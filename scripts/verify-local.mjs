#!/usr/bin/env node
/**
 * verify-local.mjs — 本地校验（对齐 .github/workflows/ci.yml 全部门禁）。
 *
 * 两种模式：
 *   full（默认，`npm run verify` / `--full`）：全量 —— 全部检查项 + 全部插件测试，
 *     语义与历史版本完全一致。
 *   fast（`--fast`）：快速通道（pre-push 默认用这个）—— 按本次推送的变更范围裁剪：
 *     · 与插件源码相关的检查照跑（typecheck/lint/format/knip/jscpd/depcruise/test-scripts/docs），
 *       彼此并发只是为了让墙钟变短；
 *     · 插件测试只跑「受影响插件」（见下方「影响面规则」）；
 *     · ts-size / resource-smoke 等只有「有证据能证明不可能受影响」时才跳过，并打印原因；
 *     · 纯文档变更时跳过一切只针对源码的检查（仍跑 format + docs），并逐项打印跳过原因。
 *     无变更证据（首次推送 / 无 upstream / 根配置变更 / 分支落后）时**安全退化**为全量，
 *     绝不静默放水。
 *
 * 检查项（CI job → 本地命令）：
 *   audit        → npm audit --audit-level=moderate @ 官方 registry（默认跳过：需要联网，
 *                  本地可用 --audit 显式开启）。issue #199：始终强制官方 registry 并校验
 *                  「审计是否真的执行」，避免镜像源（npmmirror 无 advisories 端点）静默假绿
 *   test         → 遍历 plugins/ 下全部插件：node --check lib/index.js + lib/client.js（存在
 *                  则查）+ npm test（单元测试 + 覆盖率门禁 + Gherkin 验收），与
 *                  scripts/test-all.sh 同逻辑（区别：本脚本不 set -e，单个插件失败
 *                  继续其余插件并汇总；支持 --plugin 过滤）
 *   mutation     → (cd plugins/dsh-file-activity && npx stryker run)（默认跳过：
 *                  本地约 20s，push 场景太重，CI 独立 job 强制）
 *   typecheck    → npx tsc --noEmit
 *   lint         → npx eslint plugins/
 *   ts-size      → node scripts/check-ts-size.mjs（TS 行数/复杂度基线）
 *   format       → npx prettier --check .
 *   test-scripts → npm run test:scripts（vitest 发版校验）
 *   depcruise    → npx depcruise plugins/
 *   knip         → npx knip（死代码）
 *   jscpd        → npx jscpd（重复代码）
 *   docs         → node scripts/check-docs.mjs（文档一致性，纯本地文件检查）
 *   links        → node scripts/check-links.mjs（文档引用完整性：链接/锚点/路径 token/
 *                  shell 调用/npm script/skill 与插件名，纯本地文件检查）
 *   resource-smoke→ node scripts/resource-smoke.mjs（issue #127 资源回归门禁）
 *
 * 用法：
 *   node scripts/verify-local.mjs                    # full：全部检查（跳过 audit/mutation）
 *   node scripts/verify-local.mjs --fast             # fast：按变更裁剪（pre-push 用）
 *   node scripts/verify-local.mjs --fast --base <r>  # 指定比较基准（默认 @{upstream} → origin/main）
 *   node scripts/verify-local.mjs --full             # 强制全量（与 --fast 同给时 --full 生效）
 *   node scripts/verify-local.mjs --audit            # 额外执行 npm audit
 *   node scripts/verify-local.mjs --mutation         # 额外执行 stryker 变异测试
 *   node scripts/verify-local.mjs --only <id>        # 只跑单项（可重复，如 --only knip）
 *   node scripts/verify-local.mjs --plugin <name>    # 只跑该插件的 test/--check（可重复）
 *   node scripts/verify-local.mjs --timeout <sec>    # 覆盖整体超时上限（秒；0 = 关闭）
 *   node scripts/verify-local.mjs --list             # 列出全部检查项 id
 *   node scripts/verify-local.mjs --help
 *
 * 环境变量：
 *   VERIFY_CONCURRENCY=1..8   覆盖插件测试并发度（默认 3；怀疑并发冲突时设 1）
 *   VERIFY_TIMEOUT=<sec>      整体墙钟上限（默认 300；0/off/none = 关闭）
 *   VERIFY_STEP_TIMEOUT=<sec> 单个子进程上限（默认 min(整体上限, 120)；0 = 关闭）
 *   VERIFY_NO_TIMEOUT=1       等价于 VERIFY_TIMEOUT=0
 *   VERIFY_NO_RETRY=1         关闭「疑似并发冲突 → 串行自动复测」（见下）
 *
 * 退出码：0 = 全部通过（跳过项不计失败）；1 = 任一检查失败、或参数/基准不可解析；
 *         124 = 整体超时（子进程组已被强制终止）。
 *
 * 超时与快速失败（必读，pre-push 健壮性）：
 *   本脚本是 pre-push 钩子的执行体，**绝不能静默挂死**。历史上出现过「只改了 docs
 *   的一次推送，git push 前台 5 分钟未返回被超时杀掉」，根因就是整条链路上每个子进程都没有
 *   超时、整个脚本也没有墙钟上限——任何一步被拖慢/阻塞（并发争用、网络、文件锁）都会让
 *   git push 无限期等待且不打印任何东西。因此现在：
 *     · 每个子进程都有显式超时（runCapture 的 timeoutMs）；超时杀「进程组」而非单进程，
 *       连 npm → vitest/cucumber 等孙进程一起清掉，不留孤儿；
 *     · 整条链路有整体墙钟上限（TOTAL_TIMEOUT_MS），超时打印「卡在哪一步 + 已跑多久 +
 *       如何绕过」后以退出码 124 结束；
 *     · 所有子进程禁用交互式提示（GIT_TERMINAL_PROMPT=0 等），绝不等待输入；
 *     · 本脚本自己的 npx 调用一律带 --no-install：零联网、零临时安装，本地缺工具就立即
 *       失败，而不是去 registry 拉包（那正是历史上长时间挂起的现实来源之一）。
 *
 * 疑似并发冲突 → 串行自动复测：
 *   多个进程同时跑同一插件的 vitest 会争用其 coverage/ 临时目录，表现为
 *   coverage/EACCES/ENOENT/EPERM 或 5s 联网用例超时（见 docs/踩坑/多agent并行测试资源冲突.md）。
 *   插件测试失败且报错命中这些特征时，会自动以串行（并发 1）复测**失败的那些插件**：
 *   复测通过 → 判通过并打印「疑似并发冲突，已串行复测通过」；复测仍失败 → 判红。
 *   只复测一次、只复测失败项，不掩盖真实回归；VERIFY_NO_RETRY=1 可关闭该降级。
 *
 * 详见 docs/开发指南/构建与测试.md「本地一键校验（verify-local）」。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// issue #199：audit 门禁的参数/输出解析抽成纯函数件（含「镜像源静默失效」检测），便于单测。
import {
  auditCmdArgs,
  auditCommandHint,
  auditEnv,
  extractJsonObject,
  parseAuditOutput,
  renderAuditReport,
} from './lib/npm-audit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

// 安全出口：被 `import`（而非 `node scripts/verify-local.mjs` 直接执行）时立即结束，
// 避免误跑整套校验（也便于隔离调试影响面函数）。
if (process.argv[1] === undefined || resolve(process.argv[1]) !== fileURLToPath(import.meta.url)) {
  process.exit(0)
}

// ── 参数解析 ────────────────────────────────────────────────────────────────
const options = {
  only: [],
  plugins: [],
  audit: false,
  mutation: false,
  fast: false,
  full: false,
  base: null,
  timeout: null,
  list: false,
  help: false,
}
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i]
  const value = () => {
    const v = args[++i]
    if (v === undefined) {
      console.error(`[verify] ${flag} 缺少参数值（--help 查看用法）`)
      process.exit(1)
    }
    return v
  }
  if (flag === '--only') options.only.push(value())
  else if (flag === '--plugin') options.plugins.push(value())
  else if (flag === '--base') options.base = value()
  else if (flag === '--timeout') options.timeout = value()
  else if (flag === '--audit') options.audit = true
  else if (flag === '--mutation') options.mutation = true
  else if (flag === '--fast' || flag === '--changed-only') options.fast = true
  else if (flag === '--full') options.full = true
  else if (flag === '--list') options.list = true
  else if (flag === '--help' || flag === '-h') options.help = true
  else {
    console.error(`[verify] unknown flag: ${flag}（--help 查看用法）`)
    process.exit(1)
  }
}
// --full 优先级最高（显式声明要全量）；二者同给时 --full 生效并提示
if (options.full && options.fast) {
  console.error('[verify] 同时指定 --fast 与 --full，以 --full 为准（不裁剪）')
  options.fast = false
}

const ALL_PLUGINS = readdirSync(join(root, 'plugins'))
  .filter((name) => existsSync(join(root, 'plugins', name, 'package.json')))
  .sort()

// ── 输出 ────────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text)
const green = (t) => paint('32', t)
const red = (t) => paint('31', t)
const yellow = (t) => paint('33', t)
const dim = (t) => paint('2', t)

const log = (msg = '') => console.log(`[verify] ${msg}`)
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`

// ── 超时配置（pre-push 绝不能静默挂死）──────────────────────────────────────
/**
 * 解析「秒」配置：未设置 → null（回落默认值）；0/off/none → 0（显式关闭）。
 * 0 与 null 语义不同：0 = 用户明确要求关闭，null = 没配。
 */
