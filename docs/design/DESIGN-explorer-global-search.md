# DESIGN — Explorer 跨目录全局搜索

- **状态**：已确认（架构设计）
- **关联**：`docs/prd/PRD-explorer-global-search.md`、`docs/spec/SPEC-explorer-global-search.md`、`docs/CONTEXT.md`
- **决策记录**：`docs/knowledge/adr/ADR-0001-*.md`（IPC 形态）、`ADR-0002-*.md`（gitignore 策略）、`ADR-0003-*.md`（同步遍历取舍）

## 1. 目标与范围

在右侧 Explorer 面板顶部加一个常驻文件搜索框，对**当前活动项目**递归遍历整个项目目录，按**整条仓库相对路径**做大小写不敏感的子串匹配，结果平铺（≤500，截断提示），点击用现有文件阅读器打开。技术边界对齐 SPEC AC-1~AC-21，不写业务代码、不重写 PRD。

## 2. 现状核实（2026-08-14 已读源码确认）

| 事实 | 位置 | 结论 |
|------|------|------|
| `enumerateProjectFiles(resolvedCwd): string[]` | `src/main/ipc-handlers.ts:80` | 主路径 `git ls-files --cached --others --exclude-standard`（`execSync`，5s 超时）；非 git 目录回退 `readdirSync` 递归（`IGNORE={node_modules,.git,dist,build,coverage,.next,__pycache__}` + 跳过点文件，`MAX_DEPTH=5`、`MAX_FILES=5000`）。返回仓库相对路径。 |
| `fs:listFiles` | `ipc-handlers.ts:605` | `isWithinKnownProject` 校验 → `enumerateProjectFiles` → 四级排序匹配（exact > startsWith > nameContains > pathContains，大小写不敏感）→ `slice(0,50)`。**唯一调用方是 `quick-open.ts`（Ctrl+P）**。 |
| `fs:topFilesByTokens` | `ipc-handlers.ts:635` | 也复用 `enumerateProjectFiles`，另叠加 `.vibeyardignore` 过滤（`buildVibeyardignoreMatcher`）。 |
| Explorer 面板 | `index.html:72-78` | `#explorer-panel` > `#explorer-header`（`#explorer-title` + `#btn-close-explorer`）+ `#explorer-content`。搜索框插入点：header 与 content 之间。 |
| 面板生命周期 | `explorer-panel.ts` | `renderTreeForActiveProject()` / `closeTree()`；订阅 `state-loaded`、`explorer-toggled`、`project-changed`、`project-removed`。 |
| 文件树 | `file-tree.ts` | `renderFileTree(project, container)` / `closeFileTree(projectId)`；模块级 `activeTrees`、`entryCache`、`expandedFolders` 维护展开/滚动/缓存状态——**搜索结果列表不能销毁文件树 DOM**，否则丢失增量调和所需的注册表。 |
| 点击落点 | `state.ts:637` `addFileReaderSession(projectId, filePath, lineNumber?)` | 相对路径拼 `project.path`；同名已开则复用并聚焦（`findExistingFileReader`）。 |
| 参照交互 | `quick-open.ts` | 150ms 去抖 + `fs:listFiles` + 点击 `addFileReaderSession` + Esc 关闭；结果行"文件名粗体 + 目录灰"样式可参照。 |
| 类型/preload 桥 | `shared/types.ts`、`preload/preload.ts`、`renderer/types.ts` | `fs` 命名空间 `listFiles`/`topFilesByTokens` 均需在三个文件同步新增。 |
| i18n | `i18n.ts` + `locales/{en,zh-CN}.json` | `t(key)` 点路径；已有 `sidebar.explorerTitle`，需新增 `explorer.*` 三键。 |
| 隐藏类 | `styles/explorer-panel.css` | 项目**无全局 `.hidden` 工具类**，各选择器自带 `.hidden{display:none}`；新增元素需自配 `.hidden` 规则。 |

## 3. 技术边界建模

