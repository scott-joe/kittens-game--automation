# OTel Monitoring — Implementation Plan

Companion to [03-architecture.md](03-architecture.md). Each numbered item
below is filed as a GitHub issue under milestone
[OTel Monitoring](https://github.com/scott-joe/kittens-game--automation/milestone/1)
(issues [#1](https://github.com/scott-joe/kittens-game--automation/issues/1)–[#14](https://github.com/scott-joe/kittens-game--automation/issues/14)).
Ordered so each phase is independently testable before the next depends on
it.

## Phase 0 — Build pipeline

1. **Switch build from bare `tsc` to esbuild bundling**
   Add `esbuild` devDependency, `esbuild.config.mjs`, update `package.json`
   scripts (`build`/`watch`/`typecheck`) per architecture doc. Verify
   `dist/main.js` still loads correctly via the existing Tampermonkey loader
   with zero functional change (this issue adds no OTel code — it only
   proves bundling doesn't break the current harness before dependencies are
   added on top).
   _Depends on: nothing. Blocks: everything below._

## Phase 1 — Local collector stack

2. **Stand up local OTel Collector + Grafana (docker-compose)**
   Add `docker-compose.yml` (`grafana/otel-lgtm` image), `otel:up`/`otel:down`
   scripts, confirm OTLP/HTTP receiver reachable at `127.0.0.1:4318` and
   Grafana UI at `127.0.0.1:3000`. Manually verify with `curl`/a sample OTLP
   payload — no browser code yet.
   _Depends on: nothing (parallelizable with Phase 0)._

3. **Confirm browser→localhost CORS/mixed-content path works**
   Spike: minimal inline script on `https://kittensgame.com` (or a local
   test HTML page) POSTs a sample OTLP span to `127.0.0.1:4318`, confirm no
   CORS/mixed-content block. Configure collector CORS allowlist as needed.
   If blocked, fall back to the `server.js` proxy plan from the design doc
   and adjust this issue's outcome accordingly before continuing.
   _Depends on: #2. Blocks: #4 (informs the export path)._

## Phase 2 — Core instrumentation

4. **`src/telemetry.ts`: OTel Web SDK init + `Telemetry` interface**
   Implement `initTelemetry()`, `tickSpan`, `recordDecision`, `gauge`,
   `counter`, `logWarn`, `NoopTelemetry` fallback, collector-reachability
   probe. Unit-testable in isolation (no `gamePage` dependency).
   _Depends on: #1, #3._

5. **Wire tick-span + decision spans into `main.ts`** (FR1, FR2, FR5)
   Wrap the automation body of `g.tick` in `telemetry.tickSpan`; add child
   spans for catnip-critical check and per-resource danger-zone check;
   route existing `console.warn` catch blocks through `telemetry.logWarn`
   alongside (not instead of) the console call.
   _Depends on: #4._

6. **Game-economy gauge sampler** (FR3)
   Add the `setInterval`-driven sampler reading `resPool`/`bld`/`village`/
   `isPaused` into `game.resource.*`, `game.building.count`,
   `game.kittens.*`, `game.paused` gauges, independent of tick cadence.
   _Depends on: #4._

7. **Action counters** (FR4)
   `automation.action_taken`, `automation.pause_for_famine` counters wired
   at the existing action call sites.
   _Depends on: #5._

## Phase 3 — Manual vs. automation attribution

8. **`wrapAttributed` helper + wrap shared `gamePage` methods** (FR9)
   Implement the `automationInFlight` flag + method-wrapping approach from
   design §2a for `craft`, `craftAll`, `sendHunters`, `promoteKittens`,
   `religion.praise`, `togglePause`; bracket existing automation call sites
   with the flag; emit `game.action{method,source}`.
   _Depends on: #4. Should land after #5–7 so it wraps a stable action
   surface, but has no hard code dependency on them._

## Phase 4 — Dashboards

9. **Game Economy + Automation Activity dashboards** (FR7)
   Grafana provisioned JSON under `docs/otel-monitoring/dashboards/`,
   provisioning config under `otel/grafana-provisioning/`, mounted into the
   compose service. Covers resource/building/kitten time series, pause
   annotations, action-rate counters.
   _Depends on: #2, #6, #7._

10. **Manual vs. Automation comparison dashboard** (FR10)
    `game.action` split by `source`, resource growth-rate overlay shaded by
    automation-active periods, per design §2a/dashboards.
    _Depends on: #8, #9._

11. **Tick Trace Explorer view** (FR1/FR2 consumption)
    Wire Grafana's Tempo datasource + a saved trace search/link for `tick`
    spans, confirm a full tick's child-span waterfall is inspectable
    end-to-end for a live session.
    _Depends on: #5, #9._

## Phase 5 — Polish / follow-ups

12. **NFR7 sampling controls**
    Make `tracePerTick` / sample-interval genuinely effective (verify
    disabling still leaves gauges/counters intact, only span volume drops);
    document the on/off switch in `docs/otel-monitoring/`.
    _Depends on: #5, #6._

13. **Docs: fold OTel dev workflow into `DEVELOPMENT.md`/`README.md`**
    Add a "Telemetry" section: `pnpm run otel:up`, where to view dashboards,
    what each span/metric means — cross-link to this design doc rather than
    duplicating it.
    _Depends on: #9 (dashboards exist to document)._

14. **(Stretch, not required for v1) Automation enable/disable toggle**
    A literal on/off switch for the automation layer itself (separate from
    game pause), to allow clean manual-only baseline sessions for FR10
    comparison. Flagged as optional in design doc §2a — file as a
    lower-priority issue, only pick up if the FR10 dashboard proves
    insufficient without it.
    _Depends on: #10._

## Suggested milestone sequencing

Phase 0 and Phase 1 (#1–3) can run in parallel. Phase 2 (#4–7) is
sequential-ish but #6/#7 can parallelize once #4/#5 land. Phase 3 (#8)
should follow Phase 2 for a stable action surface. Phase 4 (#9–11) is the
payoff and depends on everything upstream. Phase 5 is cleanup, #14 explicitly
optional.
