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
 *   typecheck    → npx tsc --noEmit（根 tsconfig：只覆盖 plugins/<插件>/lib/*.d.ts 产物与根级 TS）
 *   typecheck-plugins → node scripts/typecheck-all.mjs（18 插件的 server + client 端，并发）
 *                  issue #330：这是 CI 一直在跑、而**本地此前完全没跑**的那一项——client 端
 *                  类型检查本地零覆盖，本地全绿、CI 红，白等一轮 CI。现已在两种模式下恒跑。
 *   lint         → npx eslint plugins/（--fast 时按变更裁剪到本次改动的 .js/.mjs，
 *                  无 .js/.mjs 变更时跳过并打印原因；规则集/根配置变更会退化全量）
 *   ts-size      → node scripts/check-ts-size.mjs（TS 行数/复杂度基线）
 *   client-modules→ node scripts/check-client-modules.mjs（客户端 bundle 模块白名单，
 *                  issue #321：产物 require 的模块必须能解析，否则整条 client factory 挂掉）
 *   pack-hygiene → node scripts/check-pack-hygiene.mjs（包发布卫生，issue #323：字段指向的
 *                  文件存在 / dsh.* 与 exports 互证 / npm pack 内容断言 / README 引用的
 *                  assets 确实随包发布）
 *   test-sleeps  → node scripts/check-test-sleeps.mjs（固定 sleep 门禁，issue #335：新增的
 *                  固定时长等待必须写 `// sleep-ok: 理由`，存量冻结在基线里只许变少）
 *   format       → npx prettier --check .
 *   test-scripts → npm run test:scripts（vitest 发版校验）
 *   depcruise    → npx depcruise plugins/
 *   knip         → npx knip（死代码）
 *   jscpd        → npx jscpd（重复代码）
 *   docs         → node scripts/check-docs.mjs（文档一致性，纯本地文件检查）
 *   links        → node scripts/check-links.mjs（文档引用完整性：链接/锚点/残缺链接语法/
 *                  路径 token/shell 调用/npm script/skill 与插件名，纯本地文件检查）
 *   artifacts    → node scripts/check-client-artifacts.mjs（issue #318 / ADR-0002：共享部件与
 *                  server tsc 产物必须与已提交版本逐字节一致，fail-closed）
 *   secret-scan  → node scripts/check-secrets.mjs（issue #324：gitleaks 扫**全历史**
 *                  —— 覆盖本次 diff。二进制固定版本 + SHA256 校验后缓存到 .gitleaks-cache/；
 *                  首次需下载（走 HTTPS_PROXY；本机实测 7.9MB / 90s，CI 网络下更快））
 *   commits      → node scripts/check-commit-messages.mjs（issue #324：**只校验本次变更范围**
 *                  的提交信息，规则同 ./.commitlintrc.json 与 .husky/commit-msg。
 *                  范围默认 @{upstream} → origin/main；CI 上从 GITHUB_EVENT_PATH 推导
 *                  （PR 的 base..head / push 的 before..after）；范围内无提交时打印"跳过"）
 *   resource-smoke→ node scripts/resource-smoke.mjs（issue #127 资源回归门禁）
 *   client-size  → node scripts/check-client-size.mjs（客户端产物**体积预算**，issue #322：
 *                  发布面（lib/** 与 assets/**，以插件 package.json 的 files 为准）不得超过
 *                  「基线 + 余量」——#185 曾把 4.48 MB 冗余注入 client bundle，全靠人工发现）
 *   gate-parity  → node scripts/check-gate-parity.mjs（issue #330：本地检查项集合 ↔ CI 步骤集合
 *                  的**双向**一致性校验，缺口逐条列出；它自己也跑在 CI，否则「校验一致性」
 *                  这件事就变成新的静默缺口）
 *   review-scripts → node --test .github/scripts/*.test.cjs（issue #311：PR 审查判定内核
 *                  review-verdict.cjs 的三态判定/抖动区分/历史摘要单测。此前这类测试只在
 *                  人工执行时跑过，没人跑就没人知道判定分支坏了 —— 判定逻辑必须进门禁）
 *
 * ⚠️ 检查项与权威执行点的登记表在 `scripts/lib/gate-registry.mjs`（issue #330）：
 *    每个检查项都有 `command`（本文件实际执行的命令）与 `ciQuality`（是否属于 CI quality job），
 *    两者与登记表逐字比对（`gate-parity` 门禁），任何一边改了另一边没跟上就红。
 *
 * 用法：
 *   node scripts/verify-local.mjs                    # full：全部检查（跳过 audit/mutation）
 *   node scripts/verify-local.mjs --fast             # fast：按变更裁剪（pre-push 用）
 *   node scripts/verify-local.mjs --ci-quality       # CI quality job 的执行体（并发跑 ciQuality 项，
 *                                                    # 并写 GitHub job summary；见 .github/workflows/ci.yml）
 *   node scripts/verify-local.mjs --fast --base <r>  # 指定比较基准（默认 @{upstream} → origin/main）
 *   node scripts/verify-local.mjs --full             # 强制全量（与 --fast 同给时 --full 生效）
 *   node scripts/verify-local.mjs --audit            # 额外执行 npm audit
 *   node scripts/verify-local.mjs --mutation         # 额外执行 stryker 变异测试
 *   node scripts/verify-local.mjs --only <id>        # 只跑单项（可重复，如 --only knip）
 *   node scripts/verify-local.mjs --plugin <name>    # 只跑该插件的 test/--check（可重复）
 *   node scripts/verify-local.mjs --timeout <sec>    # 覆盖整体超时上限（秒；none = 显式关闭）
 *   node scripts/verify-local.mjs --list             # 列出全部检查项 id
 *   node scripts/verify-local.mjs --list --json      # 机器可读清单（供 check-gate-parity 校验）
 *   node scripts/verify-local.mjs --help
 *
 * 环境变量：
 *   VERIFY_CONCURRENCY=1..8   显式覆盖插件测试并发度（**默认自适应**：clamp(floor(核数/2),1,6)，
 *                             load > 核数×1.5 时降为 1 串行；非法值忽略并打印提示，见下）
 *   VERIFY_CHECK_CONCURRENCY=1..8 显式覆盖检查项并发度（同样自适应，上界 4；issue #418）
 *   VERIFY_TIMEOUT=<sec>      整体墙钟上限（默认 300；none = 显式关闭）
 *   VERIFY_STEP_TIMEOUT=<sec> 单个子进程上限（默认 min(整体上限, 120)；none = 显式关闭）
 *   VERIFY_NO_TIMEOUT=1       等价于 VERIFY_TIMEOUT=none（只关整体上限，单步仍默认 120s）
 *   注意：0 / 负数 / 空 / 非数字一律报错退出 —— 「设成 0 即关闭上限」是 fail-open，已废除；
 *         需要「无上限」必须显式写 none（关闭是看得见的选择，并在 stderr 打印警告）。
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
 *   coverage/EACCES/ENOENT/EPERM 或 5s 联网用例超时（见 docs/踩坑/README.md）。
 *   插件测试失败且报错命中这些特征时，会自动以串行（并发 1）复测**失败的那些插件**：
 *   复测通过 → 判通过并打印「疑似并发冲突，已串行复测通过」；复测仍失败 → 判红。
 *   只复测一次、只复测失败项，不掩盖真实回归；VERIFY_NO_RETRY=1 可关闭该降级。
 *
 * 详见 docs/开发指南/构建与测试.md「本地一键校验（verify-local）」。
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, loadavg, tmpdir } from 'node:os'
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
// issue #188：影响面规则抽成纯函数模块，供 verify-local / 回放统计脚本 / 单测三方共用
import {
  computeImpactScope,
  createDependentsResolver,
  diffPackageJsonRuntimeFields,
  listChangedFiles,
} from './lib/impact-scope.mjs'
// 超时配置解析抽成纯函数模块（fail-closed：0 / 负数 / 空 / 非法一律报错，见该文件头注释）
import { isValidTimeoutMs, parseTimeoutSeconds, timeoutConfigError } from './lib/verify-timeout.mjs'
import { looksLikeConcurrencyConflict } from './lib/verify-flaky-classify.mjs'
// 自适应并发度（issue #418）：核数 + load 双约束，纯函数便于单测
import { resolveConcurrency, describeConcurrency, resolveVitestWorkers } from './lib/verify-concurrency.mjs'

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
  ciQuality: false,
  base: null,
  commitsFrom: null,
  timeout: null,
  list: false,
  json: false,
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
  else if (flag === '--commits-from') options.commitsFrom = value()
  else if (flag === '--timeout') options.timeout = value()
  else if (flag === '--audit') options.audit = true
  else if (flag === '--mutation') options.mutation = true
  else if (flag === '--fast' || flag === '--changed-only') options.fast = true
  else if (flag === '--full') options.full = true
  else if (flag === '--ci-quality') options.ciQuality = true
  else if (flag === '--json') options.json = true
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
// --ci-quality 是「CI quality job 的执行体」：CI 上永远是全量（不做范围裁剪），
// 但只跑登记表里 ci.job === 'quality' 的那些检查项（插件测试/资源冒烟/审计/变异各有独立 job）。
if (options.ciQuality && options.fast) {
  console.error('[verify] --ci-quality 在 CI 上按全量执行，忽略 --fast')
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
 * 解析一项超时配置：未设置 → null（回落默认值）；显式 none/off → 0（关闭该上限）。
 *
 * 0 / 负数 / 空 / 非数字 **一律报错退出**（fail-closed）：旧实现把「0 / false / no / disable」
 * 当成「关闭上限」（fail-open —— 非交互环境里「配置为 0」= 「无限制放行」，见 AGENTS.md
 * 「写操作默认拒绝（fail-closed）」），把非法值静默回落默认（掩盖配置错误）。
 * 纯函数与边界单测：scripts/lib/verify-timeout.mjs / scripts/test/verify-timeout-parse.test.mjs。
 */
