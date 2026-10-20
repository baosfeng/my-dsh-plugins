/**
 * Step definitions：dsh-md-render 的 Gherkin 验收（真增量注入点）。
 *
 * 契约基准 = **当前渲染层源码**（mdr 设计系统，见 src/client/parts/）：类名 / 属性 / 导出
 * 一律按源码，不再引用重构前那套自绘 DOM（`dsh-md-render-*` 类名、`data-dsh-md-render-text-view`、
 * 块内「查看原文」按钮、`CardBody` / `ZoomSeg` 等已删除导出）。
 *
 * 与 vitest 套件共用 test/support/fake-dom.mjs（假 DOM + bundle 加载器 + 真实 marked / hljs）：
 * 验收判据是**接线**——把哪个块的哪段文本交给自研渲染器、容器插在哪里、块视图状态是什么、
 * 原文是否保留、非目标内容是否一动不动。
 */
import { Given, When, Then, Before, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { waitFor } from '../../../../dsh-shared/test-kit/wait.mjs'
import { createLangIndex } from '../../../lib/lang-index.js'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeCodeBlock,
  makeContextPre,
  makeElement,
  makeRealHostCodeBlock,
} from '../../support/fake-dom.mjs'

// ── 当前 DOM 契约（类名 / 属性，全部来自 src/client/parts/）────────────────
/** 围栏块视图属性（code | markdown；source 时属性被移除 → 宿主原样）。 */
const VIEW_ATTR = 'data-mdr-view'
/** markdown 卡（卡片）/ 正文容器。 */
const MD_CARD = 'div.mdr-block-md'
const MD_BODY = 'div.mdr-md.mdr-block-body'
/** 代码卡 / 语言胶囊 / 无高亮时的源码容器。 */
const CODE_CARD = 'div.mdr-block'
const LANG_PILL = 'span.mdr-fence-pill'
/** 源码容器：hljs 未就绪 / 语言未知 → code.mdr-fence-text；高亮就绪 → code.mdr-fence-hl。 */
const CODE_TEXT = 'code.mdr-fence-text, code.mdr-fence-hl'
/** 「渲染为…」三态控件：容器 + 选项按钮（文案在 data-mdr-tip）。 */
const SWITCH = 'span.mdr-rm'
const SWITCH_BTN = 'button.mdr-rm-btn'
const SWITCH_TIPS = ['渲染为图表', '渲染为Markdown', '渲染为源码']
/** 图表卡片：host（块内）/ 卡片根（React 渲染）。 */
const MM_HOST = 'div.mdr-mm-host'
const MM_CARD = 'div.mdr-mm-card'
/** 上下文注入卡 / 正文。 */
const CTX_CARD = 'div.mdr-ctx'
const CTX_BODY = 'div.mdr-md.mdr-ctx-body'

setWorldConstructor(function World() {
  this.page = null
  this.loaded = null
  this.stack = null
  this.runtime = null
  this.scroll = null
  this.row = null
  this.block = null
  this.pre = null
  this.official = true
  this.langStub = null
  /** 插件 ctx（client 侧围栏语言索引的来源；缺省 = 只有 effect 的精简上下文）。 */
  this.ctx = null
  /** 图表卡片场景的 React 节点 / 缩放桩调用记录。 */
  this.card = null
  this.canvas = null
  this.scope = ''
  this.panzoomCalls = []
  this.panzoomFetches = []
})

Before(function () {
  this.scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  this.row = makeElement('div')
})

After(function () {
  // 清掉语言索引查询桩 / 缩放库 fetch 桩 / 未命中的重试定时器（场景之间不串味）。
  if (this.langStub !== null) this.langStub.restore()
  if (this.runtime !== null) this.runtime.teardown()
  if (this.loaded !== null) this.loaded.exports.teardownLangProbes()
  this.loaded = null
  this.runtime = null
})

/**
 * 按当前 world 组装页面并加载产物（官方组件在/不在由 this.official 决定）。
 * hooks = true → 用最小 hooks 渲染器（见 createHooksRuntime）：图表卡片的就绪态 / 失败态 /
 * 浮窗开关都是 React 状态，精简桩不重渲就观察不到。
 */
function boot(world, options = {}) {
  world.page = installGlobals(createPage(world.scroll))
  const runtime = options.hooks === true ? createHooksRuntime(world.page) : null
  const react = runtime === null ? createReactStub() : runtime.react
  const stack = world.official ? createRenderStack(world.page, react) : { reactDom: undefined, assets: null }
  world.stack = stack
  world.runtime = runtime
  world.loaded = loadBundle({
    page: world.page,
    react,
    reactDom: runtime === null ? stack.reactDom : runtime.reactDom,
  })
}

/** 等图表卡片进入指定渲染态（就绪 / 失败）：条件满足即返回，不用固定等待。 */
function waitCardState(world, state) {
  return waitFor(
    () => {
      const card = world.page.document.querySelector(MM_CARD)
      return card !== null && card.getAttribute('data-mdr-mm-state') === state
    },
    { message: '等待图表卡片进入「' + state + '」渲染态' },
  )
}

/** 块内三态控件的某个选项（图表 / Markdown / 源码）。 */
function switchOption(block, option) {
  return block.querySelector(SWITCH_BTN + '[data-mdr-option="' + option + '"]')
}

