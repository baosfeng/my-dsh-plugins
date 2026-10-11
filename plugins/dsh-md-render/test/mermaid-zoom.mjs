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
  createRenderStack,
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
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
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
    assert.deepEqual(
      Panzoom.made[0].calls,
      [
        ['zoom', 1, { animate: false }],
        ['zoom', 1.5, { animate: true }],
      ],
      '绑定即适应容器（量不出尺寸 → 1），随后首次点击补执行（不是被丢掉）',
    )
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
  assert.deepEqual(api.calls.at(-1), ['zoom', 1, { animate: false }], 'Fit = 适应容器（此处量不出容器尺寸 → 1）')
  f.loaded.exports.zoomEntry(ENTRY, 'full')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['zoom', 2, { animate: false }], '100% = viewBox 600 ÷ 显示 300 = 2')
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['zoom', 3, { animate: true }], '放大 = 当前 2 × 1.5')
  f.loaded.exports.zoomEntry(ENTRY, 'out')
  await settle()
  assert.deepEqual(api.calls.at(-1)[0], 'zoom', '缩小走 zoom')
  assert.ok(api.calls.at(-1)[1] < 3, '缩小后的 scale 更小')
})

test('首次绑定即适应容器（contain）：容器与图固有尺寸取宽高比例的较小者', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  // 容器 660×320；图固有 300×200（未缩放显示尺寸）→ min(660/300, 320/200) = min(2.2, 1.6) = 1.6。
  // 关键：小图（如 flowchart LR `X-->Y` 仅 ~90px 宽）躺在大容器里若只 reset 到 1，
  // 用户点「适应」没变化、点「放大」一次也只动 25%，感知就是「没反应」。
  // 注：假 DOM 的 getBoundingClientRect 不随 transform 变化，故只断言**首次绑定**这一路。
  f.frame.offsetWidth = 660
  f.frame.offsetHeight = 320
  f.loaded.exports.zoomEntry(ENTRY, 'fit')
  await settle()
  assert.deepEqual(
    Panzoom.made[0].calls[0],
    ['zoom', 1.6, { animate: false }],
    '绑定即适应：contain 取较小比例（不是 reset 到 1）',
  )
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
    ['zoom', scaleBefore * 1.5, { animate: false }],
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

  // 双击 = 适应 ↔ 实际大小（不是复位）。此处量不出容器 → fit = 1，当前比例远大于 1 → 回到适应；
  // 「双击不再复位 / 键盘 0 才复位」与完整切换语义见下面「缩放体验」专项用例。
  f.box.fire('dblclick', {})
  assert.deepEqual(api.calls.at(-1), ['zoom', 1, { animate: false }], '双击回到适应（不是 reset）')
  assert.equal(api.calls.filter((c) => c[0] === 'reset').length, 0, '双击不再是复位语义')
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
  assert.equal(Panzoom.made[0].calls.length, zoomBefore + 2, '开浮窗重新适应容器（1 次）+ 浮窗内缩放照样生效（1 次）')

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

test('浮窗内的小按钮保留浏览器全屏二级入口：**先收浮窗再进全屏**（两层模态绝不同时存在）', async () => {
  const f = setup({ Panzoom: panzoomStub() })
  let fullscreenAsked = 0
  let overlayStillOpen = null
  f.card.requestFullscreen = () => {
    fullscreenAsked += 1
    // PhotoSwipe 官方配方：全屏与浮窗是两层容器，进入全屏前必须先收掉浮窗
    // （真机实测修复前 dialogStillOpen: true —— 两层模态叠加）。
    overlayStillOpen = panelOf(f.page) !== null
    return Promise.resolve()
  }
  const docEvents = []
  f.page.document.addEventListener = (type, fn) => docEvents.push([type, fn])
  f.page.window.Panzoom = f.Panzoom
  f.loaded.exports.toggleCardOverlay(ENTRY)
  await settle() // 绑定链完成 → fullscreenchange 监听已挂上
  const panel = panelOf(f.page)
  const nativeBtn = panel.querySelectorAll('button').find((b) => b.textContent === '浏览器全屏')
  assert.ok(nativeBtn, '面板里有浏览器全屏小按钮')
  nativeBtn.fire('click')
  assert.equal(fullscreenAsked, 1, '点了才调 requestFullscreen（不是主入口）')
  assert.equal(overlayStillOpen, false, '进全屏时浮窗已收掉（两层容器绝不同时存在）')
  assert.equal(panelOf(f.page), null, '浮窗已从页面移除')
  assert.equal(f.host.parentNode, f.block, '宿主已还回原父节点')
  assert.equal(f.card.getAttribute(FS_ATTR), null, '卡片已退出浮窗态')
  assert.deepEqual(
    docEvents.map(([t]) => t),
    ['fullscreenchange'],
    '全屏切换交给 fitMode 的跟随重算',
  )
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

test('panzoom 拉取失败 → 内置降级引擎接管（按钮不再「点了没反应」）', async () => {
  // #471 真机第四轮：panzoom 走**运行时** fetch，环境差异（资源加载 / 注入时机 / UMD 落点）
  // 会让它静默失败。真机复现过用户现象：阻断该请求 → 百分比停在初始 100%、绑定从未建立、
  // 每个缩放按钮点下去毫无反应、卡片零提示。降级引擎用纯 CSS transform，零运行时加载。
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    const f = setup({ Panzoom: undefined })
    f.loaded.exports.zoomEntry(ENTRY, 'in')
    await settle()
    assert.equal((f.card._listeners.wheel || []).length, 1, '降级后照样接管滚轮 / 触控板捏合')
    assert.equal(f.card.getAttribute(FS_ATTR), null, '不再是「失败即静默丢弃」态')
    assert.equal(f.frame.getAttribute('data-dsh-md-render-zoom'), 'on', '外层容器切到裁剪态')
    // 真正的判据：变换层上真的出现了放大（修复前这条路径 = 点了完全没反应）
    assert.ok(
      String(f.box.style.transform).includes('scale(1.5)'),
      '降级引擎真的放大了（首次 fit→1，点击 + → 1.5）：' + String(f.box.style.transform),
    )
    f.loaded.exports.zoomEntry(ENTRY, 'out')
    await settle()
    assert.ok(String(f.box.style.transform).includes('scale(1)'), '缩小真的回 1：' + String(f.box.style.transform))
    f.loaded.exports.toggleCardOverlay(ENTRY)
    assert.ok(panelOf(f.page), '降级态下浮窗也照常开')
    f.loaded.exports.closeCardOverlay()
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('panzoom 构造抛错 → 同样降级到内置引擎（绝不静默）', async () => {
  const f = setup({
    Panzoom: function BrokenPanzoom() {
      throw new Error('ctor boom')
    },
  })
  f.page.window.Panzoom = f.Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.ok(
    String(f.box.style.transform).includes('scale(1.5)'),
    '构造抛错也必须有反应：' + String(f.box.style.transform),
  )
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

// ── 图表缩放体验（真机反馈：「全屏之后不能点自适应」/ 双击语义不对）─────────────
// 落地调研结论：draw.io 的 Fit Window 是**保持态**、PhotoSwipe 的 fill = 适应宽度、
// Panzoom 的 toggleZoom = 适应 ↔ 实际大小、mermaid.live 用 zoomAtPoint 跟随手势中心。

/** 真实浏览器语义：比例 s 下 SVG 的显示尺寸 = 自然尺寸 × s（假 DOM 的 getBoundingClientRect
 *  不随 transform 变化；不同步的话 fit / 100% / fill 的期望值都会失真）。
 *  接在库的 zoom 之后 —— 任何改比例的动作都带着几何一起变，与真机一致。 */
function trackSvgScale(f, api) {
  const zoom = api.zoom
  api.zoom = (scale, opts) => {
    const out = zoom(scale, opts)
    const now = api.getScale()
    f.svg._rect = { width: 300 * now, height: 200 * now }
    return out
  }
  return api
}

/** 让桩实例自带真实几何语义（构造时就接上，绑定链里的首批 fit / fill 也算得对）。 */
function withSvgTracking(Panzoom, f) {
  return function TrackedPanzoom(element, options) {
    return trackSvgScale(f, Panzoom(element, options))
  }
}

/** ResizeObserver 桩（记录回调与观察目标；真实浏览器由渲染引擎在尺寸变化时回调）。 */
function installResizeObserver(page) {
  const observers = []
  page.window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe(target) {
      this.target = target
    }
    disconnect() {
      this.disconnected = true
    }
  }
  return observers
}

test('fitMode：适应是保持态 —— 容器尺寸 / 全屏切换都重算 fit（draw.io 的 Fit Window 同款）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = withSvgTracking(Panzoom, f)
  const observers = installResizeObserver(f.page)
  const docEvents = []
  f.page.document.addEventListener = (type, fn) => docEvents.push([type, fn])
  f.frame.offsetWidth = 600
  f.frame.offsetHeight = 300
  f.loaded.exports.zoomEntry(ENTRY, 'fit') // 绑定即 fit：min(600/300, 300/200) = 1.5
  await settle()
  const api = Panzoom.made[0]
  assert.deepEqual(api.calls.at(-1), ['zoom', 1.5, { animate: false }], '首次适应')
  assert.equal(observers.length, 1, '一个实例一个 ResizeObserver')
  assert.equal(observers[0].target, f.frame, '观察的是**裁剪容器** frame（fit 的基准），不是变换层')
  assert.deepEqual(
    docEvents.map(([t]) => t),
    ['fullscreenchange'],
    '绑全屏切换',
  )

  // 容器尺寸变化（开浮窗 / 进全屏那种量级）→ 重算，而不是停在旧比例
  // （真机实证：容器 1174×508 → 800×544 后图仍停在旧比例）。
  f.frame.offsetWidth = 1200
  f.frame.offsetHeight = 600
  api.calls.length = 0
  observers[0].callback()
  assert.deepEqual(api.calls.at(-1), ['zoom', 3, { animate: false }], '容器变化 → 重算 fit = min(1200/300, 600/200)')

  // fit 值没变就不要再写 transform（否则 ResizeObserver 与自身写入的变换互相触发）
  api.calls.length = 0
  observers[0].callback()
  assert.equal(api.calls.length, 0, 'fit 值没变 → 不动（防回环）')

  // 全屏切换走同一条路（全屏后按 fitMode 重新适应）
  f.frame.offsetWidth = 1800
  f.frame.offsetHeight = 900
  api.calls.length = 0
  docEvents.find(([t]) => t === 'fullscreenchange')[1]()
  assert.deepEqual(api.calls.at(-1), ['zoom', 4.5, { animate: false }], '进全屏 → 重算 fit = min(1800/300, 900/200)')

  // 用户手动缩放 → 退出保持态：容器再变也不重算
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '手动缩放即退出 fitMode')
  api.calls.length = 0
  observers[0].callback()
  assert.equal(api.calls.length, 0, '退出后不再跟随容器')

  f.loaded.exports.teardownZoom()
  assert.equal(observers[0].disconnected, true, 'teardown 解绑跟随监听（不留观察者）')
})

test('fitMode：没有 ResizeObserver 时退回 window resize（老环境也能跟随）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = withSvgTracking(Panzoom, f)
  const winEvents = []
  f.page.window.addEventListener = (type, fn) => winEvents.push([type, fn])
  f.frame.offsetWidth = 900
  f.frame.offsetHeight = 300
  f.loaded.exports.zoomEntry(ENTRY, 'fit') // min(900/300, 300/200) = 1.5
  await settle()
  const api = Panzoom.made[0]
  assert.deepEqual(
    winEvents.map(([t]) => t),
    ['resize'],
    '无 ResizeObserver → 退回 window resize',
  )
  f.frame.offsetWidth = 1500
  f.frame.offsetHeight = 500
  api.calls.length = 0
  winEvents[0][1]()
  assert.deepEqual(api.calls.at(-1), ['zoom', 2.5, { animate: false }], '窗口变化 → 重算 fit = min(1500/300, 500/200)')
})

test('双击 = 适应 ↔ 实际大小（Panzoom 的 toggleZoom 语义；键盘 0 才是复位）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = withSvgTracking(Panzoom, f)
  f.frame.offsetWidth = 600
  f.frame.offsetHeight = 300
  f.loaded.exports.zoomEntry(ENTRY, 'fit') // 1.5
  await settle()
  const api = Panzoom.made[0]

  api.calls.length = 0
  f.box.fire('dblclick', {})
  assert.deepEqual(api.calls.at(-1), ['zoom', 2, { animate: false }], '当前在适应 → 双击去实际大小（600/300 = 2）')
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '去 100% 即退出 fitMode')

  f.box.fire('dblclick', {})
  assert.deepEqual(api.calls.at(-1), ['zoom', 1.5, { animate: false }], '不在适应（2 ≠ 1.5）→ 双击回适应')
  assert.equal(api.calls.filter((c) => c[0] === 'reset').length, 0, '双击不再走 reset')

  // 边界：容器与图几乎 1:1（fit ≈ 100%）→ 双击仍必须能回到「适应」。
  // 判据是**状态**（fitMode）而非「当前比例是否接近 fit 值」：后者在 fit ≈ 100% 时两次双击
  // 都会判成「接近 fit」，用户永远回不去（101% --双击--> 100% --双击--> 100%）。
  f.frame.offsetWidth = 300
  f.frame.offsetHeight = 200
  f.loaded.exports.zoomEntry(ENTRY, 'full')
  await settle()
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '100% = 用户接管态')
  api.calls.length = 0
  f.box.fire('dblclick', {})
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, true, 'fit ≈ 100% 时双击也要能回到适应')
  assert.deepEqual(api.calls.at(-1), ['zoom', 1, { animate: false }], '此处 fit = min(300/300, 200/200) = 1')

  f.card.fire('keydown', { key: '0' })
  assert.deepEqual(api.calls.at(-1), ['reset', { animate: false }], '键盘 0 = 真正的复位（scale 1）')
})

