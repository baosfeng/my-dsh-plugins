#!/usr/bin/env node
/**
 * verify-local.mjs — 本地一键全量校验（对齐 .github/workflows/ci.yml 全部门禁）。
 *
 * 按 CI 顺序执行全部检查；任一失败 exit 1 且继续跑完其余项，最后汇总所有失败，
 * 方便一次修完。与 CI 的对应关系见 docs/开发指南/构建与测试.md「本地一键校验」。
 *
 * 检查项（CI job → 本地命令）：
 *   audit      → npm audit --audit-level=high          （默认跳过：本地 npmmirror
 *                等 registry 不支持 audit API，CI 默认官方 registry 强制执行）
 *   test       → 遍历 plugins/ 下全部插件：node --check lib/index.js + lib/client.js（存在
 *                则查）+ npm test（单元测试 + 覆盖率门禁 + Gherkin 验收），与
 *                scripts/test-all.sh 同逻辑（区别：本脚本不 set -e，单个插件失败
 *                继续其余插件并汇总；支持 --plugin 过滤）
 *   mutation   → (cd plugins/dsh-file-activity && npx stryker run)（默认跳过：
 *                本地约 20s，push 场景太重，CI 独立 job 强制）
 *   typecheck  → npx tsc --noEmit
 *   lint       → npx eslint plugins/
 *   format     → npx prettier --check .
 *   test-scripts → npm run test:scripts（vitest 发版校验）
 *   depcruise  → npx depcruise plugins/
 *   knip       → npx knip（死代码）
 *   jscpd      → npx jscpd（重复代码）
 *   docs       → node scripts/check-docs.mjs（文档一致性，纯本地文件检查）
 *
 * 用法：
 *   node scripts/verify-local.mjs                 # 默认：全部检查（跳过 audit/mutation）
 *   node scripts/verify-local.mjs --audit         # 额外执行 npm audit
 *   node scripts/verify-local.mjs --mutation      # 额外执行 stryker 变异测试
 *   node scripts/verify-local.mjs --only <id>     # 只跑单项（可重复，如 --only knip）
 *   node scripts/verify-local.mjs --plugin <name> # 只跑该插件的 test/--check（可重复）
 *   node scripts/verify-local.mjs --help
 *
 * 退出码：0 = 全部通过（跳过项不计失败）；1 = 任一检查失败。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

// ── 参数解析 ────────────────────────────────────────────────────────────────
const options = { only: [], plugins: [], audit: false, mutation: false, help: false }
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i]
  const value = () => args[++i]
  if (flag === '--only') options.only.push(value())
  else if (flag === '--plugin') options.plugins.push(value())
  else if (flag === '--audit') options.audit = true
  else if (flag === '--mutation') options.mutation = true
  else if (flag === '--help' || flag === '-h') options.help = true
  else {
    console.error(`[verify] unknown flag: ${flag}（--help 查看用法）`)
    process.exit(1)
  }
}

const CHECK_IDS = [
  'audit',
  'test',
  'mutation',
  'typecheck',
  'lint',
  'format',
  'test-scripts',
  'depcruise',
  'knip',
  'jscpd',
  'docs',
  'resource-smoke',
]
const OPTIONAL_CHECKS = ['audit', 'mutation'] // CI 强制但本地默认跳过的项
const ALL_PLUGINS = readdirSync(join(root, 'plugins'))
  .filter((name) => existsSync(join(root, 'plugins', name, 'package.json')))
  .sort()

for (const id of options.only) {
  if (!CHECK_IDS.includes(id)) {
    console.error(`[verify] --only 未知检查项: ${id}（可选：${CHECK_IDS.join(' / ')}）`)
    process.exit(1)
  }
}
for (const name of options.plugins) {
  if (!ALL_PLUGINS.includes(name)) {
    console.error(`[verify] --plugin 未知插件: ${name}（plugins/ 下不存在或有 package.json）`)
    process.exit(1)
  }
}

const log = (msg) => console.log(`[verify] ${msg}`)

if (options.help) {
  printHelp()
  process.exit(0)
}

// ── 子进程 ──────────────────────────────────────────────────────────────────
/** 运行命令，stdio 透传（失败详情直接可见），返回 { ok, code }。 */
function run(cmd, cmdArgs, cwd = root) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit' })
    child.on('error', (error) => resolveRun({ ok: false, code: -1, error: String(error?.message ?? error) }))
    child.on('close', (code) => resolveRun({ ok: code === 0, code }))
  })
}

// ── 检查项实现 ──────────────────────────────────────────────────────────────
/** test：遍历插件 --check + npm test；单插件失败继续其余插件。 */
async function checkTests() {
  const targets = options.plugins.length > 0 ? options.plugins : ALL_PLUGINS
  const failedPlugins = []
  for (const name of targets) {
    const dir = join(root, 'plugins', name)
    let ok = true
    for (const f of ['lib/index.js', 'lib/client.js']) {
      if (existsSync(join(dir, f))) {
        const r = await run('node', ['--check', `plugins/${name}/${f}`])
        if (!r.ok) ok = false
      }
    }
    if (ok) {
      const r = await run('npm', ['test'], dir)
      if (!r.ok) ok = false
    }
    if (ok) {
      log(`✅ ${name}`)
    } else {
      failedPlugins.push(name)
      log(`❌ ${name}`)
    }
  }
  if (failedPlugins.length > 0) {
    log(`✗ 失败插件（${failedPlugins.length}）：${failedPlugins.join('、')}`)
  } else {
    log(`✓ 全部 ${targets.length} 个插件通过（--check + npm test）`)
  }
  return failedPlugins.length === 0
}

