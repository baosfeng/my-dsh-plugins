/**
 * dsh-ts-example — client 端「原生侧边栏扩展点」契约测试（issue #187 批 1）。
 *
 * 迁移前：client 端通过第三方侧边栏服务的 `registerTab` 注册页签；
 * 迁移后：走宿主原生扩展点
 *   - `ctx.sidebarRightTabs.register({ id, kind, title, guide })` —— 注册页面类型；
 *   - `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name, key }, Body))`；
 *   - 同 key 的 `sidebar.right.pane.tab.title` 席位渲染页签标题。
 *
 * 本测试加载**已提交的构建产物** `lib/client.js`（`node --check` 之外的行为契约），
 * 用最小 react 桩驱动注册与渲染，锁定「不再消费第三方侧边栏服务」。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── 最小 react 桩 ─────────────────────────────────────────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let hookStates = []
let hookCursor = 0

/** navigator 在 Node 里是 getter-only，必须用 defineProperty 覆盖。 */
function setNavigator(language) {
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
}
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
  useEffect: () => undefined,
}

/** 加载产物 bundle（`__ModuleLoader__` 格式），返回 factory 的 exports。 */
function loadBundle() {
  hookStates = []
  hookCursor = 0
  let registered = null
  const windowMock = {
    __ModuleLoader__: {
      load: (def) => {
        registered = def
      },
    },
  }
  new Function('window', fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))(windowMock)
  assert.ok(registered, 'bundle 必须调用 window.__ModuleLoader__.load 注册自己')
  assert.equal(registered.id, 'dsh-ts-example')
  return registered.factory((spec) => {
    assert.equal(spec, 'react', 'client bundle 只允许 require react')
    return reactStub
  })
}

/** 构造原生扩展点 mock：记录页签类型注册与两个席位注册。 */
function createNativeCtx() {
  const state = { types: [], seats: [], effects: [], injects: [] }
  const mockSlots = {
    inject(name, factory) {
      state.injects.push(name)
      return factory()
    },
    register(descriptor, component) {
      state.seats.push({ descriptor, component })
      return () => {}
    },
  }
  const mockTabs = {
    register(definition) {
      state.types.push(definition)
      return () => {}
    },
  }
  const ctx = {
    effect(fn, label) {
      state.effects.push(label)
      return fn()
    },
  }
  return { ctx, state, mockSlots, mockTabs }
}

/** 展开 React 元素树（调用函数式组件），返回扁平节点列表。 */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  // 函数式组件：调用它并递归展开**其返回节点**（render 属性本身可能是元素、
  // 数组或原始值，不能再用 node.props.children）。
  const el = typeof node.type === 'function' ? node.type(node.props) : node
  if (el === null || el === undefined) return out
  if (typeof el !== 'object') return out
  if (Array.isArray(el)) {
    for (const child of el) collect(child, out)
    return out
  }
  if (typeof el.type === 'function') {
    collect(el, out)
    return out
  }
  out.push(el)
  collect(el.props?.children, out)
  return out
}

test('client 端消费宿主原生扩展点：inject 声明 slots + sidebarRightTabs，注册页签类型与两个席位', () => {
  const exportsObj = loadBundle()
  assert.deepEqual(
    exportsObj.inject,
    ['slots', 'sidebarRightTabs'],
    'inject 必须声明原生服务名（不再有第三方侧边栏服务）',
  )
  assert.equal(typeof exportsObj.apply, 'function')
})

test('原生页签类型：id/kind 用包名与页面 kind，guide 保留原 order(90)，标题惰性求值', () => {
  const exportsObj = loadBundle()
  const { ctx, state, mockSlots, mockTabs } = createNativeCtx()
  ctx.slots = mockSlots
  ctx.sidebarRightTabs = mockTabs
  setNavigator('zh-CN')

  exportsObj.apply(ctx)

  assert.equal(state.types.length, 1, '注册一个页签类型')
  const type = state.types[0]
  assert.equal(type.id, 'dsh-ts-example', 'id 用包名（宿主原生惯例，全局唯一）')
  assert.equal(type.kind, 'dsh-ts-example:greeting', 'kind 保留原 better-sidebar tab id')
  assert.equal(typeof type.title, 'function', 'title 必须惰性求值')
  assert.equal(type.title('dsh-resource://sidebar/dsh-ts-example:greeting'), 'TS 示例')
  assert.deepEqual(
    type.guide.map((entry) => ({ order: entry.order, title: entry.title() })),
    [{ order: 90, title: 'TS 示例' }],
    'guide.order 沿用原 better-sidebar 的 order(90)，保证相对顺序',
  )
  // guide 条目 `id` 是宿主必填字段：缺了它 → 注册不报错，但宿主把 `entryId: undefined`
  // 传给 `sidebar.right.tab.guide.entry` 席位，且同类型多条目的重复检测失效（静默降级）。
  assert.equal(
    typeof type.guide[0].id === 'string' && type.guide[0].id !== '',
    true,
    'guide 条目必须有非空 id（宿主 SidebarRightGuideEntry 必填字段）',
  )

  // 两个 keyed 席位：body + title，key 都是类型注册的 id
  assert.deepEqual(state.injects, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  assert.deepEqual(
    state.seats.map((seat) => ({ name: seat.descriptor.name, key: seat.descriptor.key })),
    [
      { name: 'sidebar.right.pane.tab', key: 'dsh-ts-example' },
      { name: 'sidebar.right.pane.tab.title', key: 'dsh-ts-example' },
    ],
  )
  assert.deepEqual(state.effects, [
    'dsh-ts-example: tab',
    'dsh-ts-example: greeting tab body',
    'dsh-ts-example: greeting tab title',
  ])
})

test('面板内容渲染：原生 props(useTabInfo + sessionId) 适配后仍由 GreetingPanel 出内容', () => {
  const exportsObj = loadBundle()
  const { ctx, state, mockSlots, mockTabs } = createNativeCtx()
  ctx.slots = mockSlots
  ctx.sidebarRightTabs = mockTabs
  exportsObj.apply(ctx)

  const body = state.seats.find((seat) => seat.descriptor.name === 'sidebar.right.pane.tab')
  const props = {
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { id: 'tab-1', title: 'TS 示例', visible: true } }),
  }
  const nodes = collect(reactStub.createElement(body.component, props))
  const texts = nodes.flatMap((el) => {
    const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
    return kids.filter((child) => typeof child === 'string')
  })
  assert.ok(texts.includes('TS 示例插件'), '面板标题渲染')
  assert.ok(texts.includes('加载中…'), '首屏 loading 文案渲染')
})

test('.title 席位：渲染页签标题文本并跟随语言', () => {
  const exportsObj = loadBundle()
  const { ctx, state, mockSlots, mockTabs } = createNativeCtx()
  ctx.slots = mockSlots
  ctx.sidebarRightTabs = mockTabs
  exportsObj.apply(ctx)

  const titleSeat = state.seats.find((seat) => seat.descriptor.name === 'sidebar.right.pane.tab.title')
  hookCursor = 0
  hookStates = []
  setNavigator('zh-CN')
  const nodes = collect(
    reactStub.createElement(titleSeat.component, {
      sessionId: 'sess-1',
      useTabInfo: () => ({ tab: { id: 'tab-1', title: 'TS 示例', visible: true } }),
    }),
  )
  const texts = nodes.flatMap((el) => {
    const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
    return kids.filter((child) => typeof child === 'string')
  })
  assert.ok(texts.includes('TS 示例'), '标题席位渲染标签文本')
})
