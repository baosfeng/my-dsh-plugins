import { test } from 'vitest'
/**
 * Issue #393 regression test: fenced code blocks tagged `text` / `plaintext` /
 * `txt` must be rendered as markdown, each with its own "查看原文" toggle,
 * while **every other language tag and untagged blocks stay exactly as
 * before** (anti-regression) — mirroring the dsh-mermaid-render shape
 * (intercept a specific fence language → swap the rendering form + view
 * toggle).
 * Assertions:
 *  - the three tags render markdown DOM (headings / bold / inline code /
 *    lists / non-standard tables — i.e. the existing render pipeline),
 *  - the raw <pre> stays in the DOM (原文保留, 切换可切回),
 *  - each block carries its own view state: toggling one block's button
 *    does not touch another block,
 *  - other tags (js) and untagged blocks get no container, no toggle and no
 *    view attribute (behaviour unchanged),
 *  - streaming blocks (ancestor `[data-streaming]`) are skipped until the
 *    stream settles, and re-scans never duplicate the rendered nodes.
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
    type: '',
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
      if (sel === 'div.md-code-block') {
        return this.tagName === 'DIV' && String(this.className).split(/\s+/).includes('md-code-block')
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
  return el
}

/** 构造一个围栏代码块：div.md-code-block > head(语言标签) + pre > code。 */
function makeCodeBlock(lang, code) {
  const block = makeElement('div', { className: 'md-code-block' })
  const head = makeElement('div', { className: 'dsh-md-render-code-head' })
  const label = makeElement('span', { className: 'dsh-md-render-code-lang' })
  label.textContent = lang || 'text'
  head.appendChild(label)
  const pre = makeElement('pre', { className: 'tzx-pre' })
  const codeEl = makeElement('code', { className: lang ? 'language-' + lang : '' })
  codeEl.textContent = code
  pre.appendChild(codeEl)
  block.appendChild(head)
  block.appendChild(pre)
  return block
}

const MARKDOWN_SOURCE = [
  '## 结论',
  '',
  '模型实际输出的是 **markdown**，详见 `detect.ts`。',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '插件 | 版本',
  '--- | ---',
  'dsh-md-render | 0.1.9',
].join('\n')

// ── fake page: [data-conversation-scroll] > 各类围栏代码块 ──────────────
const scrollEl = makeElement('div')
scrollEl.dataset.conversationScroll = '1'
const textBlock = makeCodeBlock('text', MARKDOWN_SOURCE)
const plaintextBlock = makeCodeBlock('plaintext', '# plaintext 标题')
const txtBlock = makeCodeBlock('txt', '1. 有序一\n2. 有序二')
const jsBlock = makeCodeBlock('js', 'const a = 1')
const plainBlock = makeCodeBlock('', 'plain text block')
for (const b of [textBlock, plaintextBlock, txtBlock, jsBlock, plainBlock]) scrollEl.appendChild(b)
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

const TEXT_BODY = 'div.dsh-md-render-text-md'
const TOGGLE = 'button.dsh-md-render-text-toggle'
const VIEW_ATTR = 'data-dsh-md-render-text-view'

/** 点一次块的切换按钮（假 DOM：直接调绑定的 click 监听）。 */
function clickToggle(block) {
  const btn = block.querySelector(TOGGLE)
  assert.ok(btn, 'toggle button exists')
  btn._listeners.click[0]({})
}

test('text / plaintext / txt fences are rendered as markdown', () => {
  assert.equal(typeof exportsObj.scanTextBlocks, 'function', 'scanTextBlocks exported')
  for (const [name, block] of [
    ['text', textBlock],
    ['plaintext', plaintextBlock],
    ['txt', txtBlock],
  ]) {
    const body = block.querySelector(TEXT_BODY)
    assert.ok(body, name + ' block got a markdown container')
    assert.ok(String(body.className).includes('tzx-md'), name + ' container carries the tzx-md contract class')
    assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', name + ' block starts in markdown view')
    assert.ok(block.querySelector(TOGGLE), name + ' block got a 查看原文 toggle')
  }
  // 复用既有渲染管线：标题 / 粗体 / 行内代码 / 列表
  const body = textBlock.querySelector(TEXT_BODY)
  assert.equal(body.querySelector('h2').textContent, '结论', 'heading rendered')
  assert.equal(body.querySelector('strong').textContent, 'markdown', 'bold rendered')
  assert.equal(body.querySelector('code').textContent, 'detect.ts', 'inline code rendered')
  assert.equal(body.querySelectorAll('li').length, 2, 'list items rendered')
  // 复用既有表格能力：非标准表格（无首尾管道符）在 text 块内渲染为表格
  const table = body.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'non-standard table inside a text fence rendered as a real table')
  assert.equal(table.querySelectorAll('th')[0].textContent, '插件', 'table header cell')
  assert.equal(table.querySelectorAll('td')[0].textContent, 'dsh-md-render', 'table data cell')
  // plaintext / txt 也走同一管线
  assert.equal(plaintextBlock.querySelector(TEXT_BODY).querySelector('h1').textContent, 'plaintext 标题', 'h1 rendered')
  assert.equal(txtBlock.querySelector(TEXT_BODY).querySelectorAll('li').length, 2, 'ordered list rendered')
  // 原文保留在 DOM（切回后显示原始内容）且未被改写
  const pre = textBlock.querySelector('pre')
  assert.ok(pre, 'original <pre> kept in the DOM')
  assert.equal(pre.querySelector('code').textContent, MARKDOWN_SOURCE, 'original code text untouched')
  assert.equal(pre.querySelector('code').className, 'language-text', 'original language class untouched')
})

