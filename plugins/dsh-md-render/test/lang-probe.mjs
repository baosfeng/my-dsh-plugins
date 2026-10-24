/**
 * 围栏语言识别（client half 的索引回退）—— **issue #466 防复发测试**。
 *
 * 真实宿主（0.2.0-rc.2）实测根因：官方 `CodeBlock` 的 banner 只在 shiki **认识**该语言时
 * 才写语言原名（`supportsHighlighting(lang) ? lang : labels.codeLabel`），非空代码块的
 * `<code>` 又没有 `language-*` class —— `text` / `mermaid` / **无语言** 三种块的 DOM
 * 逐字段完全相同（14 个块实测 HTML 一致）。因此纯 DOM 识别 100% 静默失效。
 * 修复：按块内容哈希查语言索引（client 事件流主源 + host 半实时索引兜底）。
 *
 * 本套件判据（全部走**真实实现**：hash 用 bundle 的，查表用 lib/lang-index.js 的索引）：
 *  ① 真实宿主 DOM 形态（banner=「代码块」、无 language-* class）下重新认出 text / mermaid；
 *  ② 索引查不到 **不等于**「确证无语言」→ 按代码块接管但语言位留空（绝不误判成 markdown）；
 *  ③ DOM 已给语言名（js / json / bash）的块**零额外请求**；
 *  ④ 同一次扫描的多个块合成**一次**请求；
 *  ⑤ 流式块（[data-streaming]）不查表；消息稳定后重扫才查；
 *  ⑥ 查不到 → 负缓存（不重复请求）；host 索引后建 → 有界重试（每哈希 ≤ 2 次）；
 *  ⑦ 请求失败 / 无 fetch → 静默降级（不抛错；语言位留空，绝不猜）。
 */
import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex, fenceHash } from '../lib/lang-index.js'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeCodeBlock,
  makeElement,
  makeRealHostCodeBlock,
} from './support/fake-dom.mjs'

const MARKDOWN = ['## 结论', '', '| 列 | 值 |', '| --- | --- |', '| a | b |'].join('\n')
const MERMAID = ['flowchart TD', '  A["提交订单 (v2)"] --> B[校验]'].join('\n')
const UNKNOWN = '这个块的语言宿主与插件都不认识'
const MD_BODY = 'div.mdr-md.mdr-block-body'
const CODE_HOST = 'div.mdr-block'
const CODE_LANG = 'span.mdr-fence-pill'
const TOGGLE = 'button.mdr-rm-btn[data-mdr-option="source"]'
const MERMAID_HOST = 'div.mdr-mm-host'

/** 让出事件循环：冲刷微任务批处理 + fetch 回调（固定的 0ms 让出，不是「赌异步完成」）。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 拼一段围栏（避免测试源码里出现裸反引号串）。 */
const fence = (lang, body) => ['```' + lang, body, '```'].join('\n')

let active = null
afterEach(() => {
  // 清理：停掉未命中重试定时器并还原 fetch（同一文件内多个用例共享 globalThis）。
  if (active !== null) active()
  active = null
})

/** 装配页面（可选 mermaid 引擎桩）+ bundle + 语言索引桩。 */
function boot({ blocks = [], markdown, streaming = false, mermaidStub = true } = {}) {
  const index = createLangIndex()
  if (markdown !== undefined) index.record(markdown)
  // 真实宿主结构：document.body 之下才是会话滚动容器，块在容器内。夹具照此搭，
  // 兜底重扫（骨架的 rescanSelectors / 语言命中后的重扫）才走真实路径。
  const wrapper = makeElement('div')
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  wrapper.appendChild(scroll)
  const wrap = streaming ? makeElement('div', { 'data-streaming': 'true' }) : scroll
  for (const block of blocks) wrap.appendChild(block)
  if (streaming) scroll.appendChild(wrap)

  const page = installGlobals(createPage(wrapper))
  if (mermaidStub) page.window.mermaid = { initialize() {}, render: () => Promise.resolve({ svg: '<svg></svg>' }) }
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(index)
  active = () => {
    loaded.exports.teardownLangProbes()
    stub.restore()
  }
  return { page, loaded, stack, stub, scroll, index, wrap }
}

