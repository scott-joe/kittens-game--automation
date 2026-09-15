# Batch-expanding `types.d.ts` from indexed + live-verified candidates

**Status:** Accepted

## Ask

After fixing the `observeStarEvent` bug
([2026-09-15: observe-star-event-does-not-exist](2026-09-15--observe-star-event-does-not-exist.md)),
the user noted this reference checkout doesn't change much and asked whether
it'd help to generate types for the entities we're most likely to encounter,
rather than adding one method at a time only when a bug surfaces.

## Approach

Bulk-generating straight from the reference checkout was rejected: the
reference build's own staleness is *why* `observeStarEvent` and the earlier
`craftAll`/`sendHunters` bugs
([2026-09-15: act-firing-every-tick](2026-09-15--act-firing-every-tick.md))
happened in the first place — encoding more unverified guesses faster isn't
progress. Full behavioral verification (invoke each method, diff game state
before/after) doesn't scale to ~130 candidates either.

Settled on a middle tier: batch existence + arity verification. For every
candidate, confirm live that `typeof gamePage.<x>.<method> === "function"`
and that `fn.length` matches the reference checkout's declared parameter
count, all in one `evaluate_script` call. This directly catches both bug
classes hit so far — a method that doesn't exist at all, and a method whose
signature drifted — across a whole batch cheaply. It does **not** confirm
behavior (what the call actually does to game state), so every entry added
this way is commented `batch-verified 2026-09-15` to mark that weaker
confidence level, distinct from the fuller `huntAll()`/`observeHandler()`
style write-ups where behavior was diffed by hand.

## Candidate selection

Ran `scripts/index-engine-api.js` against the reference checkout
(`/Users/scott/Dev/sprout-garden/gym--kittens-game/_old/kitten-game--orig`)
for 11 classes — the managers already exposed on `gamePage` (`resPool`,
`workshop`, `village`, `bld`, `religion`, `calendar`, `diplomacy`) plus three
not yet declared in `types.d.ts` but plausibly useful soon (`science`,
`prestige`, `time`), and the shared `TabManager` base class to check whether
anything in it was worth surfacing. Output written to a scratch directory
(not committed, per the local-development guide's "What this tool is not").

From ~130 raw candidates, scoped down to ~55 plausibly useful for
automation — resource/building/job/tech queries, crafting, trading, hunting,
praising, time acceleration — excluding UI-only, save/load, and
internal-bookkeeping methods (`resetState`, `_getTranscendTotalPrice`,
etc.). `TabManager` itself was excluded entirely: every method in it
(`registerPanel`, `updateEffectCached`, `loadMetadata`, ...) is internal
plumbing, not something automation logic would call directly.

## Verification

Live (ephemeral, no-Tampermonkey browser via chrome-devtools MCP) against
`kittensgame.com` (`Ver 1.6.1.6.r163`), one `evaluate_script` pass checking
all ~59 scoped candidates (some overlap with already-declared methods,
re-checked for free): 57 matched exactly. Two didn't:

- `village.assignJob`: reference checkout showed `(job, amt)` (arity 2);
  live is `function(job, amt, optimize)` (arity 3) — a parameter added since
  that checkout was captured.
- `diplomacy.sellBcoin`: reference checkout showed `()` (arity 0); live is
  `function(isHodl)` (arity 1).

Both corrected against the live `.toString()` before being added — exactly
the kind of drift the reference checkout's staleness warning
(`CLAUDE.md`) predicts, caught here because the check compares against live
rather than trusting the index output.

Also found, incidentally, while verifying `workshop.get`: the *existing*
`Upgrade` interface and its doc-table entry
(`gamePage.upgrade.get('mineralHoes').purchased`) were already wrong and
unused anywhere in `src/` — confirmed live that `gamePage.upgrade` is a bare
constructor function, not a manager object with `.get()`. The correct path
is `gamePage.workshop.get(name).researched`. Removed the dead interface and
fixed both `types.d.ts` and the doc table.

## Fix

`src/types.d.ts`: added ~55 batch-verified method signatures across
`Workshop`, `Village`, `Religion`, `ResPool`, `Calendar`, `Diplomacy`,
`BldManager`, plus new `Science`, `Prestige`, `TimeManager` interfaces wired
into `GameEngine` (`science`, `prestige`, `time` fields). Removed the dead
`Upgrade` interface and `upgrade` field.

`docs/architecture/automation-harness.md`: corrected the Upgrade-status API
reference row.

## Rollback / next step

Nothing here changes runtime behavior — `types.d.ts` is compile-time only,
so this is a zero-risk addition to revert (`git revert` this commit) if any
signature turns out wrong in practice. The existence+arity check is a
starting point, not a substitute for the fuller live-verification workflow
in `docs/guides/local-development.md` before any of these new methods are
actually wired into `main.ts` automation logic.
