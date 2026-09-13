#!/usr/bin/env node
/**
 * Release automation for one or more plugins in this repo (batch + parallel supported).
 *
 *   node scripts/release.mjs <plugin-name> [<plugin-name>...] [--bump patch|minor|major] [--push]
 *        [--concurrency N] [--all-checks] [--skip-real-verify --skip-reason "<理由>"]
 *
 * issue #246（发版速度专项）把本脚本从「严格串行」改成「流水线」，门禁一条都没少：
 *   1. 同一插件内互不依赖的门禁并发执行——每条失败都带门禁编号，汇总按门禁编号
 *      （1a→1b-pre→1b→1c→2→3→3c→3b）重排，「首个失败门禁」与串行版同口径；
 *      每个门禁都必须通过，判定权没有交给调度器；
 *   2. 批量发版的多个插件流水线并发（--concurrency，默认 3；单插件恒为 1，行为与串行版一致）；
 *   3. tag 全部创建后一次性推送，再并发等待全部 Release/npm（N × ~55s → ~55s）；
 *   4. 结束打印各阶段实测耗时表；失败时给出失败点与断点续跑提示。
 * 并发**不改变失败语义**：任一插件任一子门禁失败 → 该插件失败 → exit 1（fail-closed）。
 * 代价（诚实记录）：并发后早期门禁失败时，已启动的重门禁仍需跑完才退出——不能 kill，
 * scripts/verify-real-profile.mjs 没有信号清理，强杀会残留隔离实例与临时目录。
 * 静态门禁（1b/1c/2）失败不受影响：它们跑完才启动 3c，仍是最快的失败路径（实测 ~6ms 即拦下）。
 *
 * --all-checks（仅 dry-run，issue #227）：静态门禁（peer / 跨插件依赖 / CHANGELOG /
 * 测试 / README 效果图）全部跑完再统一报告失败项，避免 fail-fast 让后续门禁
 * 「从未执行」而掩盖缺陷。默认（含 --push）仍是首个失败即停。
 *
 * Steps (dry-run by default; --push performs git commit + tag + push):
 *   1.  validate plugins/<name> exists and package.json version parses
 *   1b. validate peerDependencies.cordis declared and consistent across plugins
 *   1b-pre. 形态判定：agent preset 资产包 dsh.kind=preset 豁免（issue #231，lib/preset-gate.mjs）
 *   1c. cross-plugin dependency check (issue #39): client require('dsh-*') must
 *       be declared in peerDependencies; in-repo dsh-* deps published + tagged
 *   2.  validate CHANGELOG.md has a "## [<version>]" section at the top
 *   3.  run the plugin's tests (npm test)
 *   3b. validate README screenshot references under assets/
 *   3c. real-environment verification (issue #39 + #67): verify-real-profile.mjs
 *       --addons plugins/<name> --checklist verification/<name>-<version>.md
 *       (local only; CI auto-skips; --skip-real-verify requires --skip-reason),
 *       then gate on the functional checklist being fully checked (issue #67)
 *   4.  sync the version in root README.md plugin table and AGENTS.md
 *   5.  --push: commit doc sync, tag <name>@v<version> for all plugins, push tags in
 *       one round trip (triggers the release workflow), then verify Release + npm
 *       for all tags concurrently
 *
 * Batch mode (multiple plugins):
 *   - Each plugin is validated independently (one failure doesn't block others)
 *   - All valid plugins are committed together, then tags are created and pushed
 *   - Failure report lists all failed plugins at the end
 *
 * Exit codes: 0 ok, 1 validation/test failure (nothing changed), 2 usage error.
 */
import { spawn, execSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractDshRequires,
  findUndeclaredPeers,
  findUnpublishedDeps,
  collectClientSources,
  collectServerSources,
  buildPluginIndex,
  findFreePorts,
  versionGte,
  rangeMin,
  isNpmNotFound,
  inspectTagState,
  tagConflictHint,
} from './lib/release-checks.mjs'
import { verifyPostRelease } from './lib/post-release.mjs'
import { checkScreenshotGate } from './lib/screenshot-gate.mjs'
import { resolvePresetAsset } from './lib/preset-gate.mjs'
import { createTimeline } from './lib/release-timing.mjs'
import { mapWithConcurrency, normalizeConcurrency, DEFAULT_CONCURRENCY } from './lib/release-concurrency.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
// Batch mode: 收集插件名（flag 与其取值都要跳过）
// 注意：`--bump <type>` / `--skip-reason <理由>` 的取值不以 `--` 开头，
// 若直接 `filter(!a.startsWith('--'))` 会把取值误当成插件名——实测批量发版
// 报 `✗ plugins/patch does not exist`（`--bump patch` 的 patch 被当成插件）。
const VALUE_FLAGS = new Set(['--bump', '--skip-reason', '--concurrency'])
const names = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg.startsWith('--')) {
    if (VALUE_FLAGS.has(arg)) i += 1 // 跳过该 flag 的取值
    continue
  }
  names.push(arg)
}
const push = args.includes('--push')
// --all-checks：静态门禁失败项收集模式（仅 dry-run）。fail-fast 会让"首个失败"
// 掩盖后续门禁从未执行的事实（issue #227 就是依赖门禁掩盖效果图门禁）。
const allChecks = args.includes('--all-checks')
const skipRealVerify = args.includes('--skip-real-verify')
const skipReasonIdx = args.indexOf('--skip-reason')
const skipReason = skipReasonIdx >= 0 ? args[skipReasonIdx + 1] || '' : ''
const bumpIdx = args.indexOf('--bump')
const bump = bumpIdx >= 0 ? args[bumpIdx + 1] || '' : ''
const concurrencyIdx = args.indexOf('--concurrency')
const concurrencyRaw = concurrencyIdx >= 0 ? args[concurrencyIdx + 1] : undefined
const BUMP_TYPES = new Set(['patch', 'minor', 'major'])

