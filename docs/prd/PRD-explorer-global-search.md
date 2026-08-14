# PRD — Explorer 跨目录全局搜索

- **状态**：已确认方向（L 级 / flow-l）
- **关联**：`docs/intent.json`、`docs/CONTEXT.md`、`docs/spec/SPEC-explorer-global-search.md`

## 背景

右侧 Explorer 文件树是惰性加载的（只渲染展开过的目录，逐层点击展开）。在大型项目里定位一个文件需要反复展开，甚至不知道文件在哪一层。用户希望像 VS Code 全局查找那样，在 Explorer 面板顶部放一个搜索框，输入即搜、**递归遍历整个项目目录（包括尚未展开/加载的目录）**、按整条相对路径做不区分大小写的子串匹配、把命中文件**平铺列出（含相对路径）**、点击即用文件阅读器打开。

现有 `Ctrl+P` 快速打开（`quick-open.ts`）已实现近似的递归搜索，但它是一个**临时的覆盖层**，不是常驻面板视图；本功能把同样的"全局搜文件"能力内嵌进 Explorer 面板，与文件树共用同一块区域。

## 范围

### 做什么

1. 在 Explorer 面板顶部（标题行下方、文件树上方）加一个**文件搜索框**。
2. 输入时对**当前活动项目**递归遍历整个项目目录（覆盖文件树尚未展开/加载的目录），按**整条仓库相对路径（含目录名与文件名）**做**不区分大小写的子串匹配**。
3. 命中文件以**平铺列表**展示，每行显示**仓库相对路径**（文件名突出、目录作为次要信息）。
4. 点击结果 → 打开该文件的**文件阅读器**（`addFileReaderSession`）；同一文件已开则聚焦复用。
5. 搜索即触发（去抖），**不需要回车**；空查询恢复文件树；Esc 清除搜索并恢复文件树。
6. 结果上限 500 条，超出显示截断提示；排序按仓库相对路径字典序升序（大小写不敏感）。

### 不做什么（明确非目标）

1. **不做 fuzzy / 正则 / 拼音匹配**：匹配目标是**整条相对路径的子串**（含目录名，VS Code Ctrl+P 风格），但不是跳字符/乱序的 fuzzy ranking，也不支持正则。例如查询 `store` **会**命中 `src/store/index.ts`（路径含 `store`）。
2. **不跨项目搜索**：范围仅当前活动项目。
3. **不做文件内容搜索**：本功能只搜文件名，不搜文件内容（内容级全局搜索是另一个需求）。
4. **不做模糊/拼音/正则**：纯子串匹配，无 fuzzy ranking、无正则、无拼音。
5. **不做搜索历史 / 最近打开 / 收藏**。
6. **不做结果缓存**：每次查询重新遍历（去抖 + 500 上限已足够；缓存留作性能后续）。
7. **不搜索被忽略文件**：`node_modules`、`.git`、`.gitignore` 命中文件、隐藏文件（点开头）默认排除。
8. **不改动文件树本身的行为**：搜索列表只在查询激活时临时替换文件树，空查询/Esc 恢复原文件树。

## 用户旅程

1. 用户打开右侧 Explorer 面板（`#btn-toggle-explorer`），面板顶部出现搜索框，下方是正常文件树。
2. 用户在搜索框输入 `store`，停止输入约 150–300ms 后自动触发搜索（无需回车）。
3. 文件树被**平铺结果列表**临时替换：每行显示命中文件的相对路径，如 `src/renderer/state.ts`、`src/shared/store.ts`，按相对路径字典序排列。
4. 命中的文件即使位于未展开的深层目录（如 `src/renderer/components/`）也会出现——遍历覆盖整个项目目录。
5. 结果超过 500 条时，列表只显示前 500 条，并在底部提示"500+ 条匹配，请细化搜索词"。
6. 用户点击 `src/renderer/state.ts` → 文件阅读器打开该文件（若已打开则聚焦），阅读器显示文件内容。
7. 用户按 Esc（或清空搜索框）→ 结果列表消失，恢复原文件树。
8. 用户在搜索状态下切换到另一个项目 → 搜索被清除，面板显示新项目的文件树。

## 业务实体

| 实体 | 关键字段 | 说明 |
|------|---------|------|
| 搜索查询（Search Query） | 文本字符串 | 匹配目标 = 整条仓库相对路径（含目录名），大小写不敏感；首尾空白去除，纯空白视为空查询。 |
| 搜索结果（Search Result） | 仓库相对路径 | 一条命中文件的身份，如 `src/renderer/state.ts`；点击后交给 `addFileReaderSession` 解析。 |
| 结果列表（Result List） | 结果数组（≤500）、截断标志 | 查询激活时替换文件树的平铺列表。 |
| 文件阅读器（File Reader） | 会话 + 文件路径 | 现有 `file-reader.ts` 的会话型阅读器；点击结果的落点。 |

## 范围决策记录（为什么这么定）

| 决策 | 结论 | 理由 |
|------|------|------|
| 是否跳过 node_modules/.git/.gitignore/隐藏文件 | **跳过** | 与现有 `enumerateProjectFiles` 枚举口径一致；这些目录文件数量大且与"搜自己的代码"无关，跳过可避免结果洪泛 + 降低遍历成本。 |
| 触发时机 | **输入即搜（去抖 150–300ms）** | 与现有 `quick-open.ts` 150ms 去抖一致；免回车更符合"全局查找"直觉；去抖防止每个按键触发遍历。 |
| 结果上限与排序 | **上限 500；相对路径字典序升序（大小写不敏感）** | 500 兼顾"搜得到"与"渲染不卡"；字典序让同目录文件聚拢、可扫描（"平铺 + 相对路径"诉求）。 |
| 空查询行为 | **隐藏结果列表，恢复文件树** | 空查询等于"没在搜索"，回到常驻文件树是最小惊讶。 |
| 实现方式（新 IPC 还是复用） | **留给架构师** | 已有 `fs:listFiles` 可复用/扩展，但它有 50 上限和 pathContains 匹配两层 gap；架构师决定是扩展它还是新增 `fs:searchFiles`，本 PRD 只锁用户侧行为。 |

## 用户可见文案（i18n，需在 en.json / zh-CN.json 新增）

| key | en | zh-CN |
|-----|----|-------|
| `explorer.searchPlaceholder` | Search files | 搜索文件 |
| `explorer.searchNoResults` | No files found | 未找到文件 |
| `explorer.searchTooMany` | 500+ matches — refine your query | 匹配超过 500 条，请细化搜索词 |

> 通过现有 `t(key)` 机制接入；`sidebar.explorerTitle` 已存在，勿重复。

## 参考实现（真实文件，实现前请再读）

- `src/renderer/components/explorer-panel.ts` — 面板容器、生命周期、`renderFileTree`/`closeFileTree`。
- `src/renderer/index.html:72-78` — Explorer DOM 结构（搜索框插入点）。
- `src/main/ipc-handlers.ts:80`（`enumerateProjectFiles`）与 `:605`（`fs:listFiles`）— 已有递归枚举 + 匹配，需弥合 gap。
- `src/renderer/components/quick-open.ts` — 现有搜索交互（150ms 去抖、结果渲染、点击打开）的参照。
- `src/renderer/state.ts:637`（`addFileReaderSession`）— 点击结果的落点（相对路径自动解析）。
- `src/renderer/styles/explorer-panel.css` — 面板样式。
- `src/renderer/components/explorer-panel.test.ts` — 现有测试风格（Vitest，stub DOM）。
