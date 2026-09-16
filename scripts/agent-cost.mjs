#!/usr/bin/env node
/**
 * 子 agent token 成本观测（成本纪律的配套工具）。
 *
 * 成本 ≈ Σ(每一步的完整上下文)，所以要看的是「步数 × 上下文规模」这两个数，
 * 而不是模型输出长度（实测 output 只占约 1%）。本工具一条命令列出近期每个会话的
 * 步数 / 累计 token / 峰值上下文，并标出越过预算的会话，供 leader 决定是否收尾。
 *
 * 用法：
 *   node scripts/agent-cost.mjs                        # 近 8 小时；预算 5.0M/会话、100 步
 *   node scripts/agent-cost.mjs --hours 24 --budget 3 --steps 100
 *   node scripts/agent-cost.mjs --json                 # 机器可读
 *
 * 退出码：0 = 无超限；1 = 存在超限会话（便于脚本或 leader 直接判定）。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const hours = Number(flag('hours', 8))
const budgetM = Number(flag('budget', 5))
const stepLimit = Number(flag('steps', 100))
const asJson = argv.includes('--json')

const M = (n) => `${(n / 1e6).toFixed(2)}M`

/** DSH 的会话目录名 = cwd 的 `/` 换成 `-`，前后各加 `--`。 */
function sessionDirFor(cwd) {
  return join(homedir(), '.dsh', 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`)
}

/** 解压并统计一个会话文件；失败返回 null（不因此中断整体报告）。 */
function readSession(file) {
  let raw
  try {
    raw = execFileSync('zstd', ['-d', '-c', file], { maxBuffer: 1 << 30 })
  } catch {
    return null
  }
  let steps = 0
  let total = 0
  let peak = 0
  for (const line of raw.toString('utf8').split('\n')) {
    if (!line.includes('"assistant/message"')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (!usage) continue
    const ctx = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
    steps += 1
    total += ctx + (usage.outputTokens ?? 0)
    peak = Math.max(peak, ctx)
  }
  return { steps, total, peak }
}

function collect() {
  const dir = sessionDirFor(process.cwd())
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const since = Date.now() - hours * 3600 * 1000
  const rows = []
  for (const name of entries) {
    const file = join(dir, name, 'session.v3.jsonl.zstd')
    let stat
    try {
      stat = statSync(file)
    } catch {
      continue
    }
    if (stat.mtimeMs < since) continue
    const stats = readSession(file)
    if (!stats || stats.steps === 0) continue
    rows.push({ id: name, ...stats })
  }
  return rows.sort((a, b) => b.total - a.total)
}

const isOver = (r) => r.total > budgetM * 1e6 || r.steps > stepLimit
const rows = collect()
const over = rows.filter(isOver)

if (asJson) {
  const payload = {
    hours,
    budgetM,
    stepLimit,
    sessions: rows,
    overBudget: over.map((r) => r.id),
  }
  console.log(JSON.stringify(payload, null, 2))
} else {
  const budget = M(budgetM * 1e6)
  console.log(`子 agent token 成本（近 ${hours} 小时 · 预算 ${budget}/会话 · ${stepLimit} 步/会话）\n`)
  if (rows.length === 0) console.log('  无活跃/近期会话')
  for (const r of rows) {
    const mark = isOver(r) ? '⚠️ ' : '   '
    const steps = String(r.steps).padStart(4)
    console.log(`  ${mark}${r.id.slice(0, 8)}  ${steps} 步  ${M(r.total).padStart(8)}  峰值 ${M(r.peak)}`)
  }
  const sumSteps = rows.reduce((a, r) => a + r.steps, 0)
  const sumTotal = rows.reduce((a, r) => a + r.total, 0)
  console.log(`  ${'─'.repeat(52)}`)
  console.log(`  合计 ${sumSteps} 步 · ${M(sumTotal)} · 超限 ${over.length} 个会话`)
  if (over.length > 0) {
    const ids = over.map((r) => r.id.slice(0, 8)).join(', ')
    console.log(`\n  ⚠️ 超限会话应立即 send_message 收尾交阶段性成果：${ids}`)
  }
}

process.exit(over.length > 0 ? 1 : 0)
