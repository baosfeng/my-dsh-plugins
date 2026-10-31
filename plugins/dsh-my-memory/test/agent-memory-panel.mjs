/**
 * agent 记忆面板（issue #502 第四个 tab）的渲染契约测试。
 *
 * 覆盖三件用户可感知的事：
 *  1. **行内操作按钮必须走设计系统的 iconbtn 范式**——与「全局记忆 / 项目记忆 /
 *     全局提示词」三个 tab 完全一致。曾经这里用的是 `dsh-my-memory-btn`，而
 *     该类名在 styles.ts 里根本不存在，按钮退化为浏览器默认样式（用户实测截图）。
 *  2. **作用域必须可见**：文件来自 `user.md`（全局）还是 `projects/<id>/…`
 *     （项目），卡片上要有徽标——项目相关的内容写进全局时，用户一眼能看出来。
 *  3. **编辑态不重复「取消」**：头部按钮在编辑态应让位给编辑器底部的「保存 /
 *     取消」，否则同一个卡片上出现两个「取消」。
 *  4. **删除要二次确认**：agent 记忆是长期数据，误删不可恢复。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react（stateful hooks，按组件实例隔离）────────────────────────
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
  return withHookComponent(`${seed}#${occurrence}`, () => type(props))
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

// ── 官方组件库 stub：只暴露用到的那几个导出 ─────────────────────────────────
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
global.localStorage = { getItem: () => null }
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

const NOW = 1793460239913

/** 三个分组：全局 + 最近写入的项目（android-monitor）+ 更早写入的项目（my-dsh-plugins）。 */
const USER_ENTRY = {
  name: 'user.md',
  content: '# 用户偏好\n- 交付 UI 改动时给实测数字表',
  createdAt: NOW - 7200_000,
  updatedAt: NOW - 60_000,
  lastReadAt: NOW - 120_000,
  readCount: 3,
  archived: false,
}
const ANDROID_ENTRY = {
  name: 'projects/c1a9a5e21a94/decisions.md',
  projectName: 'android-monitor',
  content: '- 选 A 因为 B',
  createdAt: NOW - 7200_000,
  updatedAt: NOW - 60_000,
  lastReadAt: 0,
  readCount: 0,
  archived: false,
}
const PLUGINS_ENTRY = {
  name: 'projects/ba7b32df3d04/pitfalls.md',
  projectName: 'my-dsh-plugins',
  content: '- 探针文件不要落在 src/main 下',
  createdAt: NOW - 90_000_000,
  updatedAt: NOW - 86_400_000,
  lastReadAt: 0,
  readCount: 0,
  archived: false,
}

/** 跨项目重复的一条：可晋升（两个项目都记了同一句门禁假红）。 */
const PROMOTABLE = {
  text: '门禁九项并行时 vitest 偶发单例超时假红',
  similarity: 0.72,
  sources: [
    {
      name: 'projects/c1a9a5e21a94/pitfalls.md',
      projectId: 'c1a9a5e21a94',
      projectName: 'android-monitor',
      line: '门禁九项并行时 vitest 偶发单例超时假红',
    },
    {
      name: 'projects/ba7b32df3d04/pitfalls.md',
      projectId: 'ba7b32df3d04',
      projectName: 'my-dsh-plugins',
      line: '门禁九项并行时 vitest 偶发单例超时假红',
    },
  ],
  blocked: null,
}

/** 被全局层护栏拒绝的一条：含项目内路径，必须把原因显示出来而不是静默隐藏。 */
const BLOCKED = {
  text: '手机测试走 scripts/debug-cli.sh ui',
  similarity: 0.61,
  sources: [
    {
      name: 'projects/c1a9a5e21a94/pitfalls.md',
      projectId: 'c1a9a5e21a94',
      projectName: 'android-monitor',
      line: '手机测试走 scripts/debug-cli.sh ui',
    },
    {
      name: 'projects/ba7b32df3d04/pitfalls.md',
      projectId: 'ba7b32df3d04',
      projectName: 'my-dsh-plugins',
      line: '手机测试走 scripts/debug-cli.sh ui',
    },
  ],
  blocked: '这条含项目专属标识（路径 / 地址 / 端口），请写 projects/current/…；全局层只放跨项目通用的能力',
}

