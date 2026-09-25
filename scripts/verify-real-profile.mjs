#!/usr/bin/env node
/**
 * verify-real-profile.mjs — 真实环境全流程验证（配置副本模拟）。
 *
 * 复刻生产 profile 的「配置组合」（bundle 自动插行 + profile 手动 patch 行
 * 的叠加）到临时 DSH_HOME，可选模拟安装新插件（--addons），然后完整验证：
 *
 *   1. dump-config 配置组合检查：插件行 id 必须全局唯一
 *      （duplicate loader entry id 是真实启动最常见的配置组合炸弹——全新
 *      独立实例永远测不出它，只有复用真实配置组合才能复现/验证）；
 *      --addons 的插件还必须在组合配置里**处于启用态**：`disabled: true` 的行虽然
 *      出现在 dump 里（旧判据据此判通过），插件却被加载而不运行 —— 禁用位在 profile
 *      的 cordis.patch.yml 里（dshmarket 启停开关也落到那里），不在 `.dsh-market`；
 *   2. 启动独立实例（真实进程，插件树加载 + apply + 路由注册）；
 *   3. 健康检查（HTTP 200）+ 启动日志错误扫描；
 *   4. 可选 --api-path 对已挂载插件的 API 做冒烟（验证 server 端 apply 生效）；
 *   5. 停止实例并清理临时目录（绝不残留）。
 *
 * 用法：
 *   node scripts/verify-real-profile.mjs [--profile web] [--port 3087]
 *        [--addons plugins/dsh-my-skill-manager]... [--api-path /my-skill-manager/api/list]...
 *        [--timeout 90] [--skip] [--keep] [--help]
 *        [--checklist <path>] [--check <path>] [--plugin <name>] [--version <x.y.z>]
 *        [--workspace <dir>] [--workspace-title <title>] [--refresh-header]
 *        [--clean-externals] [--omit-node-modules <pkg>]...
 *
 * 退出码：0 = 全部通过；1 = 任一环节失败。
 *
 * issue #294（external 缺包演练，防 #290/#293 复发）：
 *   隔离实例过去**无条件复用生产 profile 的全部 node_modules 条目** —— 本机 profile 已
 *   装了 dsh-md-render 时，「新装用户拿不到 external 依赖」这个状态永远不可能被验证到
 *   （实测量化见 PR：#294 之前 3c 对这种插件恒通过）。现在：
 *     --clean-externals        从 --addons 的 dsh.client.external 自动推导「缺包演练」集合；
 *     --omit-node-modules <pkg> 显式省略某个 node_modules 条目（可重复；环境噪声隔离也用它）；
 *   被省略的条目**既不复用真实 profile、也不做 addon 链接**，并在实例启动前
 *   fail-closed 校验「确实不可解析」（checkOmittedAbsent），随后连同启动日志错误扫描
 *   一起断言：缺包时插件仍能加载、日志不出现 failed to import loader entry /
 *   missed the module table / Element type is invalid 等错误。
 *   注意（诚实记录）：client 侧崩溃（Element type is invalid）发生在浏览器运行时，
 *   server 启动日志未必留痕 —— 这一项仍需 skills/verifying-dsh-plugins 的浏览器步骤兜底。
 *   默认不开（旧行为不变）；发版门禁 scripts/release.mjs 3c 默认传 --clean-externals。
 *
 * issue #220（假验证修复）：
 *   --addons 是「待验代码」的显式声明，其 profile node_modules 条目**必须**指向该
 *   addon 目录。旧实现在同名条目已存在时复用真实 profile 的软链（生产 profile 用
 *   link: 装在主工作区），隔离实例于是加载主工作区版本 → 假通过（未验证的修复被
 *   当成已验证）/ 假失败（agent 以为改动无效，去改本来正确的代码）。现在软链强制
 *   重写，并在实例启动前**打印 + 校验**每个 addon 的 realpath：不一致即退出（静默
 *   正是这个坑潜伏数轮的原因）。--workspace <dir> 预置隔离实例工作区状态，免去每
 *   个 agent 手工试错 storages/workspace.json 的隐性 Zod 格式。
 *
 * issue #67 增强（发版前功能级验证留痕）：
 *   --checklist <path>  验证通过后生成「发版前功能级验证清单」Markdown 文件：
 *                       自动验证项（配置组合/启动/日志/API）自动勾选 [x]，
 *                       功能级验证项（核心功能/易碎场景/client UI/插件联动）
 *                       留空 [ ] 待验证者（人工或 agent）在真实浏览器中验证后勾选。
 *   --check <path>     校验清单文件：功能级验证项必须全部 [x]（供 release.mjs
 *                       发版门禁调用；未全部勾选 → exit 1）。
 *   --plugin/--version 写入清单头部（插件名与版本，便于留痕归档）。
 *
 * issue #329（幂等，不许覆盖人工留痕）：
 *   过去 --checklist **整文件重写**目标清单 —— 已发布版本的 `verification/<插件>-<版本>.md`
 *   被重跑一次后，末尾「验证记录（真实环境证据）」整段（实测 45 行）被删除、头部
 *   「验证时间/端口」被改写（3092 → 3087，对已发布版本是纯假 diff），改动还会以
 *   未提交状态留在工作区（极易被顺手提交掉）。现在：
 *     目标文件已存在 → **幂等合并**（scripts/lib/verify-checklist.mjs）：人工「验证记录」
 *     段与已勾选的 [x] 逐字节保留，头部时间/端口保持原值（换端口重跑不产生任何 diff），
 *     只刷新脚本拥有的自动验证项；需要把本轮环境写进头部时加 `--refresh-header`。
 *     目标文件不存在 → 按模板新建（行为与旧版逐字节一致）。
 *   清单的生成/合并/门禁判定全部是 lib 里的**纯函数**（单测
 *   scripts/test/verify-checklist.test.mjs 不需要启动任何隔离实例）。
 */
