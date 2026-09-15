# Automation Harness

## Core principle

The compiled userscript (`dist/main.js`) runs **inside the live kittensgame.com browser tab**, not in Node. It hooks the game's own `window.gamePage` object and wraps its `tick` method — one automation pass per real game tick.

## Engine hooking

`gamePage.tick` is the primary lifecycle hook. `src/main.ts` wraps it:

```js
const originalTick = g.tick;
g.tick = function () {
  originalTick.apply(this, arguments);
  if (g.isPaused) return;
  // automation logic
};
```

Interacting with the `gamePage` API directly is more stable than simulating DOM clicks.

## Load-order gotcha: poll for subsystems, not just `gamePage`

The loader injects the script as soon as it's appended to `<body>`, which can race the game's own bootstrap: `window.gamePage` is assigned before its subsystems (`resPool`, etc.) finish constructing. `src/main.ts` polls (`setTimeout`, 100ms, 15s timeout) until `gamePage.resPool` and `gamePage.tick` both exist before doing anything.

> Full derivation and live verification: [2026-09-13: resPool race on injection](../decisions/2026-09-13--respool-race-on-injection.md)

## Engine conventions to follow

- **`gamePage.togglePause()` is a toggle, not a setter.** Always check `gamePage.isPaused` first.
- **`resPool.get()` returning `undefined` for a resource key is expected**, not a bug — game content drifts between versions/saves. Skip with a warning instead of throwing.
- Wrap each independent automation action in its own try/catch so one failure doesn't break the rest of the tick or the game's real tick.
- `perTickCached` values are only recomputed by the engine every 5 ticks — account for that lag in anything reacting to them.

## Auto-pause on impending catnip famine

Reuses two calculations the engine already makes, rather than watching the on-screen famine banner:

- **Primary — the Food Advisor forecast** (`gamePage.winterCatnipPerTick`): projects catnip stock across the rest of winter at a conservative worst-case rate, giving real lead time to reassign workers. Gated on having at least one Catnip Field.
- **Backstop — the same-tick starvation check**: `catnip.value + catnip.perTickCached < 0`. Fires only once catnip is about to run out on the very next tick — covers saves with no Catnip Fields yet, where the forecast can't engage.

Either signal calls `gamePage.togglePause()` (guarded on `!gamePage.isPaused`) and logs the reason.

> Full derivation and live verification: [2026-09-13: catnip famine autopause](../decisions/2026-09-13--catnip-famine-autopause.md)

## Defensive hardening

A console `getMeta` error on save load turned out to be the game engine's own handled version-drift warning (unrecognized biome names from a save made on a newer build) — not a bug in this project. The response was to harden `main.ts` against the same class of risk generally, rather than touch the game engine.

> Full write-up: [2026-09-13: getMeta error and defensive hardening](../decisions/2026-09-13--getmeta-error-and-defensive-hardening.md)

## Custom CSS injection

Two independently toggled CSS files, injected as `<link rel="stylesheet">` elements once the engine is confirmed ready (same point as tick-patching, at the top of `init()`):

- `src/styles/override.css` — a full-page look replacement. Gated by `ENABLE_STYLE_OVERRIDE` in `src/main.ts` (default `false`, since it's a deliberate, disruptive replacement that should require explicit opt-in).
- `src/styles/amend.css` — small tweaks layered on top of whichever theme is currently active. Gated by `ENABLE_STYLE_AMEND` (default `true` — this is its steady-state intended use).

Both files ship as build artifacts under `dist/styles/`, copied there by `scripts/copy-styles.js` as part of `pnpm run build` (and watched separately during `pnpm run dev`), then served by the same static `server.js` that serves `main.js` — `main.ts` has no bundler, so a separate `.css` asset stays editable without touching TypeScript.

**Why `<link>`, not `fetch()`:** the dev server (`127.0.0.1:5500`) is a different origin than the live game (`kittensgame.com`) and sends no CORS headers. A `fetch()` of the CSS text gets blocked by the browser's CORS check — confirmed live, it doesn't just fail quietly. A `<link rel="stylesheet">` element, like the loader's own `<script src>` tag for `main.js`, loads cross-origin without needing CORS; load success/failure is observed via its `onload`/`onerror` handlers instead of a fetch response.

**Game's theme mechanism** (verified against a reference checkout — confirm against the live site if it seems to have drifted): the game loads its base `res/default.css` plus *every* `res/theme_<id>.css` file into `<head>` up front, regardless of which is active. Which one visually applies is decided purely by a `scheme_<id>` class the game toggles on `<body>` — not by which stylesheet is loaded. There are no CSS custom properties anywhere in the game's CSS; theming is entirely class-selector-based. `gamePage.colorScheme` holds the active theme id at runtime (`""` = default).

**Gotcha carried over from theme-switching:** the game's own `updateOptions()` strips *all* classes off `<body>` before re-adding the active `scheme_<id>` class, on every options/theme change. Don't rely on a custom marker class surviving on `<body>`.

**Why injection happens at engine-ready, not earlier:** there's no single deterministic "last stylesheet wins" point built into the game — theme CSS layers over `default.css` via selector specificity, not load order, and some theme files load asynchronously during boot. Waiting until the engine (`resPool`/`tick`) is confirmed ready means the game's own boot, including that async CSS loading, should already be done, so our `<style>` elements land last in `<head>` and generally win equal-specificity ties. This is a good-enough proxy, not a hard guarantee — if the game is still appending theme `<link>` tags after our injection point, one could still win a tie. Fully closing that gap would mean hooking the theme-loading loop itself; treated as an accepted limitation rather than solved.

> Full derivation and live verification: [2026-09-13: CSS style loader](../decisions/2026-09-13--css-style-loader.md)

## API reference

Key control points identified for the userscript:

| Feature | Method / Property |
| :--- | :--- |
| Check resource | `gamePage.resPool.get('catnip').value` |
| Resource per-tick rate | `gamePage.resPool.get('catnip').perTickCached` (recalculated every 5 ticks, not every tick) |
| Craft items | `gamePage.workshop.craft('beam', 1)` |
| Send hunters | `gamePage.village.sendHunters()` |
| Pause game (toggle!) | `gamePage.togglePause()` — check `gamePage.isPaused` first, it flips rather than sets |
| Is game paused | `gamePage.isPaused` (the real per-tick early-exit flag, not cosmetic) |
| Winter-worst-case catnip rate | `gamePage.winterCatnipPerTick` (drives the in-game Food Advisor banner) |
| Building count/status | `gamePage.bld.get('field').on` |
| Upgrade status | `gamePage.upgrade.get('mineralHoes').purchased` |
| Observe star event | `gamePage.calendar.observeStarEvent()` |
| Free kittens count | `gamePage.village.getFreeKittens()` |
| Active theme id | `gamePage.colorScheme` (empty string `""` = default theme) |
| List of valid theme ids | `gamePage.ui.allSchemes` |

Other identified subsystems: `gamePage.bld` (building construction/levels), `gamePage.workshop` (crafting), `gamePage.calendar` (time/seasons/astronomical events), `gamePage.village` (kittens/jobs/hunting).

*Note: these were identified on a live page in DevTools. Kittens Game content and internals drift between builds — verify against the live site when extending this, rather than trusting any reference (including this one) as permanently accurate.*
