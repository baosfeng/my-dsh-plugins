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
}

setWorldConstructor(World)

After(async function () {
  delete global.window
  delete global.document
  delete global.Element
  delete global.MutationObserver
  delete global.Node
  delete global.navigator
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
