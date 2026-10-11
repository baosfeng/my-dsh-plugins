// ── 内置降级缩放引擎（panzoom 不可用时的兜底）──────────────────────────────
// #471 真机第四轮教训：panzoom 走**运行时** fetch + <script> 注入，环境差异（资源加载、
// 注入时机、UMD 落点）会让它静默失败 —— 用户看到的就是「缩放按钮点了完全没反应」，
// 而百分比停在硬编码的初始值 100%（真机复现：阻断该请求 → pct 100% / 绑定从未建立 /
// 卡片零提示）。这里用纯 CSS transform 实现同一套 API：**零运行时加载 ⇒ 不存在失败面**。
// 锚点差异：panzoom 由库自己算 translate（自有 CSS 里 transform-origin 是 0 0）；
// 降级态改用元素自身中心（50% 50%），图围绕自己的中心缩放。

/** 缩放上下界（panzoom 与内置降级引擎共用同一契约）。 */
interface ZoomLimits {
  minScale: number
  maxScale: number
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
    onDrag(now.x - last.x, now.y - last.y)
    last = now
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

/** 内置降级缩放器：接口与 panzoom 一致（zoom / pan / reset / getScale / destroy）。 */
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
    destroy: () => {
      unbind()
      style.transform = ''
      style.transformOrigin = ''
    },
  }
}
