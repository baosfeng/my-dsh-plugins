/**
 * Client render-path test: loads the client bundle with a stubbed react
 * (real createElement; hooks stubbed to stateful no-ops), registers the
 * settings tab through a mocked slots service, then invokes the view
 * component to verify:
 *  - the GLOBAL and PROJECT sections render side by side (project accented),
 *  - memory rows render with edit/delete actions,
 *  - the custom confirmation UI: delete is a red two-step confirm, save/add
 *    is green, and the confirmed write carries `confirmed: true`.
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

// ── 官方组件库 stub（issue #143 试点：模拟真实渲染结构）──────────────────
// Button → <button type=button data-ui=button className=... {...rest}>（icon
// 与 children 直接作为子节点）；Input → <span data-ui=input className=...>
// <input {...rest}/></span>（className 在 wrapper，原生属性在内部 input）；
// Pill → 有 onClick 渲染 button、否则 span（data-ui=pill，className 透传）；
// 图标 → <svg data-icon=.../>。data-ui 标记供「官方组件被使用」断言。
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
  IconChevronDownOutline14: (props) => createElement('svg', { 'data-icon': 'chevron-down', ...props }),
  IconCloseOutline16: (props) => createElement('svg', { 'data-icon': 'close', ...props }),
}

/** Render the tab component once (hooks restart at index 0 each render). */
function renderView() {
  hookIndex = 0
  return capturedTab.component({})
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
// 无当前会话（no-session）场景：localStorage 返回 null → currentSessionId() → ''
global.localStorage = { getItem: () => null }
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
assert.equal(capturedTab.options.id, 'my-memory')
assert.equal(typeof capturedTab.component, 'function')

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
    collectButtons(node.type(node.props), out)
    return
  }
  collectButtons(props.children, out)
}

function collectInputs(node, out) {
  if (node === null || typeof node !== 'object') return
  const props = node.props ?? {}
  const cls = props.className
  if (
    typeof cls === 'string' &&
    (cls.includes('dsh-my-memory-add-input') || cls.includes('dsh-my-memory-path-input'))
  ) {
    // 官方 Input 的 className 在 wrapper span 上（issue #143 试点），
    // onChange/value/placeholder 在内部 input 上——返回内部 input 的 props，
    // 并附 wrapperClass 供断言定位。
    const kids = Array.isArray(props.children) ? props.children : [props.children]
    const inner = kids.find((c) => c !== null && typeof c === 'object' && c.type === 'input')
    out.push(inner ? { ...inner.props, wrapperClass: cls } : { ...props, wrapperClass: cls })
    return
  }
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

/** True when the node tree contains an <svg> element (icon rendering). */
function hasIcon(node) {
  if (node === null || typeof node !== 'object') return false
  if (node.type === 'svg') return true
  if (Array.isArray(node)) return node.some(hasIcon)
  if (typeof node.type === 'function') return hasIcon(node.type(node.props))
  return hasIcon(node.props.children)
}

/** Count official-component markers (data-ui) in the tree (issue #143 试点). */
function countUi(node, marker) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  let count = props['data-ui'] === marker ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countUi(c, marker)
    return count
  }
  if (typeof node.type === 'function') return count + countUi(node.type(node.props), marker)
  return count + countUi(props.children, marker)
}

/** Count official-icon markers (data-icon) in the tree (issue #143 试点). */
function countIcon(node, name) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  let count = props['data-icon'] === name ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countIcon(c, name)
    return count
  }
  if (typeof node.type === 'function') return count + countIcon(node.type(node.props), name)
  return count + countIcon(props.children, name)
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

function countConfirmPanels(node) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  const cls = props.className
  let count =
    typeof cls === 'string' && (cls === 'dsh-my-memory-confirm' || cls.startsWith('dsh-my-memory-confirm ')) ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countConfirmPanels(c)
    return count
  }
  if (typeof node.type === 'function') return count + countConfirmPanels(node.type(node.props))
  return count + countConfirmPanels(props.children)
}

