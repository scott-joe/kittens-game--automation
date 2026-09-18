# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tampermonkey userscript automation harness for the browser game Kittens Game (kittensgame.com). The compiled output (`dist/main.js`) runs **inside the live game's browser tab**, hooking `window.gamePage` — it is not a Node app, even though the build tooling is Node/TypeScript.

## Commands

Use **pnpm**, not npm/yarn (lockfile and scripts assume it).

- `pnpm run dev` — TypeScript watch + local static server together (the normal dev loop)
- `pnpm run build` — `tsc` compiles `src/**/*.ts` → `dist/`
- `pnpm run server` — Express server serving `dist/` on port 5500 (`/health` endpoint)
- `pnpm run start` — build then serve

There is no automated test suite. "Testing" means rebuilding and verifying in an actual browser tab against kittensgame.com — see `.claude/rules/local-development.md` (or invoke the `browser-debug` skill for the headless chrome-devtools MCP path).

## Architecture

See `.claude/rules/automation-harness.md` (symlinked from `docs/architecture/`, loaded automatically) for the engine-hooking model, load-order gotchas, and API reference. It is canonical — edit `docs/architecture/automation-harness.md`, never the symlink.

## Repo conventions

- Write a dated file in `docs/decisions/` for notable bugs/investigations, following the `sprout-standards:adr` naming convention (`YYYY-MM-DD--kebab-topic.md`) — see existing files there for the pattern: what happened, root cause, fix.
- `docs/otel-monitoring/` holds a *planned but unimplemented* OpenTelemetry instrumentation design (5-doc series). Don't assume any of it (including a proposed esbuild build-pipeline switch in doc 4) is actually in place — current build is plain `tsc`, current logging is `console.log`/`warn`.
- `docs/automation-console/` holds a *planned but unimplemented* design for a runtime automation toggle UI, named workflow presets, and a goal-directed job-optimization planner (6-doc series). Don't assume any of it is in place — automations are still hardcoded consts/arrays in `src/main.ts` today.
- The sibling checkout `/Users/scott/Dev/sprout-garden/gym--kittens-game/_old/kitten-game--orig` has the game's own source but may be an older build than what's live — treat as reference only, verify against the live site when in doubt.