const AGENT_PAYLOAD = {
  ok: true,
  value: {
    groups: [
      { id: 'global', kind: 'global', entries: [USER_ENTRY], count: 1, latestUpdatedAt: NOW - 60_000 },
      {
        id: 'project:c1a9a5e21a94',
        kind: 'project',
        projectId: 'c1a9a5e21a94',
        projectName: 'android-monitor',
        entries: [ANDROID_ENTRY],
        count: 1,
        latestUpdatedAt: NOW - 60_000,
      },
      {
        id: 'project:ba7b32df3d04',
        kind: 'project',
        projectId: 'ba7b32df3d04',
        projectName: 'my-dsh-plugins',
        entries: [PLUGINS_ENTRY],
        count: 1,
        latestUpdatedAt: NOW - 86_400_000,
      },
    ],
    archived: [],
    suggestions: [PROMOTABLE, BLOCKED],
  },
}

const FIXED_RESPONSES = {
  '/my-memory/api/config': { ok: true, value: { maxEntryLength: 50 } },
  '/my-memory/api/prompts': { ok: true, value: { items: [] } },
  '/my-memory/api/agent-memory': AGENT_PAYLOAD,
}
const fetchCalls = []
/** 写动作（POST）的排队响应：为空时走固定响应；晋升成功 / 被拒绝的用例在这里塞。 */
let postResponses = []
global.fetch = (url, options) => {
  const target = String(url)
  fetchCalls.push({ url: target, options })
  if (options !== undefined && postResponses.length > 0) {
    return Promise.resolve({ json: () => Promise.resolve(postResponses.shift()) })
  }
  const fixed = options === undefined ? (FIXED_RESPONSES[target] ?? null) : null
  const canned = fixed ?? { ok: true, value: { scope: 'global', cwd: '', projectRoot: '', items: [] } }
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

// ── render helpers ─────────────────────────────────────────────────────────
function renderView() {
  return withHookComponent('root', () => {
    componentSeen.clear()
    return capturedTab.component({})
  })
}

/** 展开函数组件后收集所有原生 <button> 节点（className + 文本 + onClick）。 */
function collectButtonNodes(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) collectButtonNodes(child, out)
    return
  }
  if (typeof node !== 'object') return
  const props = node.props ?? {}
  if (typeof node.type === 'function') {
    collectButtonNodes(renderComponent(node.type, props), out)
    return
  }
  if (typeof node.type === 'string') {
    if (node.type === 'button') {
      out.push({
        className: props.className ?? '',
        text: textOf(props.children),
        label: props['aria-label'] ?? '',
        expanded: props['aria-expanded'],
        disabled: props.disabled === true,
        onClick: props.onClick,
      })
    }
    collectButtonNodes(props.children, out)
  }
}

function textOf(node) {
  const out = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'object') walk(value.props?.children)
  }
  walk(node)
  return out.join('')
}

/** 收集 class 含指定类名的子树（用于定位卡片 / 徽标）。 */
function collectByClass(node, className, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectByClass(child, className, out)
    return out
  }
  const props = node.props ?? {}
  if (typeof props.className === 'string' && props.className.split(/\s+/).includes(className)) out.push(node)
  if (typeof node.type === 'function') {
    collectByClass(renderComponent(node.type, props), className, out)
    return out
  }
  collectByClass(props.children, className, out)
  return out
}

/** 模拟「重新打开设置面板」：清空 hook 槽位与组件实例表后重新挂载。 */
function resetPanel() {
  hookValues.clear()
  effectRan.clear()
  componentSeen.clear()
}

/** 点击 Agent 记忆 tab，返回渲染结果。 */
async function openAgentTab() {
  resetPanel()
  renderView()
  await new Promise((resolve) => setTimeout(resolve, 0))
  renderView()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tabButton = findTabByLabel(renderView(), 'Agent 记忆')
  assert.ok(tabButton, 'Agent 记忆 tab rendered')
  tabButton.onClick()
  return renderView()
}

function findTabByLabel(tree, label) {
  const out = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const props = node.props ?? {}
    if (props.role === 'tab' && props['aria-label'] === label && typeof props.onClick === 'function') {
      out.push({ onClick: props.onClick })
    }
    if (typeof node.type === 'function') {
      walk(renderComponent(node.type, props))
      return
    }
    walk(props.children)
  }
  walk(tree)
  return out[0]
}

// ── 断言 ───────────────────────────────────────────────────────────────────
test('agent 记忆卡片的行内操作按钮走 iconbtn 范式（不是未定义的 dsh-my-memory-btn）', async () => {
  const tree = await openAgentTab()
  const buttons = []
  collectButtonNodes(tree, buttons)
  const editButton = buttons.find((b) => b.label === '编辑 user.md')
  assert.ok(editButton, '编辑按钮存在')
  assert.ok(
    editButton.className.includes('dsh-my-memory-iconbtn'),
    `编辑按钮应使用 dsh-my-memory-iconbtn，实际 className=${JSON.stringify(editButton.className)}`,
  )
  const deleteButton = buttons.find((b) => b.label === '删除 user.md')
  assert.ok(deleteButton, '删除按钮存在')
  assert.ok(
    deleteButton.className.split(/\s+/).includes('dsh-my-memory-iconbtn-danger'),
    `删除按钮应带 dsh-my-memory-iconbtn-danger，实际 className=${JSON.stringify(deleteButton.className)}`,
  )
  assert.ok(
    !buttons.some((b) => b.className.split(/\s+/).includes('dsh-my-memory-btn')),
    '不应再出现无样式定义的 dsh-my-memory-btn',
  )
})

