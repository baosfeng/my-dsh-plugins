// ── 图表缩放 / 平移绑定（panzoom 懒加载 + 内置降级引擎）──────────────────
// 一个「作用域」= 一个带 data-mdr-mm="<id>" 的容器（卡片体 / 全屏 dialog 体各一个），
// 作用域里再找裁剪容器（.mdr-mm-frame）与变换层（.mdr-mm-canvas）；
// 几何与动作策略在 zoom-math.ts，panzoom 不可用时的纯属性引擎在 zoom-fallback.ts。
//
// 设计取舍：
//  · 缩放对象是**本插件自有的容器**（不碰官方元素），事件绑在作用域根上 ——
//    指针落在卡片任意位置都能捏合；
//  · 裸 wheel 不拦截（纵向滚动归页面），只有 ctrl+wheel（触控板捏合）或全屏态才缩放；
//  · 全屏 dialog 由卡片以 React 渲染、原生 showModal() 打开；这里只按作用域各自绑定，
//    两个作用域互不影响。

/** 缩放作用域标记（卡片根 / dialog 体各带一个；值 = 作用域 id）。 */
const MM_SCOPE_ATTR = 'data-mdr-mm'
/** 全屏态标记（原生 <dialog open> 之外的自有标记，供滚轮策略判断）。 */
const MM_FS_ATTR = 'data-mdr-mm-fs'
/** panzoom 实例契约（只声明用到的成员；锚点能力可选，见 zoom-math.ts 的 zoomAnchored）。 */
interface PanzoomInstance {
  zoom: (scale: number, options?: { animate?: boolean }) => number
  pan: (x: number, y: number, options?: { animate?: boolean; relative?: boolean }) => { x: number; y: number }
  reset: (options?: { animate?: boolean }) => { x: number; y: number }
  getScale: () => number
  destroy: () => void
  /** panzoom 4.6.2 自带：签名是 (scale, event) —— scale 在前，event 带 clientX / clientY。 */
  zoomToPoint?: (scale: number, event: { clientX: number; clientY: number }) => unknown
  /** 降级引擎自带：以屏幕点为锚点缩放。 */
  zoomAtPoint?: (scale: number, point: ZoomPoint) => unknown
}
type PanzoomCtor = new (element: Element, options?: Record<string, unknown>) => PanzoomInstance

/** 键盘事件最小契约（真实 KeyboardEvent 满足）。 */
interface ZoomKeyEvent {
  key?: string
  preventDefault?: () => void
}

/** 已绑定的缩放作用域（变换层元素 → 状态；同一元素只绑一次）。 */
interface ZoomState {
  pz: PanzoomInstance
  /** 作用域根（卡片 / dialog 体）：百分比标签与键盘事件都挂在它下面。 */
  root: Element
  /** 裁剪容器（overflow:auto），contain 计算的「可用空间」取自它而非变换层。 */
  frame: Element
  /** 变换层（panzoom 真正变换的元素）。 */
  box: Element
  /** 适应模式（保持态）：容器 / 全屏尺寸变化时重算；用户手动缩放即退出。 */
  fitMode: boolean
  /** 引擎的 transform 组合顺序（真机实测两者相反）：panzoom 是 scale(s) translate(t)，
   *  降级引擎是属性缩放（translate 语义按滚动，系数 1:1）。 */
  translateInScaledSpace: boolean
  /** fitMode 跟随（fullscreenchange / ResizeObserver / window resize）的解绑函数。 */
  unwatch?: () => void
}

const zoomStates = new Map<Element, ZoomState>()
let panzoomReady: Promise<PanzoomCtor> | null = null

/** 注入 panzoom UMD 并解析 window.Panzoom（注入下无 module → 落 window）。 */
function injectPanzoom(code: string): Promise<PanzoomCtor> {
  return new Promise<PanzoomCtor>((resolve, reject) => {
    const script = document.createElement('script')
    script.textContent = code
    script.onerror = () => reject(new Error('panzoom 脚本注入失败'))
    document.head.appendChild(script)
    const ctor = typeof window === 'undefined' ? undefined : (window as unknown as { Panzoom?: PanzoomCtor }).Panzoom
    if (typeof ctor !== 'function') {
      reject(new Error('注入后仍未拿到 panzoom'))
      return
    }
    resolve(ctor)
  })
}

/** 懒加载 panzoom（首次真正需要才取；失败重置缓存 → 下次点击可重试）。 */
function ensurePanzoom(): Promise<PanzoomCtor> {
  const globalCtor =
    typeof window === 'undefined' ? undefined : (window as unknown as { Panzoom?: PanzoomCtor }).Panzoom
  if (typeof globalCtor === 'function') return Promise.resolve(globalCtor)
  if (panzoomReady !== null) return panzoomReady
  panzoomReady = fetch(PANZOOM_SCRIPT_URL)
    .then((resp) => {
      if (resp.ok === false) throw new Error('panzoom 下载失败：HTTP ' + String(resp.status))
      return resp.text()
    })
    .then(injectPanzoom)
    .catch((err: unknown) => {
      panzoomReady = null
      throw err instanceof Error ? err : new Error(String(err))
    })
  return panzoomReady
}

/** 作用域根（卡片 / 全屏 dialog 体）。 */
function zoomScopeOf(scopeId: string): Element | null {
  if (typeof document === 'undefined' || document === null) return null
  return document.querySelector('[' + MM_SCOPE_ATTR + '="' + scopeId + '"]')
}

