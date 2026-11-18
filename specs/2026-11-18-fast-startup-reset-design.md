# Vibeyard 0.0.1 — 极速启动重构设计

日期：2026-11-18
状态：待批准

## 1. 意图与为什么

Vibeyard 从一个「AI IDE 全家桶」退回一个**按下去就出来的终端**。

过去两年这个产品不断加功能：概览看板、团队、浏览器 tab、分享、MCP 检查器、使用统计……每一项单独看都合理，合起来的结果是：打开要 1.2 秒以上，而用户 90% 的时间只做三件事——开项目、开 CLI 会话、看文件。

所以这不是"再优化一下"，是重新划定产品边界：**砍掉非终端工作流的功能，把启动路径上的每一毫秒都拿回来**，版本归零到 0.0.1，重新定义这个产品是什么。

成功的标准是冷的、可测的：冷启动到界面可交互 ≤ 700ms（当前 1230ms）。

## 2. 目标 / 非目标 / 反目标

**目标**

1. 冷启动到界面可交互 ≤ 700ms（Windows，本机三次测量取中位数）。
2. 删除 4 个功能域（概览、团队、浏览器、更新）+ 7 个附加域，代码量从 ~64k 行降到 ~35k 行量级。
3. 启动关键路径上不再有同步子进程调用，不再全量加载编辑器/浏览器/看板依赖。
4. 版本 0.0.1，无自动更新。
5. 现有 405 个源文件里，被砍功能的类型、IPC、偏好、i18n、测试一并删净，不留"以后再懒加载"的半成品。

**非目标**

- 不重写 PTY / 终端渲染 / 持久化 / provider 抽象这些已经踩过坑的核心（CJK IME 光标、profile 目录隔离、macOS keychain 隔离、hook 安装、跨平台路径、文件监听）。
- 不做新功能。
- 不改视觉风格、不换 UI 框架、不换构建工具链。

**反目标（技术上都成立、但算失败）**

- 为了快牺牲 resume / profile 隔离的正确性。
- 功能删了但入口还留着（菜单项、快捷键、preference 开关、i18n 键）。
- 旧 `state.json` 在新版本里炸掉或复活已删除的会话类型。
- 启动快了但把首屏必需的渲染成本挪到别处再算快。（例外：PTY 恢复延后不算——窗口可用性不依赖它，见 5.6）

## 3. 约束与已核实的现状

### 3.1 基线测量（`VIBEYARD_TIMING=1`，三次一致）

| 阶段 | 累计耗时 |
|---|---|
| Electron 启动 → 主进程模块加载完 | 275ms |
| provider 前置校验（4 次同步 `where`/`which`） | 700ms（**+425ms**） |
| 注册 80 个 IPC handler + 读 `state.json` | 710ms |
| 创建窗口 | 810ms |
| 渲染进程解析 3.8MB bundle（未 minify） | 自带 ~450ms |
| 窗口 → `did-finish-load` | **1230ms** |

结论：总时间 = 主进程到窗口 810ms + 渲染进程到 ready ~480ms。三段可砍——provider 校验 425ms（唯一用途是决定要不要弹"没装 CLI"错误框）、bundle 解析 450ms、以及渲染进程里那堆首屏根本用不到的模块。

基线是在一个**零 CLI 会话**的工作区上取的（那台机器的 `state.json` 里 4 个会话全是 `project-tab`/`kanban`/`team`/`browser-tab`），所以 480ms 里不含任何 PTY 恢复，是纯外壳成本。含 CLI 会话的工作区会额外叠加 N 个 PTY spawn，这一部分怎么算见 §7 待定项。

预算表（目标态）：

| 阶段 | 现在 | 目标 |
|---|---|---|
| Electron 启动 → 模块加载 | 275ms | 275ms（地板） |
| provider 校验 | 425ms | 0（移到窗口之后） |
| IPC 注册 + 读 state | 10ms | 10ms |
| 创建窗口 | 105ms | 105ms |
| 渲染进程 → ready | ~480ms | ≤200ms |
| **合计** | **1230ms** | **≤600ms** |

### 3.2 结构约束

- 渲染层是单个 3.8MB IIFE bundle，`src/renderer/index.ts` 顶部 51 个静态 import 全量加载；esbuild 命令**没有 `--minify`**。
- 主进程 75 个编译模块、80 个 `ipcMain.handle`、preload 21 个命名空间，全部在启动时注册。
- `src/renderer/state.ts`（1120 行）是功能的公共宿主：team、board、overview、browser tab、remote session、kanban session 的 CRUD 全在里面。砍功能的主战场在这里，不在组件目录。
- `docs/` 下原有 14 个旧理念文档（`CONTEXT.md`、`intent.json`、`prd/`、`spec/`、`review/`、`tickets/`、`knowledge/adr/`），已整目录删除（见 5.8）。README / CONTRIBUTING / CLAUDE.md 里没有指向它们的链接（已 grep 确认），无断链风险。