test('① 真实宿主 DOM（banner 只有「代码块」）下按内容哈希认出 text / mermaid 并各归其主', async () => {
  const text = makeRealHostCodeBlock({ code: MARKDOWN })
  const mermaidBlock = makeRealHostCodeBlock({ code: MERMAID })
  const unknown = makeRealHostCodeBlock({ code: UNKNOWN })
  const booted = boot({
    blocks: [text, mermaidBlock, unknown],
    markdown: fence('text', MARKDOWN) + '\n' + fence('mermaid', MERMAID),
  })
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  await settle()

  const body = text.querySelector(MD_BODY)
  assert.ok(body, 'text 块（banner 只有「代码块」）被重新认出并 markdown 化')
  assert.equal(body.querySelector('h2').textContent, '结论', '自研渲染器渲染的是哈希命中的那段内容')
  assert.ok(body.querySelector('table'), '内容里的表格也渲染为真表格')
  assert.equal(text.getAttribute('data-mdr-view'), 'markdown', '进入 markdown 视图')
  assert.ok(text.querySelector(TOGGLE), '带「查看原文」切换按钮')
  assert.ok(mermaidBlock.querySelector(MERMAID_HOST), 'mermaid 块被重新认出并挂卡片 host')
  assert.equal(mermaidBlock.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '进入预览视图')
  assert.equal(mermaidBlock.querySelector(MD_BODY), null, 'mermaid 块不被 markdown 接管（分流稳定）')
  assert.equal(text.querySelector(MERMAID_HOST), null, 'text 块无卡片 host')

  // ④ 批量：一次请求拿到多个哈希的答案
  const calls = booted.stub.langCalls()
  assert.equal(calls.length, 1, '同一次扫描的多个块合成一次请求')
  assert.deepEqual(
    new URL(calls[0], 'http://x').searchParams.getAll('h').sort(),
    [fenceHash(MARKDOWN), fenceHash(MERMAID), fenceHash(UNKNOWN)].sort(),
    '一次请求带上全部待查哈希',
  )
})

test('② 索引「查不到」不等于「无语言」：按代码块接管但语言位留空（绝不误判）', async () => {
  const untagged = makeRealHostCodeBlock({ code: '无语言块的内容' })
  const unknown = makeRealHostCodeBlock({ code: UNKNOWN })
  const booted = boot({ blocks: [untagged, unknown], markdown: fence('text', MARKDOWN) })
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  await settle()
  for (const [name, block] of Object.entries({ untagged, unknown })) {
    assert.equal(block.querySelector(MD_BODY), null, name + ' 块不被误判成 markdown')
    assert.equal(block.querySelector(MERMAID_HOST), null, name + ' 块不被卡片接管')
    assert.equal(block.getAttribute('data-mdr-view'), 'code', name + ' 块走代码视图')
    assert.ok(block.querySelector(CODE_HOST), name + ' 块按代码块接管')
    assert.equal(block.querySelector(CODE_LANG).textContent, '', name + ' 块语言位留空')
    // 官方节点结构不动（我们只追加自有容器）：官方 <code> 文本仍是原文
    const officialCode = name === 'untagged' ? '无语言块的内容' : UNKNOWN
    assert.equal(block.querySelector('code').textContent, officialCode, name + ' 块官方 code 结构保持原样')
  }
  // ⑥ 负缓存：再扫一次（模拟 DOM 变更触发的兜底重扫）不重复请求
  booted.page.observers[0].callback([{ addedNodes: [] }])
  await settle()
  assert.equal(booted.stub.langCalls().length, 1, '未命中已负缓存，不重复请求')
})

test('③ DOM 已给出语言名的块（js / json / bash）零额外请求，语言名照实上 banner', async () => {
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  const json = makeCodeBlock({ lang: 'json', code: '{"a":1}' })
  const bash = makeCodeBlock({ lang: 'bash', code: 'ls -la' })
  const booted = boot({ blocks: [js, json, bash], markdown: fence('text', MARKDOWN) })
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(booted.stub.langCalls().length, 0, 'DOM 认得出的语言一律不查索引（零请求）')
  for (const [lang, block] of [
    ['js', js],
    ['json', json],
    ['bash', bash],
  ]) {
    assert.equal(block.getAttribute('data-mdr-view'), 'code', lang + ' 块走代码视图')
    assert.equal(block.querySelector(CODE_LANG).textContent, lang, lang + ' 块 banner 是真实语言名')
    assert.equal(block.querySelector(MD_BODY), null, lang + ' 块不被 markdown 接管')
    assert.equal(block.querySelector(MERMAID_HOST), null, lang + ' 块无卡片')
  }
})

test('⑤ 流式块不查表（内容还在补写，哈希必然落空）；消息稳定后重扫才查', async () => {
  const text = makeRealHostCodeBlock({ code: MARKDOWN })
  const booted = boot({ blocks: [text], markdown: fence('text', MARKDOWN), streaming: true })
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(booted.stub.langCalls().length, 0, '流式中的块一次请求都不发')
  assert.equal(text.getAttribute('data-mdr-view'), null, '流式中的块不接管')

  // 宿主流式结束：移除 [data-streaming] → 属性变更触发兜底重扫（真实观察器回调）
  booted.wrap.removeAttribute('data-streaming')
  booted.page.observers[0].callback([
    { type: 'attributes', attributeName: 'data-streaming', target: booted.wrap, addedNodes: [] },
  ])
  await settle()
  await settle()
  assert.equal(booted.stub.langCalls().length, 1, '稳定后才查表')
  assert.ok(text.querySelector(MD_BODY), '稳定后接管（markdown）')
})

