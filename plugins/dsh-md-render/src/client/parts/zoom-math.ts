// ── 缩放几何与策略：上下界 / fit / fill / 100% / 锚点手势 / 跟随 / 键盘 ──
// 从 mermaid-zoom.ts 拆出（单文件行数门禁）。几何基准一律量**裁剪容器**（state.frame）
// 而非变换层：变换层高度由内容决定（扁图 flowchart LR 可能只有几十像素高），拿它当
// 可用空间会让 contain 恒为 1 —— 那正是「图永远放不大」的根因。
//
// 取值口径（原型）：缩放区间 50–200%，步进 25%；「适应容器 / 适应宽度」是保持态
// （draw.io 的 Fit Window 同款）——容器 / 全屏尺寸变化时重算，用户手动缩放即退出。

/** 缩放上下界与步进（原型：50–200%，一次 ±25%）。 */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 1.25
/** 方向键平移步长（像素）。 */
const PAN_KEY_STEP = 40

/** 屏幕坐标点（client 坐标系；滚轮指针 / Safari 手势中心 / 触摸捏合中心共用）。 */
interface ZoomPoint {
  x: number
  y: number
}

/** 「裁剪容器 ÷ 图固有尺寸」的量测结果（fit 与 fill 共用）。 */
interface ZoomMetrics {
  bw: number
  bh: number
  sw: number
  sh: number
}

/** 比例夹逼到引擎上下界（与缩放下界同源，纯函数）。 */
function zoomClamp(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/** 量容器与图固有尺寸；量不出（无 SVG / 未布局 / 尺寸为 0）→ null（调用方退回 1）。 */
function zoomMetrics(state: ZoomState): ZoomMetrics | null {
  const svg = state.box.querySelector('svg')
  if (svg === null) return null
  const container = state.frame as { offsetWidth?: number; offsetHeight?: number }
  const bw = Number(container.offsetWidth ?? 0)
  const bh = Number(container.offsetHeight ?? 0)
  const scale = state.pz.getScale() || 1
  const rect = svg.getBoundingClientRect()
  const sw = rect.width / scale
  const sh = rect.height / scale
  if (bw <= 0 || bh <= 0 || sw <= 0 || sh <= 0) return null
  return { bw, bh, sw, sh }
}

/**
 * 程序性缩放后的**居中补偿**：两个引擎的缩放锚点都是「变换层布局盒中心」，而变换层
 * 高度 = 内容固有高度（竖向长图常远超容器），锚点可能落在容器可视区之外。变换是
 * translate(t) scale(s)（降级引擎）/ scale(s) translate(t)（panzoom），补偿系数按引擎取。
 * 水平方向变换层宽 = 容器宽、内容已居中，无需补偿。
 */
function zoomCenterInFrame(state: ZoomState): void {
  const m = zoomMetrics(state)
  if (m === null) return
  const s = state.pz.getScale() || 1
  const k = state.translateInScaledSpace && s > 0 ? 1 / s : 1
  state.pz.pan(0, ((m.bh - m.sh) / 2) * k, { relative: false })
}

/** 100% = 图表真实像素大小：viewBox 宽 ÷ 未缩放的显示宽（适应容器后两者不等）。 */
function zoomNaturalScale(state: ZoomState): number {
  const svg = state.box.querySelector('svg')
  const scale = state.pz.getScale() || 1
  const shown = svg === null ? 0 : svg.getBoundingClientRect().width / scale
  const natural = svg === null ? 0 : svg.viewBox.baseVal.width
  if (shown <= 0 || natural <= 0) return 1
  return zoomClamp(natural / shown)
}

/** 适应容器 = 完整显示（contain）：宽 / 高比例的较小者。 */
function zoomFitScale(state: ZoomState): number {
  const m = zoomMetrics(state)
  if (m === null) return 1
  return zoomClamp(Math.min(m.bw / m.sw, m.bh / m.sh))
}

/** 适应宽度 = 铺满（bw / sw），高度溢出时用户平移。 */
function zoomFillScale(state: ZoomState): number {
  const m = zoomMetrics(state)
  if (m === null) return 1
  return zoomClamp(m.bw / m.sw)
}

/** 事件里的指针 / 手势中心（client 坐标）；拿不到有限坐标 → null（退回元素中心为锚）。 */
function zoomPointOf(event: unknown): ZoomPoint | null {
  const e = event as { clientX?: number; clientY?: number }
  const x = typeof e.clientX === 'number' ? e.clientX : NaN
  const y = typeof e.clientY === 'number' ? e.clientY : NaN
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: x, y: y }
}

/** 以屏幕点为锚点缩放：优先引擎自带锚点 API；不支持 → false（调用方退回居中缩放）。 */
function zoomAnchored(state: ZoomState, scale: number, point: ZoomPoint | null): boolean {
  if (point === null) return false
  const pz = state.pz
  if (typeof pz.zoomToPoint === 'function') {
    const before = pz.getScale()
    try {
      // panzoom 4.6.2 的签名是 zoomToPoint(scale, event) —— scale 在前；传反时不抛错、只是不动。
      pz.zoomToPoint(scale, { clientX: point.x, clientY: point.y })
      if (Math.abs((pz.getScale() || 0) - before) > 1e-6) return true
    } catch (_e) {
      /* 落回退路径 */
    }
  }
  if (typeof pz.zoomAtPoint === 'function') {
    pz.zoomAtPoint(scale, point)
    return true
  }
  return false
}

/** 一档缩放比（滚轮 / 捏合共用）：deltaY < 0 = 放大。 */
function zoomStep(event: Event): number {
  return Number((event as WheelEvent).deltaY) < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
}

