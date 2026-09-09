// ── 表格检测与解析（纯函数，导出供单测）──────────────────────
// 增强检测规则（相对 dsh-think-zh-expand 的 tryTable）：
//  - 表头/数据行：含 `|` 且至少 2 列即可，允许无首尾管道符；
//  - 分隔行：只含 `-` `:` `|` 与空白的变体（--- | ---、-|-|-、---）；
//  - 对齐标记：`:---` 左、`:---:` 中、`---:` 右，无冒号默认左；
//  - 表格可出现在段落中间（prefix/suffix 文本保留）。

interface TableData {
  header: string[]
  aligns: string[]
  rows: string[][]
  prefix: string
  suffix: string
}

/** 分隔行：只含 - : | 与空白，且至少含一个 -。 */
function isSeparatorLine(line: string): boolean {
  if (typeof line !== 'string') return false
  if (!/^\s*\|?[\s:\-|]+\|?\s*$/.test(line)) return false
  return line.includes('-')
}

/** 按 | 分割一行（去首尾管道符，逐格 trim）。 */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 表格行：含 |、至少 2 列、且不是分隔行。 */
function isTableLine(line: string): boolean {
  if (typeof line !== 'string') return false
  if (isSeparatorLine(line)) return false
  const t = line.trim()
  if (!t.includes('|')) return false
  return splitRow(t).length >= 2
}

/** 对齐标记解析：:--- 左、:---: 中、---: 右、其余左。 */
function parseAlign(cell: string): string {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.endsWith(':')) return 'right'
  return 'left'
}

/**
 * 解析表格文本 → { header, aligns, rows, prefix, suffix } 或 null。
 * 在段落内查找「表格行 + 分隔行」组合；prefix/suffix 为表格前后的
 * 非表格文本（渲染时保留）。
 */
function parseTable(text: string): TableData | null {
  const lines = String(text).split('\n')
  for (let start = 0; start < lines.length - 1; start += 1) {
    if (!isTableLine(lines[start])) continue
    if (!isSeparatorLine(lines[start + 1])) continue
    const header = splitRow(lines[start])
    const aligns = splitRow(lines[start + 1]).map(parseAlign)
    const rows: string[][] = []
    let end = start + 2
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() === '') break
      if (!isTableLine(line)) break
      rows.push(splitRow(line))
      end += 1
    }
    return {
      header,
      aligns,
      rows,
      prefix: lines.slice(0, start).join('\n'),
      suffix: lines.slice(end).join('\n'),
    }
  }
  return null
}

exports.isSeparatorLine = isSeparatorLine
exports.isTableLine = isTableLine
exports.splitRow = splitRow
exports.parseAlign = parseAlign
exports.parseTable = parseTable