// ── 最小 hooks 渲染器（仅步骤夹具用）──────────────────────────────────────
// 真实浏览器里由 React 负责；假 DOM 没有 React，而图表卡片的「就绪 / 失败 / 浮窗开关」
// 都是 useState 状态 —— 不重渲就永远观察不到「点全屏 → showModal」「引擎失败 → 预览禁用」。
// 只实现本卡片用到的子集：
//  · 元素按渲染路径复用（等价 React 的 DOM 复用）：ref 拿到的节点跨渲染稳定，缩放实例因此
//    仍绑在页面里的同一个变换层上；
//  · effect 按依赖浅比较，变化才先清理再执行；effect 内部异常吞掉（假 DOM 缺
//    document.addEventListener 之类 API，属夹具限制，不代表被测行为）。
function createHooksRuntime(page) {
  const document = page.document
  const elements = new Map()
  const roots = []
  let current = null
  let pendingEffects = []
  let pendingRefs = []
  let rootSeq = 0

  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.flat() },
  })

  /** 依赖浅比较（无依赖数组 = 每次渲染都执行）。 */
  function sameDeps(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return false
    if (prev.length !== next.length) return false
    for (let i = 0; i < next.length; i += 1) if (prev[i] !== next[i]) return false
    return true
  }

  function useState(initial) {
    const inst = current
    const index = inst.index
    inst.index += 1
    if (inst.state[index] === undefined) {
      inst.state[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = inst.state[index]
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (value === slot.value) return
      slot.value = value
      rerender(inst.root)
    }
    return [slot.value, set]
  }

  function useEffect(fn, deps) {
    const inst = current
    const index = inst.index
    inst.index += 1
    pendingEffects.push({ inst, index, fn, deps })
  }

  /** 假 DOM 的 <dialog> 没有 `open` 属性（真实浏览器 showModal 会置 true）：补齐后再交给被测代码。 */
  function patchDialog(el) {
    if (el.tagName !== 'DIALOG' || el._dialogPatched === true) return el
    el._dialogPatched = true
    const show = el.showModal
    const close = el.close
    el.showModal = function showModal() {
      show.call(this)
      this.open = true
    }
    el.close = function closeDialog() {
      close.call(this)
      this.open = false
    }
    return el
  }

  /** 按渲染路径复用元素（清空属性 / 子节点 / 监听器，由本次渲染重建）。 */
  function elementAt(path, tag) {
    const cached = elements.get(path)
    if (cached !== undefined && cached.tagName === String(tag).toUpperCase()) {
      cached._nodes = []
      cached._attrs = {}
      cached._listeners = {}
      cached.hidden = false
      cached.style = {}
      return patchDialog(cached)
    }
    const el = patchDialog(document.createElement(tag))
    elements.set(path, el)
    return el
  }

  function instanceAt(root, path) {
    const existing = root.instances.get(path)
    if (existing !== undefined) return existing
    const inst = { root, state: [], effects: [], index: 0 }
    root.instances.set(path, inst)
    return inst
  }

  function createDom(node, path, root) {
    if (node === null || node === undefined || node === true || node === false) return null
    if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
    if (Array.isArray(node)) {
      const frag = document.createDocumentFragment()
      for (let i = 0; i < node.length; i += 1) {
        const child = createDom(node[i], path + '.' + i, root)
        if (child) frag.appendChild(child)
      }
      return frag
    }
    if (typeof node.type === 'function') {
      const inst = instanceAt(root, path)
      const parent = current
      current = inst
      inst.index = 0
      let out
      try {
        out = node.type(node.props)
      } finally {
        current = parent
      }
      return createDom(out, path + '/', root)
    }
    if (typeof node.type !== 'string') return null
    const el = elementAt(path, node.type)
    const props = node.props || {}
    for (const key of Object.keys(props)) {
      const value = props[key]
      // dangerouslySetInnerHTML 在假 DOM 里无法落地（无 innerHTML）：图表 SVG 的内容由用例夹具提供
      if (key === 'children' || key === 'key' || key === 'ref' || key === 'dangerouslySetInnerHTML') continue
      if (value === undefined || value === null || value === false) continue
      if (key === 'className') el.className = value
      else if (key === 'style') el.style = value
      else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
        el._listeners[key.slice(2).toLowerCase()] = [value]
      } else el.setAttribute(key, String(value))
    }
    const children = props.children || []
    for (let i = 0; i < children.length; i += 1) {
      const child = createDom(children[i], path + '.' + i, root)
      if (child) el.appendChild(child)
    }
    if (typeof props.ref === 'function') pendingRefs.push(() => props.ref(el))
    return el
  }

  function runRefs() {
    const list = pendingRefs
    pendingRefs = []
    for (const ref of list) ref()
  }

  function runEffects() {
    const list = pendingEffects
    pendingEffects = []
    for (const item of list) {
      const slot =
        item.inst.effects[item.index] || (item.inst.effects[item.index] = { deps: undefined, cleanup: undefined })
      if (sameDeps(slot.deps, item.deps)) continue
      if (typeof slot.cleanup === 'function') {
        try {
          slot.cleanup()
        } catch (_e) {
          /* 夹具缺 API（如 document.addEventListener）不阻断渲染 */
        }
      }
      slot.deps = item.deps
      try {
        const cleanup = item.fn()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      } catch (_e) {
        slot.cleanup = undefined
      }
    }
  }

  /** 重渲：清空容器 → 重建（元素按路径复用）→ 执行 ref / effect；状态更新会再来一轮。 */
  function rerender(root) {
    if (root.rendering) {
      root.dirty = true
      return
    }
    root.rendering = true
    try {
      let guard = 0
      do {
        root.dirty = false
        pendingEffects = []
        pendingRefs = []
        root.container._nodes = []
        const dom = createDom(root.node, root.key, root)
        if (dom) root.container.appendChild(dom)
        runRefs()
        runEffects()
        guard += 1
      } while (root.dirty && guard < 25)
    } finally {
      root.rendering = false
    }
  }

  function createRoot(container) {
    rootSeq += 1
    const root = {
      key: 'root' + String(rootSeq),
      container,
      node: null,
      instances: new Map(),
      rendering: false,
      dirty: false,
    }
    roots.push(root)
    return {
      render(node) {
        root.node = node
        rerender(root)
      },
      unmount() {
        for (const inst of root.instances.values()) {
          for (const slot of inst.effects) {
            if (slot === undefined || typeof slot.cleanup !== 'function') continue
            try {
              slot.cleanup()
            } catch (_e) {
              /* 夹具缺 API 同上 */
            }
          }
        }
        root.instances.clear()
        container._nodes = []
      },
    }
  }

  return {
    react: { createElement, useState, useEffect },
    reactDom: { createRoot },
    teardown() {
      for (const root of roots) {
        for (const inst of root.instances.values()) inst.effects = []
      }
      elements.clear()
    },
  }
}

