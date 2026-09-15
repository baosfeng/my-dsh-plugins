#!/usr/bin/env node
/**
 * 包发布卫生门禁 —— scripts/check-pack-hygiene.mjs（issue #323）
 *
 * 背景：插件以 npm 包发布（`exports` 映射 `./client`、`files` 白名单、`dsh.bundle.patch`、
 * `main`）。这些字段写错会**直接变成用户侧故障**：安装后 require 失败、漏发产物、README
 * 图片在 npm/unpkg 上 404、把测试/源码/coverage 一并发布。既有门禁查了版本 / CHANGELOG /
 * peer 依赖 / 跨插件依赖 / 测试 / 截图 / 真实验证，**没有一项检查"这个包本身是否可安装、
 * 内容是否正确"**——本门禁补这一格。
 *
 * 判据（全部 fail-closed；判定逻辑在 scripts/lib/pack-hygiene.mjs，纯函数可单测）：
 *   ① 字段指向的文件必须真实存在：`exports`（递归所有条件值）/ `main` / `types` /
 *      `dsh.bundle.patch`（issue 需求 1；实测与 publint 同判据，选型理由见 lib 文件头注释）；
 *   ② `dsh.*` 字段自洽：声明 `dsh.client` ⇒ `platform === 'web'` 且 `exports["./client"]`
 *      存在；有 `exports["./client"]` ⇒ 必须声明 `dsh.client`；有 `cordis.patch.yml` ⇒
 *      必须声明 `dsh.bundle.patch`（否则"装了没反应"，issue 需求 3）；
 *   ③ `npm pack --dry-run --json` 内容断言（issue 需求 2）：README/CHANGELOG/LICENSE/
 *      package.json 与所有声明目标**必须在包里**；`test/` `src/` `coverage/` `reports/`
 *      `node_modules/` `.DS_Store` `*.log` **不得在包里**；
 *   ④ README 引用的资产（相对路径或 `unpkg.com/<本包>/...`）必须**存在且随包发布**
 *      —— 这是 3b 效果图门禁的盲区（3b 只查文件在仓库里存在，查不到 files 白名单没带它）。
 *
 * 「源在仓库但故意不发布」的表达（issue 明确要求，不许一刀切）：判据是**被已发布面引用
 * 才必须在包内**。`vendor/`、`src/`、`test/`、`scripts/`、`dsh-shared/client-parts/` 等
 * 不被引用 → 只作为 info 列出（`describeUnpackedEntries`）、绝不报警。
 *
 * 用法：
 *   node scripts/check-pack-hygiene.mjs                 # 门禁模式（全仓库 19 个插件）
 *   node scripts/check-pack-hygiene.mjs --list          # 快速模式：只列包内容 + 耗时，不判定
 *   node scripts/check-pack-hygiene.mjs --json          # 机器可读结果
 *   node scripts/check-pack-hygiene.mjs --root <dir>    # 指定仓库根（测试用）
 *   node scripts/check-pack-hygiene.mjs --plugin <name> # 只查单个插件（release.mjs 用）
 *
 * 退出码：0 通过；1 有违规或 pack/解析/IO 失败（绝不静默变绿）；2 用法错误。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPlugin, parsePackJson } from './lib/pack-hygiene.mjs'
import { mapWithConcurrency } from './lib/release-concurrency.mjs'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** npm 在 Windows 上是 .cmd 包装（本仓库 CI 为 ubuntu/macOS，保守兜底）。 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
/** pack 并发度：pack 是独立子进程（无共享临时目录），实测 6 路 19 插件 ~1.5s（串行 ~7s）。 */
const PACK_CONCURRENCY = 6