/** 作用域内的裁剪容器 / 变换层 / 根（缺失 → null）。 */
function zoomTargetsOf(scopeId: string): { root: Element; frame: Element; box: Element } | null {
  const root = zoomScopeOf(scopeId)
  if (root === null || typeof root.querySelector !== 'function') return null
  const frame = root.querySelector('.mdr-mm-frame')
  const box = root.querySelector('.mdr-mm-canvas')
  if (frame === null || box === null) return null
  return { root: root, frame: frame, box: box }
}

/** 该作用域是否处于全屏态（滚轮策略用：全屏里裸 wheel 也缩放）。 */
function zoomScopeIsFullscreen(scopeId: string): boolean {
  const root = zoomScopeOf(scopeId)
  return root !== null && root.getAttribute(MM_FS_ATTR) === 'open'
}

/** 事件绑定：绑在作用域根上；缩放锚点跟随手势中心。 */
function bindZoomEvents(state: ZoomState, scopeId: string): void {
  const { pz, root, box } = state
  root.addEventListener(
    'wheel',
    (event: Event) => {
      if (!zoomWheelShouldHandle(event, scopeId)) return
      zoomManual(state, pz.getScale() * zoomStep(event), zoomPointOf(event), false)
      event.preventDefault()
    },
    { passive: false },
  )
  // macOS Safari 触控板捏合派发 gesture*（不发 ctrl+wheel）；接不住就「没有任何放大效果」。
  let gestureBase = pz.getScale()
  root.addEventListener('gesturestart', (event: Event) => {
    gestureBase = pz.getScale()
    event.preventDefault()
  })
  root.addEventListener('gesturechange', (event: Event) => {
    const ratio = Number((event as unknown as { scale?: number }).scale)
    if (ratio > 0) zoomManual(state, gestureBase * ratio, zoomPointOf(event), false)
    event.preventDefault()
  })
  // 双击 = 适应 ↔ 实际大小；拖动平移（panzoompan / 降级引擎合成都发）→ 退出 fitMode。
  box.addEventListener('dblclick', () => zoomToggle(state))
  box.addEventListener('panzoompan', () => {
    state.fitMode = false
  })
  root.addEventListener('keydown', (event: Event) => zoomKey(box, event as unknown as ZoomKeyEvent))
}

/** 用给定引擎建实例（幂等）：状态登记 + 事件绑定 + fitMode 跟随 + 首次适应容器。
 *  引擎构造抛错也回落降级引擎，绝不让按钮失灵。 */
function buildZoomState(
  target: { root: Element; frame: Element; box: Element },
  make: (limits: ZoomLimits) => PanzoomInstance,
  translateInScaledSpace: boolean,
  scopeId: string,
): ZoomState {
  const { root, frame, box } = target
  const again = zoomStates.get(box)
  if (again !== undefined) return again
  let pz: PanzoomInstance
  let inScaledSpace = translateInScaledSpace
  try {
    pz = make({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
  } catch (_e) {
    pz = createFallbackZoomer(box, { minScale: ZOOM_MIN, maxScale: ZOOM_MAX })
    inScaledSpace = false
  }
  const state: ZoomState = {
    pz: pz,
    root: root,
    frame: frame,
    box: box,
    fitMode: true,
    translateInScaledSpace: inScaledSpace,
  }
  zoomStates.set(box, state)
  bindZoomEvents(state, scopeId)
  state.unwatch = bindFitFollow(state)
  applyZoom(state, 'fit')
  return state
}

/** 绑定缩放 / 平移（幂等）：优先 panzoom，**它拉不起来就用内置引擎**（不允许静默失败）。 */
function bindZoom(target: { root: Element; frame: Element; box: Element }, scopeId: string): Promise<ZoomState> {
  const bound = zoomStates.get(target.box)
  if (bound !== undefined) return Promise.resolve(bound)
  return ensurePanzoom()
    .then((Panzoom) =>
      buildZoomState(
        target,
        (limits) =>
          new Panzoom(target.box, {
            minScale: limits.minScale,
            maxScale: limits.maxScale,
            cursor: 'grab',
            pinchAndPan: true,
            zoomWithWheel: false,
            touchAction: 'pan-y',
          }),
        true,
        scopeId,
      ),
    )
    .catch(() => buildZoomState(target, (limits) => createFallbackZoomer(target.box, limits), false, scopeId))
}

/** 工具条入口：未就绪就等加载完再执行（加载期间 / 失败后点击都不能被丢弃）。 */
function zoomEntry(scopeId: string, action: string): void {
  const target = zoomTargetsOf(scopeId)
  if (target === null) return
  void bindZoom(target, scopeId).then((state) => applyZoom(state, action))
}

/** 卸载一个作用域（全屏 dialog 关闭 / 卡片卸载）：解绑跟随、销毁引擎、清表。 */
function destroyZoomScope(scopeId: string): void {
  const root = zoomScopeOf(scopeId)
  if (root === null) return
  for (const [box, state] of zoomStates) {
    if (state.root !== root) continue
    if (typeof state.unwatch === 'function') state.unwatch()
    try {
      state.pz.destroy()
    } catch (_e) {
      /* 不阻断清理 */
    }
    zoomStates.delete(box)
  }
}

/** teardown：销毁全部实例、清空表与加载缓存（观察器断连由共享骨架负责）。 */
function teardownZoom(): void {
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
exports.MM_SCOPE_ATTR = MM_SCOPE_ATTR
exports.MM_FS_ATTR = MM_FS_ATTR
exports.zoomStates = zoomStates
exports.zoomScopeOf = zoomScopeOf
exports.zoomTargetsOf = zoomTargetsOf
exports.zoomScopeIsFullscreen = zoomScopeIsFullscreen
exports.ensurePanzoom = ensurePanzoom
exports.bindZoom = bindZoom
exports.zoomEntry = zoomEntry
exports.destroyZoomScope = destroyZoomScope
exports.teardownZoom = teardownZoom