## 4. 方案

三条路，用户在对话中选了 C。

**A 减法（原地删 + 懒加载 + minify）** — 1–2 天见效，风险低。但 405 个文件的历史包袱还在，能"快"，到不了"极简"。

**B 重写（新骨架只搬 PTY/终端/项目会话）** — 真正极简，但要重踩 CJK 光标、profile 隔离、hook 安装、跨平台路径这些坑，以周计，期间旧版仍是唯一可用版。

**C 先减面再提速（选定）** — 把 A 拆成两个可验收阶段：先把功能删干净让代码库真的变小，再专注重构启动路径，并立一条启动耗时门槛当验收标准。拿 B 的收益，不承担从零踩坑的成本。

## 5. 已定的决定

### 5.1 功能边界（用户拍板）

**保留**：项目 · 会话（多 provider、resume、profile 隔离）· 终端（xterm + 分屏 + 右键菜单）· 文件树 / 阅读器 / 编辑器 / 全局搜索 / Ctrl+P · git 面板 · 侧边栏 + 标签栏 + Windows 自绘标题栏 · 快捷键 / 主题 / i18n / Preferences · 状态持久化 · **Session inspector** · **Insights 与上下文/工具告警** · **MCP inspector**。

后三项保留，但**不在启动时初始化**，改为首次使用时加载。

**删除**（连带类型、IPC、preference、i18n 键、测试、样式）：

| 域 | 主要文件 |
|---|---|
| 概览 | `components/project-tab/**`（含 `grid.ts` 与全部 widgets）、`gridstack` 依赖、`OverviewWidget*` 类型、`overviewLayout` 字段 |
| 团队 | `components/team/**`、`state/team-state.ts`、`shared/team-config.ts`、`personas/`、`TeamMember`/`TeamData` 类型、provider 的 `agentsDir`/`installAgent`/`removeAgent` |
| 浏览器 | `components/browser-tab/**`、`webviewTag`、`BROWSER_DEFAULT_PARTITION`、`browser-*` preference、`preferences/browser-section.ts` |
| 更新 | `main/auto-updater.ts`、`components/update-banner.ts`、`whats-new-dialog.ts`、`star-prompt-dialog.ts`、`electron-updater` 依赖、`update` IPC 命名空间、`build.publish` |
| Kanban | `board-*.ts`、`components/board/**`、`styles/kanban.css`、`Board*`/`TagDefinition` 类型、`board` 字段 |
| Discussions | `discussions-badge.ts`（已无引用）、侧边栏入口 |
| 分享 | `renderer/sharing/**`、`share-dialog.ts`、`share-*` IPC |
| remote-terminal / swarm | `components/remote-terminal-pane.ts`、`split-layout.ts` 的 swarm 分支、`buildRemoteSession`、View 菜单的 `toggleSwarm` |
| GitHub | `main/github-cli.ts`、`components/project-tab/widgets/github-*`、`github-unread.ts`、`Github*` 类型、`githubLastSeen` 字段、`github` IPC |
| usage-stats | `usage-stats` widget、stats cache IPC、`styles/usage.css` |
| Chrome 导入 | `main/chrome-import/**`、`chrome-import-modal.ts`、`chromeImport` IPC、`preferences.chromeImport`、`better-sqlite3` 依赖（同时移出 `asarUnpack`） |
| 就绪检查 | `main/readiness/**`、`readiness` IPC 命名空间、`Readiness*` 类型。唯一消费链是 `preload.ts` → `ipc-handlers.ts` → 已删的 project-tab widgets；Preferences 的 setup 检查走的是 `preferences/setup-section.ts` → `setup-checks.ts` → `provider:checkBinary`，不受影响 |
| debug panel | `components/debug-panel.ts` 与 8 处 `logDebugEvent` 调用（保留 `debugMode` 偏好与 DevTools 菜单项） |

### 5.2 版本与发布

`package.json` 原地改 `0.0.1`，删除 `electron-updater` 与 `build.publish`，不再发 GitHub Release。这样不换 repo 也不会出现 tag 排序倒挂和 CHANGELOG 自动生成错位的问题。`CHANGELOG.md` 停止自动生成，历史段落归档。

**发布路径**（用户定：只构建不发版）：

