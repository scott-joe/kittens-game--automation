# Kitten Almanac & World History — Design Addendum

Builds on [01-discovery.md](01-discovery.md)–[04-implementation-plan.md](04-implementation-plan.md).
Where those docs cover *operational* telemetry (is the automation behaving
correctly, right now), this addendum covers *durable history* (what
happened, ever, queryable forever) — a related but distinct problem with a
different storage answer. Source research: game engine internals in
`js/village.js`, `js/buildings.js`, `js/science.js`, `core.js` of the
upstream Kittens Game source (see conversation history for the full
file:line citations — not duplicated here to keep this doc focused on
design).

## Why not just OTel for this too

OTel backends (Tempo/Loki/Prometheus) are built around retention windows and
sampling — reasonable for "what's happening right now / in the last N days,"
wrong for "this kitten's entire life, queryable forever." SQLite is the
system of record for durable entity history; OTel stays scoped to
operational tracing/metrics as already designed. The two are linked by a
shared correlation key rather than one being derived from the other (see
Correlation below) — deriving the almanac from OTel's own storage would
inherit its rotation/sampling limits, which defeats the point.

## Two capture strategies, matched to two kinds of data

Confirmed against actual engine behavior:

- **Kitten identity has no stable ID or birth timestamp in the engine** —
  only `name`/`surname`/`trait`, identified by array position. Needs
  **event hooks** (birth/death are discrete, fast-moving, and lossy if
  sampled — a kitten born and dead between two snapshots would vanish
  entirely under a snapshot-only approach).
- **World state (resource levels, building counts/stages, researched
  techs/policies) changes slowly relative to tick rate** and doesn't need
  per-mutation fidelity — "how much catnip at 10-minute mark" is the
  interesting question, not "every craft that moved the needle." This is a
  **periodic snapshot**, not an event stream.

This is a deliberate hybrid, not "snapshot everything" or "event-source
everything" — matches the shape of the actual data.

### Event hooks (kitten lifecycle)

| Event | Hook point | Notes |
| :-- | :-- | :-- |
| Born | `village.sim.addKitten` | Called exactly once per new kitten; patch immediately after the push to capture `name`/`surname`/`trait`. |
| Died | `village.sim.killKittens` | Sole death path (starvation only); always removes the *newest* kittens by array index, so the function's own return value is exactly the correct "who died" set — no inference needed. |

**Synthesizing an ID**: generate a `crypto.randomUUID()` client-side at the
birth hook and attach it directly to the live kitten object (e.g.
`kitten.__almanacId`) before it's ever sent anywhere. This makes the ID
available to the death hook later (which only has the engine's own kitten
objects to work with, no DB round-trip needed to know "which kitten was
this") and means correlation still works even if a given write to SQLite or
OTel fails — the ID exists independent of either sink succeeding.

### Periodic snapshots (world state)

Reuse `TELEMETRY_CONFIG.sampleIntervalMs` — the same interval already
planned for the OTel gauge sampler ([02-design.md](02-design.md) §2,
[04-implementation-plan.md](04-implementation-plan.md) #6) — for the
almanac's world-state snapshots too. **One interval, one clock, for both
systems.** This was a specific ask: snapshot cadence must line up with the
OTel gauge timestamps so a graphing tool can overlay "resource trend from
Prometheus" against "building/tech state from SQLite" on the same time axis
without interpolation. Don't introduce a second configurable interval for
this — if the OTel sample interval ever changes, the snapshot cadence
changes with it by construction.

Each snapshot captures: every tracked resource's `value`/`maxValue`/
`perTickCached`, every building's `on` count and current `stage` (for
staged buildings like Hut→Log House→Mansion), every researched tech key,
every enacted policy key.

## Fan-out: one call site, two sinks, shared correlation key

Rather than instrument OTel and the almanac independently (which risks them
drifting out of sync), both hooks and the snapshot timer call through a
single function in `telemetry.ts`:

```ts
interface AlmanacEvent {
  type: "kitten_born" | "kitten_died" | "world_snapshot";
  sessionId: string;   // same UUID already used as the OTel service.session_id resource attribute
  tick: number;
  occurredAt: number;  // Date.now()
  payload: Record<string, unknown>;
}

function recordEvent(event: AlmanacEvent): void {
  // 1. OTel: emit as a log record / span event, tagged with the same
  //    sessionId (+ kitten_id / building_key / tech_key in payload as
  //    span/log attributes) so a Tempo/Loki query can find "everything
  //    tagged with this kitten_id" alongside operational spans.
  // 2. Almanac: POST to server.js's /almanac endpoint, which writes the
  //    durable SQLite row. Wrapped in the same try/catch-and-continue
  //    philosophy as the rest of telemetry.ts (NFR3) — a down server.js
  //    endpoint must not affect gameplay or automation.
}
```

`sessionId` + `tick` (+ the relevant entity key — `kitten_id`, or a
building/tech key for future extensions) is the join key across both
systems: a future viewer can pull a kitten's SQLite biography row, then
query Tempo/Loki for `sessionId=X AND kitten_id=Y` to see what else was
happening (a famine pause, a resource crunch) at the ticks bracketing that
kitten's life, all inside one interface, without either system needing to
know about the other's schema.

## Storage: SQLite via `server.js`

`server.js` is the only long-lived local process here (the browser tab
isn't), so it owns the database — `better-sqlite3` (sync, zero-config,
matches the "no new always-on complexity" bar already set for this
project). New endpoints:

- `POST /almanac/event` — accepts an `AlmanacEvent`, writes to the
  appropriate table based on `type`.
- (later, once there's a reason to read it back) `GET /almanac/kittens`,
  `GET /almanac/snapshots` — deferred until a viewer is actually built;
  not needed to start capturing data.

### Schema (normalized, not JSON blobs — deliberately, so snapshot data is
directly query/graphable in SQL without JSON extraction, matching the
"line up on graphing tools" goal)

```sql
CREATE TABLE kittens (
  id TEXT PRIMARY KEY,          -- the client-generated UUID
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  trait TEXT,
  born_tick INTEGER NOT NULL,
  born_at INTEGER NOT NULL,     -- epoch ms
  died_tick INTEGER,
  died_at INTEGER,
  cause TEXT                    -- 'starvation' for v1; column exists for future causes
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  captured_at INTEGER NOT NULL
);

CREATE TABLE snapshot_resources (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  resource_key TEXT NOT NULL,
  value REAL NOT NULL,
  max_value REAL,
  per_tick REAL
);

CREATE TABLE snapshot_buildings (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  building_key TEXT NOT NULL,
  count_on INTEGER NOT NULL,
  stage INTEGER
);

CREATE TABLE snapshot_tech_state (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  kind TEXT NOT NULL CHECK (kind IN ('tech', 'policy')),
  key TEXT NOT NULL
  -- presence of a row = researched/enacted as of this snapshot
);
```

Indexes on `(session_id, tick)` across all tables — the expected query shape
is always "for this session, around this tick."

## Future work (documented now, not built): resource transaction ledger

Raised and explicitly deferred: recording *what was spent to buy what* (a
craft of 10 wood costing catnip+minerals, a building costing X+Y, etc.)
would let the almanac answer "where did all the wood actually go" — a real
"spending map" of a playthrough. Judged likely too expensive for the value
right now: it means hooking (or diffing resource pools around) every
resource-consuming action across crafting, building, tech, and policy
purchases, not just the handful of lifecycle events above.

**Cheaper path, if revisited**: the game already stores each purchasable's
*price* declaratively in its config (building/tech/policy prices are static
arrays in `js/buildings.js`/`js/science.js`, scaled by a known formula per
purchase count) — so a transaction ledger doesn't need to diff resource
pools before/after each action. It can read the *declared* price at the
same hook points already identified for construction/research (`core.js`'s
shared `build` controller and `onPurchase`) and record `{action, resource,
amount}` tuples directly from config, no diffing required. This drops the
implementation cost significantly if picked up later — worth re-evaluating
once the base almanac is live and it's clear what questions people actually
want to ask of it.

**Not filed as an issue now** — noted here so the schema/hook decisions
above don't accidentally foreclose it (e.g. the `snapshots`/`kittens`
tables above don't need to change to add a `transactions` table alongside
them later).

