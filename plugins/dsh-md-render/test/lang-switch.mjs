/**
 * 需求 4（issue #470）：语言手动切换 —— 块级覆盖层 + 块内控件。
 *
 * 判据（全部走真产物 + 假 DOM）：
 *  · **用户显式意图 != 猜语言**：没点过控件时**不产生任何覆盖**（fenceForceOf 为 undefined），
 *    自动判定那条「绝不猜」的线一点没动；
 *  · 任意代码块（js / 无语言 / text）都有三选一控件；点「Markdown」→ 被 markdown 接管，
 *    点「源码」→ 还原官方代码块，切换时先把现接管方（容器 / 卡片，含各自 React root）拆干净；
 *  · 覆盖按**块内容哈希**存有界 Map → 宿主重渲染重建 DOM 后仍然生效；
 *  · **绝不触发 host 索引查询**（控件不该为了一行文案放大请求量）；
 *  · 图表卡片改用卡片头承载另外两项，块内不再重复挂控件。
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

const SWITCH = 'span.mdr-rm'
const BTN = 'button.mdr-rm-btn'
const HEAD_BTN = 'button[data-mdr-tip]'
const TEXT_BODY = 'div.mdr-md.mdr-block-body'
const FORCE_ATTR = 'data-dsh-md-render-lang-force'
const CARD_HOST = 'div.mdr-mm-host'

function setup(blocks) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const b of blocks) scroll.appendChild(b)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  return { page, loaded, stack, scroll }
}

/** 按文案点某个选项按钮。 */
function pick(block, label) {
  const btn = block.querySelectorAll(BTN).find((b) => b.getAttribute('data-mdr-tip') === '渲染为' + label)
  assert.ok(btn, '控件里应有「' + label + '」')
  btn.fire('click')
}

test('未点击过控件 → 不产生任何语言覆盖（用户显式意图 != 猜语言）', () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const { loaded } = setup([js])
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(loaded.exports.fenceForceOf(js), undefined, '没有覆盖值')
  assert.equal(js.getAttribute(FORCE_ATTR), null, '块上也没有覆盖属性')
  assert.ok(js.querySelector(SWITCH), '但控件已就位（三选一）')
  assert.deepEqual(
    js.querySelectorAll(BTN).map((b) => b.getAttribute('data-mdr-tip')),
    ['渲染为图表', '渲染为Markdown', '渲染为源码'],
    '三个选项',
  )
  assert.equal(js.getAttribute('data-mdr-view'), 'code', '自动判定没有被放宽：js 块走自研代码块视图')
  assert.equal(js.querySelector(TEXT_BODY), null, 'js 块不被 markdown 接管')
})

test('任意代码块可切 Markdown / 源码，来回切不重复注入', () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const { loaded } = setup([js])
  loaded.exports.apply({ effect: (fn) => fn() })

  pick(js, 'Markdown')
  assert.equal(js.getAttribute(FORCE_ATTR), 'markdown', '覆盖值写在块属性上')
  assert.ok(js.querySelector(TEXT_BODY), '块被按 markdown 渲染')
  assert.equal(js.querySelector(TEXT_BODY).textContent, 'const a = 1', '源码交给自研 markdown 渲染器')

  pick(js, '源码')
  assert.equal(js.getAttribute(FORCE_ATTR), 'source', '切回源码')
  assert.equal(js.querySelector(TEXT_BODY), null, 'markdown 容器已拆干净')
  // 视图属性也必须清：否则块停在 markdown 视图，官方内容被自有 CSS 藏住 → 空块（真实浏览器实测）。
  assert.equal(js.getAttribute('data-mdr-view'), null, '视图属性已清（否则官方内容仍被隐藏）')
  assert.equal(js.querySelectorAll(TEXT_BODY).length, 0, '无残留容器')
  assert.equal(js.querySelectorAll(SWITCH).length, 1, '控件只有一份')

  pick(js, 'Markdown')
  assert.equal(js.querySelectorAll(TEXT_BODY).length, 1, '再切回来仍只有一份容器')
  assert.equal(js.querySelectorAll(BTN).length, 3, '按钮无重复')
})

test('覆盖按块内容哈希跨宿主重渲染存活（新 DOM 块同内容仍生效）', () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const { loaded, scroll } = setup([js])
  loaded.exports.apply({ effect: (fn) => fn() })
  pick(js, 'Markdown')
  assert.equal(js.getAttribute(FORCE_ATTR), 'markdown', '先落下覆盖')

  // 宿主重渲染：整块被换成新节点（同内容、无任何属性）
  const rebuilt = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  scroll.appendChild(rebuilt)
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(loaded.exports.fenceForceOf(rebuilt), 'markdown', '按内容哈希命中覆盖')
  assert.ok(rebuilt.querySelector(TEXT_BODY), '重建后的块仍按 markdown 渲染')
})

