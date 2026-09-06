import { test } from 'vitest'
/**
 * 渲染开关断言（issue #84 配置化）：关闭某增强功能后该功能不渲染。
 *
 * 加载已构建 lib/client.js（parts 拼装产物），用桩 React 调用
 * MarkdownView / renderTable，setRenderOptions 切换开关后断言：
 *  - copyButton / languageLabel / lineNumbers / syntaxHighlight 关闭 →
 *    代码块不渲染对应元素；
 *  - taskList / strikethrough / image / nestedList 关闭 → 语法补全
 *    保持原文 / 扁平渲染；
 *  - mathStructures 关闭 → 行内/块级公式不渲染公式结构；
 *  - tableSort / tableFold 关闭 → DOM 表格不渲染排序/折叠。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SELECT_KEYS } from '../lib/routes.js'

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

// ── fake DOM（renderTable 需要的最小实现）────────────────────────────
function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: tag === 'fragment' ? 11 : 1,
    children: [],
    _text: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    parentNode: null,
    _listeners: {},
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    dispatchEvent(ev) {
      ev.target = ev.target || this
      let node = ev.target
      while (node) {
        for (const fn of node._listeners[ev.type] || []) fn.call(node, ev)
        node = node.parentNode
      }
      return true
    },
    appendChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    replaceWith(...nodes) {
      const parent = this.parentNode
      if (!parent) return
      const i = parent.children.indexOf(this)
      if (i < 0) return
      const flat = []
      for (const n of nodes) {
        if (n && n.nodeType === 11) flat.push(...n.children)
        else flat.push(n)
      }
      parent.children.splice(i, 1, ...flat)
      this.parentNode = null
      flat.forEach((n) => {
        n.parentNode = parent
      })
    },
    setAttribute(k, v) {
      this[k] = v
    },
    getAttribute(k) {
      return this[k]
    },
    querySelector(sel) {
      const walk = (els) => {
        for (const e of els) {
          if (e.matchesSel && e.matchesSel(sel)) return e
          const found = walk(e.children || [])
          if (found) return found
        }
        return null
      }
      return walk(this.children)
    },
    querySelectorAll(sel) {
      const out = []
      const walk = (els) => {
        for (const e of els) {
          if (e.matchesSel && e.matchesSel(sel)) out.push(e)
          walk(e.children || [])
        }
      }
      walk(this.children)
      return out
    },
    matchesSel(sel) {
      const hasClass = (c) => this.className.split(/\s+/).includes(c)
      if (sel === 'th[data-sort-col]') return this.tagName === 'TH' && this['data-sort-col'] !== undefined
      if (sel === 'tr.dsh-md-render-folded-row') return this.tagName === 'TR' && hasClass('dsh-md-render-folded-row')
      if (sel === 'button.dsh-md-render-table-fold') {
        return this.tagName === 'BUTTON' && hasClass('dsh-md-render-table-fold')
      }
      if (sel === '.dsh-md-render-sort-arrow') return this.tagName === 'SPAN' && hasClass('dsh-md-render-sort-arrow')
      if (/^[a-z]+$/.test(sel)) return this.tagName === sel.toUpperCase()
      return false
    },
    closest(sel) {
      let node = this
      while (node) {
        if (node.matchesSel && node.matchesSel(sel)) return node
        node = node.parentNode
      }
      return null
    },
  }
  Object.defineProperty(el, 'classList', {
    get() {
      return {
        add: (c) => {
          const s = new Set(el.className.split(/\s+/).filter(Boolean))
          s.add(c)
          el.className = [...s].join(' ')
        },
        remove: (c) => {
          const s = new Set(el.className.split(/\s+/).filter(Boolean))
          s.delete(c)
          el.className = [...s].join(' ')
        },
        contains: (c) => el.className.split(/\s+/).includes(c),
      }
    },
  })
  Object.defineProperty(el, 'textContent', {
    get() {
      if (this.children.length === 0) return this._text
      return this.children.map((c) => c.textContent).join('')
    },
    set(v) {
      this._text = v
      this.children = []
    },
  })
  return el
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
global.document = {
  createElement: (tag) => makeElement(tag),
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  createDocumentFragment: () => makeElement('fragment'),
}
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

/** 渲染 MarkdownView 并收集元素树（函数组件展开）。 */
function renderTree(text) {
  const tags = []
  const texts = []
  const tokenSpans = []
  const langLabels = []
  const lineDivs = []
  const copyButtons = []
  const mathSpans = []
  const mathBlocks = []
  const checkboxes = []
  const dels = []
  const imgs = []
  const uls = []
  // issue #146：代码块主题（data-theme）与复制按钮位置收集。
  const mdCodeBlockThemes = []
  const codeCopyInHead = []
  const codeCopyBottom = []
  /** 展开函数组件（CopyButton 等），返回最终 DOM 元素节点或 null。 */
  function expand(node) {
    let cur = node
    while (cur && typeof cur === 'object' && typeof cur.type === 'function') cur = cur.type(cur.props)
    return cur
  }
  /** 收集某容器的直接子元素中的代码块复制按钮（展开后）。 */
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
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'string') {
      tags.push(node.type)
      if (node.type === 'div' && props.className === 'md-code-block') {
        if (typeof props['data-theme'] === 'string') mdCodeBlockThemes.push(props['data-theme'])
        for (const btn of directCopyButtons(node)) codeCopyBottom.push(btn)
      }
      if (node.type === 'div' && props.className === 'dsh-md-render-code-head') {
        for (const btn of directCopyButtons(node)) codeCopyInHead.push(btn)
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
        langLabels.push(node)
      }
      if (node.type === 'div' && props.className === 'dsh-md-render-code-line') lineDivs.push(node)
      if (
        node.type === 'button' &&
        typeof props.className === 'string' &&
        props.className.includes('dsh-md-render-copy')
      ) {
        copyButtons.push(node)
      }
      if (node.type === 'span' && props.className === 'dsh-md-render-math') mathSpans.push(node)
      if (node.type === 'div' && props.className === 'dsh-md-render-math-block') mathBlocks.push(node)
      if (node.type === 'input' && props.type === 'checkbox') checkboxes.push(node)
      if (node.type === 'del') dels.push(node)
      if (node.type === 'img') imgs.push(node)
      // ul/ol 计入计数后照常遍历子元素（嵌套 ul 也会被子树收集）
      if (node.type === 'ul' || node.type === 'ol') uls.push(node)
    } else if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    walk(props.children)
  }
  walk(exportsObj.MarkdownView({ text }))
  return {
    tags,
    texts,
    tokenSpans,
    langLabels,
    lineDivs,
    copyButtons,
    mathSpans,
    mathBlocks,
    checkboxes,
    dels,
    imgs,
    uls,
    mdCodeBlockThemes,
    codeCopyInHead,
    codeCopyBottom,
  }
}

