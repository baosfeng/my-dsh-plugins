/**
 * Step definitions for dsh-mermaid-render Gherkin acceptance tests.
 * Loads the BUILT bundle lib/client.js (parts spliced + base64 engine
 * injected by scripts/build.mjs) against stubbed react + a fake DOM,
 * mirroring client-render.mjs: card mount, loading state, toggle, non-mermaid
 * ignore and stylesheet injection.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import fs from 'node:fs'
// host 半（issue #194：system-prompt 注入）——与 client 半同一份产物入口
import { apply as hostApply } from '../../../lib/index.js'

function makeElement(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    textContent: '',
    className: attrs.className || '',
    style: {},
    dataset: {},
    parentNode: null,
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      this.textContent += child.textContent
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
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
          const found = walk(e.children)
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
          walk(e.children)
        }
      }
      walk(this.children)
      return out
    },
    matchesSel(sel) {
      if (sel === 'pre') return this.tagName === 'PRE'
      if (sel === 'code') return this.tagName === 'CODE'
      if (sel === '[data-conversation-scroll]') return this.dataset.conversationScroll === '1'
      if (sel === 'div.md-code-block') return this.tagName === 'DIV' && this.className === 'md-code-block'
      return false
    },
  }
  return el
}

// ── issue #195：更真实的 mock（useState 带 setter / useEffect 执行 /
//    可手动触发的 MutationObserver），用于流式稳定判定与失败兜底场景 ──────
function makeLiveElement(tag, attrs) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    attrs: {},
    className: (attrs && attrs.className) || '',
    _text: '',
    get textContent() {
      return this.children.length === 0 ? this._text : this.children.map((c) => c.textContent).join('')
    },
    set textContent(v) {
      this._text = String(v)
      this.children.length = 0
    },
    get isConnected() {
      let n = this
      while (n.parentNode) n = n.parentNode
      return n.tagName === 'BODY'
    },
    appendChild(child) {
      child.parentNode = this
      this.children.push(child)
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v)
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : undefined
    },
    removeAttribute(k) {
      delete this.attrs[k]
    },
    matches(sel) {
      return matchesLive(this, sel)
    },
    closest(sel) {
      let n = this
      while (n) {
        if (matchesLive(n, sel)) return n
        n = n.parentNode
      }
      return null
    },
    querySelector(sel) {
      const out = []
      collectLive(this, sel, out, true)
      return out[0] || null
    },
    querySelectorAll(sel) {
      const out = []
      collectLive(this, sel, out, false)
      return out
    },
  }
  return el
}

function collectLive(root, sel, out, first) {
  for (const child of root.children || []) {
    if (matchesLive(child, sel)) {
      out.push(child)
      if (first) return
    }
    collectLive(child, sel, out, first)
    if (first && out.length > 0) return
  }
}

function matchesLive(el, sel) {
  return String(sel)
    .split(',')
    .some((part) => matchesLiveOne(el, part.trim()))
}

function matchesLiveOne(el, sel) {
  if (sel === 'div.md-code-block') return el.tagName === 'DIV' && el.className === 'md-code-block'
  if (sel === 'pre') return el.tagName === 'PRE'
  if (sel === 'code') return el.tagName === 'CODE'
  if (sel === 'svg') return el.tagName === 'SVG'
  if (sel === 'button') return el.tagName === 'BUTTON'
  if (sel === '[data-conversation-scroll]') return el.getAttribute('data-conversation-scroll') !== undefined
  if (sel === '[data-streaming]') return el.getAttribute('data-streaming') !== undefined
  let m = /^\[([\w-]+)\^="([^"]*)"\]$/.exec(sel)
  if (m) {
    const v = el.getAttribute(m[1])
    return typeof v === 'string' && v.startsWith(m[2])
  }
  m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel)
  if (m) return el.getAttribute(m[1]) === m[2]
  m = /^\[([\w-]+)\]$/.exec(sel)
  if (m) return el.getAttribute(m[1]) !== undefined
  m = /^\.([\w-]+)$/.exec(sel)
  if (m) return String(el.className).split(/\s+/).includes(m[1])
  return false
}

/** 假 Element：instanceof 对假元素成立（scanner 用它判断扫描根）。 */
function LiveElement() {}
Object.defineProperty(LiveElement, Symbol.hasInstance, {
  value: (obj) => !!obj && typeof obj.tagName === 'string',
})

