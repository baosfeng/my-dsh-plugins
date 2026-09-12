// ── DOM markdown 渲染器（issue #205）──────────────────────────────
// 轨迹视图（宿主 @deepseek-ai/dsh-client-ui-trajectory）的 markdown 只有
// 「宿主渲染后的 HTML」存在于 DOM 中，md-render 的 React 渲染管线
// （MarkdownView）完全不介入。本模块把 markdown 原文渲染为**原生 DOM**
// （不经 React，因此可以安全地插入 React 管理的树旁），供轨迹视图接管层
// 使用，能力与 MarkdownView 对齐：
//  - 表格：parseTable（宽容格式：无首尾管道符 / 分隔行变体 / 对齐标记）
//    + renderTable（滚动容器 + 滚动提示 + 表头排序 + 长表格折叠）；
//  - 公式：$$`…`$$ 块级与 $…$ 行内 → parseMath + 结构 DOM（分数 / 根号 /
//    上下标 / 求和积分，样式见 styles.ts）；
//  - 代码块：语言标签 + 复制按钮 + 行号 + 语法高亮（tokenizeCode）；
//  - 标题 / 引用 / 列表 / 段落行内元素复用 context-markdown 的块级函数与
//    renderInline（同一 factory 作用域）。
// 所有输出类名与 MarkdownView 一致（div.tzx-md / p.tzx-p /
// table.dsh-md-render-table / div.md-code-block / …），样式无差异。

/** 行内公式候选（与 markdown.ts 的 mdInline 同一语义，仅取第 7 组）。 */
const DOM_MATH_RE = /\$([^$\n]+?)\$/g

/** token 类型 → 高亮类名（与 codeblock.ts 的 TOKEN_CLASS 一致）。 */
const DOM_TOKEN_CLASS: Record<string, string> = {
  keyword: 'dsh-md-render-tok-keyword',
  string: 'dsh-md-render-tok-string',
  comment: 'dsh-md-render-tok-comment',
  number: 'dsh-md-render-tok-number',
  function: 'dsh-md-render-tok-function',
}

/** 建 span（指定类名）并挂到 parent，返回之。 */
function domSpan(cls: string, parent: Element): Element {
  const el = document.createElement('span')
  el.className = cls
  parent.appendChild(el)
  return el
}

/** 公式 AST → DOM（结构类名与 math-render.ts 的 React 版一致）。 */
function domMathNodes(nodes: MathNode[] | undefined, parent: Element): void {
  for (const node of nodes ?? []) domMathNode(node, parent)
}

function domMathFrac(node: MathNode, parent: Element): void {
  const el = domSpan('dsh-md-render-frac', parent)
  domMathNodes([node.num as MathNode], domSpan('dsh-md-render-frac-num', el))
  domMathNodes([node.den as MathNode], domSpan('dsh-md-render-frac-den', el))
}

function domMathSqrt(node: MathNode, parent: Element): void {
  const el = domSpan('dsh-md-render-sqrt', parent)
  domSpan('dsh-md-render-sqrt-symbol', el).textContent = '√'
  domMathNodes([node.body as MathNode], domSpan('dsh-md-render-sqrt-body', el))
}

/** 上下标：base + scripts（sup / sub 各自可选）。 */
function domMathSupsub(node: MathNode, parent: Element): void {
  const el = domSpan('dsh-md-render-supsub', parent)
  domMathNodes([node.base as MathNode], domSpan('dsh-md-render-supsub-base', el))
  if (node.sup === null && node.sub === null) return
  const scripts = domSpan('dsh-md-render-supsub-scripts', el)
  if (node.sup !== null && node.sup !== undefined)
    domMathNodes([node.sup], domSpan('dsh-md-render-supsub-sup', scripts))
  if (node.sub !== null && node.sub !== undefined)
    domMathNodes([node.sub], domSpan('dsh-md-render-supsub-sub', scripts))
}

/** 大运算符（求和 / 积分）+ 上下限。 */
function domMathBig(node: MathNode, parent: Element): void {
  const el = domSpan('dsh-md-render-big', parent)
  if (node.sup !== null || node.sub !== null) {
    const limits = domSpan('dsh-md-render-big-limits', el)
    if (node.sup !== null && node.sup !== undefined) domMathNodes([node.sup], domSpan('dsh-md-render-big-sup', limits))
    if (node.sub !== null && node.sub !== undefined) domMathNodes([node.sub], domSpan('dsh-md-render-big-sub', limits))
  }
  domSpan('dsh-md-render-big-symbol', el).textContent = node.sym ?? ''
}

