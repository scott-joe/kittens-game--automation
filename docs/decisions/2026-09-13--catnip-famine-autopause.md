# Auto-pause on an impending catnip famine

**Status:** Accepted

## Ask

Pause the game before kittens start starving from catnip running out, using a
real engine signal rather than watching the on-screen famine warning element
(a DOM node that flips from `display: none` to visible).

## Revision: reactive check was too late

The first version paused only once `catnip.value + perTickCached < 0` on the
*current* tick — mathematically the same instant the game itself would starve
a kitten. That's too late to be useful: by the time it fires there's no time
left to reassign workers to more catnip production before the famine is
already underway.

The visible "Food advisor: 'Your catnip supply is too low!'" banner the user
pointed at turned out to be driven by a genuinely earlier, forward-looking
calculation in `js/jsx/left.jsx.js` (`showAdvisor`), not anything reactive:

```js
var winterDays = calendar.daysPerSeason -
    (calendar.getCurSeason().name === "winter" ? calendar.day : 0);
var catnipPerTick = game.winterCatnipPerTick; // worst-case, -75% field penalty
showAdvisor = (catnip.value + winterDays * catnipPerTick * calendar.ticksPerDay) <= 0;
```

`game.winterCatnipPerTick` is a conservative estimate — catnip production
under full winter penalty — recomputed every 25 ticks by
`updateWinterCatnip()`, independent of the actual current season. It projects
stock across the *entire remaining winter*, not just the next tick, which is
what gives enough lead time to actually fix the problem. Gated the same way
the game gates the banner: only meaningful once at least one Catnip Field is
built (`bld.get("field").on > 0`).

`main.ts` now checks this Food Advisor condition first (the early warning),
and falls back to the original current-tick reactive check as a backstop for
saves with no Catnip Fields yet (where the advisor's own gate would never
fire). Either one pauses via the same `pauseForCatnip()` helper.

Local checked-out game source
(`gym--kittens-game/_old/kitten-game--orig`) has `updateAdvisors` as a dead
stub — it's from an older build. Confirmed all of the above instead against
the live site's actual `game.js` / `js/jsx/left.jsx.js` / `res/i18n/en.json`,
fetched directly for this investigation.

## Original internal signal (still used as the backstop)

`village.js`'s own `update()` computes, every tick:

```js
var catnipPerTick = this.game.getResourcePerTick("catnip", true);
var catnipVal = this.game.resPool.get("catnip").value;
var resDiff = catnipVal + catnipPerTick;
if (resDiff < 0) { /* starve a kitten */ }
```

That per-tick rate is cached directly on the resource object as
`resPool.get('catnip').perTickCached` — the same number the UI's catnip row
displays. We reuse this instead of the game's own formula duplication, so
`main.ts` mirrors the exact condition the engine uses to decide starvation.

For stopping the game, `gamePage.tick()` itself does `if (this.isPaused)
return;` at the very top of the real per-frame update — so `isPaused` is a
genuine simulation halt, not a cosmetic overlay. `togglePause()` flips it (and
updates the `pauseBtn` DOM text, which is harmless to call outside a click
handler). Because it's a toggle, the automation only calls it while
`!g.isPaused`, and once triggered, skips the rest of that tick's automation
(crafting, hunting, etc.) rather than acting on a paused game.

## Gotcha found during testing: `perTickCached` is throttled

`game.js`'s `updateResources()` (which recalculates `perTickCached` for every
resource) is not called every tick — it's scheduled via
`this.timer.addEvent(..., 5)`, i.e. once per 5 ticks, plus immediately after
`craft()`/`craftAll()`. So `perTickCached` can lag real production changes by
up to ~5 ticks under default settings. Acceptable for a safety net (ticks are
frequent), but it means the pause won't trip the instant catnip production
changes — only once the cache catches up.

## Verification

Confirmed in a live (ephemeral, no-Tampermonkey) browser via chrome-devtools
MCP:
- Reactive backstop: forced `catnip.value` low and monkey-patched
  `calcResourcePerTick` to return a negative rate for catnip, looped
  `gamePage.tick()` until the throttled cache picked up the negative rate.
  `gamePage.isPaused` flipped `true` on exactly the tick the cache refreshed.
- Food Advisor check: unforced — an earlier test session's manipulations had
  already left this save's catnip near zero and declining with 7 real Catnip
  Fields built. On reload, the page's own UI was independently showing
  "Food advisor: 'Your catnip supply is too low!'" and the pause button read
  "unpawse" — our automation had already paused it. Console showed
  `[kg-automation] CRITICAL: Food Advisor projects catnip won't last the
  winter; pausing the game.`, matching the live UI's own warning exactly.
- Both cases: confirmed the freeze is real — further `tick()` calls left
  `catnip.value` completely unchanged.

See also [2026-09-13-resPool-race-on-injection.md](2026-09-13--respool-race-on-injection.md)
for the unrelated engine-readiness race fixed earlier in this file.
