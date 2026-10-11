// ── 缩放几何与策略：fit / fill / 100% 的基准比例、锚点手势、fitMode 跟随、快捷键动作 ──
// 从 mermaid-zoom.ts 拆出（单文件行数门禁 ≤400）。几何基准一律量**裁剪容器**（state.frame）
// 而非变换层：变换层高度由内容决定（扁图如 flowchart LR `X-->Y` 仅约 50px），拿它当可用空间
// 会让 contain 恒为 1 —— 那正是「图永远放不大」的根因（真机实测：容器 160 vs 变换层 50）。

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

/** 比例夹逼到引擎上下界（与 panzoom 构造参数同源）。 */
function zoomClamp(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/** 量容器与图固有尺寸；量不出（无 SVG / 容器未布局 / 尺寸为 0）→ null（调用方退回 1）。 */
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

/** 100% = 图表真实像素大小：viewBox 宽 ÷ 未缩放的显示宽（适应容器后两者不等）。 */
function zoomNaturalScale(state: ZoomState): number {
  const svg = state.box.querySelector('svg')
  const scale = state.pz.getScale() || 1
  const shown = svg === null ? 0 : svg.getBoundingClientRect().width / scale
  const natural = svg === null ? 0 : svg.viewBox.baseVal.width
  if (shown <= 0 || natural <= 0) return 1
  return zoomClamp(natural / shown)
}

/** 适应 = 完整显示（contain）：按「容器尺寸 ÷ 图固有尺寸」取宽高比例的**较小**者。
 *  原先 fit 只是 reset 到 scale=1 —— 小图（如 flowchart LR `X-->Y` 仅 ~90px 宽）躺在
 *  上千像素的容器里，点「适应」毫无变化、点「+」一次也只放大 25%，用户感知就是「没反应」。 */
function zoomFitScale(state: ZoomState): number {
  const m = zoomMetrics(state)
  if (m === null) return 1
  return zoomClamp(Math.min(m.bw / m.sw, m.bh / m.sh))
}

/** 铺满 = 适应宽度（PhotoSwipe 的 fill / Panzoom 的 cover）：bw / sw，保持宽高比。
 *  与 fit 只差**不**受高度约束 —— 宽图比「适应」更实用，高度溢出时用户拖动平移。 */
function zoomFillScale(state: ZoomState): number {
  const m = zoomMetrics(state)
  return m === null ? 1 : zoomClamp(m.bw / m.sw)
}

/** 事件里的指针 / 手势中心（client 坐标）；拿不到有限坐标 → null（退回以元素中心为锚）。 */
function zoomPointOf(event: unknown): ZoomPoint | null {
  const e = event as { clientX?: number; clientY?: number }
  const x = typeof e.clientX === 'number' ? e.clientX : NaN
  const y = typeof e.clientY === 'number' ? e.clientY : NaN
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** 以屏幕点为锚点缩放到 scale：优先用引擎自带的锚点 API（panzoom 4.6 的 zoomToPoint /
 *  降级引擎的 zoomAtPoint）；引擎不支持 → false（调用方退回以元素中心为锚的居中缩放）。 */
function zoomAnchored(state: ZoomState, scale: number, point: ZoomPoint | null): boolean {
  if (point === null) return false
  const pz = state.pz
  if (typeof pz.zoomToPoint === 'function') {
    const before = pz.getScale()
    try {
      // panzoom **4.6.2** 的签名是 zoomToPoint(**scale, event**) —— scale 在前。证据在库自身：
      // `function v(e,t,n,o){ … t.clientX … }`，而它的 `zoomWithWheel` 是 `v(h(…), e, t, e)`。
      // 较新版本才是 (point, scale)。传错顺序时它**不抛错、只是静默不动** —— 真机实测：
      // wheel 事件已到达且 preventDefault 了、console 零报错，transform 却纹丝不动。
      pz.zoomToPoint(scale, { clientX: point.x, clientY: point.y })
      // 调用后校验：签名不符 / 内部异常时它可能既不抛错也不生效 —— 没变就当没成功，
      // 让调用方回退到居中缩放。绝不把「锚点失败」放大成「整次缩放都不生效」。
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

/** 裸 wheel 归页面（滚动陷阱）：只有 ctrlKey+wheel（捏合）或浮窗态才缩放。 */
function zoomWheelShouldHandle(event: Event, card: Element): boolean {
  const wheel = event as WheelEvent
  return wheel.ctrlKey === true || card.getAttribute(FS_ATTR) === FS_OPEN
}

/** 手动缩放（滚轮 / 捏合 / 键盘）：退出 fitMode（用户接管后不再跟随容器），
 *  有指针坐标就以该点为锚点，否则以元素中心为锚。 */
function zoomManual(state: ZoomState, next: number, point: ZoomPoint | null, animate: boolean): void {
  state.fitMode = false
  if (!zoomAnchored(state, next, point)) state.pz.zoom(next, { animate })
  // 滚轮 / 捏合 / 键盘这条路径此前**从不刷新百分比标签**（锚点分支还会提前 return）——
  // 结果就是「缩放真的生效了、百分比纹丝不动」，用户据此判断成「点了没反应」
  // （真机实测：transform 已 scale(1.006→1.509) 且平移到锚点，pct 却仍显示 101%）。
  refreshZoomLabel(state)
}

/** fitMode 下的重算（全屏切换 / 容器尺寸变化）：比例没变就不写 transform，
 *  否则 ResizeObserver 与自身写入的变换会互相触发。 */
function zoomRefitIfFit(state: ZoomState): void {
  if (!state.fitMode) return
  const next = zoomFitScale(state)
  if (Math.abs(next - state.pz.getScale()) <= next * 0.005) return
  state.pz.zoom(next, { animate: false })
  refreshZoomLabel(state)
}

/** 事件解绑闭包（document / window / 元素通用）。 */
function zoomListen(target: EventTarget, type: string, fn: () => void): () => void {
  target.addEventListener(type, fn)
  return () => {
    // 伪 DOM / 残缺实现可能没有 removeEventListener：解绑失败不该让 teardown 抛错。
    if (typeof target.removeEventListener === 'function') target.removeEventListener(type, fn)
  }
}

/** ResizeObserver 最小契约（构造签名与浏览器一致，便于测试注入桩）。 */
interface ZoomResizeObserverCtor {
  new (callback: () => void): { observe: (target: Element) => void; disconnect: () => void }
}

/** fitMode 的「跟随容器」：全屏切换、以及容器尺寸变化（ResizeObserver；不可用退回
 *  window resize）时**重算 fit** —— draw.io 的 Fit Window 是保持态，不是一次性动作
 *  （真机实证：容器 1174×508 → 800×544 后图仍停在旧比例，全屏后缩在一角、大片空白）。 */
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
  state.fitMode = false // 0 = 位移与比例一并复位（真正的复位；适应交给「适应」按钮 / 双击）
  state.pz.reset({ animate: false })
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

/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移（Esc 由浮窗 dialog 的 cancel 负责）。 */
function zoomKey(card: Element, box: Element, event: ZoomKeyEvent): void {
  const state = zoomStates.get(box)
  if (state === undefined) return
  const key = String(event.key ?? '')
  if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key)) return
  if (typeof event.preventDefault === 'function') event.preventDefault()
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

/** 工具条 / 双击动作：fit = 适应容器（进入**保持态**跟随模式）/ fill = 铺满宽度 /
 *  full = 100% / in / out。除 fit 外都算用户手动接管 → 退出 fitMode。 */
function applyZoom(state: ZoomState, action: string): void {
  if (action === 'fit') {
    state.fitMode = true
    state.pz.zoom(zoomFitScale(state), { animate: false })
  } else if (action === 'fill') {
    state.fitMode = false
    state.pz.zoom(zoomFillScale(state), { animate: false })
  } else if (action === 'full') {
    state.fitMode = false
    state.pz.zoom(zoomNaturalScale(state), { animate: false })
  } else {
    state.fitMode = false
    state.pz.zoom(state.pz.getScale() * (action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP), { animate: true })
  }
  refreshZoomLabel(state)
}

/** 双击 = 「适应 ↔ 实际大小」切换（Panzoom 的 toggleZoom / viewer.js / lightGallery 同款语义）：
 *  正在跟随 fit → 去 100%；否则回到 fit。键盘 0 才是真正的复位。
 *
 *  **必须按状态判断，不能按「当前比例是否接近 fit 值」**：fit ≈ 100%（图接近 1:1）时，
 *  |1.00 − 1.011| = 0.011 落在任何容差内 → 两次双击都判「接近 fit」→ 永远切不回 fit
 *  （真机实测：101% --双击--> 100% --双击--> 100%）。 */
function zoomToggle(state: ZoomState): void {
  applyZoom(state, state.fitMode ? 'full' : 'fit')
}
