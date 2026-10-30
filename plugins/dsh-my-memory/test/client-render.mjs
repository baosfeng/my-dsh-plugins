/**
 * Client render-path test: loads the client bundle with a stubbed react
 * (real createElement; hooks stubbed to stateful no-ops), registers the
 * settings tab through a mocked slots service, then invokes the view
 * component to verify the three-tab settings panel:
 *  - tabs: 全局记忆 / 项目记忆 / 全局提示词 (one section visible at a time),
 *  - memory rows render with category/confidence/source metadata + actions,
 *  - the composer is a self-growing textarea with a char counter,
 *  - the confirmation panel is a centered overlay (delete red / save green)
 *    and the confirmed write carries `confirmed: true`,
 *  - prompts (toggle / reorder / edit / delete / add) use their own endpoint.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react (stateful hooks, per component instance) ────────────────
// hook 状态按「组件实例 + 序号」隔离，与 React 一致（不同组件的 hook 不共享
// 槽位）。视图里有自持状态的子分区（提示词），因此隔离是必需的：共享槽位时
// 子分区的 hook 会顶掉父视图的槽位，表现为「记忆列表渲染不出来」的假红。
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
  hookIndex = 0
  try {
    return render()
  } finally {
    hookComponentId = outerId
    hookIndex = outerIndex
  }
}

/** 组件实例身份：类型名 + 判别键（scope / key / id），同名同键只算一个实例。 */
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

// ── 官方组件库 stub：只暴露宿主 0.1.7-rc.2 真实存在的导出 ────────────────
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

/** 防回归（React error #130）：遍历渲染树（展开函数组件），断言不存在
 *  `undefined` / 非法元素类型——宿主缺失图标导出时整块内容区白屏。 */
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

/** Render the tab component once (hooks restart at index 0 each render). */
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

/** 模拟「关闭再打开设置面板」：清空 hook 槽位后重新挂载，useEffect 重新拉数据。 */
function remountView() {
  hookValues.clear()
  effectRan.clear()
  componentSeen.clear()
  return renderView()
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
const PROMPT_SEED = {
  id: 'gp-seed-think-zh',
  title: '中文思考',
  text: '思考过程必须使用简体中文书写。',
  enabled: true,
  order: 10,
  builtin: 'builtin:think-zh',
}
const PROMPT_OFF = { id: 'gp-1', title: '停用规则', text: '这条不注入。', enabled: false, order: 20 }
const PROMPTS_RESPONSE = { ok: true, value: { items: [PROMPT_SEED, PROMPT_OFF] } }
const CONFIG_RESPONSE = { ok: true, value: { maxEntryLength: 50 } }
const FIXED_RESPONSES = {
  '/my-memory/api/config': CONFIG_RESPONSE,
  '/my-memory/api/prompts': PROMPTS_RESPONSE,
  // agent 记忆面板挂载即拉一次（issue #502）：固定空响应，不占用 FIFO 队列
  '/my-memory/api/agent-memory': { ok: true, value: { items: [] } },
}
global.fetch = (url, options) => {
  const target = String(url)
  fetchCalls.push({ url: target, options })
  // 固定响应只用于 GET：POST /prompts 与 GET /prompts 同 URL，若不分方法会把
  // 写操作响应错位成读操作响应（表现为记忆列表被提示词数据覆盖）。
  const fixed = options === undefined ? (FIXED_RESPONSES[target] ?? null) : null
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

/** 收集输入控件：原生 textarea + 官方 Input 的内层 input（className 在 wrapper）。 */
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

function countByClass(node, className) {
  if (node === null || typeof node !== 'object') return 0
  const props = node.props ?? {}
  const cls = props.className
  let count = typeof cls === 'string' && cls.split(' ').includes(className) ? 1 : 0
  if (Array.isArray(node)) {
    for (const c of node) count += countByClass(c, className)
    return count
  }
  if (typeof node.type === 'function') return count + countByClass(renderComponent(node.type, node.props), className)
  return count + countByClass(props.children, className)
}

function countSections(node) {
  return countByClass(node, 'dsh-my-memory-section')
}

function findByClassContaining(node, className) {
  if (node === null || typeof node !== 'object') return undefined
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.includes(className)) return node
  if (Array.isArray(node)) {
    for (const c of node) {
      const hit = findByClassContaining(c, className)
      if (hit) return hit
    }
    return undefined
  }
  if (typeof node.type === 'function') return findByClassContaining(renderComponent(node.type, node.props), className)
  return findByClassContaining(node.props?.children, className)
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
  if (typeof node.type === 'function') return collectByClass(renderComponent(node.type, node.props), className)
  return collectByClass(props.children, className)
}

function findTab(tree, label) {
  const buttons = []
  collectButtons(tree, buttons)
  return buttons.find((b) => b.role === 'tab' && b.label === label)
}
function clickTab(label) {
  const btn = findTab(renderView(), label)
  assert.ok(btn, `tab ${label} rendered`)
  btn.onClick()
  return renderView()
}

// ── 初始渲染：默认全局 tab + loading 态 ─────────────────────────────────────
const globalValue = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [
      {
        id: 'g1',
        desc: '回复使用中文',
        category: 'preference',
        confidence: 3,
        createdAt: 1,
        updatedAt: 2,
        source: { sessionId: 'sess-abcdef123', at: 3 },
      },
    ],
  },
}
cannedResponses.push(globalValue)