function resolveTimeoutSec(name, raw, { closeForm = `${name}=none`, hint = '' } = {}) {
  const parsed = parseTimeoutSeconds(raw)
  if (parsed.ok) return parsed.seconds
  console.error(timeoutConfigError({ name, raw, closeForm, hint }))
  process.exit(1)
}

const DEFAULT_TOTAL_TIMEOUT_SEC = 300
const DEFAULT_STEP_TIMEOUT_SEC = 120

const totalTimeoutSec = (() => {
  // VERIFY_NO_TIMEOUT=1 是显式开关（严格等号，不是 falsy 判断）：等价于 VERIFY_TIMEOUT=none
  if (String(process.env.VERIFY_NO_TIMEOUT ?? '') === '1') return 0
  if (options.timeout !== null) {
    return resolveTimeoutSec('--timeout', options.timeout, {
      closeForm: '--timeout none',
      hint: '整体上限也可用 VERIFY_NO_TIMEOUT=1 显式关闭。',
    })
  }
  const fromEnv = resolveTimeoutSec('VERIFY_TIMEOUT', process.env.VERIFY_TIMEOUT, {
    hint: '整体上限也可用 VERIFY_NO_TIMEOUT=1 显式关闭。',
  })
  return fromEnv === null ? DEFAULT_TOTAL_TIMEOUT_SEC : fromEnv
})()
const stepTimeoutSec = (() => {
  const fromEnv = resolveTimeoutSec('VERIFY_STEP_TIMEOUT', process.env.VERIFY_STEP_TIMEOUT)
  if (fromEnv !== null) return fromEnv
  if (totalTimeoutSec === 0) return DEFAULT_STEP_TIMEOUT_SEC
  return Math.min(totalTimeoutSec, DEFAULT_STEP_TIMEOUT_SEC)
})()
const TOTAL_TIMEOUT_MS = totalTimeoutSec * 1000
const STEP_TIMEOUT_MS = stepTimeoutSec * 1000

// 「无上限」必须是看得见的选择：显式关闭时在 stderr 明确告知「挂死时不会有东西来杀它」。
// 刻意走 stderr 而不是 stdout —— `--list --json` 的 stdout 必须保持纯 JSON（门禁脚本消费）。
if (totalTimeoutSec === 0) {
  console.error(
    `[verify] ⚠ 整体墙钟上限已显式关闭（VERIFY_NO_TIMEOUT=1 / VERIFY_TIMEOUT=none）：脚本挂死时不会有任何东西来终止它（单步上限仍为 ${secs(STEP_TIMEOUT_MS)}）`,
  )
}
if (stepTimeoutSec === 0) {
  console.error('[verify] ⚠ 单步子进程超时已显式关闭（VERIFY_STEP_TIMEOUT=none）：任一步挂死都不会被终止')
}

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

/**
 * 用**独立的 TMPDIR** 运行一个检查项（issue #330）。
 *
 * 为什么需要：`os.tmpdir()` 读的是全局 `TMPDIR`，而 `os.tmpdir()` 下的目录是**进程间共享**的。
 * 实测（本仓库真实 race）：`scripts/test/client-artifacts.test.mjs` 有一条「不残留临时目录」断言，
 * 它枚举 `os.tmpdir()` 里的 `dsh-artifacts-mirror-*`；而并发池里的 `artifacts` 检查项**自己就在**
 * `os.tmpdir()` 建镜像 → 前者把「别人正在用的目录」误判成自己的残留 → **必然假红**（单跑全绿、
 * 并发必红，且与代码正确性无关）。
 *
 * 这是与「文件争用」不同的一类污染：**全局状态互相看见**。修法不是降并发度（那只是掩盖），
 * 而是让检查项**不共享全局临时目录**——注入独立 `TMPDIR/TEMP/TMP`，跑完删除。
 * 同一原则适用于任何「计数/枚举全局资源」的检查或测试（固定端口、共享目录同理）。
 */
