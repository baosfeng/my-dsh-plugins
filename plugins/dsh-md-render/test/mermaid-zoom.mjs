/**
 * 图表缩放 / 平移（重构 v2）：作用域模型（[data-mdr-mm] → .mdr-mm-frame / .mdr-mm-canvas）。
 *
 * 判据（真产物 + 假 DOM + panzoom 桩）：
 *  · panzoom 走 assets 懒加载（首次真正需要才 fetch 一次），**不进 client.js**；
 *  · 作用域根 = 卡片（或全屏 dialog 体），事件绑在根上（指针偏出图形也能捏合）；
 *    裸 wheel 归页面，只有 ctrl+wheel / 全屏态才缩放；
 *  · 工具条动作 fit / fill / full / in / out 打到引擎；键盘 + - 0 与方向键平移；
 *  · 库拉不起来 → 内置降级引擎接管（绝不静默失效）；teardown 销毁实例。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeElement,
} from './support/fake-dom.mjs'

const SCOPE = 'mdr-mm-7'

/** panzoom 桩：记录构造函数参数与全部调用。 */
function panzoomStub() {
  const made = []
  function Panzoom(element, options) {
    const api = {
      element,
      options,
      scale: 1,
      calls: [],
      zoom(scale, opts) {
        api.calls.push(['zoom', scale, opts])
        api.scale = scale
        return scale
      },
      pan(x, y, opts) {
        api.calls.push(['pan', x, y, opts])
        return { x, y }
      },
      reset(opts) {
        api.calls.push(['reset', opts])
        api.scale = 1
        return { x: 0, y: 0 }
      },
      getScale: () => api.scale,
      destroy() {
        api.destroyed = true
      },
    }
    made.push(api)
    return api
  }
  Panzoom.made = made
  return Panzoom
}

/** 夹具：作用域根（卡片）> 裁剪容器（.mdr-mm-frame）> 变换层（.mdr-mm-canvas）> svg。 */
function setup({ panzoom = true } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const root = makeElement('div', {
    className: 'mdr-mm-card mdr-root',
    'data-mdr-mm': SCOPE,
    'data-mdr-mermaid': 'true',
  })
  const frame = makeElement('div', { className: 'mdr-mm-body mdr-mm-frame' })
  const box = makeElement('div', { className: 'mdr-mm-canvas' })
  const svg = makeElement('svg')
  svg.viewBox = { baseVal: { width: 600, height: 400 } }
  svg._rect = { width: 300, height: 200 }
  box.appendChild(svg)
  frame.appendChild(box)
  root.appendChild(frame)
  scroll.appendChild(root)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  if (panzoom) globalThis.window.Panzoom = panzoomStub()
  else delete globalThis.window.Panzoom
  return { page, loaded, root, frame, box, svg, Panzoom: globalThis.window.Panzoom }
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
const zooms = (api) => api.calls.filter((call) => call[0] === 'zoom')

test('懒加载：首次真正需要缩放时才 fetch panzoom（单一真源 URL）', async () => {
  const Panzoom = panzoomStub()
  const fetched = []
  const original = globalThis.fetch
  globalThis.fetch = (url) => {
    const href = String(url)
    fetched.push(href)
    if (!href.includes('panzoom')) return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    globalThis.window.Panzoom = Panzoom
    return Promise.resolve({ ok: true, text: () => Promise.resolve('/* umd */') })
  }
  try {
    const f = setup({ panzoom: false })
    assert.equal(fetched.length, 0, 'apply 不动手加载（懒）')
    f.loaded.exports.zoomEntry(SCOPE, 'in')
    await settle()
    assert.deepEqual(fetched, ['/md-render/assets/panzoom-4.6.2.min.js'], 'fetch 单一真源 URL')
    assert.equal(Panzoom.made.length, 1, '构造函数调用一次')
    assert.equal(Panzoom.made[0].element, f.box, '作用在自有变换层上')
    assert.equal(Panzoom.made[0].options.zoomWithWheel, false, '裸 wheel 交给页面')
    assert.equal(Panzoom.made[0].options.maxScale, 2, '缩放上界（ZOOM_MAX）')
  } finally {
    globalThis.fetch = original
  }
})

test('工具条动作：绑定即 fit；in / out / full / fit 分别打到引擎', async () => {
  const f = setup()
  f.loaded.exports.zoomEntry(SCOPE, 'fit')
  await settle()
  const api = f.Panzoom.made[0]
  assert.ok(api, '已绑定')
  assert.ok(zooms(api).length >= 1, '绑定即适应容器')
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, true, 'fit 动作后处于 fitMode')
  const before = api.scale
  f.loaded.exports.zoomEntry(SCOPE, 'in')
  await settle()
  assert.equal(api.scale, Math.min(2, before * 1.25), 'in 放大一档（1.25x，上界 2）')
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '手动缩放退出 fitMode')
  const bigger = api.scale
  f.loaded.exports.zoomEntry(SCOPE, 'out')
  await settle()
  assert.ok(api.scale < bigger, 'out 缩小')
  f.loaded.exports.zoomEntry(SCOPE, 'full')
  await settle()
  assert.equal(api.scale, 600 / 300, '100% = 真实像素（viewBox 宽 / 显示宽）')
  f.loaded.exports.zoomEntry(SCOPE, 'fit')
  await settle()
  assert.ok(f.loaded.exports.zoomStates.get(f.box).fitMode, 'fit 回到保持态')
})

