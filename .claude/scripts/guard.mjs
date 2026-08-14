#!/usr/bin/env node
/**
 * guard.mjs — 守卫平面（V4 精简版）
 *
 * 平台中性状态机 + 机器门禁 + hash 漂移探测。纯 Node，零平台依赖。
 *
 * V4 精简：
 *   - 砍掉数散文 gate（grill/spec/adr），只留真实机器门禁：build/verify/review/deps
 *   - spec 结构校验交给 QA 的 Spec 对照校验（提示词层卡口），guard 只做机器门禁
 *   - 阶段顺序不再硬编码，由 workflow JSON 驱动（team skill 用 handoff --enter 设当前阶段）
 *
 * CLI 契约：
 *   node guard.mjs --init [--run-id X]      # 创建 run-state
 *   node guard.mjs --status                 # 只读 dump
 *   node guard.mjs handoff --enter <phase>  # 阶段进入：锁输入 hash
 *   node guard.mjs handoff --write          # 阶段结束：漂移检查
 *   node guard.mjs <gate> [--write]         # 机器门禁：build | verify | review | deps
 *
 * 通用选项：--state <path>（默认 <基座>/checkpoints/run-state.json，脚本自定位）、--root <dir>
 * exit：0 = PASS；1 = BLOCKED；2 = 用法错误。
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const SCHEMA = 'run-state.v2'
const DEFAULT_RUN_ID = 'change-000-initial'

// 自定位基座：本脚本所在目录的上一级 = 平台目录（源仓库平铺=项目根 / Claude=.claude/ / Codex=.codex/）。
// 运行时状态（checkpoints/acp/observability）统一放在基座下；--root 是项目根（docs/、package.json 用）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = path.resolve(HERE, '..')
const DEFAULT_STATE = path.join(BASE, 'checkpoints', 'run-state.json')

// ── 工具 ─────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(msg + '\n') }
function err(msg) { process.stderr.write(msg + '\n') }
function sha256(text) { return crypto.createHash('sha256').update(text, 'utf-8').digest('hex') }
function fileHash(fp) { return sha256(fs.readFileSync(fp, 'utf-8')) }

function writeJsonSafe(fp, obj) {
  const tmp = fp + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
  try { fs.renameSync(tmp, fp) }
  catch { fs.rmSync(fp, { force: true }); fs.renameSync(tmp, fp) }
}

// glob 展开（* 匹配段内任意字符，不跨目录分隔符）
function segmentPattern(seg) {
  return new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*') + '$')
}
function globWalk(segments, dir) {
  if (segments.length === 0) return fs.existsSync(dir) && fs.statSync(dir).isFile() ? [dir] : []
  const [seg, ...rest] = segments
  if (!seg.includes('*')) {
    const full = path.join(dir, seg)
    if (!fs.existsSync(full)) return []
    return globWalk(rest, full)
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  const re = segmentPattern(seg)
  const out = []
  for (const entry of fs.readdirSync(dir)) if (re.test(entry)) out.push(...globWalk(rest, path.join(dir, entry)))
  return out
}
function resolveFiles(patterns, root) {
  const files = [], missing = []
  for (const p of patterns || []) {
    if (!p.includes('*')) {
      const full = path.isAbsolute(p) ? p : path.join(root, p)
      if (fs.existsSync(full)) files.push(full); else missing.push(p)
      continue
    }
    const base = path.isAbsolute(p) ? path.parse(p).root : root
    const rest = (path.isAbsolute(p) ? p.slice(path.parse(p).root.length) : p).replace(/^[/\\]+/, '').split(/[\\/]/).filter(Boolean)
    const matched = globWalk(rest, base)
    if (matched.length === 0) missing.push(p); else files.push(...matched)
  }
  return { files, missing }
}
function computeInputHash(resolvedFiles) {
  return sha256(resolvedFiles.map((f) => `${path.basename(f)}:${fileHash(f)}`).sort().join('\n'))
}

// ── run-state ────────────────────────────────────────────────────

function freshState(runId) {
  return {
    schema: SCHEMA,
    runId,
    status: 'running',
    currentPhase: null,
    completed: [],
    phases: {},   // phaseId -> { status, inputs, inputHash, outputs, endedAt }
    gates: {},    // gateId -> { status, checks }
    refs: {
      metrics: 'observability/metrics.json',   // 相对基座（平台目录/源仓库根）
      acp: 'acp/journal.jsonl',                // 相对基座
      checkpointsDir: 'checkpoints/',          // 相对基座
    },
  }
}
function loadState(statePath) {
  if (!fs.existsSync(statePath)) return { ok: false, error: `run-state 不存在：${statePath}（先 --init）` }
  let raw
  try { raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) }
  catch (e) { return { ok: false, error: `run-state 损坏（非合法 JSON）：${e.message}` } }
  if (raw.schema !== SCHEMA) return { ok: false, error: `schema 不符：${raw.schema}（期望 ${SCHEMA}）` }
  return { ok: true, state: raw }
}

// ── 命令门禁（build/verify 共用）─────────────────────────────────

function inferCommand(root, kind) {
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.scripts && typeof pkg.scripts[kind] === 'string' ? `npm run ${kind}` : null
  } catch { return null }
}
function runCommandSync(cmd, root) {
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf-8', timeout: 600000 })
  return { exitCode: r.status === null ? 1 : r.status, stdout: r.stdout || '' }
}
function runCommandGate(root, kind, label) {
  const cmd = inferCommand(root, kind)
  if (!cmd) {
    return { skip: true, reason: `未找到 ${label} 命令（package.json scripts.${kind} 缺失）`, checks: [], failures: [] }
  }
  const { exitCode, stdout } = runCommandSync(cmd, root)
  const checks = [
    { name: `${label}命令`, actual: cmd, required: '执行' },
    { name: `${label}退出码`, actual: exitCode, required: '0' },
  ]
  if (exitCode !== 0) return { checks, failures: [{ check: `${label}退出码`, actual: exitCode, required: '0' }], stdout }
  return { checks, failures: [] }
}

// ── deps gate（依赖图查环）──────────────────────────────────────

function readFrontmatter(taskPath) {
  const text = fs.readFileSync(taskPath, 'utf-8')
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { id: null, dependsOn: [] }
  const fm = m[1]
  const id = (fm.match(/^id:\s*(.+)$/m) || [])[1]?.trim() ?? null
  let dependsOn = []
  const inline = fm.match(/^depends_on:\s*\[([^\]]*)\]/m)
  if (inline) dependsOn = inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  else {
    const block = fm.match(/^depends_on:\s*\n((?:\s+-[^\n]*\n?)+)/m)
    if (block) dependsOn = [...block[1].matchAll(/\s+-\s+(.+)$/gm)].map((m) => m[1].trim())
  }
  return { id, dependsOn }
}
function findCycle(graph) {
  const state = {}, stack = []
  const visit = (n) => {
    if (state[n] === 1) return stack.slice(stack.indexOf(n)).concat(n)
    if (state[n] === 2) return null
    state[n] = 1; stack.push(n)
    for (const dep of graph[n] || []) { const c = visit(dep); if (c) return c }
    stack.pop(); state[n] = 2
    return null
  }
  for (const node of Object.keys(graph)) {
    if (state[node]) continue
    const c = visit(node)
    if (c) return c
  }
  return null
}
function parseDeps(taskFiles) {
  const graph = {}, ids = new Set(), missingDeps = []
  for (const f of taskFiles) {
    const { id, dependsOn } = readFrontmatter(f)
    if (!id) continue
    ids.add(id); graph[id] = dependsOn
  }
  for (const node of Object.keys(graph)) for (const dep of graph[node]) if (!ids.has(dep)) missingDeps.push(`${node} → ${dep}`)
  return { taskCount: taskFiles.length, cycle: findCycle(graph), missingDeps }
}

// ── review gate（结构化评审 JSON）───────────────────────────────

function parseReviewJson(files) {
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(f, 'utf-8'))
      if (r && typeof r === 'object' && Array.isArray(r.blockers)) return r
    } catch { /* 跳过损坏文件 */ }
  }
  return null
}

