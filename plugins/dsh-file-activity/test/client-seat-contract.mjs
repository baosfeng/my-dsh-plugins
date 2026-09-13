import { test } from 'vitest'
/**
 * 席位上屏契约回归测试（issue #266，P0）。
 *
 * 宿主 dsh-client-ui-sidebar-right 渲染 sidebar.right.pane.tab 席位的真实调用是：
 *
 *   renderSlot('sidebar.right.pane.tab', {}, { entryKey, hookContext })
 *
 * 也就是 **owner props 是空对象**，能力全部走 hookContext；组件实际收到的
 * props = framework standard props（sessionId）+ 席位 inject face
 * （hooks.tabInfo → useTabInfo），**没有 visible / scope / ctx**。
 *
 * 事故（0.5.8）：view.ts 的 useSessionLoader 守卫是 `if (!visible || sessionId === '')
 * return`，而 visible 只从 props 读 → 恒为 undefined → 守卫恒真 → 面板打开后
 * 既不首载也不轮询（POLL_MS 失效），永远显示「暂无文件活动记录」；手点刷新
 * 才走 refreshSessionData 拿到数据。旧测试直接传 `{ visible: true }`，所以
 * 掩盖了这个契约漂移。
 *
 * 本套件按真实契约（空 props + useTabInfo）渲染组件，断言：
 *   1. 面板可见时**首次加载**会发起 /file-activity/api/stats 请求；
 *   2. 轮询定时器以 POLL_MS 注册；
 *   3. 宿主判定不可见（tab.visible === false）时不加载不轮询；
 *   4. 从不可见切回可见会立即加载并重启轮询；
 *   5. 旧式 visible prop 仍被接受（向后兼容，不作为主路径）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── mini react runtime（useEffect 真跑、useState 有真状态）──────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let hookScope = { index: 0, slots: [] }
const resetHooks = () => {
  hookScope = { index: 0, slots: [] }
}
/** Run every effect whose deps changed, in call order (React's own rule). */
const sameDeps = (left, right) =>
  left !== undefined &&
  right !== undefined &&
  left.length === right.length &&
  left.every((d, i) => Object.is(d, right[i]))

const stubbedReact = {
  createElement,
  useState: (initial) => {
    const i = hookScope.index++
    if (!hookScope.slots[i])
      hookScope.slots[i] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    const slot = hookScope.slots[i]
    return [
      slot.value,
      (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
      },
    ]
  },
  useEffect: (fn, deps) => {
    const i = hookScope.index++
    const slot = hookScope.slots[i] ?? (hookScope.slots[i] = { kind: 'effect', deps: undefined, cleanup: undefined })
    if (sameDeps(slot.deps, deps)) return
    if (typeof slot.cleanup === 'function') slot.cleanup()
    slot.deps = deps
    slot.cleanup = fn() ?? undefined
  },
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

// ── browser globals ───────────────────────────────────────────────────────
let registered = null
const storage = new Map()
const storageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
/** Every fetch the bundle performed, in order. */
const fetches = []
/** Every window.setInterval registration: { fn, ms }. */
const intervals = []
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: (url) => {
    fetches.push(String(url))
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
  },
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: (fn, ms) => {
    intervals.push({ fn, ms })
    return intervals.length
  },
  clearInterval: () => {},
  localStorage: storageStub,
  sessionStorage: storageStub,
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.localStorage = storageStub
global.sessionStorage = storageStub
global.fetch = (url) => {
  fetches.push(String(url))
  return Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
}
global.document = {
  head: { appendChild: () => {} },
  documentElement: { dataset: {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '', parentNode: null }),
}

// ── load the built bundle ─────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbedReact
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return {}
  throw new Error('unexpected require: ' + spec)
})

// ── native service doubles ────────────────────────────────────────────────
let tabBody = null
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_slot, factory) => factory(),
    register: (options, component) => {
      if (options.name === 'sidebar.right.pane.tab') tabBody = component
      return () => {}
    },
  },
  sidebarRightTabs: { register: () => () => {}, entries: () => [] },
  documentPreviews: { register: () => () => {}, candidates: () => [] },
  sidebarRight: { openTab: () => {}, openResource: () => {}, isExpanded: () => true, active: () => undefined },
}
exportsObj.apply(ctx)
assert.ok(tabBody, 'the tab body seat is registered')

