# Vibeyard 0.0.1 减面（P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Vibeyard 砍到「项目 + 会话 + 终端 + 文件 + git」的核心，删掉概览、团队、浏览器、更新等 12 个功能域，让代码库真的变小，为 P2 提速腾出空间。

**Architecture:** 按「叶子先行」顺序一个域一个任务地删：先加 `state.json` 加载白名单兜住所有后续删除，再从没有下游依赖的域（更新、chrome 导入、死代码）删起，逐步推进到纠缠最深的 `state.ts` 宿主。每个任务独立可验收、可回滚。

**Tech Stack:** Electron 33 + TypeScript（主进程/preload 走 tsc，渲染层走 esbuild）+ Vitest。

**Spec:** `specs/2026-11-18-fast-startup-reset-design.md`

**本计划范围：** 只覆盖设计文档的 **P1 减面**。P2（启动路径重构 + PTY 恢复延后 + minify）与 P3（版本归零、发布 workflow、README）在 P1 落地后另写计划——它们的任务依赖 P1 完成后的实际代码形态。

## Global Constraints

- `state.json` 的 `version` 字段**保持 `1`**（`state.ts:182` 只接受 `1`）。
- **不新增任何依赖**；本计划只做删除，`package.json` 的 `version` 字段本阶段不动（留 P3）。
- 跨平台路径断言一律用 `path.join` 构造期望值，禁止硬编码正斜杠字面量。
- 不动 provider 的注册、二进制解析、hook 安装、env 注入、config 读取——这些是踩过坑的部分。
- 每个任务结束必须 `npm run build` 通过 + `npm test` 全绿（基线 140 文件 / 1851 通过）。
- 提交一律走项目的 `/commit` 命令，不手写 `git commit`。一任务一提交。
- 每删一个域，同步删除其测试文件；不留空跑或 `.skip`。

## Review Focus

以下五类是设计文档隐含、但任何单个任务的测试都不会覆盖的失效模式，每个任务的验收都要覆盖自己那一行：

1. **旧 `state.json` 含已删会话类型**（本机就是极端案例：唯一项目的 4 个会话全是待删类型）→ 启动不崩、不白屏、不复活。
2. **`activeSessionId` / `layout.splitPanes` 指向已删会话** → 不指向不存在的 pane。
3. **已删功能的残留入口**（菜单项、快捷键、i18n key、preference 开关、preload 命名空间）→ 点了不该报错或静默无效。
4. **`debugMode` 打开时 View 菜单**：debug panel 删了，但 DevTools / reload 项仍要工作。
5. **旧 state 的已删字段**（`team`、`board`、`overviewLayout`、`githubLastSeen`、`chromeImport`、`readiness*`）→ 保存时不再写回。

---

### Task 1: `state.json` 加载白名单与悬空引用清理

先兜住所有后续删除——否则第一个被删的会话类型就会让旧 state 启动即崩。

**Files:**
- Modify: `src/renderer/state/persistence.ts`（`hydrateLoadedState`）
- Test: `src/renderer/state/persistence.test.ts`

**Interfaces:**
- Produces: `DROPPED_SESSION_TYPES: ReadonlySet<string>`（导出，供后续任务在删除会话类型时同步维护）、`hydrateLoadedState(state, defaultPreferences)` 的新语义：过滤已删类型会话 + 清理悬空引用 + `swarm` 降级为 `tabs`。

- [ ] **Step 1: 写失败测试**

在 `persistence.test.ts` 追加 4 个用例（用现有测试的 state 构造风格）：被丢弃类型的会话从 `project.sessions` 移除；无 `type` 的 CLI 会话与 `file-reader`/`diff-viewer`/`mcp-inspector` 保留；`activeSessionId` 指向被丢弃会话时置 `null`；`layout.splitPanes` 里被丢弃的 id 被剔除，且 `layout.mode === 'swarm'` 降级为 `'tabs'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/renderer/state/persistence.test.ts`
Expected: FAIL —— 4 个新用例失败（会话未被过滤）。

- [ ] **Step 3: 实现**