/**
 * Escape a user-supplied string for safe use inside a RegExp constructor.
 * `name` comes from the command line and must never alter the match grammar.
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── 用法校验（退出码 2）────────────────────────────────────────────────────
// 约定：用法错误 = 2，环境/仓库错误 = 1；**用法校验全部前移到环境校验之前**。
// 否则参数写错时会先撞上环境错误，报错指向错的地方（PR #248 实测教训：
// 用法校验被环境校验挡住，让人以为是仓库状态问题）。
if (names.length === 0) {
  console.error(
    'usage: node scripts/release.mjs <plugin-name> [<plugin-name>...] [--bump patch|minor|major] [--push] [--all-checks] [--concurrency N]',
  )
  process.exit(2)
}
for (const name of names) {
  // name 会拼入多个 shell 命令（git tag --list / git log / git add 等），
  // 严格校验字符集（CodeQL js/shell-command-injection-from-environment）。
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    console.error(`✗ 非法插件名: ${name}（仅允许 [a-zA-Z0-9._-] 且首字符为字母/数字）`)
    process.exit(2)
  }
}
if (bump !== '' && !BUMP_TYPES.has(bump)) {
  console.error(`✗ --bump 必须是 patch | minor | major，收到: ${bump}`)
  process.exit(2)
}
if (push && allChecks) {
  console.error('✗ --all-checks 只用于 dry-run 静态门禁全景；发布必须走 fail-fast 完整门禁（含真实环境验证）')
  process.exit(2)
}
// --skip-real-verify / --skip-reason 是参数配对约束（用法），不是仓库状态：
// 前移到任何插件处理之前拦截，避免「先跑了半部门禁才报参数错」。
if (skipRealVerify && skipReason === '') {
  console.error('✗ --skip-real-verify 必须带 --skip-reason "<理由>" 显式记录跳过原因（issue #67）')
  process.exit(2)
}

// ── 环境校验（退出码 1）────────────────────────────────────────────────────
for (const name of names) {
  if (!existsSync(join(root, 'plugins', name))) {
    console.error(`✗ plugins/${name} does not exist`)
    process.exit(1)
  }
}

/** 并发度：单插件恒为 1；非法取值回落默认值（性能开关不参与放行判定）。 */
const batchConcurrency = normalizeConcurrency(concurrencyRaw, names.length)

// ── 子进程执行 ──────────────────────────────────────────────────────────────
/**
 * 运行子进程并按行转发输出（可加来源前缀），返回 `{ code, stdout, stderr }`。
 *
 * 取代原来的 `execSync(..., { stdio: 'inherit' })`：门禁并发后必须能区分输出来源
 * （批量模式下还要区分是哪个插件），且失败不再抛异常——异常会让「已启动的其它门禁」
 * 变成孤儿（见文件头「代价」说明）。stdout/stderr 同时被捕获，供调用方判定 404/限流。
 *
 * @param {string} command
 * @param {string[]} argv
 * @param {{cwd?: string, prefix?: string, quiet?: boolean}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runChild(command, argv, options = {}) {
  const { cwd = root, prefix = '', quiet = false } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err?.message ?? err) })
      return
    }
    const captured = { stdout: '', stderr: '' }
    const forward = (stream, key) => {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        captured[key] += chunk
        if (quiet) return
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) process.stdout.write(`${prefix}${line}\n`)
      })
      stream.on('end', () => {
        if (pending !== '') {
          process.stdout.write(`${prefix}${pending}\n`)
          pending = ''
        }
      })
    }
    forward(child.stdout, 'stdout')
    forward(child.stderr, 'stderr')
    // error 与 close 都可能触发：用 settled 保证只 resolve 一次。
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.on('error', (err) =>
      finish({
        code: -1,
        stdout: captured.stdout,
        stderr: `${captured.stderr}${err.message}`,
      }),
    )
    child.on('close', (code) =>
      finish({
        code: code ?? -1,
        stdout: captured.stdout,
        stderr: captured.stderr,
      }),
    )
  })
}

/** 子进程失败的简短归因（取 stderr 首行，没有则取 stdout 首行）。 */
const failureLine = (result) => String(result.stderr || result.stdout || '').split('\n')[0]

// ── 门禁实现（每个门禁一个函数，返回 { ok, message } 而不是直接退出）──────────
/**
 * 1a. 语义 gate（plugin-release 增量）：stable 版本发布前查 npm latest 防降级。
 * 当前版本低于 npm 已发布 latest 时拒绝发布（防止 latest 回退到更低版本）；
 * 首次发布（404）跳过；查询失败（网络/限流）只警告不阻断。
 */
async function npmLatestGate(name, pkg, version, say) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { ok: true }
  const result = await runChild('npm', ['view', pkg.name, 'dist-tags.latest'], {
    quiet: true,
  })
  if (result.code === 0) {
    const latest = result.stdout.trim().split('\n').pop()
    if (latest && !versionGte(version, latest)) {
      return {
        ok: false,
        message: `${name} 版本 ${version} 低于 npm latest ${latest} — 拒绝发布（防止 latest 回退，plugin-release 语义 gate）`,
      }
    }
    say(`✓ npm latest ${latest} ≤ 当前版本 ${version}（无降级）`)
    return { ok: true }
  }
  if (isNpmNotFound(result.stderr)) {
    say(`- ${pkg.name} 尚未发布到 npm（首次发布，跳过 latest 防降级检查）`)
  } else {
    say(`- npm latest 查询失败（${failureLine(result)}）— 跳过防降级检查`)
  }
  return { ok: true }
}

/** 3. 插件测试（npm test）。返回 ok/message，不抛异常。 */
async function testsGate(pluginDir, prefix) {
  const result = await runChild('npm', ['test'], { cwd: pluginDir, prefix })
  if (result.code !== 0) return { ok: false, message: 'tests failed — fix before releasing' }
  return { ok: true }
}

