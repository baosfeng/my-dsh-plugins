// ── mermaid 图表全屏 + 缩放 / 平移（issue #470 需求 1）────────────────────
// 全屏 = 原生 Fullscreen API（自有卡片 DOM，需用户手势）；不支持（iPhone Safari 仅 iPad）
// → 降级卡片内 overlay。缩放 / 平移 = @panzoom/panzoom 4.6.2 以 vendored asset **懒加载**
// （不进 client.js，体积门禁增量 0）；照引擎先例冻结 SHA256 + 单一真源 + asset 注入。
// UMD 直接 concat 会执行 module.exports 清掉插件 exports；注入下无 module → 落 window.Panzoom。

/** 缩放态标记（自有外层容器）：CSS 据此把 overflow 收紧为 hidden。 */
const ZOOM_ATTR = 'data-dsh-md-render-zoom'
/** 全屏态标记（写在自有卡片上）：native | fallback。 */
const FS_ATTR = 'data-dsh-md-render-fs'
const ZOOM_MIN = 0.2
const ZOOM_MAX = 8
const ZOOM_STEP = 1.25
const PAN_KEY_STEP = 40

/** panzoom 实例契约（只声明用到的成员）。 */
interface PanzoomInstance {
  zoom: (scale: number, options?: { animate?: boolean }) => number
  pan: (x: number, y: number, options?: { animate?: boolean; relative?: boolean }) => { x: number; y: number }
  reset: (options?: { animate?: boolean }) => { x: number; y: number }
  getScale: () => number
  destroy: () => void
}
type PanzoomCtor = new (element: Element, options?: Record<string, unknown>) => PanzoomInstance
/** 键盘事件最小契约（真实 KeyboardEvent 满足）。 */
interface ZoomKeyEvent {
  key?: string
  preventDefault?: () => void
}
interface ZoomState {
  pz: PanzoomInstance
  card: Element
  box: Element
}

/** 已绑定的图表（自有容器 → 状态）；同容器只绑一次。 */
const zoomStates = new Map<Element, ZoomState>()
let panzoomReady: Promise<PanzoomCtor> | null = null
let fsSyncInstalled = false

/** 注入 panzoom UMD 并解析 window.Panzoom。 */
function injectPanzoom(code: string): Promise<PanzoomCtor> {
  return new Promise<PanzoomCtor>((resolve, reject) => {
    const script = document.createElement('script')
    script.textContent = code
    script.onerror = () => reject(new Error('panzoom script injection failed'))
    document.head.appendChild(script)
    const ctor = typeof window !== 'undefined' ? (window as unknown as { Panzoom?: PanzoomCtor }).Panzoom : undefined
    if (typeof ctor !== 'function') {
      reject(new Error('panzoom missing after injection'))
      return
    }
    resolve(ctor)
  })
}

/** 懒加载 panzoom（首次真正需要才 fetch；失败重置缓存）。 */
function ensurePanzoom(): Promise<PanzoomCtor> {
  const globalCtor =
    typeof window !== 'undefined' ? (window as unknown as { Panzoom?: PanzoomCtor }).Panzoom : undefined
  if (typeof globalCtor === 'function') return Promise.resolve(globalCtor)
  if (panzoomReady !== null) return panzoomReady
  panzoomReady = fetch(PANZOOM_SCRIPT_URL)
    .then((resp) => {
      if (resp.ok === false) throw new Error('panzoom fetch failed: ' + String(resp.status))
      return resp.text()
    })
    .then(injectPanzoom)
    .catch((err: unknown) => {
      panzoomReady = null
      throw err instanceof Error ? err : new Error(String(err))
    })
  return panzoomReady
}

