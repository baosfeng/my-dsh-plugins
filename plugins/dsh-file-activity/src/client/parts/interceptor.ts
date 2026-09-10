// ── fetch interception: sidebar file operations ───────────────────────
function methodOf(init?: RequestInit): string {
  return (init?.method ?? 'GET').toUpperCase()
}

/** POST body as a plain object (non-string bodies are ignored). */
function parseBody(init?: RequestInit): Record<string, unknown> {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : {}
}

/** Record fs.read / fs.write POSTs observed on the sidebar API. */
function recordSidebarFs(url: URL, init?: RequestInit): void {
  if (url.pathname !== '/sidebar/api/fs.read' && url.pathname !== '/sidebar/api/fs.write') return
  if (methodOf(init) !== 'POST') return
  const body = parseBody(init)
  if (typeof body.sessionId !== 'string' || typeof body.path !== 'string') return
  postRecord(body.sessionId, body.path, url.pathname === '/sidebar/api/fs.write' ? 'write' : 'read')
}

/** Record sidebar media opens (/sidebar/file?sessionId=...&path=...). */
function recordMediaOpen(url: URL, init?: RequestInit): void {
  if (url.pathname !== '/sidebar/file' || methodOf(init) !== 'GET') return
  const sessionId = url.searchParams.get('sessionId')
  const path = url.searchParams.get('path')
  if (sessionId !== null && path !== null) postRecord(sessionId, path, 'read')
}

/** Observe a resolved fetch URL and record sidebar file operations. */
function observeSidebarFetch(url: URL, init?: RequestInit): void {
  try {
    recordSidebarFs(url, init)
    recordMediaOpen(url, init)
  } catch {
    // observation must never break the underlying call
  }
}

function installFetchInterceptor(): () => void {
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const result = original(input, init)
    let url: URL
    try {
      if (typeof input === 'string') url = new URL(input, window.location.href)
      else if (input instanceof URL) url = input
      else return result // Request instances: skip observation
    } catch {
      return result
    }
    observeSidebarFetch(url, init)
    return result
  }
  return () => {
    window.fetch = original
  }
}
