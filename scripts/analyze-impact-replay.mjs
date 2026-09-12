#!/usr/bin/env node
/**
 * analyze-impact-replay.mjs — 回放最近 N 个提交，统计 pre-push 的范围落点
 * （纯文档短路 / 插件裁剪 / 安全退化全量）。issue #188 验收项「回放最近 200 提交的
 * 退化率统计脚本可复现」。
 *
 * 用法：
 *   node scripts/analyze-impact-replay.mjs                 # 最近 200 个非 merge 提交
 *   node scripts/analyze-impact-replay.mjs --limit 50
 *   node scripts/analyze-impact-replay.mjs --legacy        # 额外用 #188 之前的旧规则对比
 *   node scripts/analyze-impact-replay.mjs --json          # 机器可读
 *
 * 口径说明（为什么这个统计可信）：
 *   · 范围规则完全复用 scripts/lib/impact-scope.mjs —— 与 pre-push 是**同一份**
 *     computeImpactScope / parseNameStatus，不存在「统计脚本另写一套规则」的漂移；
 *   · 每个提交按 `git diff --name-status --no-renames --diff-filter=ACMRD <parent> <commit>`
 *     取变更集（与 pre-push 的 `base...HEAD` 同参同序）；
 *   · 依赖图与插件表取**当前工作区**——与 pre-push 的判定口径一致（pre-push 判的也是
 *     「当前仓库状态下的影响面」）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closureOf,
  computeImpactScope,
  createDependentsResolver,
  diffPackageJsonRuntimeFields,
  isRuntimeIrrelevant,
  parseNameStatus,
  PLUGIN_TEST_IRRELEVANT_FILES,
  ROOT_TOOLCHAIN_FILES,
  scopedLimit,
} from './lib/impact-scope.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const hasFlag = (flag) => argv.includes(flag)
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log('用法: node scripts/analyze-impact-replay.mjs [--limit N] [--legacy] [--json]')
  process.exit(0)
}

const LIMIT = Number.parseInt(valueOf('--limit', '200'), 10)
const AS_JSON = hasFlag('--json')
const WITH_LEGACY = hasFlag('--legacy') || !AS_JSON

const git = (gitArgs) => {
  const r = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

const PLUGINS = readdirSync(join(root, 'plugins'))
  .filter((name) => existsSync(join(root, 'plugins', name, 'package.json')))
  .sort()
const dependentsOf = createDependentsResolver(root, PLUGINS)

const commits = (git(['log', '--no-merges', '--pretty=format:%H', '-n', String(LIMIT)]) ?? '')
  .split('\n')
  .filter((line) => line !== '')

/** 旧规则的直接依赖方阈值（issue #188 之前）：≥ 3 就全量。仅供对比统计使用。 */
const LEGACY_HIGH_FANIN = 3

/** #188 之前的根工具链集合快照（package-lock.json 当时也在里面 → 一律退化）。 */
const LEGACY_ROOT_TOOLCHAIN = new Set([...ROOT_TOOLCHAIN_FILES, 'package-lock.json'])

/** 旧规则（issue #188 之前）：scripts/** 一律退化、package.json 任何字段变化都退化、diff-filter 无 D。 */
function legacyEscalates(changed) {
  for (const { path: file, status } of changed) {
    if (status === 'D') continue // 旧 --diff-filter=ACMR 根本看不到删除条目
    const m = /^plugins\/([^/]+)\//.exec(file)
    if (m) {
      if (PLUGINS.includes(m[1]) && dependentsOf(m[1]).size >= LEGACY_HIGH_FANIN) return true
      continue
    }
    if (file.startsWith('scripts/') || LEGACY_ROOT_TOOLCHAIN.has(file)) return true
    if (isRuntimeIrrelevant(file)) continue
    return true
  }
  return false
}

/** 退化主因定位：第一个把范围顶成全量的文件（与 computeImpactScope 的判定顺序一致）。 */
function escalationCause(changed, pkgFields) {
  for (const { path: file, status } of changed) {
    if (PLUGIN_TEST_IRRELEVANT_FILES.has(file) && status !== 'D') continue
    const m = /^plugins\/([^/]+)\//.exec(file)
    if (m) {
      if (!PLUGINS.includes(m[1]) && status === 'D') return '删除插件 ' + m[1]
      if (PLUGINS.includes(m[1]) && closureOf(m[1], dependentsOf, PLUGINS).size > scopedLimit(PLUGINS))
        return '共享库闭包 ' + m[1]
      continue
    }
    if (file === 'package.json') {
      if (status === 'M' && Array.isArray(pkgFields) && pkgFields.length === 0) continue
      return pkgFields === null ? 'package.json' : 'package.json (' + pkgFields.join(',') + ')'
    }
    if (file.startsWith('scripts/') || ROOT_TOOLCHAIN_FILES.has(file)) return file
    if (isRuntimeIrrelevant(file)) continue
    return file
  }
  return '（未定位）'
}

