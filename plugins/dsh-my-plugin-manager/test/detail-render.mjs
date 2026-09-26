/**
 * 插件详情面板渲染测试（issue #90，issue #428 后的只读形态）。
 *
 * 覆盖：README（官方 baseline MarkdownText）/ 版本时间线 / 依赖 / 元数据 / 版本选择
 * 切换 / 加载失败 / 平台组件缺失时的 <pre> 兜底；并断言详情页**没有安装按钮**
 * （安装是官方插件页的能力，本插件不再重复），以及渲染内核不再跨插件 require。
 *
 * createElement 复刻 React 的元素类型不变量（非 string/function/带 `$$typeof` 的对象
 * → 抛错）与 memo 的展开方式，否则 memo 用例会假通过。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const MEMO_TYPE = Symbol.for('react.memo')

function createElement(type, props, ...children) {
  const valid =
    typeof type === 'string' ||
    typeof type === 'function' ||
    (typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol')
  if (!valid) {
    const got = type === null || type === undefined ? String(type) : typeof type
    throw new Error(
      'Element type is invalid: expected a string (for built-in components) or a ' +
        `class/function (for composite components) but got: ${got}.`,
    )
  }
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

// hook 槽位按「组件身份 + 组件内序号」隔离：walker 会把组件函数反复展开（等价于
// React 重复渲染），按全局调用顺序分配槽位会在展开后错位，让断言读到空态而假通过。
let currentComponent = 'root'
let hookIndex = 0

/** 展开一个组件函数（hook 槽位按组件隔离，可重复展开）。 */
function expand(type, props) {
  const prevName = currentComponent
  const prevIndex = hookIndex
  currentComponent = type.name || 'anonymous'
  hookIndex = 0
  try {
    return type(props)
  } finally {
    currentComponent = prevName
    hookIndex = prevIndex
  }
}

function renderComponent(type, props) {
  if (typeof type === 'function') return expand(type, props)
  if (typeof type.type === 'function') return expand(type.type, props) // React.memo
  if (typeof type.render === 'function') return expand(type.render, props) // React.forwardRef
  throw new Error('unsupported component shape in walker')
}

function isComponent(type) {
  return typeof type === 'function' || (typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol')
}

function makeReact() {
  const hookValues = new Map()
  const effectRan = new Set()
  return {
    createElement,
    isValidElementType: (v) =>
      typeof v === 'string' ||
      typeof v === 'function' ||
      (typeof v === 'object' && v !== null && typeof v.$$typeof === 'symbol'),
    useState: (initial) => {
      const key = currentComponent + '#' + hookIndex
      hookIndex += 1
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
    useEffect: (fn) => {
      const key = currentComponent + '#' + hookIndex
      hookIndex += 1
      if (effectRan.has(key)) return
      effectRan.add(key)
      fn()
    },
    _reset: () => {
      hookIndex = 0
    },
  }
}

// ── 宿主全局 + fetch mock ──────────────────────────────────────────────────
let registered = null
global.window = {
  __ModuleLoader__: { load: (registration) => (registered = registration) },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

const fetchCalls = []
let cannedResponses = []
global.fetch = (url, options) => {
  fetchCalls.push({ url: String(url), options })
  const canned = cannedResponses.shift() ?? { ok: true, value: {} }
  return Promise.resolve({ json: () => Promise.resolve(canned) })
}

eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'client bundle registered')
const factory = registered.factory

const UI_MISSING = new Error("Cannot find module '@deepseek-ai/dsh-client-ui-primitives'")

/** 平台官方组件 stub：shape='function' 为普通组件，'memo' 为真实宿主形态。 */
function makePlatformStub({ shape = 'memo' } = {}) {
  const calls = []
  const render = (props) => {
    calls.push(props)
    return createElement('div', { className: 'official-markdown-text', 'data-ui': 'markdown-text' }, props.text)
  }
  const MarkdownText = shape === 'memo' ? { $$typeof: MEMO_TYPE, type: render, compare: null } : render
  return { ui: { MarkdownText }, calls }
}

/** 启动插件 client（每次新建 factory 实例，便于替换平台模块）。 */
function boot({ platform }) {
  const r = makeReact()
  const required = []
  const exportsObj = factory((spec) => {
    required.push(spec)
    if (spec === 'react') return r
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      if (platform instanceof Error) throw platform
      return platform.ui
    }
    throw new Error('unexpected require: ' + spec)
  })
  let capturedTab = null
  const mockSlots = {
    inject: (name, register) => {
      const tab = register()
      if (name === 'settings.plugins.tab') capturedTab = tab
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  exportsObj.apply({
    get: (name, strict = false) => (name === 'slots' && strict === false ? mockSlots : undefined),
    effect: (fn) => fn(),
  })
  assert.ok(capturedTab, 'settings tab registered')
  return {
    required,
    render: () => {
      r._reset()
      return expand(capturedTab.component, {})
    },
  }
}

// ── 元素树辅助 ────────────────────────────────────────────────────────────
function collect(node, found) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found)
    return found
  }
  const props = node.props ?? {}
  if (typeof props.onClick === 'function') found.buttons.push({ label: textOf(props.children), onClick: props.onClick })
  if (node.type === 'input') found.inputs.push(props)
  if (node.type === 'select') found.selects.push(props)
  if (node.type === 'a') found.links.push(props)
  if (props['data-ui'] === 'markdown-text') found.official.push(props)
  if (node.type === 'pre') found.pres.push(props)
  if (isComponent(node.type)) {
    collect(renderComponent(node.type, props), found)
    return found
  }
  collect(props.children, found)
  return found
}