// ── render the view with canned two-scope data ─────────────────────────────
const globalValue = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [
      { id: 'g1', desc: '回复使用中文', createdAt: 1, updatedAt: 2, source: { sessionId: 'sess-abcdef123', at: 3 } },
    ],
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
// 初始挂载 fetch 顺序（view.part.js useEffect 同步执行）：
// 1. GET /my-memory/api/config → { maxEntryLength }（issue #105 精简引导）
// 2. GET /my-memory/api/candidates → []（issue #78 待确认候选；sessionId 空
//    不 fetch /session，global 的 fetchAll 在其后的微任务里发起）
// 3. GET /my-memory/api/memory?scope=global → globalValue
cannedResponses.push({ ok: true, value: { maxEntryLength: 50 } }, { ok: true, value: { items: [] } }, globalValue)

const tree = renderView()
const texts0 = []
walkText(tree, texts0)
assert.ok(texts0.join('|').includes('加载中'), 'initial render shows the loading state')

await new Promise((resolve) => setTimeout(resolve, 0))

// ── re-render: both sections side by side (project empty until loaded) ─────
const tree2 = renderView()
const texts = []
walkText(tree2, texts)
const joined = texts.join('|')

assert.ok(joined.includes('全局记忆'), 'global section present')
assert.ok(joined.includes('项目记忆'), 'project section present')
assert.equal(countSections(tree2), 2, 'both scopes render as sections (side by side)')
assert.ok(joined.includes('回复使用中文'), 'global memory desc rendered')
assert.ok(joined.includes('暂无记忆'), 'project section empty before a project is loaded')
assert.ok(joined.includes('当前无项目会话'), 'project empty state prompts to load a project path')
// ── 回归：confidence 缺失时不渲染"置信度 undefined"；徽标不重复 scope 标签 ──
assert.ok(!joined.includes('置信度 undefined'), 'confidence omitted when missing (no undefined text)')
assert.ok(joined.includes('1 条'), 'global count badge rendered (count only)')
// ── issue #209：带来源的条目展示来源会话前缀，未标记条目不渲染该徽章 ──
assert.ok(joined.includes('agent 保存 · sess-abc'), 'source badge shows the agent session prefix (#209)')
assert.equal(joined.split('agent 保存').length - 1, 1, 'only the session-stamped entry carries the source badge')
const buttons2 = []
collectButtons(tree2, buttons2)
assert.ok(
  buttons2.some((b) => b.label.includes('编辑')),
  'edit action rendered',
)
assert.ok(
  buttons2.some((b) => b.label.includes('删除')),
  'delete action rendered',
)
assert.ok(joined.includes('新增'), 'add bar rendered')
assert.ok(hasIcon(tree2), 'view renders inline svg icons')
// ── issue #143 试点：官方组件使用断言（Input/Pill/Button + 官方图标）────
assert.ok(countUi(tree2, 'input') >= 3, 'official Input used (path + both add inputs)')
assert.ok(countUi(tree2, 'pill') >= 2, 'official Pill used (section badges + sort)')
assert.ok(countUi(tree2, 'button') >= 2, 'official Button used (load + refresh)')
assert.ok(countIcon(tree2, 'refresh') >= 1, 'official refresh icon used')
assert.ok(countIcon(tree2, 'folder') >= 1, 'official folder icon used')

const listCalls = fetchCalls.filter((c) => c.url.startsWith('/my-memory/api/memory') && c.options === undefined)
assert.equal(listCalls.length, 1, 'initial load fetches only the global scope')
assert.ok(listCalls[0].url.includes('scope=global'), 'global fetch')

// ── load a project path: project memory + root badge appear ────────────────
const pathInputs0 = []
collectInputs(tree2, pathInputs0)
const pathInput0 = pathInputs0.find((i) => i.wrapperClass.includes('dsh-my-memory-path-input'))
assert.ok(pathInput0, 'project path input rendered')
pathInput0.onChange({ target: { value: '/work/proj' } })
const tree2b = renderView()
const buttons2b = []
collectButtons(tree2b, buttons2b)
const loadBtn0 = buttons2b.find((b) => b.label.includes('加载'))
assert.ok(loadBtn0, 'load button rendered')
// fetchAll 会同时请求 global + project 两个 scope
cannedResponses.push(globalValue, projectValue)
loadBtn0.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const tree2c = renderView()
const texts2c = []
walkText(tree2c, texts2c)
const joined2c = texts2c.join('|')
assert.ok(joined2c.includes('本项目用 vitest'), 'project memory desc rendered after load')
assert.ok(joined2c.includes('项目根：/work/proj'), 'project root badge rendered')

