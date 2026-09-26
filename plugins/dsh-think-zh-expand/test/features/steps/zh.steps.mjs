/**
 * Step definitions for dsh-think-zh-expand Gherkin acceptance tests.
 * Covers the server half (system-prompt section injection) and the client
 * half (localization pure functions + markdown table rendering), mirroring
 * host-smoke.mjs and client-render.mjs.
 */
import { Given, When, Then, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentProfile, extractConfig, patchFileOf } from 'dsh-shared'
import { apply, CONFIG_ROUTE_PREFIX, PROMPT_TEXT } from '../../../lib/index.js'
import { createHostCtx } from '../../helpers/host-ctx.mjs'

class World {
  constructor() {
    this.sections = []
    this.exportsObj = null
    this.renderer = null
    this.lastRender = null
    this.platformCalls = []
  }

  bootServer() {
    // 真实契约宿主桩（helpers/host-ctx.mjs）：无 webServer 时 section 注入仍须生效
    const host = createHostCtx({ webServer: 'never' })
    apply(host.ctx)
    this.host = host
    this.sections = host.sections
  }

  /**
   * 加载 client bundle 并 materialize 本插件 factory。
   *
   * @param {{ platform?: 'ok' | 'throw', platformShape?: 'function' | 'memo' }} [opts]
   *   platform 控制宿主 staticModules 的官方组件是否可用（官方组件 / <pre> 两级），
   *   platformShape='memo' 复刻真实宿主 MarkdownText 的 React.memo 对象形态。
   *   issue #428：不再有 dsh-md-render 参数——产物已无跨插件取值。
   */
  loadClient({ platform = 'throw', platformShape = 'function' } = {}) {
    const stubbed = {
      createElement(type, props, ...children) {
        return { type, props: { ...(props || {}), children: children.flat() } }
      },
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }
    // issue #428：只加载本插件产物（不再跨 bundle require dsh-md-render）。
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

    eval(fs.readFileSync(new URL('../../../lib/client.js', import.meta.url), 'utf8'))
    assert.equal(registrations.length, 1, 'only the think-zh-expand bundle is loaded')
    const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
    assert.ok(thinkReg, 'think-zh-expand bundle registered')
    const platformCalls = this.platformCalls
    const markdownTextRender = (props) => {
      platformCalls.push(props)
      return { type: 'div', props: { 'data-ui': 'markdown-text', children: [props.text] } }
    }
    // 真实宿主（0.1.5-rc.1）的 MarkdownText 是 React.memo 返回的**对象**
    // （object($$typeof,type,compare)），不是函数——可用性判定必须按 React 语义。
    const uiPrimitives = {
      MarkdownText:
        platformShape === 'memo'
          ? { $$typeof: Symbol.for('react.memo'), type: markdownTextRender, compare: null }
          : markdownTextRender,
    }
    const exportsObj = thinkReg.factory((spec) => {
      if (spec === 'react') return stubbed
      if (spec === 'dsh-md-render') throw new Error('cross-plugin require removed (issue #428)')
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
      } else if (typeof node.type?.type === 'function') {
        // React.memo 对象（真实宿主 MarkdownText 形态）：React 渲染时调用 type.type
        walk(node.type.type(node.props))
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
  // issue #383：设置页保存场景用临时 DSH_HOME 落盘，用例结束恢复并清理（真实 ~/.dsh 不触碰）
  if (this.home !== undefined) {
    if (this.previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = this.previousHome
    rmSync(this.home, { recursive: true, force: true })
  }
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

// issue #428：官方 baseline 组件可用 / 缺失 / memo 形态（只剩两级回退）
Given('官方组件可用时渲染器已注册', async function () {
  this.loadClient({ platform: 'ok' })
  this.registerRenderer()
})

Given('官方组件缺失时渲染器已注册', async function () {
  this.loadClient({ platform: 'throw' })
  this.registerRenderer()
})

// 真实宿主 MarkdownText 是 React.memo 对象（不是函数）——可用性判定必须按 React 语义
Given('官方组件为 memo 对象时渲染器已注册', async function () {
  this.loadClient({ platform: 'ok', platformShape: 'memo' })
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
  // issue #299/#428：回退逻辑收口在共享件（构建期注入），但跨插件取渲染器那一级
  // 已被显式旁路（external 指向平台 seed 模块 + 不存在的导出名）。
  assert.ok(bundleSrc.includes('function installMarkdownViewFallback('), 'shared fallback part injected')
  assert.ok(!bundleSrc.includes("require('dsh-md-render')"), 'no cross-plugin require (issue #428)')
  assert.ok(bundleSrc.includes('external: PLATFORM_PRIMITIVES'), 'external kernel slot points at the platform module')
  assert.ok(
    bundleSrc.includes("externalExport: 'externalRendererDisabled'"),
    'shared fallback part external-kernel level bypassed (never matches)',
  )
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
})

Then('输出回退为带 fallback 标记的 pre', async function () {
  const nodes = this.lastRender.nodes
  assert.ok(
    nodes.some((n) => n.type === 'pre' && n.props['data-dsh-think-zh-expand-fallback'] === 'true'),
    `expected <pre data-dsh-think-zh-expand-fallback>, got tags: ${this.lastRender.tags.join(',')}`,
  )
})

// ── issue #383：宿主设置面板（设置 → 插件 → 思考增强）─────────────────────
// 设置页保存 → PUT 配置端点 → 写回 profile patch（行 id think-zh-expand）并热生效。
// 落盘一律写临时 DSH_HOME（见上述 After 钩子）。

/** 最小响应桩（记录 status / body）。 */
function settingsResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(payload) {
      this.body = payload ?? ''
    },
  }
}

/** 最小请求桩：本机 host + 可异步迭代的 JSON body。 */
function settingsRequest(method, body) {
  return {
    method,
    url: `${CONFIG_ROUTE_PREFIX}/config`,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield JSON.stringify(body)
    },
  }
}

Given('思考增强插件已带配置路由启动', async function () {
  this.home = mkdtempSync(join(tmpdir(), 'dsh-think-zh-expand-cucumber-'))
  this.previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = this.home
  const host = createHostCtx({ webServer: 'ready' })
  apply(host.ctx)
  await host.settle()
  this.host = host
  this.routes = host.routes
  assert.equal(this.routes.length, 1, '配置路由恰好注册一次（ctx.inject 局部等待服务就绪）')
  this.api = this.routes[0]
  this.patchFile = patchFileOf(currentProfile())
})

// 回归场景：webServer 晚于本插件就绪（旧实现用 ctx.get 一次性取值 + 无重试 → 永久 404）
Given('思考增强插件在 webServer 就绪前启动', async function () {
  this.host = createHostCtx({ webServer: 'late' })
  apply(this.host.ctx)
  await this.host.settle()
  assert.equal(this.host.routes.length, 0, '服务未就绪时不注册（也不抛错）')
})

When('webServer 服务就绪', async function () {
  this.host.provideWebServer()
  await this.host.settle()
})

Then('配置路由注册为 {string}', function (path) {
  assert.equal(this.host.routes.length, 1, '服务就绪后恰好注册一条路由')
  assert.equal(this.host.routes[0].kind, 'prefix', 'prefix 路由')
  assert.equal(this.host.routes[0].path, path, '路由前缀与 client 端契约一致')
})

When('通过配置接口保存 defaultExpanded 为 {word}', async function (raw) {
  const response = settingsResponse()
  await this.api.handler(settingsRequest('PUT', { defaultExpanded: raw === 'true' }), response)
  assert.equal(response.status, 200, '保存成功，响应体：' + response.body)
})

Then('配置接口返回生效值 {word}', async function (raw) {
  const response = settingsResponse()
  await this.api.handler(settingsRequest('GET'), response)
  assert.equal(response.status, 200, 'GET 配置成功')
  const value = JSON.parse(response.body).value
  assert.deepEqual(value, { defaultExpanded: raw === 'true' }, '保存即生效（无需等 patch 热重载）')
})

Then('profile patch 中行 {string} 的 defaultExpanded 为 {word}', async function (rowId, raw) {
  const text = fs.readFileSync(this.patchFile, 'utf8')
  assert.deepEqual(extractConfig(text, rowId), { defaultExpanded: raw === 'true' }, 'patch 内容：\n' + text)
})

Then('profile patch 中行 {string} 恰好一条', async function (rowId) {
  const text = fs.readFileSync(this.patchFile, 'utf8')
  assert.equal(text.split(`- id: ${rowId}`).length - 1, 1, '不产生幽灵行，patch 内容：\n' + text)
})
