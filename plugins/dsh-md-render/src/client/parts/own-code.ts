// ── 自研代码围栏卡（B 路）：语言胶囊 + 标题 + 行号 / 换行 / 复制 + 底栏三态 ──
// 用户口径（最高优先级）：「代码渲染使用我们自己的，不要使用原生的」。本卡片完全由
// 本插件产出（不调用官方 CodeBlock / MarkdownText）：
//   · 语言胶囊 = 围栏 info string 的真实 token（CSS 大写 + 字距 .06em），语言位为空时
//     留空（**绝不编造语言名**）；
//   · 高亮走懒加载 highlight.js 的**令牌树 → vdom span**，不拼 HTML、不 innerHTML，
//     模型输出不会被当 HTML 执行；hljs 未就绪 / 语言不认识 / 超长 → 纯文本（内容一字不少）；
//   · 行号默认关、自动换行默认关（状态写卡片 data-mdr-lines / data-mdr-wrap，CSS 呈现）；
//   · 底栏「渲染为…」三态（图表 / Markdown / 源码）复用 lang-switch.ts 的控件。

/** 代码块宿主容器类名（block-render.ts 探测 / block-lang.ts 防递归引用）。 */
const CODE_HOST_CLASS = 'mdr-block'
/** 围栏卡 / 头部 / 语言胶囊 / 标题 / 操作区 / 主体 / 行号列 / 代码 / 底栏类名。 */
const MDR_FENCE_CLASS = 'mdr-fence'
const MDR_FENCE_HEAD_CLASS = 'mdr-fence-head'
const MDR_FENCE_PILL_CLASS = 'mdr-pill mdr-fence-pill'
const MDR_FENCE_TITLE_CLASS = 'mdr-fence-title'
const MDR_FENCE_ACTIONS_CLASS = 'mdr-fence-actions'
const MDR_FENCE_ACTION_CLASS = 'mdr-icon-btn mdr-fence-action'
const MDR_FENCE_COPY_CLASS = 'mdr-fence-copy'
const MDR_FENCE_BODY_CLASS = 'mdr-fence-body'
const MDR_FENCE_NUMS_CLASS = 'mdr-line-nums'
const MDR_FENCE_CODE_CLASS = 'mdr-fence-code'
const MDR_FENCE_FOOT_CLASS = 'mdr-fence-foot'
const MDR_FENCE_NOTE_CLASS = 'mdr-fence-note'
/** 单块高亮上限（字符）：超出只做纯文本渲染（高亮是 O(代码长度) 的正则扫描）。 */
const MAX_HIGHLIGHT_CHARS = 60000

/** hljs 令牌树节点（字符串 = 纯文本片段）。 */
interface MdrHlNode {
  scope?: unknown
  children?: unknown
}

/**
 * hljs scope → 本插件语法色类名（原型 .hl-key / .hl-str / .hl-num / .hl-com /
 * .hl-fn / .hl-tag / .hl-prop）。只映射到有颜色的族；未知 scope 不包 span（纯文本）。
 * 分级 scope 取首段（`comment.line` → comment）。
 */
const MDR_HL_SCOPE_CLASS: Record<string, string> = {
  keyword: 'hl-key',
  built_in: 'hl-key',
  type: 'hl-key',
  literal: 'hl-key',
  symbol: 'hl-key',
  meta: 'hl-key',
  'keyword.control': 'hl-key',
  string: 'hl-str',
  regexp: 'hl-str',
  char: 'hl-str',
  'string.escape': 'hl-str',
  'char.escape': 'hl-str',
  number: 'hl-num',
  comment: 'hl-com',
  quote: 'hl-com',
  title: 'hl-fn',
  'title.function': 'hl-fn',
  'title.class': 'hl-fn',
  function: 'hl-fn',
  tag: 'hl-tag',
  name: 'hl-tag',
  'selector-tag': 'hl-tag',
  'selector-id': 'hl-tag',
  attr: 'hl-prop',
  attribute: 'hl-prop',
  property: 'hl-prop',
  params: 'hl-prop',
  variable: 'hl-prop',
}

/** scope → 语法色类名（无法映射 → 空串）。 */
function hlClassOf(scope: unknown): string {
  const name = String(scope === null || scope === undefined ? '' : scope)
  if (name === '') return ''
  const direct = MDR_HL_SCOPE_CLASS[name]
  if (direct !== undefined) return direct
  const dot = name.indexOf('.')
  const head = dot >= 0 ? name.slice(0, dot) : name
  return MDR_HL_SCOPE_CLASS[head] ?? ''
}

