/**
 * issue #195 回归测试：流式「代码块闭合即渲染」+ 任何失败路径「零炸弹图」。
 *
 * 加载构建产物 lib/client.js（与 client-render.mjs 同源），用**可手动触发**的
 * MutationObserver + 假 DOM 驱动 scanner，断言：
 *  1. 引擎加载失败（payload 不可用）→ 无 mermaid 错误图形残留 + 错误横幅 + 重试按钮；
 *  2. 引擎渲染失败（引擎把错误图形插进渲染容器）→ 错误图形随离屏容器一起丢弃；
 *  3. 流式块内容稳定 → 在 [data-streaming] 仍存在时（消息未结束）即挂载卡片；
 *  4. 流式块内容仍在变化 → 不挂载（不把残缺中间态渲染成失败卡片）；
 *  5. 已挂载后内容继续变化 → 卡片自愈卸载，重新等待；
 *  6. 不回归：非流式块 0 延迟挂载、流式结束后立即挂载。
 *
 * 说明：assistant 消息流式期间宿主在整条消息容器上挂 data-streaming（证据：
 * dsh-client-ui-chat/lib/client.js 的 "data-streaming": streaming || void 0），
 * 因此「围栏闭合」只能由插件侧用「内容稳定窗口 + 连续观察」判定。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── 假 DOM ────────────────────────────────────────────────────────────────
function makeEl(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    attrs: {},
    className: String(attrs.className || ''),
    _text: '',
    get textContent() {
      return this.children.length === 0 ? this._text : this.children.map((c) => c.textContent).join('')
    },
    set textContent(v) {
      this._text = String(v)
      this.children.length = 0
    },
    get nextElementSibling() {
      const p = this.parentNode
      if (!p) return null
      const i = p.children.indexOf(this)
      return i >= 0 && i + 1 < p.children.length ? p.children[i + 1] : null
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
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
        this.dataset[camel] = String(v)
      }
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : undefined
    },
    removeAttribute(k) {
      delete this.attrs[k]
    },
    matches(sel) {
      return matchesSel(this, sel)
    },
    closest(sel) {
      let n = this
      while (n) {
        if (matchesSel(n, sel)) return n
        n = n.parentNode
      }
      return null
    },
    querySelector(sel) {
      const out = []
      collect(this, sel, out, true)
      return out[0] || null
    },
    querySelectorAll(sel) {
      const out = []
      collect(this, sel, out, false)
      return out
    },
  }
  return el
}

function collect(root, sel, out, first) {
  for (const child of root.children || []) {
    if (matchesSel(child, sel)) {
      out.push(child)
      if (first) return
    }
    collect(child, sel, out, first)
    if (first && out.length > 0) return
  }
}

function matchesSel(el, sel) {
  return String(sel)
    .split(',')
    .some((part) => matchesSimple(el, part.trim()))
}

function matchesSimple(el, sel) {
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

/** 假 Element：instanceof 必须像真实 DOM 一样对元素成立（scanner 用它判断扫描根）。 */
function FakeElement() {}
Object.defineProperty(FakeElement, Symbol.hasInstance, {
  value: (obj) => !!obj && typeof obj.tagName === 'string',
})

// ── 可手动触发的 MutationObserver ─────────────────────────────────────────
class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb
    this.disconnected = false
    FakeMutationObserver.instances.push(this)
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  trigger() {
    if (!this.disconnected) this.cb([], this)
  }
}
FakeMutationObserver.instances = []

// ── bundle 注册（只 eval 一次；factory 每次调用得到独立模块状态）──────────
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (r) => {
      registered = r
    },
  },
}
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')

