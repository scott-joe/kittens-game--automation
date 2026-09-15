# OTel Monitoring — Design Doc

See [01-discovery.md](01-discovery.md) for requirements this design satisfies.

## Goals / Non-goals

**Goals**: rich per-tick decision tracing, game-economy metrics over time, a
local dashboard for both, zero behavioral impact on automation, fits the
existing dev loop.

**Non-goals**: remote/cloud telemetry backend, multi-user or multi-session
aggregation, alerting/paging, replacing `console.*` entirely (keep console
output for the live DevTools workflow — OTel is additive).

## High-level shape

```
┌─────────────────────────┐        OTLP/HTTP        ┌───────────────────┐
│ Browser tab              │  spans, metrics, logs   │  OTel Collector    │
│  window.gamePage.tick()  │ ───────────────────────▶│  (docker, local)   │
│  ├─ src/telemetry.ts     │                          └─────────┬─────────┘
│  │  (OTel Web SDK)       │                                    │
│  └─ src/main.ts          │                                    ▼
└─────────────────────────┘                          ┌───────────────────┐
                                                        │ Grafana LGTM      │
        pnpm run dev serves dist/main.js               │ (Tempo/Loki/      │
        (unchanged)                                     │  Prometheus/      │
                                                          │  Grafana), docker │
                                                          └───────────────────┘
```

## Components

### 1. `src/telemetry.ts` — instrumentation module

New module, separate from `main.ts`, exporting a small typed API so
`main.ts`'s automation logic doesn't get cluttered with OTel boilerplate:

```ts
export interface Telemetry {
  tickSpan<T>(fn: (span: Span) => T): T;          // wraps one automation tick
  recordDecision(name: string, attrs: Attributes, fn: () => void): void; // child span
  gauge(name: string): (value: number, attrs?: Attributes) => void;
  counter(name: string): (attrs?: Attributes) => void;
  logWarn(msg: string, attrs?: Attributes): void;
}

export function initTelemetry(config: TelemetryConfig): Telemetry;
```

- Initializes `WebTracerProvider`, `MeterProvider`, and the OTel Logs SDK,
  each with an `OTLPExporter` (HTTP/protobuf or HTTP/JSON — JSON is simpler
  to debug via browser devtools network tab, and volume here is low enough
  that protobuf's efficiency isn't needed) pointed at the local collector
  (default `http://127.0.0.1:4318`).
- Uses `BatchSpanProcessor` / periodic metric export so exporting never
  blocks the tick (NFR1, NFR3).
- All exporter calls wrapped so a failed/absent collector degrades to a
  no-op (NFR3) — checked once at init via a short-timeout health probe
  against the collector, falling back to a `NoopTelemetry` implementation
  if unreachable, rather than retrying per-tick.
- `service.name` resource attribute: `kittens-game-automation`.

### 2. `main.ts` integration points

