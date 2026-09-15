# OTel Monitoring — Discovery

## Problem statement

`src/main.ts` runs inside the Kittens Game browser tab and makes automation
decisions every game tick (pause-for-famine, craft-when-near-cap, etc.), but
today the only observability is `console.log`/`console.warn`. There's no way
to answer questions like "how often does the danger-zone threshold actually
fire per resource," "how long did the game stay paused for catnip last
week," or "did a `resPool.get()` miss silently disable a resource for an
entire run" without manually reading the browser console in real time.

This effort adds OpenTelemetry-based instrumentation to the harness plus a
local collection/analysis stack, so tick-level decisions and game-economy
state become queryable data instead of scrollback.

## Functional requirements

| ID | Requirement |
| :-- | :-- |
| FR1 | Emit a trace span per `tick` covering the automation layer (not the game's own tick), with child spans for each decision point: catnip-critical check, per-resource danger-zone check + action, star-event observation, free-kitten check. |
| FR2 | Each span records why a decision did/did not fire — e.g. danger-zone span carries `resource.name`, `resource.value`, `resource.max_value`, `resource.ratio`, `action.taken` (bool). |
| FR3 | Emit metrics (gauges) for game economy state at a sampling interval decoupled from tick rate: resource `value`/`maxValue`/`perTickCached` per tracked resource, building `on` counts, kitten counts (free vs total), pause state. |
| FR4 | Emit metrics (counters) for automation actions taken: crafts triggered, hunts sent, kittens promoted, faith praised, pause-for-famine events — labeled by resource/reason. |
| FR5 | Emit a log record (OTel log, not just `console.*`) for warnings/errors already surfaced today (missing resource key, action threw, engine-ready timeout), correlated to the active trace/span where applicable. |
| FR6 | Telemetry must not change automation behavior — instrumentation failures must never prevent a tick's real automation logic from running (matches the existing per-block try/catch philosophy in `main.ts`). |
| FR7 | Provide a local dashboard (Grafana or equivalent) with at least: resource levels over time, tick-decision trace waterfall/search, pause events timeline, action-rate counters. |
| FR8 | Telemetry pipeline must work fully offline/local — no data leaves the machine by default. |
| FR9 | Every game-state-changing action (craft, hunt, promote, praise, pause/unpause) must be attributed to a **source** — `automation` or `manual` — so trends can be split by who/what drove them, not just what happened. |
| FR10 | Dashboard must support comparing game-economy trends across time ranges where automation was active vs. inactive/manual-only, to answer "what did automation actually change" rather than only "what happened." |

## Non-functional requirements

| ID | Requirement |
| :-- | :-- |
| NFR1 | **Tick-rate safety**: the game ticks frequently (sub-second in accelerated play); per-tick span creation + export must not introduce perceptible frame lag. Batch/export must be async and never block the tick. |
| NFR2 | **Bundle size**: the harness is a single userscript injected via Tampermonkey/loader — instrumentation code should stay lean; avoid pulling in OTel SDK components not needed in a browser context (e.g. no Node-only exporters). |
| NFR3 | **Resilience to collector being down**: if the local collector isn't running, the game and its automation must continue unaffected (exporter failures swallowed/backed off, not thrown). |
| NFR4 | **Local-only by default**: collector config should default to `localhost`, with no external endpoints baked in. |
| NFR5 | **Cardinality control**: resource/building/kitten names are a small bounded set (~10-20 keys) — safe as span attributes/metric labels; avoid unbounded labels (e.g. raw error messages as label values). |
| NFR6 | **Dev workflow parity**: must fit the existing `pnpm run dev` loop (tsc watch + local server) — adding the collector stack should be one additional `docker compose up`, not a rearchitecture of the dev loop. |
| NFR7 | **Sampling control**: full per-tick tracing should be toggleable/sample-able, since long play sessions could otherwise generate large trace volumes locally. |

## Constraints & context

- Runtime is a **browser tab**, not Node — must use `@opentelemetry/sdk-trace-web` / OTLP HTTP exporter (browser-compatible), not `sdk-trace-node`.
- No build-time bundler currently exists beyond `tsc` (see [DEVELOPMENT.md](../../DEVELOPMENT.md)); OTel browser SDK + its deps will need to be bundled somehow (bare `tsc` won't resolve npm package imports into a single browser-loadable `dist/main.js`). This is a **new** build requirement introduced by this work — see architecture doc.
- Existing dev server (`server.js`, Express, port 5500) serves `dist/` statically; it can double as a lightweight OTLP-forwarding proxy if useful, or the collector can run as its own local service.
- Decision made in [Q&A above]: local OTel Collector + backend via `docker-compose`, browser OTel SDK exporting OTLP/HTTP directly to the local collector, covering both automation-decision tracing and game-economy metrics from the start.

## Attribution: manual vs. automation

Stated goal: analyze the game's own trends *alongside* manual play and
automation's impact — not just "what happened" but "what did automation
cause vs. what did the player do by hand." `main.ts`'s automation calls the
same `gamePage` methods (`craft`, `sendHunters`, `promoteKittens`, `praise`,
`togglePause`) that the game's own UI buttons call when the player clicks
them directly. Manual play isn't otherwise instrumented today, so
distinguishing the two requires tagging calls to those shared methods by
origin rather than assuming everything observed came from automation. See
design doc for the wrapping approach.

## Open questions (deferred to design)

- Exact backend choice for the local stack: Grafana LGTM (Loki/Grafana/Tempo/Mimir all-in-one) vs. Jaeger+Prometheus+Grafana vs. SigNoz. Recommend the all-in-one to minimize compose complexity — resolved in design doc.
- Bundling strategy for pulling OTel's browser SDK into a single-file userscript (esbuild/rollup vs. keeping `tsc` and vendoring a prebuilt bundle).
