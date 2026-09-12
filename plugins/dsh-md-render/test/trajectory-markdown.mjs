import { test } from 'vitest'
/**
 * Issue #205 regression test: markdown blocks inside the TRAJECTORY view
 * (host @deepseek-ai/dsh-client-ui-trajectory's MarkdownFragment rendered
 * mode) must be taken over by this plugin's renderer:
 *  - host contract (bundle evidence, lib/client.js of ui-trajectory):
 *      <div class="<hash>_markdownPayload|<hash>_markdownPreview">
 *        <div class="_markdown_<hash>">   <- ui-primitives MarkdownText
 *      </div>
 *    wrapped in <div data-trajectory-scroll> (TrajectoryTable pane).
 *  - the markdown SOURCE only exists on the React fiber
 *    (__reactFiber$* -> memoizedProps.text of MarkdownFragment); the DOM
 *    holds rendered HTML only.
 *  - takeover = insert div.tzx-md before the host container + hide it
 *    (never mutate the host subtree: React owns it).
 *  - content gate: only blocks that actually contain a table / math /
 *    fenced code block are taken over (measured: p50 = 51 chars, 3.6% of
 *    trajectory markdown blocks contain an enhancement target).
 *  - idempotent by content signature; silent degradation when the fiber
 *    contract is unavailable; oversized blocks skipped.
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

// ── generic selector matcher (tag / .class / [attr] / [attr="v"] / [attr*="v"]) ──
function matchSimple(el, sel) {
  if (!el || el.nodeType !== 1 || !el._attrs) return false
  const m = /^([a-zA-Z][a-zA-Z0-9]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(sel.trim())
  if (!m) return false
  const tag = m[1]
  if (tag && el.tagName !== tag.toUpperCase()) return false
  const rest = m[2] || ''
  const parts = rest.match(/[.#][\w-]+|\[[^\]]+\]/g) || []
  for (const p of parts) {
    if (p[0] === '.') {
      if (!String(el.className).split(/\s+/).includes(p.slice(1))) return false
    } else if (p[0] === '#') {
      if (el._attrs.id !== p.slice(1)) return false
    } else {
      const am = /^\[([\w-]+)(?:([*^$~|]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(p)
      if (!am) return false
      const [, name, op, dq, sq, raw] = am
      const want = dq !== undefined ? dq : sq !== undefined ? sq : raw
      const has = Object.prototype.hasOwnProperty.call(el._attrs, name)
      if (op === undefined) {
        if (!has) return false
        continue
      }
      if (!has) return false
      const got = String(el._attrs[name])
      if (op === '*' && !got.includes(want)) return false
      if (op === '' && got !== want) return false
      if (op === '^' && !got.startsWith(want)) return false
      if (op === '$' && !got.endsWith(want)) return false
    }
  }
  return true
}

function matchesSelector(el, sel) {
  return String(sel)
    .split(',')
    .some((one) => matchSimple(el, one))
}

function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: tag === 'fragment' ? 11 : 1,
    children: [],
    childNodes: [],
    _text: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    hidden: false,
    parentNode: null,
    _attrs: { ...attrs },
    _listeners: {},
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    appendChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.children.push(child)
      this.childNodes = this.children
      child.parentNode = this
      return child
    },
    insertBefore(child, ref) {
      const i = ref ? this.children.indexOf(ref) : -1
      if (i < 0) this.children.push(child)
      else this.children.splice(i, 0, child)
      this.childNodes = this.children
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      this.childNodes = this.children
      child.parentNode = null
      return child
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v)
      if (k === 'hidden') this.hidden = true
      if (k === 'class' || k === 'className') this.className = String(v)
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
          if (matchesSelector(e, sel)) return e
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
          if (matchesSelector(e, sel)) out.push(e)
          walk(e.children || [])
        }
      }
      walk(this.children)
      return out
    },
    matches(sel) {
      return matchesSelector(this, sel)
    },
    closest(sel) {
      let node = this
      while (node) {
        if (node.nodeType === 1 && matchesSelector(node, sel)) return node
        node = node.parentNode
      }
      return null
    },
    contains(other) {
      let node = other
      while (node) {
        if (node === this) return true
        node = node.parentNode
      }
      return false
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
      this.childNodes = this.children
    },
  })
  Object.defineProperty(el, 'parentElement', {
    get() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null
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
  Object.defineProperty(el, 'nextElementSibling', {
    get() {
      const parent = this.parentNode
      if (!parent) return null
      const i = parent.children.indexOf(this)
      for (let j = i + 1; j < parent.children.length; j += 1) {
        if (parent.children[j].nodeType === 1) return parent.children[j]
      }
      return null
    },
  })
  return el
}

// ── host contract fixtures ────────────────────────────────────────────────
/** Rendered-mode markdown container (MarkdownFragment), matching the real
 *  CSS-module class names observed in the browser (hash prefix varies). */