function parseSeconds(raw) {
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim().toLowerCase()
  if (text === '') return null
  if (['0', 'off', 'none', 'false', 'no', 'disable', 'disabled'].includes(text)) return 0
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

const DEFAULT_TOTAL_TIMEOUT_SEC = 300
const DEFAULT_STEP_TIMEOUT_SEC = 120

const totalTimeoutSec = (() => {
  if (String(process.env.VERIFY_NO_TIMEOUT ?? '') === '1') return 0
  if (options.timeout !== null) {
    const parsed = parseSeconds(options.timeout)
    if (parsed === null) {
      console.error(`[verify] --timeout 参数非法: ${options.timeout}（需要正秒数，或 0 表示关闭）`)
      process.exit(1)
    }
    return parsed
  }
  const fromEnv = parseSeconds(process.env.VERIFY_TIMEOUT)
  return fromEnv === null ? DEFAULT_TOTAL_TIMEOUT_SEC : fromEnv
})()
const stepTimeoutSec = (() => {
  const fromEnv = parseSeconds(process.env.VERIFY_STEP_TIMEOUT)
  if (fromEnv !== null) return fromEnv
  if (totalTimeoutSec === 0) return DEFAULT_STEP_TIMEOUT_SEC
  return Math.min(totalTimeoutSec, DEFAULT_STEP_TIMEOUT_SEC)
})()
const TOTAL_TIMEOUT_MS = totalTimeoutSec * 1000
const STEP_TIMEOUT_MS = stepTimeoutSec * 1000
/** git 只读查询的超时（正常 <1s；卡住说明 git / 文件系统异常）。 */
const GIT_TIMEOUT_MS = 30_000
const globalStartedAt = Date.now()

/**
 * 注入给所有子进程的环境变量——防「等待输入」与「无谓联网」这两类静默挂起：
 *   GIT_TERMINAL_PROMPT=0            git 需要账号密码时立即失败，绝不等待终端输入
 *   GIT_OPTIONAL_LOCKS=0             git 不加「可选锁」（如 status 刷新 index 的锁），
 *                                    避免与 git push 自身 / 编辑器插件争 index.lock 而互相等待
 *   npm_config_update_notifier=false npm 不去 registry 查「是否有新版本」（常见静默联网等待）
 *   npm_config_fund / npm_config_audit=false  关掉 npm 附带的额外网络请求
 *   npm_config_progress=false        关掉进度条（管道场景无意义，还污染日志）
 *
 * ⚠️ 刻意**不**设置 npm_config_yes=true：直觉上它能让 npx「免交互自动确认」，但本机实测
 * `npm_config_yes=true npx tsc --version` 会挂起 45s+。本地工具的联网风险统一改用显式
 * `--no-install`（见 NPX_BASE_ARGS）解决。
 */
const CHILD_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
  npm_config_progress: 'false',
}

/** 本脚本自己调 npx 时统一加的参数：只用本地已装工具，绝不联网 / 临时安装。 */
const NPX_BASE_ARGS = ['--no-install']

const childEnv = () => ({ ...process.env, ...CHILD_ENV })

// ── 子进程（带超时 + 进程组清理）────────────────────────────────────────────
/** 活跃子进程登记表：pid → { label, cmd, cwd, startedAt }；超时报告与清理都靠它。 */
const ACTIVE_CHILDREN = new Map()

/**
 * 终止子进程及其全部后代。
 * spawn 时用 detached=true 让子进程自成进程组，于是 `kill(-pid)` 能一次带走
 * npm → npx → vitest/cucumber 整棵树——只杀直接子进程会留下孤儿继续占 CPU 与 coverage 目录。
 */
function killChildTree(pid, signal = 'SIGKILL') {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      /* 已经退出了 */
    }
  }
}

/** 终止全部在跑的子进程（整体超时、收到 SIGTERM/SIGINT 时调用）。 */
function killAllChildren(signal = 'SIGKILL') {
  for (const pid of [...ACTIVE_CHILDREN.keys()]) killChildTree(pid, signal)
  ACTIVE_CHILDREN.clear()
}

/**
 * 运行命令并缓冲输出；返回 { ok, code, out, error, timedOut, timeoutMs, cmd, ms }。
 * 缓冲避免并发日志互相穿插；超时整组终止（见 killChildTree）。
 */
