# getMeta console errors on save load, and hardening main.ts against version drift

**Status:** Accepted

## Symptom

Loading a save produced this in the browser console:

```
Could not find metadata for  undefined in [...]
```

Pasted alongside a generic AI-generated suggestion to add a guard clause directly
inside the game engine's `getMeta` function.

## Root cause

Not a bug in our automation script. It's the game engine's own save-migration
path:

- `village.js` (`loadMetadata`, called from the village's save loader) walks
  `saveData.village.biomes` and looks up each saved entry by name via
  `core.js`'s `getMeta(name, metadata)`.
- The fixture in `data/state.sample.base64` (`saveVersion: 15`) has 13 entries
  in `village.biomes`, including `cath` and `redmoon`.
- The checked-out game source at
  `/Users/scott/Dev/sprout-garden/gym--kittens-game/_old/kitten-game--orig`
  only defines 11 biomes in `js/village.js` (through `swamp`) — `cath` and
  `redmoon` don't exist there as biomes at all; those names only appear in
  `js/calendar.js` as *space planet* names, a different metadata table
  entirely.
- So `getMeta("cath", <biome list>)` and `getMeta("redmoon", <biome list>)`
  fail to find a match and log the error. It's already handled gracefully
  upstream (`loadMetadata` does `if (!elem) continue;`), so nothing actually
  breaks — the save was very likely made on a newer game build than this
  checked-out source.

Confirmed by decompressing the fixture with the game's own `lib/lz-string.js`
(`LZString.decompressFromBase64`) and diffing its `village.biomes` names
against the biome list literally defined in `village.js`.

## What we changed

Not the game engine — we don't own that code, and patching a third party's
internal function is the wrong layer to fix a version-drift issue. Instead we
hardened `main.ts`, since the same underlying risk (this script running
against a game version whose API/content has shifted) applies directly to it:

- `resPool.get(resKey)` is checked before a resource is added to
  `managedResources`; an unrecognized key is skipped with a `console.warn`
  instead of the danger-zone check later throwing on `undefined.maxValue`.
- Each independent piece of the `tick` override (star-event observation, each
  resource's craft/act call, the free-kitten check) is wrapped in its own
  `try/catch` and logged with a `[kg-automation]` prefix, so one failing piece
  can't take down the rest of the automation loop — or the game's own tick,
  which has already run by the time our code executes.

## Fixture

`data/state.sample.base64` is kept as a first save-state fixture (LZString +
base64, same format the game itself uses for import/export). Decode with:

```js
const LZString = require(".../lib/lz-string.js");
const save = JSON.parse(LZString.decompressFromBase64(fs.readFileSync("data/state.sample.base64", "utf8").trim()));
```

## Open question

Worth checking `changelog.txt` in the game source for when biomes past
`swamp` were added, to confirm the save's actual originating version — not
done yet.

## Same error, different mechanism, seen again

See
[2026-09-15: getMeta "Could not find metadata for undefined" on the Village/Explore tab](2026-09-15--biome-getmeta-undefined-id.md)
for a later occurrence of this same `getMeta` error family, this time with
`name` itself being `undefined` (not merely absent from a stale list) —
traced to an unguarded call site in the live game's own
`BiomeBtnController.fetchModel`. Same conclusion: not our bug, don't patch
the engine.
