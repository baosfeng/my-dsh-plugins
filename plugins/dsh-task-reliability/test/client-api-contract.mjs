import { test, beforeEach, afterEach } from 'vitest'
/**
 * dsh-task-reliability — client 端 HTTP 契约防回归测试（TS 迁移随附）。
 *
 * 背景：client 半是浏览器 __ModuleLoader__ bundle，迁移前是 632 行手写
 * lib/client.js（无源码、无构建）。这类代码最容易出现的回归是"接口悄悄改掉了"
 * ——轮询端点、轮询间隔、模式开关/任务操作/回答问题/注册任务的 POST 路径与
 * 载荷，任一处漂移在浏览器里都是静默失效（页签永远空着或点了没反应），而
 * 既有的 client-render.mjs 只渲染元素树、不联网，抓不到。
 *
 * 本套件直接驱动 client.js 产物：桩掉 fetch / setInterval，apply(ctx) 拿到注册
 * 的页签，调用组件，然后断言：
 *  1. 可见时 load() 打三个 GET（info / tasks / questions），并以 6000ms 注册
 *     轮询；visible=false 时不打请求、不注册定时器；
 *  2. 三个 GET 的响应分别落到 info / tasks / questions 三个 state；
 *  3. 三个模式开关的 onClick 分别 POST /api/mode（载荷只带对应键）；
 *  4. 任务操作 POST /api/tasks/<id>/<action>，且重新拉取列表；
 *  5. 回答问题 POST /api/questions/<id>/answer（载荷 { answer }，空白不入库）；
 *  6. 注册任务 POST /api/tasks（载荷 { sessionId, description, mode }）。
 *
 * 行为等价性（迁移前后）由本套件 + client-render.mjs（渲染/注册）+ toggle-styles.mjs
 * （样式契约）共同锁定。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── createElement 桩：宿主元素把 children 放进 props（React 的 createElement
//    对 Function 组件会把第 3+ 参数挂到 props.children）──────────────────
function createElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children } }
}

/**
 * hook 槽位：`<组件名>#<序号>` → [value, setter]。
 *
 * 为什么按组件名分键：没有 React 调度器时组件函数会被测试反复直接调用
 * （Panel 与它渲染的 RegisterForm/QuestionRow 共用同一个 hook 计数器），
 * 全局序号会把不同组件的 state 混在一起；按组件名隔离后每次渲染都稳定命中
 * 自己的槽位，重渲染也不会互相覆盖。
 */
const hookValues = new Map()
/** setState 调用记录（key → 值），用于断言响应落到正确的 state。 */
const stateCalls = []
let currentComponent = 'anonymous'
let hookIndex = 0
/** 本 bundle 的组件函数名（collect 只展开它们，避免把 hook 桩等函数当组件）。 */
const COMPONENT_NAMES = new Set([
  'Panel',
  'Switch',
  'TaskRow',
  'QuestionRow',
  'RegisterForm',
  'TaskReliabilitySettingsView',
  'SettingsSwitchRow',
  'SettingsTextRow',
])

/** 以某个组件的 hook 命名空间调用它。 */
function renderWith(name, fn, props) {
  const prevName = currentComponent
  const prevIndex = hookIndex
  currentComponent = name
  hookIndex = 0
  try {
    return fn(props)
  } finally {
    currentComponent = prevName
    hookIndex = prevIndex
  }
}

/** 已执行过 effect 的组件槽位（模拟 React 的 deps 空数组只跑一次）。 */
const effectRan = new Set()

const stubbedReact = {
  createElement,
  useState: (initial) => {
    const key = `${currentComponent}#${hookIndex}`
    hookIndex += 1
    if (!hookValues.has(key)) {
      const value = typeof initial === 'function' ? initial() : initial
      // setter 真正落值（下一轮渲染读到新 state），同时记录调用轨迹。
      const setter = (next) => {
        const current = hookValues.get(key)
        const resolved = typeof next === 'function' ? next(current[0]) : next
        hookValues.set(key, [resolved, setter])
        stateCalls.push({ key, value: resolved })
      }
      hookValues.set(key, [value, setter])
    }
    return hookValues.get(key)
  },
  // 同步执行 effect，让 load() 立即发出请求（真实 Host 在挂载后执行）；
  // 同一组件的同一个 effect 只跑一次（Panel 的 deps 是 [visible]，测试里
  // visible 不变，重渲染不应重复挂载），否则反复重渲染会放大 fetch 计数。
  useEffect: (fn) => {
    const key = `${currentComponent}!effect#${hookIndex}`
    hookIndex += 1
    if (effectRan.has(key)) return
    effectRan.add(key)
    fn()
  },
}

