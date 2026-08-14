# ADR-0003 — v1 保留同步枚举（`execSync`/`readdirSync`），去抖 + latest-wins + git 快路径缓解阻塞，异步化/缓存留待后续

搜索每次查询都遍历项目目录，存在主进程阻塞风险（`CONTEXT.md` 风险 #2）。决策：v1 复用 `enumerateProjectFiles` 的同步实现（`git ls-files` 快路径 + 非 git 同步回退），**不做异步化、不做可取消、不做跨查询缓存**；用 150ms 去抖 + renderer 序号守卫（latest-wins）+ `git ls-files` 单次 exec 快路径来缓解连续输入风暴与阻塞。异步化与缓存显式排除在 v1 范围。

## Considered Options

1. **异步遍历 + 可取消**（spawn git、`fs.promises.readdir`，IPC 带 AbortController/取消信号）。
   - 优点：不阻塞主进程，慢结果可真正中止，大仓库体验最佳。
   - 缺点：重写枚举核心，`fs:listFiles` 与 `fs:topFilesByTokens` 的共享代码要一起迁移，改动面大、回归面广；Electron `ipcMain.handle` 的取消语义要额外设计。收益仅在大仓库/慢 git 场景显现。
2. **缓存每项目文件列表**（首次枚举后缓存，`fs:changed`/`git:changed` 失效）。
   - 优点：后续查询零遍历成本。
   - 缺点：缓存失效一致性复杂（新增/删除/忽略变化），且 PRD 明确"不做缓存"（非目标 #6），v1 不做。
3. **同步枚举 + 渲染侧去抖/latest-wins**（推荐）。复用 `enumerateProjectFiles` 原样。
   - 优点：与 `fs:listFiles` 同路径、同行为，零新增复杂度；`git ls-files` 单次 exec 极快（主路径覆盖绝大多数项目），回退遍历有 `MAX_FILES=5000` 上限；去抖把按键风暴压成"停止输入后才一次遍历"，latest-wins 保证结果正确。
   - 缺点：超大非 git 仓库或慢 `git` 仍可能短暂阻塞主进程（影响 PTY 输入输出）——作为已知残余风险记录，待真实负载反馈后再决定是否异步化。

## Consequences

- `DESIGN-explorer-global-search.md` §8 明确主进程阻塞为残余风险与后续优化点。
- 若未来异步化，改造集中在 `enumerateProjectFiles`（单点），`searchProjectFiles` 纯匹配无需变动，`fs:searchFiles` 处理器仅换调用方式。
