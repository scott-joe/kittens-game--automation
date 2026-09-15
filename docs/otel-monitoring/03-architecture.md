# OTel Monitoring — Architecture

Companion to [02-design.md](02-design.md); this doc covers deployment
topology, file/module layout, and the build system change concretely.

## Deployment topology

```
Developer machine
├── Browser (Tampermonkey → loader.user.js → http://127.0.0.1:5500/main.js)
│   └── https://kittensgame.com tab
│       └── dist/main.js (bundled: main.ts + telemetry.ts + OTel Web SDK)
│             │ OTLP/HTTP (traces, metrics, logs) → http://127.0.0.1:4318
│
├── pnpm run dev
│   ├── esbuild --watch  (src/**/*.ts → dist/main.js, bundled)
│   └── server.js        (Express :5500, serves dist/ — unchanged)
│
└── docker compose (new: docker-compose.yml)
    └── otel-lgtm container
        ├── :4318  OTLP/HTTP receiver (CORS-enabled for kittensgame.com)
        ├── :3000  Grafana UI (pre-provisioned dashboards)
        └── internal Tempo (traces) / Prometheus (metrics) / Loki (logs)
```

No new always-on services beyond the existing `server.js` — the collector
stack is opt-in (`docker compose up`), started only when you want telemetry
for a session.

## Repository layout changes

```
.
├── src/
│   ├── main.ts                 # automation logic (existing, now imports telemetry)
│   ├── types.d.ts               # existing ambient types
│   └── telemetry.ts             # NEW: OTel init + Telemetry interface (design §1)
├── docs/
│   └── otel-monitoring/
│       ├── 01-discovery.md
│       ├── 02-design.md
│       ├── 03-architecture.md   # this file
│       ├── 04-implementation-plan.md
│       └── dashboards/          # NEW: Grafana provisioned dashboard JSON
│           ├── game-economy.json
│           ├── automation-activity.json
│           └── manual-vs-automation.json
├── docker-compose.yml            # NEW: otel-lgtm service
├── otel/
│   └── grafana-provisioning/     # NEW: datasource + dashboard provisioning config
├── esbuild.config.mjs            # NEW: replaces bare `tsc` for emit
├── tsconfig.json                 # unchanged (still used for typecheck via --noEmit)
├── package.json                  # scripts updated (below)
└── server.js                     # unchanged
```

## Build system

Current (`tsc` only, flat emit):

```
tsc src/main.ts → dist/main.js   (no bundling; fine while main.ts has 0 npm deps)
```

New (bundled, since `telemetry.ts` pulls in npm packages):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "pnpm run typecheck && node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "server": "node server.js",
    "dev": "concurrently \"pnpm run watch\" \"pnpm run server\"",
    "start": "pnpm run build && pnpm run server",
    "otel:up": "docker compose up -d",
    "otel:down": "docker compose down"
  }
}
```

`esbuild.config.mjs` targets `es2020`, bundles `src/main.ts` →
`dist/main.js`, `--format=iife` (matches the existing self-invoking-function
shape the userscript loader expects), sourcemaps enabled for DevTools
debugging. `tsc` stays for type-checking only (`--noEmit`) since esbuild
doesn't type-check — this preserves the "TypeScript rebuilds" safety net
[DEVELOPMENT.md](../../DEVELOPMENT.md) describes, just via two tools instead
of one.

**New dependencies**:
`@opentelemetry/sdk-trace-web`, `@opentelemetry/sdk-metrics`,
`@opentelemetry/sdk-logs`, `@opentelemetry/exporter-trace-otlp-http`,
`@opentelemetry/exporter-metrics-otlp-http`,
`@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources`,
`@opentelemetry/semantic-conventions` (dependencies); `esbuild`
(devDependency).

## Configuration

`telemetry.ts` reads config from constants at the top of the file (no env
vars — this is a userscript, there's no build-time env injection pipeline
today, and adding one is out of scope):

```ts
const TELEMETRY_CONFIG = {
  enabled: true,                          // master switch
  otlpEndpoint: "http://127.0.0.1:4318",
  sampleIntervalMs: 5000,                 // FR3 gauge sampling
  tracePerTick: true,                     // NFR7: can disable for long sessions
};
```

Kept simple and in-code rather than externalized, consistent with the rest
of `main.ts` (e.g. `DANGER_ZONE_THRESHOLD`, `READY_POLL_TIMEOUT_MS` are
already in-code constants, not config files).

## Failure isolation boundary

```
tick()
 ├─ originalTick.apply()          ← untouched, always runs first
 ├─ try { catnip-critical check + telemetry } catch → console.warn
 ├─ if (isPaused) return
 ├─ try { star event + telemetry } catch → console.warn
 ├─ for each resource: try { danger-zone check + act() + telemetry } catch → console.warn
 └─ try { free-kitten check + telemetry } catch → console.warn
```

Telemetry calls live *inside* the existing try/catch blocks, not wrapped
around them — a `telemetry.recordDecision(...)` failure is caught by the
same catch that already protects `resource.act()` failing, so no new
failure boundary is introduced (NFR3/FR6 satisfied structurally, not just by
convention).

## Security & privacy notes

- OTLP export target is a hardcoded `127.0.0.1` endpoint — no telemetry
  leaves the machine (NFR4) unless a developer explicitly repoints it.
- No PII is collected; `game.session_id` is a random UUID, not tied to any
  account (Kittens Game has no login/account system in scope here).
- `docker-compose.yml` binds ports to `127.0.0.1` only, not `0.0.0.0`, so the
  Grafana UI/collector aren't reachable from the local network by default.
