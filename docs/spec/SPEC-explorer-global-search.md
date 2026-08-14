# SPEC — Explorer 跨目录全局搜索

> 契约先行：以下 Given/When/Then 是 QA 逐条对照的验收卡口。每一条都可量化、可测试。范围前提见 `docs/prd/PRD-explorer-global-search.md`；本文件只约定「构建什么」，技术实现由架构师负责。

## 范围前提（引用 PRD 决策）

- 搜索范围 = **当前活动项目**，不跨项目。
- 匹配目标 = **整条仓库相对路径（含目录名与文件名）**，**不区分大小写**的子串；不做 fuzzy、不做正则。
- 默认排除 `node_modules`、`.git`、`.gitignore` 命中文件、隐藏文件（点开头）。
- 结果**上限 500**，排序 = 仓库相对路径字典序升序（大小写不敏感）。
- 搜索即触发（去抖 150–300ms），无需回车；空查询/Esc 恢复文件树。
- 点击结果 = 打开文件阅读器，复用 `addFileReaderSession` 语义。

---

## 1. 搜索框与触发

**AC-1 搜索框位置**
- Given 右侧 Explorer 面板已打开
- When 面板渲染完成
- Then 面板顶部（标题行下方、文件树上方）显示一个文件搜索输入框，占位符为「Search files / 搜索文件」（`explorer.searchPlaceholder`）

**AC-2 空查询 = 文件树**
- Given 搜索框为空
- When 面板渲染
- Then 显示正常文件树，不显示结果列表，且不触发任何目录遍历搜索

**AC-3 输入即搜（免回车）**
- Given 用户在搜索框输入
- When 用户停止输入 ≥ 去抖窗口（150–300ms）
- Then 自动触发搜索并显示结果，全程无需按回车

**AC-4 latest-wins（慢结果不得覆盖新结果）**
- Given 用户快速连续输入 `s` → `st` → `store`
- When `s` 的搜索仍在途、`store` 的搜索已完成
- Then 最终显示的结果只对应 `store`；`s`/`st` 的旧结果不得在之后覆盖显示

---

## 2. 匹配语义

**AC-5 大小写不敏感**
- Given 项目含 `Store.ts`、`user-Store.ts`、`STORE.test.ts`
- When 查询为 `store`
- Then 三者的文件名均命中，全部出现在结果中

**AC-6 整条相对路径子串匹配**
- Given 项目含 `store.ts`、`userstore.ts`、`src/user-store/util.ts`、`store-utils.ts`
- When 查询为 `store`
- Then 四者均命中（`store` 是完整相对路径的子串，目录名段也参与）

**AC-7 匹配边界：目录名参与匹配**
- Given 项目含 `src/store/index.ts`（文件名是 `index.ts`，不含 `store`）
- When 查询为 `store`
- Then `src/store/index.ts` 出现在结果中（匹配范围是完整相对路径，目录名 `store` 参与匹配）

**AC-8 递归覆盖未加载目录**
- Given 项目含 `a/b/c/deep-file.ts`，且该目录从未在文件树中展开
- When 查询为 `deep-file`
- Then `a/b/c/deep-file.ts` 出现在结果中（遍历覆盖未展开/未加载目录）

**AC-9 忽略文件排除**
- Given 项目含 `node_modules/pkg/index.js`、`.git/HEAD`、被 `.gitignore` 忽略的 `generated.txt`、隐藏文件 `.env.local`
- When 任意查询
- Then 这些文件**永不**出现在结果中

**AC-10 纯空白查询 = 空查询**
- Given 搜索框输入只有空格
- When 触发搜索
- Then 按空查询处理：隐藏结果列表，恢复文件树（不报错、不显示结果）

---

## 3. 结果列表

**AC-11 平铺 + 相对路径**
- Given 搜索命中多个文件
- When 结果渲染
- Then 以平铺列表展示，每行显示仓库相对路径（如 `src/renderer/state.ts`）；不显示绝对路径；文件名作为主要信息、目录作为次要信息

**AC-12 排序（相对路径字典序升序，大小写不敏感）**
- Given 命中文件相对路径为 `B.ts`、`a.ts`、`src/x.ts`、`Z.ts`
- When 结果渲染
- Then 顺序为 `a.ts` → `B.ts` → `src/x.ts` → `Z.ts`（大小写不敏感字典序，同目录文件聚拢）

**AC-13 结果上限 + 截断提示**
- Given 查询命中文件数 > 500
- When 结果渲染
- Then 仅显示前 500 条，并在列表底部显示「500+ matches — refine your query / 匹配超过 500 条，请细化搜索词」（`explorer.searchTooMany`）

**AC-14 无结果空状态**
- Given 查询无任何匹配
- When 搜索完成
- Then 显示「No files found / 未找到文件」空状态（`explorer.searchNoResults`），不显示文件树

---

## 4. 点击打开

**AC-15 点击打开文件阅读器**
- Given 结果列表有命中项
- When 用户点击某条结果
- Then 打开该文件的文件阅读器会话并使其成为活动会话（聚焦）

**AC-16 复用已打开阅读器**
- Given 目标文件已有一个打开的阅读器会话
- When 用户点击该文件的同一条结果
- Then 聚焦已有阅读器会话，不重复新建

**AC-17 相对路径解析正确**
- Given 点击结果 `src/renderer/state.ts`，活动项目根为 `{project.path}`
- When 阅读器加载
- Then 阅读器打开并显示 `{project.path}/src/renderer/state.ts` 的内容（路径解析正确，非空内容）

---

## 5. 生命周期

**AC-18 Esc 清除并恢复文件树**
- Given 搜索框有查询且结果列表显示中
- When 用户按 Escape
- Then 清空搜索框、隐藏结果列表、恢复文件树

**AC-19 清空查询恢复文件树**
- Given 结果列表显示中
- When 用户删除搜索框全部内容
- Then 隐藏结果列表、恢复文件树

**AC-20 切换项目重置搜索**
- Given 搜索框有查询
- When 活动项目切换到另一个项目
- Then 搜索被清除，面板显示新项目的文件树（结果列表不残留）

**AC-21 关闭面板重置搜索**
- Given 搜索框有查询
- When 关闭 Explorer 面板后重新打开
- Then 面板回到文件树状态（搜索状态重置，不残留上次查询/结果）

---

## 非验收项（明确不测试 / 防止误判）

- 不做文件**内容**搜索（只搜文件名）。
- 不做跨项目聚合搜索。
- 不要求 fuzzy ranking / 正则 / 拼音匹配。
- 不要求搜索历史、最近打开、收藏。
- 不要求搜索结果缓存（每次查询重新遍历）。

## 可测试性说明

- 大部分验收可用 stub 的 `window.vibeyard.fs`（Vitest，参照 `explorer-panel.test.ts`）断言：模拟 `fs` 通道返回固定文件列表，验证渲染、排序、上限、空状态、Esc/清空/切项目重置。
- 匹配语义（AC-5/6/7）可在主进程枚举逻辑层单独测：构造含 `Store.ts`、`store.ts`、`src/store/index.ts`、`node_modules/...` 的临时目录树，断言返回集合。
- 性能类约束（去抖、latest-wins、上限）通过计时器与"旧结果不得覆盖新结果"的顺序断言验证，不要求真实大仓库跑测。
