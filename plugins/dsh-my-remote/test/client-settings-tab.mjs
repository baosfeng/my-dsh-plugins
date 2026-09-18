import { test } from 'vitest'
/**
 * dsh-my-remote — 设置页签（设置 → 插件 → 远程控制）单测（issue #385）。
 *
 * 需求：client 半通过官方 slots 扩展点 `settings.plugins.tab` 注册页签，可视化编辑
 * 本插件 4 项配置（apiToken 掩码 / askTimeoutMs / approvalTimeoutMs / webhooks[]）
 * → PUT /remote/settings/api/settings 保存写回 profile patch（行 id `remote`）并热生效。
 *
 * 本文件钉住七条底线：
 *  1. 页签注册成功（id **精确等于** `my-remote-settings`、order 数字、label 惰性函数、
 *     组件是函数），**且 slots 提供者 fiber 尚未 active 时也能注册**
 *     （cordis `ctx.get(name, strict=true)` 首屏返回 undefined → 必须 strict=false）；
 *  2. 页签 id 全局唯一：复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）；
 *  3. **文案按当前语言返回单语**（惰性 + 跟随 `<html lang>` / navigator.language：
 *     中文下不含英文对照，英文下不含中文）；
 *  4. 设置页样式走共享 installStyles（`data-dsh-my-remote-settings`），类名前缀
 *     `dsh-my-remote-settings`，只用宿主 CSS 变量（不硬编码色值）；
 *  5. **slots 缺失静默降级**（极简 ctx / 老宿主）：不抛错、不注册，样式照旧注入；
 *  6. 视图行为：加载 → 回填 → 编辑超时 / 增删改 webhook → 保存（PUT body 正确）→
 *     「已保存」提示；保存失败 / 加载失败都有明确提示（不静默）；
 *  7. **apiToken 掩码语义**：输入框是 password 型、界面不出现 token 明文、
 *     未输入时 PUT body **不含 apiToken 键**（host 半据此保持原值）。
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
  documentElement: { lang: '' },
  head,
  createElement: (tag) => (tag === 'style' ? makeStyleEl() : { tagName: String(tag).toUpperCase(), children: [] }),
  querySelector: () => null,
  querySelectorAll: () => [],
}

// ── locale 控制：文案按浏览器语言返回单语 ─────────────────────────────────
// 判据与仓库设置页惯例一致：优先 <html lang>（宿主 locale），回退 navigator.language。
function setLocale(lang) {
  global.document.documentElement.lang = lang
  Object.defineProperty(globalThis, 'navigator', { value: { language: lang }, configurable: true, writable: true })
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

/** 按 className 片段找全部元素。 */
function findAllByClass(nodes, fragment) {
  return nodes.filter((n) => typeof n.props?.className === 'string' && n.props.className.includes(fragment))
}

/** 按 className 片段找单个元素。 */
function findByClass(nodes, fragment) {
  return findAllByClass(nodes, fragment)[0]
}

/** 按 data-role 找元素（面板按钮众多，按角色定位比按文本/序号稳）。 */
function findByRole(nodes, role) {
  return nodes.find((n) => n.props?.['data-role'] === role)
}

/** fetch 桩：按 method 分派并记录调用。 */
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

const SETTINGS_URL = '/remote/settings/api/settings'

const SNAPSHOT = {
  apiTokenSet: true,
  askTimeoutMs: 0,
  approvalTimeoutMs: 0,
  webhooks: [{ name: '中转', url: 'https://relay.example.com/hook', events: ['ask'], enabled: true }],
}

test('设置页 tab 注册：id 精确唯一、slots 未 active 时也能注册（首屏时序防回归）', () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  assert.ok(state.tab, 'slots 服务 provider fiber 未 active 时也注册成功（ctx.get strict=false）')
  assert.equal(state.tab.options.name, 'settings.plugins.tab', '注册到官方设置页扩展点')
  assert.equal(state.tab.options.id, 'my-remote-settings', '页签 id 精确 = my-remote-settings（不与其它插件撞名）')
  assert.equal(typeof state.tab.options.order, 'number', 'order 为数字')
  assert.equal(typeof state.tab.options.label, 'function', 'label 是惰性函数（宿主靠重注册跟随语言切换）')
  assert.equal(state.tab.options.label(), '远程控制', '中文 locale 下页签 label 单语')
  assert.equal(typeof state.tab.component, 'function', '页签组件是函数')

  setLocale('en-US')
  try {
    const enLabel = state.tab.options.label()
    assert.equal(enLabel, 'Remote control', '英文 locale 下页签 label 单语：' + enLabel)
    assert.ok(!/[\u4e00-\u9fff]/.test(enLabel), '英文页签 label 不含中文：' + enLabel)
  } finally {
    setLocale('zh-CN')
  }
  assert.equal(state.tab.options.label(), '远程控制', '复位中文后 label() 又返回中文（惰性、无缓存）')
})

