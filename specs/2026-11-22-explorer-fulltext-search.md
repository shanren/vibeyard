# Explorer 全文搜索（路径 / 内容 tab）设计

日期：2026-11-22
状态：待批准
阶段：实现前设计（批准后进入 writing-plans 出实施计划）
方案选择：**C —— `git grep` 按仓库根各打一次 + Node 兜底**（实测见 §7）

## 1. 目标与非目标

**目标**：右侧 Explorer 搜索框上方加一组 tab「路径 / 内容」。切到内容后，对整个项目做全文搜索（VS Code 式全局搜索），结果按文件分组，带行号与命中片段，点击打开文件并跳到该行。

**非目标**：不做替换（replace in files）；不做正则 / 大小写敏感 / 整词开关（v1 固定为**不区分大小写的字面量**）；不做搜索结果文件树的折叠展开动画；不改 `Ctrl+P` quick-open（它仍是模糊文件名跳转）。

**反目标**：为了"像 VS Code"而引入 ripgrep 依赖或改打包链路（那会动到已经不稳的安装包与 CI）；在启动路径上预热任何东西（搜索必须在 IPC 调用时才发生）。

## 2. 用户可见行为

```
┌─ EXPLORER ───────────────┐
│ [ 路径 ][ 内容 ]         │  ← tab strip（35px，沿用 sidebar 的 segmented 样式）
│ ┌──────────────────────┐ │
│ │ 搜索文件内容…        │ │  ← 同一输入框，placeholder 随模式变
│ └──────────────────────┘ │
│ src/main/text-search.ts  │  ← 结果按文件分组：文件名 + 命中数
│   12  const q = query…   │     每行：行号（暗）+ 片段（纯文本，v1 不高亮）
│   48  return matches…    │
└──────────────────────────┘
```

- 默认模式 = 上次选择的模式，持久化在 `Preferences.explorerSearchMode: 'path' | 'content'`，默认 `'path'`；**不新增 Preferences 界面行**（tab 本身就是开关，再加一行是重复）。
- 切换 tab 保留输入内容并立即用新引擎重跑（不重新打字）。
- 输入防抖 300ms（路径搜索现为 150ms，内容模式单独 300ms）；`Escape` 清空并回到文件树；查询为空白 = 恢复文件树（与现在一致）。
- 进行中显示 `搜索中…`；旧请求结果一律丢弃（沿用 `searchSeq` 序号守卫）。
- 命中超过上限时底部显示截断脚注，措辞与路径搜索的 `500+ matches — refine your query` 一致。
- 命中片段按纯文本渲染（`textContent`），v1 **不做命中高亮**——高亮需要按查询串切分片段并注入 `<span>`，等正则/大小写开关一起做（见 §8）。
- 点击某行 → `appState.addFileReaderSession(projectId, relPath, line)`（`quick-open.ts:154` 已在用的落点，file reader 打开后 `scrollToLine`）。
- 快捷键 `Ctrl/Cmd+Shift+E`：打开 Explorer（若关着）、切到内容 tab、聚焦输入框。（`Ctrl/Cmd+Shift+F` 已被 `session-search` 占用，不能用。）

## 3. 架构与数据流

```
renderer/explorer-search.ts  (tab 状态 + 分组渲染)
   ├─ 路径模式 ─→ window.rcode.fs.searchFiles(cwd, q)   ── 现状不变
   └─ 内容模式 ─→ window.rcode.fs.searchText(cwd, q)    ← 新增
                        ↓ main/ipc-handlers.ts  ipcMain.handle('fs:searchText')
                        ↓ main/text-search.ts  searchText(root, query)
                        ├─ findRepoRoots(root)            ← file-enumeration.ts 新增导出
                        ├─ 有仓库根 → 并行 git grep（每根一次）
                        └─ 无仓库根 → Node 逐文件扫描（限额 + 预算）
```

### 3.1 `file-enumeration.ts` 新增导出

```ts
/** 项目根及其中所有「自己的 .git」子目录（绝对路径），供全文搜索按仓库分治。 */
export async function findRepoRoots(cwd: string): Promise<string[]>
```

复用现有 `SKIP_DIRS` / `ENUMERATE_MAX_DEPTH` 剪枝规则与 `.git` 探测（`isRepoRoot`），只收集根、不列文件。与 `enumerateProjectFiles` 共用 2s 缓存窗口策略（同一 Map，键加前缀 `repo:`）。

### 3.2 引擎 `src/main/text-search.ts`

```ts
export const TEXT_SEARCH_MAX_MATCHES = 500;
export const TEXT_SEARCH_MAX_PER_FILE = 20;
export const TEXT_SEARCH_MAX_FILES = 200;
export const TEXT_SEARCH_TIMEOUT_MS = 5000;
export const TEXT_SEARCH_MAX_FILE_BYTES = 1024 * 1024;
export const TEXT_SEARCH_MAX_LINE_CHARS = 400;

export interface SearchTextMatch { path: string; line: number; text: string }
export interface SearchTextResult {
  matches: SearchTextMatch[];
  truncated: boolean;            // 命中被上限/timeout 截断
  engine: 'git' | 'walk';
  tookMs: number;
}
export async function searchText(cwd: string, query: string): Promise<SearchTextResult>
```

**git 分支**（`findRepoRoots` 非空）：对每个根并行执行

```
git grep -z -n -I -i -F --untracked --no-color \
         --max-count=<TEXT_SEARCH_MAX_PER_FILE> -e <query> --
```

