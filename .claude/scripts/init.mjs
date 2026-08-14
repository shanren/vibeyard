#!/usr/bin/env node
/**
 * init.mjs — 项目骨架一键初始化（平台中性）
 *
 * 为新项目创建框架所需的目录骨架。幂等：目录已存在不报错。
 *
 * 用法：
 *   node init.mjs [--root <dir>]   # 默认 root = cwd；配置基座自定位
 *
 * 创建目录：
 *   项目根：docs/ · docs/prd · docs/spec · docs/design · docs/knowledge/adr ·
 *           docs/tickets · docs/review
 *   配置基座（自定位：源仓库平铺=项目根 / Claude=.claude/ / Codex=.codex/）：
 *           checkpoints · acp · observability
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 自定位配置基座（平台目录/源仓库根），与 guard.mjs / persist-results.mjs 一致
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = path.resolve(HERE, '..')

function log(msg) {
  process.stdout.write(msg + '\n')
}

function main() {
  const argv = process.argv.slice(2)
  let root = process.cwd()
  if (argv[0] === '--root') {
    if (argv.length < 2) {
      log('[init] 用法: node init.mjs [--root <dir>]')
      process.exit(2)
    }
    root = path.resolve(argv[1])
  }

  log(`[init] 项目根: ${root}`)

  // 项目根目录骨架（docs/ 产物）
  const rootDirs = [
    'docs',
    'docs/prd',
    'docs/spec',
    'docs/design',
    'docs/knowledge',
    'docs/knowledge/adr',
    'docs/tickets',
    'docs/review',
  ]
  for (const d of rootDirs) {
    fs.mkdirSync(path.join(root, d), { recursive: true })
  }

  // 运行时状态目录（配置基座下；源仓库平铺=项目根，Claude=.claude/，Codex=.codex/）
  const runtimeDirs = ['checkpoints', 'acp', 'observability']
  for (const d of runtimeDirs) {
    fs.mkdirSync(path.join(BASE, d), { recursive: true })
  }
  log(`[init] 项目骨架就绪：docs(${rootDirs.length} 目录) @ ${root}`)
  log(`[init] 运行时目录就绪：${BASE}/${runtimeDirs.join(' · ')}`)

  log('[init] 完成。下一步：`/team <需求>` 启动研发（首次由 guard --init 创建 run-state.json）。')
  process.exit(0)
}

main()
