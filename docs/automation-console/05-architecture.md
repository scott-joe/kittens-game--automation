# Automation Console — Architecture

Companion to [02](02-design-toggles.md)/[03](03-design-workflows.md)/[04](04-design-goal-planner.md).
Extends, and cross-links to, `docs/architecture/automation-harness.md`
rather than duplicating it.

## Repository layout changes

Proposed eventual home, once implementation begins:

```
src/
  automations/
    registry.ts    # AutomationEntry type + registry construction (§02)
    workflows.ts    # Workflow type, persistence, apply/snapshot (§03)
    planner.ts       # target selection, cost extraction, job optimization, floor logic (§04)
  automation-config.ts  # global defaults: initial toggle states, default reserve floor, exemption list
  main.ts            # shrinks to bootstrap/wiring: engine-ready poll, style injection, constructs the registry/workflow/planner modules and drives the tick loop
```

**Open question**: does this module split happen as a prerequisite to the
toggle UI (Phase 0 in the implementation plan), or can toggles be bolted
onto the current single-`main.ts` shape first and split out later? `main.ts`
is only ~268 lines today — the split is a bigger structural change than
anything else in this series, and premature module boundaries could be
wrong once the planner's actual shape is known. Recommendation: treat the
registry refactor (Phase 0) as the trigger for creating `src/automations/`,
rather than splitting the file speculatively before any of these features
exist.

## Deployment topology

No change. Still a single Tampermonkey-loaded `dist/main.js`, served by the
existing `server.js` on `127.0.0.1:5500` during dev. The toggle panel and
any workflow picker are DOM elements injected at the same point as the
existing CSS `<link>` injection (`init()`, right after engine-ready is
confirmed) — not a separate build artifact, not a separate page.

## Build system

None of these three features require the esbuild bundling switch that the
(still unimplemented) `docs/otel-monitoring/` design proposes for pulling
in the OTel browser SDK. Toggles, workflows, and the planner are all
self-contained TypeScript operating on `gamePage`, the DOM, and
`localStorage` — no new npm runtime dependency is introduced, so the
existing bare `tsc` build (`pnpm run build`) stays sufficient for this
series regardless of whether the OTel work ever lands.

## Configuration

Global defaults — initial per-automation enabled/disabled state, the
default reserve floor value, and the default floor-exemption list — live in
a new `src/automation-config.ts` const module, mirroring the existing
top-of-file const pattern in `main.ts` (`ENABLE_STYLE_OVERRIDE`,
`DANGER_ZONE_THRESHOLD`, etc.) rather than being buried inside
`registry.ts`/`planner.ts` themselves. This keeps "what are the defaults"
answerable by reading one file, the same way the current style-injection
toggles are answerable by reading the top of `main.ts`.

## Failure isolation boundary

Extends the existing per-block try/catch principle
(`docs/architecture/automation-harness.md`) explicitly across the three new
pieces:

- A broken planner run (target selection, cost extraction, or job
  reassignment throwing) must not disable the toggle registry or any other
  automation — it fails, logs, and the tick continues.
- A broken toggle-UI render (DOM injection failing, an event listener
  throwing) must not stop tick-time automation from running — UI and
  automation logic are isolated from each other the same way CSS injection
  failures are already isolated from the tick loop today (`onerror`
  handlers, never thrown).
- A workflow failing to load or apply (corrupt `localStorage` JSON, unknown
  schema version) must leave the registry at its last-known-good state, not
  a partially-applied one.

## Security / privacy notes

Deliberately short: this series is entirely local. No network calls, no
external service (contrast with `docs/otel-monitoring/`'s OTLP export and
local collector stack, where this section carries real weight). The only
persisted data is workflow definitions in `localStorage`, scoped to the
`kittensgame.com` origin like the game's own save data — no new data
leaves the browser and no new attack surface is introduced.