const loadingTree = renderView()
assert.ok(joinedText(loadingTree).includes('加载中'), 'initial render shows the loading state')

await new Promise((resolve) => setTimeout(resolve, 0))
renderView()
await new Promise((resolve) => setTimeout(resolve, 0))
const tree2 = renderView()
const joined = joinedText(tree2)

assert.ok(joined.includes('全局记忆'), 'global tab label rendered')
assert.ok(joined.includes('项目记忆'), 'project tab label rendered')
assert.ok(joined.includes('全局提示词'), 'prompts tab label rendered')
assert.equal(countSections(tree2), 1, 'exactly one tab panel visible at a time (global)')
assert.ok(joined.includes('回复使用中文'), 'global memory desc rendered')
assert.ok(joined.includes('偏好'), 'category badge rendered')
assert.ok(joined.includes('3/5'), 'confidence dots + ratio rendered')
// 来源会话与演进历史移入展开详情（列表行只留内容 / 分类 / 置信度 / 时间）
const expandBtns0 = []
collectButtons(tree2, expandBtns0)
const expand0 = expandBtns0.find((b) => b.label.includes('展开'))
assert.ok(expand0, 'the description itself is the expand control')
expand0.onClick()
const detailJoined = joinedText(renderView())
assert.ok(detailJoined.includes('agent 保存 · sess-abc'), 'source session shown inside the detail')
assert.ok(detailJoined.includes('演进历史'), 'history label shown inside the detail')
const collapseBtns0 = []
collectButtons(renderView(), collapseBtns0)
const collapse0 = collapseBtns0.find((b) => b.label.includes('收起'))
assert.ok(collapse0, 'expanded row offers a collapse control')
collapse0.onClick()
assert.ok(!joinedText(renderView()).includes('演进历史'), 'collapsing hides the detail block')
assert.ok(!joined.includes('置信度 undefined'), 'confidence omitted when missing (no undefined text)')

const listCalls = fetchCalls.filter((c) => c.url.startsWith('/my-memory/api/memory') && c.options === undefined)
assert.equal(listCalls.length, 1, 'initial load fetches the global scope once')
assert.ok(listCalls[0].url.includes('scope=global'), 'global fetch')
const candidatesCalls = fetchCalls.filter((c) => c.url.includes('/candidates'))
assert.equal(candidatesCalls.length, 0, 'no candidate endpoint is ever requested (feature removed)')

// composer：多行 textarea + 字数计数
const composerInputs = []
collectInputs(tree2, composerInputs)
const composer = composerInputs.find((i) => i.tag === 'textarea' && String(i.placeholder).includes('记住'))
assert.ok(composer, 'add composer is a textarea (self-growing)')
assert.equal(composer.value, '', 'composer starts empty')
assert.ok(joined.includes('0 / 50'), 'composer shows the char counter')
assert.ok(joined.includes('所有新增 / 修改 / 删除都需要你确认'), 'composer shows the consent hint')

// ── tab: 项目记忆（无会话 cwd → 空态提示）────────────────────────────────
const projectTree = clickTab('项目记忆')
const projectJoined = joinedText(projectTree)
assert.equal(countSections(projectTree), 1, 'project tab renders one section')
assert.ok(projectJoined.includes('当前无项目会话'), 'project tab shows the no-session empty hint')
const projectInputs = []
collectInputs(projectTree, projectInputs)
assert.ok(
  !projectInputs.some((i) => i.wrapperClass && i.wrapperClass.includes('path')),
  'no project path input anymore (removed per product decision)',
)

