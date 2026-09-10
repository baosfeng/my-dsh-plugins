/**
 * dsh-my-guard — client 端构建契约 + 行为契约。
 *
 * 两类契约：
 *
 * 1. **构建契约**（TS升级规范 6.2 源码/产物同步）：
 *    - 提交进仓库的 `lib/client.js` 必须**逐字节**等于 `lib/client.src.js` 模板
 *      拼接 `lib/parts/*.js` 片段的结果 —— 只改产物不改模板/片段（或反之）
 *      立即失败（历史坑：只改产物，下次构建即丢失）；
 *    - 产物零未解析 `__PART_*__` 占位符；
 *    - 每个已发布片段都对应 `src/client/parts/<name>.ts`，且二者顶层声明
 *      （function/const 名）一致 —— 只改 `lib/parts/*.js` 不改 TS 源码会被抓住
 *      （产物是 tsc 输出，TS 源码才是唯一真源）；
 *    - 片段不得出现 import/export（DSH 浏览器 ModuleLoader 不支持 factory 内
 *      相对路径 require，必须拼成单 bundle）；
 *    - 拼接顺序锁定（pieces 顺序有跨片段引用依赖，见 scripts/build.mjs）。
 *
 * 2. **client 行为契约**——本插件的 client 端此前**零测试覆盖**（9 个测试文件
 *    无一引用 client），浏览器渲染/交互路径完全裸奔。本套件在真实产物
 *    （`lib/client.js`，仅把末尾 `return module.exports` 换成暴露内部符号的
 *    return，见「夹具保真」用例）上以 stub react + 迷你 hooks 运行时 +
 *    DOM/fetch/定时器桩，覆盖：
 *    - 渲染路径：主面板（告警行/徽标/元信息/详情）、工具区块、规则面板；
 *    - 交互路径：自定义规则增/删/改、通知开关与冷却输入、保存回传体、
 *      告警确认、重试、扫描/检测/规则测试的请求与分支；
 *    - 状态徽标：类型徽标（danger/warn/info）、严重度徽标随数据变化，
 *      loading/empty/error/confirmed 状态切换；
 *    - i18n：zh/en 两套文案 + 未知语言回退英文 + navigator 缺失回退；
 *    - 样式注入：单次激活注入一个 <style>、teardown 卸载、重复激活无残留；
 *    - 轮询：可见时轮询（GUARD_POLL_MS）、隐藏时暂停、卸载后停止。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

/** build.mjs 的 pieces（顺序即拼接顺序，与 scripts/build.mjs 保持一致）。 */
const PIECES = [
  ['/*__PART_I18N__*/', 'lib/parts/i18n.js'],
  ['/*__PART_ICONS__*/', '../dsh-shared/client-parts/icons.part.js'],
  ['/*__PART_PANEL__*/', 'lib/parts/panel.js'],
  ['/*__PART_STATES__*/', 'lib/parts/states.js'],
  ['/*__PART_RULES__*/', 'lib/parts/rules-panel.js'],
  ['/*__PART_STYLES__*/', 'lib/parts/styles.js'],
]

/** 本插件自己的片段（icons 为 dsh-shared 共享片段，无本插件 TS 源码）。 */
const OWN_PARTS = PIECES.filter(([, file]) => file.startsWith('lib/parts/')).map(([, file]) =>
  file.replace('lib/parts/', '').replace('.js', ''),
)

/** 片段顶层声明名（function foo / const foo），用于锁定「产物来自 TS 源码」。 */
function topLevelDecls(src) {
  return [...src.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/gm)]
    .map((m) => m[1] ?? m[2])
    .sort()
}

// ══ 1. 构建契约 ═══════════════════════════════════════════════════════════

test('构建契约：lib/client.js 必须逐字节等于 client.src.js 模板 + lib/parts/*.js 片段拼接结果', () => {
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

test('构建契约：产物零未解析占位符，且每个片段都有对应 TS 源码（迁移口径）', () => {
  const bundle = read('../lib/client.js')
  assert.ok(!bundle.includes('/*__PART_'), 'lib/client.js 里仍有未解析的 __PART_*__ 占位符')
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
    assert.ok(/^(?:function|const)\s/m.test(ts), `${name}.ts 应为纯声明片段`)
  }
  assert.deepEqual(OWN_PARTS.slice().sort(), ['i18n', 'panel', 'rules-panel', 'states', 'styles'])
})

test('构建契约：拼接顺序锁定（pieces 顺序有跨片段引用依赖，不可调整）', () => {
  const buildSrc = read('../scripts/build.mjs')
  const declared = [...buildSrc.matchAll(/\['(\/\*__PART_[A-Z0-9_]+__\*\/)', '([^']+)'/g)].map((m) => [
    m[1],
    m[2] === 'icons.part' ? '../dsh-shared/client-parts/icons.part.js' : `lib/parts/${m[2]}.js`,
  ])
  assert.deepEqual(declared, PIECES, 'scripts/build.mjs 的 pieces 顺序/命名必须与本契约一致')
  assert.ok(
    buildSrc.includes("'icons.part', { shared: true }"),
    '共享图标片段必须以 { shared: true } 按文件系统路径读取',
  )
})

// ══ 2. client 端运行时夹具 ════════════════════════════════════════════════

/** stub react：元素树语义与 React 一致（单 child 直接赋值、多 child 组数组）。 */
function createElement(type, props, ...children) {
  const p = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { type, props: p }
}

/** 迷你 hooks 运行时：按组件类型分配状态槽，支持多轮「渲染」+ 依赖感知 effect。 */
function createHarness() {
  const slots = new Map()
  let active = null
  const slotFor = (key) => {
    let slot = slots.get(key)
    if (!slot) {
      slot = { states: [], effects: [], sc: 0, ec: 0 }
      slots.set(key, slot)
    }
    return slot
  }
  const useState = (initial) => {
    // 捕获当前渲染的槽位：setState 可能在渲染结束后（await 之后）才被调用，
    // 此时 active 已被还原，不能依赖它。
    const slot = active
    const i = slot.sc
    slot.sc += 1
    if (!(i in slot.states)) slot.states[i] = typeof initial === 'function' ? initial() : initial
    return [
      slot.states[i],
      (next) => {
        slot.states[i] = typeof next === 'function' ? next(slot.states[i]) : next
      },
    ]
  }
  const useEffect = (fn, deps) => {
    const slot = active
    const i = slot.ec
    slot.ec += 1
    const prev = slot.effects[i]
    const changed =
      !prev ||
      !deps ||
      !prev.deps ||
      deps.length !== prev.deps.length ||
      deps.some((d, k) => !Object.is(d, prev.deps[k]))
    if (!changed) return
    if (prev?.cleanup) prev.cleanup()
    const cleanup = fn()
    slot.effects[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  }
  const invoke = (type, props) => {
    const prev = active
    const slot = slotFor(type)
    slot.sc = 0
    slot.ec = 0
    active = slot
    try {
      return type(props)
    } finally {
      active = prev
    }
  }
  return { useState, useEffect, invoke, effectCleanup: (type, i) => slotFor(type).effects[i]?.cleanup }
}

/** 展开元素树：函数式组件各调用一次，children 递归展开（此后断言不再触碰 hooks）。 */
function expand(node, harness) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child) => expand(child, harness))
  const el = typeof node.type === 'function' ? harness.invoke(node.type, node.props) : node
  if (el === null || el === undefined || typeof el !== 'object') return el
  return { type: el.type, props: { ...el.props, children: expand(el.props?.children, harness) } }
}

/** 展开树里的全部元素节点。 */
function flat(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) flat(child, out)
    return out
  }
  out.push(node)
  flat(node.props?.children, out)
  return out
}

