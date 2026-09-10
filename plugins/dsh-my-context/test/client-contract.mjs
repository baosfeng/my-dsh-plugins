/**
 * 构建契约 + client 行为契约（TS 迁移防回归）。
 *
 * 覆盖两类此前无测试锁定的契约（迁移前 dsh-my-context 的 client 端只被
 * test/host-client.mjs 间接覆盖：无浏览器渲染路径、无片段/模板同步锁定）：
 *
 * 1. 构建契约（源码与产物同步，TS升级规范 6.2）：
 *    - 提交进仓库的 `lib/client.js` 必须**逐字节**等于 `lib/client.src.js` 模板
 *      拼接 `lib/parts/*.js` 片段的结果 —— 只改产物不改模板/片段（或反之）
 *      立即失败（历史上出现过「只改产物，下次构建即丢失」）；
 *    - 产物零未解析 `__PART_*__` 占位符；
 *    - 每个已发布片段都对应 `src/client/parts/<name>.ts` 源码，且二者的顶层
 *      声明（function/const 名）一致 —— 只改 `lib/parts/*.js` 不改 TS 源码
 *      会被这条抓住（产物是 tsc 输出，源码才是唯一真相）；
 *    - TS 片段不得出现 import/export（DSH ModuleLoader 不支持 factory 内相对
 *      路径 require，必须拼成单 bundle）；
 *    - 拼接顺序固定（i18n 的 strings 声明先于其它片段的使用）。
 *
 * 2. client 行为契约：面板渲染（概览/构成/请求/告警）、溢出预警（分级/进度条/
 *    建议卡/记录/阈值保存）、预算设置（保存 POST + 反馈）、数据拉取与轮询
 *    生命周期、i18n 文案与回退、样式注入与 teardown、bundle 页签注册。
 *
 * 断言值全部按**迁移前手写实现的实际行为**写死（迁移不得改变行为）：
 * 例如累计 token 不含 cacheRead、非法时间戳产出 NaN 串、tokens() 带 ' tokens'
 * 后缀 —— 这些是既有语义，不是本次迁移引入的。
 *
 * 片段按 factory 语义拼接后 eval（与 `lib/client.js` 同一作用域形态），
 * 用最小 React/hooks/DOM/fetch 桩驱动。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 已发布片段（顺序 = scripts/build.mjs 的 pieces 顺序，也是拼接顺序）。 */
const PIECES = [
  ['/*__PART_I18N__*/', 'i18n'],
  ['/*__PART_PANEL__*/', 'panel'],
  ['/*__PART_OVERFLOW__*/', 'overflow'],
  ['/*__PART_STYLES__*/', 'styles'],
]

/** 片段顶层声明名（function foo / const foo），用于锁定「产物来自 TS 源码」。 */
function topLevelDecls(src) {
  return [...src.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/gm)]
    .map((m) => m[1] ?? m[2])
    .sort()
}

/** 等一轮宏任务（冲刷 fetch 桩的 promise 链）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── React / hooks / DOM / fetch 桩 ─────────────────────────────────────

function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

/** 最小 hooks 桩：支持多次「渲染」（每次渲染重置 hook 游标）。 */
function createHookHarness() {
  const states = []
  let cursor = 0
  const useState = (initial) => {
    const index = cursor
    cursor += 1
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
    return [
      states[index],
      (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      },
    ]
  }
  return {
    useState,
    render(component, props) {
      cursor = 0
      return component(props)
    },
  }
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

/** 元素文本（直接字符串子节点拼接）。 */
function textOf(el) {
  const kids = Array.isArray(el.props?.children) ? el.props.children : [el.props?.children]
  return kids.filter((k) => typeof k === 'string').join('')
}

/** className 是否含该类名（片段里多为组合类名，如 'dso-alert dso-alert-warn'）。 */
function hasClass(el, token) {
  return typeof el.props?.className === 'string' && el.props.className.split(/\s+/).includes(token)
}

/** 按 className 精确查找元素。 */
function byClass(tree, className) {
  return collect(tree).find((el) => el.props?.className === className)
}

/** 按 className 精确查找全部元素。 */
function allByClass(tree, className) {
  return collect(tree).filter((el) => el.props?.className === className)
}

/** 按组合类名中的单个类名查找元素。 */
function byClassToken(tree, token) {
  return collect(tree).find((el) => hasClass(el, token))
}

/** 按组合类名中的单个类名查找全部元素。 */
function allByClassToken(tree, token) {
  return collect(tree).filter((el) => hasClass(el, token))
}

/** 按文本找按钮。 */
function buttonByText(tree, label) {
  return collect(tree).find((el) => el.type === 'button' && textOf(el) === label)
}

/** 下拉框的全部 option 文本。 */
function optionTexts(select) {
  return collect(select)
    .filter((el) => el.type === 'option')
    .map((el) => textOf(el))
}

/** 路由式 fetch 桩：handler(path, options) 返回 value；返回 Error 表示失败响应。 */
function createFetchStub(handler) {
  const calls = []
  const fetchStub = (path, options) => {
    calls.push({ path, options })
    const result = handler(path, options)
    if (result instanceof Error) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: result.message } }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ value: result }) })
  }
  fetchStub.calls = calls
  return fetchStub
}