function makeTrajectoryBlock(source, preview = true) {
  const payload = makeElement('div', { class: preview ? 'Y0dWHa_markdownPreview' : 'Y0dWHa_markdownPayload' })
  const rendered = makeElement('div', { class: '_markdown_kcgor_5' })
  rendered.appendChild(makeElement('p'))
  payload.appendChild(rendered)
  // React fiber contract: memoizedProps.text lives on the MarkdownFragment fiber.
  payload['__reactFiber$test'] = {
    memoizedProps: { rendered: true, preview },
    return: { memoizedProps: { text: source } },
  }
  payload['__reactProps$test'] = { className: payload.className }
  return payload
}

const scroller = makeElement('div', { class: 'Y0dWHa_tablePane' })
scroller.setAttribute('data-trajectory-scroll', '')
const row = makeElement('tr', { 'data-record-index': '32' })
const cell = makeElement('td', { class: 'Y0dWHa_content' })
row.appendChild(cell)
scroller.appendChild(row)

const enhanced = [
  'dsh-my-notify 还在运行中（`6310f120`），**第二批完成情况**：',
  '',
  '| 插件 | 状态 |',
  '|------|------|',
  '| dsh-my-remote | ✅ 验收通过 |',
  '| dsh-my-notify | ⏳ 等待完成 |',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '$$E = mc^2$$',
].join('\n')
const payload = makeTrajectoryBlock(enhanced)
cell.appendChild(payload)

// plain block: no table / math / fence -> must stay with the host (content gate)
const plainRow = makeElement('tr', { 'data-record-index': '33' })
const plainCell = makeElement('td')
const plainPayload = makeTrajectoryBlock('收到！让我验证 dsh-my-remote：')
plainCell.appendChild(plainPayload)
plainRow.appendChild(plainCell)
scroller.appendChild(plainRow)

// degraded block: host contract changed (no React fiber) -> silent give-up
const brokenRow = makeElement('tr', { 'data-record-index': '34' })
const brokenCell = makeElement('td')
const brokenPayload = makeElement('div', { class: 'Y0dWHa_markdownPayload' })
brokenPayload.appendChild(makeElement('div', { class: '_markdown_kcgor_5' }))
brokenCell.appendChild(brokenPayload)
brokenRow.appendChild(brokenCell)
scroller.appendChild(brokenRow)

// main conversation path (must stay untouched by the trajectory module)
const convo = makeElement('div')
convo.setAttribute('data-conversation-scroll', '')
const convoMd = makeElement('div', { class: 'tzx-md' })
const convoP = makeElement('p', { class: 'tzx-p' })
convoP.textContent = 'a | b'
convoMd.appendChild(convoP)
convo.appendChild(convoMd)

// trajectory DETAIL panel (aside): markdown containers are siblings of the
// scroll pane, NOT inside div[data-trajectory-scroll] (real DOM chain:
// div.markdownPayload < aside.details < div.split > div[data-trajectory-scroll])
const split = makeElement('div', { class: 'Y0dWHa_split' })
const detailAside = makeElement('aside', { class: 'Y0dWHa_details' })
const detailBody = makeElement('div', { class: 'Y0dWHa_detailBody' })
const detailPayload = makeTrajectoryBlock('| 列 A | 列 B |\n|---|---|\n| 1 | 2 |', false)
detailBody.appendChild(detailPayload)
detailAside.appendChild(detailBody)
split.appendChild(scroller)
split.appendChild(detailAside)

const bodyEl = makeElement('body')
bodyEl.appendChild(split)
bodyEl.appendChild(convo)

