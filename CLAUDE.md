# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A terminal-centric IDE desktop app built on Electron that wraps CLI tool sessions. Users manage projects and sessions, each backed by a PTY running a CLI tool (currently Claude Code, with an abstraction layer for future providers like Copilot CLI and Gemini CLI), rendered via xterm.js.

## Build & Run

```bash
npm run build    # Compile all three targets (main, preload, renderer) + copy assets
npm start        # Build then launch Electron app (alias: npm run dev)
```

No hot reload — changes require rebuild + app restart.

### Packaging (Windows)

```bash
npm run dist                 # build + electron-builder (nsis installer + portable)
out/RCode Setup 0.0.1.exe    # installer (writes the Explorer context menu)
out/RCode 0.0.1.exe          # portable
```

- **The NSIS installer is unreliable on machines with third-party AV.** On this
  workstation (腾讯电脑管家 active, Windows Defender disabled) `RCode Setup 0.0.1.exe`
  segfaults in NSIS's extracted `System.dll` (0xc0000005, `APPCRASH` in the event log)
  on roughly 3 of 4 runs — identical binary, path and args sometimes succeed, so it is
  not build config: an assisted build, a oneClick build, and the same build copied to a
  no-space path all flake. It is not disk/RAM pressure either (48GB and 8.5GB free).
  Consequently `--win zip` and `--win portable` are the dependable Windows artifacts;
  ship those when the installer cannot be trusted.
- Output goes to `out/`, not `dist/` — `dist/` is the compiled app and is listed in
  `build.files`, so writing installers there would package them into themselves.
- Only `en-US` and `zh-CN` Electron locale paks are shipped (`build.electronLanguages`);
  the other 53 cost 47MB on disk and nothing else. Renderer source maps are excluded
  from the package (`!dist/**/*.map`) — they are 6MB of dev-only payload.
- `build/installer.nsh` adds "Open with RCode" to `Directory`, `Directory\Background`
  and `*` under HKCU (no elevation) and removes the keys on uninstall.
- If the Electron download fails (GitHub release assets time out), package against the
  already-installed runtime instead:
  `npx electron-builder --win nsis portable --publish never -c.electronDist=node_modules/electron/dist`.
- Builds are unsigned, so Windows SmartScreen will warn on first run.
For UI work there is a browser harness: `npm run dev:web:watch` serves the renderer at
`http://localhost:5173` with a fixture-backed `window.rcode` (`dev/`), so CSS/TS
tweaks reload without Electron. `node dev/shot.js out.png` screenshots it headlessly
and reports page errors. See `dev/README.md`.

Requires Node v24 (see `.nvmrc`). No lint tooling is configured.

Cross-platform: builds and runs on macOS, Linux, and Windows. Release artifacts (via electron-builder) include `.dmg`/`.zip` (mac), `.deb`/`.AppImage` (linux), and NSIS installer + portable `.exe` (win). CI covers all three platforms.

## Testing

```bash
npm test             # Run all tests once
npm run test:watch   # Watch mode (re-runs on file changes)
npm run test:coverage # Run with coverage report (terminal + HTML)
```

Uses **Vitest** with v8 coverage. Tests are co-located with source files as `*.test.ts`. Coverage HTML report outputs to `coverage/index.html`.

Test files are excluded from production builds via `exclude` in `tsconfig.main.json` and `tsconfig.renderer.json`.

Renderer modules (`session-activity.ts`, `session-context.ts`) expose `_resetForTesting()` to clear module-level state between tests. Main process tests mock `fs`, `child_process`, `node-pty`, and `os` via `vi.mock()`.

## Architecture

Three-process Electron architecture with strict context isolation:

- **Main process** (`src/main/`) — Node.js side: window creation, PTY lifecycle via `node-pty`, filesystem access, persistent state (`~/.rcode/state.json`). IPC handlers in `ipc-handlers.ts` dispatch to `pty-manager.ts` and `store.ts`. CLI tool behavior is abstracted via the provider system (`src/main/providers/`).
- **Preload** (`src/preload/preload.ts`) — Secure bridge exposing `window.rcode` API via `contextBridge` with namespaces: `pty`, `session`, `store`, `profiles`, `fs`, `provider`, `menu`.
- **Renderer** (`src/renderer/`) — Vanilla TypeScript DOM UI (no framework). `AppState` singleton in `state.ts` uses an event emitter pattern; components in `components/` subscribe to state changes.