function runCapture(cmd, cmdArgs, cwd, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? STEP_TIMEOUT_MS
  const cmdline = [cmd, ...cmdArgs].join(' ')
  const label = opts.label ?? cmdline
  return new Promise((resolveRun) => {
    const startedAt = Date.now()
    let child
    try {
      child = spawn(cmd, cmdArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // 自成进程组 → 超时可整组终止
        // opts.env 覆盖 CHILD_ENV：audit 检查项需要显式指定官方 registry（issue #199）
        env: { ...childEnv(), ...(opts.env ?? {}) },
      })
    } catch (error) {
      resolveRun({ ok: false, code: -1, out: '', error: String(error?.message ?? error), cmd: cmdline, ms: 0 })
      return
    }
    let out = ''
    let settled = false
    let timer = null
    if (Number.isInteger(child.pid)) ACTIVE_CHILDREN.set(child.pid, { label, cmd: cmdline, cwd, startedAt })

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (Number.isInteger(child.pid)) ACTIVE_CHILDREN.delete(child.pid)
      resolveRun({ cmd: cmdline, ms: Date.now() - startedAt, ...result })
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killChildTree(child.pid, 'SIGKILL')
        finish({
          ok: false,
          code: 124,
          timedOut: true,
          timeoutMs,
          out,
          error:
            `命令超过单步上限 ${secs(timeoutMs)} 仍未返回，已强制终止其进程组（含孙进程）。\n` +
            `  命令：${cmdline}（cwd: ${cwd}）\n` +
            `  放宽单步上限：VERIFY_STEP_TIMEOUT=<秒>；完全关闭超时：VERIFY_NO_TIMEOUT=1`,
        })
      }, timeoutMs)
    }

    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', (error) => finish({ ok: false, code: -1, out, error: String(error?.message ?? error) }))
    child.on('close', (code) => finish({ ok: code === 0, code, out }))
  })
}

/**
 * 并发执行器：limit 个 worker 轮询队列，结果按完成顺序收集。
 * `after` 门控：带 after 的任务不进入并发池，由调用方在标记任务完成后单独跑
 * （用于「必须等插件测试结束才安全」的检查——插件测试会生成/清空 coverage 目录，
 *  dependency-cruiser 扫到半截目录会 ENOENT 崩掉）。
 */
async function runPool(tasks, limit, onDone) {
  const results = []
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      const result = await tasks[index].run()
      results.push(result)
      if (onDone) onDone(result, results.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

// ── git 影响面分析 ──────────────────────────────────────────────────────────
/**
 * 同步执行 git（只用于范围分析的一次性轻量查询；数组传参，无 shell 注入风险）。
 * 范围分析必须在构建任务列表之前完成，故用 spawnSync。
 * 同样带超时（spawnSync 的 timeout 会杀子进程）：git 查询卡住时宁可「无法确定基准 →
 * 安全退化全量」，也不让 pre-push 挂在这里。
 */
function spawnSyncGIT(gitArgs) {
  const r = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: childEnv(),
  })
  if (r.error || r.status !== 0) return { ok: false, out: r.stdout ?? '' }
  return { ok: true, out: r.stdout ?? '' }
}

function git(gitArgs) {
  const r = spawnSyncGIT(gitArgs)
  return r.ok ? r.out.trim() : null
}

/** 是否存在该 ref。 */
function refExists(ref) {
  return spawnSyncGIT(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok
}

/** 解析比较基准，返回 { ref, reason, ok }。 */
function resolveBase(explicit) {
  if (explicit) {
    if (!refExists(explicit)) return { ok: false, reason: `--base ${explicit} 不存在（git rev-parse 失败）` }
    return { ok: true, ref: explicit, reason: `--base 指定` }
  }
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (upstream && refExists(upstream)) {
    return { ok: true, ref: upstream, reason: `@{upstream} = ${upstream}` }
  }
  for (const candidate of ['origin/main', 'origin/master']) {
    if (refExists(candidate)) {
      const behind = spawnSyncGIT(['rev-list', '--count', `${candidate}..HEAD`])
      return {
        ok: true,
        ref: candidate,
        reason: `无 upstream，回退 ${candidate}（本地领先 ${behind.ok ? behind.out.trim() : '?'} 个提交）`,
      }
    }
  }
  return { ok: false, reason: '无 upstream 且找不到 origin/main 或 origin/master（首次推送/新 clone）' }
}

/**
 * git diff base...HEAD 的变更文件；失败返回 null。
 * 关键：`-c core.quotepath=false` 让中文路径按原样输出（本仓库 docs/ 大量中文名），
 * 否则 git 会输出 "docs/\347\264\242\345\274\225.md" 这种 C 风格转义路径，
 * 影响面规则的前缀匹配（docs/、plugins/）会全部失配。
 */
function changedFiles(base) {
  const r = spawnSyncGIT(['-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])
  if (!r.ok) return null
  return r.out.split('\n').filter((line) => line !== '')
}

// ── 影响面规则 ──────────────────────────────────────────────────────────────
/** 根工具链/根配置：改了它们就无法安全推断影响面 → 全量。 */
const ROOT_TOOLCHAIN_FILES = new Set([
  'package.json',
  'package-lock.json',
  'knip.json',
  'tsconfig.json',
  'vitest.config.mjs',
  'eslint.config.js',
  '.dependency-cruiser.js',
  '.jscpd.json',
  '.prettierrc.json',
  '.prettierignore',
  '.commitlintrc.json',
])

/** 文档/skill/纯文本文件：只影响 docs 与 format 检查，不改变插件运行时行为。 */
const DOC_DIRS = ['docs/', 'skills/']
const DOC_EXT = ['.md', '.mdx', '.txt']
const isDocFile = (p) => DOC_DIRS.some((d) => p.startsWith(d)) || DOC_EXT.some((e) => p.endsWith(e)) || p === 'LICENSE'

/**
 * CI 流水线定义目录（GitHub .github/）。
 * 与文档同级：改了它不会改变任何插件的运行时行为（插件测试结果与流水线 YAML 无关），
 * 因此**不应**触发「仓库根文件变更 → 安全退化全量」。
 *
 * 背景（真实事故）：一次「只改了 docs/**、CI 流水线 YAML、AGENTS.md」的推送，因流水线 YAML
 * 落在「其它根文件」分类里被判为无法裁剪 → 退化全量，把本该秒级的 pre-push 变成跑完全部
 * 插件测试（19 个 vitest+cucumber），叠加机器负载后表现为长时间不返回。
 */
const CI_CONFIG_DIRS = ['.github/']
const isRuntimeIrrelevant = (p) => isDocFile(p) || CI_CONFIG_DIRS.some((d) => p.startsWith(d))

/** 插件包名映射：目录名 → package.json name（本仓库两者一致，仍按实际值匹配以免未来漂移）。 */
const PLUGIN_NAMES = new Map()
for (const name of ALL_PLUGINS) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'plugins', name, 'package.json'), 'utf8'))
    PLUGIN_NAMES.set(name, pkg.name ?? name)
  } catch {
    PLUGIN_NAMES.set(name, name)
  }
}

/**
 * 反向依赖：依赖 plugins/<pluginName> 的插件集合（两路取证，宁多勿少）。
 *   1. package.json 依赖声明——按包名（`"dsh-shared": "^0.1.0"`）或 file 路径匹配；
 *   2. 源码 import/require——本仓库存在「源码 import 了 dsh-shared 但 package.json 未声明」
 *      的情况（15 个插件 import、仅 6 个声明），只查 package.json 会漏检。
 */
