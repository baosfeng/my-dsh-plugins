import { test } from 'vitest'
/**
 * 三级渲染回退测试（issue #293）。
 *
 * 0.4.9 的「降级」是假降级：`lib/client.src.js` 只把 `require('dsh-md-render')`
 * 包进 try/catch 并把 `MarkdownView` 置为 null，而渲染路径是裸
 * `createElement(MarkdownView, { text })` → React 渲染期抛
 * `Element type is invalid ... but got: null`。
 *
 * 本文件覆盖「dsh-md-render 缺失」的两条真实路径（这是 `client-render.mjs`
 * 结构性无法覆盖的：它必须先 materialize dsh-md-render）：
 *  - A：md-render 缺失 + 平台 `@deepseek-ai/dsh-client-ui-primitives` 的
 *    `MarkdownText` 可用 → 用官方组件渲染（文本不丢、`labels` 契约被满足）；
 *  - B：md-render 与平台组件都缺失 → `<pre data-dsh-think-zh-expand-fallback>`；
 *  - C：各级解析的「导出不是组件」都必须安全落到下一级；
 *  - F：官方组件是 **`React.memo` 返回的对象**（真实宿主实测：
 *    `object($$typeof,type,compare)`）→ 必须仍被第二级采用；「可用性判定」若写成
 *    `typeof v === 'function'` 会把 memo 组件误判为不可用、直接落到 `<pre>`。
 *
 * createElement 复刻 React 的元素类型不变量（type 为 null/undefined 或非
 * string/function/带 `$$typeof` 的组件对象时抛错）——纯结构 stub 不会抛错，
 * 会让「假降级」静默通过；展开时同样复刻 React 对 memo/forwardRef 的调用方式
 * （memo 用 `type.type`、forwardRef 用 `type.render`），否则 memo 用例会假失败。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const MEMO_TYPE = Symbol.for('react.memo')
const FORWARD_REF_TYPE = Symbol.for('react.forward_ref')

function invalidElementType(got) {
  return new Error(
    'Element type is invalid: expected a string (for built-in components) or a ' +
      `class/function (for composite components) but got: ${got}.`,
  )
}

/** React 的 isValidElementType 语义（string / function / 带 $$typeof 的组件对象）。 */
function isValidElementType(type) {
  if (typeof type === 'string' || typeof type === 'function') return true
  return typeof type === 'object' && type !== null && typeof type.$$typeof === 'symbol'
}

function createElement(type, props, ...children) {
  if (!isValidElementType(type)) {
    const got = type === null || type === undefined ? String(type) : typeof type
    throw invalidElementType(got)
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
  throw new Error('unsupported component shape in test walker')
}

/** react stub：withIsValidElementType=false 模拟只有退化判定可用的精简 seed。 */
function makeReactStub({ withIsValidElementType = true } = {}) {
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    ...(withIsValidElementType ? { isValidElementType } : {}),
  }
}

const stubbed = makeReactStub()

// ── 全局宿主 mock（与 client-render.mjs 同款最小集）────────────────────
const registrations = []
global.window = {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.localStorage = { getItem: () => null, setItem: () => {} }
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
global.document = {
  head: { appendChild: () => {}, removeChild: () => {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '' }),
}

const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
eval(bundleSrc)
const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
assert.ok(thinkReg, 'dsh-think-zh-expand bundle registered')

// ── 平台官方组件 stub（带 data-ui 标记，可断言「官方组件被使用」）──────
// shape='function'：普通函数组件；shape='memo'：**真实宿主形态**
// （宿主 0.1.5-rc.1 实测 `MarkdownText` 是 `React.memo(...)` 返回的对象：
//  `object($$typeof,type,compare)`，typeof 是 'object' 而不是 'function'）。
function makePlatformStub({ shape = 'function' } = {}) {
  const calls = []
  const render = (props) => {
    calls.push(props)
    return createElement('div', { 'data-ui': 'markdown-text' }, props.text)
  }
  const MarkdownText = shape === 'memo' ? { $$typeof: MEMO_TYPE, type: render, compare: null } : render
  return { ui: { MarkdownText }, calls }
}

const MD_MISSING = new Error("Cannot find module 'dsh-md-render'")
const UI_MISSING = new Error("Cannot find module '@deepseek-ai/dsh-client-ui-primitives'")

/** 构造 require stub：mdRender / platform 取值为 exports 或 'throw'。 */
function requireStub({ mdRender = 'throw', platform = 'throw', react = stubbed } = {}) {
  return (spec) => {
    if (spec === 'react') return react
    if (spec === 'dsh-md-render') {
      if (mdRender === 'throw') throw MD_MISSING
      return mdRender
    }
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      if (platform === 'throw') throw UI_MISSING
      return platform
    }
    throw new Error('unexpected require: ' + spec)
  }
}