### Data Flow

Renderer → IPC invoke/send → Main process → PTY/filesystem → IPC send back → Renderer updates xterm terminal.

### Build Targets

Each process has its own `tsconfig.*.json`. Main and preload compile via `tsc` (CommonJS). Renderer bundles via esbuild (IIFE format, browser platform, with sourcemaps).

### CLI Provider System

CLI-specific behavior is encapsulated behind a `CliProvider` interface (`src/main/providers/provider.ts`). Each provider handles binary resolution, env vars, args, hooks, config reading, and cleanup. Providers are registered in a registry (`src/main/providers/registry.ts`) at app startup.

- **Provider per-session**: Each `SessionRecord` has a `providerId` (defaults to `'claude'`). A project can contain sessions from multiple providers.
- **Capabilities pattern**: Providers declare what they support via `CliProviderCapabilities`. UI can conditionally enable features per-session.
- **Current providers**: `ClaudeProvider` (`src/main/providers/claude-provider.ts`) — extracts all Claude-specific logic from `pty-manager.ts`, `prerequisites.ts`, `claude-cli.ts`, and `hook-status.ts`.
- **Profiles** (multi-license): a `Profile` (`{ id, name, providerId, configDir, managed }`, top-level `state.profiles`) backs a CLI session with an isolated config directory so a user can run separate logins/licenses (work vs personal). `buildEnv(sessionId, baseEnv, opts?: { configDir? })` injects it — Claude sets `CLAUDE_CONFIG_DIR` (which relocates *everything* Claude reads/writes: credentials, `settings.json`, hooks, status line, transcripts, agents); other providers accept the param but don't use it yet. The effective profile (explicit choice > project `defaultProfileId` > `preferences.defaultProfileId`, provider-matched) is resolved **once at session creation** via `resolveProfile` (`src/renderer/state/specialized-sessions.ts`) and **pinned** onto `SessionRecord.profileId` — it is NOT re-derived at spawn, so changing a default later never redirects an existing session's resume. At spawn, `split-layout.ts` looks up the config dir from the sticky `session.profileId` only (provider-checked) and threads the `configDir` string through `createTerminalPane` → `pty.create` → `pty:create` → `spawnPty` → `buildEnv`. `profileId` is persisted on `SessionRecord`/`ArchivedSession` (and on `TranscriptDescriptor`/`DeepSearchResult` so global-search resume reopens under the right dir); `removeProfile` clears it from sessions, projects, history, and prefs. Because `CLAUDE_CONFIG_DIR` relocates `settings.json`, `spawnPty` installs RCode's hooks + status line into the profile dir on each Claude spawn via the config-dir-parameterized `installHooksOnly(configDir)` / `installStatusLine(configDir)` in `claude-cli.ts` (the status-line *script* stays global in `~/.rcode/run/`; only per-dir `settings.json` differs). `getTranscriptPath(cliSessionId, projectPath, configDir?)` and `discoverTranscripts()` are profile-aware — the latter unions `~/.claude/projects` with every claude profile's `<configDir>/projects` (read from `loadState()`). Managed profile dirs live at `~/.rcode/profiles/<id>/` (auto-created), with an optional custom path; provisioning is `src/main/profiles.ts` exposed via the `profiles:provision` IPC. Profile management UI is the Preferences "Profiles" section; selection is in the New Session dialog and the sidebar project "Project Settings…" menu. The `getConfig` reader and the config-watcher stay on the default `~/.claude`. macOS keychain caveat + guardrail: on macOS Claude stores credentials in the system Keychain (not `<configDir>/.credentials.json`) under a per-config-dir service name `Claude Code-credentials-<first 8 hex of sha256(configDir)>` (verified on 2.1.159), so profiles isolate logins only on Claude builds new enough to namespace that entry. Older builds (≤2.1.19, anthropics/claude-code#20553) reuse one shared `Claude Code-credentials` entry, bleeding logins across profiles. `src/main/claude-keychain.ts` (`getKeychainIsolationStatus`, exposed via IPC `profiles:keychainStatus` → `window.rcode.profiles.keychainStatus()`) guards this: empirically `supported` if any known profile already has a namespaced Keychain entry, else version-gated (`≤2.1.19` ⇒ `unsupported`; newer-but-unconfirmed ⇒ `unknown`, allowed — never false-blocked); non-macOS is always `supported` (isolation is file-based). On `unsupported`, `spawnPty` skips the profile session and writes an in-pane message (it does not throw — the renderer fires `pty.create` un-awaited), and the Preferences "Profiles" section blocks profile creation and shows a warning banner. The shared semver helpers (`parseSemver`, `semverGte`) live in `claude-hook-versions.ts`.

### Key Components

- `terminal-pane.ts` — xterm.js wrapper per session, handles PTY data streaming and WebGL rendering with software fallback. Wheel scrolling inside full-screen CLIs goes through `attachAlternateScroll` (`terminal-utils.ts`): on the alternate screen xterm keeps no scrollback, and xterm 6 dropped its `alternateScroll` option, so the wheel is translated into **PageUp/PageDown** (not arrow keys — those move the cursor/prompt in TUIs like pi, which reads as "cannot scroll"). Deltas accumulate first so a two-finger touchpad scroll (≈6px per event) advances at the same rate as a mouse notch, and the app's mouse-reporting mode wins over translation when it is enabled. pi is launched with `--tui-mode regular` (see `pi-provider.ts`), which keeps it out of the alternate buffer so the terminal keeps real scrollback and a draggable scrollbar — the same technique orca uses for Codex (`--no-alt-screen`). Intercepting the alt-screen escape sequences instead was tried and rejected: a repainting TUI then yanks the viewport back to the bottom on every frame and wheel scrolling stops working. Independently, `.xterm-viewport` is forced to `overflow: hidden; pointer-events: none` — it is a vestigial div in xterm 6 whose inherited `overflow-y: scroll` painted a second, permanently immovable scrollbar over the right edge.
- `state.ts` — Reactive AppState singleton; debounced persistence (300ms) to `~/.rcode/state.json`
- `split-layout.ts` — Manages tab mode (single terminal) vs split mode (side-by-side panes); `appState.toggleSplit()` switches between them
- `session-activity.ts` — Tracks working/waiting/idle status with debounced transitions
- `components/active-sessions-panel.ts` — Global, cross-project **Active Sessions** list rendered into `#sidebar-active-sessions` (a persistent sidebar block). `selectActiveSessions(projects, statusOf, activeStatuses)` is a DOM-free selector that collects open CLI sessions (`isCliSession`) across `appState.projects` whose live `getStatus()` is in the configured set, ordered by `STATUS_PRIORITY` (from `project-status.ts`, now exported) then project name. `initActiveSessions()` subscribes to `session-activity.onChange` + the relevant `appState` events and re-renders; rows route clicks through `setActiveProject` + `setActiveSession`. Visibility is gated by `preferences.sidebarViews.activeSessions` **and** requires more than one project (with a single project the rows just duplicate its own tab bar); the "active" status set comes from `preferences.activeSessionStatuses` (`{ working, waiting, input, completed }`, default working/input/completed via `resolveActiveStatuses`). Both preferences are edited in the Preferences → Appearance section. Styles live in `styles/sidebar.css`; status dots reuse the existing `.project-status.<status>` classes.
- **File tree context menu** — `components/file-tree-menu.ts` builds the right-click menu as a DOM-free spec (`fileTreeMenu(entry)` → ordered `FileTreeMenuEntry[]`) plus `menuEntriesFor(entry, handlers)` which binds each id to a callback; `components/file-entry-menu.ts` supplies the handlers and the `showFileEntryMenu(x, y, ctx, entry)` entry point, so the file tree and the Explorer's search results share one implementation (the menu acts on an absolute `entry.path`; `absolutePathFrom` (`src/shared/platform.ts`) turns a project-relative search result into one, and `ctx.onMutated` lets the search re-run its query after a rename/delete so no dead row is left behind). VS Code grouping: view (`Open` for files) · `Reveal in File Explorer` / `Copy Path` / `Copy Relative Path` · `Rename…` · `Delete` (the only `danger` row) · `Properties`; folders swap `Open` for `New File…` / `New Folder…`. `showContextMenu` (`context-menu.ts`) accepts `MenuEntry = MenuOption | MenuSeparator` so a rule renders as `.board-context-menu-separator` instead of a clickable row. New inputs come from `showModal(...)` prompts and are validated in `src/main/fs-ops.ts` (`validateEntryName` — no separators/`..`/reserved Windows names/trailing dot, 255-byte cap; `resolveRenameTarget` — sibling-only rename), which is also where the "rename never moves an entry to another folder and never overwrites" rule lives. New IPC: `fs:revealItem` (`shell.showItemInFolder`, selects the entry in Explorer/Finder), `fs:createDirectory`, `fs:renamePath` — all behind `isWithinKnownProject`.
- **Tab context menu → path actions** — a file reader / diff tab's menu carries a path group (`tab-bar/file-path-menu.ts`: `tabFilePathMenuItems()` is a DOM-free, translated spec, `runTabFilePathAction(id, path)` runs it, and `tabFilePath(session, projectPath)` derives the tab's absolute path — a file reader already stores one, a diff tab's `diffFilePath` is repo-relative and is anchored to the session's `worktreePath` or the project root) holding `Open File` (`fs:openPath`, the OS default app), `Reveal in File Explorer` (`fs:revealItem`) and `Copy File Path` — the same view-then-clipboard order the file tree uses. The group is absent (not disabled) for CLI session tabs, which have no path.
- `components/git-panel.ts` — Git changes for the **active project**, rendered inside its sidebar card as a `git` panel-toggle tab (a third `ProjectPanel` alongside `history`/`files` in `sidebar.ts`), not a standalone bottom panel. The "Git" tab carries a `.project-action-badge` count of total changes (badge + click-to-open); `Cmd/Ctrl+Shift+G` (`toggleGitPanel`, exported from `sidebar.ts`) toggles it. `mountGitPanel(project, container)` reparents a single persistent node into `.project-panel-git` so file rows/scroll survive sidebar re-renders; `closeGitPanel()` detaches it. The shared `loadFiles`/worktree-selector logic is unchanged; `sidebarViews.gitPanel` now gates the tab button. There is no `#git-panel` node in `index.html`.
- **UI shell** — one left column only: `#sidebar` (project management: list, active project card, per-project panels). `#app-body` = sidebar (+ resize handle) · `#main-area` (tab bar 35px + terminal) · `#explorer-panel` (right, toggled). `#title-bar` (35px, Windows only) sits above, and the branch chip lives in the tab bar (`#git-status`), not a status bar. `#sidebar.collapsed` collapses the column to a 58px icon rail, not to nothing.
- **Design tokens** — `styles/base.css` is the single source of truth, in three layers: `--vscode-*` (1:1 with VS Code color ids, dark = Dark Modern, light = Light Modern, both verified against `extensions/theme-defaults/themes/*_modern.json`), `--app-*` semantics (`surface-canvas/panel/raised`, `text`, `line`, `accent`, `status-*`, plus typography `--app-font-*`, geometry `--app-activitybar-width`/`--app-statusbar-height`/`--app-tab-height`/`--app-row-height`/`--app-radius-*`, and interaction `--app-duration-color`), and the legacy `--bg-*`/`--text-*`/`--accent*`/`--border*`/`--radius-*` names kept as aliases of layer 2 so untouched component CSS re-themes automatically. Fonts are **system stacks** (no bundled woff2). Rules: one blue accent (`#0078D4` dark / `#005FB8` light), three surfaces, 1px separators instead of shadows, near-square corners (0/2/6), 13px UI type. The spec is `specs/2026-11-18-vscode-design-tokens.md`. `app:setTitleBarOverlay` re-tints the Windows overlay on theme change. **Visual** changes only: the app deliberately keeps its own layout (project management on the left) rather than copying VS Code's activity-bar shell.
- `terminal-context-menu.ts` — Right-click context menu for terminal panes (Copy, Paste, Select All). DOM-based using shared `tab-context-menu` CSS classes. `showTerminalContextMenu()` / `hideTerminalContextMenu()` exports; integrated via `contextmenu` listener on `xtermWrap` in `terminal-pane.ts`. Every action handler calls `terminal.focus()` after closing the menu so keyboard input resumes immediately (clicking a menu item otherwise leaves focus on the document, e.g. typing after Paste would be dropped). Note: the flex layout (`display:flex; justify-content:space-between; align-items:center`) lives on the shared `.tab-context-menu-item` selector in `styles/tabs.css`, so it affects every menu reusing that class — existing single-label items are unaffected since `space-between` has nothing to push.
- **i18n** — lightweight in-house internationalization (no third-party library). `src/renderer/i18n.ts` exports `t(key)` (dot-path lookup with English fallback + `console.warn` for missing keys), `getLocale()`, `setLocale(locale)` (unknown locales rejected), and `onLocaleChange(cb)` returning an unsubscribe handle. Catalogs at `src/renderer/locales/{en,zh-CN}.json` are statically imported by esbuild (zero runtime fetches). `src/renderer/system-locale.ts` resolves `navigator.language` (`/^zh/i` → `zh-CN`, else `en`). The persisted choice lives at `Preferences.locale` (`'en' | 'zh-CN'`, defined inline in `src/shared/types.ts` rather than imported from `i18n.ts` to avoid a main↔renderer import cycle). Persistence flows through the existing `setPreference('locale', loc)` → 300ms-debounced main-process save. `initI18n()` in `src/renderer/index.ts` runs right after `appState.load()`; on first launch (no saved `locale`) it persists the OS-resolved choice. The `preferences-changed` listener in `index.ts` calls `i18n.setLocale(newLocale)` and `rerenderOpenPreferencesModal()` (exported from `src/renderer/components/preferences-modal.ts`) so the open Preferences modal re-translates in place. The Language switcher itself lives at the top of Preferences → General as a `createCustomSelect` row backed by `appState.setLocale` (live, no Confirm required). Translated sections in v1: Preferences sidebar labels + General + Appearance. Out-of-modal strings (sidebar buttons, tab titles) stay English until a follow-up PR.
- `components/code-editor.ts` + `components/code-editor-search.ts` — CodeMirror 6 wrapper used by the file reader's raw mode (plain-text DOM rows replaced). `createFileEditor(container, content, filePath, onChange?)` builds an **editable** `EditorView` (line numbers, active-line highlight, `EditorView.lineWrapping`, caret + active-line themed via CSS vars) with syntax highlighting from `detectLanguage(path)` (extension/basename → `@codemirror/lang-*` or `StreamLanguage` legacy modes; pure/unit-tested) and a `HighlightStyle` whose colors are `--syntax-*` CSS vars themed per `[data-theme]`. `FileEditorHandle` exposes `setContent` (full-doc replace preserving the view; dispatches with a suppression flag so programmatic syncs never fire `onChange`) and `scrollToLine` (selects + centers the line). The editor is editable: the file reader tracks unsaved edits via the `onChange` callback (only `docChanged` updates), sets `instance.dirty`, and enables a Save button (`saveFileReader`, Ctrl+S `save-file` shortcut) that writes through the `fs:writeFile` IPC (main-side scoped to known projects via `isWithinKnownProject`). `setContent` re-syncs only while clean — dirty edits always win over file-watcher reloads. `file-reader.ts` recreates the editor on open/toggle, destroys it on pane close/unload/image&rendered modes; `file-prompt.ts` reads line numbers from the CM view state selection in raw mode. Search (Cmd+F) switches to `CodeMirrorSearchBackend` (`code-editor-search.ts`, implements the `SearchBackend` interface) for raw-mode readers: regex/case-sensitive match collection over the doc text, all-match + current-match decorations via a `StateField`, selection + `scrollIntoView` navigation; rendered markdown / images / diff viewers keep the DOM-based `DomSearchBackend`.
- `components/title-bar.ts` + `styles/title-bar.css` — **Windows-only** custom in-app title bar. `main.ts` sets `titleBarStyle: 'hidden'` + `titleBarOverlay` (dark `#101116` tint, 36px) on `isWin`, so Windows shows no native title/menu bar; `createAppMenu` returns early on `isWin`, and the renderer builds a dark 36px nav bar (`#title-bar` above the `#app-body` row, `-webkit-app-region: drag`) with the brand + File/Edit/View dropdowns, reusing the shared `.tab-context-menu` classes + `tab-bar/menu.ts` single-menu tracker (one open menu, click-outside/Escape dismissal). Menus are built on click so `preferences.debugMode` is read live. File uses existing `promptNewProject`/`quickNewSession`/`closeSessionWithConfirm` + new `menu.quitApp`; Edit dispatches `window.rcode.menu.runEditAction(action)` (new `menu:edit-action` IPC → `focusedContents()[action]()`, same behavior as the old native Windows Edit menu) after restoring focus to the previously focused element (queueMicrotask) so webContents edit commands target the terminal/input, not the menu button; View uses `appState.toggleSplit`/`toggleInspector`, plus debug items (`menu:toggleDevTools`, `menu:reloadMainWindow`) when debug mode is on. macOS/Linux keep the native title bar + system menu bar. All shortcuts still work on Windows because native menu accelerators are disabled (`registerAccelerator: false`).

