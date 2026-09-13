/**
 * release-timing.mjs — 发版流水线阶段耗时记录与渲染（issue #246）。
 *
 * 背景：发版是「一串阶段」而不是一次性动作，但原来没有任何耗时输出，只能靠人工
 * 掐表猜「慢在哪」。本模块把阶段耗时变成**发版输出的固定部分**：每次发版结束都打印
 * 各阶段实测毫秒数与占比，失败时能一眼看出卡在哪个阶段、失败点之前的阶段是否白跑。
 *
 * 设计取舍：
 *   - 纯数据 + 纯渲染，不碰 IO、不读时钟以外的东西（clock 可注入，便于单测）；
 *   - 表格按**显示宽度**对齐（中文占 2 列），否则中英混排的表格在终端里会歪；
 *   - 只记录，不判定——门禁通过与否由 release.mjs 负责，本模块绝不参与放行决策。
 */

/** 全角/宽字符区间（CJK、假名、全角标点、谚文等），终端里占 2 列。 */
const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/

/**
 * 终端显示宽度：宽字符计 2，其余计 1（用于表格对齐）。
 * @param {unknown} text
 * @returns {number}
 */
export function displayWidth(text) {
  let width = 0
  for (const ch of String(text ?? '')) width += WIDE_CHAR.test(ch) ? 2 : 1
  return width
}

/** 补空格到目标显示宽度（超宽不截断，避免丢信息）。 */
function padTo(text, width) {
  const value = String(text ?? '')
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)))
}

/**
 * 渲染定宽表格（中文按 2 列计算），行数/列数不匹配时按空串补齐。
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string} 多行文本（不含结尾换行）
 */
export function formatTable(headers, rows) {
  const head = headers.map((h) => String(h))
  const body = rows.map((row) => head.map((_, i) => String(row[i] ?? '')))
  const widths = head.map((h, i) => Math.max(displayWidth(h), ...body.map((r) => displayWidth(r[i])), 0))
  const render = (cells) =>
    '  ' +
    cells
      .map((c, i) => padTo(c, widths[i]))
      .join('  ')
      .trimEnd()
  const separator = '  ' + widths.map((w) => '─'.repeat(w)).join('  ')
  return [render(head), separator, ...body.map(render)].join('\n')
}

/** 毫秒取整（阶段耗时全部是整数毫秒，避免表格里出现 0.30000000000000004）。 */
const ms = (value) => Math.round(Number(value) || 0)

/**
 * 创建一条发版时间线。
 * @param {{ now?: () => number }} [options] now 注入时钟（默认 performance.now），便于单测
 * @returns {{
 *   mark: (name: string, durationMs: number, note?: string) => void,
 *   phase: <T>(name: string, fn: () => T | Promise<T>, note?: string) => Promise<T>,
 *   skip: (name: string, note?: string) => void,
 *   entries: () => Array<{name: string, ms: number, note: string, skipped: boolean}>,
 *   totalMs: () => number,
 *   format: (title?: string) => string,
 * }}
 */
export function createTimeline(options = {}) {
  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  const phases = []

  // 并发阶段是「重叠」的：只按完成顺序记录会让表格看起来像串行。因此每条记录都带上
  // 起始偏移 `start`，渲染时按 start 排序——表格顺序 = 流水线真实启动顺序。
  const push = (entry) => phases.push({ note: '', skipped: false, ...entry })

  const mark = (name, durationMs, note = '') => {
    push({ name: String(name), ms: ms(durationMs), note: String(note), start: ms(now() - startedAt) })
  }

  return {
    mark,
    async phase(name, fn, note = '') {
      const begin = now()
      const start = ms(begin - startedAt)
      try {
        return await fn()
      } finally {
        push({ name: String(name), ms: ms(now() - begin), note: String(note), start })
      }
    },
    /** 记录「本阶段被合法跳过」（形态豁免/显式跳过），与「没跑」区分开，避免表格撒谎。 */
    skip(name, note = '') {
      push({ name: String(name), ms: 0, note: String(note), skipped: true, start: ms(now() - startedAt) })
    },
    entries: () => phases.map((p) => ({ ...p })),
    totalMs: () => ms(now() - startedAt),
    /**
     * 渲染阶段耗时表：每行「阶段 / 耗时 / 占比 / 备注」，末尾一行合计。
     * 占比以 totalMs 为分母；totalMs 为 0 时占比显示 '-'（不产生 NaN）。
     */
    format(title = '流水线阶段耗时') {
      const total = ms(now() - startedAt)
      const rows = [...phases]
        .sort((a, b) => a.start - b.start)
        .map((p) => [
          p.name,
          p.skipped ? '跳过' : `${p.ms} ms`,
          p.skipped ? '-' : total > 0 ? `${((p.ms / total) * 100).toFixed(1)}%` : '-',
          p.note,
        ])
      rows.push(['合计', `${total} ms`, '100.0%', ''])
      return `${title}\n${formatTable(['阶段', '耗时', '占比', '备注'], rows)}`
    },
  }
}
