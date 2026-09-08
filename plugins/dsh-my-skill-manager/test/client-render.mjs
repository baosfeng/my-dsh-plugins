/**
 * Client render-path test: loads the client bundle with a stubbed react
 * (real createElement; hooks stubbed to stateful no-ops), registers the
 * settings tab through a mocked slots service, then invokes the view
 * component to verify the global/project sections, disabled badges and the
 * toggle→PUT wiring.
 *
 * issue #69: 断言新结构——标题区（唯一刷新按钮）、分段控件（全局|当前项目，
 * 项目 tab 仅会话 cwd 非空时出现）、状态 chip（文字+颜色双编码）、来源/未收录
 * 弱化为 meta 小字、诊断折叠条；路径输入框/加载按钮已移除。
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
  useEffect: (fn) => {
    if (!effectState.ran) {
      effectState.ran = true
      fn()
    }
  },
}
/** useEffect 只跑一次（模拟真实组件挂载）；测试可重置以模拟重新挂载。 */
const effectState = { ran: false }

/**
 * SkillManagerView 的 useState 数量（data/view/sessionCwd/loading/error/saved/
 * sortBy/unusedOnly）。辅助函数（walkText/collectByClass/collectButtons）展开
 * 函数组件时会消耗全局 hookIndex——若不重置，DiagnosticsBlock 的 useState
 * 会被分配多个影子索引，点击的 setter 与渲染读取的索引错位（issue #69 测试
 * 实测）。展开时重置为真实渲染的继续位置，保证每次展开复用同一索引。
 */
const VIEW_HOOK_COUNT = 8

/** Render the tab component once (hooks restart at index 0 each render). */
function renderView() {
  hookIndex = 0
  return capturedTab.component({})
}

// ── stubbed official UI primitives (issue #143 试点) ───────────────────────
// 官方组件库由宿主 staticModules 提供，测试用最小 stub 渲染（data-ui 标记
// 供「官方组件被使用」断言）。Button → <button data-ui=button>；Pill → 有
// onClick 渲染 button、否则 span（data-ui=pill，className 透传）；图标 →
// <svg data-icon=.../>。
const uiPrimitives = {
  Button: ({ variant: _variant, size: _size, icon, className, children, ...rest }) =>
    createElement('button', { type: 'button', 'data-ui': 'button', className, ...rest }, icon, children),
  Pill: ({ active: _active, className, children, onClick, ...rest }) =>
    onClick
      ? createElement('button', { type: 'button', 'data-ui': 'pill', className, onClick, ...rest }, children)
      : createElement('span', { 'data-ui': 'pill', className }, children),
  IconRefreshOutline14: (props) => createElement('svg', { 'data-icon': 'refresh', ...props }),
}

// ── browser globals ────────────────────────────────────────────────────────
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registered = registration
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

/** 可配置的 localStorage：dsh.sessions.current 返回测试设定的会话。 */
let storedSession = null
global.localStorage = {
  getItem: (key) => (key === 'dsh.sessions.current' ? storedSession : null),
  setItem: () => {},
}

const fetchCalls = []
let cannedResponses = []
global.fetch = (url, options) => {
  fetchCalls.push({ url: String(url), options })
  const canned = cannedResponses.shift() ?? {
    ok: true,
    value: { skills: [], global: { disabled: [] }, project: [], cwd: '', projectRoot: '' },
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
assert.equal(capturedTab.options.id, 'my-skill-manager')
assert.equal(typeof capturedTab.component, 'function')

// ── render the view with a canned catalog response ─────────────────────────
const USED_AT = new Date(2026, 8, 2, 10, 30).getTime()
const catalog = {
  ok: true,
  value: {
    cwd: '',
    projectRoot: '',
    skills: [
      { name: 'web-search', description: '网络搜索', source: 'user-dsh', provider: 'filesystem' },
      {
        name: 'codebase-memory',
        description: '图查询',
        source: 'project-dsh',
        provider: 'filesystem',
      },
    ],
    global: { disabled: ['web-search'] },
    project: [],
    usage: {
      'web-search': { count: 3, lastUsedAt: USED_AT, lastSource: 'model' },
    },
  },
}
cannedResponses.push(catalog)

const tree = renderView()
// 初始渲染：data=null → loading 分支
const texts0 = []
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
    const saved = hookIndex
    hookIndex = VIEW_HOOK_COUNT
    walkText(node.type(node.props), out)
    hookIndex = saved
    return
  }
  walkText(node.props.children, out)
}
walkText(tree, texts0)
assert.ok(texts0.join('|').includes('加载中'), 'initial render shows the loading state')

