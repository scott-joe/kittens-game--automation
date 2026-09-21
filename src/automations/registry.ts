import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "../automation-config.js";

export interface AutomationEntry {
	id: string;
	label: string;
	enabled: boolean;
	run: () => void;
}

export type AutomationChangeListener = (id: string, enabled: boolean) => void;

// Module-level rather than attached to the registry array itself: there's
// only ever one registry per page load (createRegistry runs once in
// init()), same singleton assumption window.kgAutomation already makes.
const changeListeners: AutomationChangeListener[] = [];

/**
 * Subscribe to setEnabled() calls from ANY caller (console API, DOM panel,
 * or otherwise), so consumers with their own rendered state — the panel's
 * checkboxes — can stay in sync without each caller having to know about
 * every other UI surface.
 */
export function onAutomationChange(listener: AutomationChangeListener): void {
	changeListeners.push(listener);
}

interface ManagedResourceDef {
	name: string;
	resKey: string;
	act: () => void;
}

/**
 * Builds the fixed set of automation entries for this game session: the
 * anti-famine auto-pause, auto-observe, and one per-resource danger-zone
 * crafting entry for each resource found in the current save. Constructed
 * once at init() time, mirroring where `managedResources` used to be built
 * before this registry existed.
 */
export function createRegistry(game: GameEngine): AutomationEntry[] {
	const registry: AutomationEntry[] = [];

	// --- Anti-famine auto-pause --------------------------------------------
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

	registry.push({
		id: "famine-autopause",
		label: "Anti-famine auto-pause",
		enabled: true,
		run: () => {
			if (isFoodAdvisorTriggered()) {
				pauseGame();
				console.warn(`${LOG_PREFIX} CRITICAL: Food Advisor projects catnip won't last the winter; pausing the game.`);
			} else if (isCatnipCriticalThisTick()) {
				pauseGame();
				console.warn(`${LOG_PREFIX} CRITICAL: catnip projected to run out next tick; pausing the game.`);
			}
		},
	});

	// --- Auto-observe astronomical events -----------------------------------
	// observeBtn is only set while an astronomical event is actually pending
	// observation (the game creates it alongside the "Observe the Sky"
	// message and destroys it in observeClear()). observeHandler pays out the
	// science/starchart bonus unconditionally whenever called — verified live
	// it pays out even with nothing pending — so it must only be called while
	// a button is up, mirroring a manual click. See
	// docs/decisions/2026-09-15--observe-star-event-does-not-exist.md.
	registry.push({
		id: "auto-observe",
		label: "Auto-observe sky events",
		enabled: true,
		run: () => {
			if (game.calendar?.observeBtn && typeof game.calendar.observeHandler === "function") {
				game.calendar.observeHandler();
			}
		},
	});

	// --- Per-resource danger-zone crafting -----------------------------------
	// Game content (resource keys, biome lists, etc.) can drift between the
	// version this script was written against and the version it runs on
	// (e.g. a save made on a newer build, or the game receiving an update).
	// resPool.get() returns undefined for an unrecognized key rather than
	// throwing, so each lookup is checked before the resource is tracked.
	// Every `act` here must actually spend down the resource that triggered
	// it: the danger-zone check re-fires every tick the resource stays >= 90%
	// of its cap, so an action that doesn't consume that resource runs
	// unconditionally forever instead of once per overflow. `craftAll()`
	// needs its recipe's name for this reason (a bare call throws and crafts
	// nothing), and `huntAll()`, not `sendHunters()`, is the hunting method
	// that actually spends manpower — `sendHunters()` grants hunt loot for
	// free. See docs/decisions/2026-09-15--act-firing-every-tick.md.
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

	for (const def of resourceDefs) {
		const source = game.resPool.get(def.resKey);

		if (!source) {
			console.warn(`${LOG_PREFIX} resource "${def.resKey}" not found; skipping "${def.name}" automation.`);
			continue;
		}

		const isInDangerZone = (): boolean =>
			source.maxValue > 0 && source.value / source.maxValue >= DANGER_ZONE_THRESHOLD;

		registry.push({
			id: `danger-zone:${def.resKey}`,
			label: `Danger-zone crafting: ${def.name}`,
			enabled: true,
			run: () => {
				if (isInDangerZone()) {
					console.log(`${LOG_PREFIX} "${def.name}" at ${source.value}/${source.maxValue}, running action`);
					def.act();
				}
			},
		});
	}

	console.log(`${LOG_PREFIX} registry ready:`, registry.map((e) => e.id));

	return registry;
}

/**
 * Flip one entry's enabled flag by id. Shared by the console API and the
 * DOM panel so both write through the same single source of truth and log
 * consistently, rather than each mutating `entry.enabled` inline.
 */
export function setEnabled(registry: AutomationEntry[], id: string, enabled: boolean): boolean {
	const entry = registry.find((e) => e.id === id);
	if (!entry) {
		console.warn(`${LOG_PREFIX} setEnabled: unknown automation id "${id}"`);
		return false;
	}
	entry.enabled = enabled;
	console.log(`${LOG_PREFIX} "${id}" ${enabled ? "enabled" : "disabled"}`);

	// Isolated per-listener: a broken UI subscriber (e.g. the panel failing
	// to find its checkbox) must not make toggle() itself appear to fail,
	// mirroring the tick loop's per-entry try/catch convention elsewhere in
	// this codebase.
	for (const listener of changeListeners) {
		try {
			listener(id, enabled);
		} catch (err) {
			console.warn(`${LOG_PREFIX} automation-change listener failed:`, err);
		}
	}

	return true;
}
