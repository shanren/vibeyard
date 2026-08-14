# CONTEXT — Explorer 全局搜索

> 需求分诊：L 级 / flow-l（见 `docs/intent.json`）。本文档是「构建什么」的业务上下文与领域词汇表，不含技术方案。技术设计由架构师负责。

## 用户画像

- **使用者**：Vibeyard 用户是重度 CLI 开发者（当前主要跑 Claude Code，抽象层预留 Copilot/Gemini/Codex）。他们在终端 IDE 内管理项目与会话，需要频繁打开项目里的文件。
- **痛点**：右侧 Explorer 文件树是**惰性加载**的——只渲染展开过的目录，且每个目录需手动点击展开。在大型项目里定位一个文件要逐层展开，甚至不知道它在哪层。
- **已有能力**：`Ctrl+P` 快速打开（`src/renderer/components/quick-open.ts`）已经提供"按文件名搜索文件"的**覆盖层**。本功能把同类能力以**常驻搜索框**的形式搬进右侧 Explorer 面板，与文件树共用同一块区域。
- **诉求**：像 VS Code 全局查找那样，输入即搜、递归覆盖未展开目录、结果平铺带相对路径、点击即打开。

## 统一语言（Ubiquitous Language）

| 术语 | 定义 |
|------|------|
| 搜索查询（Search Query） | 用户在搜索框输入的一段文本；匹配目标是**文件名**（basename）。 |
| 搜索结果（Search Result） | 一条命中的文件，以其**仓库相对路径**（相对项目根，如 `src/renderer/state.ts`）表示。 |
| 结果列表（Result List） | 查询激活时，替换文件树展示的**平铺、可滚动**命中列表。 |
| 活动项目（Active Project） | 搜索范围 = 当前活动项目（`appState.activeProject`），**不跨项目**。 |
| 仓库相对路径（Repo-relative path） | 相对项目根的路径，非绝对路径；`fs:listFiles` 已按此返回。 |
| 去抖（Debounce） | 停止输入后延迟触发搜索，避免每个按键都触发一次遍历。 |

## 关键假设

1. **搜索范围是单个活动项目**，不是跨项目聚合。切换活动项目时，搜索状态重置（见 SPEC AC-19）。
2. **默认排除**：`node_modules`、`.git`、`.gitignore` 命中文件、隐藏文件/目录（点开头）。这与现有 `enumerateProjectFiles` 的枚举口径一致，用户预期"搜的是我的代码，不是依赖和构建产物"。
3. **结果上限 500 条**，超出显示截断提示；排序按仓库相对路径字典序（大小写不敏感）。
4. **点击结果复用现有「文件阅读器」会话**打开，不新建阅读视图。同一文件已有阅读器时聚焦而不重复开。
5. **实现方式留白**：是否复用/扩展 `fs:listFiles` 或新增 `fs:searchFiles` 由架构师定；本文件只约定用户侧行为与已知现状。

## 风险（重点：性能）

1. **大仓库递归遍历成本**：单次遍历可能覆盖数万文件。缓解方向——复用 `git ls-files`（快、gitignore 感知）作为主路径；非 git 目录回退到深度/数量受限的同步遍历（现状 `MAX_DEPTH=5`、`MAX_FILES=5000`，见 `src/main/ipc-handlers.ts` 的 `enumerateProjectFiles`）。
2. **主进程阻塞**：现有 `enumerateProjectFiles` 用 `execSync` + `fs.readdirSync`（同步）。在大仓库上若每次查询都同步遍历，会阻塞主进程进而影响 PTY 输入输出（`fs:topFilesByTokens` 里已出现过"保持主循环响应"的顾虑，见 `ipc-handlers.ts:649` 的注释）。架构师需评估搜索是否异步化/可取消。
3. **连续输入的遍历风暴**：输入即搜必须去抖（现状 `quick-open.ts` 用 150ms），并保证 **latest-wins**——慢返回的旧查询不得覆盖新查询结果（SPEC AC-4）。
4. **结果集过大**：500 上限 + 截断提示兜底，避免一次性渲染上万 DOM 行。
5. **无缓存**：v1 每次查询重新遍历，不做跨查询缓存（去抖 + 上限已足够），缓存留作后续优化，明确不在 v1 范围。
6. **安全边界**：搜索沿用 `isWithinKnownProject` 守卫（`ipc-handlers.ts:38`），只能枚举已知项目目录，无新增越权面。

## 已核实现状（快照 2026-08-14，实现前请再读代码确认）

- **已有 IPC `fs:listFiles`**（`src/main/ipc-handlers.ts:605`）：`isWithinKnownProject` 校验 → `enumerateProjectFiles` 递归枚举（git 快路径 / 同步回退）→ 按 exact > startsWith > nameContains > pathContains 四级匹配（大小写不敏感）→ `slice(0, 50)`。**与本需求的两处 gap：上限 50（需求要 500）、匹配含 pathContains（需求明确仅文件名）**。
- **`enumerateProjectFiles`**（`ipc-handlers.ts:80`）：`git ls-files --cached --others --exclude-standard`（尊重 `.gitignore`、含未跟踪未忽略文件）；非 git 目录回退同步遍历，`IGNORE = {node_modules, .git, dist, build, coverage, .next, __pycache__}` + 跳过点文件，`MAX_DEPTH=5`、`MAX_FILES=5000`。
- **`quick-open.ts`**（`src/renderer/components/quick-open.ts`）：150ms 去抖 + `fs:listFiles` + 点击结果 `appState.addFileReaderSession(project.id, filePath)`（`filePath` 为仓库相对路径）。搜索结果展示样式（文件名粗体 + 目录灰色）可参考。
- **`addFileReaderSession`**（`src/renderer/state.ts:637`）：相对路径自动拼 `project.path`；同名文件已开时复用并聚焦（`findExistingFileReader`），不重复建会话。
- **Explorer DOM**（`src/renderer/index.html:72-78`）：`#explorer-panel` > `#explorer-header`（`#explorer-title` + `#btn-close-explorer`）+ `#explorer-content`。搜索框应插入 header 与 content 之间。
- **`explorer-panel.ts`**（`src/renderer/components/explorer-panel.ts`）：`renderFileTree(project, contentEl)` / `closeFileTree(projectId)`；已处理 `project-changed`、`project-removed`、`explorer-toggled`、`state-loaded` 生命周期——搜索状态需与这些生命周期对齐（切项目/关面板时重置）。
- **i18n**（`src/renderer/i18n.ts` + `locales/{en,zh-CN}.json`）：`t(key)` 点路径查表，已有 `sidebar.explorerTitle`。需新增 `explorer.*` 键（占位符 / 无结果 / 截断提示）。
- **样式**（`src/renderer/styles/explorer-panel.css`）：`#explorer-header`、`#explorer-content`、`.explorer-title` 已定义，搜索框样式可并入此文件。