/** 可手动触发的 MutationObserver（scanner 的扫描轮次由 trigger 驱动）。 */
class LiveMutationObserver {
  constructor(cb) {
    this.cb = cb
    this.disconnected = false
    LiveMutationObserver.instances.push(this)
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  trigger() {
    if (!this.disconnected) this.cb([], this)
  }
}
LiveMutationObserver.instances = []

/** 带真实 setter 的 react stub（effect 同步执行，promise 链走微任务）。 */
function makeLiveReact() {
  let hookCall = 0
  const slots = []
  return {
    reset() {
      hookCall = 0
    },
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children: children.flat() } }
    },
    useState(initial) {
      const i = hookCall++
      if (slots[i] === undefined) slots[i] = typeof initial === 'function' ? initial() : initial
      const set = (v) => {
        slots[i] = typeof v === 'function' ? v(slots[i]) : v
      }
      return [slots[i], set]
    },
    useEffect(fn) {
      fn()
    },
    useMemo(fn) {
      return fn()
    },
    useSyncExternalStore(_s, get) {
      return get()
    },
  }
}

/** 假引擎：ok = 渲染成功；boom = 把「炸弹图」插进容器再抛错（mermaid 10.9.3 实测行为）。 */
function makeLiveEngine(kind) {
  return {
    initialize: () => {},
    render: async (id, _src, container) => {
      if (kind === 'boom') {
        if (container) {
          const holder = makeLiveElement('div')
          holder.setAttribute('id', 'd' + id)
          const svg = makeLiveElement('svg')
          svg.setAttribute('class', 'error-icon')
          const txt = makeLiveElement('text')
          txt.setAttribute('class', 'error-text')
          txt.textContent = 'Syntax error in text'
          svg.appendChild(txt)
          holder.appendChild(svg)
          container.appendChild(holder)
        }
        throw new Error('Parse error on line 3')
      }
      return { svg: '<svg id="' + id + '"></svg>' }
    },
  }
}

/** 收集元素树里的全部文本（函数组件会被展开求值）。 */
function walkLiveTexts(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const c of node) walkLiveTexts(c, out)
    return
  }
  const props = node.props ?? {}
  if (typeof node.type === 'function') {
    walkLiveTexts(node.type(props), out)
    return
  }
  walkLiveTexts(props.children, out)
}

class World {
  constructor() {
    this.styleTags = []
    this.capturedRender = null
    this.mermaidPre = null
    this.jsBlock = null
  }

  buildDom(withMermaid) {
    const scrollEl = makeElement('div')
    scrollEl.dataset.conversationScroll = '1'
    if (withMermaid) {
      const mermaidBlock = makeElement('div', { className: 'md-code-block' })
      const mermaidPre = makeElement('pre')
      const mermaidCode = makeElement('code', { className: 'language-mermaid' })
      mermaidCode.textContent = 'flowchart TD\n  A --> B'
      mermaidPre.appendChild(mermaidCode)
      mermaidBlock.appendChild(mermaidPre)
      scrollEl.appendChild(mermaidBlock)
      this.mermaidPre = mermaidPre
    }
    const jsBlock = makeElement('div', { className: 'md-code-block' })
    const jsPre = makeElement('pre')
    const jsCode = makeElement('code', { className: 'language-js' })
    jsCode.textContent = 'const x = 1'
    jsPre.appendChild(jsCode)
    jsBlock.appendChild(jsPre)
    scrollEl.appendChild(jsBlock)
    this.jsBlock = jsBlock
    const bodyEl = makeElement('body')
    bodyEl.appendChild(scrollEl)
    return bodyEl
  }

