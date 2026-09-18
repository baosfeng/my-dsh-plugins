import { test } from 'vitest'
/**
 * dsh-think-zh-expand — 设置页签（设置 → 插件 → 思考增强）单测（issue #383）。
 *
 * 需求：client 半通过官方 slots 扩展点 `settings.plugins.tab` 注册页签，开关
 * 「思考默认展开」（defaultExpanded）可视化编辑 → PUT /think-zh-expand/api/config
 * 保存写回 profile patch（行 id `think-zh-expand`）并热生效。
 *
 * 本文件钉住六条底线：
 *  1. 页签注册成功（id 精确 = think-zh-expand-settings / order 数字 / label 惰性 /
 *     组件是函数），**且 slots 提供者 fiber 尚未 active 时也能注册**
 *     （cordis `ctx.get(name, strict=true)` 首屏时序坑 → 必须 strict=false）；
 *  2. 页签 id 全局唯一：复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）；
 *  3. 设置页样式走共享 installStyles（`data-dsh-think-zh-expand-settings`），
 *     类名前缀 `dsh-think-zh-expand-settings`，只用宿主 CSS 变量（不硬编码色值）；
 *  4. **渲染增强回归**：同一次 apply 里 assistant-step 渲染器（思考默认展开）与
 *     界面中文化照旧挂载 —— 设置页不得挤掉本插件的核心能力；
 *  5. 视图行为：加载 → 开关显示当前值 → 点击翻转 → 保存（PUT body 正确）→
 *     立即生效 + 「已保存」提示；保存失败 / 加载失败都有明确提示（不静默）；
 *  6. 文案双语（中文 + 英文对照，沿用本插件界面中文化的英中对照风格）。
 *
 * 断言对象是构建产物 lib/client.js（CI 只跑产物，不跑构建）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ── react stub：createElement + 带状态槽的 useState/useEffect ─────────────
// hook 索引按渲染顺序共享（与 React 的 hook 链表语义一致）：每次渲染前
// resetHooks() 归零，但状态槽与 effect deps 跨渲染保留。
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
// 刻意**不**提供 MutationObserver：界面中文化的 DOM 扫描链路由 client-render.mjs
// 覆盖，本文件只断言它的 effect 仍挂载（installUiLocalize 在无 observer 时是 no-op）。

// ── 载入产物 bundle ───────────────────────────────────────────────────────
let registered = null
global.window = { __ModuleLoader__: { load: (reg) => (registered = reg) } }
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  // 三级 Markdown 回退的首选内核：这里只提供最小可用组件（渲染链路不在本文件断言范围）
  if (spec === 'dsh-md-render') return { MarkdownView: () => null }
  throw new Error('unexpected require: ' + spec)
})
assert.equal(typeof exportsObj.apply, 'function', 'apply 导出')

/** 捕获设置页 tab 的 mock slots 服务（同时记录 conversation.chat.node 注册）。 */
function makeSlots() {
  const state = { tab: null, injected: [], chatNode: null }
  const slots = {
    inject: (name, register) => {
      state.injected.push(name)
      if (name === 'settings.plugins.tab') state.tab = register()
      if (name === 'conversation.chat.node') state.chatNode = register()
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
  // 真实 DSH 里 ctx.slots 由 cordis inject 暴露为属性（index.ts 直接取 ctx.slots）
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

const CONFIG_URL = '/think-zh-expand/api/config'

test('设置页 tab 注册：id 精确唯一、slots 未 active 时也能注册（首屏时序防回归）', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  exportsObj.apply(ctx)
  assert.ok(state.tab, 'slots 服务 provider fiber 未 active 时也注册成功（ctx.get strict=false）')
  assert.equal(state.tab.options.name, 'settings.plugins.tab', '注册到官方设置页扩展点')
  assert.equal(
    state.tab.options.id,
    'think-zh-expand-settings',
    '页签 id 精确 = think-zh-expand-settings（不与其它插件撞名）',
  )
  assert.equal(typeof state.tab.options.order, 'number', 'order 为数字')
  const label = state.tab.options.label()
  assert.equal(typeof label, 'string', 'label 惰性求值返回字符串')
  assert.ok(label.includes('思考'), 'label 含插件语义「思考」：' + label)
  assert.equal(typeof state.tab.component, 'function', '页签组件是函数')
})

test('设置页样式走共享 installStyles，类名前缀与宿主变量（不硬编码色值）', () => {
  const { slots } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const settingsStyle = styleTags.find((s) => s.attrs['data-dsh-think-zh-expand-settings'] === 'styles')
  assert.ok(settingsStyle, '注入 data-dsh-think-zh-expand-settings="styles" 样式表')
  assert.ok(
    settingsStyle.textContent.includes('.dsh-think-zh-expand-settings'),
    '样式类名前缀为 dsh-think-zh-expand-settings',
  )
  assert.ok(settingsStyle.textContent.includes('--dsw-'), '颜色/字号走宿主 --dsw-* 变量')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(settingsStyle.textContent), '不硬编码十六进制色值（主题自适应）')
})

test('渲染增强回归：设置页不影响 assistant-step 渲染器与界面中文化（核心能力照旧）', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  const before = styleTags.length
  exportsObj.apply(ctx)
  assert.ok(
    state.injected.includes('conversation.chat.node'),
    'assistant-step 槽位仍注入：' + JSON.stringify(state.injected),
  )
  assert.equal(state.chatNode.options.key, 'assistant-step', '仍替换 assistant-step 渲染器（思考默认展开）')
  assert.equal(state.chatNode.options.registrant, 'dsh-think-zh-expand', 'registrant 不变')
  assert.ok(
    ctx.effects.some((label) => String(label).includes('ui localization')),
    '界面中文化 effect 仍挂载：' + JSON.stringify(ctx.effects),
  )
  assert.ok(
    ctx.effects.some((label) => String(label).includes('assistant-step renderer')),
    '渲染器 effect 仍挂载',
  )
  // 按属性定位本次 apply 新增的样式表（不跨用例累计计数）
  const added = styleTags.slice(before)
  assert.equal(added.length, 2, '本次 apply 恰好两张样式表：思考块 + 设置页')
  assert.ok(
    added.some((s) => s.attrs['data-dsh-think-zh-expand'] === 'styles'),
    '思考块样式仍在：' + JSON.stringify(added.map((s) => s.attrs)),
  )
  assert.ok(
    added.some((s) => s.attrs['data-dsh-think-zh-expand-settings'] === 'styles'),
    '设置页样式同批注入',
  )
})

