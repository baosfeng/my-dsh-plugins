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
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// 属性段允许带引号的值与内部空格：`[data-variant="think"]`、`[aria-expanded]`。
// （曾用 `\[[^\]]+\]` 整体匹配，只能解析无值属性 → 带值的官方契约选择器在假 DOM 里
//  永远匹配不上，测试因此看不见真实行为。）
const TAG_CLASS_ATTR = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]*\])*)$/

/** 单条简单选择器（tag / .class / [attr] / [attr="v"] / [attr*=v] 的任意组合）。 */
function matchSimple(el, sel) {
  const m = TAG_CLASS_ATTR.exec(sel)
  if (!m) return false
  const [, tag, classes, attrs] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  for (const cls of classes.split('.').filter(Boolean)) {
    if (!String(el.className).split(/\s+/).includes(cls)) return false
  }
  for (const attr of attrs.match(/\[[^\]]+\]/g) || []) {
    // 支持 = / *= / ^= / $= 四种属性算子（* 用于 [class*=dsh-md-render] 这类契约断言）。
    const parsed = /^\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|([^\]]*?))\s*)?\]$/.exec(attr)
    if (!parsed) return false
    const value = el.getAttribute(parsed[1])
    if (value === null) return false
    const op = parsed[2]
    if (op === undefined) continue
    const expected = parsed[3] !== undefined ? parsed[3] : parsed[4]
    if (op === '=') {
      if (value !== expected) return false
    } else if (op === '*=') {
      if (!value.includes(expected)) return false
    } else if (op === '^=') {
      if (!value.startsWith(expected)) return false
    } else if (op === '$=') {
      if (!value.endsWith(expected)) return false
    } else {
      return false
    }
  }
  return true
}

/**
 * 选择器匹配：支持逗号并列（`a, b`）与**后代组合**（`A B`，A 是 B 的祖先）。
 * 本插件用到的官方契约选择器就有后代组合（think.ts 的
 * `[data-variant="think"] [data-disclosure-row][aria-expanded]`），不支持的话
 * 「思考行默认展开」这条行为在假 DOM 里永远匹配不上、测试会静默失效。
 */
function matchesSelector(el, sel) {
  return String(sel)
    .split(',')
    .some((part) => {
      const chain = parseSelectorChain(part.trim())
      if (chain.length === 0) return false
      const last = chain[chain.length - 1]
      if (!matchSimple(el, last.simple)) return false
      let node = el.parentNode
      for (let i = chain.length - 2; i >= 0; i -= 1) {
        const step = chain[i]
        // 组合子记在**后一个**简单选择器上（chain[i+1].combinator = chain[i] 与 chain[i+1] 的关系）。
        if (chain[i + 1].combinator === '>') {
          // 子代组合：父节点必须**恰好**匹配（不向上找）。
          if (!node || node.nodeType !== 1 || !matchSimple(node, step.simple)) return false
        } else {
          while (node && node.nodeType === 1 && !matchSimple(node, step.simple)) node = node.parentNode
          if (!node || node.nodeType !== 1) return false
        }
        node = node.parentNode
      }
      return true
    })
}

/**
 * 选择器链解析：把 `A > B C` 拆成
 * [{simple:'A',combinator:' '},{simple:'B',combinator:'>'},{simple:'C',combinator:' '}]。
 * 支持后代（空格）与子代（>）两种组合子；不认识的组合子按后代处理。
 */
