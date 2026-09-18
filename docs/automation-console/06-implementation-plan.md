# Automation Console — Implementation Plan

Companion to [05-architecture.md](05-architecture.md). No issues/milestone
exist yet — this is a plan to file them from once implementation is
approved to start, not a live tracker.

## Phase 0 — Registry refactor (foundation, blocks everything below)

1. **Introduce `AutomationEntry` + registry, refactor existing automations
   into it** — no behavior change. Convert the catnip famine autopause,
   auto-observe, and each `resourceDefs` entry into registry entries per
   [02-design-toggles.md](02-design-toggles.md); replace the current
   hand-written tick-hook sequence with a single loop over the registry.
   Verify via `browser-debug` that observed automation behavior is
   byte-for-byte identical to today's before adding any toggle surface on
   top.
   _Depends on: nothing. Blocks: everything below._

## Phase 1 — Toggle UI

2. **`window`-exposed config object** (v0) — expose the registry's
   enable/disable as a console-callable API. Verify live that toggling an
   entry off actually skips its `run()` on the next tick.
   _Depends on: #1._
3. **In-page DOM panel** (v1) — inject a floating toggle panel at the same
   point as CSS injection in `init()`; wire it to the same registry object
   #2 exposed. Verify visually in a live tab that it renders without
   colliding with the game's own UI.
   _Depends on: #2 (shares the same underlying registry API, so #2 isn't
   thrown away)._

## Phase 2 — Workflows

4. **Workflow persistence** — `localStorage` read/write under the
   namespaced, versioned key from [03-design-workflows.md](03-design-workflows.md).
   Verify a corrupt/missing key degrades to "no workflows" without breaking
   toggles (NFR3).
   _Depends on: #1._
5. **Workflow apply/snapshot + picker UI** — apply sets only the ids a
   workflow lists (partial application); snapshot creates a new workflow
   from current registry state. Add picker to the panel from #3.
   _Depends on: #3, #4._

## Phase 3 — Goal planner: target + cost (can start in parallel with Phase 1/2)

6. **Live-verify `game.time.queue` and `getFirstItemEtaDay`** — spike via
   `browser-debug`: confirm the queue manager exists on the live engine
   with the shape found in the reference checkout (`js/time.js:1585,
   1599-1641`); add verified types to `src/types.d.ts` per the existing
   "batch-verified" convention, or correct/remove if drifted.
   _Depends on: nothing (independent research spike)._
7. **Target selection (user-specified v1)** — read-queue-front-if-non-empty,
   else user-specified target via the toggle UI's "set goal" action.
   _Depends on: #3 (UI to set a goal), #6._
8. **Cost extraction** — generalize `getPrices` dispatch (stackable
   buildings vs. flat tech/policy/religion) per
   [04-design-goal-planner.md](04-design-goal-planner.md); reuse
   `resPool.hasRes`/`isStorageLimited`, verified live.
   _Depends on: #6._

## Phase 4 — Goal planner: optimization (highest-risk phase)

9. **Spike: simulation approach** — before writing the greedy algorithm,
   live-verify `village.getResProduction()`'s actual shape via
   `browser-debug` and prototype the hand-rolled parallel-calculation
   approach recommended in [04](04-design-goal-planner.md) end-to-end on a
   single resource, confirming it matches `getResourcePerTick`'s live
   output for the *current* (non-hypothetical) job assignment before
   trusting it for a hypothetical one. This is the single most likely step
   in the whole series to reveal the reference checkout is stale — treat it
   the same way the otel plan treats its own CORS spike: a go/no-go gate
   before building on top of the assumption.
   _Depends on: #6, #8._
10. **Greedy marginal-value reassignment + reserve floor** — implement the
    algorithm from [04](04-design-goal-planner.md), gated on #9's simulation
    approach; floor check runs before every reassignment, not after.
    _Depends on: #9._
11. **Wire planner into the registry as a toggleable automation** — the
    planner itself becomes one more `AutomationEntry` (periodic cadence per
    §Cadence in [04](04-design-goal-planner.md)), so it can be
    enabled/disabled and bundled into workflows like anything else.
    _Depends on: #1, #7, #10._

## Phase 5 — Follow-ups (explicitly future work, not silently dropped)

12. **Automatic workflow switching** (flagged in
    [03-design-workflows.md](03-design-workflows.md) Future work) — e.g.
    switching workflows on goal completion.
    _Depends on: #5, #11._
13. **Multi-goal planning** (flagged as a non-goal in
    [04-design-goal-planner.md](04-design-goal-planner.md)) — chaining
    goals rather than re-selecting from scratch on completion.
    _Depends on: #11._
14. **Automatic target-selection heuristics** (v1.1, deferred in
    [04-design-goal-planner.md](04-design-goal-planner.md) §Target selection)
    — cheapest-next-tech / next-buildable-building heuristics for when no
    goal is user-specified and the queue is empty.
    _Depends on: #7._

## Suggested milestone sequencing

Phase 0 (#1) is a strict prerequisite for everything. Phase 1 (#2–3) and
Phase 2 (#4–5) are sequential within themselves but independent of each
other. Phase 3 (#6–8) can start in parallel with Phase 1/2 since target
selection and cost extraction don't depend on the toggle UI existing,
except for #7's dependency on having a "set goal" UI action. Phase 4
(#9–11) is the highest-risk phase and should not start until #9's spike is
green — if it reveals the reference checkout's job-production data is
unreadable without mutation, the recommendation in
[04-design-goal-planner.md](04-design-goal-planner.md) needs to be
revisited before #10 proceeds. Phase 5 is explicitly optional follow-up
work.
