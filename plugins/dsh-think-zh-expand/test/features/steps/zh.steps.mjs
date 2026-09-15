/**
 * Step definitions for dsh-think-zh-expand Gherkin acceptance tests.
 * Covers the server half (system-prompt section injection) and the client
 * half (localization pure functions + markdown table rendering), mirroring
 * host-smoke.mjs and client-render.mjs.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { apply, PROMPT_TEXT } from '../../../lib/index.js'

class World {
  constructor() {
    this.sections = []
    this.exportsObj = null
    this.renderer = null
    this.lastRender = null
    this.platformCalls = []
  }

  bootServer() {
    const sections = this.sections
    const ctx = {
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {}
        },
      },
    }
    apply(ctx)
  }

  /**
   * 加载 client bundle 并 materialize 本插件 factory。
   *
   * @param {{ withMdRender?: boolean, platform?: 'ok' | 'throw' }} [opts]
   *   withMdRender=false 模拟「未安装 dsh-md-render」（issue #293 场景），
   *   platform 控制宿主 staticModules 的官方组件是否可用（三级回退）。
   */
  loadClient({ withMdRender = true, platform = 'throw' } = {}) {
    const stubbed = {
      createElement(type, props, ...children) {
        return { type, props: { ...(props || {}), children: children.flat() } }
      },
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }
    // issue #31 渲染职责迁移：先加载 dsh-md-render（本插件跨 bundle
    // require 其 MarkdownView），再加载本插件。
    const registrations = []
    global.window = {
      __ModuleLoader__: {
        load: (registration) => {
          registrations.push(registration)
        },
      },
      location: { href: 'http://127.0.0.1:3080/app', search: '' },
      confirm: () => true,
      fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    }
    Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
    global.localStorage = { getItem: () => null, setItem: () => {} }
    global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })

    eval(fs.readFileSync(new URL('../../../../dsh-md-render/lib/client.js', import.meta.url), 'utf8'))
    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.equal(registrations.length, 2, 'two bundles registered')
    const mdRenderReg = registrations.find((r) => r.id === 'dsh-md-render')
    const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
    assert.ok(mdRenderReg, 'dsh-md-render bundle registered')
    assert.ok(thinkReg, 'think-zh-expand bundle registered')
    const mdRenderExports = withMdRender
      ? mdRenderReg.factory((spec) => {
          if (spec === 'react') return stubbed
          throw new Error('unexpected require: ' + spec)
        })
      : null
    const platformCalls = this.platformCalls
    const uiPrimitives = {
      MarkdownText: (props) => {
        platformCalls.push(props)
        return { type: 'div', props: { 'data-ui': 'markdown-text', children: [props.text] } }
      },
    }
    const exportsObj = thinkReg.factory((spec) => {
      if (spec === 'react') return stubbed
      if (spec === 'dsh-md-render') {
        if (!withMdRender) throw new Error("Cannot find module 'dsh-md-render'")
        return mdRenderExports
      }
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
        if (platform !== 'ok') throw new Error("Cannot find module '@deepseek-ai/dsh-client-ui-primitives'")
        return uiPrimitives
      }
      throw new Error('unexpected require: ' + spec)
    })
    this.exportsObj = exportsObj
  }

  registerRenderer() {
    let registerFn = null
    const world = this
    const ctx = {
      effect: (fn) => fn(),
      slots: {
        inject: (_name, fn) => {
          registerFn = fn
          return () => {}
        },
        register: (_desc, renderer) => {
          world.renderer = renderer
          return () => {}
        },
      },
    }
    this.exportsObj.apply(ctx)
    assert.equal(typeof registerFn, 'function', 'slots.inject callback captured')
    registerFn()
    assert.equal(typeof this.renderer, 'function', 'assistant-step renderer captured')
  }

  renderText(text) {
    const tree = this.renderer({ node: { data: { blocks: [{ kind: 'text', text }] } } })
    const tags = []
    const texts = []
    const nodes = []
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
      if (typeof node.type === 'string') {
        tags.push(node.type)
        nodes.push({ type: node.type, props })
      } else if (typeof node.type === 'function') {
        // plugin internal components (MarkdownView / ThinkBlock …): expand
        walk(node.type(node.props))
        return
      }
      walk(props.children)
    }
    walk(tree)
    this.lastRender = { tags, texts, nodes }
  }
}

setWorldConstructor(World)

After(async function () {
  delete global.window
  delete global.localStorage
})

// ── Given ─────────────────────────────────────────────────────────────────
Given('思考增强插件已启动', async function () {
  this.bootServer()
})

Given('客户端模块已加载', async function () {
  this.loadClient()
})

Given('渲染器已注册', async function () {
  this.loadClient()
  this.registerRenderer()
})