/** DOM 桩：记录注入的 style 元素（injectStyles 用）。 */
function createDocumentStub() {
  const appended = []
  return {
    appended,
    head: {
      appendChild(node) {
        appended.push(node)
        node.parentNode = this
      },
      removeChild(node) {
        const index = appended.indexOf(node)
        if (index >= 0) appended.splice(index, 1)
        node.parentNode = null
      },
    },
    createElement(tag) {
      return {
        tag,
        attributes: {},
        textContent: '',
        parentNode: null,
        setAttribute(k, v) {
          this.attributes[k] = v
        },
      }
    },
  }
}

/** 临时替换全局 navigator（bundle 里的 isZh() 读全局作用域）。 */
function withNavigator(language, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true, writable: true })
  try {
    return fn()
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
}

/** Eval 全部片段（同一作用域，等价于 build 拼接后的 factory 内部）。 */
function loadParts(opts = {}) {
  const harness = createHookHarness()
  const navigatorMock = 'navigator' in opts ? opts.navigator : { language: 'zh-CN' }
  const documentMock = opts.document
  const fetchMock = opts.fetch || (() => Promise.reject(new Error('fetch not stubbed')))
  const effects = []
  const timers = []
  const cleared = []
  const useEffect = (effect) => {
    effects.push(effect)
    return undefined
  }
  const source = PIECES.map(([, name]) => read(`../lib/parts/${name}.js`)).join('\n')
  const factory = new Function(
    'createElement',
    'useState',
    'useEffect',
    'navigator',
    'document',
    'fetch',
    'setInterval',
    'clearInterval',
    `${source}\nreturn {
      strings, isZh,
      apiJson, timeText, cacheHitRate, compositionLabel,
      Stat, modelBadge, windowNote, OverviewCard, CompositionBar, RequestRow, RequestList,
      BudgetField, BudgetSettings, saveBudget, AlertList, loadContextData, sessionSections,
      statusNote, ContextPanel, CONTEXT_POLL_MS,
      contextUsage, ratioTo, overflowLevelOf, usageMeter, overflowLevelLabel, topComposition,
      ContextUsageCard, CompressSuggestions, OverflowList, OverflowSection, ThresholdField,
      OverflowSettings, saveOverflow, injectStyles, STYLES,
    }`,
  )
  const api = factory(
    createElement,
    harness.useState,
    useEffect,
    navigatorMock,
    documentMock,
    fetchMock,
    (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    (id) => {
      cleared.push(id)
    },
  )
  return { ...api, harness, effects, timers, cleared }
}

/** 会话统计样本（server GET /context/api/session 的 value 形态）。 */
function sessionFixture(overrides = {}) {
  return {
    sessionId: 'sess-1',
    model: 'deepseek-v4',
    contextWindow: 1000,
    usage: { inputTokens: 400, outputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0 },
    composition: { system: 100, tools: 60, user: 40 },
    requests: [
      {
        turn: 1,
        step: 1,
        prompt: 200,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        time: new Date(2026, 0, 2, 3, 4, 5).getTime(),
      },
      {
        turn: 1,
        step: 2,
        prompt: 500,
        output: 50,
        cacheRead: 300,
        cacheWrite: 0,
        time: new Date(2026, 0, 2, 3, 4, 9).getTime(),
      },
    ],
    alerts: [],
    overflows: [],
    ...overrides,
  }
}

const OVERFLOW_DEFAULT = { warnThreshold: 0.8, alertThreshold: 0.9 }

// ── 1. 构建契约 ────────────────────────────────────────────────────────

test('构建契约：lib/client.js 必须等于 lib/client.src.js 模板 + lib/parts/*.js 片段拼接结果', () => {
  let expected = read('../lib/client.src.js')
  for (const [placeholder, name] of PIECES) {
    assert.ok(expected.includes(placeholder), `lib/client.src.js 缺少 ${placeholder} 占位符`)
    const part = read(`../lib/parts/${name}.js`)
    // 函数式替换：片段里的 $&/$1 不作特殊解释（与 scripts/build.mjs 一致）
    expected = expected.replaceAll(placeholder, () => part)
  }
  const actual = read('../lib/client.js')
  assert.equal(actual, expected, 'lib/client.js 与「模板 + 片段」不一致：源码/产物不同步，请 npm run build 并提交产物')
})

test('构建契约：产物零未解析占位符，且每个片段都有对应 TS 源码（迁移口径）', () => {
  const bundle = read('../lib/client.js')
  assert.ok(!bundle.includes('/*__PART_'), 'lib/client.js 里仍有未解析的 __PART_*__ 占位符')
  for (const [, name] of PIECES) {
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
  assert.deepEqual(
    PIECES.map(([, name]) => name),
    ['i18n', 'panel', 'overflow', 'styles'],
    '片段清单与拼接顺序（scripts/build.mjs pieces）必须锁定',
  )
  // globals.d.ts 是本插件 client 端的类型契约，必须随片段一起提交。
  assert.ok(read('../src/client/globals.d.ts').includes('declare function createElement'))
})

test('构建契约：拼接顺序即声明顺序（i18n 的 strings 先于 panel/overflow 的使用）', () => {
  const bundle = read('../lib/client.js')
  const at = (needle) => {
    const index = bundle.indexOf(needle)
    assert.ok(index >= 0, `lib/client.js 缺少 ${needle}`)
    return index
  }
  const stringsDecl = at('const strings = {')
  for (const usage of ['function ContextPanel', 'function ContextUsageCard']) {
    assert.ok(stringsDecl < at(usage), `strings 声明必须早于 ${usage}（片段顺序不可调换）`)
  }
  // 模板占位符顺序 = 拼接顺序：i18n → panel → overflow → styles
  const template = read('../lib/client.src.js')
  const order = PIECES.map(([placeholder]) => template.indexOf(placeholder))
  assert.deepEqual(
    order.slice().sort((a, b) => a - b),
    order,
    'lib/client.src.js 的占位符顺序必须与 build.mjs pieces 顺序一致',
  )
})

// ── 2. i18n 文案契约 ──────────────────────────────────────────────────

test('i18n 契约：中文/英文两套文案 + 未知语言回退英文', () => {
  const zh = loadParts({ navigator: { language: 'zh-CN' } })
  assert.equal(zh.strings.tabTitle(), '上下文透镜')
  assert.equal(zh.strings.allSessions(), '全部会话')
  assert.equal(zh.strings.overflowSection(), '溢出预警')
  assert.equal(zh.strings.levelCritical(), '严重')
  assert.equal(zh.strings.suggestNewSession(), '开启新会话，归档当前上下文')
  assert.equal(zh.strings.turnStep(2, 3), '轮 2 · 步 3')
  assert.equal(zh.strings.overflowThreshold(0.9), '阈值 90%')
  assert.equal(zh.strings.suggestComposition('系统提示、工具'), '查看上下文构成占比（系统提示、工具 占比最高）')
  assert.equal(zh.strings.tokens(500), '500 tokens')

  const en = loadParts({ navigator: { language: 'en-US' } })
  assert.equal(en.strings.tabTitle(), 'Context')
  assert.equal(en.strings.allSessions(), 'All sessions')
  assert.equal(en.strings.overflowSection(), 'Overflow alerts')
  assert.equal(en.strings.levelCritical(), 'Critical')
  assert.equal(en.strings.turnStep(2, 3), 'turn 2 · step 3')
  assert.equal(en.strings.overflowThreshold(0.9), 'threshold 90%')
  assert.equal(en.strings.suggestTitle('alert'), 'Suggestion: compact soon or start a new session')
  assert.equal(en.strings.suggestTitle('warn'), 'Suggestion: watch context usage')

  // 语文扩展：zh-TW 同样按中文渲染。
  assert.equal(loadParts({ navigator: { language: 'zh-TW' } }).isZh(), true)
  // 无 navigator / 语言缺失 → 回退英文（不抛异常）。
  const none = loadParts({ navigator: undefined })
  assert.equal(none.isZh(), false)
  assert.equal(none.strings.tabTitle(), 'Context')
  assert.equal(none.strings.suggestTitle('critical'), 'Suggestion: context near limit, start a new session')
})

// ── 3. 面板渲染契约 ───────────────────────────────────────────────────

test('面板：cacheHitRate / timeText / compositionLabel / percent 口径', () => {
  const p = loadParts()
  assert.equal(p.cacheHitRate({ inputTokens: 100, cacheReadTokens: 300 }), 0.75)
  assert.equal(p.cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 }), 0)
  assert.equal(p.cacheHitRate(undefined), 0)
  assert.equal(p.strings.percent(p.cacheHitRate({ inputTokens: 100, cacheReadTokens: 300 })), '75.0%')

  const stamp = new Date(2026, 0, 2, 3, 4, 5).getTime()
  assert.equal(p.timeText(stamp), '03:04:05', 'HH:MM:SS 补零')
  // 既有行为（迁移不改）：只有 new Date() 抛错才走 catch，非法字符串产出 NaN 串。
  assert.equal(p.timeText('not-a-date'), 'NaN:NaN:NaN')

  assert.equal(p.compositionLabel('system'), '系统提示')
  assert.equal(p.compositionLabel('tool'), '工具结果')
  assert.equal(p.compositionLabel('unknown-key'), 'unknown-key', '未知分类原样回显')
})