/** 元素子树的全部文本叶子拼接。 */
function deepText(node) {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(deepText).join('')
  return deepText(node.props?.children)
}

const classOf = (el) => String(el.props?.className ?? '')
const hasClass = (el, cls) => classOf(el).split(/\s+/).includes(cls)
const allByClass = (tree, cls) => flat(tree).filter((el) => hasClass(el, cls))
const byClass = (tree, cls) => allByClass(tree, cls)[0]
const buttonByText = (tree, label) => flat(tree).find((el) => el.type === 'button' && deepText(el) === label)
const byAria = (tree, label) => flat(tree).find((el) => el.props?.['aria-label'] === label)

/** 最小 DOM 桩：只提供 injectStyles 用到的 createElement/head/append/remove。 */
function createDom() {
  const nodes = []
  const head = {
    appendChild(node) {
      nodes.push(node)
      node.parentNode = head
      return node
    },
    removeChild(node) {
      const i = nodes.indexOf(node)
      if (i !== -1) nodes.splice(i, 1)
      node.parentNode = null
    },
  }
  return {
    head,
    nodes,
    createElement(tag) {
      return {
        tagName: tag,
        attrs: {},
        textContent: '',
        parentNode: null,
        setAttribute(k, v) {
          this.attrs[k] = v
        },
      }
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// ── 夹具：加载真实产物 lib/client.js，末尾 return 暴露内部符号 ──────────────
const BUNDLE = read('../lib/client.js')
const EXPOSE = [
  'strings',
  'isZh',
  'STYLES',
  'injectStyles',
  'busyState',
  'errorFeedback',
  'cleanFeedback',
  'confirmedBadge',
  'issueRow',
  'LoadingState',
  'EmptyState',
  'ErrorState',
  'GUARD_POLL_MS',
  'apiJson',
  'timeText',
  'alertTypeLabel',
  'severityLabel',
  'alertKind',
  'alertTypeIcon',
  'AlertMeta',
  'AlertDetails',
  'AlertRow',
  'shortSessionId',
  'loadAlerts',
  'confirmAlert',
  'ScanResult',
  'runScan',
  'ScanTool',
  'PromptResult',
  'PromptTool',
  'GuardPanel',
  'modeLabel',
  'ruleSourceLabel',
  'RuleEntry',
  'RuleTestResult',
  'RuleTest',
  'RuleSettings',
  'ruleSettingsView',
]
const EXPOSED_RETURN = `return Object.assign(module.exports, { __t: { ${EXPOSE.join(', ')} } })`
const EXPOSED_BUNDLE = BUNDLE.replace('return module.exports', EXPOSED_RETURN)
let REGISTRATION = null

/**
 * 启动一个隔离的 client 运行时：stub react + hooks 运行时 + DOM/fetch/定时器桩，
 * 加载产物 bundle 并通过 betterSidebar 注册拿到 exports。
 * `language: null` 表示不提供 navigator（测 i18n 的异常回退分支）。
 */
function boot({ language = 'zh-CN', withDocument = true, fetch: fetchImpl } = {}) {
  const harness = createHarness()
  const dom = withDocument ? createDom() : undefined
  const react = { createElement, useState: harness.useState, useEffect: harness.useEffect }
  const intervals = []
  const clearedIntervals = []
  const fetchCalls = []

  globalThis.window = {
    __ModuleLoader__: {
      load: (registration) => {
        REGISTRATION = registration
      },
    },
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: language === null ? undefined : { language },
    configurable: true,
  })
  if (dom) globalThis.document = dom
  else delete globalThis.document
  globalThis.setInterval = (fn, ms) => {
    const id = { fn, ms }
    intervals.push(id)
    return id
  }
  globalThis.clearInterval = (id) => {
    clearedIntervals.push(id)
  }
  globalThis.fetch = (path, init) => {
    fetchCalls.push({ path, init })
    const res = fetchImpl ? fetchImpl(path, init) : { ok: true, json: async () => ({ value: undefined }) }
    return Promise.resolve(res)
  }

  new Function('window', EXPOSED_BUNDLE)(globalThis.window)
  assert.ok(REGISTRATION, 'bundle 必须调用 window.__ModuleLoader__.load 注册自己')
  const api = REGISTRATION.factory((spec) => {
    if (spec === 'react') return react
    throw new Error('unexpected require: ' + spec)
  })
  return {
    api,
    internals: api.__t,
    harness,
    dom,
    intervals,
    clearedIntervals,
    fetchCalls,
    render: (component, props) => expand(harness.invoke(component, props), harness),
  }
}

/** 构造一个成功的插件 API 响应（apiJson 取 value 字段）。 */
const okValue = (value) => ({ ok: true, json: async () => ({ value }) })
/** 构造一个失败的插件 API 响应（apiJson 抛 data.error.message）。 */
const errValue = (message, status = 500) => ({ ok: false, status, json: async () => ({ error: { message } }) })

/** 主面板会连带渲染子区块（规则面板自己会拉一次 /guard/api/rules），
 *  因此与告警轮询相关的断言只统计告警接口的调用。 */
const alertCalls = (env) => env.fetchCalls.filter((call) => call.path.startsWith('/guard/api/alerts'))

test('夹具保真：暴露内部符号只改动了 bundle 末尾的 return 语句', () => {
  assert.notEqual(EXPOSED_BUNDLE, BUNDLE, '夹具必须真的替换了末尾 return')
  assert.equal(
    EXPOSED_BUNDLE.replace(EXPOSED_RETURN, 'return module.exports'),
    BUNDLE,
    '除末尾 return 外必须逐字节相同',
  )
})

// ══ 3. 插件体：样式注入 + 页签注册 ════════════════════════════════════════

test('client 插件体：apply 注册「安全护栏」页签并注入样式，teardown 双清理（HMR 无残留）', () => {
  const env = boot()
  const cleanups = []
  let tab = null
  let tabDisposed = false
  const ctx = {
    effect: (fn, label) => {
      cleanups.push({ label, cleanup: fn() })
    },
    betterSidebar: {
      registerTab: (descriptor) => {
        tab = descriptor
        return () => {
          tabDisposed = true
        }
      },
    },
  }

  assert.deepEqual(env.api.inject, ['betterSidebar'])
  env.api.apply(ctx)

  // 页签注册
  assert.equal(tab.id, 'dsh-my-guard:guard')
  assert.equal(tab.order, 42)
  assert.equal(tab.single, true)
  assert.equal(tab.title(), '安全护栏', '标题惰性求值，跟随语言')
  assert.equal(tab.component({ visible: true }).type, env.internals.GuardPanel, 'component 接主面板')
  assert.equal(cleanups.length, 2, '样式与页签各注册一个 effect')

  // 样式注入：一次激活恰好一个 <style>，带标识属性，内容即 STYLES
  assert.equal(env.dom.nodes.length, 1)
  assert.equal(env.dom.nodes[0].tagName, 'style')
  assert.equal(env.dom.nodes[0].attrs['data-dsh-my-guard'], 'styles')
  assert.equal(env.dom.nodes[0].textContent, env.internals.STYLES)

  // teardown：样式节点卸载 + 页签注销
  for (const { cleanup } of cleanups) cleanup()
  assert.equal(env.dom.nodes.length, 0, 'teardown 后无样式残留')
  assert.ok(tabDisposed, 'teardown 注销页签')
  assert.doesNotThrow(() => cleanups[0].cleanup(), '重复 teardown 安全')
  assert.equal(env.dom.nodes.length, 0)

  // 重新激活（HMR/重新启用）后仍只有一个样式节点
  env.api.apply(ctx)
  assert.equal(env.dom.nodes.length, 1, '重复激活不叠加样式')
})

test('client 插件体：betterSidebar 缺失时只注入样式不抛错；无 document 时样式注入降级为空操作', () => {
  const env = boot()
  assert.doesNotThrow(() => env.api.apply({ effect: (fn) => fn(), betterSidebar: undefined }))
  assert.equal(env.dom.nodes.length, 1)

  const headless = boot({ withDocument: false })
  const cleanup = headless.internals.injectStyles()
  assert.equal(typeof cleanup, 'function')
  assert.doesNotThrow(() => cleanup())
})

test('styles：语义 token 样式表契约（关键选择器/视觉类别族/keyframes 齐备，无 !important、无跨插件前缀）', () => {
  const { STYLES } = boot().internals
  const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(STYLES.length > 1000, '样式表不应为空壳')

  // 走 DSH 语义 token（不写死颜色），且不使用 !important
  assert.ok(css.includes('var(--dsw-alias-'), '样式必须走 DSH 语义 token')
  assert.ok(css.includes('var(--dsw-font-'), '字体走 DSH token')
  assert.ok(!css.includes('!important'), '不使用 !important，覆盖一律靠选择器结构')

  // issue #54：前缀隔离——不得出现其他插件类名或全局子串选择器
  assert.ok(!/\.dsh-my-(?!guard-)/.test(css), '样式表不得出现其他插件的类名前缀（会跨插件误伤）')
  assert.ok(!/\[class\*="/.test(css), '不得使用全局子串选择器（会误伤宿主元素）')

  // 花括号配对 + 动画定义（改了动画参数就是视觉回归）
  assert.equal((css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length, 'CSS 花括号必须配对')
  assert.ok(css.includes('@keyframes dsh-my-guard-spin'), '缺少加载旋转动画')
  assert.ok(css.includes('@keyframes dsh-my-guard-row-in'), '缺少告警入场动画')
  assert.ok(css.includes('rotate(360deg)'), '旋转动画必须为整圈')
  assert.ok(css.includes('translateY(1px)'), '入场动画位移')

  // 关键选择器（面板/告警卡片/按钮/输入/规则区/三态区）
  for (const selector of [
    '.dsh-my-guard-panel{',
    '.dsh-my-guard-timeline{',
    '.dsh-my-guard-alert{',
    '.dsh-my-guard-alert-msg{',
    '.dsh-my-guard-alert-meta{',
    '.dsh-my-guard-alert-explain{',
    '.dsh-my-guard-alert-snippet{',
    '.dsh-my-guard-alert-hint{',
    '.dsh-my-guard-alert-actions{',
    '.dsh-my-guard-btn{',
    '.dsh-my-guard-btn-primary{',
    '.dsh-my-guard-btn-confirm{',
    '.dsh-my-guard-iconbtn{',
    '.dsh-my-guard-input{',
    '.dsh-my-guard-textarea{',
    '.dsh-my-guard-feedback{',
    '.dsh-my-guard-feedback-ok{',
    '.dsh-my-guard-feedback-error{',
    '.dsh-my-guard-issue{',
    '.dsh-my-guard-state{',
    '.dsh-my-guard-empty{',
    '.dsh-my-guard-empty-hint{',
    '.dsh-my-guard-error{',
    '.dsh-my-guard-section{',
    '.dsh-my-guard-section-title{',
    '.dsh-my-guard-rule-row{',
    '.dsh-my-guard-rule-list{',
    '.dsh-my-guard-rules-section{',
    '.dsh-my-guard-check{',
    '.dsh-my-guard-cooldown-input{',
    '.dsh-my-guard-notify-row{',
    '.dsh-my-guard-notify-hint{',
    '.dsh-my-guard-effective{',
  ]) {
    assert.ok(css.includes(selector), `样式表缺少关键选择器 ${selector}`)
  }

  // 视觉类别族必须成套：类型徽标/图标按告警类型切换，严重度徽标按严重度切换
  for (const [prefix, variants] of [
    ['dsh-my-guard-badge', ['danger', 'warn', 'info']],
    ['dsh-my-guard-icon', ['danger', 'warn', 'info']],
    ['dsh-my-guard-sev', ['high', 'medium', 'low']],
    ['dsh-my-guard-issue', ['high', 'medium', 'low']],
  ]) {
    for (const variant of variants) {
      assert.ok(css.includes(`.${prefix}-${variant}`), `样式表缺少视觉类别 .${prefix}-${variant}`)
    }
  }
})

// ══ 4. i18n 文案与回退 ═══════════════════════════════════════════════════

test('i18n：中文文案', () => {
  const { strings } = boot({ language: 'zh-CN' }).internals
  assert.equal(strings.tabTitle(), '安全护栏')
  assert.equal(strings.alertsTitle(), '告警记录')
  assert.equal(strings.scanTitle(), '投毒扫描')
  assert.equal(strings.promptTitle(), '提示注入检测')
  assert.ok(strings.emptyAlerts().startsWith('暂无告警'))
  assert.ok(strings.emptyAlertsHint().includes('护栏会在这里生成告警'))
  assert.equal(strings.typeDestructive(), '破坏性命令')
  assert.equal(strings.typePoison(), '投毒扫描')
  assert.equal(strings.typeInjection(), '提示注入')
  assert.equal(strings.sevHigh(), '高')
  assert.equal(strings.sevMedium(), '中')
  assert.equal(strings.sevLow(), '低')
  assert.equal(strings.confirm(), '确认')
  assert.equal(strings.confirmAria(), '确认此告警')
  assert.equal(strings.confirmed(), '已确认')
  assert.equal(strings.scanClean(), '未发现可疑内容')
  assert.equal(strings.checkClean(), '未命中注入规则')
  assert.equal(strings.noTarget(), '请输入包名或路径')
  assert.equal(strings.noText(), '请输入要检测的文本')
  assert.equal(strings.noCommand(), '请输入命令')
  assert.equal(strings.findings(3), '3 个发现项')
  assert.equal(strings.checkHits(2), '命中 2 条规则')
  assert.equal(strings.sessionShort('abc12345'), '会话 abc12345')
  assert.equal(strings.droppedRule(2), '已保存 2 条，丢弃 2 条非法规则（正则无效/缺 pattern）')
  assert.equal(strings.saveRulesOk(), '规则已保存（已生效）')
  assert.equal(strings.emptyRules(), '暂无自定义规则——点击「添加规则」创建')
  assert.equal(strings.ruleHitSource('builtin'), '内置', '内置规则显示「内置」')
  assert.equal(strings.ruleHitSource('custom'), '自定义', '非内置一律显示「自定义」')
  assert.equal(strings.modeObserve(), '观察（只告警）')
  assert.equal(strings.modeAsk(), '确认（审批）')
  assert.equal(strings.modeDeny(), '拦截')
})

test('i18n：英文文案 + 未知语言/缺失 navigator 回退英文', () => {
  const en = boot({ language: 'en-US' }).internals
  assert.equal(en.isZh(), false)
  assert.equal(en.strings.tabTitle(), 'Guard')
  assert.equal(en.strings.alertsTitle(), 'Alerts')
  assert.equal(en.strings.scanTitle(), 'Poison scan')
  assert.equal(en.strings.promptTitle(), 'Injection check')
  assert.equal(en.strings.sevHigh(), 'high')
  assert.equal(en.strings.sevLow(), 'low')
  assert.equal(en.strings.confirm(), 'Confirm')
  assert.equal(en.strings.findings(2), '2 finding(s)')
  assert.equal(en.strings.checkHits(1), '1 rule(s) hit')
  assert.equal(en.strings.sessionShort('abc'), 'session abc')
  assert.equal(en.strings.scanClean(), 'No suspicious content found')
  assert.equal(en.strings.emptyRules(), 'No custom rules — click "Add rule" to create one')
  assert.equal(en.strings.droppedRule(2), 'Saved, 2 invalid rule(s) dropped')
  assert.equal(en.strings.ruleHitSource('builtin'), 'builtin', '英文下规则来源原样回显')

  // 非 zh 语言（如 fr）与 navigator 缺失都回退英文，且不抛异常
  for (const language of ['fr-FR', null]) {
    const other = boot({ language }).internals
    assert.equal(other.isZh(), false, `language=${language} 应回退英文`)
    assert.equal(other.strings.tabTitle(), 'Guard')
  }
})

// ══ 5. 状态与徽标（states）═══════════════════════════════════════════════

test('states：loading/空/错误/已确认/发现项各状态的元素与文案', () => {
  const env = boot()
  const { internals: t, harness } = env
  const render = (component, props) => expand(harness.invoke(component, props), harness)

  // busy 状态行
  const busy = t.busyState('扫描中…')
  assert.equal(busy.props.className, 'dsh-my-guard-state')
  assert.equal(deepText(busy).includes('扫描中…'), true)

  // 干净结果反馈
  const clean = t.cleanFeedback('未发现可疑内容')
  assert.ok(hasClass(clean, 'dsh-my-guard-feedback-ok'))
  assert.ok(deepText(clean).includes('未发现可疑内容'))

  // 错误反馈
  const bad = t.errorFeedback('扫描失败：boom')
  assert.ok(hasClass(bad, 'dsh-my-guard-feedback-error'))
  assert.equal(deepText(bad), '扫描失败：boom')

  // 已确认徽标
  assert.equal(t.confirmedBadge().props.className, 'dsh-my-guard-alert-confirmed')
  assert.equal(deepText(t.confirmedBadge()), '已确认')

  // 发现项行：严重度决定 class + 徽标文案
  const high = t.issueRow({ severity: 'high', message: '危险脚本' }, 0, '/tmp/a · install')
  assert.ok(hasClass(high, 'dsh-my-guard-issue-high'))
  assert.equal(deepText(byClass(high, 'dsh-my-guard-issue-sev')), '高')
  assert.equal(deepText(byClass(high, 'dsh-my-guard-issue-msg')), '危险脚本')
  assert.equal(deepText(byClass(high, 'dsh-my-guard-issue-rule')), '/tmp/a · install')
  const medium = t.issueRow({ severity: 'medium', message: 'm' }, 1, 'r')
  assert.ok(hasClass(medium, 'dsh-my-guard-issue-medium'))
  assert.equal(deepText(byClass(medium, 'dsh-my-guard-issue-sev')), '中')
  const unknown = t.issueRow({ severity: 'weird', message: 'm' }, 2, 'r')
  // class 直接内插原始严重度（未知值原样出现在 class 里），文案按 low 回退
  assert.ok(hasClass(unknown, 'dsh-my-guard-issue-weird'))
  assert.equal(deepText(byClass(unknown, 'dsh-my-guard-issue-sev')), '低')

  // 加载中 / 空 / 错误三态
  assert.ok(deepText(t.LoadingState()).includes('加载中…'))
  const empty = t.EmptyState()
  assert.equal(empty.props.className, 'dsh-my-guard-empty')
  assert.ok(deepText(byClass(empty, 'dsh-my-guard-empty-hint')).includes('护栏会在这里生成告警'))
  let retried = 0
  const errState = render(t.ErrorState, { message: 'boom', onRetry: () => retried++ })
  assert.ok(hasClass(errState, 'dsh-my-guard-error'))
  assert.equal(deepText(byClass(errState, 'dsh-my-guard-error-text')), '加载失败：boom')
  const retryBtn = byAria(errState, '重试')
  assert.ok(retryBtn, '错误态提供重试按钮')
  retryBtn.props.onClick()
  assert.equal(retried, 1)
})

test('states/panel：徽标与标签随告警数据变化（类型→视觉类别、严重度→文案）', () => {
  const t = boot().internals
  assert.equal(t.alertTypeLabel('destructive'), '破坏性命令')
  assert.equal(t.alertTypeLabel('poison'), '投毒扫描')
  assert.equal(t.alertTypeLabel('injection'), '提示注入')
  assert.equal(t.alertTypeLabel('weird-type'), 'weird-type', '未知类型原样回显')
  assert.equal(t.severityLabel('high'), '高')
  assert.equal(t.severityLabel('medium'), '中')
  assert.equal(t.severityLabel('low'), '低')
  assert.equal(t.severityLabel('weird'), '低', '未知严重度回退 low')
  assert.equal(t.alertKind({ type: 'destructive' }), 'danger')
  assert.equal(t.alertKind({ type: 'poison' }), 'warn')
  assert.equal(t.alertKind({ type: 'injection' }), 'info')
  assert.equal(t.alertKind({ type: 'weird' }), 'info', '未知类型回退 info')

  assert.equal(t.timeText(new Date(2026, 0, 2, 3, 4, 5).getTime()), '03:04:05')
  assert.equal(t.shortSessionId('abcdefgh-1234'), 'abcdefgh…', 'UUID 取前 8 位 + 省略号')
  assert.equal(t.shortSessionId('short'), 'short', '短 id 不截断')
  assert.equal(t.shortSessionId(undefined), '')
})

// ══ 6. 主面板渲染路径 ════════════════════════════════════════════════════

const T0 = new Date(2026, 0, 2, 3, 4, 5).getTime()

const ALERTS = [
  {
    id: 1,
    type: 'destructive',
    severity: 'high',
    time: T0,
    message: 'rm -rf / 已被拦截',
    sessionId: 'sess-1234-5678',
    detail: { command: 'rm -rf /' },
  },
  {
    id: 2,
    type: 'poison',
    severity: 'medium',
    time: T0,
    message: '安装脚本可疑',
    detail: { file: '/tmp/pkg/package.json', pattern: 'curl | sh' },
  },
  {
    id: 3,
    type: 'injection',
    severity: 'low',
    time: T0,
    message: '疑似越狱',
    sessionId: 'abcdefgh-9999',
    confirmed: true,
    detail: { rule: 'inj-1', explain: '忽略之前所有指令', snippet: 'ignore all previous instructions' },
  },
  { id: 4, type: 'injection', severity: 'high', time: T0, message: '无详情告警' },
]

test('panel 渲染：告警行结构（类型徽标/严重度/时间/消息/元信息/详情/确认操作）', async () => {
  const env = boot({ fetch: () => okValue(ALERTS) })
  const loading = env.render(env.internals.GuardPanel, { visible: true })
  assert.ok(byClass(loading, 'dsh-my-guard-state'), '首屏（未拉到数据）显示加载中')
  assert.equal(alertCalls(env)[0].path, '/guard/api/alerts?limit=200')

  await flush()
  const tree = env.render(env.internals.GuardPanel, { visible: true })

  // 区块结构
  for (const title of ['告警记录', '投毒扫描', '提示注入检测', '规则测试', '自定义护栏规则']) {
    assert.ok(deepText(tree).includes(title), `面板应包含区块 ${title}`)
  }
  assert.ok(byAria(tree, '刷新'), '告警区提供刷新按钮')

  const rows = allByClass(tree, 'dsh-my-guard-alert')
  assert.equal(rows.length, 4, '四条告警各渲染一行')

  // 行 1：破坏性命令 / high / command 元信息
  assert.equal(deepText(byClass(rows[0], 'dsh-my-guard-badge')), '破坏性命令')
  assert.ok(hasClass(byClass(rows[0], 'dsh-my-guard-badge'), 'dsh-my-guard-badge-danger'))
  assert.ok(hasClass(byClass(rows[0], 'dsh-my-guard-sev'), 'dsh-my-guard-sev-high'))
  assert.equal(deepText(byClass(rows[0], 'dsh-my-guard-alert-msg')), 'rm -rf / 已被拦截')
  assert.equal(deepText(byClass(rows[0], 'dsh-my-guard-alert-meta')), 'rm -rf /', 'command 直接作为 meta')
  assert.match(deepText(byClass(rows[0], 'dsh-my-guard-time')), /^\d{2}:\d{2}:\d{2}$/)

  // 行 2：投毒 / medium / file 元信息加「文件 」前缀
  assert.ok(hasClass(byClass(rows[1], 'dsh-my-guard-badge'), 'dsh-my-guard-badge-warn'))
  assert.ok(hasClass(byClass(rows[1], 'dsh-my-guard-sev'), 'dsh-my-guard-sev-medium'))
  assert.equal(deepText(byClass(rows[1], 'dsh-my-guard-alert-meta')), '文件 /tmp/pkg/package.json')

  // 行 3：提示注入 + 已确认 → rule 元信息 + 会话短 id + 弱化显示 + 无确认按钮
  assert.ok(hasClass(byClass(rows[2], 'dsh-my-guard-badge'), 'dsh-my-guard-badge-info'))
  assert.equal(deepText(byClass(rows[2], 'dsh-my-guard-alert-meta')), '规则 inj-1 · 会话 abcdefgh…')
  assert.equal(deepText(byClass(rows[2], 'dsh-my-guard-alert-explain')), '忽略之前所有指令')
  assert.equal(deepText(byClass(rows[2], 'dsh-my-guard-alert-snippet')), '命中原文：ignore all previous instructions')
  assert.ok(hasClass(rows[2], 'dsh-my-guard-alert-confirmed'), '已确认告警整体弱化显示')
  const confirmedBadgeEl = flat(rows[2]).find((el) => classOf(el) === 'dsh-my-guard-alert-confirmed')
  assert.equal(deepText(confirmedBadgeEl), '已确认')
  assert.equal(byClass(rows[2], 'dsh-my-guard-alert-actions'), undefined, '已确认告警不再提供操作区')

  // 行 4：无 detail → 无 meta 行；未确认的注入告警给出「误报可确认」提示
  assert.equal(byClass(rows[3], 'dsh-my-guard-alert-meta'), undefined, '无 detail 不渲染 meta 行')
  assert.equal(
    deepText(byClass(rows[3], 'dsh-my-guard-alert-hint')),
    '如为误报：点击「确认」标记为已处理，该告警将弱化显示',
  )
  assert.equal(deepText(byAria(rows[3], '确认此告警')), '确认')

  // 行 1 是破坏性命令（非注入）→ 不显示误报提示
  assert.equal(deepText(byClass(rows[0], 'dsh-my-guard-alert-hint')), '')
})

test('panel 渲染：空列表显示空状态，加载失败显示错误态并可重试', async () => {
  const emptyEnv = boot({ fetch: () => okValue([]) })
  emptyEnv.render(emptyEnv.internals.GuardPanel, { visible: true })
  await flush()
  const emptyTree = emptyEnv.render(emptyEnv.internals.GuardPanel, { visible: true })
  assert.ok(byClass(emptyTree, 'dsh-my-guard-empty'), '空列表显示空状态')
  assert.ok(deepText(emptyTree).includes('暂无告警'))
  assert.equal(allByClass(emptyTree, 'dsh-my-guard-alert').length, 0)

  let fail = true
  const errEnv = boot({ fetch: () => (fail ? errValue('guard down') : okValue(ALERTS)) })
  errEnv.render(errEnv.internals.GuardPanel, { visible: true })
  await flush()
  const errTree = errEnv.render(errEnv.internals.GuardPanel, { visible: true })
  assert.equal(deepText(byClass(errTree, 'dsh-my-guard-error-text')), '加载失败：guard down')

  // 重试：清错误 + 回到加载中 + reloadTick 变化触发重新拉取
  fail = false
  byAria(errTree, '重试').props.onClick()
  const retryTree = errEnv.render(errEnv.internals.GuardPanel, { visible: true })
  assert.equal(byClass(retryTree, 'dsh-my-guard-error-text'), undefined, '重试后清除错误')
  assert.ok(byClass(retryTree, 'dsh-my-guard-state'), '重试后回到加载中')
  assert.equal(alertCalls(errEnv).length, 2, '重试触发重新拉取')
  assert.equal(alertCalls(errEnv)[1].path, '/guard/api/alerts?limit=200')
})

test('panel 轮询：可见时按 GUARD_POLL_MS 轮询，隐藏时暂停，卸载后停止', async () => {
  const env = boot({ fetch: () => okValue([]) })
  env.render(env.internals.GuardPanel, { visible: false })
  assert.equal(alertCalls(env).length, 0, '隐藏时不拉取告警（省请求）')
  assert.equal(env.intervals.length, 0, '隐藏时不轮询')

  env.render(env.internals.GuardPanel, { visible: true })
  await flush()
  assert.equal(alertCalls(env).length, 1, '可见时立即拉取一次')
  assert.equal(env.intervals.length, 1, '可见时注册轮询定时器')
  assert.equal(env.intervals[0].ms, env.internals.GUARD_POLL_MS)
  assert.equal(env.internals.GUARD_POLL_MS, 5000)

  env.intervals[0].fn()
  assert.equal(alertCalls(env).length, 2, '轮询 tick 触发拉取')

  env.harness.effectCleanup(env.internals.GuardPanel, 0)()
  assert.deepEqual(env.clearedIntervals, [env.intervals[0]], '卸载清理定时器')
  env.intervals[0].fn()
  assert.equal(alertCalls(env).length, 2, '卸载后 tick 不再拉取（alive=false）')
})

test('panel 交互：确认告警 POST 并就地弱化；确认失败静默保持原状', async () => {
  let confirmOk = true
  const env = boot({
    fetch: (path) =>
      path === '/guard/api/alerts/confirm' ? (confirmOk ? okValue({}) : errValue('confirm failed')) : okValue(ALERTS),
  })
  env.render(env.internals.GuardPanel, { visible: true })
  await flush()

  const before = env.render(env.internals.GuardPanel, { visible: true })
  const target = allByClass(before, 'dsh-my-guard-alert').find((row) => deepText(row).includes('rm -rf / 已被拦截'))
  byAria(target, '确认此告警').props.onClick()
  await flush()

  const confirmCall = env.fetchCalls.find((call) => call.path === '/guard/api/alerts/confirm')
  assert.ok(confirmCall, '确认触发 POST /guard/api/alerts/confirm')
  assert.equal(confirmCall.init.method, 'POST')
  assert.equal(confirmCall.init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(confirmCall.init.body), { id: 1 })

  const after = env.render(env.internals.GuardPanel, { visible: true })
  const updated = allByClass(after, 'dsh-my-guard-alert').find((row) => deepText(row).includes('rm -rf / 已被拦截'))
  assert.ok(hasClass(updated, 'dsh-my-guard-alert-confirmed'), '确认成功后该行就地弱化')
  assert.equal(byAria(updated, '确认此告警'), undefined)
  assert.equal(allByClass(after, 'dsh-my-guard-alert').length, 4, '其他告警不受影响')

  // 确认失败：静默，不抛错，保持未确认
  confirmOk = false
  const failEnv = boot({
    fetch: (path) => (path === '/guard/api/alerts/confirm' ? errValue('confirm failed') : okValue([ALERTS[1]])),
  })
  failEnv.render(failEnv.internals.GuardPanel, { visible: true })
  await flush()
  let row = allByClass(failEnv.render(failEnv.internals.GuardPanel, { visible: true }), 'dsh-my-guard-alert')[0]
  byAria(row, '确认此告警').props.onClick()
  await flush()
  row = allByClass(failEnv.render(failEnv.internals.GuardPanel, { visible: true }), 'dsh-my-guard-alert')[0]
  assert.ok(!hasClass(row, 'dsh-my-guard-alert-confirmed'), '确认失败保持未确认（由轮询校正）')
})

// ══ 7. 工具区块：投毒扫描 / 注入检测 / 规则测试 ═══════════════════════════

test('ScanTool 交互：空输入拦截、请求体、发现项渲染、干净结果、失败反馈、回车触发', async () => {
  const findings = [
    { file: '/tmp/a/package.json', pattern: 'postinstall', severity: 'high', message: '可疑安装脚本' },
    { file: '/tmp/a/.env', pattern: 'AKIA', severity: 'medium', message: '疑似密钥' },
  ]
  const env = boot({ fetch: () => okValue({ ok: true, findings }) })
  const render = () => env.render(env.internals.ScanTool, {})
  let tree = render()
  assert.equal(deepText(tree).includes('投毒扫描'), true)
  const input = () => byClass(render(), 'dsh-my-guard-tool-input')
  assert.equal(input().props.value, '')
  assert.equal(input().props.placeholder, '包名或本地路径，如 dsh-my-guard')

  // 空输入：本地拦截，不发请求
  buttonByText(render(), '扫描').props.onClick()
  assert.equal(env.fetchCalls.length, 0, '空输入不发请求')
  tree = render()
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-error')), '扫描失败：请输入包名或路径')

  // 输入 + 回车触发
  input().props.onChange({ target: { value: '  left-pad  ' } })
  assert.equal(input().props.value, '  left-pad  ', '受控输入回写原值')
  await flush()
  byClass(render(), 'dsh-my-guard-tool-input').props.onKeyDown({ key: 'Enter' })
  assert.equal(env.fetchCalls.length, 1, '回车触发扫描')
  assert.equal(env.fetchCalls[0].path, '/guard/api/scan')
  assert.equal(env.fetchCalls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(env.fetchCalls[0].init.body), { target: 'left-pad' }, '目标去空白后提交')

  // busy 期间按钮禁用 + 扫描中状态
  const busyTree = render()
  assert.equal(buttonByText(busyTree, '扫描').props.disabled, true)
  assert.equal(deepText(byClass(busyTree, 'dsh-my-guard-state')), '扫描中…')

  await flush()
  const resultTree = render()
  assert.equal(deepText(byClass(resultTree, 'dsh-my-guard-feedback-head')), '2 个发现项：')
  const issues = allByClass(resultTree, 'dsh-my-guard-issue')
  assert.equal(issues.length, 2)
  assert.equal(deepText(byClass(issues[0], 'dsh-my-guard-issue-sev')), '高')
  assert.equal(deepText(byClass(issues[0], 'dsh-my-guard-issue-rule')), '/tmp/a/package.json · postinstall')
})

test('ScanTool：干净结果与失败反馈', async () => {
  const cleanEnv = boot({ fetch: () => okValue({ ok: true, findings: [] }) })
  byClass(cleanEnv.render(cleanEnv.internals.ScanTool, {}), 'dsh-my-guard-tool-input').props.onChange({
    target: { value: 'safe-pkg' },
  })
  await flush()
  buttonByText(cleanEnv.render(cleanEnv.internals.ScanTool, {}), '扫描').props.onClick()
  await flush()
  const cleanTree = cleanEnv.render(cleanEnv.internals.ScanTool, {})
  assert.equal(deepText(byClass(cleanTree, 'dsh-my-guard-feedback-ok')), '未发现可疑内容')
  assert.equal(allByClass(cleanTree, 'dsh-my-guard-issue').length, 0)

  const errEnv = boot({ fetch: () => errValue('registry unreachable') })
  byClass(errEnv.render(errEnv.internals.ScanTool, {}), 'dsh-my-guard-tool-input').props.onChange({
    target: { value: 'x' },
  })
  await flush()
  buttonByText(errEnv.render(errEnv.internals.ScanTool, {}), '扫描').props.onClick()
  await flush()
  const errTree = errEnv.render(errEnv.internals.ScanTool, {})
  assert.equal(deepText(byClass(errTree, 'dsh-my-guard-feedback-error')), '扫描失败：registry unreachable')
  assert.equal(allByClass(errTree, 'dsh-my-guard-issue').length, 0)
})

test('PromptTool 交互：空文本拦截、textarea 受控、命中规则列表、无命中反馈', async () => {
  const hits = [
    { id: 'inj-1', severity: 'high', message: '忽略指令' },
    { id: 'inj-2', severity: 'medium', message: '角色扮演越狱' },
  ]
  const env = boot({ fetch: () => okValue({ hits }) })
  const render = () => env.render(env.internals.PromptTool, {})
  const textarea = () => byClass(render(), 'dsh-my-guard-textarea')
  assert.equal(deepText(render()).includes('提示注入检测'), true)
  assert.equal(textarea().props.placeholder, '输入要检测的文本…')

  buttonByText(render(), '检测').props.onClick()
  assert.equal(env.fetchCalls.length, 0, '空文本不发请求')
  assert.equal(deepText(byClass(render(), 'dsh-my-guard-feedback-error')), '加载失败：请输入要检测的文本')

  textarea().props.onChange({ target: { value: 'ignore  all  previous' } })
  await flush()
  assert.equal(textarea().props.value, 'ignore  all  previous')
  buttonByText(render(), '检测').props.onClick()
  assert.equal(env.fetchCalls[0].path, '/guard/api/scan-prompt')
  assert.deepEqual(JSON.parse(env.fetchCalls[0].init.body), { text: 'ignore  all  previous' })
  await flush()

  const tree = render()
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-head')), '命中 2 条规则：')
  const issues = allByClass(tree, 'dsh-my-guard-issue')
  assert.equal(issues.length, 2)
  assert.equal(deepText(byClass(issues[0], 'dsh-my-guard-issue-rule')), 'inj-1', '注入命中显示规则 id')
  assert.equal(deepText(byClass(issues[1], 'dsh-my-guard-issue-msg')), '角色扮演越狱')

  const cleanEnv = boot({ fetch: () => okValue({ hits: [] }) })
  byClass(cleanEnv.render(cleanEnv.internals.PromptTool, {}), 'dsh-my-guard-textarea').props.onChange({
    target: { value: 'hello' },
  })
  await flush()
  buttonByText(cleanEnv.render(cleanEnv.internals.PromptTool, {}), '检测').props.onClick()
  await flush()
  assert.equal(
    deepText(byClass(cleanEnv.render(cleanEnv.internals.PromptTool, {}), 'dsh-my-guard-feedback-ok')),
    '未命中注入规则',
  )
})

test('RuleTest 交互：空命令拦截、命中列表 + 合并决策、无命中反馈', async () => {
  const result = {
    hits: [
      { id: 'destructive-rm', mode: 'deny', severity: 'high', message: '递归删除', source: 'builtin' },
      { id: 'custom-1', mode: 'ask', severity: 'medium', message: '自定义危险模式', source: 'custom' },
    ],
    decision: { mode: 'deny', severity: 'high' },
  }
  const env = boot({ fetch: () => okValue(result) })
  const render = () => env.render(env.internals.RuleTest, {})
  const input = () => byClass(render(), 'dsh-my-guard-tool-input')
  assert.equal(deepText(render()).includes('规则测试'), true)
  assert.equal(input().props.placeholder, '输入命令，预览命中哪些规则…')

  buttonByText(render(), '测试').props.onClick()
  assert.equal(env.fetchCalls.length, 0, '空命令不发请求')
  assert.equal(deepText(byClass(render(), 'dsh-my-guard-feedback-error')), '加载失败：请输入命令')

  input().props.onChange({ target: { value: 'rm -rf /' } })
  await flush()
  buttonByText(render(), '测试').props.onClick()
  assert.equal(env.fetchCalls[0].path, '/guard/api/rules/test')
  assert.deepEqual(JSON.parse(env.fetchCalls[0].init.body), { command: 'rm -rf /' })
  await flush()

  const tree = render()
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-head')), '命中规则：')
  const issues = allByClass(tree, 'dsh-my-guard-issue')
  assert.equal(issues.length, 2)
  assert.equal(deepText(byClass(issues[0], 'dsh-my-guard-issue-msg')), '拦截 · 递归删除', '命中行 = 模式 · 消息')
  assert.equal(
    deepText(byClass(issues[0], 'dsh-my-guard-issue-rule')),
    '内置 · destructive-rm',
    '命中行 = 来源 · 规则 id',
  )
  assert.equal(deepText(byClass(issues[1], 'dsh-my-guard-issue-rule')), '自定义 · custom-1')
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-effective')), '合并决策: 拦截 / 高')

  const cleanEnv = boot({ fetch: () => okValue({ hits: [] }) })
  byClass(cleanEnv.render(cleanEnv.internals.RuleTest, {}), 'dsh-my-guard-tool-input').props.onChange({
    target: { value: 'ls' },
  })
  await flush()
  buttonByText(cleanEnv.render(cleanEnv.internals.RuleTest, {}), '测试').props.onClick()
  await flush()
  assert.equal(
    deepText(byClass(cleanEnv.render(cleanEnv.internals.RuleTest, {}), 'dsh-my-guard-feedback-ok')),
    '未命中任何护栏规则',
  )
})

// ══ 8. 规则面板：加载 / 增 / 删 / 改 / 开关 / 保存 ═════════════════════════

const RULE_A = { pattern: 'touch /etc/evil', mode: 'deny', severity: 'high', description: '拦截改系统文件' }
const RULE_B = { pattern: 'chmod 777', mode: 'observe', severity: 'low', description: '' }

/** 规则面板请求桩：GET /guard/api/rules 返回初始值，POST 返回可配置结果。 */
function rulesFetch({ initial, save } = {}) {
  return (path, init) => {
    if (path === '/guard/api/rules' && (!init || init.method === undefined)) {
      return typeof initial === 'function' ? initial() : (initial ?? okValue({}))
    }
    return typeof save === 'function' ? save(init) : (save ?? okValue({}))
  }
}

const rulesLoaded = () => okValue({ custom: [RULE_A, RULE_B], notifyEnabled: true, notifyCooldownMs: 120000 })

test('RuleSettings 渲染：加载初始值（规则行/通知开关/冷却秒数）与空列表提示', async () => {
  const env = boot({ fetch: rulesFetch({ initial: rulesLoaded }) })
  env.render(env.internals.RuleSettings, {})
  await flush()
  const tree = env.render(env.internals.RuleSettings, {})

  assert.equal(deepText(byClass(tree, 'dsh-my-guard-section-title')), '自定义护栏规则')
  assert.ok(deepText(byClass(tree, 'dsh-my-guard-rules-hint')).includes('与内置规则合并生效'))
  const rows = allByClass(tree, 'dsh-my-guard-rule-row')
  assert.equal(rows.length, 2)
  assert.deepEqual(
    allByClass(tree, 'dsh-my-guard-rule-pattern').map((i) => i.props.value),
    ['touch /etc/evil', 'chmod 777'],
  )
  assert.deepEqual(
    allByClass(tree, 'dsh-my-guard-rule-desc').map((i) => i.props.value),
    ['拦截改系统文件', ''],
  )
  assert.deepEqual(
    allByClass(tree, 'dsh-my-guard-rule-select').map((s) => s.props.value),
    ['deny', 'high', 'observe', 'low'],
    '每行「模式 + 严重级」两个下拉',
  )
  assert.equal(flat(tree).find((el) => el.props?.type === 'checkbox').props.checked, true, '通知开关回显')
  assert.equal(byClass(tree, 'dsh-my-guard-cooldown-input').props.value, 120, '冷却毫秒 → 秒')
  assert.equal(byClass(tree, 'dsh-my-guard-empty-rules'), undefined)
  assert.ok(buttonByText(tree, '添加规则'), '提供添加规则按钮')
  assert.ok(buttonByText(tree, '保存规则'), '提供保存按钮')
  assert.ok(deepText(byClass(tree, 'dsh-my-guard-notify-hint')).includes('dsh-my-notify'))

  const emptyEnv = boot({ fetch: rulesFetch({ initial: () => okValue({ custom: [] }) }) })
  emptyEnv.render(emptyEnv.internals.RuleSettings, {})
  await flush()
  const emptyTree = emptyEnv.render(emptyEnv.internals.RuleSettings, {})
  assert.equal(allByClass(emptyTree, 'dsh-my-guard-rule-row').length, 0)
  assert.equal(deepText(byClass(emptyTree, 'dsh-my-guard-empty-rules')), '暂无自定义规则——点击「添加规则」创建')
})

test('RuleSettings 增：添加规则写入默认模板，行数递增且可编辑', async () => {
  const env = boot({ fetch: rulesFetch({ initial: () => okValue({ custom: [] }) }) })
  env.render(env.internals.RuleSettings, {})
  await flush()

  buttonByText(env.render(env.internals.RuleSettings, {}), '添加规则').props.onClick()
  const tree = env.render(env.internals.RuleSettings, {})
  assert.equal(allByClass(tree, 'dsh-my-guard-rule-row').length, 1, '新增一行')
  assert.equal(byClass(tree, 'dsh-my-guard-rule-pattern').props.value, '', '新规则 pattern 为空')
  assert.equal(byClass(tree, 'dsh-my-guard-rule-pattern').props.placeholder, '正则，如 touch /etc/evil')
  assert.equal(byClass(tree, 'dsh-my-guard-rule-desc').props.placeholder, '描述（可选）')
  assert.deepEqual(
    allByClass(tree, 'dsh-my-guard-rule-select').map((s) => s.props.value),
    ['observe', 'medium'],
    '默认模式 observe / 严重级 medium',
  )
})

test('RuleSettings 改：pattern/mode/severity/description 四个字段写回对应规则', async () => {
  const env = boot({ fetch: rulesFetch({ initial: () => okValue({ custom: [RULE_A, RULE_B] }) }) })
  env.render(env.internals.RuleSettings, {})
  await flush()
  const render = () => env.render(env.internals.RuleSettings, {})

  // 改第 2 行 pattern：只影响第 2 行
  allByClass(render(), 'dsh-my-guard-rule-pattern')[1].props.onChange({ target: { value: 'rm -rf /tmp' } })
  assert.deepEqual(
    allByClass(render(), 'dsh-my-guard-rule-pattern').map((i) => i.props.value),
    ['touch /etc/evil', 'rm -rf /tmp'],
  )

  // 改第 1 行模式下拉
  allByClass(render(), 'dsh-my-guard-rule-select')[0].props.onChange({ target: { value: 'ask' } })
  assert.equal(allByClass(render(), 'dsh-my-guard-rule-select')[0].props.value, 'ask')

  // 改第 1 行严重级下拉
  allByClass(render(), 'dsh-my-guard-rule-select')[1].props.onChange({ target: { value: 'low' } })
  assert.equal(allByClass(render(), 'dsh-my-guard-rule-select')[1].props.value, 'low')

  // 改第 2 行描述
  allByClass(render(), 'dsh-my-guard-rule-desc')[1].props.onChange({ target: { value: '世界可写' } })
  assert.deepEqual(
    allByClass(render(), 'dsh-my-guard-rule-desc').map((i) => i.props.value),
    ['拦截改系统文件', '世界可写'],
  )
  assert.equal(allByClass(render(), 'dsh-my-guard-rule-row').length, 2, '编辑不改变行数')
})

test('RuleSettings 删：删除指定行，其余行顺序与内容保持', async () => {
  const env = boot({ fetch: rulesFetch({ initial: () => okValue({ custom: [RULE_A, RULE_B] }) }) })
  env.render(env.internals.RuleSettings, {})
  await flush()

  const removeButtons = () =>
    flat(env.render(env.internals.RuleSettings, {})).filter((el) => el.props?.['aria-label'] === '删除此规则')
  assert.equal(removeButtons().length, 2, '每行一个删除按钮')
  removeButtons()[0].props.onClick()
  assert.deepEqual(
    allByClass(env.render(env.internals.RuleSettings, {}), 'dsh-my-guard-rule-pattern').map((i) => i.props.value),
    ['chmod 777'],
    '删除第 1 行后只剩第 2 行',
  )
  removeButtons()[0].props.onClick()
  assert.equal(
    allByClass(env.render(env.internals.RuleSettings, {}), 'dsh-my-guard-rule-row').length,
    0,
    '删除全部后回到空态',
  )
  assert.ok(byClass(env.render(env.internals.RuleSettings, {}), 'dsh-my-guard-empty-rules'))
})

test('RuleSettings 通知开关与冷却输入（含非法数字回退 0）', async () => {
  const env = boot({ fetch: rulesFetch({ initial: rulesLoaded }) })
  env.render(env.internals.RuleSettings, {})
  await flush()
  const render = () => env.render(env.internals.RuleSettings, {})
  const checkbox = () => flat(render()).find((el) => el.props?.type === 'checkbox')
  assert.equal(checkbox().props.checked, true)
  assert.ok(deepText(render()).includes('告警通知'))
  assert.ok(deepText(render()).includes('冷却(秒)'))

  checkbox().props.onChange({ target: { checked: false } })
  assert.equal(checkbox().props.checked, false, '通知开关可关闭')

  const cooldown = () => byClass(render(), 'dsh-my-guard-cooldown-input')
  assert.equal(cooldown().props.type, 'number')
  assert.equal(cooldown().props.min, '0')
  cooldown().props.onChange({ target: { value: '90' } })
  assert.equal(cooldown().props.value, 90)
  cooldown().props.onChange({ target: { value: 'abc' } })
  assert.equal(cooldown().props.value, 0, '非法输入回退 0')
})

test('RuleSettings 保存：POST 回传体、保存中禁用、反馈文案（已生效 / 丢弃非法规则）', async () => {
  let saved = null
  const env = boot({
    fetch: rulesFetch({
      initial: () => okValue({ custom: [RULE_A], notifyEnabled: true, notifyCooldownMs: 120000 }),
      save: (init) => {
        saved = JSON.parse(init.body)
        return okValue({ customRules: [RULE_A], notifyEnabled: false, notifyCooldownMs: 90000, dropped: 0 })
      },
    }),
  })
  env.render(env.internals.RuleSettings, {})
  await flush()
  const render = () => env.render(env.internals.RuleSettings, {})

  flat(render())
    .find((el) => el.props?.type === 'checkbox')
    .props.onChange({ target: { checked: false } })
  byClass(render(), 'dsh-my-guard-cooldown-input').props.onChange({ target: { value: '45' } })
  buttonByText(render(), '保存规则').props.onClick()

  // busy：保存中按钮禁用 + 加载中状态
  const busyTree = render()
  assert.equal(buttonByText(busyTree, '保存规则').props.disabled, true)
  assert.equal(deepText(byClass(busyTree, 'dsh-my-guard-state')), '加载中…')

  await flush()
  assert.deepEqual(saved, { customRules: [RULE_A], notifyEnabled: false, notifyCooldownMs: 45000 })
  const tree = render()
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-ok')), '规则已保存（已生效）')
  assert.equal(buttonByText(tree, '保存规则').props.disabled, false, '保存结束后恢复可用')
  assert.equal(byClass(tree, 'dsh-my-guard-cooldown-input').props.value, 90, '保存响应回写冷却秒数')
  assert.equal(flat(tree).find((el) => el.props?.type === 'checkbox').props.checked, false, '保存响应回写开关')

  // dropped > 0 → 丢弃非法规则提示
  const dropEnv = boot({
    fetch: rulesFetch({
      initial: () => okValue({ custom: [RULE_A] }),
      save: () => okValue({ customRules: [RULE_A], notifyEnabled: true, notifyCooldownMs: 60000, dropped: 2 }),
    }),
  })
  dropEnv.render(dropEnv.internals.RuleSettings, {})
  await flush()
  buttonByText(dropEnv.render(dropEnv.internals.RuleSettings, {}), '保存规则').props.onClick()
  await flush()
  assert.equal(
    deepText(byClass(dropEnv.render(dropEnv.internals.RuleSettings, {}), 'dsh-my-guard-feedback-ok')),
    '已保存 2 条，丢弃 2 条非法规则（正则无效/缺 pattern）',
  )
})

test('RuleSettings 失败路径：加载失败与保存失败都显示可读错误', async () => {
  const loadEnv = boot({ fetch: rulesFetch({ initial: () => errValue('state file unreadable') }) })
  loadEnv.render(loadEnv.internals.RuleSettings, {})
  await flush()
  assert.equal(
    deepText(byClass(loadEnv.render(loadEnv.internals.RuleSettings, {}), 'dsh-my-guard-feedback-error')),
    '规则加载失败：state file unreadable',
  )

  const saveEnv = boot({
    fetch: rulesFetch({ initial: () => okValue({ custom: [] }), save: () => errValue('write failed') }),
  })
  saveEnv.render(saveEnv.internals.RuleSettings, {})
  await flush()
  buttonByText(saveEnv.render(saveEnv.internals.RuleSettings, {}), '保存规则').props.onClick()
  await flush()
  assert.equal(
    deepText(byClass(saveEnv.render(saveEnv.internals.RuleSettings, {}), 'dsh-my-guard-feedback-error')),
    '规则加载失败：write failed',
  )
})

test('ruleSettingsView：busy/error/feedback 三态可同时呈现（纯视图函数契约）', () => {
  const { internals: t, harness } = boot()
  const view = {
    customRules: [],
    notifyEnabled: false,
    notifyCooldownSec: 60,
    busy: true,
    feedback: '规则已保存（已生效）',
    error: 'boom',
    changeRule: () => {},
    addRule: () => {},
    removeRule: () => {},
    save: async () => {},
    setNotifyEnabled: () => {},
    setNotifyCooldownSec: () => {},
  }
  const tree = expand(t.ruleSettingsView(view), harness)
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-ok')), '规则已保存（已生效）')
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-feedback-error')), '规则加载失败：boom')
  assert.equal(deepText(byClass(tree, 'dsh-my-guard-state')), '加载中…')
  assert.equal(buttonByText(tree, '保存规则').props.disabled, true)
})
