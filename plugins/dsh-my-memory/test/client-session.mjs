/**
 * Client session-cwd auto-load test (issue #104): when the panel opens and the
 * current session has a working directory, the PROJECT tab shows that
 * project's memory — verifying the initial mount resolves the session cwd
 * (GET /my-memory/api/session) then fetches global + project
 * (GET /my-memory/api/memory?scope=global / ...scope=project&cwd=…).
 * The panel has no project-path input anymore: the project scope comes from
 * the session cwd only.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react (stateful hooks, per component instance) ────────────────
let hookComponentId = null
let hookIndex = 0
const hookValues = new Map()
const effectRan = new Map()

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

function withHookComponent(id, render) {
  const outerId = hookComponentId
  const outerIndex = hookIndex
  hookComponentId = id
  hookIndex = 0
  try {
    return render()
  } finally {
    hookComponentId = outerId
    hookIndex = outerIndex
  }
}

const componentSeen = new Map()

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

const uiPrimitives = {
  Button: ({ variant: _variant, size: _size, icon, className, children, ...rest }) =>
    createElement('button', { type: 'button', 'data-ui': 'button', className, ...rest }, icon, children),
  Input: ({ icon: _icon, className, ...rest }) =>
    createElement('span', { 'data-ui': 'input', className }, createElement('input', rest)),
  Pill: ({ active: _active, className, children, onClick, ...rest }) =>
    onClick
      ? createElement('button', { type: 'button', 'data-ui': 'pill', className, onClick, ...rest }, children)
      : createElement('span', { 'data-ui': 'pill', className }, children),
}

function assertRenderableTypes(node, path = 'tab[settings.plugins.tab]') {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertRenderableTypes(child, `${path}[${i}]`))
    return
  }
  const type = node.type
  if (type === undefined || type === null) {
    throw new Error(`React error #130: Element type is invalid at ${path} (got: ${String(type)})`)
  }
  if (typeof type === 'string') {
    assertRenderableTypes(node.props?.children, `${path}<${type}>`)
    return
  }
  if (typeof type === 'function') {
    assertRenderableTypes(renderComponent(type, node.props ?? {}), `${path}<${type.name || 'anonymous'}>`)
    return
  }
  throw new Error(`React error #130: Element type is invalid at ${path} (got: ${typeof type})`)
}

function renderView() {
  return withHookComponent('root', () => {
    componentSeen.clear()
    const tree = capturedTab.component({})
    // 只渲染一次根组件：第二次渲染会拿到新的 hook 槽位，effect 会重复触发
    // （表现为 session/config 端点被请求两次）。元素类型校验复用同一棵树。
    assertRenderableTypes(tree)
    return tree
  })
}

// ── browser globals: a session id is present ───────────────────────────────
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
const PROMPTS_RESPONSE = {
  ok: true,
  value: { items: [{ id: 'gp-seed', title: '中文思考', text: '中文思考。', enabled: true, order: 10 }] },
}
const CONFIG_RESPONSE = { ok: true, value: { maxEntryLength: 50 } }
const SESSION_RESPONSE = { ok: true, value: { cwd: '/work/proj' } }
global.fetch = (url, options) => {
  const target = String(url)
  fetchCalls.push({ url: target, options })
  const fixed =
    options !== undefined
      ? null
      : target === '/my-memory/api/prompts'
        ? PROMPTS_RESPONSE
        : target === '/my-memory/api/config'
          ? CONFIG_RESPONSE
          : target.startsWith('/my-memory/api/session')
            ? SESSION_RESPONSE
            : target === '/my-memory/api/agent-memory'
              ? // agent 记忆面板挂载即拉一次（issue #502）：固定空响应，不占 FIFO
                { ok: true, value: { items: [] } }
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
  get: (name, strict = true) => (name === 'slots' ? (strict ? undefined : mockSlots) : undefined),
  effect: (fn) => fn(),
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'settings tab registered')
assert.equal(capturedTab.options.id, 'my-memory')

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

function joinedText(tree) {
  const out = []
  walkText(tree, out)
  return out.join('|')
}

function collectInputs(node, out) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const c of node) collectInputs(c, out)
    return
  }
  if (typeof node.type === 'function') {
    collectInputs(renderComponent(node.type, node.props), out)
    return
  }
  const props = node.props ?? {}
  if (node.type === 'textarea') {
    out.push({ ...props, tag: 'textarea' })
    return
  }
  const cls = props.className
  if (typeof cls === 'string' && cls.includes('dsh-my-memory-add-input')) {
    const kids = Array.isArray(props.children) ? props.children : [props.children]
    const inner = kids.find((c) => c !== null && typeof c === 'object' && c.type === 'input')
    out.push(inner ? { ...inner.props, wrapperClass: cls } : { ...props, wrapperClass: cls })
    return
  }
  collectInputs(props.children, out)
}

function collectButtons(node, out) {
  if (node === null || node === undefined || typeof node !== 'object') return
  const props = node.props ?? {}
  if (typeof props.onClick === 'function' && typeof props['aria-label'] === 'string') {
    out.push({ label: props['aria-label'], onClick: props.onClick, role: props.role })
  }
  if (Array.isArray(node)) {
    for (const c of node) collectButtons(c, out)
    return
  }
  if (typeof node.type === 'function') {
    collectButtons(renderComponent(node.type, node.props), out)
    return
  }
  collectButtons(props.children, out)
}

// ── mount with a session cwd: project auto-loads without any manual load ──
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
// 初始挂载的 fetch 顺序：global 先到，project 由 session cwd 触发（Promise.all）。
cannedResponses.push(globalValue, projectValue)

const loadingTree = renderView()
assert.ok(joinedText(loadingTree).includes('加载中'), 'initial render shows the loading state')

await new Promise((resolve) => setTimeout(resolve, 0))

const tree2 = renderView()
const joined = joinedText(tree2)
assert.ok(joined.includes('回复使用中文'), 'global memory desc rendered on the default tab')
assert.ok(!joined.includes('本项目用 vitest'), 'project memory stays on its own tab')

// 切到项目 tab：会话 cwd 自动加载的项目记忆已就绪
const buttons = []
collectButtons(tree2, buttons)
const projectTab = buttons.find((b) => b.role === 'tab' && b.label === '项目记忆')
assert.ok(projectTab, 'project tab rendered')
projectTab.onClick()
const tree3 = renderView()
const joined3 = joinedText(tree3)
assert.ok(joined3.includes('本项目用 vitest'), 'current project memory auto-loaded, no manual load')
assert.ok(joined3.includes('项目记忆'), 'project section present')

// 不再有项目路径输入框
const inputs = []
collectInputs(tree3, inputs)
assert.ok(!inputs.some((i) => (i.wrapperClass ?? i.className ?? '').includes('path')), 'no project path input anymore')

const sessionCalls = fetchCalls.filter((c) => c.url.startsWith('/my-memory/api/session'))
assert.equal(sessionCalls.length, 1, 'panel opens by resolving the session cwd')
assert.ok(sessionCalls[0].url.includes('sessionId=s1'), 'session id passed to /session')
const projectCalls = fetchCalls.filter((c) => c.url.includes('scope=project'))
assert.equal(projectCalls.length, 1, 'project scope fetched on open')
assert.ok(projectCalls[0].url.includes('cwd='), 'project fetch carries the session cwd')
const candidateCalls = fetchCalls.filter((c) => c.url.includes('/candidates'))
assert.equal(candidateCalls.length, 0, 'candidate endpoint removed from the client')

console.log('ALL MY-MEMORY CLIENT SESSION-CWD AUTO-LOAD TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})
