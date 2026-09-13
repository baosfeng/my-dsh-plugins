/**
 * dsh-my-observability — client 端「原生侧边栏扩展点」契约测试（issue #187 批 1）。
 *
 * 迁移前本插件的 client 端**零测试覆盖**（12 个测试无一加载 lib/client.js），
 * 迁移前先补上这层契约（issue #187 批 1 风险点 4）：
 *
 *  1. 构建产物 lib/client.js 可被 __ModuleLoader__ 加载、只 require react；
 *  2. 两个页面类型（轨迹回放 / Git 工具）经宿主原生
 *     `ctx.sidebarRightTabs.register` 注册，id 用包名、kind 沿用迁移前的
 *     better-sidebar tab id、guide.order 沿用迁移前的 order(40/41)；
 *  3. 每个类型在 `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`
 *     两个 keyed 席位各注册一次（key = 类型 id）；
 *  4. 面板适配层把原生 props 传给面板组件（ReplayPanel 接 visible 等），
 *     且面板可见时仍按原契约轮询、隐藏时暂停。
 *
 * 迁移前这些断言全部失败（当时走第三方侧边栏服务的 registerTab）。
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

/** 加载产物 bundle（__ModuleLoader__ 格式），返回 factory 的 exports。 */
function loadBundle() {
  hookStates = []
  hookCursor = 0
  effects = []
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
  globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => ({ value: undefined }) })
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  new Function('window', BUNDLE)(windowMock)
  assert.ok(registered, 'bundle 必须调用 window.__ModuleLoader__.load 注册自己')
  assert.equal(registered.id, 'dsh-my-observability')
  return registered.factory((spec) => {
    assert.equal(spec, 'react', 'client bundle 只允许 require react')
    return reactStub
  })
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
// 一个 key 只能注册一个席位 —— 因此每个 kind 用自己的 id（= 迁移前
// better-sidebar 的 tab id），两个面板才能并存。
const REPLAY_ID = 'dsh-my-observability:replay'
const GIT_ID = 'dsh-my-observability:git'

test('client 端 inject 声明宿主原生服务名（不再消费第三方侧边栏服务）', () => {
  const exportsObj = loadBundle()
  assert.deepEqual(exportsObj.inject, ['slots', 'sidebarRightTabs'])
  assert.equal(typeof exportsObj.apply, 'function')
})

test('原生页签类型：replay(40) 与 git(41) 两个类型，id/kind 沿用迁移前 tab id', () => {
  const exportsObj = loadBundle()
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
        id: REPLAY_ID,
        kind: REPLAY_ID,
        title: '轨迹回放',
        guide: [{ order: 40, title: '轨迹回放' }],
      },
      {
        id: GIT_ID,
        kind: GIT_ID,
        title: 'Git 工具',
        guide: [{ order: 41, title: 'Git 工具' }],
      },
    ],
  )
  setNavigator('en-US')
  assert.deepEqual(
    state.types.map((type) => type.title('dsh-resource://sidebar/x')),
    ['Trajectory', 'Git Tools'],
    '标题惰性求值，跟随语言',
  )
})

test('两个类型各有 body + title 两个 keyed 席位（key = 类型 id），effect 标签锁定', () => {
  const exportsObj = loadBundle()
  const { ctx, state } = createNativeCtx()
  exportsObj.apply(ctx)

  // 每个类型 id 各注册一个 body + 一个 title 席位（key = 类型 id）
  assert.deepEqual(
    state.seats.map((seat) => seat.descriptor),
    [
      { name: 'sidebar.right.pane.tab', key: REPLAY_ID },
      { name: 'sidebar.right.pane.tab.title', key: REPLAY_ID },
      { name: 'sidebar.right.pane.tab', key: GIT_ID },
      { name: 'sidebar.right.pane.tab.title', key: GIT_ID },
    ],
  )
  assert.deepEqual(state.labels, [
    'dsh-my-observability: styles',
    'dsh-my-observability: replay tab',
    'dsh-my-observability: replay tab body',
    'dsh-my-observability: replay tab title',
    'dsh-my-observability: git tab',
    'dsh-my-observability: git tab body',
    'dsh-my-observability: git tab title',
  ])
})

test('面板适配层：每个 body 席位渲染自己的面板（原生 props 不破坏面板契约）', () => {
  const exportsObj = loadBundle()
  const { ctx, state } = createNativeCtx()
  exportsObj.apply(ctx)

  const bodies = state.seats.filter((seat) => seat.descriptor.name === 'sidebar.right.pane.tab')
  assert.deepEqual(
    bodies.map((seat) => seat.descriptor.key),
    [REPLAY_ID, GIT_ID],
  )
  for (const [key, panel] of [
    [REPLAY_ID, 'ReplayPanel'],
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

  // visible 语义：停靠页签未激活（visible=false）时适配层必须如实传给面板
  // （ReplayPanel 在 visible=false 时暂停轮询）。
  hookCursor = 0
  hookStates = []
  const hidden = bodies[0].component({
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { id: 'tab-1', title: 'x', visible: false } }),
  })
  assert.equal(hidden.props.visible, false, 'visible=false 如实透传')
})
