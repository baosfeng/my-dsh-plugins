/**
 * dsh-file-activity — 右侧边栏默认宽度契约测试（issue #384）。
 *
 * 背景：宿主把右侧栏首次打开宽度硬编码为 45%（ui-layout/src/client/columns.ts
 * RIGHTBAR_DEFAULT_RATIO）且不持久化，也没有宽度 API（ctx.layout /
 * ctx.sidebarRight 都没有宽度面）。唯一可达通道是 ui-layout 注册到 'root' 席位时
 * 声明的 store 座位：entry.store.create() 返回的正是 AppFrame 订阅的同一实例
 * （框架自身也走 handle.create()）。
 *
 * 本套件按**真实契约形状**打桩（slots.entries('root') → 带 store.create() 的
 * entry；快照含 layoutInfo.rightbar / viewportWidth），钉住：
 *   1. 仅当 layoutInfo.rightbar === null 时应用 Math.round(viewport*ratio)；
 *   2. 非 null（用户本次运行拖过）绝不调用；
 *   3. 非法 / 越界比例回退默认 20%；
 *   4. 一切宿主契约不匹配（entry 缺失、store 是 factory、无 create、无
 *      setRightbar、create() 抛错、快照形状不符、slots 服务无 entries）都静默
 *      降级：不抛错、无 console.error/warn、插件其它功能照常注册；
 *   5. ctx.slots.subscribe('root', …) 触发后重新取实例，且订阅随 fiber 释放注销；
 *   6. 设置页签的百分比输入（默认 20，非法编辑不落盘）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const BUNDLE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ── react 桩（服务端渲染的极简 hook 槽）────────────────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}
let hookIndex = 0
const hookStore = []
const stubbedReact = {
  createElement,
  useState: (initial) => {
    const i = hookIndex++
    if (!hookStore[i]) hookStore[i] = [typeof initial === 'function' ? initial() : initial, () => {}]
    return hookStore[i]
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

// ── 浏览器环境桩 ───────────────────────────────────────────────────────
const storage = new Map()
const sessionStorageMap = new Map()
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
const sessionStorageStub = {
  getItem: (k) => (sessionStorageMap.has(k) ? sessionStorageMap.get(k) : null),
  setItem: (k, v) => sessionStorageMap.set(k, String(v)),
  removeItem: (k) => sessionStorageMap.delete(k),
}
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  // 宿主 frame 的测量来源：快照缺 viewportWidth 时才回落到它。
  innerWidth: 1920,
  localStorage: localStorageStub,
  sessionStorage: sessionStorageStub,
}
global.localStorage = localStorageStub
global.sessionStorage = sessionStorageStub
global.fetch = global.window.fetch
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.document = {
  head: { appendChild: () => {} },
  documentElement: { dataset: {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
}
const logs = { warn: [], error: [], debug: [] }
global.console = {
  ...console,
  warn: (...args) => logs.warn.push(args.join(' ')),
  error: (...args) => logs.error.push(args.join(' ')),
  debug: (...args) => logs.debug.push(args.join(' ')),
}

// ── 每次用例的洁净台面 ─────────────────────────────────────────────────
/** setRightbar 收到的 px（按调用顺序）。 */
let setRightbarCalls = []
/** 本插件注册过的席位（name + component）。 */
let registrations = []
/** ctx.effect 返回的 disposer。 */
let disposers = []
/** ctx.slots.entries('root') 的当前返回值。 */
let rootEntries = []
/** 本插件订阅过的 root 回调（active=false 表示已注销）。 */
let subs = []
/** 客户端 bundle 的 exports。 */
let client = null

/** 本用例的宿主当前快照——openTab 桩用它模拟宿主首开语义。 */
let liveLayoutState = null

function resetHarness() {
  setRightbarCalls = []
  registrations = []
  disposers = []
  rootEntries = []
  subs = []
  liveLayoutState = null
  hookIndex = 0
  hookStore.length = 0
  storage.clear()
  sessionStorageMap.clear()
  logs.warn.length = 0
  logs.error.length = 0
  logs.debug.length = 0
  global.window.innerWidth = 1920
  client = null
}

/** 加载构建产物并取出 exports（每次调用得到全新实例，模拟一次激活）。 */
function loadClient() {
  registered = null
  eval(BUNDLE)
  assert.ok(registered, 'client bundle 未注册到 __ModuleLoader__')
  return registered.factory((spec) => {
    if (spec === 'react') return stubbedReact
    throw new Error('unexpected require: ' + spec)
  })
}