// ── panzoom 桩（记录构造与全部调用；断言「懒加载 + 作用在卡片自有变换层上」）────

function panzoomStub(calls) {
  function Panzoom(element, options) {
    const api = {
      element,
      options,
      scale: 1,
      zoom: (scale, opts) => {
        calls.push(['zoom', scale, opts])
        api.scale = scale
        return scale
      },
      pan: (x, y, opts) => {
        calls.push(['pan', x, y, opts])
        return { x, y }
      },
      reset: (opts) => {
        calls.push(['reset', opts])
        api.scale = 1
        return { x: 0, y: 0 }
      },
      getScale: () => api.scale,
      setOptions: () => {},
      destroy: () => calls.push(['destroy', api]),
    }
    calls.push(['new', element, options, api])
    return api
  }
  return Panzoom
}

/**
 * 缩放库的懒加载桩（与生产同一契约：fetch → 注入 <script> → 复读 window.Panzoom）。
 * 只有真正 fetch 到 panzoom 资产时才把构造器挂上 window —— 这样「懒」是可断言的。
 * fetches 只记 panzoom 的请求（配置等其它 fetch 不算「缩放库被取」）。
 */
function installPanzoomFetchStub(pageWindow, calls, fetches) {
  const original = globalThis.fetch
  globalThis.fetch = (url) => {
    const href = String(url)
    if (href.includes('panzoom')) {
      fetches.push(href)
      pageWindow.Panzoom = panzoomStub(calls)
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('/* panzoom UMD */') })
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
  }
  return {
    fetches,
    restore() {
      if (original === undefined) delete globalThis.fetch
      else globalThis.fetch = original
    },
  }
}

// ── 基本注入点 ─────────────────────────────────────────────────────────

Given('会话里有语言标记为 {word} 的围栏块，内容是一段 markdown', function (lang) {
  this.block = makeCodeBlock({ lang, code: '## 标题\n\n- 一\n- 二' })
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('宿主把上下文注入正文渲染为纯文本块', function () {
  this.pre = makeContextPre('## 子 agent 回传\n\n要点 **加粗**')
  this.row.appendChild(this.pre)
  this.scroll.appendChild(this.row)
  boot(this)
})

Given('会话里有语言标记为 {word} 的围栏块', function (lang) {
  this.block = makeCodeBlock({ lang, code: 'const a = 1' })
  this.scroll.appendChild(this.block)
})

/**
 * 真实宿主 DOM 形态（issue #466）：banner 只有本地化标签「代码块」、`<code>` 无 language-*，
 * 语言只能从 host 半的语言索引（按块内容哈希）拿到。索引桩接的是 host 半**真实现**。
 */
Given('宿主 banner 只显示本地化标签「代码块」的 {word} 围栏块，且该围栏已登记进 host 语言索引', function (lang) {
  const code = '## 标题\n\n- 一\n- 二'
  this.block = makeRealHostCodeBlock({ code, label: '代码块' })
  this.scroll.appendChild(this.block)
  const index = createLangIndex()
  index.record(['```' + lang, code, '```'].join('\n'))
  boot(this)
  this.langStub = installLangFetchStub(index)
})

Given('平台官方渲染组件不可用', function () {
  this.official = false
  boot(this)
})

When('插件扫描会话 DOM', function () {
  if (this.loaded === null) boot(this)
  this.loaded.exports.apply(this.ctx ?? { effect: (fn) => fn() })
})

/** 扫描 + 让出事件循环一次（冲刷语言索引查询与本插件随后的重扫），再断言。 */
When('插件扫描会话 DOM 并等待语言索引查询完成', async function () {
  if (this.loaded === null) boot(this)
  this.loaded.exports.apply({ effect: (fn) => fn() })
  await new Promise((resolve) => setTimeout(resolve, 0)) // 让出事件循环（非固定等待）
})

When('点击该块的切换按钮', function () {
  const btn = switchOption(this.block, 'source')
  assert.ok(btn, '块内有「渲染为源码」入口')
  btn.fire('click')
})

// ── 合并后三个核心行为（思考默认展开 / mermaid 卡片 / 与 text 围栏分流）──────

Given('会话里有一条折叠的官方思考行', function () {
  const root = makeElement('div', { 'data-variant': 'think' })
  const row = makeElement('div', { 'data-disclosure-row': 'true', 'aria-expanded': 'false' })
  this.thinkClicks = 0
  // 官方折叠行的真实行为：点击 → 自身状态机展开（本插件只派发点击，不改外观）
  row.addEventListener('click', () => {
    this.thinkClicks += 1
    row.setAttribute('aria-expanded', 'true')
  })
  root.appendChild(row)
  this.scroll.appendChild(root)
  this.thinkRow = row
})

Given('会话里有一个 mermaid 图表代码块', function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n  A["提交订单 (v2)"] --> B[校验]', fiber: false })
  this.block.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话里同时有 text 与 mermaid 围栏块', function () {
  this.textBlock = makeCodeBlock({ lang: 'text', code: '## 标题' })
  this.mermaidBlock = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n  A --> B', fiber: false })
  this.mermaidBlock.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.textBlock)
  this.scroll.appendChild(this.mermaidBlock)
  boot(this)
})

