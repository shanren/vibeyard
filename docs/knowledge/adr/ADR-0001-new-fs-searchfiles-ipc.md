# ADR-0001 — Explorer 全局搜索新增 `fs:searchFiles` IPC，而非扩展 `fs:listFiles`

Explorer 全局搜索（`SPEC-explorer-global-search.md`）需要"整条相对路径的大小写不敏感子串匹配 + 500 上限 + 截断标志"，而现有 `fs:listFiles` 服务 Ctrl+P 快速打开，语义是"四级排序（exact > startsWith > nameContains > pathContains）+ 50 上限"。二者匹配模型、返回结构、上限都不同。决策：新增 `fs:searchFiles` 通道，返回 `SearchFilesResult { files, truncated }`，与 `fs:listFiles` 共享底层枚举 `enumerateProjectFiles`（`ipc-handlers.ts:80`），但**不共享 IPC 契约**。

## Considered Options

1. **扩展 `fs:listFiles`**（加 mode/limit 参数，返回结构改为 `{ files, truncated }`）。
   - 优点：少一个通道。
   - 缺点：`fs:listFiles` 的调用方 `quick-open.ts` 依赖四级排序做"输入少时先出精确/前缀命中"的体验；强行改成路径子串 + 500 会劣化 Ctrl+P，或需在 handler 里塞两套分支，把两个不同诉求耦合进一个契约。返回结构从 `string[]` 改为对象会破坏现有调用契约。
2. **复用 `fs:listFiles` 原样，renderer 端再过滤/排序/截断**。
   - 优点：零后端改动。
   - 缺点：`fs:listFiles` 已经 `slice(0,50)` 且按四级排序，renderer 拿不到完整命中集，无法正确实现 500 上限与字典序；且每次按键仍需等后端全量枚举，没有省到遍历成本。不可行。
3. **新增 `fs:searchFiles`**（推荐）。请求 `(cwd, query)`，响应 `SearchFilesResult { files, truncated }`，复用 `enumerateProjectFiles` + 新的纯函数 `searchProjectFiles`。
   - 优点：语义单一清晰，各自独立演进；共享部分（枚举）通过复用函数而非复用契约；匹配/排序/截断集中在主进程纯函数，可单测 AC-5/6/7/12/13。
   - 缺点：多一个通道 + 三处类型桥声明（preload/renderer-types/shared-types）。

## Consequences

- 新增 `src/main/file-search.ts`（`searchProjectFiles` 纯函数 + `SEARCH_FILES_LIMIT=500`）与 `fs:searchFiles` 处理器。
- `fs:listFiles` 与 `quick-open.ts` 完全不动，Ctrl+P 行为零回归。
- 未来若两个搜索要统一 ranking，可在 `file-search.ts` 内部收敛，不触碰 IPC 面。
