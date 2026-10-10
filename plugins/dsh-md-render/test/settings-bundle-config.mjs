/**
 * 设置入口适配 DSH >= 0.1.7 插件管理器（issue #443 的「追加不替换」落地）。
 *
 * 新版插件管理器（client-ui-plugin-manager）把插件配置页放在**组合包详情页**，
 * 由它自己声明 `plugins.bundle.config`（keyed slot，key = 组合包 npm 包名，仅在
 * view: 'page' 时渲染；摘要/列表页不渲染）。旧版入口 `settings.plugins.tab`
 * 在 DSH < 0.1.7（以及「设置 → 内置插件」分区）仍然有效，因此本插件**两个都注册**：
 * 追加，不替换。本文件把这条契约钉死（断言对象是构建产物 lib/client.js）。
 *
 * 覆盖（先红后绿）：
 *  1. 注册契约：`plugins.bundle.config` 已注册、key === package.json 的 name；
 *  2. 视图契约：`view === 'summary'` → null；`'page'` / 缺省 → 同一设置页且开关可用；
 *  3. 防回退：旧 `settings.plugins.tab` 注册仍在（「追加不替换」的核心保证）；
 *  4. 反向验证：不注册重复的 section 名（各 slot 恰好一次）、不覆盖官方内置 key
 *     （不得占用出厂组合包 @deepseek-ai/dsh-experimental-voice-input-bundle）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPage, installGlobals, loadBundle } from './support/fake-dom.mjs'

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
/** 出厂已占用 plugins.bundle.config key 的内置组合包（slot 契约 keyDomain）。 */
const SHIPPED_BUNDLE_KEY = '@deepseek-ai/dsh-experimental-voice-input-bundle'

/** 带状态槽的 react 桩：hook 索引按渲染顺序共享，状态跨渲染保留（React hook 链表语义）。 */
function createStatefulReact() {
  let hookIndex = 0
  const hookState = []
  const effectRan = []
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.flat() },
  })
  return {
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
      if (effectRan[i] === true) return
      effectRan[i] = true
      fn()
    },
    /** 模拟组件重新挂载：清空 hook 记忆（状态 + effect 已跑标记）。 */
    reset() {
      hookIndex = 0
      hookState.length = 0
      effectRan.length = 0
    },
    /** 模拟同一次挂载内的重渲染：只归零索引，保留状态。 */
    rerender() {
      hookIndex = 0
    },
  }
}

/** mock slots 服务：记录 inject 顺序与每次 register 的 (name, options, component)。 */
function makeSlots() {
  const state = { injected: [], registered: [], teardowns: 0 }
  const slots = {
    inject(name, register) {
      state.injected.push(name)
      state.registered.push({ name, ...register() })
      // 宿主契约：inject 返回 disposer（真实 cordis 里由 effect 负责回收）。
      return () => {
        state.teardowns += 1
      }
    },
    register(options, component) {
      return { options, component }
    },
  }
  return { slots, state }
}

/** 启动插件（ctx.get('slots', false) 拿服务；effect 立即执行并记录 label）。 */
function boot() {
  const page = installGlobals(createPage())
  const react = createStatefulReact()
  const loaded = loadBundle({ page, react })
  const { slots, state } = makeSlots()
  const labels = []
  const effectTeardowns = []
  const ctx = {
    effect: (fn, label) => {
      labels.push(label)
      const teardown = fn()
      if (typeof teardown === 'function') effectTeardowns.push({ label, teardown })
      return teardown
    },
    get: (name, strict = true) => (strict ? undefined : slots),
  }
  globalThis.fetch = () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, value: {} }) })
  loaded.exports.apply(ctx)
  return { page, react, loaded, slots, state, labels, effectTeardowns }
}

/** 取某个 slot 的注册记录（name 精确匹配）。 */
function registrationOf(state, name) {
  return state.registered.find((r) => r.name === name)
}

/** 展开元素树为节点列表（函数组件节点被调用展开；字符串节点收成 { text }）。 */
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
  collect(node.props && node.props.children, out)
  return out
}

