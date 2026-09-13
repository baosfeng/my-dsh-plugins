#!/usr/bin/env node
/**
 * fork-pool.mjs — fork 池一条命令化（issue #240）。
 *
 *   node scripts/fork-pool.mjs create <编号> [--branch <名>] [--base main] [--dir <路径>]
 *                                  [--node-modules symlink|copy|none] [--no-hooks] [--json]
 *   node scripts/fork-pool.mjs check  <编号|路径> [--static] [--json]
 *   node scripts/fork-pool.mjs clean  <编号|路径> --yes [--json]
 *   node scripts/fork-pool.mjs list [--json]
 *
 * 为什么要脚本化（issue #240 的实测依据）：
 *   · 手工 5 步（fetch/merge → clone --local → set-url → fetch → checkout -b）每次子任务都要重敲，
 *     本仓库已发生几十次；且 node_modules 就位过去靠 `for … ln -s` 外壳循环，实测 3657ms，
 *     换成 Node 内建 fs.symlinkSync 只要 29ms（同样的"逐包软链 + 可写目录真实化"语义）。
 *   · 更要命的是**隐性前置缺失**：clone --local 不复制 .git/config，主工作区的
 *     `core.hooksPath=.husky/_` 带不进来；`.husky/_/` 又被自身 .gitignore 挡住。
 *     于是 fork 内 commit/push **完全不跑 pre-commit / pre-push**，本地门禁空转，
 *     错误直接漏到 CI（PR #239 的 prettier 红盘）。本脚本默认把 hooks 装回去。
 *
 * 与 skills/dsh-github-triage/SKILL.md 的手工 5 步完全等价（手工步骤保留为该 skill 的兜底），
 * 差异只有三点：① 多一步基线 SHA 校验；② node_modules 用 Node 逐包软链；③ 默认装 hooks。
 *
 * 退出码：0 成功；1 参数/前置/校验失败；2 需要显式确认（如 clean 缺 --yes）。
 *
 * ⚠️ **测试与覆盖边界（别误以为 CI 覆盖了 create）**：
 *   `scripts/test/fork-pool.test.mjs` 覆盖的是**纯函数契约**与**离线 CLI 路径**
 *   （list / clean 的安全护栏与幂等 / 参数错误 / 前置失败的可诊断性）。
 *   `create` 依赖 GitHub 网络（`fetch` + `ls-remote`），**不在 CI 里跑** ——
 *   它有真实环境的手测记录（八步全绿 3.3s，见 docs/开发指南/工程效率规范.md），
 *   但那是手测，不是回归保障。改动 create 时请务必手工走一遍。
 *
 *   网络不可达时的行为（实测）：第 3 步 `git fetch origin <base>` 立即失败（388ms），
 *   脚本打印**该步的 git 原始输出**与代理排查提示后以退出码 1 中断；
 *   已生成的半个 fork 目录会保留供排查，`clean <编号> --yes` 可清理。
 *   **基线校验绝不跳过**（宁可失败，也不基于来源不明的基线起分支）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REQUIRED_TOOLS,
  WRITABLE_NODE_MODULES_ENTRIES,
  branchNameFor,
  buildCheckItems,
  evaluateBaseline,
  forkDirFor,
  formatMs,
  isSafeToClean,
  isValidForkId,
  normalizePath,
  parseForkPoolArgs,
  parseOwnerRepo,
  fetchRemoteFor,
  pushRemoteFor,
  planCreateSteps,
  renderCheckReport,
  resolveTargetDir,
} from './lib/fork-pool.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const options = parseForkPoolArgs(args)
if (options.errors.length > 0) {
  for (const err of options.errors) console.error(`✖ ${err}`)
  console.error('用法：node scripts/fork-pool.mjs <create|check|clean|list> [参数]（--help 看全集）')
  process.exit(1)
}

const TMP_ROOT = process.env.FORK_POOL_TMP ?? '/tmp'
const log = (text = '') => process.stdout.write(`${text}\n`)

/** 跑一条命令并计时；默认继承 stdio 之外全捕获（便于在 JSON 模式里回放证据）。 */
function run(cmd, cmdArgs, { cwd = root, quiet = true, inherit = false } = {}) {
  const started = performance.now()
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 180_000,
  })
  const ms = performance.now() - started
  const out = inherit ? '' : `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (!quiet && out) log(`    ${out.split('\n').slice(-2).join('\n    ')}`)
  return { code: result.status ?? 1, out, ms }
}

const git = (dir, gitArgs, opts = {}) => run('git', ['-C', dir, ...gitArgs], opts)

/** 取"值"型 git 查询：失败一律返回空串，避免把 fatal 信息当成值渲染出去。 */
const gitOut = (dir, gitArgs) => {
  const res = git(dir, gitArgs)
  return res.code === 0 ? res.out : ''
}

/** 分支上报 ①：只读远程（走 https+代理）。失败返回空串，由调用方判定。 */
function remoteHeadSha(repoDir, base) {
  const url = gitOut(repoDir, ['remote', 'get-url', 'origin'])
  const parsed = parseOwnerRepo(url)
  if (!parsed) return ''
  const ref = `refs/heads/${base}`
  const res = run('git', ['ls-remote', fetchRemoteFor(parsed.owner, parsed.repo), ref], { cwd: repoDir })
  return res.code === 0 ? (res.out.split(/\s+/)[0] ?? '') : ''
}

/**
 * node_modules 就位。默认逐包软链：既不像整体软链那样让并行 agent 争用同一份 .vite/.cache，
 * 也不像 cp -Rc 那样克隆 619MB（实测 4164ms）。
 */
function provisionNodeModules(sourceNm, targetNm, mode) {
  if (!existsSync(sourceNm)) return { ok: false, detail: `主工作区 node_modules 不存在：${sourceNm}` }
  if (mode === 'none') return { ok: true, detail: '按 --node-modules none 跳过' }
  if (mode === 'copy') {
    const res = run('cp', ['-Rc', sourceNm, targetNm])
    if (res.code === 0) return { ok: true, detail: `APFS clonefile 全量克隆（${formatMs(res.ms)}）` }
    return { ok: false, detail: `cp -Rc 失败（${res.out}）——改用 --node-modules symlink` }
  }
  mkdirSync(targetNm, { recursive: true })
  let links = 0
  let dirs = 0
  for (const entry of readdirSync(sourceNm, { withFileTypes: true })) {
    const dst = join(targetNm, entry.name)
    if (existsSync(dst)) continue
    if (WRITABLE_NODE_MODULES_ENTRIES.includes(entry.name)) {
      mkdirSync(dst, { recursive: true })
      dirs += 1
    } else {
      try {
        symlinkSync(join(sourceNm, entry.name), dst)
        links += 1
      } catch {
        /* 个别条目并发创建时已存在：忽略即可，语义不变 */
      }
    }
  }
  return { ok: true, detail: `逐包软链 ${links} 项 + ${dirs} 个可写真实目录` }
}

/** 装回 hooks。根因见文件头：clone 不带 config，husky 的 _ 目录又被 gitignore。 */
function installHooks(forkDir) {
  const huskyBin = join(forkDir, 'node_modules', '.bin', 'husky')
  if (!existsSync(huskyBin)) {
    return { ok: false, detail: 'fork 内没有 node_modules/.bin/husky（用 create 时别加 --node-modules none）' }
  }
  const res = run(huskyBin, [], { cwd: forkDir })
  const hooksPath = gitOut(forkDir, ['config', '--get', 'core.hooksPath'])
  const wired = hooksPath === '.husky/_' && existsSync(join(forkDir, '.husky', '_'))
  if (!wired) {
    return {
      ok: false,
      detail: `husky 执行了但挂载判定未通过（exit ${res.code}，core.hooksPath=${hooksPath || '未设置'}）`,
    }
  }
  return { ok: true, detail: `core.hooksPath=${hooksPath}（pre-commit / pre-push 已生效）` }
}

/** 防误提交：node_modules 是符号链接，.gitignore 的 `node_modules/` 规则**不匹配软链**。 */
function ensureExclude(forkDir) {
  const excludeFile = join(forkDir, '.git', 'info', 'exclude')
  const current = existsSync(excludeFile) ? execFileSync('cat', [excludeFile], { encoding: 'utf8' }) : ''
  if (current.split('\n').includes('node_modules')) return { ok: true, detail: '已包含 node_modules' }
  try {
    writeFileSync(excludeFile, `${current.replace(/\n?$/, '\n')}node_modules\n`)
    return { ok: true, detail: '已写入 node_modules（防 git add -A 误提交软链）' }
  } catch (error) {
    return { ok: false, detail: `写入失败：${error.message}` }
  }
}

function cmdCreate() {
  if (!isValidForkId(options.id)) {
    console.error(`✖ 非法 fork 编号：${options.id}`)
    process.exit(1)
  }
  const forkDir = options.dir ? normalizePath(options.dir) : forkDirFor(options.id, TMP_ROOT)
  const branch = branchNameFor(options.id, options.branch)
  const mainWorkdir = resolve(process.env.FORK_POOL_MAIN ?? root)
  if (existsSync(forkDir)) {
    console.error(`✖ 目录已存在：${forkDir}（先 node scripts/fork-pool.mjs clean ${options.id} --yes，或换编号）`)
    process.exit(1)
  }
  const ownerRepo = parseOwnerRepo(gitOut(mainWorkdir, ['remote', 'get-url', 'origin']))
  if (!ownerRepo) {
    console.error('✖ 无法从主工作区 origin 解析 owner/repo（先确认 git remote -v）')
    process.exit(1)
  }
  const steps = planCreateSteps({ hooks: options.hooks, nodeModules: options.nodeModules })
  const timings = {}
  const total = performance.now()
  log(`fork 池创建 → ${forkDir}（分支 ${branch}，基线 ${options.baseRef}）`)

  const record = (id, res, ok, detail) => {
    timings[id] = Math.round(res?.ms ?? 0)
    log(
      `  ${ok ? '✔' : '✖'} ${steps.find((s) => s.id === id)?.label ?? id} ${detail ? `— ${detail}` : ''} ${res ? `(${formatMs(res.ms)})` : ''}`,
    )
    if (!ok) {
      // 失败必须可诊断：把该步的**原始输出**贴出来。
      // 补验时发现的缺口：断网只会打印「✖ 拉取远端基线」，用户无从判断是代理挂了、
      // 分支名写错、还是仓库权限问题 —— 于是掉头去查别的地方。
      const raw = String(res?.out ?? '').trim()
      if (raw) {
        console.error('  原始输出（末 5 行）：')
        for (const line of raw.split('\n').slice(-5)) console.error(`    ${line}`)
      }
      if (id === 'fetch' || id === 'baseline') {
        console.error('  这两步需要网络（https + 代理）。排查：`ghops proxy` / `gh-net check`。')
        console.error('  离线时无法创建 fork —— 基线校验必须比对远端 SHA，脚本不会跳过它。')
      }
      console.error('\n✖ 创建中断。已生成的目录可保留排查，或 clean 后重试。')
      process.exit(1)
    }
  }

  record('clone', run('git', ['clone', '--local', '--quiet', mainWorkdir, forkDir]), true)
  const remoteStep = (() => {
    const started = performance.now()
    const a = git(forkDir, ['remote', 'set-url', 'origin', fetchRemoteFor(ownerRepo.owner, ownerRepo.repo)])
    const b = git(forkDir, ['config', 'remote.origin.pushurl', pushRemoteFor(ownerRepo.owner, ownerRepo.repo)])
    return { code: a.code || b.code, ms: performance.now() - started, out: `${a.out}${b.out}` }
  })()
  record('remote', remoteStep, remoteStep.code === 0)
  const fetchStep = git(forkDir, ['fetch', '--quiet', 'origin', options.base])
  record('fetch', fetchStep, fetchStep.code === 0)

  const baselineStep = { ms: 0 }
  const startedAt = performance.now()
  const forkSha = gitOut(forkDir, ['rev-parse', options.baseRef])
  const remoteSha = remoteHeadSha(forkDir, options.base)
  baselineStep.ms = performance.now() - startedAt
  const baseline = evaluateBaseline(forkSha, remoteSha)
  record('baseline', baselineStep, baseline.ok, baseline.reason)

  record('branch', git(forkDir, ['checkout', '--quiet', '-b', branch, options.baseRef]), true)
  record('exclude', ensureExclude(forkDir), true)

  if (steps.some((s) => s.id === 'node_modules')) {
    const started = performance.now()
    const nm = provisionNodeModules(
      join(mainWorkdir, 'node_modules'),
      join(forkDir, 'node_modules'),
      options.nodeModules,
    )
    record('node_modules', { ms: performance.now() - started }, nm.ok, nm.detail)
  }
  if (options.hooks) {
    const started = performance.now()
    const hooks = installHooks(forkDir)
    record('hooks', { ms: performance.now() - started }, hooks.ok, hooks.detail)
  }

  const totalMs = Math.round(performance.now() - total)
  log(`\n✅ fork 就位（共 ${formatMs(totalMs)}）：${forkDir}`)
  log(
    `   下一步：cd ${forkDir} && git status${options.hooks ? '（hooks 已生效，提交会自动校验）' : '（⚠ 未装 hooks，提交不会跑本地门禁）'}`,
  )
  log(`   推送前自检：node scripts/fork-pool.mjs check ${options.id}（或在本 fork 内直接跑）`)
  if (options.json)
    log(JSON.stringify({ ok: true, forkDir, branch, base: options.baseRef, timingsMs: timings, totalMs }, null, 2))
}

/** 工具链探针：本地校验要用的可执行文件是否都在（见 lib 里 REQUIRED_TOOLS 的注释）。 */
function probeToolchain(forkDir) {
  const binDir = join(forkDir, 'node_modules', '.bin')
  const missing = REQUIRED_TOOLS.filter((tool) => !existsSync(join(binDir, tool)))
  return { ok: missing.length === 0 && existsSync(binDir), missing }
}

function cmdCheck() {
  const forkDir = resolveTargetDir(options.id, TMP_ROOT, options.dir)
  const forkExists = existsSync(forkDir)
  if (!forkExists) {
    console.error(`✖ fork 目录不存在：${forkDir}`)
    process.exit(1)
  }
  const hooksPath = gitOut(forkDir, ['config', '--get', 'core.hooksPath'])
  const hooksWired = hooksPath === '.husky/_' && existsSync(join(forkDir, '.husky', '_'))
  const branch =
    gitOut(forkDir, ['symbolic-ref', '--short', 'HEAD']) ||
    gitOut(forkDir, ['rev-parse', '--abbrev-ref', 'HEAD']) ||
    '?'
  const forkSha = gitOut(forkDir, ['rev-parse', options.baseRef])
  const baseline = evaluateBaseline(forkSha, remoteHeadSha(forkDir, options.base))
  const staged = gitOut(forkDir, ['diff', '--cached', '--name-only'])
    .split('\n')
    .filter((f) => f.includes('node_modules'))
  const items = buildCheckItems({
    forkExists,
    hooksPath,
    hooksWired,
    toolchain: probeToolchain(forkDir),
    baseline,
    stagedNodeModules: staged,
  })

  let verify = null
  if (!options.staticOnly) {
    log('→ 正在跑本地校验（verify-local --fast，可能 1~30s）…')
    const res = run(process.execPath, ['scripts/verify-local.mjs', '--fast'], { cwd: forkDir, inherit: true })
    verify = { code: res.code, summary: `耗时 ${formatMs(res.ms)}` }
  }
  const report = renderCheckReport({ forkDir, branch, items, verify })
  log(report.text)
  if (options.json) log(JSON.stringify({ ok: report.ok, items, verify }, null, 2))
  process.exit(report.ok ? 0 : 1)
}

function cmdClean() {
  const forkDir = resolveTargetDir(options.id, TMP_ROOT, options.dir)
  if (!isSafeToClean(forkDir, TMP_ROOT)) {
    console.error(`✖ 拒绝删除：${forkDir} 不在 ${TMP_ROOT}/gh-fork-* 范围内（安全护栏，避免 rm -rf 打错路径）`)
    process.exit(1)
  }
  // ⚠️ 顺序即语义（与 scripts/ship.mjs 同一条规则）：**用法校验（缺 --yes，exit 2）
  // 必须先于环境校验（目录是否存在）**。反过来写的话，`clean 不存在的东西` 会以"幂等通过"
  // 返回 0，把"你忘了 --yes"这个用法错误悄悄吞掉 —— 退出码就再也区分不出
  // 「命令写错了」和「环境不对」。
  if (!options.yes) {
    console.error(`✖ clean 会删除 ${forkDir}（不可逆）。确认后加 --yes：`)
    console.error(`  node scripts/fork-pool.mjs clean ${options.id} --yes`)
    process.exit(2)
  }
  if (!existsSync(forkDir)) {
    log(`✔ 目录本就不存在，幂等通过：${forkDir}`)
    process.exit(0)
  }
  const dirty = git(forkDir, ['status', '--porcelain']).out
  if (dirty) {
    log(`⚠ 目录内有未提交改动（${dirty.split('\n').length} 项）——已 push 的提交在远端分支上，未提交内容会一起删除：`)
    log(
      dirty
        .split('\n')
        .slice(0, 5)
        .map((l) => `    ${l}`)
        .join('\n'),
    )
  }
  const started = performance.now()
  rmSync(forkDir, { recursive: true, force: true })
  log(`✅ 已清理 ${forkDir}（${formatMs(performance.now() - started)}）`)
}

function cmdList() {
  const entries = existsSync(TMP_ROOT) ? readdirSync(TMP_ROOT).filter((name) => name.startsWith('gh-fork-')) : []
  if (entries.length === 0) {
    log(`（${TMP_ROOT} 下没有 gh-fork-* 目录）`)
    return
  }
  log(`${TMP_ROOT} 下的 fork 池（${entries.length} 个）：`)
  for (const name of entries.sort()) {
    const dir = join(TMP_ROOT, name)
    const isRepo = existsSync(join(dir, '.git'))
    // 优先 symbolic-ref：刚 clone/init、还没有任何提交时 HEAD 处于 unborn 分支，
    // rev-parse --abbrev-ref 会直接失败，而这时恰恰最需要看到分支名。
    const branch = isRepo
      ? gitOut(dir, ['symbolic-ref', '--short', 'HEAD']) || gitOut(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || '?'
      : '(非 git 仓库)'
    const hooksOk = isRepo && gitOut(dir, ['config', '--get', 'core.hooksPath']) === '.husky/_'
    const dirty = gitOut(dir, ['status', '--porcelain']) ? 'dirty' : 'clean'
    const size = formatBytes(dirSize(dir))
    log(`  ${name}  分支=${branch}  hooks=${hooksOk ? '✔' : '✖'}  ${dirty}  ${size}`)
  }
}

/** 目录体积（只算普通文件，软链不跟进——否则会把主工作区的 619MB 重复计入）。 */
function dirSize(dir) {
  let total = 0
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) total += statSync(full).size
    }
  }
  try {
    walk(dir)
  } catch {
    /* 体积统计失败不影响主流程 */
  }
  return total
}

const formatBytes = (bytes) =>
  bytes > 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)}M` : `${Math.round(bytes / 1024)}K`

function cmdHelp() {
  log(`fork-pool — fork 池一条命令化（issue #240）

  create <编号>   创建隔离 fork（clone --local → remote 分流 → fetch → 基线校验 → 分支 → node_modules → hooks）
  check  <编号>   推送前一键自检（静态项 + verify-local --fast），结论首行直接给"可否推送"
  clean  <编号>   清理 fork（需 --yes；只允许删除 ${TMP_ROOT}/gh-fork-*）
  list            列出 ${TMP_ROOT} 下的 fork 池（分支 / hooks 状态 / 是否脏 / 体积）

可选参数：--branch <名> --base main --dir <路径> --node-modules symlink|copy|none --no-hooks --static --json --yes

为什么默认装 hooks：clone --local 不复制 .git/config，主工作区的 core.hooksPath=.husky/_ 带不进来，
.husky/_/ 又被自身 .gitignore 挡住 —— 不装 hooks 的 fork 里提交/推送**完全不跑本地门禁**。`)
}

const commands = { create: cmdCreate, check: cmdCheck, clean: cmdClean, list: cmdList, help: cmdHelp }
;(commands[options.command] ?? cmdHelp)()