async function runWithIsolatedTmp(label, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-isolated-tmp-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 独立 TMPDIR 对应的子进程 env。 */
const isolatedTmpEnv = (dir) => ({ TMPDIR: dir, TEMP: dir, TMP: dir })

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
  // 执行层防线（fail-closed）：0 只允许来自解析层的「显式关闭」（none/off/VERIFY_NO_TIMEOUT=1）；
  // NaN / 负数 / 非整数（例如调用方传错 opts.timeoutMs）必须硬失败，绝不落进
  // 「falsy → 静默无上限」的老路径。
  if (!isValidTimeoutMs(timeoutMs)) {
    console.error(
      `[verify] 内部错误：runCapture 收到非法 timeoutMs=${String(timeoutMs)}（需要非负整数毫秒；0 仅表示已显式关闭）`,
    )
    process.exit(1)
  }
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

    // 只有「已显式关闭」（timeoutMs === 0，来自 none/off/VERIFY_NO_TIMEOUT=1）才走无上限分支。
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
            `  放宽单步上限：VERIFY_STEP_TIMEOUT=<秒>；显式关闭该上限：VERIFY_STEP_TIMEOUT=none`,
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

/** git diff base...HEAD 的变更文件（含状态）；失败返回 null。规则与实现见 lib/impact-scope.mjs。 */
function changedFiles(base) {
  return listChangedFiles(base, spawnSyncGIT)
}

// ── 影响面规则 ──────────────────────────────────────────────────────────────
// 规则本体（文档/CI 配置短路、根工具链集合、「与插件测试结果无关」白名单、package.json
// 字段级判定、高扇入阈值、computeImpactScope）已抽到 scripts/lib/impact-scope.mjs（issue #188）。
// 抽出的两个理由：① pre-push 与「回放最近 N 提交的退化率统计」（scripts/analyze-impact-replay.mjs）
// 必须共用同一份规则，否则统计数字与实际行为两张皮；② 边界（纯删除提交、已删除的插件目录、
// package.json 只改元数据）要能单测，见 scripts/test/impact-scope.test.mjs。
//
// 相对于旧版内联规则的两处行为变化：
//   · package-lock.json 从「根工具链 → 全量」移入「与插件测试无关」白名单（lockfile 只被
//     npm ci/install 消费，本地插件测试跑的是已安装的 node_modules）；
//   · scripts/check-{docs,links,ts-size}.mjs 同样白名单化（无插件测试引用，且各自有独立检查项）。

// 反向依赖（依赖图口径）已抽到 lib/impact-scope.mjs（issue #188）：pre-push 与
// scripts/analyze-impact-replay.mjs（回放统计）必须共用同一份依赖图，否则两边算出的
// 「受影响插件」会对不上。
const dependentsOf = createDependentsResolver(root, ALL_PLUGINS)

/**
 * package.json 的「字段级」退化判定（issue #188）：只有非元数据字段（dependencies /
 * devDependencies / scripts / overrides / engines / type / …）变化才需要退化全量；
 * description / keywords 这类纯元数据改动不改变任何插件测试结果。
 *
 * 返回 diffPackageJsonRuntimeFields 的结果：[] = 只有元数据变化（可收窄）；
 * 非空数组 = 有运行时字段变化（退化）；null = 无法判定（读不到旧版本或 JSON 解析失败 → 退化）。
 */
function packageJsonRuntimeFields(baseRef) {
  const before = spawnSyncGIT(['show', baseRef + ':package.json'])
  if (!before.ok) return null
  let after
  try {
    after = readFileSync(join(root, 'package.json'), 'utf8')
  } catch {
    return null
  }
  return diffPackageJsonRuntimeFields(before.out, after)
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
// CI 强制、本地默认跳过的项（= 白名单豁免，理由见 `scripts/lib/gate-registry.mjs` 的 LOCAL_EXEMPTIONS，
// 由 `gate-parity` 门禁逐条校验「有理由 + CI 侧真有执行点」，防止「本地慢」被塞进白名单）。
// issue #330 前这里是 ['audit','mutation']；mutation 按规范第十四节改为默认执行。
const OPTIONAL_CHECKS = ['audit']

/**
 * CHECK_META（issue #330）：每个检查项的机器可读元数据。
 *   command   —— 本文件**实际执行**的命令（与 `scripts/lib/gate-registry.mjs` 的 `localCommand`
 *                逐字比对，见 `scripts/check-gate-parity.mjs`；漂移即门禁变红）
 *   ciQuality —— 是否属于 CI 的 `quality` job 聚合步骤（`--ci-quality` 只跑这些项）。
 *                插件测试 / 资源冒烟 / 审计 / 变异各有独立 CI job，因此为 false。
 *
 * 为什么集中成一张表：让「检查项定义」与「机器可读声明」在同一屏内可直接对照。
 * ⚠️ 改任一 `run()` 的命令，必须同步本表与 `gate-registry.mjs`——否则 `gate-parity` 门禁会点名。
 * 本表的 key 集合与 CHECK_DEFS 的 id 集合由单测钉死（scripts/test/gate-parity.test.mjs），
 * 且每个 command 的关键可执行名必须出现在对应 `run()` 的源码里（防「声明一套、跑另一套」）。
 */
const CHECK_META = {
  audit: { command: 'npm audit --audit-level=moderate', ciQuality: false },
  mutation: { command: 'npx --no-install stryker run', ciQuality: false },
  test: { command: 'npm test（逐插件）', ciQuality: false },
  typecheck: { command: 'npx --no-install tsc --noEmit', ciQuality: true },
  'typecheck-plugins': { command: 'node scripts/typecheck-all.mjs', ciQuality: true },
  lint: { command: 'npx --no-install eslint plugins/', ciQuality: true },
  'ts-size': { command: 'node scripts/check-ts-size.mjs', ciQuality: true },
  'client-modules': { command: 'node scripts/check-client-modules.mjs', ciQuality: true },
  'client-size': { command: 'node scripts/check-client-size.mjs', ciQuality: true },
  'pack-hygiene': { command: 'node scripts/check-pack-hygiene.mjs', ciQuality: true },
  format: { command: 'npx --no-install prettier --check --ignore-unknown', ciQuality: true },
  'test-scripts': { command: 'npm run test:scripts', ciQuality: true },
  depcruise: { command: 'npx --no-install depcruise plugins/', ciQuality: true },
  knip: { command: 'npx --no-install knip', ciQuality: true },
  jscpd: { command: 'npx --no-install jscpd', ciQuality: true },
  docs: { command: 'node scripts/check-docs.mjs', ciQuality: true },
  // 文档-代码漂移门禁：docs/官方文档/本仓库重点.md 的 API 面是**从 plugins/*/src 取证**的
  // 派生内容，靠它双向守护（文档提到了代码没有的 API / 代码新增了 API 文档没登记）。
  'doc-api': { command: 'node scripts/check-doc-api-drift.mjs', ciQuality: true },
  links: { command: 'node scripts/check-links.mjs', ciQuality: true },
  'test-sleeps': { command: 'node scripts/check-test-sleeps.mjs', ciQuality: true },
  artifacts: { command: 'node scripts/check-client-artifacts.mjs', ciQuality: true },
  'merge-ref': { command: 'git merge-base --is-ancestor origin/main HEAD', ciQuality: false },
  'gate-parity': { command: 'node scripts/check-gate-parity.mjs', ciQuality: true },
  // issue #311：PR 审查的判定内核（三态判定 / 未能判定显式 / 抖动区分 / 历史摘要）必须有单测，
  // 且单测必须真的跑在门禁里——判定分支写错时靠它拦住（此前这些用例从没进过 CI）。
  'review-scripts': { command: 'node --test .github/scripts/*.test.cjs', ciQuality: true },
  // issue #324：两项都需要**完整历史**（gitleaks 扫全历史；commitlint 解析 base..head 两个历史 SHA），
  // 而 quality job 的 checkout 是浅克隆 → 它们由独立的 history-gates job 执行（fetch-depth: 0），
  // 故 ciQuality 为 false（与 test / resource-smoke 同理）。
  'secret-scan': { command: 'node scripts/check-secrets.mjs', ciQuality: false },
  commits: { command: 'node scripts/check-commit-messages.mjs', ciQuality: false },
  'resource-smoke': { command: 'node scripts/resource-smoke.mjs', ciQuality: false },
}

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
    // issue #330 + 工程效率规范第十四节「本地绿 ⇒ CI 绿」：CI 的 mutation job 是**阻断性**的，
    // 因此本地默认也跑。白名单只认「CI 专属环境/凭据」这类理由，**「本地慢」不是理由**
    // （唯一白名单项是 audit，见 gate-registry 的 LOCAL_EXEMPTIONS）。
    // 仅显式 `--fast`（快速通道）才跳过，并打印原因与未跑清单。
    id: 'mutation',
    label: 'mutation (npx stryker run @ dsh-file-activity)',
    note: 'issue #13：变异分 ≥70 才算测试有效。CI mutation job 阻断；本地默认执行（约 20s），--fast 才跳过',
    run: () => runCapture('npx', [...NPX_BASE_ARGS, 'stryker', 'run'], join(root, 'plugins', 'dsh-file-activity')),
    // 独占（issue #330 实测）：stryker **自己就会起多个 worker 吃满 CPU**，与并发池里的
    // eslint / prettier / test-scripts 叠加会超卖 → 实测在 `--full` 并发下失败、单独跑 11.9s 全绿
    // （典型资源争抢型 flaky）。「本地绿 ⇒ CI 绿」不允许 flaky，故把它排到并发池之后独占执行。
    // 代价：`--full` 墙钟 +约 12s；换取 pre-push 不再偶发红（一次 CI 往返约半小时）。
    exclusive: true,
    skip: (ctx) =>
      ctx.fast ? '快速通道（--fast，显式选择）：约 20s，CI mutation job 强制；本地等价全量用 npm run verify' : null,
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
    // issue #330 第 5 条修复：改前 verify-local 只跑根 tsc（根配置 exclude 了 src/client/**），
    // 于是「插件 client 端类型检查」本地零覆盖 —— 本地全绿、CI 红，白等一轮 CI。
    // 现在它是恒跑项（fast/full/CI 都跑），内部并发，本机 0.9~2.0s。
    id: 'typecheck-plugins',
    label: 'typecheck-plugins (node scripts/typecheck-all.mjs，18 插件的 server + client)',
    note: '唯一权威执行点是各插件自己的 tsconfig.json / tsconfig.client.json（构建语义），见 gate-registry',
    run: () => runCapture('node', ['scripts/typecheck-all.mjs'], root),
    // 只能靠 tsconfig / .ts 变更影响；但 tsconfig 变更属于「根工具链 → 安全退化全量」，
    // 纯文档变更时确无影响。除此之外恒跑（本地裁剪漏检正是本卡要根治的问题）。
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：类型检查只针对 .ts/.tsx' : null),
  },
  {
    id: 'lint',
    label: 'lint (npx eslint plugins/)',
    // issue #330：--fast 时按变更裁剪 scope（改前对「只改 1 个文件」的推送也要全量扫 9~15s）。
    // 安全性由三层保证：① 只有拿到变更证据才裁剪；② 无 .js/.mjs 变更时**跳过并打印原因**
    // （eslint 只检查 JS，插件源码未动、规则集未动 ⇒ 结果不可能变）；③ 规则集/根配置变更会
    // 触发安全退化全量（impact-scope 的根工具链集合含 eslint.config.js），CI 始终全量兜底。
    run: (ctx) => {
      const scoped =
        ctx.fast && !ctx.escalated && ctx.changedFiles !== null && ctx.changedFiles.length > 0
          ? ctx.changedFiles.filter((p) => /\.(c|m)?js$/.test(p) && existsSync(join(root, p)))
          : []
      if (scoped.length > 0) {
        ctx.report?.(`范围：本次变更 ${scoped.length} 个 .js/.mjs 文件（CI 仍全量兜底）`)
        return runCapture('npx', [...NPX_BASE_ARGS, 'eslint', ...scoped], root)
      }
      ctx.report?.('范围：全仓库（没有可裁剪的 .js/.mjs 变更文件，安全回退）')
      return runCapture('npx', [...NPX_BASE_ARGS, 'eslint', 'plugins/'], root)
    },
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：eslint 只检查 plugins/ 下源码'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      // 变更集为空（`--base` 指向 HEAD 等）：没有证据可裁剪 → 走全量，不跳过
      if (ctx.changedFiles.length === 0) return null
      const touched = ctx.changedFiles.some((f) => /\.(c|m)?js$/.test(f))
      return touched ? null : '本次变更不含 .js/.mjs 文件（eslint 只检查 JS 源码）'
    },
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
    id: 'client-modules',
    label: 'client-modules (node scripts/check-client-modules.mjs)',
    run: () => runCapture('node', ['scripts/check-client-modules.mjs'], root),
    // 只扫 plugins/*/lib/client.js 与 plugins/*/package.json：两者都没动就不可能失败
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：该门禁只扫客户端产物与插件 package.json'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.changedFiles.some(
        (f) => /^plugins\/[^/]+\/lib\/client\.js$/.test(f) || /^plugins\/[^/]+\/package\.json$/.test(f),
      )
      return touched ? null : '本次变更不含 plugins/*/lib/client.js 或 plugins/*/package.json'
    },
  },
  {
    id: 'client-size',
    label: 'client-size (node scripts/check-client-size.mjs)',
    run: () => runCapture('node', ['scripts/check-client-size.mjs'], root),
    // 只量「发布面」体积：插件 package.json（files 字段决定发布面）+ plugins/<name>/{lib,assets}/
    // 下的产物 + 门禁自己的基线文件。三者都没动时体积不可能变化（纯统计，无外部输入）。
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：该门禁只量插件发布面产物体积'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.changedFiles.some(
        (f) =>
          /^plugins\/[^/]+\/package\.json$/.test(f) ||
          /^plugins\/[^/]+\/(lib|assets)\//.test(f) ||
          f === 'scripts/client-size-baseline.json',
      )
      return touched ? null : '本次变更不含 plugins/*/{package.json,lib/**,assets/**} 或体积基线'
    },
  },
  {
    id: 'pack-hygiene',
    label: 'pack hygiene (node scripts/check-pack-hygiene.mjs)',
    note: 'issue #323 包发布卫生：exports/main/types/dsh.bundle.patch 指向真实文件、dsh.client 与 exports["./client"] 互证、npm pack 内容「该有的在 / 不该发的没在」、README 引用的 assets 确实随包发布（实测 19 插件 ~1.3s，含 19 次 npm pack，并发 6）',
    run: () => runCapture('node', ['scripts/check-pack-hygiene.mjs'], root),
    // 判据全部落在 plugins/<插件> 的包内容与 package.json 上：没有 plugins/ 变更就不可能失败
    skip: (ctx) => {
      if (ctx.docsOnly) return '纯文档变更：包发布卫生只与 plugins/ 下的包内容有关'
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.changedFiles.some((f) => f.startsWith('plugins/'))
      return touched ? null : '本次变更不含 plugins/（包发布卫生只与插件包内容有关）'
    },
  },
  {
    id: 'test-sleeps',
    label: 'fixed sleeps in tests (node scripts/check-test-sleeps.mjs)',
    note: 'issue #335 固定 sleep 门禁：plugins/*/test/** 里**新增**的固定时长等待（setTimeout(N>0)/settle(N)/sleep(N)）必须写 `// sleep-ok: <为什么不能用条件轮询>`，否则失败；存量冻结在 scripts/test-sleep-baseline.json（只允许变少）。判据与分类见 scripts/lib/test-sleeps.mjs 文件头（同族根因反复复发：CI 高负载下固定 sleep 赌异步必输）',
    run: () => runCapture('node', ['scripts/check-test-sleeps.mjs'], root),
    // 判据只落在 plugins/*/test/** 与基线文件上：没有测试变更就不可能失败
    skip: (ctx) => {
      if (!ctx.fast || ctx.escalated || ctx.changedFiles === null) return null
      const touched = ctx.changedFiles.some(
        (f) => /^plugins\/[^/]+\/test\//.test(f) || f === 'scripts/test-sleep-baseline.json',
      )
      return touched ? null : '本次变更不含 plugins/*/test/**（固定 sleep 门禁只扫描测试代码）'
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
      // 删除（D）的文件在工作区已不存在，显式传给 prettier 会 "No files matching the pattern" 假失败
      // ——这是 issue #188 把 D 纳入 diff-filter 之后才会出现的形态。过滤后一个不剩时回退全仓库，
      // 与「拿不到变更证据」走同一条安全路径（宁可多查，不可漏查）。
      const existing = scoped ? ctx.changedFiles.filter((p) => existsSync(join(root, p))) : []
      const paths = existing.length > 0 ? existing : ['.']
      ctx.report?.(
        existing.length > 0
          ? `范围：本次变更 ${paths.length} 个文件`
          : '范围：全仓库（没有可裁剪的变更文件，安全回退）',
      )
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
    // 独立 TMPDIR：该检查项内含「枚举 os.tmpdir() 判残留」的断言，与并发池里的 artifacts
    // 镜像会互相看见 → 假红（详见 runWithIsolatedTmp 的注释）。
    run: () =>
      runWithIsolatedTmp('test-scripts', (dir) =>
        runCapture('npm', ['run', 'test:scripts'], root, { env: isolatedTmpEnv(dir) }),
      ),
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
    id: 'secret-scan',
    label: 'secret-scan (node scripts/check-secrets.mjs：gitleaks 全历史)',
    note: 'issue #324：与 CI 同一个二进制（版本 + SHA256 钉死在 scripts/ci-tools.json，缓存 .gitleaks-cache/）。首次运行需下载，走 HTTPS_PROXY',
    // 与 CI 完全同一条命令。默认**要跑**（本地绿 ⇒ CI 绿）：拿不到二进制就是失败，
    // 错误信息给出出口（单次放行：--only secret-scan --allow-missing；或 --bin 手动指定）。
    run: () => runCapture('node', ['scripts/check-secrets.mjs'], root),
  },
  {
    id: 'commits',
    label: 'commits (node scripts/check-commit-messages.mjs：提交信息规范)',
    note: 'issue #324：只校验本次变更范围；规则同 .commitlintrc.json（与 .husky/commit-msg 同源）。范围自动推导（CI 读 GITHUB_EVENT_PATH；本地 @{upstream} → origin/main），可用 --commits-from <ref> 覆盖',
    run: () =>
      runCapture(
        'node',
        ['scripts/check-commit-messages.mjs', ...(options.commitsFrom ? ['--from', options.commitsFrom] : [])],
        root,
      ),
  },
  {
    id: 'docs',
    label: 'docs consistency (node scripts/check-docs.mjs)',
    run: () => runCapture('node', ['scripts/check-docs.mjs'], root),
  },
  {
    // 派生文档（docs/官方文档/本仓库重点.md）的 API 面双向守护：文档提到代码里不存在的
    // API（betterSidebar / ctx.config 两次真实事故）与代码新增 API 未登记，都必须变红。
    id: 'doc-api',
    label: 'doc-api drift (node scripts/check-doc-api-drift.mjs)',
    note: '文档-代码 API 漂移：同一 API 既要在文档声明又要在代码里真实存在；范例坐标校验文件存在 / 行号在范围内 / 文件含该 API（行号允许漂移）。<0.2s，纯本地文件检查，任何变更都跑',
    run: () => runCapture('node', ['scripts/check-doc-api-drift.mjs'], root),
  },
  {
    id: 'links',
    label: 'links integrity (node scripts/check-links.mjs)',
    note: '文档引用完整性：markdown 链接与锚点 / 残缺链接语法 / 路径 token / shell 调用 / npm script / skill 与插件名（<1s，纯本地文件检查，任何变更都跑）',
    run: () => runCapture('node', ['scripts/check-links.mjs'], root),
  },
  {
    // issue #330 关键交付物：本地检查项集合 ↔ CI 步骤集合的**双向**一致性校验。
    // 它自己也在 CI 跑——否则「校验覆盖一致性」这件事本身就成了新的静默缺口。
    id: 'gate-parity',
    label: 'gate-parity (node scripts/check-gate-parity.mjs)',
    note: '登记表 ↔ ci.yml ↔ 本文件的检查项/命令三方交叉校验；缺口逐条列出（含「跑了没声明」「声明了没跑」）',
    run: () => runCapture('node', ['scripts/check-gate-parity.mjs'], root),
  },
  {
    // issue #311：PR 审查的判定内核（通过 / 不通过 / 未能判定三态、抖动区分、历史摘要）
    // 由 .github/scripts/review-verdict.cjs 承担，这里跑它的单测——判定分支写错必须有人拦住。
    // 文件用 glob 动态发现（新增 test 文件自动纳入），避免"加了用例却没人跑"。
    id: 'review-scripts',
    label: 'review verdict kernel (node --test .github/scripts/*.test.cjs)',
    note: 'issue #311：三态判定（含超时/跳过/依赖不可用/无输出/未执行任何检查）与「同一 commit 结论一致 + 抖动只标注不翻转」的防回归单测',
    run: () => {
      const dir = join(root, '.github', 'scripts')
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.test.cjs'))
        .sort()
        .map((f) => join('.github', 'scripts', f))
      return runCapture('node', ['--test', ...files], root)
    },
    skip: (ctx) => (ctx.docsOnly ? '纯文档变更：审查判定逻辑与文档无关' : null),
  },
  {
    id: 'artifacts',
    label: 'client artifacts (node scripts/check-client-artifacts.mjs)',
    note: 'issue #318（ADR-0002）：消费 dsh-shared/client-parts/* 的插件重建 client bundle + 各插件 server tsc 产物，须与已提交产物逐字节一致（实测 10-12s 独占；纯本地）',
    // 独立 TMPDIR：它在 os.tmpdir() 建 HEAD 镜像，与 test-scripts 的全局枚举断言互相看见 → 假红。
    run: () =>
      runWithIsolatedTmp('artifacts', (dir) =>
        runCapture('node', ['scripts/check-client-artifacts.mjs'], root, { env: isolatedTmpEnv(dir) }),
      ),
    // 历史 race（issue #330 实测、issue #336 根治）：本门禁曾**原地重建工作区**
    // （`build.mjs` 逐个重写 `plugins/*/lib/parts/*.js` 再 `prettier --write`），与并发的
    // `format` 抢同一批文件 → 假红（实测：99 次采样中 2 次抓到未格式化的中间态）。
    // issue #336 把重建整体移进 `os.tmpdir` 的一次性 HEAD 镜像（`git archive HEAD`），
    // 门禁变为**只读**（`scripts/test/client-artifacts.test.mjs` 的「只读契约」用例钉死）。
    // 独立核实（issue #330）：806 次采样中 hash / mtime / inode **全部 0 变化** —— 因此
    // 它不再需要独占，回到并发池。`exclusive` 机制本身保留，供未来任何写工作区的检查项使用。
  },
  {
    // 工程效率规范第十四节：GitHub 在 pull_request 上 checkout 的是**合并结果**（你的分支 + 最新 main），
    // 而本地跑的是你自己的分支——该差异会让「本地过 ⇒ CI 过」天然不成立（#322 的 agent 就因此得出过
    // 「CI 与本地差 2.3KB」的错误结论，真因是它拿旧 base 在比）。这里把它**显式化为一条本地检查**。
    id: 'merge-ref',
    label: 'merge-ref (HEAD 是否已包含 origin/main)',
    note: '本地结论要能预测 CI 的 merge ref 结果，分支就必须先包含最新 origin/main（CI 侧天然是 merge ref，故不在 CI 跑）',
    run: () => {
      if (!refExists('origin/main')) {
        return { ok: true, summary: '无 origin/main（新 clone / 单分支环境），跳过 merge ref 一致性判定' }
      }
      if (spawnSyncGIT(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).ok) {
        return { ok: true, summary: 'HEAD 已包含本地已知的 origin/main（结论适用于 CI 的 merge ref）' }
      }
      return {
        ok: false,
        out:
          'HEAD 未包含 origin/main。\n' +
          '  GitHub PR 上 CI 测的是**合并结果**（你的分支 + 最新 main），本地测的是你自己的分支——\n' +
          '  两者可能不一致，本地绿不能预测 CI 绿。\n' +
          '  修法：git fetch origin main && git rebase origin/main（或 merge）后重跑。\n' +
          '  注：本检查只看**本地已知**的 origin/main，很久没 fetch 时请先 git fetch（本地校验不联网）。',
      }
    },
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
// CHECK_META 必须与 CHECK_DEFS 一一对应：`--list --json` 与 gate-parity 门禁都靠它，
// 少一条会让「该检查项在 CI 侧是否覆盖」变成盲区，多一条会让校验对着一个不存在的项比。
{
  const missing = CHECK_IDS.filter((id) => !CHECK_META[id])
  const extra = Object.keys(CHECK_META).filter((id) => !CHECK_IDS.includes(id))
  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `[verify] 内部错误：CHECK_META 与 CHECK_DEFS 不一致（缺 ${JSON.stringify(missing)}；多 ${JSON.stringify(extra)}）`,
    )
    process.exit(1)
  }
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
  if (options.json) {
    // 机器可读清单（issue #330）：供 scripts/check-gate-parity.mjs 与单测消费。
    // 走这条路径时不做任何检查、不读 git、不 spawn 子进程，可安全地被门禁脚本反复调用。
    const checks = CHECK_DEFS.map((c) => ({
      id: c.id,
      label: c.label,
      optional: Boolean(c.optional),
      ciQuality: Boolean(CHECK_META[c.id].ciQuality),
      command: CHECK_META[c.id].command,
    }))
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`)
    process.exit(0)
  }
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
  const r = await runCapture('npm', ['test'], dir, {
    label: `test ${name}（npm test @ plugins/${name}）`,
    // issue #418：限制每路 vitest 的 worker 数，使「插件并发 × 每路 worker ≈ 核数」
    env: { VITEST_MAX_WORKERS: String(vitestWorkersBudget()) },
  })
  return { name, ok: r.ok, out: r.out, error: r.error, stage: 'npm test', timedOut: r.timedOut, timeoutMs: r.timeoutMs }
}

/**
 * 疑似「多进程并发跑同一插件测试」的报错特征。
 * 依据 docs/踩坑/README.md：并发跑同一插件时两个 vitest 会争用该插件的
 * coverage/ 与临时目录，表现为 coverage 写入异常 / EACCES / ENOENT / EPERM，或带
 * testTimeout 的联网用例超时（dsh-my-guard 曾出现 5013ms 误报）。
 * 刻意保持保守：只有命中这些特征才触发「串行复测」，不做无条件重试，以免掩盖真实回归。
 */
// 判定逻辑抽到 lib/verify-flaky-classify.mjs（纯函数、可单测，见
// scripts/test/verify-flaky-classify.test.mjs）。issue #402 在那里补了「npm test 阶段的
// 纯断言失败也算疑似并发冲突」——旧正则只认 coverage/EACCES/超时特征，判不出
// 「等待预算与墙钟解耦」导致的假红（guardian 的 setImmediate 忙等、observability 的
// 固定 40ms sleep），于是跳过串行复测直接判红挡推送。

/** 「疑似并发冲突 → 串行复测」是否启用（首轮本就串行时无需复测）。 */
function serialRetryEnabled() {
  if (String(process.env.VERIFY_NO_RETRY ?? '') === '1') return false
  return pluginConcurrency() > 1
}

/**
 * 需要**排队尾**的插件测试（不与其它插件同时开工）。
 * dsh-my-guard 的黑名单扫描测试会真去 npm registry 解析包名（含一个 `testTimeout: 5000`
 * 的联网用例），与其他插件测试并发时曾出现 5013ms 超时误报。
 *
 * issue #188 把它从「并发池排空后的串行尾巴」改成「队列末尾」：原实现让 guard 的 ~6s 完全
 * 落在关键路径上（实测全量 --only test：池 25.4s + guard 6.5s = 31.9s）；排到队尾后它只在
 * 并发池出现空槽时启动，启动时前面的任务大多已结束（等同于旧语义里的「不要和其他插件同时
 * 开工」），但不再占用尾延迟。仍不把它塞进队列中间——那正是 5013ms 误报的原始形态。
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
  // 独占插件排在队尾（见 EXCLUSIVE_PLUGIN_TESTS 注释）：既不与其它插件同时开工，
  // 也不占用「池排空后」的额外尾延迟。
  // 注：曾实现过「按上轮耗时降序启动（最慢优先）」的 LPT 调度，实测无收益（28.0s → 28.7s）
  // ——把 6 个最重的插件同时塞进第一批会最大化 CPU 争用，反而整体变慢，故不采用。
  const ordered = [
    ...targets.filter((name) => !EXCLUSIVE_PLUGIN_TESTS.has(name)),
    ...targets.filter((name) => EXCLUSIVE_PLUGIN_TESTS.has(name)),
  ]
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
    const results = await runPool(ordered.map(makeTask), pluginConcurrency(), onDone)

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
 * 插件测试并发度（issue #188：默认 3 → 6；issue #418 起由核数 + load 自适应，6 是**上界**而非常量默认）。
 *
 * 为什么是 6、而不是更高（依据 = 本机 10 核实测，同一变更集、同一条命令
 * \`--only test --full\`）：
 *   · 并发 3（旧默认）38.0s → 并发 6 31.9s（省 6.1s）；
 *   · 并发 8 实测 32.3s——**没有收益**，且最慢的 dsh-file-activity 从 25.4s 变成 25.8s：
 *     瓶颈是「最慢单插件」而不是并发度，加进程只是把最慢的那个拖得更慢；
 *   · 更高并发在 issue #188 的原始实测里曾让 dsh-my-guard 的联网用例（test/host-guard.mjs，
 *     testTimeout 5s）劣化到单测试 930s；本脚本现已把 dsh-my-guard 放进 EXCLUSIVE_PLUGIN_TESTS
 *     独占运行，但上界仍钉在 6——加并发换不来收益，只会抬高联网用例与 CPU 争用的 flaky 风险。
 *
 * 各插件测试相互隔离（独立 node 进程 + 临时 DSH_HOME / port 0，无固定端口占用），但同一仓库里
 * 若**另有进程正在跑同一插件**的 vitest，会争用该插件的 coverage 目录
 * （见 docs/踩坑/README.md）——故保留 VERIFY_CONCURRENCY=1 手动串行降级。
 */
/**
 * 自适应并发的**单一来源**（issue #418）：所有取值都经 scripts/lib/verify-concurrency.mjs
 * 的纯函数 resolveConcurrency；本文件不再保留任何硬编码默认值（防绕过断言见单测）。
 * 结果按 kind 缓存 —— 横幅与执行器读同一份，避免重复解析与重复告警。
 */
const CONCURRENCY_DECISIONS = new Map()

function concurrencyFor(kind) {
  if (CONCURRENCY_DECISIONS.has(kind)) return CONCURRENCY_DECISIONS.get(kind)
  const envName = kind === 'plugin' ? 'VERIFY_CONCURRENCY' : 'VERIFY_CHECK_CONCURRENCY'
  let cpus = 0
  let load1 = 0
  try {
    cpus = availableParallelism()
    load1 = loadavg()[0]
  } catch {
    // 平台不支持（如 Windows 无 loadavg）→ 保持 0：不触发熔断，仅按核数推导
  }
  const decision = resolveConcurrency({ requested: process.env[envName], kind, cpus, load1 })
  // 非法显式值不静默：打印提示后回落自适应
  if (decision.invalidRequested !== undefined) {
    log(yellow(`⚠ ${envName}=${decision.invalidRequested} 非法（需 1..8 整数），已忽略并回落自适应`))
  }
  CONCURRENCY_DECISIONS.set(kind, decision)
  return decision
}

function pluginConcurrency() {
  return concurrencyFor('plugin').value
}

/**
 * 每路插件测试可用的 vitest worker 上限（issue #418）：把「插件并发 × 每路 worker」压到 ≈ 核数。
 * 实测：只把插件并发 6→5 时峰值 load 仍 42.09（≈5×9），故必须同时管住每路 worker。
 */
function vitestWorkersBudget() {
  const decision = concurrencyFor('plugin')
  return resolveVitestWorkers({ cpus: decision.cpus, concurrency: decision.value })
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
  log(dim('  排查文档：docs/踩坑/README.md'))
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

/**
 * 写 GitHub Actions job summary（issue #330）。
 *
 * 背景：CI quality job 改前是 12 个串行步骤，Actions 的步骤列表天然给出「哪一步红」；
 * 并发化后合并成**一个**步骤（`--ci-quality`），必须补回这个可定位性——硬约束要求
 * 「CI 里也要能在 job 摘要直接看出是哪一项红」。summary 表格列出每一项的结果与耗时，
 * 失败项置顶并单独点名；同时每项的完整输出仍在日志里按 `[verify] ❌ <label>` 分组打印。
 * summary 写失败（磁盘/权限）不影响门禁结论，只是少了一份可读报告。
 */
function writeJobSummary(results, totalMs) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath || results.length === 0) return
  const failed = results.filter((r) => !r.ok)
  const ordered = [...failed, ...results.filter((r) => r.ok)]
  const lines = [`## ${failed.length === 0 ? '✅' : '❌'} Quality gates：${results.length} 项 / ${secs(totalMs)}`, '']
  if (failed.length > 0) {
    lines.push(`**失败项**：${failed.map((f) => `\`${f.id}\``).join('、')}`, '')
    lines.push('复现单项：`node scripts/verify-local.mjs --only <id>`', '')
  }
  lines.push('| 检查项 | 结果 | 耗时 | 命令 |', '| --- | --- | --- | --- |')
  for (const r of ordered) {
    lines.push(`| \`${r.id}\` | ${r.ok ? '✅' : '❌'} | ${secs(r.ms)} | \`${CHECK_META[r.id]?.command ?? ''}\` |`)
  }
  lines.push('')
  try {
    appendFileSync(summaryPath, `${lines.join('\n')}\n`)
  } catch {
    /* summary 只是可读性增强，写不进去不影响门禁结论 */
  }
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
      // package.json 的字段级判定只在它真的出现在变更列表里时才去读 base 版本（多一次 git 调用）
      const pkgFields = changed.some((c) => c.path === 'package.json') ? packageJsonRuntimeFields(base.ref) : null
      impact = computeImpactScope(changed, {
        plugins: ALL_PLUGINS,
        dependentsOf,
        packageJsonRuntimeFields: pkgFields,
      })
      log(`  变更文件：${changed.length} 个`)
      const deleted = changed.filter((c) => c.status === 'D')
      if (deleted.length > 0) log(`  含删除文件：${deleted.length} 个（--diff-filter 已含 D，issue #188）`)
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
  // 提交信息门禁不再需要基准：scripts/check-commit-messages.mjs 自己推导范围（CI 读
  // GITHUB_EVENT_PATH，本地 @{upstream} → origin/main），需要时用 --commits-from <ref> 覆盖。
  // 历史上这里传过 baseRef，但 `base` 是本文件**后面**才声明的顶层 const，CHECK_DEFS 的 run 里
  // 直接引用会命中 TDZ（ReferenceError: Cannot access 'base' before initialization，实测踩过）。
  // changedFiles：变更文件的路径列表（保持既有语义：format / ts-size 等检查项直接消费）
  changedFiles: changed === null ? null : changed.map((c) => c.path),
  impactPlugins: impact.plugins,
  escalated: impact.escalated,
  docsOnly: impact.docsOnly || false,
  plugins: options.plugins,
  report: null,
}

