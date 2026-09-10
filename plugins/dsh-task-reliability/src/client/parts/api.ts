// ── API helpers ───────────────────────────────────────────────────────

/** GET/POST 包装：解析 JSON 响应；body 非法 JSON 时返回 null（调用方判 ok）。 */
async function apiFetch(path: string, options?: RequestInit): Promise<ApiResult> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text || 'null') }
  } catch {
    return { status: response.status, body: null }
  }
}

/** JSON POST（模式开关 / 任务操作 / 回答问题 / 注册任务共用）。 */
function post(path: string, payload: unknown): Promise<ApiResult> {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
}