### Platform Checks

Platform detection is centralized in `src/main/platform.ts`. Import
`isWin`/`isMac`/`isLinux` (and derived constants `pathSep`, `whichCmd`,
`pythonBin`) from there — do **not** inline `process.platform === 'win32'`
or redefine `isWin`/`isMac` locally in source or test files. The
three-way managed-path branch in `claude-cli.ts` is the one intentional
exception.

### Cross-platform paths in tests

When asserting on a path that the implementation produced via `path.join`,
`path.resolve`, or `path.normalize`, **never hardcode forward-slash literals**
like `'/repo/foo.ts'` in the assertion — they pass on macOS/Linux but fail
on `windows-latest` because Node yields `\repo\foo.ts` there. Build the
expected value with the same primitive the implementation uses:

```ts
import * as path from 'path';
// good — matches whatever path.join produces on the running platform
expect(mockRm).toHaveBeenCalledWith(path.join('/repo', 'foo.ts'), opts);

// bad — hidden Windows-only failure
expect(mockRm).toHaveBeenCalledWith('/repo/foo.ts', opts);
```

This applies to any assertion on arguments to `fs.*`, `child_process` calls,
or anything else that flows a joined path through. CI runs on all three
platforms, so a forward-slash literal will eventually fail on Windows.

### Startup performance