/** 宿主 ui-layout 的快照形状（LayoutState）；viewportWidth 允许显式缺失。 */
function layoutState(options = {}) {
  const layoutInfo = { sidebar: 280, narrowExpanded: false, rightbarShown: false, rightbar: null }
  if ('rightbar' in options) layoutInfo.rightbar = options.rightbar
  // 「缺字段」用例必须真的不带该键，所以这里不用默认参数
  if ('viewportWidth' in options) {
    if (options.viewportWidth !== undefined) layoutInfo.viewportWidth = options.viewportWidth
  } else {
    layoutInfo.viewportWidth = 1920
  }
  return { panelInfo: { activePanelId: null }, layoutInfo }
}

/**
 * 宿主 root entry 的真实形状：注册时传的是 `{ ...handle, create: () => instance }`
 * ——store 是 handle（有 create()），create() 给出框架正在用的那一个实例。
 */
function layoutEntry({ state, withSetRightbar = true, createThrows = false, instance } = {}) {
  // 登记本用例的宿主快照：openTab 桩要按宿主首开语义（rightbar ??= 45%）改它。
  if (state) liveLayoutState = state
  const live = instance ?? {
    getSnapshot: () => state,
    actions: withSetRightbar
      ? {
          setRightbar: (px) => {
            setRightbarCalls.push(px)
            if (state?.layoutInfo) state.layoutInfo.rightbar = px
          },
        }
      : {},
  }
  return {
    options: { key: undefined },
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      main: { kind: 'keyed', scope: 'root' },
      rightbar: { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    store: {
      spec: { init: () => state },
      create: () => {
        if (createThrows) throw new Error('create exploded')
        return live
      },
    },
  }
}

/** 宿主 client ctx 的桩（只桩本插件消费的服务面）。 */
function makeCtx({ withEntries = true, withSubscribe = true, slotsOverride } = {}) {
  const slots = {
    inject: (slot, factory) => factory(),
    register: (options, component) => {
      registrations.push({ name: options.name, options, component })
      return () => {}
    },
  }
  if (withEntries) slots.entries = (key) => (key === 'root' ? rootEntries : [])
  if (withSubscribe) {
    slots.subscribe = (key, fn) => {
      const rec = { key, fn, active: true }
      subs.push(rec)
      return () => {
        rec.active = false
      }
    }
  }
  return {
    effect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    slots: slotsOverride ?? slots,
    sidebarRightTabs: { register: () => () => {} },
    documentPreviews: { register: () => () => {} },
    sidebarRight: {
      openTab: () => {
        // 宿主真实首开语义（stores.ts openRightbar）：rightbar ??= max(300, round(vw*0.45))。
        // 谁先写谁赢——本插件必须先落 20%，否则宿主 45% 会占位。
        const info = liveLayoutState && liveLayoutState.layoutInfo
        if (info && info.rightbar === null) {
          info.rightbar = Math.max(300, Math.round((info.viewportWidth || 0) * 0.45))
        }
      },
      openResource: () => {},
      isExpanded: () => true,
      active: () => undefined,
    },
  }
}

/** 激活插件：加载 bundle → apply(ctx)。 */
function activate(options) {
  client = loadClient()
  client.apply(makeCtx(options))
  return client
}

/** 触发所有仍生效的 root 订阅回调（模拟 HMR / 重挂载后的席位变化）。 */
function emitRootChange() {
  for (const rec of subs) if (rec.active) rec.fn()
}

/** 深度优先找出树里的 type=number input（设置页签控件）。 */
function findNumberInput(node) {
  if (node === null || typeof node !== 'object') return null
  if (node.type === 'input' && node.props?.type === 'number') return node
  const children = node.props?.children
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children]
  for (const child of list) {
    const hit = findNumberInput(child)
    if (hit) return hit
  }
  return null
}

/** 渲染设置页签组件并返回其元素树。 */
function renderSettings() {
  const seat = registrations.find((r) => r.name === 'settings.plugins.tab')
  assert.ok(seat, '设置页签未注册')
  hookIndex = 0
  hookStore.length = 0
  return seat.component({})
}

// ── 1. 应用语义：仅 rightbar === null 时给默认宽度 ──────────────────────

test('rightbar === null 时按默认 20% 应用（1920 → 384px）', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [384], '默认 20% × 1920 = 384')
})

test('持久化的比例生效（30% × 1920 = 576px）', () => {
  resetHarness()
  storage.set('dsh-file-activity:rightbarWidth', '30')
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [576])
})