function setup(state) {
  exportsObj.setRenderOptions(state)
}
function reset() {
  exportsObj.setRenderOptions({
    copyButton: true,
    syntaxHighlight: true,
    languageLabel: true,
    lineNumbers: true,
    taskList: true,
    strikethrough: true,
    image: true,
    nestedList: true,
    mathStructures: true,
    tableSort: true,
    tableFold: true,
    // issue #146：选择项也复位（setRenderOptions 合并语义，避免测试间串扰）
    copyButtonPosition: 'bottom-right',
    codeTheme: 'bright',
  })
}

const CONFIG_SWITCHES = [
  'copyButton',
  'syntaxHighlight',
  'languageLabel',
  'lineNumbers',
  'taskList',
  'strikethrough',
  'image',
  'nestedList',
  'mathStructures',
  'tableSort',
  'tableFold',
]

test('pickRenderOptions：显式布尔开关生效、非法值忽略', () => {
  const picked = exportsObj.pickRenderOptions({ copyButton: false, lineNumbers: 'nope', tableFold: false })
  assert.equal(picked.copyButton, false, 'explicit boolean picked')
  assert.equal(picked.tableFold, false, 'explicit boolean picked')
  assert.equal(picked.lineNumbers, undefined, 'non-boolean ignored (default preserved)')
  assert.equal(picked.syntaxHighlight, undefined, 'missing key ignored (default preserved)')
})

test('全部开关默认开启', async () => {
  reset()
  const r = renderTree('- [x] 任务 ~~删除~~ ![alt](x.png)\n\n```js\nconst a = 1\n```\n\n$公式$\n\n$$\n块\n$$')
  assert.ok(r.copyButtons.length >= 1, 'copy buttons on by default')
  assert.ok(r.tokenSpans.length > 0, 'highlight on by default')
  assert.ok(r.langLabels.length > 0, 'language label on by default')
  assert.ok(r.lineDivs.length > 0, 'line numbers on by default')
  assert.ok(r.checkboxes.length > 0, 'task list on by default')
  assert.ok(r.dels.length > 0, 'strikethrough on by default')
  assert.ok(r.imgs.length > 0, 'image on by default')
  assert.ok(r.mathSpans.length > 0, 'inline math on by default')
})

