// ── 非标准表格容错（官方 GFM 未覆盖的那一部分）────────────────────────
// 官方渲染链是 micromark-extension-gfm + mdast-util-gfm（ui-primitives/
// src/markdown/parse.ts:16,29-30），**实测**（test/table-normalize.mjs 用
// micromark 逐条验证）它已经接受这些写法：
//   · 无首尾管道符      a | b / --- | ---
//   · 紧凑分隔行        a | b / ---|---
//   · 单横线分隔        a | b / -|-
//   · 表格前有普通段落文本（前缀文本不会吃掉表格）
//   · 数据行多列/少列、只有表头无数据行、逐列对齐标记
// 只有两种写法 GFM 不认：
//   ① 分隔行完全没有管道符（a | b 后跟 ---）：GFM 视为 setext 标题
//   ② 分隔行单元格数与表头不等（a | b | c 后跟 --- | ---）：整段不识别
// 本函数只把这①②两种写法**规范化**成合法 GFM 分隔行（列数与表头对齐、
// 逐列保留 :--- / :---: / ---: 对齐标记），其余文本一字不动 —— 规范化后
// 交给官方 MarkdownText 渲染，本插件不做任何自己的渲染实现。
// 只作用于本插件交给官方渲染器的文本（MarkdownView / text 围栏块 /
// 上下文注入块），不触碰宿主其它内容。

/** 分隔行候选：只含 - : | 与空白，且至少一个 -（与旧实现同一判据）。 */
const TABLE_SEP_RE = /^\s*\|?[\s:\-|]+\|?\s*$/

function isTableSeparator(line: string): boolean {
  return typeof line === 'string' && TABLE_SEP_RE.test(line) && line.includes('-')
}

/** 按 | 切列（去首尾管道符、逐格 trim）。 */
function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 表头候选：含 |、至少 2 列、且本身不是分隔行。 */
function isTableHeader(line: string): boolean {
  if (typeof line !== 'string' || isTableSeparator(line)) return false
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  return splitTableCells(trimmed).length >= 2
}

/** 对齐标记 → 合法 GFM 分隔单元格（保留左/中/右语义，缺省左对齐）。 */
function alignCell(cell: string): string {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return ':---:'
  if (right) return '---:'
  if (left) return ':---'
  return '---'
}

/**
 * 把①②两种 GFM 不认的分隔行规范化为合法写法；无需改动时原样返回。
 * 已是合法 GFM 表格（有管道符且列数与表头一致）一字不动。
 */
function normalizeTables(text: string): string {
  const source = String(text)
  const lines = source.split('\n')
  let out: string[] | null = null
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (!isTableHeader(lines[i]) || !isTableSeparator(lines[i + 1])) continue
    const header = splitTableCells(lines[i])
    const separator = splitTableCells(lines[i + 1])
    if (lines[i + 1].includes('|') && separator.length === header.length) continue
    if (out === null) out = lines.slice()
    out[i + 1] = header.map((_cell, j) => alignCell(separator[j] ?? '')).join(' | ')
  }
  return out === null ? source : out.join('\n')
}

exports.normalizeTables = normalizeTables
exports.isTableSeparator = isTableSeparator
exports.isTableHeader = isTableHeader
exports.splitTableCells = splitTableCells