// ── delete flow: red two-step confirm, then POST with confirmed: true ─────
const buttons = []
collectButtons(tree2c, buttons)
const deleteBtn = buttons.find((b) => b.label.includes('删除') && b.label.includes('p1'))
assert.ok(deleteBtn, 'delete button for the project memory found')
deleteBtn.onClick()
const tree3 = renderView()
const texts3 = []
walkText(tree3, texts3)
const joined3 = texts3.join('|')
assert.ok(joined3.includes('确定删除这条记忆'), 'delete confirmation text shown')
assert.ok(joined3.includes('确认删除'), 'red confirm-delete button shown')
assert.equal(countConfirmPanels(tree3), 1, 'one confirmation panel open')

// 取消：确认面板消失
const cancelBtn = collectCancel(tree3)
assert.ok(cancelBtn, 'cancel button in the confirm panel')
cancelBtn.onClick()
const tree3b = renderView()
assert.equal(countConfirmPanels(tree3b), 0, 'cancel closes the confirmation panel')

// 再次删除并确认
deleteBtn.onClick()
const tree4 = renderView()
const confirmDelete = collectConfirmOk(tree4)
assert.ok(confirmDelete, 'confirm-delete button found')
cannedResponses.push({
  ok: true,
  value: { scope: 'project', cwd: '/work/proj', projectRoot: '/work/proj', items: [] },
})
confirmDelete.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const deleteCall = fetchCalls.find(
  (c) => c.options !== undefined && c.options.method === 'POST' && JSON.parse(c.options.body).action === 'delete',
)
assert.ok(deleteCall, 'confirmed delete issues a POST')
const deletePayload = JSON.parse(deleteCall.options.body)
assert.equal(deletePayload.action, 'delete')
assert.equal(deletePayload.scope, 'project')
assert.equal(deletePayload.id, 'p1')
assert.equal(deletePayload.confirmed, true, 'write carries the user-consent marker')

// ── add flow: green confirm, then POST with confirmed: true ────────────────
const tree5 = renderView()
const inputs = []
collectInputs(tree5, inputs)
const globalAddInput = inputs.find(
  (i) => i.wrapperClass.includes('dsh-my-memory-add-input') && i.placeholder.includes('记住'),
)
assert.ok(globalAddInput, 'global add input found')
globalAddInput.onChange({ target: { value: '新记忆内容' } })
const tree6 = renderView()
const buttons6 = []
collectButtons(tree6, buttons6)
const addBtn = buttons6.find((b) => b.label.includes('新增') && b.label.includes('global'))
assert.ok(addBtn, 'global add button found')
addBtn.onClick()
const tree7 = renderView()
const texts7 = []
walkText(tree7, texts7)
const joined7 = texts7.join('|')
assert.ok(joined7.includes('确认新增这条记忆'), 'add confirmation text shown')
assert.ok(joined7.includes('确认保存'), 'green confirm-save button shown')
const confirmSave = collectConfirmOk(tree7)
assert.ok(confirmSave, 'confirm-save button found')
cannedResponses.push({
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [
      { id: 'g1', desc: '回复使用中文', createdAt: 1, updatedAt: 2 },
      { id: 'g2', desc: '新记忆内容', createdAt: 3, updatedAt: 3 },
    ],
  },
})
confirmSave.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const addCall = fetchCalls.find(
  (c) => c.options !== undefined && c.options.method === 'POST' && JSON.parse(c.options.body).action === 'add',
)
assert.ok(addCall, 'confirmed add issues a POST')
const addPayload = JSON.parse(addCall.options.body)
assert.equal(addPayload.action, 'add')
assert.equal(addPayload.scope, 'global')
assert.equal(addPayload.desc, '新记忆内容')
assert.equal(addPayload.confirmed, true, 'add carries the user-consent marker')

