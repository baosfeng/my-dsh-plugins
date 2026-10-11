// ── mermaid 图表浮窗 + 缩放 / 平移（#470 需求 1 / #471 真机反馈）────────────
// 浮窗 = 页面内 <dialog> 模态，**不用** Fullscreen API：顶层压过宿主 UI，遮罩 / Esc /
// 焦点归还 / 滚动锁定由浏览器兜底。缩放 = panzoom vendored asset 懒加载（0 增量）。
// 设计取舍与真机实测数字见 tmp/md-render-enhancements/zoom-fix-report.md。

const ZOOM_ATTR = 'data-dsh-md-render-zoom'
/** 缩放百分比标签类名（工具条内自有 DOM）：让「点了到底有没有变」一眼可见。 */
const ZOOM_PCT_CLASS = 'dsh-md-render-mermaid-zoom-pct'
/** 卡片态：open = 浮窗开；failed = panzoom 加载失败（此前静默 → 像「点了没反应」）。 */
const FS_ATTR = 'data-dsh-md-render-fs'
const FS_OPEN = 'open'
const FS_FAIL = 'failed'
/** 浮窗面板标记 + 面板 / 面板工具条类名（自有 DOM）。 */
const FS_PANEL_ATTR = 'data-dsh-md-render-fs-panel'
const FS_CLASS = 'dsh-md-render-mermaid-fs'
const FS_BAR_CLASS = 'dsh-md-render-mermaid-fs-bar'
const ZOOM_MIN = 0.2
const ZOOM_MAX = 8
const ZOOM_STEP = 1.5
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
  /** 裁剪容器（overflow:hidden），contain 计算的「可用空间」取自它而非变换层。 */
  frame: Element
  box: Element
}
/** 浮窗代管记录：关闭时按它把宿主还回原父节点的原位置。 */
interface OverlayHome {
  host: Element
  entryId: string
  parent: Node | null
  next: Node | null
  dialog: HTMLDialogElement
}

/** 已绑定的图表（自有变换层 → 状态）；同容器只绑一次。 */
const zoomStates = new Map<Element, ZoomState>()
let panzoomReady: Promise<PanzoomCtor> | null = null
let overlayHome: OverlayHome | null = null

/** 注入 panzoom UMD 并解析 window.Panzoom（注入下无 module → 落 window）。 */
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

/** 懒加载 panzoom（首次真正需要才 fetch；失败重置缓存 → 下次点击可重试）。 */
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
  const card = host.querySelector('div.' + MERMAID_CARD_CLASS)
  if (card === null) return null
  const frame = card.querySelector('div.' + MERMAID_SVG_CLASS)
  if (frame === null) return null
  const canvas = frame.querySelector('div.' + MERMAID_CANVAS_CLASS) ?? frame
  return { card, frame, box: canvas }
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

/** 裸 wheel 归页面（滚动陷阱）：只有 ctrlKey+wheel（捏合）或浮窗态才缩放。 */
function zoomWheelShouldHandle(event: Event, card: Element): boolean {
  const wheel = event as WheelEvent
  return wheel.ctrlKey === true || card.getAttribute(FS_ATTR) === FS_OPEN
}

/** 方向键平移（拆出来压圈复杂度）。 */
function zoomArrowKey(state: ZoomState, key: string): boolean {
  const dx = key === 'ArrowLeft' ? PAN_KEY_STEP : key === 'ArrowRight' ? -PAN_KEY_STEP : 0
  const dy = key === 'ArrowUp' ? PAN_KEY_STEP : key === 'ArrowDown' ? -PAN_KEY_STEP : 0
  if (dx === 0 && dy === 0) return false
  state.pz.pan(dx, dy, { animate: false, relative: true })
  return true
}

/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移（Esc 由浮窗 dialog 的 cancel 负责）。 */
function zoomKey(card: Element, box: Element, event: ZoomKeyEvent): void {
  const state = zoomStates.get(box)
  if (state === undefined) return
  const key = String(event.key ?? '')
  if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key)) return
  if (typeof event.preventDefault === 'function') event.preventDefault()
}

/** 一档缩放比（滚轮 / 捏合共用）：deltaY < 0 = 放大。 */
function zoomStep(event: Event): number {
  return Number((event as WheelEvent).deltaY) < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
}

/** 事件绑定：绑在**卡片**上（指针落在卡片任意位置都能捏合，原先只绑变换层，偏一点就没反应）；
 *  裸 wheel 不拦截，纵向滚动仍归页面。 */
