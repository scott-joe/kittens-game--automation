# Automation Console — Toggle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing automation (catnip famine auto-pause, auto-observe, each per-resource danger-zone craft) individually toggleable at runtime, exposed both via a console API and an in-page DOM panel, with zero change to existing automation behavior.

**Architecture:** Extract the three hand-written tick-hook blocks in `src/main.ts` into an `AutomationEntry` registry (`src/automations/registry.ts`), collapse the tick hook into a single loop over that registry, then layer a console-exposed toggle API and a floating DOM panel on top of the same registry object. This requires splitting `main.ts` into real ES modules for the first time in this project, which in turn requires switching the userscript loader from a classic `<script src>` tag to `<script type="module">` and adding a CORS header to the dev server — both verified live before anything else is built on top.

**Tech Stack:** TypeScript (`tsc`, no bundler), plain DOM APIs, Tampermonkey userscript loader, Express dev server (`server.js`), chrome-devtools MCP via the `browser-debug` skill for live verification (no automated test suite exists in this repo).

**Spec:** [docs/automation-console/01-discovery.md](../../automation-console/01-discovery.md), [02-design-toggles.md](../../automation-console/02-design-toggles.md), [05-architecture.md](../../automation-console/05-architecture.md), [06-implementation-plan.md](../../automation-console/06-implementation-plan.md) (Phase 0 + Phase 1, items #1–#3)

## Global Constraints

- FR-T1: Each automation is individually identifiable and can be enabled/disabled at runtime, without a rebuild.
- FR-T2: Disabling an automation must be effectively free — the tick loop must skip a disabled automation before doing any of its work (`if (!entry.enabled) continue;` before the try/catch, not a check inside it).
- FR-T3: The current enabled/disabled state of every automation must be inspectable at runtime.
- NFR1: Neither the DOM panel nor the registry loop may introduce perceptible tick lag versus the current hand-written blocks.
- NFR2: A toggle flip takes effect on the next tick boundary, never mid-iteration over the registry.
- NFR4: A broken toggle-UI render or a broken automation must not disable anything else — per-entry `try/catch` in the tick loop; UI injection wrapped in its own `try/catch`, never throwing into the tick.
- NFR5: No bundler switch. The build stays plain `tsc`; only native browser ES-module loading (`type="module"`) is added, verified live before use.
- Registry entries are constructed once at `init()` time, in the same place `managedResources` is built today — skip resources not found in the current save (`resPool.get()` returns `undefined`), matching the existing convention, logged via `console.warn`, never thrown.
- No new npm UI framework or runtime dependency — DOM/localStorage-only, per `docs/automation-console/05-architecture.md` §Build system.
- Every engine API already in `src/types.d.ts` is treated as live-verified; this plan introduces no new engine API calls, only relocates existing ones — no new `browser-debug` API-verification spike is needed beyond confirming the *loading mechanism* (ES modules) still works.

---

## File Structure

```
src/
  automation-config.ts       # NEW — LOG_PREFIX, DANGER_ZONE_THRESHOLD (moved out of main.ts)
  automations/
    registry.ts               # NEW — AutomationEntry type, createRegistry(game), setEnabled()
    console-api.ts            # NEW — window.kgAutomation.{list,toggle}
    panel.ts                  # NEW — floating DOM toggle panel
  main.ts                     # MODIFIED — shrinks to bootstrap/wiring, imports the above
  types.d.ts                  # MODIFIED — Window.kgAutomation type
server.js                     # MODIFIED — CORS header for cross-origin module script fetches
loader.user.js                # MODIFIED — script.type = "module"
.claude/skills/browser-debug/SKILL.md  # MODIFIED — initScript sample updated to type="module"
docs/decisions/2026-09-18--esm-module-split-and-cors.md  # NEW — ADR for the loading-mechanism change
```

**Why the CORS/module-loading change is a prerequisite, not optional polish:** `main.ts` has never had an `import`/`export` statement — it's a single IIFE loaded via a classic `<script src>` tag (`loader.user.js`), which loads cross-origin without needing CORS headers (same reason the CSS `<link>` injection works, per `docs/architecture/automation-harness.md`). Splitting automation logic into `src/automations/*.ts` means `main.ts` must contain real `import` statements, which only execute if the script tag is `type="module"`. Unlike classic scripts, **`<script type="module">` fetches are subject to CORS** per the HTML spec — so the dev server must also start sending `Access-Control-Allow-Origin`, or every cross-origin module fetch (main.js → kittensgame.com) will fail silently with a CORS error, the exact class of bug already documented for `fetch()` vs `<link>` CSS loading. This must be verified live (not assumed) before Task 2 builds `src/automations/` on top of it — hence Task 1.

---

### Task 1: Enable ES-module loading + extract `automation-config.ts`

**Files:**
- Create: `src/automation-config.ts`
- Create: `docs/decisions/2026-09-18--esm-module-split-and-cors.md`
- Modify: `server.js`
- Modify: `loader.user.js`
- Modify: `.claude/skills/browser-debug/SKILL.md` (the `initScript` code sample)
- Modify: `src/main.ts:1-10, 96-99` (see diffs below)

**Interfaces:**
- Produces: `automation-config.ts` exports `LOG_PREFIX: string` and `DANGER_ZONE_THRESHOLD: number`, both consumed by Tasks 2–4.

- [ ] **Step 1: Create `src/automation-config.ts`**

```ts
// Global automation defaults. Mirrors the existing top-of-file const
// pattern main.ts used before the automations/ module split — "what are
// the defaults" should stay answerable by reading one file.

export const LOG_PREFIX = "😻 [kg-automation]";

// Craft a resource into its next-tier good once it nears its storage cap,
// so production doesn't stall while waiting for a manual check-in.
export const DANGER_ZONE_THRESHOLD = 0.9;
```

- [ ] **Step 2: Add a CORS header to the dev server**

Edit `server.js`, inserting the header middleware before the static
middleware (dev-only local server, `*` is fine — no auth/cookies involved):

```js
const express = require('express');
const path = require('path');
const app = express();
const PORT = 5500;

// Cross-origin <script type="module"> fetches (unlike classic <script src>)
// are subject to CORS — see docs/decisions/2026-09-18--esm-module-split-and-cors.md.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n✓ Server running at http://127.0.0.1:${PORT}`);
  console.log(`✓ Load script in Tampermonkey from: http://127.0.0.1:${PORT}/main.js\n`);
});
```

- [ ] **Step 3: Switch the loader to a module script**

Edit `loader.user.js`, changing the script-tag construction:

```js
(() => {
	const SCRIPT_URL = "http://127.0.0.1:5500/main.js";

	const script = document.createElement("script");
	script.type = "module";
	// Served by this project's own dev server (`pnpm run dev` / `pnpm run server`),
	// which serves the dist/ folder as its web root — see server.js.
	script.src = SCRIPT_URL;
	script.onload = () => {
		console.log("[Kittens Automation] Loader: Script loaded successfully");
	};
	script.onerror = () => {
		console.error(`[Kittens Automation] Loader: Failed to load script from ${SCRIPT_URL}`);
		console.error(
			'[Kittens Automation] Loader: Ensure the dev server is running: `pnpm run dev` (or `pnpm run server`) in the project folder',
		);
	};
	document.body.appendChild(script);
})();
```

- [ ] **Step 4: Update the `browser-debug` skill's `initScript` sample**

Edit `.claude/skills/browser-debug/SKILL.md`, adding `script.type = "module";`
to its `initScript` code block (same edit as Step 3, applied to the
duplicated inline copy used for headless verification):

```js
(() => {
  const SCRIPT_URL = "http://127.0.0.1:5500/main.js";
  const inject = () => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = SCRIPT_URL;
    script.onload = () => console.log("[Kittens Automation] Loader: Script loaded successfully");
    script.onerror = () => console.error(`[Kittens Automation] Loader: Failed to load script from ${SCRIPT_URL}`);
    document.body.appendChild(script);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
```

- [ ] **Step 5: Wire `main.ts` to import from `automation-config.ts`**

Replace `src/main.ts:1-10`:

```ts
// Kittens Game Automation Harness
(() => {
	const LOG_PREFIX = "😻 [kg-automation]";

	// --- Custom style loader config -------------------------------------
	// Toggle fetching+injecting our own CSS files. See src/styles/*.css and
	// docs/architecture/automation-harness.md.
	const ENABLE_STYLE_OVERRIDE = false; // full page look replacement (src/styles/override.css)
	const ENABLE_STYLE_AMEND = true; // small layered tweaks over the active theme (src/styles/amend.css)
	const STYLE_BASE_URL = "http://127.0.0.1:5500/styles";
```

with:

```ts
// Kittens Game Automation Harness
import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "./automation-config.js";

(() => {
	// --- Custom style loader config -------------------------------------
	// Toggle fetching+injecting our own CSS files. See src/styles/*.css and
	// docs/architecture/automation-harness.md.
	const ENABLE_STYLE_OVERRIDE = false; // full page look replacement (src/styles/override.css)
	const ENABLE_STYLE_AMEND = true; // small layered tweaks over the active theme (src/styles/amend.css)
	const STYLE_BASE_URL = "http://127.0.0.1:5500/styles";
```

(Note the `.js` extension on the import specifier even though the source
file is `automation-config.ts` — this is required for the compiled output
to resolve as a real browser ES-module import; `tsc` resolves it against
the `.ts` source at compile time and preserves the `.js` specifier as
written in its output.)

Then remove the now-duplicated constant a few lines down. Delete these
three lines from inside `init()` (currently `src/main.ts:96-99`, right
before `interface ManagedResource {`):

```ts
			// Craft a resource into its next-tier good once it nears its storage cap,
			// so production doesn't stall while waiting for a manual check-in.
			const DANGER_ZONE_THRESHOLD = 0.9;
```

`DANGER_ZONE_THRESHOLD` isn't actually consumed yet at this point in the
file (Task 2 moves its one use site into `registry.ts`) — leave the
now-unused import; `tsc` won't error on an unused top-level import, and
Task 2 will use it within the same file's dependency graph. Confirm with
`pnpm run build` in Step 6 regardless.

- [ ] **Step 6: Build and verify no TypeScript errors**

Run: `pnpm run build`
Expected: exits 0, `dist/automation-config.js` now exists alongside
`dist/main.js`.

- [ ] **Step 7: Live-verify module loading over CORS via the `browser-debug` skill**

Invoke the `browser-debug` skill against `https://kittensgame.com/web/`
using the Step 4 `initScript`. After `wait_for(["catnip", "Catnip
Field"])`, run:

```js
// Confirm main.js loaded as a module (no "Cannot use import statement
// outside a module" syntax error) and pulled in automation-config.js
// cross-origin without a CORS failure.
window.gamePage ? "gamePage present" : "gamePage missing"
```

Then check `list_console_messages` / `list_network_requests` (filtered to
`127.0.0.1:5500`) for:
- No `SyntaxError: Cannot use import statement outside a module`.
- No `CORS` / `Access-Control-Allow-Origin` error on the request for
  `automation-config.js`.
- The usual `😻 [Kittens Automation] Loader: Script loaded successfully`
  and `Kittens Game Engine metadata:` log lines still appear.
- A `GET http://127.0.0.1:5500/automation-config.js` entry in
  `list_network_requests` with status 200.

If any of these fail, treat it as a go/no-go gate on the whole plan —
do not proceed to Task 2 until module loading is confirmed working live.

- [ ] **Step 8: Write the ADR**

Create `docs/decisions/2026-09-18--esm-module-split-and-cors.md` following
the existing files in `docs/decisions/` as the template (what happened,
root cause/reasoning, fix, live verification evidence) — cover: why the
split needed `type="module"`, why that requires CORS unlike the classic
`<script src>`/`<link>` cases already documented, and the Step 7 live
verification result.

- [ ] **Step 9: Commit**

```bash
git add src/automation-config.ts src/main.ts server.js loader.user.js \
  .claude/skills/browser-debug/SKILL.md \
  docs/decisions/2026-09-18--esm-module-split-and-cors.md
git commit -m "$(cat <<'EOF'
Enable ES-module loading and extract automation-config.ts

Splitting automation logic into src/automations/ requires main.ts to use
real import statements, which only run under type="module" — verified
live that switching the loader script tag requires a CORS header on the
dev server, since module fetches (unlike classic <script src>) enforce
CORS.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract the automation registry, refactor the tick loop

**Files:**
- Create: `src/automations/registry.ts`
- Modify: `src/main.ts` (full-file replacement below)

**Interfaces:**
- Consumes: `LOG_PREFIX`, `DANGER_ZONE_THRESHOLD` from `../automation-config.js` (Task 1).
- Produces: `AutomationEntry` interface (`id: string; label: string; enabled: boolean; run: () => void`), `createRegistry(game: GameEngine): AutomationEntry[]`, and `setEnabled(registry: AutomationEntry[], id: string, enabled: boolean): boolean` — all consumed by Tasks 3 and 4.

- [ ] **Step 1: Create `src/automations/registry.ts`**

```ts
import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "../automation-config.js";

export interface AutomationEntry {
	id: string;
	label: string;
	enabled: boolean;
	run: () => void;
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
	return true;
}
```

- [ ] **Step 2: Replace `src/main.ts` in full**

```ts
// Kittens Game Automation Harness
import { LOG_PREFIX } from "./automation-config.js";
import { createRegistry } from "./automations/registry.js";

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

		const registry = createRegistry(game);

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
```

- [ ] **Step 3: Build and verify no TypeScript errors**

Run: `pnpm run build`
Expected: exits 0, `dist/automations/registry.js` now exists.

- [ ] **Step 4: Live-verify byte-identical behavior via the `browser-debug` skill**

This is the critical regression check for Phase 0 ("no behavior change").
Invoke `browser-debug` against `https://kittensgame.com/web/` and, using
the reset/seed test harness documented in the skill (fresh save, seeded
catnip, a bought Catnip Field), verify each relocated automation still
fires:

```js
// 1. Danger-zone crafting still fires for a resource pushed >= 90% of cap.
//    (Catnip's danger-zone action is game.craft("wood", 10).)
const catnip = gamePage.resPool.get('catnip');
catnip.maxValue = 100;
catnip.value = 95; // 95% >= 90% threshold
const woodBefore = gamePage.resPool.get('wood').value;
gamePage.tick();
gamePage.resPool.get('wood').value > woodBefore
  ? "danger-zone:catnip fired (wood increased)"
  : "REGRESSION: danger-zone:catnip did not fire"
```

```js
// 2. Anti-famine backstop still pauses the game.
gamePage.isPaused = false; // reset from any prior test
const c = gamePage.resPool.get('catnip');
c.value = 1;
c.perTickCached = -5; // c.value + perTickCached < 0
gamePage.tick();
gamePage.isPaused ? "famine-autopause fired (paused)" : "REGRESSION: famine-autopause did not fire"
```

```js
// 3. Auto-observe still only acts while observeBtn is set (no throw either way).
gamePage.isPaused = false;
gamePage.calendar.observeBtn = null;
gamePage.tick(); // should not throw
"auto-observe ran without throwing while inactive"
```

```js
// 4. Console confirms the registry replaced the old hand-written blocks.
// Expect one "registry ready:" log listing exactly:
// ["famine-autopause", "auto-observe", "danger-zone:catnip", "danger-zone:wood",
//  "danger-zone:minerals", "danger-zone:iron", "danger-zone:coal", "danger-zone:gold",
//  "danger-zone:catpower", "danger-zone:culture", "danger-zone:furs", "danger-zone:faith"]
```

Check `list_console_messages` for that exact `registry ready:` line and
confirm no new errors appeared versus a pre-refactor baseline run.

- [ ] **Step 5: Commit**

```bash
git add src/automations/registry.ts src/main.ts
git commit -m "$(cat <<'EOF'
Refactor tick automations into a toggleable AutomationEntry registry

Collapses the three hand-written tick-hook blocks (famine auto-pause,
auto-observe, per-resource danger-zone crafting) into a single registry
loop that skips disabled entries before doing any work. No behavior
change — verified live via browser-debug that each automation still
fires identically to before the refactor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Console-exposed toggle API (`window.kgAutomation`)

*Can be implemented in parallel with Task 4 — both depend only on Task 2's
`registry.ts`, not on each other. Expect a trivial two-line merge conflict
in `src/main.ts` (one `import` line, one call in `init()`) if run as
separate concurrent subagents; resolve by keeping both lines.*

**Files:**
- Create: `src/automations/console-api.ts`
- Modify: `src/types.d.ts:251-254`
- Modify: `src/main.ts` (two-line addition, see diff)

**Interfaces:**
- Consumes: `AutomationEntry`, `setEnabled` from `./registry.js` (Task 2); `LOG_PREFIX` from `../automation-config.js` (Task 1).
- Produces: `installConsoleApi(registry: AutomationEntry[]): void`, and the global `window.kgAutomation: AutomationConsoleAPI` with `list(): AutomationConsoleEntry[]` and `toggle(id: string, enabled: boolean): boolean`.

- [ ] **Step 1: Create `src/automations/console-api.ts`**

```ts
import { LOG_PREFIX } from "../automation-config.js";
import { AutomationEntry, setEnabled } from "./registry.js";

export interface AutomationConsoleEntry {
	id: string;
	label: string;
	enabled: boolean;
}

export interface AutomationConsoleAPI {
	list(): AutomationConsoleEntry[];
	toggle(id: string, enabled: boolean): boolean;
}

/**
 * Exposes the registry's enable/disable state as a console-callable API
 * (`window.kgAutomation`) — the v0 toggle surface from
 * docs/automation-console/02-design-toggles.md, intended to stay useful
 * even after the DOM panel (Task 4) ships, since both read/write the same
 * registry object.
 */
export function installConsoleApi(registry: AutomationEntry[]): void {
	window.kgAutomation = {
		list: () => registry.map(({ id, label, enabled }) => ({ id, label, enabled })),
		toggle: (id, enabled) => setEnabled(registry, id, enabled),
	};
	console.log(`${LOG_PREFIX} console API installed: window.kgAutomation.list() / .toggle(id, enabled)`);
}
```

- [ ] **Step 2: Add the `window.kgAutomation` type**

Edit `src/types.d.ts:251-254`, replacing:

```ts
    interface Window {
        gamePage?: GameEngine;
        game?: GameEngine;
    }
```

with:

```ts
    interface Window {
        gamePage?: GameEngine;
        game?: GameEngine;
        kgAutomation?: import("./automations/console-api").AutomationConsoleAPI;
    }
```

- [ ] **Step 3: Wire it into `main.ts`**

Add to the import group at the top of `src/main.ts`:

```ts
import { installConsoleApi } from "./automations/console-api.js";
```

And in `init()`, immediately after `const registry = createRegistry(game);`:

```ts
		const registry = createRegistry(game);
		installConsoleApi(registry);
```

- [ ] **Step 4: Build and verify no TypeScript errors**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 5: Live-verify via the `browser-debug` skill**

```js
// List should show all 12 entries, each enabled.
window.kgAutomation.list()
```

```js
// Disable catnip's danger-zone entry, confirm it actually stops firing.
window.kgAutomation.toggle("danger-zone:catnip", false);
const catnip = gamePage.resPool.get('catnip');
catnip.maxValue = 100;
catnip.value = 95;
const woodBefore = gamePage.resPool.get('wood').value;
gamePage.tick();
gamePage.resPool.get('wood').value === woodBefore
  ? "toggle off worked: danger-zone:catnip did not fire"
  : "REGRESSION: fired while disabled"
```

```js
// Re-enable, confirm it fires again.
window.kgAutomation.toggle("danger-zone:catnip", true);
const woodBefore2 = gamePage.resPool.get('wood').value;
gamePage.tick();
gamePage.resPool.get('wood').value > woodBefore2
  ? "toggle on worked: danger-zone:catnip fired again"
  : "REGRESSION: did not resume after re-enabling"
```

```js
// Unknown id returns false, doesn't throw.
window.kgAutomation.toggle("not-a-real-id", false) === false
```

- [ ] **Step 6: Commit**

```bash
git add src/automations/console-api.ts src/types.d.ts src/main.ts
git commit -m "$(cat <<'EOF'
Add window.kgAutomation console API for toggling automations

v0 toggle surface from docs/automation-console/02-design-toggles.md —
console-callable list()/toggle() over the same registry the tick loop
reads, verified live that a disabled entry actually stops running and a
re-enabled one resumes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: In-page DOM toggle panel

*Can be implemented in parallel with Task 3 — see note at the top of
Task 3.*

**Files:**
- Create: `src/automations/panel.ts`
- Modify: `src/main.ts` (two-line addition, see diff)

**Interfaces:**
- Consumes: `AutomationEntry`, `setEnabled` from `./registry.js` (Task 2); `LOG_PREFIX` from `../automation-config.js` (Task 1).
- Produces: `injectTogglePanel(registry: AutomationEntry[]): void`.

- [ ] **Step 1: Create `src/automations/panel.ts`**

```ts
import { LOG_PREFIX } from "../automation-config.js";
import { AutomationEntry, setEnabled } from "./registry.js";

const PANEL_ID = "kg-automation-panel";

/**
 * Injects a small floating checkbox list, one row per registry entry, so
 * toggling an automation doesn't require the DevTools console. Follows the
 * loadAndInjectStyle precedent in main.ts for *where* it attaches (called
 * from init(), after engine-ready is confirmed) — not for *how* it renders,
 * since a settings panel needs real DOM elements and event listeners, not
 * a <link> tag. Reads/writes the exact same registry array the tick loop
 * and the console API (Task 3) use, via the shared setEnabled() helper, so
 * all three surfaces always agree on state.
 */
export function injectTogglePanel(registry: AutomationEntry[]): void {
	try {
		if (document.getElementById(PANEL_ID)) return; // already injected, e.g. init() ran more than once

		const panel = document.createElement("div");
		panel.id = PANEL_ID;
		panel.style.cssText = [
			"position: fixed",
			"bottom: 8px",
			"right: 8px",
			"z-index: 99999",
			"background: rgba(20, 20, 20, 0.85)",
			"color: #eee",
			"font: 12px sans-serif",
			"padding: 8px 10px",
			"border-radius: 6px",
			"max-height: 40vh",
			"overflow-y: auto",
			"box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4)",
		].join(";");

		const title = document.createElement("div");
		title.textContent = "Kittens Automation";
		title.style.cssText = "font-weight: bold; margin-bottom: 4px;";
		panel.appendChild(title);

		for (const entry of registry) {
			const row = document.createElement("label");
			row.style.cssText = "display: flex; align-items: center; gap: 6px; margin: 2px 0; cursor: pointer;";

			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = entry.enabled;
			checkbox.addEventListener("change", () => {
				setEnabled(registry, entry.id, checkbox.checked);
			});

			const text = document.createElement("span");
			text.textContent = entry.label;

			row.appendChild(checkbox);
			row.appendChild(text);
			panel.appendChild(row);
		}

		document.body.appendChild(panel);
		console.log(`${LOG_PREFIX} toggle panel injected (${registry.length} automations)`);
	} catch (err) {
		console.warn(`${LOG_PREFIX} failed to inject toggle panel:`, err);
	}
}
```

- [ ] **Step 2: Wire it into `main.ts`**

Add to the import group at the top of `src/main.ts`:

```ts
import { injectTogglePanel } from "./automations/panel.js";
```

And in `init()`, immediately after the `installConsoleApi(registry);` line
added by Task 3 (or after `const registry = createRegistry(game);` if Task
4 lands before Task 3):

```ts
		injectTogglePanel(registry);
```

- [ ] **Step 3: Build and verify no TypeScript errors**

Run: `pnpm run build`
Expected: exits 0.

- [ ] **Step 4: Live-verify via the `browser-debug` skill**

```js
// Panel exists with one checkbox per registry entry.
const panel = document.getElementById("kg-automation-panel");
const boxes = panel.querySelectorAll('input[type="checkbox"]');
boxes.length === window.kgAutomation.list().length
  ? "panel row count matches registry"
  : "REGRESSION: row count mismatch"
```

Take a screenshot (`take_screenshot`) to visually confirm the panel is
positioned bottom-right and doesn't overlap or obscure the game's own
resource bar / tab UI.

```js
// Clicking a checkbox updates the registry (panel -> registry direction).
const firstBox = boxes[0];
const idBefore = window.kgAutomation.list()[0].enabled;
firstBox.click();
window.kgAutomation.list()[0].enabled !== idBefore
  ? "panel checkbox click flipped registry state"
  : "REGRESSION: click had no effect"
```

```js
// Console-API toggles (Task 3) and the panel read the same registry array
// by reference, so a toggle from either surface is visible to the other
// immediately via window.kgAutomation.list() — a live-updating checkbox
// UI (re-rendering the DOM on external change) is explicitly out of scope
// per docs/automation-console/02-design-toggles.md non-goals.
window.kgAutomation.toggle("auto-observe", false);
window.kgAutomation.list().find(e => e.id === "auto-observe").enabled === false
  ? "registry reflects the console toggle (panel's checkbox will match on next injection)"
  : "REGRESSION: console toggle didn't update shared registry"
```

- [ ] **Step 5: Commit**

```bash
git add src/automations/panel.ts src/main.ts
git commit -m "$(cat <<'EOF'
Add in-page DOM toggle panel for automations

v1 toggle surface from docs/automation-console/02-design-toggles.md — a
floating checkbox panel wired to the same registry the console API and
tick loop use. Verified live that it renders without colliding with the
game's own UI and that checkbox clicks flip registry state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Explicitly out of scope for this plan

Per `docs/automation-console/06-implementation-plan.md`, Phase 2
(workflow persistence/picker) and Phases 3–4 (goal planner) are separate,
later plans — not part of this one. The free-kitten job-assignment stub in
`main.ts`'s tick hook (currently an empty `if` block) is untouched; it is
not one of the three automations named in FR-T1.
