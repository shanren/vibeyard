# Explorer 全局搜索 — Checkpoint 实施计划

> **For agentic workers:** 按依赖序执行 `docs/tickets/TASK-001.md` → `TASK-002.md` → `TASK-003.md` → `TASK-004.md`。每个 Task 交付一个可独立验收的增量，`depends_on` frontmatter 已声明阻塞边（`deps` gate 校验无环无悬空）。

**Goal:** 在右侧 Explorer 面板顶部加常驻文件搜索框，对当前活动项目递归遍历全项目目录，按整条仓库相对路径做大小写不敏感子串匹配，平铺展示 ≤500 结果（超限截断提示），点击用现有文件阅读器打开。

**Architecture:** 主进程新增纯函数 `searchProjectFiles`（匹配/排序/截断），复用既有 `enumerateProjectFiles` 枚举核心；新增 `fs:searchFiles` IPC + preload 桥；renderer 新增 `explorer-search.ts` 模块（150ms 去抖 + latest-wins 序号守卫 + 结果渲染 + CSS 显隐替换文件树），生命周期挂在 `explorer-panel.ts`。

**Tech Stack:** Electron（main / preload / renderer 三进程）、Vanilla TypeScript（无框架）、esbuild、Vitest、node-pty / xterm.js（本需求不涉及）。

**Spec:** `docs/spec/SPEC-explorer-global-search.md`（AC-1~AC-21，QA 逐条验收）
**Design:** `docs/design/DESIGN-explorer-global-search.md`（模块划分 / 接口契约 / 数据模型 / 决策→AC 映射 / 测试策略）

## Global Constraints（每个 Task 隐式包含本节）

- 搜索范围 = 当前活动项目，不跨项目。
- 匹配 = 整条仓库相对路径（含目录名）大小写不敏感子串；**不做** fuzzy / 正则 / 拼音。
- 默认排除 `node_modules` / `.git` / `.gitignore` 命中 / 隐藏文件（点开头）——复用 `enumerateProjectFiles` 口径。
- 结果上限 500，排序 = 相对路径字典序升序（`localeCompare` + `sensitivity:'base'`）。
- 去抖 150ms（PRD 150–300ms 区间内）；latest-wins；空查询 / Esc 恢复文件树。
- **不引入 `ignore` npm 包**；不改 `enumerateProjectFiles` 内部逻辑（ADR-0002）。
- v1 同步枚举（`execSync` / `readdirSync`），不做异步化 / 取消（ADR-0003）。
- 点击结果 = `appState.addFileReaderSession(project.id, filePath)`，**不传 lineNumber**（同名复用聚焦）。
- 项目**无全局 `.hidden` 工具类**，新元素自配 `.hidden{display:none}` 规则。
- 三进程类型（`src/shared/types.ts` / `preload/preload.ts` / `renderer/types.ts`）同步新增。
- 路径分隔符：git 快路径产出 `/`、非 git 回退产出 `path.sep`，与 `fs:listFiles` 现状一致，**不归一化**（DESIGN §8）。
- 不搜文件内容；不缓存；不做搜索历史 / 最近 / 收藏。

## 依赖树

严格线性链（每层依赖前一层产出的接口契约，无并行分支）：

```
TASK-001 (searchProjectFiles 纯函数 + SearchFilesResult 类型 + 单测)
   └─> TASK-002 (fs:searchFiles IPC + preload/renderer 类型桥)
          └─> TASK-003 (explorer-search.ts 搜索 UI + 结果列表 + 文件树显隐 + i18n/CSS/DOM)
                 └─> TASK-004 (点击打开阅读器 + 生命周期重置接线 + 面板集成测试)
```

无环、无悬空：`TASK-001: []`，`TASK-002: [TASK-001]`，`TASK-003: [TASK-002]`，`TASK-004: [TASK-003]`。

## Checkpoint 里程碑与验收节奏

### Checkpoint 1 — 主进程匹配语义落地（TASK-001）

