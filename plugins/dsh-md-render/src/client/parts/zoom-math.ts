// ── 缩放几何：适应容器（contain）与「实际大小 100%」的比例计算 ────────────
// 从 mermaid-zoom.ts 拆出（单文件行数门禁 ≤400）。两者都量**裁剪容器**而非变换层：
// 变换层高度由内容决定（扁图如 flowchart LR `X-->Y` 仅约 50px），拿它当可用空间会让
// contain 恒为 1 —— 那正是「图永远放不大」的根因（真机实测：容器 160 vs 变换层 50）。

/** 100% = 图表真实像素大小：viewBox 宽 ÷ 未缩放的显示宽（适应容器后两者不等）。 */
function zoomNaturalScale(state: ZoomState): number {
  const svg = state.box.querySelector('svg')
  const scale = state.pz.getScale() || 1
  const shown = svg === null ? 0 : svg.getBoundingClientRect().width / scale
  const natural = svg === null ? 0 : svg.viewBox.baseVal.width
  if (shown <= 0 || natural <= 0) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, natural / shown))
}

/** 适应 = 完整显示（contain）：按「容器尺寸 ÷ 图固有尺寸」取宽高比例的**较小**者。
 *  原先 fit 只是 reset 到 scale=1 —— 小图（如 flowchart LR `X-->Y` 仅 ~90px 宽）躺在
 *  上千像素的容器里，点「适应」毫无变化、点「+」一次也只放大 25%，用户感知就是「没反应」。 */
function zoomFitScale(state: ZoomState): number {
  const svg = state.box.querySelector('svg')
  if (svg === null) return 1
  // 量的必须是**裁剪容器**（frame），不是变换层：canvas 高度由内容决定（扁图如
  // flowchart LR `X-->Y` 仅 50px），拿它当可用空间算 contain 只会永远得到 1。
  const container = state.frame as { offsetWidth?: number; offsetHeight?: number }
  const bw = Number(container.offsetWidth ?? 0)
  const bh = Number(container.offsetHeight ?? 0)
  const scale = state.pz.getScale() || 1
  const rect = svg.getBoundingClientRect()
  const sw = rect.width / scale
  const sh = rect.height / scale
  if (bw <= 0 || bh <= 0 || sw <= 0 || sh <= 0) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(bw / sw, bh / sh)))
}
