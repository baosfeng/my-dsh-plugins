// ── 通知分发（SSE 帧 → 渲染入口）───────────────────────────────────
function isNoticeKind(kind: string): boolean {
  return kind === 'end' || kind === 'ask' || kind === 'approval' || kind === 'remote'
}

// ── 通知去重（issue #70）：本地窗口 + 跨标签页协调 ─────────────────
// 服务端已按 kind:sessionId 在 dedupeMs（默认 3000ms）内去重；客户端再做
// 双保险：① 本标签页内存窗口（快速路径 + localStorage 不可用时的兜底）；
// ② 跨标签页互斥（Web Locks，Chrome 69+/Firefox 96+/Safari 15.4+）——
// 同一通知只由一个标签页弹系统通知 + 响铃，其余标签页静默。窗口
// 2000ms，覆盖多标签页帧到达时间差与服务端窗口外的偶发重复帧。
//
// 为什么不用 localStorage 做锁：get→check→set 三个步骤非原子（TOCTOU），
// 两个标签页几乎同时收到同一帧时都会读到「未过期」而各自弹通知（真实
// 浏览器复现双弹；单元测试串行调用测不出来）。navigator.locks.request
// 为同名锁提供浏览器级跨标签页互斥：回调串行执行，后到的标签页在回调
// 里读到的锁时间戳已在窗口内 → 静默。无 Web Locks（旧浏览器）时降级为
// 原 localStorage 快速路径（尽力而为，保留历史行为）。
const CLIENT_DEDUPE_MS = 2000
const DEDUPE_LS_PREFIX = 'dsh-notify:dedupe:'
const localRecent = new Map<string, number>() // `${kind}:${sessionId}` -> lastTime

/** 锁内检查窗口并登记；返回 true = 本标签页应处理（调用方需已持有锁或降级）。 */
function claimLocked(key: string, now: number): boolean {
  try {
    const lockKey = DEDUPE_LS_PREFIX + key
    const last = Number(window.localStorage.getItem(lockKey) || 0)
    if (now - last < CLIENT_DEDUPE_MS) {
      localRecent.set(key, now)
      return false
    }
    window.localStorage.setItem(lockKey, String(now))
  } catch {
    // localStorage 不可用（隐私模式等）：仅本地窗口去重
  }
  localRecent.set(key, now)
  if (localRecent.size > 256) {
    for (const [k, t] of localRecent) {
      if (now - t >= CLIENT_DEDUPE_MS) localRecent.delete(k)
    }
  }
  return true
}

/** 通知帧是否在去重窗口内已处理（本标签页或其他标签页）；未处理则登记并返回 true。
 *  返回 Promise（Web Locks 互斥异步；无 Web Locks 时立即 resolve，接口统一）。 */
function claimNotice(key: string): Promise<boolean> {
  const now = Date.now()
  const lastLocal = localRecent.get(key)
  if (lastLocal !== undefined && now - lastLocal < CLIENT_DEDUPE_MS) return Promise.resolve(false)
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks !== undefined && locks !== null && typeof locks.request === 'function') {
    // 跨标签页互斥：同名锁回调串行执行，后到者读到窗口内时间戳 → 静默。
    return locks.request(DEDUPE_LS_PREFIX + key, () => claimLocked(key, Date.now()))
  }
  // 降级：无 Web Locks（旧浏览器）→ 原 localStorage 快速路径。
  return Promise.resolve(claimLocked(key, now))
}

function openSessionFor(sessionId: string, sessionsSvc: any): () => void {
  return () => {
    try {
      window.focus()
    } catch {
      // ignore
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
        // opening is best-effort
      }
    }
  }
}

function dispatchByPermission(notice: NotifyNotice, sessionId: string, openSession: () => void): void {
  if (prefOn(LS.notify, true) && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      fireSystemNotification(notice, sessionId, openSession)
      return
    }
    if (Notification.permission === 'default') {
      // 第一次收到通知时请求权限（用户此刻正需要它）；请求期间先以
      // toast + 声音保证提醒，授权成功后本次已不重复弹系统通知。
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

function handleNotice(notice: NotifyNotice | null, sessionsSvc: any): Promise<void> {
  if (notice === null || typeof notice !== 'object' || notice.type !== 'notice') return Promise.resolve()
  if (!isNoticeKind(notice.kind)) return Promise.resolve()
  const sessionId = typeof notice.sessionId === 'string' ? notice.sessionId : ''
  const key = `${notice.kind}:${sessionId}`
  return claimNotice(key).then((claimed) => {
    if (!claimed) return // 窗口内已处理（本标签页或其他标签页）→ 静默
    const openSession = openSessionFor(sessionId, sessionsSvc)
    dispatchByPermission(notice, sessionId, openSession)
    if (prefOn(LS.sound, true)) beep()
  })
}

// ── SSE 订阅（server 事件 → 浏览器通知）─────────────────────────────
function subscribeStream(sessionsSvc: any): () => void {
  if (typeof window === 'undefined' || typeof EventSource !== 'function') return () => {}
  const source = new EventSource('/notify/api/stream')
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      void handleNotice(data, sessionsSvc)
    } catch {
      // one bad frame must never kill the stream handler
    }
  }
  return () => {
    source.close()
    removeToastBox()
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────
exports.apply = function apply(ctx: ClientContext): void {
  // strict=false：首屏加载时 sessions 服务的提供者 fiber 可能尚未 active，
  // cordis 的 ctx.get(name, strict = true) 在 strict 模式下会返回 undefined，
  // 导致点击通知无法跳转会话（降级为仅聚焦窗口，直到 HMR/重启才恢复）；
  // 取到实例即可——openSessionFor 内部仍按 typeof open === 'function' 判空降级。
  const sessionsSvc = ctx.get('sessions', false)

  // 样式注入（与 fiber 同生命周期）。
  ctx.effect(() => injectStyles(), 'dsh-my-notify: styles')

  // 音频解锁：首次用户交互后 resume（浏览器自动播放策略）。
  ctx.effect(() => armAudioUnlock(), 'dsh-my-notify: audio unlock')

  // SSE 订阅：server 事件 → 浏览器通知。
  ctx.effect(() => subscribeStream(sessionsSvc), 'dsh-my-notify: event stream')

  // 设置页 tab（官方 slots 扩展点，issue #27 配置可视化）。
  attachSettingsTab(ctx)
}
