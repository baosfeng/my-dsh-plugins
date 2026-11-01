'use strict'
function isNoticeKind(kind) {
  return kind === 'end' || kind === 'ask' || kind === 'approval' || kind === 'remote'
}
const CLIENT_DEDUPE_MS = 2000
const DEDUPE_LS_PREFIX = 'dsh-notify:dedupe:'
const localRecent = new Map()
function claimLocked(key, now) {
  try {
    const lockKey = DEDUPE_LS_PREFIX + key
    const last = Number(window.localStorage.getItem(lockKey) || 0)
    if (now - last < CLIENT_DEDUPE_MS) {
      localRecent.set(key, now)
      return false
    }
    window.localStorage.setItem(lockKey, String(now))
  } catch {
    void 0
  }
  localRecent.set(key, now)
  if (localRecent.size > 256) {
    for (const [k, t] of localRecent) {
      if (now - t >= CLIENT_DEDUPE_MS) localRecent.delete(k)
    }
  }
  return true
}
function claimNotice(key) {
  const now = Date.now()
  const lastLocal = localRecent.get(key)
  if (lastLocal !== undefined && now - lastLocal < CLIENT_DEDUPE_MS) return Promise.resolve(false)
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks !== undefined && locks !== null && typeof locks.request === 'function') {
    return locks.request(DEDUPE_LS_PREFIX + key, () => claimLocked(key, Date.now()))
  }
  return Promise.resolve(claimLocked(key, now))
}
function openSessionFor(sessionId, sessionsSvc) {
  return () => {
    try {
      window.focus()
    } catch {
      void 0
    }
    if (
      sessionId !== '' &&
      sessionsSvc !== undefined &&
      sessionsSvc !== null &&
      typeof sessionsSvc.open === 'function'
    ) {
      try {
        sessionsSvc.open(sessionId)
      } catch {
        void 0
      }
    }
  }
}
function dispatchByPermission(notice, sessionId, openSession) {
  if (prefOn(LS.notify, true) && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      fireSystemNotification(notice, sessionId, openSession)
      return
    }
    if (Notification.permission === 'default') {
      void Notification.requestPermission()
        .then((permission) => {
          if (permission === 'granted') {
            fireSystemNotification(notice, sessionId, openSession)
          } else {
            showToast(notice, openSession)
          }
        })
        .catch(() => showToast(notice, openSession))
      showToast(notice, openSession)
      return
    }
  }
  showToast(notice, openSession)
}
function handleNotice(notice, sessionsSvc) {
  if (notice === null || typeof notice !== 'object' || notice.type !== 'notice') return Promise.resolve()
  if (!isNoticeKind(notice.kind)) return Promise.resolve()
  const sessionId = typeof notice.sessionId === 'string' ? notice.sessionId : ''
  const key = `${notice.kind}:${sessionId}`
  return claimNotice(key).then((claimed) => {
    if (!claimed) return
    const openSession = openSessionFor(sessionId, sessionsSvc)
    dispatchByPermission(notice, sessionId, openSession)
    if (prefOn(LS.sound, true)) beep()
  })
}
function subscribeStream(sessionsSvc) {
  if (typeof window === 'undefined' || typeof EventSource !== 'function') return () => {}
  loadRuntimeConfig()
  const source = new EventSource('/notify/api/stream')
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      void handleNotice(data, sessionsSvc)
    } catch {
      void 0
    }
  }
  return () => {
    source.close()
    removeToastBox()
  }
}
exports.apply = function apply(ctx) {
  const sessionsSvc = ctx.get('sessions', false)
  ctx.effect(() => injectStyles(), 'dsh-my-notify: styles')
  ctx.effect(() => armAudioUnlock(), 'dsh-my-notify: audio unlock')
  ctx.effect(() => subscribeStream(sessionsSvc), 'dsh-my-notify: event stream')
  attachSettingsTab(ctx)
}
