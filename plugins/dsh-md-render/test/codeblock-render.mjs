import { test } from 'vitest'
/**
 * Code-block render assertions for dsh-md-render (issue #80):
 *  - syntax-highlight token spans (keyword / string / comment / number),
 *  - language label in the block header (same row as the #74 copy button),
 *  - line numbers (CSS counter line divs) with the configurable toggle,
 *  - unknown language falls back to plain text (no token spans),
 *  - code <code> textContent stays the raw code (mermaid/copy unaffected),
 *  - the #74 copy button coexists with the header layout.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}
const stubbed = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
}

let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
global.document = undefined
global.Element = function Element() {}
global.MutationObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
}

eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.MarkdownView, 'function', 'MarkdownView exported')

/** Render MarkdownView and collect the code-block surface for assertions. */
function renderBlock(config) {
  const tree = exportsObj.MarkdownView({ text: config.text })
  const tokenSpans = []
  const langLabels = []
  const lineDivs = []
  const copyButtons = []
  const codeLangs = []
  const codeElements = []
  const mdCodeBlockThemes = []
  const codeCopyInHead = []
  const codeCopyBottom = []
  let mdCodeBlockWrappers = 0
  /** 展开函数组件（CopyButton 等），返回最终 DOM 元素节点或 null。 */
  function expand(node) {
    let cur = node
    while (cur && typeof cur === 'object' && typeof cur.type === 'function') cur = cur.type(cur.props)
    return cur
  }
  /** 收集某容器直接子元素中的代码块复制按钮（展开后）。 */
  function directCopyButtons(container) {
    const kids = Array.isArray(container.props.children)
      ? container.props.children
      : container.props.children !== undefined && container.props.children !== null
        ? [container.props.children]
        : []
    const out = []
    for (const k of kids) {
      const el = expand(k)
      if (
        el &&
        typeof el === 'object' &&
        el.type === 'button' &&
        typeof el.props?.className === 'string' &&
        el.props.className.includes('dsh-md-render-copy')
      ) {
        out.push(el)
      }
    }
    return out
  }
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') return
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'string') {
      if (node.type === 'div' && props.className === 'md-code-block') {
        mdCodeBlockWrappers += 1
        if (typeof props['data-theme'] === 'string') mdCodeBlockThemes.push(props['data-theme'])
        for (const btn of directCopyButtons(node)) codeCopyBottom.push(btn)
      }
      if (node.type === 'div' && props.className === 'dsh-md-render-code-head') {
        for (const btn of directCopyButtons(node)) codeCopyInHead.push(btn)
      }
      if (node.type === 'code' && typeof props.className === 'string') {
        codeLangs.push(props.className)
        codeElements.push(node)
      }
      if (
        node.type === 'span' &&
        typeof props.className === 'string' &&
        props.className.startsWith('dsh-md-render-tok-')
      ) {
        tokenSpans.push(props.className)
      }
      if (
        node.type === 'span' &&
        typeof props.className === 'string' &&
        props.className.includes('dsh-md-render-code-lang')
      ) {
        langLabels.push(collectText(node))
      }
      if (node.type === 'div' && props.className === 'dsh-md-render-code-line') lineDivs.push(node)
      if (
        node.type === 'button' &&
        typeof props.className === 'string' &&
        props.className.includes('dsh-md-render-copy')
      ) {
        copyButtons.push(node)
      }
    } else if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    walk(props.children)
  }
  walk(tree)
  // code <code> 纯文本 = 叶子字符串拼接（行号是 CSS 伪元素，不在 React 树中）
  const codeRawText = codeElements.length ? collectText(codeElements[0]) : ''
  return {
    tokenSpanClasses: tokenSpans,
    langLabelTexts: langLabels,
    lineDivs,
    codeRawText,
    copyButtons,
    codeLangs,
    mdCodeBlockWrappers,
    mdCodeBlockThemes,
    codeCopyInHead,
    codeCopyBottom,
  }
}

/** 递归拼接某个子树下的叶子字符串（不含伪元素行号）。 */
function collectText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const kids = node && node.props && node.props.children
  if (kids === undefined) return ''
  if (typeof kids === 'string' || typeof kids === 'number') return String(kids)
  if (!Array.isArray(kids)) return ''
  return kids.map((c) => collectText(c)).join('')
}

function setupLineNumbers(value) {
  exportsObj.setRenderOptions({ lineNumbers: value })
}
function resetLineNumbers() {
  exportsObj.setRenderOptions({ lineNumbers: true })
}

const JS_CODE = '```js\nconst x = "hi" // comment\nlet n = 42\n```'

test('代码块：语法高亮 token span（关键字/字符串/注释/数字）', () => {
  const r = renderBlock({ text: JS_CODE })
  assert.ok(r.tokenSpanClasses.includes('dsh-md-render-tok-keyword'), 'keyword span')
  assert.ok(r.tokenSpanClasses.includes('dsh-md-render-tok-string'), 'string span')
  assert.ok(r.tokenSpanClasses.includes('dsh-md-render-tok-comment'), 'comment span')
  assert.ok(r.tokenSpanClasses.includes('dsh-md-render-tok-number'), 'number span')
})