Then('该思考行被展开', function () {
  assert.equal(this.thinkRow.getAttribute('aria-expanded'), 'true', '行已展开')
})

Then('该行只被点击一次（用户手动折叠后不再干预）', function () {
  assert.equal(this.thinkClicks, 1, '恰好派发一次点击')
  this.thinkRow.setAttribute('aria-expanded', 'false')
  this.loaded.exports.apply(this.ctx ?? { effect: (fn) => fn() })
  assert.equal(this.thinkClicks, 1, '已处理过的行不再派发（尊重用户手动折叠）')
})

Then('该块挂上图表卡片容器', function () {
  const host = this.block.querySelector(MM_HOST)
  assert.ok(host, '卡片 host 已挂上（div.mdr-mm-host）')
  assert.equal(this.block.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '块进入预览视图')
  assert.equal(host.getAttribute('data-dsh-md-render-mermaid-state'), 'loading', '卡片初始为渲染中')
  const card = host.querySelector(MM_CARD)
  assert.ok(card, '卡片组件已渲染（div.mdr-mm-card）')
  assert.equal(card.getAttribute('data-mdr-mm-view'), 'diagram', '卡片默认图表视图')
  assert.ok(card.getAttribute('data-mdr-mm'), '卡片带自有缩放作用域 id')
})

Then('官方代码块结构保持不变', function () {
  const pres = this.block.querySelectorAll('pre')
  // 卡片自带一份源码 <pre>（在 div.mdr-mm-host 里）；官方那份必须仍在原位、内容一字不改。
  const official = pres.filter((pre) => pre.closest(MM_HOST) === null)
  assert.equal(official.length, 1, '官方 pre 未被移除')
  assert.equal(
    official[0].querySelector('code').textContent,
    'flowchart TD\n  A["提交订单 (v2)"] --> B[校验]',
    '源码未改写',
  )
  const host = this.block.querySelector(MM_HOST)
  assert.ok(host, '卡片宿主仍在')
  assert.equal(host.querySelectorAll('pre').length, 1, '卡片有自己的源码视图（不搬动官方节点）')
})

Then('text 块只被 markdown 接管', function () {
  assert.ok(this.textBlock.querySelector(MD_CARD), 'text 块 markdown 化')
  assert.equal(this.textBlock.getAttribute(VIEW_ATTR), 'markdown', 'text 块视图 = markdown')
  assert.equal(this.textBlock.querySelector(MM_HOST), null, 'text 块无卡片 host')
})

Then('mermaid 块只被图表卡片接管', function () {
  assert.ok(this.mermaidBlock.querySelector(MM_HOST), 'mermaid 块挂卡片')
  assert.equal(this.mermaidBlock.querySelector(MD_CARD), null, 'mermaid 块未被 markdown 接管')
  assert.equal(this.mermaidBlock.getAttribute(VIEW_ATTR), null, 'mermaid 块没有 markdown / code 视图属性')
})

Then('该块内出现自研渲染的 markdown 卡', function () {
  const card = this.block.querySelector(MD_CARD)
  assert.ok(card, 'markdown 卡已追加到块内')
  const body = this.block.querySelector(MD_BODY)
  assert.ok(body, '卡片里有自研 markdown 正文容器（div.mdr-md.mdr-block-body）')
  assert.equal(this.block.getAttribute(VIEW_ATTR), 'markdown', '初始为 markdown 视图')
  assert.equal(body.querySelector('h2').textContent, '标题', '自研渲染产出真实 h2（官方组件不参与）')
  assert.equal(body.querySelectorAll('li').length, 2, '列表渲染为真 li')
})

Then('该块被按代码块接管（语言位留空）', function () {
  assert.equal(this.block.getAttribute(VIEW_ATTR), 'code', '代码视图')
  const card = this.block.querySelector(CODE_CARD)
  assert.ok(card, '自研代码卡已挂上（div.mdr-block）')
  assert.equal(card.querySelector(LANG_PILL).textContent, '', '语言无从确证时留空，不写「代码块」也不瞎猜')
  assert.equal(this.block.querySelector(MD_CARD), null, '不是 markdown 卡')
})

