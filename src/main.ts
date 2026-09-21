// Kittens Game Automation Harness
import { LOG_PREFIX } from "./automation-config.js";
import { createRegistry } from "./automations/registry.js";
import { installConsoleApi } from "./automations/console-api.js";
import { installPanel } from "./automations/panel.js";

(() => {
	// --- Custom style loader config -------------------------------------
	// Toggle fetching+injecting our own CSS files. See src/styles/*.css and
	// docs/architecture/automation-harness.md.
	const ENABLE_STYLE_OVERRIDE = false; // full page look replacement (src/styles/override.css)
	const ENABLE_STYLE_AMEND = true; // small layered tweaks over the active theme (src/styles/amend.css)
	const ENABLE_TOGGLE_PANEL = true; // floating automation on/off panel (src/styles/panel.css)
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

		const registry = createRegistry(game);
		installConsoleApi(registry);

		if (ENABLE_TOGGLE_PANEL) {
			loadAndInjectStyle(`${STYLE_BASE_URL}/panel.css`, "kg-automation-style-panel", () => {
				installPanel(registry);
			});
		}

		const originalTick = game.tick;
		game.tick = function (...args: any[]) {
			originalTick.apply(this, args);

			// EXIT IF GAME IS PAUSED
			// Don't act on a paused game, whether we just paused it for the
			// catnip emergency above or the player paused it themselves.
			if (game.isPaused) return;

			// Everything below is our automation layered on top of the real tick,
			// which has already run by this point. None of it should be able to
			// take the game down, so each independent entry is isolated in its
			// own try/catch rather than one guard around the whole loop.
			for (const entry of registry) {
				if (!entry.enabled) continue;

				try {
					entry.run();
				} catch (err) {
					console.warn(`${LOG_PREFIX} "${entry.id}" failed:`, err);
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