// await the fetch microtasks so setData lands in the stub hook
await new Promise((resolve) => setTimeout(resolve, 0))

// ── re-render: catalog branch (global view, no session) ────────────────────
const tree2 = renderView()
const texts = []
walkText(tree2, texts)
const joined = texts.join('|')

assert.ok(joined.includes('全局'), 'global section present')
assert.equal(countSections(tree2), 1, 'global view renders exactly one section (no project section)')
assert.ok(joined.includes('web-search'), 'skill name rendered')
assert.ok(joined.includes('codebase-memory'), 'second skill rendered')
assert.ok(joined.includes('网络搜索'), 'skill description rendered')
assert.ok(joined.includes('已禁用') === false, 'no state chip text (switch is the single encoding)')
const switchButtons = []
collectButtons(tree2, switchButtons)
assert.ok(
  switchButtons.some((b) => b.label.includes('web-search') && b.label.includes('已禁用')),
  'disabled switch label rendered',
)
assert.ok(
  switchButtons.some((b) => b.label.includes('codebase-memory') && b.label.includes('启用')),
  'enabled switch label rendered',
)
assert.ok(joined.includes('全局（user-dsh）'), 'source note rendered in meta line')
assert.ok(joined.includes('项目（project-dsh）'), 'project source note rendered in meta line')

// ── issue #91: usage statistics rendered in the meta line ─────────────────
assert.ok(joined.includes('使用 3 次'), 'usage count rendered for the used skill')
assert.ok(joined.includes('最近 09-02 10:30'), 'last used time rendered')
assert.ok(joined.includes('模型'), 'model source rendered')
assert.ok(joined.includes('未使用'), 'never-used skill marked in the meta line')
assert.ok(joined.includes('次数'), 'count sort segment rendered')
assert.ok(joined.includes('最近'), 'last-used sort segment rendered')

const listCall = fetchCalls[0]
assert.ok(listCall.url.startsWith('/my-skill-manager/api/list'), 'initial list fetch')
assert.equal(fetchCalls.length, 1, 'only the initial list call so far (no session → no /session call)')

// ── issue #69: no path input / no load button; single refresh action ───────
const inputs = []
collectByClass(tree2, 'dsh-my-skill-manager-path-input', inputs)
assert.equal(inputs.length, 0, 'path input removed (issue #69)')
const buttons = []
collectButtons(tree2, buttons)
assert.ok(!buttons.some((b) => b.label.includes('加载')), 'load button removed (issue #69)')
const refreshBtn = buttons.find((b) => b.label.includes('刷新'))
assert.ok(refreshBtn, 'refresh button rendered (the only action)')

// ── issue #69: segmented control — global on, no project tab (no cwd) ─────
const segs = []
collectByClass(tree2, 'dsh-my-skill-manager-seg', segs)
assert.equal(segs.length, 1, 'only the global segment without a session cwd')
assert.equal(segs[0].props['aria-pressed'], true, 'global segment active by default')
assert.equal(segs[0].props.children, '全局', 'global segment label')

// ── state encoded by the switch only (双编码 chip 已移除) ──────────────────
const chips = []
collectByClass(tree2, 'dsh-my-skill-manager-chip', chips)
assert.equal(chips.length, 0, 'state chip removed — switch is the single encoding')