const stats = {
  total: 0,
  docsOnly: 0,
  scoped: 0,
  escalated: 0,
  scopedPlugins: 0,
  legacyEscalated: 0,
  causes: new Map(),
}
for (const commit of commits) {
  const parent = git(['rev-parse', '--verify', '--quiet', commit + '^'])
  if (parent === null) continue // 根提交（无父）跳过
  const base = parent.trim()
  const raw = git([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '--no-renames',
    '--diff-filter=ACMRD',
    base,
    commit,
  ])
  if (raw === null) continue
  const changed = parseNameStatus(raw)
  if (changed.length === 0) continue

  const pkgFields = changed.some((c) => c.path === 'package.json')
    ? diffPackageJsonRuntimeFields(
        git(['show', base + ':package.json']) ?? '',
        git(['show', commit + ':package.json']) ?? '',
      )
    : null
  const scope = computeImpactScope(changed, { plugins: PLUGINS, dependentsOf, packageJsonRuntimeFields: pkgFields })

  stats.total += 1
  if (scope.escalated) {
    stats.escalated += 1
    const cause = escalationCause(changed, pkgFields)
    stats.causes.set(cause, (stats.causes.get(cause) ?? 0) + 1)
  } else if (scope.docsOnly) {
    stats.docsOnly += 1
  } else {
    stats.scoped += 1
    stats.scopedPlugins += scope.plugins.size
  }
  if (legacyEscalates(changed.filter((c) => c.status !== 'D' || true))) {
    // legacy 判定内部自行跳过 D（旧 diff-filter 看不到删除）
    stats.legacyEscalated += 1
  }
}

const pct = (n) => ((n / Math.max(1, stats.total)) * 100).toFixed(1) + '%'
const topCauses = [...stats.causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        total: stats.total,
        docsOnly: stats.docsOnly,
        scoped: stats.scoped,
        escalated: stats.escalated,
        avgPluginsPerScopedRun: stats.scoped > 0 ? Number((stats.scopedPlugins / stats.scoped).toFixed(2)) : 0,
        causes: Object.fromEntries(topCauses),
        legacyEscalated: stats.legacyEscalated,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const log = (msg = '') => console.log('[replay] ' + msg)
log('范围：最近 ' + commits.length + ' 个非 merge 提交（规则 = scripts/lib/impact-scope.mjs，依赖图取当前工作区）')
log('')
log('  分类                        次数    占比')
log('  纯文档/CI 短路        ' + String(stats.docsOnly).padStart(8) + '  ' + pct(stats.docsOnly).padStart(6))
log(
  '  插件裁剪              ' +
    String(stats.scoped).padStart(8) +
    '  ' +
    pct(stats.scoped).padStart(6) +
    '   （平均 ' +
    (stats.scoped > 0 ? (stats.scopedPlugins / stats.scoped).toFixed(2) : '0') +
    ' 个受影响插件）',
)
log('  安全退化全量          ' + String(stats.escalated).padStart(8) + '  ' + pct(stats.escalated).padStart(6))
log('  （计入 ' + stats.total + ' 个非空提交）')
log('')
if (topCauses.length > 0) {
  log('退化主因（Top ' + topCauses.length + '）：')
  for (const [cause, count] of topCauses) log('  ' + String(count).padStart(4) + '  ' + cause)
  log('')
}
if (WITH_LEGACY) {
  log(
    '旧规则对比（issue #188 之前：package-lock/scripts 一律退化、package.json 任何字段变化都退化、diff-filter 无 D）：',
  )
  log(
    '  旧规则退化 ' +
      stats.legacyEscalated +
      ' 次（' +
      pct(stats.legacyEscalated) +
      '） → 新规则 ' +
      stats.escalated +
      ' 次（' +
      pct(stats.escalated) +
      '）',
  )
  log('  说明：旧规则下「纯删除提交」因 diff-filter 无 D 而根本看不到变更（本地跑 0 个测试却退出 0）——')
  log('        这类提交在新规则下会被正确归类（插件裁剪或退化），是本脚本无法用旧规则等价复现的部分。')
}