  loadAndApply(bodyEl) {
    const stubbed = {
      createElement(type, props, ...children) {
        return { type, props: { ...(props || {}), children: children.flat() } }
      },
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useSyncExternalStore: (_s, get) => get(),
    }
    const world = this
    const stubbedReactDomClient = {
      createRoot: () => ({
        render: (el) => {
          world.capturedRender = el
        },
        unmount: () => {},
      }),
    }
    let registered = null
    global.window = {
      location: { href: 'http://127.0.0.1:3080/app', search: '' },
      mermaid: {
        initialize: () => {},
        render: async (id) => ({ svg: `<svg id="${id}" width="100%"></svg>` }),
      },
      __ModuleLoader__: {
        load: (reg) => {
          registered = reg
        },
      },
    }
    global.document = {
      body: bodyEl,
      head: {
        appendChild(el) {
          world.styleTags.push(el)
          return el
        },
        removeChild() {},
      },
      createElement(tag) {
        return makeElement(tag)
      },
    }
    // 剪贴板 mock（issue #85 复制源码场景）
    this.clipboardWrites = []
    Object.defineProperty(global, 'navigator', {
      value: {
        clipboard: {
          writeText: async (text) => {
            this.clipboardWrites.push(text)
          },
        },
      },
      configurable: true,
    })
    global.Element = function Element() {}
    global.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    }
    global.NodeFilter = { SHOW_TEXT: 4 }

