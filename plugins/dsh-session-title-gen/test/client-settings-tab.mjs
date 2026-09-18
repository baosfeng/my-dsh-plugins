import { test } from 'vitest'
/**
 * dsh-session-title-gen — 设置页签（设置 → 插件 → 会话标题生成）单测（issue #385）。
 *
 * 需求：client 半通过官方 slots 扩展点 `settings.plugins.tab` 注册页签，把插件的
 * **8 项配置**（enabled / template / provider / model / maxTitleBytes / maxInputBytes /
 * maxOutputTokens / timeoutMs）可视化编辑 → PUT /session-title-gen/api/config 保存写回
 * profile patch（行 id `session-title-gen`）并热生效。
 *
 * 本文件钉住七条底线：
 *  1. 页签注册成功（id **精确** = session-title-gen-settings / order 数字 / label 惰性函数 /
 *     组件是函数），**且 slots 提供者 fiber 尚未 active 时也能注册**
 *     （cordis `ctx.get(name, strict=true)` 首屏时序坑 → 必须 strict=false）；
 *  2. 页签 id 全局唯一：复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）；
 *  3. 设置页样式走共享 installStyles（`data-dsh-session-title-gen-settings`），类名前缀
 *     `dsh-session-title-gen-settings`，只用宿主 CSS 变量（不硬编码色值）；
 *  4. **8 项全部暴露**（每个控件带唯一 data-field），GET 回填当前生效值；
 *  5. 保存 PUT 提交完整 8 项，成功提示「已保存」并用响应回填（host 回退后的实际值），
 *     失败提示不静默；加载失败给 404/网络区分与重试；
 *  6. **文案按当前语言返回单语**（与 dsh-think-zh-expand / dsh-my-observability 的设置页
 *     同一惯例）：label 惰性 + 跟随 `<html lang>` / navigator.language；中文 locale 下
 *     文案不含英文对照，英文 locale 下不含中文；英文串不得等于本仓库中文化词表键
 *     （dsh-think-zh-expand 的 DOM 词表会改写页签文字）；
 *  7. 拿不到 slots 服务时**静默降级**（设置页是增强能力，不能让整个 client 挂掉）。
 *
 * 断言对象是构建产物 lib/client.js（CI 只跑产物，不跑构建）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── react stub：createElement + 带状态槽的 useState/useEffect ─────────────
function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat() } }
}
let hookIndex = 0
const hookState = []
const effectDeps = []
const resetHooks = () => {
  hookIndex = 0
}
const stubbed = {
  createElement,
  useState: (initial) => {
    const i = hookIndex++
    if (hookState[i] === undefined) hookState[i] = typeof initial === 'function' ? initial() : initial
    const set = (v) => {
      hookState[i] = typeof v === 'function' ? v(hookState[i]) : v
    }
    return [hookState[i], set]
  },
  useEffect: (fn) => {
    const i = hookIndex++
    if (effectDeps[i] !== undefined) return
    effectDeps[i] = true
    fn()
  },
}

// ── 最小浏览器环境：共享 installStyles 会创建 <style> 并 setAttribute ────
const styleTags = []
function makeStyleEl() {
  return {
    textContent: '',
    attrs: {},
    parentNode: null,
    setAttribute(k, v) {
      this.attrs[k] = String(v)
    },
  }
}
const head = {
  appendChild(el) {
    el.parentNode = head
    styleTags.push(el)
  },
  removeChild(el) {
    el.parentNode = null
    const i = styleTags.indexOf(el)
    if (i >= 0) styleTags.splice(i, 1)
  },
}
global.document = {
  head,
  createElement: (tag) => (tag === 'style' ? makeStyleEl() : { tagName: String(tag).toUpperCase(), children: [] }),
  querySelector: () => null,
  querySelectorAll: () => [],
}

// ── locale 控制：设置页文案按宿主/浏览器语言返回单语 ──────────────────────
// 判据与本仓库设置页惯例一致：优先 `<html lang>`（宿主 locale），回退
// navigator.language 前缀 zh。文案是惰性函数，所以**切完语言再取**才有效。
function setLocale(lang) {
  Object.defineProperty(globalThis, 'navigator', { value: { language: lang }, configurable: true, writable: true })
}
global.document.documentElement = { getAttribute: () => null }
function setHtmlLang(lang) {
  global.document.documentElement = { getAttribute: (name) => (name === 'lang' ? lang : null) }
}
setLocale('zh-CN')

// ── 载入产物 bundle ───────────────────────────────────────────────────────
let registered = null
global.window = { __ModuleLoader__: { load: (reg) => (registered = reg) } }
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function', 'apply 导出')

/** 捕获设置页 tab 的 mock slots 服务。 */
function makeSlots() {
  const state = { tab: null, injected: [] }
  const slots = {
    inject: (name, register) => {
      state.injected.push(name)
      if (name === 'settings.plugins.tab') state.tab = register()
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  return { slots, state }
}

/** 严格模拟 cordis `ctx.get(name, strict = true)`：提供者未 active 时
 *  strict 取法返回 undefined、strict=false 才返回服务对象（首屏时序桩）。 */
function makeBootCtx(services) {
  const effects = []
  const ctx = {
    effects,
    effect: (fn, label) => {
      effects.push(label)
      return fn()
    },
    get(name, strict = true) {
      const svc = services[name]
      if (svc === undefined) return undefined
      return strict ? undefined : svc
    },
  }
  if (services.slots !== undefined) ctx.slots = services.slots
  return ctx
}

/** 展开元素树（函数组件节点会被调用展开）。 */
function collect(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ text: String(node) })
    return out
  }
  if (typeof node.type === 'function') {
    collect(node.type(node.props), out)
    return out
  }
  out.push(node)
  collect(node.props?.children, out)
  return out
}