/** fetch 桩：按 method+URL 记录调用，并返回预置 JSON 响应。 */
let fetchCalls = []
let routes = {}

function stubFetch() {
  global.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const body = options.body === undefined ? undefined : JSON.parse(options.body)
    fetchCalls.push({ url, method, body })
    // 模拟 server 写路径：POST /api/mode 落库后，后续 GET /api/info 返回新值
    // （否则"开关切换 → 状态回流"这条链路在桩里永远看不到变化）。
    if (method === 'POST' && url === '/task-reliability/api/mode' && routes['GET /task-reliability/api/info']?.ok) {
      routes['GET /task-reliability/api/info'] = {
        ok: true,
        value: { ...routes['GET /task-reliability/api/info'].value, ...body },
      }
    }
    const value = routes[`${method} ${url}`] ?? routes[`GET ${url}`] ?? { ok: true, value: undefined }
    // 每次响应重新序列化：组件把响应对象直接塞进 state，多个用例共享同一
    // routes 对象时引用复用会让"新数据"读到旧内容（深拷贝语义）。
    const text = JSON.stringify(value)
    return { status: 200, text: async () => text, json: async () => JSON.parse(text) }
  }
}

/** setInterval 桩：记录注册的间隔，不真的起定时器。 */
let intervals = []
const realSetInterval = global.setInterval

/**
 * document 桩：只实现 client 端用到的 createElement / head.appendChild 与
 * 元素属性读写（apply 里的样式注入路径）。会写入 global.document，由
 * afterEach 统一清理，避免用例间泄漏。
 */
function stubDocument() {
  const elements = []
  const makeElement = (tag) => {
    const node = {
      tag,
      attrs: {},
      textContent: '',
      parentNode: null,
      setAttribute(name, value) {
        node.attrs[name] = value
      },
    }
    elements.push(node)
    return node
  }
  const head = {
    appendChild(child) {
      child.parentNode = head
    },
    removeChild(child) {
      elements.splice(elements.indexOf(child), 1)
      child.parentNode = null
    },
  }
  global.document = { head, createElement: makeElement }
  return { elements, document: global.document }
}

function loadBundle() {
  hookIndex = 0
  currentComponent = 'anonymous'
  hookValues.clear()
  effectRan.clear()
  stateCalls.length = 0
  fetchCalls = []
  intervals = []
  let registered = null
  global.window = {
    __ModuleLoader__: {
      load: (registration) => {
        registered = registration
      },
    },
  }
  Object.defineProperty(global, 'navigator', { value: { language: 'en-US' }, configurable: true })
  global.setInterval = (fn, ms) => {
    intervals.push(ms)
    return { fn, ms }
  }
  eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
  assert.ok(registered, 'bundle registered')
  assert.equal(registered.id, 'dsh-task-reliability')
  const exportsObj = registered.factory((spec) => {
    if (spec === 'react') return stubbedReact
    throw new Error('unexpected require: ' + spec)
  })
  assert.equal(typeof exportsObj.apply, 'function')
  return exportsObj
}

/** apply(ctx) 并返回侧边栏页签描述符。 */
function mountTab(exportsObj) {
  let capturedTab = null
  const mockService = {
    registerTab: (descriptor) => {
      capturedTab = descriptor
      return () => {}
    },
  }
  exportsObj.apply({
    betterSidebar: mockService,
    effect: (fn) => fn(),
    // 严格模拟 cordis：strict 取法在提供者未 active 时返回 undefined。
    get(name, strict = true) {
      if (name === 'betterSidebar') return strict ? undefined : mockService
      return undefined
    },
  })
  assert.ok(capturedTab, 'sidebar tab registered')
  return capturedTab
}

