---
id: TASK-004
depends_on: [TASK-003]
---
# 点击结果打开阅读器 + 生命周期重置接线 + 面板集成测试

## 描述

完成搜索功能的「连接层」：点击结果复用现有文件阅读器打开（DESIGN D7），并把 `resetExplorerSearch()` 挂到 Explorer 面板既有生命周期回调（DESIGN D9），使切项目 / 关面板时搜索状态归零。这是全链路的最后一个增量。

**点击打开**（DESIGN §4 renderer 侧末步）：

- 结果行 `click` → `appState.addFileReaderSession(project.id, filePath)`，**不传 lineNumber**（搜索是纯路径/文件名子串，无 `:line` 语义，DESIGN D7）。
- 相对路径自动解析（`state.ts:637` 已拼 `project.path`）、同名已开则复用并聚焦（`findExistingFileReader`），无需本任务额外实现——只需正确调用。

**生命周期重置**（DESIGN D9，挂在 `explorer-panel.ts`）：

- `renderTreeForActiveProject()` 顶部加 `resetExplorerSearch()` → 覆盖 AC-20（`project-changed` → `renderTreeForActiveProject`）与 `state-loaded` / 打开面板的重置。
- `closeTree()` 内加 `resetExplorerSearch()` → 覆盖 AC-21（`explorer-toggled` 关闭 → `closeTree`）与 `project-removed`。

> 说明：`resetExplorerSearch()` 会 `searchSeq++`，使切项目/关面板时所有在途结果一并失效（DESIGN §4「latest-wins 的落点」）。

**文件**
- Modify: `src/renderer/components/explorer-search.ts`（结果行加 `click` → `addFileReaderSession`）
- Modify: `src/renderer/components/explorer-panel.ts`（`renderTreeForActiveProject` + `closeTree` 内调用 `resetExplorerSearch()`）
- Test: `src/renderer/components/explorer-panel.test.ts`（增补：`initExplorerSearch`/`resetExplorerSearch` 的调用断言）

**接口契约**
- Consumes:
  - `initExplorerSearch` / `resetExplorerSearch`（`./explorer-search.js`，TASK-003）
  - `appState.addFileReaderSession(projectId, filePath)`（`../state.js`，已有，`state.ts:637`）
- Produces: 无新导出接口（纯接线；完成 SPEC AC-1~21 全量闭环）

> `explorer-panel.test.ts` 需在现有 `vi.mock('./file-tree.js', ...)` 旁新增 `vi.mock('./explorer-search.js', ...)`（`initExplorerSearch: vi.fn(), resetExplorerSearch: vi.fn()`），断言 `initExplorerPanel()` 触发 `initExplorerSearch`、关闭面板 / 切项目触发 `resetExplorerSearch`。

## Acceptance Criteria

- [ ] AC-1（SPEC AC-15 点击打开）：点击结果行 → `appState.addFileReaderSession(project.id, filePath)` 被调用，打开该文件的阅读器会话并聚焦
- [ ] AC-2（SPEC AC-16 复用已开阅读器）：目标文件已有打开的阅读器会话时，`addFileReaderSession` 复用并聚焦（由既有 `findExistingFileReader` 保证，测试断言仅调用一次且不重复建会话）
- [ ] AC-3（SPEC AC-17 相对路径解析）：点击 `src/renderer/state.ts`，`addFileReaderSession` 收到的 `filePath` 为该仓库相对路径，阅读器打开 `{project.path}/src/renderer/state.ts` 内容（路径解析正确、非空）
- [ ] AC-4（SPEC AC-20 切项目重置）：活动项目切换后，`resetExplorerSearch()` 被调用，搜索清除、显示新项目文件树、结果列表不残留
- [ ] AC-5（SPEC AC-21 关面板重置）：关闭 Explorer 面板再打开后，面板回到文件树状态，搜索状态不残留（`closeTree()` 内 `resetExplorerSearch()`）
- [ ] AC-6（测试）：`explorer-panel.test.ts` 增补断言全绿，覆盖 `initExplorerSearch`（面板初始化调用一次）与 `resetExplorerSearch`（关面板 / 切项目时调用）
- [ ] AC-7（整体回归）：`npm test` 全量通过；`npm run build` 全绿；QA 对照 SPEC AC-1~21 全量回归（含手动验证点击打开 / 复用聚焦 / 切项目 / 关面板）