Startup is a hard requirement, not a nice-to-have: the window appears at ~250ms
(main process) and content must follow within a few hundred ms. Three costs were
measured and removed; the pattern for all of them is *detect once, then never pay
again*, because the slow paths are machine-specific.

- **GPU compositing** (`src/main/gpu-prefs.ts`, `~/.rcode/gpu.json`) — on some
  machines Chromium's GPU process needs seconds for its first composited frame
  (measured 3.5–4.9s to first paint vs **0.2s** with software compositing), which
  reads as a black screen after launch. It cannot be detected before the first
  paint, so `app:startupReport` measures window-shown → first-content; above
  `1500ms` the verdict is persisted and `app.disableHardwareAcceleration()` runs at
  module scope on later launches (before `whenReady`). `shouldUseSoftwareCompositing`
  re-tests after 30 days so one slow launch (AV scan, cold file cache) cannot
  permanently disable hardware acceleration. Kept out of `state.json` on purpose —
  the renderer saves that file wholesale and would clobber a main-only flag.
- **Terminal WebGL renderer** (`scheduleWebglUpgrade` in `terminal-utils.ts`) —
  creating the GPU context blocked the main thread for ~6s on software-rasterised
  machines. Panes now paint with the DOM renderer immediately and upgrade later;
  the first terminal on a machine triggers one delayed probe whose verdict is
  persisted as `Preferences.terminalWebgl` (surfaced as Preferences → Appearance →
  *Terminal renderer*: Auto / GPU / CPU).
