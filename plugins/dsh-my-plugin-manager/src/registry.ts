/**
 * dsh-my-plugin-manager — registry.ts: npm registry lookups for the market
 * browser (search) and the update check (latest versions).
 *
 * The npm registry is the public plugin source of truth: search covers every
 * published dsh plugin (npm search `keywords:dsh`), and `/<pkg>/latest`
 * gives the newest version for update comparison.
 */
const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search'
const NPM_PACKAGE = (name: string): string => `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
const NPM_PACKUMENT = (name: string): string => `https://registry.npmjs.org/${encodeURIComponent(name)}`
const NPM_DOWNLOADS = (name: string): string =>
  `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`

/** 一条市场搜索结果行（字段全部防御性兜底为空串）。 */
export interface MarketEntry {
  name: string
  version: string
  description: string
  date: string
  homepage: string
  repository: string
  author: string
}

/** 版本时间线的一项。 */
export interface VersionEntry {
  version: string
  date: string
}

/** 依赖项（name + 版本范围）。 */
export interface DepEntry {
  name: string
  spec: string
}

/** 对等依赖项（missing = 该包自身不提供、需运行时提供）。 */
export interface PeerDepEntry extends DepEntry {
  missing: boolean
}

/** 插件详情（issue #90）：README / 版本时间线 / 依赖 / 元数据。 */
export interface PackageDetail {
  name: string
  version: string
  latest: string
  description: string
  author: string
  license: string
  homepage: string
  repository: string
  readme: string
  versions: VersionEntry[]
  dependencies: DepEntry[]
  peerDependencies: PeerDepEntry[]
  downloads: number
}

/**
 * npm registry 的 JSON 响应（结构随包而异；读取处逐字段防御性收窄，
 * 故此处保留动态形状）。
 */
type Json = any

/** Search npm for plugins; returns a flat market list (name/version/…). */
export async function searchNpmPlugins(query: string, size = 30): Promise<MarketEntry[]> {
  const url = `${NPM_SEARCH}?text=${encodeURIComponent(query)}&size=${size}`
  const data = await fetchJson(url)
  const objects: Json[] = Array.isArray(data.objects) ? data.objects : []
  return objects.map((entry) => entryToResult(entry.package)).filter((entry) => entry.name !== '')
}

/**
 * Fetch a package detail (issue #90): README preview + version timeline +
 * dependency info + metadata. A single full packument lookup provides
 * readme / time / versions / dist-tags; download count comes from the npm
 * downloads API (best-effort). `version` selects the version whose
 * dependencies/metadata are surfaced; defaults to `dist-tags.latest`.
 */
export async function fetchPackageDetail(name: string, version = ''): Promise<PackageDetail> {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('package name is required')
  const packument = await fetchPackument(trimmed)
  const latest = stringOf(packument?.['dist-tags']?.latest)
  const selected = pickVersion(packument, version, latest)
  const doc = versionDocOf(packument, selected)
  const dependencies = depsOf(doc.dependencies)
  const downloads = await recentDownloadsOf(trimmed)
  return {
    name: stringOf(packument.name || trimmed),
    version: selected,
    latest,
    description: stringOf(packument.description),
    author: authorOf(packument.author || doc.author),
    license: licenseOf(doc.license ?? packument.license),
    homepage: stringOf(doc.homepage || packument.homepage),
    repository: repositoryUrlOf(doc.repository ?? packument.repository),
    readme: stringOf(packument.readme),
    versions: versionTimelineOf(packument),
    dependencies,
    peerDependencies: peerDepsOf(doc.peerDependencies, dependencies),
    downloads,
  }
}

/** Full packument lookup; 404/network errors become a friendly message. */
async function fetchPackument(name: string): Promise<Json> {
  try {
    return await fetchJson(NPM_PACKUMENT(name))
  } catch (error) {
    throw new Error(detailErrorMessage(name, error), { cause: error })
  }
}

/** The version document for `selected`, falling back to an empty doc. */
function versionDocOf(packument: Json, selected: string): Json {
  const doc = packument.versions?.[selected]
  return isPlainObject(doc) ? doc : {}
}

/** The version to surface: caller's `version` if published, else latest. */
function pickVersion(packument: Json, version: string, latest: string): string {
  const requested = version.trim()
  if (requested !== '' && isPlainObject(packument.versions?.[requested])) return requested
  return latest
}

