'use strict'
// ── data access (host routes) ─────────────────────────────────────────
async function fetchStats(sessionId) {
  const response = await fetch(`/file-activity/api/stats?sessionId=${encodeURIComponent(sessionId)}`)
  const json = await response.json()
  if (json === null || typeof json !== 'object' || json.ok !== true) return null
  return json.value
}
/** Resolve the session working directory through the sidebar's native API. */
async function fetchSessionCwd(sessionId) {
  try {
    const response = await fetch('/sidebar/api/session.cwd', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const json = await response.json()
    const cwd = json?.value?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : ''
  } catch {
    return ''
  }
}
function postRecord(sessionId, path, op) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof path !== 'string' || path === '') return
  void fetch('/file-activity/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, path, op }),
  }).catch(() => {})
}
function postClear(sessionId) {
  void fetch('/file-activity/api/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {})
}
/** Plugin media route URL for a recorded path (authorized per session). */
function mediaUrlOf(sessionId, path) {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path })}`
}
/** Plugin text route URL (`as=text`): fs.read-shaped JSON for recorded text. */
function textUrlOf(sessionId, path) {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path, as: 'text' })}`
}