/** 展平元素树，收集全部元素节点（只展开本 bundle 的组件函数）。 */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  out.push(node)
  if (typeof node.type === 'function' && COMPONENT_NAMES.has(node.type.name)) {
    collect(renderWith(node.type.name, node.type, node.props), out)
  } else {
    collect(node.props?.children, out)
  }
  return out
}

/**
 * 宿主元素的直接子节点（扁平化 createElement 传进来的嵌套数组——bundle 里
 * `.map(...)` 的返回值会作为一个数组子节点存在，React 会递归处理）。
 */
function childrenOf(node) {
  const flat = []
  const walk = (child) => {
    if (Array.isArray(child)) {
      for (const item of child) walk(item)
      return
    }
    flat.push(child)
  }
  walk(node?.props?.children)
  return flat
}

/** 收集元素树里的全部文本叶子（渲染断言用）。 */
function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node.type === 'function' && COMPONENT_NAMES.has(node.type.name)) {
    collectText(renderWith(node.type.name, node.type, node.props), out)
  } else {
    collectText(node.props?.children, out)
  }
  return out
}

/** 排空微任务队列（load() 内部是串行 await fetch）。 */
const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** 调一次顶层组件函数，返回元素树。 */
function renderTree(element) {
  const name = typeof element.type === 'function' ? element.type.name || 'anonymous' : 'anonymous'
  return renderWith(name, element.type, element.props)
}

/**
 * 渲染页签两轮（每轮 = 渲染 + 排空），返回"数据已就绪"的元素树。
 *
 * 为什么两轮：effect 只在挂载时跑（deps 未变），重渲染不会自动拉取；测试里改了
 * routes 之后必须让组件再挂载一次才会取到新数据。stub 的 setState 真正落值，
 * 所以最后一轮渲染能读到列表/配置数据。
 */
async function renderLoaded(tab, options = {}) {
  const props = { scope: { sessionId: 'sess-test' }, visible: true, ...options }
  renderTree(tab.component(props))
  await drain()
  return renderTree(tab.component(props))
}

/** 找第一个满足条件的元素。 */
const findNode = (tree, predicate) => collect(tree).find(predicate)
/** 按钮按文案取（按钮 children[0] 是文案）。 */
const findButton = (tree, text) => findNode(tree, (node) => node.type === 'button' && node.props.children?.[0] === text)

/**
 * 只遍历**已展开的**元素树（不重新调用组件函数）。
 *
 * `collect` 为了拿到完整树会重新调用组件，而组件里 `useState` 的局部状态会被
 * 复位（textarea 的输入值、模式选择）。要在"事件写入局部 state → 再点按钮"
 * 之间保持状态，就必须用这个静态查找。
 */
function findNodeStatic(node, predicate) {
  if (node === null || node === undefined || typeof node === 'boolean') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNodeStatic(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(node)) return node
  // 函数组件：按组件命名空间展开（hook 槽位持久化在 hookValues 里，
  // 展开不会丢掉已写入的局部 state）。
  if (typeof node.type === 'function' && COMPONENT_NAMES.has(node.type.name)) {
    const expanded = renderWith(node.type.name, node.type, node.props)
    return findNodeStatic(expanded, predicate)
  }
  return findNodeStatic(node.props?.children, predicate)
}

/**
 * 触发一次面板重新挂载：清掉 effect 守卫让 `useEffect(..., [visible])` 再跑一次
 * （模拟下一个轮询周期），渲染 + 排空后返回新树。用于"状态/数据变化后再看一帧"。
 *
 * 注意：不会清 fetchCalls（调用方可自行对比前后的请求记录）。
 */
async function reloadPanel(tab, options = {}) {
  for (const key of [...effectRan]) if (key.startsWith('Panel!')) effectRan.delete(key)
  const props = { scope: { sessionId: 'sess-test' }, visible: true, ...options }
  renderTree(tab.component(props))
  await drain()
  return renderTree(tab.component(props))
}

beforeEach(() => {
  routes = {}
  stubFetch()
})

afterEach(() => {
  global.setInterval = realSetInterval
  delete global.document
})

