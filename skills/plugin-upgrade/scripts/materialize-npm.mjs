#!/usr/bin/env node
/**
 * Materialize two published @deepseek-ai/dsh versions for an npm-mode audit.
 *
 * Usage: node materialize-npm.mjs <versionA> <versionB> <out-dir> [--packages name1,name2] [--no-github]
 *
 * Versions accept npm versions (x.y.z-alpha.1), dsh tag spellings (dsh-vx.y.z-alpha.1),
 * or dist-tags (alpha, latest, next). Installs the CLI dependency closure (plus any
 * supplement packages, default: the SQLite storage and session-query backends) into
 * <out-dir>/a and /b with scripts disabled, then emits a manifest diff and GitHub commit enrichment
 * when the repository is public. Prints a stats JSON to stdout; exits 1 with the
 * published version list when a requested version is not on the registry.
 *
 * A from-side older than the storage/session-query split publishes a since-removed standalone
 * SQLite persistence package instead; pass --packages with that version's own package names.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseGithubRepo } from './lib/github-repo.mjs'
import { commitLines, revertLines } from './lib/commit-lines.mjs'
import { manifestDiffText } from './lib/manifest-diff.mjs'
import { deepseekPackages } from './lib/npm-tree.mjs'

const CLI = '@deepseek-ai/dsh'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const DEFAULT_SUPPLEMENTS = ['@deepseek-ai/dsh-storage-sqlite', '@deepseek-ai/dsh-session-query-sqlite']
const args = process.argv.slice(2)
const [va, vb, out] = args.filter((a) => !a.startsWith('--'))
if (!va || !vb || !out) {
  console.error(
    'Usage: node materialize-npm.mjs <versionA> <versionB> <out-dir> [--packages name1,name2] [--no-github]',
  )
  process.exit(2)
}
function flagValue(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const supplements = flagValue('--packages')?.split(',') ?? DEFAULT_SUPPLEMENTS
const useGithub = !args.includes('--no-github')

function npm(...a) {
  const commandArgs = [...a, '--loglevel=error']
  if (process.platform === 'win32' && commandArgs.some((arg) => /[&|<>^()%!"`\r\n]/.test(arg))) {
    throw new Error('npm arguments contain unsupported Windows shell characters')
  }
  return execFileSync(NPM, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

/** Convert GitHub-style dsh-v tags to registry versions while preserving dist-tags. */
function registrySpec(spec) {
  return spec.replace(/^dsh-/, '').replace(/^v(?=\d)/, '')
}

/** Resolve a spec (version or dist-tag) against the registry; null when absent. */
function resolve(spec) {
  try {
    return { spec, resolved: JSON.parse(npm('view', `${CLI}@${registrySpec(spec)}`, 'version', '--json')) }
  } catch {
    return { spec, resolved: null }
  }
}
const published = JSON.parse(npm('view', CLI, 'versions', '--json'))
const distTags = JSON.parse(npm('view', CLI, 'dist-tags', '--json'))
const repository = npm('view', CLI, 'repository.url')
  .trim()
  .replace(/^git\+|\.git$/g, '')
const [a, b] = [resolve(va), resolve(vb)]
const missing = [a, b].filter((r) => !r.resolved)
if (missing.length) {
  console.log(
    JSON.stringify(
      { error: 'requested version(s) not published', requested: missing.map((m) => m.spec), published, distTags },
      null,
      2,
    ),
  )
  process.exit(1)
}

function resolvePackageVersion(pkg, version) {
  try {
    return JSON.parse(npm('view', `${pkg}@${version}`, 'version', '--json'))
  } catch {
    return null
  }
}

const supplementsResolved = supplements.map((pkg) => ({
  pkg,
  resolvedA: resolvePackageVersion(pkg, a.resolved),
  resolvedB: resolvePackageVersion(pkg, b.resolved),
}))

/** Install one root: CLI closure plus the supplements available for that side. */
function materialize(root, version, side) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'dsh-upgrade-run-root', private: true }, null, 2) + '\n',
  )
  const specs = [
    `${CLI}@${version}`,
    ...supplementsResolved
      .map((supplement) => ({ pkg: supplement.pkg, resolved: supplement[side] }))
      .filter((supplement) => supplement.resolved)
      .map((supplement) => `${supplement.pkg}@${supplement.resolved}`),
  ]
  const installArgs = [
    'install',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    ...specs,
  ]
  if (process.platform === 'win32' && installArgs.some((arg) => /[&|<>^()%!"`\r\n]/.test(arg))) {
    throw new Error('npm arguments contain unsupported Windows shell characters')
  }
  execFileSync(NPM, installArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  })
}

