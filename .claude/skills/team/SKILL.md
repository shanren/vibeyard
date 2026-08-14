---
name: team
description: 启动 AI 开发团队。按需求难度选 workflow，驱动 5 个角色 agent（产品经理/项目经理/架构师/开发/测试）分阶段协作完成研发。支持断点续跑和状态查看。
user-invocable: true
allowed-tools: Agent(product-manager, project-manager, architect, developer, qa-engineer), Read, Write, Edit, Bash, Grep, Glob
---

# 启动 AI 开发团队

一条命令走完整研发流程。5 个角色 agent 按 workflow 分阶段协作，以 PRD/Spec 文档为载体，以 guard.mjs + run-state.json 为机器门禁。

## 使用方式

- `/team <需求>` — 启动研发
- `/team resume` — 断点续跑
- `/team status` — 状态查看

## 执行流程

### 1. 分诊（triage）

派 `product-manager` 分级需求，产出 `docs/intent.json`：

```json
{ "difficulty": "S|M|L|XL", "flow": "flow-s|flow-m|flow-l|flow-xl", "summary": "一句话需求" }
```

### 2. 选 flow

读平台目录的 `workflows/<flow>.json`（Claude 安装后为 `.claude/workflows/`，源仓库平铺为 `workflows/`），得到阶段列表（每个 stage = `{ id, agent, gates }`）。

### 3. 初始化 run-state

```bash
node .claude/scripts/guard.mjs --init --run-id <slug>
```

### 4. 逐阶段执行

对 flow 的每个 stage，按序：

1. **锁输入**：`node .claude/scripts/guard.mjs handoff --enter <stage-id>`（锁输入产物 hash）
2. **派发**：派发 `stage.agent` 对应的子 agent（带需求 + 上游产物文件路径）。`agent: null` 表示人工审批节点，暂停等待用户确认
3. **门禁**：对 `stage.gates` 里每个 gate，跑 `node .claude/scripts/guard.mjs <gate> --write`
4. **BLOCK → 修复重试**：gate 失败时让对应 agent 修复产物，重跑 gate，不得越级

### 5. 交付

全部阶段完成 → 汇报结果（变更文件 + 测试 + 评审结论）。

## 断点续跑

`/team resume`：读 `node .claude/scripts/guard.mjs --status` 的 `currentPhase` / `completed[]`，从断点继续，不重跑已完成阶段。

## 硬性规则

- **子 agent 只产出产物，永不触碰 run-state**（guard 是唯一写者）
- **阶段间传文件路径，不把全文塞进 prompt**（上下文瘦身的关键）
- gate BLOCK 必须修复后重跑，不静默失败

## 注意事项

- 本技能运行于已安装的平台目录：Claude 下脚本在 `.claude/scripts/`，源仓库平铺为 `scripts/`，Codex 为 `.codex/scripts/`（guard 脚本自定位，路径统一）
- 需求越详细，分诊越快
- 分诊是唯一的流程分叉点：分诊后 S 走 1 阶段，M 走 3，L 走 5，XL 走 6（均不含分诊一步）