/** 单个公式节点（未知类型静默忽略，不破坏页面）。 */
function domMathNode(node: MathNode, parent: Element): void {
  if (node === null || node === undefined) return
  if (node.t === 'text') {
    parent.appendChild(document.createTextNode(node.v ?? ''))
    return
  }
  if (node.t === 'seq') {
    domMathNodes(node.kids, parent)
    return
  }
  if (node.t === 'frac') domMathFrac(node, parent)
  else if (node.t === 'sqrt') domMathSqrt(node, parent)
  else if (node.t === 'supsub') domMathSupsub(node, parent)
  else if (node.t === 'big') domMathBig(node, parent)
}

/** 公式内容 → span.dsh-md-render-math（解析失败保持原文）。 */
function domMathSpan(content: string): Element {
  const el = document.createElement('span')
  el.className = 'dsh-md-render-math'
  const parsed = parseMath(content)
  if (parsed.failed) el.textContent = content
  else domMathNodes(parsed.nodes, el)
  return el
}

/** 块级公式内容 → div.dsh-md-render-math-block（解析失败保持原文）。 */
function domMathBlockEl(content: string): Element {
  const el = document.createElement('div')
  el.className = 'dsh-md-render-math-block'
  if (content === '') return el
  const parsed = parseMath(content)
  if (parsed.failed) el.textContent = content
  else domMathNodes(parsed.nodes, el)
  return el
}

/** 行内渲染：先切出 $…$ 公式段，其余交给 renderInline（同一作用域）。 */
function domInline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  if (!renderOptions.mathStructures) {
    frag.appendChild(renderInline(text))
    return frag
  }
  let last = 0
  let m: RegExpExecArray | null
  DOM_MATH_RE.lastIndex = 0
  while ((m = DOM_MATH_RE.exec(text)) !== null) {
    const before = text[m.index - 1]
    const after = text[m.index + m[0].length]
    // 货币 / 变量保护（与 isMathSpan 同规则）：紧邻 `\w` 或 `$` 时不是公式。
    if (before !== undefined && /[\w$]/.test(before)) continue
    if (after !== undefined && /[\w$]/.test(after)) continue
    if (m.index > last) frag.appendChild(renderInline(text.slice(last, m.index)))
    frag.appendChild(domMathSpan(m[1]))
    last = m.index + m[0].length
  }
  if (last < text.length) frag.appendChild(renderInline(text.slice(last)))
  return frag
}

/** DOM 复制按钮：从 DOM 取文本（代码块取 code，整段取纯文本）。 */
function domCopyButton(host: Element, kind: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'dsh-md-render-copy'
  btn.title = '复制'
  btn.setAttribute('aria-label', '复制')
  btn.textContent = '复制'
  btn.addEventListener('click', () => {
    let text: string
    if (kind === 'code') {
      const codeEl = host.querySelector('code')
      text = codeEl ? (codeEl.textContent ?? '') : ''
    } else {
      const out: (string | null)[] = []
      collectCopyText(host, out)
      text = out.join('')
    }
    if (!text) return
    copyText(text).then(
      () => {
        btn.textContent = '已复制'
        btn.className = 'dsh-md-render-copy dsh-md-render-copy-done'
        setTimeout(() => {
          btn.textContent = '复制'
          btn.className = 'dsh-md-render-copy'
        }, 1500)
      },
      () => {},
    )
  })
  return btn
}

/** 代码行内细胞：token span / 纯文本（与 codeblock.ts 的 renderTokens 等价）。 */
function domCodeCells(toks: Token[], lineEl: Element): void {
  for (const tok of toks) {
    const cls = DOM_TOKEN_CLASS[tok.type]
    if (!cls) {
      lineEl.appendChild(document.createTextNode(tok.text))
      continue
    }
    const span = document.createElement('span')
    span.className = cls
    span.textContent = tok.text
    lineEl.appendChild(span)
  }
}

/** 代码块主体：按行输出 token（可选行号 div），行间补 `\n`。 */
function domCodeLines(codeEl: Element, lines: string[], tokens: Token[][] | null): void {
  for (let i = 0; i < lines.length; i += 1) {
    const toks = tokens ? tokens[i] : [{ type: 'plain', text: lines[i] }]
    let target: Element = codeEl
    if (renderOptions.lineNumbers) {
      const div = document.createElement('div')
      div.className = 'dsh-md-render-code-line'
      codeEl.appendChild(div)
      target = div
    }
    domCodeCells(toks, target)
    if (i < lines.length - 1) codeEl.appendChild(document.createTextNode('\n'))
  }
}

/** 代码块头部：语言标签 + （header 位置时）复制按钮。 */
function domCodeHead(block: Element, lang: string, bottomCopy: boolean): void {
  if (!renderOptions.languageLabel && !(renderOptions.copyButton && !bottomCopy)) return
  const head = document.createElement('div')
  head.className = 'dsh-md-render-code-head'
  if (renderOptions.languageLabel) {
    const label = document.createElement('span')
    label.className = 'dsh-md-render-code-lang'
    label.textContent = langLabel(lang)
    head.appendChild(label)
  }
  if (!bottomCopy && renderOptions.copyButton) head.appendChild(domCopyButton(block, 'code'))
  block.appendChild(head)
}

