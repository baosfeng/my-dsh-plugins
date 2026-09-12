#!/usr/bin/env node
/**
 * deps-matrix.mjs — 全仓依赖矩阵盘点（**只读**），issue #184 阶段 1 的落地件。
 *
 * 扫「根 + plugins/<插件名>/package.json」，把 dependencies / devDependencies /
 * peerDependencies / optionalDependencies 的每一条声明，连同「实际安装版本」与
 * 「registry 最新版本」放在一起，按 A/B/C/D 分档输出，并标注阻塞项。
 *
 * 用法（另见 docs/开发指南/依赖升级矩阵.md）：
 *   node scripts/deps-matrix.mjs                # 人类可读报告（按档分组）
 *   node scripts/deps-matrix.mjs --markdown     # markdown 表格（贴 PR / 存档）
 *   node scripts/deps-matrix.mjs --json         # 机读（CI / 二次处理）
 *   node scripts/deps-matrix.mjs --offline      # 不联网，只用缓存（无缓存项标 ?）
 *   node scripts/deps-matrix.mjs --refresh      # 忽略缓存强制重查
 *   node scripts/deps-matrix.mjs --registry=URL --timeout=20000 --concurrency=6
 *   node scripts/deps-matrix.mjs --out=report.md
 *
 * 设计约束（都是踩过的坑）：
 *   1. **不联网也能出「当前版本」部分**：registry 查询失败只把该项降到 [`?`] 档并写明原因，
 *      绝不让整个脚本挂掉 —— 盘点工具在离线 / 镜像不可达时必须仍然可用。
 *   2. **输出稳定**：按包名 ASCII 升序、按档分组，行内不含时间戳；两次运行可直接 diff。
 *   3. **只读**：不写任何 package.json / package-lock.json，唯一写动作是缓存文件
 *      `.deps-matrix-cache.json`（已被 .gitignore 忽略，--offline 时不写）。
 *   4. **默认官方 registry**：npmmirror 的 latest 标签与元数据与上游存在偏差，
 *      盘点结论要能对得上 npm 官方；可用 --registry 覆盖。
 *   5. `@types/node` 这类 npm latest 标签刻意停在旧 LTS 分支的包，按「当前分支」
 *      查最大版本（trackBranch），否则会得出「已最新」的反向结论。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRows,
  compareVersions,
  findPolicy,
  parseSpec,
  parseVersion,
  renderJson,
  renderMarkdown,
  renderReport,
} from './lib/deps-matrix.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_FILE = join(ROOT, '.deps-matrix-cache.json')
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const KINDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

const USAGE = `用法：node scripts/deps-matrix.mjs [--markdown|--json] [--offline] [--refresh]
       [--registry=URL] [--timeout=MS] [--concurrency=N] [--out=FILE]

  --markdown     markdown 表格输出（默认是人类可读报告）
  --json         机读 JSON 输出
  --offline      不联网，只用本地缓存（缺失项标为 ?）
  --refresh      忽略缓存 TTL，强制重查
  --registry=URL registry 地址（默认官方 ${DEFAULT_REGISTRY}）
  --timeout=MS   单次请求超时（默认 20000）
  --concurrency  并发请求数（默认 6）
  --out=FILE     同时把输出写入文件`

function parseArgs(argv) {
  const opts = {
    format: 'report',
    offline: false,
    refresh: false,
    registry: process.env.DEPS_MATRIX_REGISTRY || DEFAULT_REGISTRY,
    timeoutMs: 20000,
    concurrency: 6,
    out: null,
  }
  for (const arg of argv) {
    if (arg === '--markdown' || arg === '--md') opts.format = 'markdown'
    else if (arg === '--json') opts.format = 'json'
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--refresh') opts.refresh = true
    else if (arg.startsWith('--registry=')) opts.registry = arg.slice(11).replace(/\/+$/, '')
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = Number(arg.slice(10))
    else if (arg.startsWith('--concurrency=')) opts.concurrency = Number(arg.slice(14))
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6)
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(0)
    } else {
      process.stderr.write(`未知参数：${arg}\n${USAGE}\n`)
      process.exit(2)
    }
  }
  return opts
}

/** 根 + 19 个插件目录（有 package.json 的才算，避免把空目录算进去）。 */
function collectManifests() {
  const manifests = [{ scope: 'root', dir: ROOT }]
  const pluginsDir = join(ROOT, 'plugins')
  for (const name of readdirSync(pluginsDir).sort()) {
    const dir = join(pluginsDir, name)
    if (existsSync(join(dir, 'package.json'))) manifests.push({ scope: `plugins/${name}`, dir })
  }
  return manifests
}

/** 从 <dir>/node_modules/<name>/package.json 读实际安装版本（插件级软链也能读到）。 */
function readInstalled(dir, name) {
  const file = join(dir, 'node_modules', name, 'package.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version ?? null
  } catch {
    return null
  }
}

function collectDeclarations(manifests) {
  const declarations = []
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(join(manifest.dir, 'package.json'), 'utf8'))
    for (const kind of KINDS) {
      for (const [name, spec] of Object.entries(pkg[kind] ?? {})) {
        declarations.push({ name, kind, scope: manifest.scope, spec, installed: readInstalled(manifest.dir, name) })
      }
    }
    // overrides：强制版本（issue #199 的 qs 就在这）。嵌套对象形式（{ eslint: '$eslint' }）
    // 是「引用另一条声明」而非独立依赖，跳过。
    for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
      if (typeof spec !== 'string') continue
      declarations.push({
        name,
        kind: 'overrides',
        scope: manifest.scope,
        spec,
        installed: readInstalled(manifest.dir, name),
      })
    }
  }
  return declarations
}

