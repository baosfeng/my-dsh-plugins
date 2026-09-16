import { test } from 'vitest'
/**
 * Client-half config test（issue #355）：思考块展开初值来自配置项 defaultExpanded。
 *
 * 覆盖：
 *  ① defaultExpanded:true → 默认展开（既有行为不回归）；
 *  ② defaultExpanded:false → 默认折叠、流式中自动展开、完成后收起；
 *  ③ 配置缺失 / 非布尔 / 拉取失败 → 回退 true（绝不能变成折叠）；
 *  ④ 静态断言锁死源码初值走配置项（沿用外部 PR #356 的思路：运行时 stub
 *     锁不住源码字面量，必须直接断言随包产物的源码）。
 *
 * 加载方式与 client-render.mjs 一致：eval 两个 __ModuleLoader__ bundle，
 * 先 materialize dsh-md-render（本插件 require 它），react 用最小 stub。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

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

const registrations = []
global.window = {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  location: { href: 'http://127.0.0.1:3080/app', search: '' },
  confirm: () => true,
}
global.document = {
  head: { appendChild: () => {}, removeChild: () => {} },
  createElement: () => ({ setAttribute: () => {}, textContent: '' }),
}
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) })

eval(fs.readFileSync(new URL('../../dsh-md-render/lib/client.js', import.meta.url), 'utf8'))
eval(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
const mdRenderReg = registrations.find((r) => r.id === 'dsh-md-render')
const thinkReg = registrations.find((r) => r.id === 'dsh-think-zh-expand')
assert.ok(mdRenderReg && thinkReg, 'two bundles registered')
const mdRenderExports = mdRenderReg.factory((spec) => {
  if (spec === 'react') return stubbed
  throw new Error('unexpected require: ' + spec)
})
const exportsObj = thinkReg.factory((spec) => {
  if (spec === 'react') return stubbed
  if (spec === 'dsh-md-render') return mdRenderExports
  throw new Error('unexpected require: ' + spec)
})

/** 捕获 assistant-step 渲染器。 */
let capturedRenderer = null
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_name, fn) => (fn(), () => {}),
    register: (_desc, renderer) => ((capturedRenderer = renderer), () => {}),
  },
}
exportsObj.apply(ctx)
assert.equal(typeof capturedRenderer, 'function', 'assistant-step renderer captured')

/** 渲染一个 reasoning 块，返回 { hasBody, texts }。 */
function renderThink({ text = '第一行\n第二行', running = false } = {}) {
  const tree = capturedRenderer({
    node: { data: { status: running ? 'running' : 'ok', blocks: [{ kind: 'reasoning', text }] } },
  })
  let hasBody = false
  const texts = []
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const props = node.props ?? {}
    if (node.type === 'div' && String(props.className).includes('dsh-think-zh-expand-think-body')) hasBody = true
    if (typeof node.type === 'function') {
      walk(node.type(props))
      return
    }
    walk(props.children)
  }
  walk(tree)
  return { hasBody, texts }
}

test('① 默认（无配置）：仍为默认展开，既有行为不回归', () => {
  exportsObj.setDefaultExpanded(undefined)
  assert.equal(exportsObj.DEFAULT_EXPANDED, true, '默认值导出为 true')
  assert.equal(exportsObj.getDefaultExpanded(), true, '生效初值 true')
  const { hasBody, texts } = renderThink()
  assert.equal(hasBody, true, '思考正文默认展开')
  assert.ok(
    texts.some((t) => t.includes('第二行')),
    '展开内容可见',
  )
})

test('② defaultExpanded:false：默认折叠、流式中展开、完成后收起', () => {
  assert.equal(exportsObj.setDefaultExpanded({ defaultExpanded: false }), false, '显式 false 生效')
  const collapsed = renderThink()
  assert.equal(collapsed.hasBody, false, '初始折叠（无正文）')
  assert.ok(
    collapsed.texts.some((t) => t.includes('第一行')),
    '折叠态显示首行摘要',
  )

  const streaming = renderThink({ running: true })
  assert.equal(streaming.hasBody, true, '流式生成中自动展开')
  assert.ok(
    streaming.texts.some((t) => t.includes('第二行')),
    '流式内容可见',
  )

  const done = renderThink()
  assert.equal(done.hasBody, false, '流式结束后收起（expanded || running 的语义）')
})

test('③ 配置缺失 / 非布尔值 → 回退 true', () => {
  for (const config of [undefined, null, {}, { defaultExpanded: 'false' }, { defaultExpanded: 0 }]) {
    assert.equal(exportsObj.resolveDefaultExpanded(config), true, `resolve(${JSON.stringify(config)}) → true`)
  }
  assert.equal(exportsObj.setDefaultExpanded({}), true, '空配置应用后仍展开')
  assert.equal(exportsObj.getDefaultExpanded(), true)
  assert.equal(renderThink().hasBody, true, '配置缺失时渲染仍展开')
})

test('③b 拉取失败（reject / 非 ok / value 非对象）→ 保持默认展开', async () => {
  exportsObj.setDefaultExpanded(undefined)
  global.fetch = () => Promise.reject(new Error('offline'))
  await exportsObj.initConfigFromServer()
  assert.equal(exportsObj.getDefaultExpanded(), true, '网络失败保持 true')

  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false, value: {} }) })
  await exportsObj.initConfigFromServer()
  assert.equal(exportsObj.getDefaultExpanded(), true, 'ok!==true 保持 true')

  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: null }) })
  await exportsObj.initConfigFromServer()
  assert.equal(exportsObj.getDefaultExpanded(), true, 'value 非对象保持 true')

  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: { defaultExpanded: false } }) })
  await exportsObj.initConfigFromServer()
  assert.equal(exportsObj.getDefaultExpanded(), false, '读到配置后生效')
  assert.equal(renderThink().hasBody, false, '渲染按拉取到的配置折叠')

  const saved = global.fetch
  global.fetch = undefined
  await exportsObj.initConfigFromServer()
  assert.equal(exportsObj.getDefaultExpanded(), false, '无 fetch 时不改变现状也不抛错')
  global.fetch = saved
})

test('④ 静态断言：源码初值来自配置项，不再有硬编码 useState(true)', () => {
  const bundleSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // tsc 的 CommonJS 产物把 useState 调用 emit 成 (0, react_1.useState)(...)
  assert.ok(/useState\)?\(defaultExpanded\)/.test(bundleSrc), '展开初值读取配置项（源码级锁定）')
  // 只看可执行代码行：注释里提到「原硬编码 useState(true)」是文档，不算初值
  const codeLines = bundleSrc.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  assert.ok(!codeLines.some((line) => /useState\)?\(true\)/.test(line)), '硬编码 useState(true) 已移除')
  assert.ok(bundleSrc.includes("'/think-zh-expand/api/config'"), '读取地址与 host 侧路由一致')
  const hostSrc = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  // host 侧前缀常量 + '/config' 拼接（client 的 CONFIG_URL 与之一致）
  assert.ok(hostSrc.includes("'/think-zh-expand/api'"), 'host 侧注册同一地址前缀')
  assert.ok(hostSrc.includes('defaultExpanded'), 'host 侧暴露 defaultExpanded')
})
