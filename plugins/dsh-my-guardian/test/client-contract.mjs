/**
 * dsh-my-guardian — client 端「构建契约 + 行为契约」防回归测试（TS 迁移随附）。
 *
 * 迁移背景：client 半原先由 5 个手写 `lib/parts/*.part.js` 片段拼接，没有任何
 * 测试锁住「谁是源码」；迁移后 `src/client/parts/*.ts` 是唯一真源，产物
 * `lib/parts/*.js` 与 `lib/client.js` 必须提交且与源码同步（TS 升级规范 6.2：
 * CI 只跑 node --check + 测试，从不跑构建，只改产物 = 下次构建即丢失）。
 *
 * 本套件覆盖四类契约：
 *
 * 1. 构建契约
 *    - 提交进仓库的 `lib/client.js` 必须**逐字节**等于 `lib/client.src.js` 模板
 *      拼接 `lib/parts/*.js` 的结果（源码/产物不同步立即失败）；
 *    - 产物零未解析 `__PART_*__` 占位符；bundle 内不得出现相对路径 require
 *      （DSH 浏览器 ModuleLoader 不支持 factory 内 `require('./x.js')`）；
 *    - 每个片段都有对应的 `src/client/parts/<name>.ts`，两者顶层声明一致，
 *      且 TS 片段无 import/export（片段共享 factory 作用域）；
 *    - `scripts/build.mjs` 的 pieces 清单/顺序与上面的片段清单一致 —— 新增 TS
 *      片段却漏接进构建（或调换顺序触发 TDZ）会被抓住。
 *
 * 2. 样式契约：apply 把 STYLES 注入 `<style data-dsh-my-guardian=styles>`，
 *    fiber teardown 时移除；document 不可用时静默降级。
 *
 * 3. API 契约：可见时 GET /guardian/api/state 并按 POLL_MS 轮询；隐藏时不轮询；
 *    retry / remove / safemode 三个 POST 的路径与载荷；失败时显示错误横幅。
 *
 * 4. 渲染契约：loading / 空态 / 条目列表 / 失败分类徽章 / 安装建议 / 冻结提示 /
 *    失败行默认展开错误详情 / 移除二次确认 / 事件日志过滤启动噪音 / i18n 回退。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

// ── 构建契约清单（顺序必须与 scripts/build.mjs 的 pieces 完全一致）──────────
const PIECES = [
  ['__PART_STYLES__', 'lib/parts/styles.js'],
  ['__PART_UTIL__', 'lib/parts/util.js'],
  ['__PART_ICONS__', '../dsh-shared/client-parts/icons.part.js'],
  ['__PART_ROW__', 'lib/parts/row.js'],
  ['__PART_VIEW__', 'lib/parts/view.js'],
  ['__PART_APPLY__', 'lib/parts/apply.js'],
]

/** 本插件自己的片段（icons 是 dsh-shared 共享片段，无 TS 源码）。 */
const OWN_PARTS = PIECES.filter(([, file]) => file.startsWith('lib/parts/')).map(([, file]) =>
  file.replace('lib/parts/', '').replace('.js', ''),
)

/** 片段顶层声明名（async function / function / const），用于锁定「产物来自 TS 源码」。 */
function topLevelDecls(src) {
  return [
    ...src.matchAll(
      /^(?:async\s+function\s+([A-Za-z_$][\w$]*)|function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/gm,
    ),
  ]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .sort()
}

// ── React 桩：真实 createElement 语义 + 可控 hook 槽位 ─────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let hookStates = []
let hookIndex = 0
let effectIndex = 0
let effectRan = new Set()
let stateCalls = []

function resetHooks() {
  hookStates = []
  hookIndex = 0
  effectIndex = 0
  effectRan = new Set()
  stateCalls = []
}

/** 每次「渲染」前重置游标：hook 槽位按渲染顺序稳定复用。 */
function resetCursors() {
  hookIndex = 0
  effectIndex = 0
}

const stubbedReact = {
  createElement,
  useState: (initial) => {
    const index = hookIndex
    hookIndex += 1
    if (!(index in hookStates)) hookStates[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next
      stateCalls.push({ index, value: hookStates[index] })
    }
    return [hookStates[index], setter]
  },
  // effect 同步执行一次（真实宿主在挂载后执行）；同一渲染序号的 effect 只跑一次，
  // 避免重渲染放大 fetch 计数。
  useEffect: (fn) => {
    const key = effectIndex
    effectIndex += 1
    if (effectRan.has(key)) return
    effectRan.add(key)
    fn()
  },
}

// ── 全局桩（window / document / navigator / fetch）────────────────────────
let fetchCalls = []
let intervals = []
let routeTable = {}

function setNavigator(language) {
  Object.defineProperty(global, 'navigator', {
    value: language === undefined ? undefined : { language },
    configurable: true,
  })
}

function stubFetch(routes) {
  routeTable = routes
  fetchCalls = []
  global.fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    fetchCalls.push({ url, method, body: options.body === undefined ? undefined : JSON.parse(options.body) })
    const payload = routeTable[`${method} ${url}`] ?? { ok: true, value: {} }
    return { json: async () => payload }
  }
}