/** 整棵树的可见文本。 */
function textOf(nodes) {
  return nodes
    .filter((n) => n.text !== undefined)
    .map((n) => n.text)
    .join(' ')
}

/** 按 className 片段找元素。 */
function findByClass(nodes, fragment) {
  return nodes.find((n) => typeof n.props?.className === 'string' && n.props.className.includes(fragment))
}

/** 按 data-field 找配置控件（8 项各一个）。 */
function findByField(nodes, field) {
  return nodes.find((n) => n.props?.['data-field'] === field)
}

/** fetch 桩：按 method 分派，记录调用。 */
function stubFetch(handler) {
  const calls = []
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET'
    calls.push({ url, method, body: init && init.body })
    return Promise.resolve(handler(method, url, init))
  }
  return calls
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const jsonRes = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: () => Promise.resolve(body) })

const CONFIG_URL = '/session-title-gen/api/config'
const TAB_ID = 'session-title-gen-settings'
const FIELDS = [
  'enabled',
  'template',
  'provider',
  'model',
  'maxTitleBytes',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
]
const SERVER_VALUE = {
  enabled: true,
  template: '[{workspace}] {description}',
  provider: '',
  model: '',
  maxTitleBytes: 80,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 30000,
}

test('设置页 tab 注册：id 精确唯一、slots 未 active 时也能注册（首屏时序防回归）', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  exportsObj.apply(ctx)
  assert.ok(state.tab, 'slots 服务 provider fiber 未 active 时也注册成功（ctx.get strict=false）')
  assert.deepEqual(state.injected, ['settings.plugins.tab'], '注入官方设置页扩展点')
  assert.equal(state.tab.options.name, 'settings.plugins.tab', '注册到官方设置页扩展点')
  assert.equal(state.tab.options.id, TAB_ID, '页签 id 精确 = session-title-gen-settings（不与其它插件撞名）')
  assert.equal(typeof state.tab.options.order, 'number', 'order 为数字')
  assert.equal(typeof state.tab.options.label, 'function', 'label 是惰性函数（宿主靠重注册跟随语言切换）')
  const label = state.tab.options.label()
  assert.equal(typeof label, 'string', 'label 惰性求值返回字符串')
  assert.equal(label, '会话标题生成', '中文 locale 下页签 label 单语：' + label)
  assert.equal(typeof state.tab.component, 'function', '页签组件是函数')

  setLocale('en-US')
  try {
    const enLabel = state.tab.options.label()
    assert.equal(enLabel, 'Session titles', '英文 locale 下页签 label 单语：' + enLabel)
    assert.ok(!/[\u4e00-\u9fff]/.test(enLabel), '英文页签 label 不含中文：' + enLabel)
    assert.notEqual(enLabel, 'Session log', '英文页签名不得等于中文化词表键（会被改写成「会话日志」）')
    assert.equal(
      state.tab.options.id,
      TAB_ID,
      'id 不随语言变化（复用 id 会顶掉对方页签），且不得与既有 11 个设置页 id 相同',
    )
  } finally {
    setLocale('zh-CN')
  }
  assert.equal(state.tab.options.label(), '会话标题生成', '复位中文后 label() 又返回中文（惰性、无缓存）')
})

