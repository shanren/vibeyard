---
id: TASK-002
depends_on: [TASK-001]
---
# fs:searchFiles IPC 处理器 + preload / renderer 类型桥

## 描述

新增 `fs:searchFiles` IPC 通道，复用既有 `enumerateProjectFiles` 枚举核心 + TASK-001 的 `searchProjectFiles` 纯函数，并在 preload 与 renderer 三处同步类型桥。数据流见 DESIGN §4 主进程侧：

```
ipcMain.handle('fs:searchFiles', (_event, cwd: string, query: string) => {
  // 1. query.trim() === '' → { files: [], truncated: false }（不触发遍历，AC-2/AC-10 防御性短路）
  // 2. path.resolve(cwd) → isWithinKnownProject 校验，false → { files: [], truncated: false }
  // 3. enumerateProjectFiles(resolvedCwd)（git ls-files 快路径 / 非 git 回退 IGNORE+点文件）
  // 4. searchProjectFiles(files, query)（默认 limit = SEARCH_FILES_LIMIT = 500）
  // 5. try/catch → console.warn → { files: [], truncated: false }（异常兜底）
});
```

契约见 DESIGN §3.3「主进程 IPC」。**遍历复用 `enumerateProjectFiles` 原样**（`src/main/ipc-handlers.ts:80`），不引入 `ignore` npm 包、不改其内部忽略逻辑——因此 `node_modules`/`.git`/`.gitignore` 命中文件/隐藏文件天然排除（AC-9），未展开/未加载目录因全量枚举而覆盖（AC-8）。

**文件**
- Modify: `src/main/ipc-handlers.ts`（新增 `fs:searchFiles` handler，置于 `fs:listFiles` 附近）
- Modify: `src/preload/preload.ts`（`fs` 命名空间接口 + 实现各加一行）
- Modify: `src/renderer/types.ts`（`VibeyardApi.fs` 接口加一行）

**接口契约**
- Consumes:
  - `searchProjectFiles`、`SEARCH_FILES_LIMIT`（`src/main/file-search.ts`，TASK-001）
  - `SearchFilesResult`（`src/shared/types.ts`，TASK-001）
  - 既有 `enumerateProjectFiles`、`isWithinKnownProject`（`src/main/ipc-handlers.ts`，本文件内部函数）
- Produces:
  - `window.vibeyard.fs.searchFiles(cwd: string, query: string): Promise<SearchFilesResult>`
  - 通道名 `'fs:searchFiles'`，请求 `(cwd: string, query: string)`，响应 `SearchFilesResult`

> 三处类型同步（DESIGN §3.3）：
> - `preload/preload.ts` 接口：`searchFiles(cwd: string, query: string): Promise<SearchFilesResult>;`，实现 `searchFiles: (cwd, query) => ipcRenderer.invoke('fs:searchFiles', cwd, query),`
> - `renderer/types.ts` 接口：同签名；`SearchFilesResult` 加入该文件顶部的 `import type { ... }`（第 2 行，与 `TopFilesResult` 并列）

## Acceptance Criteria

- [ ] AC-1（SPEC AC-8 递归覆盖未加载目录）：handler 通过 `enumerateProjectFiles(resolvedCwd)` 全量枚举，未展开目录下的文件（如 `a/b/c/deep-file.ts`）可被枚举 → 经 `searchProjectFiles` 命中
- [ ] AC-2（SPEC AC-9 忽略文件排除）：遍历复用 `enumerateProjectFiles`（git `ls-files --exclude-standard` 快路径 / 非 git 回退 `IGNORE` 集合 + 跳点文件），`node_modules`/`.git`/`.gitignore` 命中/隐藏文件永不进入结果
- [ ] AC-3（SPEC AC-2 / AC-10 后端防御）：`query.trim()` 为空（空串或纯空白）时直接返回 `{ files: [], truncated: false }`，不触发 `enumerateProjectFiles`
- [ ] AC-4（安全守卫）：非已知项目（`isWithinKnownProject(path.resolve(cwd)) === false`）返回 `{ files: [], truncated: false }`
- [ ] AC-5（异常兜底）：枚举/匹配抛异常时 `console.warn` 并返回 `{ files: [], truncated: false }`（与 `fs:listFiles` 口径一致）
- [ ] AC-6（类型桥）：`npm run build` 全绿；`window.vibeyard.fs.searchFiles` 在 preload 与 renderer 类型中均可见且签名一致
- [ ] AC-7（截断透传）：命中 > 500 时返回 `{ files: 500 项, truncated: true }`（由 `searchProjectFiles` 默认 limit 保证）