## Non-goal (for now): rendered world visualization

The original spark for this — rendering the almanac data as a graphical
"world" representation — is real but explicitly out of scope for this
phase. Everything above is aimed at making the *data* exist and be
queryable; a rendering layer is a separate, later effort once there's
actually a session's worth of almanac data to render.

## Implementation plan addendum

New issues, milestone
[Kitten Almanac & World History](https://github.com/scott-joe/kittens-game--automation/milestone/2)
(issues [#15](https://github.com/scott-joe/kittens-game--automation/issues/15)–[#21](https://github.com/scott-joe/kittens-game--automation/issues/21);
depends on the OTel milestone's `telemetry.ts` init
([#4](https://github.com/scott-joe/kittens-game--automation/issues/4)) and
gauge sampler
([#6](https://github.com/scott-joe/kittens-game--automation/issues/6)) for
the shared `sessionId`/sample interval):

1. [**Add SQLite (better-sqlite3) + almanac schema to `server.js`**](https://github.com/scott-joe/kittens-game--automation/issues/15) — create
   the tables above on startup if missing.
2. [**`POST /almanac/event` endpoint**](https://github.com/scott-joe/kittens-game--automation/issues/16) — validates `AlmanacEvent` shape,
   routes to the right table(s) by `type`.
3. [**`recordEvent` fan-out helper in `telemetry.ts`**](https://github.com/scott-joe/kittens-game--automation/issues/17) — single call site,
   emits OTel log/span event + POSTs to `/almanac/event`; failures isolated
   per NFR3, same as all other telemetry calls.
4. [**Kitten birth/death hooks in `main.ts`**](https://github.com/scott-joe/kittens-game--automation/issues/18) — patch `addKitten`/
   `killKittens`, synthesize `kitten.__almanacId`, call `recordEvent`.
5. [**World-state snapshot timer**](https://github.com/scott-joe/kittens-game--automation/issues/19) — reuse the gauge sampler's interval
   (#6 from the OTel plan); read resources/buildings/techs/policies, call
   `recordEvent({type: "world_snapshot", ...})`.
6. [**Correlation attributes on OTel side**](https://github.com/scott-joe/kittens-game--automation/issues/20) — ensure `kitten_id` (and
   `building_key`/`tech_key` where relevant) land as span/log attributes,
   not just in the SQLite row, so Tempo/Loki queries can filter by them.
7. *(Stretch, deferred)* [**Resource transaction ledger spike**](https://github.com/scott-joe/kittens-game--automation/issues/21) — prototype
   the config-price-read approach above once the base almanac has real
   data to validate against.
