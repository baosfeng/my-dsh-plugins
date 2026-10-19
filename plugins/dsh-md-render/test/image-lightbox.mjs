/**
 * markdown 图片「点击放大」灯箱（image-lightbox.ts）—— 成熟方案（medium-zoom / PhotoSwipe /
 * lightGallery）都有、此前自研渲染器缺的交互。
 *
 * 判据（产物 lib/client.js + 假 DOM）：
 *  · 渲染出的 img **追加** `[data-mdr-zoom]`（原有 `mdr-md-img` 保留）且可点击；
 *  · 点击 → 文档里出现 <dialog class="mdr-lightbox">，内含
 *    <img class="mdr-lightbox-img">（src / alt 与 markdown 一致）；
 *  · 三路关闭：Esc（cancel）/ 点击遮罩（target = dialog 自身）/ 点击图片 —— 均把 dialog 移除；
 *  · 同一时刻只有一个灯箱；关闭幂等（无残留节点、不抛错）；
 *  · 安全口径不变：不在白名单的地址不产出 img，直接调 openImageLightbox 也不开灯箱。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  vdomToDom,
} from './support/fake-dom.mjs'

const MARKDOWN = '![猫](https://example.com/cat.png)'
const TWO_IMAGES = '![一](https://example.com/1.png) ![二](https://example.com/2.png)'

/** 用 MarkdownView（公共 API，同一份自研渲染器）把 markdown 落成假 DOM。 */
function render(text) {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text }), page.document)
  /** 灯箱挂在 document.body 上（不在 MarkdownView 子树里）。 */
  const lightbox = () => page.document.body.querySelector('dialog.mdr-lightbox')
  return { page, loaded, dom, lightbox }
}

test('markdown 图片：追加可点击放大类名，点击后弹出原生 dialog 灯箱（大图 src / alt 一致）', () => {
  const { dom, lightbox } = render(MARKDOWN)
  const img = dom.querySelector('img')
  assert.ok(img, '图片正常产出')
  assert.equal(img.getAttribute('data-mdr-zoom'), 'true', '追加 data-mdr-zoom 标记')
  assert.ok(String(img.className).includes('mdr-md-img'), '原有 mdr-md-img 保留')
  assert.equal(lightbox(), null, '未点击时没有灯箱（不预建节点）')

  img.fire('click')
  const dialog = lightbox()
  assert.ok(dialog, '点击后出现 mdr-lightbox')
  const big = dialog.querySelector('img.mdr-lightbox-img')
  assert.ok(big, '灯箱内是 mdr-lightbox-img')
  // 灯箱大图由插件用 DOM 属性赋值创建（img.src / img.alt，真实浏览器里会反映到同名属性，
  // 与 mermaid 浮窗的 btn.textContent 同款写法）；假 DOM 只做属性赋值，故断言属性值。
  assert.equal(big.src, 'https://example.com/cat.png', '大图 = markdown 图片地址')
  assert.equal(big.alt, '猫', 'alt 透传给大图')
  assert.equal(dialog._open, true, '以模态方式打开（showModal）')
  assert.equal(dialog.getAttribute('class'), 'mdr-lightbox', '仅有约定类名')
})

test('键盘可达：Enter / 空格与点击同路（样式里的 :focus-visible 焦点环不是死的）', () => {
  const { dom, lightbox } = render(MARKDOWN)
  const img = dom.querySelector('img')
  // 假 DOM 的 vdom 落盘不做属性名归一化（真实 React 输出 tabindex="0"），故按 prop 名取。
  assert.equal(img.getAttribute('tabIndex'), '0', '可聚焦（styles.ts 的 :focus-visible 焦点环据此生效）')
  img.fire('keydown', { key: 'a' })
  assert.equal(lightbox(), null, '无关按键不开灯箱')
  img.fire('keydown', { key: 'Enter' })
  assert.ok(lightbox(), 'Enter 放大')
  lightbox().fire('cancel')
  img.fire('keydown', { key: ' ' })
  assert.ok(lightbox(), '空格放大')
  lightbox().fire('cancel')
  assert.equal(lightbox(), null, '收起')
})

test('三路关闭：Esc / 点击遮罩 / 点击图片（关闭即移除 dialog 节点）', () => {
  const { dom, lightbox } = render(MARKDOWN)
  const img = dom.querySelector('img')

  img.fire('click')
  assert.ok(lightbox(), '① 先打开')
  lightbox().fire('cancel')
  assert.equal(lightbox(), null, '① Esc（cancel 事件）关闭并移除节点')

  img.fire('click')
  assert.ok(lightbox(), '② 再打开')
  lightbox().fire('click')
  assert.equal(lightbox(), null, '② 点击遮罩（落点 = dialog 自身）关闭')

  img.fire('click')
  assert.ok(lightbox(), '③ 再打开')
  // 真实浏览器里「点击图片」= click 冒泡到 dialog，delegation 里 event.target === 大图；
  // 假 DOM 的 fire 不做冒泡，故显式把 target 指到大图上（同一判定分支）。
  const dialog3 = lightbox()
  dialog3.fire('click', { target: dialog3.querySelector('img.mdr-lightbox-img') })
  assert.equal(lightbox(), null, '③ 点击放大后的图片即收起')
})

test('第四条关闭路径：32px 圆形关闭按钮（显式出口，大图铺满时不必去够边缘）', () => {
  const { dom, lightbox } = render(MARKDOWN)
  dom.querySelector('img').fire('click')
  const dialog = lightbox()
  assert.ok(dialog.querySelector('.mdr-lightbox-wrap'), '大图包在包装层内（关闭按钮的定位锚点）')
  const close = dialog.querySelector('button.mdr-lightbox-close')
  assert.ok(close, '关闭按钮存在')
  assert.equal(close.getAttribute('aria-label'), '关闭', '纯图标按钮必须带 aria-label')
  close.fire('click')
  assert.equal(lightbox(), null, '点击关闭按钮收起并移除节点')
})

test('同一时刻只有一个灯箱；关闭幂等且不抛错', () => {
  const { page, dom, lightbox } = render(TWO_IMAGES)
  const imgs = dom.querySelectorAll('img')
  assert.equal(imgs.length, 2, '两张图片')
  imgs[0].fire('click')
  assert.equal(page.document.body.querySelectorAll('dialog.mdr-lightbox').length, 1, '第一张打开一个灯箱')
  imgs[1].fire('click')
  assert.equal(page.document.body.querySelectorAll('dialog.mdr-lightbox').length, 1, '点第二张不会堆叠出第二个灯箱')
  assert.equal(lightbox().querySelector('img').src, 'https://example.com/2.png', '灯箱切到第二张')
})

test('安全口径不变：非白名单地址不产 img，直接调 openImageLightbox 也不开灯箱', () => {
  const { page, dom, loaded, lightbox } = render('![坏](javascript:alert(1))')
  assert.equal(dom.querySelector('img'), null, '危险地址不产出 img')
  assert.equal(dom.querySelector('.mdr-md-img-alt').textContent, '坏', '退化为 alt 文本')
  assert.equal(dom.querySelector('.[data-mdr-zoom]'), null, '没有可点击放大的元素')
  loaded.exports.openImageLightbox('javascript:alert(1)', '坏')
  assert.equal(lightbox(), null, '非白名单地址：灯箱不打开（不加载来路不明资源）')
  loaded.exports.closeImageLightbox()
  assert.equal(page.document.body.querySelectorAll('dialog').length, 0, '直接关闭（未打开过）也不留节点、不抛错')
})