/** materialize factory + apply + 捕获 assistant-step 渲染器。 */
function mount(opts) {
  const exportsObj = thinkReg.factory(requireStub(opts))
  assert.equal(typeof exportsObj.apply, 'function', 'apply exported')
  let injectCallback = null
  let capturedRenderer = null
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => {
        injectCallback = fn
        return () => {}
      },
      register: (_desc, renderer) => {
        capturedRenderer = renderer
        return () => {}
      },
    },
  }
  exportsObj.apply(ctx)
  assert.equal(typeof injectCallback, 'function', 'slots.inject callback captured')
  injectCallback()
  assert.equal(typeof capturedRenderer, 'function', 'assistant-step renderer captured')
  return {
    exportsObj,
    render: (blocks, extraData) => capturedRenderer({ node: { data: { blocks, ...(extraData ?? {}) } } }),
  }
}

// ── 元素树断言辅助 ─────────────────────────────────────────────────────
/** 展开函数/memo/forwardRef 组件后收集全部 props 快照（含 data-ui / fallback 标记）。 */
function collectNodes(tree) {
  const nodes = []
  const texts = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walk(c)
      return
    }
    const props = node.props ?? {}
    if (isValidElementType(node.type) && typeof node.type !== 'string') {
      // 插件内部组件（AssistantStepView / ThinkBlock）、三级链适配器，
      // 以及宿主组件（函数组件 / memo 对象）
      walk(renderComponent(node.type, props))
      return
    }
    nodes.push({ type: node.type, props })
    walk(props.children)
  }
  walk(tree)
  return { nodes, texts, text: texts.join('') }
}

const REASONING = '思考第一行\n思考第二行'
const TEXT_BLOCK = '回复正文 **加粗**'