test('代码块：语言标签显示（js → javascript，与 md-code-block 容器共存）', () => {
  const r = renderBlock({ text: JS_CODE })
  assert.equal(r.mdCodeBlockWrappers, 1, 'md-code-block container')
  assert.ok(r.langLabelTexts.includes('javascript'), 'language label javascript')
  assert.ok(r.codeLangs.includes('language-js'), 'code keeps language class')
})

test('代码块：行号默认开启（行 div 数量 = 代码行数）', () => {
  resetLineNumbers()
  const r = renderBlock({ text: JS_CODE })
  assert.equal(r.lineDivs.length, 2, '2 line-number divs for 2 code lines')
})

test('配置开关：setRenderOptions({lineNumbers:false}) 关闭行号', () => {
  setupLineNumbers(false)
  try {
    const r = renderBlock({ text: JS_CODE })
    assert.equal(r.lineDivs.length, 0, 'no line divs when disabled')
  } finally {
    resetLineNumbers()
  }
})

test('行号开启/关闭下 code 纯文本保持原样（复制/mermaid 不受污染）', () => {
  resetLineNumbers()
  const on = renderBlock({ text: JS_CODE })
  assert.equal(on.codeRawText, 'const x = "hi" // comment\nlet n = 42', 'raw code with line numbers on')
  setupLineNumbers(false)
  try {
    const off = renderBlock({ text: JS_CODE })
    assert.equal(off.codeRawText, 'const x = "hi" // comment\nlet n = 42', 'raw code with line numbers off')
  } finally {
    resetLineNumbers()
  }
})

test('未知语言回退纯文本（无 token span，仍有语言标签 + 行号）', () => {
  resetLineNumbers()
  const r = renderBlock({ text: '```mermaid\nflowchart TD\n    A --> B\n```' })
  assert.equal(r.tokenSpanClasses.length, 0, 'no syntax token spans for unknown language')
  assert.ok(r.langLabelTexts.includes('mermaid'), 'mermaid label shown')
  assert.equal(r.lineDivs.length, 2, 'line numbers still shown')
  assert.equal(r.codeRawText, 'flowchart TD\n    A --> B', 'raw mermaid source preserved')
})

test('与 #74 复制按钮共存（默认右下角，复制按钮仍渲染）', () => {
  const r = renderBlock({ text: JS_CODE })
  assert.ok(r.copyButtons.length >= 1, 'copy button still rendered')
  assert.equal(r.codeCopyBottom.length, 1, 'copy button at block bottom-right by default (issue #146)')
  assert.equal(r.codeCopyInHead.length, 0, 'not in header by default')
  assert.ok(r.tokenSpanClasses.length > 0, 'highlighting coexists with copy button')
})

// ── issue #146：代码主题（data-theme）与复制按钮位置配置 ────────────

test('默认主题 bright：高亮代码块携带 data-theme', () => {
  exportsObj.setRenderOptions({ codeTheme: 'bright' })
  const r = renderBlock({ text: JS_CODE })
  assert.deepEqual(r.mdCodeBlockThemes, ['bright'], 'highlighted block carries default theme')
  assert.ok(r.tokenSpanClasses.length > 0, 'highlight on')
})

test('主题切换：data-theme 跟随配置', () => {
  exportsObj.setRenderOptions({ codeTheme: 'github-dark' })
  try {
    const r = renderBlock({ text: JS_CODE })
    assert.deepEqual(r.mdCodeBlockThemes, ['github-dark'], 'data-theme follows codeTheme')
  } finally {
    exportsObj.setRenderOptions({ codeTheme: 'bright' })
  }
})

test('syntaxHighlight 关闭 → 无 data-theme（主题不影响纯文本代码块）', () => {
  exportsObj.setRenderOptions({ codeTheme: 'bright', syntaxHighlight: false })
  try {
    const r = renderBlock({ text: JS_CODE })
    assert.equal(r.tokenSpanClasses.length, 0, 'no token spans')
    assert.deepEqual(r.mdCodeBlockThemes, [], 'no theme marker on plain code block')
  } finally {
    exportsObj.setRenderOptions({ syntaxHighlight: true })
  }
})

test('未知语言（mermaid）→ 无 data-theme', () => {
  const r = renderBlock({ text: '```mermaid\nflowchart TD\n    A --> B\n```' })
  assert.equal(r.tokenSpanClasses.length, 0, 'no highlight')
  assert.deepEqual(r.mdCodeBlockThemes, [], 'no theme marker without highlight')
})

test('copyButtonPosition=header：复制按钮回到头部（与语言标签同排）', () => {
  exportsObj.setRenderOptions({ copyButtonPosition: 'header' })
  try {
    const r = renderBlock({ text: JS_CODE })
    assert.equal(r.codeCopyInHead.length, 1, 'copy button in header for header position')
    assert.equal(r.codeCopyBottom.length, 0, 'no bottom-right button')
  } finally {
    exportsObj.setRenderOptions({ copyButtonPosition: 'bottom-right' })
  }
})

test('多反引号/无语言代码块：无语言类，代码块仍可渲染', () => {
  const r = renderBlock({ text: '```\nplain text\n```' })
  assert.equal(r.codeLangs.includes('language-'), false, 'no language class set')
  assert.ok(r.langLabelTexts.includes('text'), 'plain block gets text label')
  assert.equal(r.lineDivs.length, 1, 'line numbers for plain block')
})
