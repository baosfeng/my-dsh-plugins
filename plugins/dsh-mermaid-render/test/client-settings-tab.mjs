import { test } from 'vitest'
/**
 * dsh-mermaid-render — 设置页签（设置 → 插件 → Mermaid 渲染）单测（issue #383）。
 *
 * 需求：client 半通过官方 slots 扩展点 `settings.plugins.tab` 注册页签，
 * 开关「向系统提示词注入 mermaid 能力说明」可视化编辑 → PUT
 * /mermaid-render/api/config 保存写回 profile patch。
 *
 * 本文件钉住五条底线：
 *  1. 页签注册成功（id / order / label / 组件），**且 slots 提供者 fiber 尚未
 *     active 时也能注册**（cordis `ctx.get(name, strict=true)` 首屏时序坑，
 *     见 dsh-my-notify/test/client-settings-tab.mjs）；
 *  2. 设置页样式走共享 installStyles（`data-dsh-mermaid-render-settings`），
 *     只用宿主 CSS 变量（不硬编码色值）；
 *  3. **渲染增强回归**：同一次 apply 里卡片样式（data-dsh-mermaid-render）与
 *     DOM 扫描器照旧挂载 —— 设置页不得挤掉本插件的核心渲染链路；
 *  4. 视图行为：加载 → 开关显示当前值 → 点击翻转 → 保存成功提示（PUT body 正确）；
 *  5. 保存失败 / 加载失败有明确提示（不静默）。
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
let hookState = []
let effectDeps = []
const resetHooks = () => {
  hookIndex = 0
}
/** 跨用例复位：每个用例都重新 apply 客户端，hook 状态槽必须从零开始
 *  （否则 useEffect 的 deps 记忆会吞掉新用例的首次 load）。 */
const resetHookState = () => {
  hookIndex = 0
  hookState = []
  effectDeps = []
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
    // deps 记忆（[] 只跑一次），避免每次重渲染重复 GET。
    if (effectDeps[i] !== undefined) return
    effectDeps[i] = true
    fn()
  },
}

// react-dom/client 桩：渲染链路（卡片挂载）在 apply 时会被 require，本文件
// 只关心设置页，故 createRoot 直接吞掉渲染结果。
const stubbedReactDomClient = {
  createRoot: () => ({ render: () => {}, unmount: () => {} }),
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
/** 最小 DOM 元素桩：只实现 scanner（scanBlocks）会碰到的 API。 */
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    dataset: {},
    className: '',
    style: {},
    parentNode: null,
    matches: () => false,
    closest: () => null,
    getAttribute: () => null,
    hasAttribute: () => false,
    setAttribute() {},
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      return child
    },
    querySelector: () => null,
    querySelectorAll: () => [],
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
  body: makeEl('body'),
  createElement: (tag) => (tag === 'style' ? makeStyleEl() : makeEl(tag)),
  querySelector: () => null,
  querySelectorAll: () => [],
}
global.MutationObserver = class {
  observe() {}
  disconnect() {}
}

// ── 载入产物 bundle ───────────────────────────────────────────────────────
let registered = null
global.window = { __ModuleLoader__: { load: (reg) => (registered = reg) } }
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
assert.ok(registered, 'bundle registered')
const exportsObj = registered.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === 'react-dom/client') return stubbedReactDomClient
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
  return {
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
}

/** 展开元素树（函数组件节点会被调用展开；普通渲染函数返回的树直接遍历）。 */
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

const CONFIG_URL = '/mermaid-render/api/config'

test('设置页 tab 注册：slots 提供者未 active 时也能注册（首屏时序防回归）', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  exportsObj.apply(ctx)
  assert.ok(state.tab, 'slots 服务 provider fiber 未 active 时也注册成功')
  assert.equal(state.tab.options.name, 'settings.plugins.tab', '注册到官方设置页扩展点')
  assert.equal(state.tab.options.id, 'mermaid-render-settings', '页签 id 唯一（不与其它插件撞名）')
  assert.equal(typeof state.tab.options.order, 'number', 'order 为数字')
  const label = state.tab.options.label()
  assert.equal(typeof label, 'string', 'label 是字符串（惰性求值以跟随语言切换）')
  assert.ok(label.includes('Mermaid'), 'label 含插件语义 Mermaid：' + label)
  assert.equal(typeof state.tab.component, 'function', '页签组件是函数')
})

test('设置页样式走共享 installStyles，且只用宿主 CSS 变量', () => {
  const { slots } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const settingsStyle = styleTags.find((s) => s.attrs['data-dsh-mermaid-render-settings'] === 'styles')
  assert.ok(settingsStyle, '注入 data-dsh-mermaid-render-settings="styles" 样式表')
  assert.ok(
    settingsStyle.textContent.includes('.dsh-mermaid-render-settings'),
    '样式类名前缀为 dsh-mermaid-render-settings',
  )
  assert.ok(settingsStyle.textContent.includes('--dsw-'), '颜色/字号走宿主 --dsw-* 变量')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(settingsStyle.textContent), '不硬编码十六进制色值（主题自适应）')
})

