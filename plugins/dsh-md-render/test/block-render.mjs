/**
 * 围栏块接管（block-render.ts）：**所有**围栏块都由自研渲染器产出。
 *
 * 判据（全部走真产物 + 真实 marked / hljs）：
 *  · text / plaintext / txt / md / markdown，以及**确证无语言**的块 → 自研 markdown 渲染
 *    （真标签：h1 / h2 / ul / table），每块带「查看原文」一键切回官方视图；
 *  · 其他语言（js / json / bash / python …）→ 自研代码块渲染（真语言名 banner + 高亮）；
 *  · 识别不出语言的块同样接管（用户口径「所有围栏块都由插件接管」），但**绝不编造语言名**；
 *  · mermaid / mmd 交给图表卡片（分流不重叠）；
 *  · 流式块等内容稳定；重扫幂等；超长 / 开关关闭 / react-dom 不可用 → 不动宿主 DOM（真降级）；
 *  · 语言来源只用官方 DOM 契约 + 语言索引，**不读 React fiber 私有属性**。
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

const SOURCE = ['## 结论', '', '模型输出的是 **markdown**。', '', '插件 | 版本', '---', 'dsh-md-render | 0.2.0'].join(
  '\n',
)
const MD_BODY = 'div.mdr-md.mdr-block-body'
const CODE_HOST = 'div.mdr-block'
const CODE_BANNER = 'span.mdr-fence-pill'
const TOGGLE = 'button.mdr-rm-btn[data-mdr-option="source"]'
const MD_BTN = 'button.mdr-rm-btn[data-mdr-option="markdown"]'
const VIEW_ATTR = 'data-mdr-view'

/** 一套完整夹具：markdown 家族 + 代码家族 + mermaid。 */
function setup({ assets = true } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const blocks = {
    text: makeCodeBlock({ lang: 'text', code: SOURCE }),
    plaintext: makeCodeBlock({ lang: 'plaintext', code: '# plaintext 标题' }),
    txt: makeCodeBlock({ lang: 'txt', code: '1. 有序一\n2. 有序二' }),
    js: makeCodeBlock({ lang: 'js', code: 'const a = 1' }),
    json: makeCodeBlock({ lang: 'json', code: '{"a":1}' }),
    mermaid: makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B' }),
  }
  blocks.mermaid.querySelector('code').className = 'language-mermaid'
  for (const block of Object.values(blocks)) scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react, { assets })
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const ctx = { effect: (fn) => fn() }
  loaded.exports.apply(ctx)
  return { page, loaded, stack, blocks, scroll, ctx }
}

test('markdown 家族的围栏块交给自研渲染器（真标签）+ 每块「查看原文」', () => {
  const { loaded, blocks } = setup()
  for (const [name, block] of Object.entries({
    text: blocks.text,
    plaintext: blocks.plaintext,
    txt: blocks.txt,
  })) {
    const body = block.querySelector(MD_BODY)
    assert.ok(body, name + ' 块获得自研渲染容器')
    assert.ok(String(body.className).includes('mdr-md'), name + ' 容器带 mdr-md 契约类')
    assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', name + ' 块初始为 markdown 视图')
    assert.ok(block.querySelector(TOGGLE), name + ' 块获得切换按钮')
    assert.ok(block.querySelectorAll('h1,h2,h3,h4,ul,ol,p,pre').length > 0, name + ' 块产出了真实 markdown 标签')
  }
  // 表格容错仍接上：GFM 不认的「a | b」+「---」被规范化成真表格
  assert.ok(blocks.text.querySelector('table'), 'text 块里的非标准表格被容错成真表格')
  assert.equal(blocks.plaintext.querySelector('h1').textContent, 'plaintext 标题', '标题渲染为 h1 真标签')
  assert.equal(blocks.txt.querySelectorAll('li').length, 2, '有序列表渲染为两个 li')
  assert.equal(blocks.text.querySelector('code').textContent, SOURCE, '宿主 code 文本未被改写')
  assert.equal(loaded.exports.domRootAvailable(), true, 'react-dom/client 可用')
})

test('其他语言的围栏块交给自研代码块渲染（真语言名 banner + 高亮 + 复制）', () => {
  const { blocks } = setup()
  for (const [name, lang] of [
    ['js', 'js'],
    ['json', 'json'],
  ]) {
    const block = blocks[name]
    assert.ok(block.querySelector(CODE_HOST), name + ' 块获得自研代码块容器')
    assert.equal(block.getAttribute(VIEW_ATTR), 'code', name + ' 块进入 code 视图')
    assert.equal(
      block.querySelector(CODE_BANNER).textContent,
      lang,
      name + ' 块 banner 显示真实语言名（不是「代码块」）',
    )
    assert.ok(block.querySelector('button.mdr-fence-copy'), name + ' 块有复制按钮')
    assert.equal(block.querySelector(MD_BODY), null, name + ' 块不被 markdown 接管')
    assert.equal(
      block.querySelector(TOGGLE).getAttribute('data-mdr-tip'),
      '渲染为源码',
      name + ' 代码视图的还原入口是底栏三态里的「源码」',
    )
  }
  assert.ok(blocks.js.querySelectorAll('span[class*=hl-]').length > 0, 'js 块产出 hl-* 高亮 span')
  assert.equal(blocks.js.querySelector('pre').textContent, 'const a = 1', '源码一字不少')
})

