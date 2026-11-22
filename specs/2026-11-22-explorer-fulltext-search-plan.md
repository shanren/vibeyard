# Explorer 全文搜索 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 右侧 Explorer 搜索框上方加「路径 / 内容」tab；内容模式对整个项目做全文搜索（`git grep` 按仓库根并行 + Node 兜底），结果按文件分组、带行号与片段、点击跳转。

**Architecture:** 渲染层只加 UI 与模式路由，搜索引擎全部在主进程按需调用（`fs:searchText` IPC → `src/main/text-search.ts`）。仓库根发现复用 `src/main/file-enumeration.ts` 已有的剪枝/`.git` 探测逻辑。

**Tech Stack:** Electron (main/preload/renderer) · TypeScript · `child_process.execFile`（git） · `fs.promises` · esbuild · Vitest。

**Spec:** `specs/2026-11-22-explorer-fulltext-search.md`

## Global Constraints

- **零新依赖**：不得新增 npm 包；不得修改 `package.json` 依赖、`electron-builder` 配置或 CI。
- **启动时间硬约束**：不得在模块顶层 spawn 进程、读目录或预热缓存；一切工作只在 `fs:searchText` / 渲染层交互发生时进行。
- **不新增 Preferences 界面行**：`Preferences.explorerSearchMode` 只由 tab 自身写入。
- 路径约定：所有从主进程返回的路径都是**项目相对路径、`/` 分隔**（Windows 也是 `/`）。
- 限额常量（逐字使用）：`TEXT_SEARCH_MAX_MATCHES = 500`、`TEXT_SEARCH_MAX_PER_FILE = 20`、`TEXT_SEARCH_MAX_FILES = 200`、`TEXT_SEARCH_TIMEOUT_MS = 5000`、`TEXT_SEARCH_MAX_FILE_BYTES = 1024 * 1024`、`TEXT_SEARCH_MAX_LINE_CHARS = 400`。
- 匹配语义 v1：**不区分大小写的字面量**（`-F` + `-i`；Node 兜底用 `toLowerCase().indexOf`）。不做正则、大小写开关、整词、替换。
- 遵守 `.rcodeignore`（`buildRcodeIgnoreMatcher`）。
- i18n：新增 key 必须同时进 `src/renderer/locales/en.json` 与 `zh-CN.json`。
- 测试与源码同目录、`*.test.ts`；断言路径时用 `path.join`/`path.resolve` 构造期望值，禁止硬编码正斜杠字面量。
- 提交信息用 `feat:` / `test:` / `docs:` 前缀；用户未要求前不要 push。

## Review Focus

1. 查询含正则元字符（`a.*b`、`(`、`\`）或看起来像命令行选项（`-n`、`--all`）时，必须被当成**字面量**搜索，不得报错、不得被 git 当成选项。
2. 路径含空格、中文、`+`、`#`、`\]` 等特殊字符时，命中项路径必须完整正确（`-z` 解析不能串行/截断），点开能打开正确文件。
3. 命中二进制、GBK/UTF-16 文本或 >1MB 文件时，不得出现乱码行、不得让主进程卡死超过预算。
4. 命中数量巨大（如搜 `e`）时，必须在 5s 内返回、给出截断脚注，且结果列表仍可交互。
5. 搜索在途时切换项目 / 关闭 Explorer / 切换 tab：旧结果不得渲染到新项目或新模式上。

---

### Task 1: `findRepoRoots` —— 找出项目根与所有嵌套仓库根

**Files:**
- Modify: `src/main/file-enumeration.ts`（新增导出，复用 `isRepoRoot` / `SKIP_DIRS` / `ENUMERATE_MAX_DEPTH` / `cache`）
- Test: `src/main/file-enumeration.test.ts`

