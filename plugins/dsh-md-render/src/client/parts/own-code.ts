// ── 自研代码块渲染（语法高亮 + 真实语言名 banner + 复制 + 自动换行）──────────
// 用户口径（最高优先级）：「代码渲染使用我们自己的，不要使用原生的」。
// 本模块**不调用官方 CodeBlock / MarkdownText**：banner 自己画（语言名用**围栏 info
// string 的真实 token**，不是官方的本地化标签「代码块」）、复制按钮自己实现、
// 高亮走懒加载的 highlight.js（assets/highlightjs-*.min.js，不进 bundle）。
//
// 高亮实现（刻意不用 innerHTML）：
//   highlight.js 的结果对象带 `_emitter` 令牌树（root.children：字符串 / {scope,children}），
//   本模块按 hljs 自己的 `scopeToCSSClass` 口径把 scope 映射成 `hljs-*` class，再落成
//   **React vdom span** —— 全程没有字符串拼 HTML、没有 dangerouslySetInnerHTML，
//   模型输出不会被当 HTML 执行（与官方「raw HTML 保持字面文本」同一条安全口径）。
//
// 降级（真降级）：hljs 没加载好 / 语言不在 hljs 语言表 / 超长（> MAX_HIGHLIGHT_CHARS）
//   一律渲染**纯文本**代码块（内容一字不少，只是没有着色）；hljs 就绪后签名变化会重建一次。

/** 代码块渲染容器类名（block-render.ts 插入块内的自有节点）。 */
const CODE_HOST_CLASS = 'dsh-md-render-code-host'
/** 代码卡片类名。 */
const CODE_VIEW_CLASS = 'dsh-md-render-code'
/** banner 行 / 语言名 / 操作区 / 复制按钮类名。 */
const CODE_HEAD_CLASS = 'dsh-md-render-code-head'
const CODE_LANG_CLASS = 'dsh-md-render-code-lang'
const CODE_ACTIONS_CLASS = 'dsh-md-render-code-actions'
const CODE_COPY_CLASS = 'dsh-md-render-code-copy'
/** 换行切换按钮类名 / 换行态下追加到 pre 的类名（**默认不换行** = 横向滚动）。 */
const CODE_WRAP_BTN_CLASS = 'dsh-md-render-code-wrap-btn'
const CODE_WRAP_CLASS = 'dsh-md-render-code-wrap'
/** 代码主体行（行号列 + pre 的横向滚动容器）/ 行号列 / 行号切换按钮类名。 */
const CODE_BODY_CLASS = 'dsh-md-render-code-body'
const CODE_NUMS_CLASS = 'dsh-md-render-code-nums'
const CODE_LINES_BTN_CLASS = 'dsh-md-render-code-lines-btn'
/** 代码主体容器（pre）/ 无高亮时的纯文本 code 类名。 */
const CODE_PRE_CLASS = 'dsh-md-render-code-pre'
const CODE_TEXT_CLASS = 'dsh-md-render-code-text'
/** hljs class 前缀（hljs 的 options.classPrefix 默认值，逐字对齐）。 */
const HLJS_CLASS_PREFIX = 'hljs-'
/** 单块高亮上限（字符）：超出只做纯文本渲染（高亮是 O(代码长度) 的正则扫描）。 */
const MAX_HIGHLIGHT_CHARS = 60000

/** hljs 令牌树节点（字符串 = 纯文本片段）。 */
interface HljsNode {
  scope?: unknown
  children?: unknown
}

/**
 * hljs scope → CSS class（与 hljs HTMLRenderer 的 `scopeToCSSClass` **逐字同口径**）：
 *  · `language:xxx` → `language-xxx`（子语言）；
 *  · 分级 scope `comment.line` → `hljs-comment line`；
 *  · 简单 scope `keyword` → `hljs-keyword`。
 */
function hljsScopeClass(scope: unknown): string {
  const name = String(scope ?? '')
  if (name === '') return ''
  if (name.indexOf('language:') === 0) return name.replace('language:', 'language-')
  if (name.indexOf('.') >= 0) {
    const pieces = name.split('.')
    const head = pieces.shift() ?? ''
    const tail = pieces.map((piece, index) => piece + '_'.repeat(index + 1))
    return [HLJS_CLASS_PREFIX + head, ...tail].join(' ')
  }
  return HLJS_CLASS_PREFIX + name
}