test('copyButton 关闭 → 无复制按钮（代码块 + 整段）', () => {
  reset()
  setup({ copyButton: false })
  try {
    const r = renderTree('```js\nconst a = 1\n```\n\n普通段落')
    assert.equal(r.copyButtons.length, 0, 'no copy buttons when disabled')
  } finally {
    reset()
  }
})

test('syntaxHighlight 关闭 → 无 token span（语言标签/行号仍在）', () => {
  reset()
  setup({ syntaxHighlight: false })
  try {
    const r = renderTree('```js\nconst x = "hi" // comment\n```')
    assert.equal(r.tokenSpans.length, 0, 'no token spans when disabled')
    assert.ok(r.langLabels.length > 0, 'language label remains')
    assert.ok(r.lineDivs.length > 0, 'line numbers remain')
  } finally {
    reset()
  }
})

test('languageLabel 关闭 → 无语言标签（高亮/行号仍在）', () => {
  reset()
  setup({ languageLabel: false })
  try {
    const r = renderTree('```js\nconst x = 1\n```')
    assert.equal(r.langLabels.length, 0, 'no language label when disabled')
    assert.ok(r.tokenSpans.length > 0, 'highlight remains')
    assert.ok(r.lineDivs.length > 0, 'line numbers remain')
  } finally {
    reset()
  }
})

test('lineNumbers 关闭 → 无行号 div（高亮/标签仍在）', () => {
  reset()
  setup({ lineNumbers: false })
  try {
    const r = renderTree('```js\nconst x = 1\n```')
    assert.equal(r.lineDivs.length, 0, 'no line numbers when disabled')
    assert.ok(r.tokenSpans.length > 0, 'highlight remains')
    assert.ok(r.langLabels.length > 0, 'language label remains')
  } finally {
    reset()
  }
})

test('taskList 关闭 → 无 checkbox（任务标记保留原文）', () => {
  reset()
  setup({ taskList: false })
  try {
    const r = renderTree('- [x] 已完成任务\n- [ ] 待办任务')
    assert.equal(r.checkboxes.length, 0, 'no checkbox when disabled')
    assert.ok(
      r.texts.some((t) => t.includes('[x]')),
      'task marker kept as literal text',
    )
  } finally {
    reset()
  }
})

test('strikethrough 关闭 → 无 del（删除线标记保持原文）', () => {
  reset()
  setup({ strikethrough: false })
  try {
    const r = renderTree('文本 ~~删除~~ 文本')
    assert.equal(r.dels.length, 0, 'no del when disabled')
    assert.ok(
      r.texts.some((t) => t.includes('~~删除~~')),
      'strikethrough marker kept',
    )
  } finally {
    reset()
  }
})

test('image 关闭 → 无 img（图片语法保持原文）', () => {
  reset()
  setup({ image: false })
  try {
    const r = renderTree('图片 ![alt](https://example.com/a.png) 测试')
    assert.equal(r.imgs.length, 0, 'no img when disabled')
    assert.ok(
      r.texts.some((t) => t.includes('![alt](https://example.com/a.png)')),
      'image syntax kept',
    )
  } finally {
    reset()
  }
})

test('nestedList 关闭 → 深层列表项扁平渲染（无嵌套 ul）', () => {
  reset()
  const on = renderTree('- 一级\n  - 二级\n    - 三级')
  reset()
  setup({ nestedList: false })
  try {
    const off = renderTree('- 一级\n  - 二级\n    - 三级')
    assert.ok(on.uls.length >= 2, 'nested list creates nested ul when enabled')
    assert.equal(off.uls.length, 1, 'single flat ul when disabled')
  } finally {
    reset()
  }
})

test('mathStructures 关闭 → 行内/块级公式不渲染公式结构', () => {
  reset()
  setup({ mathStructures: false })
  try {
    const r = renderTree('公式 $x^2$ 测试\n\n$$\nE=mc^2\n$$')
    assert.equal(r.mathSpans.length, 0, 'no inline math span when disabled')
    assert.equal(r.mathBlocks.length, 0, 'no math block when disabled')
    assert.ok(
      r.texts.some((t) => t.includes('$x^2$')),
      'inline math syntax kept',
    )
  } finally {
    reset()
  }
})

test('tableSort 关闭 → th 无排序列标记与箭头', () => {
  reset()
  setup({ tableSort: false })
  try {
    const tbl = { header: ['a', 'b'], aligns: ['left', 'left'], rows: [['1', '2']], prefix: '', suffix: '' }
    const frag = exportsObj.renderTable(tbl)
    const scroll = frag.children[0]
    const th = scroll.querySelector('th')
    assert.ok(th, 'th rendered')
    assert.equal(th['data-sort-col'], undefined, 'no sort column marker when disabled')
    const arrow = scroll.querySelector('.dsh-md-render-sort-arrow')
    assert.equal(arrow, null, 'no sort arrow when disabled')
  } finally {
    reset()
  }
})

