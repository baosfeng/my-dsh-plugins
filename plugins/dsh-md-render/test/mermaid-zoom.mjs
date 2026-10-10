/**
 * 需求 1（issue #470）：图表全屏 + 缩放 / 平移。
 *
 * 判据（真产物 + 假 DOM + panzoom 桩）：
 *  · panzoom 走 **assets 懒加载**（首次真正需要缩放才 fetch 一次），**不进 client.js**；
 *  · 绑定对象是**本插件自有的 SVG 容器**（硬约束：不碰官方元素）；同一容器只绑一次；
 *  · 缩放动作 Fit / 100% / ± 打到库的对应 API；
 *  · 键盘 a11y：0 复位 / + - 缩放 / 方向键平移 / Esc 退出降级 overlay；
 *  · 裸 wheel 归页面（滚动陷阱）—— 只有 ctrlKey+wheel（捏合）或**全屏态**才缩放；
 *  · 全屏优先原生 API，**不支持（iPhone Safari）降级卡片内 overlay**；退出后缩放状态保留；
 *  · 库加载失败 → 静默保持静态图（真降级），且下次点击可重试。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const ENTRY = 'dsh-md-render-mermaid-7'
const FS_ATTR = 'data-dsh-md-render-fs'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** panzoom 桩：构造函数 + 实例记录全部调用。 */
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
      setOptions() {},
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

/** 夹具：自有 DOM 契约（host[entryId] > card > svg 容器）。 */
function setup({ Panzoom = panzoomStub(), fullscreen = true } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  const host = makeElement('div', { className: 'dsh-md-render-mermaid-host', 'data-dsh-md-render-mermaid': ENTRY })
  const card = makeElement('div', { className: 'dsh-md-render-mermaid-card' })
  // 两层自有 DOM：外层 frame（滚动 / 缩放态裁剪）+ 内层 canvas（panzoom 只变换它）
  const frame = makeElement('div', { className: 'dsh-md-render-mermaid-svg' })
  const box = makeElement('div', { className: 'dsh-md-render-mermaid-canvas' })
  if (fullscreen) card.requestFullscreen = () => Promise.resolve()
  frame.appendChild(box)
  card.appendChild(frame)
  host.appendChild(card)
  block.appendChild(host)
  scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, scroll, block, host, card, frame, box, Panzoom }
}

test('懒加载：只在首次真正需要缩放时 fetch 一次 panzoom assets（不进 client.js）', async () => {
  const Panzoom = panzoomStub()
  const fetched = []
  const original = globalThis.fetch
  globalThis.fetch = (url) => {
    const href = String(url)
    fetched.push(href)
    if (!href.includes('panzoom'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: {} }) })
    globalThis.window.Panzoom = Panzoom // 模拟 <script> 注入后落 window.Panzoom
    return Promise.resolve({ ok: true, text: () => Promise.resolve('/* umd */') })
  }
  try {
    const f = setup({ Panzoom: undefined })
    const panzoomFetches = () => fetched.filter((u) => u.includes('panzoom'))
    assert.equal(panzoomFetches().length, 0, 'apply 不动手加载（懒）')
    f.loaded.exports.zoomEntry(ENTRY, 'in')
    await settle()
    assert.deepEqual(panzoomFetches(), ['/md-render/assets/panzoom-4.6.2.min.js'], 'fetch 单一真源 URL')
    assert.equal(Panzoom.made.length, 1, '构造函数被调用一次')
    assert.equal(Panzoom.made[0].element, f.box, '作用在**自有**变换层上')
    assert.equal(Panzoom.made[0].options.zoomWithWheel, false, '裸 wheel 交给页面（滚动陷阱）')
    assert.equal(Panzoom.made[0].options.touchAction, 'pan-y', '触屏纵向滚动仍归页面')
    assert.equal(Panzoom.made[0].options.maxScale, 8, '缩放上界')
    assert.equal(f.frame.getAttribute('data-dsh-md-render-zoom'), 'on', '外层容器切到裁剪态（放大后不盖住工具条）')

    f.loaded.exports.zoomEntry(ENTRY, 'out')
    await settle()
    assert.equal(panzoomFetches().length, 1, '已加载则不重复 fetch')
    assert.equal(Panzoom.made.length, 1, '同容器只绑一次（幂等）')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('Fit / 100% / ± 打到库的对应 API', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  const { loaded } = f
  loaded.exports.zoomEntry(ENTRY, 'in') // 首次调用只负责懒加载 + 绑定
  await settle()
  const api = Panzoom.made[0]
  assert.ok(api, '已绑定')
  loaded.exports.zoomEntry(ENTRY, 'fit')
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], 'Fit = reset')
  loaded.exports.zoomEntry(ENTRY, 'full')
  assert.deepEqual(api.calls.at(-1), ['zoom', 1, { animate: false }], '100% = 绝对 scale 1')
  loaded.exports.zoomEntry(ENTRY, 'in')
  assert.deepEqual(api.calls.at(-1), ['zoom', 1.25, { animate: true }], '放大 = 当前 × 1.25')
  loaded.exports.zoomEntry(ENTRY, 'out')
  assert.deepEqual(api.calls.at(-1)[0], 'zoom', '缩小走 zoom')
  assert.ok(api.calls.at(-1)[1] < 1.25, '缩小后的 scale 更小')
})