test('visible panel polls the three list endpoints and re-arms every 6000ms', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  routes = {
    'GET /task-reliability/api/info': { ok: true, value: { tracking: true, verify: false, autopilot: true } },
    'GET /task-reliability/api/tasks': { ok: true, value: [{ id: 't1', description: 'task one', status: 'active' }] },
    'GET /task-reliability/api/questions': { ok: true, value: [{ id: 'q1', question: 'pick one' }] },
  }

  renderTree(tab.component({ scope: { sessionId: 'sess-test' }, visible: true }))
  await drain()

  assert.deepEqual(
    fetchCalls.map((call) => `${call.method} ${call.url}`),
    ['GET /task-reliability/api/info', 'GET /task-reliability/api/tasks', 'GET /task-reliability/api/questions'],
    'panel load() must poll info + tasks + questions in order',
  )
  assert.deepEqual(intervals, [6000], 'polling must re-arm at POLL_MS (6000ms)')

  // Panel 的 state 槽位依次是 info / tasks / questions / loadError。
  const infoCall = stateCalls.find((call) => call.key === 'Panel#0' && call.value?.tracking === true)
  const tasksCall = stateCalls.find((call) => call.key === 'Panel#1' && Array.isArray(call.value))
  const questionsCall = stateCalls.find((call) => call.key === 'Panel#2' && Array.isArray(call.value))
  assert.ok(infoCall, 'info response must land in the info state')
  assert.ok(tasksCall, 'tasks response must land in the tasks state')
  assert.ok(questionsCall, 'questions response must land in the questions state')
  assert.deepEqual(tasksCall.value, [{ id: 't1', description: 'task one', status: 'active' }])
  assert.deepEqual(questionsCall.value, [{ id: 'q1', question: 'pick one' }])

  // 数据就绪后重渲染：列表与问题各自渲染出卡片。
  const tree = await renderLoaded(tab)
  assert.deepEqual(
    collect(tree)
      .filter((node) => node.props?.className === 'dtr-task')
      .map((node) => node.props.children[1]?.props?.children?.[0]),
    ['task one'],
    'loaded tasks must render as dtr-task rows',
  )
  assert.equal(
    collect(tree).filter((node) => node.props?.className === 'dtr-question').length,
    1,
    'loaded questions must render as dtr-question rows',
  )
})

test('hidden panel (visible === false) issues no request and arms no interval', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  renderTree(tab.component({ scope: { sessionId: 'sess-test' }, visible: false }))
  await drain()
  assert.deepEqual(fetchCalls, [], 'hidden tab must not poll')
  assert.deepEqual(intervals, [], 'hidden tab must not arm a polling interval')
})

test('each mode switch POSTs only its own key to /api/mode', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  routes = {
    'GET /task-reliability/api/info': { ok: true, value: { tracking: false, verify: false, autopilot: false } },
    'GET /task-reliability/api/tasks': { ok: true, value: [] },
    'GET /task-reliability/api/questions': { ok: true, value: [] },
  }
  const tree = await renderLoaded(tab)

  // 三个开关行：Switch 组件渲染出的 dtr-switch-row 容器。
  const switchRows = collect(tree).filter((node) => node.props?.className === 'dtr-switch-row')
  assert.equal(switchRows.length, 3, 'panel must render three mode switches')
  const toggles = switchRows.map((row) => row.props.children[1])
  assert.deepEqual(
    toggles.map((toggle) => toggle.props['data-on']),
    ['false', 'false', 'false'],
    'switch on-state must come from info (all false here)',
  )
  assert.deepEqual(
    toggles.map((toggle) => toggle.props['aria-checked']),
    ['false', 'false', 'false'],
    'switch must expose aria-checked for the current state',
  )
  assert.deepEqual(
    switchRows.map((row) => row.props.children[0].props.children[0].props.children[0]),
    ['Reliability tracking', 'Completion verify', 'Autopilot'],
    'switch labels must be the three modes',
  )

  fetchCalls = []
  for (const toggle of toggles) toggle.props.onClick()
  await drain()

  assert.deepEqual(
    fetchCalls.filter((call) => call.method === 'POST').map((call) => [call.url, call.body]),
    [
      ['/task-reliability/api/mode', { tracking: true }],
      ['/task-reliability/api/mode', { verify: true }],
      ['/task-reliability/api/mode', { autopilot: true }],
    ],
    'each switch must POST only its own key (info is false → toggling sends true)',
  )
  // 每次 POST 后立即重新拉取列表（不等下一个轮询周期）：3 次点击 → 3 组 GET。
  assert.equal(
    fetchCalls.filter((call) => call.method === 'GET').length,
    3 * 3,
    'every mode change must trigger a fresh 3-endpoint reload',
  )
  // 状态回流：info.tracking 变 true → 开关 data-on 翻转（重挂载取新数据）。
  const after = await reloadPanel(tab)
  assert.equal(
    collect(after).filter((node) => node.props?.className === 'dtr-switch-row')[0].props.children[1].props['data-on'],
    'true',
    'switch must reflect the new mode after the POST + reload',
  )
})