const emptyFound = () => ({ buttons: [], inputs: [], selects: [], links: [], official: [], pres: [] })

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isComponent(node.type)) return textOf(renderComponent(node.type, node.props ?? {}))
  return textOf(node.props?.children)
}

function textsOf(node) {
  const out = []
  const walk = (n) => {
    if (n === null || n === undefined || typeof n === 'boolean') return
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n))
      return
    }
    if (Array.isArray(n)) {
      for (const child of n) walk(child)
      return
    }
    if (isComponent(n.type)) {
      walk(renderComponent(n.type, n.props ?? {}))
      return
    }
    walk(n.props?.children)
  }
  walk(node)
  return out.join('|')
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const SEARCH_HIT = {
  ok: true,
  value: { results: [{ name: 'dsh-x', version: '1.0.0', description: 'desc', author: 'alice' }] },
}

function detailValue(overrides = {}) {
  return {
    name: 'dsh-x',
    version: '1.0.0',
    latest: '1.0.0',
    description: 'a plugin',
    author: 'alice',
    license: 'MIT',
    repository: 'https://github.com/x/y',
    readme: '# 标题\n\n```js\nconst x = 1\n```',
    versions: [
      { version: '1.0.0', date: '2026-01-02' },
      { version: '0.9.0', date: '2025-12-01' },
    ],
    dependencies: [{ name: 'dsh-shared', spec: '^0.1.4' }],
    peerDependencies: [
      { name: 'cordis', spec: '^4.0.0-rc.10', missing: false },
      { name: 'dsh-shared', spec: '^0.1.4', missing: true },
    ],
    downloads: 1234,
    ...overrides,
  }
}

/** 市场搜索 → 点「详情」→ 返回 { h, tree }（已渲染详情面板）。 */
async function openDetail({ platform = makePlatformStub(), detail = detailValue() } = {}) {
  fetchCalls.length = 0
  cannedResponses = [SEARCH_HIT, { ok: true, value: detail }]
  const h = boot({ platform })
  let found = collect(h.render(), emptyFound())
  found.inputs[0].onChange({ target: { value: 'dsh-x' } })
  found = collect(h.render(), emptyFound())
  const searchBtn = found.buttons.find((b) => b.label === '搜索')
  assert.ok(searchBtn, 'search button rendered')
  searchBtn.onClick()
  await settle()
  found = collect(h.render(), emptyFound())
  const detailBtn = found.buttons.find((b) => b.label === '详情')
  assert.ok(detailBtn, 'detail button rendered on the market row')
  detailBtn.onClick()
  await settle()
  return { h, tree: h.render() }
}

