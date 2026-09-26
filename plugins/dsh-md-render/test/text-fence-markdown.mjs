/**
 * text / plaintext / txt 围栏块按 markdown 渲染（本插件保留的真增量）。
 *
 * 口径：这三种语言标记**一律**渲染（不做内容启发式判定）；其他标记（js / ts /
 * json / bash …）与无标记的块完全不触碰（反回归）；每块独立的「查看原文」切换；
 * 流式块等内容稳定再渲染；幂等（签名未变不重建）；超长 / 开关关闭 / 官方组件
 * 不可用 → 不动宿主 DOM（真降级）。
 *
 * 语言与源码来源是官方 CodeBlock 的 React props（fiber memoizedProps.lang/code，
 * ui-primitives/src/markdown/CodeBlock.tsx），DOM 里没有 language-xxx class；
 * fiber 取不到时回退 code.language-xxx / banner infostring（兼容旧契约 DOM）。
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

const SOURCE = ['## 结论', '', '模型输出的是 **markdown**。', '', '插件 | 版本', '---', 'dsh-md-render | 0.2.0'].join(
  '\n',
)
const TEXT_BODY = 'div.dsh-md-render-text-md'
const TOGGLE = 'button.dsh-md-render-text-toggle'
const VIEW_ATTR = 'data-dsh-md-render-text-view'

/** 一套完整夹具：三个目标块 + 两个不该被碰的块。 */
function setup({ withOfficial = true } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const blocks = {
    text: makeCodeBlock({ lang: 'text', code: SOURCE }),
    plaintext: makeCodeBlock({ lang: 'plaintext', code: '# plaintext 标题' }),
    txt: makeCodeBlock({ lang: 'txt', code: '1. 有序一\n2. 有序二' }),
    js: makeCodeBlock({ lang: 'js', code: 'const a = 1' }),
    untagged: makeCodeBlock({ lang: '', code: 'plain text block' }),
  }
  for (const block of Object.values(blocks)) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = withOfficial ? createOfficialStack(page, react) : { markdown: undefined, reactDom: undefined }
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  const ctx = { effect: (fn) => fn() }
  loaded.exports.apply(ctx)
  return { page, loaded, stack, blocks, scroll, ctx }
}

const stubText = (block) => {
  const stub = block.querySelector('.official-md-stub')
  return stub === null ? null : stub.getAttribute('data-text')
}

test('三种语言标记的围栏块都交给官方渲染器渲染，并挂上「查看原文」', () => {
  const { loaded, stack, blocks } = setup()
  for (const [name, block] of Object.entries({ text: blocks.text, plaintext: blocks.plaintext, txt: blocks.txt })) {
    const body = block.querySelector(TEXT_BODY)
    assert.ok(body, name + ' 块获得渲染容器')
    assert.ok(String(body.className).includes('tzx-md'), name + ' 容器带 tzx-md 契约类')
    assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', name + ' 块初始为 markdown 视图')
    assert.ok(block.querySelector(TOGGLE), name + ' 块获得切换按钮')
  }
  assert.equal(stubText(blocks.text), SOURCE.replace('---', '--- | ---'), 'text 块内容进入官方渲染器（表格已规范化）')
  assert.equal(stubText(blocks.plaintext), '# plaintext 标题', 'plaintext 块内容')
  assert.equal(stubText(blocks.txt), '1. 有序一\n2. 有序二', 'txt 块内容')
  assert.equal(stack.markdown.calls.length, 3, '官方渲染器恰好被调用三次')
  assert.equal(stack.markdown.calls[0].labels.code.copyLabel, '复制', 'labels 透传')
  assert.equal(blocks.text.querySelector('code').textContent, SOURCE, '宿主 code 文本未被改写')
  assert.equal(loaded.exports.officialMarkdownAvailable(), true, '官方渲染器可用')
})

test('「查看原文」逐块独立，来回切不重复挂载', () => {
  const { blocks } = setup()
  const toggle = blocks.text.querySelector(TOGGLE)
  assert.equal(toggle.textContent, '查看原文', 'markdown 视图下的按钮文案')
  toggle.fire('click')
  assert.equal(blocks.text.getAttribute(VIEW_ATTR), 'source', '切到原文视图')
  assert.equal(blocks.text.querySelector(TOGGLE).textContent, '查看渲染', '文案翻转')
  assert.equal(blocks.text.querySelector(TOGGLE).getAttribute('aria-pressed'), 'true', 'aria-pressed 反映状态')
  assert.equal(blocks.plaintext.getAttribute(VIEW_ATTR), 'markdown', '其它块状态独立')
  blocks.text.querySelector(TOGGLE).fire('click')
  assert.equal(blocks.text.getAttribute(VIEW_ATTR), 'markdown', '切回 markdown 视图')
  assert.equal(blocks.text.querySelectorAll(TEXT_BODY).length, 1, '容器未重复')
  assert.equal(blocks.text.querySelectorAll(TOGGLE).length, 1, '按钮未重复')
})

