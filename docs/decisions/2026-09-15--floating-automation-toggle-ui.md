# Decision Record: Floating bottom-left UI for toggling automations on/off

**Status:** Proposed
**Date:** 2026-09-15
**Context:** User asked whether a small hovering UI panel (chatbot-widget style, bottom-left of the page) could let them toggle individual pieces of automation on/off at runtime, and wanted the feasibility question answered before any design of the toggle mechanics or hook wiring.

---

## Summary

**Add a small floating DOM panel, injected by `main.ts` into the live `kittensgame.com` page, to toggle individual automation features on/off at runtime** — confirmed feasible with no blockers from the game's page structure or this project's existing injection model; this record captures that feasibility finding so the actual toggle design (which automations, persistence, styling) can be scoped later.

## Context

### Problem

The userscript (`dist/main.js`) currently runs a fixed set of automations unconditionally inside `gamePage.tick`'s hook (per `docs/architecture/automation-harness.md`). There is no runtime way to disable one piece of automation (e.g. auto-pause on famine) without editing source and rebuilding. The user wants a lightweight, always-visible control surface — the kind of floating widget common to chatbot embeds — anchored bottom-left, to flip automations on/off without a rebuild.

This record only addresses the preliminary question asked: **can such UI even be injected into this page given how the harness works?** It does not design the toggle state model, persistence, or which automations get switches — that's explicitly deferred.

### Constraints

- `dist/main.js` executes inside the live game tab, not in Node — any UI must be plain DOM/CSS/JS, no bundler, no framework (consistent with the rest of the codebase; see CLAUDE.md).
- The project already has a precedent for late-bound DOM/CSS injection: custom stylesheets (`src/styles/override.css`, `src/styles/amend.css`) are injected as `<link>` elements at engine-ready time, gated by feature flags (`ENABLE_STYLE_OVERRIDE`, `ENABLE_STYLE_AMEND`) — see `docs/architecture/automation-harness.md` § Custom CSS injection.
- The game's own `updateOptions()` strips all classes off `<body>` on any options/theme change (documented gotcha) — a new panel must not depend on a surviving `<body>` class, and should be its own appended element instead.
- No automated test suite exists; verification is manual, in-browser (or via the `browser-debug` chrome-devtools MCP skill).

## Decision

Confirm (feasibility only, not implementation): a `position: fixed; bottom: ...; left: ...` panel, appended to `<body>` at the same engine-ready point where CSS is currently injected, with a high `z-index` to sit above game chrome, is a safe and low-risk way to add on/off automation toggles. Implementation (state model, which automations are toggleable, persistence across reloads, and wiring into the tick hook's per-feature try/catch blocks) is out of scope for this record and should be scoped in a follow-up when the enhancement is picked up.

## Implementation Plan

Deferred — this record exists to capture the ask and the feasibility finding, not to schedule the build. A follow-up ADR or plan should cover:

### Phase 1: TODO
```bash
```

## Benefits

| Before | After |
|---|---|
| Disabling a piece of automation requires editing `src/main.ts` and rebuilding (`pnpm run build`) | A visible in-page control flips automation state without a rebuild |
| No runtime visibility into which automations are active | A persistent widget makes active/inactive state observable at a glance |

## Risks & Mitigations

### Risk 1: Panel visually collides with game chrome or gets clipped
**Likelihood:** low
**Impact:** panel is hidden behind a game element or clipped by an `overflow: hidden` ancestor
**Mitigation:** append directly to `<body>` (not nested inside a game container), use a high `z-index` (e.g. `999999`), and verify visually in a live browser tab per `docs/guides/local-development.md`.

### Risk 2: Injection timing races the game's own boot
**Likelihood:** low
**Impact:** panel injected before `resPool`/`tick` are ready, or duplicated on re-injection
**Mitigation:** reuse the existing engine-ready gate already used for CSS injection (`docs/architecture/automation-harness.md` § Load-order gotcha), rather than inventing a new readiness check.

## Alternatives Considered

### 1. Add toggles into the game's own in-game options menu
**Pros:** toggles would live in a place players already look for settings; no separate floating element to manage.
**Cons:** requires modifying or extending the game's own options UI/DOM rather than adding an independent element; couples this project to the internal structure of a UI panel that isn't part of the documented, verified API surface (unlike `gamePage.tick`/`resPool` hooking).
**Rejected because:** the game's own UI internals are more fragile and more likely to drift between game builds than the documented `gamePage` API surface this project already relies on (see CLAUDE.md's guidance to verify against the live site rather than trust any reference as permanently accurate). An independent overlay element, by contrast, only depends on being able to append to `<body>` — a much smaller and more stable surface.

## Success Criteria

- [ ] TODO — defined when this is scoped for implementation (e.g. "panel renders bottom-left within N seconds of engine-ready, toggling a switch measurably changes tick-hook behavior on next tick").

## Related Decisions

- Builds on: [2026-09-13: CSS style loader](./2026-09-13--css-style-loader.md) (precedent for late-bound DOM/CSS injection gated on engine readiness)
- Builds on: [2026-09-13: resPool race on injection](./2026-09-13--respool-race-on-injection.md) (engine-ready gating this panel should reuse)
