'use strict'
// ── auto-open (enabled by default) ────────────────────────────────────
function findTabIn(state, tabId) {
  const leaves = (node) => (node.kind === 'leaf' ? [node] : (node.children ?? []).flatMap(leaves))
  for (const node of [state?.splits, state?.bottomSplits]) {
    if (node === undefined || node === null) continue
    for (const leaf of leaves(node)) {
      if ((leaf.tabs ?? []).some((tab) => tab.type === tabId)) return true
    }
  }
  return false
}
/** Current sidebar snapshot, or null when the service is not ready. */
function sidebarSnapshot(service) {
  try {
    return service.getSnapshot?.()
  } catch {
    return null
  }
}
/** The user disabled auto-open for this tab in the sidebar settings. */
function isAutoOpenDisabled(snapshot, tabId) {
  const settings = snapshot.prefs?.pluginSettings?.[tabId]
  return settings !== undefined && settings.autoOpen === false
}
/** Whether this session was already auto-opened (localStorage marker). */
function isAutoOpenMarked(sessionId) {
  try {
    return Boolean(window.localStorage.getItem(AUTO_OPEN_KEY + sessionId))
  } catch {
    return true
  }
}
/** Persist the auto-opened marker for this session. */
function markAutoOpened(sessionId) {
  try {
    window.localStorage.setItem(AUTO_OPEN_KEY + sessionId, '1')
  } catch {
    // ignore
  }
}
/** Open the tab once per session unless disabled in the plugin settings. */
function tryAutoOpen(service, tabId) {
  const snapshot = sidebarSnapshot(service)
  if (snapshot === undefined || snapshot === null || snapshot.sessionId === undefined || snapshot.state === undefined)
    return
  const sessionId = snapshot.sessionId
  if (isAutoOpenDisabled(snapshot, tabId)) return
  if (isAutoOpenMarked(sessionId)) return
  if (findTabIn(snapshot.state, tabId)) {
    markAutoOpened(sessionId)
    return
  }
  try {
    service.openTab({ type: tabId, title: strings.title(), path: '' })
    markAutoOpened(sessionId)
  } catch (error) {
    console.error('[dsh-file-activity] auto-open failed:', error)
  }
}
function installAutoOpen(ctx, tabId) {
  const service = ctx.betterSidebar
  tryAutoOpen(service, tabId)
  let off = () => {}
  try {
    off = service.subscribeState?.(() => tryAutoOpen(service, tabId)) ?? off
  } catch {
    // service may lack subscribeState on older versions
  }
  return off
}