test('其他语言标记与无标记块完全不被触碰（反回归）', () => {
  const { blocks, scroll } = setup()
  for (const [name, block] of Object.entries({ js: blocks.js, untagged: blocks.untagged })) {
    assert.equal(block.getAttribute(VIEW_ATTR), null, name + ' 块无视图属性')
    assert.equal(block.querySelector(TEXT_BODY), null, name + ' 块无渲染容器')
    assert.equal(block.querySelector(TOGGLE), null, name + ' 块无切换按钮')
    assert.equal(block.querySelectorAll('pre').length, 1, name + ' 块保持单个 pre')
  }
  assert.equal(blocks.js.querySelector('code').textContent, 'const a = 1', 'js 文本未动')
  assert.equal(scroll.querySelectorAll(TEXT_BODY).length, 3, '恰好三个目标块被接管')
})

test('流式块等内容稳定；重扫幂等；内容变化才重建', () => {
  const { loaded, blocks, ctx } = setup()
  const wrap = makeElement('div', { 'data-streaming': 'true' })
  const streamBlock = makeCodeBlock({ lang: 'txt', code: '## 流式标题' })
  wrap.appendChild(streamBlock)
  blocks.text.parentNode.appendChild(wrap)
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), null, '流式中的块不动')
  delete wrap.dataset.streaming
  wrap.removeAttribute('data-streaming')
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), 'markdown', '流式结束后渲染')
  const body = streamBlock.querySelector(TEXT_BODY)
  assert.equal(stubText(streamBlock), '## 流式标题', '流式内容进入官方渲染器')
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.querySelector(TEXT_BODY), body, '同一容器复用')
  assert.equal(streamBlock.querySelectorAll(TEXT_BODY).length, 1, '无重复容器')
  streamBlock['__reactFiber$test1'].return.memoizedProps.code = '## 改后标题'
  loaded.exports.apply(ctx)
  assert.notEqual(streamBlock.querySelector(TEXT_BODY), body, '内容变化后重建容器')
  assert.equal(stubText(streamBlock), '## 改后标题', '新内容进入官方渲染器')
  assert.equal(streamBlock.querySelectorAll(TEXT_BODY).length, 1, '旧容器已移除')
})

test('fiber 取不到时回退 code.language-xxx / banner 语言名（兼容旧契约 DOM）', () => {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const legacy = makeCodeBlock({ lang: 'text', code: '# 旧契约', fiber: false, banner: false })
  legacy.querySelector('code').className = 'language-text'
  const bannerOnly = makeCodeBlock({ lang: 'txt', code: '# banner', fiber: false })
  scroll.appendChild(legacy)
  scroll.appendChild(bannerOnly)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(stubText(legacy), '# 旧契约', 'code.language-xxx 回退生效')
  assert.equal(stubText(bannerOnly), '# banner', 'banner infostring 回退生效')
})

test('超长块 / 开关关闭 / 官方组件不可用 → 一律不动宿主 DOM（真降级）', () => {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const huge = makeCodeBlock({ lang: 'text', code: 'x'.repeat(100001) })
  scroll.appendChild(huge)
  let page = installGlobals(createPage(scroll))
  let react = createReactStub()
  let stack = createOfficialStack(page, react)
  let loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(huge.querySelector(TEXT_BODY), null, '超长块不渲染')
  assert.equal(huge.getAttribute(VIEW_ATTR), null, '超长块无视图属性')

  const offBlock = makeCodeBlock({ lang: 'text', code: '# 关掉' })
  scroll.appendChild(offBlock)
  loaded.exports.setRenderOptions({ textFenceMarkdown: false })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(offBlock.querySelector(TEXT_BODY), null, '开关关闭后不渲染')
  loaded.exports.setRenderOptions({ textFenceMarkdown: true })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(offBlock.querySelector(TEXT_BODY), '开关恢复后渲染')

  const noOfficial = makeElement('div', { 'data-conversation-scroll': 'true' })
  const block = makeCodeBlock({ lang: 'text', code: '# 无官方' })
  noOfficial.appendChild(block)
  page = installGlobals(createPage(noOfficial))
  react = createReactStub()
  loaded = loadBundle({ page, react })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(block.querySelector(TEXT_BODY), null, '官方组件不可用时不注入')
  assert.equal(block.getAttribute(VIEW_ATTR), null, '无视图属性（宿主保持原样）')
})