/** 裸 wheel 归页面（滚动陷阱）：只有 ctrlKey+wheel（捏合）或全屏态才缩放。 */
function zoomWheelShouldHandle(event: Event, scopeId: string): boolean {
  const wheel = event as WheelEvent
  return wheel.ctrlKey === true || zoomScopeIsFullscreen(scopeId)
}

/** 手动缩放（滚轮 / 捏合 / 键盘）：用户接管 → 退出 fitMode；有坐标则以该点为锚。 */
function zoomManual(state: ZoomState, next: number, point: ZoomPoint | null, animate: boolean): void {
  state.fitMode = false
  if (!zoomAnchored(state, next, point)) state.pz.zoom(next, { animate: animate })
  refreshZoomLabel(state)
}

/** fitMode 下的重算（全屏 / 容器尺寸变化）：比例没变就不写变换，避免观察器自激。 */
function zoomRefitIfFit(state: ZoomState): void {
  if (!state.fitMode) return
  const next = zoomFitScale(state)
  if (Math.abs(next - state.pz.getScale()) <= next * 0.005) return
  state.pz.zoom(next, { animate: false })
  zoomCenterInFrame(state)
  refreshZoomLabel(state)
}

/** 事件解绑闭包（document / window / 元素通用）。 */
function zoomListen(target: EventTarget, type: string, fn: () => void): () => void {
  target.addEventListener(type, fn)
  return () => {
    if (typeof target.removeEventListener === 'function') target.removeEventListener(type, fn)
  }
}

/** ResizeObserver 最小契约（构造签名与浏览器一致，便于测试注入桩）。 */
interface ZoomResizeObserverCtor {
  new (callback: () => void): { observe: (target: Element) => void; disconnect: () => void }
}

/** fitMode 的「跟随容器」：全屏切换 / 容器尺寸变化时重算 fit（保持态）。 */
function bindFitFollow(state: ZoomState): () => void {
  const refit = (): void => zoomRefitIfFit(state)
  const win = typeof window === 'undefined' ? undefined : window
  const doc = typeof document === 'undefined' ? undefined : document
  const unbinds: Array<() => void> = []
  if (doc !== undefined && typeof doc.addEventListener === 'function') {
    unbinds.push(zoomListen(doc, 'fullscreenchange', refit))
  }
  const RO =
    win === undefined ? undefined : (win as unknown as { ResizeObserver?: ZoomResizeObserverCtor }).ResizeObserver
  if (typeof RO === 'function') {
    const ro = new RO(refit)
    ro.observe(state.frame)
    unbinds.push(() => ro.disconnect())
  } else if (win !== undefined && typeof win.addEventListener === 'function') {
    unbinds.push(zoomListen(win, 'resize', refit))
  }
  return () => {
    for (const off of unbinds) off()
  }
}

/** 缩放键（+ / - / = / _ / 0）；拆出来压圈复杂度。 */
function zoomScaleKey(state: ZoomState, key: string): boolean {
  const factor = key === '+' || key === '=' ? ZOOM_STEP : key === '-' || key === '_' ? 1 / ZOOM_STEP : 0
  if (factor > 0) {
    zoomManual(state, state.pz.getScale() * factor, null, true)
    return true
  }
  if (key !== '0') return false
  state.fitMode = false // 0 = 位移与比例一并复位（真正的复位；适应交给按钮 / 双击）
  state.pz.reset({ animate: false })
  refreshZoomLabel(state)
  return true
}

/** 方向键平移（拆出来压圈复杂度）。 */
function zoomArrowKey(state: ZoomState, key: string): boolean {
  const dx = key === 'ArrowLeft' ? PAN_KEY_STEP : key === 'ArrowRight' ? -PAN_KEY_STEP : 0
  const dy = key === 'ArrowUp' ? PAN_KEY_STEP : key === 'ArrowDown' ? -PAN_KEY_STEP : 0
  if (dx === 0 && dy === 0) return false
  state.fitMode = false
  state.pz.pan(dx, dy, { animate: false, relative: true })
  return true
}

/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移（Esc 由原生 dialog 负责）。 */
function zoomKey(box: Element, event: ZoomKeyEvent): void {
  const state = zoomStates.get(box)
  if (state === undefined) return
  const key = String(event.key ?? '')
  if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key)) return
  if (typeof event.preventDefault === 'function') event.preventDefault()
}

/** 刷新百分比标签（同一作用域内的 − 100% + 分段）。 */
function refreshZoomLabel(state: ZoomState): void {
  const label = state.root.querySelector('.mdr-mm-zoom-val')
  if (label === null) return
  const apply = (): void => {
    label.textContent = Math.round((state.pz.getScale() || 1) * 100) + '%'
  }
  apply()
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame
  if (typeof raf === 'function') raf(apply)
}

/** 工具条 / 菜单动作：fit = 适应容器（保持态）/ fill = 适应宽度 / full = 100% / in / out。 */
function applyZoom(state: ZoomState, action: string): void {
  if (action === 'fit') {
    state.fitMode = true
    state.pz.zoom(zoomFitScale(state), { animate: false })
    zoomCenterInFrame(state)
  } else if (action === 'fill') {
    state.fitMode = false
    state.pz.zoom(zoomFillScale(state), { animate: false })
    zoomCenterInFrame(state)
  } else if (action === 'full') {
    state.fitMode = false
    state.pz.zoom(zoomNaturalScale(state), { animate: false })
    zoomCenterInFrame(state)
  } else {
    state.fitMode = false
    state.pz.zoom(state.pz.getScale() * (action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP), { animate: true })
  }
  refreshZoomLabel(state)
}

/** 双击 = 「适应 ↔ 实际大小」切换（按 fitMode 状态判断，不按比例接近度判断）。 */
function zoomToggle(state: ZoomState): void {
  applyZoom(state, state.fitMode ? 'full' : 'fit')
}
