// ── 思考块默认展开（DOM 层派发官方点击，路径 C）─────────────────────────
// 官方没有任何「思考默认展开」的设置或扩展点：
//  - 折叠态摘要不是 markdown，展开内容才是（官方 ReasoningRow 内部已用
//    MarkdownText variant="compact" 渲染 —— 思考 markdown 渲染**官方默认已具备**）；
//  - 折叠时内容**不在 DOM**（DisclosureRow 的 {open && children}）→ 设属性
//    （data-expanded / details.open）只能得到空的 24px 行，永远看不到内容；
//  - 唯一不接管节点、不改样式的手段是**对官方折叠行派发一次真实 click**，
//    让官方自己的 React 状态机切到展开态（外观 / DOM 结构 / 动画 / a11y 全走官方）。
//
// 硬约束遵守：
//  - 不注册任何 conversation.chat.node 节点级 seat（尤其 assistant-step）；
//  - 不写官方元素的 style / class / aria（本模块只调用 `row.click()`）；
//  - **契约守卫 + 静默降级**：选择器失配（官方改属性名 / 改结构）→ 退回官方默认，
//    不抛错、不写任何 DOM、不影响其它渲染能力；
//  - **性能护栏**：只在新增节点内定位 think 容器（`matchesThinkRoot` 短路），
//    避免每批都对全文档跑属性选择器；`WeakSet` 保证每个元素**一次性动作**
//    （幂等：用户手动折叠后我们永不再碰它；observer 自激也会被集合挡住）。

/** 官方思考行定位选择器（只用官方自身属性，不新增任何 class / style）。 */
const THINK_ROW_SELECTOR = '[data-variant="think"] [data-disclosure-row][aria-expanded]'
/** 官方思考容器选择器（性能护栏：先短路，再在容器内查行）。 */
const THINK_ROOT_SELECTOR = '[data-variant="think"]'
/** 单次扫描处理的行数上限（性能护栏：一次批次最多派发这么多次 click）。 */
const MAX_THINK_ROWS_PER_SCAN = 200

/** 已由本模块处理过的行（一次性动作；WeakSet 不阻止 GC）。 */
const handledThinkRows = new WeakSet<Element>()

/** 元素是否为思考容器，或包含思考容器（性能护栏短路条件）。 */
function hasThinkRoot(el: Element): boolean {
  if (typeof el.matches !== 'function') return false
  try {
    return el.matches(THINK_ROOT_SELECTOR) || el.querySelector(THINK_ROOT_SELECTOR) !== null
  } catch (_e) {
    return false
  }
}

/** 在 root 内枚举思考行（契约守卫：任何 DOM 异常都静默返回空数组）。 */
function thinkRowsIn(root: Element): Element[] {
  try {
    const out: Element[] = []
    if (typeof root.matches === 'function' && root.matches(THINK_ROW_SELECTOR)) out.push(root)
    const found = root.querySelectorAll(THINK_ROW_SELECTOR)
    for (let i = 0; i < found.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1) out.push(found[i])
    return out
  } catch (_e) {
    return []
  }
}

/** 派发一次官方点击（契约守卫：抛错即静默放弃，绝不影响其它渲染）。 */
function expandThinkRow(row: Element): void {
  try {
    const click = (row as HTMLElement).click
    if (typeof click !== 'function') return
    click.call(row)
  } catch (_e) {
    /* 官方契约变化 → 静默降级为官方默认（折叠） */
  }
}

/**
 * 扫描 root（自身 / 后代）内的官方思考行：新见到的、仍折叠的行派发一次 click。
 * 开关关闭 / 已处理过 / 已展开 / 契约失配 → 一律不动（完全保持官方默认）。
 */
function applyThinkExpand(root: Element): void {
  if (!renderOptions.thinking.defaultExpanded) return
  if (!hasThinkRoot(root)) return
  for (const row of thinkRowsIn(root)) {
    if (handledThinkRows.has(row)) continue
    handledThinkRows.add(row)
    // 已展开（用户手动展开 / 官方默认展开）→ 不碰；只对 aria-expanded="false" 动作。
    if (row.getAttribute('aria-expanded') !== 'false') continue
    expandThinkRow(row)
  }
}

exports.THINK_ROW_SELECTOR = THINK_ROW_SELECTOR
exports.applyThinkExpand = applyThinkExpand
