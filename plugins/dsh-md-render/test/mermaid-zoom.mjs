/**
 * 需求 1（#470）+ 真机反馈修复（#471）：图表浮窗 + 缩放 / 平移。
 *
 * 判据（真产物 + 假 DOM + panzoom 桩）：
 *  · panzoom 走 assets 懒加载（首次真正需要才 fetch 一次），**不进 client.js**；
 *  · 绑定对象是**本插件自有的 SVG 容器**（硬约束：不碰官方元素）；同一容器只绑一次；
 *  · 浮窗 = 页面内 `<dialog>` 模态（**不用** Fullscreen API）：卡片搬进面板、关闭还回原位置、
 *    遮罩点击 / Esc（cancel）/ 关闭按钮三路都能关；浮窗态里工具条照样能缩放；
 *  · 工具条 Fit / 100% / ± 打到库的对应 API；**库未就绪时的点击排队执行**（此前被静默丢弃）；
 *  · 事件绑在**卡片**上（指针偏出图形也能捏合）；裸 wheel 归页面（无滚动陷阱）；
 *    ctrl+wheel（触控板捏合）与 Safari gesture* 都能缩放；
 *  · 库加载失败 → 卡片标记 failed（不再静默）且下次点击可重试；teardown 收浮窗 + 销毁实例。
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
import { waitFor, yieldLoop } from '../../dsh-shared/test-kit/wait.mjs'

const ENTRY = 'dsh-md-render-mermaid-7'
const FS_ATTR = 'data-dsh-md-render-fs'
const PANEL_ATTR = 'data-dsh-md-render-fs-panel'

/** 让出事件循环，等 fetch → text → 注入 → 建实例 → 执行排队动作这条微任务链跑完。 */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await yieldLoop()
}

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

/** 夹具：自有 DOM 契约（host[entryId] > card > svg 容器 > canvas 变换层）。 */
function setup({ Panzoom = panzoomStub() } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  const host = makeElement('div', { className: 'dsh-md-render-mermaid-host', 'data-dsh-md-render-mermaid': ENTRY })
  const card = makeElement('div', { className: 'dsh-md-render-mermaid-card' })
  const frame = makeElement('div', { className: 'dsh-md-render-mermaid-svg' })
  const box = makeElement('div', { className: 'dsh-md-render-mermaid-canvas' })
  // 图内 SVG：100% 判据要用 viewBox 宽 ÷ 未缩放的显示宽（测试里显式给死值）。
  const svg = makeElement('svg')
  svg.viewBox = { baseVal: { width: 600, height: 400 } }
  svg._rect = { width: 300, height: 200 }
  box.appendChild(svg)
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
  return { page, loaded, scroll, block, host, card, frame, box, svg, Panzoom }
}

/** 打开浮窗后拿到面板（自有 DOM 标记定位）。 */
const panelOf = (page) => page.document.querySelector('[' + PANEL_ATTR + ']')

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
    assert.equal(f.frame.getAttribute('data-dsh-md-render-zoom'), 'on', '外层容器切到裁剪态')

    f.loaded.exports.zoomEntry(ENTRY, 'out')
    await settle()
    assert.equal(panzoomFetches().length, 1, '已加载则不重复 fetch')
    assert.equal(Panzoom.made.length, 1, '同容器只绑一次（幂等）')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('库未就绪时的点击排队执行，不静默丢弃（懒加载期间点「+」必须有反应）', async () => {
  const Panzoom = panzoomStub()
  const original = globalThis.fetch
  let release = () => {}
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = () => {
        globalThis.window.Panzoom = Panzoom
        resolve({ ok: true, text: () => Promise.resolve('/* umd */') })
      }
    })
  try {
    const f = setup({ Panzoom: undefined })
    f.loaded.exports.zoomEntry(ENTRY, 'in') // 此刻库还在加载中（fetch 未 resolve）
    assert.equal(Panzoom.made.length, 0, '确实还没绑定')
    release()
    await waitFor(() => Panzoom.made.length === 1, { message: '懒加载完成后补齐绑定' })
    assert.deepEqual(Panzoom.made[0].calls, [['zoom', 1.25, { animate: true }]], '首次点击补执行（不是被丢掉）')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('Fit / 100% / ± 打到库的对应 API；100% = 真实像素（不再是 Fit 的同义词）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  const api = Panzoom.made[0]
  assert.ok(api, '已绑定')
  f.loaded.exports.zoomEntry(ENTRY, 'fit')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], 'Fit = reset')
  f.loaded.exports.zoomEntry(ENTRY, 'full')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['zoom', 2, { animate: false }], '100% = viewBox 600 ÷ 显示 300 = 2')
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['zoom', 2.5, { animate: true }], '放大 = 当前 × 1.25')
  f.loaded.exports.zoomEntry(ENTRY, 'out')
  await settle()
  assert.deepEqual(api.calls.at(-1)[0], 'zoom', '缩小走 zoom')
  assert.ok(api.calls.at(-1)[1] < 2.5, '缩小后的 scale 更小')
})