// ── toggle: click the global enable toggle of codebase-memory ─────────────
const toggle = buttons.find((t) => t.label.includes('codebase-memory') && t.label.includes('启用'))
assert.ok(toggle, 'toggle for the enabled skill found')

cannedResponses.push({ ok: true }) // PUT response
cannedResponses.push(catalog) // refresh list after save
toggle.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const putCall = fetchCalls.find((c) => c.url.startsWith('/my-skill-manager/api/config'))
assert.ok(putCall, 'toggle issues a PUT config call')
assert.equal(putCall.options.method, 'PUT')
const payload = JSON.parse(putCall.options.body)
assert.equal(payload.scope, 'global')
assert.deepEqual(payload.disabled, ['web-search', 'codebase-memory'], 'disabled list extended')
assert.equal(payload.cwd, '', 'global scope saves without cwd')

// ── refresh button: click triggers a rescan fetch and shows new skills ─────
cannedResponses.push({
  ok: true,
  value: {
    ...catalog.value,
    skills: [
      ...catalog.value.skills,
      {
        name: 'dsh-issue-request',
        description: '新需求',
        source: 'user-dsh',
        provider: 'filesystem',
      },
      {
        name: 'teach',
        description: '教学',
        source: 'user-dsh',
        provider: 'filesystem',
        cataloged: false,
      },
    ],
    diagnostics: {
      missing: [
        {
          name: 'ego-browser',
          path: '/home/u/.agents/skills/ego-browser',
          reason: 'broken-symlink',
        },
      ],
    },
  },
})
refreshBtn.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const rescanCall = fetchCalls.find((c) => c.url.startsWith('/my-skill-manager/api/rescan'))
assert.ok(rescanCall, 'refresh issues a rescan call')
const tree3 = renderView()
const texts3 = []
walkText(tree3, texts3)
const joined3 = texts3.join('|')
assert.ok(joined3.includes('dsh-issue-request'), 'new skill visible after rescan')
assert.ok(joined3.includes('未收录'), 'not-cataloged note rendered in meta line')
assert.ok(joined3.includes('扫描诊断'), 'diagnostics bar rendered after rescan')
assert.ok(!joined3.includes('ego-browser'), 'diagnostics body hidden while collapsed')

// ── issue #69: diagnostics is a collapsible bar (closed by default) ────────
const diagBars = []
collectByClass(tree3, 'dsh-my-skill-manager-diag-bar', diagBars)
assert.equal(diagBars.length, 1, 'diagnostics bar rendered')
assert.equal(diagBars[0].props['aria-expanded'], false, 'diagnostics collapsed by default')
const diagBodies = []
collectByClass(tree3, 'dsh-my-skill-manager-diag-body', diagBodies)
assert.equal(diagBodies.length, 0, 'diagnostics body hidden while collapsed')
console.log('DBG hookValues[6] before click:', JSON.stringify(hookValues.get(6)?.[0]))
diagBars[0].props.onClick()
console.log('DBG hookValues[6] after click:', JSON.stringify(hookValues.get(6)?.[0]))
const tree3b = renderView()
console.log('DBG hookIndex after render:', hookIndex)
const diagBodies2 = []
collectByClass(tree3b, 'dsh-my-skill-manager-diag-body', diagBodies2)
assert.equal(diagBodies2.length, 1, 'diagnostics body expands on click')
const texts3b = []
walkText(tree3b, texts3b)
const joined3b = texts3b.join('|')
assert.ok(joined3b.includes('ego-browser'), 'missing entry name rendered after expand')
assert.ok(joined3b.includes('符号链接'), 'missing entry reason rendered after expand')