// ── tab: 全局提示词 ───────────────────────────────────────────────────────
const promptsTree = clickTab('全局提示词')
const promptsJoined = joinedText(promptsTree)
assert.equal(countSections(promptsTree), 1, 'prompts tab renders one section')
assert.ok(promptsJoined.includes('中文思考'), 'seeded prompt title rendered')
assert.ok(promptsJoined.includes('思考过程必须使用简体中文书写。'), 'prompt body rendered')
assert.ok(promptsJoined.includes('内置'), 'builtin badge rendered for the seed')
assert.ok(promptsJoined.includes('已停用'), 'disabled prompt is visible with its state')

// 提示词启停：switch 按钮（role=switch + aria-label）→ POST toggle + confirmed
const promptsButtons = []
collectButtons(promptsTree, promptsButtons)
const toggleBtn = promptsButtons.find((b) => b.label.includes('停用') && b.label.includes('gp-seed-think-zh'))
assert.ok(toggleBtn, 'enable/disable switch rendered for the seed prompt')
cannedResponses.push({ ok: true, value: { items: [{ ...PROMPT_SEED, enabled: false }, PROMPT_OFF], item: null } })
toggleBtn.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const toggleCall = fetchCalls.find(
  (c) =>
    c.options !== undefined && c.url === '/my-memory/api/prompts' && JSON.parse(c.options.body).action === 'toggle',
)
assert.ok(toggleCall, 'toggling issues a POST to /my-memory/api/prompts')
assert.equal(JSON.parse(toggleCall.options.body).enabled, false)
assert.equal(JSON.parse(toggleCall.options.body).confirmed, true, 'toggle carries the consent marker')

// 排序：上移 / 下移 → reorder POST
const reorderTree = renderView()
const reorderButtons = []
collectButtons(reorderTree, reorderButtons)
const moveDown = reorderButtons.find((b) => b.label.includes('下移') && b.label.includes('gp-seed-think-zh'))
assert.ok(moveDown, 'move-down control rendered')
cannedResponses.push({ ok: true, value: { items: [PROMPT_OFF, { ...PROMPT_SEED, enabled: false }], item: null } })
moveDown.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const reorderCall = fetchCalls.find(
  (c) =>
    c.options !== undefined && c.url === '/my-memory/api/prompts' && JSON.parse(c.options.body).action === 'reorder',
)
assert.ok(reorderCall, 'moving issues a reorder POST')
assert.equal(JSON.parse(reorderCall.options.body).direction, 'down')

// ── 回到全局 tab：新增 → 居中确认弹层 → POST ──────────────────────────────
clickTab('全局记忆')
const addInputs = []
collectInputs(renderView(), addInputs)
const addComposer = addInputs.find((i) => i.tag === 'textarea' && String(i.placeholder).includes('记住'))
assert.ok(addComposer, 'global composer rendered')
addComposer.onChange({ target: { value: '新记忆内容' } })
const typedTree = renderView()
assert.ok(joinedText(typedTree).includes('5 / 50'), 'char counter follows the draft')

const addBtns = []
collectButtons(typedTree, addBtns)
const addBtn = addBtns.find((b) => b.label === '新增 global')
assert.ok(addBtn, 'add button rendered for the global scope')
addBtn.onClick()

const confirmTree = renderView()
const confirmJoined = joinedText(confirmTree)
assert.ok(confirmJoined.includes('确认新增这条记忆'), 'add confirmation text shown')
assert.ok(confirmJoined.includes('确认保存'), 'green confirm-save button shown')
assert.equal(countByClass(confirmTree, 'dsh-my-memory-overlay'), 1, 'confirmation renders in a centered overlay')
assert.equal(countByClass(confirmTree, 'dsh-my-memory-confirm'), 1, 'one confirmation card open')