// ── Gate 注册表（只留真实机器门禁）───────────────────────────────

const GATES = {
  build: {
    label: '开发→审查',
    run: (files, root) => runCommandGate(root, 'build', '构建'),
  },
  verify: {
    label: '审查→交付',
    run: (files, root) => runCommandGate(root, 'test', '验证'),
  },
  review: {
    label: '审查→交付',
    target: ['docs/review/REVIEW-*.json'],
    run: (files) => {
      const report = parseReviewJson(files)
      if (!report) {
        return { checks: [{ name: '评审报告', actual: '缺失', required: 'REVIEW-*.json 存在' }], failures: [{ check: '评审报告', actual: '缺失', required: '存在' }] }
      }
      const blockers = report.blockers.length
      const checks = [{ name: 'Blocker 数', actual: blockers, required: '0' }]
      if (blockers > 0) return { checks, failures: [{ check: 'Blocker 数', actual: blockers, required: '0' }] }
      return { checks, failures: [] }
    },
  },
  deps: {
    label: '拆卡→开发',
    target: ['docs/tickets/TASK-*.md'],
    run: (files) => {
      if (files.length === 0) return { checks: [], failures: [{ check: 'TASK 数量', actual: 0, required: '≥1' }] }
      const r = parseDeps(files)
      const checks = [
        { name: 'TASK 数量', actual: r.taskCount, required: '≥1' },
        { name: '依赖图有环', actual: r.cycle ? '是' : '否', required: '否' },
        { name: '悬空依赖', actual: r.missingDeps.length, required: '0' },
      ]
      const failures = []
      if (r.cycle) failures.push({ check: '依赖图有环', actual: `是（${r.cycle.join(' → ')}）`, required: '否' })
      if (r.missingDeps.length > 0) failures.push({ check: '悬空依赖', actual: r.missingDeps.length, required: '0' })
      return { checks, failures }
    },
  },
}

