// ── 「渲染为…」语言手动切换（issue #470 需求 4）───────────────────────────
// 语言自动判定在真实宿主会误判（banner 只给本地化标签「代码块」），用户需要显式纠正手段：
// 块内（已是图表卡片时改在卡片头）追加**自有**控件，写块级覆盖 data-dsh-md-render-lang-force，
// 由 block-lang.ts 的 resolveFenceLangEx 在**最前面**读取。
// 口径：「用户显式意图 != 猜语言」—— 只在用户点过之后生效，不参与任何自动判定。
// 成本（已知情并接受）：原本零注入的块现在每块多一个自有节点；入口 hover 才显示，但**必须**
// 同时支持键盘 focus-within 与触屏常显（@media (hover:none)），只做 hover 手机点不到。
// 已是卡片时不再注入块内控件。视觉语言复用 ViewToggle 类，不引第二套。

/** 控件容器类名 + 块级标记（自有 DOM；块级标记兼作 hover 作用域）。 */
const LANG_SWITCH_CLASS = 'dsh-md-render-lang-switch'
const LANG_SWITCH_ATTR = 'data-dsh-md-render-lang-switch'
/** ViewToggle 的既有类名（复用视觉语言，不新增一套按钮样式）。 */
const LANG_SWITCH_BTN = 'dsh-md-render-mermaid-vt'
const LANG_SWITCH_GROUP = 'dsh-md-render-mermaid-view-toggle'
/** 控件已渲染的值（没变就不重建 DOM）。 */
const langSwitchRendered = new WeakMap<Element, string>()

function peekFenceLang(block: Element): FenceLangResult {
  const local = fenceLangOf(block)
  if (local !== undefined) return { lang: local, confirmed: true }
  const dom = blockLangDomLang(block)
  return { lang: dom !== '' && LANG_TOKEN_RE.test(dom) ? dom : '', confirmed: false }
}

/** 当前有效渲染方式（手动覆盖优先；`'' + confirmed` = 确证无语言）。 */
function langSwitchValue(block: Element): string {
  const forced = fenceForceOf(block)
  if (forced !== undefined) return forced
  // 已接管的块按**观察到的状态**判定（卡片 host / 自有容器在），零额外判定。
  if (mermaidMounts.has(block)) return 'mermaid'
  if (block.querySelector('div.' + BLOCK_MD_CLASS) !== null) return 'markdown'
  // 自研代码块视图：三态控件里没有对应选项 → 三个按钮都不激活（自动判定为「代码」）。
  if (block.querySelector('div.' + CODE_HOST_CLASS) !== null) return 'code'
  const peek = peekFenceLang(block)
  if (MERMAID_FENCE_LANGS.includes(peek.lang)) return 'mermaid'
  if (TEXT_FENCE_LANGS.includes(peek.lang) || (peek.lang === '' && peek.confirmed)) return 'markdown'
  return 'source'
}

/** 该块是否该有块内控件：渲染容器内 / 已是卡片 / 流式块都不管。 */
function langSwitchEnabled(block: Element): boolean {
  if (isInsideRenderedMarkdown(block)) return false
  if (mermaidMounts.has(block)) return false
  return !(block.closest && block.closest('[data-streaming]'))
}

/** 移除块内控件（卡片挂载时调用；卡片头自带另外两项）。 */
function removeLangSwitch(block: Element): void {
  const group = block.querySelector('div.' + LANG_SWITCH_CLASS)
  if (group !== null && group.parentNode) group.parentNode.removeChild(group)
  if (typeof block.removeAttribute === 'function') block.removeAttribute(LANG_SWITCH_ATTR)
}

/** 切换渲染方式：写覆盖 -> 拆掉现接管方 -> 重扫重建（幂等）。 */

