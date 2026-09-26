/**
 * Client render-path test: loads the client bundle with a stubbed react,
 * registers the settings tab through a mocked slots service, then renders the
 * view to verify the two remaining sections (npm market search + update check).
 *
 * 安装 / 卸载 / 启停 / 清单 UI 已下线（官方插件页承担），因此这里同时断言：市场
 * 结果行没有安装按钮、视图不发 /installed 请求——防「重复能力」悄悄回流。
 *
 * harness 说明：组件函数会被 walker 反复展开（等价于 React 重复渲染），所以 hook
 * 槽位按「组件身份 + 组件内序号」分配——按全局调用顺序分配会在 walker 展开后错位，
 * 让断言读到空态而假通过/假失败。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react (per-component stateful useState) ───────────────────────
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

let currentComponent = 'root'
let hookIndex = 0
const hookValues = new Map()

/** 展开一个组件函数：hook 槽位按组件身份隔离（可重复展开）。 */
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

const stubbed = {
  createElement,
  useState: (initial) => {
    const key = `${currentComponent}#${hookIndex}`
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
  useEffect: (() => {
    const ran = new Set()
    return (fn) => {
      const key = currentComponent + '#' + hookIndex
      hookIndex += 1
      if (ran.has(key)) return
      ran.add(key)
      fn()
    }
  })(),
}

/** Render the tab component once (hooks restart at index 0 each render). */
function renderView() {
  return expand(capturedTab.component, {})
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

const fetchCalls = []
let cannedResponses = []
global.fetch = (url, options) => {
  fetchCalls.push({ url: String(url), options })
  const canned = cannedResponses.shift() ?? { ok: true, value: {} }
  return Promise.resolve({ json: () => Promise.resolve(canned) })
}

// ── load bundle ────────────────────────────────────────────────────────────
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
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
  // 模拟 cordis `ctx.get(name, strict = true)` 的严格语义：服务提供者的 fiber
  // 未 active 时返回 undefined。插件必须传 strict = false 才能在首屏拿到
  // slots，否则设置页页签静默不注册（本断言即该缺陷的防复发测试）。
  get: (name, strict = true) => (name === 'slots' && strict === false ? mockSlots : undefined),
  effect: (fn) => fn(),
}
exportsObj.apply(ctx)
assert.ok(capturedTab, 'settings tab registered')
assert.equal(capturedTab.options.id, 'my-plugin-manager')

// ── tree helpers ───────────────────────────────────────────────────────────
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
    walkText(expand(node.type, node.props), out)
    return
  }
  walkText(node.props?.children, out)
}

const textsOf = (node) => {
  const out = []
  walkText(node, out)
  return out.join('|')
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(expand(node.type, node.props))
  return textOf(node.props?.children)
}

function collect(node, found) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found)
    return found
  }
  const props = node.props ?? {}
  if (typeof props.onClick === 'function') found.buttons.push({ label: textOf(props.children), onClick: props.onClick })
  if (node.type === 'input') found.inputs.push(props)
  if (typeof node.type === 'function') {
    collect(expand(node.type, props), found)
    return found
  }
  collect(props.children, found)
  return found
}

const scan = (tree) => collect(tree, { buttons: [], inputs: [] })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── initial render: market + update check sections, no write actions ──────
{
  const tree = renderView()
  const joined = textsOf(tree)
  assert.ok(joined.includes('市场'), 'market section present')
  assert.ok(joined.includes('更新检查'), 'update check section present')
  assert.ok(joined.includes('官方侧边栏插件页'), 'scope hint points at the official plugins page')
  assert.ok(!joined.includes('暂无已安装插件'), 'installed inventory section is gone')
  const labels = scan(tree)
    .buttons.map((b) => b.label)
    .join('|')
  for (const gone of ['安装', '卸载', '启用', '禁用']) {
    assert.ok(!labels.includes(gone), `${gone} 按钮已下线（官方插件页承担）`)
  }
  assert.equal(
    fetchCalls.filter((c) => c.url.includes('/installed')).length,
    0,
    'no /installed call: the inventory is the official plugin page’s job',
  )
}

// ── update check flow: icon button → GET /updates → 当前 → 最新 ────────────
{
  cannedResponses.push({ ok: true, value: { outdated: [{ name: 'dsh-a', current: '1.0.0', latest: '1.1.0' }] } })
  const checkBtn = scan(renderView()).buttons.find((b) => b.label === '')
  assert.ok(checkBtn, 'update check icon button found')
  checkBtn.onClick()
  await settle()
  const tree = renderView()
  const joined = textsOf(tree)
  assert.ok(joined.includes('dsh-a'), 'outdated plugin rendered in the update list')
  assert.ok(joined.includes('1.0.0 → 1.1.0'), 'current → latest shown')
  assert.ok(joined.includes('1 个插件可更新'), 'update count summary rendered')
  assert.ok(
    fetchCalls.some((c) => c.url.startsWith('/my-plugin-manager/api/updates')),
    'update check hits GET /updates',
  )
}

// ── market search flow: keyword → GET /search → rows with detail only ────
{
  cannedResponses.push({
    ok: true,
    value: {
      results: [{ name: 'dsh-file-activity', version: '1.2.3', description: 'file activity', author: 'alice' }],
    },
  })
  const input = scan(renderView()).inputs.find((p) => String(p.placeholder ?? '').includes('搜索 npm 插件'))
  assert.ok(input, 'search input found')
  input.onChange({ target: { value: 'dsh-file' } })
  const searchBtn = scan(renderView()).buttons.find((b) => b.label === '搜索')
  assert.ok(searchBtn, 'search button found')
  searchBtn.onClick()
  await settle()
  const tree = renderView()
  const joined = textsOf(tree)
  assert.ok(joined.includes('dsh-file-activity'), 'market result name rendered')
  assert.ok(joined.includes('v1.2.3'), 'market result version chip rendered')
  assert.ok(joined.includes('alice'), 'market result author rendered')
  assert.ok(joined.includes('file activity'), 'market result description rendered')
  assert.ok(
    fetchCalls.some((c) => c.url.startsWith('/my-plugin-manager/api/search?q=dsh-file')),
    'search hits GET /search with the keyword',
  )
  const labels = scan(tree).buttons.map((b) => b.label)
  assert.ok(labels.includes('详情'), '市场行保留「详情」入口')
  for (const gone of ['安装', '卸载']) {
    assert.ok(!labels.includes(gone), `市场行没有${gone}按钮（官方插件页承担）`)
  }
}

console.log('ALL PLUGIN-MANAGER CLIENT RENDER-PATH TESTS PASSED')

test('script-style suite (assertions ran at module load)', () => {})
