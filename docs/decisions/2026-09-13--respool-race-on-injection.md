# Uncaught TypeError reading 'get' of undefined, on script injection

**Status:** Accepted

## Symptom

Console showed, right when the loader injected `main.js`:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'get')
  at dist/main.js:34
```

Reproduced by loading https://kittensgame.com/web/ in a vanilla (no-Tampermonkey)
Chrome instance via chrome-devtools MCP, using `navigate_page`'s `initScript` to
replicate the loader's `<script src="http://127.0.0.1:5500/main.js">` injection
directly — no userscript manager needed to repro or debug this.

## Root cause

`dist/main.js:34` is `g.resPool.get(def.resKey)`. The existing top-level guard
(`if (!g) return;`) only checks that `window.gamePage` exists — it doesn't check
that the engine has finished constructing its subsystems.

`window.gamePage` gets assigned (`gamePage = game = new GamePage()`) before the
page's own module loader has fully wired up `resPool` and friends. Our loader
appends the `<script>` tag as soon as it runs, so on a slow/early load we can
execute while `g` is a truthy-but-incomplete `gamePage`, with `g.resPool` still
`undefined`. Confirmed via `evaluate_script`: immediately after the crash,
`window.gamePage.resPool` was present — it just wasn't there yet at the moment
our code ran.

This is a different failure from
[2026-09-13-getmeta-error-and-defensive-hardening.md](2026-09-13--getmeta-error-and-defensive-hardening.md)
(that was the game's own save-migration logging a handled, harmless
mismatch); this one is a genuine crash in our script caused by an init-order
race, not version drift.

## What we changed

`main.ts` no longer does its setup synchronously at script-load time. It now
polls (`setTimeout`, 100ms interval, 15s timeout) until `window.gamePage` (or
`window.game`) is truthy **and** has both `resPool` and a `tick` function,
then runs the real init logic. All the existing resKey-drift and try/catch
hardening is unchanged, just moved inside `init()`.

## Verification

Rebuilt (`pnpm run build`), reloaded in DevTools, confirmed via
`list_console_messages` that the TypeError no longer appears, and via
`evaluate_script` that `window.gamePage.tick` is the wrapped version and
`resPool.get('catnip')` resolves normally.