Then('该块带「查看原文」三态控件', function () {
  const control = this.block.querySelector(SWITCH)
  assert.ok(control, '「渲染为…」三态控件已挂上（卡片底栏）')
  assert.equal(control.getAttribute('aria-label'), '渲染为', '分段组的可读名')
  assert.deepEqual(
    this.block.querySelectorAll(SWITCH_BTN).map((btn) => btn.getAttribute('data-mdr-tip')),
    SWITCH_TIPS,
    '三个选项：图表 / Markdown / 源码',
  )
  assert.equal(switchOption(this.block, 'source').getAttribute('data-mdr-tip'), '渲染为源码', '还原原文的入口')
})

Then('该块进入原文视图', function () {
  assert.equal(this.block.getAttribute(VIEW_ATTR), null, '源码视图下移除视图属性（宿主原样）')
  assert.equal(this.block.querySelectorAll(MD_CARD).length, 0, '自研卡已拆干净')
  assert.equal(this.block.querySelectorAll('pre').length, 1, '官方 pre 原样保留（唯一一份）')
  assert.equal(switchOption(this.block, 'source').getAttribute('aria-pressed'), 'true', '块内三态回到「源码」态')
})

Then('该纯文本块旁出现自研渲染的上下文卡片', function () {
  const card = this.row.querySelector(CTX_CARD)
  assert.ok(card, '上下文注入卡已插入（div.mdr-ctx）')
  const body = card.querySelector(CTX_BODY)
  assert.ok(body, '卡片正文是自研 markdown 容器（div.mdr-md.mdr-ctx-body）')
  assert.equal(this.pre.previousElementSibling, card, '卡片插在原文之前')
  assert.equal(body.querySelector('h2').textContent, '子 agent 回传', '自研渲染产出真实 h2')
  assert.equal(body.querySelector('strong').textContent, '加粗', '加粗渲染为真 strong')
  assert.ok(card.querySelector('div.mdr-ctx-head').textContent.includes('上下文注入'), '标注头如实说明来源')
})

Then('原文纯文本块被隐藏', function () {
  assert.equal(this.pre.hidden, true, '原文置 hidden')
  assert.equal(this.pre.getAttribute('data-mdr-context-hidden'), 'true', '原文带自有隐藏标记')
  assert.equal(this.pre.textContent, '## 子 agent 回传\n\n要点 **加粗**', '原文内容未改写')
})

Then('没有任何块被接管', function () {
  assert.equal(this.block.querySelector(CODE_CARD), null, '目标语言之外的块不接管')
  assert.equal(this.block.getAttribute(VIEW_ATTR), null, '无视图属性')
  assert.equal(this.block.getAttribute('data-mdr-lang-switch'), null, '也没有块内三态控件')
  assert.equal(this.scroll.querySelectorAll(CODE_CARD).length, 0, '没有任何自研卡')
  assert.equal(this.scroll.querySelectorAll(MM_HOST).length, 0, '也没有图表卡片')
})

// ── client 侧围栏语言索引：会话事件流（含历史）───────────────────────────
// 判据是**接线**：语言来自 ctx.sessions.binding(id).eventSource 的原始 Session 事件，
// 按「规范化代码内容哈希 + 文档序 FIFO」映射回 DOM 块；DOM 只给本地化标签「代码块」、
// host 实时索引为空（冷启动 / 历史会话）时也能接管；无语言 / 有歧义一律退回官方形态。
// R1（真实 cordis 4.0.4 实测）：ctx.get('sessions', false) **无需 inject**，inject 保持 []。

/** 宿主 0.2.0-rc.2 对 shiki 不认识的语言显示的本地化标签（banner 文本）。 */
const HOST_LABEL = '代码块'
const FENCE = '```'
const FENCE_BODY = '## 标题\n\n- 一\n- 二'
/** 确证无语言但**内容明显是代码**的围栏（真实会话里最常见的形态：Kotlin / Compose 片段）。 */
const KOTLIN_FENCE_BODY = [
  'private const val GRID_COLUMNS = 6',
  '',
  '@Composable',
  'fun PhotoGrid(modifier: Modifier = Modifier) {',
  '  Row(modifier = modifier) {',
  '    repeat(GRID_COLUMNS) { index ->',
  '      PhotoTile(index = index)',
  '    }',
  '  }',
  '}',
].join('\n')

/** 围栏 markdown（lang 为空 = 无语言围栏）。 */
function fenceMarkdown(lang, body) {
  return [lang === '' ? FENCE : FENCE + lang, body, FENCE].join('\n')
}

/** 造一条 durable 事件条目（surfaceOp = append）。 */
function messageEntry(seq, markdown) {
  return {
    type: 'event',
    event: {
      seq,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: markdown }] } },
    },
  }
}

/** 假会话服务 + 插件 ctx（ctx.get('sessions', false)；**不声明 inject**）。 */
function sessionCtx(entries) {
  const eventSource = { getSnapshot: () => ({ entries, hasMore: false, revision: 1 }) }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
    binding: (id) => (id === 's1' ? { sessionId: 's1', eventSource } : undefined),
  }
  return { effect: (fn) => fn(), get: (name) => (name === 'sessions' ? sessions : undefined) }
}

/** 造一个「0.2.0-rc.2 契约」的代码块：banner 只有本地化标签，<code> 无 language-*。 */
function hostBlock(code) {
  return makeRealHostCodeBlock({ code, label: HOST_LABEL })
}

