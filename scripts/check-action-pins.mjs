#!/usr/bin/env node
/**
 * scripts/check-action-pins.mjs — 「同一 GitHub Action 的不同子路径必须用同一 ref」门禁（issue #435）。
 *
 * 拦住的真实事故：Dependabot PR #430 把 `github/codeql-action/analyze` 从 4.38.0 单侧升到 4.38.1，
 * 而同仓库的 `init` 仍是 4.38.0 → 每次 CodeQL 分析恒红
 * `Loaded a configuration file for version 4.38.0, but running version 4.38.1`，
 * 且**所有 PR 都被假红挡住**（#433 即被挡），每个 PR 都要人工判断「这两个红与我无关」。
 *
 * 为什么值得单独一条门禁：Dependabot 的依赖粒度是**子路径**，而 CodeQL 这类 Action 要求同仓库
 * 多子路径版本一致——两者天然冲突，靠人肉 review 迟早再犯（main 的那次假绿只是因为 run 早于 #430）。
 *
 * 用法：
 *   node scripts/check-action-pins.mjs                 # 扫描 .github/workflows/*.yml（门禁）
 *   node scripts/check-action-pins.mjs --json          # 机器可读
 *   node scripts/check-action-pins.mjs --root <dir>    # 指定仓库根（单测用）
 *
 * 退出码：0 通过；1 有版本分叉或 IO/解析异常（**fail-closed**：目录不存在、零 workflow、
 * 零 uses 一律判红——静默通过才是这类门禁最危险的失败模式）；2 用法错误。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractActionUses, findPinMismatches, renderMismatches } from './lib/action-pins.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const idx = argv.indexOf(flag)
  if (idx === -1) return undefined
  const value = argv[idx + 1]
  return value === undefined || value.startsWith('--') ? null : value
}

if (has('--help')) {
  process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]}\n`)
  process.exit(0)
}

const rootFlag = valueOf('--root')
if (rootFlag === null) {
  console.error('用法错误：--root 需要一个目录参数')
  process.exit(2)
}
const root = resolve(rootFlag ?? join(here, '..'))
const dir = join(root, '.github', 'workflows')

/** 违规或异常一律走这里：先打印原因再退出（绝不静默通过）。 */
function fail(message) {
  console.error(`✗ action-pins：${message}`)
  process.exit(1)
}

let files
try {
  files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
} catch (err) {
  fail(`无法读取 workflow 目录 ${dir}：${err.message}`)
}

const uses = []
for (const f of files) {
  const rel = `.github/workflows/${f}`
  let text
  try {
    text = readFileSync(join(dir, f), 'utf8')
  } catch (err) {
    fail(`读取失败 ${rel}：${err.message}`)
  }
  uses.push(...extractActionUses(text, rel))
}

if (files.length === 0) fail(`workflow 目录里没有任何 .yml/.yaml：${dir}（路径写错或 workflow 被清空，fail-closed）`)
if (uses.length === 0)
  fail(`扫描了 ${files.length} 个 workflow 却没解析出任何 uses:（解析器失效或配置异常，fail-closed）`)

const mismatches = findPinMismatches(uses)
const summary = {
  scannedFiles: files.length,
  uses: uses.length,
  actions: new Set(uses.map((u) => u.action)).size,
  subpaths: new Set(uses.map((u) => `${u.action}/${u.subpath}`)).size,
  mismatches: mismatches.length,
}

if (has('--json')) {
  process.stdout.write(`${JSON.stringify({ summary, mismatches }, null, 2)}\n`)
  process.exit(mismatches.length === 0 ? 0 : 1)
}

if (mismatches.length > 0) {
  console.error(renderMismatches(mismatches))
  console.error('')
  fail(
    `${mismatches.length} 个 Action 存在版本分叉（${summary.scannedFiles} 个 workflow / ${summary.uses} 个 uses / ${summary.actions} 个 Action）。` +
      '根因通常是 Dependabot 把「action 子路径」当独立依赖单侧 bump（#430 引入、#435 登记）。',
  )
}

console.log(
  `✓ action-pins：${summary.actions} 个 Action / ${summary.uses} 个 uses（${summary.scannedFiles} 个 workflow），同一 Action 的不同子路径 ref 全部一致`,
)