test('task actions POST /api/tasks/<id>/<action> and reload', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  routes = {
    'GET /task-reliability/api/info': { ok: true, value: {} },
    'GET /task-reliability/api/tasks': {
      ok: true,
      value: [
        { id: 't-active', description: 'a', status: 'active' },
        { id: 't-done', description: 'b', status: 'done' },
      ],
    },
    'GET /task-reliability/api/questions': { ok: true, value: [] },
  }
  const tree = await renderLoaded(tab)

  // 每条任务渲染 done/暂停|恢复/删除 三个按钮，共 6 个（注册表单的按钮不含 dtr-task 容器）。
  const taskRows = collect(tree).filter((node) => node.props?.className === 'dtr-task')
  assert.equal(taskRows.length, 2, 'two task rows rendered')
  const rowButtons = taskRows.map((row) => collect(row.props.children[3]).filter((node) => node.type === 'button'))
  assert.deepEqual(
    rowButtons.map((buttons) => buttons.map((button) => button.props.children[0])),
    [
      ['Done', 'Pause', 'Delete'],
      ['Resume', 'Delete'],
    ],
    'active row: Done/Pause/Delete; done row: Resume/Delete (no Done button)',
  )

  fetchCalls = []
  for (const button of rowButtons[0]) {
    button.props.onClick()
    await drain()
  }
  assert.deepEqual(
    fetchCalls.filter((call) => call.method === 'POST').map((call) => [call.url, call.body]),
    [
      ['/task-reliability/api/tasks/t-active/done', {}],
      ['/task-reliability/api/tasks/t-active/pause', {}],
      ['/task-reliability/api/tasks/t-active/delete', {}],
    ],
    'task action must POST /api/tasks/<id>/<action> with an empty JSON body',
  )
  assert.equal(
    fetchCalls.filter((call) => call.method === 'GET').length,
    3 * 3,
    'every task action must reload the lists',
  )

  // 元信息：verify 模式 + 继续/校验次数（strings.loops / strings.verifies）。
  routes['GET /task-reliability/api/tasks'] = {
    ok: true,
    value: [{ id: 't-meta', description: 'c', status: 'checking', mode: 'verify', loopCount: 3, verifyCount: 2 }],
  }
  const metaTree = await reloadPanel(tab)
  const meta = findNode(metaTree, (node) => node.props?.className === 'dtr-task-meta')
  assert.ok(meta, 'task with counters must render the meta line')
  assert.equal(meta.props.children[0], 'Verify · 3 continues · 2 verifies', 'task meta line must list mode + counters')
})