test('快照缺 viewportWidth 时回落到 window.innerWidth', () => {
  resetHarness()
  global.window.innerWidth = 1000
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: undefined }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [200], '20% × 1000 = 200')
})

test('优先用快照的 viewportWidth（宿主 clamp 用的同一个值）', () => {
  resetHarness()
  // window.innerWidth 与快照不一致时，必须按快照算（宿主 clamp 用的是它）
  global.window.innerWidth = 3000
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1000 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [200], '20% × 1000（快照）= 200，而不是 20% × 3000')
})

test('先落宽度、再让宿主首开：宿主 ??= 45% 不得占位', () => {
  resetHarness()
  const state = layoutState({ rightbar: null, viewportWidth: 1920 })
  rootEntries = [layoutEntry({ state })]
  activate()
  assert.deepEqual(setRightbarCalls, [384], '本插件必须先写 20%')
  assert.equal(state.layoutInfo.rightbar, 384, '宿主首开默认 45%（864）不得占位')
})

test('rightbar !== null（用户本次运行拖过）绝不调用 setRightbar', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: 700, viewportWidth: 1920 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [], '已有宽度偏好时不得覆盖')
  emitRootChange()
  assert.deepEqual(setRightbarCalls, [], '订阅回调同样不得覆盖')
})

// ── 2. 非法比例回退默认 20% ────────────────────────────────────────────

test('非法 / 越界比例一律回退默认 20%', () => {
  for (const raw of ['abc', '', '0', '5', '9', '71', '999', '-3', 'NaN']) {
    resetHarness()
    storage.set('dsh-file-activity:rightbarWidth', raw)
    rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
    activate()
    assert.deepEqual(setRightbarCalls, [384], `storage=${JSON.stringify(raw)} 应回退 20%`)
  }
})

test('合法边界 10% / 70% 原样生效', () => {
  resetHarness()
  storage.set('dsh-file-activity:rightbarWidth', '10')
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [192], '10% × 1920 = 192')

  resetHarness()
  storage.set('dsh-file-activity:rightbarWidth', '70')
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  activate()
  assert.deepEqual(setRightbarCalls, [1344], '70% × 1920 = 1344')
})

// ── 3. 静默降级：契约不匹配不得抛错、不得污染日志、不得影响其它功能 ────

/** 降级用例的公共断言：插件其它四件事照常注册，且无 error/warn。 */
function assertPluginIntact() {
  const names = registrations.map((r) => r.name)
  assert.ok(names.includes('settings.plugins.tab'), '设置页签仍注册')
  assert.ok(names.includes('sidebar.right.pane.tab'), '正文席位仍注册')
  assert.ok(names.includes('sidebar.right.pane.tab.title'), '标题席位仍注册')
  assert.ok(names.includes('shell.overlay'), '浮窗席位仍注册')
  assert.deepEqual(logs.error, [], '降级不得产生 console.error')
  assert.deepEqual(logs.warn, [], '降级不得产生 console.warn')
  assert.ok(logs.debug.length <= 1, `最多一条 debug 日志，实得 ${logs.debug.length}`)
}

test('entry 缺失 → 静默跳过', () => {
  resetHarness()
  rootEntries = []
  assert.doesNotThrow(() => activate())
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('slots 服务没有 entries() → 静默跳过', () => {
  resetHarness()
  assert.doesNotThrow(() => activate({ withEntries: false }))
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('store 是 factory 形态 → 静默跳过（不猜调用）', () => {
  resetHarness()
  rootEntries = [
    {
      options: {},
      children: { rightbar: { kind: 'single' } },
      store: () => layoutEntry({ state: layoutState() }).store,
    },
  ]
  assert.doesNotThrow(() => activate())
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('store 没有 create() → 静默跳过', () => {
  resetHarness()
  rootEntries = [{ options: {}, children: { rightbar: { kind: 'single' } }, store: { spec: {} } }]
  assert.doesNotThrow(() => activate())
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('create() 抛错 → 静默跳过', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState(), createThrows: true })]
  assert.doesNotThrow(() => activate())
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('实例没有 setRightbar → 静默跳过', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState(), withSetRightbar: false })]
  assert.doesNotThrow(() => activate())
  assert.deepEqual(setRightbarCalls, [])
  assertPluginIntact()
})

test('快照形状不符（无 layoutInfo / 非对象 / 抛错）→ 静默跳过', () => {
  const shapes = [
    { getSnapshot: () => ({}), actions: { setRightbar: (px) => setRightbarCalls.push(px) } },
    { getSnapshot: () => null, actions: { setRightbar: (px) => setRightbarCalls.push(px) } },
    { getSnapshot: () => ({ layoutInfo: 'nope' }), actions: { setRightbar: (px) => setRightbarCalls.push(px) } },
    {
      getSnapshot: () => {
        throw new Error('snapshot exploded')
      },
      actions: { setRightbar: (px) => setRightbarCalls.push(px) },
    },
  ]
  for (const instance of shapes) {
    resetHarness()
    rootEntries = [layoutEntry({ state: layoutState(), instance })]
    assert.doesNotThrow(() => activate())
    assert.deepEqual(setRightbarCalls, [])
    assertPluginIntact()
  }
})

test('rightbar 为 undefined（形态不符）→ 不当作 null 应用', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: { panelInfo: { activePanelId: null }, layoutInfo: { viewportWidth: 1920 } } })]
  activate()
  assert.deepEqual(setRightbarCalls, [], '只有严格 === null 才应用')
})