function dependentsOf(pluginName) {
  const result = new Set()
  const pkgName = PLUGIN_NAMES.get(pluginName) ?? pluginName
  const sourceCache = (name) => {
    if (!SOURCE_SCAN_CACHE.has(name)) {
      const dirs = [join(root, 'plugins', name, 'lib'), join(root, 'plugins', name, 'src')]
      const texts = []
      for (const dir of dirs) {
        if (!existsSync(dir)) continue
        try {
          for (const entry of readdirSync(dir, { recursive: true })) {
            const file = join(dir, String(entry))
            if (!/\.(mjs|cjs|js|ts|tsx)$/.test(file)) continue
            if (file.includes('/test/') || file.includes('/coverage/')) continue
            texts.push(readFileSync(file, 'utf8'))
          }
        } catch {
          /* 目录不可读：忽略该目录 */
        }
      }
      SOURCE_SCAN_CACHE.set(name, texts)
    }
    return SOURCE_SCAN_CACHE.get(name)
  }

  for (const name of ALL_PLUGINS) {
    if (name === pluginName) continue
    if (result.has(name)) continue
    let hit = false
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'plugins', name, 'package.json'), 'utf8'))
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      hit = Object.entries(deps).some(([dep, spec]) => {
        if (dep === pkgName) return true
        return typeof spec === 'string' && (spec.includes(`plugins/${pluginName}`) || spec.includes(`/${pluginName}`))
      })
    } catch {
      /* package.json 不可读：继续走源码扫描 */
    }
    if (!hit) {
      // 匹配 import ... from 'dsh-shared' / require('dsh-shared') / from '../dsh-shared'
      const re = new RegExp(`(?:from|require\\()\\s*['"](?:\\.\\.?/)*${pluginName}['"]`)
      hit = sourceCache(name).some((text) => re.test(text))
    }
    if (hit) result.add(name)
  }
  return result
}

/** 高扇入阈值：依赖方超过这个数就不值得逐个跑，直接全量更简单也更安全。 */
const HIGH_FANIN = 3

/** 源码扫描缓存：插件名 → 其 lib/ + src/ 下源码文本。 */
const SOURCE_SCAN_CACHE = new Map()

/**
 * 计算受影响插件集合。
 * 返回 { plugins, escalated, reasons }；escalated = true 表示必须全量（无证据可裁剪）。
 */
function computeImpactScope(files) {
  if (files === null) {
    return { plugins: new Set(ALL_PLUGINS), escalated: true, reasons: ['无法获取变更文件列表（git diff 失败）'] }
  }
  const reasons = []
  const affected = new Set()
  const rootToolchain = []
  const otherRoot = []
  let docOnly = 0

  for (const file of files) {
    const pluginMatch = /^plugins\/([^/]+)\//.exec(file)
    if (pluginMatch) {
      const name = pluginMatch[1]
      if (!ALL_PLUGINS.includes(name)) continue
      affected.add(name)
      const dependents = [...dependentsOf(name)].sort()
      for (const dep of dependents) affected.add(dep)
      if (dependents.length >= HIGH_FANIN) {
        // 高扇入共享库（如 dsh-shared：15 个插件 import 它）——逐个跑依赖方 ≈ 全量，
        // 直接全量更简单，也不给「漏掉某个间接依赖方」留口子
        reasons.push(`plugins/${name}/** 是被 ${dependents.length} 个插件依赖的共享库 → 无法有意义地裁剪，全量`)
        return { plugins: new Set(ALL_PLUGINS), escalated: true, reasons, docsOnly: false }
      }
      if (dependents.length > 0) {
        reasons.push(`plugins/${name}/** 变更 → 额外纳入依赖方：${dependents.join('、')}`)
      }
      continue
    }
    if (file.startsWith('scripts/')) {
      // 校验/发版脚本变更：可能影响任何插件结果，保守全量
      rootToolchain.push(file)
      continue
    }
    if (ROOT_TOOLCHAIN_FILES.has(file)) {
      rootToolchain.push(file)
      continue
    }
    if (isRuntimeIrrelevant(file)) {
      // 文档/skill/CI 流水线定义只影响 docs/format 检查，不可能改变插件运行时行为
      docOnly += 1
      continue
    }
    otherRoot.push(file)
  }

  if (docOnly > 0) reasons.push(`其中文档/skill/CI 配置 ${docOnly} 个：不影响插件测试范围`)
  if (rootToolchain.length > 0) {
    reasons.push(
      `根工具链文件变更（${rootToolchain.slice(0, 3).join('、')}${rootToolchain.length > 3 ? '…' : ''}）→ 无法安全裁剪，全量`,
    )
    return { plugins: new Set(ALL_PLUGINS), escalated: true, reasons, docsOnly: false }
  }
  if (otherRoot.length > 0) {
    reasons.push(`仓库根文件变更（${otherRoot.slice(0, 3).join('、')}${otherRoot.length > 3 ? '…' : ''}）→ 全量`)
    return { plugins: new Set(ALL_PLUGINS), escalated: true, reasons, docsOnly: false }
  }
  const docsOnly = files.length > 0 && docOnly === files.length
  if (docsOnly) reasons.push('本次变更为纯文档/skill/CI 配置 → 跳过一切与插件源码相关的检查')
  return { plugins: affected, escalated: false, reasons, docsOnly }
}

/**
 * audit 检查项（issue #199）。
 *
 * 三件事必须同时成立，否则这个门禁就是「假绿」：
 *   1. 打到**官方 registry**——镜像（npmmirror 等）没有 security advisories 端点。
 *      实测：`--registry` 会被 npm 按本机 registry 反向重写，必须再设
 *      `replace_registry_host=never`；两者由 auditEnv() 统一给出；
 *   2. 校验输出里**确有结构化报告**（parseAuditOutput）——只看退出码时，
 *      「端点不存在」与「干净」都可能以 0/1 退出而无法区分；
 *   3. 门槛与 CI 一致（moderate）——原 CI 用 high，正是它放行了 #199 的两条 moderate。
 */
async function runAudit() {
  const result = await runCapture('npm', auditCmdArgs(), root, { env: auditEnv() })
  const verdict = parseAuditOutput(result)
  if (!verdict.effective) {
    const mirror = verdict.reason.includes('端点未实现')
    const hint = mirror
      ? '原因：当前 registry 不提供 npm audit 的 security advisories 端点（npmmirror 等镜像即如此）。'
      : '原因：audit 未能取到 advisory 数据（网络不可达 / 需要代理）。'
    return {
      ok: false,
      message:
        'audit 门禁未真正执行 —— ' +
        verdict.reason +
        '\n      ' +
        hint +
        '\n      本检查项始终按官方 registry 运行，与你的 npm 配置无关；请确认网络或代理可用。\n      手动复现：' +
        auditCommandHint(),
    }
  }
  // effective=true：npm audit 的退出码此时才可信（0 = 无达阈值漏洞，1 = 有）。
  if (result.ok) return { ok: true, summary: verdict.reason }
  // 失败时把 --json 报告渲染成人类可读清单（裸 JSON 没人看得下去，等于把门禁做成摆设）
  let rendered = result.out
  try {
    rendered = renderAuditReport(JSON.parse(extractJsonObject(result.out)))
  } catch {
    // 渲染失败就退回原始输出——真实报告永远不能被我们自己的渲染逻辑吞掉
  }
  return { ok: false, out: rendered }
}

// ── 检查项定义 ──────────────────────────────────────────────────────────────
const OPTIONAL_CHECKS = ['audit', 'mutation'] // CI 强制但本地默认跳过的项

/**
 * CHECK_DEFS：每项 { id, label, note?, optional?, run(ctx), skip?(ctx) }
 *   - ctx = { fast, changedFiles, impactPlugins, escalated, docsOnly, plugins (--plugin 过滤) }
 *   - skip(ctx) 返回 string = 跳过原因（快速模式下的「有证据跳过」，会被打印出来）
 */