import { spawn } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  bootFailureExcerpt,
  checkAddonEntriesEnabled,
  checkAddonResolution,
  checkOmittedAbsent,
  decideBootOutcome,
  extractApiToken,
  fatalBootHits,
  isPluginStatePath,
  linkNodeModules,
  presentStateDirs,
  readAddon,
  readAddonExternals,
  stripProfileDeclarations,
  writeWorkspaceStorage,
} from './lib/verify-profile.mjs'
import { DEFAULT_AUTO_ITEMS, checkChecklistFile, mergeChecklist, renderChecklist } from './lib/verify-checklist.mjs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import tmp from 'tmp'

// ── args ───────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}

function parseArgs(args) {
  const result = {
    profile: 'web',
    port: 3087,
    addons: [],
    apiPaths: [],
    timeoutSec: 90,
    skipWeb: false,
    keep: false,
    help: false,
    checklist: null,
    check: null,
    plugin: '',
    version: '',
    workspace: null,
    workspaceTitle: null,
    cleanExternals: false,
    omitNodeModules: [],
    refreshHeader: false,
  }
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    const value = () => args[++i]
    if (flag === '--profile') result.profile = value()
    else if (flag === '--port') result.port = Number(value())
    else if (flag === '--addons') result.addons.push(value())
    else if (flag === '--api-path') result.apiPaths.push(value())
    else if (flag === '--timeout') result.timeoutSec = Number(value())
    else if (flag === '--skip') result.skipWeb = true
    else if (flag === '--keep') result.keep = true
    else if (flag === '--checklist') result.checklist = value()
    else if (flag === '--check') result.check = value()
    else if (flag === '--plugin') result.plugin = value()
    else if (flag === '--version') result.version = value()
    else if (flag === '--workspace') result.workspace = value()
    else if (flag === '--workspace-title') result.workspaceTitle = value()
    // issue #329：清单已存在时头部时间/端口默认冻结（换端口重跑不产生假 diff）；
    // 确需把本轮环境写入留痕时显式开启。
    else if (flag === '--refresh-header') result.refreshHeader = true
    // issue #294：external 缺包演练（默认关，发版门禁 3c 默认开）
    else if (flag === '--clean-externals') result.cleanExternals = true
    else if (flag === '--omit-node-modules') result.omitNodeModules.push(value())
    else if (flag === '--help' || flag === '-h') result.help = true
    else {
      console.error(`[verify] unknown flag: ${flag}`)
      process.exit(1)
    }
  }
  return result
}

function printHelp() {
  console.log(
    '真实环境全流程验证（配置副本模拟）\n' +
      '用法: node scripts/verify-real-profile.mjs [options]\n' +
      '  --profile <name>   profile 名（默认 web）\n' +
      '  --port <port>      验证实例端口（默认 3087）\n' +
      '  --addons <dir>     模拟安装的插件目录（可重复；写入临时 profile 的 bundles + dependencies）\n' +
      '  --api-path <path>  启动后对每个 path 做 GET 冒烟（可重复）。\n' +
      '                     ⚠️ 需要浏览器会话（issue #257）：DSH web 有认证层，非交互环境下脚本\n' +
      '                     拿不到访问 token，这一项会**显式失败**并提示"这是脚本问题"。\n' +
      '                     要做 API 断言请走 skills/verifying-dsh-plugins 的浏览器步骤。\n' +
      '  --timeout <sec>    启动就绪超时（默认 90）\n' +
      '  --skip             只做配置组合检查（dump-config），不启动实例\n' +
      '  --keep             失败/完成后保留临时目录（默认清理）\n' +
      '  --checklist <path> 验证通过后生成发版前功能级验证清单（issue #67 留痕）。\n' +
      '                     清单已存在时**幂等合并**（issue #329）：人工「验证记录」段与已勾选的\n' +
      '                     [x] 逐字节保留，头部时间/端口保持原值（换端口重跑不产生假 diff），\n' +
      '                     只刷新自动验证项；需要把本轮环境写进头部时加 --refresh-header。\n' +
      '  --check <path>     校验清单功能级项全部勾选（供 release.mjs 门禁；未全勾选 exit 1）\n' +
      '  --refresh-header   刷新清单头部「验证时间 / 验证环境」为本轮值（默认冻结；issue #329）\n' +
      '  --plugin <name>    清单头部插件名（配合 --checklist）\n' +
      '  --version <x.y.z>  清单头部版本号（配合 --checklist）\n' +
      '  --workspace <dir>  预置隔离实例的工作区状态（storages/workspace.json；path 自动取 realpath）\n' +
      '  --workspace-title <t> 工作区标题（配合 --workspace；默认取目录名）\n' +
      '  --clean-externals  缺包演练（issue #294）：从 --addons 的 dsh.client.external 自动推导\n' +
      '                     要从隔离实例 node_modules 省略的包（复现"新装用户没装 external 依赖"）。\n' +
      '                     默认关；发版门禁 release.mjs 3c 默认开。\n' +
      '  --omit-node-modules <pkg> 显式省略某个 node_modules 条目（可重复；含 scope 展开的子条目）\n',
  )
}