test('每张卡片显示作用域徽标：全局 / 项目', async () => {
  const tree = await openAgentTab()
  const cards = collectByClass(tree, 'dsh-my-memory-agent-card')
  assert.equal(cards.length, 2, '两张卡片')
  const badges = collectByClass(tree, 'dsh-my-memory-agent-scope')
  assert.equal(badges.length, 2, '每张卡片一个作用域徽标')
  const texts = badges.map((badge) => textOf(badge.props.children))
  assert.ok(texts.includes('全局'), 'user.md 标注为全局')
  assert.ok(texts.includes('项目'), 'projects/<id>/decisions.md 标注为项目')
})

test('项目卡片标题显示项目可读名，不再是 hash id', async () => {
  const tree = await openAgentTab()
  const names = collectByClass(tree, 'dsh-my-memory-agent-name')
  const texts = names.map((node) => textOf(node.props.children))
  assert.ok(texts.includes('android-monitor / decisions.md'), `项目卡片显示项目名，实际 ${JSON.stringify(texts)}`)
  assert.ok(texts.includes('user.md'), '全局文件保持原名')
  const projectTitle = names.find((node) => textOf(node.props.children).includes('android-monitor'))
  assert.equal(projectTitle.props.title, 'projects/c1a9a5e21a94/decisions.md', '悬停仍显示全路径')
})

test('编辑态只有编辑器底部一组「取消 / 保存」，头部不再出现第二个「取消」', async () => {
  const tree = await openAgentTab()
  const buttons = []
  collectButtonNodes(tree, buttons)
  const editButton = buttons.find((b) => b.label === '编辑 user.md')
  assert.ok(editButton, '编辑按钮存在')
  editButton.onClick()
  const editingTree = renderView()
  const editingButtons = []
  collectButtonNodes(editingTree, editingButtons)
  const cancels = editingButtons.filter((b) => b.text === '取消')
  assert.equal(cancels.length, 1, `编辑态只应有一个「取消」，实际 ${cancels.length} 个`)
  const saves = editingButtons.filter((b) => b.text === '保存')
  assert.equal(saves.length, 1, '编辑态应有一个「保存」')
  assert.ok(saves[0].className.includes('dsh-my-memory-btn-save'), '保存按钮复用 MemoryRowEdit 的 btn-save 样式')
})

test('删除先弹确认层，确认后才发 POST', async () => {
  const tree = await openAgentTab()
  fetchCalls.length = 0
  const buttons = []
  collectButtonNodes(tree, buttons)
  const deleteButton = buttons.find((b) => b.label === '删除 user.md')
  assert.ok(deleteButton, '删除按钮存在')
  deleteButton.onClick()
  const confirmTree = renderView()
  assert.equal(collectByClass(confirmTree, 'dsh-my-memory-overlay').length, 1, '删除弹出确认层')
  assert.equal(
    fetchCalls.filter((call) => call.options !== undefined && String(call.url).includes('agent-memory')).length,
    0,
    '确认前不得发出删除请求',
  )
  const confirmButtons = []
  collectButtonNodes(confirmTree, confirmButtons)
  const allow = confirmButtons.find((b) => b.text === '确认删除')
  assert.ok(allow, '确认层有「确认删除」按钮')
  allow.onClick()
  renderView()
  const posted = fetchCalls.filter((call) => call.options !== undefined && String(call.url).includes('agent-memory'))
  assert.equal(posted.length, 1, '确认后发出一次删除请求')
  assert.equal(JSON.parse(posted[0].options.body).action, 'delete', '请求体 action=delete')
})

// ── 分组折叠 + 跨项目晋升（issue #502 后续）──────────────────────────────────

/** 分组头按钮（可折叠的「项目名 · N 条」）。 */
function groupHeadsOf(tree) {
  const buttons = []
  collectButtonNodes(tree, buttons)
  return buttons.filter((button) => button.className.includes('dsh-my-memory-agent-group-head'))
}