test('answering a question POSTs { answer } to /api/questions/<id>/answer', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  routes = {
    'GET /task-reliability/api/info': { ok: true, value: {} },
    'GET /task-reliability/api/tasks': { ok: true, value: [] },
    'GET /task-reliability/api/questions': {
      ok: true,
      value: [
        { id: 'q-1', question: 'pick one' },
        { id: 'q-2', question: 'already answered', answer: 'yes' },
      ],
    },
  }
  const tree = await renderLoaded(tab)

  // 未回答的问题渲染「问题文本 + 输入框 + 回答按钮」；已回答的问题不进待确认
  // 列表（filter answer === undefined），所以整棵树只有 1 个 dtr-question。
  const questions = collect(tree).filter((node) => node.props?.className === 'dtr-question')
  assert.equal(questions.length, 1, 'only unanswered questions enter the pending list')
  assert.deepEqual(
    childrenOf(questions[0]).map((child) => child.type),
    ['div', 'textarea', 'div'],
    'unanswered question = question text + answer textarea + actions row',
  )
  assert.ok(collectText(tree).includes('pick one'), 'the unanswered question text must be rendered')
  assert.ok(
    !collectText(tree).includes('already answered') && !collectText(tree).includes('yes'),
    'answered questions must not leak into the pending list',
  )
  const answerButton = findButton(tree, 'Answer')
  assert.ok(answerButton, 'unanswered question must render an Answer button')

  // 未输入内容时不提交（防回归：空白答案不入库）。
  fetchCalls = []
  answerButton.props.onClick()
  await drain()
  assert.deepEqual(
    fetchCalls.filter((call) => call.method === 'POST'),
    [],
    'empty answer must not be submitted',
  )

  // 提交：从问题卡片元素上取 Panel 注入的 onAnswer（= answerQuestion，内部就是
  // 一次 post(...) + load()），断言载荷形状与"回答后重新拉取列表"。
  const questionsSection = childrenOf(tree).find(
    (node) =>
      node?.props?.className === 'dtr-section' && childrenOf(node)[0]?.props?.children?.[0] === 'Pending questions',
  )
  assert.ok(questionsSection, 'questions section must be a direct child of the panel')
  const questionRow = collect(questionsSection).find((node) => typeof node.type === 'function')
  assert.equal(questionRow?.type?.name, 'QuestionRow', 'the pending question must render a QuestionRow')
  assert.equal(typeof questionRow.props.onAnswer, 'function', 'Panel must inject the answer handler into QuestionRow')
  const textarea = findNodeStatic(questions[0], (node) => node.type === 'textarea')
  assert.ok(textarea, 'unanswered question must render a textarea')
  textarea.props.onChange({ target: { value: '  option B  ' } })

  fetchCalls = []
  questionRow.props.onAnswer('q-1', '  option B  '.trim())
  await drain()
  assert.deepEqual(
    fetchCalls.filter((call) => call.method === 'POST').map((call) => [call.url, call.body]),
    [['/task-reliability/api/questions/q-1/answer', { answer: 'option B' }]],
    'answer must be POSTed trimmed to /api/questions/<id>/answer',
  )
  assert.equal(fetchCalls.filter((call) => call.method === 'GET').length, 3, 'answering must reload the lists')
})

test('apply injects the panel stylesheet with the plugin attribute tag and unregisters on teardown', async () => {
  const exportsObj = loadBundle()
  const { elements } = stubDocument()

  const disposers = []
  let capturedTab = null
  const mockService = {
    registerTab: (descriptor) => {
      capturedTab = descriptor
      return () => {}
    },
  }
  const ctx = {
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    get(name, strict = true) {
      if (name === 'betterSidebar') return strict ? undefined : mockService
      return undefined
    },
  }
  exportsObj.apply(ctx)
  assert.ok(capturedTab, 'tab registered')

  const style = elements.find((node) => node.tag === 'style')
  assert.ok(style, 'apply must inject a <style> element')
  assert.equal(style.attrs['data-dsh-task-reliability'], 'styles', 'stylesheet must be tagged for diagnostics')
  assert.ok(style.textContent.includes('.dtr-panel{'), 'injected stylesheet must carry the panel CSS')
  assert.ok(style.textContent.includes('.dtr-toggle[data-on="true"]'), 'injected stylesheet must carry the toggle CSS')

  // fiber teardown：两个 effect 的 disposer 各自摘掉自己插入的 <style>，
  // 且不得抛错（HMR / 插件禁用路径）。
  assert.ok(disposers.length >= 2, 'apply must register styles + tab effects')
  for (const dispose of disposers) dispose()
  assert.equal(style.parentNode, null, 'teardown must detach the injected stylesheet')
})

