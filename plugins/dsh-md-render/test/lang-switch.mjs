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
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeElement,
} from './support/fake-dom.mjs'

const SWITCH = 'div.dsh-md-render-lang-switch'
const BTN = 'button.dsh-md-render-mermaid-vt'
const TEXT_BODY = 'div.dsh-md-render-text-md'
const FORCE_ATTR = 'data-dsh-md-render-lang-force'
const CARD_HOST = 'div.dsh-md-render-mermaid-host'

function setup(blocks) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  for (const b of blocks) scroll.appendChild(b)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  return { page, loaded, stack, scroll }
}

/** 按文案点某个选项按钮。 */
function pick(block, label) {
  const btn = block.querySelectorAll(BTN).find((b) => b.textContent === label)
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
    js.querySelectorAll(BTN).map((b) => b.textContent),
    ['图表', 'Markdown', '源码'],
    '三个选项',
  )
  assert.equal(js.querySelector(TEXT_BODY), null, '自动判定没有被放宽：js 块仍不被 markdown 接管')
})

test('任意代码块可切 Markdown / 源码，来回切不重复注入', () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const { loaded, stack } = setup([js])
  loaded.exports.apply({ effect: (fn) => fn() })

  pick(js, 'Markdown')
  assert.equal(js.getAttribute(FORCE_ATTR), 'markdown', '覆盖值写在块属性上')
  assert.ok(js.querySelector(TEXT_BODY), '块被按 markdown 渲染')
  assert.equal(stack.markdown.calls.at(-1).text, 'const a = 1', '源码交给官方渲染器')

  pick(js, '源码')
  assert.equal(js.getAttribute(FORCE_ATTR), 'source', '切回源码')
  assert.equal(js.querySelector(TEXT_BODY), null, 'markdown 容器已拆干净')
  // 视图属性也必须清：否则块停在 markdown 视图，官方内容被自有 CSS 藏住 → 空块（真实浏览器实测）。
  assert.equal(js.getAttribute('data-dsh-md-render-text-view'), null, '视图属性已清（否则官方内容仍被隐藏）')
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

test('mermaid 卡片：块内不重复挂控件，另外两项并进卡片头', () => {
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  block.querySelector('code').className = 'language-mermaid'
  const { loaded } = setup([block])
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(block.querySelector(CARD_HOST), '卡片已挂上')
  assert.equal(block.querySelector(SWITCH), null, '块内不再挂控件（避免一块两套）')

  // 卡片头承载「Markdown / 源码」两项，点「源码」→ 拆卡片、还原官方代码块
  const head = block.querySelector(CARD_HOST)
  const src = head.querySelectorAll(BTN).find((b) => b.textContent === '源码')
  assert.ok(src, '卡片头有「源码」')
  src.fire('click')
  assert.equal(block.getAttribute(FORCE_ATTR), 'source', '覆盖已写入')
  assert.equal(block.querySelector(CARD_HOST), null, '卡片已卸载，还原官方代码块')
  assert.ok(block.querySelector(SWITCH), '块内控件回来了（卡片没了）')
})

test('切换时先拆干净：图表卡片 → markdown 不残留卡片 host 与视图属性', () => {
  const block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' })
  block.querySelector('code').className = 'language-mermaid'
  const { loaded } = setup([block])
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(block.querySelector(CARD_HOST), '先有卡片')
  pick(block, 'Markdown')
  assert.equal(block.querySelector(CARD_HOST), null, '卡片 host 已移除')
  assert.equal(block.getAttribute('data-dsh-md-render-mermaid-view'), null, '块级视图属性已清')
  assert.ok(block.querySelector(TEXT_BODY), '改由 markdown 接管')
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
  const stack2 = createOfficialStack(page2, react2)
  const loaded2 = loadBundle({ page: page2, react: react2, markdown: stack2.markdown, reactDom: stack2.reactDom })
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