test('分组默认展开全局 + 最近写入的项目，其余折叠成「项目名 · N 条」', async () => {
  const tree = await openAgentTab()
  const heads = groupHeadsOf(tree)
  assert.deepEqual(
    heads.map((head) => head.label),
    ['全局 · 1 条', 'android-monitor · 1 条', 'my-dsh-plugins · 1 条'],
    '分组顺序：全局 → 最近写入的项目 → 更早的项目',
  )
  assert.deepEqual(
    heads.map((head) => head.expanded),
    [true, true, false],
    '默认只展开全局与最近写入的项目',
  )
  assert.equal(collectByClass(tree, 'dsh-my-memory-agent-card').length, 2, '折叠的项目不渲染卡片')

  const collapsed = heads[2]
  assert.ok(collapsed.onClick, '折叠头可点击')
  collapsed.onClick()
  const opened = renderView()
  assert.equal(collectByClass(opened, 'dsh-my-memory-agent-card').length, 3, '点开后显示该项目的卡片')
  assert.deepEqual(
    groupHeadsOf(opened).map((head) => head.expanded),
    [true, true, true],
    '展开状态记在面板状态里',
  )
})

test('晋升建议：顶部列出跨项目重复条目，被护栏拒绝的直接给原因', async () => {
  const tree = await openAgentTab()
  assert.equal(collectByClass(tree, 'dsh-my-memory-agent-suggest').length, 1, '顶部有晋升建议区块')
  const texts = collectByClass(tree, 'dsh-my-memory-agent-suggest-text').map((node) => textOf(node.props.children))
  assert.deepEqual(texts, [PROMOTABLE.text, BLOCKED.text], '两条建议都列出来（被拒绝的也不隐藏）')
  const blockedNotes = collectByClass(tree, 'dsh-my-memory-agent-suggest-blocked').map((node) =>
    textOf(node.props.children),
  )
  assert.equal(blockedNotes.length, 1, '只有被拒绝的那条有原因')
  assert.match(blockedNotes[0], /项目专属标识/, '原因文案来自 globalScopeReject，原样展示')
  const buttons = []
  collectButtonNodes(tree, buttons)
  const promoteButtons = buttons.filter((button) => button.text === '晋升到 user.md')
  assert.equal(promoteButtons.length, 2, '每条建议一个晋升按钮')
  assert.equal(promoteButtons.filter((button) => button.disabled).length, 1, '被拒绝的那条按钮不可点')
})

test('晋升先弹确认层，确认后才发 POST（action=promote）', async () => {
  const tree = await openAgentTab()
  fetchCalls.length = 0
  const buttons = []
  collectButtonNodes(tree, buttons)
  const promote = buttons.find((button) => button.text === '晋升到 user.md' && !button.disabled)
  assert.ok(promote, '可晋升的那条有按钮')
  promote.onClick()
  const confirmTree = renderView()
  const overlays = collectByClass(confirmTree, 'dsh-my-memory-overlay')
  assert.equal(overlays.length, 1, '晋升弹出确认层')
  assert.equal(fetchCalls.filter((call) => call.options !== undefined).length, 0, '确认前不得发出写请求')
  const confirmButtons = []
  collectButtonNodes(overlays[0], confirmButtons)
  const allow = confirmButtons.find((button) => button.text === '晋升到 user.md')
  assert.ok(allow, '确认层有「晋升到 user.md」按钮')
  postResponses.push({ ok: true, value: { groups: [], archived: [], suggestions: [] } })
  allow.onClick()
  const posted = fetchCalls.filter((call) => call.options !== undefined && String(call.url).includes('agent-memory'))
  assert.equal(posted.length, 1, '确认后发出一次晋升请求')
  const body = JSON.parse(posted[0].options.body)
  assert.equal(body.action, 'promote', '请求体 action=promote')
  assert.equal(body.text, PROMOTABLE.text, '请求体带建议文本（服务端据此重算，不信任面板状态）')
})

test('晋升被服务端拒绝时把原因显示在面板上，不静默失败', async () => {
  const tree = await openAgentTab()
  const buttons = []
  collectButtonNodes(tree, buttons)
  buttons.find((button) => button.text === '晋升到 user.md' && !button.disabled).onClick()
  const overlays = collectByClass(renderView(), 'dsh-my-memory-overlay')
  const confirmButtons = []
  collectButtonNodes(overlays[0], confirmButtons)
  const reason =
    '不能进全局层：这条含项目专属标识（路径 / 地址 / 端口），请写 projects/current/…；全局层只放跨项目通用的能力'
  postResponses.push({ ok: false, error: { message: reason } })
  confirmButtons.find((button) => button.text === '晋升到 user.md').onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const after = renderView()
  const errors = collectByClass(after, 'dsh-my-memory-error').map((node) => textOf(node.props.children))
  assert.ok(
    errors.some((text) => text.includes('不能进全局层')),
    `面板应显示拒绝原因，实际 ${JSON.stringify(errors)}`,
  )
})