**Interfaces:**
- Consumes: 现有的 `isRepoRoot(dir)`、`SKIP_DIRS`、`ENUMERATE_MAX_DEPTH`、`ENUMERATION_CACHE_TTL_MS`、`const cache`。
- Produces: `export async function findRepoRoots(cwd: string): Promise<string[]>` —— 绝对路径数组；项目根本身是仓库时排第一，其后按目录名升序；缓存键 `repo:${path.resolve(cwd)}`，TTL 同 `ENUMERATION_CACHE_TTL_MS`；`clearEnumerationCache()` 必须同时失效它（同一 Map，天然满足）。

- [ ] **Step 1: Write the failing tests** —— 追加到 `src/main/file-enumeration.test.ts`：

```ts
describe('findRepoRoots', () => {
  it('returns the project root first when it is a repo, then nested repo roots', async () => {
    markRepo();
    markRepo('sub-a');
    markRepo('nested/sub-b');
    expect(await findRepoRoots(root)).toEqual([
      path.resolve(root),
      path.resolve(root, 'sub-a'),
      path.resolve(root, 'nested/sub-b'),
    ]);
  });

  it('finds a repo nested inside a non-repo root', async () => {
    markRepo('only-repo');
    expect(await findRepoRoots(root)).toEqual([path.resolve(root, 'only-repo')]);
  });

  it('returns [] for a plain directory with no repos', async () => {
    writeFile('a.ts');
    expect(await findRepoRoots(root)).toEqual([]);
  });

  it('does not descend into pruned directories', async () => {
    markRepo('node_modules/evil');
    expect(await findRepoRoots(root)).toEqual([]);
  });

  it('caches within the TTL, so a second call does not walk again', async () => {
    markRepo('sub-a');
    const readdir = vi.spyOn(fs.promises, 'readdir');
    await findRepoRoots(root);
    const afterFirst = readdir.mock.calls.length;
    await findRepoRoots(root);
    expect(readdir.mock.calls.length).toBe(afterFirst);
    readdir.mockRestore();
  });
});
```

（`beforeEach` 已调用 `clearEnumerationCache()`；若 `vi.spyOn(fs.promises, 'readdir')` 与本文件的 `fs` 真实实现冲突，改用真实临时目录计数即可。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/file-enumeration.test.ts -t findRepoRoots`
Expected: FAIL —— `findRepoRoots is not a function`（import 报错）。

- [ ] **Step 3: Implement `findRepoRoots`**

同一文件、`enumerateProjectFiles` 之后追加：内部 `async function visitRepos(absDir, depth, out)` 与 `visit` 同构（`isRepoRoot` 命中就 push 绝对路径，**仍然继续向下**，`SKIP_DIRS`/`ENUMERATE_MAX_DEPTH` 剪枝，`readdir` 失败静默返回）；`findRepoRoots` 负责 `path.resolve` + 缓存读写（键 `repo:` 前缀）。注意根目录先 push，保证"根排第一"。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/file-enumeration.test.ts`
Expected: PASS（原 11 个用例 + 新增 5 个）。

- [ ] **Step 5: Commit**

```bash
git add src/main/file-enumeration.ts src/main/file-enumeration.test.ts
git commit -m "feat: expose findRepoRoots for per-repo full-text search"
```

---

### Task 2: 结果类型 + `-z` 输出解析 + 合并/去重/限额（纯函数，无 I/O）

**Files:**
- Modify: `src/shared/types.ts`（`SearchFilesResult` 相邻处新增两个类型）
- Create: `src/main/text-search.ts`（本任务只放纯函数与常量）
- Test: `src/main/text-search.test.ts`

**Interfaces:**
- Produces（`src/shared/types.ts`）:
  - `export interface SearchTextMatch { path: string; line: number; text: string }`
  - `export interface SearchTextResult { matches: SearchTextMatch[]; truncated: boolean; engine: 'git' | 'walk'; tookMs: number }`
