# ADR-0002 — 复用 git 原生 `.gitignore`（`git ls-files --exclude-standard`），不引入 `ignore` npm 包

Explorer 全局搜索必须排除 `node_modules`、`.git`、`.gitignore` 命中文件、隐藏文件（PRD"不做什么 #7"，SPEC AC-9）。决策：直接复用现有 `enumerateProjectFiles`（`ipc-handlers.ts:80`）的枚举口径——git 仓库走 `git ls-files --cached --others --exclude-standard`（git 原生解析 `.gitignore`，含未跟踪未忽略文件），非 git 目录回退到固定 `IGNORE` 集合 + 跳过点文件的同步遍历。不新增任何 gitignore 解析依赖或手写解析器。

## Considered Options

1. **引入 `ignore` npm 包**（用 `.gitignore` 规则过滤回退遍历）。
   - 优点：非 git 回退也能精确遵循任意 `.gitignore` 模式。
   - 缺点：git 快路径已经由 git 自己解析 `.gitignore`，再引入 `ignore` 是**第二套 gitignore 真源**，两条路径对同一模式可能不一致；新增依赖，而本项目对依赖克制（`picomatch` 已用于 `.vibeyardignore`，但那是另一个正交的忽略面）。非 git 目录在本产品语境占比低，收益小。
2. **手写轻量 gitignore 解析器**。
   - 优点：无依赖。
   - 缺点：gitignore 语义（嵌套规则、否定 `!`、目录锚定）极易写错，属于"看起来简单实则难"的坑；重复造轮子且难测。
3. **复用 git 原生 + 既有回退忽略集**（推荐）。不改 `enumerateProjectFiles` 内部，搜索直接复用其输出。
   - 优点：零新依赖、零新遍历代码，与 `fs:listFiles`/`fs:topFilesByTokens` 完全同口径；git 快路径天然 gitignore 感知。
   - 缺点：非 git 回退不解析任意 `.gitignore`（只跳过固定集合 + 点文件），且 git 快路径与回退的忽略口径不一致——但这是**既有行为**，非本需求引入。

## Consequences

- 搜索功能继承 `enumerateProjectFiles` 的全部忽略行为，AC-9 在 git 仓库上由 `--exclude-standard` 保证。
- 已知限制（非 git 目录的 gitignore 盲区）记录在 `DESIGN-explorer-global-search.md` §8，不在此处修复，避免超出范围的兼容面变化。
