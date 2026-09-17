#!/usr/bin/env node
/**
 * 客户端 bundle 模块白名单门禁 —— scripts/check-client-modules.mjs（issue #321）
 *
 * 背景（本仓库最痛一类故障，此前**无任何门禁**）：
 * 浏览器端 ModuleLoader 的同步 `require` 只认三类来源 —— 平台 seed 表 / 已 materialize
 * 的模块 / 已注册的 package factory；否则抛
 * `client-modules: require("X") missed the module table`，**整条 client factory 随之抛错**，
 * 该插件的所有 UI 席位一起挂掉。而插件安装路径**不会**自动安装/激活
 * `dsh.client.external` 指向的包（`dsh plugin add` 只把 profile 直接 dependencies 里声明
 * `dsh.bundle.patch` 的包写进 bundles）——所以"产物里 require 了什么"必须独立检查。
 *
 * 真实事故三次，根因都是这一条：issue #39（未声明就 require）→ #290（声明了也装不上）
 * → #293（"降级"是假降级）。#294 的 1c 只检查"external 必须在依赖里声明"，**发现不了**
 * "产物 require 了一个既非 seed、也没在 external 声明的模块"。
 *
 * 本脚本的判据（fail-closed）：
 *   扫 `plugins/*​/lib/client.js` 里所有**字面量** `require('<spec>')`（AST 提取，
 *   注释与字符串里的示例不计 —— 实测 my-plugin-manager / think-zh-expand 的产物注释里
 *   就写着 `require('dsh-shared/client-parts/...')` 的反例说明），逐条判定是否在允许集合内：
 *     ① 平台 seed 表（见 SEED_MODULES，来源见其上方注释）
 *     ② 该插件 `package.json` 的 `dsh.client.external`（含 `<pkg>` 与 `<pkg>/client` 两种形态）
 *     ③ 插件自身的包名（含 `<name>/client`）
 *   不在集合内 → 门禁失败，并逐个输出「为什么在用户机器上会 miss the module table + 修法」。
 *
 * 用法：
 *   node scripts/check-client-modules.mjs              # 门禁模式（默认）
 *   node scripts/check-client-modules.mjs --json       # 机器可读结果
 *   node scripts/check-client-modules.mjs --root <dir> # 指定仓库根（测试用）
 *
 * 退出码：0 通过；1 有违规（或产物解析失败——解析失败绝不静默跳过）；2 用法错误。
 */
import { parse } from '@babel/parser'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 平台 seed 表：宿主主 bundle 的 `staticModules` 显式暴露、插件 client 可直接 `require`
 * 的模块（零安装/零打包）。
 *
 * 来源：`docs/开发指南/官方UI组件库.md` 的「接入契约」节（实测 `staticModules: Jd()` 暴露 react /
 * react/jsx-runtime / react-dom / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots /
 * @deepseek-ai/dsh-client-ui-primitives）。issue #321 另列了 react-dom/client、
 * @deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-dockkit —— 一并收录，
 * 它们是同一 seed 表在其它宿主版本/文档里的形态。**新发现的 seed 模块只在这里加一处。**
 */
export const SEED_MODULES = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** 违规时的解释与修法（输出给作者，避免只报"违规"却不知为何/怎么办）。 */
const WHY =
  'ModuleLoader 同步 require 只认 seed 表 / 已 materialize / 已注册 factory；' +
  '插件安装路径不会自动安装并激活该包 → 用户机器上抛 missed the module table，整条 client factory 挂掉'
const FIX =
  '补 dsh.client.external 声明（并在有降级路径时同时声明 externalDegraded）；' +
  '改用平台 seed 模块；或去掉该 require 走真降级（不要用 try/catch 吞掉模块加载错误）'

/** 仓库根（CLI --root 可覆盖，测试用）。 */
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 从 bundle 源码里提取所有字面量 require 的 spec（AST 提取：注释/字符串示例不计）。 */
export function collectRequiredSpecs(code, filePath = '<inline>') {
  let ast
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx'],
      attachComment: false,
      errorRecovery: false,
    })
  } catch (error) {
    const at = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : ''
    throw new Error(`client bundle 解析失败 ${filePath}${at} — ${error.message}`)
  }
  // 按 node.start 排序：栈式遍历不保证源码顺序，而报告要稳定可读（测试也据此断言）
  const found = []
  const stack = [ast.program]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'require' &&
      node.arguments?.length === 1 &&
      (node.arguments[0].type === 'StringLiteral' || node.arguments[0].type === 'Literal') &&
      typeof node.arguments[0].value === 'string'
    ) {
      found.push({ start: node.start ?? 0, spec: node.arguments[0].value })
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      stack.push(node[key])
    }
  }
  return found.sort((a, b) => a.start - b.start).map((entry) => entry.spec)
}