function parseSelectorChain(part) {
  const out = []
  if (part === '') return out
  const re = /\s*(>)\s*|\s+/g
  let last = 0
  let combinator = ' '
  let m = re.exec(part)
  while (m !== null) {
    const simple = part.slice(last, m.index)
    if (simple !== '') out.push({ simple, combinator })
    combinator = m[1] === '>' ? '>' : ' '
    last = re.lastIndex
    m = re.exec(part)
  }
  const tail = part.slice(last)
  if (tail !== '') out.push({ simple: tail, combinator })
  return out
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
      // 真实 DOM 语义：搬走的孩子会先从原父节点的子表里摘掉。
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child)
      const i = this._nodes.indexOf(child)
      if (i >= 0) this._nodes.splice(i, 1)
      this._nodes.push(child)
      child.parentNode = this
      // 真实浏览器语义：插入 <script> 会执行它（本插件的懒加载依赖这条：fetch → 注入 → 全局可用）。
      if (child.tagName === 'SCRIPT' && typeof child.textContent === 'string' && child.textContent !== '') {
        runScriptInPage(child.textContent)
      }
      return child
    },
    insertBefore(child, ref) {
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child)
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
    /** 真实 DOM 语义：dispatchEvent(new CustomEvent(...)) → 监听器收到带 detail 的事件。 */
    dispatchEvent(event) {
      this.fire(event.type, event.detail === undefined ? {} : { detail: event.detail })
      return true
    },
    /** 真实 DOM 语义：`el.click()` 派发一次 click（think.ts 对官方折叠行就是这么触发的）。 */
    click() {
      this.fire('click')
    },
    /** 真实 DOM 语义：`<dialog>` 模态开关（mermaid 浮窗用；测试断言 DOM 与自有标记）。 */
    showModal() {
      this._open = true
    },
    close() {
      this._open = false
      this.fire('close')
    },
    /** 布局量（真实浏览器由渲染引擎给；测试用 `el._rect` 显式指定）。 */
    getBoundingClientRect() {
      return this._rect || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
    },
  }
  // className 与 class 属性双向同步（真实 DOM 语义）：契约断言会用 [class*=…] 选择器。
  Object.defineProperty(el, 'className', {
    get: () => (Object.prototype.hasOwnProperty.call(el._attrs, 'class') ? el._attrs.class : ''),
    set: (value) => {
      el._attrs.class = String(value)
    },
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(el, 'children', { get: () => el._nodes.filter((n) => n.nodeType === 1) })
  Object.defineProperty(el, 'childNodes', { get: () => el._nodes })
  Object.defineProperty(el, 'firstElementChild', { get: () => el._nodes.find((n) => n.nodeType === 1) || null })
  Object.defineProperty(el, 'nextSibling', {
    get: () => {
      if (!el.parentNode) return null
      const siblings = el.parentNode._nodes
      return siblings[siblings.indexOf(el) + 1] || null
    },
  })
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

/** 会话级存储桩（需求 4「刷新后仍记得」的持久化面；真实浏览器由 sessionStorage 提供）。 */
function createSessionStorageStub() {
  const map = new Map()
  return {
    _map: map,
    getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => void map.set(String(key), String(value)),
    removeItem: (key) => void map.delete(String(key)),
  }
}

/** 当前假页面（<script> 注入需要知道往哪个 realm 里执行；installGlobals 时更新）。 */
let currentPage = null
/** 已 contextify 的 window（vm.createContext 幂等，但用 WeakSet 省去重复判断）。 */
const contextifiedWindows = new WeakSet()

/**
 * 执行一段注入脚本（模拟浏览器对 <script> 的处理）：把假 window 作为 vm 上下文，
 * 于是 UMD 里的 `globalThis.X = …` 直接落到 page.window.X 上（与真实浏览器同一契约）。
 * 没有假页面时静默跳过（纯 vdom 测试用不到）。
 */
function runScriptInPage(code) {
  if (currentPage === null) return
  try {
    if (!contextifiedWindows.has(currentPage.window)) {
      vm.createContext(currentPage.window)
      contextifiedWindows.add(currentPage.window)
    }
    vm.runInContext(code, currentPage.window)
  } catch (_e) {
    // 假 DOM 里脚本执行失败 = 与真实浏览器里注入失败等价，交给被测代码的降级分支。
  }
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
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  }
  const window = {
    location: { href: 'http://127.0.0.1:3080/app', search: '' },
    sessionStorage: createSessionStorageStub(),
  }
  return { document, window, observers: [] }
}

/** 安装假全局（每个测试文件调用一次）。 */
export function installGlobals(page) {
  currentPage = page
  globalThis.window = page.window
  globalThis.document = page.document
  globalThis.Element = function Element() {}
  // CustomEvent：本插件的语言切换 / 缩放事件走它（真实浏览器原生存在，假环境补最小实现）。
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type
      this.bubbles = init.bubbles === true
      this.detail = init.detail
    }
  }
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

/**
 * **真实**渲染依赖（assets/ 里 vendored 的 marked / highlight.js）装进页面 window。
 *
 * 为什么不用桩：自研渲染器（own-markdown.ts / own-code.ts）的判据就是「marked 词法树 →
 * 我们的 vdom」「hljs 令牌树 → hljs-* class 的 span」——用真库才能断言真实产物
 * （h1 / ul / table / hljs-keyword span），桩只能断言接线、断言不了渲染。
 * 用 node:vm 起一个隔离上下文（UMD 在那里落到 globalThis），再挂到假 window 上。
 */
