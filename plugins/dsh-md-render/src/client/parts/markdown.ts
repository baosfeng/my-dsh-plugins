// ── 统一 MarkdownView：行内 + 块级渲染（issue #31 自 dsh-think-zh-expand
//    迁移，行为等价 + 公式渲染）。由 scripts/build.mjs 拼入 client.js 的
//    factory 作用域（纯函数声明文本，依赖 factory 内 createElement）；输出
//    结构保持迁移前约定（div.tzx-md / p.tzx-p / table.tzx-table /
//    div.md-code-block）。零运行时依赖（issue #81 语法补全见 syntax.ts）。

// ── 行内 code（CommonMark 多反引号语义）────────────────────────────
function trimCode(raw: string): string {
  if (raw.length > 1 && raw[0] === ' ' && raw[raw.length - 1] === ' ' && raw.trim() !== '') {
    return raw.slice(1, -1)
  }
  return raw
}

// ── 行内公式候选验证（货币/变量/块级保护，通过才渲染为公式）──────
function isMathSpan(text: string, m: RegExpExecArray): boolean {
  const content = m[7].slice(1, -1)
  if (content === '' || content.trim() !== content) return false
  const before = text[m.index - 1]
  const after = text[m.index + m[0].length]
  if (before !== undefined && /[\w$]/.test(before)) return false
  if (after !== undefined && /[\w$]/.test(after)) return false
  return true
}

// 公式错误提示（issue #32）：异常公式 → 错误标记（原文保留 + 错误样式，
// 参考内置 katex-error 语义）；货币/变量/块级 `$$` 保护不误报。
const MATH_ERROR_TITLES: Record<string, string> = {
  malformed: '公式内容异常',
  unclosed: '未闭合的公式',
  multiline: '公式内容含换行',
  empty: '公式内容为空',
}

function isMathError(m: RegExpExecArray): boolean {
  const content = m[7].slice(1, -1)
  return content[0] === ' ' || content[0] === '\t'
}

function mathSkip(text: string, i: number): number {
  const before = text[i - 1]
  const after = text[i + 1]
  if (before !== undefined && /[\w$]/.test(before)) return i + 1
  if (after === '$') return i + 2
  if (after !== undefined && /\d/.test(after)) return i + 1
  return i
}

/** 在正则未匹配区间 [start, end) 中扫描疑似公式的 `$`（未闭合/跨行 → 错误标记）。 */
function scanMathErrors(text: string, start: number, end: number, key: string, k: number, out: unknown[]): number {
  let i = start
  let segStart = start
  while (i < end) {
    if (text[i] !== '$') {
      i += 1
      continue
    }
    const skip = mathSkip(text, i)
    if (skip !== i) {
      i = skip
      continue
    }
    if (i > segStart) out.push(text.slice(segStart, i))
    let j = i + 1
    while (j < end && text[j] !== '$') j += 1
    if (j >= end) {
      out.push(
        createElement(
          'span',
          { key: key + '-e' + k, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.unclosed },
          icon.alert(12),
          text.slice(i, end),
        ),
      )
      return k + 1
    }
    out.push(
      createElement(
        'span',
        { key: key + '-e' + k, className: 'dsh-md-render-math-error', title: MATH_ERROR_TITLES.multiline },
        icon.alert(12),
        text.slice(i, j + 1),
      ),
    )
    k += 1
    i = j + 1
    segStart = i
  }
  if (end > segStart) out.push(text.slice(segStart, end))
  return k
}