global.window = { location: { href: 'http://127.0.0.1:3080/app', search: '' } }
global.document = {
  body: bodyEl,
  querySelector: (sel) => bodyEl.querySelector(sel),
  querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  head: {
    appendChild(el) {
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
const observers = []
global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback
    observers.push(this)
  }
  observe() {}
  disconnect() {}
}
/** Fire the newest observer with a childList mutation (host appended nodes). */
function emitAdded(nodes) {
  const observer = observers[observers.length - 1]
  observer.callback([{ addedNodes: nodes }], observer)
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

function bodyOf(el) {
  return el.previousElementSibling
}

test('trajectory markdown blocks are taken over with md-render enhancements', () => {
  const body = bodyOf(payload)
  assert.ok(body, 'render container inserted before the host markdown container')
  assert.ok(String(body.className).includes('tzx-md'), 'container carries the tzx-md class contract')
  assert.equal(body.getAttribute('data-dsh-md-render-trajectory-body'), 'true', 'container marker')
  assert.equal(payload.hidden, true, 'host markdown container hidden')
  assert.equal(payload.getAttribute('data-dsh-md-render-trajectory'), 'applied', 'applied marker on host container')
  // table enhancement
  const table = body.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'markdown table rendered as an enhanced table')
  assert.equal(table.querySelectorAll('th')[0].textContent, '插件', 'table header cell')
  assert.ok(body.querySelector('div.dsh-md-render-table-scroll'), 'table wrapped in the scroll container')
  // fenced code block enhancement (language label + line numbers + tokens)
  const block = body.querySelector('div.md-code-block')
  assert.ok(block, 'fenced code block rendered as md-code-block')
  assert.ok(block.querySelector('div.dsh-md-render-code-head'), 'code block head rendered')
  assert.ok(block.querySelector('button.dsh-md-render-copy'), 'copy button rendered')
  assert.ok(block.querySelector('div.dsh-md-render-code-line'), 'line numbers rendered')
  assert.equal(block.querySelector('pre').querySelector('code').textContent, 'const a = 1', 'code text preserved')
  assert.ok(block.querySelector('span.dsh-md-render-tok-keyword'), 'syntax highlighting applied')
  // math block
  assert.ok(body.querySelector('div.dsh-md-render-math-block'), 'math block rendered')
  // inline markdown
  assert.equal(body.querySelector('strong').textContent, '第二批完成情况', 'bold rendered')
})

test('blocks without table / math / fence stay with the host renderer (content gate)', () => {
  assert.equal(bodyOf(plainPayload), null, 'no takeover container for plain short markdown')
  assert.equal(plainPayload.hidden, false, 'host container stays visible')
  assert.equal(plainPayload.getAttribute('data-dsh-md-render-trajectory'), null, 'host container unmarked')
})

test('missing React fiber degrades silently', () => {
  assert.equal(bodyOf(brokenPayload), null, 'no takeover without the fiber contract')
  assert.equal(brokenPayload.hidden, false, 'host container stays visible')
})

test('main conversation path is untouched', () => {
  assert.equal(
    convoMd.querySelectorAll('table.dsh-md-render-table').length,
    0,
    'conversation markdown untouched by this pass',
  )
  assert.equal(convoMd.hidden, false, 'conversation container not hidden')
})

test('re-scan is idempotent and host rebuild is recovered', () => {
  const first = bodyOf(payload)
  exportsObj.apply(ctx)
  assert.equal(bodyOf(payload), first, 'same container reused when text is unchanged')
  assert.equal(scroller.querySelectorAll('div.dsh-md-render-trajectory-md').length, 1, 'no duplicate containers')
  // simulate React dropping our sibling container
  payload.parentNode.removeChild(first)
  exportsObj.apply(ctx)
  const second = bodyOf(payload)
  assert.ok(second, 'container rebuilt after host re-render')
  assert.equal(scroller.querySelectorAll('div.dsh-md-render-trajectory-md').length, 1, 'still exactly one container')
})

test('detail-panel markdown blocks (outside the scroll pane) are taken over too', () => {
  const body = bodyOf(detailPayload)
  assert.ok(body, 'detail panel container taken over')
  assert.equal(detailPayload.hidden, true, 'detail panel host container hidden')
  const table = body.querySelector('table.dsh-md-render-table')
  assert.ok(table, 'detail panel table rendered as an enhanced table')
  assert.equal(table.querySelectorAll('th')[0].textContent, '列 A', 'detail panel table header')
})

test('rows appended inside an already-open trajectory pane are taken over (incremental path)', () => {
  const newRow = makeElement('tr', { 'data-record-index': '90' })
  const newCell = makeElement('td')
  const appended = makeTrajectoryBlock('| a | b |\n|---|---|\n| 1 | 2 |')
  newCell.appendChild(appended)
  newRow.appendChild(newCell)
  scroller.appendChild(newRow) // React inserts the row into the pane
  emitAdded([newRow])
  assert.ok(bodyOf(appended), 'appended row markdown block taken over via the incremental scan')
  assert.equal(appended.hidden, true, 'appended host container hidden')
})

test('oversized blocks are skipped', () => {
  const bigRow = makeElement('tr')
  const bigCell = makeElement('td')
  const big = makeTrajectoryBlock('| a | b |\n|---|---|\n| ' + 'x'.repeat(exportsObj.MAX_TRAJECTORY_CHARS) + ' | y |')
  bigCell.appendChild(big)
  bigRow.appendChild(bigCell)
  scroller.appendChild(bigRow)
  exportsObj.apply(ctx)
  assert.equal(big.hidden, false, 'oversized block not hidden')
  assert.equal(bodyOf(big), null, 'no container added for oversized block')
})
