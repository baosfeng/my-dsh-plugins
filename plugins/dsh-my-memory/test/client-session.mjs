/**
 * Client session-cwd auto-load test (issue #104): when the panel opens and the
 * current session has a working directory, the PROJECT scope auto-loads that
 * project's memory — verifying the initial mount resolves the session cwd
 * (GET /my-memory/api/session) then fetches global + project
 * (GET /my-memory/api/memory?scope=global / ...scope=project&cwd=…), renders
 * the project section with its items and the project-root badge, and
 * pre-fills the path input — all WITHOUT a manual path load.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react (stateful hooks, per component instance) ────────────────
// hook 状态按「组件实例 + 序号」隔离，与 React 一致（不同组件的 hook 不共享
// 槽位）。视图里新增了自持状态的子分区（全局提示词），因此隔离是必需的：
// 共享槽位时子分区的 hook 会顶掉父视图的槽位，表现为「记忆列表渲染不出来」的
// 假红；而把 effect 简化成「全局只跑第一个」又会把新分区的 effect 吞掉，表现为
// 「分区在、内容是空」的假绿。
/** 当前正在渲染的组件实例 id（hook 槽位前缀）。 */
let hookComponentId = null
/** 单次组件渲染内的 hook 序号。 */
let hookIndex = 0
const hookValues = new Map()
/** effect 键 → { deps, cleanup }（React 依赖数组语义）。 */
const effectRan = new Map()

/** 依赖数组浅比较（长度 + Object.is 逐项）。 */
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

/** 以组件实例为界跑一次渲染：独立 hook 命名空间 + 序号归零，跑完还原调用方上下文。 */
function withHookComponent(id, render) {
  const outerId = hookComponentId
  const outerIndex = hookIndex
  hookComponentId = id
  try {
    return render()
  } finally {
    hookComponentId = outerId
    hookIndex = outerIndex
  }
}

/** 组件实例身份：类型名 + 判别键（scope / key / id），同名同键只算一个实例。
 *  这是 React「同类同位置复用实例」的近似——用类型名而非树坐标，因为本 stub 的
 *  树在每次渲染都会被重建（元素对象是新的），位置坐标不可稳定复现。 */
const componentSeen = new Map()

/** 实例身份 + hook 槽位隔离。 */
function renderComponent(type, props) {
  const name = typeof type.name === 'string' && type.name !== '' ? type.name : 'anon'
  const discriminator = props !== null && typeof props === 'object' ? (props.scope ?? props.key ?? props.id ?? '') : ''
  const seed = `${name}:${discriminator}`
  const occurrence = componentSeen.get(seed) ?? 0
  componentSeen.set(seed, occurrence + 1)
  const id = `${seed}#${occurrence}`
  return withHookComponent(id, () => type(props))
}

function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

function hookSlot() {
  const key = `${hookComponentId ?? 'root'}:${hookIndex}`
  hookIndex += 1
  return key
}

/** Render the tab component once: root 实例 hook 槽位 + 每个渲染 pass 重置出现序号。 */
function renderView() {
  return withHookComponent('root', () => {
    componentSeen.clear()
    return capturedTab.component({})
  })
}

const stubbed = {
  createElement,
  useState: (initial) => {
    const key = hookSlot()
    if (!hookValues.has(key)) {
      const value = typeof initial === 'function' ? initial() : initial
      hookValues.set(key, [
        value,
        (next) => {
          const current = hookValues.get(key)[0]
          hookValues.set(key, [typeof next === 'function' ? next(current) : next, hookValues.get(key)[1]])
        },
      ])
    }
    return hookValues.get(key)
  },
  // 对齐 React 语义：按依赖数组决定是否重跑（deps 浅比较；空数组 = 只跑一次）。
  // 只按「跑过一次」判定的实现会让 `[actions]` 这类依赖永远不再触发——真实宿主会
  // 反复请求记忆端点，测试却绿着（假绿）。
  useEffect: (fn, deps) => {
    const key = hookSlot()
    const previous = effectRan.get(key)
    const shouldRun = previous === undefined || deps === undefined || !sameDeps(previous.deps, deps)
    if (shouldRun) {
      previous?.cleanup?.()
      effectRan.set(key, { deps, cleanup: fn() })
    }
  },
}

