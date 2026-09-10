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
 *
 * 退出码：0 = 全部通过；1 = 任一环节失败。
 *
 * issue #67 增强（发版前功能级验证留痕）：
 *   --checklist <path>  验证通过后生成「发版前功能级验证清单」Markdown 文件：
 *                       自动验证项（配置组合/启动/日志/API）自动勾选 [x]，
 *                       功能级验证项（核心功能/易碎场景/client UI/插件联动）
 *                       留空 [ ] 待验证者（人工或 agent）在真实浏览器中验证后勾选。
 *   --check <path>     校验清单文件：功能级验证项必须全部 [x]（供 release.mjs
 *                       发版门禁调用；未全部勾选 → exit 1）。
 *   --plugin/--version 写入清单头部（插件名与版本，便于留痕归档）。
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'

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
      '  --api-path <path>  启动后对每个 path 做 GET 冒烟（可重复）\n' +
      '  --timeout <sec>    启动就绪超时（默认 90）\n' +
      '  --skip             只做配置组合检查（dump-config），不启动实例\n' +
      '  --keep             失败/完成后保留临时目录（默认清理）\n' +
      '  --checklist <path> 验证通过后生成发版前功能级验证清单（issue #67 留痕）\n' +
      '  --check <path>     校验清单功能级项全部勾选（供 release.mjs 门禁；未全勾选 exit 1）\n' +
      '  --plugin <name>    清单头部插件名（配合 --checklist）\n' +
      '  --version <x.y.z>  清单头部版本号（配合 --checklist）\n',
  )
}

// ── 常量 ───────────────────────────────────────────────────────────────────
const home = homedir()
const realProfile = join(home, '.dsh', 'profiles', options.profile)
const simHome = `/tmp/dsh-verify-real-${options.port}`
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

/** 从 dump-config 输出里收集所有 insert 的插件 name（用于 addons 断言）。 */
function entryNames(dumpOutput) {
  const names = []
  for (const line of dumpOutput.split('\n')) {
    const match = /^\s*-?\s*name:\s*'?([A-Za-z0-9@._/-]+)'?/.exec(line)
    if (match !== null) names.push(match[1])
  }
  return names
}

async function httpStatus(port, path = '/') {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.status
  } catch {
    return 0
  }
}