// ── 用例 1：详情页渲染 README / 时间线 / 依赖 / 元数据，且没有安装入口 ─────
test('detail: read-only panel renders README, timeline, deps and metadata', async () => {
  const platform = makePlatformStub()
  const { h, tree } = await openDetail({ platform })
  const found = collect(tree, emptyFound())
  const joined = textsOf(tree)

  assert.equal(found.official.length, 1, 'README 由官方 MarkdownText 渲染')
  assert.ok(platform.calls.length >= 1, '官方组件收到 props')
  assert.ok(String(platform.calls[0].text).includes('const x = 1'), 'README 原文完整渲染')
  assert.equal(platform.calls[0].labels?.code?.copyLabel, '复制', 'labels.code.copyLabel（无默认值，必传）')
  assert.equal(platform.calls[0].labels?.code?.copiedLabel, '已复制', 'labels.code.copiedLabel')
  assert.equal(platform.calls[0].labels?.footnotes, '脚注', 'labels.footnotes')
  assert.ok(joined.includes('1.0.0') && joined.includes('2026-01-02'), '版本时间线渲染')
  assert.ok(joined.includes('0.9.0'), '更早的版本也在时间线里')
  assert.ok(joined.includes('dsh-shared'), '依赖表渲染')
  assert.ok(joined.includes('缺失'), '缺失的 peer 被标注')
  assert.ok(joined.includes('MIT') && joined.includes('alice') && joined.includes('1234'), '元数据渲染')
  assert.ok(
    found.links.some((l) => l.href === 'https://github.com/x/y'),
    '仓库链接渲染',
  )
  const labels = found.buttons.map((b) => b.label).join('|')
  assert.ok(labels.includes('关闭'), '关闭按钮渲染')
  assert.ok(!labels.includes('安装'), '详情页没有安装按钮（安装属官方插件页）')
  assert.ok(!h.required.includes('dsh-md-render'), '渲染内核不再跨插件 require dsh-md-render')
})

// ── 用例 2：版本选择器切换查看指定版本 ────────────────────────────────────
test('detail: version picker reloads that version’s detail', async () => {
  const { h, tree } = await openDetail()
  const found = collect(tree, emptyFound())
  assert.equal(found.selects.length, 1, '版本选择器渲染')
  assert.equal(found.selects[0].value, '1.0.0', '默认选中当前版本')

  cannedResponses = [
    {
      ok: true,
      value: detailValue({
        version: '0.9.0',
        dependencies: [{ name: 'legacy-dep', spec: '^1.0.0' }],
      }),
    },
  ]
  found.selects[0].onChange({ target: { value: '0.9.0' } })
  await settle()
  const joined = textsOf(h.render())
  assert.ok(
    fetchCalls.some((c) => c.url === '/my-plugin-manager/api/detail?name=dsh-x&version=0.9.0'),
    '版本切换带上 version 查询参数',
  )
  assert.ok(joined.includes('legacy-dep'), '切换后展示该版本的依赖')
})

// ── 用例 3：详情加载失败 → 错误提示 ───────────────────────────────────────
test('detail: load failure shows a fallback error', async () => {
  fetchCalls.length = 0
  cannedResponses = [SEARCH_HIT, { ok: false, error: { message: 'boom' } }]
  const h = boot({ platform: makePlatformStub() })
  let found = collect(h.render(), emptyFound())
  found.inputs[0].onChange({ target: { value: 'dsh-x' } })
  found = collect(h.render(), emptyFound())
  found.buttons.find((b) => b.label === '搜索').onClick()
  await settle()
  found = collect(h.render(), emptyFound())
  found.buttons.find((b) => b.label === '详情').onClick()
  await settle()
  const joined = textsOf(h.render())
  assert.ok(joined.includes('详情加载失败'), '错误标题渲染')
  assert.ok(joined.includes('boom'), '错误原因渲染')
})

// ── 用例 4：平台官方组件缺失 → 本插件 <pre> 兜底（真降级）────────────────
test('detail: README falls back to the plugin <pre> when the platform component is missing', async () => {
  const { tree } = await openDetail({ platform: UI_MISSING })
  const found = collect(tree, emptyFound())
  assert.equal(found.official.length, 0, '平台组件缺失时不被误用')
  assert.equal(found.pres.length, 1, 'README 落到 <pre> 兜底')
  assert.equal(found.pres[0]['data-dsh-my-plugin-manager-fallback'], 'true', '兜底标记属性（本插件前缀）')
  assert.equal(found.pres[0].className, 'dsh-my-plugin-manager-readme-plain', '兜底 class 契约保持（issue #90）')
  assert.ok(String(found.pres[0].children).includes('const x = 1'), '兜底原文不丢')
})