/** 卡片 + 自有 SVG 容器（按 entryId 定位）。 */
function zoomTargetsOf(entryId: string): { card: Element; frame: Element; box: Element } | null {
  if (typeof document === 'undefined' || document === null) return null
  const host = document.querySelector('[' + MERMAID_ENTRY_ATTR + '="' + entryId + '"]')
  if (host === null || typeof host.querySelector !== 'function') return null
  const frame = host.querySelector('div.' + MERMAID_SVG_CLASS)
  if (frame === null) return null
  const canvas = frame.querySelector('div.' + MERMAID_CANVAS_CLASS) ?? frame
  return { card: host.querySelector('div.' + MERMAID_CARD_CLASS) ?? host, frame, box: canvas }
}

/** 缩放键（+ / - / = / _ / 0）；拆出来压圈复杂度。 */
function zoomScaleKey(state: ZoomState, key: string): boolean {
  const factor = key === '+' || key === '=' ? ZOOM_STEP : key === '-' || key === '_' ? 1 / ZOOM_STEP : 0
  if (factor > 0) {
    state.pz.zoom(state.pz.getScale() * factor, { animate: true })
    return true
  }
  if (key !== '0') return false
  state.pz.reset({ animate: false })
  return true
}

/** 裸 wheel 归页面（滚动陷阱）：ctrlKey+wheel 或全屏态才缩放。 */
function zoomWheelShouldHandle(event: Event, card: Element): boolean {
  const wheel = event as WheelEvent
  return wheel.ctrlKey || card.getAttribute(FS_ATTR) !== null
}

/** 方向键平移（拆出来压圈复杂度）。 */
function zoomArrowKey(state: ZoomState, key: string): boolean {
  const dx = key === 'ArrowLeft' ? PAN_KEY_STEP : key === 'ArrowRight' ? -PAN_KEY_STEP : 0
  const dy = key === 'ArrowUp' ? PAN_KEY_STEP : key === 'ArrowDown' ? -PAN_KEY_STEP : 0
  if (dx === 0 && dy === 0) return false
  state.pz.pan(dx, dy, { animate: false, relative: true })
  return true
}

/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移，Esc 退出降级 overlay。 */
function zoomKey(card: Element, box: Element, event: ZoomKeyEvent): void {
  const state = zoomStates.get(box)
  if (state === undefined) return
  const key = String(event.key ?? '')
  if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key)) {
    if (key !== 'Escape' || card.getAttribute(FS_ATTR) !== 'fallback') return
    exitFullscreen(card)
  }
  if (typeof event.preventDefault === 'function') event.preventDefault()
}

/** 绑定缩放 / 平移（幂等；失败静默保持静态图）。 */
function bindZoom(target: { card: Element; frame: Element; box: Element }): void {
  const { card, frame, box } = target
  if (zoomStates.has(box)) return
  ensurePanzoom()
    .then((Panzoom) => {
      if (zoomStates.has(box) || (box as { isConnected?: unknown }).isConnected === false) return
      // touchAction 内联态取 pan-y：纵向滚动归页面，横向拖拽平移。
      const pz = new Panzoom(box, {
        minScale: ZOOM_MIN,
        maxScale: ZOOM_MAX,
        cursor: 'grab',
        pinchAndPan: true,
        zoomWithWheel: false,
        touchAction: 'pan-y',
      })
      zoomStates.set(box, { pz, card, box })
      // 外层容器切到裁剪态：放大的变换层不再溢出盖住工具条。
      frame.setAttribute(ZOOM_ATTR, 'on')
      box.addEventListener(
        'wheel',
        (event: Event) => {
          if (!zoomWheelShouldHandle(event, card)) return
          pz.zoom(pz.getScale() * (Number((event as WheelEvent).deltaY) < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), {
            animate: false,
          })
          event.preventDefault()
        },
        { passive: false },
      )
      box.addEventListener('dblclick', () => pz.reset({ animate: false }))
      card.addEventListener('keydown', (event: Event) => zoomKey(card, box, event as unknown as ZoomKeyEvent))
      installFullscreenSync()
    })
    .catch(() => {
      /* 库加载失败：保持静态图 */
    })
}