Given('会话事件流里有语言标记为 {word} 的围栏块，内容是一段 markdown', function (lang) {
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown(lang, FENCE_BODY))])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话事件流里有语言标记为 {word} 的围栏块', function (lang) {
  const source = 'flowchart TD\n  A --> B'
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown(lang, source))])
  this.block = hostBlock(source)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('宿主 DOM 里的该代码块在 0.2.0-rc.2 契约下没有任何语言标记', function () {
  assert.equal(this.block.querySelector('code').className, '', 'code 不带 language-*')
  assert.equal(
    this.block.querySelector('[data-code-block-banner]').firstElementChild.textContent,
    HOST_LABEL,
    'banner 只有本地化标签「代码块」',
  )
})

Given('会话事件流里的围栏块没有语言标记，内容是一篇 markdown 文档', function () {
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown('', FENCE_BODY))])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话事件流里的围栏块没有语言标记，内容是一段 Kotlin 代码', function () {
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown('', KOTLIN_FENCE_BODY))])
  this.block = hostBlock(KOTLIN_FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话事件流里同一段内容既是 text 又是 mermaid 围栏', function () {
  this.ctx = sessionCtx([
    messageEntry(1, fenceMarkdown('text', FENCE_BODY)),
    messageEntry(2, fenceMarkdown('mermaid', FENCE_BODY)),
  ])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话 DOM 里该内容只有一块', function () {
  assert.equal(this.scroll.querySelectorAll('div.md-code-block').length, 1, '夹具只有一块（候选数 2 ≠ 块数 1）')
})

Given('会话事件流不可用', function () {
  this.ctx = { effect: (fn) => fn() } // 无 ctx.get → 空表 → 退回 DOM 契约读法
})

Given('会话里有一个代码块在 DOM 上带有语言标记 text', function () {
  this.block = makeCodeBlock({ lang: 'text', code: FENCE_BODY })
  this.scroll.appendChild(this.block)
  boot(this)
})

// ── 需求 3：确证无语言 → 看内容分流（markdown 文档 vs 代码）─────────────────

Then('该块被按 markdown 兜底渲染', function () {
  const card = this.block.querySelector(MD_CARD)
  assert.ok(card, '确证无语言 + 内容明显是 markdown 文档 → 按 markdown 卡渲染')
  assert.equal(this.block.getAttribute(VIEW_ATTR), 'markdown', '初始 markdown 视图')
  assert.equal(card.querySelector('h2').textContent, '标题', '自研渲染产出真实 h2')
})

Then('该块被按代码卡渲染（视图 code、语言用推断值）', function () {
  assert.equal(this.block.getAttribute(VIEW_ATTR), 'code', '块进入代码视图')
  const card = this.block.querySelector(CODE_CARD)
  assert.ok(card, '自研代码卡已挂上')
  assert.equal(card.querySelector(LANG_PILL).textContent.toLowerCase(), 'kotlin', '内容识别出 Kotlin（推断值）')
  assert.equal(this.block.getAttribute('data-mdr-lang-inferred'), 'content', '推断语言带标识（不冒充原文标注）')
  assert.equal(this.block.querySelector(MD_CARD), null, '不是 markdown 卡（代码结构不能被软换行吃掉）')
})

Then('该块源码保留换行', function () {
  const code = this.block.querySelector(CODE_TEXT)
  assert.ok(code, '代码卡用等宽源码容器（纯文本或高亮态）')
  assert.equal(code.textContent, KOTLIN_FENCE_BODY, '源码一字不少、缩进与换行原样')
  assert.ok(code.textContent.split('\n').length > 1, '多行代码不被折叠成一行')
})

Then('该块不挂图表卡片', function () {
  assert.equal(this.block.querySelector(MM_HOST), null, '绝不误伤为图表卡片')
})

Given('宿主 DOM 里有一个只显示本地化标签「代码块」的围栏块', function () {
  this.block = hostBlock('真纯文本，但语言无从确证')
  this.scroll.appendChild(this.block)
  boot(this)
})

// ── 需求 2：失败态源码为主、错误提示降为一行灰字、保留重试、预览禁用 ────────
// 卡片状态机由 React 状态驱动（就绪 / 失败），因此这里用最小 hooks 渲染器真正走一遍
// 「引擎失败 → 失败态」的渲染，再按当前契约断言 DOM。
// 注：当前实现失败时只把「预览」按钮置 disabled，视图状态仍停在 diagram（aria-pressed /
// is-active 仍为真）——「不显示为激活假象」还差一步（已作为 src 跟进点上报）；
// 本场景按**现有真实契约**断言，不伪造通过。

const MM_FAIL_SOURCE = 'flowchart TD\n A --> B'

Given('一个 mermaid 卡片在渲染失败状态下完成渲染', async function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: MM_FAIL_SOURCE, fiber: false })
  this.block.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.block)
  boot(this, { hooks: true })
  // 引擎桩：渲染直接失败（真实可恢复场景：源码语法错 / 引擎加载失败）
  this.page.window.mermaid = {
    initialize() {},
    render: () => Promise.reject(new Error('Syntax error in text')),
  }
  this.loaded.exports.apply({ effect: (fn) => fn() })
  await waitCardState(this, 'error')
})