- **Deferred main-process work** (`runDeferredStartupWork`) — `validatePrerequisites()`
  is a synchronous `where`/`which` spawn (~60ms each); it is memoised per provider
  per pass and the hook-install loop yields with `setImmediate` between providers so
  renderer IPC is never starved. `Notification.requestPermission()` (a modal OS
  prompt, measured 1.8s) moved into `showNotification`, i.e. the first banner that
  is actually about to be shown.
- **Window backdrop** — `BrowserWindow` gets `backgroundColor` from the persisted
  theme (`#1f1f1f` dark / `#ffffff` light) and is shown immediately, so any gap
  before the first paint looks like the app rather than a black hole.
- **Memory** — a one-window Electron app costs ~410MB across four processes
  (browser ~120, GPU ~121, renderer ~117, network utility ~51). Our own JS is not
  the weight: the main process heap is 8MB and the renderer's is 9.5MB, so
  lazy-loading renderer code buys nothing measurable. The one real lever is
  process topology: when `softwareCompositing` is on, `in-process-gpu` +
  `disable-gpu` + `disable-software-rasterizer` fold the (software-only) GPU
  process into the browser process for **−47MB** (~361MB) with no change to first
  paint. `--in-process-gpu` without `--disable-gpu` is a trap: it pulls SwiftShader
  into the browser process and balloons it past 1GB. `enable-low-end-device-mode`
  measured no effect at all.