const CHECK_DEFS = [
  {
    id: 'audit',
    label: 'audit (npm audit --audit-level=moderate @ 官方 registry)',
    note: 'CI 强制；本地默认跳过（需联网 + 官方 registry 可直连/可代理），--audit 或 --only audit 开启',
    optional: true,
    run: runAudit,
  },
  {
    id: 'mutation',
    label: 'mutation (npx stryker run @ dsh-file-activity)',
    note: 'CI 强制；本地约 20s，默认跳过，--mutation 或 --only mutation 开启',
    optional: true,
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'stryker', 'run'], join(root, 'plugins', 'dsh-file-activity')),
  },
  {
    id: 'test',
    label: 'test（逐插件：node --check + npm test）',
    run: (ctx) => runPluginTests(ctx),
    skip: (ctx) => (ctx.docsOnly ? '本次变更为纯文档/skill，无插件源码变更' : null),
  },
  {
    id: 'typecheck',
    label: 'typecheck (npx tsc --noEmit)',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'tsc', '--noEmit'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：tsc 输入仅含 .ts/.tsx，不可能受影响' : null),
  },
  {
    id: 'lint',
    label: 'lint (npx eslint plugins/)',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'eslint', 'plugins/'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：eslint 只检查 plugins/ 下源码' : null),
  },
  {
    id: 'ts-size',
    label: 'ts-size (node scripts/check-ts-size.mjs)',
    run: () => runCapture('node', ['scripts/check-ts-size.mjs'], root),
    // 无 .ts/.tsx 变更时该门禁不可能失败（基线未动）→ 快速模式跳过并说明
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：该门禁只统计 TS 源码规模'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.changedFiles.some((f) => /\.tsx?$/.test(f))
      return touched ? null : '本次变更不含 .ts/.tsx 文件（该门禁只统计 TS 源码规模）'
    },
  },
  {
    id: 'format',
    label: 'format (npx prettier --check .)',
    run: (ctx) => {
      // 仅在「确实拿到了变更文件」时才裁剪范围。changedFiles 为空数组（例如 --base 指向 HEAD、
      // 没有待推送提交）时必须回退全仓库：否则会变成 `prettier --check` 无文件参数 → prettier
      // 转去读 stdin，行为随版本而变（本机恰好返回 0，但那是隐式的、不可依赖的）。
      const scoped = ctx.fast && !ctx.escalated && ctx.changedFiles !== null && ctx.changedFiles.length > 0
      const paths = scoped ? ctx.changedFiles : ['.']
      ctx.report?.(scoped ? `范围：本次变更 ${paths.length} 个文件` : '范围：全仓库（没有可裁剪的变更文件，安全回退）')
      // --ignore-unknown：按变更文件裁剪时传入的是**显式路径**，prettier 对显式路径里的
      // 未知扩展名（.feature / .png 等）直接报 "No parser could be inferred for file"（exit 2），
      // 而全仓库 `--check .`（CI 语义）走目录展开、这类文件被静默跳过 —— 于是「改了 Gherkin
      // 场景或新增截图」的推送在本地 pre-push 假失败、CI 反而通过。--ignore-unknown 让显式
      // 路径与目录展开行为一致：只检查**能格式化**的文件（实测 RED：改 .feature 后
      // `prettier --check <file>` exit 2 → 加该参数后 exit 0）。
      return runCapture('npx', [...NPX_BASE_ARGS, 'prettier', '--check', '--ignore-unknown', ...paths], root)
    },
  },
  {
    id: 'test-scripts',
    label: 'release checks (npm run test:scripts)',
    run: () => runCapture('npm', ['run', 'test:scripts'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：发版校验脚本测试与文档无关' : null),
  },
  {
    id: 'depcruise',
    label: 'dependency analysis (npx depcruise plugins/)',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'depcruise', 'plugins/'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：依赖图只由 plugins/ 源码决定' : null),
    // 必须等插件测试跑完：测试会创建/清理各插件 coverage/ 目录，depcruise 扫到半截会 ENOENT
    after: 'test',
  },
  {
    id: 'knip',
    label: 'dead code (npx knip)',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'knip'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：死代码分析只覆盖 JS/TS/MJS 源文件' : null),
  },
  {
    id: 'jscpd',
    label: 'duplicate code (npx jscpd)',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'jscpd'], root),
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：重复代码检测只覆盖 js/ts 格式' : null),
  },
  {
    id: 'docs',
    label: 'docs consistency (node scripts/check-docs.mjs)',
    run: () => runCapture('node', ['scripts/check-docs.mjs'], root),
  },
  {
    id: 'links',
    label: 'links integrity (node scripts/check-links.mjs)',
    note: '文档引用完整性：markdown 链接与锚点 / 路径 token / shell 调用 / npm script / skill 与插件名（<1s，纯本地文件检查，任何变更都跑）',
    run: () => runCapture('node', ['scripts/check-links.mjs'], root),
  },
  {
    id: 'resource-smoke',
    label: 'resource smoke (node scripts/resource-smoke.mjs)',
    note: 'issue #127 发版前资源回归门禁：长会话写放大 ≤1.6 / 内存有界 / 降级触发与恢复（对齐 CI resource-smoke job）',
    run: () => runCapture('node', ['scripts/resource-smoke.mjs'], root),
    // 只覆盖 dsh-my-observability 的审计存储；该插件或 dsh-shared 未动时跳过
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：该门禁只覆盖资源增量模型'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.impactPlugins.has('dsh-my-observability') || ctx.impactPlugins.has('dsh-shared')
      return touched ? null : '本次变更未触及 dsh-my-observability / dsh-shared（该门禁只覆盖资源增量模型）'
    },
  },
]

const CHECK_IDS = CHECK_DEFS.map((c) => c.id)
const CHECK_LABELS = new Map(CHECK_DEFS.map((c) => [c.id, c.label]))
if (new Set(CHECK_IDS).size !== CHECK_IDS.length) {
  console.error('[verify] 内部错误：检查项 id 重复')
  process.exit(1)
}

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

if (options.list) {
  for (const c of CHECK_DEFS) log(`${c.id}\t${c.label}${c.optional ? '（可选，默认跳过）' : ''}`)
  process.exit(0)
}
if (options.help) {
  printHelp()
  process.exit(0)
}

// ── 插件测试 ────────────────────────────────────────────────────────────────
/** 单插件：node --check（lib/index.js / lib/client.js）+ npm test（带单步超时）。 */
async function runOnePlugin(name) {
  const dir = join(root, 'plugins', name)
  for (const f of ['lib/index.js', 'lib/client.js']) {
    if (existsSync(join(dir, f))) {
      const r = await runCapture('node', ['--check', `plugins/${name}/${f}`], root, {
        label: `test ${name}（node --check ${f}）`,
      })
      if (!r.ok) {
        return {
          name,
          ok: false,
          out: r.out,
          error: r.error,
          stage: `node --check ${f}`,
          timedOut: r.timedOut,
          timeoutMs: r.timeoutMs,
        }
      }
    }
  }
  const r = await runCapture('npm', ['test'], dir, { label: `test ${name}（npm test @ plugins/${name}）` })
  return { name, ok: r.ok, out: r.out, error: r.error, stage: 'npm test', timedOut: r.timedOut, timeoutMs: r.timeoutMs }
}