test('设置页样式走共享 installStyles，类名前缀与宿主变量（不硬编码色值）', () => {
  const { slots } = makeSlots()
  const before = styleTags.length
  exportsObj.apply(makeBootCtx({ slots }))
  const settingsStyle = styleTags.slice(before).find((s) => s.attrs['data-dsh-my-remote-settings'] === 'styles')
  assert.ok(settingsStyle, '注入 data-dsh-my-remote-settings="styles" 样式表')
  assert.ok(settingsStyle.textContent.includes('.dsh-my-remote-settings'), '样式类名前缀为 dsh-my-remote-settings')
  assert.ok(settingsStyle.textContent.includes('--dsw-'), '颜色/字号走宿主 --dsw-* 变量')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(settingsStyle.textContent), '不硬编码十六进制色值（主题自适应）')
  assert.ok(settingsStyle.textContent.includes('.dsh-my-remote-toggle'), '布尔项用开关样式')
})

test('拿不到 slots 服务 / ctx.get（极简 ctx、老宿主）时静默降级，样式照旧注入', () => {
  const { slots, state } = makeSlots()
  const ctx = makeBootCtx({ slots })
  ctx.get = () => undefined
  const before = styleTags.length
  assert.doesNotThrow(() => exportsObj.apply(ctx), '拿不到 slots 时不抛错')
  assert.equal(state.tab, null, '拿不到 slots 时不注册设置页签')
  assert.ok(
    styleTags.slice(before).some((s) => s.attrs['data-dsh-my-remote-settings'] === 'styles'),
    '样式仍注入（位置在任何早退分支之前）',
  )

  const bare = makeSlots()
  const bareCtx = { effect: (fn) => fn() }
  assert.doesNotThrow(() => exportsObj.apply(bareCtx), 'ctx.get 缺失时也不抛错')
  assert.equal(bare.state.tab, null, '没有服务查询能力时不注册设置页签')
})

/** 渲染设置页视图：加载配置 → 返回可断言的节点列表。 */
async function renderSettings(tabComponent) {
  hookState.length = 0
  effectDeps.length = 0
  resetHooks()
  tabComponent() // 首渲染「加载中…」，并触发 useEffect 里的配置 GET
  await flush()
  resetHooks()
  collect(tabComponent()) // 稳态渲染一次（后续断言各自 render()）
  return {
    render() {
      resetHooks()
      return collect(tabComponent())
    },
  }
}

test('视图：加载回填（token 不回显）+ 超时可编辑 + 保存 PUT body 正确', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch((method) =>
    method === 'GET' ? jsonRes({ ok: true, value: SNAPSHOT }) : jsonRes({ ok: true, value: SNAPSHOT }),
  )
  const view = await renderSettings(state.tab.component)

  assert.ok(
    calls.some((c) => c.method === 'GET' && c.url === SETTINGS_URL),
    'GET 拉取当前配置：' + SETTINGS_URL,
  )
  const text = textOf(view.render())
  assert.ok(!text.includes('super-secret'), '界面不出现 token 明文')
  const tokenInput = findByClass(view.render(), 'dsh-my-remote-input')
  assert.equal(tokenInput.props.type, 'password', 'token 输入框是密码型（不回显）')
  assert.equal(tokenInput.props.value, '', 'token 输入框初值为空（服务端只回 apiTokenSet）')
  assert.ok(text.includes('留空则不修改'), '提示「留空则不修改」：' + text)

  const numberInputs = findAllByClass(view.render(), 'dsh-my-remote-input').filter((n) => n.props.type === 'number')
  assert.equal(numberInputs.length, 2, '两个超时输入框')
  numberInputs[0].props.onChange({ target: { value: '5000' } })
  const edited = view.render()
  const editedNumbers = findAllByClass(edited, 'dsh-my-remote-input').filter((n) => n.props.type === 'number')
  assert.equal(editedNumbers[0].props.value, '5000', '超时输入生效')

  findByRole(edited, 'settings-save').props.onClick()
  await flush()
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put, '保存触发 PUT')
  assert.equal(put.url, SETTINGS_URL, 'PUT 打到设置端点')
  const body = JSON.parse(put.body)
  assert.equal(body.askTimeoutMs, 5000, 'PUT body 带新超时')
  assert.ok(!('apiToken' in body), 'token 未输入 → body 不含 apiToken 键（host 半保持原值）')
  assert.ok(textOf(view.render()).includes('已保存'), '保存成功有提示')
})