function applyLangForce(block: Element, value: string): void {
  setFenceForce(block, value)
  clearFenceView(block)
  // 视图属性也必须一起清：否则块停在接管视图，官方内容被自有 CSS 藏住 → 空块。
  if (typeof block.removeAttribute === 'function') block.removeAttribute(BLOCK_VIEW_ATTR)
  const mounted = mermaidMounts.get(block)
  if (mounted !== undefined) unmountCard(block, mounted)
  syncLangSwitch(block)
  rescanForLangs()
}

/** 选项图标（共享图标集名）：「渲染为」三项各自的标识 —— 文字收起后它必须还在。 */
const LANG_SWITCH_ICONS: Record<string, string> = { mermaid: 'chart', markdown: 'markdown', source: 'code' }

/** 按名取共享图标（查不到退回 code，绝不返回空按钮）。 */
function langSwitchIcon(name: string, size: number): unknown {
  const make = icon[name]
  return typeof make === 'function' ? make(size) : icon.code(size)
}

/** 单个选项按钮（块内版）：文字走 data-dsh-md-render-tip 悬停浮层，图标 React 渲染进按钮
 *  （按钮自身是命令式 DOM，子节点归 React —— 所以**不能**再手改 textContent）。 */
function langSwitchButton(block: Element, option: { value: string; label: string }, value: string): Element {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = value === option.value ? LANG_SWITCH_BTN + ' ' + LANG_SWITCH_BTN + '-active' : LANG_SWITCH_BTN
  const tip = '渲染为' + option.label
  btn.setAttribute('aria-label', tip)
  btn.setAttribute('data-dsh-md-render-tip', tip)
  btn.setAttribute('aria-pressed', value === option.value ? 'true' : 'false')
  renderNodeInto(btn, langSwitchIcon(LANG_SWITCH_ICONS[option.value] ?? 'code', 14))
  btn.addEventListener('click', () => applyLangForce(block, option.value))
  return btn
}

/** 同步块内「渲染为…」控件（幂等；不该有控件时去掉）。 */
function syncLangSwitch(block: Element): void {
  if (typeof block.querySelectorAll !== 'function') return
  if (!langSwitchEnabled(block)) {
    removeLangSwitch(block)
    return
  }
  const value = langSwitchValue(block)
  const existing = block.querySelector('div.' + LANG_SWITCH_CLASS)
  if (existing !== null) {
    if (langSwitchRendered.get(existing) === value) return
    if (existing.parentNode) existing.parentNode.removeChild(existing)
    langSwitchRendered.delete(existing)
  }
  const group = document.createElement('div')
  group.className = LANG_SWITCH_CLASS + ' ' + LANG_SWITCH_GROUP
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', '渲染为')
  for (const option of FENCE_FORCE_OPTIONS) group.appendChild(langSwitchButton(block, option, value))
  block.appendChild(group)
  langSwitchRendered.set(group, value)
  block.setAttribute(LANG_SWITCH_ATTR, value)
}

/** 扫描 root（自身 / 后代）内的围栏代码块，同步各自的语言控件。 */
function scanLangSwitches(root: Element): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  if (typeof root.matches === 'function' && root.matches('div.md-code-block')) syncLangSwitch(root)
  for (const block of root.querySelectorAll('div.md-code-block')) syncLangSwitch(block)
}

// 卡片头的 CardLangSwitch 已删除（用户口径「外面有的，里面就别有了」）：它的
// 「渲染为 Markdown / 源码」与卡片头常驻的「预览 / 代码」是同一意图的两套入口。
// 块内控件（langSwitchButton 那套）保留 —— 它是**语言误判后的纠正入口**，代码块没有别的切换手段。

exports.LANG_SWITCH_CLASS = LANG_SWITCH_CLASS
exports.LANG_SWITCH_ATTR = LANG_SWITCH_ATTR
exports.langSwitchValue = langSwitchValue
exports.peekFenceLang = peekFenceLang
exports.syncLangSwitch = syncLangSwitch
exports.scanLangSwitches = scanLangSwitches
exports.removeLangSwitch = removeLangSwitch
exports.applyLangForce = applyLangForce