### 3.1 模块划分

新增两个"深模块"（小接口 + 大实现），复用既有 `enumerateProjectFiles` 作为共享枚举核心：

| 模块 | 文件 | 接口（对调用方可见的全部契约） | 实现 |
|------|------|------------------------------|------|
| **纯匹配模块** | `src/main/file-search.ts`（新增） | `searchProjectFiles(allFiles, query, limit): SearchFilesResult` + `SEARCH_FILES_LIMIT` 常量 | 大小写不敏感子串过滤、大小写不敏感字典序排序、截断、`truncated` 标志。无 I/O、无 Electron，纯函数可单测。 |
| **IPC 处理器** | `src/main/ipc-handlers.ts`（增改） | `fs:searchFiles`（复用 `enumerateProjectFiles` + `searchProjectFiles`） | 路径解析、`isWithinKnownProject` 守卫、错误兜底。 |
| **搜索 UI 模块** | `src/renderer/components/explorer-search.ts`（新增） | `initExplorerSearch(): void`、`resetExplorerSearch(): void`、`normalizeQuery(raw): string`（导出纯函数供测） | 搜索框 DOM、150ms 去抖、latest-wins 序号守卫、结果渲染、Esc/点击、树/结果的显隐切换。 |
| **面板编排** | `src/renderer/components/explorer-panel.ts`（增改） | 现有接口不变 | 在既有生命周期回调里调用 `resetExplorerSearch()`。 |
| **数据模型** | `src/shared/types.ts`（增改） | `SearchFilesResult` | 跨进程类型。 |

### 3.2 数据模型

```ts
// src/shared/types.ts
export interface SearchFilesResult {
  files: string[];      // 仓库相对路径数组，已按大小写不敏感字典序升序，长度 ≤ SEARCH_FILES_LIMIT
  truncated: boolean;   // true 表示总命中数 > 上限（渲染端据此显示截断提示）
}
```

约束：`files` 元素为仓库相对路径（相对 `project.path`，`git` 快路径产出 `/` 分隔符、回退遍历产出 `path.sep`——与既有 `fs:listFiles` 完全一致，本设计**不改变**该行为，见 §8）。空查询/非已知项目/异常均返回 `{ files: [], truncated: false }`。

### 3.3 接口契约

**主进程 IPC**（新增通道）：

```
channel: 'fs:searchFiles'
request:  (cwd: string, query: string)
response: SearchFilesResult
```

- `query` 已 `trim` 的空串 → 直接 `{ files: [], truncated: false }`（不触发遍历，满足 AC-2/AC-10 的防御性后端保证）。
- 非已知项目（`isWithinKnownProject` false）→ 空结果（安全守卫，沿用现有 `fs:listFiles` 口径）。
- 异常 → `console.warn` + 空结果（与 `fs:listFiles`/`fs:topFilesByTokens` 一致）。

**纯匹配函数**：

```ts
// src/main/file-search.ts
export const SEARCH_FILES_LIMIT = 500;

export function searchProjectFiles(
  allFiles: string[],
  query: string,
  limit: number = SEARCH_FILES_LIMIT,
): SearchFilesResult {
  const q = query.toLowerCase();
  const matched = allFiles.filter((f) => f.toLowerCase().includes(q));
  matched.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { files: matched.slice(0, limit), truncated: matched.length > limit };
}
```

> `sensitivity: 'base'` 与 `file-tree.ts` 的 `sortEntries` 相同，是该代码库既有的大小写不敏感排序惯例，天然满足 AC-12 的 `a.ts → B.ts → src/x.ts → Z.ts` 顺序。

**preload / renderer 类型桥**（三处同步）：

```ts
// preload/preload.ts 的 VibeyardApi.fs 与 renderer/types.ts 的 VibeyardApi.fs
searchFiles(cwd: string, query: string): Promise<SearchFilesResult>;
// preload 实现：
searchFiles: (cwd, query) => ipcRenderer.invoke('fs:searchFiles', cwd, query),
```