// ── 常量 ───────────────────────────────────────────────────────────────────
const home = homedir()
const realProfile = join(home, '.dsh', 'profiles', options.profile)
const simHome = tmp.dirSync({ prefix: `dsh-verify-real-${options.port}-`, unsafeCleanup: true }).name
const simProfile = join(simHome, 'profiles', options.profile)
const dshBin = process.env.DSH_BIN || 'dsh'
let web = null
let failed = false
const log = (msg) => console.log(`[verify] ${msg}`)
const pass = (msg) => console.log(`[verify] ✓ ${msg}`)
const fail = (msg) => {
  failed = true
  console.error(`[verify] ✗ ${msg}`)
}

/** 运行命令并收集输出。 */
function run(command, argsList, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, argsList, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) =>
      resolveRun({ ok: false, code: -1, stdout, stderr, error: String(error?.message ?? error) }),
    )
    child.on('close', (code) => resolveRun({ ok: code === 0, code, stdout, stderr }))
  })
}

/** 从 dump-config 输出里收集所有 loader entry id。 */
function entryIds(dumpOutput) {
  const ids = []
  for (const line of dumpOutput.split('\n')) {
    const match = /^\s*-?\s*id:\s*([A-Za-z0-9._-]+)/.exec(line)
    if (match !== null) ids.push(match[1])
  }
  return ids
}

/**
 * 端口是否已被占用（issue #294：启动前 fail-closed 预检）。
 *
 * 就绪探测只认「任何 HTTP 响应」（#257：新版对无 token 的根路径返回 401），因此
 * **残留实例**会让自己 spawn 的实例还没起来就被判定"已就绪" —— 实测 0.2s 假就绪
 * （真实冷启动 ~8s），那一轮的验证结论（尤其"缺包演练"）全部不可信。
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(true))
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(port, '127.0.0.1')
  })
}

async function httpStatus(port, path = '/', token = null) {
  try {
    const url = new URL(`http://127.0.0.1:${port}${path}`)
    if (token) url.searchParams.set('token', token)
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })
    return res.status
  } catch {
    return 0
  }
}

/**
 * 取隔离实例的访问 token（issue #257）。
 *
 * 为什么必须要：DSH web 对**无凭据**请求返回 401/403。旧实现里 `--api-path` 的冒烟是裸
 * `fetch`（不带 token），于是**恒返回 404** —— 这一项成了"永远不通过、也永远不会真正
 * 失败"的空检查，让 release.mjs 3c 门禁的「API 冒烟」失去意义。
 *
 * 取法（两条，都不赌固定 sleep）：
 *   ① 启动输出：`dsh web` 首次启动会打印 `http://127.0.0.1:<port>/?token=…`；
 *      隔离实例每次都重建 DSH_HOME，属于首次启动，因此这条命中率最高；
 *   ② 退路：`<DSH_HOME>/.credentials.yaml` —— 该文件在启动过程中可能处于 .tmp/.lock
 *      写入中，故用**条件轮询**（每 500ms 试一次，直到超时），而不是 sleep 固定秒数。
 *
 * 拿不到 token 时**不静默**：调用方必须显式失败或降级并说明原因（见步骤 5）。
 */
async function resolveApiToken({ getWebLog, simHome, timeoutMs = 20000 }) {
  const file = join(simHome, '.credentials.yaml')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 条件轮询（不是 sleep 固定秒数）：token 行可能在"实例就绪"之后才出现，
    // 凭据文件在启动过程中也可能处于 .tmp/.lock 的写入态。
    let credentialsText = ''
    if (existsSync(file)) {
      try {
        credentialsText = readFileSync(file, 'utf8')
      } catch {
        /* 正在写入：下一轮再试 */
      }
    }
    const found = extractApiToken({ logText: getWebLog(), credentialsText })
    if (found.token) return found
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  return { token: null, source: null, logTail: String(getWebLog() ?? '').slice(-400) }
}