// ── 阶段输入产物（handoff 漂移探测的锁定对象）────────────────────

const PHASE_INPUTS = {
  triage: [],
  // spec 阶段的输入只有分诊产物 intent.json；CONTEXT.md/PRD/SPEC 由产品经理在本阶段写入，
  // 因此在架构阶段（architecture）才作为输入锁定
  spec: ['docs/intent.json'],
  architecture: ['docs/CONTEXT.md', 'docs/prd/PRD-*.md', 'docs/spec/SPEC-*.md'],
  ticket: ['docs/spec/SPEC-*.md', 'docs/design/DESIGN-*.md'],
  develop: ['docs/spec/SPEC-*.md', 'docs/design/DESIGN-*.md', 'docs/tickets/PLAN-*.md', 'docs/tickets/TASK-*.md'],
  qa: ['docs/spec/SPEC-*.md', 'docs/tickets/TASK-*.md'],
}

// ── handoff（hash 锁 + 漂移）─────────────────────────────────────

function lockInputs(state, phase, root) {
  const patterns = PHASE_INPUTS[phase] || []
  const { files, missing } = resolveFiles(patterns, root)
  const inputs = files.map((f) => path.relative(root, f).replace(/\\/g, '/'))
  const hash = computeInputHash(files)
  state.phases[phase] = { status: 'running', inputs, inputHash: hash, outputs: [], endedAt: null }
  state.currentPhase = phase
  return { inputs, missing, hash }
}
function checkDrift(state, phase, root) {
  const rec = state.phases[phase]
  if (!rec || !rec.inputHash) return { ok: true, note: '无输入 hash 基线，跳过漂移检查' }
  const { files, missing } = resolveFiles(rec.inputs, root)
  if (missing.length > 0) return { ok: false, reason: `输入产物缺失：${missing.join(', ')}` }
  const hash = computeInputHash(files)
  if (hash !== rec.inputHash) return { ok: false, reason: '输入产物内容变化（hash 漂移）' }
  return { ok: true, hash }
}
function advanceState(state, gateName, checks) {
  state.gates[gateName] = { status: 'passed', checks: Object.fromEntries(checks.map((c) => [c.name, c.actual])) }
  const phase = state.currentPhase
  if (phase) {
    state.phases[phase].status = 'done'
    state.phases[phase].endedAt = new Date().toISOString()
    if (!state.completed.includes(phase)) state.completed.push(phase)
  }
  state.currentPhase = null
}

