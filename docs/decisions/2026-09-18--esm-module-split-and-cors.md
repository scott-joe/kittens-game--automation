# ES-module loading for `main.ts`, and the CORS header it requires

**Status:** Accepted

## Ask

Task 1 of the automation-console toggle UI plan
(`docs/superpowers/plans/2026-09-18-automation-console-toggle-ui.md`)
needs `main.ts` to split automation logic into `src/automations/*.ts`
files that it `import`s, starting with a small shared config module,
`src/automation-config.ts` (`LOG_PREFIX`, `DANGER_ZONE_THRESHOLD`). That
only works if the compiled files are loaded as real ES modules — `tsc`
can compile `import`/`export` syntax, but the browser has to actually
execute it as a module for the statement to be legal at runtime. Until
now `main.ts` compiled to a single self-contained IIFE with no imports,
loaded via a classic `<script src>` tag (see
`docs/architecture/automation-harness.md`'s core principle and the CSS
style-loader ADR, both predating this change).

## Design: `type="module"` on the loader's script tag

Changed three places that construct the same script tag (kept in sync
deliberately, per the existing "loader.user.js is authoritative, the
browser-debug skill duplicates it for headless testing" pattern already
noted in `docs/guides/local-development.md`):

- `loader.user.js` (the real Tampermonkey userscript)
- `.claude/skills/browser-debug/SKILL.md`'s `initScript` sample
- (`src/main.ts` itself needed no script-tag change — only the new
  top-of-file `import` statement)

```js
const script = document.createElement("script");
script.type = "module";
script.src = SCRIPT_URL;
```

`main.ts` now imports the two constants instead of declaring
`LOG_PREFIX` inline and re-declaring `DANGER_ZONE_THRESHOLD` a few lines
into `init()`:

```ts
// Kittens Game Automation Harness
import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "./automation-config.js";
```

Note the `.js` extension on the import specifier even though the source
file is `automation-config.ts` — required for the compiled output to
resolve as a real browser ES-module import. `tsc` resolves the specifier
against the `.ts` source at compile time and preserves the written `.js`
extension verbatim in its output; this is normal/expected behavior for
`"module": "ES2020"`, not a typo.

`DANGER_ZONE_THRESHOLD` isn't consumed at its import site yet in Task 1
— its one use site doesn't move into `registry.ts` until Task 2. `tsc`
doesn't error on an unused top-level import, so this is a deliberate,
temporary intermediate state within this one task, resolved by the very
next task in the same plan.

## Why this needed a CORS header, unlike the classic `<script src>`/`<link>` cases already documented

Both `docs/decisions/2026-09-13--respool-race-on-injection.md`-adjacent
loading (`main.js` itself, via classic `<script src>`) and the CSS
style-loader ADR's final `<link rel="stylesheet">` fix rely on the same
fact: an element that *loads* a cross-origin resource for the browser to
execute/render (`<script src>`, `<link rel="stylesheet">`, `<img src>`,
etc.) is **not** subject to CORS — only code that reads the response body
back into JavaScript (`fetch()`, `XMLHttpRequest`) is. That's exactly why
the CSS loader ADR's `fetch()`-based approach failed under CORS while its
`<link>`-based fix didn't need CORS at all.

`<script type="module" src="...">` breaks that pattern. Per the ES module
spec (and unlike a classic `<script src>`), a module script's fetch — and
the fetch of everything it statically `import`s — **is** subject to CORS,
because the module loader needs to read and parse the response body
itself (to resolve nested imports, among other things), the same
category of "JS reads the body" access a plain `<script src>` never
needed. This applies both to the top-level `main.js` module fetch and to
its `automation-config.js` import, fetched from the same
`127.0.0.1:5500` origin as a **different** origin than
`https://kittensgame.com` where the page (and therefore the module
graph) runs.

The fix: add a permissive CORS header to the dev server's responses.
Dev-only, local, no auth or cookies involved, so `*` is acceptable —
mirrors the reasoning already used for treating `server.js` as
disposable local tooling elsewhere in this repo:

```js
// Cross-origin <script type="module"> fetches (unlike classic <script src>)
// are subject to CORS — see docs/decisions/2026-09-18--esm-module-split-and-cors.md.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
```

Inserted before the static-file middleware in `server.js`, so it applies
uniformly to every file the dev server serves (`main.js`,
`automation-config.js`, and the existing `styles/*.css`).

## Verification

`pnpm run build` (via the locally-installed `tsc`, no network needed):
exit 0, and `dist/automation-config.js` now exists alongside
`dist/main.js`:

```
// dist/main.js
// Kittens Game Automation Harness
import { LOG_PREFIX, DANGER_ZONE_THRESHOLD } from "./automation-config.js";
(() => { ... })();

// dist/automation-config.js
export const LOG_PREFIX = "😻 [kg-automation]";
export const DANGER_ZONE_THRESHOLD = 0.9;
```

Confirmed live against `https://kittensgame.com/web/` via the
`browser-debug` skill's chrome-devtools MCP workflow (`navigate_page`
with the Step 4 `initScript`, `script.type = "module"`), against the
dev server serving this worktree's freshly built `dist/`:

- `window.gamePage` present after `wait_for(["catnip", "Catnip
  Field"])` resolved.
- No `SyntaxError: Cannot use import statement outside a module` in
  `list_console_messages`.
- No CORS/`Access-Control-Allow-Origin` error for
  `http://127.0.0.1:5500/automation-config.js` — `list_network_requests`
  shows `GET http://127.0.0.1:5500/main.js [200]` and `GET
  http://127.0.0.1:5500/automation-config.js [200]`, both loaded as
  `script` resources under the module graph, no failed/blocked entries
  for either origin.
- `[Kittens Automation] Loader: Script loaded successfully` still logs
  (twice — once from the `initScript`'s pre-navigation injection path,
  once from the normal DOM-ready path, matching the skill's dual-path
  `inject()` guard), followed by the existing steady-state automation
  logs (`😻 [kg-automation] ready, tracking: [...]`, the `amend.css`
  style-injection confirmation) — i.e. the module split changed nothing
  observable about the harness's own behavior, only how it loads.

(The `docs/guides/local-development.md` troubleshooting table's
reference to a `Kittens Game Engine metadata:` log line predates the
current `main.ts` and no longer matches any log this codebase emits —
noted here as a pre-existing doc/reality drift unrelated to this change,
not a regression from it.)

**Environment note, not a code issue:** during this session port `5500`
was transiently held by an unrelated dev-server process outside this
worktree, which blocked the first verification attempt (this project's
own sandboxed tooling can't bind a listening socket, and the browser
tool's network policy only permits `127.0.0.1:5500` specifically, not an
arbitrary alternate port tried as a workaround). Once that process was
stopped, verification proceeded as above with no code changes required.

## Consequences

- Any future file `main.ts` (or a module it imports) needs to import from
  must also be served by `server.js` for the module graph to resolve —
  already true here since both live under `dist/`, served by the same
  `express.static()` call the new CORS middleware wraps.
- The dev server now sends `Access-Control-Allow-Origin: *` on every
  response, not just module files. Acceptable for a local, unauthenticated
  dev tool serving static build output; would need revisiting if
  `server.js` ever grew a non-static, credentialed endpoint.