test('100% 在没有 SVG 量不出尺寸时退回 scale 1（不抛错）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.box._nodes = []
  f.loaded.exports.zoomEntry(ENTRY, 'full')
  await settle()
  assert.deepEqual(Panzoom.made[0].calls.at(-1), ['zoom', 1, { animate: false }], '量不出尺寸 → 1')
})

test('键盘 a11y：0 复位 / ± 缩放 / 方向键平移（绑在卡片上）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  const api = Panzoom.made[0]
  api.calls.length = 0 // 只数键盘动作
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
})

test('裸 wheel 归页面；ctrlKey+wheel（捏合）与 gesture（Safari）都缩放', async () => {
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
    f.card.fire('wheel', {
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
  const scaleBefore = api.getScale()
  wheel({ ctrlKey: true })
  assert.deepEqual(
    api.calls.at(-1),
    ['zoom', scaleBefore * 1.25, { animate: false }],
    'ctrlKey+wheel = 触控板捏合，放大一档',
  )
  assert.equal(prevented.at(-1), true, '捏合时拦下浏览器默认缩放')
  wheel({ ctrlKey: true, deltaY: 120 })
  assert.equal(api.calls.at(-1)[1] < scaleBefore * 1.25, true, '反向 deltaY = 缩小')

  // Safari 触控板捏合：gesturestart/gesturechange（不发 ctrl+wheel）
  let gesturePrevented = false
  const gEvent = {
    scale: 1,
    preventDefault: () => {
      gesturePrevented = true
    },
  }
  f.card.fire('gesturestart', gEvent)
  assert.equal(gesturePrevented, true, 'gesturestart 拦下浏览器整页缩放')
  const gestureBase = api.getScale()
  f.card.fire('gesturechange', { scale: 2, preventDefault: () => {} })
  assert.deepEqual(api.calls.at(-1), ['zoom', gestureBase * 2, { animate: false }], 'gesturechange 按倍率缩放')
  const afterGesture = api.calls.length
  f.card.fire('gesturechange', { scale: 0, preventDefault: () => {} })
  assert.equal(api.calls.length, afterGesture, '非法倍率不动')

  f.box.fire('dblclick', {})
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], '双击复位')
})

