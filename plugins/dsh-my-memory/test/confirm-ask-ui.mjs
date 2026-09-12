/**
 * issue #193 — ask 范式确认卡 + 工具侧审批接管（不误伤）测试。
 *
 * 契约来源（宿主构建产物，均为唯一可见实现）：
 *  - chain slot 选举：dsh-client-ui-renderer/lib/client.js:831-849 —— 按 priority
 *    顺序询问每个条目，**首个 select 返回非 null 者当选并独占渲染（break）**；
 *    select 抛错 = declined（continue，自动让位下一个条目）。
 *  - 宿主审批条目：dsh-client-ui-approval/lib/client.js:272-281 ——
 *    name 'conversation.composer'、priority 1、select instanceof PendingApproval。
 *  - 插件可按同一扩展点注册自己的条目（chain 多注册共存）。
 *
 * 本文件断言两类契约：
 *  A. 接管层判据（安全）：只接管 pending approval 且 toolName ∈ {memory_save,
 *     memory_delete}；字段缺失/结构变化/取值抛错一律返回 null（让位宿主），
 *     绝不出现「我们既不渲染、又挡住宿主」的死锁中间态。
 *  B. 视觉（ask 范式）：条带标题 + 状态点 + 20px 大卡 + 范围选项行 +
 *     footer 左右分布；删除危险色 + 二次确认，保存成功色。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react：createElement 保留结构，useState 有状态（二次确认要重渲染）──
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let hookValues = []
let hookIndex = 0
const stubbed = {
  createElement,
  useState: (initial) => {
    const idx = hookIndex
    hookIndex += 1
    if (!(idx in hookValues)) {
      hookValues[idx] = typeof initial === 'function' ? initial() : initial
    }
    return [
      hookValues[idx],
      (next) => {
        hookValues[idx] = typeof next === 'function' ? next(hookValues[idx]) : next
      },
    ]
  },
  // 面板的加载副作用：每次渲染都跑（fetch 幂等 GET），让 C 段能观察到数据态
  useEffect: (fn) => {
    try {
      fn()
    } catch {
      /* 渲染副作用异常不影响断言 */
    }
  },
}

// ── 官方组件库 stub（确认卡只用到少量原语）──────────────────────────────
const uiPrimitives = {
  Button: ({ variant: _v, size: _s, icon, className, children, ...rest }) =>
    createElement('button', { type: 'button', 'data-ui': 'button', className, ...rest }, icon, children),
  Input: ({ icon: _i, className, ...rest }) =>
    createElement('span', { 'data-ui': 'input', className }, createElement('input', rest)),
  Pill: ({ active: _a, className, children, onClick, ...rest }) =>
    onClick
      ? createElement('button', { type: 'button', 'data-ui': 'pill', className, onClick, ...rest }, children)
      : createElement('span', { 'data-ui': 'pill', className }, children),
  IconRefreshOutline14: (p) => createElement('svg', { 'data-icon': 'refresh', ...p }),
  IconFolderOpenOutline16: (p) => createElement('svg', { 'data-icon': 'folder', ...p }),
  IconCheckOutline16: (p) => createElement('svg', { 'data-icon': 'check', ...p }),
  IconPlusOutline16: (p) => createElement('svg', { 'data-icon': 'plus', ...p }),
  IconChevronDownOutline14: (p) => createElement('svg', { 'data-icon': 'chevron-down', ...p }),
  IconCloseOutline16: (p) => createElement('svg', { 'data-icon': 'close', ...p }),
}

// ── browser globals ───────────────────────────────────────────────────────
let registered = null
global.window = {
  __ModuleLoader__: {
    load: (r) => {
      registered = r
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
global.localStorage = { getItem: () => null }
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
const SEED_ITEM = { id: 'mem-1', desc: '回复使用中文', category: 'fact', updatedAt: Date.now(), createdAt: Date.now() }
global.fetch = () =>
  Promise.resolve({
    json: () =>
      Promise.resolve({
        ok: true,
        value: { scope: 'global', cwd: '', projectRoot: '', items: [SEED_ITEM], maxEntryLength: 50 },
      }),
  })

eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return uiPrimitives
  throw new Error('unexpected require: ' + spec)
})

// ── mock slots / ctx ──────────────────────────────────────────────────────
let capturedTab = null
let capturedComposer = null
const mockSlots = {
  inject: (name, register) => {
    const entry = register()
    if (name === 'settings.plugins.tab') capturedTab = entry
    if (name === 'conversation.composer') capturedComposer = entry
    return () => {}
  },
  register: (options, component) => ({ options, component }),
}
const ctx = {
  get: (name, strict = true) => (name === 'slots' ? (strict ? undefined : mockSlots) : undefined),
  effect: (fn) => fn(),
}
exportsObj.apply(ctx)

// ── helpers ───────────────────────────────────────────────────────────────
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    node.forEach((c) => walk(c, visit))
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  const props = node.props ?? {}
  if (typeof node.type === 'function') {
    walk(node.type(node.props), visit)
    return
  }
  walk(props.children, visit)
}
function classes(node) {
  const out = []
  walk(node, (n) => {
    const cls = n.props?.className
    if (typeof cls === 'string') out.push(...cls.split(' ').filter(Boolean))
  })
  return out
}
function texts(node) {
  const out = []
  walk(node, (n) => {
    const c = n.props?.children
    if (typeof c === 'string') out.push(c)
  })
  return out
}
/** 收集 className 含 token 且带 onClick 的节点 props（按钮）。 */
function buttons(node, token) {
  const out = []
  walk(node, (n) => {
    const cls = n.props?.className
    if (typeof cls === 'string' && cls.split(' ').includes(token) && typeof n.props?.onClick === 'function')
      out.push(n.props)
  })
  return out
}

