# Automation Console — Design: Toggle UI

Companion to [01-discovery.md](01-discovery.md) (FR-T1–T3, NFR1–2, NFR4).

## Goals / non-goals

**Goals**: let each existing automation be individually enabled or disabled
at runtime, without a rebuild, at effectively zero cost when disabled.

**Non-goals**:
- Redesigning any part of the game's own UI/theme system.
- Persisting toggle state across reloads — that's a workflow concern, see
  [03-design-workflows.md](03-design-workflows.md). A bare toggle UI reverts
  to build-time defaults on every page load.
- Exposing every possible tunable (e.g. the 90%-of-cap danger-zone
  threshold, the famine-forecast lead time) as a toggle — v1 is on/off per
  automation, not a general settings surface.

## High-level shape

Introduce an **automation registry**: instead of the tick hook directly
iterating `managedResources` and running two standalone try/catch blocks
for catnip-critical/famine and auto-observe, every independent piece of
automation becomes a registry entry with an `enabled` flag. The tick hook
becomes a single loop over the registry that skips disabled entries before
running anything, rather than three different hand-written blocks each
checking their own condition.

```ts
interface AutomationEntry {
  id: string;          // stable id, e.g. "danger-zone:catnip", "famine-autopause", "auto-observe"
  label: string;       // human-readable, for the UI
  enabled: boolean;
  run: () => void;      // the existing try/catch body, unchanged in content
}
```

The tick hook's per-tick loop becomes:

```ts
for (const entry of registry) {
  if (!entry.enabled) continue;
  try {
    entry.run();
  } catch (err) {
    console.warn(`${LOG_PREFIX} "${entry.id}" failed:`, err);
  }
}
```

This is a direct refactor of the existing pattern (per-block try/catch is
already how `main.ts` is written) — the only change is that each block
gains an `id`/`label`/`enabled` wrapper and the loop replaces the
hand-written sequence of `if`/`for` blocks.

## Data model

- **Fixed-automation entries**: catnip famine autopause and auto-observe
  each become exactly one registry entry.
- **Per-resource entries**: `resourceDefs` (the danger-zone crafting list)
  is itself a list — each resource entry (catnip, wood, minerals, ...)
  becomes its own registry entry (`danger-zone:<resKey>`), so e.g. catnip's
  danger-zone crafting can be disabled independently of wood's. A single
  master "danger-zone crafting" toggle is **not** proposed as a separate
  concept — disabling every per-resource entry has the same effect, and a
  master switch would just be another workflow (see 03), so it doesn't need
  first-class registry support.
- Registry entries are constructed once at `init()` time, in the same place
  `managedResources` is built today (skipping resources not found in the
  current save, per the existing `resPool.get()` convention).

## Alternatives considered

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **Current state**: build-time consts | Zero new code | Requires editing source + rebuild to change anything; not "runtime" at all |
| **v0 — `window`-exposed config object**, e.g. `window.kgAutomation.toggle("danger-zone:catnip", false)` | No DOM/UI work; trivially testable from DevTools console; ships fast | No discoverability (must know ids), no visual state, easy to forget it's off |
| **v1 — in-page DOM panel** injected the same way `amend.css` is (a small floating element added to `<body>` once the engine is confirmed ready) | Discoverable, visual on/off state, no console needed | More surface area to build (rendering, click handling, staying visually out of the way of the game's own UI) |

**Recommendation**: build the `window`-exposed config object first — it's
the same registry either way, just with or without a rendered panel, so it
is a legitimate, low-risk first implementation slice rather than a
throwaway prototype. The DOM panel is the intended v1 deliverable and
should read from/write to the exact same registry object, so shipping the
console-object version first doesn't create rework.

The DOM panel itself should follow the existing style-injection precedent
(`loadAndInjectStyle` in `src/main.ts`) for *where* it attaches (top of
`init()`, after engine-ready is confirmed) — not for *how* it renders,
since a settings panel needs actual DOM elements and event listeners, not
a `<link>` tag.