test('the per-block 查看原文 toggle switches back to the raw code block', () => {
  assert.equal(textBlock.querySelector(TOGGLE).textContent, '查看原文', 'toggle label in markdown view')
  clickToggle(textBlock)
  assert.equal(textBlock.getAttribute(VIEW_ATTR), 'source', 'block switched to the source view')
  assert.equal(textBlock.querySelector(TOGGLE).textContent, '查看渲染', 'toggle label flips in source view')
  assert.equal(textBlock.querySelector(TOGGLE).getAttribute('aria-pressed'), 'true', 'aria-pressed reflects the state')
  // 每块独立：另一个 text 块不受影响
  assert.equal(plaintextBlock.getAttribute(VIEW_ATTR), 'markdown', 'other blocks keep their own state')
  clickToggle(textBlock)
  assert.equal(textBlock.getAttribute(VIEW_ATTR), 'markdown', 'switch back to the markdown view')
  // 切换两次不产生重复节点
  assert.equal(textBlock.querySelectorAll(TEXT_BODY).length, 1, 'single markdown container per block')
  assert.equal(textBlock.querySelectorAll(TOGGLE).length, 1, 'single toggle per block')
})

test('other language tags and untagged blocks are untouched (anti-regression)', () => {
  for (const [name, block] of [
    ['js', jsBlock],
    ['untagged', plainBlock],
  ]) {
    assert.equal(block.getAttribute(VIEW_ATTR), null, name + ' block carries no view attribute')
    assert.equal(block.querySelector(TEXT_BODY), null, name + ' block got no markdown container')
    assert.equal(block.querySelector(TOGGLE), null, name + ' block got no toggle')
    assert.equal(block.querySelectorAll('pre').length, 1, name + ' block keeps its single <pre>')
  }
  assert.equal(jsBlock.querySelector('code').textContent, 'const a = 1', 'js code text untouched')
  assert.equal(plainBlock.querySelector('code').textContent, 'plain text block', 'untagged code text untouched')
  assert.equal(scrollEl.querySelectorAll(TEXT_BODY).length, 3, 'exactly the three target fences rendered')
})

test('streaming blocks wait for the stream to settle, re-scans stay idempotent', () => {
  const streamWrap = makeElement('div')
  streamWrap.dataset.streaming = '1'
  const streamBlock = makeCodeBlock('txt', '## 流式标题')
  streamWrap.appendChild(streamBlock)
  scrollEl.appendChild(streamWrap)
  exportsObj.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), null, 'streaming block left alone')
  assert.equal(streamBlock.querySelector(TEXT_BODY), null, 'no container while streaming')
  // 流式结束（宿主移除 data-streaming）→ 兜底重扫后渲染一次
  delete streamWrap.dataset.streaming
  exportsObj.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), 'markdown', 'rendered once the stream settled')
  assert.equal(
    streamBlock.querySelector(TEXT_BODY).querySelector('h2').textContent,
    '流式标题',
    'streamed content rendered',
  )
  // 再次重扫：签名一致 → 不重复渲染、不重建节点
  const body = streamBlock.querySelector(TEXT_BODY)
  exportsObj.apply(ctx)
  assert.equal(streamBlock.querySelector(TEXT_BODY), body, 'same container reused on re-scan')
  assert.equal(streamBlock.querySelectorAll(TEXT_BODY).length, 1, 'no duplicate containers after re-scan')
  assert.equal(streamBlock.querySelectorAll(TOGGLE).length, 1, 'no duplicate toggles after re-scan')
  // 内容变化（宿主重渲染补写）→ 重建渲染
  streamBlock.querySelector('code').textContent = '## 改后标题'
  exportsObj.apply(ctx)
  assert.notEqual(streamBlock.querySelector(TEXT_BODY), body, 'container rebuilt for changed content')
  assert.equal(
    streamBlock.querySelector(TEXT_BODY).querySelector('h2').textContent,
    '改后标题',
    'updated content rendered',
  )
  assert.equal(streamBlock.querySelectorAll(TEXT_BODY).length, 1, 'old container removed')
})