// ── 0. 前置校验 ────────────────────────────────────────────────────────────
// --check 模式：只校验清单文件功能级项是否全部勾选（供 release.mjs 门禁调用）。
// 判定逻辑在 scripts/lib/verify-checklist.mjs 的 checkChecklistText（纯函数，可单测）。
if (options.check !== null) {
  const result = checkChecklistFile(options.check)
  if (result.missing) {
    console.error(`[verify] ✗ 验证清单不存在: ${options.check}（发版前必须先跑 verify-real-profile.mjs --checklist）`)
    process.exit(1)
  }
  if (!result.ok) {
    console.error(`[verify] ✗ 功能级验证项未全部勾选（${result.pending.length} 项待验证）:`)
    for (const item of result.pending) console.error(`[verify]   - ${item}`)
    process.exit(1)
  }
  console.log(`[verify] ✓ 验证清单全部勾选: ${options.check}`)
  process.exit(0)
}
if (!existsSync(realProfile)) {
  console.error(`[verify] profile 不存在: ${realProfile}`)
  process.exit(1)
}
if (!existsSync(join(realProfile, 'package.json'))) {
  console.error(`[verify] profile 缺少 package.json: ${realProfile}`)
  process.exit(1)
}

// ── 1. 复刻配置层 ──────────────────────────────────────────────────────────
log(`复刻生产 profile 配置层 → ${simProfile}`)
rmSync(simHome, { recursive: true, force: true })
mkdirSync(join(simHome, 'profiles'), { recursive: true })
// issue #240：剥离插件自维护的启停状态（如 dshmarket 的 .dsh-market/state.json）。
// 不剥离的话，生产里被关掉的插件在隔离实例里同样被强制 off —— client bundle 不进 manifest、
// server API 404，看起来像"插件坏了"，实际是验证环境自己把插件关了。
const strippedStateDirs = presentStateDirs(realProfile)
cpSync(realProfile, simProfile, {
  recursive: true,
  filter: (src) => !src.includes('/node_modules') && !isPluginStatePath(src),
})
rmSync(join(simProfile, 'node_modules'), { recursive: true, force: true })
if (strippedStateDirs.length > 0) {
  log(`已剥离插件自维护的启停状态：${strippedStateDirs.join('、')}（否则生产的禁用名单会让隔离实例静默少加载插件）`)
}

// node_modules：真实条目全量软链（保住 pnpm 依赖解析）+ addons 条目**强制**指向
// addon 目录（issue #220：旧实现遇到同名条目直接复用真实 profile 的软链，隔离实例
// 于是加载主工作区版本而不是待验代码 → 假通过/假失败）。
const simNode = join(simProfile, 'node_modules')
const realNode = join(realProfile, 'node_modules')
const addons = []
for (const addon of options.addons) {
  const entry = readAddon(addon)
  if (entry === null) {
    console.error('[verify] --addons 不是插件目录（无 package.json）: ' + addon)
    process.exit(1)
  }
  addons.push(entry)
}
// issue #294：omit 集合 = 显式 --omit-node-modules + --clean-externals 从 addon 的
// dsh.client.external 推导。两者都不传时为空数组 → 链接计划与旧版逐条一致（行为不回归）。
const derivedExternals = options.cleanExternals ? addons.flatMap((addon) => readAddonExternals(addon.dir)) : []
const omitEntries = [...new Set([...options.omitNodeModules, ...derivedExternals])]
if (options.cleanExternals) {
  log(
    'external 缺包演练（--clean-externals）：从 --addons 的 dsh.client.external 推导出 ' +
      (omitEntries.length > 0 ? omitEntries.join('、') : '（无 —— 该插件未声明 external）'),
  )
}
const linkResult = linkNodeModules({ simNode, realNode, addons, omit: omitEntries })
for (const { entry, was } of linkResult.overridden) {
  log('覆盖生产 profile 的同名条目 ' + entry + '（原指向 ' + was + '）')
}
for (const { entry, was } of linkResult.replaced) {
  log('修正已存在的错误软链 ' + entry + '（原指向 ' + was + '）')
}

// issue #294：external 缺包演练的状态证据 + fail-closed 校验。
// 不 omit 的话，本机生产 profile 已装 dsh-md-render → 「新装用户没装 external 依赖」
// 这个状态永远不可能出现在隔离实例里（3c 结构性假通过，正是 #290/#293 漏到用户侧的原因）。
if (linkResult.omittedAddons.length > 0) {
  log('注意：以下 --addons 条目同时被 omit 覆盖，未做链接（omit 优先）：' + linkResult.omittedAddons.join('、'))
}
if (linkResult.omitted.length > 0) {
  log('external 缺包演练：隔离实例 node_modules 省略 ' + linkResult.omitted.join('、'))
  const absent = checkOmittedAbsent({ simNode, omitted: linkResult.omitted })
  if (!absent.ok) {
    fail(
      '缺包演练未生效（fail-closed）：以下条目在隔离实例 node_modules 里仍可解析 —— ' +
        absent.leaked.map((item) => item.entry + ' → ' + (item.resolved ?? item.link)).join('；'),
    )
    await cleanup()
    process.exit(1)
  }
  pass(
    '缺包演练生效：隔离实例 node_modules 不含 ' +
      linkResult.omitted.join('、') +
      '（生产 profile 里已装的同名条目被跳过）',
  )
}

