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
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REQUIRED_TOOLS,
  WRITABLE_NODE_MODULES_ENTRIES,
  branchNameFor,
  buildCheckItems,
  evaluateBaseline,
  evaluateWorkspaceLinks,
  excludeAppendContent,
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

/**
 * 防误提交：node_modules 是符号链接，.gitignore 的 `node_modules/` 规则**不匹配软链**。
 *
 * 读文件用 fs.readFileSync（与 `cat` 同语义、同 utf8 解码，错误同样向上抛），不派生子进程：
 * 子进程版是多进程/不可移植的（Windows 无 cat），CodeQL js/unnecessary-use-of-cat 也在此报警。
 */
function ensureExclude(forkDir) {
  const excludeFile = join(forkDir, '.git', 'info', 'exclude')
  let current = ''
  try {
    current = readFileSync(excludeFile, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const appended = excludeAppendContent(current)
  if (!appended) return { ok: true, detail: '已包含 node_modules' }
  try {
    writeFileSync(excludeFile, appended)
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
  // 把"创建时的基线 SHA"记进 fork 的 local config：check 用它判断 fork 有没有被
  // rebase/改写（真异常），而"远端 main 前进"只是正常生命周期（提示，不阻塞）。
  git(forkDir, ['config', '--local', 'forkPool.baselineSha', remoteSha])
  git(forkDir, ['config', '--local', 'forkPool.base', options.base])

  if (steps.some((s) => s.id === 'node_modules')) {
    const started = performance.now()
    const nm = provisionNodeModules(
      join(mainWorkdir, 'node_modules'),
      join(forkDir, 'node_modules'),
      options.nodeModules,
    )
    record('node_modules', { ms: performance.now() - started }, nm.ok, nm.detail)
  }
  if (steps.some((s) => s.id === 'workspace-links')) {
    const started = performance.now()
    const ws = relinkWorkspacePackages(forkDir)
    record('workspace-links', { ms: performance.now() - started }, ws.ok, ws.detail)
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

/** 读 fork 的 plugins/<dir>/package.json → [{ name, dir }]（workspace 内部包的权威清单）。 */
function readWorkspacePackages(forkDir) {
  const pluginsDir = join(forkDir, 'plugins')
  if (!existsSync(pluginsDir)) return []
  const out = []
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgPath = join(pluginsDir, entry.name, 'package.json')
    if (!existsSync(pkgPath)) continue
    try {
      const name = JSON.parse(readFileSync(pkgPath, 'utf8')).name
      if (typeof name === 'string' && name) out.push({ name, dir: entry.name })
    } catch {
      /* 坏 package.json 跳过：不阻断创建，check 会因解析失败而报出来 */
    }
  }
  return out
}

/**
 * 把 workspace 内部包在 fork 的 node_modules 下指向 **fork 内**的 plugins/<dir>。
 * 不这么做的后果见 lib 里 planWorkspaceLinks 的注释：在 fork 里改 dsh-shared 会变成
 * **假验证**（依赖方仍读主工作区的旧包）。
 */
function relinkWorkspacePackages(forkDir) {
  const entries = readWorkspacePackages(forkDir)
  const target = join(forkDir, 'node_modules')
  if (!existsSync(target)) return { ok: true, count: 0, relinked: [], detail: '无 node_modules，跳过' }
  const relinked = []
  for (const { name, dir } of entries) {
    const linkPath = join(target, name)
    const wanted = join(forkDir, 'plugins', dir)
    let current = null
    try {
      current = realpathSync(linkPath)
    } catch {
      /* 不存在或断链 → 下面重建 */
    }
    if (current === wanted) continue
    try {
      rmSync(linkPath, { recursive: true, force: true })
      symlinkSync(wanted, linkPath)
      relinked.push(name)
    } catch (error) {
      return { ok: false, count: entries.length, relinked, detail: `重指向 ${name} 失败：${error.message}` }
    }
  }
  const sample = relinked.slice(0, 3).join('、')
  return {
    ok: true,
    count: entries.length,
    relinked,
    detail: `内部包 ${entries.length} 个，重指向 ${relinked.length} 个${sample ? `（${sample}${relinked.length > 3 ? ' 等' : ''}）` : '（已全部正确）'}`,
  }
}

/**
 * check 用：解析每个内部包当前落在哪里，交给 lib 判定是否在 fork 内。
 * 这是「包级假验证」的**日常防线**（比 A/B 对照轻，适合每次推送前跑）。
 */
function probeWorkspaceLinks(forkDir) {
  const root = (() => {
    try {
      return realpathSync(forkDir)
    } catch {
      return forkDir
    }
  })()
  const links = []
  for (const { name, dir } of readWorkspacePackages(forkDir)) {
    const linkPath = join(forkDir, 'node_modules', name)
    let present = true
    try {
      lstatSync(linkPath)
    } catch {
      present = false
    }
    // 只判定**实际存在于 node_modules** 的内部包。
    // 大部分内部包本来就不是根依赖（只有 dsh-shared 是 file: 引用的），把它们算成
    // "解析失败"会让每个 fork 都长期假红 —— 正是本次要消灭的那种噪音。
    if (!present) continue
    let resolved = null
    try {
      resolved = realpathSync(linkPath)
    } catch {
      /* 断链：resolved 保持 null，交由判定报出来 */
    }
    links.push({ name, dir, resolved })
  }
  return evaluateWorkspaceLinks(links, { forkDir: root })
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

  // 「fork 是否被改写」= 真检查（可 ✖）：创建时记录的基线提交必须仍在 HEAD 的历史里。
  // 不在 → 说明这个 fork 被 rebase / 强推 / 换过基点，那才是异常。
  // 「远端 main 前进」= 提示（不阻塞）：长寿命 fork 必然遇到，判成 ✖ 会训练人忽略告警。
  const recordedBaseline = gitOut(forkDir, ['config', '--local', '--get', 'forkPool.baselineSha'])
  let baselineIntegrity = null
  if (recordedBaseline) {
    const ancestor = git(forkDir, ['merge-base', '--is-ancestor', recordedBaseline, 'HEAD'], { allowFail: true })
    const short = recordedBaseline.slice(0, 8)
    baselineIntegrity = {
      ok: ancestor.code === 0,
      detail:
        ancestor.code === 0
          ? `创建时基线 ${short} 仍在 HEAD 历史中`
          : `创建时基线 ${short} 已不在 HEAD 历史中 —— fork 被 rebase / 强推 / 换过基点`,
    }
  }

  const staged = gitOut(forkDir, ['diff', '--cached', '--name-only'])
    .split('\n')
    .filter((f) => f.includes('node_modules'))
  const items = buildCheckItems({
    forkExists,
    hooksPath,
    hooksWired,
    toolchain: probeToolchain(forkDir),
    workspaceLinks: probeWorkspaceLinks(forkDir),
    baselineIntegrity,
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