- **交付**：`searchProjectFiles` 纯函数 + `SearchFilesResult` 类型 + `file-search.test.ts` 单测全绿。
- **验收门**：`npm test` 中 `file-search.test.ts` 通过；AC-5/6/7/12/13（匹配/排序/截断）由纯函数单测锁定，无需启动 Electron。
- **可并行预研**：无上游依赖，是整条链的地基。

### Checkpoint 2 — 后端可调用（TASK-002）

- **交付**：`fs:searchFiles` IPC 处理器 + preload / renderer 三处类型桥；`window.vibeyard.fs.searchFiles(cwd, query)` 可调用。
- **验收门**：`npm run build` 三进程全绿（类型同步无遗漏）；AC-8/9（递归覆盖 + 忽略排除）由「复用 `enumerateProjectFiles` 原样」保证，配手动 QA（临时目录含 `node_modules`/`.git`/隐藏文件 + 深层未展开文件）。
- **里程碑**：后端完整，renderer 侧可开始消耗该接口。

### Checkpoint 3 — 搜索交互可见（TASK-003）

- **交付**：搜索框 + 150ms 去抖 + latest-wins + 结果平铺列表 + 文件树 CSS 显隐替换 + i18n（3 键）/ CSS / `index.html` DOM + `initExplorerSearch()` 接线。
- **验收门**：`npm test` 中 `explorer-search.test.ts` 通过；手动：输入即搜、空查询 / Esc / 清空恢复文件树、无结果空态、>500 截断脚注。
- **里程碑**：用户可「搜到文件并浏览结果」（点击打开留待 Checkpoint 4）。

### Checkpoint 4 — 全链路闭环（TASK-004）

- **交付**：点击结果打开阅读器 + `resetExplorerSearch()` 挂入 `renderTreeForActiveProject` / `closeTree`（切项目 / 关面板重置）+ `explorer-panel.test.ts` 集成断言。
- **验收门**：`npm test` 全量通过 + `npm run build` 全绿；手动验证点击打开 / 复用聚焦 / 切项目 / 关面板残留清零。
- **里程碑**：QA 对照 SPEC AC-1~AC-21 全量回归，功能可发布。

## AC → Task 覆盖映射（QA 追责用）

| SPEC AC | 内容 | 归属 Task |
|---------|------|-----------|
| AC-1 | 搜索框位置 / 占位符 | TASK-003 |
| AC-2 | 空查询 = 文件树 | TASK-003（renderer）+ TASK-002（后端短路）|
| AC-3 | 输入即搜（去抖 150ms） | TASK-003 |
| AC-4 | latest-wins | TASK-003 |
| AC-5 | 大小写不敏感 | TASK-001 |
| AC-6 | 整条相对路径子串 | TASK-001 |
| AC-7 | 目录名参与匹配 | TASK-001 |
| AC-8 | 递归覆盖未加载目录 | TASK-002 |
| AC-9 | 忽略文件排除 | TASK-002 |
| AC-10 | 纯空白 = 空查询 | TASK-003（`normalizeQuery`）+ TASK-002（后端短路）|
| AC-11 | 平铺 + 相对路径 | TASK-003 |
| AC-12 | 排序（字典序升序） | TASK-001（排序）+ TASK-003（顺序透传）|
| AC-13 | 上限 500 + 截断提示 | TASK-001（截断 + `truncated`）+ TASK-003（脚注渲染）|
| AC-14 | 无结果空状态 | TASK-003 |
| AC-15 | 点击打开阅读器 | TASK-004 |
| AC-16 | 复用已打开阅读器 | TASK-004 |
| AC-17 | 相对路径解析正确 | TASK-004 |
| AC-18 | Esc 清除恢复树 | TASK-003 |
| AC-19 | 清空查询恢复树 | TASK-003 |
| AC-20 | 切项目重置 | TASK-004 |
| AC-21 | 关面板重置 | TASK-004 |

## 非验收项（明确不测，防误判）

- 不做文件**内容**搜索；不跨项目聚合；不做 fuzzy / 正则 / 拼音；不做搜索历史 / 最近 / 收藏；不做结果缓存。
- 性能类约束（去抖 / latest-wins / 上限）用计时器 + 顺序断言验证，不要求真实大仓库跑测（SPEC「可测试性说明」）。
