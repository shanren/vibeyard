# Renderer dev harness (browser)

The renderer only talks to the outside world through `window.rcode`, the
preload bridge. This harness swaps that bridge for a fixture-backed stand-in so
the real UI runs in a plain browser — no Electron rebuild/relaunch per tweak.

```bash
npm run dev:web         # build once, then serve http://localhost:5173
npm run dev:web:watch   # rebuild renderer + reload the page on every change
```

Open <http://localhost:5173> in Chrome/Edge, use devtools as usual.

## What it does

- `dev/server.js` serves `dist/renderer` and injects `dev/mock-bridge.js`
  ahead of the bundle. Every asset URL carries its file mtime
  (`styles.css?v=…`, `index.js?v=…`, and per-`@import` versions inside
  `styles.css`), so a reload never serves stale CSS.
- `dev:web:watch` runs esbuild in watch mode and re-copies
  `src/renderer/styles/**`; the page long-polls `/__reload` and reloads itself.
  Append `?noreload` to disable that.
- `dev/mock-bridge.js` holds the fixtures: three projects, sessions of mixed
  providers and types, a git status per project, a small file tree, and one
  Claude profile. It is in-memory — reloading resets it.

## Screenshots without a human

`dev/shot.js` drives headless Chrome over CDP and writes a PNG:

```bash
node dev/shot.js out.png                       # 1400×900
DSF=2 node dev/shot.js out.png 1400 900        # 2x, for detail work
ACTIONS='[{"script":"document.querySelector(\"#btn-toggle-sidebar\").click()"}]' \
  node dev/shot.js out.png                     # click things first
PROBE='getComputedStyle(document.body).fontSize' node dev/shot.js out.png
```

It prints any `console.error`/uncaught exception from the page and exits
non-zero if there were any, so it doubles as a smoke test. Each run uses a
throwaway Chrome profile and closes the browser over CDP — a stray headless
instance would otherwise serve stale CSS to the next run.

## Limits

The harness is for **look and layout**. Anything that needs the main process
(real PTY output, git, hooks, cost parsing, file watching) is faked: terminals
stay blank, and actions that write to disk are no-ops. Verify those in Electron
(`npm start`).