materialize(join(out, 'a'), a.resolved, 'resolvedA')
materialize(join(out, 'b'), b.resolved, 'resolvedB')

/**
 * 枚举两侧安装树里的全部 `@deepseek-ai/*` 包（实现与回归测试见 ./lib/npm-tree.mjs
 * + scripts/test/npm-tree.test.mjs）：必须递归**所有层级**的
 * `node_modules/@deepseek-ai/`，只读顶层 scope 目录会把嵌套在
 * `@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下的整批子包漏掉（包计数与
 * manifest-diff 覆盖面因此严重偏低，审计结论不可引用）。
 */
const pkgsA = deepseekPackages(join(out, 'a'))
const pkgsB = deepseekPackages(join(out, 'b'))

/** 包名 → 已解析的 package.json（读取行为与净化前的循环内读取等价）。 */
function readManifests(pkgs) {
  const manifests = new Map()
  for (const [name, dir] of pkgs) manifests.set(name, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')))
  return manifests
}

/**
 * manifest-diff.txt：字段同样来自网络（版本头来自 `npm view --json`，包名与 manifest 字段来自
 * 下载包的 package.json），落盘前必须与 commits.txt / reverts.txt 用**同一套净化**——
 * 判据不是"代码扫描报不报"（js/http-to-file-access 不追踪 execFileSync 的 npm CLI 响应，
 * 所以这条路径当时没被一并处置，见 issue #388），而是字段可不可信。
 * 净化与拼接实现见 ./lib/manifest-diff.mjs（复用 ./lib/commit-lines.mjs 的 scrubField）。
 */
writeFileSync(
  join(out, 'manifest-diff.txt'),
  manifestDiffText({
    cli: CLI,
    from: a.resolved,
    to: b.resolved,
    packagesA: readManifests(pkgsA),
    packagesB: readManifests(pkgsB),
  }),
)

/**
 * GitHub compare enrichment: commit list + revert detection across the tag pair.
 *
 * host 判据必须落在**解析后的 hostname**上：`repository.includes('github.com')` 会把
 * `https://evil.example/github.com/o/r` 这类 URL 也放行（CodeQL
 * js/incomplete-url-substring-sanitization），随后拿这段路径去请求 api.github.com。
 * 解析与回归测试见 ./lib/github-repo.mjs + scripts/test/github-repo.test.mjs。
 */
let enrichment = { attempted: false }
const githubRepo = useGithub ? parseGithubRepo(repository) : null
if (githubRepo) {
  enrichment.attempted = true
  const { owner, repo } = githubRepo
  const range = `dsh-v${a.resolved}...dsh-v${b.resolved}`
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/compare/${range}`)
    if (res.ok) {
      const data = await res.json()
      // CodeQL js/http-to-file-access：提交清单逐字来自 HTTP，落盘前必须净化
      // （控制字符/换行/超长消息），净化实现与理由见 ./lib/commit-lines.mjs。
      const rawCommits = Array.isArray(data.commits) ? data.commits : []
      const commits = commitLines(rawCommits)
      writeFileSync(join(out, 'commits.txt'), commits.join('\n') + '\n')
      const reverts = revertLines(commits)
      writeFileSync(join(out, 'reverts.txt'), reverts.join('\n') + '\n')
      enrichment = {
        attempted: true,
        ok: true,
        range,
        totalCommits: data.total_commits,
        commitsListed: commits.length,
        truncated: commits.length < data.total_commits || commits.length < rawCommits.length,
        reverts: reverts.length,
      }
    } else {
      enrichment = { attempted: true, ok: false, status: res.status }
    }
  } catch (e) {
    enrichment = { attempted: true, ok: false, error: String(e) }
  }
}

const stats = {
  from: { requested: a.spec, resolved: a.resolved },
  to: { requested: b.spec, resolved: b.resolved },
  distTags,
  publishedVersions: published,
  outDir: out,
  supplements: supplementsResolved,
  packagesA: pkgsA.size,
  packagesB: pkgsB.size,
  packagesOnlyInA: [...pkgsA.keys()].filter((p) => !pkgsB.has(p)),
  packagesOnlyInB: [...pkgsB.keys()].filter((p) => !pkgsA.has(p)),
  github: enrichment,
  artifacts: ['a/', 'b/', 'manifest-diff.txt', ...(enrichment.ok ? ['commits.txt', 'reverts.txt'] : [])],
}
console.log(JSON.stringify(stats, null, 2))