When('查看卡片主体与工具条', function () {
  this.card = this.page.document.querySelector(MM_CARD)
  assert.ok(this.card, '图表卡片已挂载')
  assert.equal(this.card.getAttribute('data-mdr-mm-state'), 'error', '卡片进入失败态')
})

Then('卡片主体的第一个节点是源码 <pre>', function () {
  const errorBox = this.card.querySelector('div.mdr-mm-error')
  assert.ok(errorBox, '失败态容器已渲染')
  const first = errorBox.children[0]
  assert.equal(first.tagName, 'PRE', '第一个节点就是源码 <pre>')
  assert.ok(String(first.className).includes('mdr-mm-error-src'), '源码容器带失败态类名')
  assert.equal(first.textContent, MM_FAIL_SOURCE, '首屏即源码（内容一字不丢）')
})

Then('失败原因只占一行灰字提示', function () {
  const errorBox = this.card.querySelector('div.mdr-mm-error')
  assert.equal(errorBox.children.length, 2, '失败态只剩「源码 + 一行提示」两个节点')
  const msg = errorBox.children[1]
  assert.ok(String(msg.className).includes('mdr-mm-error-msg'), '提示行用灰字类名')
  assert.ok(msg.textContent.includes('Syntax error in text'), '保留失败原因原文')
  assert.ok(msg.textContent.includes('渲染失败'), '仍有可读前缀')
  for (const gone of ['div.mdr-mm-error-title', 'div.mdr-mm-error-head', 'div.mdr-mm-error-line']) {
    assert.equal(this.card.querySelector(gone), null, '不再有红底加粗标题：' + gone)
  }
})

Then('保留「重试」按钮', function () {
  const retry = this.card.querySelector('button.mdr-mm-retry')
  assert.ok(retry, '重试按钮仍在（引擎加载失败是真实可恢复场景）')
  assert.equal(retry.getAttribute('data-mdr-tip'), '重试渲染', '浮层文案')
})

Then('失败态下预览按钮被禁用（不假装可预览）', function () {
  const toolbar = this.card.querySelector('div.mdr-mm-toolbar')
  assert.ok(toolbar, '工具条已渲染')
  const preview = toolbar.querySelectorAll('button').find((btn) => btn.getAttribute('data-mdr-tip') === '预览')
  assert.ok(preview, '工具条里有预览按钮')
  assert.equal(preview.getAttribute('disabled'), 'true', '失败态禁用预览')
})

// ── 需求 4：语言手动切换（用户显式意图 != 猜语言）─────────────────────────

Then('该块带三选一的「渲染为…」控件', function () {
  assert.ok(this.block.querySelector(CODE_CARD), '代码卡已挂（控件在卡片底栏）')
  assert.ok(this.block.querySelector(SWITCH), '控件已注入')
  assert.deepEqual(
    this.block.querySelectorAll(SWITCH_BTN).map((btn) => btn.getAttribute('data-mdr-tip')),
    SWITCH_TIPS,
    '三个选项',
  )
})

When('点击该控件的「{word}」', function (label) {
  const btn = this.block
    .querySelectorAll(SWITCH_BTN)
    .find((item) => item.getAttribute('data-mdr-tip') === '渲染为' + label)
  assert.ok(btn, '控件里有「' + label + '」')
  btn.fire('click')
})

Then('该块被按 markdown 渲染', function () {
  assert.ok(this.block.querySelector(MD_CARD), '已 markdown 化')
  assert.equal(this.block.getAttribute(VIEW_ATTR), 'markdown', '块视图 = markdown')
})

Then('该块还原为官方代码块', function () {
  assert.equal(this.block.querySelector(MD_CARD), null, '自研卡已拆干净')
  assert.equal(this.block.getAttribute(VIEW_ATTR), null, '视图属性被移除（宿主原样）')
  assert.equal(this.block.querySelectorAll('pre').length, 1, '官方 pre 仍在原位')
})

Then('覆盖值写在块的 data-dsh-md-render-lang-force 上（刷新后仍记得）', function () {
  assert.equal(this.block.getAttribute('data-dsh-md-render-lang-force'), 'source', '覆盖值在块属性上')
  const saved = this.page.window.sessionStorage.getItem('dsh-md-render:lang-force')
  assert.ok(String(saved).includes('source'), '并落会话存储（刷新后仍记得）')
})

Then('该块没有任何语言覆盖值', function () {
  assert.equal(this.loaded.exports.fenceForceOf(this.block), undefined, '没点过 = 没有任何覆盖')
  assert.equal(this.block.getAttribute('data-dsh-md-render-lang-force'), null, '块上也没有')
})

// ── 需求 1：图表全屏浮窗 + 缩放 / 平移 ───────────────────────────────
// 卡片默认视图 = 图表；「放大」在卡片工具条（只显示图标，按 aria-label 找），
// 全屏是卡片自带的原生 <dialog>（页面内模态，不用 Fullscreen API）。
// 注：**浮窗作用域自身**的缩放绑定当前失效（mermaid-zoom.ts 的 zoomTargetsOf 用
// root.querySelector('.mdr-mm-frame') 找裁剪容器，而浮窗作用域根自身就是该容器 →
// 取不到 → 绑定直接退出），已作为 src 跟进点上报；本场景只断言浮窗结构 + 卡片自身的
// 缩放绑定，不把浮窗内缩放写成「通过」。

