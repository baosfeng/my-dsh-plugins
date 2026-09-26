import { test } from 'vitest'
/**
 * Client render-path test for dsh-think-zh-expand: loads the client bundle
 * with a stubbed react (real createElement; hooks stubbed), mounts the plugin
 * against a mocked slots service, captures the assistant-step renderer it
 * registers, then invokes it with markdown text blocks to verify:
 *  - tables (| a | b | + separator + data rows) render as table/thead/tbody
 *    with th/td cells and per-column alignment from the separator row,
 *  - a non-table pipe line (no separator row) falls back to a paragraph,
 *  - basic inline markdown inside cells still works (bold / inline code).
 *
 * issue #428：渲染内核改为宿主官方 baseline 组件（平台 seed 模块
 * @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText），本插件不再跨插件
 * require dsh-md-render、不再声明 dsh.client.external。测试只加载本插件产物，
 * 用平台 stub 注入官方组件；产物若仍 require dsh-md-render 会直接抛
 * 'unexpected require' 让测试失败（强断言）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── stubbed react ─────────────────────────────────────────────────────────
// 渲染路径测试只需要元素树结构（type/props/children），不依赖真实 react：
// 自写最小 createElement（children 语义与 React 一致：单 child 直接赋值、
// 多 child 组装数组、数组 child 原样保留）。CI（ubuntu runner 无 node_modules）
// 与本机均可运行——此前 require 本机绝对路径的 react，导致远程 CI 必然失败。
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

const stubbed = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

// ── load bundle: 只有本插件；平台 seed 模块用 stub 注入 ───────────────────
let registrations = []
global.window = {
  __ModuleLoader__: {
    load: (registration) => {
      registrations.push(registration)
    },
  },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}
Object.defineProperty(global, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
global.localStorage = { getItem: () => null, setItem: () => {} }
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })
// ── document mock: 捕获 apply() 注入的样式表（issue #57 防复发）──────────
// 样式 effect 在 document 存在时会把 STYLES 注入 head；测试在此捕获内容，
// 断言思考块内 Markdown 内容的浅灰覆盖规则存在（防止 .tzx-md 覆盖思考
// 块浅灰色导致思考/非思考区分不开的问题回归）。
const injectedStyles = []
global.document = {
  head: {
    appendChild: (el) => injectedStyles.push(el.textContent),
    removeChild: () => {},
  },
  createElement: () => ({ setAttribute: () => {}, textContent: '' }),
}

eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.equal(registrations.length, 1, 'only the think-zh-expand bundle is loaded')
const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
assert.ok(thinkReg, 'think-zh-expand bundle registered')
// issue #428：平台 seed 模块 stub（宿主官方 baseline MarkdownText）。require 里
// **没有** dsh-md-render 分支——产物若仍跨插件取渲染器，这里会抛
// 'unexpected require: dsh-md-render' 直接让测试失败（强断言）。
const platformCalls = []
function PlatformMarkdownText(props) {
  platformCalls.push(props)
  return createElement('pre', { 'data-ui': 'markdown-text' }, props.text)
}
const platformModule = { MarkdownText: PlatformMarkdownText }
const exportsObj = thinkReg.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return platformModule
  throw new Error('unexpected require: ' + spec)
})
assert.deepEqual(exportsObj.inject, ['slots'])
assert.equal(typeof exportsObj.apply, 'function')

// ── mock ctx: effect runs immediately; slots.inject/register captured ─────
let registerFn = null
let capturedRenderer = null
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_name, fn) => {
      registerFn = fn
      return () => {}
    },
    register: (_desc, renderer) => {
      capturedRenderer = renderer
      return () => {}
    },
  },
}
exportsObj.apply(ctx)
assert.equal(typeof registerFn, 'function', 'slots.inject callback captured')
registerFn()
assert.equal(typeof capturedRenderer, 'function', 'assistant-step renderer captured')

// ── helpers ───────────────────────────────────────────────────────────────
function renderText(text) {
  const tree = capturedRenderer({ node: { data: { blocks: [{ kind: 'text', text }] } } })
  const tags = []
  const texts = []
  const thStyles = []
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
    if (typeof node.type === 'string') {
      tags.push(node.type)
      if (node.type === 'th' && props.style && typeof props.style.textAlign === 'string') {
        thStyles.push(props.style.textAlign)
      }
    } else if (typeof node.type === 'function') {
      // plugin internal components (AssistantStepView / MarkdownView / ThinkBlock)
      walk(node.type(node.props))
      return
    }
    walk(props.children)
  }
  walk(tree)
  return { tags, texts, thStyles }
}

// ── assertions ────────────────────────────────────────────────────────────
try {
  // 5. reasoning block still renders as think block (regression: default expanded)
  const think = capturedRenderer({
    node: { data: { blocks: [{ kind: 'reasoning', text: '第一行\n第二行' }] } },
  })
  const thinkTexts = []
  function walkText(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      thinkTexts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walkText(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walkText(node.type(props))
      return
    }
    walkText(props.children)
  }
  walkText(think)
  assert.ok(thinkTexts.includes('思考'), 'think block title')
  assert.ok(
    thinkTexts.some((t) => t.includes('第一行')),
    'thinking content expanded',
  )

  // 6. 渲染内核契约（issue #428）：本插件不再跨插件取渲染器。
  //    产物里没有 require('dsh-md-render')，也不声明 dsh.client.external；
  //    文本块与思考块一律交给宿主官方 baseline 组件
  //    （@deepseek-ai/dsh-client-ui-primitives 的 MarkdownText，平台 seed 模块）。
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const textTree = renderText('文本块正文')
  const textCall = platformCalls.find((call) => call.text === '文本块正文')
  assert.ok(textCall, 'text block handed to the official baseline MarkdownText')
  assert.equal(
    textCall.labels?.code?.copyLabel,
    '复制',
    'labels.code.copyLabel passed (official component has no default)',
  )
  assert.ok(
    textTree.texts.some((t) => t.includes('文本块正文')),
    'text content preserved through the official component',
  )
  assert.ok(!bundleSrc.includes("require('dsh-md-render')"), 'artifact has no cross-plugin require (issue #428)')
  assert.ok(bundleSrc.includes('external: PLATFORM_PRIMITIVES'), 'external kernel slot points at the platform module')
  assert.ok(
    bundleSrc.includes("externalExport: 'externalRendererDisabled'"),
    'external-kernel level of the shared fallback part is bypassed (never matches)',
  )

  // ── issue #54 类名前缀统一 + 视觉回退（用户要求）：思考块结构/折叠交互 ──
  // 13. 结构：统一 dsh-think-zh-expand- 前缀类名；视觉回归官方基线
  //     （无卡片/徽章/动画/图标，字符折叠箭头）
  function collectClasses(node, out = []) {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (Array.isArray(node)) {
      for (const c of node) collectClasses(c, out)
      return out
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      collectClasses(node.type(props), out)
      return out
    }
    if (typeof node.type === 'string' && typeof props.className === 'string') {
      for (const c of props.className.split(/\s+/)) out.push(c)
    }
    collectClasses(props.children, out)
    return out
  }
  function countSvg(node) {
    let n = 0
    function walk(x) {
      if (x === null || x === undefined || typeof x === 'boolean') return
      if (Array.isArray(x)) {
        for (const c of x) walk(c)
        return
      }
      const props = x.props ?? {}
      if (typeof x.type === 'function') {
        walk(x.type(props))
        return
      }
      if (x.type === 'svg') n += 1
      walk(props.children)
    }
    walk(node)
    return n
  }
  function findClass(node, cls) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (Array.isArray(node)) {
      for (const c of node) {
        const hit = findClass(c, cls)
        if (hit) return hit
      }
      return null
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') return findClass(node.type(props), cls)
    if (typeof node.type === 'string' && props.className === cls) return node
    return findClass(props.children, cls)
  }
  function collectTexts(node) {
    const out = []
    function walk(x) {
      if (x === null || x === undefined || typeof x === 'boolean') return
      if (typeof x === 'string' || typeof x === 'number') {
        out.push(String(x))
        return
      }
      if (Array.isArray(x)) {
        for (const c of x) walk(c)
        return
      }
      const props = x.props ?? {}
      if (typeof x.type === 'function') {
        walk(x.type(props))
        return
      }
      walk(props.children)
    }
    walk(node)
    return out
  }

  const thinkTree = capturedRenderer({
    node: { data: { blocks: [{ kind: 'reasoning', text: '第一行\n第二行' }] } },
  })
  const thinkClasses = collectClasses(thinkTree)
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think'), 'think class (new prefix)')
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think-head'), 'think head class (new prefix)')
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think-chevron'), 'chevron class (new prefix)')
  assert.ok(
    !thinkClasses.includes('dsh-think-zh-expand-think-chevron-open'),
    'no chevron rotation transition class (visual rollback)',
  )
  // issue #73: 展开态无 think 图标（官方展开态 leading 只显示 chevron）
  assert.ok(!thinkClasses.includes('dsh-think-zh-expand-think-icon'), 'no think icon while expanded (official)')
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think-title'), 'think title class (new prefix)')
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think-body'), 'think body class (new prefix)')
  // issue #73: 头部结构对齐官方 DisclosureRow——leading 图标区 + separator
  assert.ok(thinkClasses.includes('dsh-think-zh-expand-think-leading'), 'think leading class (official DisclosureRow)')
  assert.ok(
    !thinkClasses.includes('dsh-think-zh-expand-think-separator'),
    'no separator while expanded (official collapsedContent hidden)',
  )
  // 本插件旧类名全部清除。issue #428 起渲染走宿主官方 baseline 组件，
  // 不再有 tzx-md / tzx-p 这类来自跨插件渲染内核的输出契约类名。
  const LEGACY_OWN = [
    'tzx-think',
    'tzx-think-row',
    'tzx-think-chevron',
    'tzx-think-title',
    'tzx-think-summary',
    'tzx-think-body',
    'tzx-assistant',
    'tzx-assistant-body',
    'tzx-stopped',
  ]
  assert.ok(!thinkClasses.some((c) => LEGACY_OWN.includes(c)), 'no legacy own tzx-* classes in the think tree')
  // issue #73: 折叠箭头为官方 IconChevronDownOutline14（14px SVG 图标），
  // 不再是字符 ▸/▾；展开态渲染 1 个 chevron svg
  assert.equal(countSvg(thinkTree), 1, 'chevron svg icon rendered while expanded (official)')
  const thinkExpandedTexts = collectTexts(thinkTree)
  assert.ok(!thinkExpandedTexts.includes('▾'), 'no plain chevron glyph (official svg icon)')
  assert.ok(!thinkExpandedTexts.includes('▸'), 'no plain chevron glyph (official svg icon)')
  const thinkRoot = findClass(thinkTree, 'dsh-think-zh-expand-think')
  assert.equal(thinkRoot.props['data-state'], 'ok', 'data-state ok when not streaming')
  assert.equal(thinkRoot.props['data-variant'], 'think', 'data-variant think preserved')

  // 13b. issue #73: #57 的思考正文浅灰覆盖规则已移除——思考正文经
  //      MarkdownView 渲染后颜色跟随其官方默认（primary，与正式回复一致），
  //      不再有 .tzx-md / 表格 / 公式的 label-tertiary 覆盖。断言注入的
  //      样式表不含这些覆盖规则（防 #57 回归）。
  assert.ok(injectedStyles.length >= 1, 'styles injected into document head')
  const thinkStyleSheet = injectedStyles.join('\n')
  assert.ok(
    !thinkStyleSheet.includes('.dsh-think-zh-expand-think-body .tzx-md{color:var(--dsw-alias-label-tertiary)}'),
    'no .tzx-md tertiary override (issue #73)',
  )
  assert.ok(
    !thinkStyleSheet.includes(
      '.dsh-think-zh-expand-think-body .dsh-md-render-table{color:var(--dsw-alias-label-tertiary)}',
    ),
    'no table tertiary override (issue #73)',
  )
  // 正文缩进对齐官方 thinkBody（22px，非 24px）
  assert.ok(thinkStyleSheet.includes('padding:4px 0 4px 22px'), 'think body 22px indent (official thinkBody)')

  // 14. 流式生成中：data-state=running + 强制展开（徽章已回退移除）
  const runningTree = capturedRenderer({
    node: { data: { status: 'running', blocks: [{ kind: 'reasoning', text: '流式思考内容' }] } },
  })
  const runningRoot = findClass(runningTree, 'dsh-think-zh-expand-think')
  assert.equal(runningRoot.props['data-state'], 'running', 'data-state running while streaming')
  const runningTexts = collectTexts(runningTree)
  assert.ok(!runningTexts.includes('生成中'), 'no streaming badge text (visual rollback)')
  assert.ok(
    runningTexts.some((t) => t.includes('流式思考内容')),
    'streaming forces expanded content',
  )

  // 15. 折叠交互：点击标题行收起（摘要出现、内容隐藏），再点恢复展开
  let interactiveExpanded = true
  const interactiveReact = {
    ...stubbed,
    useState: () => [
      interactiveExpanded,
      (v) => {
        interactiveExpanded = typeof v === 'function' ? v(interactiveExpanded) : v
      },
    ],
  }
  const exportsObj2 = thinkReg.factory((spec) => {
    if (spec === 'react') return interactiveReact
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return platformModule
    throw new Error('unexpected require: ' + spec)
  })
  let registerFn2 = null
  let capturedRenderer2 = null
  const ctx2 = {
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => {
        registerFn2 = fn
        return () => {}
      },
      register: (_desc, renderer) => {
        capturedRenderer2 = renderer
        return () => {}
      },
    },
  }
  exportsObj2.apply(ctx2)
  registerFn2()
  assert.equal(typeof capturedRenderer2, 'function', 'interactive renderer captured')
  const renderThink = () =>
    capturedRenderer2({ node: { data: { blocks: [{ kind: 'reasoning', text: '第一行\n第二行' }] } } })
  const expandedTexts = collectTexts(renderThink())
  assert.ok(
    expandedTexts.some((t) => t.includes('第二行')),
    'expanded by default',
  )
  const head = findClass(renderThink(), 'dsh-think-zh-expand-think-head')
  assert.ok(head, 'think head element found')
  head.props.onClick()
  const collapsedTexts = collectTexts(renderThink())
  assert.ok(
    collapsedTexts.some((t) => t.includes('第一行')),
    'summary shows first line when collapsed',
  )
  assert.ok(!collapsedTexts.some((t) => t.includes('第二行')), 'body hidden when collapsed')
  // issue #73: 收起态结构对齐官方——think 图标 + chevron(hover 显示) +
  // separator + summary
  const collapsedTree = renderThink()
  const collapsedClasses = collectClasses(collapsedTree)
  assert.ok(collapsedClasses.includes('dsh-think-zh-expand-think-icon'), 'think icon shown when collapsed (official)')
  assert.ok(
    collapsedClasses.includes('dsh-think-zh-expand-think-chevron-hover'),
    'chevron hover class when collapsed (official)',
  )
  assert.ok(
    collapsedClasses.includes('dsh-think-zh-expand-think-separator'),
    'separator shown when collapsed (official)',
  )
  assert.equal(countSvg(collapsedTree), 2, 'think icon + chevron svg when collapsed (official)')
  const head2 = findClass(renderThink(), 'dsh-think-zh-expand-think-head')
  head2.props.onClick()
  const reexpandedTexts = collectTexts(renderThink())
  assert.ok(
    reexpandedTexts.some((t) => t.includes('第二行')),
    're-expanded after second click',
  )

  // ── 控制标签剥离回归 ────────────────────────────────────────────────
  // 模型输出中的 xml 风格控制标签（<review>/</review>、<think>、
  // <answer>）不得以裸文本出现在正文/思考里：标签剥离、内部内容保留。
  const stripped1 = renderText('执行发版 <review>目标 0.1.4</review> 完成')
  assert.ok(
    !stripped1.texts.some((t) => t.includes('<review>') || t.includes('</review>')),
    'review tags stripped from text blocks',
  )
  assert.ok(
    stripped1.texts.some((t) => t.includes('目标 0.1.4')),
    'review inner content preserved',
  )
  const strippedThink = collectTexts(
    capturedRenderer2({
      node: {
        data: {
          blocks: [{ kind: 'reasoning', text: '</review>\n<review>执行 md-render 0.1.4 发版。\n<review></think>' }],
        },
      },
    }),
  )
  assert.ok(
    !strippedThink.some(
      (t) => t.includes('<review>') || t.includes('</review>') || t.includes('</think>') || t.includes('<think>'),
    ),
    'control tags stripped from reasoning blocks',
  )
  assert.ok(
    strippedThink.some((t) => t.includes('执行 md-render 0.1.4 发版。')),
    'reasoning content preserved',
  )

  // 16. 前缀统一回归：bundle 不再包含旧 tzx-* 本插件类名；共享图标已拼接
  assert.ok(!bundleSrc.includes("'tzx-think"), 'legacy tzx-think class prefix removed from bundle')
  assert.ok(!bundleSrc.includes("'tzx-assistant"), 'legacy tzx-assistant class prefix removed from bundle')
  assert.ok(!bundleSrc.includes("'tzx-stopped"), 'legacy tzx-stopped class removed from bundle')
  assert.ok(bundleSrc.includes('chevronRight:'), 'shared icons spliced into bundle (chevronRight)')
  assert.ok(bundleSrc.includes('clock:'), 'shared icons spliced into bundle (clock)')

  console.log('ALL CLIENT RENDER-PATH TESTS PASSED')
} finally {
  delete global.window
  delete global.localStorage
  delete global.fetch
  delete global.navigator
}

test('script-style suite (assertions ran at module load)', () => {})