// ── edit flow: edit mode input + green save confirm ───────────────────────
const tree8 = renderView()
const buttons8 = []
collectButtons(tree8, buttons8)
const editBtn = buttons8.find((b) => b.label.includes('编辑') && b.label.includes('g1'))
assert.ok(editBtn, 'edit button found')
editBtn.onClick()
const tree9 = renderView()
const texts9 = []
walkText(tree9, texts9)
assert.ok(texts9.join('|').includes('保存'), 'edit mode shows the save button')
const editInputs = []
collectInputs(tree9, editInputs)
const editInput = editInputs.find(
  (i) => i.wrapperClass.includes('dsh-my-memory-add-input') && i.value === '回复使用中文',
)
assert.ok(editInput, 'edit input prefilled with the current desc')
editInput.onChange({ target: { value: '回复必须使用中文' } })
const tree10 = renderView()
const buttons10 = []
collectButtons(tree10, buttons10)
// 编辑模式的保存按钮没有 aria-label，直接找 dsh-my-memory-btn-save
const saveEdit = findSaveButton(tree10)
assert.ok(saveEdit, 'edit save button found')
saveEdit.onClick()
const tree11 = renderView()
const texts11 = []
walkText(tree11, texts11)
assert.ok(texts11.join('|').includes('确认保存这条记忆'), 'update confirmation text shown')
const confirmUpdate = collectConfirmOk(tree11)
assert.ok(confirmUpdate, 'confirm-update button found')
cannedResponses.push({
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [{ id: 'g1', desc: '回复必须使用中文', createdAt: 1, updatedAt: 4 }],
  },
})
confirmUpdate.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const updateCall = fetchCalls.find(
  (c) => c.options !== undefined && c.options.method === 'POST' && JSON.parse(c.options.body).action === 'update',
)
assert.ok(updateCall, 'confirmed update issues a POST')
const updatePayload = JSON.parse(updateCall.options.body)
assert.equal(updatePayload.action, 'update')
assert.equal(updatePayload.id, 'g1')
assert.equal(updatePayload.desc, '回复必须使用中文')
assert.equal(updatePayload.confirmed, true, 'update carries the user-consent marker')

// ── project path input: load a project refreshes the project scope ────────
const tree12 = renderView()
const pathInputs = []
collectInputs(tree12, pathInputs)
const pathInput = pathInputs.find((i) => i.wrapperClass.includes('dsh-my-memory-path-input'))
assert.ok(pathInput, 'project path input rendered')
pathInput.onChange({ target: { value: '/work/other' } })
const tree13 = renderView()
const buttons13 = []
collectButtons(tree13, buttons13)
const loadBtn = buttons13.find((b) => b.label.includes('加载'))
assert.ok(loadBtn, 'load button rendered')
cannedResponses.push(globalValue, {
  ok: true,
  value: { scope: 'project', cwd: '/work/other', projectRoot: '/work/other', items: [] },
})
loadBtn.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const tree14 = renderView()
const texts14 = []
walkText(tree14, texts14)
assert.ok(texts14.join('|').includes('项目根：/work/other'), 'project root badge updated after load')

// ── issue #110 视觉重设计断言：排序 / 相对时间 / 截断展开 ─────────────────
assert.equal(typeof exportsObj.sortMemories, 'function', 'sortMemories helper exported')
assert.equal(typeof exportsObj.relativeTime, 'function', 'relativeTime helper exported')
assert.equal(typeof exportsObj.truncateText, 'function', 'truncateText helper exported')

// 排序：desc 最新在顶、asc 最旧在顶，且不修改原数组
const sortInput = [
  { id: 'a', desc: 'A', updatedAt: 200 },
  { id: 'b', desc: 'B', updatedAt: 100 },
]
const descItems = exportsObj.sortMemories(sortInput, 'desc')
assert.deepEqual(
  descItems.map((i) => i.id),
  ['a', 'b'],
  'desc orders updated-desc first',
)
const ascItems = exportsObj.sortMemories(sortInput, 'asc')
assert.deepEqual(
  ascItems.map((i) => i.id),
  ['b', 'a'],
  'asc orders updated-asc first',
)
assert.equal(sortInput[0].id, 'a', 'sortMemories does not mutate the input array')

// 截断：超过上限截断 + 「…」收尾，未超限原样返回
const longCut = exportsObj.truncateText('A'.repeat(64), 60)
assert.equal(longCut.truncated, true, 'long text flags truncated')
assert.equal(longCut.text, `${'A'.repeat(60)}…`, 'long text truncated with ellipsis')
const shortCut = exportsObj.truncateText('短内容', 60)
assert.equal(shortCut.truncated, false, 'short text not truncated')
assert.equal(shortCut.text, '短内容', 'short text returned unchanged')

// 相对时间：一分钟内「刚刚」、数分钟「n 分钟前」
assert.equal(exportsObj.relativeTime(Date.now() - 30 * 1000), '刚刚', 'under a minute is 刚刚')
assert.equal(exportsObj.relativeTime(Date.now() - 5 * 60 * 1000), '5 分钟前', 'five minutes shows 5 分钟前')