test('拿不到 slots 服务 / ctx.get（极简 ctx、老宿主）时设置页静默跳过，渲染链路照旧', () => {
  // ctx.slots 属性可用（cordis inject 保证），但服务查询拿不到实例（首屏 / 老宿主）
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  ctx.get = () => undefined
  assert.doesNotThrow(() => exportsObj.apply(ctx), '设置页签静默跳过而不是崩掉 client')
  assert.equal(state.tab, null, '拿不到 slots 时不注册设置页签')
  assert.ok(state.chatNode, 'assistant-step 渲染器照旧注册')
  assert.ok(
    styleTags.some((s) => s.attrs['data-dsh-think-zh-expand'] === 'styles'),
    '思考块样式仍在（注入位置在任何早退分支之前）',
  )
  assert.ok(
    styleTags.some((s) => s.attrs['data-dsh-think-zh-expand-settings'] === 'styles'),
    '设置页样式仍在（注册失败不影响样式）',
  )

  // ctx.get 根本不是函数（极简测试 ctx / 更老宿主）
  const bare = makeSlots()
  const bareCtx = { effect: (fn) => fn(), slots: bare.slots }
  assert.doesNotThrow(() => exportsObj.apply(bareCtx), 'ctx.get 缺失时也不抛错')
  assert.equal(bare.state.tab, null, '没有服务查询能力时不注册设置页签')
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

test('视图：开关显示当前值，点击翻转后保存成功（PUT body 正确 + 立即生效 + 已保存提示）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch((method) => {
    if (method === 'GET') return jsonRes({ ok: true, value: { defaultExpanded: true } })
    return jsonRes({ ok: true })
  })
  const view = await renderSettings(state.tab.component)

  const toggle = findByClass(view.nodes, 'dsh-think-zh-expand-settings-toggle')
  assert.ok(toggle, '有开关行')
  assert.equal(toggle.props['data-on'], 'true', '开关反映当前生效值')
  assert.equal(toggle.props.role, 'switch', '无障碍语义 role=switch')
  assert.ok(
    calls.some((c) => c.method === 'GET' && c.url === CONFIG_URL),
    'GET 拉取当前配置：' + CONFIG_URL,
  )

  toggle.props.onClick() // 关闭
  const flipped = view.render()
  assert.equal(findByClass(flipped, 'dsh-think-zh-expand-settings-toggle').props['data-on'], 'false', '点击后开关翻转')

  const saveBtn = findByClass(flipped, 'dsh-think-zh-expand-settings-btn')
  assert.ok(saveBtn, '有保存按钮')
  saveBtn.props.onClick()
  await flush()
  const saved = view.render()
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, '保存触发 PUT')
  assert.equal(put.url, CONFIG_URL, 'PUT 打到插件配置端点')
  assert.deepEqual(JSON.parse(put.body), { defaultExpanded: false }, 'PUT body 是校验后的布尔值')
  assert.ok(textOf(saved).includes('已保存'), '保存成功有提示：' + textOf(saved))
  assert.equal(exportsObj.getDefaultExpanded(), false, '保存即生效：client 生效值同步为新值')
})

