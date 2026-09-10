#!/usr/bin/env node
/**
 * Release automation for one or more plugins in this repo (batch supported).
 *
 *   node scripts/release.mjs <plugin-name> [<plugin-name>...] [--bump patch|minor|major] [--push] [--skip-real-verify --skip-reason "<理由>"]
 *
 * Steps (dry-run by default; --push performs git commit + tag + push):
 *   1.  validate plugins/<name> exists and package.json version parses
 *   1b. validate peerDependencies.cordis declared and consistent across plugins
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
 *   5.  --push: commit doc sync, tag <name>@v<version>, push tag (triggers
 *       the release workflow), then verify Release + npm
 *
 * Batch mode (multiple plugins):
 *   - Each plugin is validated independently (one failure doesn't block others)
 *   - All valid plugins are committed together, then tags are pushed sequentially
 *   - Failure report lists all failed plugins at the end
 *
 * Exit codes: 0 ok, 1 validation/test failure (nothing changed).
 */
import { execSync, execFileSync } from 'node:child_process'
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
  findFreePort,
  versionGte,
  rangeMin,
  isNpmNotFound,
} from './lib/release-checks.mjs'
import { verifyPostRelease } from './lib/post-release.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
// Batch mode: 收集插件名（flag 与其取值都要跳过）
// 注意：`--bump <type>` / `--skip-reason <理由>` 的取值不以 `--` 开头，
// 若直接 `filter(!a.startsWith('--'))` 会把取值误当成插件名——实测批量发版
// 报 `✗ plugins/patch does not exist`（`--bump patch` 的 patch 被当成插件）。
const VALUE_FLAGS = new Set(['--bump', '--skip-reason'])
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
const skipRealVerify = args.includes('--skip-real-verify')
const skipReasonIdx = args.indexOf('--skip-reason')
const skipReason = skipReasonIdx >= 0 ? args[skipReasonIdx + 1] || '' : ''
const bumpIdx = args.indexOf('--bump')
const bump = bumpIdx >= 0 ? args[bumpIdx + 1] || '' : ''
const BUMP_TYPES = new Set(['patch', 'minor', 'major'])

/**
 * Escape a user-supplied string for safe use inside a RegExp constructor.
 * `name` comes from the command line and must never alter the match grammar.
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

if (names.length === 0) {
  console.error('usage: node scripts/release.mjs <plugin-name> [<plugin-name>...] [--bump patch|minor|major] [--push]')
  process.exit(2)
}
// Validate all plugin names
for (const name of names) {
  // name 会拼入多个 shell 命令（git tag --list / git log / git add 等），
  // 严格校验字符集（CodeQL js/shell-command-injection-from-environment）。
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    console.error(`✗ 非法插件名: ${name}（仅允许 [a-zA-Z0-9._-] 且首字符为字母/数字）`)
    process.exit(2)
  }
  const pluginDir = join(root, 'plugins', name)
  if (!existsSync(pluginDir)) {
    console.error(`✗ plugins/${name} does not exist`)
    process.exit(1)
  }
}
if (bump !== '' && !BUMP_TYPES.has(bump)) {
  console.error(`✗ --bump 必须是 patch | minor | major，收到: ${bump}`)
  process.exit(2)
}

/**
 * Process a single plugin for release.
 * Returns { ok: boolean, name: string, version: string, bumped: boolean, changed: boolean }
 */