// 渲染态：重新加载含长条目的全局数据，验证排序 + 截断展开
const freshGlobal = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [
      { id: 'long', desc: 'A'.repeat(64), createdAt: 200, updatedAt: 200 },
      { id: 'short', desc: 'OLDER-ITEM', createdAt: 100, updatedAt: 100 },
    ],
  },
}
const reloadInputs = []
collectInputs(renderView(), reloadInputs)
const reloadInput = reloadInputs.find((i) => i.wrapperClass.includes('dsh-my-memory-path-input'))
reloadInput.onChange({ target: { value: '' } })
const reloadTree = renderView()
const reloadButtons = []
collectButtons(reloadTree, reloadButtons)
const refreshBtn = reloadButtons.find((b) => b.label.includes('刷新'))
assert.ok(refreshBtn, 'refresh button found for reload')
cannedResponses.push(freshGlobal)
refreshBtn.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const sortedTree = renderView()
const sortedTexts = []
walkText(sortedTree, sortedTexts)
const sortedJoined = sortedTexts.join('|')
const truncatedLong = `${'A'.repeat(60)}…`
assert.ok(sortedJoined.includes(truncatedLong), 'long item renders truncated')
assert.ok(!sortedJoined.includes('A'.repeat(64)), 'long item is not expanded before the user opens it')
assert.ok(sortedJoined.indexOf(truncatedLong) < sortedJoined.indexOf('OLDER-ITEM'), 'newest-updated item sorts first')

const sortedBtns = []
collectButtons(sortedTree, sortedBtns)
const expandBtn = sortedBtns.find((b) => b.label.includes('展开'))
assert.ok(expandBtn, 'expand button renders for a truncated item')
expandBtn.onClick()
const expandedTree = renderView()
const expandedTexts = []
walkText(expandedTree, expandedTexts)
assert.ok(expandedTexts.join('|').includes('A'.repeat(64)), 'expand reveals the full text')
const collapseBtns = []
collectButtons(expandedTree, collapseBtns)
const collapseBtn = collapseBtns.find((b) => b.label.includes('收起'))
assert.ok(collapseBtn, 'collapse button renders while expanded')
collapseBtn.onClick()
const collapsedTree = renderView()
const collapsedTexts = []
walkText(collapsedTree, collapsedTexts)
assert.ok(collapsedTexts.join('|').includes(truncatedLong), 'collapse truncates the text again')

// 排序开关：点击后切到最旧优先，顺序反转
const flipBtns = []
collectButtons(collapsedTree, flipBtns)
const flipBtn = flipBtns.find((b) => b.label.includes('按更新时间排序'))
assert.ok(flipBtn, 'sort toggle button renders')
flipBtn.onClick()
const flippedTree = renderView()
const flippedTexts = []
walkText(flippedTree, flippedTexts)
const flippedJoined = flippedTexts.join('|')
assert.ok(
  flippedJoined.indexOf('OLDER-ITEM') < flippedJoined.indexOf(truncatedLong),
  'toggling sort flips to oldest-updated first',
)

// ── issue #105 记忆内容精简：概要/详情两级展示 + 保存精简引导 ─────────────
assert.equal(
  exportsObj.firstSentence('回复使用中文。代码注释也要中文。'),
  '回复使用中文。',
  'firstSentence helper exported',
)

// 概要渲染：多句条目列表只显示首句（概要），点击展开显示完整详情
const multiSentenceValue = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [
      { id: 'm1', desc: '这是重要约定。这是详细解释不应该铺开在列表里。', createdAt: 100, updatedAt: 100 },
      { id: 'short', desc: '短条目', createdAt: 200, updatedAt: 200 },
    ],
  },
}
const reloadInputs105 = []
collectInputs(renderView(), reloadInputs105)
reloadInputs105.find((i) => i.wrapperClass.includes('dsh-my-memory-path-input')).onChange({ target: { value: '' } })
const reloadTree105 = renderView()
const reloadButtons105 = []
collectButtons(reloadTree105, reloadButtons105)
cannedResponses.push(multiSentenceValue)
reloadButtons105.find((b) => b.label.includes('刷新')).onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const summaryTree = renderView()
const summaryTexts = []
walkText(summaryTree, summaryTexts)
const summaryJoined = summaryTexts.join('|')
assert.ok(summaryJoined.includes('这是重要约定。'), 'list shows the first sentence as the summary')
assert.ok(!summaryJoined.includes('这是详细解释不应该铺开在列表里'), 'list hides the detail sentences')
const expandBtns105 = []
collectButtons(summaryTree, expandBtns105)
// 刷新后列表只有 m1（多句 → 概要截断，有展开按钮）与 short（短 → 无），
// 唯一的「展开」按钮即属于多句条目
const expandBtn105 = expandBtns105.find((b) => b.label.includes('展开'))
assert.ok(expandBtn105, 'expand button renders for a multi-sentence item')
expandBtn105.onClick()
const expandedTree105 = renderView()
const expandedTexts105 = []
walkText(expandedTree105, expandedTexts105)
assert.ok(
  expandedTexts105.join('|').includes('这是详细解释不应该铺开在列表里'),
  'clicking the summary expands to the FULL desc (detail level)',
)