/** engines.node 的声明分布：用于暴露「声明下限 vs CI 实际运行版本」的背离。 */
function collectEngines(manifests) {
  const groups = new Map()
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(join(manifest.dir, 'package.json'), 'utf8'))
    const node = pkg.engines?.node
    if (!node) continue
    const label = manifest.scope === 'root' ? 'root' : manifest.scope.replace('plugins/', '')
    groups.set(node, [...(groups.get(node) ?? []), label])
  }
  return groups
}

/** scoped 包名要转义 `/` 才能进 URL 路径。 */
const encodeName = (name) => (name.startsWith('@') ? name.replace('/', '%2f') : name)

async function fetchJson(url, opts, accept = 'application/json') {
  const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(opts.timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** 一次重试：registry 偶发抖动不该让整张矩阵出现无谓的 ? 档。 */
async function withRetry(fn) {
  try {
    return await fn()
  } catch {
    return await fn()
  }
}

/** dist-tags 端点约 100B，比完整 packument（eslint 1.2MB / @types/node 2.3MB）小三个数量级。 */
async function queryLatest(name, opts) {
  const tags = await withRetry(() => fetchJson(`${opts.registry}/-/package/${encodeName(name)}/dist-tags`, opts))
  return tags.latest ?? null
}

/** 分支跟踪：在当前 major 分支内取最大正式版本（@types/node 的 latest 停在旧 LTS 分支）。 */
async function queryBranchLatest(name, major, opts) {
  const doc = await withRetry(() =>
    fetchJson(`${opts.registry}/${encodeName(name)}`, opts, 'application/vnd.npm.install-v1+json'),
  )
  const candidates = Object.keys(doc.versions ?? {})
    .map(parseVersion)
    .filter((v) => v && v.major === major && v.prerelease.length === 0)
    .sort(compareVersions)
  return candidates.length ? candidates[candidates.length - 1].raw : null
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return { version: 1, entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    return parsed?.entries ? parsed : { version: 1, entries: {} }
  } catch {
    return { version: 1, entries: {} }
  }
}

/** 决定每个包要查什么：trackBranch 的包按当前分支查，其余查 dist-tags.latest。 */
function buildQueries(declarations) {
  const queries = new Map()
  for (const decl of declarations) {
    if (queries.has(decl.name)) continue
    const spec = parseSpec(decl.spec)
    if (!spec.registry) continue // file:/link:/workspace: 声明没有「registry 最新版」可比
    const policy = findPolicy(decl.name)
    const floor = spec.floor
    const branch = policy?.trackBranch && floor ? parseVersion(floor)?.major : undefined
    queries.set(decl.name, { name: decl.name, branch })
  }
  return [...queries.values()]
}

/** 逐条取最新版本：先吃缓存，再并发（分批）查 registry，失败只标 error 不中断。 */
async function resolveLatest(queries, opts, cache) {
  const index = {}
  const pending = []
  for (const query of queries) {
    const key = `${query.name}@${query.branch ?? 'latest'}`
    const hit = cache.entries[key]
    const fresh = hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS
    if (hit && (fresh || opts.offline)) {
      index[query.name] = { latest: hit.latest, error: hit.error ?? null, cached: true }
    } else if (opts.offline) {
      index[query.name] = { latest: null, error: 'offline 且本地缓存缺失', cached: false }
    } else {
      pending.push({ ...query, key })
    }
  }
  for (let i = 0; i < pending.length; i += opts.concurrency) {
    const batch = pending.slice(i, i + opts.concurrency).map(async (query) => {
      try {
        const latest = query.branch
          ? await queryBranchLatest(query.name, query.branch, opts)
          : await queryLatest(query.name, opts)
        if (!latest) throw new Error('registry 未返回 latest')
        cache.entries[query.key] = { latest, fetchedAt: Date.now(), error: null }
        return [query.name, { latest, error: null, cached: false }]
      } catch (error) {
        const message = String(error?.message ?? error).slice(0, 120)
        cache.entries[query.key] = { latest: null, fetchedAt: Date.now(), error: message }
        return [query.name, { latest: null, error: message, cached: false }]
      }
    })
    for (const [name, value] of await Promise.all(batch)) index[name] = value
    process.stderr.write(
      `${opts.registry} 查询进度 ${Math.min(i + opts.concurrency, pending.length)}/${pending.length}\r`,
    )
  }
  if (pending.length) process.stderr.write('\n')
  return index
}

function saveCache(cache, opts) {
  if (opts.offline) return
  cache.version = 1
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`)
}

const RENDERERS = { report: renderReport, markdown: renderMarkdown, json: renderJson }

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const manifests = collectManifests()
  const declarations = collectDeclarations(manifests)
  const cache = loadCache()
  const queries = buildQueries(declarations)
  const latestIndex = await resolveLatest(queries, opts, cache)
  saveCache(cache, opts)

  const rows = buildRows(declarations, latestIndex)
  const notes = [...collectEngines(manifests).entries()].map(
    ([range, list]) =>
      `engines.node ${range}：${list.length} 个 package.json（${list.slice(0, 4).join('、')}${list.length > 4 ? ' 等' : ''}）`,
  )
  const output = `${RENDERERS[opts.format](rows, { scopeCount: manifests.length, registry: opts.registry, notes })}\n`
  process.stdout.write(output)
  if (opts.out) {
    writeFileSync(opts.out, output)
    process.stderr.write(`已写入 ${opts.out}\n`)
  }
}

await main()