try {
  // ── 用例 A：md-render 缺失 + 平台 MarkdownText 可用 ──────────────────
  {
    const platform = makePlatformStub()
    const { render } = mount({ mdRender: 'throw', platform: platform.ui })

    const reasoning = collectNodes(render([{ kind: 'reasoning', text: REASONING }], { status: 'running' }))
    const textNodes = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))

    for (const [label, out] of [
      ['reasoning', reasoning],
      ['text', textNodes],
    ]) {
      assert.equal(
        out.nodes.filter((n) => n.props['data-ui'] === 'markdown-text').length,
        1,
        `${label} block rendered by official MarkdownText (data-ui marker)`,
      )
      assert.ok(!out.nodes.some((n) => n.type === 'pre'), `${label} block not downgraded to <pre>`)
    }
    assert.ok(reasoning.text.includes('思考第一行'), 'reasoning text preserved (first line)')
    assert.ok(reasoning.text.includes('思考第二行'), 'reasoning text preserved (second line)')
    assert.ok(textNodes.text.includes('回复正文'), 'text block content preserved')

    // labels 契约：壳内联版 MarkdownText 直接访问 labels.code.copyLabel（无默认值）
    assert.ok(platform.calls.length >= 2, 'platform MarkdownText received props')
    const props = platform.calls[0]
    assert.equal(props.labels?.code?.copyLabel, '复制', 'labels.code.copyLabel passed (required, no default)')
    assert.equal(props.labels?.code?.copiedLabel, '已复制', 'labels.code.copiedLabel passed')
    assert.equal(props.labels?.footnotes, '脚注', 'labels.footnotes passed')
    // 旧版官方包（npm latest 0.0.1-rc.1）props 为 codeLabels
    assert.equal(props.codeLabels?.copyLabel, '复制', 'legacy codeLabels.copyLabel passed (npm 0.0.1-rc.1)')
    assert.equal(props.codeLabels?.copiedLabel, '已复制', 'legacy codeLabels.copiedLabel passed')
    assert.equal(props.text, REASONING, 'adaptor forwards text unchanged')
  }

  // ── 用例 B：md-render 缺失 + 平台组件也缺失 → <pre> 纯文本兜底 ────────
  {
    const { render } = mount({ mdRender: 'throw', platform: 'throw' })
    const reasoning = collectNodes(render([{ kind: 'reasoning', text: REASONING }], { status: 'running' }))
    const textNodes = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))

    for (const [label, out] of [
      ['reasoning', reasoning],
      ['text', textNodes],
    ]) {
      const pre = out.nodes.find((n) => n.props['data-dsh-think-zh-expand-fallback'] === 'true')
      assert.ok(pre, `${label} block falls back to <pre data-dsh-think-zh-expand-fallback>`)
      assert.equal(pre.type, 'pre', `${label} fallback element is <pre>`)
      assert.equal(pre.props.children, label === 'reasoning' ? REASONING : TEXT_BLOCK, `${label} raw text kept`)
    }
    assert.ok(reasoning.text.includes('思考第二行'), 'reasoning text preserved in <pre> fallback')
  }

  // ── 用例 F：官方 MarkdownText 是 React.memo 对象 → 第二级必须被采用 ────
  // 真实宿主（0.1.5-rc.1）实测 MarkdownText 形态为
  // `object($$typeof,type,compare)`：`typeof === 'function'` 判定会把它误判为
  // 不可用、直接落到第三级 <pre>（渲染不再崩，但仍未达成 #293 的「官方组件渲染」）。
  {
    const platform = makePlatformStub({ shape: 'memo' })
    assert.equal(typeof platform.ui.MarkdownText, 'object', 'stub reproduces the real memo-object shape')
    const { render } = mount({ mdRender: 'throw', platform: platform.ui })

    const reasoning = collectNodes(render([{ kind: 'reasoning', text: REASONING }], { status: 'running' }))
    const textNodes = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))

    for (const [label, out] of [
      ['reasoning', reasoning],
      ['text', textNodes],
    ]) {
      const markers = out.nodes.map((n) => n.props['data-ui'] ?? n.props['data-dsh-think-zh-expand-fallback'] ?? n.type)
      assert.equal(
        out.nodes.filter((n) => n.props['data-ui'] === 'markdown-text').length,
        1,
        `${label} block rendered by memo-form official MarkdownText (level 2), got markers=${JSON.stringify(markers)}`,
      )
      assert.ok(!out.nodes.some((n) => n.type === 'pre'), `${label} block not downgraded to <pre>`)
    }
    assert.ok(reasoning.text.includes('思考第二行'), 'reasoning text preserved (memo form)')
    assert.ok(textNodes.text.includes('回复正文'), 'text block content preserved (memo form)')

    assert.ok(platform.calls.length >= 2, 'memo-form MarkdownText received props')
    const props = platform.calls[0]
    assert.equal(props.labels?.code?.copyLabel, '复制', 'labels.code.copyLabel passed to memo component')
    assert.equal(props.labels?.code?.copiedLabel, '已复制', 'labels.code.copiedLabel passed to memo component')
    assert.equal(props.labels?.footnotes, '脚注', 'labels.footnotes passed to memo component')
    assert.equal(props.codeLabels?.copyLabel, '复制', 'legacy codeLabels passed to memo component')
    assert.equal(props.text, REASONING, 'adaptor forwards text unchanged (memo form)')
  }

  // ── 用例 G：react seed 无 isValidElementType 时退化判定仍认 memo 对象 ──
  {
    const bareReact = makeReactStub({ withIsValidElementType: false })
    assert.equal(bareReact.isValidElementType, undefined, 'react stub without isValidElementType')
    const platform = makePlatformStub({ shape: 'memo' })
    const { render } = mount({ mdRender: 'throw', platform: platform.ui, react: bareReact })
    const out = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))
    assert.equal(
      out.nodes.filter((n) => n.props['data-ui'] === 'markdown-text').length,
      1,
      'fallback predicate (typeof function || $$typeof symbol) still accepts memo objects',
    )
    assert.ok(platform.calls.length >= 1, 'memo-form MarkdownText used with bare react seed')
  }

  // ── 用例 C：每一级导出「非组件」都必须安全落到下一级（永不抛错）──────
  // 注意：**带 $$typeof 的对象是合法组件**（React.memo / forwardRef），不算畸形；
  // 只有 undefined / null / 字符串 / 空对象 / 组件位非组件才是畸形。
  {
    const malformedMdRender = [
      ['undefined exports', undefined],
      ['null exports', null],
      ['string exports', 'nope'],
      ['empty object', {}],
      ['non-component MarkdownView', { MarkdownView: 'nope' }],
      ['null MarkdownView', { MarkdownView: null }],
      ['empty-object MarkdownView', { MarkdownView: {} }],
    ]
    for (const [label, mdRender] of malformedMdRender) {
      const platform = makePlatformStub()
      const { render } = mount({ mdRender, platform: platform.ui })
      const out = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))
      assert.equal(
        out.nodes.filter((n) => n.props['data-ui'] === 'markdown-text').length,
        1,
        `md-render ${label} → level 2 official MarkdownText`,
      )
      assert.equal(out.text, TEXT_BLOCK, `md-render ${label} → text preserved`)
    }

    const malformedPlatform = [
      ['undefined exports', undefined],
      ['null exports', null],
      ['string exports', 'nope'],
      ['empty object', {}],
      ['non-component MarkdownText', { MarkdownText: 'nope' }],
      ['null MarkdownText', { MarkdownText: null }],
      ['empty-object MarkdownText', { MarkdownText: {} }],
    ]
    for (const [label, platform] of malformedPlatform) {
      const { render } = mount({ mdRender: 'throw', platform })
      const out = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))
      const pre = out.nodes.find((n) => n.props['data-dsh-think-zh-expand-fallback'] === 'true')
      assert.ok(pre, `platform ${label} → level 3 <pre> fallback`)
      assert.equal(out.text, TEXT_BLOCK, `platform ${label} → text preserved`)
    }

    // 组件位是 memo / forwardRef 对象 → **可用**，不得落级
    const memoView = {
      $$typeof: MEMO_TYPE,
      type: (props) => createElement('div', { 'data-ui': 'md-render-memo' }, props.text),
      compare: null,
    }
    const memoPlatform = makePlatformStub({ shape: 'memo' })
    const bothObject = collectNodes(
      mount({ mdRender: { MarkdownView: memoView }, platform: memoPlatform.ui }).render([
        { kind: 'text', text: TEXT_BLOCK },
      ]),
    )
    assert.ok(
      bothObject.nodes.some((n) => n.props['data-ui'] === 'md-render-memo'),
      'memo-form MarkdownView counts as a valid level-1 component (object with $$typeof)',
    )
    assert.equal(memoPlatform.calls.length, 0, 'level 1 wins when md-render export is a memo object')

    const forwardRefView = {
      $$typeof: FORWARD_REF_TYPE,
      render: (props) => createElement('div', { 'data-ui': 'md-render-forward-ref' }, props.text),
    }
    const forwardOut = collectNodes(
      mount({ mdRender: { MarkdownView: forwardRefView }, platform: 'throw' }).render([
        { kind: 'text', text: TEXT_BLOCK },
      ]),
    )
    assert.ok(
      forwardOut.nodes.some((n) => n.props['data-ui'] === 'md-render-forward-ref'),
      'forwardRef-form MarkdownView counts as a valid level-1 component',
    )
  }

  // ── 用例 D：md-render 可用时仍是第一级（平台组件不被触碰）────────────
  {
    const mdCalls = []
    const mdView = (props) => {
      mdCalls.push(props)
      return createElement('div', { className: 'tzx-md', 'data-ui': 'md-render' }, props.text)
    }
    const platform = makePlatformStub()
    const { render } = mount({ mdRender: { MarkdownView: mdView }, platform: platform.ui })
    const out = collectNodes(render([{ kind: 'text', text: TEXT_BLOCK }]))
    assert.equal(mdCalls.length, 1, 'dsh-md-render MarkdownView used when available (level 1)')
    assert.equal(platform.calls.length, 0, 'official MarkdownText untouched when md-render present')
    assert.ok(
      out.nodes.some((n) => n.props['data-ui'] === 'md-render'),
      'md-render output used verbatim',
    )
  }

  // ── 用例 E：产物契约（三级链都在 bundle 里，且无裸 createElement(null)）──
  {
    // issue #299：三级链逻辑收口在共享件（构建期注入），模块名以参数传入共享件
    assert.ok(bundleSrc.includes('function installMarkdownViewFallback('), 'shared fallback part injected')
    assert.ok(bundleSrc.includes("'dsh-md-render'"), 'preferred render kernel is dsh-md-render (level 1)')
    assert.ok(
      bundleSrc.includes("'@deepseek-ai/dsh-client-ui-primitives'"),
      'platform official primitives wired for fallback (level 2)',
    )
    assert.ok(
      bundleSrc.includes('data-dsh-think-zh-expand-fallback'),
      'bundle carries the <pre> fallback marker (level 3)',
    )
    assert.ok(bundleSrc.includes('const MarkdownView = '), 'three-level chain still binds a MarkdownView const')
    assert.ok(
      bundleSrc.includes('isValidElementType') && bundleSrc.includes('$$typeof'),
      'bundle uses React isValidElementType semantics with a $$typeof fallback (memo/forwardRef aware)',
    )
  }

  console.log('ALL THREE-LEVEL RENDER FALLBACK TESTS PASSED')
} finally {
  delete global.window
  delete global.localStorage
  delete global.fetch
  delete global.navigator
  delete global.document
}

test('script-style suite (assertions ran at module load)', () => {})