// ── 宿主 chain 选举语义（复刻 dsh-client-ui-renderer/lib/client.js:831-849）──
function electChain(entries, ownerProps) {
  for (const entry of entries) {
    let matched
    try {
      matched = entry.options.select(ownerProps)
    } catch {
      continue // 宿主语义：select 抛错 = declined，让位下一个条目
    }
    if (matched !== null && matched !== undefined) return { entry, matched }
  }
  return null
}

/** 宿主审批条目（模拟 dsh-client-ui-approval：priority 1 + instanceof 判据）。 */
class HostPendingApproval {
  constructor(request) {
    this.kind = 'approval'
    this.toolName = request.toolName
    this.callId = request.callId
    this.reason = request.reason
    this.answered = []
  }
  async answer(outcome) {
    this.answered.push(outcome)
  }
}
const hostEntry = {
  options: {
    name: 'conversation.composer',
    priority: 1,
    select: ({ pendingInteraction }) => (pendingInteraction instanceof HostPendingApproval ? pendingInteraction : null),
  },
  component: () => null,
}

const SAVE_REASON =
  'dsh-my-memory：agent 请求保存项目记忆「本项目用 pnpm」。记忆绝不静默变更，请确认是否保存' +
  '\n范围：project\n分类：workflow\n内容：本项目用 pnpm'
const DELETE_REASON =
  'dsh-my-memory：agent 请求删除全局记忆 「回复使用中文」[mem-1]。删除不可撤销，记忆绝不静默变更，请确认是否删除' +
  '\n范围：global\n内容：回复使用中文'

function pendingSave(over = {}) {
  return new HostPendingApproval({ toolName: 'memory_save', callId: 'call-save', reason: SAVE_REASON, ...over })
}
function pendingDelete(over = {}) {
  return new HostPendingApproval({ toolName: 'memory_delete', callId: 'call-del', reason: DELETE_REASON, ...over })
}

/** 挂载确认卡（全新组件实例：hook 状态从零开始）。 */
function renderCard(matched) {
  hookIndex = 0
  hookValues = []
  return capturedComposer.component({
    sessionId: 'sess-1',
    session: undefined,
    pendingInteraction: matched?.pending,
    matched,
  })
}
/** 重渲染（保留 hook 状态，模拟 setState 触发的渲染）。 */
function rerenderCard(matched) {
  hookIndex = 0
  return capturedComposer.component({
    sessionId: 'sess-1',
    session: undefined,
    pendingInteraction: matched?.pending,
    matched,
  })
}

// ═══ A. 接管层契约 ═══════════════════════════════════════════════════════

assert.ok(capturedComposer, 'RED: apply() must register an approval composer entry (issue #193)')
assert.equal(capturedComposer.options.name, 'conversation.composer')
assert.equal(typeof capturedComposer.options.select, 'function', 'entry must declare a select election')
assert.ok(
  capturedComposer.options.priority < hostEntry.options.priority,
  'entry must outrank the shipped approval entry (host priority=1, smaller wins)',
)

// A1. 正例：memory_save / memory_delete 的 pending approval 被接管
const electedSave = electChain([capturedComposer, hostEntry], {
  pendingInteraction: pendingSave(),
  sessionId: 's',
  session: undefined,
})
assert.ok(electedSave, 'memory_save approval must be elected')
assert.equal(electedSave.entry, capturedComposer, 'our entry must win the chain election for memory_save')
assert.equal(electedSave.matched.toolName, 'memory_save')
assert.equal(electedSave.matched.operation, 'save')
assert.equal(electedSave.matched.scope, 'project', 'scope parsed from the reason contract')

