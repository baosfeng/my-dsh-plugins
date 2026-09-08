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

// ── stubbed react (stateful useState so re-render sees updated state) ─────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
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
      hookValues.set(idx, [
        value,
        (next) => {
          const current = hookValues.get(idx)[0]
          hookValues.set(idx, [typeof next === 'function' ? next(current) : next, hookValues.get(idx)[1]])
        },
      ])
    }
    return hookValues.get(idx)
  },
  useEffect: (() => {
    let ran = false
    return (fn) => {
      if (!ran) {
        ran = true
        fn()
      }
    }
  })(),
}

/** Render the tab component once (hooks restart at index 0 each render). */
function renderView() {
  hookIndex = 0
  return capturedTab.component({})
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
global.fetch = (url, options) => {
  fetchCalls.push({ url: String(url), options })
  const canned = cannedResponses.shift() ?? {
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
    walkText(node.type(node.props), out)
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
    collectInputs(node.type(node.props), out)
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
  if (typeof node.type === 'function') return count + countSections(node.type(node.props))
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
cannedResponses.push(
  { ok: true, value: { maxEntryLength: 50 } },
  { ok: true, value: { cwd: '/work/proj' } },
  { ok: true, value: { items: [] } },
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

assert.equal(countSections(tree2), 2, 'both scopes render as sections')
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
