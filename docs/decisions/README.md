# Decisions

Dated write-ups of bugs found and decisions made while building this
automation, in case future-us (or future-Claude) needs the reasoning behind
something in `main.ts` rather than just the diff. See the `adr` skill for the
naming convention and template these follow going forward.

- [2026-09-13--getmeta-error-and-defensive-hardening.md](2026-09-13--getmeta-error-and-defensive-hardening.md) —
  a `getMeta` console error on save load turned out to be the game's own
  handled version-drift warning, not our bug; hardened `main.ts` anyway
  against the same class of risk (unrecognized resource keys, one bad tick
  step taking down the rest).
- [2026-09-13--respool-race-on-injection.md](2026-09-13--respool-race-on-injection.md) —
  `main.ts` crashed on `resPool.get()` because the loader can inject before
  `gamePage`'s subsystems finish constructing; fixed by polling for real
  engine readiness instead of just truthiness.
- [2026-09-13--catnip-famine-autopause.md](2026-09-13--catnip-famine-autopause.md) —
  auto-pause on impending catnip famine, revised from a same-tick reactive
  check (too late to react) to reusing the game's own forward-looking Food
  Advisor forecast (enough lead time to actually fix it).
- [2026-09-13--css-style-loader.md](2026-09-13--css-style-loader.md) —
  fetch-and-inject loader for two independently toggled CSS files (a full
  page override and a lighter theme amendment), designed around the
  game's `scheme_<id>` body-class theming mechanism and its lack of any
  guaranteed "last stylesheet wins" load order.

The first three were investigated and verified live via the chrome-devtools MCP
tools, driving an ephemeral (no-Tampermonkey) browser instance — see the
`browser-debug` skill (`.claude/skills/browser-debug/`) or
`docs/guides/local-development.md#headless-debugging-with-the-chrome-devtools-mcp`
for how that workflow works.
