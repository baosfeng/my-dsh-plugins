'use strict'
// ── auto-open (enabled by default) ────────────────────────────────────
//
// Native flow: the tab is a PAGE type, so opening it means
// `ctx.sidebarRight.openTab(kind)` — there is no layout snapshot to inspect
// and no session id to read from a third-party sidebar service anymore.
//
// Timing is the whole problem. The navigation controller throws
// "sidebarRight: no session surface is mounted" when the right column has not
// mounted its session surface yet — which is exactly the state during the
// first paint of a fresh page. better-sidebar used to answer with a snapshot
// and the old code simply gave up when it was missing, which is how the tab
// could silently never auto-open. Here the attempt is RETRIED with the timers
// until the surface is up, and a permanent failure is recorded through
// markDegraded() instead of disappearing.
/** Retry cadence while the right column has not mounted its session surface. */
const AUTO_OPEN_RETRY_MS = 1000
/** Give up after this many attempts (~30s) and degrade observably. */
const AUTO_OPEN_MAX_TRIES = 30
/**
 * Pending retry timer id (0 = none).
 *
 * There is deliberately NO "already attempted" flag guarding this module: a
 * rejected registration or an HMR rebuild re-runs apply(), and the second run
 * must still be able to bring the tab back. `openTab` is idempotent — it
 * focuses the existing page instead of duplicating it.
 */
let autoOpenTimer = 0
/**
 * Whether this BROWSER TAB already had its auto-open attempt.
 *
 * The native API exposes no "current session id" to a plugin (`openTab`
 * targets the mounted session, and the layout store is the host's own), so a
 * per-session marker cannot be written from here. The marker is therefore
 * per-browser-tab: one attempt per page load, which is exactly the visible
 * behaviour — the session's tab record itself is persisted host-side, so
 * revisiting a session that already shows the tab merely focuses it.
 */
function isAutoOpenAttempted() {
  const key = AUTO_OPEN_KEY + 'loaded'
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
/** Mark this browser tab as already attempted. */
function markAutoOpenAttempted() {
  try {
    window.sessionStorage.setItem(AUTO_OPEN_KEY + 'loaded', '1')
  } catch {
    // ignore
  }
}
/** The most recent controller refusal, surfaced when retries run out. */
let lastAutoOpenError = null
/** One open attempt: true when the controller accepted it. */
function tryOpenTab(ctx, tries) {
  try {
    ctx.sidebarRight.openTab(TAB_KIND, { revealIfOpened: false })
    return true
  } catch (error) {
    if (tries === 0) lastAutoOpenError = error
    return false
  }
}
/**
 * Open the tab once the session surface exists, then stop. The tab record
 * itself is persisted host-side, so a session that already shows it is not
 * reopened: `openTab` focuses the existing page instead of duplicating it.
 * @param ctx - client context carrying the navigation controller.
 * @returns disposer cancelling a pending retry.
 */
function installAutoOpen(ctx) {
  if (!autoOpenEnabled()) return () => {}
  if (isAutoOpenAttempted()) return () => {}
  let tries = 0
  const attempt = () => {
    tries += 1
    if (tryOpenTab(ctx, tries - 1)) {
      autoOpenTimer = 0
      markAutoOpenAttempted()
      return
    }
    if (tries >= AUTO_OPEN_MAX_TRIES) {
      autoOpenTimer = 0
      markDegraded('auto-open', lastAutoOpenError ?? 'sidebarRight: session surface never mounted')
      return
    }
    autoOpenTimer = window.setTimeout(attempt, AUTO_OPEN_RETRY_MS)
  }
  attempt()
  return () => {
    if (autoOpenTimer !== 0) {
      window.clearTimeout(autoOpenTimer)
      autoOpenTimer = 0
    }
  }
}
