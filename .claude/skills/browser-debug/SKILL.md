---
name: browser-debug
description: Reproduce or debug the Kittens Game userscript against the live kittensgame.com site using the chrome-devtools MCP, without needing Tampermonkey installed. Use when investigating a loading issue, a runtime error in main.ts, or verifying automation behavior (e.g. danger-zone crafting, catnip auto-pause) end-to-end.
---

Make sure the dev server is running first (`pnpm run dev`, or at least `pnpm run server` against a built `dist/`) so `http://127.0.0.1:5500/main.js` is reachable.

Use `navigate_page` (type `url`, `url: "https://kittensgame.com/web/"`) with this `initScript`, which replicates exactly what `loader.user.js` does:

```js
(() => {
  const SCRIPT_URL = "http://127.0.0.1:5500/main.js";
  const inject = () => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = SCRIPT_URL;
    script.onload = () => console.log("[Kittens Automation] Loader: Script loaded successfully");
    script.onerror = () => console.error(`[Kittens Automation] Loader: Failed to load script from ${SCRIPT_URL}`);
    document.body.appendChild(script);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
```

Then:

- `wait_for` with text like `["catnip", "Catnip Field"]` to confirm the game finished loading.
- `list_console_messages` / `get_console_message` (with `includeStackTraces: true`) to see errors and their exact source line — this is how the `resPool` race in `docs/decisions/2026-09-13--respool-race-on-injection.md` was found and confirmed fixed.
- `evaluate_script` to poke at live game state directly: read `window.gamePage`, force a resource's `.value`/`.perTickCached` to fabricate a scenario (danger zone, catnip famine, etc.) without needing a crafted save file, then call `window.gamePage.tick()` manually to drive the simulation one step at a time and check the result.

Gotchas:

- `perTickCached` and similar cached values are only recalculated by the game's own internal timer every N ticks, not on every `tick()` call — see `docs/decisions/2026-09-13--catnip-famine-autopause.md` for what that meant for testing and for the automation's reaction time.
- `localStorage` (and therefore the save) persists across `navigate_page` calls within the same browser context — state fabricated in one test carries into the next unless explicitly reset (e.g. `window.gamePage.isPaused = false`, or the in-game "Wipe" link).
- If the script doesn't load at all: verify the dev server (`curl http://127.0.0.1:5500/health`), confirm `dist/main.js` exists, and double check the URL has no `/dist/` prefix (the server serves `dist/` as its web root).

If the bug is confirmed and fixed, write a dated file in `docs/decisions/` (`YYYY-MM-DD--kebab-topic.md`, per the `sprout-standards:adr` skill) documenting what happened, the root cause, and the fix — follow the existing files there as the template.

## Test harness: reset to a fresh save with a running Catnip Field

Starting from a clean, known state with one resource already ticking up every
tick (instead of a frozen zero-building save, or leftover state from a prior
test session) makes it much faster to observe automation behavior live.
Verified against the live game (`Ver 1.6.1.6.r163`):

1. **Reset.** Clear the save and reload — simplest and most robust way to get
   a truly fresh game, independent of any internal reset/wipe method name:
   ```js
   localStorage.clear();
   ```
   Then `navigate_page` with `type: "reload"` (re-add the loader `initScript`
   from above if you want the automation script attached too), and `wait_for`
   `["catnip", "Catnip Field"]` again.

2. **Seed catnip and bypass the Field's unlock gate.** A fresh save starts at
   0 catnip with the Catnip Field button not yet rendered — it's gated by
   `unlockScheme: {name: "catnip", threshold: 56}` (confirmed live via
   `gamePage.bld.get('field')`), a "having *seen* 56 catnip" check separate
   from its actual 10-catnip purchase price. Sidestep both by fabricating
   state directly (matching the danger-zone testing approach above) rather
   than waiting on real gathering:
   ```js
   gamePage.resPool.get('catnip').value = 20; // comfortably above the 10-catnip cost
   gamePage.bld.get('field').unlocked = true; // bypass the "seen 56 catnip" gate
   gamePage.render(); // re-render so the now-unlocked button actually appears
   ```

3. **Buy it.** The button only appears in the DOM once unlocked — there's no
   simple top-level `gamePage`/`bld` API for "buy this building" (the real
   `build(model, opts)` method lives on the UI's button controller, tightly
   coupled to its rendered React model), so this one step is a real click
   rather than an `evaluate_script` call: `take_snapshot`, find the "Catnip
   Field" element (`description` starts with "Plant some catnip to grow in
   the village..."), then `click` it.

4. **Verify.** Confirm the purchase actually landed and production is
   running, not just that the click didn't error:
   ```js
   gamePage.bld.get('field').on   // -> 1
   gamePage.resPool.get('catnip').perTickCached   // -> positive
   ```
   Re-reading `catnip.value` a few seconds apart should show it climbing on
   its own — that's the "obvious work happening every tick" signal a debug
   session is usually seeded for.
