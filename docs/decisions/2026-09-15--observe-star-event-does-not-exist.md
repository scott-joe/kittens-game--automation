# Auto-observe silently no-opping: `observeStarEvent` does not exist

**Status:** Accepted

## Ask

The user reported that "A rare astronomical event occurred in the sky"
messages appear in the game log, but the science bonus isn't granted until
they manually click the in-game "Observe" button — the auto-observe
automation wasn't doing anything.

## Root cause

`src/main.ts` called `game.calendar.observeStarEvent()`, guarded by
`typeof game.calendar?.observeStarEvent === "function"`. Confirmed live
(`kittensgame.com`, `Ver 1.6.1.6.r163`):

```js
typeof gamePage.calendar.observeStarEvent   // -> "undefined"
```

That method has never existed on the live engine. The `typeof` guard was
doing exactly what it was written to do — refusing to call something that
isn't a function — so it never threw and never logged a warning; it just
silently skipped the block every tick. Same class of bug as `craftAll()` in
[2026-09-15: `act()` firing every tick](2026-09-15--act-firing-every-tick.md):
a method name written from memory instead of verified against source, except
here the guard clause masked it completely instead of surfacing a warning.

The reference checkout (`js/calendar.js`) shows what the game actually does:
on an astronomical event, it calls `observeClear()`, logs the "event
occurred" message, and creates an `observeBtn` `<input>` wired to
`observeHandler` via `dojo.connect(..., "onclick", this, this.observeHandler)`.
`observeHandler()` is the function that actually grants science/starcharts —
confirmed both in source and live it does **not** check whether an event is
actually pending:

```js
// before: science = 0
gamePage.calendar.observeHandler();
// after: science = 25 — paid out with nothing pending
```

So the fix isn't just "call the right method" — it's "call the right method
only while a button would actually be showing," mirroring what a manual
click does. `observeBtn` is non-null exactly while an event is pending (the
game destroys it in `observeClear()`, which `observeHandler()` itself calls
first thing), so it's the correct gate.

## Fix

`src/main.ts` (tick loop): replaced the `observeStarEvent()` call with

```js
if (game.calendar?.observeBtn && typeof game.calendar.observeHandler === "function") {
	game.calendar.observeHandler();
}
```

`src/types.d.ts`: replaced `observeStarEvent(): void;` with
`observeHandler(): void;` and `observeBtn: unknown;` on `Calendar`, with an
inline comment citing this file so the gating requirement isn't lost again.

## Verification

Live (ephemeral, no-Tampermonkey browser via chrome-devtools MCP), against
the running save, after rebuilding and reloading with the patched script:

- Fabricated a pending event (`gamePage.calendar.observeBtn = <detached
  input element>`, `observeRemainingTime = 300`) and called `gamePage.tick()`
  once: science rose by 25 and `observeBtn` was cleared back to `null` by
  `observeHandler()` itself — the automation resolved the pending event on
  the very next tick, matching what clicking "Observe" would do.
- Called `gamePage.tick()` again with nothing pending: science was
  unchanged — confirms the gate prevents the free-science bug that calling
  `observeHandler()` unconditionally would reintroduce.