const confirmSave = collectByClass(
  findByClassContaining(confirmTree, 'dsh-my-memory-overlay'),
  'dsh-my-memory-confirm-ok',
)
assert.ok(confirmSave, 'confirm-save button found')
cannedResponses.push({
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [globalValue.value.items[0], { id: 'g2', desc: '新记忆内容', createdAt: 3, updatedAt: 3 }],
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
assert.ok(joinedText(renderView()).includes('已保存'), 'saved status shown after the write')

// ── 编辑：inline textarea → 确认 → POST ────────────────────────────────────
const editButtons = []
collectButtons(renderView(), editButtons)
const editBtn = editButtons.find((b) => b.label.includes('编辑') && b.label.includes('g1'))
assert.ok(editBtn, 'edit action rendered')
editBtn.onClick()
const editTree = renderView()
const editInputs = []
collectInputs(editTree, editInputs)
const editInput = editInputs.find((i) => i.tag === 'textarea' && i.value === '回复使用中文')
assert.ok(editInput, 'edit textarea prefilled with the current desc')
editInput.onChange({ target: { value: '回复必须使用中文' } })
const saveEdit = collectByClass(renderView(), 'dsh-my-memory-btn-save')
assert.ok(saveEdit, 'edit save button found')
saveEdit.onClick()
const updateConfirmTree = renderView()
assert.ok(joinedText(updateConfirmTree).includes('确认保存这条记忆'), 'update confirmation text shown')
assert.equal(countByClass(updateConfirmTree, 'dsh-my-memory-overlay'), 1, 'update confirmation is an overlay')
const confirmUpdate = collectByClass(updateConfirmTree, 'dsh-my-memory-confirm-ok')
assert.ok(confirmUpdate, 'confirm-update button found')
cannedResponses.push({
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [{ id: 'g1', desc: '回复必须使用中文', category: 'preference', confidence: 3, createdAt: 1, updatedAt: 4 }],
  },
})
confirmUpdate.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const updateCall = fetchCalls.find((c) => c.options !== undefined && JSON.parse(c.options.body).action === 'update')
assert.ok(updateCall, 'confirmed update issues a POST')
assert.equal(JSON.parse(updateCall.options.body).id, 'g1')
assert.equal(JSON.parse(updateCall.options.body).desc, '回复必须使用中文')
assert.equal(JSON.parse(updateCall.options.body).confirmed, true)

// ── 删除：红色确认（两步）→ POST ─────────────────────────────────────────
const delButtons = []
collectButtons(renderView(), delButtons)
const deleteBtn = delButtons.find((b) => b.label.includes('删除') && b.label.includes('g1'))
assert.ok(deleteBtn, 'delete action rendered')
deleteBtn.onClick()
const delConfirmTree = renderView()
const delJoined = joinedText(delConfirmTree)
assert.ok(delJoined.includes('确定删除这条记忆'), 'delete confirmation text shown')
assert.ok(delJoined.includes('确认删除'), 'confirm-delete button shown')
assert.equal(countByClass(delConfirmTree, 'dsh-my-memory-overlay'), 1, 'delete confirmation is an overlay')
const confirmDelete = collectByClass(delConfirmTree, 'dsh-my-memory-confirm-ok')
assert.ok(confirmDelete, 'confirm-delete button found')
cannedResponses.push({ ok: true, value: { scope: 'global', cwd: '', projectRoot: '', items: [] } })
confirmDelete.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const deleteCall = fetchCalls.find(
  (c) =>
    c.options !== undefined && JSON.parse(c.options.body).action === 'delete' && JSON.parse(c.options.body).id === 'g1',
)
assert.ok(deleteCall, 'confirmed delete issues a POST')
assert.equal(JSON.parse(deleteCall.options.body).confirmed, true, 'delete carries the consent marker')

// 取消：确认弹层关闭且不发请求
const beforeCancelCalls = fetchCalls.length
const composerInputs2 = []
collectInputs(renderView(), composerInputs2)
assert.ok(composerInputs2.length > 0, 'view still renders after writes')
assert.equal(fetchCalls.length, beforeCancelCalls, 'no request while idle')

// ── 排序 / 截断 / 展开 / 超长提示 / 概要预览 ──────────────────────────────
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
// 重新打开面板 → 重新拉取全局记忆（响应来自队列）
cannedResponses.push(freshGlobal)
remountView()
await new Promise((resolve) => setTimeout(resolve, 0))
const freshTree = renderView()
assert.ok(joinedText(freshTree).includes('OLDER-ITEM'), 'fresh memory data loaded after remount')

// 排序开关：点击后切到最旧优先（按钮 label 固定为「按更新时间排序 global」）
const sortButtons = []
collectButtons(freshTree, sortButtons)
const sortBtn = sortButtons.find((b) => b.label.includes('按更新时间排序'))
assert.ok(sortBtn, 'sort toggle rendered')
sortBtn.onClick()
const sortedTree = renderView()
const sortedJoined = joinedText(sortedTree)
assert.ok(sortedJoined.includes('OLDER-ITEM'), 'sort toggle still renders the rows after flip')

// 截断与展开：多句条目列表显示首句概要，展开后显示全文
const multiValue = {
  ok: true,
  value: {
    scope: 'global',
    cwd: '',
    projectRoot: '',
    items: [{ id: 'm1', desc: '这是重要约定。这是详细解释不应该铺开在列表里。', createdAt: 100, updatedAt: 100 }],
  },
}
cannedResponses.push(multiValue)
remountView()
await new Promise((resolve) => setTimeout(resolve, 0))
const summaryTree = renderView()
const summaryJoined = joinedText(summaryTree)
assert.ok(summaryJoined.includes('这是重要约定。'), 'list shows the first sentence as the summary')
assert.ok(!summaryJoined.includes('这是详细解释不应该铺开在列表里'), 'list hides the detail sentences')
const expandButtons = []
collectButtons(summaryTree, expandButtons)
const expandBtn = expandButtons.find((b) => b.label.includes('展开'))
assert.ok(expandBtn, 'expand button renders for a truncated item')
expandBtn.onClick()
assert.ok(joinedText(renderView()).includes('这是详细解释不应该铺开在列表里'), 'expand reveals the full text')

// 超长输入提示（超过 config maxEntryLength=50）
const longInputs = []
collectInputs(renderView(), longInputs)
const longInput = longInputs.find((i) => i.tag === 'textarea' && String(i.placeholder).includes('记住'))
assert.ok(longInput, 'global composer rendered')
longInput.onChange({ target: { value: 'x'.repeat(51) } })
const longJoined = joinedText(renderView())
assert.ok(longJoined.includes('内容过长'), 'typing beyond maxEntryLength shows the concise-entry hint')
assert.ok(longJoined.includes('建议精简为 1-2 句'), 'hint suggests 1-2 sentences')

// 概要预览：超长 add 确认面板说明「保存完整内容 + 显示概要」
longInput.onChange({
  target: {
    value: '保存这句完整内容。这句是较长的详情内容，会完整保留在存储中，同时列表与注入只展示概要首句以保持可扫读性。',
  },
})
const previewAddButtons = []
collectButtons(renderView(), previewAddButtons)
const previewAdd = previewAddButtons.find((b) => b.label === '新增 global')
assert.ok(previewAdd, 'add button found')
previewAdd.onClick()
const previewJoined = joinedText(renderView())
assert.ok(previewJoined.includes('将保存完整内容'), 'confirm panel previews the summary for a long entry')
assert.ok(previewJoined.includes('保存这句完整内容。'), 'summary preview shows the first sentence')
const previewCancel = collectByClass(renderView(), 'dsh-my-memory-confirm-cancel')
assert.ok(previewCancel, 'cancel button present in the preview panel')
previewCancel.onClick()
assert.equal(countByClass(renderView(), 'dsh-my-memory-overlay'), 0, 'cancel closes the overlay')

// ── 提示词编辑 / 删除（独立端点） ─────────────────────────────────────────
const promptTabTree = clickTab('全局提示词')
const promptEditButtons = []
collectButtons(promptTabTree, promptEditButtons)
const promptEditBtn = promptEditButtons.find((b) => b.label.includes('编辑') && b.label.includes('gp-seed-think-zh'))
assert.ok(promptEditBtn, 'prompt edit control rendered')
promptEditBtn.onClick()
const promptEditTree = renderView()
const promptEditInputs = []
collectInputs(promptEditTree, promptEditInputs)
const promptTitleInput = promptEditInputs.find(
  (i) => String(i.placeholder).includes('提示词标题') && i.value === '中文思考',
)
assert.ok(promptTitleInput, 'prompt title editor prefilled')
promptTitleInput.onChange({ target: { value: '中文思考（改）' } })
const editingRow = findByClassContaining(renderView(), 'dsh-my-memory-row-editing')
assert.ok(editingRow, 'prompt row switched into editing mode')
const promptSave = collectByClass(editingRow, 'dsh-my-memory-btn-save')
assert.ok(promptSave, 'prompt editor renders the save button')
promptSave.onClick()
const promptUpdateJoined = joinedText(renderView())
assert.ok(promptUpdateJoined.includes('确认保存这条提示词的修改'), 'saving an edit asks for confirmation')
const promptUpdateOk = collectByClass(renderView(), 'dsh-my-memory-confirm-ok')
assert.ok(promptUpdateOk, 'prompt update confirm button rendered')
cannedResponses.push({
  ok: true,
  value: { items: [{ ...PROMPT_SEED, title: '中文思考（改）' }, PROMPT_OFF], item: null },
})
promptUpdateOk.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const promptUpdateCall = fetchCalls.find(
  (c) =>
    c.url === '/my-memory/api/prompts' && c.options !== undefined && JSON.parse(c.options.body).action === 'update',
)
assert.ok(promptUpdateCall, 'prompt update POST issued')
assert.equal(JSON.parse(promptUpdateCall.options.body).title, '中文思考（改）')
assert.equal(JSON.parse(promptUpdateCall.options.body).confirmed, true)

// 删除提示词
const promptDelButtons = []
collectButtons(renderView(), promptDelButtons)
const promptDelete = promptDelButtons.find((b) => b.label.includes('删除') && b.label.includes('gp-1'))
assert.ok(promptDelete, 'prompt delete control rendered')
promptDelete.onClick()
const promptDelJoined = joinedText(renderView())
assert.ok(promptDelJoined.includes('确定删除这条提示词'), 'prompt delete confirmation text shown')
const promptDelOk = collectByClass(renderView(), 'dsh-my-memory-confirm-ok')
assert.ok(promptDelOk, 'prompt delete confirm button rendered')
cannedResponses.push({ ok: true, value: { items: [PROMPT_SEED], item: null } })
promptDelOk.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const promptDeleteCall = fetchCalls.find(
  (c) =>
    c.url === '/my-memory/api/prompts' && c.options !== undefined && JSON.parse(c.options.body).action === 'delete',
)
assert.ok(promptDeleteCall, 'prompt delete POST issued')
assert.equal(JSON.parse(promptDeleteCall.options.body).confirmed, true)

// 提示词写操作全部打到 /prompts，没有一条走 /memory
const promptWrites = fetchCalls.filter(
  (c) => c.options !== undefined && String(c.options.body).includes('"action":"toggle"'),
)
assert.ok(
  promptWrites.every((c) => c.url === '/my-memory/api/prompts'),
  'prompt writes never hit the memory endpoint',
)

// ── 纯函数导出 ────────────────────────────────────────────────────────────
assert.equal(typeof exportsObj.sortMemories, 'function', 'sortMemories helper exported')
assert.equal(typeof exportsObj.relativeTime, 'function', 'relativeTime helper exported')
assert.equal(typeof exportsObj.truncateText, 'function', 'truncateText helper exported')
assert.equal(typeof exportsObj.firstSentence, 'function', 'firstSentence helper exported')

const sortInput = [
  { id: 'a', desc: 'A', updatedAt: 200 },
  { id: 'b', desc: 'B', updatedAt: 100 },
]
assert.deepEqual(
  exportsObj.sortMemories(sortInput, 'desc').map((i) => i.id),
  ['a', 'b'],
)
assert.deepEqual(
  exportsObj.sortMemories(sortInput, 'asc').map((i) => i.id),
  ['b', 'a'],
)
assert.equal(sortInput[0].id, 'a', 'sortMemories does not mutate the input array')
assert.equal(
  exportsObj.truncateText('A'.repeat(64), 60).text,
  `${'A'.repeat(60)}…`,
  'long text truncated with ellipsis',
)
assert.equal(exportsObj.relativeTime(Date.now() - 30 * 1000), '刚刚')
assert.equal(exportsObj.firstSentence('回复使用中文。代码注释也要中文。'), '回复使用中文。')

console.log('ALL MY-MEMORY CLIENT RENDER-PATH TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})

test('i18n: 宿主 <html lang> 优先于 navigator.language（桌面 app 语言错配回归）', () => {
  const prevDoc = global.document
  global.document = { documentElement: { lang: 'en' } }
  try {
    assert.equal(capturedTab.options.label(), 'Memory', 'host en wins over navigator zh')
    global.document.documentElement.lang = 'zh-CN'
    assert.equal(capturedTab.options.label(), '记忆', 'host zh-CN switches back')
  } finally {
    if (prevDoc === undefined) delete global.document
    else global.document = prevDoc
  }
})