`src/main/startup-log.ts` appends one block per launch to `~/.rcode/startup.log`
(main milestones, renderer marks, first-paint, the derived **black screen** duration,
compositing mode, GPU status; trimmed to the last 32KB). `RCODE_TIMING=1` additionally
streams the marks to the console and auto-exits after 12s. When a launch "feels slow",
read that file before guessing.

### File Search Enumeration

The Explorer's file search (`fs:searchFiles`), quick-open (`fs:listFiles`), and
`fs:topFilesByTokens` all share `enumerateProjectFiles` in
`src/main/file-enumeration.ts` — one async, cached (2s TTL) enumeration per project
root. It walks the tree but delegates **every repo root it finds** to
`git ls-files -z --cached --others --exclude-standard` (that repo's own ignore
rules win; the walk prunes build-output dirs like `node_modules`/`target`/`bin`/
`obj`/`dist`). Two details are load-bearing: the walk must keep descending *inside*
a git root, because a project's real source frequently lives in sub-projects that
are separate repos **and are gitignored by the outer one** — the old single
outer-repo `git ls-files` returned 136 of ~7.7k files for exactly that layout — and
git must run with `-z`, since newline output applies `core.quotepath` escaping that
mangles every non-ASCII path into an unmatchable, unopenable `"\345\244\226..."`
blob. Results are deduped (a tracked sub-project can be listed by both repos) and
capped (`ENUMERATE_MAX_FILES`). Keeping it async matters: it runs on the main
process that also pumps PTY data.