// 输入超长提示：超过 maxEntryLength（config: 50）时出现精简提示
const longDraftInputs = []
collectInputs(renderView(), longDraftInputs)
const longDraftInput = longDraftInputs.find(
  (i) => i.wrapperClass.includes('dsh-my-memory-add-input') && i.placeholder.includes('记住'),
)
assert.ok(longDraftInput, 'global add input found')
longDraftInput.onChange({ target: { value: 'x'.repeat(51) } })
const longDraftTree = renderView()
const longDraftTexts = []
walkText(longDraftTree, longDraftTexts)
assert.ok(longDraftTexts.join('|').includes('内容过长'), 'typing beyond maxEntryLength shows the concise-entry hint')
assert.ok(longDraftTexts.join('|').includes('建议精简为 1-2 句'), 'hint suggests 1-2 sentences')
// 短内容不提示
longDraftInput.onChange({ target: { value: '短内容' } })
const shortDraftTree = renderView()
const shortDraftTexts = []
walkText(shortDraftTree, shortDraftTexts)
assert.ok(!shortDraftTexts.join('|').includes('内容过长'), 'short draft shows no hint')

// 确认面板概要预览：超长 add 时确认面板说明「保存完整内容 + 显示概要」
longDraftInput.onChange({
  target: {
    value: '保存这句完整内容。这句是较长的详情内容，会完整保留在存储中，同时列表与注入只展示概要首句以保持可扫读性。',
  },
})
const confirmDraftTree = renderView()
const addBtns105 = []
collectButtons(confirmDraftTree, addBtns105)
const addBtn105 = addBtns105.find((b) => b.label.includes('新增') && b.label.includes('global'))
assert.ok(addBtn105, 'add button found')
addBtn105.onClick()
const previewTree = renderView()
const previewTexts = []
walkText(previewTree, previewTexts)
const previewJoined = previewTexts.join('|')
assert.ok(previewJoined.includes('确认新增这条记忆'), 'add confirmation shown')
assert.ok(previewJoined.includes('将保存完整内容'), 'confirm panel previews the summary for a long entry')
assert.ok(previewJoined.includes('保存这句完整内容。'), 'summary preview shows the first sentence')
// 取消，避免污染后续流程
const previewCancel = collectCancel(previewTree)
assert.ok(previewCancel, 'cancel button present in the preview panel')
previewCancel.onClick()

console.log('ALL MY-MEMORY CLIENT RENDER-PATH TESTS PASSED')

// ── helpers for button collection (no aria-label on some buttons) ─────────
function collectCancel(node) {
  return collectByClass(node, 'dsh-my-memory-confirm-cancel')
}
function collectConfirmOk(node) {
  return collectByClass(node, 'dsh-my-memory-confirm-ok')
}
function findSaveButton(node) {
  return collectByClass(node, 'dsh-my-memory-btn-save')
}
function collectByClass(node, className) {
  if (node === null || typeof node !== 'object') return undefined
  const props = node.props ?? {}
  const cls = props.className
  if (typeof cls === 'string' && cls.split(' ').includes(className) && typeof props.onClick === 'function') return props
  if (Array.isArray(node)) {
    for (const c of node) {
      const hit = collectByClass(c, className)
      if (hit) return hit
    }
    return undefined
  }
  if (typeof node.type === 'function') return collectByClass(node.type(node.props), className)
  return collectByClass(props.children, className)
}

test('script-style suite (assertions ran at module load)', () => {})