test('文案跟随宿主 <html lang>（优先于 navigator，避免"浏览器英文 + 宿主中文"错配）', () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  setLocale('en-US')
  setHtmlLang('zh-CN')
  try {
    assert.equal(state.tab.options.label(), '会话标题生成', '<html lang=zh-CN> 优先于 navigator（英文）')
  } finally {
    setHtmlLang('')
    setLocale('zh-CN')
  }
})

test('设置页样式走共享 installStyles，类名前缀与宿主变量（不硬编码色值）', () => {
  const { slots } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const settingsStyle = styleTags.find((s) => s.attrs['data-dsh-session-title-gen-settings'] === 'styles')
  assert.ok(settingsStyle, '注入 data-dsh-session-title-gen-settings="styles" 样式表')
  assert.ok(
    settingsStyle.textContent.includes('.dsh-session-title-gen-settings'),
    '样式类名前缀为 dsh-session-title-gen-settings',
  )
  assert.ok(settingsStyle.textContent.includes('--dsw-'), '颜色/字号走宿主 --dsw-* 变量')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(settingsStyle.textContent), '不硬编码十六进制色值（主题自适应）')
})

test('拿不到 slots 服务 / ctx.get（极简 ctx、老宿主）时设置页静默降级，不抛错', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  ctx.get = () => undefined
  assert.doesNotThrow(() => exportsObj.apply(ctx), '拿不到服务时静默跳过而不是崩掉 client')
  assert.equal(state.tab, null, '拿不到 slots 时不注册设置页签')
  assert.ok(
    styleTags.some((s) => s.attrs['data-dsh-session-title-gen-settings'] === 'styles'),
    '样式仍在（注入位置在任何早退分支之前）',
  )

  const bare = makeSlots()
  const bareCtx = { effect: (fn) => fn(), slots: bare.slots }
  assert.doesNotThrow(() => exportsObj.apply(bareCtx), 'ctx.get 缺失时也不抛错')
  assert.equal(bare.state.tab, null, '没有服务查询能力时不注册设置页签')

  const nullSlots = makeBootCtx({ slots: null })
  assert.doesNotThrow(() => exportsObj.apply(nullSlots), 'slots 为 null 时也不抛错')
})

/** 渲染设置页视图：加载配置 → 返回可断言的元素节点列表。 */
async function renderSettings(tabComponent) {
  // 模拟组件「重新挂载」：清空上一用例的 hook 状态槽与 effect deps 记忆。
  hookState.length = 0
  effectDeps.length = 0
  resetHooks()
  tabComponent() // 首渲染「加载中…」，并触发 useEffect 里的配置 GET
  await flush()
  resetHooks()
  const nodes = collect(tabComponent())
  return {
    render() {
      resetHooks()
      return collect(tabComponent())
    },
    nodes,
  }
}