// issue #293 三级渲染回退：md-render 缺失 / 平台官方组件也缺失
Given('未装 dsh-md-render 但官方组件可用时渲染器已注册', async function () {
  this.loadClient({ withMdRender: false, platform: 'ok' })
  this.registerRenderer()
})

Given('未装 dsh-md-render 且官方组件也缺失时渲染器已注册', async function () {
  this.loadClient({ withMdRender: false, platform: 'throw' })
  this.registerRenderer()
})

// ── When ──────────────────────────────────────────────────────────────────
When('渲染含分隔行的文本块', async function () {
  this.renderText('| 插件 | 版本 |\n|:-----|:----:|\n| dsh-file-activity | **0.4.2** |')
})

When('渲染文本块 {string}', async function (text) {
  this.renderText(text)
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('注册了唯一的 system-prompt section', async function () {
  assert.equal(this.sections.length, 1)
})

Then('section 名为 {string} 且顺序为 {int}', async function (name, order) {
  const section = this.sections[0]
  assert.equal(section.name, name)
  assert.equal(section.order, order)
})

Then('section 文本要求思考与回复使用中文', async function () {
  const section = this.sections[0]
  assert.equal(section.text, PROMPT_TEXT)
  assert.ok(section.text.includes('思考'), 'covers thinking')
  assert.ok(section.text.includes('中文'), 'forces Chinese')
  assert.ok(section.text.includes('回复'), 'covers replies')
})

Then('section 文本覆盖关键场景与代码术语', async function () {
  const section = this.sections[0]
  assert.ok(section.text.includes('错误消息'), 'covers English error-message scenario')
  assert.ok(section.text.includes('不翻译'), 'keeps code/commands/paths untranslated')
  assert.ok(section.text.includes('最高优先级'), 'declares top priority over context')
})

Then('{string} 的卡片标题为 {string}', async function (title, expected) {
  assert.equal(this.exportsObj.zhCardTitle(title), expected)
})

Then('工具名 {string} 映射为 {string}', async function (name, expected) {
  assert.equal(this.exportsObj.zhToolName(name), expected)
})

Then('未覆盖的工具名 {string} 映射为空', async function (name) {
  assert.equal(this.exportsObj.zhToolName(name), null)
})

Then('输出包含 table 标签', async function () {
  assert.ok(this.lastRender.tags.includes('table'), `tags: ${this.lastRender.tags.join(',')}`)
})

Then('输出包含表头文本 {string}', async function (text) {
  assert.ok(this.lastRender.texts.includes(text), `texts: ${this.lastRender.texts.join(',')}`)
})

Then('输出包含数据文本 {string}', async function (text) {
  assert.ok(this.lastRender.texts.includes(text), `texts: ${this.lastRender.texts.join(',')}`)
})

Then('本插件不导出 MarkdownView 渲染组件', async function () {
  assert.equal(this.exportsObj.MarkdownView, undefined, 'MarkdownView not exported by think-zh-expand')
})

Then('本插件 bundle 不包含表格渲染逻辑', async function () {
  const bundleSrc = fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8')
  assert.ok(!bundleSrc.includes('function tryTable'), 'tryTable definition removed from bundle')
  assert.ok(!bundleSrc.includes('function MarkdownView'), 'MarkdownView definition removed from bundle')
  assert.ok(bundleSrc.includes("require('dsh-md-render')"), 'bundle requires dsh-md-render for rendering')
})

// ── issue #293：三级渲染回退 ───────────────────────────────────────────────
Then('输出由官方 MarkdownText 渲染', async function () {
  const nodes = this.lastRender.nodes
  assert.ok(
    nodes.some((n) => n.props['data-ui'] === 'markdown-text'),
    `expected official MarkdownText output, got tags: ${this.lastRender.tags.join(',')}`,
  )
})

Then('传给官方组件的 labels.code.copyLabel 为 {string}', async function (expected) {
  assert.ok(this.platformCalls.length >= 1, 'official MarkdownText received props')
  const props = this.platformCalls[0]
  assert.equal(props.labels?.code?.copyLabel, expected, 'labels.code.copyLabel (required, no default)')
  assert.equal(props.labels?.code?.copiedLabel, '已复制', 'labels.code.copiedLabel')
  assert.equal(props.labels?.footnotes, '脚注', 'labels.footnotes')
  assert.equal(props.codeLabels?.copyLabel, expected, 'legacy codeLabels.copyLabel (npm 0.0.1-rc.1)')
})

Then('输出回退为带 fallback 标记的 pre', async function () {
  const nodes = this.lastRender.nodes
  assert.ok(
    nodes.some((n) => n.type === 'pre' && n.props['data-dsh-think-zh-expand-fallback'] === 'true'),
    `expected <pre data-dsh-think-zh-expand-fallback>, got tags: ${this.lastRender.tags.join(',')}`,
  )
})
