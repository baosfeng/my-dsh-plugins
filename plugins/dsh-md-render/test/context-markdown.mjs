import { test } from 'vitest'
/**
 * Issue #196 regression test: context-injection blocks (host ContextBody's
 * <pre data-context-text="true"> plain-text rendering) must be rendered as
 * markdown by the client bundle:
 *  - headings / bold / inline code / lists / non-standard tables / fenced
 *    code blocks become real DOM elements (MarkdownView class contract:
 *    div.tzx-md / p.tzx-p / table.tzx-table / div.md-code-block),
 *  - the original <pre> is hidden and marked applied (host keeps its node),
 *  - re-scanning is idempotent (identical signature → no re-render),
 *  - changed text re-renders, a removed render container is rebuilt
 *    (host React re-render), oversized blocks are left untouched.
 * Loads the BUILT bundle lib/client.js against a fake DOM.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const stubbed = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.flat() } }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
}

function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: tag === 'fragment' ? 11 : 1,
    children: [],
    _text: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    hidden: false,
    parentNode: null,
    _attrs: {},
    _listeners: {},
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    appendChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    insertBefore(child, ref) {
      const i = ref ? this.children.indexOf(ref) : -1
      if (i < 0) this.children.push(child)
      else this.children.splice(i, 0, child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v)
      if (k === 'hidden') this.hidden = true
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null
    },
    removeAttribute(k) {
      delete this._attrs[k]
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
      if (sel === 'pre[data-context-text="true"]') {
        return this.tagName === 'PRE' && this.getAttribute('data-context-text') === 'true'
      }
      if (sel === 'div.tzx-md') return this.tagName === 'DIV' && String(this.className).includes('tzx-md')
      if (sel === 'div.md-table-wide') return this.tagName === 'DIV' && String(this.className).includes('md-table-wide')
      if (sel === 'div.tzx-md, div.md-table-wide') {
        return (
          (this.tagName === 'DIV' && String(this.className).includes('tzx-md')) ||
          (this.tagName === 'DIV' && String(this.className).includes('md-table-wide'))
        )
      }
      if (sel === '[data-conversation-scroll]') return this.dataset.conversationScroll === '1'
      if (sel === '[data-streaming]') return this.dataset.streaming === '1'
      if (sel === 'table.dsh-md-render-table')
        return this.tagName === 'TABLE' && this.className === 'dsh-md-render-table'
      if (sel === 'div.dsh-md-render-context-md') {
        return this.tagName === 'DIV' && String(this.className).includes('dsh-md-render-context-md')
      }
      const tagClass = sel.match(/^([a-z][a-z0-9]*)\.([\w-]+)$/)
      if (tagClass) {
        return this.tagName === tagClass[1].toUpperCase() && String(this.className).split(/\s+/).includes(tagClass[2])
      }
      if (/^[a-z][a-z0-9]*$/.test(sel)) return this.tagName === sel.toUpperCase()
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
  Object.defineProperty(el, 'previousElementSibling', {
    get() {
      const parent = this.parentNode
      if (!parent) return null
      const i = parent.children.indexOf(this)
      for (let j = i - 1; j >= 0; j -= 1) {
        if (parent.children[j].nodeType === 1) return parent.children[j]
      }
      return null
    },
  })
  return el
}

// ── fake page: [data-conversation-scroll] > pre[data-context-text] ────────
const scrollEl = makeElement('div')
scrollEl.dataset.conversationScroll = '1'
const contextText = [
  '## 标题',
  '',
  '结论：**已完整实现**，详见 `scanner.ts`。',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '插件 | 版本',
  '--- | ---',
  'dsh-md-render | 0.1.8',
  '',
  '```js',
  'const a = 1',
  '```',
].join('\n')
const contextPre = makeElement('pre')
contextPre.setAttribute('data-context-text', 'true')
contextPre.textContent = contextText
scrollEl.appendChild(contextPre)
const bodyEl = makeElement('body')
bodyEl.appendChild(scrollEl)

const styleTags = []
global.window = { location: { href: 'http://127.0.0.1:3080/app', search: '' } }
global.document = {
  body: bodyEl,
  head: {
    appendChild(el) {
      styleTags.push(el)
      return el
    },
    removeChild() {},
  },
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

let registered = null
global.window.__ModuleLoader__ = {
  load: (reg) => {
    registered = reg
  },
}
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
const ctx = { effect: (fn) => fn() }
exportsObj.apply(ctx)

function contextBody() {
  return contextPre.previousElementSibling
}

test('context injection block is rendered as markdown DOM', () => {
  const body = contextBody()
  assert.ok(body, 'render container inserted before the <pre>')
  assert.ok(String(body.className).includes('tzx-md'), 'container carries the tzx-md class contract')
  assert.equal(body.getAttribute('data-dsh-md-render-context-body'), 'true', 'container marker')
  assert.equal(contextPre.hidden, true, 'original plain-text <pre> hidden')
  assert.equal(contextPre.getAttribute('data-dsh-md-render-context'), 'applied', 'applied marker on <pre>')
  // headings / inline
  assert.equal(body.querySelector('h2').textContent, '标题', 'heading rendered')
  assert.equal(body.querySelector('strong').textContent, '已完整实现', 'bold rendered')
  assert.equal(body.querySelector('code').textContent, 'scanner.ts', 'inline code rendered')
  // list
  const lis = body.querySelectorAll('li')
  assert.equal(lis.length, 2, 'list items rendered')
  assert.equal(lis[0].textContent, '第一项', 'list item text')
  // non-standard table (no leading/trailing pipes)
  const table = body.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'non-standard table rendered as a real table')
  assert.equal(table.querySelectorAll('th')[0].textContent, '插件', 'table header cell')
  assert.equal(table.querySelectorAll('td')[0].textContent, 'dsh-md-render', 'table data cell')
  // fenced code block
  const block = body.querySelector('div.md-code-block')
  assert.ok(block, 'fenced code block rendered')
  assert.equal(block.querySelector('pre').querySelector('code').textContent, 'const a = 1', 'code text')
})

test('re-scanning is idempotent and text changes re-render', () => {
  const first = contextBody()
  exportsObj.apply(ctx)
  assert.equal(contextBody(), first, 'same container reused when text is unchanged')
  assert.equal(scrollEl.querySelectorAll('div.dsh-md-render-context-md').length, 1, 'no duplicate containers')
  // host replaces the text (React text diff) → signature changes → re-render
  contextPre.textContent = '**改了**'
  exportsObj.apply(ctx)
  const second = contextBody()
  assert.notEqual(second, first, 'container rebuilt for changed text')
  assert.equal(second.querySelector('strong').textContent, '改了', 'updated content rendered')
  assert.equal(scrollEl.querySelectorAll('div.dsh-md-render-context-md').length, 1, 'old container removed')
})

test('a host-side rebuild is recovered and oversized blocks are skipped', () => {
  // simulate React dropping our sibling container
  const parent = contextPre.parentNode
  parent.removeChild(contextBody())
  exportsObj.apply(ctx)
  assert.ok(contextBody(), 'container rebuilt after host re-render')
  // oversized blocks stay as host plain text
  const big = makeElement('pre')
  big.setAttribute('data-context-text', 'true')
  big.textContent = 'x'.repeat(exportsObj.MAX_CONTEXT_CHARS + 1)
  scrollEl.appendChild(big)
  exportsObj.apply(ctx)
  assert.equal(big.hidden, false, 'oversized block not hidden')
  assert.equal(big.getAttribute('data-dsh-md-render-context'), null, 'oversized block unmarked')
  assert.equal(
    scrollEl.querySelectorAll('div.dsh-md-render-context-md').length,
    1,
    'no container added for oversized block',
  )
})