let realAssets = null

/** 懒加载真实 assets（每个测试进程只解析一次）。同文件内供 createRenderStack 使用，不导出。 */
function loadRealRenderAssets() {
  if (realAssets !== null) return realAssets
  const context = vm.createContext({})
  vm.runInContext(fs.readFileSync(new URL('../../assets/marked-18.1.0.umd.js', import.meta.url), 'utf8'), context)
  vm.runInContext(fs.readFileSync(new URL('../../assets/highlightjs-11.12.0.min.js', import.meta.url), 'utf8'), context)
  realAssets = { marked: context.marked, hljs: context.hljs }
  return realAssets
}

/** 把真实 marked / hljs 装到假 window 上（等价于「懒加载已完成」）。同文件内使用，不导出。 */
function installRealRenderAssets(page) {
  const assets = loadRealRenderAssets()
  page.window.marked = assets.marked
  page.window.hljs = assets.hljs
  return assets
}

/**
 * 加载 lib/client.js（产物）并返回它的 exports。
 * @param {{ page: object, reactDom?: object, react?: object, extraRequire?: object }} options
 *   reactDom 缺省 = 平台模块缺失（用于验证真降级）；渲染依赖（marked / hljs）经
 *   `installRealRenderAssets(page)` 装到 window 上，缺省 = 未加载（懒加载 / 降级路径）。
 */
export function loadBundle({ page, reactDom, react, extraRequire = {} } = {}) {
  const reactStub = react || createReactStub()
  const stubs = { react: reactStub }
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

/**
 * 渲染栈：react-dom/client 桩（createRoot 把 vdom 落成假 DOM）+ 可选的**真实**渲染依赖。
 * @param {{ assets?: boolean }} [options] assets = false → 不装 marked / hljs（验证懒加载与降级）
 */
export function createRenderStack(page, react, options = {}) {
  const reactDom = createReactDomStub(page)
  const assets = options.assets === false ? null : installRealRenderAssets(page)
  return { reactDom, assets }
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

/**
 * 语言索引查询桩（issue #466）：把 host 半**真实的**语言索引接到 client 半的 fetch 上。
 *
 * 测试直接传 `lib/lang-index.js` 的 `createLangIndex()` 实例 —— 桩里不放任何「内容 → 语言」
 * 的假答案，哈希算法与查表语义都走真实现，避免桩与真实现漂移（client 只认
 * `GET /md-render/api/langs?h=…` 的 `{ ok, value }` 契约）。
 *
 * @param {{ lookup: (hashes: string[]) => Record<string, string> }} index host 半索引实例
 * @param {{ fail?: boolean }} [options] fail = 让所有请求失败（验证静默降级）
 * @returns {{ calls: string[], langCalls: () => string[], restore: () => void }}
 */
export function installLangFetchStub(index, options = {}) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = (url) => {
    const href = String(url)
    calls.push(href)
    if (options.fail === true) return Promise.reject(new Error('offline'))
    if (href.includes('/assets/')) {
      // 懒加载路径：把真实的 vendored 库当静态资源回给 client（与 host 半静态路由同契约）。
      const name = href.slice(href.lastIndexOf('/') + 1)
      const file = new URL('../../assets/' + name, import.meta.url)
      if (!fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404 })
      const body = fs.readFileSync(file, 'utf8')
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) })
    }
    if (href.includes('/config')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: {} }) })
    }
    const hashes = new URL(href, 'http://127.0.0.1:3080').searchParams.getAll('h')
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: index.lookup(hashes) }) })
  }
  return {
    calls,
    langCalls: () => calls.filter((href) => href.includes('/langs')),
    restore() {
      if (original === undefined) delete globalThis.fetch
      else globalThis.fetch = original
    },
  }
}

/**
 * 造一个**真实宿主形态**的代码块（issue #466 实测，宿主 0.2.0-rc.2）：
 * banner 只显示本地化标签「代码块」（shiki 不认识 text / mermaid 时走
 * `i8(lang) ? lang : labels.codeLabel`），`<code>` **没有** language-* class
 * （官方只在空围栏分支写）。它与「无语言块」逐字段完全相同 —— 纯 DOM 无法区分。
 */
export function makeRealHostCodeBlock({ code, label = '代码块', blockAttrs = {} } = {}) {
  return makeCodeBlock({ lang: label, code, fiber: false, blockAttrs })
}