`persistence.ts` 顶部导出 `DROPPED_SESSION_TYPES`（本任务先放全部 5 个：`browser-tab`、`project-tab`、`kanban`、`team`、`remote-terminal`——后续任务删除对应域时从这里删条目，保持一致）。`hydrateLoadedState` 每个 project 内：过滤 `sessions`；重建 `Set` 后清理 `activeSessionId` 与 `layout.splitPanes`；`layout.mode === 'swarm'` 时置 `'tabs'` 并清空 `splitPanes` 之外的 swarm 残留。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/renderer/state/persistence.test.ts`
Expected: PASS

- [ ] **Step 5: 全量验证 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 2: 删除更新域（auto-updater / 更新横幅 / whats-new / star-prompt）

**Files:**
- Delete: `src/main/auto-updater.ts`、`src/main/auto-updater.test.ts`、`src/renderer/components/update-banner.ts`、`src/renderer/components/whats-new-dialog.ts`、`src/renderer/components/whats-new-dialog.test.ts`、`src/renderer/components/star-prompt-dialog.ts`、`src/renderer/components/star-prompt-dialog.test.ts`
- Modify: `src/main/main.ts`（`initAutoUpdater` 的 import 与调用）、`src/main/ipc-handlers.ts:875-876` 与 import、`src/preload/preload.ts:91` 与 `:287-293`（`update` 命名空间）、`src/renderer/index.ts`（`initUpdateBanner` / `checkWhatsNew` / `checkStarPrompt`）、`src/renderer/components/preferences/about-section.ts`（若有「检查更新」按钮）、`package.json`（移除 `electron-updater` 依赖）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "auto-updater\|update-banner\|whats-new\|star-prompt\|electron-updater\|'update:" src/ package.json`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 3: 删除 Chrome 导入域