test('视图：输入新 token 后保存，PUT body 带 apiToken；成功后输入框清空', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  const calls = stubFetch(() => jsonRes({ ok: true, value: SNAPSHOT }))
  const view = await renderSettings(state.tab.component)

  findByClass(view.render(), 'dsh-my-remote-input').props.onChange({ target: { value: 'brand-new-token' } })
  const edited = view.render()
  findByRole(edited, 'settings-save').props.onClick()
  await flush()
  const put = calls.find((c) => c.method === 'PUT')
  assert.equal(JSON.parse(put.body).apiToken, 'brand-new-token', 'PUT body 带新 token')
  const after = view.render()
  assert.equal(findByClass(after, 'dsh-my-remote-input').props.value, '', '保存成功后 token 输入框清空（不回显）')
})

test('视图：webhooks 增 / 改 / 删 / 启停', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  // PUT 回显「提交内容」（真实 host 行为：保存后回新快照）
  // PUT 回显「提交内容」（真实 host 行为：保存后回新快照），否则草稿会被旧快照覆盖
  const calls = stubFetch((_method, _url, init) => {
    if (_method !== 'PUT') return jsonRes({ ok: true, value: SNAPSHOT })
    const body = JSON.parse(init.body)
    return jsonRes({ ok: true, value: { ...SNAPSHOT, ...body } })
  })
  const view = await renderSettings(state.tab.component)

  const saveBtnOf = (nodes) => findByRole(nodes, 'settings-save')
  const putBody = () => JSON.parse(calls.filter((c) => c.method === 'PUT').pop().body)

  // 启停：开关点击后 PUT body 里 enabled 翻转
  const toggle = findByClass(view.render(), 'dsh-my-remote-toggle')
  assert.equal(toggle.props['data-on'], 'true', '初始为启用')
  toggle.props.onClick()
  saveBtnOf(view.render()).props.onClick()
  await flush()
  assert.equal(putBody().webhooks[0].enabled, false, '启停落进 PUT body')

  // 改：点编辑 → 改 URL → 确定 → 保存
  const editBtn = findByRole(view.render(), 'webhook-edit')
  assert.ok(editBtn, '有编辑按钮')
  editBtn.props.onClick()
  const editorInputs = findAllByClass(view.render(), 'dsh-my-remote-webhook-input')
  assert.ok(editorInputs.length >= 2, '编辑器有名称/URL 输入框')
  editorInputs[1].props.onChange({ target: { value: 'https://new.example.com/hook' } })
  findByRole(view.render(), 'webhook-save').props.onClick()
  saveBtnOf(view.render()).props.onClick()
  await flush()
  assert.equal(putBody().webhooks[0].url, 'https://new.example.com/hook', '编辑后的 URL 落进 PUT body')

  // 删：删除走内联二次确认（UI 规范：破坏性操作必须二次确认，禁原生 confirm）
  findByRole(view.render(), 'webhook-delete').props.onClick()
  const confirming = view.render()
  const confirmBtn = findByRole(confirming, 'webhook-confirm-delete')
  assert.ok(confirmBtn, '删除前出现「确认删除」（二次确认，不静默删）')
  confirmBtn.props.onClick()
  saveBtnOf(view.render()).props.onClick()
  await flush()
  assert.deepEqual(putBody().webhooks, [], '确认后该条被删除')

  // 增：添加 → 填名称/URL → 确定 → 保存
  findByRole(view.render(), 'webhook-add').props.onClick()
  const addInputs = findAllByClass(view.render(), 'dsh-my-remote-webhook-input')
  addInputs[0].props.onChange({ target: { value: '手机' } })
  const addInputs2 = findAllByClass(view.render(), 'dsh-my-remote-webhook-input')
  addInputs2[1].props.onChange({ target: { value: 'https://phone.example.com/hook' } })
  findByRole(view.render(), 'webhook-save').props.onClick()
  saveBtnOf(view.render()).props.onClick()
  await flush()
  assert.equal(putBody().webhooks.length, 1, '新增一条')
  assert.equal(putBody().webhooks[0].name, '手机', '新增条目名称正确')
})