test('键盘 a11y：0 复位 / ± 缩放 / 方向键平移 / Esc 退出降级 overlay', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  const api = Panzoom.made[0]
  f.card.fire('keydown', { key: '0' })
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], '0 复位')
  f.card.fire('keydown', { key: '-' })
  assert.equal(api.calls.at(-1)[0], 'zoom', '- 缩小')
  f.card.fire('keydown', { key: 'ArrowLeft' })
  assert.deepEqual(api.calls.at(-1), ['pan', 40, 0, { animate: false, relative: true }], '方向键平移')
  f.card.fire('keydown', { key: 'ArrowUp' })
  assert.deepEqual(api.calls.at(-1), ['pan', 0, 40, { animate: false, relative: true }], '方向键平移')
  f.card.fire('keydown', { key: 'x' })
  assert.equal(api.calls.length, 4, '无关按键不动作')

  f.card.setAttribute(FS_ATTR, 'fallback')
  f.card.fire('keydown', { key: 'Escape' })
  assert.equal(f.card.getAttribute(FS_ATTR), null, 'Esc 退出降级 overlay')
})

test('裸 wheel 归页面；ctrlKey+wheel（捏合）与全屏态才缩放', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  const api = Panzoom.made[0]
  const zoomCalls = () => api.calls.filter((c) => c[0] === 'zoom').length
  const prevented = []
  const wheel = (opts) => {
    let stopped = false
    f.box.fire('wheel', {
      deltaY: -120,
      preventDefault: () => {
        stopped = true
      },
      ...opts,
    })
    prevented.push(stopped)
  }
  const before = zoomCalls()
  wheel({})
  assert.equal(zoomCalls(), before, '裸 wheel 不缩放')
  assert.equal(prevented.at(-1), false, '裸 wheel 不拦截 → 归页面（滚动陷阱）')
  wheel({ ctrlKey: true })
  assert.deepEqual(api.calls.at(-1), ['zoom', 1.25, { animate: false }], 'ctrlKey+wheel = 触控板捏合，放大一档')
  assert.equal(prevented.at(-1), true, '捏合时拦下浏览器默认缩放')
  wheel({ ctrlKey: true, deltaY: 120 })
  assert.equal(api.calls.at(-1)[1] < 1.25, true, '反向 deltaY = 缩小')
  f.box.fire('dblclick', {})
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], '双击复位')
  f.card.setAttribute(FS_ATTR, 'native')
  const beforeFs = zoomCalls()
  wheel({})
  assert.equal(zoomCalls(), beforeFs + 1, '全屏态放开裸 wheel')
})

test('全屏：原生可用走 Fullscreen API；不支持（iPhone Safari）降级 overlay', () => {
  const native = setup({ Panzoom: undefined })
  assert.equal(native.loaded.exports.toggleCardFullscreen(ENTRY), true, '进入全屏')
  assert.equal(native.card.getAttribute(FS_ATTR), 'native', '原生全屏标记')
  assert.equal(native.loaded.exports.toggleCardFullscreen(ENTRY), false, '再点退出')
  assert.equal(native.card.getAttribute(FS_ATTR), null, '标记已清')

  const fallback = setup({ Panzoom: undefined, fullscreen: false })
  assert.equal(fallback.loaded.exports.toggleCardFullscreen(ENTRY), true, '不支持时也能全屏')
  assert.equal(fallback.card.getAttribute(FS_ATTR), 'fallback', '降级为卡片内 overlay')

  const disabled = setup({ Panzoom: undefined })
  disabled.page.document.fullscreenEnabled = false
  assert.equal(disabled.loaded.exports.toggleCardFullscreen(ENTRY), true, '被禁用时走 overlay')
  assert.equal(disabled.card.getAttribute(FS_ATTR), 'fallback', '降级为卡片内 overlay')
})

test('原生全屏被拒（Promise reject）→ 清掉标记，不卡在假全屏', async () => {
  const f = setup({ Panzoom: undefined })
  f.card.requestFullscreen = () => Promise.reject(new Error('denied'))
  f.loaded.exports.toggleCardFullscreen(ENTRY)
  assert.equal(f.card.getAttribute(FS_ATTR), 'native', '先乐观置位（不阻塞用户）')
  await settle()
  assert.equal(f.card.getAttribute(FS_ATTR), null, '被拒后清掉')
})

test('库加载失败 → 静默保持静态图，且下次点击可重试', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    const f = setup({ Panzoom: undefined })
    f.loaded.exports.zoomEntry(ENTRY, 'in')
    await settle()
    await settle()
    assert.equal((f.box._listeners.wheel || []).length, 0, '加载失败不绑事件（保持静态图）')
    assert.equal(f.card.getAttribute(FS_ATTR), null, '不影响卡片其它能力')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('teardown 销毁实例（不留下绑定与内联样式）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.equal(Panzoom.made[0].destroyed, undefined, '还活着')
  f.loaded.exports.teardownZoom()
  assert.equal(Panzoom.made[0].destroyed, true, 'destroy 已调用')
  assert.equal(f.loaded.exports.zoomStates.size, 0, '状态表清空')
})