### Full-text Search (Explorer "Content" tab)

The Explorer search box has two modes, persisted in `Preferences.explorerSearchMode`
(`'path' | 'content'`, absent ⇒ `'path'`): **path** (the `fs:searchFiles` enumeration
above) and **content** (`fs:searchText` → `src/main/text-search.ts`, results rendered
grouped per file with line numbers, click opens the file at that line via
`addFileReaderSession(projectId, path, line)`). `CmdOrCtrl+Shift+E`
(`explorer-search-text`) opens the panel in content mode and focuses the input;
`CmdOrCtrl+Shift+F` stays `session-search`.

The engine shells out to `git grep -z -n -I -i -F --untracked --no-color
--max-count=<perFile> -- -e <query>` **once per repo root** (from `findRepoRoots`,
which shares the enumeration walk) and falls back to a bounded Node scan
(`enumerateProjectFiles` + `buildRcodeIgnoreMatcher`, 32-way concurrency, `stat`
size gate, NUL sniff, `.rcodeignore`) only where git cannot answer: a non-repo
project, or a root whose `git grep` fails to spawn. `-z` matters for the same
`core.quotepath` reason as above, and the parser reads the *next* path from the tail
of the previous text chunk (`<path>\0<line>\0<text>\n<nextPath>`), so no path with
spaces, CJK or a leading `-` can be corrupted. `git grep` exit 1 means "no matches"
and must never trigger the walk fallback — otherwise every zero-result search would
cost a full scan (measured 2.8s on this workspace vs ~0.4s for the git path).

Caps live in `text-search.ts` (`TEXT_SEARCH_MAX_MATCHES` 500, `_PER_FILE` 20,
`_FILES` 200, `_TIMEOUT_MS` 5000, `_MAX_FILE_BYTES` 1MB, `_MAX_LINE_CHARS` 400) and
mirror VS Code's result-list psychology: bounded, sorted, with a truncation footnote.
Nothing is pre-warmed — no spawn, no walk, no cache fill until a query arrives — and
the whole path is async so the main process keeps pumping PTY data. Measured startup
is unchanged by the feature (first-content 200–252ms and black-screen 190–244ms
across 9 launches, against 228–260ms / 203–247ms before; the ±25ms run-to-run drift
exceeds any difference).