test('渲染增强回归：设置页不影响卡片样式与 DOM 扫描器（核心渲染链路照旧）', () => {
  const { slots } = makeSlots()
  const ctx = makeBootCtx({ slots })
  exportsObj.apply(ctx)
  const cardStyle = styleTags.find((s) => s.attrs['data-dsh-mermaid-render'] === 'styles')
  assert.ok(cardStyle, '卡片样式仍注入')
  assert.ok(cardStyle.textContent.includes('.dsh-mermaid-render-card'), '卡片规则仍在')
  assert.ok(cardStyle.textContent.includes('.dsh-mermaid-render-error'), '渲染失败兜底样式仍在')
  assert.ok(
    ctx.effects.some((label) => String(label).includes('scanner')),
    'DOM 扫描器（流式渲染链路）仍挂载：' + JSON.stringify(ctx.effects),
  )
  const cardStyles = styleTags.filter((s) => s.attrs['data-dsh-mermaid-render'] === 'styles')
  const settingsStyles = styleTags.filter((s) => s.attrs['data-dsh-mermaid-render-settings'] === 'styles')
  assert.equal(cardStyles.length, settingsStyles.length, '每次 apply 都成对注入卡片样式与设置页样式')
  assert.ok(settingsStyles.length >= 1, '设置页样式确有注入')
})

test('slots 服务缺失（精简 ctx）时 apply 不抛错（渲染能力不受影响）', () => {
  assert.doesNotThrow(() => exportsObj.apply(makeBootCtx({})), 'settings tab 静默跳过而不是崩掉 client')
  assert.ok(
    styleTags.some((s) => s.attrs['data-dsh-mermaid-render'] === 'styles'),
    '样式仍在（注入位置在任何早退分支之前）',
  )
})

/** 渲染设置页视图：加载配置 → 返回可断言的元素节点列表。 */
async function renderSettings(tabComponent) {
  resetHookState()
  // 首渲染为「加载中…」（触发 load 的 effect）；等微任务让 fetch 的 promise
  // 链落定后再渲染一次，此时状态已是配置视图。
  resetHooks()
  tabComponent()
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

test('视图：开关显示当前值，点击翻转后保存成功（PUT body 正确 + 已保存提示）', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch((method) => {
    if (method === 'GET') return jsonRes({ ok: true, value: { injectPrompt: true } })
    return jsonRes({ ok: true })
  })
  const view = await renderSettings(state.tab.component)
  const toggle = findByClass(view.nodes, 'dsh-mermaid-render-settings-toggle')
  assert.ok(toggle, '有开关行')
  assert.equal(toggle.props['data-on'], 'true', '开关反映当前生效值（默认开）')
  assert.equal(toggle.props.role, 'switch', '无障碍语义 role=switch')
  assert.ok(
    calls.some((c) => c.method === 'GET' && c.url === CONFIG_URL),
    'GET 拉取当前配置：' + CONFIG_URL,
  )

  toggle.props.onClick() // 关闭
  const flipped = view.render()
  assert.equal(findByClass(flipped, 'dsh-mermaid-render-settings-toggle').props['data-on'], 'false', '点击后开关翻转')

  const saveBtn = findByClass(flipped, 'dsh-mermaid-render-settings-btn')
  assert.ok(saveBtn, '有保存按钮')
  saveBtn.props.onClick()
  await flush()
  const saved = view.render()
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, '保存触发 PUT')
  assert.equal(put.url, CONFIG_URL, 'PUT 打到插件配置端点')
  assert.deepEqual(JSON.parse(put.body), { injectPrompt: false }, 'PUT body 是校验后的布尔值')
  assert.ok(textOf(saved).includes('已保存'), '保存成功有提示：' + textOf(saved))
})

test('视图：保存失败有提示（不静默），说明文案写明关闭后照常渲染', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch((method) => {
    if (method === 'GET') return jsonRes({ ok: true, value: { injectPrompt: true } })
    return jsonRes({ ok: false }, { ok: false, status: 400 })
  })
  const view = await renderSettings(state.tab.component)
  const toggle = findByClass(view.nodes, 'dsh-mermaid-render-settings-toggle')
  toggle.props.onClick()
  const flipped = view.render()
  findByClass(flipped, 'dsh-mermaid-render-settings-btn').props.onClick()
  await flush()
  const failed = view.render()
  const text = textOf(failed)
  assert.ok(text.includes('保存失败'), '保存失败有提示：' + text)
  const hint = findByClass(failed, 'dsh-mermaid-render-settings-hint')
  assert.ok(hint, '有说明文案')
  const hintText = textOf(collect(hint))
  assert.ok(hintText.includes('照常渲染'), '说明「关闭后已有 mermaid 代码块照常渲染」：' + hintText)
  assert.ok(/render/i.test(hintText), '说明文案含英文对照（双语）：' + hintText)
})

test('视图：配置加载失败有提示与重试（区分 404=路由未注册）', async () => {
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
  const retry = findByClass(view.nodes, 'dsh-mermaid-render-settings-btn')
  assert.ok(retry, '提供重试按钮')
  retry.props.onClick()
  await flush()
  assert.ok(attempts >= 2, '重试真的重新拉取配置')
})