test('面板：概览卡累计口径 = 输入 + 输出（不含 cacheRead），含缓存命中率与模型徽标', () => {
  const p = loadParts()
  const tree = p.harness.render(p.OverviewCard, { session: sessionFixture() })
  const values = allByClass(tree, 'dso-stat-value').map((el) => textOf(el))
  const labels = allByClass(tree, 'dso-stat-label').map((el) => textOf(el))
  assert.deepEqual(labels.slice(0, 2), ['累计 token', 'KV 缓存命中率'])
  // 累计 = 400 + 100 = 500（cacheRead 300 是计价项，不计入累计）
  assert.equal(values[0], '500 tokens')
  assert.equal(values[1], '42.9%', '命中率 = cacheRead / (input + cacheRead) = 300/700')
  assert.deepEqual(labels.slice(2), ['输入', '输出', '缓存命中'])
  assert.deepEqual(values.slice(2), ['400 tokens', '100 tokens', '300 tokens'])
  assert.equal(textOf(byClass(tree, 'dso-time')), '模型 deepseek-v4', '模型徽标')
  assert.equal(textOf(byClass(tree, 'dso-feedback')), '上下文窗口 1,000', '上下文窗口备注')
})

test('面板：概览卡无模型/无窗口时省略徽标与备注', () => {
  const p = loadParts()
  const tree = p.harness.render(p.OverviewCard, { session: sessionFixture({ model: '', contextWindow: 0 }) })
  assert.equal(byClass(tree, 'dso-time'), undefined, '无模型不渲染徽标')
  assert.equal(byClass(tree, 'dso-feedback'), undefined, '无窗口不渲染备注')
})