// 启动前可见性检查（fail-closed，issue #220）：打印每个 addon 的实际解析路径，
// 与 addon 真实路径不一致即失败退出——静默正是这个坑潜伏数轮的原因。
const resolution = checkAddonResolution({ simNode, addons })
if (resolution.entries.length > 0) log('插件解析路径（隔离 profile node_modules）:')
for (const item of resolution.entries) {
  log('  ' + item.name + ' → ' + (item.actual ?? '(解析失败)') + (item.ok ? ' ✓' : ' ✗ 期望 ' + item.expected))
}
if (!resolution.ok) {
  fail(
    'addon 解析路径与 --addons 不一致（' +
      resolution.mismatches.length +
      ' 个）：' +
      resolution.mismatches
        .map((item) => item.name + ' 期望 ' + item.expected + ' 实际 ' + (item.actual ?? '(解析失败)'))
        .join('；'),
  )
  await cleanup()
  process.exit(1)
}

// ── 2. 模拟安装 addons（写入临时 profile：bundles + dependencies） ────────
if (addons.length > 0) {
  const pkgPath = join(simProfile, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const patchPath = join(simProfile, 'cordis.patch.yml')
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  for (const addon of addons) {
    const { dir: abs, name } = addon
    // 插件已手动安装（patch 行存在）时不再写入 bundles：bundle 自动插行 +
    // patch 手动行叠加会产生重复 id（发版校验对已安装插件跑 --addons 的场景）。
    const alreadyInConfig =
      pkg.dsh.profile.bundles.includes(name) ||
      patchText.includes("name: '" + name + "'") ||
      patchText.includes('name: "' + name + '"')
    if (!alreadyInConfig) pkg.dsh.profile.bundles.push(name)
    pkg.dependencies[name] = 'link:' + abs
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  log('模拟安装 ' + addons.length + ' 个插件（bundles + dependencies）')
}

// ── 2a. 缺包演练：从隔离 profile 配置剔除 omit 条目（issue #294）──────────
// 只删 node_modules 条目会得到「配置里列着、但装不上」的不一致状态：DSH 在 dump-config
// 阶段直接抛 cannot resolve profile bundle → 实例根本起不来（本机实测），反而验不到
// 「缺包时插件能否降级」。这里连 dependencies + dsh.profile.bundles 一起剔除，
// 才是新装用户「这个包从来没装过」的真实形态。必须在 --addons 写入之后执行。
if (omitEntries.length > 0) {
  const simPkgPath = join(simProfile, 'package.json')
  const stripped = stripProfileDeclarations(JSON.parse(readFileSync(simPkgPath, 'utf8')), omitEntries)
  writeFileSync(simPkgPath, JSON.stringify(stripped.pkg, null, 2))
  log(
    'external 缺包演练：从隔离 profile 配置剔除 ' +
      (stripped.removed.length > 0 ? stripped.removed.join('、') : '（无 —— 这些包未在 profile 配置中声明）'),
  )
  // profile patch（cordis.patch.yml）里对该 id 的 config patch 行**保留**：
  // 它是对既有 entry 的配置补丁，entry 已被剔除，实测 boot 不会因它失败；
  // 若哪天变成硬失败，这里会以启动失败形式暴露（不静默）。
}

// 2b. 预置隔离实例的工作区状态（GUI 合成器前置，issue #220 附带）：
// storages/workspace.json 有隐性 Zod 校验（unit 头 + ISO 时间戳 + path 必须是
// realpath），格式不符会让实例**启动即失败**；macOS 上 path 写 /tmp/... 还会
// 触发 session/workspace-attach-failed（/tmp 是 /private/tmp 的软链）。
if (options.workspace !== null) {
  try {
    const written = writeWorkspaceStorage({
      simHome,
      workspacePath: options.workspace,
      title: options.workspaceTitle ?? undefined,
    })
    log('已预置工作区状态: ' + written.path + ' → ' + written.file)
  } catch (error) {
    fail('预置工作区失败: ' + error.message)
    await cleanup()
    process.exit(1)
  }
}

// ── 3. 配置组合检查（dump-config，与真实启动同一组合逻辑） ────────────────
log('配置组合检查（dump-config id 唯一性）…')
const dump = await run(dshBin, ['--profile', options.profile, '--dump-config'], {
  DSH_HOME: simHome,
})
if (!dump.ok) {
  fail(`dump-config 失败: ${dump.stderr || dump.stdout || dump.error}`)
  await cleanup()
  process.exit(1)
}
const ids = entryIds(dump.stdout)
const seen = new Map()
const duplicates = []
for (const id of ids) {
  if (seen.has(id)) duplicates.push(id)
  else seen.set(id, true)
}
if (duplicates.length > 0) {
  fail(`配置组合存在重复插件行 id: ${[...new Set(duplicates)].join(', ')}`)
  await cleanup()
  process.exit(1)
}
pass(`配置组合唯一：${ids.length} 个 id 无重复`)
// 3c 判据（修复后口径）：被验证的插件必须在组合配置里**处于启用态**。
// 旧判据只看「全文有没有这个 name 行」，会被 `disabled: true` 骗过：插件被加载但不运行
// （client bundle 不进 window.__DSH_BOOT__.entries、侧边栏页签不出现），门禁却判通过。
// 生产 profile 的 cordis.patch.yml 里确实存在这类行（实测：guardian / task-reliability /
// ts-example / my-context / observability），故改按 entry 块判定，命中禁用位即 fail-closed。
const combination = checkAddonEntriesEnabled({ dumpOutput: dump.stdout, addons })
for (const item of combination.entries) {
  if (!item.ok) {
    fail(`模拟安装的插件 ${item.name} ${item.reason}`)
    await cleanup()
    process.exit(1)
  }
  pass(`模拟插件 ${item.name} 已出现在组合配置（启用态）`)
}

if (options.skipWeb) {
  log('--skip：配置组合检查完成，不启动实例')
  await cleanup()
  process.exit(failed ? 1 : 0)
}

// ── 3b. 端口预检（issue #294 实测教训：残留实例会让验证静默变成假通过）──────
// 就绪探测只认「任何 HTTP 响应」。上一轮跑崩/被强杀时遗留的隔离实例若仍占着同一个
// 端口，本轮会在**自己 spawn 的实例还没起来**（甚至起不来）时就判定 "HTTP 200 就绪"，
// 于实验证的其实是那个残留实例 —— 结果完全不可信。实测：一次带残留实例的运行
// 0.2s 就"就绪"（真实冷启动 ~8s），而该轮的"缺包演练"结论也就毫无意义。
if (await isPortInUse(options.port)) {
  fail(
    `端口 ${options.port} 已被占用（多为上一轮残留的隔离实例）—— 就绪探测会命中他人实例，验证结果不可信。` +
      `请先释放：lsof -ti :${options.port} | xargs kill`,
  )
  console.error('[verify] 提示：这是**环境**问题，不是插件问题；不要据此判定插件通过或失败。')
  await cleanup()
  process.exit(1)
}

// ── 4. 启动实例（真实进程） ────────────────────────────────────────────────
log(`启动验证实例（端口 ${options.port}）…`)
// issue #257：实例输出重定向到**文件**（而不是 pipe）。
// 收益是确定的：日志会落盘，事后可诊断（pipe 版本一退出就什么都不剩）。
// ⚠️ 如实记录：本机实测两种方式**都没有**在输出里看到 token 行（捕获字节数 0），
// 所以 `--api-path` 目前会走到"取不到凭据 → 显式失败"这条分支（归因到脚本缺陷，
// 而不是像旧版那样把 404 说成插件路由异常）。真正的 200 打通见 issue #257 待确认项。
const webLogFile = join(simHome, 'dsh-web.log')
const webLogFd = openSync(webLogFile, 'a')
web = spawn(dshBin, ['--profile', options.profile, '--port', String(options.port), '--no-open'], {
  env: { ...process.env, DSH_HOME: simHome },
  stdio: ['ignore', webLogFd, webLogFd],
})
/** 按需读实例输出（文件即真相，避免 pipe 捕获不全）。 */
const readWebLog = () => {
  try {
    return readFileSync(webLogFile, 'utf8')
  } catch {
    return ''
  }
}
process.on('exit', () => {
  try {
    closeSync(webLogFd)
  } catch {
    /* 已关闭 */
  }
})

// 等待就绪（轮询 HTTP + **进程存活** + **日志就绪行**，issue #305 fail-closed）
//
// issue #305 的实测教训：`dsh web` **先监听端口、后加载插件树**。插件 apply 崩掉时，
// 端口已经能回 HTTP（旧实现据此判"就绪"并 break），随后进程才带栈退出；更糟的是
// 崩溃栈往往在脚本读完日志之后才落盘 —— 于是「实例起不来」被报成
// 「✓ 实例启动就绪 / ✓ 启动日志无 error」，把 P0 缺陷一路放行（#298 就是这么潜伏的）。
//
// 现在的判据（全部满足才算就绪，任一不满足即显式失败）：
//   1. 端口有 HTTP 响应（保留原有语义：401 也算已监听，见 #257）；
//   2. 实例日志出现**正向就绪行** `dsh web: http://127.0.0.1:<port>/?token=…`；
//   3. 就绪行出现后进程**仍然存活**（起来又崩 = 不可用）。
// 同时全程扫描致命启动特征（`plugin tree failed to load` / `without inject` / …），
// 命中即立刻失败并打印崩溃栈关键行与日志路径 —— 不再等超时、不再静默。
const deadline = Date.now() + options.timeoutSec * 1000
let outcome = { verdict: 'pending', hits: [], reason: null }
let sawHttp = false
while (Date.now() < deadline) {
  const exited = web.exitCode !== null
  outcome = decideBootOutcome({ logText: readWebLog(), exited })
  if (outcome.verdict !== 'pending') break
  if (!sawHttp) {
    const status = await httpStatus(options.port)
    // 任何 HTTP 响应都说明服务已在监听：DSH 新版对不带 token 的根路径返回
    // 401（旧版是 200），只认 200 会把"其实已就绪"误判成启动超时（实测
    // 240s 仍报"未就绪"、而实例进程存活且端口正常服务）。
    // ⚠️ 但它**不能**单独作为就绪依据（#305：崩溃时端口同样在监听）。
    if (status > 0) sawHttp = true
  }
  if (exited) break
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))
}
if (outcome.verdict !== 'ready') {
  // 再给一次机会：进程若已退出，日志可能刚写完（buffered stdout 落盘有延迟）。
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  outcome = decideBootOutcome({ logText: readWebLog(), exited: web.exitCode !== null })
}
if (outcome.verdict !== 'ready') {
  const why =
    outcome.verdict === 'failed' ? outcome.reason : `实例 ${options.timeoutSec}s 内未就绪（exitCode=${web.exitCode}）`
  fail(`实例启动失败：${why}`)
  console.error('[verify] 崩溃关键行：')
  console.error(bootFailureExcerpt({ logText: readWebLog() }))
  console.error(`[verify] 完整实例日志：${webLogFile}`)
  await cleanup()
  process.exit(1)
}
pass(`实例启动就绪（HTTP 响应${sawHttp ? ' + 就绪行 + 进程存活' : ' + 就绪行'}，端口 ${options.port}）`)