/**
 * 疑似「多进程并发跑同一插件测试」的报错特征。
 * 依据 docs/踩坑/多agent并行测试资源冲突.md：并发跑同一插件时两个 vitest 会争用该插件的
 * coverage/ 与临时目录，表现为 coverage 写入异常 / EACCES / ENOENT / EPERM，或带
 * testTimeout 的联网用例超时（dsh-my-guard 曾出现 5013ms 误报）。
 * 刻意保持保守：只有命中这些特征才触发「串行复测」，不做无条件重试，以免掩盖真实回归。
 */
const CONCURRENCY_CONFLICT_RE =
  /coverage|EACCES|ENOENT|EPERM|ETXTBSY|EBUSY|ENOTEMPTY|EEXIST|resource busy|already in use|testTimeout|Timed out in \d+\s*ms|timed out after/i

/** 该失败是否「疑似并发冲突」。单步超时也算：被争用/负载拖慢的典型表现就是超时。 */
const looksLikeConcurrencyConflict = (r) =>
  Boolean(r.timedOut) || CONCURRENCY_CONFLICT_RE.test(`${r.out ?? ''}\n${r.error ?? ''}`)

/** 「疑似并发冲突 → 串行复测」是否启用（首轮本就串行时无需复测）。 */
function serialRetryEnabled() {
  if (String(process.env.VERIFY_NO_RETRY ?? '') === '1') return false
  return pluginConcurrency() > 1
}

/**
 * 需要独占运行的插件测试（不与其他插件测试并发）。
 * dsh-my-guard 的黑名单扫描测试会真去 npm registry 解析包名（含一个 `testTimeout: 5000`
 * 的联网用例），与其他插件测试并发时曾出现 5013ms 超时误报；独占运行更稳，
 * 代价只是少一路并发（约 8s → 串行 15s 左右）。
 */
const EXCLUSIVE_PLUGIN_TESTS = new Set(['dsh-my-guard'])

function runPluginTests(ctx) {
  const targets = ctx.plugins.length > 0 ? ctx.plugins : [...ctx.impactPlugins].sort()
  const makeTask = (name) => ({
    id: `test:${name}`,
    label: `test ${name}`,
    run: async () => {
      const started = Date.now()
      const r = await runOnePlugin(name)
      return { ...r, ms: Date.now() - started }
    },
  })
  const parallel = targets.filter((name) => !EXCLUSIVE_PLUGIN_TESTS.has(name))
  const exclusive = targets.filter((name) => EXCLUSIVE_PLUGIN_TESTS.has(name))
  let done = 0
  const onDone = (r) => {
    done += 1
    const timeoutNote = r.timedOut ? red(` ⏱ 单步超时 ${secs(r.timeoutMs)}，已终止`) : ''
    log(
      `  ${r.ok ? green('✓') : red('✗')} ${r.name} ${dim(secs(r.ms))} ${dim(`(${done}/${targets.length})`)}${timeoutNote}`,
    )
    if (!r.ok) log(dim(indent(tail(r.out, 40))))
  }
  return (async () => {
    const results = await runPool(parallel.map(makeTask), pluginConcurrency(), onDone)
    for (const name of exclusive) {
      const result = await makeTask(name).run()
      results.push(result)
      onDone(result)
    }

    // ── 疑似并发冲突 → 串行复测一次 ──────────────────────────────────────────
    // 目的：多 agent / 多进程同时跑测试时，coverage 目录争用会让 npm test 偶发退出 1
    // （实测：pre-push 报「10 通过 / 1 失败」挡住 push，几十秒后原样重跑同一项却全绿）。
    // 只复测「失败且特征吻合」的插件、只复测一次，且串行独占执行以排除相互争用；
    // 复测仍失败即判红——真实回归不会被掩盖，只是多花一次单插件测试的时间。
    const retryCandidates = serialRetryEnabled() ? results.filter((r) => !r.ok && looksLikeConcurrencyConflict(r)) : []
    const retried = []
    if (retryCandidates.length > 0) {
      log('')
      log(
        yellow(
          `⚠ ${retryCandidates.length} 个插件首轮失败，且报错特征疑似「并发冲突」（coverage/EACCES/ENOENT/超时）：`,
        ),
      )
      for (const c of retryCandidates) log(yellow(`  - ${c.name}（${c.stage}）`))
      log(yellow('  → 自动串行复测（并发 1，逐个独占运行）以排除相互争用…'))
      for (const candidate of retryCandidates) {
        const started = Date.now()
        const r = await runOnePlugin(candidate.name)
        const ms = Date.now() - started
        const index = results.findIndex((x) => x.name === candidate.name)
        if (index >= 0) results[index] = { ...r, ms, retriedSerial: true }
        retried.push({ name: candidate.name, ok: r.ok, ms })
        if (r.ok) {
          log(
            `  ${green('✓')} ${candidate.name} ${dim(secs(ms))} ${green('串行复测通过')} ${dim('（首轮失败=疑似并发冲突，非真实回归）')}`,
          )
        } else {
          log(
            `  ${red('✗')} ${candidate.name} ${dim(secs(ms))} ${red('串行复测仍失败')} ${dim('（判定为真实失败，非并发冲突）')}`,
          )
        }
      }
      log('')
    }

    const failed = results.filter((r) => !r.ok)
    const out = failed
      .map(
        (f) =>
          `── ${f.name}（${f.stage} 失败）──\n${f.error ? `${f.error}\n` : ''}${tail(f.out, 60)}` +
          (f.retriedSerial ? '\n（首轮曾失败：疑似并发冲突；已串行复测，仍未通过）' : ''),
      )
      .join('\n')
    const ok = failed.length === 0
    const retriedPassed = retried.filter((r) => r.ok)
    return {
      ok,
      out,
      summary: ok
        ? `${targets.length} 个插件全部通过（node --check + npm test）` +
          (retriedPassed.length > 0
            ? `；其中 ${retriedPassed.length} 个（${retriedPassed.map((r) => r.name).join('、')}）疑似并发冲突，已串行复测通过`
            : '')
        : `${failed.length}/${targets.length} 个插件失败：${failed.map((f) => f.name).join('、')}`,
    }
  })()
}

const indent = (text) =>
  text
    .split('\n')
    .map((line) => `    │ ${line}`)
    .join('\n')
const tail = (text, lines) => text.split('\n').slice(-lines).join('\n')

/**
 * 插件测试并发度。各插件测试相互隔离（独立 node 进程 + 临时 DSH_HOME / port 0，
 * 无固定端口占用），但同一仓库里若**另有进程正在跑同一插件**的 vitest，会争用该插件的
 * coverage 目录（见 docs/踩坑/多agent并行测试资源冲突.md）——故默认取保守值，可用
 * VERIFY_CONCURRENCY 覆盖（1-8；怀疑并发冲突时设 1 串行）。
 */
function pluginConcurrency() {
  const raw = Number.parseInt(process.env.VERIFY_CONCURRENCY ?? '', 10)
  if (Number.isInteger(raw) && raw >= 1 && raw <= 8) return raw
  return 3
}