// 选定要跑的项
const runList = (() => {
  if (options.only.length > 0) return CHECK_DEFS.filter((c) => options.only.includes(c.id))
  // --ci-quality：CI quality job 的执行体。只跑登记表里标记 ciQuality 的项——
  // 插件测试（test job matrix）、资源冒烟（resource-smoke job）、审计/变异（各独立 job）
  // 都不在这里重跑，否则就是把独立 job 的墙钟全加回 quality job。
  if (options.ciQuality) return CHECK_DEFS.filter((c) => CHECK_META[c.id].ciQuality)
  return CHECK_DEFS.filter(
    (c) => !c.optional || (c.id === 'audit' && options.audit) || (c.id === 'mutation' && options.mutation),
  )
})()

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
    exclusive: check.exclusive,
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
/**
 * 检查项并发度（issue #188 实测调优：full 模式 2 → 4；issue #330 把它同时定为 CI quality job 的并发度）。
 *
 * 为什么 full 模式也要提：full 时 12 项检查里有 10 项是「与插件测试无依赖」的独立检查
 * （typecheck/lint/format/test-scripts/knip/jscpd/docs/links/resource-smoke/ts-size），
 * 旧的 2 路并发里有一路被 test 项长期占住 → 其余 10 项实际**串行**（实测 34.3s），
 * 比插件测试本身（25.1s）还长，于是全量墙钟被它们顶到 36s。提到 4 路后它们与 test 项
 * 真正重叠，全量墙钟回落到由 test 项决定。
 *
 * 上界不取更高：插件测试内部已有 6 路并发（pluginConcurrency），10 核机器上再叠加会让
 * 最慢插件被 CPU 争用拖慢（实测并发 8 时 dsh-file-activity 25.4s → 25.8s）。
 *
 * issue #330 的 `--ci-quality` 用同一个默认值 4：CI runner（ubuntu-latest）是 4 核，
 * 这批检查项大多是单线程 Node 进程（eslint / prettier / tsc / knip），并发度超过核数
 * 只会让每个进程都变慢。实测（本机 10 核，`--ci-quality` 13 项）：并发 2 → 15.7s、
 * 4 → 10.7s、6 → 10.7s、8 → 11.2s——收益可忽略，
 * 而 4 路在 4 核 runner 上不会超卖，故把它作为**上界**。issue #418 起不再是固定值：
 * 默认按核数 + load 自适应（见 lib/verify-concurrency.mjs），需要时用 VERIFY_CHECK_CONCURRENCY 显式覆盖。
 */