test('slots 服务没有 subscribe() 时仍按 null 语义应用一次', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  assert.doesNotThrow(() => activate({ withSubscribe: false }))
  assert.deepEqual(setRightbarCalls, [384])
})

// ── 4. HMR / 重挂载：订阅回调后重新取实例 ─────────────────────────────

test('root 席位变化后重新取实例并应用', () => {
  resetHarness()
  // 首次：store 形态不认识（无 setRightbar）→ 降级，但订阅已建立
  rootEntries = [layoutEntry({ state: layoutState(), withSetRightbar: false })]
  activate()
  assert.deepEqual(setRightbarCalls, [], '首次无法应用')
  assert.equal(subs.length, 1, '订阅了 root 席位变化')
  assert.equal(subs[0].key, 'root')

  // HMR 重建后席位换成了可用的实例
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  emitRootChange()
  assert.deepEqual(setRightbarCalls, [384], '回调后重新取实例并应用')
})

test('已应用过宽度后回调不重复写入', () => {
  resetHarness()
  const state = layoutState({ rightbar: null, viewportWidth: 1920 })
  rootEntries = [layoutEntry({ state })]
  activate()
  assert.deepEqual(setRightbarCalls, [384])
  emitRootChange()
  assert.deepEqual(setRightbarCalls, [384], '实例已记住宽度（非 null）→ 不重复应用')
})

test('订阅随插件 fiber 释放注销', () => {
  resetHarness()
  rootEntries = [layoutEntry({ state: layoutState({ rightbar: null, viewportWidth: 1920 }) })]
  activate()
  assert.equal(subs.length, 1)
  assert.equal(subs[0].active, true)
  for (const disposer of disposers) disposer()
  assert.equal(subs[0].active, false, 'disposer 链到了 slots.subscribe 的注销函数')
  emitRootChange()
  assert.deepEqual(setRightbarCalls, [384], '注销后回调不再生效')
})

// ── 5. 设置页签控件 ───────────────────────────────────────────────────

test('设置页签渲染百分比输入，默认 20，范围 10–70', () => {
  resetHarness()
  activate()
  const input = findNumberInput(renderSettings())
  assert.ok(input, '设置页签出现数字输入')
  assert.equal(input.props.value, 20, '默认 20%')
  assert.equal(input.props.min, 10)
  assert.equal(input.props.max, 70)
})

test('合法编辑落盘，非法 / 越界编辑不落盘', () => {
  resetHarness()
  activate()
  let input = findNumberInput(renderSettings())
  input.props.onChange({ target: { value: '35' } })
  assert.equal(storage.get('dsh-file-activity:rightbarWidth'), '35', '合法值落盘')

  hookIndex = 0
  hookStore.length = 0
  input = findNumberInput(renderSettings())
  input.props.onChange({ target: { value: 'abc' } })
  assert.equal(storage.get('dsh-file-activity:rightbarWidth'), '35', '非法值不落盘')

  const before = storage.get('dsh-file-activity:rightbarWidth')
  input.props.onChange({ target: { value: '999' } })
  assert.equal(storage.get('dsh-file-activity:rightbarWidth'), before, '越界值不落盘')
  assert.deepEqual(logs.error, [])
  assert.deepEqual(logs.warn, [])
})

test('设置页签在 slots 服务退化时仍可用（无 entries/subscribe）', () => {
  resetHarness()
  assert.doesNotThrow(() => activate({ withEntries: false, withSubscribe: false }))
  const input = findNumberInput(renderSettings())
  assert.ok(input, '控件不依赖宿主 store 通道')
})