test('铺满（fill）：按容器宽度铺满、保持宽高比、超上界夹逼（与 fit 明确区分）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = withSvgTracking(Panzoom, f)
  f.frame.offsetWidth = 600
  f.frame.offsetHeight = 300
  f.loaded.exports.zoomEntry(ENTRY, 'fill')
  await settle()
  const api = Panzoom.made[0]
  // 绑定即 fit（1.5），随后 fill 覆盖为 bw / sw = 600/300 = 2：比 fit 大 → 高度溢出，用户拖动平移
  assert.deepEqual(api.calls.at(-1), ['zoom', 2, { animate: false }], '铺满 = bw / sw（不受高度约束）')
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '铺满不是「适应」模式（不跟随容器）')
  api.calls.length = 0
  f.frame.offsetWidth = 3000
  f.loaded.exports.zoomEntry(ENTRY, 'fill')
  await settle()
  assert.deepEqual(api.calls.at(-1), ['zoom', 8, { animate: false }], '3000/300 = 10 → 夹到上界 8')
})

test('缩放锚点跟随手势中心：降级引擎按指针位置补偿平移（图不跑偏）', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline')) // 走降级引擎：纯 CSS transform，几何可断言
  try {
    const f = setup({ Panzoom: undefined })
    f.loaded.exports.zoomEntry(ENTRY, 'fit')
    await settle()
    // 变换层布局盒在屏幕 (0,0)、300×200 → 锚点 O = 布局盒中心 (150,100)
    // （与 panzoom 自己写的 transform-origin: 50% 50% 是同一个锚点）。
    f.box._rect = { left: 0, top: 0, width: 300, height: 200 }
    const wheelAt = (x, y) =>
      f.card.fire('wheel', { ctrlKey: true, deltaY: -120, clientX: x, clientY: y, preventDefault: () => {} })
    wheelAt(150, 0)
    assert.equal(
      String(f.box.style.transform),
      'translate(0px,50px) scale(1.5)',
      '指针 (150,0) 下的点保持不动：t2 = t1 + (P − O − t1)·(1 − s2/s1)',
    )
    // 第二次捏合：从变换后的真实几何继续（渲染盒 = 布局盒绕 O 缩放后再平移）
    f.box._rect = { left: -75, top: 0, width: 450, height: 300 }
    wheelAt(150, 0)
    assert.equal(String(f.box.style.transform), 'translate(0px,125px) scale(2.25)', '连续捏合锚点不漂移')
    // 量不出几何（未布局 / 伪 DOM）→ 退回居中缩放，绝不写 NaN
    f.box._rect = { left: 0, top: 0, width: 0, height: 0 }
    wheelAt(10, 10)
    assert.equal(String(f.box.style.transform), 'translate(0px,125px) scale(3.375)', '量不出几何 → 只改比例')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})