// ── 官方 UI 组件库 stub（issue #143 试点）：与 client-render.mjs 一致，
//    data-ui 标记供「官方组件被使用」断言。 ────────────────────────────────
const uiPrimitives = {
  Button: ({ variant: _variant, size: _size, icon, className, children, ...rest }) =>
    createElement('button', { type: 'button', 'data-ui': 'button', className, ...rest }, icon, children),
  Input: ({ icon: _icon, className, ...rest }) =>
    createElement('span', { 'data-ui': 'input', className }, createElement('input', rest)),
  Pill: ({ active: _active, className, children, onClick, ...rest }) =>
    onClick
      ? createElement('button', { type: 'button', 'data-ui': 'pill', className, onClick, ...rest }, children)
      : createElement('span', { 'data-ui': 'pill', className }, children),
  IconRefreshOutline14: (props) => createElement('svg', { 'data-icon': 'refresh', ...props }),
  IconFolderOpenOutline16: (props) => createElement('svg', { 'data-icon': 'folder', ...props }),
  IconCheckOutline16: (props) => createElement('svg', { 'data-icon': 'check', ...props }),
  IconPlusOutline16: (props) => createElement('svg', { 'data-icon': 'plus', ...props }),
  IconClockOutline16: (props) => createElement('svg', { 'data-icon': 'clock', ...props }),
  IconCloseOutline16: (props) => createElement('svg', { 'data-icon': 'close', ...props }),
}

// ── browser globals: current session → localStorage; project cwd on /session ─
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
global.localStorage = { getItem: () => JSON.stringify({ sessionId: 's1' }) }
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

const fetchCalls = []
let cannedResponses = []
// 提示词/候选端点按 URL 应答（子分区 effect 次数与记忆分区不同步，固定队列会错位）。
const PROMPTS_RESPONSE = {
  ok: true,
  value: { items: [{ id: 'gp-seed', title: '中文思考', text: '中文思考。', enabled: true, order: 10 }] },
}
const CANDIDATES_RESPONSE = { ok: true, value: { items: [] } }
global.fetch = (url, options) => {
  const target = String(url)
  fetchCalls.push({ url: target, options })
  const fixed =
    target === '/my-memory/api/prompts'
      ? PROMPTS_RESPONSE
      : target === '/my-memory/api/candidates'
        ? CANDIDATES_RESPONSE
        : null
  const canned = fixed ??
    cannedResponses.shift() ?? {
      ok: true,
      value: { scope: 'global', cwd: '', projectRoot: '', items: [] },
    }
  return Promise.resolve({ json: () => Promise.resolve(canned) })
}

// ── load bundle ────────────────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return uiPrimitives
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function')

// ── mock slots service + context ───────────────────────────────────────────
let capturedTab = null
const mockSlots = {
  inject: (name, register) => {
    const registeredTab = register()
    if (name === 'settings.plugins.tab') capturedTab = registeredTab
    return () => {}
  },
  register: (options, component) => ({ options, component }),
}
const ctx = {
  // 严格模拟 cordis 的 ctx.get(name, strict = true)：服务提供者 fiber 未
  // active 时 strict 取法返回 undefined、strict=false 才返回服务对象。
  // 防回归（首屏时序）：设置页 tab 注册不得依赖 slots 提供者已 active。
  get: (name, strict = true) => (name === 'slots' ? (strict ? undefined : mockSlots) : undefined),
  effect: (fn) => fn(),
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'settings tab registered')

// ── helpers ────────────────────────────────────────────────────────────────
function walkText(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walkText(child, out)
    return
  }
  if (typeof node.type === 'function') {
    walkText(renderComponent(node.type, node.props), out)
    return
  }
  walkText(node.props.children, out)
}

