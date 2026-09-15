# Local Development

## Prerequisites

- Node.js (version pinned in `package.json` `engines.node`; `fnm use` picks it up automatically)
- TamperMonkey (or Violentmonkey) browser extension — only needed if you're not using the chrome-devtools MCP workflow below
- A Kittens Game account at https://kittensgame.com/web/

## Setup

```bash
pnpm install
pnpm run build   # compiles src/ -> dist/
```

## Install the loader script in TamperMonkey

1. Open the TamperMonkey dashboard → **Create a new script**
2. Copy the entire contents of `loader.user.js`
3. Save (**Cmd/Ctrl + S**), name it, enable it

The loader fetches `main.js` from your local dev server when you visit Kittens Game.

## Dev loop

```bash
pnpm run dev
```

Runs the TypeScript watcher and the local static server (`server.js`) together. The compiled script is served at `http://127.0.0.1:5500/main.js`. Keep this running while you develop.

To run the two halves separately: `pnpm run watch` (rebuild on save) and `pnpm run server` (serve `dist/`) in separate terminals.

1. Edit `src/main.ts`
2. It rebuilds automatically under `pnpm run dev`
3. Refresh the Kittens Game tab to pick up the change
4. Open DevTools Console — you should see `😻 [Kittens Automation] Loader: Script loaded successfully` and `Kittens Game Engine metadata:`

## Headless debugging with the chrome-devtools MCP

You don't need TamperMonkey installed to reproduce or debug a loading issue. The ephemeral browser driven by the chrome-devtools MCP has no extensions, but `navigate_page`'s `initScript` parameter can inject the same logic the userscript does, before the page's own scripts run. This is packaged as the `browser-debug` skill (`.claude/skills/browser-debug/`) — invoke it rather than repeating the workflow by hand.

Two things worth knowing going in:

- `perTickCached` and similar cached values are only recalculated by the game's internal timer every 5 ticks, not on every `tick()` call.
- `localStorage` (and therefore the save) persists across `navigate_page` calls within the same browser context — state fabricated in one test carries into the next unless explicitly reset.

## Adding engine API types (`src/types.d.ts`)

Every property/method on `src/types.d.ts` is hand-written, because the
engine is a pre-ES6, dojo-toolkit codebase with no types and almost no
JSDoc. That's exactly how a real bug shipped
([2026-09-15: `act()` firing every tick](../decisions/2026-09-15--act-firing-every-tick.md)):
`craftAll(): void` was written from memory instead of from the source, and
was actually `craftAll(craftName: string): void`; separately, `sendHunters()`
was used instead of `huntAll()` without checking that it never spends the
resource it's supposed to relieve. Use the workflow below instead of
guessing at a signature.

### Step 1 — index candidates from the reference checkout

`scripts/index-engine-api.js` parses a reference-checkout `.js` file (using
the TypeScript compiler API against it as plain JS) and lists every
`dojo.declare(...)` class's methods with their parameters, arity, source
line, and any comment found above them:

```bash
pnpm run index-engine-api -- \
  /Users/scott/Dev/sprout-garden/gym--kittens-game/_old/kitten-game--orig/js/workshop.js \
  --class Workshop
```

(The `--` is required for pnpm to forward flags like `--class`/`--out` to
the script instead of consuming them itself.)

This reference checkout **may be an older build than the live site** — see
CLAUDE.md and
[docs/architecture/automation-harness.md](../architecture/automation-harness.md).
Treat every row the indexer prints as a candidate, not a fact — for example:

```
| `craftAll` | `craftName` | 1 | 2562 | Crafts maximum possible amount for given recipe name |
```

tells you *this checkout* declares `craftAll` with one parameter at line
2562 — not that the live game still does.

### Step 2 — cross-check live before trusting anything

Use the `browser-debug` skill's chrome-devtools MCP session against
`kittensgame.com/web/`. Start with a non-destructive read:

```js
// Arity: does the live method actually take the number of params the
// indexer found?
gamePage.workshop.craftAll.length   // -> 1

// Quick behavioral read
gamePage.workshop.craftAll.toString()
```

Only fabricate state and actually invoke a method when a static read leaves
a real behavioral question unanswered (e.g. "does this consume the resource
that triggers it?") — see the before/after resource-pool diffing done for
`huntAll`/`sendHunters` in
[docs/decisions/2026-09-15--act-firing-every-tick.md](../decisions/2026-09-15--act-firing-every-tick.md)
as the pattern to follow.

### Step 3 — hand-add to `types.d.ts`

Add the method to the relevant interface, with an inline comment citing the
reference-checkout file/line *and* whatever live-verified nuance you found
in Step 2 — see the existing `huntAll`/`sendHunters` and `craftAll` entries
in [`src/types.d.ts`](../../src/types.d.ts) for the house style to match.

### What this tool is not

The indexer's output is never committed and is not a source of truth on its
own — it's a scratch aid for Step 1, nothing more. If you want to keep a
report around during a session, write it outside the repo with `--out`
(e.g. your scratchpad directory), not under `docs/`. Run
`node scripts/index-engine-api.js --help` for the full flag list.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Script not loading | Verify the dev server: `curl http://127.0.0.1:5500/health`; confirm `dist/main.js` exists; check the loader URL has no `/dist/` prefix (the server serves `dist/` as its web root) |
| Script loads but doesn't work | Check DevTools console for errors; verify `window.gamePage` exists |
| Changes don't appear | Refresh the game tab; confirm `dist/main.js` was rebuilt |
| TypeScript errors | Run `pnpm run build` for full compiler output |
| Port 5500 already in use | Change `PORT` in `server.js`, update `loader.user.js` accordingly |
| Methods not found | In DevTools console: `window.gamePage` to check the engine is accessible, `console.log(Object.keys(window.gamePage))` to list available properties, then update `src/main.ts` with correct names |

See `docs/architecture/automation-harness.md` for the engine hooking model and API reference.