test('视图：保存失败有提示（不静默），文案双语且说明「关闭后仍可手动展开」', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch((method) => {
    if (method === 'GET') return jsonRes({ ok: true, value: { defaultExpanded: true } })
    return jsonRes({ ok: false }, { ok: false, status: 400 })
  })
  const view = await renderSettings(state.tab.component)
  findByClass(view.nodes, 'dsh-think-zh-expand-settings-toggle').props.onClick()
  const flipped = view.render()
  findByClass(flipped, 'dsh-think-zh-expand-settings-btn').props.onClick()
  await flush()
  const failed = view.render()
  const text = textOf(failed)
  assert.ok(text.includes('保存失败'), '保存失败有提示：' + text)
  const hint = findByClass(failed, 'dsh-think-zh-expand-settings-hint')
  assert.ok(hint, '有说明文案')
  const hintText = textOf(collect(hint))
  assert.ok(hintText.includes('展开'), '说明文案写清开关语义：' + hintText)
  assert.ok(/expand/i.test(hintText), '说明文案含英文对照（双语）：' + hintText)
})

test('视图：配置加载失败有提示与重试（区分 404 = 路由未注册）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  let attempts = 0
  stubFetch(() => {
    attempts += 1
    return jsonRes({ ok: false }, { ok: false, status: 404 })
  })
  const view = await renderSettings(state.tab.component)
  const text = textOf(view.nodes)
  assert.ok(text.includes('配置加载失败'), '加载失败有提示：' + text)
  assert.ok(text.includes('404') || text.includes('未加载'), '说明服务端插件未加载（404）：' + text)
  const retry = findByClass(view.nodes, 'dsh-think-zh-expand-settings-btn')
  assert.ok(retry, '提供重试按钮')
  retry.props.onClick()
  await flush()
  assert.ok(attempts >= 2, '重试真的重新拉取配置')
})

test('静态断言：产物里 attachSettingsTab 恰好一份，且地址 / id 与 host 半一致', () => {
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(bundleSrc.split('function attachSettingsTab(').length - 1, 1, '设置页 part 恰好注入一份')
  assert.ok(bundleSrc.includes("'think-zh-expand-settings'"), '页签 id 字面量在产物里')
  assert.ok(bundleSrc.includes("'/think-zh-expand/api/config'"), '配置端点与 host 侧路由一致')
  const hostSrc = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(hostSrc.includes("'/think-zh-expand/api'"), 'host 侧注册同一地址前缀')
  assert.ok(hostSrc.includes("'think-zh-expand'"), 'host 侧写回同一行 id')
  const template = fs.readFileSync(new URL('../lib/client.src.js', import.meta.url), 'utf8')
  assert.equal(template.split('/*__PART_SETTINGS__*/').length - 1, 1, '模板占位符恰好一处')
})