test('面板：构成条按占比渲染，空构成显示占位', () => {
  const p = loadParts()
  const tree = p.harness.render(p.CompositionBar, { composition: { system: 100, tools: 60, user: 40 } })
  assert.equal(allByClass(tree, 'dso-comp-row').length, 3, '只渲染占比 > 0 的分类')
  assert.deepEqual(
    allByClassToken(tree, 'dso-comp-fill').map((el) => el.props.className),
    ['dso-comp-fill dso-comp-system', 'dso-comp-fill dso-comp-tools', 'dso-comp-fill dso-comp-user'],
  )
  assert.deepEqual(
    allByClassToken(tree, 'dso-comp-fill').map((el) => el.props.style.width),
    ['50%', '30%', '20%'],
    '宽度 = value/total 四舍五入',
  )
  assert.deepEqual(
    allByClass(tree, 'dso-comp-label').map((el) => textOf(el)),
    ['系统提示', '工具', '用户'],
  )
  const tiny = p.harness.render(p.CompositionBar, { composition: { system: 1000, tools: 1 } })
  assert.equal(allByClassToken(tiny, 'dso-comp-fill')[1].props.style.width, '2%', '最小宽度夹到 2%')

  const empty = p.harness.render(p.CompositionBar, { composition: {} })
  assert.equal(textOf(byClass(empty, 'dso-empty')), '（空）', '无构成显示占位')
})

test('面板：请求记录与列表（最新在前 + 降级占位）', () => {
  const p = loadParts()
  const request = { turn: 3, step: 2, prompt: 500, output: 50, cacheRead: 300, cacheWrite: 100, time: 0 }
  const tree = p.harness.render(p.RequestRow, { request })
  assert.equal(textOf(byClassToken(tree, 'dso-badge-llm')), '轮 3 · 步 2')
  // 命中率口径 = cacheRead / ((prompt - cacheRead - cacheWrite) + cacheRead) = 300/400
  const meta = textOf(byClass(tree, 'dso-request-meta'))
  assert.ok(meta.includes('提示 500'), `请求记录含 prompt：${meta}`)
  assert.ok(meta.includes('输出 50'), '请求记录含 output')
  assert.ok(meta.includes('KV 缓存命中率 75.0%'), `请求记录含缓存命中率：${meta}`)

  const list = p.harness.render(p.RequestList, { requests: sessionFixture().requests })
  const rows = allByClass(list, 'dso-request')
  assert.equal(rows.length, 2)
  assert.ok(textOf(byClassToken(rows[0], 'dso-badge-llm')).includes('步 2'), '最新请求排在最前')
  assert.equal(textOf(byClass(p.harness.render(p.RequestList, { requests: [] }), 'dso-empty')), '暂无请求记录')
})

test('面板：预算告警列表（scope/拦截态 + 空占位）', () => {
  const p = loadParts()
  const alerts = [
    { id: 'a1', scope: 'turn', blocked: false, used: 1200, limit: 1000, time: 0 },
    { id: 'a2', scope: 'session', blocked: true, used: 5000, limit: 4000, time: 0 },
  ]
  const tree = p.harness.render(p.AlertList, { alerts })
  assert.deepEqual(
    allByClassToken(tree, 'dso-badge-budget').map((el) => textOf(el)),
    ['每轮超限', '每会话超限'],
  )
  const nodes = allByClassToken(tree, 'dso-alert')
  assert.equal(nodes[0].props.className, 'dso-alert dso-alert-warn', '提醒用 warn 边框')
  assert.equal(nodes[1].props.className, 'dso-alert dso-alert-danger', '拦截用 danger 边框')
  assert.equal(textOf(byClass(nodes[0], 'dso-alert-msg')), '1,200 tokens / 1,000 tokens · 已提醒')
  assert.equal(textOf(byClass(nodes[1], 'dso-alert-msg')), '5,000 tokens / 4,000 tokens · 已拦截')
  assert.equal(textOf(byClass(p.harness.render(p.AlertList, { alerts: [] }), 'dso-empty')), '暂无预算告警')
})