/** 令牌树 → vdom 子节点（无 scope 的容器节点**不包 span**，与 hljs 的 emitsWrappingTags 一致）。 */
function hljsChildren(node: HljsNode, keyBase: string, out: unknown[]): void {
  const children = Array.isArray(node.children) ? node.children : []
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as unknown
    if (typeof child === 'string') {
      out.push(child)
      continue
    }
    if (child === null || typeof child !== 'object') continue
    const key = keyBase + '-' + i
    const inner: unknown[] = []
    hljsChildren(child as HljsNode, key, inner)
    const className = hljsScopeClass((child as HljsNode).scope)
    if (className === '') {
      for (const item of inner) out.push(item)
      continue
    }
    out.push(createElement('span', { key, className }, ...inner))
  }
}

/** 从 hljs 结果里取令牌树根（结果 / _emitter / root 任一层缺失 → null）。 */
function hljsRootOf(result: unknown): HljsNode | null {
  if (result === null || result === undefined) return null
  const emitter = (result as { _emitter?: { root?: HljsNode } })._emitter
  if (emitter === null || emitter === undefined) return null
  const root = emitter.root
  return root === null || root === undefined ? null : root
}

/** 真正调 hljs（语言存在但语法扫描抛错 → 纯文本降级，不冒泡）。 */
function highlightWith(hljs: Record<string, unknown>, lang: string, code: string): unknown[] | null {
  try {
    if (!(hljs.getLanguage as (name: string) => unknown).call(hljs, lang)) return null
    const result = (hljs.highlight as (code: string, options: unknown) => unknown).call(hljs, code, {
      language: lang,
      ignoreIllegals: true,
    })
    const root = hljsRootOf(result)
    if (root === null) return null
    const out: unknown[] = []
    hljsChildren(root, 'hl', out)
    return out.length === 0 ? null : out
  } catch (_e) {
    return null
  }
}

/**
 * 高亮一段代码：返回 vdom 子节点数组；**任何一步不成立就返回 null**（调用方渲染纯文本）。
 * 用 hljs 结果里的 `_emitter` 令牌树，不消费它的 HTML 字符串。
 */
function highlightCodeNodes(lang: string, code: string): unknown[] | null {
  if (lang === '' || code === '' || code.length > MAX_HIGHLIGHT_CHARS) return null
  const hljs = ensureRenderAsset(HLJS_ASSET)
  if (hljs === null) return null
  if (typeof hljs.getLanguage !== 'function') return null
  return highlightWith(hljs, lang, code)
}

/** 代码主体：有高亮 → hljs class 的 span 树；否则纯文本（内容一字不少）。 */
function codeBodyNodes(lang: string, source: string): unknown {
  const nodes = highlightCodeNodes(lang, source)
  if (nodes === null) return createElement('code', { className: CODE_TEXT_CLASS }, source)
  return createElement('code', { className: HLJS_CLASS_PREFIX + 'code' }, ...nodes)
}

/**
 * 行号列文本：按**逻辑行**（`\n` 切分）逐行编号，与代码行一一对齐。
 * 用 `\n` join + `white-space:pre` 呈现，行高与 pre 同源 → 两列天然对齐。
 */
function lineNumbersText(source: string): string {
  const count = source.split('\n').length
  const out: string[] = []
  for (let i = 1; i <= count; i += 1) out.push(String(i))
  return out.join('\n')
}

/** 代码卡片头部：语言胶囊 + 操作区（行号 / 换行 / 复制）。 */
function CodeHead({
  lang,
  lines,
  wrap,
  copied,
  onToggleLines,
  onToggleWrap,
  onCopy,
}: {
  lang: string
  lines: boolean
  wrap: boolean
  copied: boolean
  onToggleLines: () => void
  onToggleWrap: () => void
  onCopy: () => void
}): unknown {
  const copyLabel = copied ? '已复制' : '复制'
  const wrapLabel = wrap ? '取消换行' : '自动换行'
  const linesLabel = lines ? '隐藏行号' : '显示行号'
  return createElement(
    'div',
    { className: CODE_HEAD_CLASS },
    createElement('span', { className: CODE_LANG_CLASS }, lang === '' ? '' : lang),
    createElement(
      'div',
      { className: CODE_ACTIONS_CLASS },
      // data-dsh-md-render-tip = 悬停浮层文字（styles.ts 的 [data-dsh-md-render-tip]::after）；
      // 文字收起后它是唯一的可视提示。aria-pressed 用字符串而非布尔：React 对 aria-* 原样写 true|false。
      createElement(
        'button',
        {
          type: 'button',
          className: CODE_LINES_BTN_CLASS,
          'aria-label': linesLabel,
          'data-dsh-md-render-tip': linesLabel,
          'aria-pressed': lines ? 'true' : 'false',
          onClick: onToggleLines,
        },
        icon.lines(14),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: CODE_WRAP_BTN_CLASS,
          'aria-label': wrapLabel,
          'data-dsh-md-render-tip': wrapLabel,
          'aria-pressed': wrap ? 'true' : 'false',
          onClick: onToggleWrap,
        },
        icon.wrap(14),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: CODE_COPY_CLASS,
          'aria-label': copyLabel,
          // 状态也写进 data-state：styles.ts 靠它让成功态的浮层**常显** + 图标换勾（状态不能只靠悬停才知道）。
          'data-state': copied ? 'copied' : 'idle',
          'data-dsh-md-render-tip': copyLabel,
          onClick: onCopy,
        },
        // 图标常显、文字走悬停浮层（styles.ts 的 [data-dsh-md-render-tip]::after）。
        icon.copy(14),
      ),
    ),
  )
}