**搜索 UI 模块接口**：

```ts
// src/renderer/components/explorer-search.ts
export function initExplorerSearch(): void;   // 构建搜索框 + 结果容器并接线（面板初始化时调用一次）
export function resetExplorerSearch(): void;  // 清空查询、使在途请求失效、隐藏结果、恢复文件树
export function normalizeQuery(raw: string): string; // trim；纯空白 → ''（AC-10，导出便于单测）
```

## 4. 数据流

```
[renderer 搜索框 input 事件]
  → 去抖 150ms（latest-wins：每次清旧 timer）
  → normalizeQuery(raw) → '' ? 恢复文件树 : 继续
  → const seq = ++searchSeq（单调递增序号）
  → await window.vibeyard.fs.searchFiles(project.path, query)
  → 返回后 if (seq !== searchSeq) return  // 有更新的查询在途，丢弃本次（AC-4）
  → renderResults({ files, truncated })
  → 点击行 → appState.addFileReaderSession(project.id, filePath)（AC-15/16/17）
```

主进程侧：

```
ipcMain.handle('fs:searchFiles')
  → isWithinKnownProject(path.resolve(cwd)) ? 继续 : 空
  → enumerateProjectFiles(resolvedCwd)   // git ls-files 快路径 / 非 git 同步回退
  → searchProjectFiles(files, query, 500)  // 过滤 + 排序 + 截断
  → SearchFilesResult 经 IPC 回传
```

**latest-wins 的落点**：序号守卫放在 renderer（这是 IPC 响应乱序问题，只能在发起方解决）。`resetExplorerSearch()` 也执行 `searchSeq++`，使切项目/关面板时所有在途结果一并失效（AC-20/AC-21）。

## 5. 关键设计决策（映射 SPEC）

| # | 决策 | 理由 | 覆盖 AC |
|---|------|------|---------|
| D1 | **新增 `fs:searchFiles` 通道**，不复用/不扩展 `fs:listFiles` | `fs:listFiles` 服务 Ctrl+P，靠四级排序 + 50 上限；本需求是"路径子串 + 500 + 截断标志"，语义与返回结构都不同。扩展会破坏 quick-open 的排序体验。共享部分（枚举）通过复用 `enumerateProjectFiles` 而非共享 IPC 契约。详见 ADR-0001。 | AC-4/6/7/11/13 |
| D2 | **匹配/排序/截断在主进程**（`searchProjectFiles` 纯函数），renderer 只收 ≤500 结果 | 全量文件列表在主进程枚举产生；若回传全量再在 renderer 过滤，每次按键都要跨 IPC 传数万路径。匹配语义集中一处，便于主进程单测 AC-5/6/7/12/13。 | AC-5/6/7/12/13 |
| D3 | **复用 `enumerateProjectFiles` 原样**，不改其内部忽略逻辑；不引入 `ignore` npm 包 | `git ls-files --exclude-standard` 原生尊重 `.gitignore`（含未跟踪未忽略文件）；非 git 回退已跳过 `IGNORE` 集合 + 点文件。这正是 PRD 的"默认排除"清单。加 `ignore` 包是第二套 gitignore 真源 + 新依赖。详见 ADR-0002。 | AC-8/9 |
| D4 | **v1 保留同步枚举**（`execSync`/`readdirSync`），不做异步化/取消；用 150ms 去抖 + latest-wins + git 快路径缓解阻塞 | 与 `fs:listFiles` 同路径、同行为；`git ls-files` 单次 exec 极快（主路径），回退遍历有 `MAX_FILES=5000` 上限。异步化收益有限、成本高。详见 ADR-0003。 | AC-3/4（渲染侧）/非验收项 |
| D5 | **去抖 150ms**（latest-wins 清 timer） | 与 `quick-open.ts`、`file-watcher.ts` 的 150ms 一致，落在 PRD 150–300ms 区间。 | AC-3 |
| D6 | **"临时替换文件树" = CSS 显隐，不销毁/重建树 DOM** | `file-tree.ts` 的增量调和依赖模块级 `activeTrees`/`entryCache`/`expandedFolders` 注册表；销毁树 DOM 会丢展开与滚动状态并破坏文件监听的增量更新。用新结果容器 `#explorer-search-results` 与 `#explorer-content` 互斥显示，切回时树原样还在。 | AC-2/18/19 |
| D7 | **点击结果** → `appState.addFileReaderSession(project.id, filePath)`（不传 lineNumber） | 复用现有落点，相对路径自动解析、同名复用聚焦。搜索框是纯路径/文件名子串，无 `:line` 语义。 | AC-15/16/17 |
| D8 | **Esc 仅在搜索框 keydown 处理**（不挂 document 级） | 与 `quick-open.ts` 一致，避免与终端/其它 Esc 处理冲突。Esc → 清空输入 + 恢复树。 | AC-18 |
| D9 | **生命周期重置挂在 `explorer-panel.ts`**（在 `renderTreeForActiveProject`/`closeTree` 旁调用 `resetExplorerSearch()`） | 面板已有全部生命周期订阅（切项目/关面板/移除项目/加载完成），搜索复用同一编排点，不另建订阅，单一职责清晰。 | AC-19/20/21 |