test('视图：保存失败有提示（不静默），加载失败给 404 针对性提示 + 重试', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch((method) =>
    method === 'GET' ? jsonRes({ ok: true, value: SNAPSHOT }) : jsonRes({ ok: false }, { ok: false, status: 400 }),
  )
  const view = await renderSettings(state.tab.component)
  findByRole(view.render(), 'settings-save').props.onClick()
  await flush()
  const failed = view.render()
  assert.ok(textOf(failed).includes('保存失败'), '保存失败有提示：' + textOf(failed))

  // 加载失败：404 → 说明服务端插件未加载 + 重试
  let attempts = 0
  const failSlots = makeSlots()
  exportsObj.apply(makeBootCtx({ slots: failSlots.slots }))
  stubFetch(() => {
    attempts += 1
    return jsonRes({ ok: false }, { ok: false, status: 404 })
  })
  const failView = await renderSettings(failSlots.state.tab.component)
  const failText = textOf(failView.render())
  assert.ok(failText.includes('配置加载失败'), '加载失败有提示：' + failText)
  assert.ok(failText.includes('404') || failText.includes('未加载'), '说明服务端插件未加载（404）：' + failText)
  findByRole(failView.render(), 'settings-retry').props.onClick()
  await flush()
  assert.ok(attempts >= 2, '重试真的重新拉取配置')
})

test('文案单语：中文 locale 不含英文对照，英文 locale 不含中文', async () => {
  const { slots, state } = makeSlots()
  exportsObj.apply(makeBootCtx({ slots }))
  stubFetch(() => jsonRes({ ok: true, value: SNAPSHOT }))
  const EN_SNAPSHOT = {
    ...SNAPSHOT,
    webhooks: [{ name: 'relay', url: SNAPSHOT.webhooks[0].url, events: ['ask'], enabled: true }],
  }

  const zhView = await renderSettings(state.tab.component)
  const zhText = textOf(zhView.render())
  assert.ok(zhText.includes('回答超时'), '中文含中文标签')
  assert.ok(!/Approval timeout|Answer timeout|Outbound webhooks/.test(zhText), '中文下不含英文对照：' + zhText)

  const enSlots = makeSlots()
  exportsObj.apply(makeBootCtx({ slots: enSlots.slots }))
  setLocale('en-US')
  try {
    hookState.length = 0
    effectDeps.length = 0
    stubFetch(() => jsonRes({ ok: true, value: EN_SNAPSHOT }))
    const enView = await renderSettings(enSlots.state.tab.component)
    const enText = textOf(enView.render())
    assert.ok(enText.includes('Answer timeout'), '英文含英文标签：' + enText)
    assert.ok(!/[\u4e00-\u9fff]/.test(enText), '英文 locale 下不含中文：' + enText)
  } finally {
    setLocale('zh-CN')
  }
})

test('静态断言：产物里 attachSettingsTab 恰好一份，地址 / id 与 host 半一致', () => {
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(bundleSrc.split('function attachSettingsTab(').length - 1, 1, '设置页 part 恰好注入一份')
  assert.ok(bundleSrc.includes("'my-remote-settings'"), '页签 id 字面量在产物里')
  assert.ok(bundleSrc.includes("'/remote/settings/api/settings'"), '配置端点与 host 侧路由一致')
  const hostSrc = fs.readFileSync(new URL('../lib/settings.js', import.meta.url), 'utf8')
  assert.ok(hostSrc.includes("'/remote/settings/api'"), 'host 侧注册同一地址前缀')
  const storeSrc = fs.readFileSync(new URL('../lib/settings-store.js', import.meta.url), 'utf8')
  assert.ok(storeSrc.includes("'remote'"), 'host 侧写回行 id 为 remote（与 cordis.patch.yml 一致）')
  const template = fs.readFileSync(new URL('../lib/client.src.js', import.meta.url), 'utf8')
  assert.equal(template.split('/*__PART_SETTINGS__*/').length - 1, 1, '模板占位符恰好一处')
})