- Produces（`src/main/text-search.ts`）:
  - `export const TEXT_SEARCH_MAX_MATCHES = 500`（其余 5 个常量同 §Global Constraints）
  - `export function parseGitGrepOutput(stdout: string, prefix: string): SearchTextMatch[]` —— `prefix` 是该仓库根相对项目根的前缀（根仓库传 `''`，子仓库传 `'QIS_WF/'`）
  - `export function mergeMatches(groups: SearchTextMatch[], limit?: number): { matches: SearchTextMatch[]; truncated: boolean }`

**git `-z` 输出格式（已实测 git 2.48）：** `path\0line\0text\r\npath\0line\0text\r\n…`，所以 `split('\0')` 得到 `[p1, l1, "t1\np2", l2, "t2\np3", …]` —— 每个"文本"块的最后一行尾部是**下一个路径**。解析必须按这个形状走，不能用 `:` 切分。

- [ ] **Step 1: Write the failing tests** —— 新建 `src/main/text-search.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseGitGrepOutput, mergeMatches, TEXT_SEARCH_MAX_MATCHES } from './text-search';

describe('parseGitGrepOutput', () => {
  it('parses path/line/text triples from -z output', () => {
    const stdout = 'src/a.ts\012\0const x = 1;\nsrc/b.ts\07\0hit here\n';
    expect(parseGitGrepOutput(stdout, '')).toEqual([
      { path: 'src/a.ts', line: 12, text: 'const x = 1;' },
      { path: 'src/b.ts', line: 7, text: 'hit here' },
    ]);
  });

  it('strips CRLF line endings', () => {
    expect(parseGitGrepOutput('a.md\03\0text\r\n', '')).toEqual([
      { path: 'a.md', line: 3, text: 'text' },
    ]);
  });

  it('keeps paths with spaces, CJK and leading dashes intact', () => {
    const stdout = 'docs/项目 结构.md\09\0命中\n";
    expect(parseGitGrepOutput(stdout, 'QIS_WF/')).toEqual([
      { path: 'QIS_WF/docs/项目 结构.md', line: 9, text: '命中' },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseGitGrepOutput('', '')).toEqual([]);
  });

  it('truncates over-long matched lines to the display cap', () => {
    const long = 'x'.repeat(2000);
    const [match] = parseGitGrepOutput(`a.ts\01\0${long}\n`, '');
    expect(match.text.length).toBe(400);
  });
});

describe('mergeMatches', () => {
  it('dedupes on (path, line) and sorts by path then line', () => {
    const merged = mergeMatches([
      { path: 'b.ts', line: 9, text: 'b9' },
      { path: 'a.ts', line: 20, text: 'a20' },
      { path: 'a.ts', line: 3, text: 'a3' },
      { path: 'a.ts', line: 3, text: 'a3-duplicate' },
    ]);
    expect(merged.matches.map((m) => `${m.path}:${m.line}`)).toEqual(['a.ts:3', 'a.ts:20', 'b.ts:9']);
    expect(merged.truncated).toBe(false);
  });

  it('caps at the default limit and flags truncated', () => {
    const many = Array.from({ length: TEXT_SEARCH_MAX_MATCHES + 5 }, (_, i) => ({
      path: 'a.ts', line: i + 1, text: 'x',
    }));
    const merged = mergeMatches(many);
    expect(merged.matches).toHaveLength(TEXT_SEARCH_MAX_MATCHES);
    expect(merged.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/text-search.test.ts`
Expected: FAIL —— 模块/导出不存在。

- [ ] **Step 3: Implement types + pure functions**