// ── 0. 前置校验 ────────────────────────────────────────────────────────────
// --check 模式：只校验清单文件功能级项是否全部勾选（供 release.mjs 门禁调用）。
if (options.check !== null) {
  const ok = checkChecklist(options.check)
  process.exit(ok ? 0 : 1)
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
cpSync(realProfile, simProfile, {
  recursive: true,
  filter: (src) => !src.includes('/node_modules'),
})
rmSync(join(simProfile, 'node_modules'), { recursive: true, force: true })

// node_modules：真实条目全量软链 + addons 软链（模拟 pnpm link 安装）
const simNode = join(simProfile, 'node_modules')
mkdirSync(simNode)
const realNode = join(realProfile, 'node_modules')
for (const entry of readdirSync(realNode)) {
  symlinkSync(join(realNode, entry), join(simNode, entry))
}
for (const addon of options.addons) {
  const abs = resolve(addon)
  if (!existsSync(join(abs, 'package.json'))) {
    console.error(`[verify] --addons 不是插件目录（无 package.json）: ${addon}`)
    process.exit(1)
  }
  // 生产 profile 已 link: 安装的插件（node_modules 已有同名条目，指向真实源码）
  // 直接复用，避免 EEXIST（发版校验对已安装插件跑 --addons 的常见场景）。
  const target = join(simNode, addon.split('/').pop())
  if (!existsSync(target)) symlinkSync(abs, target)
}

// ── 2. 模拟安装 addons（写入临时 profile：bundles + dependencies） ────────
if (options.addons.length > 0) {
  const pkgPath = join(simProfile, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const patchPath = join(simProfile, 'cordis.patch.yml')
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  for (const addon of options.addons) {
    const abs = resolve(addon)
    const name = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')).name
    // 插件已手动安装（patch 行存在）时不再写入 bundles：bundle 自动插行 +
    // patch 手动行叠加会产生重复 id（发版校验对已安装插件跑 --addons 的场景）。
    const alreadyInConfig =
      pkg.dsh.profile.bundles.includes(name) ||
      patchText.includes(`name: '${name}'`) ||
      patchText.includes(`name: "${name}"`)
    if (!alreadyInConfig) pkg.dsh.profile.bundles.push(name)
    pkg.dependencies[name] = `link:${abs}`
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  log(`模拟安装 ${options.addons.length} 个插件（bundles + dependencies）`)
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
for (const addon of options.addons) {
  const abs = resolve(addon)
  const name = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')).name
  if (!entryNames(dump.stdout).includes(name)) {
    fail(`模拟安装的插件 ${name} 未出现在组合配置中（bundles 声明可能未生效）`)
    await cleanup()
    process.exit(1)
  }
  pass(`模拟插件 ${name} 已出现在组合配置`)
}

if (options.skipWeb) {
  log('--skip：配置组合检查完成，不启动实例')
  await cleanup()
  process.exit(failed ? 1 : 0)
}

// ── 4. 启动实例（真实进程） ────────────────────────────────────────────────
log(`启动验证实例（端口 ${options.port}）…`)
web = spawn(dshBin, ['--profile', options.profile, '--port', String(options.port), '--no-open'], {
  env: { ...process.env, DSH_HOME: simHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let webLog = ''
web.stdout.on('data', (chunk) => {
  webLog += chunk
})
web.stderr.on('data', (chunk) => {
  webLog += chunk
})

// 等待就绪（轮询 HTTP）
const deadline = Date.now() + options.timeoutSec * 1000
let ready = false
while (Date.now() < deadline) {
  if (web.exitCode !== null) break
  const status = await httpStatus(options.port)
  // 任何 HTTP 响应都说明服务已在监听：DSH 新版对不带 token 的根路径返回
  // 401（旧版是 200），只认 200 会把"其实已就绪"误判成启动超时（实测
  // 240s 仍报"未就绪"、而实例进程存活且端口正常服务）。
  if (status > 0) {
    ready = true
    break
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
}
if (!ready) {
  fail(`实例 ${options.timeoutSec}s 内未就绪（exitCode=${web.exitCode}）`)
  console.error(webLog.slice(-2000))
  await cleanup()
  process.exit(1)
}
pass(`实例启动就绪（HTTP 200, 端口 ${options.port}）`)

// 启动日志错误扫描（duplicate / failed to apply / error / exception）
const errorHits = []
for (const line of webLog.split('\n')) {
  if (/(duplicate loader|failed to apply|error|exception|ECONNREFUSED)/i.test(line) && !/(EADDRINUSE)/i.test(line)) {
    errorHits.push(line.trim())
  }
}
if (errorHits.length > 0) {
  fail(`启动日志扫描到 ${errorHits.length} 条错误: ${errorHits.slice(0, 5).join(' | ')}`)
} else {
  pass('启动日志无 error / duplicate 记录')
}

// ── 5. 插件 API 冒烟（验证 server 端 apply 生效） ──────────────────────────
for (const path of options.apiPaths) {
  const status = await httpStatus(options.port, path)
  if (status === 200) pass(`API 冒烟 ${path} → 200`)
  else {
    fail(`API 冒烟 ${path} → ${status}（预期 200，说明插件 server 端未生效或路由异常）`)
  }
}

// ── 5b. 验证清单留痕（issue #67）：自动项已勾选，功能级项待验证者勾选 ─────
if (!failed) writeChecklist()

// ── 6. 收尾 ────────────────────────────────────────────────────────────────
if (!options.keep) {
  await cleanup()
} else {
  log(
    `--keep：实例保持运行（端口 ${options.port}，日志见 /tmp/dsh-verify-real-${options.port}.log），临时目录 ${simHome}`,
  )
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
// 函数声明（提升）而非 const：main 流程在文件中部调用 writeChecklist()，
// const 初始化在其后会导致 TDZ ReferenceError（issue #67 实测发现的坑）。
function checklistTemplate(plugin, version, port) {
  return `# 发版前功能级验证清单 — ${plugin}@${version}

验证时间：${new Date().toISOString()}
验证环境：隔离实例（端口 ${port}，复用生产 profile 配置组合，独立 DSH_HOME）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [ ] 核心功能走通（插件主功能在真实 GUI 中可用）
- [ ] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [ ] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [ ] 插件间联动不崩（与相邻插件共存）
- [ ] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
`
}

/** 生成验证清单文件（自动项已勾选，功能级项待勾选）。
 *  若目标文件已存在（如 release.mjs 3c 重跑），保留原功能级项的勾选
 *  状态，避免覆盖已验证的留痕（issue #67）。 */
function writeChecklist() {
  if (options.checklist === null) return
  const plugin = options.plugin || (options.addons.length > 0 ? options.addons[0].split('/').pop() : 'unknown')
  const version = options.version || 'x.y.z'
  let text = checklistTemplate(plugin, version, options.port)
  if (existsSync(options.checklist)) {
    text = mergeChecklistState(readFileSync(options.checklist, 'utf8'), text)
  }
  mkdirSync(dirname(options.checklist), { recursive: true })
  writeFileSync(options.checklist, text, 'utf8')
  log(`验证清单已生成: ${options.checklist}（功能级项待验证后勾选）`)
}

/** 将既有清单中已勾选（[x]）的功能级项状态合并到新生成的清单文本（按文案匹配）。 */
function mergeChecklistState(oldText, newText) {
  const checked = new Set()
  let inFunctional = false
  for (const line of oldText.split('\n')) {
    if (line.startsWith('## 功能级验证项')) inFunctional = true
    else if (line.startsWith('## ')) inFunctional = false
    if (!inFunctional) continue
    const m = /^- \[(x)\] (.+)$/.exec(line.trim())
    if (m) checked.add(m[2])
  }
  if (checked.size === 0) return newText
  return newText
    .split('\n')
    .map((line) => {
      const m = /^- \[( |x)\] (.+)$/.exec(line.trim())
      if (m && checked.has(m[2])) return line.replace('- [ ]', '- [x]')
      return line
    })
    .join('\n')
}

/** 校验清单文件：功能级验证项必须全部 [x]（供 release.mjs 门禁调用）。 */
function checkChecklist(path) {
  if (!existsSync(path)) {
    console.error(`[verify] ✗ 验证清单不存在: ${path}（发版前必须先跑 verify-real-profile.mjs --checklist）`)
    return false
  }
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  const pending = []
  let inFunctional = false
  for (const line of lines) {
    if (line.startsWith('## 功能级验证项')) inFunctional = true
    else if (line.startsWith('## ')) inFunctional = false
    if (!inFunctional) continue
    const m = /^- \[( |x)\] (.+)$/.exec(line.trim())
    if (m !== null && m[1] !== 'x') pending.push(m[2])
  }
  if (pending.length > 0) {
    console.error(`[verify] ✗ 功能级验证项未全部勾选（${pending.length} 项待验证）:`)
    for (const item of pending) console.error(`[verify]   - ${item}`)
    return false
  }
  console.log(`[verify] ✓ 验证清单全部勾选: ${path}`)
  return true
}
