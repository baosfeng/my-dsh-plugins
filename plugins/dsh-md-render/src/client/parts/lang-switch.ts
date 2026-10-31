// ── 「渲染为…」三态控件（B 路）：图表 / Markdown / 源码 ───────────────────
// 视觉真源 = 原型 .render-mode（1565–1619）：分段外框 padding 2 / 6px 圆角，
// 按钮高 22 / padding 0 8 / 10.5px，当前态用 .is-active。
//
// 通信契约：控件本身不拥有块状态 —— 点击时在最近的 div.md-code-block 上派发
// `mdr-lang-switch` CustomEvent（detail.value = diagram|markdown|source），由
// block-render.ts 的监听器改写块视图（单一事实源留在块上，控件可安全多挂）。
//
// 三种渲染方式与旧覆盖层（block-lang.ts 的 data-dsh-md-render-lang-force）的映射：
//   diagram → mermaid（交给图表卡片）· markdown → markdown · source → source（宿主原样）。

/** 控件类名 / 选项属性 / 事件名。 */
const MDR_RM_CLASS = 'mdr-rm'
const MDR_RM_BTN_CLASS = 'mdr-rm-btn'
const MDR_SWITCH_EVENT = 'mdr-lang-switch'
const MDR_SWITCH_OPTION_ATTR = 'data-mdr-option'
/** 块内控件容器类名（旧调用面 syncLangSwitch 使用）。 */
const LANG_SWITCH_CLASS = 'mdr-lang-switch'

/** 三种渲染方式（值与原型 data-mm-mode 同构：diagram / markdown / source）。 */
const MDR_RENDER_OPTIONS: readonly { value: string; label: string; iconName: string }[] = [
  { value: 'diagram', label: '图表', iconName: 'chart' },
  { value: 'markdown', label: 'Markdown', iconName: 'markdown' },
  { value: 'source', label: '源码', iconName: 'code' },
]

/** 取共享图标（查不到退回 code，绝不返回空按钮）。 */
function mdrRenderIcon(name: string, size: number): unknown {
  const make = (icon as Record<string, unknown>)[name]
  return typeof make === 'function' ? (make as (n: number) => unknown)(size) : icon.code(size)
}

/** 事件目标最近的围栏块（选择器不成立 / 抛错 → null）。 */
function mdrBlockOfTarget(target: unknown): { setAttribute?: unknown; dispatchEvent?: unknown } | null {
  const el = target as { closest?: (selector: string) => unknown } | null
  if (el === null || el === undefined || typeof el.closest !== 'function') return null
  try {
    return el.closest('div.md-code-block') as { setAttribute?: unknown; dispatchEvent?: unknown } | null
  } catch (_e) {
    return null
  }
}

/** 派发切换事件（构造失败 → 静默：块视图保持原样）。 */
function mdrEmitSwitch(host: { dispatchEvent?: unknown }, value: string): void {
  try {
    const event =
      typeof CustomEvent === 'function' ? new CustomEvent(MDR_SWITCH_EVENT, { bubbles: true, detail: { value } }) : null
    if (event !== null && typeof host.dispatchEvent === 'function') (host.dispatchEvent as (e: unknown) => void)(event)
  } catch (_e) {
    /* 事件构造失败 → 静默（块视图不变） */
  }
}

/** 点击 → 在最近的 div.md-code-block 上派发切换事件（契约守卫：无块 / 无 API 即静默）。 */
function mdrDispatchLangSwitch(target: unknown, value: string): void {
  const host = mdrBlockOfTarget(target)
  if (host === null || host === undefined || typeof host.dispatchEvent !== 'function') return
  if (typeof host.setAttribute === 'function') host.setAttribute('data-mdr-switch', value)
  mdrEmitSwitch(host, value)
}

/**
 * 渲染方式控件（内部通用形态；current 可为 'code' 表示「不是三态之一」，
 * 此时三个按钮都不激活，如实反映自动判定结果）。
 */
function MdrLangSwitchFrom(props: { current: string }): unknown {
  const current = typeof props.current === 'string' ? props.current : ''
  const buttons: unknown[] = []
  for (const option of MDR_RENDER_OPTIONS) {
    const active = current === option.value
    buttons.push(
      createElement(
        'button',
        {
          key: option.value,
          type: 'button',
          className: MDR_RM_BTN_CLASS + (active ? ' is-active' : ''),
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': '渲染为' + option.label,
          'data-mdr-tip': '渲染为' + option.label,
          [MDR_SWITCH_OPTION_ATTR]: option.value,
          onClick: (event: unknown) =>
            mdrDispatchLangSwitch(
              event === null || event === undefined ? null : (event as { currentTarget?: unknown }).currentTarget,
              option.value,
            ),
        },
        mdrRenderIcon(option.iconName, 11),
        createElement('span', null, option.label),
      ),
    )
  }
  return createElement('span', { className: MDR_RM_CLASS, role: 'group', 'aria-label': '渲染为' }, ...buttons)
}