/** 按 className 片段找节点。 */
function findByClass(nodes, fragment) {
  return nodes.find((n) => typeof (n.props && n.props.className) === 'string' && n.props.className.includes(fragment))
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 渲染设置视图：首渲染（「加载中…」+ 触发 GET）→ 等 flush → 重渲染取可断言节点。
 * `props` 为 undefined 即模拟老宿主不传 props（缺省分支）。
 */
async function renderView(react, component, props) {
  react.reset()
  component(props)
  await flush()
  react.rerender()
  return collect(component(props))
}

test('注册契约：plugins.bundle.config 已注册，key === package.json 的 name', () => {
  const { state } = boot()
  const reg = registrationOf(state, 'plugins.bundle.config')
  assert.ok(reg, 'bundle 详情页配置 slot 已注册：' + JSON.stringify(state.injected))
  assert.equal(reg.options.name, 'plugins.bundle.config', '注册到新版插件管理器的 bundle 详情页 slot')
  assert.equal(typeof reg.options.key, 'string', 'keyed slot 必须带 key')
  assert.equal(reg.options.key, PKG.name, 'key 必须是组合包 npm 包名（宿主按包名派发）')
  assert.equal(typeof reg.component, 'function', 'bundle 配置组件是函数')
})

test('防回退（追加不替换）：旧 settings.plugins.tab 注册仍在', () => {
  const { state } = boot()
  const tab = registrationOf(state, 'settings.plugins.tab')
  assert.ok(tab, '旧版入口一并保留（兼容 DSH < 0.1.7 / 设置→内置插件）：' + JSON.stringify(state.injected))
  assert.equal(tab.options.id, 'md-render-settings', '旧页签 id 不变')
  assert.equal(typeof tab.options.order, 'number', '旧页签 order 仍是数字')
  assert.equal(typeof tab.options.label, 'function', '旧页签 label 仍是惰性函数')
  assert.equal(typeof tab.component, 'function', '旧页签组件是函数')
})

test('反向验证：两个扩展点各注册恰好一次（不重复注册 section 名）', () => {
  const { state } = boot()
  const counts = state.injected.reduce((acc, name) => ({ ...acc, [name]: (acc[name] || 0) + 1 }), {})
  assert.deepEqual(
    counts,
    { 'settings.plugins.tab': 1, 'plugins.bundle.config': 1 },
    '每个 slot 恰好注入一次：' + JSON.stringify(counts),
  )
  assert.deepEqual(
    [...new Set(state.injected)].sort(),
    ['plugins.bundle.config', 'settings.plugins.tab'],
    '只注册这两个加法型扩展点',
  )
})

test('反向验证：不覆盖官方内置 key（不占用出厂组合包的 bundle.config）', () => {
  const { state } = boot()
  const keys = state.registered.filter((r) => r.name === 'plugins.bundle.config').map((r) => r.options.key)
  assert.equal(keys.includes(SHIPPED_BUNDLE_KEY), false, '不得占用出厂已注册的 key：' + SHIPPED_BUNDLE_KEY)
  assert.deepEqual(keys, [PKG.name], '只注册自己的包名')
  assert.notEqual(PKG.name, SHIPPED_BUNDLE_KEY, '本插件包名不得与出厂 key 相同')
})

test('视图契约：view === "summary" 返回 null（摘要/列表页不占位）', () => {
  const { state } = boot()
  const reg = registrationOf(state, 'plugins.bundle.config')
  assert.equal(reg.component({ view: 'summary' }), null, 'summary 视图必须返回 null')
})

test('视图契约：view === "page" 与缺省都渲染同一设置页且开关可用', async () => {
  const { react, state } = boot()
  const reg = registrationOf(state, 'plugins.bundle.config')
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, value: { markdown: {}, thinking: {}, mermaid: {} } }),
    })

  for (const props of [{ view: 'page' }, undefined]) {
    const nodes = await renderView(react, reg.component, props)
    const root = findByClass(nodes, 'dsh-md-render-settings')
    assert.ok(
      root,
      'view=' +
        JSON.stringify(props) +
        ' 渲染设置页：' +
        JSON.stringify(nodes.map((n) => n.props && n.props.className)),
    )
    const toggles = nodes.filter(
      (n) =>
        typeof (n.props && n.props.className) === 'string' &&
        n.props.className.includes('dsh-md-render-settings-toggle'),
    )
    assert.equal(toggles.length, 6, '三分组共 6 个开关可用（view=' + JSON.stringify(props) + '）')
    for (const toggle of toggles) {
      assert.equal(toggle.props.role, 'switch', '开关有 role=switch')
      assert.equal(typeof toggle.props.onClick, 'function', '开关可点击')
    }
  }

  // page 与缺省渲染同一份视图组件（不是两套实现）
  const pageNodes = await renderView(react, reg.component, { view: 'page' })
  const defaultNodes = await renderView(react, reg.component, undefined)
  assert.deepEqual(
    defaultNodes.map((n) => (n.props && n.props.className) || n.text),
    pageNodes.map((n) => (n.props && n.props.className) || n.text),
    '缺省 view 与 page 渲染同一设置页',
  )
  // 复用同一份设置页实现：bundle 配置视图（page）与旧 tab 视图渲染出同一棵元素树
  const tabReg = registrationOf(state, 'settings.plugins.tab')
  const tabNodes = await renderView(react, tabReg.component, undefined)
  assert.deepEqual(
    pageNodes.map((n) => (n.props && n.props.className) || n.text),
    tabNodes.map((n) => (n.props && n.props.className) || n.text),
    'bundle 配置视图复用同一份设置页实现（与旧页签渲染同构）',
  )
})

test('生命周期：两处注册在同一个 effect 里（宿主 fiber 回收；effect 自身无额外 teardown）', () => {
  const { slots, state, labels, effectTeardowns } = boot()
  // 两处 slot 注册都在 'settings tab registration' 这一个 effect 内完成：
  // 宿主 cordis 在 fiber 卸载时按 effect 回收，插件不需要（也不应）自持 disposer。
  assert.equal(
    labels.filter((l) => String(l).includes('settings tab registration')).length,
    1,
    '设置页注册只有一个 effect：' + JSON.stringify(labels),
  )
  assert.deepEqual(
    state.injected,
    ['settings.plugins.tab', 'plugins.bundle.config'],
    '两处注册在同一 effect 内按序执行',
  )
  assert.equal(
    effectTeardowns.some((e) => String(e.label).includes('settings tab registration')),
    false,
    '该 effect 不返回额外 teardown（回收交给宿主 slots 服务）',
  )
  // 宿主契约：inject 返回 disposer（本插件不持有，但接口必须成立，不抛错）
  const disposer = slots.inject('__probe__', () => undefined)
  assert.equal(typeof disposer, 'function', 'slots.inject 返回 disposer')
  disposer()
  assert.ok(
    labels.some((l) => String(l).includes('settings tab registration')),
    '设置页注册仍在同一个 effect label 下：' + JSON.stringify(labels),
  )
})
