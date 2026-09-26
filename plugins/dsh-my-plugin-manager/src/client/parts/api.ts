// ── api: fetch helpers for the Plugin Manager views ────────────────────
// 只保留三条只读接口：市场搜索（/search）、插件详情（/detail）、更新检查（/updates）。
// 安装、卸载、启停、清单接口随对应 UI 一并下线。
const API_BASE = '/my-plugin-manager/api'

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

function fetchJson(url: string, options?: RequestInit): Promise<any> {
  return fetch(url, options)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error(body?.error?.message ?? 'bad response')
      return body.value ?? {}
    })
}