/** Version timeline from the packument `time` map, oldest → newest. */
function versionTimelineOf(packument: Json): VersionEntry[] {
  const time = isPlainObject(packument.time) ? packument.time : {}
  const versions = isPlainObject(packument.versions) ? packument.versions : {}
  return Object.keys(time)
    .filter((v) => Object.prototype.hasOwnProperty.call(versions, v))
    .map((v) => ({ version: v, date: stringOf(time[v]) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Dependencies map → stable { name, spec } array (deps may be null-ish). */
function depsOf(deps: Json): DepEntry[] {
  if (!isPlainObject(deps)) return []
  return Object.entries(deps).map(([name, spec]) => ({ name, spec: stringOf(spec) }))
}

/** Peer deps → { name, spec, missing } (highlight peers the package alone
 *  does not satisfy: not in its own deps and not DSH-runtime-provided). */
function peerDepsOf(peers: Json, dependencies: DepEntry[]): PeerDepEntry[] {
  if (!isPlainObject(peers)) return []
  const depNames = new Set(dependencies.map((dep) => dep.name))
  return Object.entries(peers).map(([name, spec]) => ({
    name,
    spec: stringOf(spec),
    missing: !depNames.has(name) && !runtimeProvidedModule(name),
  }))
}

/** Modules always supplied by the DSH runtime, not considered "missing". */
function runtimeProvidedModule(name: string): boolean {
  if (name === 'react' || name === 'react-dom' || name === 'cordis' || name.startsWith('cordis:')) return true
  return ['@deepseek-ai/'].some((prefix) => name.startsWith(prefix))
}

/** npm 30-day download count; best-effort (0 on any failure). */
async function recentDownloadsOf(name: string): Promise<number> {
  try {
    const res = await fetch(NPM_DOWNLOADS(name), { headers: { accept: 'application/json' } })
    if (!res.ok) return 0
    const data: Json = await res.json()
    return Number.isFinite(data?.downloads) ? data.downloads : 0
  } catch {
    return 0
  }
}

/** A friendly error message for a failed packument lookup. */
function detailErrorMessage(name: string, error: unknown): string {
  const code = /404|not found/i.test(String(messageOf(error) ?? ''))
  return code ? `未找到 npm 包 "${name}"` : `加载插件详情失败（${name}）：${String(messageOf(error) ?? '网络错误')}`
}

/** 未知异常的 message（非对象/无 message 视为未提供）。 */
function messageOf(error: unknown): unknown {
  return (error as { message?: unknown } | null | undefined)?.message
}

/** Normalize a repository field (object or string) into a browseable URL. */
function repositoryUrlOf(repository: Json): string {
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '')
  return cleanRepositoryUrl(raw)
}

function cleanRepositoryUrl(raw: string): string {
  let url = raw.trim()
  if (url === '') return ''
  if (url.startsWith('git+')) url = url.slice(4)
  if (url.startsWith('github:')) url = `https://github.com/${url.slice(7)}`
  else if (url.startsWith('ssh://git@')) url = `https://${url.slice(10).replace(':', '/')}`
  else if (url.startsWith('git@')) url = `https://${url.slice(4).replace(':', '/')}`
  else if (url.startsWith('git://')) url = `https://${url.slice(6)}`
  if (url.endsWith('.git')) url = url.slice(0, -4)
  return url
}

/** License field may be a string or a { type, url } object. */
function licenseOf(license: Json): string {
  if (typeof license === 'string') return license
  return isPlainObject(license) ? stringOf(license.type) : ''
}

function isPlainObject(value: Json): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** String fields of a market row (all defensive-empty). */
const STRING_FIELDS = ['name', 'version', 'description', 'date', 'homepage', 'repository']

/** One npm search hit into the market row shape (defensive defaults). */
function entryToResult(pkg: Json): MarketEntry {
  const links = pkg?.links ?? {}
  const result: Record<string, string> = {}
  for (const field of STRING_FIELDS) result[field] = stringOf(pkg?.[field])
  result.homepage = stringOf(links.homepage)
  result.repository = stringOf(links.repository)
  result.author = authorOf(pkg?.author)
  return result as unknown as MarketEntry
}

function authorOf(author: Json): string {
  if (typeof author === 'string') return author
  return author === null || author === undefined ? '' : stringOf(author.name)
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Latest published version of a package ('' when unknown/error). */
export async function latestVersionOf(name: string): Promise<string> {
  try {
    const res = await fetch(NPM_PACKAGE(name))
    if (!res.ok) return ''
    const data: Json = await res.json()
    return typeof data.version === 'string' ? data.version : ''
  } catch {
    return ''
  }
}

async function fetchJson(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`registry request failed: ${res.status}`)
  return res.json()
}
