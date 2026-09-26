/**
 * dsh-my-observability — client 端「原生侧边栏扩展点」契约测试（issue #187 批 1）。
 *
 * 迁移前本插件的 client 端**零测试覆盖**（12 个测试无一加载 lib/client.js），
 * 迁移前先补上这层契约（issue #187 批 1 风险点 4）：
 *
 *  1. 构建产物 lib/client.js 可被 __ModuleLoader__ 加载、只 require react；
 *  2. 两个页面类型（资源监控 / Git 工具）经宿主原生
 *     `ctx.sidebarRightTabs.register` 注册，id 用包名 + 面板名、guide.order 40/41；
 *  3. 每个类型在 `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`
 *     两个 keyed 席位各注册一次（key = 类型 id）；
 *  4. 面板适配层把原生 props 传给面板组件：资源面板在页签可见时轮询
 *     `/observability/api/resources`、隐藏（visible=false）时**不发请求**。
 *
 * 轨迹回放面板已移除（官方 ui-trajectory 覆盖同一能力）：断言 tab 类型里
 * 不再有 `dsh-my-observability:replay`，防它被重新挂回去。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const BUNDLE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ── 最小 react 桩 ─────────────────────────────────────────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let hookStates = []
let hookCursor = 0
let effects = []
const reactStub = {
  createElement,
  useState: (initial) => {
    const index = hookCursor
    hookCursor += 1
    if (!(index in hookStates)) hookStates[index] = typeof initial === 'function' ? initial() : initial
    return [
      hookStates[index],
      (next) => {
        hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next
      },
    ]
  },
  useEffect: (fn) => {
    effects.push(fn)
    return fn()
  },
}

function setNavigator(language) {
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
}

/** 加载产物 bundle（__ModuleLoader__ 格式），返回 factory 的 exports 与 fetch 调用记录。 */
function loadBundle() {
  hookStates = []
  hookCursor = 0
  effects = []
  const fetchCalls = []
  let registered = null
  const windowMock = {
    __ModuleLoader__: {
      load: (def) => {
        registered = def
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  globalThis.window = windowMock
  // 记录请求路径：资源面板可见性 → 是否轮询的唯一可观测面（setInterval 被桩掉）。
  globalThis.fetch = (url) => {
    fetchCalls.push(url)
    return Promise.resolve({ ok: true, json: async () => ({ value: undefined }) })
  }
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  new Function('window', BUNDLE)(windowMock)
  assert.ok(registered, 'bundle 必须调用 window.__ModuleLoader__.load 注册自己')
  assert.equal(registered.id, 'dsh-my-observability')
  const exports = registered.factory((spec) => {
    assert.equal(spec, 'react', 'client bundle 只允许 require react')
    return reactStub
  })
  return { exports, fetchCalls }
}

/** 构造宿主原生扩展点 mock ctx，记录类型与席位注册。 */
function createNativeCtx() {
  const state = { types: [], seats: [], labels: [] }
  const ctx = {
    effect(fn, label) {
      state.labels.push(label)
      return fn()
    },
    slots: {
      inject: (name, factory) => factory(),
      register(descriptor, component) {
        state.seats.push({ descriptor, component })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register(definition) {
        state.types.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, state }
}

// 本插件有两个独立面板：原生 id 必须全局唯一且是 body/title 席位的 key，
// 一个 key 只能注册一个席位 —— 因此每个 kind 用自己的 id，两个面板才能并存。
const RESOURCE_ID = 'dsh-my-observability:resources'
const GIT_ID = 'dsh-my-observability:git'
const REMOVED_REPLAY_ID = 'dsh-my-observability:replay'

test('client 端 inject 声明宿主原生服务名（不再消费第三方侧边栏服务）', () => {
  const { exports: exportsObj } = loadBundle()
  assert.deepEqual(exportsObj.inject, ['slots', 'sidebarRightTabs'])
  assert.equal(typeof exportsObj.apply, 'function')
})

test('原生页签类型：resources(40) 与 git(41) 两个类型，轨迹回放页签已移除', () => {
  const { exports: exportsObj } = loadBundle()
  const { ctx, state } = createNativeCtx()
  setNavigator('zh-CN')
  exportsObj.apply(ctx)

  assert.deepEqual(
    state.types.map((type) => ({
      id: type.id,
      kind: type.kind,
      title: type.title('dsh-resource://sidebar/x'),
      guide: type.guide.map((entry) => ({ order: entry.order, title: entry.title() })),
    })),
    [
      {
        id: RESOURCE_ID,
        kind: RESOURCE_ID,
        title: '资源监控',
        guide: [{ order: 40, title: '资源监控' }],
      },
      {
        id: GIT_ID,
        kind: GIT_ID,
        title: 'Git 工具',
        guide: [{ order: 41, title: 'Git 工具' }],
      },
    ],
  )
  assert.deepEqual(
    state.types.map((type) => type.id).filter((id) => id === REMOVED_REPLAY_ID),
    [],
    '轨迹回放页签必须已移除（官方 ui-trajectory 覆盖同一能力）',
  )
  setNavigator('en-US')
  assert.deepEqual(
    state.types.map((type) => type.title('dsh-resource://sidebar/x')),
    ['Resources', 'Git Tools'],
    '标题惰性求值，跟随语言',
  )
})

test('两个类型各有 body + title 两个 keyed 席位（key = 类型 id），effect 标签锁定', () => {
  const { exports: exportsObj } = loadBundle()
  const { ctx, state } = createNativeCtx()
  exportsObj.apply(ctx)

  // 每个类型 id 各注册一个 body + 一个 title 席位（key = 类型 id）
  assert.deepEqual(
    state.seats.map((seat) => seat.descriptor),
    [
      { name: 'sidebar.right.pane.tab', key: RESOURCE_ID },
      { name: 'sidebar.right.pane.tab.title', key: RESOURCE_ID },
      { name: 'sidebar.right.pane.tab', key: GIT_ID },
      { name: 'sidebar.right.pane.tab.title', key: GIT_ID },
    ],
  )
  assert.deepEqual(state.labels, [
    'dsh-my-observability: styles',
    'dsh-my-observability: resources tab',
    'dsh-my-observability: resources tab body',
    'dsh-my-observability: resources tab title',
    'dsh-my-observability: git tab',
    'dsh-my-observability: git tab body',
    'dsh-my-observability: git tab title',
  ])
})

test('面板适配层：每个 body 席位渲染自己的面板（原生 props 不破坏面板契约）', () => {
  const { exports: exportsObj } = loadBundle()
  const { ctx, state } = createNativeCtx()
  exportsObj.apply(ctx)

  const bodies = state.seats.filter((seat) => seat.descriptor.name === 'sidebar.right.pane.tab')
  assert.deepEqual(
    bodies.map((seat) => seat.descriptor.key),
    [RESOURCE_ID, GIT_ID],
  )
  for (const [key, panel] of [
    [RESOURCE_ID, 'ResourcePanel'],
    [GIT_ID, 'GitPanel'],
  ]) {
    hookCursor = 0
    hookStates = []
    const seat = bodies.find((candidate) => candidate.descriptor.key === key)
    const element = seat.component({
      sessionId: 'sess-1',
      useTabInfo: () => ({ tab: { id: 'tab-1', title: 'x', visible: true } }),
    })
    assert.ok(element, `${key} 的 body 必须产出元素`)
    assert.equal(typeof element.type, 'function')
    assert.equal(element.type.name, panel, `${key} 的 body 必须渲染 ${panel}`)
  }
})

test('资源面板可见性：visible=true 轮询 /resources，visible=false 暂停（零请求）', () => {
  const visible = loadBundle()
  const visibleCtx = createNativeCtx()
  visible.exports.apply(visibleCtx.ctx)
  const visibleBody = visibleCtx.state.seats.find(
    (seat) => seat.descriptor.name === 'sidebar.right.pane.tab' && seat.descriptor.key === RESOURCE_ID,
  )
  hookCursor = 0
  hookStates = []
  visibleBody.component({ useTabInfo: () => ({ tab: { id: 'tab-1', visible: true } }) })
  assert.deepEqual(visible.fetchCalls, ['/observability/api/resources'], '可见时拉取资源采样')

  const hidden = loadBundle()
  const hiddenCtx = createNativeCtx()
  hidden.exports.apply(hiddenCtx.ctx)
  const hiddenBody = hiddenCtx.state.seats.find(
    (seat) => seat.descriptor.name === 'sidebar.right.pane.tab' && seat.descriptor.key === RESOURCE_ID,
  )
  hookCursor = 0
  hookStates = []
  const element = hiddenBody.component({ useTabInfo: () => ({ tab: { id: 'tab-1', visible: false } }) })
  assert.deepEqual(hidden.fetchCalls, [], 'visible=false 时必须暂停轮询')
  assert.ok(element, '隐藏时仍渲染面板（只是不轮询）')
})
