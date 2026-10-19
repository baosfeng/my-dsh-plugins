// ── 非标准表格容错（交给 marked 之前的一次纯文本规范化）────────────────
// 判据（GFM 实测口径）：GFM 自己就接受这些写法 —— 无首尾管道符、紧凑分隔行
// （---|---）、单横线分隔（-|-）、表格前有普通段落、数据行列数不等、只有表头、
// 逐列对齐标记。这些**一字不动**。
//
// GFM 不接受的只有两种：
//   ① 分隔行完全没有管道符（`a | b` 后跟 `---`）→ 被当成 setext 标题；
//   ② 分隔行单元格数与表头不等（`a | b | c` 后跟 `--- | ---`）→ 整段不识别。
// 本模块只规范化 ② 与 ①，把分隔行按表头列数补齐 / 裁剪，逐列保留
// :--- / :---: / ---: 对齐语义；其余文本（含行尾空白、空行、代码块）原样返回。
//
// 纯函数、无副作用：own-markdown.ts 在 `marked.lexer()` 之前调用它。
// 脚本模式片段（无 import/export），跨 part 以全局函数名引用。

/** 分隔行候选：只含 - : | 与空白，且至少一个 -。 */
const MDR_TABLE_SEPARATOR_RE = /^\s*\|?[\s:\-|]+\|?\s*$/

/** 是否为一段表格分隔行（`---` / `--- | ---` / `:-:` 等）。 */
function isTableSeparator(line: string): boolean {
  if (typeof line !== 'string') return false
  return MDR_TABLE_SEPARATOR_RE.test(line) && line.indexOf('-') >= 0
}

/** 单行 → 去首尾管道符、逐格 trim 的单元格数组。 */
function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 表头候选：含管道符、至少两格、且本身不是分隔行。 */
function isTableHeader(line: string): boolean {
  if (typeof line !== 'string' || isTableSeparator(line)) return false
  const trimmed = line.trim()
  if (trimmed.indexOf('|') < 0) return false
  return splitTableCells(trimmed).length >= 2
}

/** 单个分隔格 → 合法 GFM 分隔格（逐列保留左 / 中 / 右对齐，缺省左对齐）。 */
function alignCell(cell: string): string {
  const left = cell.charAt(0) === ':'
  const right = cell.charAt(cell.length - 1) === ':'
  if (left && right) return ':---:'
  if (right) return '---:'
  if (left) return ':---'
  return '---'
}

/**
 * 规范化 ①② 两种 GFM 不认的分隔行；无需改动时返回**同一字符串**。
 * 输出格式沿用既有口径：`--- | ---`（不补首尾管道符），列数 = 表头列数。
 */
function normalizeTables(text: string): string {
  const source = typeof text === 'string' ? text : String(text)
  const lines = source.split('\n')
  let patched: string[] | null = null
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const header = lines[i]
    const separator = lines[i + 1]
    if (!isTableHeader(header) || !isTableSeparator(separator)) continue
    const headerCells = splitTableCells(header)
    const separatorCells = splitTableCells(separator)
    // 合法 GFM 分隔行（有管道符且列数一致）不动。
    if (separator.indexOf('|') >= 0 && separatorCells.length === headerCells.length) continue
    if (patched === null) patched = lines.slice()
    patched[i + 1] = headerCells.map((_cell, index) => alignCell(separatorCells[index] ?? '')).join(' | ')
  }
  return patched === null ? source : patched.join('\n')
}

exports.normalizeTables = normalizeTables
exports.isTableSeparator = isTableSeparator
exports.isTableHeader = isTableHeader
exports.splitTableCells = splitTableCells