**Files:**
- Delete: `src/main/chrome-import/**`、`src/renderer/components/chrome-import-modal.ts`、`src/renderer/styles/chrome-import.css`
- Modify: `src/main/ipc-handlers.ts`（`chromeImport:*` handler 与 import）、`src/preload/preload.ts`（`chromeImport` 命名空间）、`src/shared/types.ts`（`ChromeProfile`/`ChromeImportSummary`/`ChromeImportProgress`/`ChromeImportOptions`/`ChromeImportResult`、`Preferences.chromeImport`）、打开导入弹窗的 preference 行（grep `chrome-import-modal` 定位）、`package.json`（移除 `better-sqlite3`、`@types/better-sqlite3`、`build.asarUnpack` 中对应项）、`src/renderer/index.html`（css link）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "chrome-import\|chromeImport\|better-sqlite3" src/ package.json`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 4: 删除 Discussions 死代码

**Files:**
- Delete: `src/renderer/discussions-badge.ts`、`src/renderer/discussions-badge.test.ts`

- [ ] **Step 1: 删除并确认无引用**

Run: `grep -rn "discussions-badge" src/`
Expected: 无输出（已核实当前只有测试引用）

- [ ] **Step 2: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 5: 删除 debug panel（保留 `debugMode` 与 DevTools 菜单）

**Files:**
- Delete: `src/renderer/components/debug-panel.ts`、`src/renderer/styles/debug-panel.css`
- Modify: `src/renderer/index.ts`（`initDebugPanel` + 8 处 `logDebugEvent` 调用）、`src/renderer/keybindings.ts:6,57`、`src/renderer/components/title-bar.ts`（debug 菜单项里的 `toggleDebugPanel`）、`src/main/menu.ts:96`（`menu:toggle-debug`）、`src/renderer/index.html`（debug panel 节点与 css link）

- [ ] **Step 1: 删除文件并拆掉所有引用**

保留 `menu:toggleDevTools`、`menu:reloadMainWindow` 与 `preferences.debugMode`——它们仍由 `debugMode` 控制。

- [ ] **Step 2: 验证残留为零（并确认 DevTools 项仍在）**

Run: `grep -rn "debug-panel\|logDebugEvent\|toggleDebugPanel\|menu:toggle-debug" src/`
Expected: 无输出
Run: `grep -rn "toggleDevTools\|reloadMainWindow" src/main/menu.ts src/renderer/components/title-bar.ts`
Expected: 仍有命中

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 6: 删除 P2P 分享域

**Files:**
- Delete: `src/renderer/sharing/**`（含 4 个 `.test.ts`）、`src/renderer/components/share-dialog.ts`、`src/renderer/components/share-dialog.test.ts`、`src/renderer/styles/p2p-sharing.css`
- Modify: `src/renderer/index.ts`（`initShareManager` / `forwardPtyData` / `endShare` / `cleanupAllShares` / `isSharing` 以及 **PTY 数据热路径上的 `isSharing(sessionId)` 调用**）、`src/renderer/components/tab-bar/tab-list.ts`（分享按钮与 `peer-host` import）、`src/main/ipc-handlers.ts`（share 相关 handler）、`src/preload/preload.ts`（share 通道）、`src/shared/types.ts`（share 相关类型）、`src/renderer/index.html`（css link）

**注意：** `remote-terminal` 会话类型由 share 的 peer-guest 生产；本任务只删生产者，pane 与 swarm 在 Task 12 处理。删完本任务后 `addRemoteSession` 暂时无调用方，`npm run build` 会因未使用而报错时，暂时保留 `state.ts` 的该方法，Task 12 一并删除。

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "sharing/\|share-manager\|share-dialog\|peer-host\|peer-guest\|webrtc-utils\|isSharing\|p2p-sharing" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 7: 删除浏览器 tab 域

**Files:**
- Delete: `src/renderer/components/browser-tab/**`、`src/renderer/components/browser-tab-pane.ts`、`src/preload/browser-tab-preload.ts`、`src/renderer/components/preferences/browser-section.ts`、`src/renderer/styles/browser-tab.css`
- Modify: `src/main/main.ts`（`webviewTag: true` → 移除该项）、`src/renderer/state.ts`（`addBrowserTabSession`、`buildBrowserTabSession`、`updateBrowserTabUrl`、`setBrowserIsolated`、`browserTabNameFromUrl`）、`src/renderer/state/session-factory.ts`、`src/renderer/components/split-layout.ts`（`browser-tab` 分支）、`src/renderer/keybindings.ts:20,112-120`、`src/preload/preload.ts`（`browser` 命名空间）、`src/shared/types.ts`（`BROWSER_DEFAULT_PARTITION`、`Preferences` 里的 browser 相关项、`SessionRecord` 的 `browserTabUrl`/`browserIsolated`）、`src/renderer/components/preferences-modal.ts`（SECTIONS 去掉 browser）、`src/renderer/index.html`（css link）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "browser-tab\|browserTab\|webviewTag\|BROWSER_DEFAULT_PARTITION" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 8: 删除概览域（连带全部 widget）

概览是最大的一块，删掉它同时带走 readiness / usage-stats / favorite-sessions / top-files / sessions / provider-tools 六个 widget 与 gridstack。

**Files:**
- Delete: `src/renderer/components/project-tab/**`（25 个文件）、`src/renderer/styles/project-tab.css`、`src/renderer/styles/widgets.css`、`src/renderer/styles/usage.css`
- Modify: `src/renderer/state.ts`（`buildProjectTabSession`、`overviewLayout` getter/setter、`'overview-layout-changed'` 事件、`boardCardMetrics` 若有概览专用分支）、`src/renderer/state/session-factory.ts`、`src/renderer/components/split-layout.ts`（`project-tab` 分支）、`src/renderer/components/tab-bar/**`（`project-tab` 的 unread 分支）、`src/shared/types.ts`（`OverviewWidgetType`/`OverviewWidget`/`OverviewLayout`、`ProjectRecord.overviewLayout`）、`src/renderer/index.html`（gridstack 与 widgets css link）、`scripts/copy-assets.js`（gridstack css 拷贝）、`package.json`（移除 `gridstack` 依赖）、`src/renderer/state/persistence.ts`（从 `DROPPED_SESSION_TYPES` 移除已无意义的条目不需要——保持到 Task 12 再统一清）

**注意：** `SessionType` 里的 `'project-tab'` 在本任务删除。落地态依赖 `split-layout.ts:480-517` 的空状态（不依赖 Overview），无需新写。

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "project-tab\|projectTab\|gridstack\|overviewLayout\|OverviewWidget" src/ package.json scripts/`
Expected: 无输出

- [ ] **Step 3: 手工冒烟（本机旧 state 就是 4 个待删会话）**

Run: `npm run build && npx electron .`
Expected: 窗口正常打开，项目显示为空项目 + 可新建会话的空状态，不崩不白屏。

- [ ] **Step 4: 构建 + 测试 + 提交**

Run: `npm test` → 全绿
Run: `/commit`

---

### Task 9: 删除 GitHub 域残余

widget 已随 Task 8 消失，剩下主进程 CLI 封装、unread 追踪与 state 字段。

**Files:**
- Delete: `src/main/github-cli.ts`、`src/main/github-cli.test.ts`、`src/renderer/github-unread.ts`、`src/renderer/github-unread.test.ts`
- Modify: `src/main/ipc-handlers.ts`（`github:*` handler 与 import）、`src/preload/preload.ts`（`github` 命名空间）、`src/shared/types.ts`（`GithubItem`/`GithubFetchResult`/`GithubRepo`、`ProjectRecord.githubLastSeen`）、`src/renderer/components/tab-bar/**`（unread 计算里的 github 分支）、`src/renderer/state.ts`（`githubLastSeen` 相关方法）、`src/renderer/index.ts`（`initGithubUnread`）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "github" src/ | grep -v "github.com" | grep -v "githubLastSeen"`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 10a: 删除团队域（UI + state + agent 安装）

**Files:**
- Delete: `src/renderer/components/team/**`、`src/renderer/state/team-state.ts`、`src/renderer/state/team-state.test.ts`、`src/shared/team-config.ts`、`src/renderer/styles/team.css`、`personas/`（整个目录）
- Modify: `src/renderer/state.ts`（`team` getter、`addMember`/`updateMember`/`removeMember`/`setPredefinedSuggestions`、`'team-changed'` 事件、`team-state` 的 8 个 import）、`src/shared/types.ts`（`TeamMember`/`TeamData`、`PersistedState.team`）、`src/preload/preload.ts`（`provider.installAgent`/`removeAgent`）、`src/main/ipc-handlers.ts`（`provider:installAgent`/`provider:removeAgent`）、`src/main/providers/provider.ts`（`agentsDir`/`installAgent`/`removeAgent` 三个可选方法）、`src/main/providers/agent-files.ts`（删除）、四个 provider 里的实现（`claude-provider.ts`/`codex-provider.ts`/`copilot-provider.ts`/`gemini-provider.ts`）、`src/renderer/index.html`（css link）、`src/renderer/components/tab-bar/**`（`team` tab 分支）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "components/team\|team-state\|team-config\|installAgent\|removeAgent\|agentsDir\|personas" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 10b: 拔掉 `systemPrompt` 链（设计文档 §5.7）

团队是它唯一的生产者，Task 10a 之后整条链已无输入。

**Files:**
- Modify: `src/shared/types.ts`（`SessionRecord.pendingSystemPrompt`、`CliProviderCapabilities.systemPromptInjection`）、`src/renderer/state.ts`（`:631` 的一次性消费逻辑）、`src/renderer/components/split-layout.ts`、`src/renderer/components/terminal-pane.ts`（`pty.create` 传参）、`src/preload/preload.ts`（`pty.create` 签名）、`src/main/ipc-handlers.ts`（`pty:create` 透传）、`src/main/pty-manager.ts`（`spawnPty` 参数）、`src/main/providers/provider.ts`（`buildArgs` 的 `systemPrompt?` 参数）、四个 provider 的 `buildArgs` 与相关测试

- [ ] **Step 1: 全链路删除 `systemPrompt`**

删 `pendingSystemPrompt` 字段与消费逻辑；删 `pty.create` / `spawnPty` / preload / IPC 上的 `systemPrompt` 参数；删 `buildArgs({ systemPrompt })` 参数与 `systemPromptInjection` 能力位；删四个 provider 的注入分支（Claude `--append-system-prompt`、Codex `-c developer_instructions`、Copilot/Gemini `--system-prompt`）与对应测试断言。

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "systemPrompt\|append-system-prompt\|developer_instructions\|system-prompt" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 11: 删除 Kanban 看板域

**Files:**
- Delete: `src/renderer/board-state.ts`、`src/renderer/board-state.test.ts`、`src/renderer/board-filter.ts`、`src/renderer/board-filter.test.ts`、`src/renderer/board-session-sync.ts`、`src/renderer/board-session-sync.test.ts`、`src/renderer/components/board/**`（9 个文件，含 2 个测试）、`src/renderer/styles/kanban.css`
- Modify: `src/renderer/state.ts`（`board` CRUD、`'board-changed'`、`createDefaultBoard` 调用、`buildKanbanSession`、`:949` 的 kanban 分支）、`src/renderer/state/persistence.ts`（`createDefaultBoard` 与 `ProjectRecord.board` 的默认值注入）、`src/renderer/state/session-factory.ts`、`src/shared/types.ts`（`ColumnBehavior`/`BoardColumn`/`BoardTask`/`TagDefinition`/`BoardData`、`ProjectRecord.board`、`Preferences` 里的看板相关项）、`src/renderer/index.ts`（`initBoard`/`initBoardSessionSync`）、`src/renderer/components/tab-bar/**`（`kanban` tab 分支）、`src/renderer/index.html`（css link）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "board-state\|board-filter\|board-session-sync\|components/board\|kanban\|BoardData\|BoardTask" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 12: 删除 remote-terminal 与 swarm 模式

**Files:**
- Delete: `src/renderer/components/remote-terminal-pane.ts`、`src/renderer/components/remote-terminal-pane.test.ts`
- Modify: `src/renderer/components/split-layout.ts`（`remote-terminal` 分支 `:148,247,309`；swarm 全部逻辑 `:111-122, 230-231, 284, 408, 421, 453-471`）、`src/renderer/state.ts`（`addRemoteSession`、`buildRemoteSession`）、`src/renderer/state/session-factory.ts`、`src/renderer/state/layout-state.ts`（swarm 相关）、`src/shared/types.ts`（`SessionType` 去掉 `'remote-terminal'`、`ProjectRecord.layout.mode` 去掉 `'swarm'`）、`src/renderer/components/title-bar.ts`（`toggleSwarm` 菜单项）、`src/renderer/index.ts`（`applyThemeToAllRemoteTerminals`）、`src/renderer/state/persistence.ts`（`DROPPED_SESSION_TYPES` 收尾：此时五个类型全部已从 `SessionType` 消失，该集合应删除、过滤逻辑改为「只接受 `SessionType` 联合内的值」）、相关 CSS（`terminal.css`/`tabs.css` 里的 `.swarm-*`）

- [ ] **Step 1: 删除文件并拆掉所有引用**

- [ ] **Step 2: 验证残留为零**

Run: `grep -rn "remote-terminal\|remoteTerminal\|swarm" src/`
Expected: 无输出

- [ ] **Step 3: 构建 + 测试 + 提交**

Run: `npm run build && npm test` → 全绿
Run: `/commit`

---

### Task 13: 收尾——引用清零、i18n、样式、文档

**Files:**
- Modify: `src/preload/preload.ts`（命名空间核对，目标 ~12 个）、`src/renderer/locales/en.json`、`src/renderer/locales/zh-CN.json`（删除已删域的 key，两语言同步）、`src/renderer/index.html`（css link 列表）、`README.md`（Highlights 段落移除概览/团队/浏览器/看板/更新）、`CLAUDE.md`（架构描述同步）

- [ ] **Step 1: 清 i18n**

删两个 locale 文件里属于已删域的 key（`overview.*`、`team.*`、`board.*`、`browser.*`、`update.*`、`github.*`、`chromeImport.*`、`usage.*`、`share.*`）。两文件 key 集合必须完全一致。

- [ ] **Step 2: 剥掉旧 state 里的已删字段**

Task 1 只处理了会话，没处理字段——而 hydrate 是 `{...default, ...saved}` 的合并，旧 `state.json` 里的 `team`、`board`、`overviewLayout`、`githubLastSeen`、`readiness`、`readinessHistory`、`preferences.chromeImport`、`preferences.browser*` 会被原样带回来并在下一次保存时写回去（Review Focus 第 5 条）。在 `hydrateLoadedState` 里显式 `delete` 这些键，并补一个测试：传入含上述字段的旧 state，断言 hydrate 后它们全部不存在。

- [ ] **Step 3: 核对 preload 命名空间**

Run: `grep -cE "^  [a-zA-Z]+: \{" src/preload/preload.ts`
Expected: ~12（原 21，去掉 `update`/`browser`/`chromeImport`/`github`/`stats`/`readiness` 等）

- [ ] **Step 4: 全仓残留扫描**

Run: `grep -rniE "overview|kanban|board|team|browser-tab|chrome-import|auto-update|whats-new|star-prompt|discussions|sharing|swarm|remote-terminal|readiness|githubLastSeen|systemPrompt" src/ README.md CLAUDE.md | grep -v "github.com" | grep -v "browser-tab-preload"`
Expected: 无输出（人工复核每一条命中）

- [ ] **Step 5: 文档与全量验证**

更新 `README.md` 的 Highlights 与 `CLAUDE.md` 的组件清单，使描述与代码一致。

Run: `npm run build && npm test` → 全绿
Run: `npx electron .` → 手工冒烟：新建项目 → 开 CLI 会话 → 终端输入输出 → 文件树 → 打开文件编辑保存 → git 面板 → resume → profile 切换
Run: `/commit`

---

## 完成标准

1. 12 个功能域全部删除，`grep` 零残留。
2. `npm test` 全绿，测试文件数从 140 显著下降且无 `.skip` 空跑。
3. 用本机旧 `state.json`（4 个待删会话）启动：正常打开成空项目，不崩不白屏。
4. preload 命名空间 ~12 个，主进程 `ipcMain.handle` 数量显著下降。
5. 手工冒烟八步全过。

## 后续

P1 完成后另写计划：**P2 提速**（provider 校验延后、非核心 init 延后、PTY 恢复串行化、`--minify`）与 **P3 归零**（0.0.1、发布 workflow、README/CLAUDE.md 终稿）。