test('mermaid 卡片：块内不挂控件，卡片头不重复提供「渲染为…」', () => {
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  block.querySelector('code').className = 'language-mermaid'
  const { loaded } = setup([block])
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(block.querySelector(CARD_HOST), '卡片已挂上')
  assert.equal(block.querySelector(SWITCH), null, '块内不再挂控件（避免一块两套）')

  // 卡片头常驻只有「视图切换 + 更多」。原来的「渲染为 Markdown / 源码」与常驻的「预览 / 代码」
  // 是同一意图的两套入口 —— 已按用户口径删掉（外面有的，里面就别再有）。这条断言防它被加回来。
  const head = block.querySelector(CARD_HOST)
  const tips = head.querySelectorAll(HEAD_BTN).map((b) => b.getAttribute('data-mdr-tip'))
  assert.ok(tips.includes('预览') && tips.includes('代码'), '卡片头常驻视图切换')
  assert.equal(head.querySelector(SWITCH), null, '卡片头没有「渲染为…」控件（不重复）')
  assert.ok(head.querySelector('.mdr-mm-menu'), '卡片头有「更多」菜单（低频操作的收纳处）')

  // 要看源码走「代码」视图：卡片卸载、官方代码块还原（这条路径仍在）。
  const codeBtn = head.querySelectorAll(HEAD_BTN).find((b) => b.getAttribute('data-mdr-tip') === '代码')
  assert.ok(codeBtn, '卡片头有「代码」视图')
  codeBtn.fire('click')
  // 视图切换只换卡片内的显示（卡片不卸载）：「看源码」现在走这条路 ——
  // 不再有语言覆盖那条路（本轮按「外面有的，里面就别再有」删除）。
  assert.ok(block.querySelector(CARD_HOST), '卡片仍在（切视图不拆卡片）')
})

test('mermaid 卡片不再提供语言覆盖入口：块内与卡片头都没有「渲染为…」', () => {
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  block.querySelector('code').className = 'language-mermaid'
  const { loaded } = setup([block])
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(block.querySelector(CARD_HOST), '卡片在')
  assert.equal(block.querySelector(SWITCH), null, '块内无控件（避免一块两套）')
  assert.equal(block.querySelector(CARD_HOST).querySelector(SWITCH), null, '卡片头也无「渲染为…」（本轮删除）')
  assert.equal(block.getAttribute(FORCE_ATTR), null, '没有语言覆盖值（只有用户显式意图才写）')
  assert.equal(block.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '卡片视图属性正常')
})

test('覆盖写入会话存储，刷新（新 bundle + 同一会话存储）后仍记得', () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const first = setup([js])
  first.loaded.exports.apply({ effect: (fn) => fn() })
  pick(js, 'Markdown')
  const store = first.page.window.sessionStorage
  assert.ok(String(store.getItem('dsh-md-render:lang-force')).includes('markdown'), '覆盖已落 sessionStorage')

  // 刷新：全新页面 + 全新 bundle（模块状态归零），但同一份会话存储
  const js2 = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const scroll2 = makeElement('div', { 'data-conversation-scroll': 'true' })
  scroll2.appendChild(js2)
  const page2 = installGlobals(createPage(scroll2))
  page2.window.sessionStorage = store
  const react2 = createReactStub()
  const stack2 = createRenderStack(page2, react2)
  const loaded2 = loadBundle({ page: page2, react: react2, reactDom: stack2.reactDom })
  loaded2.exports.apply({ effect: (fn) => fn() })
  assert.equal(loaded2.exports.fenceForceOf(js2), 'markdown', '刷新后按内容哈希恢复覆盖')
  assert.ok(js2.querySelector(TEXT_BODY), '刷新后仍按 markdown 渲染')
})

test('控件不触发 host 索引查询（一行文案不该放大请求量）', () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = (url) => {
    calls.push(String(url))
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: {} }) })
  }
  try {
    const untagged = makeCodeBlock({ lang: '', code: 'plain text' })
    untagged.querySelector('code').className = ''
    const { loaded } = setup([untagged])
    loaded.exports.apply({ effect: (fn) => fn() })
    assert.equal(calls.filter((u) => u.includes('/langs')).length, 0, '控件判定只读现成来源，绝不查表')
    assert.ok(untagged.querySelector(SWITCH), '控件仍已就位')
  } finally {
    if (original === undefined) delete globalThis.fetch
    else globalThis.fetch = original
  }
})