test('面板：主面板渲染会话选择 + 各区块，状态提示按加载中/无会话降级', () => {
  const p = loadParts()
  const tree = p.harness.render(p.ContextPanel, { visible: true, scope: { sessionId: 'sess-1' } })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dso-panel')
  const select = byClass(tree, 'dso-select')
  assert.equal(select.props.value, '', '初始选中「全部会话」')
  assert.deepEqual(optionTexts(select), ['全部会话'], '无会话列表时只有默认项')
  // 初始 loading=true：提示加载中，且未渲染概览/占用/会话区块。
  assert.equal(textOf(byClass(tree, 'dso-empty')), '加载中…')
  assert.deepEqual(
    allByClass(tree, 'dso-section-title').map((el) => textOf(el)),
    ['溢出阈值', '预算'],
    '无会话时只有设置区块',
  )
})

test('面板：数据就绪后渲染概览/占用/构成/请求/告警/溢出区块', async () => {
  const fetchStub = createFetchStub((path) => {
    if (path === '/context/api/sessions') return [{ sessionId: 'sess-1' }]
    if (path === '/context/api/status') {
      return { budget: { perTurn: 0, perSession: 0, mode: 'warn' }, overflow: OVERFLOW_DEFAULT }
    }
    if (path.startsWith('/context/api/session')) {
      return sessionFixture({
        lastPromptTokens: 950,
        model: '',
        alerts: [{ id: 'a1', scope: 'turn', blocked: true, used: 1200, limit: 1000, time: 0 }],
        overflows: [{ id: 'o1', level: 'alert', used: 950, window: 1000, ratio: 0.95, threshold: 0.9, time: 0 }],
      })
    }
    return null
  })
  const p = loadParts({ fetch: fetchStub })
  const renderPanel = () => p.harness.render(p.ContextPanel, { visible: true })

  // 渲染 #1：sessionId='' → 只拉会话列表 + 状态，并自动选中第一个会话。
  renderPanel()
  p.effects[0]()
  await flush()
  // 渲染 #2：sessionId 已写入 state，effect 依赖变化 → 追加拉取单会话统计。
  renderPanel()
  p.effects[1]()
  await flush()

  const tree = renderPanel()
  assert.deepEqual(
    allByClass(tree, 'dso-section-title').map((el) => textOf(el)),
    ['上下文构成', '请求记录', '预算告警', '溢出预警', '溢出阈值', '预算'],
  )
  assert.deepEqual(
    allByClass(tree, 'dso-card-title').map((el) => textOf(el)),
    ['概览', '上下文占用'],
    '会话数据就绪后渲染概览卡与上下文占用卡',
  )
  assert.equal(byClass(tree, 'dso-empty'), undefined, '数据就绪后不再显示状态提示')
  const select = byClass(tree, 'dso-select')
  assert.equal(select.props.value, 'sess-1', '自动选中第一个会话')
  assert.deepEqual(optionTexts(select), ['全部会话', 'sess-1'])
  assert.equal(allByClassToken(tree, 'dso-badge-budget').length, 1, '预算告警区块渲染记录')
  assert.equal(textOf(allByClassToken(tree, 'dso-badge-overflow')[0]), '告警', '溢出预警区块渲染记录')
})

// ── 4. 溢出预警契约 ───────────────────────────────────────────────────

test('溢出：contextUsage 取最近一次请求 prompt，level 分级与阈值夹取', () => {
  const p = loadParts()
  assert.equal(p.contextUsage(sessionFixture({ lastPromptTokens: 700 })), 700, '优先用 lastPromptTokens')
  assert.equal(
    p.contextUsage(sessionFixture({ lastPromptTokens: 0, requests: [{ prompt: 321 }] })),
    321,
    '旧数据回退最近请求 prompt',
  )
  assert.equal(p.contextUsage({ requests: [] }), 0)
  assert.equal(p.contextUsage({ lastPromptTokens: 0, requests: [{ prompt: undefined }] }), 0)

  assert.equal(p.overflowLevelOf(0.96, OVERFLOW_DEFAULT), 'critical')
  assert.equal(p.overflowLevelOf(0.9, OVERFLOW_DEFAULT), 'alert')
  assert.equal(p.overflowLevelOf(0.8, OVERFLOW_DEFAULT), 'warn')
  assert.equal(p.overflowLevelOf(0.79, OVERFLOW_DEFAULT), 'normal')
  assert.equal(p.overflowLevelOf(0.5, { warnThreshold: 2, alertThreshold: -1 }), 'alert', '阈值夹到 [0,1]')
  assert.equal(p.overflowLevelOf(0.5, {}), 'normal', '阈值缺失回退 0.8/0.9')
  assert.equal(p.overflowLevelOf(0.5, { warnThreshold: 'x', alertThreshold: NaN }), 'normal', '非法阈值回退默认')

  const meter = p.usageMeter(sessionFixture({ lastPromptTokens: 500, contextWindow: 1000 }), OVERFLOW_DEFAULT)
  assert.deepEqual(meter, { used: 500, window: 1000, ratio: 0.5, level: 'normal' })
  assert.equal(p.usageMeter(sessionFixture({ contextWindow: 0 }), OVERFLOW_DEFAULT).ratio, 0, '无窗口 ratio=0')
  assert.equal(p.overflowLevelLabel('critical'), '严重')
  assert.equal(p.overflowLevelLabel('nope'), '正常', '未知级别回退正常')
})

