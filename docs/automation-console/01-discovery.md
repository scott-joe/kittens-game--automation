# Automation Console — Discovery

## Problem statement

Every automation in `src/main.ts` is hardcoded: `resourceDefs` is a fixed
array crafted at build time, the catnip auto-pause and auto-observe logic
run unconditionally whenever the tick hook fires, and the only thing gated
by a runtime-ish switch at all is CSS injection (`ENABLE_STYLE_OVERRIDE`/
`ENABLE_STYLE_AMEND`, still build-time consts). There's no way to:

- disable a single automation (e.g. turn off danger-zone crafting for
  catnip specifically) without editing source and rebuilding,
- save a set of enabled/disabled automations as a reusable preset and
  switch between presets ("early game" vs. "faith rush" vs. "afk
  grinding"),
- point automation at a specific goal — a tech, building, policy, or
  religious/Ziggurat/Transcendence unlock — and have it bias kitten job
  assignment toward reaching that goal faster, rather than only reacting
  to fixed thresholds (90%-of-cap danger zones, imminent famine).

This effort designs three related, incrementally-dependent capabilities —
a runtime **toggle UI**, named **workflow** presets built on top of it, and
a goal-directed **planner** that optimizes village job assignment — without
changing any of `main.ts`'s existing automation behavior.

## Functional requirements

Tagged per sub-feature so later design docs can cross-reference cleanly:
FR-T# (toggles), FR-W# (workflows), FR-G# (goal-planner).

| ID | Requirement |
| :-- | :-- |
| FR-T1 | Each automation (catnip auto-pause, each `resourceDefs` entry's danger-zone crafting, auto-observe) is individually identifiable and can be enabled/disabled at runtime, without a rebuild. |
| FR-T2 | Disabling an automation must be effectively free — the tick loop must skip a disabled automation before doing any of its work, not just short-circuit inside it. |
| FR-T3 | The current enabled/disabled state of every automation must be inspectable at runtime (for the UI to render, and for workflows to snapshot). |
| FR-W1 | A workflow is a named, described bundle of toggle states — enabling a workflow sets every automation's enabled/disabled flag to match the bundle in one action. |
| FR-W2 | Workflows persist across page reloads (a userscript has no backend — see [03-design-workflows.md](03-design-workflows.md) for the storage mechanism). |
| FR-W3 | A user can create a new workflow from the current live toggle state (a snapshot), not only by hand-authoring one. |
| FR-G1 | The planner can select a target from the game's own build/tech/policy/religion queue (`game.time.queue`) when it is non-empty. |
| FR-G2 | The planner can select a target independent of the queue (heuristic or user-specified) when the queue is empty. |
| FR-G3 | Given a target, the planner determines the resources required to reach it (uniform `[{name, val}]` price arrays, per target type). |
| FR-G4 | The planner biases kitten job assignment toward producing the target's binding resource(s) faster, via `village.assignJob`/`unassignJob`. |
| FR-G5 | The planner enforces a per-resource "reserve floor": job reassignment must not push a floored resource's net per-tick rate negative. |
| FR-G6 | Specific resources (e.g. Ivory) are exempt from the reserve floor by default, since they are expected to run negative in normal play. |

## Non-functional requirements

| ID | Requirement |
| :-- | :-- |
| NFR1 | **Tick-rate safety**: neither a live DOM toggle panel nor periodic job-optimization may introduce perceptible tick lag, matching the existing catnip-check/danger-zone-check performance envelope. |
| NFR2 | **Atomicity**: a toggle flip must never leave an automation half-applied mid-tick — state changes take effect on the next tick boundary, not mid-iteration over `managedResources`-equivalent structures. |
| NFR3 | **Graceful degradation**: if `localStorage` (or `GM_setValue`) is unavailable or blocked, workflows must fail to persist without breaking toggles or any other automation — matches the existing "log+skip" convention for optional pieces (see the style-loader's `onerror` handling in `src/main.ts`). |
| NFR4 | **Failure isolation**: a broken planner run must not disable the toggle UI, workflows, or any other automation, and vice versa — extends the existing per-automation try/catch principle in `src/main.ts`'s tick hook. |
| NFR5 | **No new build requirement**: none of these three features may require a bundler switch — all three stay DOM/localStorage-only, compatible with the current bare `tsc` build (contrast with `docs/otel-monitoring/`, which does require one). |

## Constraints & context

- Single-file `tsc` build, no bundler (see `docs/guides/local-development.md`) — any DOM/config code must ship as plain TypeScript compiled straight to `dist/main.js`, no npm UI framework.
- The existing per-automation try/catch tick pattern (`src/main.ts`, the `for (const resource of managedResources)` loop and the standalone catnip/observe try/catch blocks) must be preserved once automations become independently toggleable — a disabled automation should not even enter its try/catch body, both for clarity and to avoid paying its cost every tick.
- All engine APIs cited in this series that are not already in `src/types.d.ts` (the queue manager, price-array helpers, job-assignment methods) come from the reference checkout at `/Users/scott/Dev/sprout-garden/gym--kittens-game/_old/kitten-game--orig`, which **may be stale relative to the live game**. Every such API must be re-verified live via the `browser-debug` skill before being relied on in implementation, per the existing convention documented in [2026-09-15--observe-star-event-does-not-exist.md](../decisions/2026-09-15--observe-star-event-does-not-exist.md) and [2026-09-15--act-firing-every-tick.md](../decisions/2026-09-15--act-firing-every-tick.md) — both are examples of exactly this class of mistake (a function assumed to exist or behave a certain way from the reference checkout, and turned out not to on the live engine).
- `docs/otel-monitoring/` is a sibling planned-but-unimplemented design series; nothing in it is assumed to be in place here.

## Relationship to `docs/otel-monitoring/`

Once automations are individually toggleable, a disabled automation calling
none of the shared `gamePage` methods (`craft`, `sendHunters`,
`promoteKittens`, `praise`, `togglePause`) is a different signal than an
automation that ran and chose not to act. If OTel instrumentation is ever
built, its FR9 "manual vs. automation attribution" concern and this
series's toggle state should stay consistent — e.g. a `game.action` event's
`source: automation` label should still fire correctly when only some
automations are enabled. No action needed now; flagged so the two efforts
don't quietly conflict if both are eventually implemented.

## Open questions (deferred to design)

- In-page DOM panel vs. a `window`-exposed, console-toggleable config object as a cheaper first cut? → [02-design-toggles.md](02-design-toggles.md)
- `localStorage` vs. Tampermonkey's `GM_setValue`/`GM_getValue` for workflow persistence, and what key namespace/schema version? → [03-design-workflows.md](03-design-workflows.md)
- How does the planner pick a target when the queue is empty — user-specified vs. heuristic, and which heuristic? → [04-design-goal-planner.md](04-design-goal-planner.md)
- How is the reserve floor configured — global default plus per-resource override, and is the exemption list (Ivory, etc.) hardcoded, config-driven, or inferred? → [04-design-goal-planner.md](04-design-goal-planner.md)
- Does job-optimization run every tick or on a periodic/triggered cadence? → [04-design-goal-planner.md](04-design-goal-planner.md)
- Does the `src/automations/` module split happen as a prerequisite to the toggle UI, or can toggles be bolted onto the current single-`main.ts` shape first? → [05-architecture.md](05-architecture.md)
