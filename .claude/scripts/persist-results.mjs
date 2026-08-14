#!/usr/bin/env node
/**
 * persist-results.mjs — 将 Orchestrator 阶段结果中的 checkpoints / acpJournal / metrics
 * 幂等落盘到项目级可观测性目录。
 *
 * 用法（由 Orchestrator / /team resume 调用）：
 *   node .claude/scripts/persist-results.mjs <result.json>
 *
 * result.json 结构（= Orchestrator 阶段结果 JSON）：
 *   {
 *     checkpoints: [{ checkpointId, phase, state, timestamp }],
 *     acpJournal:  [{ messageId, correlationId, sender, receiver, messageType, payload, timestamp }],
 *     metrics:     { phases, totalTokensUsed, totalDurationMs, agentCalls, warnings, ... },
 *     phase?: 兜底标记（无 checkpoints 时也保证至少一个快照）
 *   }
 *
 * 落盘位置（脚本自定位的配置基座下；源仓库平铺=项目根 / Claude=.claude/ / Codex=.codex/）：
 *   - checkpoints/ckpt-<id>.json          （逐个写，幂等覆盖；附 ckpt-999-final.json）
 *   - acp/journal.jsonl                   （追加每行一条 JSON 消息，已存在消息去重）
 *   - observability/metrics.json          （合并累计值）
 *
 * 全程自动创建缺失目录；任何单文件失败不影响其他文件，返回非 0 退出码。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 自定位基座（平台目录/源仓库根），与 guard.mjs / init.mjs 一致
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = path.resolve(HERE, '..')

const INVALID = Symbol.for('invalid')

function loadInput() {
  const file = process.argv[2]
  if (!file) {
    console.error('[persist] 用法: node persist-results.mjs <result.json>')
    process.exit(64)
  }
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (e) {
    console.error(`[persist] 无法读取 ${file}: ${e.message}`)
    process.exit(65)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error(`[persist] ${file} 不是合法 JSON: ${e.message}`)
    process.exit(65)
  }
}

function dirs() {
  return {
    ckptDir: path.join(BASE, 'checkpoints'),
    acpDir: path.join(BASE, 'acp'),
    obsDir: path.join(BASE, 'observability'),
  }
}

const seenMessages = new Set()

/** 启动时一次性载入 journal 里已有的 messageId，避免每次追加都整读文件（消除 O(n²)）。 */
function seedSeenMessages(file) {
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
  for (const l of lines) {
    try {
      const m = JSON.parse(l)
      if (m.messageId) seenMessages.add(m.messageId)
    } catch {
      // 忽略历史坏行
    }
  }
}

function ensureLine(file, line) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, line + '\n', { flag: 'a' })
    return
  }
  if (line) {
    try {
      const m = JSON.parse(line)
      if (m.messageId && seenMessages.has(m.messageId)) return
      if (m.messageId) seenMessages.add(m.messageId)
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(file, line + '\n', { flag: 'a' })
}

let failures = 0
function fail(msg) {
  failures++
  console.error(`[persist] ✗ ${msg}`)
}

function persist(result) {
  const { ckptDir, acpDir, obsDir } = dirs()

  for (const d of [ckptDir, acpDir, obsDir]) {
    fs.mkdirSync(d, { recursive: true })
  }

  // 1) checkpoints —— 每个检查点一个文件，幂等覆盖
  const checkpoints = Array.isArray(result?.checkpoints) ? result.checkpoints : []
  if (checkpoints.length === 0) {
    const final = {
      checkpointId: 'ckpt-final',
      timestamp: new Date().toISOString(),
      phase: result?.phase || 'completed',
      state: { note: '无阶段检查点，仅存终态快照' },
    }
    fs.writeFileSync(
      path.join(ckptDir, 'ckpt-final.json'),
      JSON.stringify(final, null, 2),
      'utf-8'
    )
  }
  for (const ck of checkpoints) {
    const id = typeof ck?.checkpointId === 'string' ? ck.checkpointId : `ckpt-x-${Date.now()}`
    const safeId = id.replace(/[^\w-]+/g, '-')
    try {
      fs.writeFileSync(
        path.join(ckptDir, `${safeId}.json`),
        JSON.stringify(ck, null, 2),
        'utf-8'
      )
    } catch (e) {
      fail(`写检查点 ${safeId} 失败: ${e.message}`)
    }
  }

  // 2) acpJournal —— 追加写 journal.jsonl，按 messageId 去重
  const journal = result?.acpJournal || []
  const journalPath = path.join(acpDir, 'journal.jsonl')
  seedSeenMessages(journalPath)
  let appended = 0
  for (const msg of journal) {
    try {
      ensureLine(journalPath, JSON.stringify(msg))
      appended++
    } catch (e) {
      fail(`写 ACP 消息失败: ${e.message}`)
    }
  }
  if (journal.length > 0) {
    console.log(`[persist] ✓ acp: ${appended}/${journal.length} 条消息写入 journal.jsonl`)
  }

  // 3) metrics —— 合并累计值
  const m = result?.metrics
  if (m) {
    const metricsPath = path.join(obsDir, 'metrics.json')
    const base = () => ({
      $schema: './metrics.schema.json',
      generatedAt: new Date().toISOString(),
      tokens: { used: 0, byPhase: {}, warnings: [] },
      duration: { totalMs: 0, byPhase: {} },
      agents: { totalCalls: 0, successfulCalls: 0, failedCalls: 0 },
      quality: {},
      gates: {},
      runs: [],
    })
    let prev
    let merged
    if (fs.existsSync(metricsPath)) {
      try {
        const prevRaw = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'))
        if (prevRaw && typeof prevRaw === 'object') {
          prev = prevRaw
        }
      } catch {
        // 历史文件损坏则从零开始
      }
    }
    if (!prev || typeof prev !== 'object') prev = base()
    merged = mergeMeta(prev, m)
    merged.generatedAt = new Date().toISOString()
    try {
      fs.writeFileSync(metricsPath, JSON.stringify(merged, null, 2), 'utf-8')
    } catch (e) {
      fail(`写 metrics.json 失败: ${e.message}`)
    }
  }

  console.log(`[persist] 落盘完成，配置基座: ${BASE}`)
  return failures === 0
}

function mergeMeta(prev, m) {
  const next = structuredClone(prev)
  const t = m.totalTokensUsed ?? 0
  next.tokens.used += t
  next.duration.totalMs += m.totalDurationMs || 0
  next.agents.totalCalls += m.agentCalls || 0
  // byPhase 逐键累加
  for (const [phase, v] of Object.entries(m.phases || {})) {
    next.tokens.byPhase[phase] = (next.tokens.byPhase[phase] || 0) + (v.tokensUsed || 0)
    next.duration.byPhase[phase] = (next.duration.byPhase[phase] || 0) + (v.durationMs || 0)
  }
  // 复用现有 quality/gates（workflow 返回的 quality/gates 合并）
  next.quality = { ...(next.quality || {}), ...(m.quality || {}) }
  next.gates = { ...(next.gates || {}), ...(m.gates || {}) }
  for (const w of (m.warnings || [])) {
    if (!next.tokens.warnings.includes(w)) next.tokens.warnings.push(w)
  }
  if (Array.isArray(m.runs)) next.runs.push(...m.runs)
  return next
}

const result = loadInput(process.argv[2])
console.log(`[persist] 配置基座(平台目录/源仓库根): ${BASE}`)
persist(result)
process.exit(0)