    // P2 parts 化后 client.src.js 是含占位符的模板，改为加载构建产物。
    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.ok(registered, 'bundle registered')
    const exportsObj = registered.factory((spec) => {
      if (spec === 'react') return stubbed
      if (spec === 'react-dom/client') return stubbedReactDomClient
      throw new Error('unexpected require: ' + spec)
    })
    const ctx = { effect: (fn) => fn() }
    exportsObj.apply(ctx)
  }

  cardTexts() {
    const cardEl = this.capturedRender
    assert.ok(cardEl, 'card captured')
    const texts = []
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
      if (typeof node.type === 'function') {
        walk(node.type(props))
        return
      }
      walk(props.children)
    }
    walk(cardEl.type(cardEl.props))
    return texts
  }

  /** 卡片内全部 button 元素（含导出按钮组，issue #85）。 */
  cardButtons() {
    const cardEl = this.capturedRender
    assert.ok(cardEl, 'card captured')
    const buttons = []
    function walk(node) {
      if (node === null || node === undefined || typeof node === 'boolean') return
      if (typeof node === 'string' || typeof node === 'number') return
      if (Array.isArray(node)) {
        for (const c of node) walk(c)
        return
      }
      const props = node.props ?? {}
      if (typeof node.type === 'function') {
        walk(node.type(props))
        return
      }
      if (node.type === 'button') buttons.push(node)
      walk(props.children)
    }
    walk(cardEl.type(cardEl.props))
    return buttons
  }

  /**
   * 挂载 host 半（issue #194）：mock systemPrompt 服务捕获 section 注册，
   * mock logger 捕获挂载日志。config 省略即默认配置。
   */
  mountHost(config) {
    this.hostSections = []
    this.hostLogs = []
    const world = this
    hostApply(
      {
        systemPrompt: {
          section(options) {
            world.hostSections.push(options)
            return () => {}
          },
        },
        logger: {
          info: (message) => world.hostLogs.push(message),
          warn: (message) => world.hostLogs.push(message),
          error: (message) => world.hostLogs.push(message),
        },
      },
      config,
    )
  }

  /** 按 aria-label 点击卡片内按钮（导出场景用）。 */
  clickExportButton(label) {
    const btn = this.cardButtons().find((b) => (b.props['aria-label'] || '') === label)
    assert.ok(btn, 'export button found: ' + label)
    btn.props.onClick()
  }

  // ── issue #195：流式「闭合即渲染」与「零炸弹图」场景 ──────────────────

  /**
   * 用更真实的 mock 加载 client bundle：useState 带 setter、useEffect 真正执行、
   * MutationObserver 可手动触发（默认无流式块；options.streaming 打开）。
   */
  loadAndApplyLive(options) {
    const opts = options || {}
    const bodyEl = makeLiveElement('body')
    const scroll = makeLiveElement('div')
    scroll.setAttribute('data-conversation-scroll', '1')
    const row = makeLiveElement('div')
    if (opts.streaming) row.setAttribute('data-streaming', '1')
    const block = makeLiveElement('div', { className: 'md-code-block' })
    const pre = makeLiveElement('pre')
    const code = makeLiveElement('code', { className: 'language-mermaid' })
    code.textContent = opts.source || 'flowchart TD\n  A --> B'
    pre.appendChild(code)
    block.appendChild(pre)
    row.appendChild(block)
    scroll.appendChild(row)
    bodyEl.appendChild(scroll)
    this.live = { bodyEl, scroll, row, block, pre, code }

    const react = makeLiveReact()
    const roots = []
    const reactDomClient = {
      createRoot: (container) => {
        const root = {
          container,
          rendered: null,
          unmounted: false,
          render(el) {
            root.rendered = el
          },
          unmount() {
            root.unmounted = true
            root.rendered = null
          },
        }
        roots.push(root)
        return root
      },
    }
    LiveMutationObserver.instances = []
    const world = this
    global.window = {
      location: { href: 'http://127.0.0.1:3080/app', search: '' },
      __ModuleLoader__: {
        load: (reg) => {
          world.registered = reg
        },
      },
    }
    if (opts.engine !== 'missing') global.window.mermaid = makeLiveEngine(opts.engine)
    global.document = {
      body: bodyEl,
      head: { appendChild: (el) => el, removeChild() {} },
      createElement: (tag) => makeLiveElement(tag),
      querySelector: (sel) => bodyEl.querySelector(sel),
      querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
    }
    global.Element = LiveElement
    global.MutationObserver = LiveMutationObserver
    global.NodeFilter = { SHOW_TEXT: 4 }
    global.atob = undefined // payload 不可用（真实引擎路径由隔离实例浏览器验证覆盖）

    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.ok(this.registered, 'bundle registered')
    const exportsObj = this.registered.factory((spec) => {
      if (spec === 'react') return react
      if (spec === 'react-dom/client') return reactDomClient
      throw new Error('unexpected require: ' + spec)
    })
    // 捕获 disposer：流式稳定判定会挂 setTimeout，After 钩子必须先断开 scanner
    // 清掉定时器，否则会在 global.document 被删掉之后触发（未捕获异常 → 进程崩溃）
    this.live.disposers = []
    const disposers = this.live.disposers
    exportsObj.apply({
      effect: (fn) => {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
    })
    this.live.react = react
    this.live.roots = roots
  }

  /** 卡片是否已挂载进块里（host 存在 + 原始 pre 隐藏）。 */
  liveMounted() {
    return this.live.block.querySelector('.dsh-mermaid-render-card-host') !== null
  }

  /** 页面上的「炸弹图」残留（引擎自带错误图形 + 离屏容器）。 */
  liveResidue() {
    return {
      dContainers: this.live.bodyEl.querySelectorAll('[id^="d"]').length,
      errorIcons: this.live.bodyEl.querySelectorAll('.error-icon').length,
      offscreen: this.live.bodyEl.querySelectorAll('[data-dsh-mermaid-render-offscreen]').length,
    }
  }

  triggerLiveObserver() {
    for (const observer of LiveMutationObserver.instances) observer.trigger()
  }

  /** 渲染一次卡片组件（effect 同步执行；promise 链走微任务），结果缓存。 */
  renderLiveCard() {
    const root = this.live.roots[0]
    assert.ok(root && root.rendered, 'card element captured')
    this.live.react.reset()
    this.live.tree = root.rendered.type(root.rendered.props)
    return this.live.tree
  }

  /** 最近一次渲染的卡片树（没有就渲染一次）。断言必须复用同一棵树：
   *  每次渲染都会重跑 effect，重复渲染会把状态打回 loading。 */
  liveCardTree() {
    return this.live.tree || this.renderLiveCard()
  }

  liveCardTexts() {
    const out = []
    walkLiveTexts(this.liveCardTree(), out)
    return out
  }

  liveCardButtons() {
    const buttons = []
    const collect = (node) => {
      if (node === null || node === undefined || typeof node === 'boolean') return
      if (typeof node === 'string' || typeof node === 'number') return
      if (Array.isArray(node)) {
        for (const c of node) collect(c)
        return
      }
      const props = node.props ?? {}
      if (typeof node.type === 'function') {
        collect(node.type(props))
        return
      }
      if (node.type === 'button') buttons.push(node)
      collect(props.children)
    }
    collect(this.liveCardTree())
    return buttons
  }
}

