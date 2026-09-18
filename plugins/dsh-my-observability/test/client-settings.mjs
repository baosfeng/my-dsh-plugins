/**
 * dsh-my-observability — 设置页页签契约测试（issue #383）。
 *
 * 设置 → 插件 → 可观测性 页签经宿主原生 slots 扩展点注册：
 *  1. 用 `ctx.get('slots', false)`（**strict=false**：首屏时 slots 提供者
 *     fiber 可能尚未 active，strict 模式返回 undefined 会让页签静默消失）；
 *  2. `slots.inject('settings.plugins.tab', …)` + `slots.register`，descriptor
 *     的 name 必须是槽位名、id 全局唯一、label 惰性求值（中英双语）；
 *  3. slots 服务缺失（精简上下文/插件未加载）时静默跳过，不影响两个原生面板；
 *  4. 视图：GET 回填 → 改开关/超时 → PUT 保存（成功/失败提示）。
 *
 * 这些断言在实现前全部失败（当时 client 端没有任何设置页注册）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const BUNDLE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const SETTINGS_SLOT = 'settings.plugins.tab'
const SETTINGS_ID = 'dsh-my-observability-settings'
const CONFIG_API = '/observability/api/config'
/** 根元素类名前缀（样式规范：只用自己的前缀 + 宿主 CSS 变量）。 */
const CLASS_PREFIX = 'dsh-my-observability-settings'

// ── 最小 react 桩（每次 mount 独立 hook 状态，支持 setState 后重渲染）──────
function createRoot() {
  const states = []
  const effects = []
  let component = () => null
  let componentProps = {}
  let cursor = 0
  let dirty = false
  let ranEffects = false
  let tree = null
  const react = {
    createElement(type, elementProps, ...children) {
      const p = elementProps ? { ...elementProps } : {}
      if (children.length === 1) p.children = children[0]
      else if (children.length > 1) p.children = children
      return { type, props: p }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [
        states[index],
        (next) => {
          states[index] = typeof next === 'function' ? next(states[index]) : next
          dirty = true
        },
      ]
    },
    useEffect(effect) {
      effects.push(effect)
    },
  }
  /**
   * 展开函数组件（React 语义：桩的 createElement 只建元素对象，不执行组件，
   * 不展开就只看到宿主元素、看不到组件渲染出的开关/输入框）。
   * 子组件本身不用 hooks（只有视图根组件用），展开前后恢复 cursor，
   * 避免污染根组件的 hook 序号。
   */
  const expand = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node.type === 'function') {
      const saved = cursor
      const rendered = expand(node.type(node.props))
      cursor = saved
      return rendered
    }
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } }
  }
  const render = () => {
    cursor = 0
    tree = expand(component(componentProps))
    if (!ranEffects) {
      ranEffects = true
      for (const effect of effects.splice(0)) effect()
    }
    return tree
  }
  return {
    react,
    render,
    /** 挂载视图组件（首次渲染 + 运行 effect）。 */
    mount(comp, props) {
      component = comp
      componentProps = props ?? {}
      return render()
    },
    tree: () => tree,
    /** 冲刷微任务 + 重渲染，直到状态稳定（fetch promise 链需要多轮）。 */
    async settle(rounds = 6) {
      for (let i = 0; i < rounds; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (dirty) {
          dirty = false
          render()
        }
      }
    },
  }
}

/** 加载 bundle，返回 { exports, root, calls, slotsState, ctx }。 */
function harness({ config, configStatus = 200, putOk = true } = {}) {
  const slotsState = { injected: [], registered: [] }
  const slots = {
    inject(name, factory) {
      slotsState.injected.push(name)
      return factory()
    },
    register(descriptor, comp) {
      slotsState.registered.push({ descriptor, component: comp })
      return () => {}
    },
  }
  const calls = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    get(name, strict) {
      calls.push({ kind: 'get', name, strict })
      return name === 'slots' ? slots : undefined
    },
    slots,
    sidebarRightTabs: { register: () => () => {} },
  }
  // HTTP 响应桩：ok 由各自分支决定（PUT 的成败单独由 putOk 控制，
  // 否则失败的 PUT 会被 get 的状态码带成「成功」→ 误报已保存）。
  const jsonOfResponse = (ok, value) => ({ ok, status: ok ? 200 : 500, json: async () => value })
  globalThis.fetch = (url, init) => {
    calls.push({ kind: 'fetch', url, method: init?.method ?? 'GET', body: init?.body })
    if ((init?.method ?? 'GET') === 'PUT') {
      return Promise.resolve(
        putOk
          ? jsonOfResponse(true, { ok: true, value: { aiReview: false, aiTimeoutMs: 60000 } })
          : jsonOfResponse(false, { ok: false, error: { message: 'save failed' } }),
      )
    }
    return Promise.resolve(
      configStatus === 200
        ? jsonOfResponse(true, { ok: true, value: config ?? { aiReview: true, aiTimeoutMs: 60000 } })
        : jsonOfResponse(false, { ok: false, error: { message: `HTTP ${configStatus}` } }),
    )
  }
  let registeredDef = null
  const windowMock = {
    __ModuleLoader__: { load: (def) => (registeredDef = def) },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  globalThis.window = windowMock
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  new Function('window', BUNDLE)(windowMock)
  assert.ok(registeredDef, 'bundle 必须向 __ModuleLoader__ 注册自己')

  // 先建 root（react 桩），再让 bundle 的 require('react') 返回同一个桩
  // （bundle 在 factory 调用时解构 createElement/useState/useEffect）。
  const root = createRoot()
  const exportsObj = registeredDef.factory((spec) => {
    assert.equal(spec, 'react', 'client bundle 只允许 require react')
    return root.react
  })
  exportsObj.apply(ctx)
  const seat = slotsState.registered.find((entry) => entry.descriptor.name === SETTINGS_SLOT)
  if (seat !== undefined) root.mount(seat.component, {})
  return { exportsObj, root, calls, slotsState, ctx, seat }
}