// ── issue #69: project tab appears when the session has a cwd ──────────────
// 模拟重新挂载（useEffect 重跑）：会话存在 → /session 返回 cwd → 项目 tab 出现。
storedSession = JSON.stringify({ sessionId: 'sess-1' })
effectState.ran = false
cannedResponses.push({ ok: true, value: { cwd: '/work/proj' } }) // /session
cannedResponses.push(catalog) // initial list (global view)
renderView()
await new Promise((resolve) => setTimeout(resolve, 0))

const sessionCall = fetchCalls.find((c) => c.url.startsWith('/my-skill-manager/api/session'))
assert.ok(sessionCall, 'session cwd fetched when a session exists')
assert.ok(sessionCall.url.includes('sessionId=sess-1'), 'session id passed to /session')

const tree4 = renderView()
const segs4 = []
collectByClass(tree4, 'dsh-my-skill-manager-seg', segs4)
assert.equal(segs4.length, 2, 'project segment appears when session cwd detected')
assert.equal(segs4[1].props.children, '当前项目', 'project segment label')
assert.equal(segs4[1].props['aria-pressed'], false, 'project segment inactive initially')

// ── switch to the project view: list?cwd=… + project-only rows ─────────────
cannedResponses.push({
  ok: true,
  value: {
    cwd: '/work/proj',
    projectRoot: '/work/proj',
    skills: [
      {
        name: 'codebase-memory',
        description: '图查询',
        source: 'project-dsh',
        provider: 'filesystem',
      },
    ],
    global: { disabled: [] },
    project: [],
    diagnostics: { missing: [] },
  },
})
segs4[1].props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const projectListCall = fetchCalls.find((c) => c.url.startsWith('/my-skill-manager/api/list?cwd='))
assert.ok(projectListCall, 'project view fetches list with cwd')
assert.ok(projectListCall.url.includes(encodeURIComponent('/work/proj')), 'cwd passed to list')

const tree5 = renderView()
const texts5 = []
walkText(tree5, texts5)
const joined5 = texts5.join('|')
assert.ok(joined5.includes('当前项目'), 'project section present in project view')
assert.ok(joined5.includes('项目根：/work/proj'), 'project root shown read-only in the title')
assert.ok(!joined5.includes('全局（'), 'no global-sourced skill rows in project view')
assert.equal(countSections(tree5), 1, 'project view renders exactly one section')
assert.ok(joined5.includes('codebase-memory'), 'project skill rendered in project view')
assert.ok(!joined5.includes('web-search'), 'global skill not rendered in project view')

// ── project toggle saves with the session cwd ──────────────────────────────
const buttons5 = []
collectButtons(tree5, buttons5)
const projToggle = buttons5.find((t) => t.label.includes('codebase-memory') && t.label.includes('启用'))
assert.ok(projToggle, 'project toggle found')
cannedResponses.push({ ok: true }) // PUT
cannedResponses.push({
  ok: true,
  value: {
    cwd: '/work/proj',
    projectRoot: '/work/proj',
    skills: [
      {
        name: 'codebase-memory',
        description: '图查询',
        source: 'project-dsh',
        provider: 'filesystem',
      },
    ],
    global: { disabled: [] },
    project: ['codebase-memory'],
    diagnostics: { missing: [] },
  },
})
projToggle.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const projPut = fetchCalls.find((c) => c.url.startsWith('/my-skill-manager/api/config') && c !== putCall)
assert.ok(projPut, 'project toggle issues a PUT config call')
const projPayload = JSON.parse(projPut.options.body)
assert.equal(projPayload.scope, 'project', 'project scope saved')
assert.equal(projPayload.cwd, '/work/proj', 'project save carries the session cwd')

// ── issue #91: sort + unused filter interactions ───────────────────────────
// 重置排序/过滤状态并重新挂载（全局视图，无会话）
hookValues.set(6, ['name', hookValues.get(6)[1]])
hookValues.set(7, [false, hookValues.get(7)[1]])
storedSession = null
effectState.ran = false
cannedResponses.push(catalog) // initial list (global view, no session)
renderView()
await new Promise((resolve) => setTimeout(resolve, 0))