Given the current tick structure ([src/main.ts:134-192](../../src/main.ts#L134)):

| Existing code | Instrumentation added |
| :-- | :-- |
| `g.tick = function(...) { originalTick.apply(...); ... }` | Wrap automation body (everything after `originalTick.apply`) in `telemetry.tickSpan(span => { ... })` |
| `isFoodAdvisorTriggered()` / `isCatnipCriticalThisTick()` / `pauseForCatnip()` | Child span `catnip-check` with attributes `trigger` (`food-advisor`\|`same-tick`\|`none`), `catnip.value`, `catnip.per_tick`; counter `automation.pause_for_famine` incremented when triggered |
| per-resource danger-zone loop | Child span `resource-check` per resource with `resource.name`, `resource.ratio`, `action.taken`; counter `automation.action_taken{resource=...}` on fire |
| `resourceDefs` → `managedResources` filtering (init-time, not per-tick) | Log record when a resource key isn't found (`resource_missing`, `resource.key`) — replaces/augments the existing `console.warn` |
| catch blocks around each independent piece | `telemetry.logWarn(...)` alongside existing `console.warn`, tagged with the failing block's name, correlated to the current span |
| resource sampling (new, for FR3 gauges) | Separate `setInterval`-driven sampler (default 5s, configurable), independent of tick rate — reads `g.resPool`, `g.bld`, `g.village`, `g.isPaused` and records gauges. Decoupling from tick rate matters because tick rate itself varies with game speed-up. |

Design principle carried over from the existing code: **telemetry failures
are isolated the same way automation failures already are** — each
`telemetry.*` call is wrapped in try/catch inside `telemetry.ts` itself, so
`main.ts` doesn't need its own defensive wrapping around telemetry calls,
keeping FR6/NFR3 enforced in one place.

### 2a. Attribution: manual vs. automation (FR9/FR10)

`main.ts`'s automation and the game's own UI buttons ultimately call the
same `gamePage` methods — `craft`, `craftAll`, `sendHunters`,
`promoteKittens`, `religion.praise`, `togglePause`. Rather than instrument
each `ManagedResourceDef.act` call site individually (which only tags calls
*we* make, leaving manual clicks invisible), wrap the shared methods
themselves once, at the same point `g.tick` is already being wrapped:

```ts
let automationInFlight = false; // set around our own act() calls only

function wrapAttributed<A extends any[], R>(
  obj: any, method: string, telemetry: Telemetry,
): void {
  const original = obj[method];
  obj[method] = function (...args: A): R {
    const source = automationInFlight ? "automation" : "manual";
    telemetry.counter("game.action")({ method, source });
    return original.apply(this, args);
  };
}
```

`automationInFlight` is set `true`/`false` immediately around each
`resource.act()` call in the tick loop (and around the existing
`pauseForCatnip` → `g.togglePause()` call), so any call to a wrapped method
*not* bracketed by that flag is attributed `manual` by construction — no
guessing from call stacks or timing heuristics needed, since automation is
the only caller that sets the flag.

This covers FR9 for the specific actions the harness already knows about.
It does **not** capture manual actions the harness has no hook for at all
(e.g. manually assigning a kitten's job, building construction) — out of
scope for v1; extending `wrapAttributed` to more `gamePage` methods is a
cheap follow-up once the pattern is validated, not a redesign.

**Trend comparison (FR10)**: with `game.action{source}` counters and
`game.paused` gauge in place, a Grafana panel can overlay resource-rate
(`deriv()`/`rate()` of `game.resource.value`) against shaded regions where
`automation.action_taken` rate > 0 vs. flat — answering "was the economy
growing faster during automation-heavy stretches" without needing a
separate manual on/off toggle. A literal automation-enable/disable toggle in
`main.ts` (so a session could be run purely manually for a clean baseline)
is called out as a **candidate follow-up**, not built in v1 — flag for the
implementation plan as a stretch item.

### 3. Build pipeline change

`tsc` alone can't bundle `@opentelemetry/*` npm packages into the single
file the userscript loader fetches. Introduce **esbuild** (fast, zero-config
for this use case, single dependency) as a bundling step:

- `pnpm run build`: `esbuild src/main.ts --bundle --outfile=dist/main.js --target=es2020` (replaces raw `tsc` for emit; `tsc --noEmit` kept as a separate `typecheck` script so type errors still fail the build)
- `pnpm run watch`: `esbuild --watch` variant, replacing `tsc --watch` in the `dev` concurrently task
- `server.js` unchanged — still serves `dist/`.

### 4. Local collector + backend stack

`docker-compose.yml` at repo root:

- **otel-collector** (`otel/opentelemetry-collector-contrib`): receives
  OTLP/HTTP on `4318`, exports to Tempo (traces), Prometheus remote-write or
  native Prometheus scrape (metrics), Loki (logs).
- **Grafana LGTM** all-in-one image (`grafana/otel-lgtm`) chosen over
  separately composing Jaeger+Prometheus+Grafana+Loki — one container, one
  port (`3000`) for the Grafana UI, minimizes NFR6 (dev workflow parity)
  overhead. The collector can point directly at this image's built-in OTLP
  receiver, so a standalone `otel-collector` container may not even be
  needed — **evaluate collapsing to just `otel-lgtm` during implementation**
  if its built-in receiver covers our needs, simplifying the compose file
  further.
- CORS: browser SDK sends OTLP/HTTP directly from `https://kittensgame.com`
  origin to `http://localhost:4318` — the collector/LGTM OTLP HTTP receiver
  needs CORS headers enabled for this origin (`cors.allowed_origins` in
  collector config, or LGTM's receiver equivalent). This is the one piece
  worth prototyping early since it determines whether direct browser→local
  export is viable at all, vs. needing `server.js` to proxy telemetry
  (fallback plan below).

**Fallback if CORS/mixed-content proves unworkable**: the game runs on
`https://kittensgame.com`, and browsers block `https:` pages from making
unencrypted `http://localhost` requests in some configurations (though
`localhost` is generally treated as a secure context exception in Chrome).
If this bites in practice, add a `/telemetry` proxy endpoint to the existing
`server.js` (same-origin-friendly since the loader already points at it)
that forwards to the collector server-side. Documented as a fallback, not
built preemptively — confirm the direct path works first.

### 5. Dashboards

Grafana provisioned dashboards (JSON, checked into
`docs/otel-monitoring/dashboards/`, auto-loaded via LGTM's provisioning
volume mount):

- **Game Economy**: resource value/max/rate over time (one panel, series per
  resource, toggleable), building `on` counts, kitten counts.
- **Automation Activity**: action-taken counters by resource/reason, pause
  events as annotations on the economy timeline.
- **Manual vs. Automation**: `game.action` counters split by `source` label
  (stacked bar or two series), resource growth-rate overlay shaded by
  automation-active periods — the FR10 comparison view.
- **Tick Trace Explorer**: Tempo trace search/waterfall (link to Tempo
  datasource, not a custom panel) — for inspecting individual tick spans.

## Data model

**Resource attributes** (attached to the OTel `Resource`, not per-span):
`service.name=kittens-game-automation`, `service.version` (from a build-time
constant), `game.session_id` (random UUID generated at `initTelemetry()`
time, so a dashboard can filter to one play session).

**Span naming**: `tick`, `tick.catnip_check`, `tick.resource_check`,
`tick.star_event`, `tick.free_kitten_check` — dotted to group in trace UIs.

**Metric names** (follow OTel semconv-style dotted naming):
`game.resource.value`, `game.resource.max_value`, `game.resource.per_tick`,
`game.building.count`, `game.kittens.free`, `game.kittens.total`,
`game.paused` (0/1 gauge), `automation.action_taken` (counter, labels
`resource`), `automation.pause_for_famine` (counter, label `trigger`),
`game.action` (counter, labels `method`, `source` ∈ {`automation`,
`manual`}).

## Alternatives considered

| Option | Why not chosen |
| :-- | :-- |
| Keep `console.*` only, skip OTel | Doesn't satisfy the actual ask — no queryability, no time-series, no trace correlation across a session. |
| Send telemetry to a hosted/cloud OTel backend (Honeycomb, etc.) | Rejected by discovery decision — local-only stack requested; also avoids sending game-session data off-machine by default. |
| Node-side telemetry only (instrument `server.js`, not the browser script) | Misses the actual subject of interest — `server.js` only serves static files, it has no visibility into tick-level game state. The interesting data originates in the browser. |
| Hand-rolled minimal OTLP JSON exporter instead of the OTel Web SDK | Considered for bundle-size (NFR2); rejected because it would mean hand-maintaining span/context propagation and batching, and the real cost driver is npm dependency count, not runtime perf — esbuild tree-shaking keeps the bundled SDK subset reasonably small. Revisit only if bundle size becomes a real problem in practice. |