test('溢出：上下文占用卡（进度条 + 徽标 + 建议卡）', () => {
  const p = loadParts()
  const session = sessionFixture({ lastPromptTokens: 950, contextWindow: 1000 })
  const tree = p.harness.render(p.ContextUsageCard, { session, overflow: OVERFLOW_DEFAULT })
  assert.equal(textOf(byClass(tree, 'dso-card-title')), '上下文占用')
  assert.equal(textOf(byClassToken(tree, 'dso-badge')), '严重', 'ratio 0.95 → critical')
  const fill = byClassToken(tree, 'dso-usage-fill')
  assert.equal(fill.props.className, 'dso-usage-fill dso-usage-critical')
  assert.equal(fill.props.style.width, '95%')
  assert.equal(textOf(byClass(tree, 'dso-usage-meta')), '950 tokens / 1,000 tokens · 已用占比 95.0%')
  const items = collect(byClass(tree, 'dso-suggest-list'))
    .filter((el) => el.type === 'li')
    .map((el) => textOf(el))
  assert.deepEqual(items, [
    '开启新会话，归档当前上下文',
    '总结/压缩历史对话后再继续',
    '查看上下文构成占比（系统提示、工具 占比最高）',
  ])
  assert.equal(textOf(byClass(tree, 'dso-suggest-title')), '建议：上下文接近上限，开启新会话')

  const unknown = p.harness.render(p.ContextUsageCard, {
    session: sessionFixture({ contextWindow: 0 }),
    overflow: OVERFLOW_DEFAULT,
  })
  assert.equal(textOf(byClass(unknown, 'dso-empty')), '上下文窗口未知')
  assert.equal(byClassToken(unknown, 'dso-usage-track'), undefined, '无窗口不渲染进度条')
})

test('溢出：normal 级别不出建议卡；无构成时只出两条通用建议', () => {
  const p = loadParts()
  const normal = p.harness.render(p.CompressSuggestions, {
    meter: { used: 100, window: 1000, ratio: 0.1, level: 'normal' },
    session: sessionFixture(),
  })
  assert.equal(normal, null, '正常级别不显示建议卡')

  const warn = p.harness.render(p.CompressSuggestions, {
    meter: { used: 850, window: 1000, ratio: 0.85, level: 'warn' },
    session: sessionFixture({ composition: {} }),
  })
  assert.deepEqual(
    collect(byClass(warn, 'dso-suggest-list'))
      .filter((el) => el.type === 'li')
      .map((el) => textOf(el)),
    ['开启新会话，归档当前上下文', '总结/压缩历史对话后再继续'],
  )
  assert.equal(textOf(byClass(warn, 'dso-suggest-title')), '建议：留意上下文占用')
})

test('溢出：预警记录列表（最新在前 + 级别徽标 + 阈值文案）', () => {
  const p = loadParts()
  const empty = p.harness.render(p.OverflowList, { overflows: [] })
  assert.equal(textOf(byClass(empty, 'dso-empty')), '暂无溢出预警')

  const overflows = [
    { id: 'o1', level: 'warn', used: 850, window: 1000, ratio: 0.85, threshold: 0.8, time: 0 },
    { id: 'o2', level: 'critical', used: 970, window: 1000, ratio: 0.97, threshold: 0.9, time: 0 },
  ]
  const tree = p.harness.render(p.OverflowList, { overflows })
  const nodes = allByClassToken(tree, 'dso-alert')
  assert.equal(nodes.length, 2)
  assert.equal(textOf(allByClassToken(tree, 'dso-badge-overflow')[0]), '严重', '最新记录排在最前')
  assert.equal(nodes[0].props.className, 'dso-alert dso-alert-danger', 'critical → danger 边框')
  assert.equal(nodes[1].props.className, 'dso-alert dso-alert-warn')
  assert.equal(textOf(byClass(nodes[0], 'dso-alert-msg')), '970 tokens / 1,000 tokens · 已用占比 97.0% · 阈值 90%')

  const section = p.harness.render(p.OverflowSection, { overflows })
  assert.equal(textOf(byClass(section, 'dso-section-title')), '溢出预警')
})

