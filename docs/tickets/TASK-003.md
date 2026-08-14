---
id: TASK-003
depends_on: [TASK-002]
---
# renderer 搜索框 UI + 结果列表 + 文件树显隐（explorer-search.ts 核心）

## 描述

新增 renderer 搜索 UI 模块 `src/renderer/components/explorer-search.ts`，在 Explorer 面板顶部（标题行下方、文件树上方）加常驻搜索框，输入即搜（150ms 去抖 + latest-wins 序号守卫），结果平铺替换文件树显示。模块内部结构见 DESIGN §6，数据流见 DESIGN §4 renderer 侧。

数据流：

```
[input 事件] → 去抖 150ms（latest-wins 清旧 timer）
  → normalizeQuery(raw) → '' ? 恢复文件树 : 继续
  → const seq = ++searchSeq
  → await window.vibeyard.fs.searchFiles(project.path, query)
  → 返回后 if (seq !== searchSeq) return  // AC-4 丢旧结果
  → renderResults({ files, truncated })
```

模块接口（DESIGN §3.1 / §3.3）：

```ts
export function initExplorerSearch(): void;    // 构建 #explorer-search + #explorer-search-results 并接线，面板初始化时调用一次
export function resetExplorerSearch(): void;   // 清空输入、searchSeq++ 使在途失效、隐藏结果、恢复文件树
export function normalizeQuery(raw: string): string; // trim；纯空白 → ''（导出供单测，AC-10）
```

关键实现约束：

- **DOM**：`#explorer-search`（含 `input#explorer-search-input`）常显；`#explorer-search-results` 默认 `.hidden`。在 `index.html` 中插入于 `#explorer-header` 与 `#explorer-content` 之间（AC-1 位置）。
- **显隐替换**：搜索激活时 `#explorer-content` 加 `.hidden`、`#explorer-search-results` 移除 `.hidden`；恢复时反向（AC-2/18/19）。**不销毁文件树 DOM**（`file-tree.ts` 增量调和依赖其模块级注册表，DESIGN D6）。
- **状态**（模块级，`resetExplorerSearch` 可清空）：`searchSeq: number`、`debounceTimer`。
- **结果行渲染**：`createElement` + `textContent`（**不用 innerHTML 拼接，规避 XSS**）；`splitResultPath` 按最后一个分隔符（兼容 `/` 与 `\`）切分，文件名作主信息、目录作次信息（AC-11，参照 `quick-open.ts` 的「文件名粗体 + 目录灰」）。
- **空/截断态**：`files.length === 0` → `explorer.searchNoResults`（AC-14）；`truncated` → 列表底部 `explorer.searchTooMany` 脚注（AC-13）。
- **Esc**：仅在搜索框 `keydown` 处理（不挂 document 级，DESIGN D8）→ 清空输入 + 恢复树（AC-18）。清空输入走同一 `resetExplorerSearch`（AC-19）。
- **i18n**：占位符在 init 时用 `t('explorer.searchPlaceholder')` 设置，并订阅 `preferences-changed` 重设（与 `explorer-panel.ts` 的 `applyTitle` 同法）。

> 点击结果打开阅读器（AC-15/16/17）与 `resetExplorerSearch` 的跨项目/关面板接线（AC-20/21）在 TASK-004，本任务只做「搜索 → 显示结果 → Esc/清空恢复树」的闭环。

**文件**
- Create: `src/renderer/components/explorer-search.ts`
- Test: `src/renderer/components/explorer-search.test.ts`
- Modify: `src/renderer/index.html`（`#explorer-header` 与 `#explorer-content` 之间新增 `#explorer-search` + `#explorer-search-results`）
- Modify: `src/renderer/styles/explorer-panel.css`（搜索框 / 结果列表 / 空态 / 截断脚注样式 + 两条 `.hidden` 规则）
- Modify: `src/renderer/locales/en.json`、`src/renderer/locales/zh-CN.json`（新增顶层 `explorer` 对象 3 键）
- Modify: `src/renderer/components/explorer-panel.ts`（`initExplorerPanel()` 内调用一次 `initExplorerSearch()`）

**接口契约**
- Consumes:
  - `window.vibeyard.fs.searchFiles(cwd, query): Promise<SearchFilesResult>`（TASK-002）
  - `appState.activeProject`（`.path` / `.id`，`../state.js`）
  - `t(key)` / `appState.on('preferences-changed', cb)`（`../i18n.js` / `../state.js`）
- Produces:
  - `initExplorerSearch(): void`
  - `resetExplorerSearch(): void`
  - `normalizeQuery(raw: string): string`（纯函数，供单测）

> renderer import 风格：参照 `explorer-panel.ts` / `quick-open.ts`，`import { appState } from '../state.js';`、`import { t } from '../i18n.js';`（`.js` 后缀）。

## Acceptance Criteria

- [ ] AC-1（SPEC AC-1 位置 + 占位符）：`#explorer-search` 位于标题行下方、`#explorer-content` 上方；`input#explorer-search-input` 占位符为 `t('explorer.searchPlaceholder')`（en `Search files` / zh `搜索文件`）
- [ ] AC-2（SPEC AC-2 空查询 = 文件树）：查询为空时显示文件树（`#explorer-content` 无 `.hidden`），`#explorer-search-results` 隐藏，且不调用 `fs.searchFiles`
- [ ] AC-3（SPEC AC-3 输入即搜 / 去抖）：停止输入 ≥ 150ms 自动触发搜索，全程无需回车（去抖 150ms，`quick-open.ts` 同款）
- [ ] AC-4（SPEC AC-4 latest-wins）：`s → st → store` 快速输入时，旧查询结果不得在之后覆盖 `store` 的结果（`searchSeq` 序号守卫丢弃乱序返回）
- [ ] AC-5（SPEC AC-10 纯空白 = 空查询）：`normalizeQuery('   ') === ''`，纯空白输入按空查询处理（隐藏结果、恢复树、不报错）
- [ ] AC-6（SPEC AC-11 平铺 + 相对路径）：结果以平铺列表展示，每行显示仓库相对路径，文件名主信息、目录次信息；不显示绝对路径
- [ ] AC-7（SPEC AC-12 排序透传）：按 `fs.searchFiles` 返回顺序渲染（排序由主进程 `searchProjectFiles` 完成，renderer 不重排）
- [ ] AC-8（SPEC AC-13 截断脚注）：`truncated === true` 时列表底部显示 `explorer.searchTooMany` 脚注
- [ ] AC-9（SPEC AC-14 无结果空状态）：`files.length === 0` 时显示 `explorer.searchNoResults`，不显示文件树
- [ ] AC-10（SPEC AC-18 Esc）：搜索框有查询且结果显示中，按 Escape 清空输入、隐藏结果、恢复文件树
- [ ] AC-11（SPEC AC-19 清空恢复）：删除搜索框全部内容后隐藏结果列表、恢复文件树
- [ ] AC-12（i18n）：`en.json`/`zh-CN.json` 新增 `explorer.searchPlaceholder`/`searchNoResults`/`searchTooMany`，文案与 PRD 一致（`Search files`/`搜索文件`、`No files found`/`未找到文件`、`500+ matches — refine your query`/`匹配超过 500 条，请细化搜索词`）
- [ ] AC-13（测试）：`src/renderer/components/explorer-search.test.ts` 全绿，stub `window.vibeyard.fs.searchFiles` + 假计时器，覆盖 AC-2/3/4/5/8/9/10/11（参照 `explorer-panel.test.ts` 的 `FakeElement` / `vi.mock` 风格；latest-wins 用两个 resolve 顺序颠倒的 Promise 断言旧结果被丢弃）
