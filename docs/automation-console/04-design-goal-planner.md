# Automation Console — Design: Goal Planner

Companion to [01-discovery.md](01-discovery.md) (FR-G1–G6). This is the
hardest and least certain of the three sub-features — every API cited below
comes from the reference checkout and **must be re-verified live** via the
`browser-debug` skill before any of it is implemented, per the standing
convention in `docs/guides/local-development.md` and the two 2026-09-15
ADRs on exactly this failure mode.

## Goals / non-goals

**Goals**: identify one next target (a tech, building, policy, or
religious/Ziggurat/Transcendence unlock), determine the resources it needs,
and bias kitten job assignment toward reaching it faster — without letting
non-exempt resources go net-negative per tick.

**Non-goals** (v1 is one active goal at a time):
- Chaining multiple goals into a long-horizon plan ("research X, then build
  Y, then unlock Z" as a single scripted sequence).
- Any lookahead beyond the single currently-selected goal — once it
  completes, target selection (§ below) runs again from scratch.

## Target selection

Two first-class paths — not one primary path with a fallback:

**(a) From the game's own queue.** The reference checkout has a real queue
manager: `dojo.declare("classes.queue.manager", ...)` at
`js/time.js:1585`, instantiated as `game.time.queue`, covering buildings,
tech, upgrades, policies, religion/Ziggurat/Transcendence, and space
missions (`queueSourcesDefault`, `js/time.js:1679-1692`). It already
computes an ETA for its front item via `getFirstItemEtaDay`
(`js/time.js:1599-1641`), using the item's price list, the resource's
current value/cap, and its per-tick rate — returning `[eta, canAffordEver]`
where `canAffordEver` is `false` if a price is permanently storage-capped
or the resource is net-negative. When the queue is non-empty, its front
item is the target.

**(b) Independent of the queue.** When the queue is empty, the target must
come from somewhere else. Candidate heuristics (not a forced choice — pick
one for v1, document it as the chosen default, keep the others as
alternatives):

- Cheapest next unresearched tech (by total price-array cost at current
  resource values).
- Next building whose prerequisites are already met and that is not yet
  built/maxed.
- User-specified: the toggle UI (§[02](02-design-toggles.md)) exposes a
  manual "set goal" action, and the planner only runs its heuristic when no
  manual goal is set.

Recommendation: start with **user-specified**, since it requires no
heuristic-quality judgment call and gives the player direct control; treat
the automatic heuristics as a v1.1 addition once user-specified targeting
is proven out.

## Cost extraction

Prices are represented uniformly as `[{name, val}]` arrays across
buildings, tech, policy, and religion. The reference checkout's `core.js`
has **three different `getPrices` implementations** depending on the
controller: a default that returns `model.options.prices` (`core.js:634`),
a stackable-with-ratio version for buildings that applies
`priceRatio^count` plus cost-reduction effects (`core.js:1920`), and a
flat-price version for non-stackable items like tech/policy/religion that
just clones `model.metadata.prices` (`core.js:2110`). Any generalized "cost
of target X" lookup needs to dispatch on target type rather than assume one
shape. Existing helpers to reuse rather than reimplement:
`resPool.hasRes(prices, amt)` (afford check), `resPool.isStorageLimited(prices)`
(permanently-can't-afford check), `resPool.payPrices(prices)` (not used by
the planner directly, since the planner never buys anything itself — it
only biases production toward affording the target, leaving the actual
purchase to the player or to the existing queue).

## Job-optimization algorithm

The game's own `optimizeJobs()` (`js/village.js:832-873`) is **not**
goal-directed: it tallies each kitten's current job (excluding engineers),
clears all jobs, and round-robins them back into the same proportions it
found, with a theocracy/leader-priest special case. It cannot be reused or
parameterized toward a target resource — a new algorithm is needed.

**Recommended v1: greedy marginal-value reassignment.**

1. Determine the goal's binding resource(s) — the price-array entries
   the target actually needs, cross-referenced against which resources are
   currently the slowest to accumulate toward affordability (via
   `getFirstItemEtaDay`-style rate math, generalized beyond just the queue's
   front item).
2. Rank available jobs by their marginal per-kitten contribution to the
   binding resource(s) (village job → resource production is data-driven;
   see `village.getResProduction()`, `js/village.js:330` area, in the
   reference checkout).
3. Reassign `getFreeKittens()` (`js/village.js:395`) into the
   highest-marginal-value job for the binding resource via
   `assignJob(job, amt)` (`js/village.js:266`), honoring `getJobLimit(jobName)`
   (`js/village.js:256`).
4. If no free kittens remain and floors (§ below) still allow it, pull
   kittens from the lowest-marginal-value job (relative to the goal) via
   `unassignJob(kitten)` (`js/village.js:282`) and reassign them, but only
   down to the point where a floored resource's projected rate would go
   negative — see reserve floor below.

| Alternative | Why not v1 |
| :-- | :-- |
| LP-style solver (formally optimal reassignment across all jobs/resources at once) | No solver dependency available without a bundler (NFR5 in discovery); greedy is simpler to reason about and debug against a live game |
| Fixed per-goal-type priority table (e.g. "religion goal → always prioritize priests") | Doesn't adapt to which resource is actually binding for a *specific* target's price list; greedy generalizes without per-target-type special-casing |
| Do nothing, rely on the game's own `optimizeJobs()` | Not goal-aware at all — confirmed above, would just preserve existing proportions |

## Simulation without mutation

**The single highest-risk open item in this series** — the game has no
built-in "preview" mode. `calcResourcePerTick`/`getResourcePerTick`
(`game.js:3016`, `game.js:3841`) compute a resource's net rate by reading
**live** job assignments via `village.getResProduction()`; there is no way
to ask "what would the rate be if 3 more kittens were farmers" without
either actually reassigning them or duplicating the calculation.

| Option | Description | Risk |
| :-- | :-- | :-- |
| **Mutate-then-restore** | Temporarily call `assignJob`/`unassignJob` to the hypothetical state, call `getResourcePerTick`, then reassign back | A real game tick could fire *during* the temporary mutated state (the tick hook already wraps `game.tick`, and nothing prevents the game's own tick from running mid-calculation) — the game would briefly compute production, UI, and possibly starvation/famine checks against a job layout that was never actually chosen. This is a concrete re-entrancy bug, not a theoretical one, given the existing tick-wrap pattern in `main.ts`. |
| **Recommended: hand-rolled parallel calculation** | Read the job→resource production tables directly (the same data `getResProduction()` reads) and compute the hypothetical rate in a pure function, without touching `village`'s live job counts at all | Duplicates a slice of game logic that can silently drift from the live game on a version update — mitigated the same way the rest of this codebase handles drift: `resPool.get()`-style "missing key → warn and skip" defensiveness, and periodic live re-verification via `browser-debug`, not a one-time port-and-forget. |

**Recommendation**: the hand-rolled parallel calculation. The mutate-then-
restore approach's re-entrancy risk is a direct, concrete consequence of
this project's own tick-wrapping architecture (`docs/architecture/automation-harness.md`),
not a hypothetical edge case, and NFR4 (failure isolation) is much harder
to uphold if the planner can transiently leave the game in a hypothetical
job state during a real tick. This should still be **spiked live** (via
`browser-debug`) before implementation — confirming the exact shape of
`village.getResProduction()`'s output — since it's the part of this whole
series most likely to reveal the reference checkout is stale (see
[06-implementation-plan.md](06-implementation-plan.md), Phase 4).

## Reserve floor design

- **Global default**: every resource's projected net per-tick rate must
  remain ≥ 0 after any planner-driven reassignment, unless exempted.
- **Per-resource override**: a config map allows raising or lowering the
  floor per resource (e.g. a stricter floor for catnip, given the existing
  famine auto-pause already treats it specially).
- **Exemption list**: resources expected to run negative in normal play
  (Ivory is the concrete example the feature was scoped around) are exempt
  from the floor entirely by default. Recommendation: hardcode a small
  default exemption list (Ivory, and any other resource with no
  job-producible source — to be confirmed live), overridable through the
  same config surface as toggles/workflows rather than inventing a fourth
  configuration mechanism.
- The floor check happens *before* committing a reassignment (using the
  simulation from § above) — a reassignment that would violate a
  non-exempt resource's floor is rejected and the algorithm tries the
  next-best marginal-value job instead, rather than applying and reverting.

## Cadence

**Recommendation: periodic, not continuous.** Re-run target selection and
job optimization every N ticks (a specific N — e.g. 10–20 — to be tuned
once live-tested) or on an explicit trigger (a new goal being set, a
resource crossing its floor), rather than every tick. This mirrors an
existing precedent in this exact codebase: `perTickCached` values are only
recomputed by the engine every 5 ticks (`docs/architecture/automation-harness.md`),
so tick-level freshness is already known to be unnecessary for this class
of decision. Continuous per-tick re-optimization is noted as an alternative
but risks thrashing job assignments every tick as marginal values shift by
tiny amounts, with no evidence it converges any faster toward the goal than
a periodic pass.

## Alternatives considered (summary table)

| Decision | Chosen | Rejected/deferred |
| :-- | :-- | :-- |
| Target selection when queue is empty | User-specified (v1) | Automatic heuristics (v1.1) |
| Job-optimization algorithm | Greedy marginal-value | LP solver, fixed priority table |
| Simulation approach | Hand-rolled parallel calculation | Mutate-then-restore (re-entrancy risk) |
| Reserve floor exemptions | Hardcoded default list, config-overridable | Fully inferred (no reliable signal found in reference checkout) |
| Optimization cadence | Periodic/triggered | Continuous every-tick |