test('mermaid / mmd 块交给图表卡片（与 markdown / code 分流不重叠）', () => {
  const { blocks } = setup()
  assert.equal(blocks.mermaid.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '进入预览视图')
  assert.ok(blocks.mermaid.querySelector('div.mdr-mm-host'), '卡片 host 已挂')
  assert.equal(blocks.mermaid.querySelector(MD_BODY), null, '不被 markdown 接管')
  assert.equal(blocks.mermaid.querySelector(CODE_HOST), null, '不被代码块接管')
})

test('「查看原文」逐块独立，来回切不重复挂载', () => {
  const { blocks } = setup()
  const toggle = blocks.text.querySelector(TOGGLE)
  assert.equal(toggle.getAttribute('data-mdr-tip'), '渲染为源码', 'markdown 视图下的还原入口（底栏三态）')
  toggle.fire('click')
  assert.equal(blocks.text.getAttribute('data-dsh-md-render-lang-force'), 'source', '切到原文视图（覆盖值）')
  assert.equal(
    blocks.text.querySelector(TOGGLE).getAttribute('data-mdr-tip'),
    '渲染为源码',
    '源码视图下底栏三态仍在（源码项激活）',
  )
  assert.equal(blocks.plaintext.getAttribute(VIEW_ATTR), 'markdown', '其它块状态独立')
  // 再切回 markdown：扫描器会在官方块形态上补回三态控件，点「Markdown」
  blocks.text.querySelector(MD_BTN).fire('click')
  assert.equal(blocks.text.getAttribute(VIEW_ATTR), 'markdown', '切回 markdown 视图')
  assert.equal(blocks.text.querySelectorAll(MD_BODY).length, 1, '容器未重复')
  assert.equal(blocks.text.querySelectorAll(TOGGLE).length, 1, '按钮未重复')
})

test('流式块等内容稳定；重扫幂等（同容器复用、无重复容器）', () => {
  const { loaded, blocks, ctx } = setup()
  const wrap = makeElement('div', { 'data-streaming': 'true' })
  const streamBlock = makeCodeBlock({ lang: 'txt', code: '## 流式标题' })
  wrap.appendChild(streamBlock)
  blocks.text.parentNode.appendChild(wrap)
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), null, '流式中的块不动')
  wrap.removeAttribute('data-streaming')
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.getAttribute(VIEW_ATTR), 'markdown', '流式结束后渲染')
  const body = streamBlock.querySelector(MD_BODY)
  assert.equal(streamBlock.querySelector('h2').textContent, '流式标题', '流式内容渲染为真标题')
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.querySelector(MD_BODY), body, '同一容器复用')
  assert.equal(streamBlock.querySelectorAll(MD_BODY).length, 1, '无重复容器')
  loaded.exports.apply(ctx)
  assert.equal(streamBlock.querySelectorAll(MD_BODY).length, 1, '旧容器已移除')
})

test('语言取 code.language-xxx / banner infostring（不读 React fiber）', () => {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const legacy = makeCodeBlock({ lang: 'text', code: '# 旧契约', fiber: false, banner: false })
  legacy.querySelector('code').className = 'language-text'
  const bannerOnly = makeCodeBlock({ lang: 'bash', code: 'ls -la', fiber: false })
  scroll.appendChild(legacy)
  scroll.appendChild(bannerOnly)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(legacy.querySelector(MD_BODY), 'code.language-xxx 回退生效（按 markdown 渲染）')
  assert.equal(bannerOnly.querySelector(CODE_BANNER).textContent, 'bash', 'banner infostring 回退生效')
})

test('超长块 / 开关关闭 / react-dom 不可用 → 一律不动宿主 DOM（真降级）', () => {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const huge = makeCodeBlock({ lang: 'text', code: 'x'.repeat(100001) })
  scroll.appendChild(huge)
  let page = installGlobals(createPage(scroll))
  let react = createReactStub()
  let stack = createRenderStack(page, react)
  let loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(huge.querySelector(MD_BODY), null, '超长块不渲染')
  assert.equal(huge.getAttribute(VIEW_ATTR), null, '超长块无视图属性')

  const offBlock = makeCodeBlock({ lang: 'text', code: '# 关掉' })
  scroll.appendChild(offBlock)
  loaded.exports.setRenderOptions({ textFenceMarkdown: false })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(offBlock.querySelector(MD_BODY), null, '开关关闭后不渲染')
  loaded.exports.setRenderOptions({ textFenceMarkdown: true })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.ok(offBlock.querySelector(MD_BODY), '开关恢复后渲染')

  const noRoot = makeElement('div', { 'data-conversation-scroll': 'true' })
  const block = makeCodeBlock({ lang: 'text', code: '# 无 react-dom' })
  noRoot.appendChild(block)
  page = installGlobals(createPage(noRoot))
  react = createReactStub()
  loaded = loadBundle({ page, react })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(block.querySelector(MD_BODY), null, 'react-dom/client 不可用时不注入')
  assert.equal(block.querySelector(CODE_HOST), null, '代码块同理')
  assert.equal(block.getAttribute(VIEW_ATTR), null, '无视图属性（宿主保持原样）')
})

test('识别不出语言的块也接管为代码块，但语言位**留空**（绝不编造语言名）', () => {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  // 真实宿主形态：banner 只有本地化标签「代码块」，<code> 无 language-*
  const block = makeCodeBlock({ lang: '代码块', code: 'const a = 1', fiber: false })
  scroll.appendChild(block)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  assert.equal(block.getAttribute(VIEW_ATTR), 'code', '仍然接管（代码视图）')
  assert.equal(block.querySelector(CODE_BANNER).textContent, '', '语言位留空，不写「代码块」也不瞎猜')
  assert.equal(block.querySelector('pre').textContent, 'const a = 1', '源码一字不少')
})
