# CSS style loader for custom page styling

**Status:** Accepted

## Ask

Give the harness a way to change the live page's *look*, not just game
logic — without editing the game's own files (it's a live third-party
site, `dist/main.js` only runs alongside it). Two related but distinct
needs: a full-page style override for a wholesale visual replacement, and
a lighter "amendment" that layers small tweaks on top of whatever theme
the player currently has active.

## Design: understanding the game's own theme mechanism first

Before deciding where/how to inject anything, checked how Kittens Game
itself does theming, using the reference checkout
(`gym--kittens-game/_old/kitten-game--orig`, caveated as possibly stale
against the live site):

- The game loads `res/default.css` (base layout) plus **every**
  `res/theme_<id>.css` file (~27 of them) into `<head>` up front,
  regardless of which is active. Which one actually applies is decided
  purely by a `scheme_<id>` class the game toggles on `<body>`
  (`js/ui.js` `updateOptions()`), not by which stylesheet is loaded.
- There are no CSS custom properties (`--foo`) anywhere in the game's CSS
  — theming is 100% class-selector-based. No "override a few vars"
  shortcut exists.
- **Gotcha:** `updateOptions()` does `$("body").removeClass()` (strips
  *everything*) before re-adding `scheme_X`, on every theme/options
  change. A userscript can't rely on any custom marker class surviving on
  `<body>`.
- `gamePage.colorScheme` is the runtime source of truth for the active
  theme id (`""` = default theme); `gamePage.ui.allSchemes` lists all
  valid ids.
- There's no single deterministic "last stylesheet wins" point built into
  the game — theme files are written to layer over `default.css` via
  selector specificity, not load order, and some theme CSS loads
  asynchronously during the game's own boot (driven off its config
  module).

This ruled out a CSS-variable-override approach (nothing to override) and
ruled out relying on `<body>` classes for anything of our own. It also
meant there's no built-in guarantee about being "last" in the cascade —
we had to pick our own best-effort injection point.

## Design: two files, not inline strings