/** 读插件 package.json 的允许集合信息（包名 + dsh.client.external）。 */
export function readPackageAllowlist(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const external = pkg?.dsh?.client?.external
  return {
    name: typeof pkg.name === 'string' ? pkg.name : null,
    external: Array.isArray(external) ? external.filter((x) => typeof x === 'string') : [],
  }
}

/** 单条 spec 是否被允许（seed / external / 自身包名；`<pkg>` 与 `<pkg>/client` 等价）。 */
export function isAllowedSpec(spec, { name, external }) {
  const variantsOf = (base) => [base, `${base}/client`]
  if (SEED_MODULES.includes(spec)) return true
  if (name !== null && variantsOf(name).includes(spec)) return true
  for (const declared of external) {
    if (variantsOf(declared).includes(spec)) return true
  }
  return false
}

/** 扫描一个插件目录（有 lib/client.js 才算 client 插件）。 */
export function auditBundle({ bundlePath, pkgPath }) {
  const code = readFileSync(bundlePath, 'utf8')
  const allow = readPackageAllowlist(pkgPath)
  const specs = [...new Set(collectRequiredSpecs(code, bundlePath))].sort()
  const violations = specs.filter((spec) => !isAllowedSpec(spec, allow))
  return { name: allow.name, specs, violations, external: allow.external }
}

/** 扫描仓库内全部插件产物。 */
export function auditRepo(root = DEFAULT_ROOT) {
  const pluginsDir = join(root, 'plugins')
  if (!existsSync(pluginsDir)) throw new Error(`插件目录不存在：${pluginsDir}`)
  const results = []
  for (const entry of readdirSync(pluginsDir).sort()) {
    const dir = join(pluginsDir, entry)
    if (!statSync(dir).isDirectory()) continue
    const bundlePath = join(dir, 'lib', 'client.js')
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(bundlePath) || !existsSync(pkgPath)) continue
    results.push({ plugin: entry, ...auditBundle({ bundlePath, pkgPath }) })
  }
  return results
}

/** 人类可读报告（含"为什么/修法"两列——只报违规数字等于把排查成本推给作者）。 */
function renderReport(results) {
  const lines = []
  const offenders = results.filter((r) => r.violations.length > 0)
  lines.push('客户端 bundle 模块白名单门禁（scripts/check-client-modules.mjs，issue #321）')
  lines.push(`扫描：${results.length} 个含 lib/client.js 的插件`)
  if (offenders.length === 0) {
    lines.push(`✅ 通过：全部产物的 require 都在白名单内（seed 表 / dsh.client.external / 自身包名）`)
    return lines.join('\n')
  }
  lines.push(`❌ ${offenders.length} 个插件存在违规 require：`)
  for (const r of offenders) {
    for (const spec of r.violations) {
      lines.push('')
      lines.push(`  插件：${r.plugin}（${r.name ?? '未命名'}）`)
      lines.push(`  违规 spec：${spec}`)
      lines.push(`  为什么用户机器上会 miss the module table：${WHY}`)
      lines.push(`  修法：${FIX}`)
    }
  }
  return lines.join('\n')
}

// ── CLI ────────────────────────────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const rootIndex = args.indexOf('--root')
  const root = rootIndex >= 0 ? args[rootIndex + 1] : DEFAULT_ROOT
  if (rootIndex >= 0 && (root === undefined || root.startsWith('--'))) {
    console.error('用法：node scripts/check-client-modules.mjs [--json] [--root <dir>]')
    process.exit(2)
  }
  try {
    const results = auditRepo(root)
    const violations = results.filter((r) => r.violations.length > 0)
    if (json) {
      console.log(JSON.stringify({ ok: violations.length === 0, scanned: results.length, results }, null, 2))
    } else {
      console.log(renderReport(results))
    }
    process.exit(violations.length === 0 ? 0 : 1)
  } catch (error) {
    // 解析/IO 失败绝不静默跳过（产物坏了要有人知道，而不是门禁变绿）
    console.error(
      `❌ 客户端 bundle 模块白名单门禁：脚本错误 — ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}