function collectInputs(node, out) {
  if (node === null || typeof node !== 'object') return
  const props = node.props ?? {}
  if (props.className === 'dsh-my-memory-add-input' || props.className === 'dsh-my-memory-path-input') out.push(props)
  if (Array.isArray(node)) {
    for (const c of node) collectInputs(c, out)
    return
  }
  if (typeof node.type === 'function') {
    collectInputs(renderComponent(node.type, node.props), out)
    return
  }
  collectInputs(props.children, out)
}

function countSections(node) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  const cls = props.className
  let count =
    typeof cls === 'string' && (cls === 'dsh-my-memory-section' || cls.startsWith('dsh-my-memory-section ')) ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countSections(c)
    return count
  }
  if (typeof node.type === 'function') return count + countSections(renderComponent(node.type, node.props))
  return count + countSections(props.children)
}

// ── mount with a session cwd: project auto-loads without a manual load ──────
const globalValue = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [{ id: 'g1', desc: '回复使用中文', createdAt: 1, updatedAt: 2 }],
  },
}
const projectValue = {
  ok: true,
  value: {
    scope: 'project',
    cwd: '/work/proj',
    projectRoot: '/work/proj',
    items: [{ id: 'p1', desc: '本项目用 vitest', createdAt: 1, updatedAt: 2 }],
  },
}
// 初始挂载的 fetch 顺序（与 view.part.js 的 useEffect 一致）：
// 1. GET /my-memory/api/config → { maxEntryLength }（issue #105 精简引导）
// 2. GET /my-memory/api/session?sessionId=s1 → { cwd: '/work/proj' }
// 3. GET /my-memory/api/candidates → []（issue #78 待确认候选）
// 4. GET /my-memory/api/memory?scope=global → globalValue
// 5. GET /my-memory/api/memory?scope=project&cwd=%2Fwork%2Fproj → projectValue
// 子分区（全局提示词）自持 state → 首屏会有一次额外渲染，effect 次数多于
// 记忆分区，固定队列会错位；candidates 只由记忆分区消费一次，故把提示词的
// 响应插在它前面，其余顺序不变。
cannedResponses.push(
  { ok: true, value: { maxEntryLength: 50 } },
  { ok: true, value: { cwd: '/work/proj' } },
  globalValue,
  projectValue,
)

const tree = renderView()
const texts0 = []
walkText(tree, texts0)
assert.ok(texts0.join('|').includes('加载中'), 'initial render shows the loading state')

await new Promise((resolve) => setTimeout(resolve, 0))

const tree2 = renderView()
const texts = []
walkText(tree2, texts)
const joined = texts.join('|')

assert.equal(countSections(tree2), 3, 'two memory scopes + the prompts section (issue #465)')
assert.ok(joined.includes('全局记忆'), 'global section present')
assert.ok(joined.includes('项目记忆'), 'project section present')
assert.ok(joined.includes('回复使用中文'), 'global memory desc rendered')
assert.ok(joined.includes('本项目用 vitest'), 'current project memory auto-loaded, no manual load')
assert.ok(joined.includes('项目根：/work/proj'), 'project root badge rendered from the session cwd')

const inputs = []
collectInputs(tree2, inputs)
const pathInput = inputs.find((i) => i.className === 'dsh-my-memory-path-input')
assert.ok(pathInput, 'project path input rendered')

const sessionCalls = fetchCalls.filter((c) => c.url.startsWith('/my-memory/api/session'))
assert.equal(sessionCalls.length, 1, 'panel opens by resolving the session cwd')
assert.ok(sessionCalls[0].url.includes('sessionId=s1'), 'session id passed to /session')
const projectCalls = fetchCalls.filter((c) => c.url.includes('scope=project'))
assert.equal(projectCalls.length, 1, 'project scope fetched on open')
assert.ok(projectCalls[0].url.includes('cwd='), 'project fetch carries the session cwd')

console.log('ALL MY-MEMORY CLIENT SESSION-CWD AUTO-LOAD TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})