test('settings tab registers through the slots service and degrades silently without it', async () => {
  const exportsObj = loadBundle()

  // slots 服务缺失（未安装 dsh-client-ui-renderer）：静默跳过，不抛错。
  const { elements: bareElements } = stubDocument()
  let error = null
  try {
    exportsObj.apply({ effect: (fn) => fn(), get: () => undefined })
  } catch (caught) {
    error = caught
  }
  assert.equal(error, null, 'apply must not throw when neither service exists')
  assert.deepEqual(
    bareElements.map((node) => node.attrs),
    [{ 'data-dsh-task-reliability': 'styles' }],
    'without the slots service only the panel stylesheet may be injected (settings tab skipped silently)',
  )

  const { elements } = stubDocument()
  const registered = []
  const mockSlots = {
    register: (descriptor, component) => {
      registered.push({ descriptor, component })
      return { descriptor, component }
    },
    inject: (name, register) => {
      assert.equal(name, 'settings.plugins.tab', 'settings slot name must stay stable')
      register()
      return () => {}
    },
  }
  exportsObj.apply({
    effect: (fn) => fn(),
    get(name, strict = true) {
      // 防回归（首屏时序）：提供者 fiber 未 active 时 strict 取法返回 undefined，
      // 代码必须走 strict=false 才能拿到服务；这里两种取法都返回服务。
      if (name === 'slots') return strict ? undefined : mockSlots
      return undefined
    },
  })
  assert.equal(registered.length, 1, 'settings tab must register exactly once')
  assert.equal(registered[0].descriptor.name, 'settings.plugins.tab', 'slot name must stay stable')
  assert.equal(registered[0].descriptor.id, 'task-reliability-settings', 'settings tab id must stay stable')
  assert.equal(registered[0].descriptor.order, 92, 'settings tab order must stay stable')
  assert.equal(typeof registered[0].descriptor.label, 'function', 'settings tab label must be a function')
  assert.ok(registered[0].descriptor.label() !== '', 'settings tab label must not be empty')
  assert.equal(typeof registered[0].component, 'function', 'settings tab component must be the view')

  const settingsStyle = elements.find(
    (node) => node.tag === 'style' && node.attrs['data-dsh-task-reliability-settings'],
  )
  assert.ok(settingsStyle, 'settings stylesheet must be injected together with the settings tab')
  assert.ok(settingsStyle.textContent.includes('.dtr-settings{'), 'settings stylesheet must carry the settings CSS')
  assert.ok(
    settingsStyle.textContent.includes('.dtr-settings-input'),
    'settings stylesheet must style the numeric/text inputs',
  )
})

test('register task POSTs { sessionId, description, mode } to /api/tasks', async () => {
  const exportsObj = loadBundle()
  const tab = mountTab(exportsObj)
  routes = {
    'GET /task-reliability/api/info': { ok: true, value: {} },
    'GET /task-reliability/api/tasks': { ok: true, value: [] },
    'GET /task-reliability/api/questions': { ok: true, value: [] },
  }
  const tree = await renderLoaded(tab)

  assert.ok(findButton(tree, 'Register task'), 'register form must render the submit button')
  assert.ok(findButton(tree, 'Direct'), 'register form must render the mode toggle (Direct by default)')
  const registerTextarea = collect(tree).find((node) => node.type === 'textarea')
  assert.ok(registerTextarea, 'register form must render a description textarea')
  assert.equal(
    registerTextarea.props.placeholder,
    'e.g. Build a feature and pass tests',
    'register textarea must carry the description placeholder',
  )

  // 模式切到 verify：按钮文案随之变化（下一次渲染读到新 state）。
  findButton(tree, 'Direct').props.onClick()
  const afterMode = await renderLoaded(tab)
  assert.ok(findButton(afterMode, 'Verify'), 'mode toggle must flip to Verify')

  // 描述入草稿 + 提交：POST { sessionId, description(trim), mode }。
  collect(afterMode)
    .find((node) => node.type === 'textarea')
    .props.onChange({ target: { value: '  ship the release  ' } })
  fetchCalls = []
  findButton(await renderLoaded(tab), 'Register task').props.onClick()
  await drain()
  assert.deepEqual(
    fetchCalls.filter((call) => call.method === 'POST').map((call) => [call.url, call.body]),
    [['/task-reliability/api/tasks', { sessionId: 'sess-test', description: 'ship the release', mode: 'verify' }]],
    'register must POST the current sessionId, trimmed description and selected mode',
  )
})