/** 跑一次 `npm pack --dry-run --json`。任何失败都是 fail-closed（返回 ok:false）。 */
function runNpmPack(dir, { ignoreScripts = true } = {}) {
  const startedAt = Date.now()
  const args = ['pack', '--dry-run', '--json']
  // 仓库 19 个插件的 package.json 实测**零** prepack/prepare/prepublishOnly 脚本
  // （见 PR #323 基线），因此忽略脚本不改变打包结果；而"门禁跑一次 pack 就执行任意
  // 生命周期脚本"是不可接受的副作用面。若未来引入 prepack，本门禁的 required/target
  // 断言会因产物缺失而 fail-closed（宁可误报，绝不漏报）。
  if (ignoreScripts) args.push('--ignore-scripts')
  return new Promise((resolvePromise) => {
    const child = spawn(NPM, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      resolvePromise({ ok: false, ms: Date.now() - startedAt, error: `无法执行 npm：${error.message}` })
    })
    child.on('close', (code) => {
      const ms = Date.now() - startedAt
      if (code !== 0) {
        resolvePromise({
          ok: false,
          ms,
          error: `npm pack 退出码 ${code}：${err.trim().split('\n').slice(0, 3).join(' / ')}`,
        })
        return
      }
      try {
        resolvePromise({ ok: true, ms, ...parsePackJson(out) })
      } catch (error) {
        resolvePromise({ ok: false, ms, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
}

/** 列出插件目录下的顶层条目（判定「源在仓库但故意不发布」用）。 */
function listTopEntries(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        try {
          return { name, isDirectory: statSync(join(dir, name)).isDirectory() }
        } catch {
          return { name, isDirectory: false }
        }
      })
  } catch {
    return []
  }
}

/**
 * 判定单个插件。任何一步失败都返回 `{ aborted: <原因> }`（fail-closed，绝不静默跳过）。
 * 导出供 `scripts/release.mjs` 门禁 1d 单插件调用（issue #323）。
 */
export async function checkPlugin({ root, plugin }) {
  const dir = join(root, 'plugins', plugin)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { plugin, dir, aborted: `找不到 ${pkgPath}（插件目录不存在或未初始化）` }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    return { plugin, dir, aborted: `package.json 解析失败：${error instanceof Error ? error.message : error}` }
  }
  const readmePath = join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
  const pack = await runNpmPack(dir)
  if (!pack.ok) return { plugin, dir, aborted: pack.error, ms: pack.ms }
  const result = auditPlugin({
    pkg,
    readme,
    packedPaths: pack.paths,
    repoEntries: listTopEntries(dir),
    exists: (rel) => existsSync(join(dir, rel)),
  })
  return {
    plugin,
    dir,
    ms: pack.ms,
    name: result.name,
    version: typeof pkg.version === 'string' ? pkg.version : '?',
    entryCount: pack.entryCount,
    unpackedSize: pack.unpackedSize,
    packedPaths: pack.paths,
    problems: result.problems,
    unpacked: result.unpacked,
  }
}

/** 扫描全仓库插件（`--plugin` 时只查一个；插件不存在即 fail-closed）。导出供测试/发版复用。 */
export async function checkRepo(root, only) {
  const pluginsDir = join(root, 'plugins')
  if (!existsSync(pluginsDir)) throw new Error(`插件目录不存在：${pluginsDir}`)
  let names = readdirSync(pluginsDir)
    .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
    .filter((name) => existsSync(join(pluginsDir, name, 'package.json')))
    .sort()
  if (only !== null) {
    if (!names.includes(only)) throw new Error(`找不到插件：${only}（plugins/ 下不存在其 package.json）`)
    names = [only]
  }
  const results = await mapWithConcurrency(names, PACK_CONCURRENCY, (plugin) => checkPlugin({ root, plugin }))
  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { plugin: names[i], aborted: String(r.reason) }))
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`

/** 渲染单条问题（只报"违规"等于把排查成本推给作者 → 必须带为什么 + 修法）。 */
function renderProblem(p) {
  return [
    `      [${p.code}] ${p.message}`,
    `        位置：${p.where}`,
    `        为什么：${p.why}`,
    `        修法：${p.fix}`,
  ]
}

/** 人类可读报告。 */
function renderReport(results, { listOnly }) {
  const lines = []
  const totalMs = results.reduce((sum, r) => sum + (r.ms ?? 0), 0)
  lines.push('包发布卫生门禁（scripts/check-pack-hygiene.mjs，issue #323）')
  lines.push(`扫描：${results.length} 个插件（npm pack --dry-run --json --ignore-scripts，并发 ${PACK_CONCURRENCY}）`)
  lines.push('')
  for (const r of results) {
    const head = `- ${(r.name ?? r.plugin).padEnd(32)} v${r.version ?? '?'}  包内 ${String(r.entryCount ?? '?').padStart(3)} 项 / ${r.unpackedSize === undefined ? '?' : kb(r.unpackedSize)}  pack ${r.ms ?? '?'}ms`
    if (r.aborted !== undefined) {
      lines.push(`${head}  ✗ 无法判定`)
    } else {
      lines.push(`${head}  ${r.problems.length === 0 ? '✓' : `✗ ${r.problems.length} 问题`}`)
    }
  }
  lines.push('')
  lines.push(
    `实测耗时：pack 合计 ${totalMs}ms（平均 ${results.length === 0 ? 0 : Math.round(totalMs / results.length)}ms/插件）`,
  )
  if (listOnly) {
    for (const r of results) {
      if (r.packedPaths === undefined) continue
      lines.push('')
      lines.push(`## ${r.name}（${r.packedPaths.length} 项）`)
      for (const p of r.packedPaths) lines.push(`   ${p}`)
    }
    return lines.join('\n')
  }
  const aborted = results.filter((r) => r.aborted !== undefined)
  const offenders = results.filter((r) => Array.isArray(r.problems) && r.problems.length > 0)
  const unpackedAll = results.filter((r) => Array.isArray(r.unpacked) && r.unpacked.length > 0)
  if (unpackedAll.length > 0) {
    lines.push('')
    lines.push('仓库内存在但不随包发布的条目（**故意如此**，判据是"未被已发布面引用"，不报警）：')
    for (const r of unpackedAll) {
      const names = r.unpacked.map((e) => e.name)
      const suspicious = r.unpacked.filter((e) => e.unexpected).map((e) => e.name)
      const note = suspicious.length === 0 ? '' : `（新目录 ${suspicious.join(', ')} 未发布，确认是有意为之）`
      lines.push(`  ${r.plugin}: ${names.join(', ')}${note}`)
    }
  }
  if (aborted.length === 0 && offenders.length === 0) {
    lines.push('')
    lines.push(`✅ 通过：${results.length}/${results.length} 个插件的发布内容与字段自洽（0 问题）`)
    return lines.join('\n')
  }
  lines.push('')
  for (const r of aborted) {
    lines.push(`❌ ${r.plugin}：无法判定（fail-closed）`)
    lines.push(`      原因：${r.aborted}`)
    lines.push(`      修法：确认 npm 可用、插件目录完整（package.json / 可打包内容）后重跑本门禁`)
    lines.push('')
  }
  for (const r of offenders) {
    lines.push(`❌ ${r.name ?? r.plugin}（${r.plugin}@v${r.version}）`)
    for (const p of r.problems) lines.push(...renderProblem(p))
    lines.push('')
  }
  lines.push(`结论：${offenders.length} 个插件有问题、${aborted.length} 个无法判定 — 发版前必须修`)
  return lines.join('\n')
}