test('溢出：阈值设置保存（POST /context/api/overflow，百分比 ↔ 小数）', async () => {
  const fetchStub = createFetchStub(() => ({ warnThreshold: 0.7, alertThreshold: 0.85 }))
  const p = loadParts({ fetch: fetchStub })
  let saved = 0
  const render = () => p.harness.render(p.OverflowSettings, { overflow: OVERFLOW_DEFAULT, onSaved: () => (saved += 1) })

  const tree = render()
  const inputs = allByClassToken(tree, 'dso-budget-input')
  assert.equal(inputs.length, 2, '预警/告警两个阈值输入')
  assert.deepEqual(
    inputs.map((el) => el.props.value),
    ['80', '90'],
    '初始值 = 阈值 × 100',
  )
  assert.deepEqual(
    allByClass(tree, 'dso-time').map((el) => textOf(el)),
    ['预警阈值', '告警阈值'],
  )

  inputs[0].props.onChange({ target: { value: '70' } })
  inputs[1].props.onChange({ target: { value: '85' } })
  buttonByText(render(), '保存').props.onClick()
  await flush()

  assert.equal(fetchStub.calls.length, 1)
  assert.equal(fetchStub.calls[0].path, '/context/api/overflow')
  assert.equal(fetchStub.calls[0].options.method, 'POST')
  assert.equal(fetchStub.calls[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(fetchStub.calls[0].options.body), { warnThreshold: 0.7, alertThreshold: 0.85 })
  assert.equal(textOf(byClass(render(), 'dso-feedback')), '已保存', '保存成功反馈')
  assert.equal(saved, 1, '保存成功后回调 onSaved')
})

test('溢出：阈值保存失败显示错误反馈', async () => {
  const p = loadParts({ fetch: createFetchStub(() => new Error('boom')) })
  const render = () => p.harness.render(p.OverflowSettings, { overflow: OVERFLOW_DEFAULT, onSaved: () => {} })
  buttonByText(render(), '保存').props.onClick()
  await flush()
  assert.equal(textOf(byClass(render(), 'dso-feedback')), '保存失败：boom')
})

// ── 5. 预算设置契约 ───────────────────────────────────────────────────

test('预算：设置保存（POST /context/api/budget，含模式）与空值归零', async () => {
  const fetchStub = createFetchStub(() => ({ perTurn: 5000, perSession: 0, mode: 'deny' }))
  const p = loadParts({ fetch: fetchStub })
  let saved = 0
  const render = () =>
    p.harness.render(p.BudgetSettings, {
      budget: { perTurn: 1000, perSession: 0, mode: 'warn' },
      onSaved: () => (saved += 1),
    })

  const tree = render()
  const inputs = allByClassToken(tree, 'dso-budget-input')
  assert.deepEqual(
    inputs.map((el) => el.props.value),
    ['1000', '0'],
    '初始值来自 budget',
  )
  assert.equal(inputs[0].props.placeholder, '不限制', '0 → 不限制占位')
  assert.deepEqual(
    allByClass(tree, 'dso-time').map((el) => textOf(el)),
    ['每轮上限', '每会话上限'],
  )
  const select = byClassToken(tree, 'dso-budget-mode')
  assert.equal(select.props.value, 'warn')
  assert.deepEqual(
    collect(select)
      .filter((el) => el.type === 'option')
      .map((el) => el.props.value),
    ['warn', 'deny'],
  )

  inputs[0].props.onChange({ target: { value: '5000' } })
  inputs[1].props.onChange({ target: { value: '' } })
  byClassToken(render(), 'dso-budget-mode').props.onChange({ target: { value: 'deny' } })
  buttonByText(render(), '保存').props.onClick()
  await flush()

  assert.equal(fetchStub.calls[0].path, '/context/api/budget')
  assert.equal(fetchStub.calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(fetchStub.calls[0].options.body), { perTurn: 5000, perSession: 0, mode: 'deny' })
  assert.equal(textOf(byClass(render(), 'dso-feedback')), '已保存')
  assert.equal(saved, 1)
})

// ── 6. 样式注入契约 ───────────────────────────────────────────────────

test('样式：无 document 时降级为 noop，有 document 时注入并可 teardown', () => {
  const p = loadParts()
  const noop = p.injectStyles()
  assert.equal(typeof noop, 'function', '无 document 仍返回 disposer')
  assert.doesNotThrow(() => noop())

  const documentStub = createDocumentStub()
  const p2 = loadParts({ document: documentStub })
  const dispose = p2.injectStyles()
  assert.equal(documentStub.appended.length, 1, '注入一个 style 元素')
  const style = documentStub.appended[0]
  assert.equal(style.tag, 'style')
  assert.equal(style.attributes['data-dsh-my-context'], 'styles', '标记属性用于清理/排查')
  assert.equal(style.textContent, p2.STYLES, 'style 内容 = STYLES 常量')
  assert.ok(p2.STYLES.includes('.dso-usage-fill'), '溢出进度条样式在片段内')
  assert.ok(p2.STYLES.includes('.dso-overflow-alert'), '溢出级别徽标样式在片段内')
  assert.ok(p2.STYLES.includes('--dsw-alias-label-primary'), '使用 DSH 语义 token')
  dispose()
  assert.equal(documentStub.appended.length, 0, 'teardown 移除注入的 style')
  assert.doesNotThrow(() => dispose(), '重复 teardown 不抛错')
})

// ── 7. 数据拉取与轮询契约 ─────────────────────────────────────────────

test('数据拉取：loadContextData 依次拉会话列表/状态/当前会话统计', async () => {
  const fetchStub = createFetchStub((path) => {
    if (path === '/context/api/sessions') return [{ sessionId: 'a' }, { sessionId: 'b' }]
    if (path === '/context/api/status') return { budget: { perTurn: 1, perSession: 2, mode: 'deny' } }
    if (path.startsWith('/context/api/session')) return sessionFixture({ sessionId: 'a' })
    return null
  })
  const p = loadParts({ fetch: fetchStub })
  const seen = {}
  const setters = {
    setSessions: (v) => (seen.sessions = v),
    setSessionId: (v) => (seen.sessionId = v),
    setSession: (v) => (seen.session = v),
    setBudget: (v) => (seen.budget = v),
    setOverflow: (v) => (seen.overflow = v),
    setError: (v) => (seen.error = v),
    setLoading: (v) => (seen.loading = v),
  }

  // sessionId='' → 不拉单会话统计，且自动选中列表首项。
  await p.loadContextData('', setters)
  assert.deepEqual(seen.sessions, [{ sessionId: 'a' }, { sessionId: 'b' }])
  assert.equal(seen.sessionId, 'a', '空选择时自动选中第一个会话')
  assert.deepEqual(seen.budget, { perTurn: 1, perSession: 2, mode: 'deny' })
  assert.deepEqual(seen.overflow, OVERFLOW_DEFAULT, 'status 无 overflow 时回退默认阈值')
  assert.deepEqual(
    fetchStub.calls.map((c) => c.path),
    ['/context/api/sessions', '/context/api/status'],
  )

  // 指定会话 → 追加拉取单会话统计（sessionId 需 URL 编码）。
  await p.loadContextData('a b', setters)
  assert.equal(fetchStub.calls.at(-1).path, '/context/api/session?sessionId=a%20b')
  assert.equal(seen.session.sessionId, 'a')
})

test('数据拉取：apiJson 非 2xx 抛服务端错误信息', async () => {
  const p = loadParts({ fetch: createFetchStub(() => new Error('上下文不可用')) })
  await assert.rejects(() => p.apiJson('/context/api/status'), /上下文不可用/)

  const statusOnly = (status) => () => Promise.resolve({ ok: false, status, json: async () => ({}) })
  const p2 = loadParts({ fetch: statusOnly(503) })
  await assert.rejects(() => p2.apiJson('/context/api/status'), /HTTP 503/, '无 error.message 时回退 HTTP 状态码')
})

test('轮询：visible=false 不注册轮询，visible=true 按 CONTEXT_POLL_MS 拉数据并可 teardown', async () => {
  const fetchStub = createFetchStub((path) => (path === '/context/api/sessions' ? [] : { budget: {}, overflow: {} }))
  const p = loadParts({ fetch: fetchStub })
  assert.equal(p.CONTEXT_POLL_MS, 5000)

  p.harness.render(p.ContextPanel, { visible: false })
  assert.equal(p.effects.length, 1, '隐藏时也注册 effect（依赖 visible）')
  assert.equal(p.effects[0](), undefined, '隐藏时 effect 不返回 cleanup')
  assert.equal(p.timers.length, 0, '隐藏时不注册轮询（省请求）')

  const p2 = loadParts({ fetch: fetchStub })
  p2.harness.render(p2.ContextPanel, { visible: true })
  const cleanup = p2.effects[0]()
  assert.equal(p2.timers.length, 1, '可见时注册轮询定时器')
  assert.equal(p2.timers[0].ms, 5000)
  assert.equal(typeof cleanup, 'function', 'effect 返回 cleanup')
  await flush()
  assert.deepEqual(
    fetchStub.calls.map((c) => c.path).slice(0, 2),
    ['/context/api/sessions', '/context/api/status'],
    '首次 tick 立即拉数据',
  )
  cleanup()
  assert.deepEqual(p2.cleared, [1], 'teardown 清理定时器')
})

// ── 8. bundle 组装契约（__ModuleLoader__ + 页签注册）────────────────────

test('bundle 契约：__ModuleLoader__ 加载后注册页签，标题跟随语言', () => {
  const seen = {}
  const windowMock = { __ModuleLoader__: { load: (def) => (seen.def = def) } }
  new Function('window', read('../lib/client.js'))(windowMock)
  assert.equal(seen.def.id, 'dsh-my-context')

  const reactStub = { createElement, useState: (initial) => [initial, () => {}], useEffect: () => undefined }
  const exports = seen.def.factory((name) => {
    assert.equal(name, 'react')
    return reactStub
  })
  assert.deepEqual(exports.inject, ['betterSidebar'])

  const labels = []
  const tabs = []
  const ctx = {
    effect(fn, label) {
      labels.push(label)
      return fn()
    },
    betterSidebar: {
      registerTab(def) {
        tabs.push(def)
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(labels, ['dsh-my-context: styles', 'dsh-my-context: context tab registration'])
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-my-context:context')
  assert.equal(tabs[0].order, 43)
  assert.equal(tabs[0].single, true)
  assert.equal(
    withNavigator('zh-CN', () => tabs[0].title()),
    '上下文透镜',
    '标题跟随浏览器语言（中文）',
  )
  assert.equal(
    withNavigator('en-US', () => tabs[0].title()),
    'Context',
    '标题跟随浏览器语言（英文）',
  )
  const element = tabs[0].component({ visible: true })
  assert.equal(typeof element.type, 'function', '页签组件为 ContextPanel 工厂')
  assert.equal(element.type(element.props).props.className, 'dso-panel')

  // 无 betterSidebar 服务时只注入样式，不抛错（服务未就绪的降级路径）。
  assert.doesNotThrow(() => exports.apply({ effect: (fn) => fn() }))
})