Both modes' rows — a path-mode file row, a content-mode file header, and every match
line beneath it — carry the file tree's right-click menu (see **File tree context
menu**); a match line's menu targets its file, not the line. Clicking a row still
opens the reader at that file (and, in content mode, at the line).

### File Watching

Live filesystem updates for the file tree, file reader, and diff viewer are backed by a single **chokidar** watcher in `src/main/file-watcher.ts` (chokidar is ESM-only but `require`-able under Electron's Node ≥22.12). It watches **directories non-recursively** (`depth: 0`), ref-counted per dir via `watchDir(dir)` / `unwatchDir(dir)` (IPC `fs:watchDir` / `fs:unwatchDir`). Watching the parent dir — not the file inode — is deliberate: it survives atomic save/replace (write-temp + rename), which silently kills an inode watch. Changes are coalesced and debounced (150ms) into a single batched `fs:changed` IPC carrying `FsChange[]` (`{ path, dir, type }`, type ∈ add/addDir/change/unlink/unlinkDir; see `src/shared/types.ts`). The renderer subscribes via `window.rcode.fs.onFsChange`. `stopAllFileWatchers()` is wired into `main.ts` teardown (window `closed` + `before-quit`).

Scope is **lazy**: only expanded tree folders and the parent dirs of open reader/viewer files are watched (cheap on huge repos). The file tree (`file-tree.ts`) reacts by **incremental reconciliation** (`reconcileChildren`), not full rebuilds: rows are keyed by `data-entry-path`, vanished entries are removed (unwatching their subtree via `unwatchSubtree`), new entries are inserted at the sorted position, and unchanged rows — with their expanded subtrees, scroll, and selection — are left untouched. Change bursts are flushed once per `requestAnimationFrame`. Cross-platform path helpers (`dirname`, `isPathUnder`) live in `src/shared/platform.ts`. Note: this is separate from `git-watcher.ts`, which watches the whole working tree and emits `git:changed` for the git-status UI. To avoid the macOS FSEvents teardown storm on project switch (#142), `git-watcher.ts` uses a **single recursive `fs.watch`** on macOS + Windows (`watchRecursiveWorkingTree`, one OS handle, events filtered via `hasIgnoredSegment`) and keeps the **capped per-dir BFS** (`walkAndWatch`, `MAX_WATCHES`) on Linux, where recursive `fs.watch` is unsupported and previously leaked inotify watches (#139). Fine-grained `.git` watches and the 60s git-status poll are unchanged.

### State Persistence

App state (projects, sessions, layout) persists to `~/.rcode/state.json` via the main process store. Saves are debounced and flushed on quit. Sessions track `cliSessionId` for CLI session resume capability.

## UI Development

When working on renderer/UI code, the `/ui-dev` skill is automatically invoked. It documents all custom components (dropdowns, modals, alerts, badges), CSS theming variables, styling conventions, and component architecture patterns. Always follow it — never use native `<select>`, never hardcode colors, always reuse existing components.

## Planning

When entering plan mode for a new feature, consider whether the feature (or aspects of it) should be exposed as a user-configurable option in Preferences. If it's relevant, ask the user whether they'd like it added as a config in the prefs before finalizing the plan.

## Post-Implementation

After completing an implementation task, always:

1. Run `/code-review` to review changed code for correctness bugs and reuse/quality/efficiency cleanups. Run it automatically — do not ask the user for permission first.
2. Run `/simplify` to apply reuse, simplification, efficiency, and altitude cleanups to the changed code. Run it automatically — do not ask the user for permission first.
3. Add or update tests as needed to cover the changes.

## Git Workflow

Always use the `/commit` command when committing changes to this project. Do not create commits manually.

Never commit, push, or create pull requests unless the user explicitly asks for it.

`CHANGELOG.md` is auto-generated by the release action (via the `/release` / release-notes flow). Do not edit it as part of coding tasks — changes there will be overwritten at release time.

## Maintaining This File

When your changes affect the architecture, build process, key components, data flow, or any other information documented above, update this CLAUDE.md to reflect the new state. This includes adding/removing/renaming files, changing IPC namespaces, modifying the build pipeline, or introducing new patterns. Keep this file accurate so future sessions start with correct context.