- `.github/workflows/release.yml` 改造成**只构建不发版**：去掉改版本号 / 打 tag / 重生成 CHANGELOG / 上传 GitHub Release 的步骤，产物改为上传 workflow artifacts（三平台安装包照旧能出）。
- 删除 npm 发布面：`bin/vibeyard.js`、`package.json` 的 `bin` / `files` / `publishConfig`。这是一个桌面应用，npm 包只是个启动器壳。
- 本地 `npm run dist` 保留，用于自己出安装包。
- **0.0.1 不发 npm、不发 GitHub Release**（不可逆）。

### 5.3 `state.json` 兼容

路径不变（`~/.vibeyard/state.json`），加载保持宽容：未知字段忽略、已删除的 `SessionRecord.type` 变体在 hydrate 时丢弃、保存时不再写回已删除字段。理由：用户的项目和会话历史必须活下来，删功能不该让人重建工作区。

三条硬要求：

1. **`version` 字段保持 `1`**——`state.ts:182` 只接受 `1`，改数字会让所有旧 state 被判为不可用。
2. hydrate 时必须清掉指向已删会话的引用：`activeProject.activeSessionId`、`layout.splitPanes` 里指向被丢弃会话的 id。否则启动即指向不存在的 pane。
3. 清空后的落地态已有现成实现（`split-layout.ts:480-517` 的空状态，不依赖 Overview），不需要新写。

本机 `state.json` 是这条要求的极端案例：唯一的 1 个项目里 4 个会话全部是 `project-tab`/`kanban`/`team`/`browser-tab`——删完之后它必须变成一个可用的空项目，而不是崩掉或白屏。

### 5.4 渲染层加载策略（分两步，按测量决定是否做第二步）

- **第一步（本项目内做）**：`--minify` + 把非核心初始化从 `index.ts` 首屏路径移走。预期 3.8MB → ~1.4MB，解析 ~450ms → ~200ms。
- **第二步（留作后续，附测量触发条件）**：把 CodeMirror 语言包、`marked`、`dompurify` 拆成惰性 chunk，首次打开文件时才加载。技术选择两条：
  1. 改 ESM + `protocol.handle('app')` 自定义协议（esbuild 的 code splitting 只支持 ESM；`file://` 下 Chromium 禁止 module script）；
  2. 保留 IIFE，多入口出 `index.js` + `lazy.js`，用 ~30 行 script 注入式 loader 加载。
  **只在第一步之后仍超 700ms 时才做**，否则不做——这是有意的取舍，不是遗漏。

### 5.5 启动路径重构

1. provider 校验移出关键路径：先建窗口，`did-finish-load` 之后异步校验；全部缺失时才弹错误框（此时窗口已存在，能正常显示）。
2. 非核心初始化（insights、告警、inspector、MCP、git 轮询）移到首帧之后或首次使用。
3. 删掉 PTY 数据热路径上的 `isSharing(sessionId)` 调用（sharing 删除后自然消失）。
4. preload 命名空间 21 → 约 12（去掉 `update`、`browser`、`chromeImport`、`github`、`stats`）。
5. 主进程 IPC 数量随功能删除自然下降；MCP 相关 handler 改为首次使用时注册。
6. Python 可用性检查（`execSync('python --version')`，3s 超时）与 `installHooks` 循环都在窗口创建之后同步阻塞，一并移到 `did-finish-load` 之后。
7. 无 provider 的退出路径上，`app.quit()` 之前必须先 `setCloseConfirmed(true)`——否则窗口的 `close` 拦截会把它变成一个「确认退出」对话框，启动失败被伪装成用户操作。

### 5.6 PTY 恢复移出首屏路径（用户定：选 A）

**门槛口径**：700ms 测的是「窗口可交互」，即 `main:window-created` ≤ 400ms 且渲染进程 `ready` ≤ 200ms，**不含任何 PTY 恢复**。

现在的行为是：`state.ts` 的 `load()` 同步发 `state-loaded` → `split-layout.ts:102` 收到后立刻 `renderLayout()` 遍历活动项目的**全部**会话（`:236-273`）并 `createTerminalPane` → `pty.create`，即 N 个 CLI 并发 resume，全部落在 `renderer:ready` 之前。

改造要求：

1. `state-loaded` 之后只渲染 pane 骨架（标题、状态、尺寸），不调 `pty.create`。
2. PTY spawn 排在首帧之后（`requestIdleCallback` 或首个 `rAF` 之后），**串行**启动而非全部并发，避免 N 个 CLI 同时抢 CPU 把窗口卡住。
3. pane 在 PTY 未就绪时显示「正在启动」占位，会话数据不变；用户点进一个未启动的 pane 时优先启动它（插队）。
4. 首个终端可用时间单独验收（见 §8），不进 700ms 门槛。