// 启动日志错误扫描（duplicate / failed to apply / error / exception）
// issue #294：正则显式覆盖「缺包」类症状 —— failed to import loader entry（loader entry
// 解析失败）/ missed the module table（client graph 里没有该行）/ Element type is invalid
// （createElement(null)：require 落空后渲染期抛错，正是 #293 的假降级）/ Cannot find module。
// 这些关键词原先不在扫描面内，缺包崩溃可能"扫不出来"。
// issue #305：再按**致命启动特征表**（lib/verify-profile.mjs 的 FATAL_BOOT_PATTERNS）复查一遍 ——
// 上面这条靠 `error` 字样，致命表按 dsh/cordis 的真实崩溃文案（如 `plugin tree failed to load`）。
const STARTUP_ERROR_RE =
  /(duplicate loader|failed to apply|failed to import loader entry|missed the module table|Element type is invalid|Cannot find module|error|exception|ECONNREFUSED)/i
const errorHits = []
for (const line of readWebLog().split('\n')) {
  if (STARTUP_ERROR_RE.test(line) && !/(EADDRINUSE)/i.test(line)) {
    errorHits.push(line.trim())
  }
}
const fatalHits = fatalBootHits({ logText: readWebLog() })
if (errorHits.length > 0 || fatalHits.length > 0) {
  const detail = [
    errorHits.length > 0 ? `${errorHits.length} 条错误: ${errorHits.slice(0, 5).join(' | ')}` : null,
    fatalHits.length > 0 ? `致命启动特征: ${fatalHits.join(' / ')}` : null,
  ]
    .filter(Boolean)
    .join('；')
  fail(`启动日志扫描失败：${detail}`)
} else if (web.exitCode !== null) {
  // 就绪后又退出（例如日志扫描期间崩掉）：实例不可用，绝不能报绿（#305）。
  fail(`实例在就绪后退出（exitCode=${web.exitCode}），未通过启动稳定性检查`)
} else {
  pass('启动日志无 error / duplicate 记录（就绪行存在且进程存活）')
  if (linkResult.omitted.length > 0) {
    // 缺包演练时的针对性留痕：日志没提 external 包缺失（server 侧可见的部分）。
    // 诚实记录边界：client 侧崩溃发生在浏览器运行时，server 启动日志未必留痕 →
    // 真实浏览器验证仍需 skills/verifying-dsh-plugins 的步骤（不把这一项说成"已验证"）。
    pass(
      `缺包演练下启动日志无 external 缺包相关错误（${linkResult.omitted.join('、')}）；` +
        'client 侧渲染崩溃需浏览器步骤确认（server 日志看不到）',
    )
  }
}

