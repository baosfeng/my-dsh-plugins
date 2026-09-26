/**
 * test/support/fake-dom.mjs — 精简后测试套件共享支撑。
 *
 * 精简后的 md-render 只做三件事，测试也只需要三样东西：
 *  ① 极简假 DOM（只实现本插件用到的 API + 本套件用到的选择器形态）；
 *  ② bundle 加载器（eval lib/client.js + 桩 require：官方组件 / react-dom/client）；
 *  ③ 官方渲染器桩：MarkdownText（记录收到的 props）+ createRoot（把 vdom 落成 DOM）。
 *
 * 为什么测试桩「官方渲染器」而不是真的渲染：GFM 表格 / 公式 / 代码块高亮的渲染
 * 正确性属于官方组件的测试面；本插件的判据是**接线正确**——把哪段文本、带什么
 * labels、交到哪个组件、渲染到哪个容器，以及注入点的门控 / 幂等 / 降级行为。
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const TAG_CLASS_ATTR = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/

/** 单条简单选择器（tag / .class / [attr] / [attr="v"] 的任意组合）。 */
function matchSimple(el, sel) {
  const m = TAG_CLASS_ATTR.exec(sel)
  if (!m) return false
  const [, tag, classes, attrs] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  for (const cls of classes.split('.').filter(Boolean)) {
    if (!String(el.className).split(/\s+/).includes(cls)) return false
  }
  for (const attr of attrs.match(/\[[^\]]+\]/g) || []) {
    const parsed = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(attr)
    if (!parsed) return false
    const value = el.getAttribute(parsed[1])
    if (value === null) return false
    if (parsed[2] !== undefined && value !== parsed[2]) return false
  }
  return true
}

/** 选择器匹配（支持逗号并列，够本插件用）。 */
function matchesSelector(el, sel) {
  return String(sel)
    .split(',')
    .some((part) => matchSimple(el, part.trim()))
}

/** 造一个假元素（假 DOM 的核心：一份 _nodes 数组 + 属性表 + 监听表）。 */
export function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    _nodes: [],
    _attrs: {},
    _listeners: {},
    className: attrs.className || '',
    style: {},
    dataset: {},
    hidden: false,
    type: '',
    parentNode: null,
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    appendChild(child) {
      const i = this._nodes.indexOf(child)
      if (i >= 0) this._nodes.splice(i, 1)
      this._nodes.push(child)
      child.parentNode = this
      return child
    },
    insertBefore(child, ref) {
      const i = ref ? this._nodes.indexOf(ref) : -1
      if (i < 0) this._nodes.push(child)
      else this._nodes.splice(i, 0, child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this._nodes.indexOf(child)
      if (i >= 0) this._nodes.splice(i, 1)
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
      const walk = (nodes) => {
        for (const node of nodes) {
          if (node.nodeType !== 1) continue
          if (node.matchesSel(sel)) return node
          const found = walk(node._nodes)
          if (found) return found
        }
        return null
      }
      return walk(this._nodes)
    },
    querySelectorAll(sel) {
      const out = []
      const walk = (nodes) => {
        for (const node of nodes) {
          if (node.nodeType !== 1) continue
          if (node.matchesSel(sel)) out.push(node)
          walk(node._nodes)
        }
      }
      walk(this._nodes)
      return out
    },
    matchesSel(sel) {
      return matchesSelector(this, sel)
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
    /** 测试用：触发某个事件监听（真实浏览器里由交互触发）。 */
    fire(type, event = {}) {
      for (const fn of this._listeners[type] || []) fn({ currentTarget: this, target: this, ...event })
    },
  }
  Object.defineProperty(el, 'children', { get: () => el._nodes.filter((n) => n.nodeType === 1) })
  Object.defineProperty(el, 'childNodes', { get: () => el._nodes })
  Object.defineProperty(el, 'firstElementChild', { get: () => el._nodes.find((n) => n.nodeType === 1) || null })
  Object.defineProperty(el, 'previousElementSibling', {
    get: () => {
      if (!el.parentNode) return null
      const siblings = el.parentNode._nodes
      for (let i = siblings.indexOf(el) - 1; i >= 0; i -= 1) {
        if (siblings[i].nodeType === 1) return siblings[i]
      }
      return null
    },
  })
  Object.defineProperty(el, 'textContent', {
    get: () => el._nodes.map((n) => n.textContent).join(''),
    set(v) {
      el._nodes = []
      if (v !== '') el.appendChild({ nodeType: 3, textContent: String(v), parentNode: el })
    },
  })
  if (attrs.className) el.setAttribute('class', attrs.className)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') continue
    el.setAttribute(k, v)
  }
  return el
}

/** 造一个假页面（document / window / MutationObserver 记录器）。 */
export function createPage(body = makeElement('body')) {
  const document = {
    body,
    head: makeElement('head'),
    createElement: (tag) => makeElement(tag),
    createElementNS: (_ns, tag) => makeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text), parentNode: null }),
    createDocumentFragment: () => makeElement('fragment'),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  }
  return { document, window: { location: { href: 'http://127.0.0.1:3080/app', search: '' } }, observers: [] }
}

/** 安装假全局（每个测试文件调用一次）。 */
export function installGlobals(page) {
  globalThis.window = page.window
  globalThis.document = page.document
  globalThis.Element = function Element() {}
  globalThis.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      page.observers.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
  }
  return page
}

/** React 桩（够本插件用：createElement / useState / useEffect）。 */
export function createReactStub() {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.flat() },
  })
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }
}

