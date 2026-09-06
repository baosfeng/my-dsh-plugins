// ── 代码块渲染（issue #80）：语言标签 + 复制按钮头部 + 行号 + 高亮 ──
// 结构：div.md-code-block > div.dsh-md-render-code-head（语言名 + 复制
// 按钮，同排）+ pre.tzx-pre > code.language-xxx（token 高亮 / 行号）。
// 行号用 CSS counter 伪元素渲染，不进入 code/pre 文本内容，mermaid 扫
// 描与复制按钮读取的原文本不受污染。语法高亮 tokenizer 见
// highlight.part.js。
// 增强开关（issue #84）：renderOptions 见 config.part.js（copyButton /
// syntaxHighlight / languageLabel / lineNumbers），apply(ctx) 从配置
// 读取，测试可用 setRenderOptions 切换。模块级变量，MarkdownView 渲染
// 代码块时读取。
// issue #146：复制按钮位置可配置（copyButtonPosition：header=头部右上
// 角 | bottom-right=右下角默认，与 #74 原始诉求一致——按钮作为
// md-code-block 直接子元素绝对定位右下角）；代码主题经 data-theme 属性
// 选择色板（styles.part.js），仅实际高亮的代码块携带主题（syntaxHighlight
// 关闭/未知语言/超长跳过高亮时无 data-theme → 保持 DSH 默认样式，
// 主题不影响纯文本代码块，开关语义不回归）。

// token 类型 → 高亮类名（其余类型渲染为纯文本）。
const TOKEN_CLASS = {
  keyword: 'dsh-md-render-tok-keyword',
  string: 'dsh-md-render-tok-string',
  comment: 'dsh-md-render-tok-comment',
  number: 'dsh-md-render-tok-number',
  function: 'dsh-md-render-tok-function',
}

function renderTokens(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    const cls = TOKEN_CLASS[t.type]
    out.push(cls ? createElement('span', { key: i, className: cls }, t.text) : t.text)
  }
  return out
}

function shouldHighlight(lang, lines) {
  return !!langConfig(lang) && lines.length <= MAX_CODE_LINES
}

/** 渲染代码块主体（code 内细胞）：按行输出 token / 行号 div。 */
function renderCodeCells(code, lang, lines, highlight, lineNumbers) {
  const tokens = highlight ? tokenize(code, lang) : null
  const nodes = []
  for (let i = 0; i < lines.length; i += 1) {
    const toks = tokens ? tokens[i] : [{ type: 'plain', text: lines[i] }]
    const cells = renderTokens(toks)
    if (!lineNumbers) {
      nodes.push(...cells)
    } else {
      nodes.push(createElement('div', { key: 'l' + i, className: 'dsh-md-render-code-line' }, ...cells))
    }
    if (i < lines.length - 1) nodes.push('\n')
  }
  return nodes
}

/** 代码块头部：语言标签 + （header 位置时）复制按钮；两元素都关闭时无头部。 */
function renderCodeHead(lang, bottomCopy) {
  const withHead = renderOptions.languageLabel || (renderOptions.copyButton && !bottomCopy)
  if (!withHead) return null
  return createElement(
    'div',
    { className: 'dsh-md-render-code-head' },
    renderOptions.languageLabel
      ? createElement('span', { className: 'dsh-md-render-code-lang' }, langLabel(lang))
      : null,
    !bottomCopy && renderOptions.copyButton ? createElement(CopyButton, { kind: 'code' }) : null,
  )
}

/** 渲染完整代码块：头部（语言名 + 复制按钮）+ pre > code（高亮/行号）。 */
function renderCodeBlock({ key, lang, code }) {
  const lines = String(code).split('\n')
  // issue #84：syntaxHighlight 关闭 → 不做 token 高亮（回退纯文本）。
  const highlight = renderOptions.syntaxHighlight && shouldHighlight(lang, lines)
  // issue #146：复制按钮位置默认右下角（bottom-right，与 #74 原始诉求
  // 一致）——按钮作为 md-code-block 直接子元素绝对定位；header 位置时
  // 按钮仍在头部（与语言标签同排，issue #80 布局）。
  const bottomCopy = renderOptions.copyButton && renderOptions.copyButtonPosition !== 'header'
  const body = renderCodeCells(code, lang, lines, highlight, renderOptions.lineNumbers)
  // issue #146：主题仅作用于实际高亮的代码块——关闭 syntaxHighlight
  // / 未知语言 / 超长跳过高亮时无 data-theme，保持 DSH 语义 token 默认
  // 样式（主题不影响纯文本代码块，开关语义不回归）。
  const blockProps = { key, className: 'md-code-block' }
  if (highlight) blockProps['data-theme'] = renderOptions.codeTheme
  return createElement(
    'div',
    blockProps,
    renderCodeHead(lang, bottomCopy),
    createElement(
      'pre',
      { className: 'tzx-pre' },
      createElement('code', { className: lang ? 'language-' + lang : '' }, ...body),
    ),
    bottomCopy ? createElement(CopyButton, { kind: 'code' }) : null,
  )
}