/**
 * 1c 依赖发布状态预热：把仓库内依赖的 `npm view` 并发跑完，再交给纯函数
 * `findUnpublishedDeps` 做同步判定——判定规则一字未改，只是把原来「每个依赖
 * 一次同步 execFileSync」（实测单次 0.3–2.5s）并发化。
 */
async function prefetchNpmVersions(deps) {
  const settled = await mapWithConcurrency(deps, Math.min(4, DEFAULT_CONCURRENCY + 1), async (dep) => {
    const result = await runChild('npm', ['view', dep, 'version'], {
      quiet: true,
    })
    if (result.code === 0)
      return [
        dep,
        {
          version: result.stdout.trim().split('\n').pop() ?? '',
          notFound: false,
        },
      ]
    return [dep, { version: '', notFound: isNpmNotFound(result.stderr) }]
  })
  const map = new Map()
  for (const item of settled) {
    if (item.status === 'fulfilled') map.set(item.value[0], item.value[1])
  }
  return map
}

/**
 * 3c. 真实环境验证（issue #39 + #67）：发版前必须跑 verify-real-profile.mjs
 * --addons（真实 DSH 实例 + 配置组合检查），失败即阻断；验证通过后校验
 * 「发版前功能级验证清单」功能级项全部勾选，未全勾选即阻断发版。
 * port 由批量调度预分配（issue #246：并行实例必须各占一个端口）。
 */
async function realVerifyGate(name, version, port, prefix) {
  const checklistPath = join(root, 'verification', `${name}-${version}.md`)
  const verify = await runChild(
    process.execPath,
    [
      'scripts/verify-real-profile.mjs',
      '--addons',
      `plugins/${name}`,
      '--port',
      String(port),
      '--checklist',
      checklistPath,
      '--plugin',
      name,
      '--version',
      version,
    ],
    { cwd: root, prefix },
  )
  if (verify.code !== 0) {
    return {
      ok: false,
      message: '真实环境验证失败 — 发版阻断。请先修复插件加载/配置问题，再重新发版',
    }
  }
  const check = await runChild(process.execPath, ['scripts/verify-real-profile.mjs', '--check', checklistPath], {
    cwd: root,
    prefix,
  })
  if (check.code !== 0) {
    return {
      ok: false,
      message:
        '功能级验证清单未全部勾选 — 发版阻断（issue #67）。请在隔离实例 + 真实浏览器中完成功能级验证后勾选清单，再重新发版',
    }
  }
  return { ok: true }
}

/**
 * 处理单个插件：门禁并发执行、按门禁编号顺序结算（issue #246）。
 *
 * @param {string} name 插件目录名
 * @param {{port: number, prefix: string}} ctx 调度上下文
 * @returns {Promise<object>} 与串行版同形的结果对象，额外带 timeline / failedGate
 */
