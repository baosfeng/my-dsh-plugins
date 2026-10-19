// ── 内置降级缩放（panzoom 不可用时的兜底）────────────────────────────────
// panzoom 走**运行时**脚本懒加载，环境差异（资源被拦、注入时机、UMD 落点）会让它失败；
// 失败时绝不能「点了没反应」。这里用**纯属性**实现同一套接口（zoom / pan / reset /
// getScale / zoomAtPoint / destroy）：
//  · 缩放 = 改 SVG 的 width / height 属性（原型 applyZoom 同款手法，不做内联样式）；
//  · 平移 = 滚裁剪容器的 scrollLeft / scrollTop（overflow:auto 本来就在）；
//  · 容器上打 data-mdr-mm-engine="attribute"，配套 CSS 取消 svg 的 max-width 封顶。
// 零运行时加载 ⇒ 不存在失败面；坐标几何纯函数化，便于单测。
//
// 硬约束：本文件不写 classList / cssText / el.style（静态断言白名单只认 setAttribute）。

/** 缩放上下界（panzoom 与降级引擎共用同一契约）。 */
interface ZoomLimits {
  minScale: number
  maxScale: number
}

/** 缩放后的 SVG 显示尺寸（纯函数；非法比例退回 1，最小 1 像素）。 */
function fallbackSvgSize(size: { w: number; h: number }, scale: number): { w: number; h: number } {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1
  return { w: Math.max(1, Math.round(size.w * safe)), h: Math.max(1, Math.round(size.h * safe)) }
}

/** 派发与 panzoom 同名的合成事件（panzoompan）：调用方据此判定「用户真的在手动平移」。 */
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

/** SVG width/height 属性给出的固有尺寸（缺省 → null）。 */
function svgAttrSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const w = Number(svg.getAttribute('width') ?? 0)
  const h = Number(svg.getAttribute('height') ?? 0)
  return w > 0 && h > 0 ? { w: w, h: h } : null
}

/** viewBox 给出的固有尺寸（缺省 → null）。 */
function svgViewBoxSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const box = svg.viewBox !== undefined && svg.viewBox !== null ? svg.viewBox.baseVal : null
  if (box === null || box.width <= 0 || box.height <= 0) return null
  return { w: box.width, h: box.height }
}

/** 布局盒量出的尺寸（最后兜底；缺省 → null）。 */
function svgBoxSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const rect = svg.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? { w: rect.width, h: rect.height } : null
}

/** 图固有尺寸：优先 SVG 的 width/height 属性，其次 viewBox，最后量布局盒。 */
function svgNaturalSize(svg: SVGSVGElement): { w: number; h: number } | null {
  return svgAttrSize(svg) ?? svgViewBoxSize(svg) ?? svgBoxSize(svg)
}

/** 裁剪容器（rolling 的 scrollLeft/scrollTop 宿主）。 */
function zoomFrameOf(box: Element): Element | null {
  const frame = typeof box.closest === 'function' ? box.closest('.mdr-mm-frame') : null
  return frame ?? box.parentElement
}

/** 设置滚动位置（负数夹到 0；伪 DOM 缺属性时静默跳过）。 */
function scrollBy(target: Element, dx: number, dy: number): void {
  const host = target as unknown as { scrollLeft?: number; scrollTop?: number }
  const left = target as unknown as { scrollLeft: number; scrollTop: number }
  if (typeof host.scrollLeft === 'number') left.scrollLeft = Math.max(0, left.scrollLeft + dx)
  if (typeof host.scrollTop === 'number') left.scrollTop = Math.max(0, left.scrollTop + dy)
}

/** 内置降级缩放器：与 panzoom 同接口，纯属性实现。 */
function createFallbackZoomer(box: Element, limits: ZoomLimits): PanzoomInstance {
  const svg = box.querySelector('svg') as SVGSVGElement | null
  const frame = zoomFrameOf(box)
  const natural = svg === null ? null : svgNaturalSize(svg)
  let scale = 1
  const clamp = (value: number): number => Math.min(limits.maxScale, Math.max(limits.minScale, value))
  const paint = (): void => {
    if (svg === null || natural === null) return
    const size = fallbackSvgSize(natural, scale)
    svg.setAttribute('width', String(size.w))
    svg.setAttribute('height', String(size.h))
  }
  if (frame !== null) frame.setAttribute('data-mdr-mm-engine', 'attribute')
  const unbind = attachDragPan(box, (dx, dy) => {
    if (frame !== null) scrollBy(frame, -dx, -dy)
  })
  return {
    zoom: (next) => {
      scale = clamp(next)
      paint()
      return scale
    },
    pan: (x, y, options) => {
      const relative = options !== undefined && options.relative === true
      if (frame !== null) {
        const scroller = frame as unknown as { scrollLeft: number; scrollTop: number }
        if (typeof scroller.scrollLeft === 'number')
          scroller.scrollLeft = relative ? scroller.scrollLeft + x : Math.max(0, x)
        if (typeof scroller.scrollTop === 'number')
          scroller.scrollTop = relative ? scroller.scrollTop + y : Math.max(0, y)
      }
      return { x: x, y: y }
    },
    reset: () => {
      scale = 1
      paint()
      if (frame !== null) {
        const scroller = frame as unknown as { scrollLeft: number; scrollTop: number }
        if (typeof scroller.scrollLeft === 'number') scroller.scrollLeft = 0
        if (typeof scroller.scrollTop === 'number') scroller.scrollTop = 0
      }
      return { x: 0, y: 0 }
    },
    getScale: () => scale,
    zoomAtPoint: (next) => {
      scale = clamp(next)
      paint()
      return scale
    },
    destroy: () => {
      unbind()
      if (frame !== null) frame.removeAttribute('data-mdr-mm-engine')
    },
  }
}

exports.fallbackSvgSize = fallbackSvgSize
exports.createFallbackZoomer = createFallbackZoomer