// ── 输出惯例 ─────────────────────────────────────────────────────

function reportGate(gateName, checks, failures, write) {
  if (failures.length === 0) {
    log(`[PASS] [gate:${gateName}] 全部机器检查通过`)
    for (const c of checks) log(`       ✓ ${c.name} = ${c.actual}（要求 ${c.required}）`)
    if (write) log(`[WRITE] [gate:${gateName}] 状态已推进`)
    log('ALL CHECKS PASSED')
    return 0
  }
  err(`[FAIL] [gate:${gateName}] 机器检查未通过`)
  for (const f of failures) err(`       ✗ ${f.check}：实际 ${f.actual}，要求 ${f.required}`)
  err(`Next: 修复产物后重跑 \`node guard.mjs ${gateName}${write ? ' --write' : ''}\``)
  err('BLOCKED — fix failing checks')
  return 1
}

// ── CLI ─────────────────────────────────────────────────────────

function usage() {
  log(`usage: node guard.mjs <gate> [--write] [--state <path>] [--root <dir>]`)
  log(`       node guard.mjs handoff --enter <phase>   # 锁阶段输入 hash`)
  log(`       node guard.mjs handoff --write           # 漂移检查（阶段结束）`)
  log(`       node guard.mjs --init [--run-id X] | --status | --help`)
  log(`gates: ${Object.keys(GATES).join(', ')} + handoff`)
}

