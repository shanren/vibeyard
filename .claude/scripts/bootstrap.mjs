#!/usr/bin/env node
/**
 * bootstrap.mjs — 把本多智能体系统一键装入目标项目（按平台选目录，交互式安装）
 *
 * 本仓库是平铺的**源**（开源库）：agents/ · skills/ · scripts/ · workflows/ · settings.json 都在根目录。
 * 安装时按 `--tools <平台>` 把系统复制到目标项目下的平台目录：
 *   claude → <目标>/.claude/      codex → <目标>/.codex/      其他工具 X → <目标>/.X/
 * 系统脚本全部"自定位"（以自身所在目录的上一级为基座），因此平铺源仓库与安装后的平台目录行为一致，
 * 无需按平台改写任何路径。
 *
 * 用法：
 *   node scripts/bootstrap.mjs                      # 交互式：提问目标路径 / 覆盖确认
 *   node scripts/bootstrap.mjs --root <目录>         # 非交互（CI/脚本）：直接装到 <目录>
 *   node scripts/bootstrap.mjs --root <目录> --force # 覆盖目标已存在的平台目录
 *   node scripts/bootstrap.mjs --root <目录> --tools codex   # 指定平台（claude 默认 → .claude/）
 *
 * --tools 决定平台目录：claude→.claude/ · codex→.codex/ · 其他工具 X→.X/；none 兜底 .claude/。
 *
 * 安装内容：
 *   agents/ · skills/ · scripts/ · workflows/ · settings.json  → <目标>/<平台目录>/
 *   然后调用 init.mjs（项目根 docs/ + 平台目录下运行时目录）。
 *   运行期状态（checkpoints/acp/observability）由 init 生成；tests/ 与本文档不复制。
 *
 * 安全护栏：
 *   - 目标路径支持 ~、相对路径、`\` 与 `/`，自动建目录（多级）
 *   - 目标以平台目录（.claude/.codex 等）结尾时自动按项目根处理（防嵌套 <平台目录>/<平台目录>）
 *   - 拒绝装进本系统自身所在目录（会自我覆盖）
 *   - 目标平台目录已存在且非空 → 交互式询问覆盖（默认否）；--force 跳过询问直接覆盖
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline/promises'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..') // 源基座：平铺源仓库=仓库根；脚本在 <平台目录>/scripts 下时=平台目录
const PARTS = ['agents', 'skills', 'scripts', 'workflows', 'settings.json']

// 平台 → 平台目录映射：claude → .claude/ · codex → .codex/ · 其他工具 X → .X/；none 兜底 .claude/
function platformDir(tools) {
  const map = { claude: '.claude', codex: '.codex' }
  if (!tools || tools === 'none') return '.claude'
  return map[tools] || `.${tools}`
}

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (name) => args.includes(name)

function log(msg = '') { process.stdout.write(msg + '\n') }
function err(msg) { process.stderr.write(msg + '\n') }

// ~ 与 ~/ 展开到用户主目录；其余交给 path.resolve（相对路径、混用 \ 与 / 均可）
function resolveTarget(raw) {
  let p = String(raw).trim().replace(/^~([\\/]|$)/, os.homedir() + path.sep)
  return path.resolve(p)
}

async function main() {
  const rootArg = flag('--root')
  const force = hasFlag('--force')
  const interactive = rootArg === undefined
  const help = hasFlag('--help') || hasFlag('-h')
  const tools = flag('--tools') ?? 'claude'

  if (help) {
    log('bootstrap.mjs — 把本多智能体系统一键装入目标项目（按平台选目录）')
    log('  用法: node scripts/bootstrap.mjs [--root <项目根>] [--force] [--tools <平台>]')
    log('  在平铺源仓库根（本仓库）运行；不带 --root = 交互式提问目标路径')
    log('  --root <项目根>      目标项目根（脚本自动创建其平台目录；传 <平台目录> 也会自动归一化）')
    log('  --force              覆盖目标已存在的平台目录')
    log('  --tools <平台>       平台目录：claude→.claude/ · codex→.codex/ · 其他X→.X/（默认 claude）')
    process.exit(0)
  }
  if (hasFlag('--root') && rootArg === undefined) {
    err('[bootstrap] 用法: node bootstrap.mjs [--root <目录>] [--force]（--root 后需跟目录）')
    process.exit(2)
  }

  let rl = null
  const ask = async (q, def) => {
    const suffix = def === undefined ? '' : `（回车默认 ${def}）`
    return (await rl.question(`[bootstrap] ${q}${suffix}: `)).trim()
  }

  // 1) 确定目标路径
  let target
  if (interactive) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    process.on('SIGINT', () => { rl.close(); process.exit(130) })
    let raw
    do {
      raw = await ask('请输入目标项目路径（支持 ~ 与相对路径）')
      if (!raw) log('[bootstrap] 输入不能为空，请重试。')
    } while (!raw)
    target = resolveTarget(raw)
  } else {
    target = resolveTarget(rootArg)
  }

  // 平台目录（claude→.claude/ · codex→.codex/ · 其他X→.X/）
  const dirName = platformDir(tools)

  // 2) 归一化：误传 `<项目>/<平台目录>` 时按项目根处理，避免嵌套
  const baseName = path.basename(target)
  if (['.claude', '.codex'].includes(baseName) || baseName === dirName) {
    log(`[bootstrap] 目标以 ${baseName} 结尾，自动按项目根 ${path.dirname(target)} 处理。`)
    target = path.dirname(target)
  }

  // 3) 安全护栏
  if (path.resolve(target, dirName) === SRC) {
    err(`[bootstrap] 拒绝：目标 ${dirName} 是本系统自身所在目录，会自我覆盖。`)
    process.exit(1)
  }
  const dstDir = path.join(target, dirName)
  const existing = fs.existsSync(dstDir)
    ? fs.readdirSync(dstDir).filter((n) => !n.startsWith('.')).length
    : 0
  if (existing > 0 && !force) {
    if (interactive) {
      const ok = await ask(`目标 ${dirName}/ 已存在（${existing} 项），覆盖其中的系统文件？`, 'N')
      if (!/^y(es)?$/i.test(ok)) {
        log('[bootstrap] 已取消（未覆盖）。可用 --force 强制覆盖，或换一个目标目录。')
        process.exit(0)
      }
    } else {
      err(`[bootstrap] 目标 ${dirName}/ 已存在（${existing} 项），非交互模式需加 --force 才覆盖。`)
      process.exit(1)
    }
  }

  // 4) 复制系统目录
  log(`\n[bootstrap] 安装系统 → ${target}/${dirName}`)
  fs.mkdirSync(dstDir, { recursive: true })
  let copied = 0
  for (const part of PARTS) {
    const s = path.join(SRC, part)
    if (!fs.existsSync(s)) continue
    fs.cpSync(s, path.join(dstDir, part), { recursive: true, force: true })
    copied++
    log(`  ✓ ${dirName}/${part}`)
  }
  log(`  （${copied} 项已复制；运行期状态 checkpoints/acp/observability 由 init 生成，tests/ 不复制）`)

  // 5) 骨架 + 知识播种（复用 init.mjs，幂等）
  log('\n[bootstrap] 初始化项目骨架 + 知识播种（init.mjs）…')
  const initRun = spawnSync('node', [path.join(dstDir, 'scripts', 'init.mjs'), '--root', target], {
    stdio: 'inherit',
  })
  if (initRun.error) { err(`[bootstrap] 调用 init.mjs 失败: ${initRun.error.message}`); process.exit(1) }
  if (initRun.status !== 0) { err(`[bootstrap] init.mjs 退出码 ${initRun.status}，安装中止。`); process.exit(initRun.status ?? 1) }

  // 6) 汇总
  const countDir = (p) => {
    try { return fs.readdirSync(path.join(dstDir, p)).length } catch { return 0 }
  }
  const agents = countDir('agents')
  const skills = fs.existsSync(path.join(dstDir, 'skills'))
    ? fs.readdirSync(path.join(dstDir, 'skills')).filter((n) => !n.startsWith('_')).length
    : 0
  log('\n[bootstrap] 完成 ✅  系统已装入：')
  log(`  目标     : ${target}`)
  log(`  平台目录 : ${dirName}（${tools}）: agents(${agents}) · skills(${skills}) · scripts · workflows · settings.json`)
  log(`  项目根   : docs/（prd · spec · design · knowledge · tickets · review）`)
  log(`  运行时   : ${dirName}/checkpoints · ${dirName}/acp · ${dirName}/observability（由 init 生成）`)
  log('  下一步：')
  log(`    cd ${target}`)
  log(`    # Claude 平台（Codex 见对应平台目录）：`)
  log(`    /team 请实现 <需求>    # 启动完整管线`)
  log(`    /team resume           # 断点续跑`)
  log(`    /team status           # 状态仪表盘`)

  if (rl) rl.close()
}

main()