function stubDocument() {
  const elements = []
  const head = {
    appendChild(child) {
      elements.push(child)
      child.parentNode = head
    },
    removeChild(child) {
      const index = elements.indexOf(child)
      if (index >= 0) elements.splice(index, 1)
      child.parentNode = null
    },
  }
  global.document = {
    head,
    createElement: (tag) => {
      const node = { tag, attrs: {}, textContent: '', parentNode: null }
      node.setAttribute = (name, value) => {
        node.attrs[name] = value
      }
      return node
    },
  }
  return { head, elements }
}

// ── 加载 bundle 产物（一次）───────────────────────────────────────────────
let bundleRegistered = null
global.window = { __ModuleLoader__: { load: (registration) => (bundleRegistered = registration) } }
eval(read('../lib/client.js'))
assert.ok(bundleRegistered, 'bundle 必须调用 window.__ModuleLoader__.load 注册')
const exportsObj = bundleRegistered.factory((spec) => {
  if (spec === 'react') return stubbedReact
  throw new Error(`unexpected require: ${spec}`)
})

/** 挂载插件：跑 apply(ctx)，返回注册到的页签 + 收集到的 teardown。 */
function mount(options = {}) {
  const { routes = {}, language = 'zh-CN', sidebar = true, hasDocument = true } = options
  resetHooks()
  setNavigator(language)
  stubFetch(routes)
  intervals = []
  delete global.document
  const doc = hasDocument ? stubDocument() : null

  let tab = null
  const service = sidebar
    ? {
        registerTab: (descriptor) => {
          tab = descriptor
          return () => {
            tab = null
          }
        },
      }
    : undefined
  const cleanups = []
  const ctx = {
    effect: (fn) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    // 模拟 cordis：strict 取法（提供者 fiber 未 active）返回 undefined，
    // strict=false 才拿到实例。
    get: (name, strict = true) => (name === 'betterSidebar' ? (strict ? undefined : service) : undefined),
  }
  global.window = {
    __ModuleLoader__: { load: () => {} },
    setInterval: (fn, ms) => {
      intervals.push(ms)
      return { fn, ms }
    },
    clearInterval: () => {},
  }
  exportsObj.apply(ctx)
  return {
    ctx,
    doc,
    cleanups,
    get tab() {
      return tab
    },
  }
}

/** 渲染页签组件并把元素树展开成扁平 host 元素列表。 */
function renderTab(tab, visible = true) {
  resetCursors()
  const element = tab.component({ scope: { sessionId: 'sess-1' }, visible })
  return collect(element)
}

/** 展开 React 元素树（调用函数式组件），返回扁平节点列表。 */
function collect(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  const el = typeof node.type === 'function' ? node.type(node.props) : node
  if (el === null || el === undefined) return out
  out.push(el)
  collect(el.props?.children, out)
  return out
}

/** 元素树里的字符串子节点（直接子级）。 */
function texts(nodes) {
  return nodes.flatMap((el) => {
    const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
    return kids.filter((child) => typeof child === 'string')
  })
}

const byClass = (nodes, className) => nodes.find((el) => el.props?.className === className)
const byClassPrefix = (nodes, prefix) =>
  nodes.filter((el) => typeof el.props?.className === 'string' && el.props.className.split(' ')[0] === prefix)
const byClassStartsWith = (nodes, prefix) =>
  nodes.filter((el) => typeof el.props?.className === 'string' && el.props.className.startsWith(prefix))
const byAria = (nodes, label) => nodes.find((el) => el.type === 'button' && el.props['aria-label'] === label)

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── 「TS 是唯一真源」强锁：把 TS 源做类型剥离后与产物逐字符比对 ─────────────
// Node ≥22.13 提供 module.stripTypeScriptTypes（只剥离类型、不做转译），正好
// 等价于 tsc 的 emit 语义；据此可以抓住**任何**源码/产物漂移，包括「改了 TS
// 源码忘了 npm run build」这种只靠声明名比对抓不到的情况。旧版本 Node 上该
// API 不存在时退回「顶层声明名 + 字面量双向集合」锁（见对应测试）。
let stripTypes = null
try {
  const nodeModule = await import('node:module')
  if (typeof nodeModule.stripTypeScriptTypes === 'function') {
    stripTypes = (code) => nodeModule.stripTypeScriptTypes(code, { mode: 'strip' })
  }
} catch {
  stripTypes = null
}

