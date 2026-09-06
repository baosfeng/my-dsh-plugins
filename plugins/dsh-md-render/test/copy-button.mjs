import { test } from 'vitest'
/**
 * Copy-button tests for dsh-md-render (issue #74).
 *
 * Loads the BUILT bundle lib/client.js (parts spliced by scripts/build.mjs)
 * against stubbed react + a fake DOM, materializes the MarkdownView element
 * tree into the fake DOM, then verifies:
 *  - every md-code-block renders a copy button at its bottom-right,
 *  - clicking the code-block button copies ONLY the code text (no language
 *    marker, no button label) via navigator.clipboard.writeText,
 *  - clicking the content button copies the whole tzx-md plain text with
 *    copy-button labels excluded,
 *  - clipboard failure falls back to document.execCommand('copy'),
 *  - the stylesheet hides copy buttons under [data-streaming] ancestors
 *    (streaming: buttons render but are CSS-hidden until the stream ends).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react (self-contained: no react install needed) ───────────────
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

// ── fake DOM (mirrors client-render.mjs; adds childNodes/matches/select) ──
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
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
    },
    setAttribute(k, v) {
      this[k] = v
    },
    getAttribute(k) {
      return this[k]
    },
    select() {},
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
      if (sel === 'div.md-code-block' || sel === '.md-code-block')
        return this.tagName === 'DIV' && this.className === 'md-code-block'
      if (sel === 'div.tzx-md' || sel === '.tzx-md') return this.tagName === 'DIV' && this.className === 'tzx-md'
      if (sel === 'button.dsh-md-render-copy' || sel === '.dsh-md-render-copy')
        return this.tagName === 'BUTTON' && this.className.includes('dsh-md-render-copy')
      if (sel === '[data-streaming]') return this.dataset.streaming === '1'
      if (/^[a-z]+$/.test(sel)) return this.tagName === sel.toUpperCase()
      return false
    },
    matches(sel) {
      return this.matchesSel(sel)
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
  Object.defineProperty(el, 'childNodes', {
    get() {
      return this.children
    },
  })
  return el
}

/** Materialize a React element tree into the fake DOM (function components expanded). */
function materialize(node, parent) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    parent.appendChild({ nodeType: 3, textContent: String(node) })
    return
  }
  if (Array.isArray(node)) {
    for (const c of node) materialize(c, parent)
    return
  }
  if (typeof node.type === 'function') {
    materialize(node.type(node.props), parent)
    return
  }
  const el = makeElement(node.type, node.props)
  const props = node.props || {}
  if (typeof props.onClick === 'function') el.onClick = props.onClick
  if (typeof props.title === 'string') el.title = props.title
  if (typeof props['aria-label'] === 'string') el['aria-label'] = props['aria-label']
  parent.appendChild(el)
  materialize(props.children, el)
  return el
}

// ── load bundle ────────────────────────────────────────────────────────────
let registered = null
global.window = {
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  __ModuleLoader__: {
    load: (reg) => {
      registered = reg
    },
  },
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

// ── clipboard stub (Node ≥21 exposes a read-only global navigator getter) ─
const clipboardCalls = []
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}
setNavigator({
  clipboard: {
    writeText: (t) => {
      clipboardCalls.push(t)
      return Promise.resolve()
    },
  },
})

