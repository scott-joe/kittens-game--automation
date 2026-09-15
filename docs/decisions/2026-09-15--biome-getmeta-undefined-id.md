# `getMeta` "Could not find metadata for undefined" on the Village/Explore tab

**Status:** Accepted

## Symptom

Console showed:

```
Could not find metadata for  undefined in Array(13)
getMeta @ core.js?rev_=163:286
```

with the dumped array being the live game's full, current 13-entry biome
list (`village`, `plains`, ..., `cath`, `redmoon`). Reported trigger: opening
or using the Village/Explore tab. Reported impact: console noise only,
nothing visibly broken in-game.

Alongside it, the same kind of generic AI-generated "fix" seen in
[2026-09-13: getMeta error and defensive hardening](2026-09-13--getmeta-error-and-defensive-hardening.md)
showed up again — this time suggesting adding an `if (!name) return null;`
guard clause directly inside the engine's own `getMeta`. Same wrong-layer
problem as before: we don't own or ship `core.js`, so patching a third
party's internal function isn't something this project can or should do.

## How this differs from the earlier `getMeta` investigation

The 2026-09-13 case was a **stale-reference-checkout** problem: the local
`kitten-game--orig` checkout's `village.js` only defined 11 biomes, so
looking up `"cath"`/`"redmoon"` (real biome names in a save from a newer
build) failed against the *old* list. This time we're reading the live
site's own `core.js`/`village.js` directly (`?rev_=163`, matching the
`Ver 1.6.1.6.r163` shown in the UI) — no version-checkout mismatch at play.
Here the array already has all 13 biomes; the argument being looked up is
`undefined` itself, not merely a name absent from an outdated list. Same
symptom family, different mechanism.

## Root cause

Confirmed by fetching the live `village.js` (`curl
https://kittensgame.com/web/js/village.js?rev_=163`):

```js
getBiome: function(id){
    return this.getMeta(id, this.map.biomes);
},

getBiomeLevel: function(id){
    var biome = this.getBiome(id);
    return biome ? (biome.val || 0) : 0;
},
```

and the map/exploration UI's button controller:

```js
dojo.declare("classes.ui.village.BiomeBtnController", com.nuclearunicorn.game.ui.ButtonModernController, {
	fetchModel: function(options){
		if (!this.biome){
			this.biome = this.game.village.getBiome(options.id);
		}
		var model = this.inherited(arguments);
		model.biome = this.biome;
		model.metadata = this.biome;
		...
```

`fetchModel` runs when the Village/Explore tab renders each biome tile
button, and calls `getBiome(options.id)` with no guard against `options.id`
being `undefined` — unlike other call sites in the same file
(`map.currentBiome ? game.village.getBiome(map.currentBiome) : null`, seen
twice elsewhere) that already defend against exactly this. On a save with
little/no exploration progress (the test save used here had 0 kittens and
had never explored), whichever biome tile's button configuration doesn't
have a resolved `id` yet hits this unguarded path, `getMeta` fails the
lookup, logs the console error, and `fetchModel` carries on with
`this.biome` left `undefined` — nothing downstream immediately dereferences
it, so the game keeps working. This matches the reported impact exactly.

Not confirmed: which specific biome tile's button is missing its `id` (would
require tracing the map's button-generation/template code, not done here),
or whether this is new/recent — plausible given `cath`/`redmoon` are
themselves fairly newly-added biomes per the prior investigation's diff
against the older reference checkout.

## Conclusion

Same as the 2026-09-13 case: not a bug in this project. `main.ts` never
touches `village.map`, biomes, or the explore mechanic at all — nothing in
our automation triggers, worsens, or could fix this. It's the live game
engine's own internal metadata lookup missing an undefined-guard on one
call site that a couple of sibling call sites already have, already
non-fatal, already just console noise. No action taken here beyond this
write-up; the earlier suggestion to patch `core.js`'s `getMeta` is rejected
for the same reason it was rejected before — wrong layer, not our code to
patch.

## Verification

Live, via chrome-devtools MCP against `kittensgame.com/web/` (no
Tampermonkey/automation script needed — this reproduces on vanilla game
state):
- Confirmed `gamePage.village.map.currentBiome` / `.lastBiome` are both
  `undefined` on a save that has never explored.
- Fetched the live `village.js` directly (`curl .../js/village.js?rev_=163`)
  and located `getBiome`/`getBiomeLevel` (matches the AI-suggested
  explanation's cited `village.js` line ~319) and the unguarded
  `BiomeBtnController.fetchModel` call site, confirmed against the actual
  currently-served source rather than trusting the pasted explanation's
  claims at face value.
- Did not need to reproduce the exact console line by clicking through the
  UI — the source-level evidence (unguarded call site sitting next to two
  guarded siblings, on a save with no exploration state) fully accounts for
  the reported symptom and impact.