test('键盘 a11y：+ / - 缩放，0 复位，方向键平移（绑在作用域根上）', async () => {
  const f = setup()
  f.loaded.exports.zoomEntry(SCOPE, 'in')
  await settle()
  const api = f.Panzoom.made[0]
  api.calls.length = 0
  f.root.fire('keydown', { key: '+', preventDefault() {} })
  assert.deepEqual(api.calls.at(-1).slice(0, 2), ['zoom', Math.min(2, 1.25 * 1.25)], '+ 放大一档')
  f.root.fire('keydown', { key: '0', preventDefault() {} })
  assert.equal(api.calls.at(-1)[0], 'reset', '0 = 复位')
  f.root.fire('keydown', { key: 'ArrowRight', preventDefault() {} })
  assert.equal(api.calls.at(-1)[0], 'pan', '方向键平移')
})

test('滚轮策略：裸 wheel 归页面；ctrl+wheel 缩放并 preventDefault', async () => {
  const f = setup()
  f.loaded.exports.zoomEntry(SCOPE, 'in')
  await settle()
  const api = f.Panzoom.made[0]
  api.calls.length = 0
  let prevented = 0
  f.root.fire('wheel', { deltaY: -120, preventDefault: () => (prevented += 1) })
  assert.equal(api.calls.length, 0, '裸 wheel 不拦')
  assert.equal(prevented, 0)
  f.root.fire('wheel', { ctrlKey: true, deltaY: -120, preventDefault: () => (prevented += 1) })
  assert.equal(api.calls.at(-1)[0], 'zoom', 'ctrl+wheel（捏合）缩放')
  assert.equal(prevented, 1, '阻止页面缩放')
})

test('双击 = 适应 ↔ 实际大小（按 fitMode 判断）', async () => {
  const f = setup()
  f.loaded.exports.zoomEntry(SCOPE, 'fit')
  await settle()
  const api = f.Panzoom.made[0]
  f.box.fire('dblclick', {})
  assert.equal(api.scale, 2, 'fitMode 下双击 → 100%（600/300 被 ZOOM_MAX=2 夹住）')
  f.box.fire('dblclick', {})
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, true, '再双击 → 适应')
})

test('panzoom 拉取失败 → 内置降级引擎接管（按钮不失效）', async () => {
  const f = setup({ panzoom: false })
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })
  try {
    f.loaded.exports.zoomEntry(SCOPE, 'in')
    await settle()
    const state = f.loaded.exports.zoomStates.get(f.box)
    assert.ok(state, '降级引擎也登记了状态')
    assert.equal(f.frame.getAttribute('data-mdr-mm-engine'), 'attribute', '降级引擎标记')
    assert.equal((f.root._listeners.wheel || []).length, 1, '滚轮事件仍接管')
  } finally {
    globalThis.fetch = original
  }
})

test('teardown / destroyZoomScope：销毁实例并清表', async () => {
  const f = setup()
  f.loaded.exports.zoomEntry(SCOPE, 'in')
  await settle()
  const api = f.Panzoom.made[0]
  f.loaded.exports.destroyZoomScope(SCOPE)
  assert.equal(api.destroyed, true, '作用域卸载时销毁引擎')
  assert.equal(f.loaded.exports.zoomStates.get(f.box), undefined, '状态已清')
  f.loaded.exports.teardownZoom()
  assert.equal(f.loaded.exports.zoomStates.size, 0, 'teardown 清空全部')
})