/** 代码主体：行号列（可选）+ pre —— 两者同属一个横向滚动容器（原型 .fence-body 同构）。 */
function CodeBody({
  lang,
  source,
  wrap,
  showLines,
}: {
  lang: string
  source: string
  wrap: boolean
  showLines: boolean
}): unknown {
  return createElement(
    'div',
    { className: CODE_BODY_CLASS },
    showLines
      ? createElement('div', { className: CODE_NUMS_CLASS, 'aria-hidden': 'true' }, lineNumbersText(source))
      : null,
    // 换行态只**追加**类名，原有 CODE_PRE_CLASS 保留（样式由 styles.ts 统一提供）。
    createElement(
      'pre',
      { className: CODE_PRE_CLASS + (wrap ? ' ' + CODE_WRAP_CLASS : ''), tabIndex: 0 },
      codeBodyNodes(lang, source),
    ),
  )
}

/**
 * 自研代码块：banner（真实语言名 + 行号切换 + 换行切换 + 复制）+ pre。
 *
 * 行号切换（原型 §代码围栏块 的 lines-btn）：**默认关闭**（与现状默认形态一致），
 * 打开后左侧出现行号列，与代码同行高对齐。行号列按逻辑行编号，**换行态下自动隐藏**
 * （自动换行后一个逻辑行会占多行物理行，行号列会错位）；点行号时若处于换行态，
 * 先收起换行再开行号，避免「按了没反应」。
 *
 * 换行切换（官方 CodeToolbar 有、此前自研版漏掉的能力）：按钮排在**复制之前**，
 * 点一次在「不换行（横向滚动）」与「自动换行」之间切换，可访问名 / aria-pressed 同步。
 * **默认不换行** —— 与现状（以及官方默认形态）一致，不改变默认视觉行为。
 *
 * `lang` 为空 = 该块语言识别不出 —— 此时**不编造语言名**，banner 语言位留空。
 */
function CodeBlockView({ lang, code }: { lang: string; code: string }): unknown {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [lines, setLines] = useState(false)
  const source = typeof code === 'string' ? code : String(code ?? '')
  const onCopy = (): void => {
    copyText(source).then(
      () => setCopied(true),
      () => {},
    )
  }
  const onToggleWrap = (): void => setWrap(!wrap)
  const onToggleLines = (): void => {
    if (!lines && wrap) setWrap(false)
    setLines(!lines)
  }
  return createElement(
    'div',
    { className: CODE_VIEW_CLASS },
    createElement(CodeHead, { lang, lines, wrap, copied, onToggleLines, onToggleWrap, onCopy }),
    // 行号列只在「已开启且未换行」时出现（换行后逻辑行 ≠ 物理行，行号必然错位）。
    createElement(CodeBody, { lang, source, wrap, showLines: lines && !wrap }),
  )
}

exports.CODE_HOST_CLASS = CODE_HOST_CLASS
exports.CODE_VIEW_CLASS = CODE_VIEW_CLASS
exports.CODE_LANG_CLASS = CODE_LANG_CLASS
exports.CODE_WRAP_BTN_CLASS = CODE_WRAP_BTN_CLASS
exports.CODE_WRAP_CLASS = CODE_WRAP_CLASS
exports.CODE_BODY_CLASS = CODE_BODY_CLASS
exports.CODE_NUMS_CLASS = CODE_NUMS_CLASS
exports.CODE_LINES_BTN_CLASS = CODE_LINES_BTN_CLASS
exports.CODE_PRE_CLASS = CODE_PRE_CLASS
exports.MAX_HIGHLIGHT_CHARS = MAX_HIGHLIGHT_CHARS
exports.hljsScopeClass = hljsScopeClass
exports.lineNumbersText = lineNumbersText
exports.highlightCodeNodes = highlightCodeNodes
exports.CodeBlockView = CodeBlockView