// ── CLI ────────────────────────────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const listOnly = args.includes('--list')
  const rootIdx = args.indexOf('--root')
  const pluginIdx = args.indexOf('--plugin')
  const root = rootIdx >= 0 ? args[rootIdx + 1] : DEFAULT_ROOT
  const only = pluginIdx >= 0 ? args[pluginIdx + 1] : null
  const badUsage =
    (rootIdx >= 0 && (root === undefined || root.startsWith('--'))) ||
    (pluginIdx >= 0 && (only === undefined || only.startsWith('--')))
  if (badUsage) {
    console.error('用法：node scripts/check-pack-hygiene.mjs [--json] [--list] [--root <dir>] [--plugin <name>]')
    process.exit(2)
  }
  const startedAt = Date.now()
  try {
    const results = await checkRepo(root, only)
    const wallMs = Date.now() - startedAt
    const failed =
      results.some((r) => r.aborted !== undefined) ||
      (!listOnly && results.some((r) => Array.isArray(r.problems) && r.problems.length > 0))
    if (json) {
      console.log(JSON.stringify({ ok: !failed, scanned: results.length, wallMs, results }, null, 2))
    } else {
      console.log(renderReport(results, { listOnly }))
      console.log(`墙钟：${wallMs}ms`)
    }
    process.exit(failed ? 1 : 0)
  } catch (error) {
    // IO/环境失败绝不静默跳过（找不到插件、pack 炸掉都要有人知道，而不是门禁变绿）
    console.error(`❌ 包发布卫生门禁：脚本错误 — ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