/** 围栏代码块：div.md-code-block > head + pre.tzx-pre > code（高亮/行号）+ 复制。 */
function domCodeBlock(lang: string, code: string): Element {
  const lines = String(code).split('\n')
  const highlight = !!renderOptions.syntaxHighlight && !!langConfig(lang) && lines.length <= MAX_CODE_LINES
  const bottomCopy = !!renderOptions.copyButton && renderOptions.copyButtonPosition !== 'header'
  const block = document.createElement('div')
  block.className = 'md-code-block'
  if (highlight) block.setAttribute('data-theme', String(renderOptions.codeTheme))
  domCodeHead(block, lang, bottomCopy)
  const pre = document.createElement('pre')
  pre.className = 'tzx-pre'
  const codeEl = document.createElement('code')
  if (lang) codeEl.className = 'language-' + lang
  domCodeLines(codeEl, lines, highlight ? tokenizeCode(code, lang) : null)
  pre.appendChild(codeEl)
  block.appendChild(pre)
  if (bottomCopy) block.appendChild(domCopyButton(block, 'code'))
  return block
}

/** 围栏代码块块级消费。 */
function domFence(lines: string[], i: number, out: DocumentFragment): number {
  const m = lines[i].match(/^```([A-Za-z0-9_+-]*)\s*$/)
  if (!m) return 0
  const body: string[] = []
  let j = i + 1
  while (j < lines.length && !/^```\s*$/.test(lines[j])) {
    body.push(lines[j])
    j += 1
  }
  out.appendChild(domCodeBlock(m[1], body.join('\n')))
  return j < lines.length ? j + 1 : j
}

/** 块级公式：$$…$$ 单行或 $$ 开闭块（mathStructures 关闭时返回 0）。 */
function domMathBlock(lines: string[], i: number, out: DocumentFragment): number {
  if (!renderOptions.mathStructures) return 0
  const single = lines[i].match(/^\$\$([^$]*)\$\$\s*$/)
  if (single) {
    out.appendChild(domMathBlockEl(single[1].trim()))
    return i + 1
  }
  if (!/^\$\$\s*$/.test(lines[i])) return 0
  const buf: string[] = []
  let j = i + 1
  while (j < lines.length && !/^\$\$\s*$/.test(lines[j])) {
    buf.push(lines[j])
    j += 1
  }
  out.appendChild(domMathBlockEl(buf.join('\n').trim()))
  return j < lines.length ? j + 1 : j
}

/** 段落：表格文本（宽容识别）→ 表格；否则普通段落（行内元素 + 公式）。 */
function domParagraph(text: string, out: DocumentFragment): void {
  const table = parseTable(text)
  if (table) {
    out.appendChild(renderTable(table))
    return
  }
  const p = document.createElement('p')
  p.className = 'tzx-p'
  p.appendChild(domInline(text))
  out.appendChild(p)
}

/** 块级起始行判定（用于段落续行边界）。 */
const DOM_BLOCK_START_RE = /^(#{1,4})\s|^```|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>|^\$\$/

/** 尝试从 lines[i] 消费一个块（围栏 / 公式 / 标题 / 引用 / 列表）；0 = 未消费。 */
function domTryBlock(lines: string[], i: number, out: DocumentFragment): number {
  return (
    domFence(lines, i, out) ||
    domMathBlock(lines, i, out) ||
    cmHeading(lines, i, out) ||
    cmQuote(lines, i, out) ||
    cmList(lines, i, out)
  )
}

/** 从 start 起消费一个段落（到空行 / 下一个块起始行为止）。 */
function domConsumeParagraph(lines: string[], start: number): { text: string; next: number } {
  const para = [lines[start]]
  let i = start + 1
  while (i < lines.length && lines[i].trim() !== '' && !DOM_BLOCK_START_RE.test(lines[i])) {
    para.push(lines[i])
    i += 1
  }
  return { text: para.join('\n'), next: i }
}

/** markdown 原文 → DOM 片段（块级顺序：围栏 / 公式 / 标题 / 引用 / 列表 / 段落）。 */
function renderDomMarkdown(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  const lines = String(text).split('\n')
  let i = 0
  while (i < lines.length) {
    const next = domTryBlock(lines, i, out)
    if (next) {
      i = next
      continue
    }
    if (lines[i].trim() === '') {
      i += 1
      continue
    }
    const para = domConsumeParagraph(lines, i)
    domParagraph(para.text, out)
    i = para.next
  }
  return out
}

exports.renderDomMarkdown = renderDomMarkdown
exports.domCopyButton = domCopyButton
exports.domInline = domInline