/** 工具条动作（按 entryId 定位；顺带懒加载）。 */
function zoomEntry(entryId: string, action: string): void {
  const target = zoomTargetsOf(entryId)
  if (target === null) return
  bindZoom(target)
  const state = zoomStates.get(target.box)
  if (state === undefined) return
  if (action === 'fit') state.pz.reset({ animate: false })
  else if (action === 'full') state.pz.zoom(1, { animate: false })
  else state.pz.zoom(state.pz.getScale() * (action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP), { animate: true })
}

/** 原生全屏是否可用（iPhone Safari 仅 iPad）。 */
function fullscreenSupported(card: Element): boolean {
  const doc = typeof document === 'undefined' ? null : (document as unknown as { fullscreenEnabled?: boolean })
  if (doc !== null && doc.fullscreenEnabled === false) return false
  return typeof (card as { requestFullscreen?: unknown }).requestFullscreen === 'function'
}

/** 退出全屏（原生 / overlay 都覆盖；panzoom 变换留在元素上）。 */
function exitFullscreen(card: Element): void {
  if (card.getAttribute(FS_ATTR) === 'native') {
    const doc = document as unknown as { exitFullscreen?: () => Promise<void> }
    try {
      if (typeof doc.exitFullscreen === 'function') void doc.exitFullscreen()
    } catch (_e) {
      /* 已退出 */
    }
  }
  if (typeof card.removeAttribute === 'function') card.removeAttribute(FS_ATTR)
}

/** 进 / 出全屏（原生优先；不支持则 overlay）；返回切换后的全屏态。 */
function toggleCardFullscreen(entryId: string): boolean {
  const target = zoomTargetsOf(entryId)
  if (target === null) return false
  const { card } = target
  if (card.getAttribute(FS_ATTR) !== null) {
    exitFullscreen(card)
    return false
  }
  if (!fullscreenSupported(card)) {
    card.setAttribute(FS_ATTR, 'fallback')
    return true
  }
  card.setAttribute(FS_ATTR, 'native')
  try {
    const pending = (card as { requestFullscreen: () => Promise<void> }).requestFullscreen()
    if (pending && typeof pending.catch === 'function') {
      pending.catch(() => {
        if (card.getAttribute(FS_ATTR) === 'native') card.removeAttribute(FS_ATTR)
      })
    }
  } catch (_e) {
    card.removeAttribute(FS_ATTR)
  }
  return card.getAttribute(FS_ATTR) !== null
}

/** 原生退出后清掉卡片上的 native 标记（只装一个监听）。 */
function installFullscreenSync(): void {
  if (fsSyncInstalled) return
  const doc =
    typeof document === 'undefined'
      ? null
      : (document as unknown as { addEventListener?: unknown; fullscreenElement?: Element | null })
  if (doc === null || typeof doc.addEventListener !== 'function') return
  fsSyncInstalled = true
  doc.addEventListener('fullscreenchange', () => {
    const full = doc.fullscreenElement ?? null
    for (const state of zoomStates.values()) {
      if (state.card === full || state.card.getAttribute(FS_ATTR) !== 'native') continue
      state.card.removeAttribute(FS_ATTR)
    }
  })
}

/** teardown：销毁实例、清表与加载缓存。 */
function teardownZoom(): void {
  for (const state of zoomStates.values()) {
    try {
      state.pz.destroy()
    } catch (_e) {
      /* 销毁异常不阻断清理 */
    }
  }
  zoomStates.clear()
  panzoomReady = null
}

exports.PANZOOM_SCRIPT_URL = PANZOOM_SCRIPT_URL
exports.ZOOM_ATTR = ZOOM_ATTR
exports.FS_ATTR = FS_ATTR
exports.zoomTargetsOf = zoomTargetsOf
exports.ensurePanzoom = ensurePanzoom
exports.bindZoom = bindZoom
exports.zoomEntry = zoomEntry
exports.zoomKey = zoomKey
exports.zoomWheelShouldHandle = zoomWheelShouldHandle
exports.toggleCardFullscreen = toggleCardFullscreen
exports.exitFullscreen = exitFullscreen
exports.installFullscreenSync = installFullscreenSync
exports.zoomStates = zoomStates
exports.teardownZoom = teardownZoom