function bindZoomEvents(state: ZoomState): void {
  const { pz, card, box } = state
  card.addEventListener(
    'wheel',
    (event: Event) => {
      if (!zoomWheelShouldHandle(event, card)) return
      pz.zoom(pz.getScale() * zoomStep(event), { animate: false })
      event.preventDefault()
    },
    { passive: false },
  )
  // macOS Safari 触控板捏合派发 gesture*（不发 ctrl+wheel）；接不住就「没有任何放大效果」。
  let gestureBase = pz.getScale()
  card.addEventListener('gesturestart', (event: Event) => {
    gestureBase = pz.getScale()
    event.preventDefault()
  })
  card.addEventListener('gesturechange', (event: Event) => {
    const ratio = Number((event as unknown as { scale?: number }).scale)
    if (ratio > 0) pz.zoom(gestureBase * ratio, { animate: false })
    event.preventDefault()
  })
  box.addEventListener('dblclick', () => pz.reset({ animate: false }))
  card.addEventListener('keydown', (event: Event) => zoomKey(card, box, event as unknown as ZoomKeyEvent))
}

/** 用给定引擎建实例（幂等）：状态登记 + 事件绑定 + 首次适应容器。
 *  panzoom 与内置降级引擎共用这条路；**引擎构造抛错也回落到降级态**，绝不让按钮失灵。 */