const electedDelete = electChain([capturedComposer, hostEntry], {
  pendingInteraction: pendingDelete(),
  sessionId: 's',
  session: undefined,
})
assert.ok(electedDelete, 'memory_delete approval must be elected')
assert.equal(electedDelete.matched.operation, 'delete')
assert.equal(electedDelete.matched.scope, 'global')

// A2. 不误伤：其它工具的审批一律让位宿主（我们返回 null，宿主当选）
for (const toolName of ['bash', 'write', 'edit', 'web_fetch', 'memory_query']) {
  const host = new HostPendingApproval({ toolName, callId: 'x', reason: 'raw reason' })
  const elected = electChain([capturedComposer, hostEntry], {
    pendingInteraction: host,
    sessionId: 's',
    session: undefined,
  })
  assert.ok(elected, 'other-tool approval must still be elected by the host entry: ' + toolName)
  assert.equal(elected.entry, hostEntry, 'we must NOT take over approvals for ' + toolName)
  assert.equal(elected.matched, host, 'host entry keeps its own pending interaction for ' + toolName)
}

// A3. 异常/结构变化 → 让位宿主（不得出现死锁中间态）
const brokenCases = [
  ['no pending interaction', undefined],
  ['null pending interaction', null],
  ['non-approval pending kind', { kind: 'question', toolName: 'memory_save', answer: () => {} }],
  ['missing kind', { toolName: 'memory_save', answer: () => {} }],
  ['missing toolName', { kind: 'approval', answer: () => {} }],
  ['answer not a function', { kind: 'approval', toolName: 'memory_save', answer: 'nope' }],
  ['non-object pending', 'garbage'],
]
for (const [label, pending] of brokenCases) {
  const got = capturedComposer.options.select({ pendingInteraction: pending, sessionId: 's', session: undefined })
  assert.equal(got, null, 'select must decline on unusable input (host entry keeps the seat): ' + label)
}

// A3b. 组件侧防御：载荷缺失/不完整 → 渲染空而不抛错（不产生 chain 的 crash face）
assert.equal(capturedComposer.component({ matched: undefined }), null, 'missing payload renders nothing')
assert.equal(
  capturedComposer.component({ matched: { operation: 'delete' } }),
  null,
  'payload without answer renders nothing',
)

// A3c. reason 缺失/非字符串仍安全接管：我们的工具由我们的卡兜底渲染（不退化成原始卡）
const bareMatch = capturedComposer.options.select({
  pendingInteraction: pendingSave({ reason: undefined }),
  sessionId: 's',
  session: undefined,
})
assert.ok(bareMatch, 'a memory_save approval with no reason is still ours')
assert.equal(bareMatch.scope, '', 'unknown scope stays empty')
const bareTree = renderCard(bareMatch)
assert.ok(classes(bareTree).includes('dsh-my-memory-ask-card'), 'fallback card keeps the ask shell')
assert.ok(texts(bareTree).join('|').includes('范围未标注'), 'fallback scope copy is shown')

// A4. 取值抛错 → 让位（我们不 catch 也要被宿主渲染器 catch；两条路径都断言）
const throwing = {
  kind: 'approval',
  get toolName() {
    throw new Error('boom')
  },
  answer: () => {},
}
const throwingResult = (() => {
  try {
    return {
      value: capturedComposer.options.select({ pendingInteraction: throwing, sessionId: 's', session: undefined }),
    }
  } catch (error) {
    return { threw: error }
  }
})()
assert.ok(
  throwingResult.value === null || throwingResult.threw !== undefined,
  'a throwing field must never produce a half-taken-over entry',
)
// 抛错路径下座位也不被我们占住：任何我们让位的审批都由宿主条目渲染
const otherToolSeat = new HostPendingApproval({ toolName: 'bash', callId: 'x', reason: 'r' })
const seatAfterThrow = electChain([capturedComposer, hostEntry], {
  pendingInteraction: otherToolSeat,
  sessionId: 's',
  session: undefined,
})
assert.equal(seatAfterThrow?.entry, hostEntry, 'host entry keeps every seat we decline (no dead-lock middle state)')

// A5. #208 无关性：没有 pending approval 时我们绝不渲染任何东西
assert.equal(
  capturedComposer.options.select({ pendingInteraction: undefined, sessionId: 's', session: undefined }),
  null,
)

// ═══ B. ask 范式视觉契约 ═══════════════════════════════════════════════