// ── 超时看门狗与进度登记 ────────────────────────────────────────────────────
/** 正在跑的检查项：id → { label, startedAt }；整体超时时用它回答「卡在哪一步、已跑多久」。 */
const ACTIVE_CHECKS = new Map()
/** 已完成的检查项：{ id, ms }；超时报告里列出来，便于判断卡在第几项。 */
const FINISHED_CHECKS = []

/** 整体超时：打印可读报告 → 终止全部子进程（含孙进程）→ 退出码 124。 */
function reportTotalTimeout() {
  const now = Date.now()
  console.error('')
  log(
    red(
      `⏱ 整体超时：本地校验已运行 ${secs(now - globalStartedAt)}，超过上限 ${totalTimeoutSec}s（可用 VERIFY_TIMEOUT 覆盖）`,
    ),
  )
  log(red('  已强制终止全部子进程（含 npm → vitest/cucumber 等孙进程），不会留在后台继续跑。'))
  log('')
  if (ACTIVE_CHECKS.size > 0) {
    log(yellow('卡在以下检查项（超时时刻仍在运行）：'))
    for (const [id, info] of ACTIVE_CHECKS) {
      log(
        yellow(
          `  - ${info.label}，已 ${secs(now - info.startedAt)}（复现：node scripts/verify-local.mjs --only ${id}）`,
        ),
      )
    }
  } else {
    log(yellow('超时时刻没有登记在跑的检查项（可能卡在启动 / git 范围分析阶段）。'))
  }
  if (ACTIVE_CHILDREN.size > 0) {
    log(yellow('仍在运行的子进程（已被终止）：'))
    for (const entry of ACTIVE_CHILDREN.values()) {
      log(yellow(`  - ${entry.label}，已 ${secs(now - entry.startedAt)}`))
      log(yellow(`      $ ${entry.cmd}（cwd: ${entry.cwd}）`))
    }
  }
  if (FINISHED_CHECKS.length > 0) {
    log(dim(`已完成 ${FINISHED_CHECKS.length} 项：${FINISHED_CHECKS.map((c) => `${c.id} ${secs(c.ms)}`).join('、')}`))
  }
  log('')
  log('如何继续（本地校验超时 = push 被挡，不是代码错误）：')
  log('  · 跳过本地校验直接推送（CI 仍会跑全部门禁）：git push --no-verify')
  log(`  · 放宽上限后重试：VERIFY_TIMEOUT=${Math.max(totalTimeoutSec * 3, 900)} git push`)
  log('  · 完全关闭超时：VERIFY_NO_TIMEOUT=1 git push')
  log('  · 只复现卡住的那一项：node scripts/verify-local.mjs --only <id>')
  log('  · 若疑似并发冲突（coverage/EACCES/ENOENT/超时）：VERIFY_CONCURRENCY=1 node scripts/verify-local.mjs --fast')
  log(dim('  排查文档：docs/踩坑/多agent并行测试资源冲突.md'))
  killAllChildren('SIGKILL')
  process.exit(124)
}

/** 启动整体看门狗；返回的定时器在正常结束时清理。 */
function armWatchdog() {
  if (TOTAL_TIMEOUT_MS <= 0) {
    log(dim(`超时保护：整体上限已关闭，单步上限 ${secs(STEP_TIMEOUT_MS)}`))
    return null
  }
  return setTimeout(reportTotalTimeout, TOTAL_TIMEOUT_MS)
}

// 被 kill（含 pre-push 的 shell 兜底超时）时也要清理子进程组：
// spawn 用了 detached，没人清理的话孙进程会变成孤儿继续占 CPU 与 coverage 目录。
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error('')
    log(yellow(`收到 ${signal}，正在终止全部子进程…`))
    killAllChildren('SIGKILL')
    process.exit(130)
  })
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const base = options.fast ? resolveBase(options.base) : { ok: false, reason: 'full 模式不做范围分析' }
let changed = null
let impact = { plugins: new Set(ALL_PLUGINS), escalated: false, docsOnly: false, reasons: [] }

if (options.fast) {
  log(`快速模式（pre-push）：分析本次推送范围${options.base ? `（--base ${options.base}）` : ''}`)
  if (!base.ok) {
    log(yellow(`⚠ 无法确定比较基准：${base.reason}`))
    log(yellow('⚠ 安全退化 → 全量：不做任何裁剪（插件测试全部运行）'))
    impact = { plugins: new Set(ALL_PLUGINS), escalated: true, docsOnly: false, reasons: ['基准不可解析 → 全量'] }
  } else {
    log(`  基准：${base.ref}（${base.reason}）`)
    changed = changedFiles(base.ref)
    if (changed === null) {
      log(yellow('⚠ git diff 失败 → 安全退化全量'))
      impact = { plugins: new Set(ALL_PLUGINS), escalated: true, docsOnly: false, reasons: ['git diff 失败 → 全量'] }
    } else {
      impact = computeImpactScope(changed)
      log(`  变更文件：${changed.length} 个`)
      for (const reason of impact.reasons) log(`  ${yellow('⚠')} ${reason}`)
      if (impact.docsOnly) {
        log(`  受影响插件：（无 —— 纯文档变更）`)
      } else if (!impact.escalated) {
        log(`  受影响插件：${impact.plugins.size > 0 ? [...impact.plugins].sort().join('、') : '（无）'}`)
      }
    }
  }
}

const ctx = {
  fast: options.fast,
  baseOk: base.ok,
  changedFiles: changed,
  impactPlugins: impact.plugins,
  escalated: impact.escalated,
  docsOnly: impact.docsOnly || false,
  plugins: options.plugins,
  report: null,
}

// 选定要跑的项
const runList =
  options.only.length > 0
    ? CHECK_DEFS.filter((c) => options.only.includes(c.id))
    : CHECK_DEFS.filter(
        (c) => !c.optional || (c.id === 'audit' && options.audit) || (c.id === 'mutation' && options.mutation),
      )

const SKIPPED_BY_SCOPE_NOTE = new Map() // id → 跳过原因（快速模式裁剪）
const tasks = []
for (const check of runList) {
  const scopeSkip = check.skip ? check.skip(ctx) : null
  if (scopeSkip) {
    SKIPPED_BY_SCOPE_NOTE.set(check.id, scopeSkip)
    continue
  }
  tasks.push({
    id: check.id,
    label: check.label,
    after: check.after,
    run: async () => {
      const started = Date.now()
      ACTIVE_CHECKS.set(check.id, { label: check.label, startedAt: started })
      let detail = null
      const localCtx = { ...ctx, report: (msg) => (detail = msg) }
      let r
      try {
        r = await check.run(localCtx)
      } finally {
        ACTIVE_CHECKS.delete(check.id)
      }
      const ms = Date.now() - started
      FINISHED_CHECKS.push({ id: check.id, ms })
      const extra = []
      if (detail) extra.push(detail)
      if (r.summary) extra.push(r.summary)
      return {
        id: check.id,
        label: check.label,
        ok: r.ok,
        code: r.code,
        out: r.out ?? '',
        error: r.error,
        timedOut: r.timedOut,
        timeoutMs: r.timeoutMs,
        ms,
        extra,
      }
    },
  })
}

const HARD_SKIPPED = CHECK_DEFS.filter((c) => !runList.includes(c))
const CONCURRENCY = options.fast ? 4 : 2

