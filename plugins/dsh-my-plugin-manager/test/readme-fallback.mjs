import { test } from 'vitest'
/**
 * README 预览的渲染回退测试（issue #299）。
 *
 * 覆盖插件详情页 README 预览的三级回退（共享部件
 * `dsh-shared/client-parts/markdown-fallback.part.js`）：
 *  - md-render 缺失 + 宿主平台官方 `MarkdownText` 可用 → 第二级被采用（含
 *    **memo 对象形态**：宿主实测 `MarkdownText` 是 `React.memo` 返回值，
 *    `typeof === 'object'`），且 `labels` 契约被满足；
 *  - 两者都缺 → 本插件自己的 `<pre class="dsh-my-plugin-manager-readme-plain"
 *    data-dsh-my-plugin-manager-fallback="true">`，原文不丢、不抛错；
 *  - md-render 可用 → 优先用它（行为与接入前一致）。
 *
 * createElement 复刻 React 的元素类型不变量（非 string/function/带 `$$typeof`
 * 的对象 → 抛错）与 memo 的展开方式（`type.type`），否则 memo 用例会假通过。
 */
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

/** 复刻 React 调用组件的方式（函数组件 / memo / forwardRef）。 */
function renderComponent(type, props) {
  if (typeof type === 'function') return type(props)
  if (typeof type.type === 'function') return type.type(props) // React.memo
  if (typeof type.render === 'function') return type.render(props, null) // React.forwardRef
  throw new Error('unsupported component shape in walker')
}

function makeReact() {
  const hookValues = new Map()
  let hookIndex = 0
  let effectRan = false
  return {
    createElement,
    isValidElementType: (v) =>
      typeof v === 'string' ||
      typeof v === 'function' ||
      (typeof v === 'object' && v !== null && typeof v.$$typeof === 'symbol'),
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
      if (!effectRan) {
        effectRan = true
        fn()
      }
    },
    _reset: () => {
      hookIndex = 0
    },
  }
}

// ── 宿主全局 + fetch mock ──────────────────────────────────────────────────
global.window = {
  __ModuleLoader__: { load: (registration) => (global.__registered = registration) },
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
assert.ok(global.__registered, 'client bundle registered')
const factory = global.__registered.factory

const installedResp = {
  ok: true,
  value: { entries: [{ moduleName: 'dsh-a', enabled: true, fiberPhase: 'ready', version: '1.0.0' }] },
}
const README_TEXT = '# 标题\n\n```js\nconst x = 1\n```'
const detailResp = {
  ok: true,
  value: { name: 'dsh-a', version: '1.0.0', latest: '1.0.0', readme: README_TEXT, versions: [] },
}

const MD_MISSING = new Error("Cannot find module 'dsh-md-render'")
const UI_MISSING = new Error("Cannot find module '@deepseek-ai/dsh-client-ui-primitives'")

/** 平台官方组件 stub：shape='function' 为普通组件，'memo' 为真实宿主形态。 */
function makePlatformStub({ shape = 'function' } = {}) {
  const calls = []
  const render = (props) => {
    calls.push(props)
    return createElement('div', { className: 'official-markdown-text', 'data-ui': 'markdown-text' }, props.text)
  }
  const MarkdownText = shape === 'memo' ? { $$typeof: MEMO_TYPE, type: render, compare: null } : render
  return { ui: { MarkdownText }, calls }
}

/** 启动插件 client，打开详情页，返回渲染树（走插件自己的详情渲染路径）。 */
async function openReadme(modules) {
  cannedResponses.length = 0
  fetchCalls.length = 0
  const r = makeReact()
  const exportsObj = factory((spec) => {
    if (spec === 'react') return r
    if (Object.prototype.hasOwnProperty.call(modules, spec)) {
      const value = modules[spec]
      if (value instanceof Error) throw value
      return value
    }
    throw new Error('unexpected require: ' + spec)
  })
  let capturedTab = null
  const mockSlots = {
    inject: (name, register) => {
      const registeredTab = register()
      if (name === 'settings.plugins.tab') capturedTab = registeredTab
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  exportsObj.apply({ get: (name) => (name === 'slots' ? mockSlots : undefined), effect: (fn) => fn() })
  assert.ok(capturedTab, 'settings tab registered')

  const render = () => {
    r._reset()
    return capturedTab.component({})
  }
  cannedResponses.push(installedResp)
  render()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const buttons = []
  collectButtons(render(), buttons)
  const detailBtn = buttons.find((b) => b.label === '详情')
  assert.ok(detailBtn, 'detail button rendered')
  cannedResponses.push(detailResp)
  detailBtn.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return render()
}

// ── 元素树辅助（按本插件自己的渲染路径）──────────────────────────────────
function collectButtons(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const c of node) collectButtons(c, out)
    return
  }
  if (typeof node !== 'object') return
  const props = node.props ?? {}
  if (typeof props.onClick === 'function') out.push({ label: textOf(props.children), onClick: props.onClick })
  if (typeof node.type === 'string') collectButtons(props.children, out)
  else if (typeof node.type === 'object' && node.type !== null) collectButtons(renderComponent(node.type, props), out)
  else if (typeof node.type === 'function') collectButtons(node.type(props), out)
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'string') return textOf(node.props?.children)
  if (isComponent(node.type)) return textOf(renderComponent(node.type, node.props ?? {}))
  return ''
}