test('浮窗：页面内 <dialog> 模态（不用 Fullscreen API），卡片搬进搬出、三路可关', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.equal(f.loaded.exports.toggleCardOverlay(ENTRY), true, '进入浮窗')
  const panel = panelOf(f.page)
  assert.ok(panel, '页面内出现自有浮窗面板')
  assert.equal(panel.tagName, 'DIALOG', '用 dialog 模态，不是浏览器全屏')
  assert.equal(panel._open, true, '已 showModal（遮罩 / Esc / 焦点 / 滚动锁定由它兜底）')
  assert.equal(panel.getAttribute(PANEL_ATTR), 'open', '自有面板标记（供真机验证定位）')
  // 搬的是**宿主（React 根容器）**，不是卡片本身：React 17+ 把合成事件委托挂在根容器上，
  // 把卡片单独搬出去 → 浮窗里所有按钮失灵（真机实测踩过这个坑）。
  assert.equal(f.host.parentNode, panel, '宿主（React 根容器）搬进面板')
  assert.equal(f.card.parentNode, f.host, '卡片留在宿主里（事件委托不断）')
  assert.equal(panel._nodes.includes(f.card), false, '卡片本身没被搬出去')
  assert.equal(f.card.getAttribute(FS_ATTR), 'open', '卡片带上浮窗态')
  assert.equal(f.block._nodes.includes(f.host), false, '宿主已离开原块')

  // 浮窗态里工具条照样能缩放（宿主在面板里，按 entryId 仍能定位到）
  const zoomBefore = Panzoom.made[0].calls.length
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.equal(Panzoom.made[0].calls.length, zoomBefore + 1, '浮窗内缩放照样生效')

  const callsBeforeClose = Panzoom.made[0].calls.length
  panel.fire('cancel') // Esc：浏览器把 cancel 事件交给浮窗
  assert.equal(f.card.getAttribute(FS_ATTR), null, '已退出浮窗')
  assert.equal(panel._open, false, '面板已关')
  assert.equal(f.host.parentNode, f.block, '宿主还回原父节点')
  assert.equal(f.card.parentNode, f.host, '卡片仍在宿主里')
  assert.equal(panelOf(f.page), null, '面板已从页面移除')
  assert.equal(Panzoom.made[0].calls.length, callsBeforeClose, '关浮窗不动缩放库')
  assert.equal(Panzoom.made[0].destroyed, undefined, '关浮窗不销毁实例（变换保留在元素上）')

  // 遮罩点击（::backdrop 不是元素 → 命中 dialog 自身）
  f.loaded.exports.toggleCardOverlay(ENTRY)
  const panel2 = panelOf(f.page)
  panel2.fire('click', { target: panel2 })
  assert.equal(panelOf(f.page), null, '点遮罩也能关')

  // 面板里的「关闭」按钮
  f.loaded.exports.toggleCardOverlay(ENTRY)
  const panel3 = panelOf(f.page)
  const closeBtn = panel3.querySelectorAll('button').find((b) => b.textContent === '关闭')
  assert.ok(closeBtn, '面板里有「关闭」按钮')
  closeBtn.fire('click')
  assert.equal(panelOf(f.page), null, '关闭按钮能关')
  assert.equal(f.host.parentNode, f.block, '宿主回到原父节点')
})

test('浮窗内的小按钮保留浏览器全屏二级入口（主入口仍是浮窗）', async () => {
  const f = setup({ Panzoom: panzoomStub() })
  let fullscreenAsked = 0
  f.card.requestFullscreen = () => {
    fullscreenAsked += 1
    return Promise.resolve()
  }
  f.loaded.exports.toggleCardOverlay(ENTRY)
  const panel = panelOf(f.page)
  const nativeBtn = panel.querySelectorAll('button').find((b) => b.textContent === '浏览器全屏')
  assert.ok(nativeBtn, '面板里有浏览器全屏小按钮')
  nativeBtn.fire('click')
  assert.equal(fullscreenAsked, 1, '点了才调 requestFullscreen（不是主入口）')
})

test('卡片卸载 / 组件清理时收掉自己的浮窗', async () => {
  const f = setup({ Panzoom: panzoomStub() })
  f.loaded.exports.toggleCardOverlay(ENTRY)
  assert.ok(panelOf(f.page), '浮窗已开')
  f.loaded.exports.closeOverlayOf('别的卡片')
  assert.ok(panelOf(f.page), '别的卡片的清理不动它')
  f.loaded.exports.closeOverlayOf(ENTRY)
  assert.equal(panelOf(f.page), null, '自己的清理收掉浮窗')
  assert.equal(f.card.parentNode, f.host, '卡片已还回')
})

test('库加载失败 → 标记卡片 failed（不再静默），下次点击可重试', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    const f = setup({ Panzoom: undefined })
    f.loaded.exports.zoomEntry(ENTRY, 'in')
    await settle()
    assert.equal((f.card._listeners.wheel || []).length, 0, '加载失败不绑事件（保持静态图）')
    assert.equal(f.card.getAttribute(FS_ATTR), 'failed', '失败可见（此前静默 → 像「点了没反应」）')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('teardown 收浮窗 + 销毁实例（不留下绑定与内联样式）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.equal(Panzoom.made[0].destroyed, undefined, '还活着')
  f.loaded.exports.toggleCardOverlay(ENTRY)
  assert.ok(panelOf(f.page), '浮窗开着')
  f.loaded.exports.teardownZoom()
  assert.equal(Panzoom.made[0].destroyed, true, 'destroy 已调用')
  assert.equal(f.loaded.exports.zoomStates.size, 0, '状态表清空')
  assert.equal(panelOf(f.page), null, '浮窗也收掉')
  assert.equal(f.card.parentNode, f.host, '卡片还回宿主')
})