`src/shared/types.ts` 加两个类型（注释写明"路径为项目相对、`/` 分隔"）。`text-search.ts` 实现：`parseGitGrepOutput` 按上文的 `parts[i]`/`parts[i+1]` 步进、用 `lastIndexOf('\n')` 切出文本与下一个路径、`replace(/\r$/, '')`、按 `TEXT_SEARCH_MAX_LINE_CHARS` 截断、`Number.parseInt` 失败则跳过该条；`mergeMatches` 用 `Set` 去重键 `` `${path}\0${line}` ``、`localeCompare(b, undefined, { sensitivity: 'base' })` 排序、`slice(0, limit)`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/text-search.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/text-search.ts src/main/text-search.test.ts
git commit -m "feat: parse git grep -z output and merge text-search matches"
```

---

### Task 3: `searchText` 引擎 —— git 并行分支 + Node 兜底

**Files:**
- Modify: `src/main/text-search.ts`
- Test: `src/main/text-search.test.ts`

**Interfaces:**
- Consumes: `findRepoRoots(cwd)`（Task 1）、`enumerateProjectFiles(cwd)`、`parseGitGrepOutput` / `mergeMatches`（Task 2）、`buildRcodeIgnoreMatcher(cwd)`（`src/main/rcodeignore.ts`）。
- Produces: `export async function searchText(cwd: string, query: string): Promise<SearchTextResult>`
  - 空白 query → `{ matches: [], truncated: false, engine: 'git', tookMs: 0 }`（不 spawn 任何进程）。
  - 有仓库根 → 并行 `git grep`，`engine: 'git'`；无仓库根（或全部根都失败）→ Node 扫描，`engine: 'walk'`。
  - 单个根失败只回落该根到 Node 扫描（用 `enumerateProjectFiles` 结果里以该根为前缀的文件）。

- [ ] **Step 1: Write the failing tests** —— 追加到 `src/main/text-search.test.ts`（沿用 `file-enumeration.test.ts` 的 `vi.mock('child_process')` + 真实临时目录写法）：

```ts
it('runs git grep in every repo root and prefixes nested results', async () => {
  // root 是仓库（回复 'AGENTS.md\01\0hit\n'），并嵌套 sub-a 仓库（回复 'pom.xml\02\0hit\n'）
  const result = await searchText(root, 'hit');
  expect(result.engine).toBe('git');
  expect(result.matches).toEqual([
    { path: 'AGENTS.md', line: 1, text: 'hit' },
    { path: 'sub-a/pom.xml', line: 2, text: 'hit' },
  ]);
  expect(gitCalls.map((c) => c.args.join(' '))).toEqual([
    expect.stringContaining('-F'), expect.stringContaining('-F'),
  ]);
});

it('passes the query as a literal -e argument after --', async () => {
  markRepo();
  replyFor('', '');
  await searchText(root, '-n a.*b');
  expect(gitCalls[0].args.slice(-3)).toEqual(['--', '-e', '-n a.*b']);
});

it('falls back to walking when git fails for a root', async () => {
  markRepo();
  writeFile('src/app.ts'); // 内容含 'needle'
  gitReplies.set(path.resolve(root), new Error('git: old version'));
  const result = await searchText(root, 'needle');
  expect(result.engine).toBe('walk');
  expect(result.matches).toEqual([{ path: 'src/app.ts', line: 1, text: expect.stringContaining('needle') }]);
});

it('skips binaries, files over 1MB and rcodeignored files in the walk engine', async () => {
  writeFile('bin.dat', 'needle\0needle');      // NUL 头 → 二进制
  writeFile('huge.ts', 'needle'.repeat(200000)); // > 1MB
  writeFile('hidden.ts', 'needle');            // .rcodeignore 命中
  writeFile('.rcodeignore', 'hidden.ts\n');
  writeFile('ok.ts', 'a needle b');
  const result = await searchText(root, 'needle');
  expect(result.matches.map((m) => m.path)).toEqual(['ok.ts']);
});

