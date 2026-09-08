/**
 * 防回归测试（首屏 slots 时序）：设置页 tab 必须能在「slots 服务提供者
 * fiber 尚未 active」时注册成功；SSE 通知点击跳会话用的 sessions 服务
 * 同理。
 *
 * 背景：cordis 的 `ctx.get(name, strict = true)` 在 strict 模式下要求服务
 * 提供者 fiber 已 active（`if (strict && impl.fiber.state !== 2) return`），
 * 首屏加载时本插件 client 端 apply 早于服务提供者 fiber 变 active，strict
 * 取法拿到 undefined：
 *  - slots 缺失 → attachSettingsTab 静默 return，设置页「插件」里看不到
 *    「通知提醒」tab（HMR 重载后才出现，刷新又消失）；
 *  - sessions 缺失 → 点击通知只聚焦窗口、不跳转会话。
 *
 * 桩严格模拟 cordis 语义：strict 调用返回 undefined、strict=false 返回服务
 * 对象，断言两条链路都仍然工作。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── react stub（单子节点 / 数组子节点语义与 React 一致）─────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}
const stubbed = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

// ── 最小浏览器环境：覆盖 apply 的无条件样式注入与音频解锁监听 ───────────
const styleTags = []
function makeStyleEl() {
  return {
    textContent: '',
    attrs: {},
    parentNode: null,
    setAttribute(k, v) {
      this.attrs[k] = String(v)
    },
  }
}
const head = {
  appendChild(el) {
    el.parentNode = head
    styleTags.push(el)
  },
  removeChild(el) {
    el.parentNode = null
    const i = styleTags.indexOf(el)
    if (i >= 0) styleTags.splice(i, 1)
  },
}
global.document = {
  head,
  createElement: () => makeStyleEl(),
  addEventListener() {},
  removeEventListener() {},
}
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (reg) => {
      registered = reg
    },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

// ── load the built bundle ────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function')

/** 捕获设置页 tab 的 mock slots 服务。 */
function makeSlots() {
  const state = { tab: null }
  const slots = {
    inject: (name, register) => {
      if (name === 'settings.plugins.tab') state.tab = register()
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  return { slots, state }
}

/** 严格模拟 cordis ctx.get(name, strict = true)：提供者未 active 时 strict
 *  取法返回 undefined、strict=false 才返回服务对象（首屏时序防回归桩）。 */
function makeBootCtx(services) {
  return {
    effect: (fn) => fn(),
    get(name, strict = true) {
      const svc = services[name]
      if (svc === undefined) return undefined
      return strict ? undefined : svc
    },
  }
}

test('设置页 tab 在 slots 提供者 fiber 尚未 active 时也注册（首屏时序防回归）', () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  assert.ok(state.tab, 'settings tab registered while the slots provider fiber is not active yet')
  assert.equal(state.tab.options.id, 'notify-settings', 'settings tab id')
  assert.equal(typeof state.tab.component, 'function', 'settings tab component')
  assert.ok(
    styleTags.some((s) => s.attrs['data-dsh-my-notify-settings'] === 'styles'),
    'settings styles injected',
  )
})

test('点击系统通知跳会话：sessions 提供者未 active 时也取到服务（首屏时序防回归）', async () => {
  const opened = []
  const sessions = { open: (id) => opened.push(id) }
  const sources = []
  global.EventSource = class {
    constructor(url) {
      this.url = url
      sources.push(this)
    }
    close() {}
  }
  const notifications = []
  global.Notification = class {
    static permission = 'granted'
    constructor(title, opts) {
      this.title = title
      this.opts = opts
      notifications.push(this)
    }
    close() {}
  }
  try {
    const { slots } = makeSlots()
    exportsObj.apply(makeBootCtx({ slots, sessions }))
    assert.equal(sources.length, 1, 'SSE subscription established')

    sources[0].onmessage({
      data: JSON.stringify({ type: 'notice', kind: 'end', sessionId: 'sess-1', title: '会话已结束' }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(notifications.length, 1, 'system notification fired')
    notifications[0].onclick()
    assert.deepEqual(opened, ['sess-1'], 'clicking the notice opens the session (sessions service resolved)')
  } finally {
    delete global.EventSource
    delete global.Notification
  }
})
