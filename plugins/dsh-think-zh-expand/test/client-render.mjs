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
 * issue #31 渲染职责迁移：MarkdownView 由 dsh-md-render 提供，本测试先
 * 加载 dsh-md-render 的构建产物（模拟 ModuleLoader 的跨 bundle require），
 * 并断言本插件 bundle 不再包含 MarkdownView 渲染逻辑（tryTable /
 * MarkdownView 函数定义已迁出）。
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

// ── load bundles: dsh-md-render first (think-zh-expand requires it) ───────
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

eval(fs.readFileSync(new URL('../../dsh-md-render/lib/client.js', import.meta.url), 'utf8'))
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.equal(registrations.length, 2, 'two bundles registered')
const mdRenderReg = registrations.find((r) => r.id === 'dsh-md-render')
const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
assert.ok(mdRenderReg, 'dsh-md-render bundle registered')
assert.ok(thinkReg, 'think-zh-expand bundle registered')
// materialize dsh-md-render first (its factory only requires react)
const mdRenderExports = mdRenderReg.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof mdRenderExports.MarkdownView, 'function', 'dsh-md-render exports MarkdownView')
const exportsObj = thinkReg.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === 'dsh-md-render') return mdRenderExports
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
  // 1. standard table: header + separator + data rows
  const t1 = renderText(
    '| 插件 | 版本 |\n|:-----|:----:|\n| dsh-file-activity | **0.4.2** |\n| dsh-think-zh-expand | `0.2.0` |',
  )
  assert.ok(t1.tags.includes('table'), 'table rendered')
  assert.ok(t1.tags.includes('thead'), 'thead rendered')
  assert.ok(t1.tags.includes('tbody'), 'tbody rendered')
  const thCount = t1.tags.filter((t) => t === 'th').length
  const tdCount = t1.tags.filter((t) => t === 'td').length
  assert.equal(thCount, 2, `2 header cells, got ${thCount}`)
  assert.equal(tdCount, 4, `4 data cells (2 rows × 2 cols), got ${tdCount}`)
  assert.ok(t1.texts.includes('插件'), 'header cell text')
  assert.ok(t1.texts.includes('版本'), 'header cell text 2')
  assert.ok(t1.texts.includes('dsh-file-activity'), 'data cell text')
  assert.ok(t1.texts.includes('0.4.2'), 'bold content inside cell (rendered)')
  assert.ok(t1.texts.includes('0.2.0'), 'inline code content inside cell (rendered)')
  // alignment: ':----' left, ':----:' center (from the separator row)
  assert.deepEqual(t1.thStyles, ['left', 'center'], 'alignment from separator row')

  // 2. alignment variants: :---: center, ---: right
  const r2 = renderText('| a | b |\n|:---:|---:|\n| 1 | 2 |')
  assert.deepEqual(r2.thStyles, ['center', 'right'], 'center + right alignment')

  // 3. non-table pipe line (no separator row) falls back to a paragraph
  const r3 = renderText('| just a pipe line')
  assert.ok(!r3.tags.includes('table'), 'no table without separator row')
  assert.ok(r3.tags.includes('p'), 'falls back to paragraph')

  // 4. pipe line followed by non-table line also falls back
  const r4 = renderText('| a | b |\nnot a separator')
  assert.ok(!r4.tags.includes('table'), 'no table when second line is not a separator')
  assert.ok(r4.tags.includes('p'), 'paragraph fallback for non-table pipes')

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

  // 6. fenced code blocks keep their language marker (```mermaid → language-mermaid)
  //    and are wrapped in the host `md-code-block` container, so third-party
  //    renderers (dsh-mermaid-render scans `div.md-code-block`) can find them.
  const codeLangs = []
  let mdCodeBlockWrappers = 0
  function walkLangs(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) {
      for (const c of node) walkLangs(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'function') {
      walkLangs(node.type(props))
      return
    }
    if (node.type === 'div' && props.className === 'md-code-block') mdCodeBlockWrappers += 1
    if (node.type === 'code' && typeof props.className === 'string') codeLangs.push(props.className)
    walkLangs(props.children)
  }
  walkLangs(
    capturedRenderer({
      node: {
        data: {
          blocks: [
            {
              kind: 'text',
              text: '```mermaid\nflowchart TD\n    A --> B\n```\n\n```js\nconst x = 1\n```',
            },
          ],
        },
      },
    }),
  )
  assert.ok(codeLangs.includes('language-mermaid'), 'mermaid fence keeps language class')
  assert.ok(codeLangs.includes('language-js'), 'js fence keeps language class')
  assert.ok(mdCodeBlockWrappers >= 2, 'fenced blocks wrapped in md-code-block for third-party renderers')

  // 7. CommonMark 多反引号行内代码：`` `agent/status` ``（内容含单反引号）
  //    应整体渲染为 code 且内容为 `agent/status`（回归：mdInline 只支持单
  //    反引号配对时，双反引号输入会错位——反引号裸露、agent/status 变裸
  //    文本、出现内容为空白的 code）。
  function constText(node) {
    const out = []
    function walk(n) {
      if (n === null || n === undefined || typeof n === 'boolean') return
      if (typeof n === 'string' || typeof n === 'number') {
        out.push(String(n))
        return
      }
      if (Array.isArray(n)) {
        for (const c of n) walk(c)
        return
      }
      const props = n.props ?? {}
      if (typeof n.type === 'function') {
        walk(n.type(props))
        return
      }
      walk(props.children)
    }
    walk(node)
    return out.join('')
  }
  function collectCode(tree) {
    const codeTexts = []
    const allTexts = []
    function walk(node) {
      if (node === null || node === undefined || typeof node === 'boolean') return
      if (typeof node === 'string' || typeof node === 'number') {
        allTexts.push(String(node))
        return
      }
      if (Array.isArray(node)) {
        for (const c of node) walk(c)
        return
      }
      const props = node.props ?? {}
      if (typeof node.type === 'function') {
        walk(node.type(props))
        return
      }
      if (node.type === 'code') codeTexts.push(constText(props.children))
      walk(props.children)
    }
    walk(tree)
    return { codeTexts, allTexts }
  }
  const r7 = collectCode(
    capturedRenderer({
      node: {
        data: {
          blocks: [{ kind: 'text', text: '思考内容中的 `` `agent/status` `` 应该会被 `mdInline` 解析' }],
        },
      },
    }),
  )
  assert.deepEqual(
    r7.codeTexts,
    ['`agent/status`', 'mdInline'],
    'double-backtick span renders whole token as code, single backtick still works',
  )
  assert.ok(!r7.codeTexts.includes(' '), 'no whitespace-only code artifact')
  assert.ok(!r7.codeTexts.includes(''), 'no empty code artifact')

  // 8. 混合：双反引号（紧凑/带空格）与单反引号共存
  const r8 = collectCode(
    capturedRenderer({
      node: { data: { blocks: [{ kind: 'text', text: '`` `job_list` `` 与 `agent/status`' }] } },
    }),
  )
  assert.deepEqual(r8.codeTexts, ['`job_list`', 'agent/status'], 'mixed multi/single backticks')

  // 9. 无内容的连续反引号串（4 连）保持字面量，不解析为 code
  const r9 = collectCode(
    capturedRenderer({
      node: { data: { blocks: [{ kind: 'text', text: '无内容反引号串 ```` 原样' }] } },
    }),
  )
  assert.ok(!r9.codeTexts.some((t) => t.includes('`')), 'four consecutive backticks stay literal')
  assert.ok(
    r9.allTexts.some((t) => t.includes('````')),
    'four backticks text retained',
  )

  // 10. 思考块（reasoning）内的双反引号同样渲染为 code（用户场景回归）
  const r10 = collectCode(
    capturedRenderer({
      node: {
        data: { blocks: [{ kind: 'reasoning', text: '调用 `` `agent/status` `` 查看状态' }] },
      },
    }),
  )
  assert.ok(r10.codeTexts.includes('`agent/status`'), 'reasoning block renders multi-backtick code')

  // 11. 工具中文化映射（需求 3a）：卡片标题 / 工具名 / 工具描述 / others 摘要
  assert.equal(exportsObj.zhCardTitle('Search'), '搜索', 'variant title Search')
  assert.equal(exportsObj.zhCardTitle('Bash'), '命令行', 'variant title Bash')
  assert.equal(exportsObj.zhCardTitle('Read'), '读取', 'variant title Read')
  assert.equal(exportsObj.zhCardTitle('Write'), '写入', 'variant title Write')
  assert.equal(exportsObj.zhCardTitle('Edit'), '编辑', 'variant title Edit')
  assert.equal(exportsObj.zhCardTitle('Code'), '代码', 'variant title Code')
  assert.equal(exportsObj.zhCardTitle('Inspect'), '检查', 'cordis inspect title')
  assert.equal(exportsObj.zhCardTitle('Run Cordis Plugin'), '运行 Cordis 插件', 'cordis run title')
  assert.equal(exportsObj.zhCardTitle('Tool call'), null, '"Tool call" stays with the global table')
  assert.equal(exportsObj.zhToolName('web_search'), '网络搜索', 'tool name web_search')
  assert.equal(exportsObj.zhToolName('bash'), '命令行', 'tool name bash')
  assert.equal(exportsObj.zhToolName('read'), '读取文件', 'tool name read')
  assert.equal(exportsObj.zhToolName('ask_user_question'), '询问用户', 'tool name ask_user_question')
  assert.equal(exportsObj.zhToolName('mcp__codebase-memory__search_graph'), '图搜索', 'tool name codebase-memory')
  assert.equal(exportsObj.zhToolName('unknown_tool'), null, 'unmapped tool stays english')
  assert.equal(exportsObj.zhToolDesc('web_search'), '搜索网络获取最新信息。', 'tool desc web_search')
  assert.equal(exportsObj.zhToolDesc('bash'), '执行命令并返回输出（可设置工作目录、超时）。', 'tool desc bash')
  assert.equal(exportsObj.zhToolDesc('unknown_tool'), null, 'unmapped desc stays english')
  assert.equal(
    exportsObj.zhCardSummary('ask_user_question · {"text":"确认"}'),
    '询问用户 · {"text":"确认"}',
    'others summary tool-name prefix localized',
  )
  assert.equal(exportsObj.zhCardSummary('web_search · 关键词'), '网络搜索 · 关键词', 'others summary web_search')
  assert.equal(exportsObj.zhCardSummary('no_prefix_here'), null, 'summary without tool prefix untouched')
  assert.equal(exportsObj.zhCardSummary('unknown_tool · x'), null, 'unmapped summary tool untouched')

  // 12. 渲染职责迁移（issue #31）：本插件不再包含 MarkdownView 渲染逻辑，
  //     渲染由 dsh-md-render 提供（跨插件 require）
  assert.equal(exportsObj.MarkdownView, undefined, 'MarkdownView not exported by think-zh-expand')
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(!bundleSrc.includes('function tryTable'), 'tryTable definition removed from bundle')
  assert.ok(!bundleSrc.includes('function tryFence'), 'tryFence definition removed from bundle')
  assert.ok(!bundleSrc.includes('function MarkdownView'), 'MarkdownView definition removed from bundle')
  assert.ok(bundleSrc.includes("require('dsh-md-render')"), 'bundle requires dsh-md-render for rendering')

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
  // 本插件旧类名全部清除；tzx-md / tzx-p 等是 dsh-md-render 的 MarkdownView
  // 输出契约类名（跨插件表格增强依赖），必须保留。
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
  assert.ok(thinkClasses.includes('tzx-md'), 'contract class tzx-md preserved (MarkdownView output)')
  assert.ok(thinkClasses.includes('tzx-p'), 'contract class tzx-p preserved (MarkdownView output)')
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
    if (spec === 'dsh-md-render') return mdRenderExports
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

  // 17. dsh-md-render 缺失时的降级回归（issue #290）：宿主安装路径不会自动安装
  //     dsh.client.external 指向的第三方包，require 落空时不得拖垮整条 client
  //     factory —— 同 issue #90（dsh-my-plugin-manager）的兜底模式。
  const fbError = new Error('client-modules: require("dsh-md-render") missed the module table')
  let fbExports = null
  assert.doesNotThrow(
    () => {
      fbExports = thinkReg.factory((spec) => {
        if (spec === 'react') return stubbed
        if (spec === 'dsh-md-render') throw fbError
        throw new Error('unexpected require: ' + spec)
      })
    },
    'client factory must not throw when dsh-md-render is missing',
  )
  assert.equal(typeof fbExports.apply, 'function', 'plugin still applies without the renderer')

  let fbRenderer = null
  fbExports.apply({
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (_desc, renderer) => {
        fbRenderer = renderer
        return () => {}
      },
    },
  })
  assert.equal(typeof fbRenderer, 'function', 'assistant-step renderer still registered on fallback')

  const fbTree = fbRenderer({
    node: { data: { blocks: [{ kind: 'reasoning', text: '降级内容第一行\n第二行' }] } },
  })
  const fbTags = []
  const fbTexts = []
  ;(function walkFallback(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      fbTexts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const c of node) walkFallback(c)
      return
    }
    const props = node.props ?? {}
    if (typeof node.type === 'string') {
      fbTags.push(node)
    } else if (typeof node.type === 'function') {
      walkFallback(node.type(node.props))
      return
    }
    walkFallback(props.children)
  })(fbTree)

  const preNode = fbTags.find((n) => n.type === 'pre')
  assert.ok(preNode, 'renders <pre> fallback when dsh-md-render is unavailable')
  assert.equal(
    preNode.props['data-dsh-think-zh-expand-fallback'],
    'true',
    'fallback node carries a debug marker attribute',
  )
  assert.ok(
    fbTexts.some((t) => t.includes('降级内容第一行')),
    'reasoning text preserved through the fallback renderer',
  )

  console.log('ALL CLIENT RENDER-PATH TESTS PASSED')
} finally {
  delete global.window
  delete global.localStorage
  delete global.fetch
  delete global.navigator
}

test('script-style suite (assertions ran at module load)', () => {})
