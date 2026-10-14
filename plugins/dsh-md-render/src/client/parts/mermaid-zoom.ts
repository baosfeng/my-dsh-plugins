// ── mermaid 图表浮窗 + 缩放 / 平移（#470 需求 1 / #471 真机反馈）────────────
// 浮窗 = 页面内 <dialog> 模态，**不用** Fullscreen API：顶层压过宿主 UI，遮罩 / Esc /
// 焦点归还 / 滚动锁定由浏览器兜底。缩放 = panzoom vendored asset 懒加载（0 增量）。
// 比例几何与交互策略（fit / fill / 100%、fitMode 跟随、锚点手势、快捷键动作）在
// zoom-math.ts；panzoom 不可用时的纯 CSS 降级引擎在 zoom-fallback.ts。
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

/** panzoom 实例契约（只声明用到的成员；锚点能力可选，见 zoom-math.ts 的 zoomAnchored）。 */
interface PanzoomInstance {
  zoom: (scale: number, options?: { animate?: boolean }) => number
  pan: (x: number, y: number, options?: { animate?: boolean; relative?: boolean }) => { x: number; y: number }
  reset: (options?: { animate?: boolean }) => { x: number; y: number }
  getScale: () => number
  destroy: () => void
  /** panzoom **4.6.2** 自带：以屏幕点为锚点缩放。签名是 **(scale, event) —— scale 在前**，
   *  第二个参数是带 clientX / clientY 的（事件）对象。证据在库自身：`function v(e,t,n,o)` 读
   *  `t.clientX`，而它的 `zoomWithWheel` 是 `v(h(…), e, t, e)`（assets/panzoom-4.6.2.min.js）。
   *  较新版本才是 (point, scale)；顺序传反时它**不抛错、只是静默不动**。 */
  zoomToPoint?: (scale: number, event: { clientX: number; clientY: number }) => unknown
  /** 降级引擎自带：以屏幕点为锚点缩放（panzoom 的 zoomToPoint 对应物）。 */
  zoomAtPoint?: (scale: number, point: ZoomPoint) => unknown
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
  /** 适应模式（**保持态**，draw.io 的 Fit Window 同款）：容器 / 全屏 / 窗口尺寸变化时重算
   *  fit；用户一旦手动缩放 / 平移 / 双击即退出（见 zoom-math.ts 的 zoomManual / zoomToggle）。 */
  fitMode: boolean
  /** 引擎的 transform 组合顺序（真机实测两者**相反**，见 buildZoomState 的说明）：
   *  panzoom 是 `scale(s) translate(t)` ⇒ 平移量的屏幕效果要乘 scale；降级引擎是 1:1。 */
  translateInScaledSpace: boolean
  /** fitMode 跟随（fullscreenchange / ResizeObserver / window resize）的解绑函数。 */
  unwatch?: () => void
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

/** 事件绑定：绑在**卡片**上（指针落在卡片任意位置都能捏合，原先只绑变换层，偏一点就没反应）；
 *  裸 wheel 不拦截，纵向滚动仍归页面。缩放锚点跟随手势中心（mermaid.live 的 zoomAtPoint 同款）。 */
function bindZoomEvents(state: ZoomState): void {
  const { pz, card, box } = state
  card.addEventListener(
    'wheel',
    (event: Event) => {
      if (!zoomWheelShouldHandle(event, card)) return
      zoomManual(state, pz.getScale() * zoomStep(event), zoomPointOf(event), false)
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
    // gesture* 的 clientX / clientY 就是手势中心 → 以它为锚点（与指针捏合一致）。
    if (ratio > 0) zoomManual(state, gestureBase * ratio, zoomPointOf(event), false)
    event.preventDefault()
  })
  // 双击 = 适应 ↔ 实际大小（不是复位）；用户拖动平移（panzoom 的 panzoompan）→ 退出 fitMode。
  box.addEventListener('dblclick', () => zoomToggle(state))
  box.addEventListener('panzoompan', () => {
    state.fitMode = false
  })
  card.addEventListener('keydown', (event: Event) => zoomKey(card, box, event as unknown as ZoomKeyEvent))
}

/** 用给定引擎建实例（幂等）：状态登记 + 事件绑定 + fitMode 跟随 + 首次适应容器。
 *  panzoom 与内置降级引擎共用这条路；**引擎构造抛错也回落到降级态**，绝不让按钮失灵。 */
function buildZoomState(
  target: { card: Element; frame: Element; box: Element },
  make: (limits: ZoomLimits) => PanzoomInstance,
  /** 引擎的 transform 组合顺序（真机实测两者**相反**）：
   *  panzoom 是 `scale(s) translate(t)` —— 平移量落在**缩放后的坐标系**里，屏幕位移 = t·s；
   *  内置降级引擎是 `translate(t) scale(s)` —— 屏幕位移 = t。居中补偿要按它取系数。 */
  translateInScaledSpace: boolean,
): ZoomState {
  const { card, frame, box } = target
  const again = zoomStates.get(box)
  if (again !== undefined) return again
  let pz: PanzoomInstance
  let inScaledSpace = translateInScaledSpace
  try {
    pz = make({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
  } catch (_e) {
    pz = createFallbackZoomer(box, { minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
    inScaledSpace = false // 回落 = 降级引擎（translate 与 scale 1:1）
  }
  const state: ZoomState = { pz, card, frame, box, fitMode: true, translateInScaledSpace: inScaledSpace }
  zoomStates.set(box, state)
  frame.setAttribute(ZOOM_ATTR, 'on') // 外层切裁剪态：放大后不盖住工具条
  bindZoomEvents(state)
  state.unwatch = bindFitFollow(state) // 全屏 / 容器尺寸变化 → fitMode 下重算 fit
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
      buildZoomState(
        target,
        (limits) => {
          // touchAction 内联态取 pan-y：纵向滚动归页面，横向拖拽平移。
          return new Panzoom(box, {
            minScale: limits.minScale,
            maxScale: limits.maxScale,
            cursor: 'grab',
            pinchAndPan: true,
            zoomWithWheel: false,
            touchAction: 'pan-y',
          })
        },
        true, // panzoom：transform 是 scale(s) translate(t)，translate 落在缩放坐标系里
      ),
    )
    .catch(() => buildZoomState(target, (limits) => createFallbackZoomer(box, limits), false))
}

/** 工具条入口：未就绪就**等加载完再执行**（此前直接 return，加载期间与加载失败后的
 *  每次点击都被静默丢弃 —— 用户看到的就是「点了没反应」）。 */
function zoomEntry(entryId: string, action: string): void {
  const target = zoomTargetsOf(entryId)
  if (target === null) return
  void bindZoom(target).then((state) => applyZoom(state, action))
}

/** 浮窗里的小按钮：文字走 data-dsh-md-render-tip 悬停浮层，图标 React 渲染进按钮
 *  （图标单一真源在共享图标集，不为命令式路径另写一套 SVG）。 */
function overlayButton(label: string, iconNode: unknown, onClick: () => void): Element {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dsh-md-render-mermaid-eb'
  btn.setAttribute('aria-label', label)
  btn.setAttribute('data-dsh-md-render-tip', label)
  renderNodeInto(btn, iconNode)
  btn.addEventListener('click', onClick)
  return btn
}

/** 二级入口：浏览器原生全屏。**先收浮窗再进全屏** —— PhotoSwipe 官方配方：两层容器
 *  绝不同时存在（真机实测此前 dialog 仍 open = 两层模态叠加）。全屏切换由 fitMode 的
 *  fullscreenchange 跟随重新适应；请求被拒 / 不支持则就地重新适应（别停在浮窗时的大比例）。 */
function requestNativeFullscreen(target: { card: Element; frame: Element; box: Element }): void {
  closeCardOverlay()
  const refit = (): void => {
    const state = zoomStates.get(target.box)
    if (state !== undefined) zoomRefitIfFit(state)
  }
  const api = target.card as { requestFullscreen?: () => Promise<void> }
  try {
    if (typeof api.requestFullscreen !== 'function') {
      refit()
      return
    }
    void Promise.resolve(api.requestFullscreen()).catch(refit)
  } catch (_e) {
    refit()
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
  bar.appendChild(overlayButton('浏览器全屏', icon.maximize(14), () => requestNativeFullscreen(target)))
  bar.appendChild(overlayButton('关闭', icon.close(14), closeCardOverlay))
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

/** teardown：收掉浮窗、解绑跟随监听、销毁实例、清表与加载缓存。 */
function teardownZoom(): void {
  closeCardOverlay()
  for (const state of zoomStates.values()) {
    if (typeof state.unwatch === 'function') state.unwatch()
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
