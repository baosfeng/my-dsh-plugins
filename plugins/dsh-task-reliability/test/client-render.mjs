/**
 * Client render-path test: loads the client bundle with a self-contained
 * createElement stub (zero dependencies, platform-independent), registers
 * the sidebar tab through a mocked betterSidebar service, then invokes the
 * panel component directly to verify the element tree builds without errors
 * and renders the mode switches / task list / pending questions structure.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── self-contained createElement stub（零依赖，跨平台）────────────────────
function createElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children } }
}

const hookValues = new Map()
let hookIndex = 0
const stubbed = {
  createElement,
  useState: (initial) => {
    const idx = hookIndex
    hookIndex += 1
    if (!hookValues.has(idx)) {
      const value = typeof initial === 'function' ? initial() : initial
      hookValues.set(idx, [value, () => {}])
    }
    return hookValues.get(idx)
  },
  useEffect: () => {},
}

function loadBundle() {
  hookIndex = 0
  let registered = null
  global.window = {
    __ModuleLoader__: {
      load: (registration) => {
        registered = registration
      },
    },
  }
  Object.defineProperty(global, 'navigator', { value: { language: 'en-US' }, configurable: true })
  eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
  assert.ok(registered, 'bundle registered')
  assert.equal(registered.id, 'dsh-task-reliability')
  const exportsObj = registered.factory((spec) => {
    if (spec === 'react') return stubbed
    throw new Error('unexpected require: ' + spec)
  })
  assert.equal(typeof exportsObj.apply, 'function')
  return exportsObj
}

test('client bundle registers sidebar tab and renders panel structure', () => {
  hookValues.clear()
  const exportsObj = loadBundle()

  // ── mock betterSidebar service + context ──────────────────────────────
  let capturedTab = null
  const mockService = {
    registerTab: (descriptor) => {
      capturedTab = descriptor
      return () => {}
    },
  }
  const ctx = {
    betterSidebar: mockService,
    effect: (fn) => fn(),
    // 严格模拟 cordis 的 ctx.get(name, strict = true)：服务提供者 fiber 未
    // active 时 strict 取法返回 undefined、strict=false 才返回服务对象。
    // 防回归（首屏时序）：侧边栏 tab 注册不得依赖 betterSidebar 提供者已 active。
    get(name, strict = true) {
      if (name === 'betterSidebar') return strict ? undefined : mockService
      return undefined
    },
  }
  exportsObj.apply(ctx)
  assert.ok(capturedTab, 'tab registered')
  assert.equal(capturedTab.id, 'task-reliability:panel')
  assert.equal(capturedTab.single, true)
  assert.ok(typeof capturedTab.title === 'function' && capturedTab.title() !== '')
  assert.equal(capturedTab.order, 70)

  // ── build the panel element ───────────────────────────────────────────
  const scope = { sessionId: 'sess-test' }
  const element = capturedTab.component({ ctx, scope, visible: true })
  assert.ok(element, 'component wired')

  // ── invoke the component directly (stubbed hooks) ─────────────────────
  const tree = element.type(element.props)
  assert.ok(tree, 'panel tree built')

  // Traverse the tree and collect all leaf texts (expanding function components).
  const texts = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    walk(node.props?.children)
  }
  walk(tree)

  const joined = texts.join('|')
  assert.ok(joined.includes('Reliability tracking'), 'tracking switch rendered')
  assert.ok(joined.includes('Completion verify'), 'verify switch rendered')
  assert.ok(joined.includes('Autopilot'), 'autopilot switch rendered')
  assert.ok(joined.includes('Active tasks'), 'tasks section title')
  assert.ok(joined.includes('No tasks'), 'empty tasks state')
  assert.ok(joined.includes('Pending questions'), 'questions section title')
  assert.ok(joined.includes('No pending questions'), 'empty questions state')
  assert.ok(joined.includes('Register task'), 'register form rendered')
})

test('apply without betterSidebar must not throw', () => {
  hookValues.clear()
  const exportsObj = loadBundle()
  let error = null
  try {
    exportsObj.apply({
      effect: () => () => {},
      get: () => undefined,
    })
  } catch (caught) {
    error = caught
  }
  assert.equal(error, null, 'apply without betterSidebar must not throw')
})

test('task status badge shows the correct label per status (regression: statusLabel(task))', () => {
  hookValues.clear()
  const exportsObj = loadBundle()

  let capturedTab = null
  const mockService = {
    registerTab: (descriptor) => {
      capturedTab = descriptor
      return () => {}
    },
  }
  const ctx = {
    betterSidebar: mockService,
    effect: (fn) => fn(),
    // 严格模拟 cordis 的 ctx.get(name, strict = true)：服务提供者 fiber 未
    // active 时 strict 取法返回 undefined、strict=false 才返回服务对象。
    // 防回归（首屏时序）：侧边栏 tab 注册不得依赖 betterSidebar 提供者已 active。
    get(name, strict = true) {
      if (name === 'betterSidebar') return strict ? undefined : mockService
      return undefined
    },
  }
  exportsObj.apply(ctx)
  assert.ok(capturedTab, 'tab registered')

  // 预置 tasks state（idx=1）：Panel 渲染时 useState 按 hookIndex 取 idx，
  // 命中预置的任务列表；其余 state（info/questions/loadError）由渲染默认创建。
  hookValues.set(1, [
    [
      { id: 't-active', description: 'a', status: 'active' },
      { id: 't-paused', description: 'b', status: 'paused' },
      { id: 't-done', description: 'c', status: 'done' },
    ],
    () => {},
  ])

  const element = capturedTab.component({ ctx, scope: { sessionId: 'sess-test' }, visible: true })
  const tree = element.type(element.props)

  const texts = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    walk(node.props?.children)
  }
  walk(tree)

  const joined = texts.join('|')
  assert.ok(joined.includes('Active'), 'active task badge label')
  assert.ok(joined.includes('Paused'), 'paused task badge label (regression)')
  assert.ok(joined.includes('Done'), 'done task badge label (regression)')
})

test('client bundle registers settings tab via slots and renders the config form (issue #27)', () => {
  hookValues.clear()
  const exportsObj = loadBundle()

  // ── mock slots service（官方扩展点）──────────────────────────────────
  let capturedTab = null
  const mockSlots = {
    register: (descriptor, component) => ({ ...descriptor, component }),
    inject: (name, register) => {
      capturedTab = register()
      return () => {}
    },
  }
  const ctx = {
    effect: (fn) => fn(),
    // 严格模拟 cordis 的 ctx.get(name, strict = true)：服务提供者 fiber 未
    // active 时 strict 取法返回 undefined、strict=false 才返回服务对象。
    // 防回归（首屏时序）：设置页 tab 注册不得依赖 slots 提供者已 active。
    get(name, strict = true) {
      if (name === 'slots') return strict ? undefined : mockSlots
      return undefined
    },
  }
  exportsObj.apply(ctx)
  assert.ok(capturedTab, 'settings tab registered')
  assert.equal(capturedTab.id, 'task-reliability-settings')
  assert.ok(typeof capturedTab.label === 'function' && capturedTab.label() !== '')

  // ── 预置 state：loading=false，config/draft 有值 → 渲染表单 ──────────
  const configValue = {
    apiToken: 'tok',
    retryMax: 5,
    maxLoop: 10,
    maxVerify: 2,
    retryableCodes: ['TIMEOUT', 'SERVER'],
    retryBaseMs: 2000,
    autopilot: true,
    steerCooldownMs: 5000,
    saveDebounceMs: 300,
    resumeGraceMs: 1000,
    rateMaxActions: 20,
    askTimeoutMs: 900000,
    autopilotGraceMs: 15000,
    watchdogIntervalMs: 120000,
    stallTimeoutMs: 300000,
    rescueOnTruncation: true,
    rescueMaxPerSession: 2,
    rescueCooldownMs: 30000,
  }
  hookValues.set(0, [configValue, () => {}])
  hookValues.set(1, [{ ...configValue, retryableCodesText: 'TIMEOUT, SERVER' }, () => {}])
  hookValues.set(2, [false, () => {}])
  hookValues.set(3, [false, () => {}])
  hookValues.set(4, [false, () => {}])

  const element = capturedTab.component({ ctx })
  const tree = element

  const texts = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    walk(node.props?.children)
  }
  walk(tree)

  const joined = texts.join('|')
  assert.ok(joined.includes('Max retries'), 'retryMax field rendered')
  assert.ok(joined.includes('Retryable codes'), 'retryableCodes field rendered')
  assert.ok(joined.includes('Max continues per task'), 'maxLoop field rendered')
  assert.ok(joined.includes('Max verifies'), 'maxVerify field rendered')
  assert.ok(joined.includes('Ask timeout (ms)'), 'askTimeoutMs field rendered (issue #34)')
  assert.ok(joined.includes('Stall watchdog'), 'watchdog section rendered (issue #34)')
  assert.ok(joined.includes('Watchdog interval (ms)'), 'watchdogIntervalMs field rendered (issue #34)')
  assert.ok(joined.includes('Stall threshold (ms)'), 'stallTimeoutMs field rendered (issue #34)')
  assert.ok(joined.includes('Autopilot (default on)'), 'autopilot switch rendered')
  assert.ok(joined.includes('Autopilot grace (ms)'), 'autopilotGraceMs field rendered (issue #79)')
  assert.ok(joined.includes('Remote trigger token'), 'apiToken field rendered')
  assert.ok(joined.includes('Truncation rescue'), 'rescue section rendered (issue #147)')
  assert.ok(joined.includes('Auto-complete truncated output'), 'rescueOnTruncation switch rendered (issue #147)')
  assert.ok(joined.includes('Max rescues per session'), 'rescueMaxPerSession field rendered (issue #147)')
  assert.ok(joined.includes('Rescue cooldown (ms)'), 'rescueCooldownMs field rendered (issue #147)')
  assert.ok(joined.includes('Save'), 'save button rendered')
})