## 6. 搜索 UI 模块内部结构（renderer）

`explorer-search.ts` 拥有搜索框与结果容器的全部 DOM 构建和事件：

- **DOM**：`#explorer-search`（含 `input#explorer-search-input`）常显；`#explorer-search-results` 默认 `.hidden`。
- **显隐**：搜索激活时 `#explorer-content` 加 `.hidden`、`#explorer-search-results` 移除 `.hidden`；恢复时反向。
- **状态**（模块级，`resetExplorerSearch` 可清空）：`searchSeq: number`、`debounceTimer`。
- **结果行渲染**：`createElement` + `textContent`（不用 `innerHTML` 拼接，规避 XSS）；文件名主信息、目录次信息（`splitResultPath` 按最后一个分隔符切分，兼容 `/` 与 `\`）。
- **空/截断态**：`files.length === 0` → `explorer.searchNoResults`（AC-14）；`truncated` → 列表底部 `explorer.searchTooMany` 脚注（AC-13）。
- **i18n**：占位符在 init 时用 `t('explorer.searchPlaceholder')` 设置，并订阅 `preferences-changed` 重设（与面板 `applyTitle` 同法）。

可单测的纯函数：`normalizeQuery`（AC-10）、`splitResultPath`（AC-11 展示）。去抖 + latest-wins 通过假计时器 + stub `window.vibeyard.fs.searchFiles` 的顺序断言验证。

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 非已知项目 | 主进程返回空结果（`isWithinKnownProject` 守卫，无新增越权面） |
| 枚举/匹配异常（git 超时、目录不可读等） | `try/catch` → `console.warn` → `{ files: [], truncated: false }`；renderer 侧再包一层 `try/catch` 兜底 |
| IPC 响应乱序 | renderer 序号守卫丢弃旧结果（AC-4） |
| 空查询/纯空白 | renderer `normalizeQuery` 归一为空 → 不发起 IPC、恢复树（AC-2/10）；主进程亦防御性短路 |
| 结果 > 500 | 截断 + `truncated` 标志 → 脚注提示（AC-13） |

## 8. 风险与已知限制

1. **主进程阻塞（残余）**：同步 `execSync`/`readdirSync` 在超大仓库或慢 `git` 上仍会短暂阻塞主进程（影响 PTY 输入输出）。缓解：`git ls-files` 快路径 + 5s 超时 + 去抖 + latest-wins 避免风暴。彻底解决需异步遍历，属后续优化（ADR-0003）。
2. **git 快路径 vs 非 git 回退的忽略口径不一致**（**既有问题，非本需求引入**）：git 路径由 `.gitignore` 决定（node_modules 通常被 ignore 而排除）；非 git 回退只跳过固定 `IGNORE` 集合 + 点文件，不解析任意 `.gitignore` 模式。本设计复用 `enumerateProjectFiles`，因此原样继承该口径，不在此处修复。
3. **路径分隔符**：git 快路径产出 `/`、回退产出 `path.sep`，与 `fs:listFiles` 现状一致；`addFileReaderSession` 用 `project.path + '/' + filePath` 拼接，Node/Electron 在 Windows 接受 `/`，且 quick-open 已走同一路径，无新增风险。本设计不引入归一化，避免超出范围的兼容面变化。
4. **无缓存**：每次查询重新遍历，符合 PRD 非目标 #6；去抖 + 500 上限已足够。

## 9. 非目标（与 PRD 对齐）

不做 fuzzy/正则/拼音匹配；不跨项目；不搜文件内容；不做搜索历史/最近/收藏；不缓存；不改文件树自身行为（只做显隐替换）。

## 10. 文件变更清单

| 文件 | 变更 | 性质 |
|------|------|------|
| `src/main/file-search.ts` | 新增 `searchProjectFiles` + `SEARCH_FILES_LIMIT` | 新增 |
| `src/main/ipc-handlers.ts` | 新增 `fs:searchFiles` 处理器 | 增改 |
| `src/shared/types.ts` | 新增 `SearchFilesResult` | 增改 |
| `src/preload/preload.ts` | `fs.searchFiles` 声明 + 实现 | 增改 |
| `src/renderer/types.ts` | `fs.searchFiles` 声明 | 增改 |
| `src/renderer/components/explorer-search.ts` | 搜索 UI 模块 | 新增 |
| `src/renderer/components/explorer-panel.ts` | 接线 `initExplorerSearch`/`resetExplorerSearch` | 增改 |
| `src/renderer/index.html` | `#explorer-search` + `#explorer-search-results` DOM | 增改 |
| `src/renderer/styles/explorer-panel.css` | 搜索框/结果列表/空态/截断样式 + 两条 `.hidden` 规则 | 增改 |
| `src/renderer/locales/en.json` | `explorer.searchPlaceholder` / `searchNoResults` / `searchTooMany` | 增改 |
| `src/renderer/locales/zh-CN.json` | 同上次键 | 增改 |
| `src/main/file-search.test.ts` | `searchProjectFiles` 纯函数测试（AC-5/6/7/12/13） | 新增 |
| `src/renderer/components/explorer-search.test.ts` | stub `fs.searchFiles` + stub DOM 测交互（AC-2/3/4/10/13/14/15/18/19/20） | 新增 |
| `src/renderer/components/explorer-panel.test.ts` | 断言搜索框存在 + 关闭重置（AC-1/21） | 增改 |

## 11. 测试策略

- **主进程语义**（`file-search.test.ts`，纯函数，无 Electron）：构造含 `Store.ts`/`store.ts`/`src/store/index.ts`/`node_modules/...` 的路径数组，断言 AC-5（大小写）、AC-6/7（整路径子串含目录名）、AC-12（排序）、AC-13（截断 + `truncated`）、空/空白查询。
- **渲染交互**（`explorer-search.test.ts`，Vitest + 假计时器 + stub DOM，参照 `explorer-panel.test.ts` 的 `FakeElement`/`vi.mock` 风格）：stub `window.vibeyard.fs.searchFiles` 返回固定列表，验证渲染、排序透传、空态、截断脚注、Esc/清空/切项目重置、点击触发 `addFileReaderSession`；latest-wins 用两个 resolve 顺序颠倒的 Promise 断言旧结果被丢弃。
- **面板集成**（`explorer-panel.test.ts` 增补）：搜索框插入位置（AC-1）、关闭面板重置（AC-21）。
- 性能类约束不要求真实大仓库跑测（SPEC"可测试性说明"），以计时器与顺序断言替代。