// 检查项定义（顺序 = CI job/step 顺序）；audit/mutation 默认跳过。
const CHECKS = [
  {
    id: 'audit',
    label: 'audit (npm audit --audit-level=high)',
    note: 'CI 强制；本地 npmmirror 等 registry 不支持 audit API，默认跳过，--audit 或 --only audit 开启',
    optional: true,
    run: () => run('npm', ['audit', '--audit-level=high']),
  },
  {
    id: 'test',
    label: 'test（全部插件：node --check + npm test）',
    run: async () => ({ ok: await checkTests() }),
  },
  {
    id: 'mutation',
    label: 'mutation (npx stryker run @ dsh-file-activity)',
    note: 'CI 强制；本地约 20s，默认跳过，--mutation 或 --only mutation 开启',
    optional: true,
    run: () => run('npx', ['stryker', 'run'], join(root, 'plugins', 'dsh-file-activity')),
  },
  { id: 'typecheck', label: 'typecheck (npx tsc --noEmit)', run: () => run('npx', ['tsc', '--noEmit']) },
  { id: 'lint', label: 'lint (npx eslint plugins/)', run: () => run('npx', ['eslint', 'plugins/']) },
  {
    id: 'ts-size',
    label: 'TS size gates (node scripts/check-ts-size.mjs)',
    run: () => run('node', ['scripts/check-ts-size.mjs']),
  },
  { id: 'format', label: 'format (npx prettier --check .)', run: () => run('npx', ['prettier', '--check', '.']) },
  {
    id: 'test-scripts',
    label: 'release checks (npm run test:scripts)',
    run: () => run('npm', ['run', 'test:scripts']),
  },
  {
    id: 'depcruise',
    label: 'dependency analysis (npx depcruise plugins/)',
    run: () => run('npx', ['depcruise', 'plugins/']),
  },
  { id: 'knip', label: 'dead code (npx knip)', run: () => run('npx', ['knip']) },
  { id: 'jscpd', label: 'duplicate code (npx jscpd)', run: () => run('npx', ['jscpd']) },
  {
    id: 'docs',
    label: 'docs consistency (node scripts/check-docs.mjs)',
    run: () => run('node', ['scripts/check-docs.mjs']),
  },
  {
    id: 'resource-smoke',
    label: 'resource smoke (node scripts/resource-smoke.mjs)',
    note: 'issue #127 发版前资源回归门禁：长会话写放大 ≤1.6 / 内存有界 / 降级触发与恢复（对齐 CI resource-smoke job）',
    run: () => run('node', ['scripts/resource-smoke.mjs']),
  },
]

function printHelp() {
  log('本地一键全量校验（对齐 CI 全部门禁）')
  log('用法: node scripts/verify-local.mjs [options]')
  log('  --only <id>     只跑单项（可重复；id 见下）')
  log('  --plugin <name> 只跑该插件的 test/--check（可重复）')
  log('  --audit         额外执行 npm audit（默认跳过：本地 registry 可能不支持 audit API）')
  log('  --mutation      额外执行 stryker 变异测试（默认跳过：约 20s）')
  log('  --help          显示本帮助')
  log('检查项: ' + CHECK_IDS.join(' / '))
  log('默认跳过（CI 强制，本地可显式开启）: ' + OPTIONAL_CHECKS.join(' / '))
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
// --only 时只跑指定项；否则全量（audit/mutation 为可选，仅对应开关开启时选中）
const runList =
  options.only.length > 0
    ? CHECKS.filter((c) => options.only.includes(c.id))
    : CHECKS.filter(
        (c) => !c.optional || (c.id === 'audit' && options.audit) || (c.id === 'mutation' && options.mutation),
      )

const skipped = CHECKS.filter((c) => !runList.includes(c))
const results = []

log(`开始本地校验（共 ${runList.length} 项${skipped.length > 0 ? `，跳过 ${skipped.length} 项` : ''}）`)
if (options.plugins.length > 0) log(`--plugin 过滤：${options.plugins.join('、')}`)

for (const check of runList) {
  log(`── ${check.label} ──`)
  const r = await check.run()
  const ok = r.ok
  results.push({ ...check, ok, code: r.code, error: r.error })
  log(ok ? `✅ ${check.label}` : `❌ ${check.label}${r.error ? `（${r.error}）` : ''}`)
}

for (const check of skipped) {
  if (check.optional) {
    log(`⏭ 跳过 ${check.label}：${check.note}`)
  }
}

const failed = results.filter((r) => !r.ok)
const passed = results.filter((r) => r.ok)
log('')
log(
  `结果：${passed.length} 通过 / ${failed.length} 失败${skipped.filter((c) => c.optional).length > 0 ? ` / ${skipped.filter((c) => c.optional).length} 跳过（CI 强制）` : ''}`,
)
if (failed.length > 0) {
  log('❌ 失败项（CI 同样会失败，修复后重跑 npm run verify）：')
  for (const f of failed) log(`  - ${f.label}`)
  process.exit(1)
}
log('✅ 全部通过')
const skippedOptional = skipped.filter((c) => c.optional)
const skippedOnly = skipped.filter((c) => !c.optional)
if (skippedOptional.length > 0) {
  log('注意：以下检查本地未跑，CI 会强制执行：')
  for (const c of skippedOptional) log(`  - ${c.label}（${c.note}）`)
}
if (skippedOnly.length > 0) {
  log('（--only 模式：以下检查未跑，如需全量请不加 --only）')
  for (const c of skippedOnly) log(`  - ${c.label}`)
}
process.exit(0)