// ── 轻量行内 Markdown：行内代码 / 粗体 / 图片 / 链接 / 公式 / 删除线 / 斜体 ──
// 图片须先于链接（`![alt](url)` 内含 `[alt](url)` 链式子结构）；行内公式
// $...$ 保护货币/变量/块级 `$$`。元素构造见 syntax.ts 的 inlineMatch。
function mdInline(text: string, key: string): unknown[] {
  const out: unknown[] = []
  const re =
    /(`+)([^`\n][^\n]*?)\1(?!`)|(\*\*[^*]+\*\*)|!\[([^\]]*)\]\(([^)]+)\)|(\[[^\]]+\]\([^)]+\))|(\$[^$\n]+?\$)|~~([^~]+)~~|(\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null,
    k = 0
  while ((m = re.exec(text)) !== null) {
    // issue #84：mathStructures 关闭 → 不扫描疑似公式的未闭合 `$`（保持原文）。
    if (renderOptions.mathStructures) k = scanMathErrors(text, last, m.index, key, k, out)
    out.push(inlineMatch(m, text, key + '-i' + k))
    k += 1
    last = m.index + m[0].length
  }
  if (renderOptions.mathStructures) scanMathErrors(text, last, text.length, key, k, out)
  return out
}

// ── 轻量块级 Markdown：代码块 / 标题 / 列表 / 引用 / 表格 / 公式 ──
// 每个 tryXxx 尝试从 lines[i] 消费一类块：成功则 push 元素并返回下一行下标，
// 失败返回 0（不消费）。复制按钮（CopyButton，issue #74）代码块/整段右下角。
function tryFence(lines: string[], i: number, out: unknown[]): number {
  const fence = lines[i].match(/^```(\w*)\s*$/)
  if (!fence) return 0
  const buf: string[] = []
  i += 1
  while (i < lines.length && !/^```\s*$/.test(lines[i])) {
    buf.push(lines[i])
    i += 1
  }
  i += 1
  // 语法高亮 / 语言标签 / 行号（issue #80）：结构见 highlight/codeblock.ts。
  out.push(renderCodeBlock({ key: 'b' + out.length, lang: fence[1], code: buf.join('\n') }))
  return i
}

function tryHeading(lines: string[], i: number, out: unknown[]): number {
  const heading = lines[i].match(/^(#{1,4})\s+(.*)$/)
  if (!heading) return 0
  const level = heading[1].length
  out.push(
    createElement(
      'h' + level,
      { key: 'b' + out.length, className: 'tzx-h' },
      ...mdInline(heading[2], 'h' + out.length),
    ),
  )
  return i + 1
}

function tryQuote(lines: string[], i: number, out: unknown[]): number {
  const quote = lines[i].match(/^\s*>\s?(.*)$/)
  if (!quote) return 0
  const buf = [quote[1]]
  i += 1
  while (i < lines.length) {
    const q2 = lines[i].match(/^\s*>\s?(.*)$/)
    if (!q2) break
    buf.push(q2[1])
    i += 1
  }
  out.push(
    createElement(
      'blockquote',
      { key: 'b' + out.length, className: 'tzx-bq' },
      ...buf.map((l, j) => createElement('p', { key: j }, ...mdInline(l, 'bq' + out.length + '-' + j))),
    ),
  )
  return i
}

function tryTable(lines: string[], i: number, out: unknown[]): number {
  const line = lines[i]
  const tableHead = line.match(/^\s*\|.*\|\s*$/)
  if (!tableHead) return 0
  const sep = lines[i + 1]
  const isSep = typeof sep === 'string' && /^\s*\|?[\s:\-|]+\|?\s*$/.test(sep) && sep.includes('-')
  if (!isSep) return 0
  // 无分隔行（不是标准表格）时返回 0：由段落逻辑接管，表格头行按普通行处理。
  const cellsOf = (row: string): string[] =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  const aligns = cellsOf(sep).map((a) => {
    if (a.startsWith(':') && a.endsWith(':')) return 'center'
    if (a.endsWith(':')) return 'right'
    return 'left'
  })
  const header = cellsOf(line)
  const dataRows: string[][] = []
  i += 2
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
    dataRows.push(cellsOf(lines[i]))
    i += 1
  }
  const cellStyle = (j: number): Record<string, string> => ({ textAlign: aligns[j] ?? 'left' })
  out.push(
    createElement(
      'table',
      { key: 'b' + out.length, className: 'tzx-table' },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          header.map((c, j) =>
            createElement('th', { key: j, style: cellStyle(j) }, ...mdInline(c, 'th' + out.length + '-' + j)),
          ),
        ),
      ),
      dataRows.length > 0
        ? createElement(
            'tbody',
            null,
            dataRows.map((row, ri) =>
              createElement(
                'tr',
                { key: ri },
                row.map((c, j) =>
                  createElement(
                    'td',
                    { key: j, style: cellStyle(j) },
                    ...mdInline(c, 'td' + out.length + '-' + ri + '-' + j),
                  ),
                ),
              ),
            ),
          )
        : null,
    ),
  )
  return i
}

// ── 块级公式：$$...$$ 单行或 $$ 开闭块；异常（未闭合/空）→ 错误标记 ──
function mathErrorEl(out: unknown[], title: string, content: string): unknown {
  return createElement(
    'div',
    { key: 'b' + out.length, className: 'dsh-md-render-math-error', title },
    icon.alert(12),
    content,
  )
}

function tryMath(lines: string[], i: number, out: unknown[]): number {
  // issue #84：mathStructures 关闭 → 块级公式不渲染为公式结构（回退段落）。
  if (!renderOptions.mathStructures) return 0
  return tryMathEnabled(lines, i, out)
}

function tryMathEnabled(lines: string[], i: number, out: unknown[]): number {
  const single = lines[i].match(/^\$\$([^$]*)\$\$\s*$/)
  if (single) {
    const content = single[1].trim()
    out.push(content === '' ? mathErrorEl(out, MATH_ERROR_TITLES.empty, lines[i].trim()) : mathBlockEl(out, content))
    return i + 1
  }
  if (!/^\$\$\s*$/.test(lines[i])) return 0
  const buf: string[] = []
  i += 1
  while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) {
    buf.push(lines[i])
    i += 1
  }
  const closed = i < lines.length
  i += 1
  const content = buf.join('\n').trim()
  const err = !closed ? MATH_ERROR_TITLES.unclosed : content === '' ? MATH_ERROR_TITLES.empty : null
  out.push(err ? mathErrorEl(out, err, !closed ? '$$\n' + buf.join('\n') : '$$\n$$') : mathBlockEl(out, content))
  return i
}

/** 块级公式内容：轻量结构解析成功 → 嵌套结构；失败 → 保持原文（issue #82）。 */
function mathBlockEl(out: unknown[], content: string): unknown {
  const parsed = parseMath(content)
  const kids = parsed.failed ? [content] : mathNodesToReact(parsed.nodes)
  return createElement('div', { key: 'b' + out.length, className: 'dsh-md-render-math-block' }, ...kids)
}

function tryParagraph(lines: string[], i: number, out: unknown[]): number {
  const para = [lines[i]]
  i += 1
  while (i < lines.length) {
    const nxt = lines[i]
    if (nxt.trim() === '' || /^(#{1,4})\s|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>\s?|^```|^\$\$/.test(nxt)) break
    para.push(nxt)
    i += 1
  }
  out.push(
    createElement('p', { key: 'b' + out.length, className: 'tzx-p' }, ...mdInline(para.join('\n'), 'p' + out.length)),
  )
  return i
}

// 块级渲染顺序（与迁移前逐分支判断的顺序一致，公式块追加在末尾）。
// 列表（内联 task/嵌套）与行内元素构造见 syntax.ts。
const MD_RENDERERS = [tryFence, tryHeading, tryList, tryQuote, tryTable, tryMath]

function MarkdownView({ text }: { text: string }): unknown {
  const lines = String(text).split('\n')
  const out: unknown[] = []
  let i = 0
  while (i < lines.length) {
    let handled = false
    for (const render of MD_RENDERERS) {
      const next = render(lines, i, out)
      if (next) {
        i = next
        handled = true
        break
      }
    }
    if (handled) continue
    if (lines[i].trim() === '') {
      i += 1
      continue
    }
    i = tryParagraph(lines, i, out)
  }
  return createElement(
    'div',
    { className: 'tzx-md' },
    out,
    // issue #84：copyButton 关闭 → 整段内容复制按钮不渲染。
    renderOptions.copyButton ? createElement(CopyButton, { kind: 'content' }) : null,
  )
}

exports.MarkdownView = MarkdownView