- `-F` 字面量、`-i` 不区分大小写、`-I` 跳过二进制、`--untracked` 覆盖未跟踪文件、`--max-count` 限每文件命中。
- `-z` 输出格式为 `path\0line\0text\n`（已在 git 2.48 实测），路径含空格/中文/CD 盘符都无歧义；解析时 strip 行尾 `\r`。
- 结果路径加「根相对项目根」前缀（`QIS_WF/`），统一 `/` 分隔。
- 单个根失败（旧 git 无 `--untracked`、非仓库、timeout）→ 该根回落到 Node 扫描，不整体失败。
- 各根 `execFile` 并行，`maxBuffer` 与 `timeout` 上限防爆。

**Node 兜底**：`enumerateProjectFiles` 的候选集 → 32 并发读文件：`stat` 超 1MB 跳过、头部 8KB 含 `\0` 视为二进制跳过、`.rcodeignore` 命中的跳过；逐行 `toLowerCase().includes()`，命中累积到上限或预算耗尽即停。

**合并**：所有命中按 `path` 大小写不敏感 → `line` 升序排序；同一 `(path,line)` 去重（外层仓库和子仓库同时跟踪同一文件时会出现）；总命中截到 500 并置 `truncated`。

### 3.3 契约与 IPC

- `src/shared/types.ts`：新增 `SearchTextMatch` / `SearchTextResult`（与 `SearchFilesResult` 相邻，注释说明路径是「项目相对、`/` 分隔」）。
- `src/preload/preload.ts`：`fs.searchText(cwd, query): Promise<SearchTextResult>`。
- 主进程沿用 `isWithinKnownProject` 白名单校验（与 `fs:searchFiles` 完全一致），空白查询直接短路返回空结果。

## 4. 启动时间：硬约束

本次改动**不允许**触碰启动路径。逐条核对：

| 风险 | 处置 |
|---|---|
| 新依赖 | 无。git 已是硬依赖（路径搜索在用），不新增 npm 包，不改 electron-builder / CI |
| 模块加载成本 | 新增两个模块（`text-search.ts`、tab UI），编译后约 +6KB 主进程 JS +4KB 渲染层；主进程 bundle 解析量级 ≪ 1ms |
| 隐式预热 | 禁止。`child_process` 不在模块顶层 spawn，`findRepoRoots`/枚举只在 `fs:searchText` 到达时调用 |
| 目录遍历 | 惰性 + 2s 缓存（上一版已如此）；`Ctrl+Shift+F` 前不会有任何 walk |
| IPC 注册 | 多一个 `ipcMain.handle`，微秒级 |
| 结果渲染 | 分组渲染上限 500 行，一次性 DOM 构建；不复用 xterm/monaco |

**验收**：用 `RCODE_TIMING=1 npm start` 各跑 3 次，`~/.rcode/startup.log` 的 `first paint` 与 `black screen` 时长与改动前相比不退化（改动前基线先记录一次）。

## 5. 错误与边界

- 查询空白 / 只有空格 → 不触发任何进程，恢复文件树。
- git 不存在或版本过旧 → 全部走 Node 扫描（仍可用，只是慢；5s 预算 + 截断脚注说明）。
- 项目不是 git 仓库（如散装目录）→ 全走 Node 扫描。
- 超大单文件（>1MB）、二进制、`.rcodeignore` 命中 → 跳过，不报错。
- 主进程异常 → 返回空结果 + `console.warn`（与 `fs:searchFiles` 一致，不抛给渲染层）。
- 切换 tab / 关面板 / 切项目 → 递增序号丢弃在途结果、清空结果区（沿用 `resetExplorerSearch`）。

## 6. 测试

| 层 | 用例 |
|---|---|
| `file-enumeration.test.ts` | `findRepoRoots` 返回根 + 嵌套仓库根；深度/剪枝生效；非仓库目录返回空 |
| `text-search.test.ts`（新） | `-z` 输出解析（含 CRLF、含空格/中文路径）；嵌套根前缀拼接；`(path,line)` 去重；每文件/总数/文件数上限与 `truncated`；git 失败回落 Node 扫描；Node 扫描跳过二进制、>1MB、`.rcodeignore`；预算耗尽截断；排序稳定 |
| `explorer-search.test.ts` | tab 切换 → 调用 `searchText` 而非 `searchFiles`；placeholder 随模式变；切 tab 复用当前查询；分组 DOM（文件名 + 行号 + 片段）；点击传 `line`；`Escape` 复位；模式写入 preference |
| 手动 | `dev/shot.js` 截图查视觉；`Ctrl+Shift+F` 焦点；点击跳行；`startup.log` 对比 |

## 7. 依据：本机实测（`E:/Project/QIS`，7536 文件 / ~165MB 文本 / 8242 文本文件）

| 引擎 | 耗时 | 结论 |
|---|---|---|
| `git grep` × 5 仓库（串行） | 1.2s | 并行后 ~0.4s，可接受 |
| `git grep` × 1 仓库（`QIS_WF`，312 文件） | 141ms | 单仓库体验接近即时 |
| Node 池化扫描（32 并发） | 2.8s | 仅作兜底 |
| ripgrep | 112ms | 快 25 倍，但需新增二进制依赖与打包改动 → 不选 |

## 8. 风险与后续

1. **超大仓库**（10 万文件）`git grep` 也会到秒级 → 5s 超时 + 截断提示；后续可换 ripgrep（引擎藏在 `searchText()` 后面，替换只动 `text-search.ts`）。
2. **正则 / 大小写 / 整词开关** 留待 v2（`git grep` 与 ripgrep 都原生支持，Node 兜底需自己实现）。
3. **替换** 需要写盘与 diff 预览，明确不在本设计内。
4. Windows 路径分隔符：内部统一 `/`，落盘打开时由 `resolveFilePath` 拼 `project.path + '/' + relPath`（`file-reader.ts:117`）。