/** 宿主席位信息（dsh-client-ui-sidebar-right 的 SidebarRightTabInfo 形状）。 */
const tabInfoOf = (visible) => ({
  sidebar: { expanded: true, fullscreen: false },
  panel: { id: 'pane-1' },
  tab: {
    id: 'tab-1',
    kind: 'file-activity',
    title: '文件活动',
    visible,
    navigation: { address: 'sidebar://file-activity', params: undefined, revision: 1 },
    signal: new AbortController().signal,
    actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
  },
})

/**
 * 按宿主真实契约渲染一个席位：owner props = {}，能力来自注入的
 * useTabInfo（TabSlot 的 hookContext + inject face），**不是** visible。
 */
const renderSeat = ({ sessionId = 'sess-1', visible = true } = {}) => {
  resetHooks()
  const element = tabBody({ sessionId, useTabInfo: () => tabInfoOf(visible) })
  return element.type(element.props)
}

/** 旧宿主 / 直接渲染：没有 useTabInfo，只有 legacy visible prop。 */
const renderLegacySeat = (visible) => {
  resetHooks()
  const element = tabBody({ sessionId: 'sess-1', visible })
  return element.type(element.props)
}

/** Let the component's fetch promises settle. */
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
}

const statsCalls = () => fetches.filter((url) => url.includes('/file-activity/api/stats'))

// ── 1. 宿主空 props 契约：面板打开即首载 + 轮询 ───────────────────────────
{
  fetches.length = 0
  intervals.length = 0
  // 契约断言先行：宿主 renderSlot 给的是空 owner props，可见性不在 props 里
  assert.equal('visible' in { sessionId: 'sess-1', useTabInfo: () => {} }, false)
  const tree = renderSeat({ visible: true })
  assert.ok(tree, 'the tab body renders a tree')
  await settle()
  assert.equal(statsCalls().length, 1, 'a visible seat loads stats on mount (issue #266 A)')
  assert.equal(intervals.length, 1, 'a visible seat starts polling (issue #266 A)')
  assert.equal(intervals[0].ms, 6000, 'the poll interval is POLL_MS')
}

// ── 2. 宿主判定不可见：不加载、不轮询（省资源，守卫仍生效）──────────────
{
  fetches.length = 0
  intervals.length = 0
  renderSeat({ visible: false })
  await settle()
  assert.equal(statsCalls().length, 0, 'a hidden seat does not load')
  assert.equal(intervals.length, 0, 'a hidden seat does not poll')
}

// ── 3. 不可见 → 可见：立即加载并重启轮询（切回页签/展开侧边栏）──────────
{
  fetches.length = 0
  intervals.length = 0
  renderSeat({ visible: false })
  await settle()
  assert.equal(statsCalls().length, 0)
  renderSeat({ visible: true })
  await settle()
  assert.equal(statsCalls().length, 1, 'becoming visible loads immediately')
  assert.equal(intervals.length, 1, 'becoming visible restarts polling')
}

// ── 4. 兼容：没有 useTabInfo 的旧调用点仍读 legacy visible prop ──────────
{
  fetches.length = 0
  intervals.length = 0
  renderLegacySeat(false)
  await settle()
  assert.equal(statsCalls().length, 0, 'legacy visible=false still hides')
  renderLegacySeat(true)
  await settle()
  assert.equal(statsCalls().length, 1, 'legacy visible=true still loads')
}

// ── 5. 宿主 hook 优先于 legacy prop（契约以宿主为准）────────────────────
{
  fetches.length = 0
  intervals.length = 0
  resetHooks()
  const element = tabBody({ sessionId: 'sess-1', visible: false, useTabInfo: () => tabInfoOf(true) })
  element.type(element.props)
  await settle()
  assert.equal(statsCalls().length, 1, 'the host hook wins over a stale legacy prop')
}

console.log('client seat contract: OK')

test('script-style suite (assertions ran at module load)', () => {})