async function processPlugin(name) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Processing plugin: ${name}`)
  console.log(`${'='.repeat(60)}`)

  const pluginDir = join(root, 'plugins', name)
  const pkgPath = join(pluginDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let bumped = false
  let version = pkg.version

  // version 会拼入 git tag/push 命令，先严格校验（CodeQL
  // js/shell-command-injection-from-environment；bump 生成的 next 必为 x.y.z）
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`✗ invalid version in plugins/${name}/package.json: ${version}`)
    return { ok: false, name, version, bumped: false, changed: false }
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
      return { ok: false, name, version, bumped: false, changed: false }
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
    console.log(
      `✓ --bump ${bump}: ${prevTag ?? '(无 tag)'} → ${next}（CHANGELOG 已生成 ${logLines.length} 条提交记录）`,
    )
  }

  // 1. version from package.json
  console.log(`✓ plugin ${name} version ${version}`)

  // 1a. 语义 gate（plugin-release 增量）：stable 版本发布前查 npm latest 防降级。
  // 当前版本低于 npm 已发布 latest 时拒绝发布（防止 latest 回退到更低版本）；
  // 首次发布（404）跳过；查询失败（网络/限流）只警告不阻断。
  const isStable = /^\d+\.\d+\.\d+$/.test(version)
  if (isStable) {
    try {
      const latest = execFileSync('npm', ['view', pkg.name, 'dist-tags.latest'], { encoding: 'utf8' }).trim()
      if (latest && !versionGte(version, latest)) {
        console.error(
          `✗ ${name} 版本 ${version} 低于 npm latest ${latest} — 拒绝发布（防止 latest 回退，plugin-release 语义 gate）`,
        )
        return { ok: false, name, version, bumped, changed: false }
      }
      console.log(`✓ npm latest ${latest} ≤ 当前版本 ${version}（无降级）`)
    } catch (err) {
      if (isNpmNotFound(err?.stderr)) {
        console.log(`- ${pkg.name} 尚未发布到 npm（首次发布，跳过 latest 防降级检查）`)
      } else {
        console.log(`- npm latest 查询失败（${String(err?.stderr || err?.message).split('\n')[0]}）— 跳过防降级检查`)
      }
    }
  }

  // 1b. peer dependencies: DSH 插件必须声明 cordis peer（npm 分发后缺失会导致
  // dsh plugin add 安装失败），且 cordis major 与仓库内其他插件保持一致。
  const peers = pkg.peerDependencies || {}
  // 共享工具包（如 dsh-shared）不是 DSH 插件：不挂载 cordis service，无
  // peerDependencies.cordis 是正常的——用 package.json 的 dsh.kind=library
  // 显式标记豁免 cordis peer 检查（其余检查照旧）。
  const isLibrary = pkg.dsh?.kind === 'library'
  if (isLibrary) {
    console.log('- 共享工具包（dsh.kind=library）豁免 peerDependencies.cordis 检查（非 DSH 插件）')
  } else {
    const cordisPeer = peers.cordis
    if (!cordisPeer) {
      console.error(`✗ ${name}/package.json 缺少 peerDependencies.cordis（DSH 插件必须声明）`)
      return { ok: false, name, version, bumped, changed: false }
    }
    const cordisMajor = String(cordisPeer).match(/^[\^~]?(\d+)/)?.[1]
    if (!cordisMajor) {
      console.error(`✗ ${name}/package.json peerDependencies.cordis 无法解析 major 版本: ${cordisPeer}`)
      return { ok: false, name, version, bumped, changed: false }
    }
    const mismatched = []
    for (const entry of readdirSync(join(root, 'plugins'))) {
      if (entry === name || !existsSync(join(root, 'plugins', entry, 'package.json'))) continue
      const other = JSON.parse(readFileSync(join(root, 'plugins', entry, 'package.json'), 'utf8'))
      const otherMajor = String(other.peerDependencies?.cordis ?? '').match(/^[\^~]?(\d+)/)?.[1]
      if (otherMajor && otherMajor !== cordisMajor) mismatched.push(`${entry} (cordis ^${otherMajor})`)
    }
    if (mismatched.length > 0) {
      console.error(`✗ ${name} peerDependencies.cordis ^${cordisMajor} 与以下插件不一致: ${mismatched.join(', ')}`)
      return { ok: false, name, version, bumped, changed: false }
    }
    console.log(`✓ peerDependencies.cordis ^${cordisMajor} 已声明且与其他插件一致`)
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
  const declared = { ...(pkg.peerDependencies || {}), ...(pkg.dependencies || {}) }
  const undeclared = findUndeclaredPeers(requires, declared)
  if (undeclared.length > 0) {
    console.error(`✗ 源码 require 了以下 dsh-* 包但未在 peerDependencies/dependencies 声明: ${undeclared.join(', ')}`)
    console.error(
      `  修复: 在 plugins/${name}/package.json 的 peerDependencies 或 dependencies 中声明（如 "dsh-shared": "^0.1.0"）`,
    )
    return { ok: false, name, version, bumped, changed: false }
  }
  if (requires.length > 0) console.log(`✓ 跨插件依赖已声明: ${requires.join(', ')}`)

  const pluginIndex = buildPluginIndex(root)
  // 仓库内 library 依赖（dsh.kind=library，如 dsh-shared）：运行时 import 的共享工具包，
  // npm 未发布 = 依赖方安装失败，必须确认 npm 发布成功才放行（不允许 tag 兜底）。
  const isLibraryDep = (dir) => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'plugins', dir, 'package.json'), 'utf8'))
      return pkg.dsh?.kind === 'library'
    } catch {
      return false
    }
  }
  const isPublished = (dep, range) => {
    const min = rangeMin(range)
    if (!min) return false
    try {
      // CodeQL js/shell-command-injection-from-environment 修复：dep 来自
      // peerDependencies/dependencies 键（外部输入），execFileSync 参数数组不经过 shell
      return versionGte(execFileSync('npm', ['view', dep, 'version'], { encoding: 'utf8' }).trim(), min)
    } catch (err) {
      // 404（npm 从未发布）→ 必须阻断：依赖方安装/运行必然失败（issue #72）。
      if (isNpmNotFound(err?.stderr)) return false
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
  }
  const isTagged = (dir, version) => {
    try {
      // CodeQL js/shell-command-injection-from-environment 修复：dir/version 来自
      // peerDependencies 键（外部输入），execFileSync 参数数组不经过 shell
      execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${dir}@v${version}`], { cwd: root })
      return true
    } catch {
      return false
    }
  }
  const depProblems = findUnpublishedDeps(declared, pluginIndex, isPublished, isTagged)
  if (depProblems.length > 0) {
    for (const p of depProblems) console.error(`✗ ${p.reason}`)
    console.error('  修复: 先发版依赖包（node scripts/release.mjs <依赖目录> --push），再发本插件')
    return { ok: false, name, version, bumped, changed: false }
  }
  const inRepoDeps = Object.keys(declared).filter((d) => pluginIndex.has(d))
  if (inRepoDeps.length > 0)
    console.log(`✓ 仓库内 dsh-* 依赖均已发布且已打 tag（发布顺序正确）: ${inRepoDeps.join(', ')}`)

  // 2. CHANGELOG section
  const changelog = readFileSync(join(pluginDir, 'CHANGELOG.md'), 'utf8')
  if (!changelog.includes(`## [${version}]`)) {
    console.error(`✗ CHANGELOG.md has no "## [${version}]" section`)
    return { ok: false, name, version, bumped, changed: false }
  }
  console.log(`✓ CHANGELOG has [${version}] section`)

  // 3. tests
  try {
    execSync('npm test', { cwd: pluginDir, stdio: 'inherit' })
    console.log('✓ tests passed')
  } catch {
    console.error('✗ tests failed — fix before releasing')
    return { ok: false, name, version, bumped, changed: false }
  }

  // 3c. 真实环境验证（issue #39 + #67）：发版前必须跑 verify-real-profile.mjs
  // --addons（真实 DSH 实例 + 配置组合检查），失败即阻断；CI 无生产 profile
  // 自动跳过。--skip-real-verify 显式跳过必须带 --skip-reason 记录理由
  // （issue #67 收紧：不允许无理由默认跳过）。
  // 验证通过后生成「发版前功能级验证清单」（--checklist），并校验功能级项
  // 全部勾选（--check）——未全勾选即阻断发版（issue #67 门禁）。
  const skipReal = skipRealVerify || process.env.GITHUB_ACTIONS === 'true' || process.env.DSH_SKIP_REAL_VERIFY === '1'
  if (skipReal) {
    if (skipRealVerify && skipReason === '') {
      console.error('✗ --skip-real-verify 必须带 --skip-reason "<理由>" 显式记录跳过原因（issue #67）')
      return { ok: false, name, version, bumped, changed: false }
    }
    console.log(
      `- 跳过真实环境验证（${skipRealVerify ? `--skip-reason: ${skipReason}` : 'CI / DSH_SKIP_REAL_VERIFY'}）`,
    )
  } else if (isLibrary) {
    // library 包（dsh.kind=library，如 dsh-shared）不是 profile bundle：无插件行、
    // 无 client，verify-real-profile --addons 的 bundle 组合校验不适用。
    // 验证职责已由 3b 测试门禁（单测/覆盖率/eslint 全绿）覆盖；npm pack 内容
    // 由本脚本 3d 校验（files 清单 + exports 可解析）。
    const warn = (msg) => console.log(`- ${msg}`)
    warn(
      '共享工具包（dsh.kind=library）非 bundle 插件：跳过 profile 组合验证（--addons 不适用）；' +
        '验证由测试门禁与 pack 校验覆盖',
    )
  } else {
    const port = await findFreePort(3087)
    const checklistPath = join(root, 'verification', `${name}-${version}.md`)
    console.log(`- 真实环境验证（verify-real-profile.mjs --addons plugins/${name} --port ${port}）…`)
    try {
      execSync(
        `node scripts/verify-real-profile.mjs --addons plugins/${name} --port ${port} --checklist ${checklistPath} --plugin ${name} --version ${version}`,
        { cwd: root, stdio: 'inherit' },
      )
      console.log('✓ 真实环境验证通过（实例启动 + 配置组合 + 日志无错误）')
    } catch {
      console.error('✗ 真实环境验证失败 — 发版阻断。请先修复插件加载/配置问题，再重新发版')
      return { ok: false, name, version, bumped, changed: false }
    }
    // issue #67 门禁：功能级验证清单必须全部勾选（核心功能/易碎场景/client UI/插件联动）
    console.log(`- 校验发版前功能级验证清单（${checklistPath}）…`)
    try {
      execSync(`node scripts/verify-real-profile.mjs --check ${checklistPath}`, { cwd: root, stdio: 'inherit' })
      console.log('✓ 功能级验证清单全部勾选（发版前功能级验证完成）')
    } catch {
      console.error(
        '✗ 功能级验证清单未全部勾选 — 发版阻断（issue #67）。请在隔离实例 + 真实浏览器中完成功能级验证后勾选清单，再重新发版',
      )
      return { ok: false, name, version, bumped, changed: false }
    }
  }

  // 3b. README 效果图校验：发版前必须引用真实截图（见效果图规范）。
  // 支持 ./assets/<file> 相对路径与 https://unpkg.com/<pkg>/assets/<file> 绝对 URL，
  // 均提取文件名校验 assets/ 下真实存在。共享工具包（dsh.kind=library）无 UI，
  // 豁免截图校验。
  const plugReadmePath = join(pluginDir, 'README.md')
  const assetsDir = join(pluginDir, 'assets')
  let screenshotRefs = 0
  if (isLibrary) {
    console.log('- 共享工具包（dsh.kind=library）豁免 README 效果图校验（无 UI）')
  } else if (existsSync(plugReadmePath)) {
    const plugReadme = readFileSync(plugReadmePath, 'utf8')
    // markdown 图片与 HTML <img> 的两种引用形态
    const imgRe =
      /(?:!\[[^\]]*\]\((?:\.\/assets\/([^)]+)|https:\/\/unpkg\.com\/[^"/]+\/assets\/([^)]+))\)|<img[^>]*src="(?:\.\/assets\/([^"]+)|https:\/\/unpkg\.com\/[^"/]+\/assets\/([^"]+))")/g
    const refs = []
    for (const m of plugReadme.matchAll(imgRe)) refs.push(m[1] || m[2] || m[3] || m[4])
    screenshotRefs = refs.length
    const missingFiles = refs.filter((f) => !existsSync(join(assetsDir, f)))
    if (refs.length > 0 && missingFiles.length > 0) {
      console.error(`✗ ${name}/README.md references missing screenshots: ${missingFiles.join(', ')}`)
      return { ok: false, name, version, bumped, changed: false }
    }
  }
  if (screenshotRefs === 0 && !isLibrary) {
    console.error(
      `✗ ${name}/README.md has no real screenshot reference (./assets/... or unpkg URL) — update README + assets/ per the 效果图规范`,
    )
    return { ok: false, name, version, bumped, changed: false }
  }
  if (!isLibrary) console.log(`✓ README references ${screenshotRefs} screenshot(s) under assets/`)

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
      console.log(`✓ README.md version synced to ${version}`)
    } else {
      console.log(`- README.md already at ${version}`)
    }
  } else {
    console.log(`- README.md: no row for ${name} (add it manually if new)`)
  }

  // AGENTS.md: "<name> v<old>" in the 版本 line
  const agentsRe = new RegExp(`(${escapeRegExp(name)} v)\\d+\\.\\d+\\.\\d+`)
  if (agentsRe.test(agents)) {
    const next = agents.replace(agentsRe, `$1${version}`)
    if (next !== agents) {
      agents = next
      changed = true
      console.log(`✓ AGENTS.md version synced to ${version}`)
    } else {
      console.log(`- AGENTS.md already at ${version}`)
    }
  } else {
    console.log(`- AGENTS.md: no "${name} v…" found (add it manually if new)`)
  }

  if (changed) {
    writeFileSync(readmePath, readme)
    writeFileSync(agentsPath, agents)
  }

  return { ok: true, name, version, bumped, changed, pkgName: pkg.name }
}

// ── Main batch processing ──────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Batch release mode: processing ${names.length} plugin(s)`)
console.log(`Plugins: ${names.join(', ')}`)
console.log(`Bump: ${bump || '(none — dry-run)'}`)
console.log(`Push: ${push ? 'yes' : 'no'}`)
console.log(`${'='.repeat(60)}`)

const results = []
const succeeded = []
const failed = []

for (const name of names) {
  try {
    const result = await processPlugin(name)
    results.push(result)
    if (result.ok) {
      succeeded.push(result)
    } else {
      failed.push(result)
    }
  } catch (err) {
    console.error(`✗ ${name}: unexpected error — ${err.message}`)
    failed.push({ ok: false, name, version: 'unknown', bumped: false, changed: false })
  }
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
  const stagedNames = execSync('git diff --cached --name-only', { cwd: root, encoding: 'utf8' }).trim()
  if (stagedNames === '') {
    console.log('- 无待提交变更（版本/文档已同步），跳过 commit')
  } else {
    execFileSync('git', commitArgs, { cwd: root, stdio: 'inherit' })
  }

  // Push main
  execSync('git push origin main', { cwd: root, stdio: 'inherit' })
  console.log(`✓ committed and pushed: ${header}`)

  // Create and push tags sequentially
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
    let tagSha = null
    try {
      // CodeQL js/shell-command-injection-from-environment 修复：tag 由外部输入
      // （name/version）拼接，execFileSync 参数数组不经过 shell。
      tagSha = execFileSync('git', ['rev-parse', '-q', '--verify', `${tag}^{commit}`], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
    } catch {
      tagSha = null
    }
    if (tagSha === null) {
      execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
    } else {
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
      if (tagSha === headSha) {
        console.log(`- tag ${tag} 已存在且指向当前 HEAD——跳过打 tag（仅推送，幂等重试）`)
      } else {
        console.error(
          `✗ tag ${tag} 已存在但指向 ${tagSha.slice(0, 7)}（当前 HEAD 为 ${headSha.slice(0, 7)}），拒绝覆盖。`,
        )
        console.error('  可选处理：')
        console.error(`  a. 当前 HEAD 即为本次发版内容，删除旧 tag 并重打（远程已存在时需 force 覆盖）：`)
        console.error(`     git tag -d ${tag} && git tag ${tag} && git push origin -f ${tag}`)
        console.error('  b. 不重打本次：等下一个版本再发（tag 指向旧 commit，本流程不提供 --force-tag 自动覆盖）')
        process.exit(1)
      }
    }
    execSync(`git push origin ${tag}`, { cwd: root, stdio: 'inherit' })
    console.log(`✓ tag ${tag} pushed — GitHub Actions will build the release`)
    console.log(`  watch: https://github.com/baosfeng/my-dsh-plugins/actions`)
    // 6. 发版后校验（issue #36）：Release + npm 任一失败即终止（需 GH_TOKEN）。
    await verifyPostRelease(result.pkgName, name, version)
  }
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

if (failed.length > 0) {
  console.log('\nFailed plugins:')
  for (const result of failed) {
    console.log(`  ✗ ${result.name} (version: ${result.version})`)
  }
  process.exit(1)
}

console.log('\n✓ All plugins processed successfully')
process.exit(0)