/** 从 hljs 结果里取令牌树根（结果 / _emitter / root 任一层缺失 → null）。 */
function hlRootOf(result: unknown): MdrHlNode | null {
  if (result === null || result === undefined) return null
  const emitter = (result as { _emitter?: { root?: MdrHlNode } })._emitter
  if (emitter === null || emitter === undefined) return null
  const root = emitter.root
  return root === null || root === undefined ? null : root
}

/** 令牌树 → vdom 子节点（无 scope / 未知 scope 的容器不包 span）。 */
function hlTokenNodes(node: MdrHlNode, keyBase: string, out: unknown[]): void {
  const children = Array.isArray(node.children) ? node.children : []
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as unknown
    if (typeof child === 'string') {
      if (child !== '') out.push(child)
      continue
    }
    if (child === null || typeof child !== 'object') continue
    const key = keyBase + '-' + String(i)
    const inner: unknown[] = []
    hlTokenNodes(child as MdrHlNode, key, inner)
    const className = hlClassOf((child as MdrHlNode).scope)
    if (className === '') {
      for (const item of inner) out.push(item)
      continue
    }
    out.push(createElement('span', { key, className }, ...inner))
  }
}

/**
 * 高亮一段代码：返回 vdom 子节点数组；任何一步不成立返回 null（调用方渲染纯文本）。
 * 解析层由 render-assets.ts 的懒加载入口提供，本文件不自己加载脚本。
 */
/** 高亮层的最小 API 面（懒加载未就绪 / 形态不符 → null）。 */
function hljsApi(): {
  getLanguage: (name: string) => unknown
  highlight: (text: string, options: unknown) => unknown
} | null {
  const hljs = ensureRenderAsset(HLJS_ASSET)
  if (hljs === null) return null
  if (typeof hljs.getLanguage !== 'function' || typeof hljs.highlight !== 'function') return null
  return hljs as unknown as {
    getLanguage: (name: string) => unknown
    highlight: (text: string, options: unknown) => unknown
  }
}

/** 调高亮层（语言不支持 / 抛错 → null）。 */
function hlResultOf(lang: string, code: string): unknown {
  const hljs = hljsApi()
  if (hljs === null) return null
  try {
    if (!hljs.getLanguage(lang)) return null
    return hljs.highlight(code, { language: lang, ignoreIllegals: true })
  } catch (_e) {
    return null
  }
}

/**
 * 高亮一段代码：返回 vdom 子节点数组；任何一步不成立返回 null（调用方渲染纯文本）。
 * 解析层由 render-assets.ts 的懒加载入口提供，本文件不自己加载脚本。
 */
function highlightNodes(lang: string, code: string): unknown[] | null {
  if (lang === '' || code === '' || code.length > MAX_HIGHLIGHT_CHARS) return null
  const root = hlRootOf(hlResultOf(lang, code))
  if (root === null) return null
  const out: unknown[] = []
  hlTokenNodes(root, 'hl', out)
  return out.length === 0 ? null : out
}

/** 行号列文本：按逻辑行逐行编号（空行占位、末尾换行不多出一行）。 */
function lineNumbersText(source: string): string {
  const count = source === '' ? 0 : source.split('\n').length
  const out: string[] = []
  for (let i = 1; i <= count; i += 1) out.push(String(i))
  return out.join('\n')
}

/** 底栏说明：行数 · 语言（语言位为空时如实说「未标注语言」，不编造）。 */
function fenceLineNote(source: string, lang: string): string {
  const lines = source === '' ? 0 : source.split('\n').length
  return String(lines) + ' 行 · ' + (lang === '' ? '未标注语言' : lang)
}

/** 代码主体：有高亮 → 语法色 span 树；否则纯文本（内容一字不少）。 */
function codeBodyNode(lang: string, source: string): unknown {
  const nodes = highlightNodes(lang, source)
  if (nodes === null) return createElement('code', { className: 'mdr-fence-text' }, source)
  return createElement('code', { className: 'mdr-fence-hl' }, ...nodes)
}