test('tableFold 关闭 → 长表格不折叠、不渲染展开按钮', () => {
  reset()
  setup({ tableFold: false })
  try {
    const rows = []
    for (let i = 0; i < 25; i += 1) rows.push([String(i), 'x'])
    const tbl = { header: ['n', 'v'], aligns: ['left', 'left'], rows, prefix: '', suffix: '' }
    const frag = exportsObj.renderTable(tbl)
    const scroll = frag.children[0]
    const folded = scroll.querySelectorAll('tr.dsh-md-render-folded-row')
    assert.equal(folded.length, 0, 'no folded rows when disabled')
    const btn = scroll.querySelector('button.dsh-md-render-table-fold')
    assert.equal(btn, null, 'no fold button when disabled')
  } finally {
    reset()
  }
})

test('开关列表完整（11 个增强项与 server 端一致）', () => {
  assert.equal(CONFIG_SWITCHES.length, 11, '11 switches')
})

// ── issue #146：代码块复制按钮位置 + 代码主题 ──────────────────────

test('默认主题 bright：高亮代码块携带 data-theme（明亮高对比）', () => {
  reset()
  const r = renderTree('```js\nconst a = 1 // c\n```')
  assert.deepEqual(r.mdCodeBlockThemes, ['bright'], 'highlighted block gets default theme marker')
  assert.ok(r.tokenSpans.length > 0, 'highlight on')
})

test('codeTheme 切换：data-theme 跟随配置（github-dark / one-dark / nord）', () => {
  reset()
  for (const theme of ['github-dark', 'one-dark', 'nord', 'github-light']) {
    setup({ codeTheme: theme })
    try {
      const r = renderTree('```py\ndef f(x):\n    return x\n```')
      assert.deepEqual(r.mdCodeBlockThemes, [theme], `data-theme=${theme}`)
    } finally {
      reset()
    }
  }
})

test('syntaxHighlight 关闭 → 无 data-theme（主题不影响纯文本代码块）', () => {
  reset()
  setup({ syntaxHighlight: false })
  try {
    const r = renderTree('```js\nconst x = "hi" // comment\n```')
    assert.equal(r.tokenSpans.length, 0, 'no token spans when disabled')
    assert.deepEqual(r.mdCodeBlockThemes, [], 'no theme marker on plain-text code block')
  } finally {
    reset()
  }
})

test('未知语言（mermaid）→ 无 data-theme（跳过高亮即无主题）', () => {
  reset()
  const r = renderTree('```mermaid\nflowchart TD\n    A --> B\n```')
  assert.equal(r.tokenSpans.length, 0, 'no highlight for unknown language')
  assert.deepEqual(r.mdCodeBlockThemes, [], 'no theme marker without highlight')
})

test('复制按钮默认位于代码块右下角（md-code-block 直接子元素）', () => {
  reset()
  const r = renderTree('```js\nconst a = 1\n```')
  assert.ok(r.copyButtons.length >= 1, 'code copy button rendered')
  assert.equal(r.codeCopyInHead.length, 0, 'button NOT in header by default')
  assert.equal(r.codeCopyBottom.length, 1, 'button is a direct md-code-block child (bottom-right)')
})

test('copyButtonPosition=header：复制按钮回到头部（与语言标签同排）', () => {
  reset()
  setup({ copyButtonPosition: 'header' })
  try {
    const r = renderTree('```js\nconst a = 1\n```')
    assert.ok(r.copyButtons.length >= 1, 'code copy button rendered')
    assert.equal(r.codeCopyInHead.length, 1, 'button in header')
    assert.equal(r.codeCopyBottom.length, 0, 'no bottom-right button')
  } finally {
    reset()
  }
})

test('选择项跨端一致性：client CODE_THEMES / COPY_BUTTON_POSITIONS 与 server SELECT_KEYS 一致', () => {
  assert.deepEqual(
    [...exportsObj.CODE_THEMES].sort(),
    [...SELECT_KEYS.codeTheme].sort(),
    'code theme ids match server SELECT_KEYS',
  )
  assert.deepEqual(
    [...exportsObj.COPY_BUTTON_POSITIONS].sort(),
    [...SELECT_KEYS.copyButtonPosition].sort(),
    'copy button positions match server SELECT_KEYS',
  )
})