setWorldConstructor(World)

After(async function () {
  if (this.live && Array.isArray(this.live.disposers)) {
    for (const dispose of this.live.disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* 清理失败不阻断后续断言清理 */
      }
    }
  }
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
  delete global.Node
  delete global.navigator
  // issue #195 场景把 atob 置空以模拟 payload 不可用；删掉自有属性即恢复 Node 内置实现
  if (Object.prototype.hasOwnProperty.call(global, 'atob')) delete global.atob
})

// ── Given ─────────────────────────────────────────────────────────────────
Given('渲染插件已启动且页面含 mermaid 与普通代码块', async function () {
  const bodyEl = this.buildDom(true)
  this.loadAndApply(bodyEl)
})

Given('渲染插件已启动且页面只含普通代码块', async function () {
  const bodyEl = this.buildDom(false)
  this.loadAndApply(bodyEl)
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('生成一个图表卡片', async function () {
  assert.ok(this.capturedRender, 'card element captured via createRoot')
  assert.equal(this.capturedRender.type.name, 'MermaidCard', 'captured element is the card')
})

Then('卡片包含渲染中的加载状态', async function () {
  assert.ok(this.cardTexts().includes('渲染中…'), 'loading state shown initially')
})

Then('卡片提供预览与代码切换', async function () {
  const texts = this.cardTexts()
  assert.ok(texts.includes('预览') && texts.includes('代码'), 'preview/code toggle present')
})

Then('原始代码块被隐藏', async function () {
  assert.equal(this.mermaidPre.style.display, 'none', 'original pre hidden after mount')
})

Then('不生成任何图表卡片', async function () {
  assert.equal(this.capturedRender, null, 'no card for non-mermaid blocks')
})

Then('页面注入包含卡片规则的样式', async function () {
  assert.ok(this.styleTags.length === 1, 'stylesheet injected')
  assert.ok(this.styleTags[0].textContent.includes('.dsh-mermaid-render-card'), 'stylesheet has card rules')
})

// ── 导出（issue #85）──────────────────────────────────────────────────────
Then('卡片提供下载 PNG 与下载 SVG 按钮', async function () {
  const labels = this.cardButtons().map((b) => b.props['aria-label'] || '')
  assert.ok(labels.includes('下载 PNG'), 'download PNG button present')
  assert.ok(labels.includes('下载 SVG'), 'download SVG button present')
})

Then('卡片提供复制代码按钮', async function () {
  const labels = this.cardButtons().map((b) => b.props['aria-label'] || '')
  assert.ok(labels.includes('复制代码'), 'copy source button present')
})

When('用户点击复制代码按钮', async function () {
  this.clickExportButton('复制代码')
  await new Promise((r) => setTimeout(r, 0))
})

Then('剪贴板写入 mermaid 源码', async function () {
  assert.ok(this.clipboardWrites.length === 1, 'clipboard.writeText called')
  assert.equal(this.clipboardWrites[0], 'flowchart TD\n  A --> B', 'copied mermaid source')
})

// ── 系统提示词注入（issue #194）──────────────────────────────────────────
Given('渲染插件 host 半以默认配置挂载', async function () {
  this.mountHost(undefined)
})

Given('渲染插件 host 半以注入开关关闭的方式挂载', async function () {
  this.mountHost({ injectPrompt: false })
})

Then('系统提示词注册了 mermaid 能力说明段', async function () {
  assert.equal(this.hostSections.length, 1, 'exactly one prompt section registered')
  assert.equal(this.hostSections[0].name, 'dsh-mermaid-render', 'section name')
  assert.ok(Number.isFinite(this.hostSections[0].order), 'order is a finite number')
  assert.ok(this.hostSections[0].text.includes('原生支持'), 'text states native mermaid support')
})

Then('说明文本含围栏语言标识 mermaid 与七类图表关键字', async function () {
  const text = this.hostSections[0].text
  assert.ok(text.includes('```mermaid'), 'fenced language tag present')
  for (const kind of ['flowchart', 'sequenceDiagram', 'stateDiagram-v2', 'classDiagram', 'erDiagram', 'gantt', 'pie']) {
    assert.ok(text.includes(kind), 'diagram keyword present: ' + kind)
  }
  assert.ok(text.includes('引号') && text.includes('嵌套'), 'common pitfalls covered')
  assert.ok(text.includes('原样显示'), 'render-failure fallback described')
})

Then('说明文本长度不超过 500 字符', async function () {
  assert.ok(this.hostSections[0].text.length <= 500, 'text length = ' + this.hostSections[0].text.length)
})

Then('系统提示词未注册任何说明段', async function () {
  assert.equal(this.hostSections.length, 0, 'no prompt section registered when the toggle is off')
})

Then('插件仍记录挂载日志', async function () {
  assert.ok(this.hostLogs.length >= 1, 'mount log emitted')
  assert.ok(this.hostLogs[0].startsWith('[dsh-mermaid-render]'), 'log carries plugin prefix')
})

// ── 流式「闭合即渲染」与「零炸弹图」（issue #195）─────────────────────────
Given('渲染插件已启动且流式消息里有一个 mermaid 代码块', async function () {
  this.loadAndApplyLive({ streaming: true, engine: 'ok' })
})

Then('消息流式结束前该块未被渲染', async function () {
  assert.equal(this.live.row.getAttribute('data-streaming'), '1', '仍在流式中')
  assert.equal(this.liveMounted(), false, '稳定窗口未到时不挂载')
})

When('该代码块内容在稳定窗口内保持不变', async function () {
  await new Promise((r) => setTimeout(r, 900))
  this.triggerLiveObserver()
})

Then('消息流式结束前该块已渲染为图表卡片', async function () {
  assert.equal(this.live.row.getAttribute('data-streaming'), '1', '消息仍在流式（未等它结束）')
  assert.ok(this.liveMounted(), '内容稳定后即挂载卡片')
  assert.equal(this.live.pre.style.display, 'none', '原始 pre 被隐藏')
})

When('该代码块内容持续增长', async function () {
  for (const chunk of ['\n  A --> B', '\n  B --> C', '\n  C --> D']) {
    await new Promise((r) => setTimeout(r, 200))
    this.live.code.textContent += chunk
    this.triggerLiveObserver()
    assert.equal(this.liveMounted(), false, '内容增长中不挂载')
  }
})

Then('该块始终未被渲染为图表卡片', async function () {
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(this.liveMounted(), false, '残缺中间态未被渲染成卡片')
})

Given('渲染插件已启动且引擎渲染必定失败', async function () {
  this.loadAndApplyLive({ engine: 'boom', source: 'flowchart TD\n  A[Start --> B' })
  this.renderLiveCard() // 触发 effect → mermaid.render 失败
  await new Promise((r) => setTimeout(r, 20))
  this.renderLiveCard() // 错误态
})

Given('渲染插件已启动且内联引擎不可用', async function () {
  this.loadAndApplyLive({ engine: 'missing' })
  this.renderLiveCard()
  await new Promise((r) => setTimeout(r, 20))
  this.renderLiveCard()
})

Then('页面不残留 mermaid 错误图形', async function () {
  assert.deepEqual(
    this.liveResidue(),
    { dContainers: 0, errorIcons: 0, offscreen: 0 },
    '页面不得残留引擎自带的错误图形（炸弹图）',
  )
})

Then('卡片显示渲染失败横幅与重试按钮', async function () {
  const texts = this.liveCardTexts()
  assert.ok(
    texts.some((t) => t.includes('渲染失败')),
    '错误横幅出现：' + JSON.stringify(texts),
  )
  const labels = this.liveCardButtons().map((b) => b.props['aria-label'] || '')
  assert.ok(labels.includes('重试'), '重试按钮存在：' + JSON.stringify(labels))
})

Then('卡片内保留原始 mermaid 源码', async function () {
  const texts = this.liveCardTexts()
  assert.ok(
    texts.some((t) => t.includes('flowchart TD')),
    '源码保留在卡片里：' + JSON.stringify(texts),
  )
})
