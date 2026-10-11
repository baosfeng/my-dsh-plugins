// ── 内置降级缩放引擎（panzoom 不可用时的兜底）──────────────────────────────
// #471 真机第四轮教训：panzoom 走**运行时** fetch + <script> 注入，环境差异（资源加载、
// 注入时机、UMD 落点）会让它静默失败 —— 用户看到的就是「缩放按钮点了完全没反应」，
// 而百分比停在硬编码的初始值 100%（真机复现：阻断该请求 → pct 100% / 绑定从未建立 /
// 卡片零提示）。这里用纯 CSS transform 实现同一套 API：**零运行时加载 ⇒ 不存在失败面**。
// 锚点与 panzoom 对齐：库自己把 transform-origin 写成 50% 50%（= 元素布局盒中心），
// 这里用同一锚点，并以 zoomAtPoint 提供「以屏幕点为锚点缩放」（对应它的 zoomToPoint）。

/** 缩放上下界（panzoom 与内置降级引擎共用同一契约）。 */
interface ZoomLimits {
  minScale: number
  maxScale: number
}

/** 派发与 panzoom 同名的合成事件（panzoompan）：调用方据此判断「用户真的在手动平移」
 *  → 退出 fitMode。伪 DOM / 旧环境没有 dispatchEvent 或 CustomEvent 时静默跳过。 */
function fireZoomEvent(box: Element, type: string): void {
  const host = box as unknown as { dispatchEvent?: (event: unknown) => void }
  const Ctor = (globalThis as { CustomEvent?: new (type: string, init?: unknown) => unknown }).CustomEvent
  if (typeof host.dispatchEvent !== 'function' || typeof Ctor !== 'function') return
  try {
    host.dispatchEvent(new Ctor(type, { detail: {} }))
  } catch (_e) {
    /* 事件派发失败不阻断平移 */
  }
}

/** 指针拖拽平移：把每次位移交给 onDrag；返回解绑函数。 */
function attachDragPan(box: Element, onDrag: (dx: number, dy: number) => void): () => void {
  let last: { x: number; y: number } | null = null
  const pointOf = (event: unknown): { x: number; y: number } => {
    const e = event as { clientX?: number; clientY?: number }
    return { x: Number(e.clientX ?? 0), y: Number(e.clientY ?? 0) }
  }
  const onDown = (event: unknown): void => {
    last = pointOf(event)
  }
  const onMove = (event: unknown): void => {
    if (last === null) return
    const now = pointOf(event)
    const dx = now.x - last.x
    const dy = now.y - last.y
    last = now
    if (dx === 0 && dy === 0) return
    fireZoomEvent(box, 'panzoompan')
    onDrag(dx, dy)
  }
  const onUp = (): void => {
    last = null
  }
  const host = box as unknown as { addEventListener?: unknown; removeEventListener?: unknown }
  if (typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') {
    return () => {}
  }
  box.addEventListener('pointerdown', onDown)
  box.addEventListener('pointermove', onMove)
  box.addEventListener('pointerup', onUp)
  box.addEventListener('pointercancel', onUp)
  return () => {
    box.removeEventListener('pointerdown', onDown)
    box.removeEventListener('pointermove', onMove)
    box.removeEventListener('pointerup', onUp)
    box.removeEventListener('pointercancel', onUp)
  }
}

/** 以屏幕点 P 为锚点缩放后的平移量：变换是 translate(t) scale(s)（origin = 布局盒中心 O），
 *  P 不动需 t2 = t1 + (P − O − t1)·(1 − s2/s1)；量不出几何（未布局 / 伪 DOM）→ null（居中缩放）。 */
function zoomPanToPoint(box: Element, from: number, to: number, pan: ZoomPoint, point: ZoomPoint): ZoomPoint | null {
  const rect = box.getBoundingClientRect()
  if (from <= 0 || rect.width <= 0 || rect.height <= 0) return null
  const k = 1 - to / from
  const ox = Number(rect.left ?? 0) + rect.width / 2 - pan.x
  const oy = Number(rect.top ?? 0) + rect.height / 2 - pan.y
  return { x: pan.x + (point.x - ox - pan.x) * k, y: pan.y + (point.y - oy - pan.y) * k }
}

/** 内置降级缩放器：接口与 panzoom 一致（zoom / pan / reset / getScale / zoomAtPoint / destroy）。 */
function createFallbackZoomer(box: Element, limits: ZoomLimits): PanzoomInstance {
  const el = box as unknown as { style?: Record<string, string> }
  const style: Record<string, string> = el.style ?? {}
  let scale = 1
  let tx = 0
  let ty = 0
  const clamp = (value: number): number => Math.min(limits.maxScale, Math.max(limits.minScale, value))
  const paint = (): void => {
    style.transformOrigin = '50% 50%'
    style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'
  }
  const unbind = attachDragPan(box, (dx, dy) => {
    tx += dx
    ty += dy
    paint()
  })
  /** panzoom 的 zoomToPoint 对应物：锚点缩放（见 zoomPanToPoint 的几何）。 */
  const zoomAtPoint = (next: number, point: ZoomPoint): number => {
    const to = clamp(next)
    const pan = zoomPanToPoint(box, scale, to, { x: tx, y: ty }, point)
    if (pan !== null) {
      tx = pan.x
      ty = pan.y
    }
    scale = to
    paint()
    return scale
  }
  return {
    zoom: (next) => {
      scale = clamp(next)
      paint()
      return scale
    },
    pan: (x, y, options) => {
      if (options !== undefined && options.relative === true) {
        tx += x
        ty += y
      } else {
        tx = x
        ty = y
      }
      paint()
      return { x: tx, y: ty }
    },
    reset: () => {
      scale = 1
      tx = 0
      ty = 0
      paint()
      return { x: 0, y: 0 }
    },
    getScale: () => scale,
    zoomAtPoint: zoomAtPoint,
    destroy: () => {
      unbind()
      style.transform = ''
      style.transformOrigin = ''
    },
  }
}