test('⑥ 时序差（client 先扫、host 索引后建）：有界重试窗口内命中即按 markdown 接管', async () => {
  const text = makeRealHostCodeBlock({ code: MARKDOWN })
  const booted = boot({ blocks: [text] }) // 索引先为空：本次查不到
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(text.querySelector(MD_BODY), null, '查不到 → 先按代码块接管（语言位留空）')
  assert.equal(booted.stub.langCalls().length, 1, '第一批请求已发')

  booted.index.record(fence('text', MARKDOWN)) // host 侧随后把这条围栏建进索引
  booted.loaded.exports.retryLangMisses() // 生产由 1.5s 重试定时器触发（客户端有界重试）
  await settle()
  await settle()
  assert.ok(text.querySelector(MD_BODY), '重试窗口内命中 → 改按 markdown 渲染')
  assert.equal(text.querySelector('h2').textContent, '结论', '渲染的是索引指认的内容')
})

test('⑥b 重试次数封顶：永久查不到时不会无限重试（请求次数有界）', async () => {
  const text = makeRealHostCodeBlock({ code: UNKNOWN })
  const booted = boot({ blocks: [text] }) // 索引永远为空
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  const base = booted.stub.langCalls().length
  const max = booted.loaded.exports.LANG_MAX_RETRIES
  for (let i = 0; i < max; i += 1) {
    booted.loaded.exports.retryLangMisses()
    await settle()
  }
  const capped = booted.stub.langCalls().length
  assert.equal(capped, base + max, '每次重试最多再发一批请求')
  booted.loaded.exports.retryLangMisses()
  booted.loaded.exports.retryLangMisses()
  await settle()
  assert.equal(booted.stub.langCalls().length, capped, '达到上限后不再请求（不会无限重试）')
  assert.equal(text.querySelector(CODE_LANG).textContent, '', '始终查不到 → 语言位始终留空')
})

test('⑦ 请求失败 / 无 fetch：静默降级（不抛错；语言位留空，绝不猜）', async () => {
  const text = makeRealHostCodeBlock({ code: MARKDOWN })
  const booted = boot({ blocks: [text], markdown: fence('text', MARKDOWN) })
  booted.stub.restore()
  const failing = installLangFetchStub(booted.index, { fail: true })
  active = () => {
    booted.loaded.exports.teardownLangProbes()
    failing.restore()
  }
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  await settle()
  assert.equal(text.querySelector(MD_BODY), null, '查表失败 → 不猜语言（不 markdown 化）')
  assert.equal(text.getAttribute('data-mdr-view'), 'code', '按代码块接管')
  assert.equal(text.querySelector(CODE_LANG).textContent, '', '语言位留空')

  // 环境里连 fetch 都没有（极老 / 裁剪宿主）：同样静默降级
  const other = makeRealHostCodeBlock({ code: MARKDOWN })
  const second = boot({ blocks: [other], markdown: fence('text', MARKDOWN) })
  delete globalThis.fetch
  active = () => {
    second.loaded.exports.teardownLangProbes()
  }
  second.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(other.querySelector(MD_BODY), null, '没有 fetch 也不抛错、不猜语言')
})

test('开关关闭时既不接管也不查表（一次请求都不发）', async () => {
  const text = makeRealHostCodeBlock({ code: MARKDOWN })
  const mermaidBlock = makeRealHostCodeBlock({ code: MERMAID })
  const booted = boot({
    blocks: [text, mermaidBlock],
    markdown: fence('text', MARKDOWN) + '\n' + fence('mermaid', MERMAID),
  })
  booted.loaded.exports.setRenderOptions({ markdown: { textFenceMarkdown: false }, mermaid: { render: false } })
  booted.loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(booted.stub.langCalls().length, 0, '开关关闭 → 不查表')
  assert.equal(text.getAttribute('data-mdr-view'), null, 'text 块不接管')
  assert.equal(mermaidBlock.querySelector(MERMAID_HOST), null, 'mermaid 块不接管')
})

test('本插件已渲染容器内的块不二次接管（防递归；连查表都不查）', async () => {
  const nested = makeRealHostCodeBlock({ code: MERMAID })
  const container = makeElement('div', { className: 'mdr-md mdr-block-md' })
  container.appendChild(nested)
  const wrapper = makeElement('div')
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  scroll.appendChild(container)
  wrapper.appendChild(scroll)
  const page = installGlobals(createPage(wrapper))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const index = createLangIndex()
  index.record(fence('mermaid', MERMAID))
  const stub = installLangFetchStub(index)
  active = () => {
    loaded.exports.teardownLangProbes()
    stub.restore()
  }
  loaded.exports.apply({ effect: (fn) => fn() })
  await settle()
  assert.equal(nested.querySelector(MERMAID_HOST), null, '渲染容器内的块不挂卡片')
  assert.equal(nested.querySelector(MD_BODY), null, '也不被 markdown 二次接管')
  assert.equal(stub.langCalls().length, 0, '也不发请求')
})
