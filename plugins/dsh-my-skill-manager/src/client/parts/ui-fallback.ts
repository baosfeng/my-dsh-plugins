// ── ui-fallback: 官方 UI 组件库的逐项兜底（结构性缺陷修复）───────────────
// 旧写法只把 require 包进 try/catch —— 它包得住「模块不存在」，**包不住
// 单个导出不存在**：require 成功 ≠ 每个 ui.X 都存在。
//   · DSH ≤ 0.1.5：@deepseek-ai/dsh-client-ui-primitives 在宿主 staticModules
//     里不存在 → require 抛错 → ui = null，整块走本地渲染路径（当时不崩）。
//   · DSH 0.1.7-rc.2：该包真实存在（version 0.1.7-rc.2）→ require 成功 →
//     首次真正进入官方组件路径；而下列带「尺寸后缀」的图标导出在该版本中
//     并不存在（官方图标导出名是 IconXxxOutlineMedium / IconXxxOutlineRegular）：
//       IconRefreshOutline14【0.1.7 缺失】
//     createElement(undefined) → React error #130（"Element type is invalid …
//     got: undefined"）→ settings.plugins.tab 整块内容区白屏。
// 修复原则：**逐项兜底**——官方存在且是组件就用官方，缺失/非法则用本插件已有
// 的本地实现顶上（图标复用 dsh-shared 的 icon 集，原子组件用本地等价实现）；
// ui 为 null（旧降级路径）时同样得到完整可用的表，语义不劣化。
// 防回归：test/client-render.mjs 用「只暴露宿主真实导出」的 stub 渲染，
// 并断言渲染树中不存在 undefined 元素类型。

/** React 可渲染组件判定：函数，或 memo / forwardRef / lazy 这类带 $$typeof 的对象。 */
function isUiComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && typeof (value as { $$typeof?: symbol }).$$typeof === 'symbol'
}

/** 官方图标缺失时的本地兜底：把 dsh-shared 的图标图形包成组件。
 *  统一渲染 inline-flex 包裹层——className（如加载旋转动画）与
 *  data-ui-icon 标记都挂在包裹层，便于样式与防回归测试断言「本地兜底生效」。 */
function uiIconFallback(glyph: (size: number) => unknown, size: number, name: string) {
  return function UiIconFallback(props?: { className?: string }): unknown {
    const wrapperProps: Record<string, unknown> = {
      'data-ui-icon': `local:${name}`,
      style: { display: 'inline-flex', alignItems: 'center' },
    }
    if (props && typeof props.className === 'string') wrapperProps.className = props.className
    return createElement('span', wrapperProps, glyph(size))
  }
}

/** 官方 Pill 缺失时的本地兜底：胶囊标签（className 透传，active 加粗）。 */
function UiPillFallback(props?: Record<string, unknown>): unknown {
  const { active, className, children, ...rest } = props ?? {}
  const rootProps: Record<string, unknown> = { ...rest }
  if (typeof className === 'string') rootProps.className = className
  if (active === true) rootProps.style = { fontWeight: 600 }
  return createElement('span', rootProps, children)
}

/** 官方 Button 缺失时的本地兜底：<button type=button>，icon 与文字并列。 */
function UiButtonFallback(props?: Record<string, unknown>): unknown {
  const { variant: _variant, size: _size, icon, children, ...rest } = props ?? {}
  return createElement('button', { type: 'button', ...rest }, icon, children)
}

/** 官方组件表 → 安全表：本插件的每个 ui.X 取用点逐项兜底。 */
function normalizeUi(raw: unknown): Record<string, unknown> {
  const official = (raw ?? {}) as Record<string, unknown>
  return {
    ...official,
    Button: isUiComponent(official.Button) ? official.Button : UiButtonFallback,
    Pill: isUiComponent(official.Pill) ? official.Pill : UiPillFallback,
    IconRefreshOutline14: isUiComponent(official.IconRefreshOutline14)
      ? official.IconRefreshOutline14
      : uiIconFallback(icon.refresh, 14, 'refresh'),
  }
}

ui = normalizeUi(ui)
