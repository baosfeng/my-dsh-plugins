import { test } from 'vitest'
/**
 * Client render-path test for dsh-md-render: loads the BUILT bundle
 * lib/client.js (lib/parts/*.part.js spliced by scripts/build.mjs) against
 * stubbed react + a fake DOM, then verifies:
 *  - the bundle registers and apply() injects the stylesheet,
 *  - the scanner replaces a non-standard table paragraph (p.tzx-p inside
 *    div.tzx-md) with a real table (div.dsh-md-render-table-scroll > table.dsh-md-render-table
 *    > thead/tbody) with per-column alignment,
 *  - already-rendered tables (table.tzx-table) are left untouched,
 *  - non-table paragraphs are left untouched,
 *  - containers under [data-streaming] are skipped (streaming),
 *  - prefix/suffix text around the table is preserved,
 *  - md-table-wide containers (built-in MarkdownText output) are not
 *    disturbed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── minimal react stub (self-contained: no react install needed) ────────
function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat() } }
}
const stubbed = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
}

// ── fake DOM ─────────────────────────────────────────────────────────────
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
    removeEventListener(type, fn) {
      const arr = this._listeners[type] || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
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
      // 真实 DOM 语义：已存在的子节点先移除再追加（移动）
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
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
      if (sel === 'p.tzx-p') return this.tagName === 'P' && this.className === 'tzx-p'
      if (sel === 'div.tzx-md') return this.tagName === 'DIV' && this.className === 'tzx-md'
      if (sel === 'div.md-table-wide') return this.tagName === 'DIV' && this.className === 'md-table-wide'
      if (sel === 'div.tzx-md, div.md-table-wide') {
        return (
          (this.tagName === 'DIV' && this.className === 'tzx-md') ||
          (this.tagName === 'DIV' && this.className === 'md-table-wide')
        )
      }
      if (sel === '[data-conversation-scroll]') return this.dataset.conversationScroll === '1'
      if (sel === '[data-streaming]') return this.dataset.streaming === '1'
      if (sel === 'table') return this.tagName === 'TABLE'
      if (sel === 'table.tzx-table') return this.tagName === 'TABLE' && this.className === 'tzx-table'
      if (sel === 'p.dsh-md-render-prefix') return this.tagName === 'P' && this.className === 'dsh-md-render-prefix'
      if (sel === 'p.dsh-md-render-suffix') return this.tagName === 'P' && this.className === 'dsh-md-render-suffix'
      if (sel === 'div.dsh-md-render-scroll-hint') {
        return this.tagName === 'DIV' && this.className === 'dsh-md-render-scroll-hint'
      }
      // 通用标签名选择器（thead/tbody/th/td/tr/strong/code/em/a/p/div）
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

// ── build the fake page ──────────────────────────────────────────────────
// [data-conversation-scroll]
//   ├── div.tzx-md (non-standard table paragraph + plain paragraph)
//   │     ├── p.tzx-p  "插件 | 版本\n--- | ---\ndsh-file-activity | 0.4.2"
//   │     └── p.tzx-p  "普通段落文本"
//   ├── div.tzx-md (already-rendered table: table.tzx-table exists)
//   │     └── table.tzx-table
//   ├── div.tzx-md (streaming container under [data-streaming])
//   │     └── p.tzx-p  "插件 | 版本\n--- | ---\n1 | 2"
//   ├── div.tzx-md (prefix/suffix around table)
//   │     └── p.tzx-p  "以下是列表：\n插件 | 版本\n--- | ---\n1 | 2\n以上"
//   └── div.md-table-wide (built-in MarkdownText output, already rendered)
//         └── table
function makeParagraph(text) {
  const p = makeElement('p', { className: 'tzx-p' })
  p.textContent = text
  return p
}

const scrollEl = makeElement('div')
scrollEl.dataset.conversationScroll = '1'

const md1 = makeElement('div', { className: 'tzx-md' })
const pNonStd = makeParagraph('插件 | 版本\n--- | ---\ndsh-file-activity | 0.4.2')
const pPlain = makeParagraph('这是一段普通文本，不含表格。')
md1.appendChild(pNonStd)
md1.appendChild(pPlain)
scrollEl.appendChild(md1)

const md2 = makeElement('div', { className: 'tzx-md' })
const renderedTable = makeElement('table', { className: 'tzx-table' })
md2.appendChild(renderedTable)
scrollEl.appendChild(md2)

const streamingRow = makeElement('div')
streamingRow.dataset.streaming = '1'
const md3 = makeElement('div', { className: 'tzx-md' })
const pStream = makeParagraph('插件 | 版本\n--- | ---\n1 | 2')
md3.appendChild(pStream)
streamingRow.appendChild(md3)
scrollEl.appendChild(streamingRow)

const md4 = makeElement('div', { className: 'tzx-md' })
const pPreSuf = makeParagraph('以下是列表：\n插件 | 版本\n--- | ---\n1 | 2\n以上')
md4.appendChild(pPreSuf)
scrollEl.appendChild(md4)

const mdWide = makeElement('div', { className: 'md-table-wide' })
const builtinTable = makeElement('table')
mdWide.appendChild(builtinTable)
scrollEl.appendChild(mdWide)

const bodyEl = makeElement('body')
bodyEl.appendChild(scrollEl)

const styleTags = []
global.window = {
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
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
global.Element = function Element() {}
global.MutationObserver = class {
  constructor() {}
  observe() {}
  disconnect() {}
}

// ── load bundle ───────────────────────────────────────────────────────────
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
assert.deepEqual(exportsObj.inject, [])
assert.equal(typeof exportsObj.apply, 'function')

// ── apply with a mock ctx (effects run immediately) ───────────────────────
const effects = []
const ctx = {
  effect: (fn, label) => {
    effects.push(label)
    return fn()
  },
}
exportsObj.apply(ctx)

try {
  // 1. stylesheet injected
  assert.ok(styleTags.length === 1, 'stylesheet injected')
  assert.ok(styleTags[0].textContent.includes('.dsh-md-render-table'), 'stylesheet has table rules')
  assert.ok(styleTags[0].textContent.includes('.dsh-md-render-table-scroll'), 'stylesheet has scroll rules')

  // 2. non-standard table paragraph replaced by a real table
  const table = md1.querySelector('table')
  assert.ok(table, 'non-standard table rendered as <table>')
  assert.equal(table.className, 'dsh-md-render-table', 'table class')
  const scroll = table.parentNode
  assert.equal(scroll.className, 'dsh-md-render-table-scroll', 'table wrapped in scroll container')
  const thead = table.querySelector('thead')
  const tbody = table.querySelector('tbody')
  assert.ok(thead, 'thead rendered')
  assert.ok(tbody, 'tbody rendered')
  const ths = thead.querySelectorAll('th')
  const tds = tbody.querySelectorAll('td')
  assert.equal(ths.length, 2, '2 header cells')
  assert.equal(tds.length, 2, '2 data cells (1 row × 2 cols)')
  assert.equal(ths[0].textContent, '插件', 'header cell 1 text')
  assert.equal(ths[1].textContent, '版本', 'header cell 2 text')
  assert.equal(tds[0].textContent, 'dsh-file-activity', 'data cell 1 text')
  assert.equal(tds[1].textContent, '0.4.2', 'data cell 2 text')
  // the original paragraph is gone
  assert.equal(pNonStd.parentNode, null, 'original paragraph replaced and detached')

  // 2b. scroll hint bar rendered after the scroll container (issue #54 阶段 1)
  const hint = md1.querySelector('div.dsh-md-render-scroll-hint')
  assert.ok(hint, 'scroll hint bar rendered')
  assert.ok(hint.textContent.includes('横向滚动'), 'hint text present')
  assert.equal(hint.parentNode, md1, 'hint bar inside the tzx-md container')

  // 3. plain paragraph untouched
  assert.equal(pPlain.parentNode, md1, 'plain paragraph still in container')
  assert.equal(pPlain.textContent, '这是一段普通文本，不含表格。', 'plain paragraph text intact')

  // 4. already-rendered table (table.tzx-table) untouched
  assert.equal(renderedTable.parentNode, md2, 'rendered table untouched')

  // 5. streaming container skipped
  assert.equal(pStream.parentNode, md3, 'streaming paragraph untouched')

  // 6. prefix/suffix preserved
  const prefixP = md4.querySelector('p.dsh-md-render-prefix')
  const suffixP = md4.querySelector('p.dsh-md-render-suffix')
  assert.ok(prefixP, 'prefix paragraph preserved')
  assert.equal(prefixP.textContent, '以下是列表：', 'prefix text')
  assert.ok(suffixP, 'suffix paragraph preserved')
  assert.equal(suffixP.textContent, '以上', 'suffix text')
  assert.ok(md4.querySelector('table'), 'table rendered with prefix/suffix')

  // 7. md-table-wide container (built-in output) not disturbed
  assert.equal(builtinTable.parentNode, mdWide, 'built-in table untouched')

  // 8. alignment: separator with :---: and ---: → center/right on th
  const md5 = makeElement('div', { className: 'tzx-md' })
  const pAlign = makeParagraph('| a | b |\n|:---:|---:|\n| 1 | 2 |')
  md5.appendChild(pAlign)
  scrollEl.appendChild(md5)
  // re-scan via a fresh apply-like scan: call the scanner through a new
  // MutationObserver callback is not available in the fake; instead verify
  // through a second apply on a fresh ctx (scanner re-runs over the body).
  exportsObj.apply(ctx)
  const ths2 = md5.querySelectorAll('th')
  assert.equal(ths2.length, 2, 'alignment table header cells')
  assert.equal(ths2[0].style.textAlign, 'center', 'center alignment applied')
  assert.equal(ths2[1].style.textAlign, 'right', 'right alignment applied')

  // 9. inline markdown inside cells: **bold** and `code` render as elements
  const md6 = makeElement('div', { className: 'tzx-md' })
  const pInline = makeParagraph('插件 | 版本\n--- | ---\ndsh-file-activity | **0.4.2**\ndsh-think-zh-expand | `0.2.0`')
  md6.appendChild(pInline)
  scrollEl.appendChild(md6)
  exportsObj.apply(ctx)
  const strong = md6.querySelector('strong')
  const code = md6.querySelector('code')
  assert.ok(strong, 'bold cell rendered as <strong>')
  assert.equal(strong.textContent, '0.4.2', 'bold cell text')
  assert.ok(code, 'code cell rendered as <code>')
  assert.equal(code.textContent, '0.2.0', 'code cell text')

  // 10. 设置页 tab 注册：首屏 slots 提供者 fiber 尚未 active 时也必须注册。
  // 防回归背景：cordis 的 ctx.get(name, strict = true) 在 strict 模式下要求
  // 服务提供者 fiber 已 active（impl.fiber.state !== 2 → 返回 undefined）。
  // 首屏加载时本插件 apply 早于 @deepseek-ai/dsh-client-ui-renderer 提供
  // slots 的 fiber 变 active，strict 取法拿到 undefined → 注册代码静默
  // return，设置页「插件」里看不到本插件 tab（HMR 重载后才出现，刷新又消失）。
  // 桩严格模拟 cordis 语义：strict 调用返回 undefined、strict=false 返回
  // 服务对象，断言 tab 仍然注册。
  let capturedTab = null
  const bootSlots = {
    inject: (name, register) => {
      capturedTab = register()
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  exportsObj.apply({
    effect: (fn) => fn(),
    get: (name, strict = true) => (name === 'slots' ? (strict ? undefined : bootSlots) : undefined),
  })
  assert.ok(capturedTab, 'settings tab registered while the slots provider fiber is not active yet')
  assert.equal(capturedTab.options.id, 'md-render-settings', 'settings tab id')

  console.log('ALL CLIENT RENDER-PATH TESTS PASSED')
} finally {
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
}

test('script-style suite (assertions ran at module load)', () => {})