it('returns no matches without spawning anything for a blank query', async () => {
  markRepo();
  expect(await searchText(root, '   ')).toEqual({ matches: [], truncated: false, engine: 'git', tookMs: 0 });
  expect(gitCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/text-search.test.ts -t searchText`
Expected: FAIL —— `searchText is not a function`。

- [ ] **Step 3: Implement `searchText`**

结构：`searchText` 记 `started = Date.now()` → 空白短路 → `findRepoRoots` → 有根则 `Promise.all(roots.map(gitGrepOne))` 并把失败根收集起来 → 失败根与"无根"情况都交给 `walkSearch(dirRelPrefixes)` → `mergeMatches` → 回填 `engine`/`tookMs`/`truncated`。`gitGrepOne(dir)` 用 `execFile('git', ['grep','-z','-n','-I','-i','-F','--untracked','--no-color','--max-count='+TEXT_SEARCH_MAX_PER_FILE,'--', '-e', query], { cwd: dir, encoding: 'utf-8', timeout: TEXT_SEARCH_TIMEOUT_MS, maxBuffer: 32*1024*1024 })`。`walkSearch` 用 `enumerateProjectFiles` 候选集 + `buildRcodeIgnoreMatcher` + 32 并发读文件：`stat` > 1MB 跳过、头部 8000 字节含 `\0` 跳过、按 `\n` 切行后用 `toLowerCase().indexOf` 累计 `TEXT_SEARCH_MAX_PER_FILE` 条/文件与 `TEXT_SEARCH_MAX_FILES` 个文件、超 `TEXT_SEARCH_TIMEOUT_MS` 预算即停并置 `truncated`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/text-search.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/text-search.ts src/main/text-search.test.ts
git commit -m "feat: search project text via git grep with walk fallback"
```

---

### Task 4: IPC + preload 曝光

**Files:**
- Modify: `src/main/ipc-handlers.ts`（`fs:searchFiles` 之后新增 handler）
- Modify: `src/preload/preload.ts`（`fs` 命名空间 + 接口声明）

**Interfaces:**
- Consumes: `searchText(cwd, query)`（Task 3）。
- Produces: `window.rcode.fs.searchText(cwd: string, query: string): Promise<SearchTextResult>` ↔ IPC 通道名 `'fs:searchText'`。

- [ ] **Step 1: 先加 preload 声明，让类型检查失败**

`preload.ts` 的 `fs` 接口加 `searchText(cwd: string, query: string): Promise<SearchTextResult>;`，实现里加 `searchText: (cwd, query) => ipcRenderer.invoke('fs:searchText', cwd, query),`，并 import `SearchTextResult`。

- [ ] **Step 2: Run typecheck to verify the handler side is missing**

Run: `npx tsc -p tsconfig.preload.json --noEmit && npx tsc -p tsconfig.main.json --noEmit`
Expected: 主进程 PASS（handler 还没引用新类型），preload PASS；人工确认 `ipc-handlers.ts` 里还搜不到 `fs:searchText`（`grep -n "fs:searchText" src/main/ipc-handlers.ts` 无输出）。

- [ ] **Step 3: Implement the handler**

照 `fs:searchFiles` 的结构：`ipcMain.handle('fs:searchText', async (_event, cwd: string, query: string) => …)`，先 `isWithinKnownProject(path.resolve(cwd))` 白名单校验，空白 query 直接返回空结果，`try/catch` 失败返回空结果 + `console.warn('fs:searchText failed:', err)`。

- [ ] **Step 4: Run typecheck + full suite**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.preload.json --noEmit && npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/preload.ts
git commit -m "feat: expose fs:searchText IPC"
```

---

### Task 5: `Preferences.explorerSearchMode` + i18n key

**Files:**
- Modify: `src/shared/types.ts`（`Preferences` 内）
- Modify: `src/renderer/locales/en.json`、`src/renderer/locales/zh-CN.json`（`explorer` 节）
- Test: `src/renderer/i18n.test.ts`（若有 key 一致性守卫则补；没有就补一个针对本模式的用例）

**Interfaces:**
- Produces: `Preferences.explorerSearchMode?: 'path' | 'content'`（缺省视为 `'path'`）。
- Produces i18n key：`explorer.searchMode.path`、`explorer.searchMode.content`、`explorer.searchTextPlaceholder`、`explorer.searchTextNoResults`、`explorer.searchTextTruncated`、`explorer.searching`。

- [ ] **Step 1: Write the failing test**

`src/renderer/i18n.test.ts` 追加：

```ts
it('has both locales for the explorer search-mode keys', () => {
  const keys = [
    'explorer.searchMode.path',
    'explorer.searchMode.content',
    'explorer.searchTextPlaceholder',
    'explorer.searchTextNoResults',
    'explorer.searchTextTruncated',
    'explorer.searching',
  ];
  for (const locale of ['en', 'zh-CN'] as const) {
    setLocale(locale);
    for (const key of keys) expect(t(key)).not.toBe(key);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/i18n.test.ts -t search-mode`
Expected: FAIL（`t()` 返回 key 本身）。

- [ ] **Step 3: Add the preference field and both catalogs**

英文：`Path` / `Content`、`Search file contents`、`No matches found`、`500+ matches — refine your query`、`Searching…`；中文：`路径` / `内容`、`搜索文件内容`、`没有匹配项`、`500+ 个匹配 — 请缩小范围`、`搜索中…`。

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/i18n.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/renderer/locales src/renderer/i18n.test.ts
git commit -m "feat: add explorer search mode preference and i18n keys"
```

---

### Task 6: 渲染层 tab + 内容结果渲染 + 模式持久化

**Files:**
- Modify: `src/renderer/index.html`（`#explorer-search` 内，输入框之前加 tab strip）
- Modify: `src/renderer/styles/explorer-panel.css`（tab strip 样式，沿用 `sidebar.css:329` 的 segmented 观感，只用 `--app-*`/`--vscode-*` token）
- Modify: `src/renderer/components/explorer-search.ts`（模式状态、请求路由、分组渲染）
- Test: `src/renderer/components/explorer-search.test.ts`

**Interfaces:**
- Consumes: `window.rcode.fs.searchFiles`（现状）、`window.rcode.fs.searchText`（Task 4）、`Preferences.explorerSearchMode` + i18n key（Task 5）、`appState.addFileReaderSession(projectId, filePath, lineNumber?)`、`appState.setPreference('explorerSearchMode', mode)`。
- Produces: `export type ExplorerSearchMode = 'path' | 'content'` 与 `export function setExplorerSearchMode(mode: ExplorerSearchMode): void`（供 Task 7 的快捷键调用；后者同时负责聚焦输入框）。

- [ ] **Step 1: Write the failing tests**

在 `src/renderer/components/explorer-search.test.ts` 追加（沿用该文件既有的 DOM fixture 写法，需在 fixture 里补 `#explorer-search-tabs` 两个按钮）：

```ts
it('calls searchText instead of searchFiles in content mode', async () => {
  setExplorerSearchMode('content');
  setQuery('needle');
  await flushDebounce();
  expect(searchTextSpy).toHaveBeenCalledWith(projectPath, 'needle');
  expect(searchFilesSpy).not.toHaveBeenCalled();
});

it('re-runs the current query when the tab changes', async () => {
  setQuery('needle');
  await flushDebounce();
  searchFilesSpy.mockClear();
  setExplorerSearchMode('content');
  await flushDebounce();
  expect(searchTextSpy).toHaveBeenCalledWith(projectPath, 'needle');
});

it('renders matches grouped by file with line numbers and opens at the line', async () => {
  setExplorerSearchMode('content');
  setQuery('needle');
  await flushDebounce();
  expect(resultsEl.querySelectorAll('.explorer-search-file-header')).toHaveLength(2);
  expect(resultsEl.querySelector('.explorer-search-line-no')!.textContent).toBe('12');
  clickFirstMatch();
  expect(addFileReaderSession).toHaveBeenCalledWith(projectId, 'src/a.ts', 12);
});

it('persists the chosen mode', () => {
  setExplorerSearchMode('content');
  expect(setPreference).toHaveBeenCalledWith('explorerSearchMode', 'content');
});

it('drops stale results when the mode changes mid-flight', async () => {
  const pending = setQuery('needle', { defer: true });
  setExplorerSearchMode('path');
  resolveDeferred(pending, { pathMatches: ['a.ts'] });
  await flushDebounce();
  expect(resultsEl.textContent).not.toContain('needle');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/explorer-search.test.ts`
Expected: FAIL —— `setExplorerSearchMode is not a function`。

- [ ] **Step 3: Implement tab strip + routing + grouped rendering**

`index.html` 加：
```html
<div id="explorer-search-tabs" role="tablist">
  <button id="explorer-tab-path" class="explorer-search-tab" role="tab" aria-selected="true"></button>
  <button id="explorer-tab-content" class="explorer-search-tab" role="tab" aria-selected="false"></button>
</div>
```
`explorer-search.ts`：`mode` 由 `appState.preferences.explorerSearchMode ?? 'path'` 初始化；`runSearch()` 按模式选 `searchFiles`/`searchText`（内容模式防抖 300ms、路径模式保持 150ms）；内容结果渲染为 `.explorer-search-file` 容器（`.explorer-search-file-header` = 文件名 + 命中数，内部 `.explorer-search-line` 行 = `.explorer-search-line-no` + `.explorer-search-line-text`），点击行调 `addFileReaderSession(projectId, match.path, match.line)`；`truncated` 用 `explorer.searchTextTruncated`，无命中用 `explorer.searchTextNoResults`；`resetExplorerSearch()` 清 tab 状态时不改模式（模式是持久偏好）。

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/renderer/components/explorer-search.test.ts && npm run build`
Expected: PASS 且构建成功。

- [ ] **Step 5: Visual check**

Run: `npm run dev:web:watch`（另一终端 `node dev/shot.js out.png`）
Expected: tab 可见、两种模式切换、内容结果有文件名/行号/片段三种视觉层级，浅色主题下同样可读。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/styles/explorer-panel.css src/renderer/components/explorer-search.ts src/renderer/components/explorer-search.test.ts
git commit -m "feat: add path/content tabs to explorer search"
```

---

### Task 7: 快捷键 `CmdOrCtrl+Shift+E`

**Files:**
- Modify: `src/renderer/shortcuts.ts`（`Search & Help` 组新增一条；**不得**占用已被 `session-search` 使用的 `CmdOrCtrl+Shift+F`）
- Modify: `src/renderer/keybindings.ts`（注册 handler）
- Modify: `src/renderer/components/explorer-search.ts`（导出 `focusExplorerContentSearch()`）
- Test: `src/renderer/components/explorer-search.test.ts`

**Interfaces:**
- Consumes: `setExplorerSearchMode('content')`（Task 6）、`appState.setExplorerPanelOpen(true)`、`toggleExplorerPanel`（`explorer-panel.ts`）。
- Produces: 快捷键 id `explorer-search-text`，label `Search in Project`，category `Search & Help`，默认 `CmdOrCtrl+Shift+E`；`export function focusExplorerContentSearch(): void`。

- [ ] **Step 1: Write the failing test**

```ts
it('focusExplorerContentSearch opens the panel, switches mode and focuses the input', () => {
  focusExplorerContentSearch();
  expect(appState.setExplorerPanelOpen).toHaveBeenCalledWith(true);
  expect(activeTab()).toBe('content');
  expect(document.activeElement).toBe(inputEl);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/explorer-search.test.ts -t focusExplorerContentSearch`
Expected: FAIL —— 导出不存在。

- [ ] **Step 3: Implement shortcut + handler**

`shortcuts.ts` 加 `{ id: 'explorer-search-text', label: 'Search in Project', category: 'Search & Help', defaultKeys: 'CmdOrCtrl+Shift+E' }`；`keybindings.ts` 加 `shortcutManager.registerHandler('explorer-search-text', focusExplorerContentSearch)`；`explorer-search.ts` 实现该函数（开面板 → 切内容模式 → `inputEl.focus()`）。

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/components/explorer-search.test.ts src/renderer/shortcuts.test.ts && npm run build`
Expected: PASS。

- [ ] **Step 5: Manual check**

启动应用按 `CmdOrCtrl+Shift+E`：Explorer 打开、tab 在「内容」、光标在输入框；在快捷键设置里能改绑。`CmdOrCtrl+Shift+F` 仍打开 session search。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shortcuts.ts src/renderer/keybindings.ts src/renderer/components/explorer-search.ts src/renderer/components/explorer-search.test.ts
git commit -m "feat: shortcut to focus explorer content search"
```

---

### Task 8: 启动预算验证 + 文档

**Files:**
- Modify: `CLAUDE.md`（Key Components 或新增小节，说明 `text-search.ts` 与 tab）

**Interfaces:**
- Consumes: 前面所有任务。

- [ ] **Step 1: 记录基线**

```bash
git stash -u                      # 回到改动前的代码
RCODE_TIMING=1 npm start          # 跑 3 次，每次记录 startup.log 末尾块的 first paint / black screen
cp ~/.rcode/startup.log /tmp/startup-before.log
git stash pop
```

- [ ] **Step 2: 记录改动后**

```bash
RCODE_TIMING=1 npm start          # 跑 3 次
cp ~/.rcode/startup.log /tmp/startup-after.log
diff <(grep -E "first paint|black screen" /tmp/startup-before.log | tail -6) \
     <(grep -E "first paint|black screen" /tmp/startup-after.log  | tail -6)
```
Expected: 指标同量级（无退化）。若退化，先查是否有人在模块顶层做了工作——这是阻塞项，不得带病合并。

- [ ] **Step 4: Update `CLAUDE.md`**

新增一小段：全文搜索的引擎选择（`git grep` per repo root + Node 兜底）、限额常量、`fs:searchText`、tab 与 `Preferences.explorerSearchMode`、以及"不得在启动路径预热"的理由。

- [ ] **Step 5: Run the full suite + build**

Run: `npm run build && npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document explorer full-text search"
```

---

## Self-Review

- **Spec coverage**：§2 交互 → Task 6/7；§3.1 `findRepoRoots` → Task 1；§3.2 引擎 + 限额 → Task 2/3；§3.3 契约/IPC → Task 2/4；§4 启动约束 → Global Constraints + Task 8；§5 边界 → Task 3（二进制/大文件/rcodeignore/空白）+ Task 6（陈旧结果）；§6 测试 → 每个任务的 Step 1；§7 依据 → 引擎选择理由（spec）；§8 风险 → 不在代码内实现，按 spec 记为后续版本。
- **Step 扫描**：每个 Step 只决定一件事；无 TBD / "handle edge cases"。
- **类型一致性**：`SearchTextMatch{path,line,text}`、`SearchTextResult{matches,truncated,engine,tookMs}`、`findRepoRoots`、`searchText`、`setExplorerSearchMode`、`focusExplorerContentSearch`、`explorerSearchMode`、通道名 `fs:searchText` 在 Task 1–8 中一致。
- **Review Focus 对应测试**：1 → Task 2 `keeps paths with … leading dashes` + Task 3 `passes the query as a literal -e argument after --`；2 → Task 2 `keeps paths with spaces, CJK`；3 → Task 3 `skips binaries, files over 1MB`；4 → Task 2 `caps at the default limit`；5 → Task 6 `drops stale results when the mode changes mid-flight`。
- **比例**：计划约 1.2 倍于 spec 长度，代码块只出现在测试断言与必要的 HTML/git 参数上。