**为什么不算「把成本搬到别处」**：用户在看到窗口之前本来就看不到终端输出，这部分工作从来不在感知路径上，只是被错误地放在了主线程上。它反而是当前的隐性危害——会话开得多时，打开应用等于同时拉起 N 个 CLI。

### 5.7 `systemPrompt` 链连根拔（用户定：拔干净）

团队是它唯一的生产者（`state/team-state.ts:95` 写入 `pendingSystemPrompt`）。团队删除后整条链一并删除：

- `SessionRecord.pendingSystemPrompt` 字段与其一次性消费逻辑（`state.ts:631`）。
- `pty.create` / `spawnPty` / preload / IPC 上的 `systemPrompt` 透传参数。
- `CliProvider.buildArgs({ systemPrompt })` 参数与 `CliProviderCapabilities.systemPromptInjection` 能力位。
- 四个 provider 实现里的注入分支（Claude `--append-system-prompt`、Codex `-c developer_instructions`、Copilot/Gemini `--system-prompt`）与全部相关测试。

这不违反「不重写 provider 抽象」：删的是一个没有生产者的可选参数和能力位，不动 provider 的注册、解析、hook、env、config 读取这些真正踩过坑的部分。

### 5.8 旧理念文档归零（用户定：`docs/` 全部删除）

`docs/` 整个目录删除，不归档。里面那套流程（`CONTEXT.md` / `intent.json` / `prd/` / `spec/` / `review/` / `tickets/` / `knowledge/adr/`）属于旧理念的产物，留着就是新定位的反面例子。共 14 个文件，无任何代码/构建引用（已 grep 确认）。

新的设计文档放在**仓库根 `specs/`**，不再放进 `docs/`——`docs/` 这个名字随旧流程一起消失。

## 6. 分阶段执行

- **P0 基线**（已完成）：`VIBEYARD_TIMING=1` 埋点，主进程 6 个、渲染进程 5 个标记。这套埋点保留为验收工具。
- **P1 减面**：按 5.1 删除功能域，同步清类型/IPC/preference/i18n/样式/测试。每删一个域跑一次 `npm test`。
- **P2 提速**：按 5.5 重排启动路径，按 5.6 把 PTY 恢复移到首帧之后，按 5.7 拔掉 systemPrompt 链，加 `--minify`。
- **P3 归零**：版本、依赖、构建配置、发布 workflow、README、`CLAUDE.md`，以及 `docs/` 整目录删除（见 5.8）。

## 7. 留给实现者的

- 删除顺序与提交粒度（建议一域一提交，便于回滚）。
- `state.ts` 的拆法：哪些 CRUD 直接删、哪些抽成会话工厂、要不要顺手把 1120 行切成 `state/` 下的几个模块。
- `docs/` 旧理念文档的处理方式：**已定——整目录删除**（见 5.8）。
- Insights / inspector / MCP 的懒加载接缝怎么切（小 facade 还是动态 import）。
- 5.4 第二步是否在本轮做（按测量决定）。
- 5.6 的串行恢复队列用什么机制（`requestIdleCallback` 在 Electron 渲染进程的可靠性需实测；退路是 `setTimeout` 链）。

## 8. 验收

1. `VIBEYARD_TIMING=1` 冷启动，两个工作区各测三次：
   - **干净工作区**（零会话）与 **3+ CLI 会话工作区**都必须满足：`main:window-created` ≤ 400ms、渲染进程 `ready` ≤ 200ms、窗口到可交互 ≤ 700ms。PTY 恢复不计入。
   - **恢复路径**：3+ 会话工作区启动后，首个终端在窗口出现后 ≤ 2s 内可用，其余会话按顺序补齐；pane 骨架在首帧即可见，不出现「空白无反馈」。
   - 会话数不能拖慢窗口：5 个会话与 1 个会话的窗口可交互时间差 ≤ 100ms。
2. `npm test` 全绿（已删模块的测试一并删除，不出现空跑）。P0 基线：140 文件 / 1851 通过 / 1 跳过，耗时 8.9s。
3. 手动冒烟：新建项目 → 开 CLI 会话 → 终端输入输出正常 → 文件树 → 打开文件编辑并保存 → git 面板 → 关闭后 resume → 切换 profile。
4. 用旧版 `state.json` 启动一次：不崩、项目与历史会话还在、已删除功能的痕迹不复活。
5. 全局搜一遍已删功能的字符串（菜单、快捷键、i18n、preference），为零。