function isComponent(type) {
  return typeof type === 'function' || (typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol')
}

/** 收集「README 预览」节点：data-ui 标记 / 兜底 <pre> / md-render 输出。 */
function findReadmeNodes(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const c of node) findReadmeNodes(c, out)
    return out
  }
  if (typeof node !== 'object') return out
  const props = node.props ?? {}
  if (isComponent(node.type)) {
    findReadmeNodes(renderComponent(node.type, props), out)
    return out
  }
  if (node.type === 'pre') out.push({ kind: 'pre', props, text: textOf(props.children) })
  if (props['data-ui'] === 'markdown-text') out.push({ kind: 'official', props, text: textOf(props.children) })
  if (typeof props.className === 'string' && props.className.includes('tzx-md')) {
    out.push({ kind: 'md-render', props, text: textOf(props.children) })
  }
  findReadmeNodes(props.children, out)
  return out
}

try {
  // ── 用例 1：md-render 缺失 + 平台组件（memo 对象形态）可用 ──────────────
  {
    const platform = makePlatformStub({ shape: 'memo' })
    assert.equal(typeof platform.ui.MarkdownText, 'object', 'stub 复刻真实 memo 形态')
    const tree = await openReadme({
      'dsh-md-render': MD_MISSING,
      '@deepseek-ai/dsh-client-ui-primitives': platform.ui,
    })
    const readme = findReadmeNodes(tree, [])
    const official = readme.filter((n) => n.kind === 'official')
    assert.equal(
      official.length,
      1,
      `README 由官方 MarkdownText 渲染（markers=${JSON.stringify(readme.map((n) => n.kind))}）`,
    )
    assert.ok(!readme.some((n) => n.kind === 'pre'), 'README 未退化为纯文本 <pre>')
    assert.ok(official[0].text.includes('const x = 1'), 'README 原文完整渲染（含代码块内容）')
    assert.ok(platform.calls.length >= 1, '官方组件收到 props')
    const props = platform.calls[0]
    assert.equal(props.labels?.code?.copyLabel, '复制', 'labels.code.copyLabel（无默认值，必传）')
    assert.equal(props.labels?.code?.copiedLabel, '已复制', 'labels.code.copiedLabel')
    assert.equal(props.labels?.footnotes, '脚注', 'labels.footnotes')
    assert.equal(props.codeLabels?.copyLabel, '复制', '旧字段 codeLabels（npm 0.0.1-rc.1）')
    assert.equal(props.text, README_TEXT, 'README 文本原样透传')
  }

  // ── 用例 2：md-render 与平台组件都缺失 → 本插件 <pre> 兜底 ──────────────
  {
    const tree = await openReadme({ 'dsh-md-render': MD_MISSING, '@deepseek-ai/dsh-client-ui-primitives': UI_MISSING })
    const readme = findReadmeNodes(tree, [])
    const pre = readme.find((n) => n.kind === 'pre')
    assert.ok(pre, 'README 回退为 <pre>')
    assert.equal(pre.props['data-dsh-my-plugin-manager-fallback'], 'true', '兜底标记属性（本插件前缀）')
    assert.equal(pre.props.className, 'dsh-my-plugin-manager-readme-plain', '兜底 class 契约保持（issue #90）')
    assert.equal(pre.text, README_TEXT, '兜底原文不丢')
    assert.ok(!readme.some((n) => n.kind === 'official'), '平台组件缺失时不误用')
  }

  // ── 用例 3：md-render 可用 → 第一级优先，平台组件不被触碰 ───────────────
  {
    const mdCalls = []
    const MarkdownView = (props) => {
      mdCalls.push(props)
      return createElement('div', { className: 'tzx-md' }, props.text)
    }
    const platform = makePlatformStub({ shape: 'memo' })
    const tree = await openReadme({
      'dsh-md-render': { MarkdownView },
      '@deepseek-ai/dsh-client-ui-primitives': platform.ui,
    })
    const readme = findReadmeNodes(tree, [])
    assert.equal(mdCalls.length, 1, 'md-render 的 MarkdownView 被使用（第一级）')
    assert.equal(platform.calls.length, 0, 'md-render 存在时平台组件不被触碰')
    assert.ok(
      readme.some((n) => n.kind === 'md-render'),
      'README 走 md-render 渲染',
    )
    assert.ok(!readme.some((n) => n.kind === 'pre'), '不落兜底')
  }

  // ── 用例 4：md-render 导出畸形（对象但非组件）→ 落到第二级 ──────────────
  {
    const platform = makePlatformStub({ shape: 'memo' })
    const tree = await openReadme({
      'dsh-md-render': { MarkdownView: {} },
      '@deepseek-ai/dsh-client-ui-primitives': platform.ui,
    })
    const readme = findReadmeNodes(tree, [])
    assert.equal(readme.filter((n) => n.kind === 'official').length, 1, '非组件导出 → 第二级')
  }

  console.log('ALL README FALLBACK TESTS PASSED')
} finally {
  delete global.window
  delete global.fetch
  delete global.navigator
}

test('script-style suite (assertions ran at module load)', () => {})
