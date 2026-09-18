// Kittens Game Automation Harness
import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "./automation-config.js";

(() => {
	// --- Custom style loader config -------------------------------------
	// Toggle fetching+injecting our own CSS files. See src/styles/*.css and
	// docs/architecture/automation-harness.md.
	const ENABLE_STYLE_OVERRIDE = false; // full page look replacement (src/styles/override.css)
	const ENABLE_STYLE_AMEND = true; // small layered tweaks over the active theme (src/styles/amend.css)
	const STYLE_BASE_URL = "http://127.0.0.1:5500/styles";

	// The loader script injects us as soon as it's appended to <body>, which can
	// race the game's own bootstrap: `window.gamePage` is assigned before all of
	// its subsystems (resPool, village, etc.) finish constructing, so `g` can be
	// truthy while `g.resPool` is still undefined. Poll until the engine is
	// actually usable instead of assuming presence of `gamePage` means ready.
	const READY_POLL_INTERVAL_MS = 100;
	const READY_POLL_TIMEOUT_MS = 15000;

	const isEngineReady = (candidate: any): candidate is GameEngine =>
		!!candidate && !!candidate.resPool && typeof candidate.tick === "function";

	/**
	 * Injects a <link rel="stylesheet"> pointing at `url` into <head>, with id
	 * `elementId`. Guards against double-injection by checking for an existing
	 * element with that id first (calling `onLoaded` immediately in that case).
	 * Uses a <link> rather than fetch()-ing the CSS text into a <style> tag
	 * because the dev server is on a different origin (127.0.0.1:5500) than
	 * the game (kittensgame.com) and sends no CORS headers — fetch() gets
	 * blocked by the browser, the same way it would for any cross-origin
	 * fetch, while a stylesheet <link> loads cross-origin without needing
	 * CORS (the same reason the loader's own <script src> tag for main.js
	 * works). Load failures are caught via `onerror` and logged via
	 * console.warn, never thrown, matching this file's "log+skip" convention
	 * for optional automation pieces.
	 */
	function loadAndInjectStyle(url: string, elementId: string, onLoaded?: () => void): void {
		try {
			if (document.getElementById(elementId)) {
				onLoaded?.(); // already injected, e.g. init() ran more than once
				return;
			}
			const link = document.createElement("link");
			link.id = elementId;
			link.rel = "stylesheet";
			link.href = url;
			link.onload = () => {
				console.log(`${LOG_PREFIX} injected style "${elementId}" from ${url}`);
				onLoaded?.();
			};
			link.onerror = () => {
				console.warn(`${LOG_PREFIX} style "${elementId}" failed to load from ${url}`);
			};
			document.head.appendChild(link);
		} catch (err) {
			console.warn(`${LOG_PREFIX} failed to inject style "${elementId}":`, err);
		}
	}

	const dateTime = Date.now();

	const waitForEngine = () => {
		const game = window.gamePage || window.game;
		if (isEngineReady(game)) {
			init(game);
			return;
		}

		if (Date.now() - dateTime >= READY_POLL_TIMEOUT_MS) {
			console.warn(`${LOG_PREFIX} Kittens Game engine never became ready; giving up.`);
			return;
		}

		setTimeout(waitForEngine, READY_POLL_INTERVAL_MS);
	};

	waitForEngine();

	function init(game: GameEngine) {
		// Inject our custom CSS <link>s, gated by the config consts above. Done
		// here, right after waitForEngine confirms the engine (resPool/tick) is
		// ready, because by that point the game's own boot — including its
		// async per-theme CSS loading — should be complete, so our stylesheets
		// land last in <head> and win ties in the cascade at equal specificity.
		// One-time setup, independent of the tick loop below; load is
		// asynchronous (onload/onerror) so a slow/failed load never blocks
		// automation.
		if (ENABLE_STYLE_OVERRIDE) {
			loadAndInjectStyle(`${STYLE_BASE_URL}/override.css`, "kg-automation-style-override");
		}
		if (ENABLE_STYLE_AMEND) {
			loadAndInjectStyle(`${STYLE_BASE_URL}/amend.css`, "kg-automation-style-amend", () => {
				console.log(`${LOG_PREFIX} amend style active; theme scheme: "${game.colorScheme || "default"}"`);
			});
		}

		interface ManagedResource {
			name: string;
			enabled: boolean;
			source: GameResource;
			act: () => void;
		}

		interface ManagedResourceDef {
			name: string;
			resKey: string;
			act: () => void;
		}

		const isInDangerZone = (res: ManagedResource): boolean =>
			res.source.maxValue > 0 &&
			res.source.value / res.source.maxValue >= DANGER_ZONE_THRESHOLD;

		// Game content (resource keys, biome lists, etc.) can drift between the
		// version this script was written against and the version it runs on
		// (e.g. a save made on a newer build, or the game receiving an update).
		// resPool.get() returns undefined for an unrecognized key rather than
		// throwing, so each lookup is checked before the resource is tracked.
		// Every `act` here must actually spend down the resource that
		// triggered it: isInDangerZone() re-fires every tick the resource
		// stays >= 90% of its cap, so an action that doesn't consume that
		// resource runs unconditionally forever instead of once per overflow.
		// `craftAll()` needs its recipe's name for this reason (a bare call
		// throws and crafts nothing), and `huntAll()`, not `sendHunters()`,
		// is the hunting method that actually spends manpower —
		// `sendHunters()` grants hunt loot for free. See
		// docs/decisions/2026-09-15--act-firing-every-tick.md.
		const resourceDefs: ManagedResourceDef[] = [
			{ name: "catnip", resKey: "catnip", act: () => game.craft("wood", 10) },
			{ name: "wood", resKey: "wood", act: () => game.craft("beam", 2) },
			{ name: "minerals", resKey: "minerals", act: () => game.craft("slab", 2) },
			{ name: "iron", resKey: "iron", act: () => game.craft("plate", 2) },
			{ name: "coal", resKey: "coal", act: () => game.craftAll("steel") },
			{ name: "gold", resKey: "gold", act: () => game.village.promoteKittens() },
			{ name: "catpower", resKey: "manpower", act: () => game.village.huntAll() },
			{ name: "culture", resKey: "culture", act: () => game.craftAll("manuscript") },
			{ name: "furs", resKey: "furs", act: () => game.craftAll("parchment") },
			{ name: "faith", resKey: "faith", act: () => game.religion.praise() },
		];

		const managedResources: ManagedResource[] = [];
		for (const def of resourceDefs) {
			const source = game.resPool.get(def.resKey);
			
			if (!source) {
				console.warn(`${LOG_PREFIX} resource "${def.resKey}" not found; skipping "${def.name}" automation.`);
				continue;
			}
			managedResources.push({ name: def.name, source, act: def.act, enabled: true });
		}

		console.log(`${LOG_PREFIX} ready, tracking:`, managedResources.map((r) => r.name));

		// `gamePage.tick()` itself no-ops when `isPaused` is set, so flipping that
		// flag is a real stop, not a cosmetic one — but `togglePause()` is a
		// toggle, so callers must only invoke it while not already paused.
		const pauseGame = () => {
			if (game.isPaused) return;
			game.togglePause();
		};

		// Primary trigger: the game's own Food Advisor forecast (left.jsx.js
		// `showAdvisor`) — it projects catnip stock across the *rest of winter*
		// at a conservative worst-case rate (`winterCatnipPerTick`, a -75% catnip
		// penalty applied every 25 ticks by `updateWinterCatnip()`), not just the
		// current tick's rate. That's what gives enough lead time to reassign
		// workers before catnip actually runs dry, instead of reacting only once
		// it already has. Gated the same way the game gates it: only meaningful
		// once Catnip Fields exist.
		const isFoodAdvisorTriggered = (): boolean => {
			const field = game.bld.get("field");
			if (!field || field.on <= 0) { return false }
			
			const catnip = game.resPool.get("catnip");
			if (!catnip) { return false }
			
			const calendar = game.calendar;
			const winterDays =
				calendar.daysPerSeason - (calendar.getCurSeason().name === "winter" ? calendar.day : 0);
			const projected = catnip.value + winterDays * game.winterCatnipPerTick * calendar.ticksPerDay;

			return projected <= 0;
		};

		// Backstop: the game's own starvation check (village.js `update()`) kills
		// a kitten whenever `catnip.value + getResourcePerTick("catnip") < 0` on
		// the *current* tick. Catches cases the forward-looking advisor check
		// above doesn't cover (e.g. no Catnip Fields built yet), at the cost of
		// much less lead time to react.
		const isCatnipCriticalThisTick = (): boolean => {
			const catnip = game.resPool.get("catnip");
			if (!catnip) {
				return false;
			}
			return catnip.value + (catnip.perTickCached ?? 0) < 0;
		};

		const originalTick = game.tick;
		game.tick = function (...args: any[]) {
			originalTick.apply(this, args);

			// EXIT IF GAME IS PAUSED
			// Don't act on a paused game, whether we just paused it for the
			// catnip emergency above or the player paused it themselves.
			if (game.isPaused) return;

			// ANTI-FAMINE AUTO-PAUSE
			try {
				if (isFoodAdvisorTriggered()) {
					pauseGame();
					console.warn(`${LOG_PREFIX} CRITICAL: Food Advisor projects catnip won't last the winter; pausing the game.`);
				} else if (isCatnipCriticalThisTick()) {
					pauseGame();
					console.warn(`${LOG_PREFIX} CRITICAL: catnip projected to run out next tick; pausing the game.`);
				}
			} catch (err) {
				console.warn(`${LOG_PREFIX} catnip-critical check failed:`, err);
			}

			// Everything below is our automation layered on top of the real tick,
			// which has already run by this point. None of it should be able to
			// take the game down, so each independent piece is isolated in its
			// own try/catch rather than one guard around the whole block.
			try {
				// observeBtn is only set while an astronomical event is actually
				// pending observation (the game creates it alongside the "Observe
				// the Sky" message and destroys it in observeClear()). observeHandler
				// pays out the science/starchart bonus unconditionally whenever
				// called — verified live it pays out even with nothing pending — so
				// it must only be called while a button is up, mirroring a manual
				// click. See docs/decisions/2026-09-15--observe-star-event-does-not-exist.md.
				if (game.calendar?.observeBtn && typeof game.calendar.observeHandler === "function") {
					game.calendar.observeHandler();
				}
			} catch (err) {
				console.warn(`${LOG_PREFIX} observeHandler failed:`, err);
			}

			for (const resource of managedResources) {
				if (!resource.enabled) continue;

				try {
					if (isInDangerZone(resource)) {
						console.log(`${LOG_PREFIX} "${resource.name}" at ${resource.source.value}/${resource.source.maxValue}, running action`);
						resource.act();
					}
				} catch (err) {
					console.warn(`${LOG_PREFIX} action for "${resource.name}" failed:`, err);
				}
			}

			// AUTO-ASSIGNING KITTEN JOBS
			try {
				if (
					typeof game.village?.getFreeKittens === "function" && game.village.getFreeKittens() > 0
				) {
					// Logic for auto-assigning jobs
				}
			} catch (err) {
				console.warn(`${LOG_PREFIX} free-kitten check failed:`, err);
			}
		};
	}
})();