`src/styles/override.css` (full replacement) and `src/styles/amend.css`
(layered tweaks, meant to be scoped the same way the game's own theme CSS
is — `.scheme_dark .btn { ... }`) are real `.css` files under `src/`,
not template strings embedded in `main.ts`. `main.ts` has no bundler
(plain `tsc`, one script per `.ts` file, no `import`/`export` — see
`docs/architecture/automation-harness.md`'s core principle) and adding a
bundler just for this felt like more machinery than the problem needs.
Both ship empty (header-comment scaffolding only) — real rules are a
follow-up, once there's something worth putting in them.

Each is independently gated by a config boolean in `main.ts`:

```ts
const ENABLE_STYLE_OVERRIDE = false; // full page look replacement
const ENABLE_STYLE_AMEND = true; // small layered tweaks over the active theme
```

`override.css` defaults off — it's a deliberate, disruptive replacement
that should require explicit opt-in even once populated. `amend.css`
defaults on — layering small tweaks over whatever theme is active is its
whole steady-state purpose, and it costs nothing while the file is empty.

## Revision: `fetch()` was blocked by CORS against the live site

The first version fetched the CSS text (`fetch(url).then(r => r.text())`)
and injected it into a `<style>` element — this compiled cleanly and
passed a dry `pnpm run build`, but failed the moment it was actually
tested against `https://kittensgame.com/web/` via the `browser-debug`
skill's chrome-devtools MCP workflow:

```
Access to fetch at 'http://127.0.0.1:5500/styles/amend.css' from origin
'https://kittensgame.com' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
[kg-automation] failed to load/inject style "kg-automation-style-amend": TypeError: Failed to fetch
```

The dev server (`127.0.0.1:5500`) is a different origin than the live
game (`kittensgame.com`), and `server.js`'s plain `express.static()` sends
no `Access-Control-Allow-Origin` header — so any `fetch()` of it from the
game's origin is blocked by the browser before the response body is ever
readable, regardless of whether the file exists. This didn't show up
until live-browser testing because `pnpm run build`/`tsc` has no way to
catch a same-origin-policy violation; it's a browser-enforced runtime
check with no static analogue.

The fix: inject a `<link rel="stylesheet">` element instead of `fetch()`ing
the CSS text into a `<style>` element. A `<link>` (like a `<script src>`
tag — which is exactly how the loader already gets `main.js` itself
cross-origin without incident) loads cross-origin without requiring CORS
headers; only *reading back* its content via JS would need CORS, and
nothing here does that. Success/failure is now observed via the link
element's `onload`/`onerror` handlers rather than a fetch response, which
also simplified `loadAndInjectStyle` from `async`/`Promise<boolean>` down
to a plain synchronous function taking an optional `onLoaded` callback
(used only by the `amend.css` call site, to log the active
`colorScheme` once the stylesheet is confirmed loaded).

## Implementation: link-tag injection, not bundle

```ts
function loadAndInjectStyle(url: string, elementId: string, onLoaded?: () => void): void {
  try {
    if (document.getElementById(elementId)) {
      onLoaded?.(); // already injected, e.g. init() ran more than once
      return;
    }
    const link = document.createElement("link");
    link.id = elementId;
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => {
      console.log(`${LOG_PREFIX} injected style "${elementId}" from ${url}`);
      onLoaded?.();
    };
    link.onerror = () => {
      console.warn(`${LOG_PREFIX} style "${elementId}" failed to load from ${url}`);
    };
    document.head.appendChild(link);
  } catch (err) {
    console.warn(`${LOG_PREFIX} failed to inject style "${elementId}":`, err);
  }
}
```

Failures (dev server down, wrong URL, 404) are caught via `onerror` and
logged via `console.warn`, never thrown — same "log+skip" convention the
rest of `main.ts` uses for optional/best-effort pieces (see `## Engine
conventions to follow` in the architecture doc). A failed style load must
never take down tick-patching or resource automation.

Both calls happen at the very top of `init()`, right after
`waitForEngine` has confirmed the engine (`resPool`/`tick`) is ready —
not earlier, and not inside the tick loop (this is one-time setup, not a
per-tick action). Reasoning: by the time `waitForEngine`'s poll resolves,
the game's own boot — including its async per-theme CSS loading — should
already be done, so appending our `<style>` elements then means they land
last in `<head>` and generally win equal-specificity ties. Calls are
fire-and-forget (not awaited), so a slow or failed fetch can't block
tick-patching either.

**Accepted limitation:** engine-ready is a good proxy for "game boot is
done," not a hard guarantee. If the game's async theme-loading loop is
still appending `<link>` tags after our injection point, one of those
could still win an equal-specificity tie against us. Fully closing that
gap would mean hooking the theme-loading loop itself, which felt like
solving a problem that hasn't actually been observed yet — flagged here
instead, not solved.

One diagnostic log line reports `gamePage.colorScheme` once `amend.css`
is confirmed injected — not speculative, since `amend.css`'s entire
purpose is scoping rules by `.scheme_<id>`, so knowing the active scheme
at injection time is directly useful for debugging whether a rule
matched. No theme-change listener, no dynamic re-injection on scheme
switch, no other diagnostics were added — that would be reaching past
what the ask needed.

## Implementation: getting the CSS into `dist/`

`tsc` only compiles `.ts` files; it won't copy `src/styles/*.css` into
`dist/` on its own. Added a small zero-dependency Node script,
`scripts/copy-styles.js`, using `fs.cpSync`/`fs.watch` rather than
pulling in a `cpx`/`copyfiles`-style package — `fs.cpSync` has been
stable since Node 16.7 and `engines.node` here pins `20.12.1`, so there's
no version risk, and the project has no existing copy-file dependency to
build on anyway. `pnpm run build` now runs it after `tsc`; `pnpm run dev`
runs it in `--watch` mode alongside the existing TypeScript watcher, so
editing a `.css` file behaves the same as editing a `.ts` file — no
manual rebuild step. (The watch mode intentionally skips `fs.watch`'s
`recursive` option, which is macOS/Windows-only in Node — `src/styles` is
flat, so a non-recursive watch is sufficient and stays portable to
Linux.)

`server.js` already serves the entire `dist/` directory statically, so
once copied, both files become fetchable at
`http://127.0.0.1:5500/styles/override.css` and `.../amend.css` — the
same pattern `main.js` itself already uses.

## Verification

Confirmed via `pnpm run build`:
- `dist/styles/override.css` and `dist/styles/amend.css` exist after the
  build, matching the (empty, header-comment-only) `src/styles/` source.
- No TypeScript errors from the `loadAndInjectStyle` helper or the
  `colorScheme`/`ui.allSchemes` additions to `GameEngine` in
  `src/types.d.ts`.

Confirmed live against `https://kittensgame.com/web/` via the
`browser-debug` skill's chrome-devtools MCP workflow (an ephemeral,
no-Tampermonkey browser, `main.js` injected the same way the real loader
does):
- First pass caught the CORS failure described above (`fetch()` blocked
  cross-origin) — `kg-automation-style-amend` never appeared in `<head>`,
  console showed the CORS error plus `[kg-automation] failed to
  load/inject style "kg-automation-style-amend": TypeError: Failed to
  fetch`.
- After switching to `<link rel="stylesheet">` injection: rebuilt,
  re-tested the same live tab —
  `document.getElementById("kg-automation-style-amend")` is now present
  in `<head>` (a `<link>`, loaded without any CORS error), and
  `document.getElementById("kg-automation-style-override")` is `null` as
  expected (`ENABLE_STYLE_OVERRIDE` defaults `false`).
- Unrelated confirmation, incidentally exercised by the same live save:
  the pre-existing catnip-famine auto-pause fired correctly
  (`[kg-automation] CRITICAL: Food Advisor projects catnip won't last the
  winter; pausing the game.`) — evidence the style-loading addition
  didn't disturb the rest of `init()`.

See also [2026-09-13--respool-race-on-injection.md](2026-09-13--respool-race-on-injection.md)
for the unrelated engine-readiness poll this reuses as its injection
timing anchor.