async function processPlugin(name, ctx) {
  const { prefix } = ctx
  const say = (msg = '') => console.log(`${prefix}${msg}`)
  const timeline = createTimeline()

  say('')
  say('='.repeat(60))
  say(`Processing plugin: ${name}`)
  say('='.repeat(60))

  const pluginDir = join(root, 'plugins', name)
  const pkgPath = join(pluginDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let bumped = false
  let version = pkg.version

  // 静态门禁失败收集（issue #227）：默认模式首个失败即停（行为不变）；
  // --all-checks 记录失败后继续跑其余可独立判定的门禁，最后统一报告。
  const gate = { failures: [] }
  /**
   * 门禁失败登记（issue #246）：执行是并发的，但每条失败都带**门禁编号**，
   * 汇总时按门禁编号重排——「哪个门禁挡下的」永远可追溯，不因并发而含糊。
   */
  const gateFail = (gateId, msg) => {
    console.error(`${prefix}✗ [${gateId}] ${msg}`)
    gate.failures.push({ gate: gateId, message: msg })
  }
  /**
   * 构造失败结果：`failedGate` 取**门禁编号顺序**上最早失败的那个（不是最早 settle 的），
   * 与串行版的「首个失败即停」报告口径一致。
   */
  const fail = (ordered = []) => ({
    ok: false,
    name,
    version,
    bumped,
    changed: false,
    failures: gate.failures,
    failedGate: ordered.find(([, ok]) => !ok)?.[0] ?? gate.failures[0]?.gate ?? null,
    timeline,
  })
  /** 结算一个并发门禁：成功返回 true，失败按门禁编号登记。 */
  const settle = (gateId, outcome) => {
    if (outcome.ok) return true
    gateFail(gateId, outcome.message)
    return false
  }

  // version 会拼入 git tag/push 命令，先严格校验（CodeQL
  // js/shell-command-injection-from-environment；bump 生成的 next 必为 x.y.z）
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`✗ invalid version in plugins/${name}/package.json: ${version}`)
    return fail()
  }

  // 0. --bump：自动升级版本 + 生成 CHANGELOG 段（提交信息从 git log 提取）
  if (bump !== '') {
    const [maj, min, pat] = version.split('.').map(Number)
    const next =
      bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
    // 最近一个 <name>@v* tag（按版本倒序），用于提取自上次发版以来的提交
    const tags = execSync(`git tag --list "${name}@v*" --sort=-v:refname`, {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
    const prevTag = tags[0] || null
    let logLines = []
    if (prevTag) {
      logLines = execSync(`git log ${prevTag}..HEAD --oneline -- plugins/${name}/`, {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    }
    if (logLines.length === 0) {
      console.error(`✗ --bump 需要至少一个自上次 tag（${prevTag ?? '无'}）以来的提交（git log 为空）`)
      return fail()
    }
    const date = new Date().toISOString().slice(0, 10)
    const section = [
      `## [${next}] - ${date}`,
      '',
      '### 变更',
      '',
      ...logLines.map((l) => `- ${l.replace(/^\w+\s+/, '')}`),
      '',
    ].join('\n')
    const changelogPath = join(pluginDir, 'CHANGELOG.md')
    const changelog = readFileSync(changelogPath, 'utf8')
    const idx = changelog.indexOf('## [')
    writeFileSync(changelogPath, changelog.slice(0, idx) + section + '\n' + changelog.slice(idx))
    pkg.version = next
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    version = next
    bumped = true
    say(`✓ --bump ${bump}: ${prevTag ?? '(无 tag)'} → ${next}（CHANGELOG 已生成 ${logLines.length} 条提交记录）`)
  }

  // 1. version from package.json
  say(`✓ plugin ${name} version ${version}`)

  // 1b-pre. 形态判定（issue #231）：agent preset 资产包（显式 dsh.kind=preset + 真实
  // agent.cordis.yml/preset.yml）不挂 profile、无 cordis.patch.yml——peerDependencies.cordis
  // 与 profile 组合验证对它都不适用（判据与仓库不变量见 lib/preset-gate.mjs，
  // 单测 scripts/test/preset-gate.test.mjs）。声明不合法时按准确原因报错，不叠加误报。
  const presetAsset = resolvePresetAsset({
    pkg,
    readAsset: (file) => {
      const p = join(pluginDir, file)
      return existsSync(p) ? readFileSync(p, 'utf8') : null
    },
  })
  const isPreset = presetAsset.status === 'declared'
  const shapeOk = presetAsset.problem === null
  if (!shapeOk) {
    gateFail('1b-pre', `${name}/package.json ${presetAsset.problem}`)
    if (!allChecks) return fail()
  }

  // 1b. peer dependencies: DSH 插件必须声明 cordis peer（npm 分发后缺失会导致
  // dsh plugin add 安装失败），且 cordis major 与仓库内其他插件保持一致。
  const peers = pkg.peerDependencies || {}
  // 共享工具包（如 dsh-shared）不是 DSH 插件：不挂载 cordis service，无
  // peerDependencies.cordis 是正常的——用 package.json 的 dsh.kind=library
  // 显式标记豁免 cordis peer 检查（其余检查照旧）。
  const isLibrary = pkg.dsh?.kind === 'library'
  const cordisPeer = peers.cordis
  let peerOk = true
  if (!shapeOk) {
    // 形态声明本身不合法：上面已按准确原因报错，不再叠加「缺少 peerDependencies.cordis」误报
  } else if (isPreset) {
    say(`- ${presetAsset.reason}：豁免 peerDependencies.cordis 检查（不挂 profile、无 cordis.patch.yml）`)
  } else if (isLibrary) {
    say('- 共享工具包（dsh.kind=library）豁免 peerDependencies.cordis 检查（非 DSH 插件）')
  } else if (cordisPeer === undefined) {
    gateFail('1b', `${name}/package.json 缺少 peerDependencies.cordis（DSH 插件必须声明）`)
    peerOk = false
  } else if (!String(cordisPeer).match(/^[\^~]?(\d+)/)?.[1]) {
    gateFail('1b', `${name}/package.json peerDependencies.cordis 无法解析 major 版本: ${cordisPeer}`)
    peerOk = false
  } else {
    const cordisMajor = String(cordisPeer).match(/^[\^~]?(\d+)/)[1]
    const mismatched = []
    for (const entry of readdirSync(join(root, 'plugins'))) {
      if (entry === name || !existsSync(join(root, 'plugins', entry, 'package.json'))) continue
      const other = JSON.parse(readFileSync(join(root, 'plugins', entry, 'package.json'), 'utf8'))
      const otherMajor = String(other.peerDependencies?.cordis ?? '').match(/^[\^~]?(\d+)/)?.[1]
      if (otherMajor && otherMajor !== cordisMajor) mismatched.push(`${entry} (cordis ^${otherMajor})`)
    }
    if (mismatched.length > 0) {
      gateFail('1b', `${name} peerDependencies.cordis ^${cordisMajor} 与以下插件不一致: ${mismatched.join(', ')}`)
      peerOk = false
    } else {
      say(`✓ peerDependencies.cordis ^${cordisMajor} 已声明且与其他插件一致`)
    }
  }

  // 1c. 跨插件依赖校验（issue #39 + #72）：client/server 端 require('dsh-*') 必须声明
  // （peerDependencies 或 dependencies）；仓库内 dsh-* 依赖必须已发布且已打 tag
  // （依赖先发版）。issue #72：扫描范围覆盖 server 端 import（dsh-shared 是 server 端
  // 运行时依赖，原先只扫 client 端漏检）；声明检查覆盖 dependencies（dsh-shared 从
  // peerDependencies 移到 dependencies 后由 npm 自动安装）。
  const clientSources = collectClientSources(pluginDir)
  const serverSources = collectServerSources(pluginDir)
  const allSources = [...clientSources, ...serverSources]
  const requires = extractDshRequires(allSources.map((f) => readFileSync(f, 'utf8')).join('\n'))
  const declared = {
    ...(pkg.peerDependencies || {}),
    ...(pkg.dependencies || {}),
  }
  const undeclared = findUndeclaredPeers(requires, declared)
  let depOk = true
  if (undeclared.length > 0) {
    gateFail('1c', `源码 require 了以下 dsh-* 包但未在 peerDependencies/dependencies 声明: ${undeclared.join(', ')}`)
    console.error(
      `  修复: 在 plugins/${name}/package.json 的 peerDependencies 或 dependencies 中声明（如 "dsh-shared": "^0.1.0"）`,
    )
    depOk = false
  }
  if (requires.length > 0) say(`✓ 跨插件依赖已声明: ${requires.join(', ')}`)

  const pluginIndex = buildPluginIndex(root)
  // 仓库内 library 依赖（dsh.kind=library，如 dsh-shared）：运行时 import 的共享工具包，
  // npm 未发布 = 依赖方安装失败，必须确认 npm 发布成功才放行（不允许 tag 兜底）。
  const isLibraryDep = (dir) => {
    try {
      const otherPkg = JSON.parse(readFileSync(join(root, 'plugins', dir, 'package.json'), 'utf8'))
      return otherPkg.dsh?.kind === 'library'
    } catch {
      return false
    }
  }
  const isTagged = (dir, depVersion) => {
    try {
      // CodeQL js/shell-command-injection-from-environment 修复：dir/version 来自
      // peerDependencies 键（外部输入），execFileSync 参数数组不经过 shell
      execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${dir}@v${depVersion}`], { cwd: root })
      return true
    } catch {
      return false
    }
  }
  // 仓库内依赖的 npm 发布状态并发预热（issue #246；判定规则见 findUnpublishedDeps）
  const inRepoDeps = Object.keys(declared).filter((d) => pluginIndex.has(d))
  const npmVersions = depOk
    ? await timeline.phase('1c 仓库内依赖 npm 查询', () => prefetchNpmVersions(inRepoDeps))
    : new Map()
  const isPublished = (dep, range) => {
    const min = rangeMin(range)
    if (!min) return false
    const cached = npmVersions.get(dep)
    if (cached === undefined) return false
    // npm view 成功：版本满足范围即通过
    if (!cached.notFound && cached.version) return versionGte(cached.version, min)
    // 404（npm 从未发布）→ 必须阻断：依赖方安装/运行必然失败（issue #72）。
    if (cached.notFound) return false
    // 429 限流等临时错误：仓库内依赖（pluginIndex）认可「已打 tag」——
    // tag push 必触发 Release workflow，GitHub Release 为仓库主交付物（issue #12）；
    // npm 发布失败不阻塞依赖顺序校验（发布后可手动重试）。
    const entry = pluginIndex.get(dep)
    if (entry !== undefined && isTagged(entry.dir, entry.version)) {
      // 但 library 依赖（dsh.kind=library）是运行时 import 的共享工具包：
      // npm 未发布 = 依赖方安装失败，必须确认 npm 发布成功才放行（issue #72）。
      if (isLibraryDep(entry.dir)) return false
      return true
    }
    return false
  }
  const depProblems = findUnpublishedDeps(declared, pluginIndex, isPublished, isTagged)
  if (depProblems.length > 0) {
    for (const p of depProblems) gateFail('1c', p.reason)
    console.error('  修复: 先发版依赖包（node scripts/release.mjs <依赖目录> --push），再发本插件')
    depOk = false
  }
  if (inRepoDeps.length > 0 && depOk) {
    say(`✓ 仓库内 dsh-* 依赖均已发布且已打 tag（发布顺序正确）: ${inRepoDeps.join(', ')}`)
  }

  // 2. CHANGELOG section
  const changelog = readFileSync(join(pluginDir, 'CHANGELOG.md'), 'utf8')
  let changelogOk = true
  if (!changelog.includes(`## [${version}]`)) {
    gateFail('2', `CHANGELOG.md has no "## [${version}]" section`)
    changelogOk = false
  } else {
    say(`✓ CHANGELOG has [${version}] section`)
  }

  // 3b. README 效果图校验：发版前必须引用真实截图（见效果图规范）。
  // 判定抽到 scripts/lib/screenshot-gate.mjs（issue #227）：支持 ./assets/<file> 与
  // unpkg 绝对 URL，文件必须真实存在；无用户可见 UI 的插件按**显式声明**豁免
  // （dsh.kind=library 或 dsh.ui=false + 非空 dsh.uiReason），豁免结果显式打印——
  // 不写插件名单、不悄悄放行（判据单测见 scripts/test/screenshot-gate.test.mjs）。
  const plugReadmePath = join(pluginDir, 'README.md')
  const gateResult = checkScreenshotGate({
    name,
    pkg,
    readme: existsSync(plugReadmePath) ? readFileSync(plugReadmePath, 'utf8') : null,
    assetExists: (file) => existsSync(join(pluginDir, 'assets', file)),
  })
  const screenshotOk = gateResult.status !== 'fail'
  if (!screenshotOk) {
    gateFail('3b', gateResult.detail)
  } else if (gateResult.status === 'exempt') {
    say(`- ${gateResult.detail}`)
  } else {
    say(`✓ ${gateResult.detail}`)
  }

  /**
   * 门禁编号顺序（= 串行版的报告顺序）：并发只改「执行」，不改「谁先挡住」的判定口径。
   * 快速失败路径用 orderedStatic（此时 1a/3/3c 根本还没启动），完整路径用 orderedFull。
   */
  const orderedStatic = [
    ['1b-pre', shapeOk],
    ['1b', peerOk],
    ['1c', depOk],
    ['2', changelogOk],
    ['3b', screenshotOk],
  ]

  // ── 3c 计划（纯决策，无 IO）──────────────────────────────────────────────
  // 「静态门禁 → 才启动重门禁」这个次序是快速失败路径的关键：静态门禁只要 ~6ms
  // （有仓库内依赖时 ~0.5s）就能拦下最常见的失败，失败时**一个隔离实例都不会起**，
  // 失败代价与串行版持平；一旦通过，1a/3/3c 全部并发启动，成功路径 ≈ max(三者)。
  const staticBlocked = !shapeOk || !peerOk || !depOk || !changelogOk || !screenshotOk
  const skipReal = skipRealVerify || process.env.GITHUB_ACTIONS === 'true' || process.env.DSH_SKIP_REAL_VERIFY === '1'
  let realPlan = { mode: 'skip', note: '' }
  if (allChecks) {
    // --all-checks 只做静态门禁全景：真实环境验证需要隔离实例 + 功能级清单勾选，
    // 属动态门禁，不在此模式执行（发布路径仍走完整 fail-fast 门禁）。
    realPlan = {
      mode: 'skip',
      note: '--all-checks：静态门禁全景模式，不做动态验证',
    }
  } else if (staticBlocked) {
    realPlan = { mode: 'skip', note: '静态门禁未通过：不启动隔离实例' }
  } else if (skipReal) {
    // --skip-real-verify 必须配 --skip-reason：已在参数校验阶段前移拦截（退出码 2）
    realPlan = {
      mode: 'skip',
      note: skipRealVerify ? `--skip-reason: ${skipReason}` : 'CI / DSH_SKIP_REAL_VERIFY',
    }
  } else if (isLibrary || isPreset) {
    // library 包（dsh.kind=library，如 dsh-shared）不是 profile bundle：无插件行、
    // 无 client，verify-real-profile --addons 的 bundle 组合校验不适用。
    // 验证职责已由测试门禁（单测/覆盖率/eslint 全绿）覆盖；npm pack 内容
    // 由 release.yml 的 CI 校验（files 清单 + exports 可解析）。
    realPlan = {
      mode: 'skip',
      note: isPreset
        ? `${presetAsset.reason}：跳过 profile 组合验证（--addons 只适用于有 dsh.profile/cordis.patch.yml 的 bundle 插件）`
        : '共享工具包（dsh.kind=library）非 bundle 插件：跳过 profile 组合验证（--addons 不适用）',
    }
  } else {
    realPlan = { mode: 'run', note: '' }
  }

  // 快速失败路径（与串行版等价）：静态门禁已失败且不是 --all-checks → 一个重门禁都不启动。
  if (gate.failures.length > 0 && !allChecks) return fail(orderedStatic)

  // ── 并发启动「重」门禁（issue #246）────────────────────────────────────────
  // 1a（npm 查询 0.3–2.5s）/ 3（插件测试 0.8–8.8s）/ 3c（真实验证 ~10s）互不依赖。
  // 三者都必须在返回前 await 完：提前 return 会让 3c 的隔离实例与临时目录变成孤儿
  // （verify-real-profile 没有信号清理，强杀会残留实例，比多等几秒更糟）。
  say(`- 并发门禁：1a npm latest 防降级 + 3 插件测试${realPlan.mode === 'run' ? ' + 3c 真实环境验证' : ''}…`)
  const npmLatestPromise = timeline.phase('1a npm latest 防降级', () => npmLatestGate(name, pkg, version, say))
  const testsPromise = timeline.phase('3 插件测试 (npm test)', () => testsGate(pluginDir, `${prefix}    `))
  let realVerifyPromise = null
  if (realPlan.mode === 'run') {
    say(`- 真实环境验证（verify-real-profile.mjs --addons plugins/${name} --port ${ctx.port}）…`)
    realVerifyPromise = timeline.phase('3c 真实环境验证（隔离实例）', () =>
      realVerifyGate(name, version, ctx.port, `${prefix}  `),
    )
  }

  const npmLatest = await npmLatestPromise
  const tests = await testsPromise
  const realVerify = realVerifyPromise === null ? null : await realVerifyPromise

  const okNpmLatest = settle('1a', npmLatest)
  const okTests = settle('3', tests)
  const okRealVerify = realVerify === null ? true : settle('3c', realVerify)
  if (realPlan.note !== '') say(`- 跳过真实环境验证（${realPlan.note}）`)

  const ordered = [
    ['1a', okNpmLatest],
    ['1b-pre', shapeOk],
    ['1b', peerOk],
    ['1c', depOk],
    ['2', changelogOk],
    ['3', okTests],
    ['3c', okRealVerify],
    ['3b', screenshotOk],
  ]
  if (gate.failures.length > 0) {
    // 任一模式都不写仓库文件：--all-checks 只报告失败项（便于一次看全），
    // 默认模式则是「首个失败即停」的等价结果（失败之前没有任何写操作）。
    return fail(ordered)
  }

  // 4. sync versions in root README.md and AGENTS.md
  const readmePath = join(root, 'README.md')
  const agentsPath = join(root, 'AGENTS.md')
  let readme = readFileSync(readmePath, 'utf8')
  let agents = readFileSync(agentsPath, 'utf8')
  let changed = false

  // README plugin table: | [<name>](plugins/<name>/README.md) | <old> | ...
  // 注意：表格对齐会产生多个空格（`README.md)   | 0.1.0 |`），用 [^|]* 容忍。
  const readmeRe = new RegExp(
    `(\\| \\[${escapeRegExp(name)}\\]\\(plugins/${escapeRegExp(name)}/README\\.md\\)[^|]*\\| ?)\\d+\\.\\d+\\.\\d+( ?\\|)`,
  )
  if (readmeRe.test(readme)) {
    const next = readme.replace(readmeRe, `$1${version}$2`)
    if (next !== readme) {
      readme = next
      changed = true
      say(`✓ README.md version synced to ${version}`)
    } else {
      say(`- README.md already at ${version}`)
    }
  } else {
    say(`- README.md: no row for ${name} (add it manually if new)`)
  }

  // AGENTS.md: "<name> v<old>" in the 版本 line
  const agentsRe = new RegExp(`(${escapeRegExp(name)} v)\\d+\\.\\d+\\.\\d+`)
  if (agentsRe.test(agents)) {
    const next = agents.replace(agentsRe, `$1${version}`)
    if (next !== agents) {
      agents = next
      changed = true
      say(`✓ AGENTS.md version synced to ${version}`)
    } else {
      say(`- AGENTS.md already at ${version}`)
    }
  } else {
    say(`- AGENTS.md: no "${name} v…" found (add it manually if new)`)
  }

  if (changed) {
    writeFileSync(readmePath, readme)
    writeFileSync(agentsPath, agents)
  }

  return {
    ok: true,
    name,
    version,
    bumped,
    changed,
    pkgName: pkg.name,
    failedGate: null,
    timeline,
    // 效果图豁免留痕（issue #227）：发版汇总显式列出「已豁免」插件与理由。
    screenshotExemption: gateResult.status === 'exempt' ? gateResult.exemption : null,
    // preset 形态豁免留痕（issue #231）：1b cordis peer 与 profile 组合验证的豁免理由，
    // 同样在批量汇总显式列出，不悄悄放行。
    presetExemption: isPreset ? { reason: presetAsset.reason } : null,
  }
}

// ── Main batch processing ──────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Batch release mode: processing ${names.length} plugin(s)`)
console.log(`Plugins: ${names.join(', ')}`)
console.log(`Bump: ${bump || '(none — dry-run)'}`)
console.log(`Push: ${push ? 'yes' : 'no'}`)
console.log(`并发度: ${batchConcurrency}${names.length > 1 ? '（--concurrency N 可覆盖；默认 3）' : '（单插件）'}`)
console.log(`${'='.repeat(60)}`)

const results = []
const succeeded = []
const failed = []
const batchStart = Date.now()

// 端口预分配（issue #246）：并行实例必须各占一个端口。原来每个插件内部各自
// `findFreePort(3087)` —— 串行时不会撞，一并行就会同时拿到同一个端口。
const ports = await findFreePorts(3087, names.length)

// 批量流水线：最多 batchConcurrency 个插件同时在跑（每个插件内部再并发门禁）。
// 失败语义不变：所有插件都会跑完，失败的照样列进汇总，任一失败 → exit 1。
const outcomes = await mapWithConcurrency(names, batchConcurrency, (name, index) =>
  processPlugin(name, {
    port: ports[index] ?? ports[0],
    prefix: names.length > 1 ? `[${name}] ` : '',
  }),
)

for (const [index, outcome] of outcomes.entries()) {
  const name = names[index]
  if (outcome.status === 'rejected') {
    const message = outcome.reason?.message ?? String(outcome.reason)
    console.error(`✗ ${name}: unexpected error — ${message}`)
    failed.push({
      ok: false,
      name,
      version: 'unknown',
      bumped: false,
      changed: false,
      failures: [message],
      failedGate: '内部错误',
    })
    continue
  }
  results.push(outcome.value)
  if (outcome.value.ok) succeeded.push(outcome.value)
  else failed.push(outcome.value)
}

// ── Push flow (batch) ──────────────────────────────────────────────────────
if (push && succeeded.length > 0) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Pushing ${succeeded.length} successful plugin(s)`)
  console.log(`${'='.repeat(60)}`)

  // Collect all files to commit
  const filesToCommit = new Set(['README.md', 'AGENTS.md'])
  const commitMessages = []

  for (const result of succeeded) {
    const name = result.name
    const version = result.version
    if (result.bumped) {
      filesToCommit.add(`plugins/${name}/package.json`)
      filesToCommit.add(`plugins/${name}/CHANGELOG.md`)
      commitMessages.push(`chore(release): ${name} v${version}（自动 bump ${bump} + CHANGELOG 生成）`)
    } else {
      commitMessages.push(`docs: 同步 ${name} 版本号至 ${version}（发版）`)
    }
  }

  // Stage all files
  const files = [...filesToCommit].join(' ')
  execSync(`git add ${files}`, { cwd: root, stdio: 'inherit' })

  // Create commit
  // commitlint 限制 header ≤ 100 字符：批量发版时插件清单必须放 body，
  // 不能 join 进 header —— 原先 12 个插件即 242 字符，commit 被 commitlint
  // 以 header-max-length 拦下，导致整个批量发版在最后一步失败（实测踩到：
  // 版本已 bump、CHANGELOG 已生成，但 commit/tag/push 全部未执行）。
  const header = succeeded.length === 1 ? commitMessages[0] : `chore(release): 批量发版 ${succeeded.length} 个插件`
  const body = succeeded.map((r) => `- ${r.name}@${r.version}`).join('\n')
  const commitArgs = succeeded.length === 1 ? ['commit', '-m', header] : ['commit', '-m', header, '-m', body]
  // 待提交内容可能为空：例如版本与文档同步已落在先前的提交里（--bump 已跑过、
  // 或手工/钩子把 bump 一并提交）。此时 `git commit` 会以 "nothing to commit"
  // 失败并中断整个发版流程（tag/push 都不会执行），所以先检测再提交。
  const stagedNames = execSync('git diff --cached --name-only', {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (stagedNames === '') {
    console.log('- 无待提交变更（版本/文档已同步），跳过 commit')
  } else {
    execFileSync('git', commitArgs, { cwd: root, stdio: 'inherit' })
  }

  // Push main
  execSync('git push origin main', { cwd: root, stdio: 'inherit' })
  console.log(`✓ committed and pushed: ${header}`)

  // ── Tag 流水线（issue #246）─────────────────────────────────────────────
  // 串行版是「打一个 tag → 推一个 tag → 立刻等这个 tag 的 Release（~55s）→ 下一个」，
  // N 个插件 = N × ~55s 的纯等待。现在拆成三段流水线：
  //   ① 全部 tag 先创建（含 tag 管理防护，冲突即停，绝不自动 force）
  //   ② 一次性推送全部 tag（一次网络往返；tag 推送本身触发各自的 workflow）
  //   ③ 并发等待全部 Release/npm，最后统一报告
  const tagTargets = []
  for (const result of succeeded) {
    const name = result.name
    const version = result.version
    const tag = `${name}@v${version}`
    // Tag 管理防护（事故：release commit 已推 main 但 tag 缺失/指向旧 commit）：
    // 打 tag 前先检查 refs/tags/<tag> 是否存在——
    //   不存在           → 正常打 tag；
    //   存在且指向 HEAD  → 跳过打 tag（仅推送，幂等重试）；
    //   存在但指向其他 commit → 明确报错并给出手动处理选项，绝不自动 force
    //   （删除/覆盖 tag 属破坏性操作，由人确认后手动执行）。
    // 判定逻辑抽到 lib（inspectTagState）以便三分支单测覆盖：
    // scripts/test/release-checks.test.mjs「inspectTagState（tag 管理防护）」。
    const tagState = inspectTagState(root, tag)
    if (tagState.state === 'absent') {
      // CodeQL js/shell-command-injection-from-environment：tag 由外部输入
      // （name/version）拼接，execFileSync 参数数组不经过 shell。
      execFileSync('git', ['tag', tag], { cwd: root, stdio: 'inherit' })
    } else if (tagState.state === 'same-head') {
      console.log(`- tag ${tag} 已存在且指向当前 HEAD——跳过打 tag（仅推送，幂等重试）`)
    } else {
      console.error(
        `✗ tag ${tag} 已存在但指向 ${tagState.tagSha.slice(0, 7)}（当前 HEAD 为 ${tagState.headSha.slice(0, 7)}），拒绝覆盖。`,
      )
      for (const line of tagConflictHint(tag)) console.error(line)
      process.exit(1)
    }
    tagTargets.push({ tag, name, version, pkgName: result.pkgName })
  }

  console.log(`\n推送 ${tagTargets.length} 个 tag（一次网络往返；origin = GitHub）…`)
  const pushTags = await runChild('git', ['push', 'origin', ...tagTargets.map((t) => t.tag)], { cwd: root })
  if (pushTags.code !== 0) {
    // fail-closed：tag 没推上去 = 发版没发生，绝不当作成功继续。
    console.error('✗ tag 推送失败 — 发版未完成（fail-closed，不继续等待 Release）')
    process.exit(1)
  }
  for (const target of tagTargets) {
    // origin = GitHub（唯一远程）。tag 推上去后由 GitHub Actions 接手发版：
    // .github/workflows/release.yml（校验 → npm pack → 建 Release；带 NPM_TOKEN 时发布 npm）。
    console.log(`✓ tag ${target.tag} pushed → origin（GitHub）：GitHub Actions 接手发版`)
  }
  console.log('  watch: https://github.com/baosfeng/my-dsh-plugins/actions')

  // 6. 发版后校验（issue #36 + #246）：N 个 tag 的 Release/npm 等待并发执行
  // （每个 tag 的 Release workflow 在 GitHub 侧本来就是并行的，串行等待纯属浪费）。
  const postResults = await mapWithConcurrency(tagTargets, Math.min(tagTargets.length, DEFAULT_CONCURRENCY), (target) =>
    verifyPostRelease(target.pkgName, target.name, target.version),
  )
  let postFailed = false
  for (const [index, item] of postResults.entries()) {
    const target = tagTargets[index]
    if (item.status === 'rejected') {
      console.error(`✗ ${target.tag} 发版后校验异常 — ${item.reason?.message ?? item.reason}`)
      postFailed = true
      continue
    }
    for (const line of item.value.lines) {
      if (line.level === 'error') console.error(line.text)
      else if (line.level === 'warn') console.warn(line.text)
      else console.log(line.text)
    }
    if (!item.value.ok) postFailed = true
  }
  if (postFailed) process.exit(1)
} else if (!push) {
  console.log('\n(dry run — pass --push to commit, tag and push)')
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log('Batch release summary')
console.log(`${'='.repeat(60)}`)
console.log(`Total plugins: ${names.length}`)
console.log(`Succeeded: ${succeeded.length}`)
console.log(`Failed: ${failed.length}`)

// README 效果图门禁豁免留痕（issue #227）：无 UI 产物而显式豁免的插件在此列出，
// 避免「悄悄放行」——理由来自 package.json 的 dsh.uiReason / dsh.kind=library。
const exempted = results.filter((result) => result.screenshotExemption)
if (exempted.length > 0) {
  console.log('\nREADME 效果图门禁已豁免（显式声明无 UI 产物）:')
  for (const result of exempted) {
    console.log(`  - ${result.name}: ${result.screenshotExemption.reason}`)
  }
}

// agent preset 资产包形态豁免留痕（issue #231）：豁免理由来自 package.json 的
// dsh.presetReason——非 bundle 形态不适用 1b cordis peer 与 profile 组合验证。
const presetExempted = results.filter((result) => result.presetExemption)
if (presetExempted.length > 0) {
  console.log('\nagent preset 资产包形态豁免（1b peerDependencies.cordis + profile 组合验证）:')
  for (const result of presetExempted) {
    console.log(`  - ${result.name}: ${result.presetExemption.reason}`)
  }
}

if (failed.length > 0) {
  console.log('\nFailed plugins:')
  for (const result of failed) {
    console.log(`  ✗ ${result.name} (version: ${result.version})`)
    if (result.failedGate) console.log(`      失败点: ${result.failedGate}`)
    // --all-checks：统一列出该插件的全部门禁失败项（不 fail-fast 掩盖后续门禁）；
    // 每条都带门禁编号——并发执行也不丢「谁挡下的」。
    for (const [index, failure] of (result.failures ?? []).entries()) {
      const label = typeof failure === 'string' ? failure : `[${failure.gate}] ${failure.message}`
      console.log(`      ${index + 1}. ${label}`)
    }
  }
}

// ── 阶段耗时表（issue #246）────────────────────────────────────────────────
// 发版是「一串阶段」：把每段实测耗时打出来，慢在哪、失败点之前白跑了多少一目了然。
// 每个插件一张表（并发阶段的耗时之和 > 墙钟合计，属正常）。
const timed = results.filter((result) => result.timeline)
if (timed.length > 0) {
  console.log('\n阶段耗时（issue #246；并发阶段耗时之和大于墙钟合计，属正常）')
  for (const result of timed) {
    console.log('')
    console.log(result.timeline.format(`— ${result.name}@${result.version} —`))
  }
  if (timed.length > 1) {
    console.log('')
    console.log(`批量墙钟合计: ${Date.now() - batchStart} ms（${names.length} 个插件，并发度 ${batchConcurrency}）`)
  }
}

if (failed.length > 0) {
  console.log('\n断点续跑提示:')
  console.log('  · 门禁失败时仓库文件未被修改；修好失败项后原样重跑即可')
  console.log('  · 若 package.json 版本已高于最近 tag（存在未发布的 bump），重跑请去掉 --bump，否则会二次升版')
  console.log('  · --push 中断后重跑：tag 侧有 same-head 幂等防护，已推的 tag 不会被重复推送')
  process.exit(1)
}

console.log('\n✓ All plugins processed successfully')
process.exit(0)