Given('一个图表卡片已渲染出 SVG', async function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B', fiber: false })
  this.block.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.block)
  boot(this, { hooks: true })
  // 引擎桩：返回一段 SVG → 卡片进就绪态（可缩放 / 可全屏）
  this.page.window.mermaid = {
    initialize() {},
    render: () => Promise.resolve({ svg: '<svg viewBox="0 0 600 400"></svg>' }),
  }
  // 缩放库走真实懒加载通道：只有 fetch 到 panzoom 时才把构造器挂上 window
  this.panzoomCalls = []
  this.panzoomFetches = []
  this.langStub = installPanzoomFetchStub(this.page.window, this.panzoomCalls, this.panzoomFetches)
  this.loaded.exports.apply({ effect: (fn) => fn() })
  await waitCardState(this, 'ok')
  this.card = this.page.document.querySelector(MM_CARD)
  assert.ok(this.card, '图表卡片已挂载')
  assert.equal(this.card.getAttribute('data-mdr-mm-state'), 'ok', '卡片进入就绪态')
  this.scope = this.card.getAttribute('data-mdr-mm')
  this.canvas = this.card.querySelector('div.mdr-mm-canvas')
  assert.ok(this.canvas, '卡片自有 SVG 容器已渲染')
})

/** 点卡片工具条上的按钮（图标按钮：按 aria-label 找；data-mdr-tip 是完整提示文案）。 */
function clickToolbar(world, label) {
  const toolbar = world.card.querySelector('div.mdr-mm-toolbar')
  assert.ok(toolbar, '卡片工具条已渲染')
  const btn = toolbar.querySelectorAll('button').find((item) => item.getAttribute('aria-label') === label)
  assert.ok(btn, '工具条里有「' + label + '」')
  btn.fire('click')
}

When('点击「{word}」缩放', async function (label) {
  clickToolbar(this, label)
  await waitFor(() => this.panzoomCalls.some((call) => call[0] === 'zoom' && call[1] === 1.25), {
    message: '等待「放大」一档打到缩放引擎（100% → 125%）',
  })
})

Then('缩放库被懒加载并作用在该卡片自有的 SVG 容器上', function () {
  assert.equal(this.panzoomFetches.length, 1, '缩放库走懒加载，且只取一次')
  assert.ok(String(this.panzoomFetches[0]).includes('panzoom'), '取的是 vendored panzoom 资产')
  const made = this.panzoomCalls.filter((call) => call[0] === 'new' && call[1] === this.canvas)
  assert.equal(made.length, 1, '只绑一次（幂等）')
  const api = made[0][3]
  assert.equal(api.scale, 1.25, '「放大」一档打到引擎（100% → 125%）')
  assert.equal(this.loaded.exports.zoomStates.get(this.canvas).pz, api, '实例登记在该卡片自有的变换层上')
})

When('点击「全屏」', async function () {
  clickToolbar(this, '全屏')
  await waitFor(
    () => {
      const panel = this.page.document.querySelector('dialog.mdr-mm-dialog')
      return panel !== null && panel._open === true
    },
    { message: '等待浮窗面板以模态打开（showModal）' },
  )
})

Then('页面内出现自有浮窗面板（不用浏览器全屏）', function () {
  const panel = this.page.document.querySelector('dialog.mdr-mm-dialog')
  assert.ok(panel, '页面内出现自有浮窗面板（原生 <dialog>，不是浏览器全屏）')
  assert.equal(panel._open, true, '已 showModal（遮罩 / Esc / 焦点 / 滚动锁定由浏览器兜底）')
  const body = panel.querySelector('div.mdr-mm-dialog-body.mdr-mm-frame')
  assert.ok(body, '浮窗体是自有裁剪容器')
  assert.equal(body.getAttribute('data-mdr-mm-fs'), 'open', '浮窗体带浮窗态标记')
  assert.equal(body.getAttribute('data-mdr-mm'), this.scope + '-fs', '浮窗有独立缩放作用域')
  assert.ok(body.querySelector('div.mdr-mm-canvas'), '浮窗自带变换层')
  assert.equal(this.page.document.fullscreenElement, undefined, '全程不碰 Fullscreen API')
})

When('点击浮窗内的「关闭全屏」', async function () {
  const panel = this.page.document.querySelector('dialog.mdr-mm-dialog')
  const btn = panel.querySelectorAll('button').find((item) => item.getAttribute('aria-label') === '关闭全屏')
  assert.ok(btn, '浮窗里有「关闭全屏」按钮')
  btn.fire('click')
  await waitFor(
    () => {
      const panel = this.page.document.querySelector('dialog.mdr-mm-dialog')
      return panel !== null && panel._open !== true
    },
    { message: '等待浮窗面板关闭（原生 dialog close）' },
  )
})

Then('卡片还回原样且缩放状态保留', function () {
  const panel = this.page.document.querySelector('dialog.mdr-mm-dialog')
  assert.notEqual(panel._open, true, '浮窗已关闭')
  assert.equal(this.page.document.querySelector(MM_CARD), this.card, '卡片还在原位（同一节点，未重建）')
  assert.equal(this.block.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '块视图未变')
  const state = this.loaded.exports.zoomStates.get(this.canvas)
  assert.ok(state, '卡片缩放的绑定状态保留')
  assert.equal(
    this.panzoomCalls.filter((call) => call[0] === 'destroy' && call[1] === state.pz).length,
    0,
    '卡片缩放实例未被销毁（变换保留）',
  )
})