/** 递归收集元素（含 children 数组）。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  findAll(node.props?.children, predicate, out)
  return out
}

/** 汇总元素的文本内容（字符串 children 拼接）。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function setNavigator(language) {
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
}

test('设置页页签经 ctx.get(slots, strict=false) + inject(settings.plugins.tab) 注册', () => {
  const { slotsState, calls } = harness()
  const getCall = calls.find((call) => call.kind === 'get' && call.name === 'slots')
  assert.ok(getCall, '必须经 ctx.get 读取 slots 服务（client 端不声明 slots 为硬依赖）')
  assert.equal(getCall.strict, false, 'strict 必须为 false：首屏提供者 fiber 未 active 时也不丢页签')
  assert.deepEqual(slotsState.injected[0], SETTINGS_SLOT, '设置页签注册必须发生在侧边栏席位注册之前')
  assert.ok(slotsState.injected.includes(SETTINGS_SLOT))
  const seat = slotsState.registered.find((entry) => entry.descriptor.name === SETTINGS_SLOT)
  assert.ok(seat, '必须注册 settings.plugins.tab 席位')
  assert.equal(seat.descriptor.id, SETTINGS_ID)
  assert.equal(typeof seat.component, 'function')
})

test('设置页页签 label 惰性求值且中英双语', () => {
  const { seat } = harness()
  setNavigator('zh-CN')
  assert.equal(seat.descriptor.label(), '可观测性')
  setNavigator('en-US')
  assert.equal(seat.descriptor.label(), 'Observability')
})

test('slots 服务缺失时静默跳过：不抛错、两个原生面板照常注册', () => {
  const ctx = {
    effect: (fn) => fn(),
    get: () => undefined,
    sidebarRightTabs: { register: () => () => {} },
  }
  let registeredDef = null
  const windowMock = {
    __ModuleLoader__: { load: (def) => (registeredDef = def) },
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  globalThis.window = windowMock
  new Function('window', BUNDLE)(windowMock)
  const exportsObj = registeredDef.factory(() => ({
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
  }))
  exportsObj.apply(ctx)
  assert.deepEqual(exportsObj.inject, ['slots', 'sidebarRightTabs'])
})

test('设置视图：GET 回填当前配置，渲染开关 + 超时输入 + 保存按钮', async () => {
  const { root } = harness({ config: { aiReview: true, aiTimeoutMs: 45000 } })
  root.render()
  await root.settle()
  const tree = root.tree()

  const rootNode = findAll(
    tree,
    (node) => typeof node.props?.className === 'string' && node.props.className.startsWith(CLASS_PREFIX),
  )[0]
  assert.ok(rootNode, `设置视图根元素类名必须以 ${CLASS_PREFIX} 开头`)

  const toggle = findAll(tree, (node) => node.props?.role === 'switch')[0]
  assert.ok(toggle, '必须有 AI 审查增强开关（role=switch）')
  assert.equal(toggle.props['data-on'], 'true', '开关状态来自 GET 回填')

  const input = findAll(tree, (node) => node.type === 'input' && node.props?.type === 'number')[0]
  assert.ok(input, '必须有 AI 审查超时数字输入')
  assert.equal(String(input.props.value), '45000')

  const saveButton = findAll(tree, (node) => node.type === 'button' && /保存|Save/.test(textOf(node)))[0]
  assert.ok(saveButton, '必须有保存按钮')
})

test('设置视图：改开关后保存 → PUT /observability/api/config，成功提示已保存', async () => {
  const { root, calls } = harness({ config: { aiReview: false, aiTimeoutMs: 45000 } })
  root.render()
  await root.settle()

  const toggle = findAll(root.tree(), (node) => node.props?.role === 'switch')[0]
  toggle.props.onClick()
  await root.settle()
  assert.equal(findAll(root.tree(), (node) => node.props?.role === 'switch')[0].props['data-on'], 'true')

  const saveButton = findAll(root.tree(), (node) => node.type === 'button' && /保存|Save/.test(textOf(node)))[0]
  saveButton.props.onClick()
  await root.settle()

  const put = calls.find((call) => call.kind === 'fetch' && call.method === 'PUT')
  assert.ok(put, '保存必须 PUT 到配置端点')
  assert.equal(put.url, CONFIG_API)
  assert.deepEqual(JSON.parse(put.body), { aiReview: true, aiTimeoutMs: 45000 })
  assert.match(textOf(root.tree()), /已保存|Saved/, '保存成功必须有成功提示')
})

test('设置视图：保存失败提示失败（配置不被误认为已保存）', async () => {
  const { root } = harness({ putOk: false })
  root.render()
  await root.settle()
  const saveButton = findAll(root.tree(), (node) => node.type === 'button' && /保存|Save/.test(textOf(node)))[0]
  saveButton.props.onClick()
  await root.settle()
  const text = textOf(root.tree())
  assert.match(text, /保存失败|Save failed/)
  assert.ok(!/已保存|Saved/.test(text), '失败时不得显示成功提示')
})

test('设置视图：配置加载失败给出提示与重试', async () => {
  const { root } = harness({ configStatus: 500 })
  root.render()
  await root.settle()
  const text = textOf(root.tree())
  assert.match(text, /加载失败|Load failed/)
  assert.ok(
    findAll(root.tree(), (node) => node.type === 'button' && /重试|Retry/.test(textOf(node)))[0],
    '必须有重试按钮',
  )
})