/** 头部：语言胶囊 + 标题 + 操作区（复制 / 换行 / 行号）。 */
function MdrFenceHead(props: {
  lang: string
  title: string
  code: string
  wrap: boolean
  lines: boolean
  onWrap: () => void
  onLines: () => void
}): unknown {
  const wrapLabel = props.wrap ? '关闭自动换行' : '切换自动换行'
  const linesLabel = props.lines ? '隐藏行号' : '切换行号'
  return createElement(
    'div',
    { className: MDR_FENCE_HEAD_CLASS },
    createElement(
      'span',
      props.lang === ''
        ? { className: MDR_FENCE_PILL_CLASS, 'aria-hidden': 'true' }
        : { className: MDR_FENCE_PILL_CLASS },
      props.lang,
    ),
    props.title === '' ? null : createElement('span', { className: MDR_FENCE_TITLE_CLASS }, props.title),
    createElement(
      'span',
      { className: MDR_FENCE_ACTIONS_CLASS },
      createElement(MdrCopyButton, { text: props.code, tip: '复制代码', className: MDR_FENCE_COPY_CLASS }),
      createElement(
        'button',
        {
          type: 'button',
          className: MDR_FENCE_ACTION_CLASS + (props.wrap ? ' is-on' : ''),
          'aria-label': wrapLabel,
          'aria-pressed': props.wrap ? 'true' : 'false',
          'data-mdr-tip': wrapLabel,
          onClick: props.onWrap,
        },
        icon.wrap(14),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: MDR_FENCE_ACTION_CLASS + (props.lines ? ' is-on' : ''),
          'aria-label': linesLabel,
          'aria-pressed': props.lines ? 'true' : 'false',
          'data-mdr-tip': linesLabel,
          onClick: props.onLines,
        },
        icon.lines(14),
      ),
    ),
  )
}

/** 主体：行号列（默认 CSS 隐藏，data-mdr-lines 开启才显示）+ pre。 */
function MdrFenceBody(props: { lang: string; code: string }): unknown {
  return createElement(
    'div',
    { className: MDR_FENCE_BODY_CLASS },
    createElement('div', { className: MDR_FENCE_NUMS_CLASS, 'aria-hidden': 'true' }, lineNumbersText(props.code)),
    createElement('pre', { className: MDR_FENCE_CODE_CLASS, tabIndex: 0 }, codeBodyNode(props.lang, props.code)),
  )
}

/** 底栏：行数/语言说明 + 「渲染为…」三态（当前视图由 view 传入，代码视图三态均不激活）。 */
function MdrFenceFoot(props: { lang: string; code: string; view: string }): unknown {
  return createElement(
    'div',
    { className: MDR_FENCE_FOOT_CLASS },
    createElement('span', { className: MDR_FENCE_NOTE_CLASS }, fenceLineNote(props.code, props.lang)),
    MdrLangSwitchFrom({ current: props.view }),
  )
}

/**
 * 代码围栏卡（契约导出）：props = { lang, code, title? }；内部可选 view 用于底栏三态
 * （代码视图无对应选项 → 三个按钮都不激活，如实反映「自动判定为代码」）。
 */
function MdrCodeBlock(props: { lang: string; code: string; title?: string; view?: string }): unknown {
  const lang = typeof props.lang === 'string' ? props.lang : ''
  const code = typeof props.code === 'string' ? props.code : ''
  const title = typeof props.title === 'string' ? props.title : ''
  const view = typeof props.view === 'string' && props.view !== '' ? props.view : 'code'
  const [wrap, setWrap] = useState(false)
  const [lines, setLines] = useState(false)
  return createElement(
    'div',
    {
      className: MDR_FENCE_CLASS,
      'data-mdr-fence': 'code',
      'data-mdr-lang': lang,
      'data-mdr-lines': lines ? 'on' : 'off',
      'data-mdr-wrap': wrap ? 'on' : 'off',
    },
    MdrFenceHead({
      lang,
      title,
      code,
      wrap,
      lines,
      onWrap: () => setWrap(!wrap),
      onLines: () => setLines(!lines),
    }),
    MdrFenceBody({ lang, code }),
    MdrFenceFoot({ lang, code, view }),
  )
}

exports.CODE_HOST_CLASS = CODE_HOST_CLASS
exports.MDR_FENCE_CLASS = MDR_FENCE_CLASS
exports.MDR_FENCE_PILL_CLASS = MDR_FENCE_PILL_CLASS
exports.MDR_FENCE_CODE_CLASS = MDR_FENCE_CODE_CLASS
exports.MAX_HIGHLIGHT_CHARS = MAX_HIGHLIGHT_CHARS
exports.MDR_HL_SCOPE_CLASS = MDR_HL_SCOPE_CLASS
exports.hlClassOf = hlClassOf
exports.hlTokenNodes = hlTokenNodes
exports.highlightNodes = highlightNodes
exports.lineNumbersText = lineNumbersText
exports.fenceLineNote = fenceLineNote
exports.MdrFenceHead = MdrFenceHead
exports.MdrFenceBody = MdrFenceBody
exports.MdrFenceFoot = MdrFenceFoot
exports.MdrCodeBlock = MdrCodeBlock
