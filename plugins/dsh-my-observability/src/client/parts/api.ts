// ── 插件 API 请求（client 片段，跨面板共用）─────────────────────────────
// 片段无 import/export，共享 client.src.js 的 factory 作用域
// （fetch 由浏览器提供），供资源 / Git / 设置页三个面板复用。

/** 请求插件 API（非 2xx 抛错；返回响应 JSON 的 value 字段）。 */
function apiJson(path: string, options?: RequestInit): Promise<any> {
  return fetch(path, options).then(async (res) => {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    return data.value
  })
}