test('视图：GET 回填 8 项配置，控件齐全（data-field 精确覆盖 8 项）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch(() => jsonRes({ ok: true, value: SERVER_VALUE }))
  const view = await renderSettings(state.tab.component)

  assert.ok(
    calls.some((c) => c.method === 'GET' && c.url === CONFIG_URL),
    'GET 拉取当前配置：' + CONFIG_URL,
  )
  const fields = view.nodes.map((n) => n.props?.['data-field']).filter(Boolean)
  assert.deepEqual([...fields].sort(), [...FIELDS].sort(), '暴露全部 8 项，不多不少：' + JSON.stringify(fields))

  const toggle = findByField(view.nodes, 'enabled')
  assert.equal(toggle.type, 'button', '开关用 button')
  assert.equal(toggle.props.role, 'switch', '无障碍语义 role=switch')
  assert.equal(toggle.props['aria-checked'], 'true', '开关反映当前生效值')
  assert.equal(findByField(view.nodes, 'template').props.value, SERVER_VALUE.template, '模板回填当前值')
  assert.equal(findByField(view.nodes, 'maxTitleBytes').props.value, String(SERVER_VALUE.maxTitleBytes), '数字项回填')
  assert.equal(findByField(view.nodes, 'timeoutMs').props.value, '30000', '数字项回填（毫秒）')
})

test('视图：改值后保存 → PUT 完整 8 项 + 「已保存」提示 + 用响应回填生效值', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch((method) => {
    if (method === 'GET') return jsonRes({ ok: true, value: SERVER_VALUE })
    // host 回退后的实际生效值（template 非法项不在这里，正常返回）
    return jsonRes({
      ok: true,
      value: { ...SERVER_VALUE, template: '{description}', maxTitleBytes: 120, enabled: false },
    })
  })
  const view = await renderSettings(state.tab.component)

  findByField(view.nodes, 'enabled').props.onClick()
  findByField(view.nodes, 'template').props.onChange({ target: { value: '{description}' } })
  findByField(view.nodes, 'maxTitleBytes').props.onChange({ target: { value: '120' } })
  findByField(view.nodes, 'provider').props.onChange({ target: { value: 'deepseek' } })
  const edited = view.render()

  const saveBtn = findByClass(edited, 'dsh-session-title-gen-settings-btn')
  assert.ok(saveBtn, '有保存按钮')
  assert.equal(textOf(collect(saveBtn)), '保存', '中文保存按钮单语')
  saveBtn.props.onClick()
  await flush()

  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, '保存触发 PUT')
  assert.equal(put.url, CONFIG_URL, 'PUT 打到插件配置端点')
  const body = JSON.parse(put.body)
  assert.deepEqual(Object.keys(body).sort(), [...FIELDS].sort(), 'PUT body 提交完整 8 项')
  assert.equal(body.enabled, false, '开关翻转被提交')
  assert.equal(body.template, '{description}', '文本项被提交')
  assert.equal(body.maxTitleBytes, 120, '数字项提交为数字（不是字符串）')
  assert.equal(body.provider, 'deepseek', 'provider 被提交')

  const saved = view.render()
  assert.ok(textOf(saved).includes('已保存'), '保存成功有提示：' + textOf(saved))
  assert.equal(findByField(saved, 'maxTitleBytes').props.value, '120', '用响应回填生效值')
})

test('视图：非法数字输入提交后按 host 回退值回填（不静默、不留脏值）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch((method, _url, init) => {
    if (method === 'GET') return jsonRes({ ok: true, value: SERVER_VALUE })
    const body = JSON.parse(init.body)
    assert.equal(body.timeoutMs, null, '非法数字提交为 null（host 按非法值回退默认）')
    return jsonRes({ ok: true, value: { ...SERVER_VALUE, timeoutMs: 30000 } })
  })
  const view = await renderSettings(state.tab.component)
  findByField(view.nodes, 'timeoutMs').props.onChange({ target: { value: 'abc' } })
  findByClass(view.render(), 'dsh-session-title-gen-settings-btn').props.onClick()
  await flush()
  const saved = view.render()
  assert.equal(findByField(saved, 'timeoutMs').props.value, '30000', '回填 host 回退后的默认值')
  assert.ok(textOf(saved).includes('已保存'), '保存流程正常结束：' + textOf(saved))
})