function buildZoomState(
  target: { card: Element; frame: Element; box: Element },
  make: (limits: ZoomLimits) => PanzoomInstance,
): ZoomState {
  const { card, frame, box } = target
  const again = zoomStates.get(box)
  if (again !== undefined) return again
  let pz: PanzoomInstance
  try {
    pz = make({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
  } catch (_e) {
    pz = createFallbackZoomer(box, { minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
  }
  const state: ZoomState = { pz, card, frame, box }
  zoomStates.set(box, state)
  frame.setAttribute(ZOOM_ATTR, 'on') // 外层切裁剪态：放大后不盖住工具条
  bindZoomEvents(state)
  if (card.getAttribute(FS_ATTR) === FS_FAIL) card.removeAttribute(FS_ATTR)
  // 首次绑定即适应容器：小图（flowchart LR 只有几十像素宽）不再缩在一角等用户放大。
  applyZoom(state, 'fit')
  return state
}

/** 绑定缩放 / 平移（幂等）：优先 panzoom；**它拉不起来就用内置引擎**。
 *  #471 真机第四轮：panzoom 走运行时 fetch + <script> 注入，环境差异会让它静默失败，
 *  用户看到的就是「点了完全没反应」（真机复现：阻断该请求 → pct 停在 100%、按钮全失效、
 *  卡片零提示）。因此这里**不再有「失败就 return undefined」这条静默路径** ——
 *  任何失败都必须落到一个真能用的引擎上。 */
function bindZoom(target: { card: Element; frame: Element; box: Element }): Promise<ZoomState> {
  const { box } = target
  const bound = zoomStates.get(box)
  if (bound !== undefined) return Promise.resolve(bound)
  return ensurePanzoom()
    .then((Panzoom) =>
      buildZoomState(target, (limits) => {
        // touchAction 内联态取 pan-y：纵向滚动归页面，横向拖拽平移。
        return new Panzoom(box, {
          minScale: limits.minScale,
          maxScale: limits.maxScale,
          cursor: 'grab',
          pinchAndPan: true,
          zoomWithWheel: false,
          touchAction: 'pan-y',
        })
      }),
    )
    .catch(() => buildZoomState(target, (limits) => createFallbackZoomer(box, limits)))
}

/** 刷新百分比标签：panzoom 的 transform 落在下一帧，同步读可能拿到旧值 → 再补一次。 */
function refreshZoomLabel(state: ZoomState): void {
  const label = state.card.querySelector('.' + ZOOM_PCT_CLASS)
  if (label === null) return
  const apply = (): void => {
    label.textContent = Math.round((state.pz.getScale() || 1) * 100) + '%'
  }
  apply()
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame
  if (typeof raf === 'function') raf(apply)
}

/** 工具条动作：fit = 适应容器（contain）/ full = 100% / in / out。 */
function applyZoom(state: ZoomState, action: string): void {
  if (action === 'fit') state.pz.zoom(zoomFitScale(state), { animate: false })
  else if (action === 'full') state.pz.zoom(zoomNaturalScale(state), { animate: false })
  else state.pz.zoom(state.pz.getScale() * (action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP), { animate: true })
  refreshZoomLabel(state)
}

/** 工具条入口：未就绪就**等加载完再执行**（此前直接 return，加载期间与加载失败后的
 *  每次点击都被静默丢弃 —— 用户看到的就是「点了没反应」）。 */
function zoomEntry(entryId: string, action: string): void {
  const target = zoomTargetsOf(entryId)
  if (target === null) return
  void bindZoom(target).then((state) => applyZoom(state, action))
}

/** 浮窗里的小按钮。 */
function overlayButton(label: string, onClick: () => void): Element {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dsh-md-render-mermaid-eb'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

/** 二级入口：浏览器原生全屏（主入口是浮窗，只作为面板里的小按钮保留）。 */
function requestNativeFullscreen(card: Element): void {
  const api = card as { requestFullscreen?: () => Promise<void> }
  try {
    if (typeof api.requestFullscreen === 'function') void api.requestFullscreen()
  } catch (_e) {
    /* 不支持 / 被拒：留在浮窗里 */
  }
}

/** 打开浮窗：搬**宿主**而不是卡片 —— React 17+ 把合成事件委托挂在根容器上，
 *  把卡片搬出去 = 浮窗里所有按钮失灵（真机实测）。 */
function openCardOverlay(target: { card: Element; frame: Element; box: Element }, entryId: string): void {
  if (overlayHome !== null || typeof document === 'undefined' || document === null) return
  const host = target.card.parentNode
  if (host === null || typeof (host as Element).appendChild !== 'function') return
  const dialog = document.createElement('dialog')
  dialog.className = FS_CLASS
  dialog.setAttribute(FS_PANEL_ATTR, 'open')
  const bar = document.createElement('div')
  bar.className = FS_BAR_CLASS
  bar.appendChild(overlayButton('浏览器全屏', () => requestNativeFullscreen(target.card)))
  bar.appendChild(overlayButton('关闭', closeCardOverlay))
  dialog.appendChild(bar)
  overlayHome = { host: host as Element, entryId, parent: host.parentNode, next: host.nextSibling, dialog }
  dialog.appendChild(host)
  // ::backdrop 不是元素：点击落在 dialog 自身 = 点了遮罩。
  dialog.addEventListener('click', (event: Event) => {
    if (event.target === dialog) closeCardOverlay()
  })
  dialog.addEventListener('cancel', closeCardOverlay)
  document.body.appendChild(dialog)
  dialog.showModal()
  target.card.setAttribute(FS_ATTR, FS_OPEN)
}

/** 关闭浮窗：宿主还回原位置（幂等；关闭按钮 / Esc / 遮罩三路共用）。 */
function closeCardOverlay(): void {
  const home = overlayHome
  if (home === null) return
  overlayHome = null
  try {
    home.dialog.close()
  } catch (_e) {
    /* 已关闭 / 伪 DOM 无此方法 */
  }
  const parent = home.parent
  if (parent !== null && typeof parent.insertBefore === 'function') {
    try {
      parent.insertBefore(home.host, home.next)
    } catch (_e) {
      parent.appendChild(home.host) // 原位置已失效（宿主重渲染）：父节点兜底
    }
  }
  const card =
    typeof home.host.querySelector === 'function' ? home.host.querySelector('div.' + MERMAID_CARD_CLASS) : null
  if (card !== null && card.getAttribute(FS_ATTR) === FS_OPEN) card.removeAttribute(FS_ATTR)
  if (home.dialog.parentNode !== null) home.dialog.parentNode.removeChild(home.dialog)
}

/** 卡片卸载时收掉自己的浮窗（别关掉别的卡片的）。 */
function closeOverlayOf(entryId: string): void {
  if (overlayHome !== null && overlayHome.entryId === entryId) closeCardOverlay()
}

/** 工具条「全屏」：开 / 关浮窗；返回切换后的浮窗态。 */
function toggleCardOverlay(entryId: string): boolean {
  if (overlayHome !== null) {
    closeCardOverlay()
    return false
  }
  const target = zoomTargetsOf(entryId)
  if (target === null) return false
  openCardOverlay(target, entryId)
  // 浮窗里容器大得多 → 重新适应，一开就是铺满的大图。
  void bindZoom(target).then((state) => applyZoom(state, 'fit'))
  return target.card.getAttribute(FS_ATTR) === FS_OPEN
}

/** teardown：收掉浮窗、销毁实例、清表与加载缓存。 */
function teardownZoom(): void {
  closeCardOverlay()
  for (const state of zoomStates.values()) {
    try {
      state.pz.destroy()
    } catch (_e) {
      /* 不阻断清理 */
    }
  }
  zoomStates.clear()
  panzoomReady = null
}

exports.PANZOOM_SCRIPT_URL = PANZOOM_SCRIPT_URL
exports.ZOOM_ATTR = ZOOM_ATTR
exports.FS_ATTR = FS_ATTR
exports.FS_OPEN = FS_OPEN
exports.FS_FAIL = FS_FAIL
exports.FS_PANEL_ATTR = FS_PANEL_ATTR
exports.FS_CLASS = FS_CLASS
exports.zoomTargetsOf = zoomTargetsOf
exports.ensurePanzoom = ensurePanzoom
exports.bindZoom = bindZoom
exports.zoomEntry = zoomEntry
exports.zoomKey = zoomKey
exports.zoomWheelShouldHandle = zoomWheelShouldHandle
exports.toggleCardOverlay = toggleCardOverlay
exports.closeCardOverlay = closeCardOverlay
exports.closeOverlayOf = closeOverlayOf
exports.zoomStates = zoomStates
exports.teardownZoom = teardownZoom