log('')
log(
  `开始校验：${tasks.length} 项${SKIPPED_BY_SCOPE_NOTE.size > 0 ? `，按范围跳过 ${SKIPPED_BY_SCOPE_NOTE.size} 项` : ''}${HARD_SKIPPED.filter((c) => c.optional).length > 0 ? `，默认跳过 ${HARD_SKIPPED.filter((c) => c.optional).length} 项（CI 强制）` : ''}（检查项并发 ${CONCURRENCY}，插件测试并发 ${pluginConcurrency()}）`,
)
if (options.plugins.length > 0) log(`--plugin 过滤：${options.plugins.join('、')}`)
log('')

const totalStarted = Date.now()
const watchdog = armWatchdog()
const onTaskDone = (r) => {
  const mark = r.ok ? green('✅') : red('❌')
  const timeoutNote = r.timedOut ? red(` ⏱ 单步超时（${secs(r.timeoutMs)} 上限，已终止该进程组）`) : ''
  log(`${mark} ${r.label} ${dim(secs(r.ms))}${timeoutNote}`)
  for (const line of r.extra) log(`   ${line}`)
  if (!r.ok) {
    const body = r.error ? `${r.error}\n${r.out}` : r.out
    log(red(indent(tail(body.trim(), 60))))
  }
}

// 两阶段调度：先跑互不依赖的检查项（并发），再跑必须等插件测试结束的项（`after` 门控）。
// 典型例子：depcruise 必须排在 test 之后——插件测试会生成/清理 coverage/ 目录。
const gated = tasks.filter((t) => t.after)
const free = tasks.filter((t) => !t.after)
const results = await runPool(free, CONCURRENCY, onTaskDone)
for (const task of gated) {
  const result = await task.run()
  results.push(result)
  onTaskDone(result)
}
const totalMs = Date.now() - totalStarted

// ── 汇总 ────────────────────────────────────────────────────────────────────
log('')
const failed = results.filter((r) => !r.ok)
const passed = results.filter((r) => r.ok)

if (options.fast) {
  const tested = tasks.find((t) => t.id === 'test')
  if (tested) {
    const pluginCount = ctx.plugins.length > 0 ? ctx.plugins.length : impact.plugins.size
    let scopeText
    if (impact.escalated) scopeText = `全部 ${ALL_PLUGINS.length} 个插件（安全退化：无变更证据可裁剪）`
    else if (ctx.docsOnly) scopeText = '0 个（本次推送不含插件源码变更）'
    else scopeText = `${pluginCount} 个受影响插件（按 git 变更裁剪）`
    log(`pre-push 实际范围：插件测试 = ${scopeText}`)
  }
  for (const [id, why] of SKIPPED_BY_SCOPE_NOTE)
    log(`⏭ ${id === 'test' ? '未跑插件测试' : `按范围跳过 ${CHECK_LABELS.get(id) ?? id}`}：${why}`)
  log(dim('未跑的项由 CI（.github/workflows/ci.yml）强制覆盖；本地要全量复现：npm run verify'))
}

const optionalSkipped = HARD_SKIPPED.filter((c) => c.optional)
if (optionalSkipped.length > 0) {
  log('')
  log('注意：以下检查本地未跑，CI 会强制执行：')
  for (const c of optionalSkipped) log(`  - ${c.label}（${c.note}）`)
}

log('')
log(`结果：${passed.length} 通过 / ${failed.length} 失败 / 总耗时 ${secs(totalMs)}`)
if (failed.length > 0) {
  log(red('❌ 失败项（CI 同样会失败，修复后重跑 npm run verify）：'))
  for (const f of failed) log(`  - ${f.label}${f.timedOut ? red(`（⏱ 单步超时 ${secs(f.timeoutMs)}，已终止）`) : ''}`)
  const timedOut = failed.filter((f) => f.timedOut)
  if (timedOut.length > 0) {
    log('')
    log(yellow('超时提示（不是断言失败，而是这一步没在预期时间内跑完）：'))
    log('  - 放宽单步上限重试：VERIFY_STEP_TIMEOUT=600 node scripts/verify-local.mjs --fast')
    log('  - 放宽整体上限重试：VERIFY_TIMEOUT=900 node scripts/verify-local.mjs --fast')
    log('  - 只想先推送、把完整校验交给 CI：git push --no-verify')
  }
  const pluginFail = failed.some((f) => f.id === 'test')
  if (pluginFail) {
    log('')
    log(yellow('排查提示（插件测试失败时）：'))
    log(
      `  - 若报错含 coverage / EACCES / ENOENT 或 5s 超时：可能有另一个进程正在跑同一插件` +
        `（见 docs/踩坑/多agent并行测试资源冲突.md）→ 确认后重跑，或 VERIFY_CONCURRENCY=1 串行复测`,
    )
    log('  - 复测单个插件：node scripts/verify-local.mjs --only test --plugin <name>')
    log('  - 本次已内置「疑似并发冲突 → 串行自动复测」且复测仍失败 → 按真实失败处理（非并发冲突）')
    log('  - 想看首轮原始失败（关闭自动复测）：VERIFY_NO_RETRY=1 node scripts/verify-local.mjs --fast')
  }
  if (watchdog !== null) clearTimeout(watchdog)
  process.exit(1)
}
if (watchdog !== null) clearTimeout(watchdog)
log(green('✅ 全部通过'))
process.exit(0)

// ── 帮助 ────────────────────────────────────────────────────────────────────
function printHelp() {
  log('本地校验（对齐 CI 全部门禁）')
  log('用法: node scripts/verify-local.mjs [options]')
  log('  （无参数）      full 全量：全部检查项 + 全部插件测试')
  log('  --fast          快速通道（pre-push 默认）：按本次推送变更裁剪插件测试，独立性检查并发')
  log('  --base <ref>    指定范围比较基准（默认 @{upstream} → origin/main；仅在 --fast 生效）')
  log('  --full          强制全量（覆盖 --fast）')
  log('  --only <id>     只跑单项（可重复；id 见下）')
  log('  --plugin <name> 只跑该插件的 test/--check（可重复）')
  log('  --timeout <sec> 覆盖整体超时上限（秒；0 = 关闭）')
  log('  --audit         额外执行 npm audit（默认跳过：本地 registry 可能不支持 audit API）')
  log('  --mutation      额外执行 stryker 变异测试（默认跳过：约 20s）')
  log('  --list          列出检查项 id')
  log('  --help          显示本帮助')
  log('检查项: ' + CHECK_IDS.join(' / '))
  log('默认跳过（CI 强制，本地可显式开启）: ' + OPTIONAL_CHECKS.join(' / '))
  log('环境变量: VERIFY_CONCURRENCY=<1-8> 覆盖插件测试并发度（默认 3）')
  log(`           VERIFY_TIMEOUT=<秒> 整体超时上限（当前 ${totalTimeoutSec === 0 ? '已关闭' : `${totalTimeoutSec}s`}）`)
  log(
    `           VERIFY_STEP_TIMEOUT=<秒> 单个子进程超时（当前 ${stepTimeoutSec === 0 ? '已关闭' : `${stepTimeoutSec}s`}）`,
  )
  log('           VERIFY_NO_TIMEOUT=1 关闭全部超时；VERIFY_NO_RETRY=1 关闭「并发冲突 → 串行复测」')
  log('超时行为: 单步超时杀该步进程组并判该步失败；整体超时打印「卡在哪一步」后以退出码 124 结束')
}