test('视图：保存失败与加载失败都有提示（不静默），404 区分「服务端插件未加载」并可重试', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch((method) =>
    method === 'GET' ? jsonRes({ ok: true, value: SERVER_VALUE }) : jsonRes({ ok: false }, { ok: false, status: 500 }),
  )
  const view = await renderSettings(state.tab.component)
  findByClass(view.nodes, 'dsh-session-title-gen-settings-btn').props.onClick()
  await flush()
  assert.ok(textOf(view.render()).includes('保存失败'), '保存失败有提示：' + textOf(view.render()))

  const failing = makeSlots()
  exportsObj.apply(makeBootCtx({ slots: failing.slots }))
  let attempts = 0
  stubFetch(() => {
    attempts += 1
    return jsonRes({ ok: false }, { ok: false, status: 404 })
  })
  const failedView = await renderSettings(failing.state.tab.component)
  const text = textOf(failedView.nodes)
  assert.ok(text.includes('配置加载失败'), '加载失败有提示：' + text)
  assert.ok(text.includes('404') || text.includes('未加载'), '说明服务端插件未加载（404）：' + text)
  const retry = findByClass(failedView.nodes, 'dsh-session-title-gen-settings-btn')
  retry.props.onClick()
  await flush()
  assert.ok(attempts >= 2, '重试真的重新拉取配置')
})

test('视图：中文 locale 下文案单语且压到一行（中英并排防回归）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch(() => jsonRes({ ok: true, value: SERVER_VALUE }))
  const view = await renderSettings(state.tab.component)
  const hints = view.nodes.filter(
    (n) => typeof n.props?.className === 'string' && n.props.className.includes('-settings-hint'),
  )
  assert.ok(hints.length >= 3, '有关键项说明文案：' + hints.length)
  for (const hint of hints) {
    const hintText = textOf(collect(hint))
    assert.ok(!/[A-Za-z]{3,}/.test(hintText.replace(/\{[a-z]+\}/g, '')), '中文 hint 不含英文对照：' + hintText)
    assert.ok(hintText.length <= 40, '中文 hint 压到一行（≤40 字）：' + hintText)
  }
})

test('视图：英文 locale（navigator.language=en）下文案只英文', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch(() => jsonRes({ ok: true, value: SERVER_VALUE }))
  setLocale('en-US')
  try {
    const view = await renderSettings(state.tab.component)
    const label = findByClass(view.nodes, 'dsh-session-title-gen-settings-label')
    const labelText = textOf(collect(label))
    assert.ok(!/[\u4e00-\u9fff]/.test(labelText), '英文 label 不含中文：' + labelText)
    const saveText = textOf(collect(findByClass(view.nodes, 'dsh-session-title-gen-settings-btn')))
    assert.ok(!/[\u4e00-\u9fff]/.test(saveText), '英文保存按钮不含中文：' + saveText)
  } finally {
    setLocale('zh-CN')
  }
})

test('静态断言：产物里 attachSettingsTab 恰好一份，且地址 / id 与 host 半一致', () => {
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(bundleSrc.split('function attachSettingsTab(').length - 1, 1, '设置页 part 恰好注入一份')
  assert.ok(bundleSrc.includes(`'${TAB_ID}'`), '页签 id 字面量在产物里')
  assert.ok(bundleSrc.includes(`'${CONFIG_URL}'`), '配置端点与 host 侧路由一致')
  const hostSrc = fs.readFileSync(new URL('../lib/config-routes.js', import.meta.url), 'utf8')
  assert.ok(hostSrc.includes("'/session-title-gen/api'"), 'host 侧注册同一地址前缀')
  assert.ok(hostSrc.includes("'session-title-gen'"), 'host 侧写回同一行 id')
  const template = fs.readFileSync(new URL('../lib/client.src.js', import.meta.url), 'utf8')
  assert.equal(template.split('/*__PART_SETTINGS__*/').length - 1, 1, '模板占位符恰好一处')
})
