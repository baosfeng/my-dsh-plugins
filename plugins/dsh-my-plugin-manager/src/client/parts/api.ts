// ── api: fetch helpers for the Plugin Manager views ────────────────────
const API_BASE = '/my-plugin-manager/api'

/** 已安装插件行（GET /installed 的 entries[]）。 */
interface InstalledEntry {
  moduleName: string
  enabled: boolean
  fiberPhase: string | null
  version: string
}

/** 市场搜索结果行（GET /search 的 results[]）。 */
interface MarketItem {
  name: string
  version: string
  description: string
  author: string
}

/** 可更新项（GET /updates 的 outdated[]）。 */
interface OutdatedItem {
  name: string
  current: string
  latest: string
}

/** GET /installed → { entries: [{ moduleName, enabled, fiberPhase, version }] }. */
function fetchInstalled(): Promise<{ entries: InstalledEntry[] }> {
  return fetchJson(`${API_BASE}/installed`)
}

/** GET /search?q= → { results: [{ name, version, description, author }] }. */
function fetchSearch(query: string): Promise<{ results: MarketItem[] }> {
  return fetchJson(`${API_BASE}/search?q=${encodeURIComponent(query.trim())}`)
}

/** GET /detail?name=&version= → plugin detail (README/versions/deps). */
function fetchDetail(name: string, version: string): Promise<any> {
  let url = `${API_BASE}/detail?name=${encodeURIComponent(name)}`
  if (version) url += `&version=${encodeURIComponent(version)}`
  return fetchJson(url)
}

/** GET /updates → { outdated: [{ name, current, latest }], error? }. */
function fetchUpdates(): Promise<{ outdated: OutdatedItem[]; error?: string }> {
  return fetchJson(`${API_BASE}/updates`)
}

/** POST /install { source } → { ok, error? }. */
function postInstall(source: string): Promise<Record<string, unknown>> {
  return fetchJson(`${API_BASE}/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source }),
  })
}

/** POST /uninstall { name } → { ok, error? }. */
function postUninstall(name: string): Promise<Record<string, unknown>> {
  return fetchJson(`${API_BASE}/uninstall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

function fetchJson(url: string, options?: RequestInit): Promise<any> {
  return fetch(url, options)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error(body?.error?.message ?? 'bad response')
      return body.value ?? {}
    })
}