// ── 5. 插件 API 冒烟（验证 server 端 apply 生效） ──────────────────────────
// issue #257 的硬要求：**不能假绿**。拿不到凭据时要么显式失败、要么明确降级并打印原因，
// 绝不允许"静默 404 但当通过" —— 绿得没有意义的门禁比红更危险（它会让人以为验过了）。
if (options.apiPaths.length > 0) {
  const { token, source, logTail } = await resolveApiToken({ getWebLog: readWebLog, simHome })
  if (!token) {
    fail(
      'API 冒烟无法进行：取不到隔离实例的访问 token（启动输出与 .credentials.yaml 都没有）。' +
        '这是**验证脚本**的问题，不是插件问题 —— 不要把 404 当成"插件路由异常"去查插件代码。' +
        'issue #257 的收口结论：DSH web 的认证层使非交互环境拿不到凭据，**这一项需要浏览器会话**；' +
        '请改用 skills/verifying-dsh-plugins 的浏览器步骤做 API 断言（不要为绕过它而删检查）。',
    )
    if (logTail) log(`实例输出尾部（诊断用）：\n${logTail}`)
  } else {
    log(`API 冒烟凭据来源：${source}`)
    for (const path of options.apiPaths) {
      const status = await httpStatus(options.port, path, token)
      if (status === 200) pass(`API 冒烟 ${path} → 200`)
      else if (status === 401 || status === 403) {
        fail(`API 冒烟 ${path} → ${status}（token 被拒：认证方式或凭据不对，属**脚本缺陷**，不是插件路由问题）`)
      } else {
        fail(`API 冒烟 ${path} → ${status}（预期 200，说明插件 server 端未生效或路由异常）`)
      }
    }
  }
}