function parseArgs(argv) {
  const args = { positional: [], write: false, state: DEFAULT_STATE, root: process.cwd(), init: false, status: false, help: false, enter: null, runId: DEFAULT_RUN_ID }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') args.write = true
    else if (a === '--init') args.init = true
    else if (a === '--status') args.status = true
    else if (a === '--help' || a === '-h') args.help = true
    else if (a === '--state') args.state = argv[++i]
    else if (a === '--root') args.root = argv[++i]
    else if (a === '--run-id') args.runId = argv[++i]
    else if (a === '--enter') args.enter = argv[++i]
    else args.positional.push(a)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) { usage(); process.exit(0) }

  if (args.init) {
    const st = freshState(args.runId)
    fs.mkdirSync(path.dirname(args.state), { recursive: true })
    writeJsonSafe(args.state, st)
    log(`[INIT] run-state 已创建：${args.state}（runId=${args.runId}）`)
    process.exit(0)
  }

  if (args.status) {
    const r = loadState(args.state)
    if (!r.ok) { err(`[FAIL] ${r.error}`); process.exit(1) }
    const st = r.state
    log(`runId: ${st.runId}`)
    log(`status: ${st.status} | currentPhase: ${st.currentPhase || '(none)'} | completed: ${st.completed.join(', ') || '(none)'}`)
    for (const g of Object.keys(GATES)) log(`  gate ${g}: ${(st.gates[g] || {}).status || 'pending'}`)
    for (const p of Object.keys(st.phases)) log(`  phase ${p}: ${st.phases[p].status}`)
    process.exit(0)
  }

  const gateName = args.positional[0]
  if (!gateName) { usage(); process.exit(2) }

  // handoff 特殊：hash 锁 / 漂移检查（不在 GATES 注册表内）
  if (gateName === 'handoff') {
    const r = loadState(args.state)
    if (!r.ok) { err(`[FAIL] ${r.error}`); process.exit(1) }
    const st = r.state
    if (args.enter) {
      if (!(args.enter in PHASE_INPUTS)) {
        err(`[FAIL] 未知阶段：${args.enter}（可选：${Object.keys(PHASE_INPUTS).join(', ')}）`)
        process.exit(2)
      }
      const lock = lockInputs(st, args.enter, args.root)
      writeJsonSafe(args.state, st)
      log(`[PASS] handoff 锁输入：${args.enter}`)
      for (const i of lock.inputs) log(`       input: ${i}`)
      if (lock.missing.length) err(`       ⚠ 缺失输入：${lock.missing.join(', ')}（漂移检查将在这些文件出现后生效）`)
      log(`       inputHash: ${lock.hash.slice(0, 12)}…`)
      log('ALL CHECKS PASSED')
      process.exit(0)
    }
    const phase = st.currentPhase
    if (!phase) { err('[FAIL] 当前无进行中的阶段（先 handoff --enter）'); process.exit(1) }
    const drift = checkDrift(st, phase, args.root)
    if (!drift.ok) {
      err(`[FAIL] handoff 漂移拦截（${phase}）：${drift.reason}`)
      err('Next: 恢复输入产物后重跑')
      err('BLOCKED — fix failing checks')
      process.exit(1)
    }
    log(`[PASS] handoff 无漂移（${phase}）`)
    if (drift.note) log(`       ${drift.note}`)
    else log(`       hash: ${drift.hash.slice(0, 12)}…`)
    log('ALL CHECKS PASSED')
    process.exit(0)
  }

  const gate = GATES[gateName]
  if (!gate) { err(`[FAIL] 未知 gate：${gateName}`); usage(); process.exit(2) }

  const r = loadState(args.state)
  if (!r.ok) { err(`[FAIL] ${r.error}`); process.exit(1) }
  const st = r.state

  const { files } = resolveFiles(gate.target || [], args.root)
  const result = gate.run(files, args.root, { runId: st.runId })

  // 条件不满足的 gate（build/verify 无命令）→ SKIP：不阻塞；--write 时视为通过并推进
  if (result.skip) {
    log(`[SKIP] gate ${gateName} ${result.reason || ''}`)
    log('       本次运行无机器意见（不阻塞）；配置命令后由 guard 校验')
    if (args.write) {
      advanceState(st, gateName, [{ name: '跳过原因', actual: result.reason || 'SKIP' }])
      writeJsonSafe(args.state, st)
      log(`[WRITE] [gate:${gateName}] 状态已推进（SKIP 视为通过）`)
    }
    process.exit(0)
  }

  const pass = result.failures.length === 0

  if (!pass) {
    if (result.stdout) err(`---- ${gateName} 命令输出尾部 ----\n${result.stdout.slice(-2000)}`)
    reportGate(gateName, result.checks, result.failures, args.write)
    process.exit(1)
  }

  if (args.write) {
    // 先做当前阶段的漂移检查（进入时锁的输入 hash）
    const phase = st.currentPhase
    if (phase) {
      const drift = checkDrift(st, phase, args.root)
      if (!drift.ok) {
        err(`[FAIL] ${gateName} 阶段 ${phase} 输入漂移：${drift.reason}`)
        err('BLOCKED — fix failing checks')
        process.exit(1)
      }
    }
    advanceState(st, gateName, result.checks)
    writeJsonSafe(args.state, st)
    reportGate(gateName, result.checks, result.failures, true)
    process.exit(0)
  }

  reportGate(gateName, result.checks, result.failures, false)
  process.exit(0)
}

main()