test('缩放锚点：panzoom 走它自带的 zoomToPoint（滚轮指针 / Safari 手势中心）', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  f.loaded.exports.zoomEntry(ENTRY, 'in')
  await settle()
  const api = Panzoom.made[0]
  const anchors = []
  // panzoom 4.6.2 的签名是 zoomToPoint(scale, event) —— scale 在前（库内 v(e,t,n,o) 读 t.clientX，
  // 且 zoomWithWheel 是 v(h(...), e, t, e)）。桩必须用同一顺序，才能钉住真实调用形状。
  api.zoomToPoint = (scale, point) => {
    anchors.push([scale, point])
    api.scale = scale
    return scale
  }
  api.calls.length = 0
  f.card.fire('wheel', { ctrlKey: true, deltaY: -120, clientX: 120, clientY: 80, preventDefault: () => {} })
  assert.deepEqual(
    anchors.at(-1),
    [2.25, { clientX: 120, clientY: 80 }],
    '以鼠标指针为锚点：scale 在前、事件在后（panzoom 4.6.2 的真实签名；传反了它会静默不动）',
  )
  assert.equal(api.calls.length, 0, '有锚点就不走居中缩放')

  const gestureBase = api.getScale()
  f.card.fire('gesturestart', { preventDefault: () => {} })
  f.card.fire('gesturechange', { scale: 2, clientX: 40, clientY: 20, preventDefault: () => {} })
  assert.deepEqual(
    anchors.at(-1),
    [gestureBase * 2, { clientX: 40, clientY: 20 }],
    'Safari 手势用手势中心为锚点（同样 scale 在前）',
  )

  anchors.length = 0
  f.card.fire('wheel', { ctrlKey: true, deltaY: -120, preventDefault: () => {} })
  assert.equal(anchors.length, 0, '没有指针坐标 → 不用锚点')
  assert.equal(api.calls.at(-1)[0], 'zoom', '退回居中缩放（不抛错）')
})

test('拖动平移（panzoompan）与方向键平移都会退出 fitMode', async () => {
  const Panzoom = panzoomStub()
  const f = setup({ Panzoom })
  f.page.window.Panzoom = Panzoom
  const observers = installResizeObserver(f.page)
  f.frame.offsetWidth = 600
  f.frame.offsetHeight = 300
  f.loaded.exports.zoomEntry(ENTRY, 'fit')
  await settle()
  const api = Panzoom.made[0]
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, true, '初始为适应模式')
  f.box.fire('panzoompan', {}) // panzoom 在真实拖动时派发（降级引擎同样派发，见 zoom-fallback.ts）
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '用户拖动 → 退出保持态')
  api.calls.length = 0
  observers[0].callback()
  assert.equal(api.calls.length, 0, '退出后容器变化不再重算')
  f.loaded.exports.zoomEntry(ENTRY, 'fit')
  await settle()
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, true, '再点「适应」重新进入保持态')
  f.card.fire('keydown', { key: 'ArrowLeft' })
  assert.equal(f.loaded.exports.zoomStates.get(f.box).fitMode, false, '方向键平移也算手动接管')
})
