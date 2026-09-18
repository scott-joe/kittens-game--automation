# Automation Console — Design: Workflows

Companion to [01-discovery.md](01-discovery.md) (FR-W1–W3, NFR3).

**This doc assumes the `AutomationRegistry` from
[02-design-toggles.md](02-design-toggles.md) exists** — a workflow is a
named snapshot of that registry's `enabled` flags. Nothing here works
without toggles existing first.

## Goals / non-goals

**Goals**: name, save, and switch between bundles of toggle state, so a
player can jump between e.g. "early game" (danger-zone crafting only),
"faith rush" (danger-zone crafting off, planner targeting religion
unlocks — see [04](04-design-goal-planner.md)), or "afk grinding"
(everything on) without re-clicking every individual toggle.

**Non-goals**:
- Automatic workflow switching (e.g. "switch to afk grinding when I tab
  away"). This is real future work, **documented now, not built**: see
  Future work below.
- Workflow sharing/export between users/browsers. v1 is single-browser,
  single-`localStorage`-origin only.

## Data model

```ts
interface Workflow {
  name: string;
  description?: string;
  toggles: Record<string /* AutomationEntry.id */, boolean>;
}
```

A workflow's `toggles` map need not cover every registered automation id —
applying a workflow sets only the ids it lists, leaving any automation not
mentioned at its current state. This keeps workflows forward-compatible: a
workflow saved before a new automation is added doesn't need to be
re-authored, it simply doesn't touch the new one.

**Authoring**: a workflow can be created either by snapshotting the current
live registry state (FR-W3 — "save my current setup as a workflow named
X") or by hand-editing an existing workflow's `toggles` map. v1 ships with
zero built-in presets; "early game"/"faith rush"/"afk grinding" are
user-authored examples, not shipped defaults, since what a useful preset
looks like depends on the specific automations that exist by the time this
is built (see [06-implementation-plan.md](06-implementation-plan.md)) and
on individual playstyle.

## Persistence

**Open question, with a recommended default.**

| Option | Pros | Cons |
| :-- | :-- | :-- |
| `localStorage` | No manifest change needed, simplest API, already implicitly relied on by the game's own save (`docs/guides/local-development.md` notes it persists across `navigate_page` calls) | Shared origin/key namespace with the game itself and any other userscripts running on the same page — a naming collision is possible |
| Tampermonkey `GM_setValue`/`GM_getValue` | Sandboxed to this userscript specifically, no collision risk | Requires a `@grant` change in `loader.user.js`'s metadata block (currently `@grant none`), which changes what Tampermonkey permits the script to do — a bigger footprint change than it looks |

**Recommendation**: `localStorage`, namespaced under a single prefixed key
(e.g. `kg-automation:workflows`) to avoid the collision risk without taking
on the `@grant` change. Store a versioned schema, e.g.:

```json
{ "schemaVersion": 1, "workflows": [ /* Workflow[] */ ] }
```

so a future format change can detect and migrate an old shape instead of
silently misreading it (mirrors this project's general stance on version
drift — see the `getMeta` defensive-hardening precedent in
`docs/architecture/automation-harness.md`). Loss of persistence (blocked
`localStorage`) must degrade to "no workflows available, toggles still work
individually," not break the toggle UI (NFR3).

## Alternatives considered

- **`localStorage` vs. `GM_setValue`** — see table above; `localStorage`
  chosen to avoid the `loader.user.js` `@grant` change.
- **No persistence (session-only)** — rejected as not meeting FR-W2; would
  make "workflows" indistinguishable from just clicking several toggles by
  hand each session.

## Future work (documented now, not built)

- **Automatic workflow switching** — e.g. time-based, or triggered by game
  state (switch to "faith rush" once a certain tech is researched). This
  composes naturally with the goal-planner in
  [04-design-goal-planner.md](04-design-goal-planner.md) (the planner could
  itself suggest or apply a workflow once its current goal completes), but
  is explicitly out of scope for v1 — flagged here so it isn't silently
  dropped, matching the framing `docs/otel-monitoring/05-almanac-and-world-history.md`
  uses for its own deferred features.
