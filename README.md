# Kittens Game Automation

A TypeScript automation harness for [Kittens Game](https://kittensgame.com/web/), delivered as a Tampermonkey userscript. It hooks the game's own `window.gamePage` engine to auto-craft resources, auto-pause on impending catnip famine, and similar tick-level automation.

- **[docs/guides/local-development.md](docs/guides/local-development.md)** — setup, dev loop, and debugging (including a headless chrome-devtools MCP workflow that needs no browser extension).
- **[docs/architecture/automation-harness.md](docs/architecture/automation-harness.md)** — how the harness hooks the engine, the API reference, and the conventions to follow when extending it.
- **[docs/decisions/](docs/decisions/)** — dated write-ups of bugs found and decisions made, with the reasoning behind non-obvious choices in `main.ts`.
