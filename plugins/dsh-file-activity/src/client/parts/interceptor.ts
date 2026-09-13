// ── fetch interception: the plugin's own file routes ───────────────────
//
// Before the native migration this module also watched the THIRD-PARTY
// sidebar's routes (/sidebar/api/fs.read|fs.write, /sidebar/file). Those are
// the host's internal surface now, fed by the host's own file provider and
// document owner — the plugin neither opens nor owns them, so observing them
// would record host traffic that is already recorded through the plugin's
// fs/observed host half. What remains is the plugin's own media/text route,
// whose reads ARE the user's previews.

/** Record requests for the plugin's own file route (media + text previews). */
function recordOwnMediaOpen(url: URL, init?: RequestInit): void {
  if (url.pathname !== '/file-activity/file') return
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return
  const sessionId = url.searchParams.get('sessionId')
  const path = url.searchParams.get('path')
  if (sessionId !== null && path !== null) postRecord(sessionId, path, 'read')
}

/** Observe a resolved fetch URL and record plugin file operations. */
function observeSidebarFetch(url: URL, init?: RequestInit): void {
  try {
    recordOwnMediaOpen(url, init)
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