const saveTree = renderCard(electedSave.matched)
const saveClasses = classes(saveTree)
for (const token of [
  'dsh-my-memory-ask',
  'dsh-my-memory-ask-save',
  'dsh-my-memory-ask-card',
  'dsh-my-memory-ask-strip',
  'dsh-my-memory-ask-dot',
  'dsh-my-memory-ask-body',
  'dsh-my-memory-ask-options',
  'dsh-my-memory-ask-option',
  'dsh-my-memory-ask-footer',
  'dsh-my-memory-ask-actions',
]) {
  assert.ok(saveClasses.includes(token), 'ask-paradigm class missing on save card: ' + token)
}
const saveTexts = texts(saveTree).join('|')
assert.ok(saveTexts.includes('项目'), 'save card shows the requested scope (项目)')
assert.ok(saveTexts.includes('工作流') || saveTexts.includes('workflow'), 'save card shows the category')
assert.ok(saveTexts.includes('本项目用 pnpm'), 'save card shows the content snippet')

const deleteTree = renderCard(electedDelete.matched)
const deleteClasses = classes(deleteTree)
assert.ok(deleteClasses.includes('dsh-my-memory-ask-delete'), 'delete card carries the danger variant class')
assert.ok(deleteClasses.includes('dsh-my-memory-ask-card'), 'delete card keeps the ask card shell')
assert.ok(deleteClasses.includes('dsh-my-memory-ask-strip'), 'delete card keeps the status strip')
const deleteTexts = texts(deleteTree).join('|')
assert.ok(deleteTexts.includes('全局'), 'delete card shows the owning scope (全局)')
assert.ok(deleteTexts.includes('回复使用中文'), 'delete card shows the content being deleted')

// B2. 删除二次确认：第一次点击只 arm，不回答
const delPending = pendingDelete()
const delMatched = capturedComposer.options.select({
  pendingInteraction: delPending,
  sessionId: 's',
  session: undefined,
})
renderCard(delMatched)
const firstOk = buttons(rerenderCard(delMatched), 'dsh-my-memory-confirm-ok')[0]
assert.ok(firstOk, 'delete card has a primary action button')
firstOk.onClick()
assert.deepEqual(delPending.answered, [], 'first click must only arm the two-step confirm, not answer the host')
const secondOk = buttons(rerenderCard(delMatched), 'dsh-my-memory-confirm-ok')[0]
secondOk.onClick()
await Promise.resolve()
assert.deepEqual(delPending.answered, ['allowed-once'], 'second click answers the host approval with allowed-once')

// B3. 保存：一次点击即允许；取消/拒绝按钮回 rejected
const savePending = pendingSave()
const saveMatched = capturedComposer.options.select({
  pendingInteraction: savePending,
  sessionId: 's',
  session: undefined,
})
renderCard(saveMatched)
buttons(rerenderCard(saveMatched), 'dsh-my-memory-confirm-ok')[0].onClick()
await Promise.resolve()
assert.deepEqual(savePending.answered, ['allowed-once'], 'save allows on a single click')

const savePending2 = pendingSave()
const saveMatched2 = capturedComposer.options.select({
  pendingInteraction: savePending2,
  sessionId: 's',
  session: undefined,
})
renderCard(saveMatched2)
buttons(rerenderCard(saveMatched2), 'dsh-my-memory-confirm-cancel')[0].onClick()
await Promise.resolve()
assert.deepEqual(savePending2.answered, ['rejected'], 'reject answers the host approval with rejected')

// ═══ C. 面板侧与工具侧同形态（同一 ask 组件，两处契约一致）═══════════════
assert.ok(capturedTab, 'settings tab still registered (no regression)')
async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}
function renderPanel() {
  hookIndex = 0
  return capturedTab.component({})
}
hookValues = []
renderPanel()
await settle()
let panelTree = renderPanel()
assert.ok(classes(panelTree).includes('dsh-my-memory-sections'), 'panel renders its global/project sections')

// 面板内删除 → 确认面板必须与工具侧同一组 ask 契约类
const panelDelete = buttons(panelTree, 'dsh-my-memory-iconbtn-danger')
assert.ok(panelDelete.length > 0, 'panel renders a delete action for the seeded memory')
panelDelete[0].onClick()
panelTree = renderPanel()
const panelClasses = classes(panelTree)
for (const token of [
  'dsh-my-memory-ask',
  'dsh-my-memory-ask-card',
  'dsh-my-memory-ask-strip',
  'dsh-my-memory-ask-dot',
  'dsh-my-memory-ask-body',
  'dsh-my-memory-ask-options',
  'dsh-my-memory-ask-footer',
  'dsh-my-memory-confirm-ok',
  'dsh-my-memory-confirm-cancel',
]) {
  assert.ok(panelClasses.includes(token), 'panel confirm shares the tool-side ask class: ' + token)
}
assert.ok(panelClasses.includes('dsh-my-memory-ask-delete'), 'panel delete confirm uses the danger variant')
const panelTexts = texts(panelTree).join('|')
assert.ok(panelTexts.includes('全局'), 'panel delete confirm names the owning scope')

console.log('ALL issue #193 CONFIRM-UI TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})