/**
 * 归一化后比对：去掉注释、tsc 注入的 `'use strict'`、类型剥离留下的尾随逗号
 * 与全部空白。两侧用同一套规则，因此注释/缩进/换行差异不会误报，而任何标识符、
 * 字面量或调用结构的变化都会让字符串不同。
 */
function stripForCompare(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'use strict'/g, '')
    .replace(/,\s*([)}\]])/g, '$1')
    .replace(/\s+/g, '')
}

/** 旧 Node 的降级锁：源码/产物的字面量集合必须相等（双向）。 */
function literals(src) {
  return [...src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([\s\S]*?)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
    .filter((value) => value.trim() !== '')
    .sort()
}

// ── 数据 fixture ─────────────────────────────────────────────────────────
const makeEntry = (over = {}) => ({
  id: 'dsh-entry',
  name: 'dsh-entry',
  status: 'running',
  attempts: 0,
  lastError: null,
  lastFailedAt: null,
  failureType: null,
  installHint: null,
  ...over,
})

const makeState = (over = {}) => ({
  safeMode: false,
  staged: [],
  promoted: [],
  events: [],
  loaded: true,
  ...over,
})

/** 挂载 + 预置 state 响应 + 渲染两轮（首轮触发 load，次轮拿到数据）。 */
async function renderLoaded(over = {}, options = {}) {
  const state = makeState(over)
  const h = mount({ ...options, routes: { 'GET /guardian/api/state': { ok: true, value: state }, ...options.routes } })
  renderTab(h.tab, options.visible ?? true)
  await flush()
  return { h, nodes: renderTab(h.tab, options.visible ?? true) }
}

// ══ 1. 构建契约 ═════════════════════════════════════════════════════════

test('构建契约：lib/client.js 必须等于 lib/client.src.js 模板 + lib/parts/*.js 片段拼接结果', () => {
  let expected = read('../lib/client.src.js')
  for (const [placeholder, file] of PIECES) {
    assert.ok(expected.includes(placeholder), `lib/client.src.js 缺少 ${placeholder} 占位符`)
    const part = read(`../${file}`)
    // 函数式替换：片段里的 $&/$1 不作特殊解释（与 scripts/build.mjs 一致）
    expected = expected.replaceAll(placeholder, () => part)
  }
  assert.equal(
    read('../lib/client.js'),
    expected,
    'lib/client.js 与「模板 + 片段」不一致：源码/产物不同步，请 npm run build 并提交产物',
  )
})

test('构建契约：每个片段都有 TS 源码、无 import/export，顶层声明与产物一致', () => {
  const bundle = read('../lib/client.js')
  assert.ok(!bundle.includes('__PART_'), 'lib/client.js 里仍有未解析的 __PART_*__ 占位符')
  assert.ok(
    !/require\(\s*['"]\.{1,2}\//.test(bundle),
    'bundle 内不得有相对路径 require：DSH ModuleLoader 不支持 factory 内的相对路径解析',
  )

  for (const name of OWN_PARTS) {
    const ts = read(`../src/client/parts/${name}.ts`)
    const js = read(`../lib/parts/${name}.js`)
    assert.deepEqual(
      topLevelDecls(ts),
      topLevelDecls(js),
      `${name}: src/client/parts/${name}.ts 与产物 lib/parts/${name}.js 的顶层声明必须一致（只改产物会被下次构建覆盖）`,
    )
    assert.ok(
      !/^\s*(?:import|export)\s/m.test(ts),
      `${name}.ts 不得有 import/export：片段共享 factory 作用域，DSH ModuleLoader 不支持相对路径 require`,
    )
    assert.ok(ts.includes('function') || ts.includes('const'), `${name}.ts 应为纯声明片段`)
  }
  assert.deepEqual(OWN_PARTS.slice().sort(), ['apply', 'row', 'styles', 'util', 'view'])
})

test('构建契约：产物必须与 TS 源逐字符对应（改了源码不重建产物即失败）', () => {
  for (const name of OWN_PARTS) {
    const ts = read(`../src/client/parts/${name}.ts`)
    const js = read(`../lib/parts/${name}.js`)
    if (stripTypes !== null) {
      assert.equal(
        stripForCompare(stripTypes(ts)),
        stripForCompare(js),
        `${name}: lib/parts/${name}.js 与 src/client/parts/${name}.ts 不一致 —— 源码与产物不同步，请 npm run build 并提交产物`,
      )
    } else {
      assert.deepEqual(
        literals(ts),
        literals(js),
        `${name}: 源码与产物的字面量集合不一致（当前 Node 无 stripTypeScriptTypes，降级为字面量锁）`,
      )
    }
  }
})

test('构建契约：build.mjs 的 pieces 与 TS 片段一一对应且顺序一致（漏接/乱序即失败）', () => {
  const build = read('../scripts/build.mjs')
  const parsed = [...build.matchAll(/\['(__PART_[A-Z_]+__)',\s*'([^']+)'([^\]]*)\]/g)].map(
    ([, placeholder, name, rest]) => ({
      placeholder,
      name,
      shared: rest.includes('shared: true'),
    }),
  )

  assert.deepEqual(
    parsed.map((piece) => piece.placeholder),
    PIECES.map(([placeholder]) => placeholder),
    'build.mjs 的片段顺序必须与拼接顺序一致：const 初始化有 TDZ 依赖（styles/util 先于 row/view，view 先于 apply）',
  )
  assert.deepEqual(
    parsed
      .filter((piece) => !piece.shared)
      .map((piece) => `${piece.name}.js`)
      .sort(),
    PIECES.filter(([, file]) => file.startsWith('lib/parts/'))
      .map(([, file]) => file.replace('lib/parts/', ''))
      .sort(),
    'build.mjs 发布的片段必须与 src/client/parts/*.ts 一一对应',
  )
  assert.equal(parsed.filter((piece) => piece.shared).length, 1, '唯一共享片段是 dsh-shared 的 icons.part.js')
})

// ══ 2. 应用 / 样式契约 ═══════════════════════════════════════════════════

test('样式契约：apply 注入 <style data-dsh-my-guardian=styles>，fiber teardown 时移除', () => {
  const h = mount()
  assert.ok(h.doc, '测试需要 document 桩')
  const style = h.doc.elements.find((el) => el.tag === 'style')
  assert.ok(style, 'apply 必须注入一个 <style> 元素')
  assert.equal(style.attrs['data-dsh-my-guardian'], 'styles', '样式元素带 data 标记（便于排查与去重）')
  assert.equal(style.parentNode, h.doc.head, '样式元素挂在 document.head')
  assert.ok(style.textContent.includes('.dsh-my-guardian-root'), 'STYLES 被完整注入')
  assert.ok(style.textContent.includes('@keyframes dsh-my-guardian-row-in'), '关键帧随样式注入')
  assert.ok(style.textContent.includes('--dsw-alias-state-warn-primary'), '使用 DSH 语义 token')

  h.cleanups[0]()
  assert.equal(style.parentNode, null, 'teardown 必须移除样式元素，避免 HMR 后重复注入')
})

test('应用契约：betterSidebar 未提供时静默跳过；strict 取法返回 undefined 仍注册页签', () => {
  const withoutService = mount({ sidebar: false })
  assert.equal(withoutService.tab, null, '未安装 better-sidebar 时不注册、不抛异常')

  const withService = mount()
  assert.ok(withService.tab, 'strict=false 取法拿到服务实例时必须注册页签（首屏提供者 fiber 尚未 active）')
  assert.equal(withService.tab.id, 'dsh-my-guardian:panel')
  assert.equal(withService.tab.order, 80)
  assert.equal(withService.tab.single, true)
  assert.equal(withService.tab.title(), '插件守护', '页签标题走 i18n')
  assert.equal(typeof withService.tab.component, 'function')
})

test('样式契约：document 不可用时 apply 降级为 no-op（返回空 teardown）', () => {
  const h = mount({ hasDocument: false })
  assert.equal(h.doc, null)
  assert.equal(global.document, undefined, 'document 缺失时不注入样式')
  assert.ok(h.cleanups.length >= 1, '样式 effect 仍返回 teardown（降级为空函数）')
  assert.doesNotThrow(() => h.cleanups[0](), '降级 teardown 可安全调用')
})

// ══ 3. API 契约 ═════════════════════════════════════════════════════════

test('API 契约：可见时 GET /guardian/api/state 并按 5000ms 轮询，隐藏时不轮询', async () => {
  const visible = mount({ routes: { 'GET /guardian/api/state': { ok: true, value: makeState() } } })
  renderTab(visible.tab, true)
  assert.deepEqual(
    fetchCalls.map((call) => `${call.method} ${call.url}`),
    ['GET /guardian/api/state'],
    '首屏拉取一次 state',
  )
  assert.deepEqual(intervals, [5000], '可见时注册 5000ms 轮询')

  const hidden = mount({ routes: { 'GET /guardian/api/state': { ok: true, value: makeState() } } })
  renderTab(hidden.tab, false)
  assert.equal(fetchCalls.length, 1, '隐藏时仍做一次首屏拉取')
  assert.deepEqual(intervals, [], '隐藏时不注册轮询（避免后台刷接口）')
})

test('API 契约：state 响应落到视图，失败时显示错误横幅与重试按钮', async () => {
  const { nodes } = await renderLoaded({
    staged: [makeEntry({ id: 'dsh-a', name: 'dsh-a', status: 'pending' })],
  })
  const joined = texts(nodes).join('|')
  assert.ok(joined.includes('dsh-a'), '服务端返回的条目被渲染')
  assert.ok(joined.includes('待加载'), 'staged 条目渲染 pending 文案')
  assert.equal(byClass(nodes, 'dsh-my-guardian-error'), undefined, '正常响应不显示错误横幅')

  const failing = mount({ routes: { 'GET /guardian/api/state': { ok: false, error: { message: 'boom' } } } })
  renderTab(failing.tab, true)
  await flush()
  const failedNodes = renderTab(failing.tab, true)
  const banner = byClass(failedNodes, 'dsh-my-guardian-error')
  assert.ok(banner, 'ok:false 响应必须显示错误横幅')
  assert.ok(texts(failedNodes).join('|').includes('加载失败'), '错误横幅带 i18n 文案')
  assert.ok(byAria(failedNodes, '重试'), '错误横幅提供重试按钮')
})

test('API 契约：retry/remove/safemode 的路径与载荷，成功后重新拉取 state', async () => {
  const routes = {
    'GET /guardian/api/state': {
      ok: true,
      value: makeState({ staged: [makeEntry({ status: 'failed', attempts: 2, lastError: 'boom' })] }),
    },
  }
  const { h, nodes } = await renderLoaded({}, { routes })

  // retry：failed 行显示重试按钮 → POST retry { id }
  byAria(nodes, '重试').props.onClick()
  await flush()
  assert.deepEqual(
    fetchCalls.at(-2),
    {
      url: '/guardian/api/retry',
      method: 'POST',
      body: { id: 'dsh-entry' },
    },
    'retry 走 POST /guardian/api/retry，载荷 { id }',
  )
  assert.equal(fetchCalls.at(-1).url, '/guardian/api/state', '动作成功后重新拉取 state')

  // remove：先弹二次确认，确认后 POST remove { id }
  const beforeRemove = fetchCalls.length
  byAria(nodes, '移除').props.onClick()
  const confirming = renderTab(h.tab, true)
  assert.ok(texts(confirming).join('|').includes('移除该插件条目？'), '移除必须二次确认（不可一键破坏）')
  const buttons = confirming.filter((el) => el.type === 'button')
  buttons.find((el) => String(el.props.className).includes('confirm-ok')).props.onClick()
  await flush()
  assert.deepEqual(fetchCalls[beforeRemove], {
    url: '/guardian/api/remove',
    method: 'POST',
    body: { id: 'dsh-entry' },
  })

  // safemode：开关 POST safemode { enabled: true }
  const beforeSafe = fetchCalls.length
  const toggles = byClassPrefix(nodes, 'dsh-my-guardian-switch')
  assert.equal(toggles.length, 1, '安全模式开关渲染一个 role=switch 按钮')
  toggles[0].props.onClick()
  await flush()
  assert.deepEqual(
    fetchCalls[beforeSafe],
    {
      url: '/guardian/api/safemode',
      method: 'POST',
      body: { enabled: true },
    },
    '开关上报新状态（点击时取反）',
  )
})

// ══ 4. 渲染契约 ═════════════════════════════════════════════════════════

test('渲染契约：首屏 loading 态、空态与条目列表', async () => {
  const loading = mount({ routes: { 'GET /guardian/api/state': { ok: true, value: makeState({ loaded: false }) } } })
  const loadingNodes = renderTab(loading.tab, true)
  assert.ok(texts(loadingNodes).join('|').includes('加载中…'), '未加载时显示 loading 行')
  assert.ok(byClassPrefix(loadingNodes, 'dsh-my-guardian-loading').length > 0, 'loading 行带专属 class')

  const { nodes: emptyNodes } = await renderLoaded()
  const emptyJoined = texts(emptyNodes).join('|')
  assert.ok(emptyJoined.includes('暂无候选插件'), '无条目时显示空态文案')
  assert.ok(emptyJoined.includes('cordis.staged.json'), '空态给出候选区文件提示')
  assert.equal(byClass(emptyNodes, 'dsh-my-guardian-list'), undefined, '空态不渲染列表容器')

  const { nodes } = await renderLoaded({
    staged: [makeEntry({ id: 'dsh-staged', name: 'dsh-staged' })],
    promoted: [makeEntry({ id: 'dsh-promoted', name: 'dsh-promoted', status: 'running' })],
  })
  const joined = texts(nodes).join('|')
  assert.ok(joined.includes('插件条目'), '列表区块标题')
  assert.ok(joined.includes('2'), '区块计数为 2')
  const rows = byClassPrefix(nodes, 'dsh-my-guardian-row')
  assert.equal(rows.length, 2, '候选 + 转正各渲染一行')
  assert.ok(joined.includes('候选') && joined.includes('转正'), '行内来源 chip 区分候选/转正')
})

test('渲染契约：失败分类徽章、安装建议与冻结提示', async () => {
  const dependency = makeEntry({
    id: 'dsh-dep',
    name: 'dsh-dep',
    status: 'failed',
    attempts: 3,
    lastError: '缺少依赖 dsh-shared（请先安装）',
    failureType: 'dependency',
    installHint: 'dsh plugin add dsh-shared',
    lastFailedAt: 1756000000000,
  })
  const { nodes } = await renderLoaded({ staged: [dependency] })
  const joined = texts(nodes).join('|')
  assert.ok(joined.includes('失败'), 'failed 状态徽章')
  assert.ok(joined.includes('失败 3 次'), '连续失败次数文案')
  assert.ok(joined.includes('依赖缺失'), '依赖类失败分类徽章')
  assert.ok(joined.includes('安装建议'), '安装建议标签')
  assert.ok(joined.includes('dsh plugin add dsh-shared'), '安装建议命令')
  assert.ok(joined.includes('缺少依赖 dsh-shared'), '失败行默认展开错误详情（无需手动点开）')

  const { nodes: codeNodes } = await renderLoaded({
    staged: [makeEntry({ status: 'failed', failureType: 'code', lastError: 'TypeError: x' })],
  })
  assert.ok(texts(codeNodes).join('|').includes('代码错误'), 'code 分类徽章')

  const { nodes: frozenNodes } = await renderLoaded({
    staged: [makeEntry({ status: 'frozen', attempts: 5, lastError: 'boom' })],
  })
  assert.ok(texts(frozenNodes).join('|').includes('已冻结'), '冻结行渲染冻结提示')

  const { nodes: otherNodes } = await renderLoaded({
    staged: [makeEntry({ status: 'failed', failureType: 'other', lastError: 'x' })],
  })
  const otherJoined = texts(otherNodes).join('|')
  assert.ok(otherJoined.includes('其他'), 'other 分类徽章')
  assert.ok(!otherJoined.includes('安装建议'), '非依赖失败不显示安装建议')
})

test('渲染契约：错误详情可折叠，重试按钮仅出现在失败/冻结行', async () => {
  const { h, nodes } = await renderLoaded({
    staged: [makeEntry({ status: 'failed', lastError: 'boom detail', attempts: 1 })],
  })
  const detail = nodes.find((el) => el.type === 'pre' && el.props.className === 'dsh-my-guardian-error-detail')
  assert.ok(detail, '失败行默认展开错误详情')
  assert.equal(detail.props.children, 'boom detail')

  const toggle = nodes.find((el) => el.type === 'button' && el.props.className === 'dsh-my-guardian-link')
  assert.ok(toggle, '提供错误详情折叠开关')
  toggle.props.onClick()
  const collapsed = renderTab(h.tab, true)
  assert.equal(
    collapsed.find((el) => el.props?.className === 'dsh-my-guardian-error-detail'),
    undefined,
    '点击折叠后错误详情消失',
  )
  const collapsedToggle = collapsed.find((el) => el.type === 'button' && el.props.className === 'dsh-my-guardian-link')
  assert.ok(texts([collapsedToggle]).includes('错误详情'), '折叠后按钮文案切回「错误详情」')

  const { nodes: runningNodes } = await renderLoaded({ staged: [makeEntry({ status: 'running' })] })
  assert.equal(byAria(runningNodes, '重试'), undefined, '运行中的行不显示重试按钮')
  assert.ok(byAria(runningNodes, '移除'), '运行中的行仍可移除')
})

test('渲染契约：移除确认可取消，取消后不发请求', async () => {
  const { h, nodes } = await renderLoaded({ staged: [makeEntry({ status: 'running' })] })
  byAria(nodes, '移除').props.onClick()
  const confirming = renderTab(h.tab, true)
  const cancel = confirming.find(
    (el) => el.type === 'button' && String(el.props.className).includes('dsh-my-guardian-confirm-cancel'),
  )
  assert.ok(cancel, '确认框提供取消按钮')
  cancel.props.onClick()
  const afterCancel = renderTab(h.tab, true)
  assert.equal(
    afterCancel.filter((el) => el.type === 'button').find((el) => String(el.props.className).includes('confirm-ok')),
    undefined,
    '取消后确认框关闭',
  )
  assert.deepEqual(
    fetchCalls.map((call) => call.url),
    ['/guardian/api/state'],
    '取消不发任何写请求',
  )
})

test('渲染契约：事件日志过滤启动噪音并回退未知类型；全噪音时不渲染区块', async () => {
  const { nodes } = await renderLoaded({
    events: [
      { type: 'entry-init', message: 'init noise', time: 1756000000000 },
      { type: 'entry-dispose', message: 'dispose noise', time: 1756000000001 },
      { type: 'quarantine', message: '插件 dsh-bad 加载失败，已隔离', time: 1756000000002 },
      { type: 'startup-issue', message: '启动名册存在坏条目', time: 1756000000003 },
    ],
  })
  const joined = texts(nodes).join('|')
  assert.ok(joined.includes('最近事件'), '事件区块标题')
  assert.ok(joined.includes('隔离'), 'quarantine 事件徽章')
  assert.ok(joined.includes('插件 dsh-bad 加载失败，已隔离'), '事件消息')
  assert.ok(!joined.includes('init noise') && !joined.includes('dispose noise'), '过滤 entry-init/entry-dispose 噪音')

  const events = byClassPrefix(nodes, 'dsh-my-guardian-event')
  assert.equal(events.length, 2, '只渲染两条关键事件')
  const badges = byClassStartsWith(nodes, 'dsh-my-guardian-event-badge')
  assert.equal(badges.length, 2, '每条事件一个徽章')
  assert.ok(String(badges[0].props.className).includes('dsh-my-guardian-event-danger'), 'quarantine 用 danger 变体')
  assert.ok(String(badges[1].props.className).includes('dsh-my-guardian-event-danger'), 'startup-issue 用 danger 变体')

  const { nodes: noisy } = await renderLoaded({
    events: [{ type: 'entry-init', message: 'only noise', time: 1756000000000 }],
  })
  assert.equal(byClass(noisy, 'dsh-my-guardian-events'), undefined, '只剩噪音时不渲染事件区块')

  const { nodes: unknown } = await renderLoaded({
    events: [{ type: 'brand-new-event', message: 'x', time: 1756000000000 }],
  })
  const unknownEvent = byClassPrefix(unknown, 'dsh-my-guardian-event')[0]
  assert.ok(unknownEvent, '未知事件仍然渲染')
  const unknownBadge = byClassStartsWith(unknown, 'dsh-my-guardian-event-badge')[0]
  assert.ok(String(unknownBadge.props.className).includes('dsh-my-guardian-event-neutral'), '未知事件回退中性变体')
  assert.ok(
    unknownEvent.props.children.some((child) => child?.props?.children === 'brand-new-event'),
    '未知事件类型原样回显',
  )
})

test('渲染契约：启动区问题置顶展示修复命令与移除提示', async () => {
  const { nodes } = await renderLoaded({
    startupIssues: [
      {
        type: 'unresolvable',
        entryId: 'ghost',
        name: 'dsh-ghost',
        message: '插件包 dsh-ghost 无法解析',
        fix: 'dsh plugin add dsh-ghost',
        remove: '从启动名册中删除该条目行',
      },
      {
        type: 'duplicate-id',
        entryId: 'dup',
        name: 'dsh-first',
        message: '名册存在重复条目 id "dup"',
        fix: null,
        remove: '每个 id 保留一条',
      },
    ],
    startupCheckedAt: 1756000000000,
  })
  const joined = texts(nodes).join('|')
  assert.ok(joined.includes('启动区问题'), '启动区问题区块标题')
  assert.ok(joined.includes('包不可解析') && joined.includes('重复 id'), '两类问题徽章')
  assert.ok(joined.includes('dsh plugin add dsh-ghost'), '修复命令')
  assert.ok(joined.includes('每个 id 保留一条'), '移除提示')
  assert.equal(byClassPrefix(nodes, 'dsh-my-guardian-startup-issue').length, 2, '两条问题各渲染一块')

  const { nodes: healthy } = await renderLoaded({ startupIssues: [], startupCheckedAt: 1756000000000 })
  assert.equal(byClass(healthy, 'dsh-my-guardian-startup-issues'), undefined, '名册健康时不渲染该区块')
})

test('渲染契约：安全模式开关上报新状态，开启时带 warn 高亮 class', async () => {
  const { nodes } = await renderLoaded({ safeMode: true })
  const bar = byClass(nodes, 'dsh-my-guardian-safemode dsh-my-guardian-safemode-on')
  assert.ok(bar, 'safeMode=true 时安全模式栏带 on 高亮 class')
  const switchButton = byClassPrefix(nodes, 'dsh-my-guardian-switch')[0]
  assert.equal(switchButton.props.role, 'switch', '开关具备 switch 语义')
  assert.equal(switchButton.props['aria-checked'], true, 'aria-checked 反映当前状态')
  assert.ok(texts(nodes).join('|').includes('cordis.patch.yml'), '安全模式说明覆盖启动名册的 all-or-nothing 语义')
})

// ══ 5. i18n 契约（直接驱动 util 片段）═══════════════════════════════════

/** 直接 eval util 片段（i18n + 纯函数），navigator 作为参数注入。 */
function loadUtil(language) {
  const factory = new Function(
    'navigator',
    `${read('../lib/parts/util.js')}\n` +
      'return { isZh, strings, formatTime, statusLabel, failureTypeLabel, eventLabel, eventVariant, startupIssueLabel }',
  )
  return factory(language === undefined ? undefined : { language })
}

test('i18n 契约：中文/英文双语文案，未提供 navigator 时回退英文', () => {
  const zh = loadUtil('zh-CN')
  assert.equal(zh.isZh(), true)
  assert.equal(zh.strings.title(), '插件守护')
  assert.equal(zh.strings.safeMode(), '安全模式')
  assert.equal(zh.strings.retry(), '重试')
  assert.equal(zh.strings.remove(), '移除')
  assert.equal(zh.strings.confirmRemove(), '确认移除')
  assert.equal(zh.strings.loading(), '加载中…')
  assert.equal(zh.strings.attempts(4), '失败 4 次')
  assert.equal(zh.strings.failureDependency(), '依赖缺失')
  assert.equal(zh.strings.startupIssueDuplicate(), '重复 id')

  const en = loadUtil('en-US')
  assert.equal(en.isZh(), false)
  assert.equal(en.strings.title(), 'Plugin Guardian')
  assert.equal(en.strings.safeMode(), 'Safe mode')
  assert.equal(en.strings.retry(), 'Retry')
  assert.equal(en.strings.remove(), 'Remove')
  assert.equal(en.strings.attempts(2), 'failed ×2')
  assert.equal(en.strings.failureDependency(), 'Dependency')
  assert.equal(en.strings.startupIssues(), 'Startup roster issues')

  const none = loadUtil(undefined)
  assert.equal(none.isZh(), false, 'navigator 缺失时不得抛异常，按英文回退')
  assert.equal(none.strings.title(), 'Plugin Guardian')
})

test('i18n 契约：未知状态/分类/事件类型原样回显（不产生空白徽章）', () => {
  const { statusLabel, failureTypeLabel, eventLabel, eventVariant, startupIssueLabel, formatTime } = loadUtil('zh-CN')
  assert.equal(statusLabel('running'), '运行中')
  assert.equal(statusLabel('pending'), '待加载')
  assert.equal(statusLabel('failed'), '失败')
  assert.equal(statusLabel('frozen'), '冻结')
  assert.equal(statusLabel('brand-new'), 'brand-new', '未知状态原样回显')

  assert.equal(failureTypeLabel('dependency'), '依赖缺失')
  assert.equal(failureTypeLabel('code'), '代码错误')
  assert.equal(failureTypeLabel('other'), '其他')
  assert.equal(failureTypeLabel('weird'), 'weird')

  assert.equal(eventLabel('promote'), '转正')
  assert.equal(eventLabel('unknown-event'), 'unknown-event')
  assert.equal(eventVariant('promote'), 'success')
  assert.equal(eventVariant('entry-init'), 'accent')
  assert.equal(eventVariant('quarantine'), 'danger')
  assert.equal(eventVariant('startup-issue'), 'danger')
  assert.equal(eventVariant('freeze'), 'warn')
  assert.equal(eventVariant('safe-mode'), 'warn')
  assert.equal(eventVariant('unknown-event'), 'neutral')

  assert.equal(startupIssueLabel('unresolvable'), '包不可解析')
  assert.equal(startupIssueLabel('dependency'), '依赖缺失')
  assert.equal(startupIssueLabel('duplicate-id'), '重复 id')
  assert.equal(startupIssueLabel('weird'), 'weird')

  assert.equal(formatTime(1756000000000).length, 8, '有限数值格式化为 HH:MM:SS')
  assert.equal(formatTime(Number.NaN), '', '非有限数值渲染为空串')
  assert.equal(formatTime('2026-01-01'), '', '非数值时间戳渲染为空串')
})