try {
  // 1. 代码块按钮：点击复制 code 文本（不含语言标记 / 按钮文案）
  const mdCodeBlock = makeElement('div', { className: 'md-code-block' })
  materialize(exportsObj.MarkdownView({ text: '```js\nconst x = 1\n```' }), mdCodeBlock)
  const codeBtn = mdCodeBlock.querySelector('button.dsh-md-render-copy')
  assert.ok(codeBtn, 'code-block copy button rendered')
  assert.equal(codeBtn.textContent, '复制', 'button label 复制')
  codeBtn.onClick({ currentTarget: codeBtn })
  assert.equal(clipboardCalls.length, 1, 'clipboard.writeText called once')
  assert.equal(clipboardCalls[0], 'const x = 1', 'copies code text only (no language marker, no button label)')

  // 1.5 默认位置 bottom-right（issue #146）：代码块按钮是 md-code-block 直接子元素
  // （右下角绝对定位），不在头部 head 内（与语言标签同排是 header 位置的行为）
  const mdBlockEl = mdCodeBlock.querySelector('div.md-code-block')
  assert.ok(mdBlockEl, 'md-code-block element found under tzx-md')
  assert.equal(
    mdBlockEl.children.filter((c) => c.tagName === 'BUTTON' && c.className.includes('dsh-md-render-copy')).length,
    1,
    'code copy button is a direct md-code-block child (bottom-right default)',
  )
  const headEl = mdBlockEl.children.find((c) => c.tagName === 'DIV' && c.className === 'dsh-md-render-code-head')
  assert.ok(headEl, 'code head rendered')
  assert.equal(
    headEl.children.filter((c) => c.tagName === 'BUTTON' && c.className.includes('dsh-md-render-copy')).length,
    0,
    'copy button NOT in header by default (issue #146)',
  )

  // 2. 内容按钮：点击复制整段纯文本（不含按钮文案）
  const tzxMd = makeElement('div', { className: 'tzx-md' })
  const innerTzx = materialize(exportsObj.MarkdownView({ text: '第一段\n\n```js\nconst y = 2\n```\n\n第二段' }), tzxMd)
  assert.equal(innerTzx.className, 'tzx-md', 'MarkdownView root container materialized')
  const contentBtn = innerTzx.children.filter((c) => c.matchesSel && c.matchesSel('button.dsh-md-render-copy'))[0]
  assert.ok(contentBtn, 'content copy button rendered (direct child of tzx-md)')
  assert.equal(tzxMd.querySelectorAll('button.dsh-md-render-copy').length, 2, 'code + content buttons')
  contentBtn.onClick({ currentTarget: contentBtn })
  assert.equal(clipboardCalls.length, 2, 'clipboard.writeText called again')
  const copied = clipboardCalls[1]
  assert.ok(copied.includes('第一段'), 'content text included')
  assert.ok(copied.includes('const y = 2'), 'code text included in content copy')
  assert.ok(copied.includes('第二段'), 'trailing text included')
  assert.ok(!copied.includes('复制'), 'copy-button labels excluded from content text')

  // 3. 无代码块时仅内容按钮
  const tzxPlain = makeElement('div', { className: 'tzx-md' })
  materialize(exportsObj.MarkdownView({ text: '普通段落' }), tzxPlain)
  assert.equal(tzxPlain.querySelectorAll('button.dsh-md-render-copy').length, 1, 'only content button')

  // 4. clipboard 失败 → 回退 document.execCommand('copy')
  const execCalls = []
  const fallbackDoc = {
    createElement: (tag) => makeElement(tag),
    body: makeElement('body'),
    execCommand: (cmd) => {
      execCalls.push(cmd)
      return true
    },
  }
  const savedDoc = global.document
  global.document = fallbackDoc
  setNavigator({
    clipboard: {
      // 同步触发 catch（script-style 测试无微任务等待）：返回 thenable，
      // .catch 立即执行 fallback 路径。
      writeText: () => ({
        catch: (fn) => {
          fn(new Error('denied'))
          return Promise.resolve()
        },
      }),
    },
  })
  const mdFallback = makeElement('div', { className: 'md-code-block' })
  materialize(exportsObj.MarkdownView({ text: '```sh\necho hi\n```' }), mdFallback)
  const fbBtn = mdFallback.querySelector('button.dsh-md-render-copy')
  fbBtn.onClick({ currentTarget: fbBtn })
  assert.equal(execCalls.length, 1, 'execCommand("copy") fallback invoked')
  assert.equal(execCalls[0], 'copy', 'fallback command is copy')
  global.document = savedDoc
  setNavigator({
    clipboard: {
      writeText: (t) => {
        clipboardCalls.push(t)
        return Promise.resolve()
      },
    },
  })

  // 5. 流式兼容：按钮始终渲染，但样式表含 [data-streaming] 隐藏规则
  const streamingRow = makeElement('div')
  streamingRow.dataset.streaming = '1'
  const mdStream = makeElement('div', { className: 'tzx-md' })
  materialize(exportsObj.MarkdownView({ text: '```js\nconst z = 3\n```' }), mdStream)
  streamingRow.appendChild(mdStream)
  const streamBtn = streamingRow.querySelector('button.dsh-md-render-copy')
  assert.ok(streamBtn, 'button rendered under streaming ancestor (CSS hides it)')

  const styleTags = []
  const bodyEl = makeElement('body')
  global.document = {
    body: bodyEl,
    head: {
      appendChild(el) {
        styleTags.push(el)
        return el
      },
      removeChild() {},
    },
    createElement(tag) {
      return makeElement(tag)
    },
    createElementNS(_ns, tag) {
      return makeElement(tag)
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: text }
    },
    createDocumentFragment() {
      return makeElement('fragment')
    },
  }
  const ctx = { effect: (fn) => fn() }
  exportsObj.apply(ctx)
  assert.ok(styleTags.length === 1, 'stylesheet injected')
  assert.ok(
    styleTags[0].textContent.includes('[data-streaming] .dsh-md-render-copy{display:none}'),
    'streaming rule hides copy buttons',
  )
  assert.ok(styleTags[0].textContent.includes('.dsh-md-render-copy-done'), 'copied-state style present')
  // issue #146：代码块按钮右下角定位规则 + 代码主题色板（含深浅自适应）在样式表中
  assert.ok(
    styleTags[0].textContent.includes('.md-code-block>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}'),
    'bottom-right positioning rule present',
  )
  assert.ok(
    styleTags[0].textContent.includes('.dsh-md-render-code-head>.dsh-md-render-copy{margin-left:auto}'),
    'header positioning rule retained',
  )
  assert.ok(styleTags[0].textContent.includes('.md-code-block[data-theme]'), 'theme palette variables present')
  assert.ok(styleTags[0].textContent.includes('prefers-color-scheme:dark'), 'dark-mode variant retained')

  console.log('ALL COPY-BUTTON TESTS PASSED')
} finally {
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
  delete global.navigator
}

test('script-style suite (assertions ran at module load)', () => {})
