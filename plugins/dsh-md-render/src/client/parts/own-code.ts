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
 * 自研代码块：banner（真实语言名 + 复制）+ 自动换行的 pre。
 * `lang` 为空 = 该块语言识别不出 —— 此时**不编造语言名**，banner 语言位留空。
 */
function CodeBlockView({ lang, code }: { lang: string; code: string }): unknown {
  const [copied, setCopied] = useState(false)
  const source = typeof code === 'string' ? code : String(code ?? '')
  const onCopy = (): void => {
    copyText(source).then(
      () => setCopied(true),
      () => {},
    )
  }
  const copyLabel = copied ? '已复制' : '复制'
  return createElement(
    'div',
    { className: CODE_VIEW_CLASS },
    createElement(
      'div',
      { className: CODE_HEAD_CLASS },
      createElement('span', { className: CODE_LANG_CLASS }, lang === '' ? '' : lang),
      createElement(
        'div',
        { className: CODE_ACTIONS_CLASS },
        createElement(
          'button',
          { type: 'button', className: CODE_COPY_CLASS, title: copyLabel, 'aria-label': copyLabel, onClick: onCopy },
          copyLabel,
        ),
      ),
    ),
    createElement('pre', { className: CODE_PRE_CLASS, tabIndex: 0 }, codeBodyNodes(lang, source)),
  )
}

exports.CODE_HOST_CLASS = CODE_HOST_CLASS
exports.CODE_VIEW_CLASS = CODE_VIEW_CLASS
exports.CODE_LANG_CLASS = CODE_LANG_CLASS
exports.CODE_PRE_CLASS = CODE_PRE_CLASS
exports.MAX_HIGHLIGHT_CHARS = MAX_HIGHLIGHT_CHARS
exports.hljsScopeClass = hljsScopeClass
exports.highlightCodeNodes = highlightCodeNodes
exports.CodeBlockView = CodeBlockView