const treeS = renderView()
const sortSegs = []
collectByClass(treeS, 'dsh-my-skill-manager-sortseg', sortSegs)
assert.equal(sortSegs.length, 3, 'three sort segments (name/count/lastUsed)')
assert.equal(sortSegs[0].props['aria-pressed'], true, 'name sort active by default')
const rowNames = []
collectByClass(treeS, 'dsh-my-skill-manager-name', rowNames)
assert.deepEqual(
  rowNames.map((n) => n.props.children),
  ['codebase-memory', 'web-search'],
  'name sort order (alphabetical)',
)

// 点击「次数」排序：使用过的 skill 排到前面
sortSegs[1].props.onClick()
const treeS2 = renderView()
const rowNames2 = []
collectByClass(treeS2, 'dsh-my-skill-manager-name', rowNames2)
assert.deepEqual(
  rowNames2.map((n) => n.props.children),
  ['web-search', 'codebase-memory'],
  'count sort puts the used skill first',
)

// 点击「未使用」过滤：只显示未使用的 skill
const unusedBtn = []
collectByClass(treeS2, 'dsh-my-skill-manager-unused', unusedBtn)
assert.equal(unusedBtn.length, 1, 'unused filter button rendered')
assert.equal(unusedBtn[0].props['aria-pressed'], false, 'unused filter off by default')
unusedBtn[0].props.onClick()
const treeS3 = renderView()
const rowNames3 = []
collectByClass(treeS3, 'dsh-my-skill-manager-name', rowNames3)
assert.deepEqual(
  rowNames3.map((n) => n.props.children),
  ['codebase-memory'],
  'unused filter shows only unused skills',
)
const unusedBtn2 = []
collectByClass(treeS3, 'dsh-my-skill-manager-unused', unusedBtn2)
assert.equal(unusedBtn2[0].props['aria-pressed'], true, 'unused filter on after click')

console.log('ALL SKILL-MANAGER CLIENT RENDER-PATH TESTS PASSED')

// ── helpers ────────────────────────────────────────────────────────────────
/** Count rendered `.dsh-my-skill-manager-section` blocks (global view = 1, project view = 1). */
function countSections(node) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  let count = props.className === 'dsh-my-skill-manager-section' ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countSections(c)
    return count
  }
  if (typeof node.type === 'function') return count + countSections(node.type(node.props))
  return count + countSections(props.children)
}

/** Collect elements whose className contains the given member. */
function collectByClass(node, className, out) {
  if (node === null || typeof node !== 'object') return
  const props = node.props ?? {}
  if (Array.isArray(node)) {
    for (const c of node) collectByClass(c, className, out)
    return
  }
  // 函数组件（含官方 Pill/Button stub）：不收集自身——展开结果会透传
  // className，收集展开后的元素即可，避免同一元素被收集两次。
  if (typeof node.type === 'function') {
    const saved = hookIndex
    hookIndex = VIEW_HOOK_COUNT
    collectByClass(node.type(node.props), className, out)
    hookIndex = saved
    return
  }
  if (
    String(props.className ?? '')
      .split(' ')
      .includes(className)
  )
    out.push(node)
  collectByClass(props.children, className, out)
}

/** Collect buttons with an aria-label (switch toggles + icon actions). */
function collectButtons(node, out) {
  if (node === null || typeof node !== 'object') return
  const props = node.props ?? {}
  if (typeof props.onClick === 'function' && typeof props['aria-label'] === 'string') {
    out.push({ label: props['aria-label'], onClick: props.onClick })
  }
  if (Array.isArray(node)) {
    for (const c of node) collectButtons(c, out)
    return
  }
  if (typeof node.type === 'function') {
    const saved = hookIndex
    hookIndex = VIEW_HOOK_COUNT
    collectButtons(node.type(node.props), out)
    hookIndex = saved
    return
  }
  collectButtons(props.children, out)
}

test('script-style suite (assertions ran at module load)', () => {})
