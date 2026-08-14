---
id: TASK-001
depends_on: []
---
# 主进程纯函数 searchProjectFiles（匹配 / 排序 / 截断）+ 单元测试

## 描述

实现架构师锁定的主进程纯匹配模块 `src/main/file-search.ts`：`searchProjectFiles(allFiles, query, limit)` + `SEARCH_FILES_LIMIT` 常量，并在 `src/shared/types.ts` 新增跨进程类型 `SearchFilesResult`。纯函数、无 I/O、无 Electron，可脱离 Electron 直接单测。

契约见 DESIGN §3.2 / §3.3：

- `SEARCH_FILES_LIMIT = 500`
- `searchProjectFiles` 做「大小写不敏感子串过滤 → 大小写不敏感字典序排序 → 截断到 `limit` 并置 `truncated` 标志」，代码原样：

```ts
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

> `sensitivity: 'base'` 与 `file-tree.ts` 的 `sortEntries` 一致，是该代码库既有大小写不敏感排序惯例，天然满足 AC-12 的 `a.ts → B.ts → src/x.ts → Z.ts` 顺序。

**本任务只覆盖纯函数与类型，不涉及 IPC / 遍历。** 空查询 / 纯空白的归一化与短路由 TASK-002（IPC 处理器）与 TASK-003（renderer `normalizeQuery`）负责——纯函数仅在查询已归一为非空时被调用，因此**不要**给纯函数加空查询守卫，严格按 DESIGN §3.3 代码实现。

**文件**
- Create: `src/main/file-search.ts`
- Test: `src/main/file-search.test.ts`
- Modify: `src/shared/types.ts`（新增 `SearchFilesResult`）

**接口契约**
- Consumes: 无（纯函数 + 类型，无上游依赖）
- Produces:
  - `searchProjectFiles(allFiles: string[], query: string, limit?: number): SearchFilesResult`
  - `SEARCH_FILES_LIMIT: number`（= 500）
  - `SearchFilesResult { files: string[]; truncated: boolean }`（`src/shared/types.ts`，供 TASK-002 在 preload / renderer 复用）

> 主进程 import 风格：参照 `src/main/ipc-handlers.ts`，`import type { SearchFilesResult } from '../shared/types';`（无 `.js` 后缀）。

## Acceptance Criteria

- [ ] AC-1（SPEC AC-5 大小写不敏感）：`searchProjectFiles(['Store.ts','user-Store.ts','STORE.test.ts'], 'store')` 三者均命中（`files.length === 3`）
- [ ] AC-2（SPEC AC-6 整条相对路径子串）：查询 `store` 命中 `store.ts`、`userstore.ts`、`src/user-store/util.ts`、`store-utils.ts`（`store` 是完整相对路径的子串）
- [ ] AC-3（SPEC AC-7 目录名参与匹配）：查询 `store` 命中 `src/store/index.ts`（文件名 `index.ts` 不含 `store`，但目录名段含 `store`）
- [ ] AC-4（SPEC AC-12 排序）：输入 `['B.ts','a.ts','src/x.ts','Z.ts']`，查询命中后输出顺序 `a.ts → B.ts → src/x.ts → Z.ts`（大小写不敏感字典序升序）
- [ ] AC-5（SPEC AC-13 上限 + 截断标志）：命中数 > 500 时 `files.length === 500` 且 `truncated === true`；命中数 ≤ 500 时 `truncated === false`
- [ ] AC-6（类型）：`SearchFilesResult` 新增于 `src/shared/types.ts`，形状为 `{ files: string[]; truncated: boolean }`
- [ ] AC-7（测试）：`npm test` 中 `src/main/file-search.test.ts` 全绿，覆盖上述 AC-1~AC-5（纯函数直测，不 mock Electron / fs / child_process）
