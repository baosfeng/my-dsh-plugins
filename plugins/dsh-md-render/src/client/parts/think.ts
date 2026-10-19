// ── 思考块默认展开（B 路）：宿主折叠态派发一次官方 click ──────────────────
// 契约决策（leader 已拍板）：**接受宿主渲染**。宿主折叠时内容不在 DOM（`{open && children}`），
// 自绘思考块拿不到内容；唯一不改宿主节点、不改样式的手段是对官方折叠行派发一次真实
// click，让官方自己的 React 状态机切到展开态（外观 / DOM / 动画 / a11y 全走官方）。
//
// 纪律与护栏：
//  - 只读官方自身属性（`[data-variant="think"] [data-disclosure-row][aria-expanded]`），
//    不写官方元素的 style / class / aria；
//  - 只对 `aria-expanded="false"` 的行动作；WeakSet 保证每行**一次性**动作
//    （用户之后手动折叠，永不再碰）；
//  - 选择器失配 / click 抛错 → 静默降级为官方默认（折叠），不影响其它渲染；
//  - 单次最多处理 MAX_THINK_ROWS_PER_SCAN 行（性能护栏）。

/** 官方思考行定位选择器（只用官方自身属性）。 */
const THINK_ROW_SELECTOR = '[data-variant="think"] [data-disclosure-row][aria-expanded]'
/** 官方思考容器选择器（先短路再查行，避免每批对全文档跑属性选择器）。 */
const THINK_ROOT_SELECTOR = '[data-variant="think"]'
/** 单次扫描处理的行数上限（性能护栏）。 */
const MAX_THINK_ROWS_PER_SCAN = 200

/** 已由本模块处理过的行（一次性动作；WeakSet 不阻止 GC）。 */
const handledThinkRows = new WeakSet<Element>()

/** 派发一次官方点击（契约守卫：抛错即静默放弃，绝不影响其它渲染）。 */
function expandThinkRow(row: Element): void {
  try {
    const click = (row as HTMLElement).click
    if (typeof click === 'function') click.call(row)
  } catch (_e) {
    /* 官方契约变化 → 静默降级为官方默认（折叠） */
  }
}

/** 在指定根内枚举思考行（scanner 传入新增节点，省一次全文档查询）。 */
function rootRowsOf(root: Element): Element[] {
  const out: Element[] = []
  try {
    const rows = root.querySelectorAll(THINK_ROW_SELECTOR)
    for (let i = 0; i < rows.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1) out.push(rows[i])
  } catch (_e) {
    return []
  }
  return out
}

/** 在文档内枚举折叠中的思考行（契约守卫：任何 DOM 异常都静默返回空数组）。 */
function thinkRowsOf(): Element[] {
  if (typeof document === 'undefined' || document === null) return []
  if (typeof document.querySelectorAll !== 'function') return []
  const out: Element[] = []
  try {
    const rows = document.querySelectorAll(THINK_ROW_SELECTOR)
    for (let i = 0; i < rows.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1) out.push(rows[i])
  } catch (_e) {
    return []
  }
  return out
}

/**
 * 扫描文档内的官方思考行：新见到的、仍折叠的行派发一次 click。
 * 开关关闭（thinking.defaultExpanded=false）/ 已处理过 / 已展开 / 契约失配 → 一律不动。
 */
function applyThinkExpand(root?: Element): void {
  if (!renderOptions.thinking.defaultExpanded) return
  const scoped = root !== undefined && root !== null && typeof root.querySelectorAll === 'function'
  for (const row of scoped ? rootRowsOf(root as Element) : thinkRowsOf()) {
    if (handledThinkRows.has(row)) continue
    handledThinkRows.add(row)
    if (row.getAttribute('aria-expanded') !== 'false') continue
    expandThinkRow(row)
  }
}

exports.THINK_ROW_SELECTOR = THINK_ROW_SELECTOR
exports.THINK_ROOT_SELECTOR = THINK_ROOT_SELECTOR
exports.MAX_THINK_ROWS_PER_SCAN = MAX_THINK_ROWS_PER_SCAN
exports.applyThinkExpand = applyThinkExpand