/** 「渲染为…」三态控件（契约导出）：props = { current: 'diagram' | 'markdown' | 'source' }。 */
function MdrLangSwitch(props: { current: 'diagram' | 'markdown' | 'source' }): unknown {
  return MdrLangSwitchFrom({ current: props.current })
}

/** 块的当前渲染方式（读块上的视图 / 覆盖标记；无法判定 → source）。 */
function langSwitchValue(block: Element): string {
  if (typeof block.getAttribute !== 'function') return 'source'
  const view = block.getAttribute('data-mdr-view')
  if (view === 'markdown' || view === 'code' || view === 'source') return view
  const forced = fenceForceOf(block)
  if (forced === 'mermaid') return 'diagram'
  if (forced === 'markdown') return 'markdown'
  if (forced === 'source') return 'source'
  return 'source'
}

/**
 * 块是否该有块内控件：自建视图（代码卡 / markdown 卡 / 图表卡）的底栏与卡片头
 * 已经各自带了三态控件，这里不再重复注入（「外面有的，里面就别有了」）；
 * 只给仍停在宿主形态、且不在流式中的块补一个入口。
 */
function langSwitchEnabled(block: Element): boolean {
  if (typeof block.getAttribute !== 'function') return false
  if (block.getAttribute('data-mdr-view') !== null) return false
  if (block.closest && block.closest('[data-streaming]')) return false
  if (typeof block.querySelector === 'function') {
    if (block.querySelector('div.mdr-block') !== null) return false
    if (block.querySelector('[data-mdr-mermaid]') !== null) return false
  }
  return true
}

/** 移除块内控件（卡片挂载时调用；卡片头自带另外一项）。 */
function removeLangSwitch(block: Element): void {
  if (typeof block.querySelector !== 'function') return
  const group = block.querySelector('div.' + LANG_SWITCH_CLASS)
  if (group !== null && group.parentNode) group.parentNode.removeChild(group)
  if (typeof block.removeAttribute === 'function') block.removeAttribute('data-mdr-lang-switch')
}

/** 同步块内「渲染为…」控件（幂等；渲染层不可用 / 不该有控件时移除）。 */
function syncLangSwitch(block: Element): void {
  if (typeof block.querySelector !== 'function') return
  if (!langSwitchEnabled(block) || !domRootAvailable()) {
    removeLangSwitch(block)
    return
  }
  const current = langSwitchValue(block)
  const existing = block.querySelector('div.' + LANG_SWITCH_CLASS)
  if (existing !== null) {
    if (existing.getAttribute('data-mdr-current') === current) return
    if (existing.parentNode) existing.parentNode.removeChild(existing)
  }
  const group = document.createElement('div')
  group.className = LANG_SWITCH_CLASS
  group.setAttribute('data-mdr-current', current)
  if (!renderNodeInto(group, createElement(MdrLangSwitchFrom, { current }))) return
  block.appendChild(group)
  if (typeof block.setAttribute === 'function') block.setAttribute('data-mdr-lang-switch', current)
}

/** 切换渲染方式：写覆盖标记 → 清本块自建视图 → 重扫（幂等）。 */
function applyLangForce(block: Element, value: string): void {
  const forced = value === 'diagram' || value === 'mermaid' ? 'mermaid' : value === 'markdown' ? 'markdown' : 'source'
  setFenceForce(block, forced)
  clearMdrBlock(block)
  if (typeof block.removeAttribute === 'function') block.removeAttribute('data-mdr-view')
  removeLangSwitch(block)
  if (typeof rescanForLangs === 'function') rescanForLangs()
}

/**
 * 扫描 root（自身 / 后代）内的围栏代码块，同步各自的语言控件。
 *
 * **增量渲染**：登记在 'lang' 键上，与同一块的 'fence' / 'mermaid' 回调按登记顺序执行
 * （scanner 的调用顺序保证卡片先挂、控件后同步）。
 */
function scanLangSwitches(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches('div.md-code-block')) {
    const self = root
    enqueueWhenVisible(self, 'lang', () => syncLangSwitch(self))
  }
  for (const block of Array.from(root.querySelectorAll('div.md-code-block'))) {
    enqueueWhenVisible(block, 'lang', () => syncLangSwitch(block))
  }
}

exports.LANG_SWITCH_CLASS = LANG_SWITCH_CLASS
exports.MDR_RM_CLASS = MDR_RM_CLASS
exports.MDR_RM_BTN_CLASS = MDR_RM_BTN_CLASS
exports.MDR_SWITCH_EVENT = MDR_SWITCH_EVENT
exports.MDR_RENDER_OPTIONS = MDR_RENDER_OPTIONS
exports.mdrDispatchLangSwitch = mdrDispatchLangSwitch
exports.MdrLangSwitchFrom = MdrLangSwitchFrom
exports.MdrLangSwitch = MdrLangSwitch
exports.langSwitchValue = langSwitchValue
exports.syncLangSwitch = syncLangSwitch
exports.removeLangSwitch = removeLangSwitch
exports.applyLangForce = applyLangForce
exports.scanLangSwitches = scanLangSwitches