// ── 每场景环境 ────────────────────────────────────────────────────────────
function makeReact() {
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

function makeEnv() {
  const body = makeEl('body')
  const head = makeEl('head')
  const document = {
    body,
    head,
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    execCommand: () => true,
  }
  FakeMutationObserver.instances = []
  const react = makeReact()
  const roots = []
  const reactDomClient = {
    createRoot(container) {
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
  global.window = { location: { href: 'http://127.0.0.1:3096/app', search: '' } }
  global.document = document
  global.MutationObserver = FakeMutationObserver
  global.Element = FakeElement
  global.NodeFilter = { SHOW_TEXT: 4 }
  global.atob = undefined // payload 不可用：MERMAID_UMD 恒为空串（真实引擎路径由浏览器验证覆盖）
  return { body, head, document, react, reactDomClient, roots, observers: FakeMutationObserver.instances }
}

/** 用当前 global 环境实例化一份独立的 client bundle。 */
function instantiate(env) {
  const exportsObj = registered.factory((spec) => {
    if (spec === 'react') return env.react
    if (spec === 'react-dom/client') return env.reactDomClient
    throw new Error('unexpected require: ' + spec)
  })
  const ctx = {
    effect(fn) {
      return fn()
    },
  }
  exportsObj.apply(ctx)
  return { exportsObj }
}

/** 造一个 mermaid md-code-block（可选挂在 data-streaming 行里）。 */
function makeMermaidBlock(body, source, opts) {
  const streaming = !!(opts && opts.streaming)
  const scroll = makeEl('div')
  scroll.setAttribute('data-conversation-scroll', '1')
  const row = makeEl('div')
  if (streaming) row.setAttribute('data-streaming', '1')
  const block = makeEl('div', { className: 'md-code-block' })
  const pre = makeEl('pre')
  const code = makeEl('code', { className: 'language-mermaid' })
  code.textContent = source
  pre.appendChild(code)
  block.appendChild(pre)
  row.appendChild(block)
  scroll.appendChild(row)
  body.appendChild(scroll)
  return { scroll, row, block, pre, code, cardHost: () => block.querySelector('.dsh-mermaid-render-card-host') }
}

/** 卡片挂载判定：卡片 host 已在块内且原始 pre 已隐藏。 */
function isMounted(fx) {
  return fx.cardHost() !== null && fx.pre.style.display === 'none'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 「炸弹图」残留检查：mermaid 自带错误图形 = #d<id> 容器 + .error-icon/.error-text。 */
function bombResidue(body) {
  return {
    dContainers: body.querySelectorAll('[id^="d"]').length,
    errorIcons: body.querySelectorAll('.error-icon').length,
    errorTexts: body.querySelectorAll('.error-text').length,
    offscreenHosts: body.querySelectorAll('[data-dsh-mermaid-render-offscreen]').length,
  }
}

function walkTree(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const c of node) walkTree(c, visit)
    return
  }
  const props = node.props || {}
  visit(node, props)
  if (typeof node.type === 'function') {
    walkTree(node.type(props), visit)
    return
  }
  walkTree(props.children, visit)
}

function collectCardText(tree) {
  const texts = []
  walkTree(tree, (node) => {
    if (typeof node.type !== 'string') return
    const arr = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
    for (const k of arr) if (typeof k === 'string' || typeof k === 'number') texts.push(String(k))
  })
  return texts
}

/** 收集一棵（子）树里的全部文本，用于按可见文案定位按钮（按钮内含 svg + span）。 */
function subtreeText(node) {
  const texts = []
  walkTree(node, (n, props) => {
    const arr = Array.isArray(props.children) ? props.children : [props.children]
    for (const c of arr) if (typeof c === 'string' || typeof c === 'number') texts.push(String(c))
  })
  return texts
}

/** 收集树里所有元素的 className（函数组件会被展开求值）。 */
function collectClassNames(tree) {
  const out = []
  walkTree(tree, (node, props) => {
    if (typeof props.className === 'string') out.push(props.className)
  })
  return out
}

function findButton(tree, label) {
  let found = null
  walkTree(tree, (node, props) => {
    if (node.type !== 'button') return
    if (subtreeText(node).some((t) => t.includes(label))) found = props
  })
  return found
}

/** 渲染一次卡片组件并返回元素树（hook 槽位按调用顺序重置）。 */
function renderCard(env, root) {
  env.react.reset()
  const el = root.rendered
  assert.ok(el, 'card element captured')
  return el.type(el.props)
}

const RESIDUE_ZERO = { dContainers: 0, errorIcons: 0, errorTexts: 0, offscreenHosts: 0 }

// ══ 场景 1：引擎加载失败（payload 不可用）→ 零炸弹图 + 错误横幅 + 重试 ══
test('引擎加载失败：无炸弹图残留、错误横幅可见、重试按钮可恢复渲染', async () => {
  const env = makeEnv()
  const fx = makeMermaidBlock(env.body, 'flowchart TD\n  A --> B')
  instantiate(env)
  assert.ok(isMounted(fx), '卡片已挂载（失败在渲染阶段暴露）')
  const root = env.roots[0]
  renderCard(env, root) // 首次渲染触发 effect → ensureMermaid 失败
  await sleep(20)
  const tree = renderCard(env, root)
  const texts = collectCardText(tree)
  assert.ok(
    texts.some((t) => t.includes('失败')),
    '错误横幅出现：' + JSON.stringify(texts),
  )
  assert.ok(findButton(tree, '重试'), '错误状态提供重试按钮')
  assert.deepEqual(bombResidue(env.body), RESIDUE_ZERO, '引擎不可用时页面无炸弹图残留')

  // 引擎恢复（模拟资源恢复）→ 点击重试应重新加载引擎并渲染成功
  global.window.mermaid = {
    initialize: () => {},
    render: async (id) => ({ svg: '<svg id="' + id + '"></svg>' }),
  }
  const retry = findButton(tree, '重试')
  retry.onClick()
  const tree2 = renderCard(env, root)
  assert.ok(
    collectCardText(tree2).some((t) => t.includes('渲染中')),
    '重试后回到渲染中状态：' + JSON.stringify(collectCardText(tree2)),
  )
  await sleep(20)
  const tree3 = renderCard(env, root)
  assert.ok(
    collectClassNames(tree3).includes('dsh-mermaid-render-svg'),
    '重试后成功渲染出 SVG（重试清掉了引擎加载缓存）',
  )
})

// ══ 场景 2：引擎渲染失败 → 错误图形随离屏容器一起丢弃 ══
test('引擎渲染失败：引擎错误图形不落进页面，错误横幅 + 源码保留', async () => {
  const env = makeEnv()
  const calls = []
  global.window.mermaid = {
    initialize: () => {},
    render: async (id, _src, container) => {
      calls.push({ id, container, attachedToBody: !!container && container.parentNode === env.body })
      // 模拟 mermaid 10.9.3 的真实失败行为：把「炸弹图」插进给定的渲染容器
      if (container) {
        const holder = makeEl('div')
        holder.setAttribute('id', 'd' + id)
        const svg = makeEl('svg')
        svg.setAttribute('class', 'error-icon')
        const txt = makeEl('text')
        txt.setAttribute('class', 'error-text')
        txt.textContent = 'Syntax error in text'
        svg.appendChild(txt)
        holder.appendChild(svg)
        container.appendChild(holder)
      }
      throw new Error('Parse error on line 3')
    },
  }
  const fx = makeMermaidBlock(env.body, 'flowchart TD\n  A[Start --> B')
  instantiate(env)
  renderCard(env, env.roots[0]) // 首次渲染触发 effect → mermaid.render
  await sleep(20)
  assert.equal(calls.length, 1, '引擎被调用一次')
  assert.ok(calls[0].container, '渲染必须给引擎一个容器（离屏），否则引擎会把错误图形插进 body')
  assert.ok(calls[0].container.getAttribute('data-dsh-mermaid-render-offscreen') !== undefined, '渲染容器带离屏标记')
  assert.equal(calls[0].attachedToBody, true, '渲染时离屏容器挂在 body 下（脱离文档流但参与布局，保证尺寸可测）')
  assert.deepEqual(bombResidue(env.body), RESIDUE_ZERO, '失败后错误图形与离屏容器都被清除')
  const tree = renderCard(env, env.roots[0])
  const texts = collectCardText(tree)
  assert.ok(
    texts.some((t) => t.includes('Parse error')),
    '错误原因可见：' + JSON.stringify(texts),
  )
  assert.ok(
    texts.some((t) => t.includes('flowchart TD')),
    '错误状态保留原始 mermaid 源码：' + JSON.stringify(texts),
  )
  assert.ok(findButton(tree, '重试'), '失败卡片提供重试')
  void fx
})

// ══ 场景 3：流式块闭合稳定 → 消息未结束即挂载 ══
test('流式块内容稳定：data-streaming 仍在时即渲染（不等消息结束）', async () => {
  const env = makeEnv()
  global.window.mermaid = {
    initialize: () => {},
    render: async (id) => ({ svg: '<svg id="' + id + '"></svg>' }),
  }
  const fx = makeMermaidBlock(env.body, 'flowchart TD\n  A --> B', { streaming: true })
  instantiate(env)
  assert.equal(isMounted(fx), false, '刚出现（未确认稳定）时不挂载')
  await sleep(150)
  assert.equal(isMounted(fx), false, '稳定窗口未到时仍不挂载')
  for (const obs of env.observers) obs.trigger()
  await sleep(700)
  assert.equal(fx.row.getAttribute('data-streaming'), '1', '消息仍在流式（data-streaming 未移除）')
  assert.ok(isMounted(fx), '内容稳定后在流式过程中即挂载卡片')
})

// ══ 场景 4：流式块内容持续变化 → 不渲染残缺中间态 ══
test('流式块内容持续变化：不挂载，稳定后才渲染', async () => {
  const env = makeEnv()
  global.window.mermaid = {
    initialize: () => {},
    render: async (id) => ({ svg: '<svg id="' + id + '"></svg>' }),
  }
  const fx = makeMermaidBlock(env.body, 'flowchart TD', { streaming: true })
  instantiate(env)
  for (const chunk of ['\n  A --> B', '\n  B --> C', '\n  C --> D']) {
    await sleep(200)
    fx.code.textContent += chunk
    for (const obs of env.observers) obs.trigger()
    assert.equal(isMounted(fx), false, '内容仍在增长时不挂载：' + JSON.stringify(chunk))
  }
  await sleep(800)
  assert.ok(isMounted(fx), '内容停止增长（围栏闭合）后才挂载')
  assert.ok(fx.code.textContent.includes('C --> D'), '卡片用的是完整源码')
})

// ══ 场景 5：已挂载后内容继续变化 → 自愈卸载 ══
test('挂载后源码继续变化：卡片自愈卸载并恢复原始代码块', async () => {
  const env = makeEnv()
  global.window.mermaid = {
    initialize: () => {},
    render: async (id) => ({ svg: '<svg id="' + id + '"></svg>' }),
  }
  const fx = makeMermaidBlock(env.body, 'flowchart TD\n  A --> B', { streaming: true })
  instantiate(env)
  await sleep(700)
  assert.ok(isMounted(fx), '先正常挂载')
  // 误判场景：流式仍在写同一个块（内容继续增长）
  fx.code.textContent += '\n  B --> C'
  for (const obs of env.observers) obs.trigger()
  await sleep(30)
  assert.equal(isMounted(fx), false, '内容变化后卡片被卸载（不留残缺失败卡片）')
  assert.equal(fx.pre.style.display, '', '原始 pre 恢复可见')
  assert.ok(env.roots[0].unmounted, 'React root 已卸载')
  await sleep(900)
  assert.ok(isMounted(fx), '内容再次稳定后重新渲染')
})

// ══ 场景 6：不回归 —— 非流式块 0 延迟、流式结束后立即挂载 ══
test('不回归：非流式块立即挂载；data-streaming 移除后立即挂载', async () => {
  const env = makeEnv()
  global.window.mermaid = {
    initialize: () => {},
    render: async (id) => ({ svg: '<svg id="' + id + '"></svg>' }),
  }
  const history = makeMermaidBlock(env.body, 'sequenceDiagram\n  A->>B: hi')
  const live = makeMermaidBlock(env.body, 'graph TD\n  X --> Y', { streaming: true })
  instantiate(env)
  assert.ok(isMounted(history), '历史（非流式）块同步挂载，无额外延迟')
  assert.equal(isMounted(live), false, '流式块未确认稳定时不挂载')
  live.row.removeAttribute('data-streaming') // 消息流式结束
  for (const obs of env.observers) obs.trigger()
  assert.ok(isMounted(live), '流式结束后立即挂载（兜底路径不变）')
})