/** vdom → 假 DOM（react-dom 桩用，够本插件的 vdom 形态）。 */
export function vdomToDom(node, document) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
  if (Array.isArray(node)) {
    const frag = document.createDocumentFragment()
    for (const child of node) {
      const dom = vdomToDom(child, document)
      if (dom) frag.appendChild(dom)
    }
    return frag
  }
  if (typeof node.type === 'function') return vdomToDom(node.type(node.props), document)
  if (typeof node.type !== 'string') return null
  const el = document.createElement(node.type)
  for (const [key, value] of Object.entries(node.props || {})) {
    if (key === 'children' || key === 'key' || value === undefined || value === null || value === false) continue
    if (key === 'className') el.className = value
    else if (key === 'style') el.style = value
    else if (key.startsWith('on')) el._listeners[key.slice(2).toLowerCase()] = [value]
    else el.setAttribute(key, String(value))
  }
  for (const child of (node.props && node.props.children) || []) {
    const dom = vdomToDom(child, document)
    if (dom) el.appendChild(dom)
  }
  return el
}

/** react-dom/client 桩：createRoot 把 vdom 落成 DOM，并记录 render / unmount。 */
function createReactDomStub(page) {
  const renders = []
  const unmounts = []
  const createRoot = (container) => ({
    container,
    render(node) {
      renders.push({ container, node })
      container.textContent = ''
      const dom = vdomToDom(node, page.document)
      if (dom) container.appendChild(dom)
    },
    unmount() {
      unmounts.push(container)
      container.textContent = ''
    },
  })
  return { createRoot, renders, unmounts }
}

/** 官方 MarkdownText 桩：记录收到的 props，落成一个带 data-text 的 div。 */
function createPrimeMarkdownStub(react) {
  const calls = []
  const MarkdownText = (props) => {
    calls.push(props)
    // 桩里同时造出官方的「噪声」结构（banner 语言名 + 代码块复制按钮），
    // 供整段复制测试验证这些文案不会被收进复制内容。
    return react.createElement(
      'div',
      { className: 'official-md-stub', 'data-text': props.text, 'data-labels': JSON.stringify(props.labels || null) },
      react.createElement('div', { 'data-code-block-banner': 'true' }, 'js'),
      react.createElement('button', { className: 'official-copy' }, '复制'),
      props.text,
    )
  }
  return { MarkdownText, calls }
}

/**
 * 加载 lib/client.js（产物）并返回它的 exports。
 * @param {{ page: object, markdown?: object, reactDom?: object, extraRequire?: object }} options
 *   markdown / reactDom 缺省 = 平台模块缺失（用于验证真降级）。
 */
export function loadBundle({ page, markdown, reactDom, react, extraRequire = {} } = {}) {
  const reactStub = react || createReactStub()
  const stubs = { react: reactStub }
  if (markdown !== undefined) stubs['@deepseek-ai/dsh-client-ui-primitives'] = markdown
  if (reactDom !== undefined) stubs['react-dom/client'] = reactDom
  Object.assign(stubs, extraRequire)
  const requireCalls = []
  let registered = null
  page.window.__ModuleLoader__ = {
    load: (registration) => {
      registered = registration
    },
  }
  globalThis.window = page.window
  const source = fs.readFileSync(fileURLToPath(new URL('../../lib/client.js', import.meta.url)), 'utf8')
  // 产物是 __ModuleLoader__ bundle（非 ESM）
  eval(source)
  if (!registered) throw new Error('bundle did not register')
  const exportsObj = registered.factory((spec) => {
    requireCalls.push(spec)
    if (spec in stubs) return stubs[spec]
    throw new Error('unexpected require: ' + spec)
  })
  return { exports: exportsObj, requireCalls, react: reactStub, registered }
}

/** 官方渲染器「完整可用」的一套桩（组件 + createRoot）+ 记录器。 */
export function createOfficialStack(page, react) {
  const markdown = createPrimeMarkdownStub(react)
  const reactDom = createReactDomStub(page)
  return { markdown, reactDom }
}

/** 造一个围栏代码块：div.md-code-block > banner(语言名) + pre > code（官方 DOM 契约）。 */
export function makeCodeBlock({ lang = '', code = '', fiber = true, banner = true, blockAttrs = {} } = {}) {
  const block = makeElement('div', { className: 'md-code-block', ...blockAttrs })
  if (banner) {
    const bannerEl = makeElement('div', { 'data-code-block-banner': 'true' })
    const info = makeElement('div')
    info.textContent = lang
    bannerEl.appendChild(info)
    block.appendChild(bannerEl)
  }
  const content = makeElement('div', { 'data-code-block-content': 'true' })
  const pre = makeElement('pre', { className: 'plain' })
  const codeEl = makeElement('code')
  codeEl.textContent = code
  pre.appendChild(codeEl)
  content.appendChild(pre)
  block.appendChild(content)
  if (fiber) {
    // React fiber 契约：div.md-code-block 的 fiber 链上有 CodeBlock 的 memoizedProps。
    // fiber 链：DOM 节点 → host fiber(div) → CodeBlock 组件 fiber（memoizedProps 带 code/lang）。
    const codeBlockFiber = { memoizedProps: { code, lang, streaming: false }, return: null }
    const hostFiber = { memoizedProps: { className: 'md-code-block' }, return: codeBlockFiber }
    Object.defineProperty(block, '__reactFiber$test1', { value: hostFiber, enumerable: true })
  }
  return block
}

/** 造一个上下文注入块：<pre data-context-text="true">{text}</pre>（宿主 ContextBody 形态）。 */
export function makeContextPre(text) {
  const pre = makeElement('pre', { 'data-context-text': 'true' })
  pre.textContent = text
  return pre
}