// ── 5b. 验证清单留痕（issue #67）：自动项已勾选，功能级项待验证者勾选 ─────
if (!failed) writeChecklist()

// ── 6. 收尾 ────────────────────────────────────────────────────────────────
if (!options.keep) {
  await cleanup()
} else {
  log(`--keep：实例保持运行（端口 ${options.port}，实例日志 ${join(simHome, 'dsh-web.log')}），临时目录 ${simHome}`)
  log(`手动停止：lsof -ti :${options.port} | xargs kill；清理：rm -rf ${simHome}`)
}
process.exit(failed ? 1 : 0)

async function cleanup() {
  if (web !== null && web.exitCode === null) {
    web.kill('SIGTERM')
    await new Promise((resolveWait) => {
      const hard = setTimeout(() => {
        if (web.exitCode === null) web.kill('SIGKILL')
        resolveWait()
      }, 3000)
      web.once('exit', () => {
        clearTimeout(hard)
        resolveWait()
      })
    })
  }
  rmSync(simHome, { recursive: true, force: true })
  log('实例已停止，临时目录已清理')
}

// ── issue #67：发版前功能级验证清单（留痕） ────────────────────────────────
// 自动验证项（脚本已执行且通过）自动勾选；功能级验证项（核心功能/易碎场景/
// client UI/插件联动）留空待验证者（人工或 agent）在真实浏览器中验证后勾选。
//
// issue #329（本函数的历史事故）：过去这里**整文件重写**目标清单 —— 已发布版本的清单
// 被重跑一次，末尾「验证记录（真实环境证据）」整段（实测 45 行）被删除、头部
// 「验证时间/端口」被改写（3092 → 3087，纯假 diff），改动以未提交状态留在工作区。
// 现在渲染/合并逻辑全部在 scripts/lib/verify-checklist.mjs（纯函数、可单测，
// 单测不需要启动任何隔离实例），本函数只做「读 → 合并 → 写」三步接线。
function writeChecklist() {
  if (options.checklist === null) return
  const plugin = options.plugin || (options.addons.length > 0 ? options.addons[0].split('/').pop() : 'unknown')
  const version = options.version || 'x.y.z'
  // issue #294：缺包演练生效时把这条自动项写进清单（只有真的 omit 了条目才写，避免留痕误导）
  const extraAuto =
    linkResult.omitted.length > 0
      ? [`external 缺包演练：隔离实例 node_modules 不含 ${linkResult.omitted.join('、')}（启动日志无相关错误）`]
      : []
  const fresh = renderChecklist({
    plugin,
    version,
    port: options.port,
    timestamp: new Date().toISOString(),
    autoItems: [...DEFAULT_AUTO_ITEMS, ...extraAuto],
  })
  let existingText = ''
  try {
    existingText = readFileSync(options.checklist, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // 已存在 → 幂等合并；不存在 → 新建（issue #329：人工记录段与勾选永不被覆盖）。
  const { text, note } =
    existingText === ''
      ? { text: fresh, note: '新建，功能级项待验证后勾选' }
      : mergeNote(mergeChecklist({ existingText, freshText: fresh, refreshHeader: options.refreshHeader }))
  mkdirSync(dirname(options.checklist), { recursive: true })
  writeFileSync(options.checklist, text, 'utf8')
  log(`验证清单已生成: ${options.checklist}（${note}）`)
}

/** 把合并结果翻译成一行日志（幂等合并 / 原样保留）。 */
function mergeNote({ text, merged, reason }) {
  return {
    text,
    note: merged
      ? '幂等合并：保留人工记录段与已勾选项' +
        (options.refreshHeader ? '（--refresh-header：头部已刷新为本轮环境）' : '，头部保持原值')
      : `未改写（${reason}）`,
  }
}
