# `act()` firing every tick instead of once per overflow

**Status:** Accepted

## Ask

The user reported the in-game log flooding with "Your kittens returned from a
hunt with..." messages, and certain resources climbing without bound. Told to
revisit the `act()` functions in `resourceDefs` (`src/main.ts`) to make sure
none of them fire every tick without real cause.

## Root cause

`isInDangerZone()` is level-triggered, not edge-triggered: it returns `true`
on every tick where `value / maxValue >= 0.9`, and the tick loop calls `act()`
again each time it does. That's fine *only if* `act()` reliably lowers the
resource back below 90% — for the crafting resources (catnip → wood, wood →
beam, minerals → slab, iron → plate, faith → praise) it does, so the pattern
self-limits: craft/praise runs a few times while draining the stockpile, then
stops until production climbs back into the zone.

Two of the ten `act()` entries didn't hold up that side of the contract:

### 1. `catpower` → `village.sendHunters()`

Confirmed against both the reference checkout and the live game
(`village.js`):

```js
sendHunters: function() {
    this.gainHuntRes(1);
},

huntAll: function() {
    var squads = Math.floor(this.game.resPool.get("manpower").value / 100);
    if (squads >= 1) {
        this.game.resPool.addResEvent("manpower", -squads * 100);
        this.gainHuntRes(squads);
    }
    ...
},
```

`sendHunters()` always sends exactly one squad and never touches `manpower`.
Once catpower crossed 90% of its cap, `isInDangerZone()` stayed `true`
forever — nothing was ever spending it back down — so `sendHunters()` fired
on *every subsequent tick, indefinitely*. Each call grants random hunt loot
(furs, ivory, unicorns, bloodstone, gold via `gainHuntRes`), which is exactly
the reported symptom: an unbroken stream of "Your kittens returned from a
hunt" log lines and resources it grants climbing without bound, since nothing
was gating the frequency other than "catpower is still high" — which it
always was, because the action that was supposed to relieve that condition
never did.

`huntAll()` is the correct method for this pattern: it spends 100 manpower
per squad before granting loot, so once it actually fires it drains the
resource well below the 90% line, matching how the crafting resources behave.

### 2. `coal` / `culture` / `furs` → `craftAll()`

These called the gamePage-level `craftAll()` with no argument. The real
signature takes the recipe name to craft — the game's own UI calls it as
`game.craftAll(res.name)` (`js/jsx/left.jsx.js`) — and `workshop.craftAll`
resolves that name via `getCraft(craftName)`, which returns `null` for
`undefined`, and the next line (`getCraftPrice(craft)`) reads `craft.name`
off that `null` and throws.

Confirmed live:

```js
gamePage.craftAll();          // throws: Cannot read properties of null (reading 'name')
gamePage.craftAll("steel");   // no throw, crafts as expected
```

The per-resource `try/catch` in the tick loop caught this every time,
logging `action for "coal" failed: ...` (same for culture/furs) — so this
wasn't silent, but it fired that failing call, and the warning, on *every
tick* those resources sat at/near their cap, without ever actually crafting
anything to relieve the overflow. Less visible in the log than the hunting
spam (a warning line instead of a game message), but the same underlying
defect: an `act()` that can never resolve the condition that triggers it.

Fixed by passing the recipe that actually consumes each resource, matching
the tier-chain naming already used elsewhere in the same list — found via the
`prices` field of each recipe in `workshop.js`:

| Resource | Recipe (consumes it) |
| :--- | :--- |
| `coal` | `steel` (100 coal + 100 iron) |
| `culture` | `manuscript` (400 culture + 25 parchment) |
| `furs` | `parchment` (175 furs) |

## Fix

`src/main.ts` `resourceDefs`:

- `catpower`: `game.village.sendHunters()` → `game.village.huntAll()`
- `coal`: `game.craftAll()` → `game.craftAll("steel")`
- `culture`: `game.craftAll()` → `game.craftAll("manuscript")`
- `furs`: `game.craftAll()` → `game.craftAll("parchment")`

`src/types.d.ts`: `craftAll(): void` → `craftAll(craftName: string): void`;
added `huntAll(): void` to `Village` (kept `sendHunters()` documented as the
non-consuming method, so the distinction doesn't get re-lost later).

A comment above `resourceDefs` now states the invariant directly: every `act`
must actually spend down the resource that triggered it, since
`isInDangerZone()` re-fires every tick otherwise.

## Verification

Live (ephemeral, no-Tampermonkey browser via chrome-devtools MCP), against a
fresh save:

- Confirmed the patched `tick()` (not the game's original) was installed
  (`gamePage.tick.toString()` shows our wrapper).
- `catpower`: with `manpower.value` forced to 95/100 (in the danger zone but
  below one full squad), manual `gamePage.tick()` calls left it unchanged —
  `huntAll()` correctly no-ops below 100, so this is a bounded few-tick grace
  window while production closes the gap, not a stuck state. Separately, the
  fresh save's own natural playthrough already showed `huntAll()` firing
  once catpower reached the 100 cap ("Your hunters have returned +0.83
  furs" in the log) and manpower reset to 0 afterward — confirming it does
  drain the resource, unlike the old `sendHunters()`.
- `craftAll`: `gamePage.craftAll()` reproduced the exact throw
  (`Cannot read properties of null (reading 'name')`); `gamePage.craftAll("steel")`
  did not throw.
- Confirmed both `village.sendHunters` and `village.huntAll` exist as real
  methods on the live `gamePage.village`, so the fix isn't relying on a
  reference-checkout-only API.

Also encountered and dismissed a stray "Are you sure that you want to
reset?" confirm dialog left over from the browser context's history — this
tool's `evaluate_script` defaults to auto-accepting dialogs
(`dialogAction: "accept"`), which appears to have advanced or reset the test
save at least once before it was caught. Not a concern for this disposable
test session, but worth remembering next time: call `handle_dialog` (or pass
an explicit `dialogAction`) before assuming a stalled `evaluate_script`
result reflects real game state.