function checkConcurrency() {
  return concurrencyFor('check').value
}
const CONCURRENCY = checkConcurrency()

log('')
log(
  options.ciQuality
    ? `CI quality job：并发执行 ${tasks.length} 项检查（${describeConcurrency('检查项', concurrencyFor('check'))}；插件测试/资源冒烟/审计/变异各由独立 job 覆盖）`
    : `开始校验：${tasks.length} 项${SKIPPED_BY_SCOPE_NOTE.size > 0 ? `，按范围跳过 ${SKIPPED_BY_SCOPE_NOTE.size} 项` : ''}${HARD_SKIPPED.filter((c) => c.optional).length > 0 ? `，默认跳过 ${HARD_SKIPPED.filter((c) => c.optional).length} 项（CI 强制）` : ''}（${describeConcurrency('检查项', concurrencyFor('check'))}，${describeConcurrency('插件测试', concurrencyFor('plugin'))} × 每路 vitest worker ${vitestWorkersBudget()}）`,
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

// 三阶段调度（issue #330 把「独占项」独立成一阶段）：
//   ① 并发池：互不依赖、且**不写工作区**的检查项
//   ② `after` 门控项：必须等插件测试结束的（depcruise —— 插件测试会生成/清理 coverage/ 目录）
//   ③ 独占项（`exclusive: true`）：需要**独占总有资源**的检查项，两类用途——
//      ① 会写工作区（历史上 artifacts 曾原地重建 `lib/parts/*.js`，现已被 #336 改为只读镜像）；
//      ② 自身就是重负载（mutation 的 stryker 会起多个 worker 吃满 CPU，与并发池叠加会超卖 → flaky）。
//      以下是历史上对 ① 的说明：
//      （artifacts 走各插件 build.mjs，
//      会重写 lib/parts/*.js 并 `prettier --write`），必须独占，否则并发的 format / lint /
//      depcruise 会扫到构建中间态而**假红**（实测证据见 CHECK_DEFS 里 artifacts 的注释）。
// `--ci-quality` 下插件测试由独立 job 承担、本 job 内没有 coverage 目录写入者，故 ② 为空。
const exclusiveTasks = tasks.filter((t) => t.exclusive)
const gated = options.ciQuality ? [] : tasks.filter((t) => !t.exclusive && t.after)
const free = tasks.filter((t) => !t.exclusive && (options.ciQuality ? true : !t.after))
const results = await runPool(free, CONCURRENCY, onTaskDone)
for (const task of [...gated, ...exclusiveTasks]) {
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
  log(
    options.ciQuality
      ? '以下检查项由独立 CI job 覆盖（不在本 job 内重复执行）：'
      : '注意：以下检查本地未跑，CI 会强制执行：',
  )
  for (const c of optionalSkipped) log(`  - ${c.label}（${c.note}）`)
}

log('')
log(`结果：${passed.length} 通过 / ${failed.length} 失败 / 总耗时 ${secs(totalMs)}`)
writeJobSummary(results, totalMs)
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
        `（见 docs/踩坑/README.md）→ 确认后重跑，或 VERIFY_CONCURRENCY=1 串行复测`,
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
  log('  --commits-from <ref>  commitlint 校验范围左端点（默认同 --base 的解析结果，回退 origin/main）')
  log('  --full          强制全量（覆盖 --fast）')
  log('  --ci-quality    CI quality job 的执行体：并发跑登记表中 ciQuality 的检查项 + 写 job summary')
  log('  --json          配合 --list 输出机器可读清单（供 scripts/check-gate-parity.mjs 校验）')
  log('  --only <id>     只跑单项（可重复；id 见下）')
  log('  --plugin <name> 只跑该插件的 test/--check（可重复）')
  log('  --timeout <sec> 覆盖整体超时上限（秒；none = 显式关闭）')
  log('  --audit         额外执行 npm audit（默认跳过：本地 registry 可能不支持 audit API）')
  log('  --mutation      额外执行 stryker 变异测试（默认跳过：约 20s）')
  log('  --list          列出检查项 id')
  log('  --help          显示本帮助')
  log('检查项: ' + CHECK_IDS.join(' / '))
  log('默认跳过（CI 强制，本地可显式开启）: ' + OPTIONAL_CHECKS.join(' / '))
  log('环境变量: VERIFY_CONCURRENCY=<1-8> 显式覆盖插件测试并发度（默认按核数+load 自适应，上界 6）')
  log('           VERIFY_CHECK_CONCURRENCY=<1-8> 显式覆盖检查项并发度（同样自适应，上界 4）')
  log(
    `           VERIFY_TIMEOUT=<秒> 整体超时上限（当前 ${totalTimeoutSec === 0 ? '已显式关闭' : `${totalTimeoutSec}s`}）`,
  )
  log(
    `           VERIFY_STEP_TIMEOUT=<秒> 单个子进程超时（当前 ${stepTimeoutSec === 0 ? '已显式关闭' : `${stepTimeoutSec}s`}）`,
  )
  log('           0 / 负数 / 空 / 非数字一律报错（fail-closed）；「无上限」只能显式写 none / off')
  log(
    '           VERIFY_NO_TIMEOUT=1 关闭整体墙钟上限（单步仍默认 120s）；VERIFY_NO_RETRY=1 关闭「并发冲突 → 串行复测」',
  )
  log('超时行为: 单步超时杀该步进程组并判该步失败；整体超时打印「卡在哪一步」后以退出码 124 结束')
}
