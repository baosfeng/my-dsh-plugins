/**
 * client 半围栏语言索引（会话事件流）—— **issue #466「冷启动 / 历史会话不生效」防复发测试**。
 *
 * 复现的缺陷：host 半的语言索引只订阅 `session/event`（**不读历史**）—— 用户打开的是
 * **历史会话**、而插件实例是之后才启动的（冷启动 / 重启后打开历史会话）时，host 索引为空，
 * 按内容哈希查表永不命中（真实浏览器实测 `toggles=0` / `views=0`）。
 * 修复：语言判定主源改为 **client 侧** `ctx.sessions.binding(id).eventSource` 的事件窗口
 * —— `assistant/message.data.message.content[].text` / `user/message.data.content[].text`
 * 就是 markdown 原文，**天然含历史**；host 半实时索引与 DOM 契约读法**保留为兜底**。
 *
 * 反向验证（门禁 9）：把 src/client/parts/scanner.ts 里的
 * `refreshFenceLangIndex(fenceScanContext)` 一行注释掉重建，本文件的「端到端」用例
 * （① / ② / ③ / ④ / 双源优先级）必须变红。
 *
 * 本套件判据是**接线 + 映射口径**（假 DOM + 真产物）：
 *  ① 端到端：DOM 无任何语言标记（真实 0.2.0-rc.2 形态）时，text / mermaid 仍各归其主；
 *  ② 确证无语言（空串）→ 按 markdown 兜底（#470 需求 3）；白名单外语言（js）仍不接管；
 *  ③ 映射口径：同哈希多候选按 DOM 文档序 FIFO；数量对不上整块放弃（绝不猜）；
 *  ④ 双源优先级：client 索引命中 → **零 RPC**（host 索引一次都不查）；未命中才回落 host；
 *  ⑤ 降级：ctx.get 抛错 / 服务缺失 / 契约残缺 → 空表且不抛（行为同修复前）；
 *  ⑥ 刷新门控：事件源 revision 未变不重复吸收；会话切换整表重置；
 *  ⑦ 围栏解析（保守子集）与性能护栏（超长块 / 空块不入表）。
 */
import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex } from '../lib/lang-index.js'
// makeRealHostCodeBlock = 「真实宿主形态」的块（issue #466 实测）：banner 只有本地化标签
// 「代码块」（shiki 不认识 text / plaintext / txt / mermaid / mmd），<code> 不带 language-*。
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

const TEXT_BODY = 'div.mdr-block-md'
const TOGGLE = 'button.mdr-rm-btn[data-mdr-option="source"]'
const MERMAID_HOST = 'div.mdr-mm-host'
const MD = '## 结论\n\n- 一\n- 二'
const MERMAID = 'flowchart TD\n  A --> B'

/** 围栏 markdown（lang 为空 = 无语言围栏）。 */
const fence = (lang, body) =>
  [lang === '' ? '\u0060\u0060\u0060' : '\u0060\u0060\u0060' + lang, body, '\u0060\u0060\u0060'].join('\n')

/** 造一条 durable 事件条目（surfaceOp = append）。 */
function messageEntry(seq, type, markdown, surfaceOp = 'append') {
  const data =
    type === 'assistant/message'
      ? { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: markdown }] } }
      : { role: 'user', content: [{ type: 'text', text: markdown }] }
  return { type: 'event', event: { seq, type, surfaceOp, data } }
}

/**
 * 假会话服务 + 插件 ctx（`ctx.get('sessions', false)`，**不声明 inject**）。
 * R1 实测（真实 cordis 4.0.4）：服务在 → 取到；服务缺 → undefined 不抛；
 * 服务晚于 apply 提供也照样取到 —— 故 exports.inject 保持 []。
 */
function sessionsCtx(entries, revision = 1, sessionId = 's1') {
  const eventSource = { getSnapshot: () => ({ entries, hasMore: false, revision }) }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } } }) },
    binding: (id) => (id === sessionId ? { sessionId, eventSource } : undefined),
  }
  return { effect: (fn) => fn(), get: (name) => (name === 'sessions' ? sessions : undefined) }
}

let active = null
afterEach(() => {
  if (active !== null) active()
  active = null
})

/**
 * 装配页面（wrapper > scroll > blocks，与真实宿主同形）+ 官方组件桩 + 产物。
 * 可选 host 语言索引桩（默认不装：host 索引为空 = 冷启动 / 历史会话的真实状态）。
 */
function boot({ blocks = [], hostIndex = null } = {}) {
  const wrapper = makeElement('div')
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  wrapper.appendChild(scroll)
  for (const block of blocks) scroll.appendChild(block)
  const page = installGlobals(createPage(wrapper))
  // mermaid 引擎桩：卡片挂载后不会真去 fetch 引擎（否则会污染 fetch 桩的请求计数）。
  page.window.mermaid = { initialize() {}, render: () => Promise.resolve({ svg: '<svg></svg>' }) }
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(hostIndex ?? createLangIndex())
  active = () => {
    loaded.exports.teardownLangProbes()
    stub.restore()
  }
  return { page, loaded, stack, stub, scroll, wrapper }
}

// ── ① 端到端：DOM 无语言标记（真实 0.2.0-rc.2 形态）+ host 索引为空（冷启动）──
test('① 冷启动 / 历史会话：host 索引为空时，事件流里的 text 围栏块仍被 markdown 接管', () => {
  const block = makeRealHostCodeBlock({ code: MD })
  const ctx = sessionsCtx([messageEntry(1, 'assistant/message', fence('text', MD))])
  const b = boot({ blocks: [block] })
  assert.equal(b.stub.langCalls().length, 0, '装桩后还没发过请求')
  b.loaded.exports.apply(ctx)
  assert.ok(block.querySelector(TEXT_BODY), '事件流索引命中 → markdown 容器已挂上（修复前此处为空）')
  assert.ok(block.querySelector(TOGGLE), '「查看原文」切换按钮已挂上')
  assert.equal(b.loaded.exports.fenceLangOf(block), 'text', '语言来源 = client 侧会话事件流索引')
  assert.equal(b.stub.langCalls().length, 0, '本地索引命中 → **零 RPC**（host 索引一次都不查）')
})

test('② 冷启动 / 历史会话：mermaid 围栏块挂图表卡片（DOM 认不出语言、host 索引为空）', () => {
  const block = makeRealHostCodeBlock({ code: MERMAID })
  const ctx = sessionsCtx([messageEntry(2, 'assistant/message', fence('mermaid', MERMAID))])
  const b = boot({ blocks: [block], ctx })
  b.loaded.exports.apply(ctx)
  assert.ok(block.querySelector(MERMAID_HOST), 'mermaid 卡片 host 已挂上')
  assert.equal(block.querySelector(TEXT_BODY), null, 'mermaid 块不被 markdown 接管（语言集合互斥）')
  assert.equal(b.stub.langCalls().length, 0, '本地索引命中 → 零 RPC')
})

test('③ 确证无语言（事件流索引给空串）→ 按 markdown 兜底，且不误伤为卡片', () => {
  const block = makeRealHostCodeBlock({ code: MD })
  const ctx = sessionsCtx([messageEntry(3, 'assistant/message', fence('', MD))])
  const b = boot({ blocks: [block], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.fenceLangOf(block), '', '确证无语言（空串 = 不是「不知道」）')
  assert.ok(block.querySelector(TEXT_BODY), '#470 需求 3：无语言块按 markdown 兜底渲染')
  assert.equal(block.getAttribute('data-mdr-view'), 'markdown', '初始 markdown 视图')
  assert.ok(block.querySelector(TOGGLE), '带「查看原文」一键还原')
  assert.equal(block.querySelector(MERMAID_HOST), null, '无语言块绝不误伤为图表卡片')
  assert.equal(b.stub.langCalls().length, 0, '本地索引确证 → 一次 RPC 都不发')
})

test('④ 绝不误伤：事件流里是 js 围栏的同内容块不被接管（白名单外语言）', () => {
  const block = makeRealHostCodeBlock({ code: 'const a = 1' })
  const ctx = sessionsCtx([messageEntry(4, 'assistant/message', fence('js', 'const a = 1'))])
  const b = boot({ blocks: [block], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.fenceLangOf(block), 'js', '认得出 js')
  assert.equal(block.querySelector(TEXT_BODY), null, '白名单外语言不接管')
})

// ── ③ 映射口径：文档序 FIFO / 数量不符放弃 ─────────────────────────────
test('⑤ 同哈希多候选（text / js）且 DOM 块数与候选数一致 → 按 DOM 文档序 FIFO', () => {
  const same = 'SAME CONTENT'
  const a = makeRealHostCodeBlock({ code: same })
  const others = [makeRealHostCodeBlock({ code: same })]
  const ctx = sessionsCtx([
    messageEntry(5, 'assistant/message', fence('text', same)),
    messageEntry(6, 'assistant/message', fence('js', same)),
  ])
  const b = boot({ blocks: [a, ...others], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.resolveFenceLang(a), 'text', '第一块取第一候选')
  assert.equal(b.loaded.exports.resolveFenceLang(others[0]), 'js', '第二块取第二候选')
  assert.ok(a.querySelector(TEXT_BODY), '只有 text 那一块被接管')
  assert.equal(others[0].querySelector(TEXT_BODY), null, 'js 那一块不被接管')
})

test('⑥ 有歧义且 DOM 内同哈希块数与候选数对不上 → 整块放弃（静默降级为官方形态）', () => {
  const same = 'AMBIGUOUS'
  const only = makeRealHostCodeBlock({ code: same })
  const ctx = sessionsCtx([
    messageEntry(7, 'assistant/message', fence('text', same)),
    messageEntry(8, 'assistant/message', fence('mermaid', same)),
  ])
  const b = boot({ blocks: [only], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.fenceLangOf(only), undefined, '不敢猜 → 放弃')
  assert.equal(only.querySelector(TEXT_BODY), null)
  assert.equal(only.querySelector(MERMAID_HOST), null)
})

test('⑦ user/message 与 reasoning 块同样参与建表', () => {
  const u = makeRealHostCodeBlock({ code: 'U1' })
  const r = makeRealHostCodeBlock({ code: 'R1' })
  const entries = [
    messageEntry(9, 'user/message', fence('plaintext', 'U1')),
    {
      type: 'event',
      event: {
        seq: 10,
        type: 'assistant/message',
        surfaceOp: 'append',
        data: { message: { content: [{ type: 'reasoning', text: fence('mmd', 'R1') }] } },
      },
    },
  ]
  const ctx = sessionsCtx(entries)
  const b = boot({ blocks: [u, r], ctx })
  b.loaded.exports.apply(ctx)
  assert.ok(u.querySelector(TEXT_BODY), 'user/message 里的 plaintext 围栏生效')
  assert.ok(r.querySelector(MERMAID_HOST), 'reasoning 块里的 mmd 围栏生效')
})

test('⑧ surfaceOp !== append 的事件被跳过（replace 副本不算真源）', () => {
  const block = makeRealHostCodeBlock({ code: 'REPLACED' })
  const ctx = sessionsCtx([messageEntry(11, 'assistant/message', fence('text', 'REPLACED'), 'replace')])
  const b = boot({ blocks: [block], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.fenceLangOf(block), undefined, 'replace 副本不入表')
  assert.equal(block.querySelector(TEXT_BODY), null)
})

// ── ④ 双源优先级：client 索引命中零 RPC；未命中才回落 host 索引 ─────────
test('⑨ client 索引优先：与 host 索引结论不同时以 client 为准，且一次 RPC 都不发', () => {
  const block = makeRealHostCodeBlock({ code: MERMAID })
  const hostIndex = createLangIndex()
  hostIndex.record(fence('text', MERMAID)) // host 索引（只覆盖实时消息）说它是 text
  const ctx = sessionsCtx([messageEntry(12, 'assistant/message', fence('mermaid', MERMAID))])
  const b = boot({ blocks: [block], hostIndex, ctx })
  b.loaded.exports.apply(ctx)
  assert.ok(block.querySelector(MERMAID_HOST), 'client 索引（原文）说了算：mermaid 卡片')
  assert.equal(block.querySelector(TEXT_BODY), null, '不按 host 索引渲染为 markdown')
  assert.equal(b.stub.langCalls().length, 0, 'client 索引命中 → 不查 host（零 RPC）')
})

test('⑩ 双源互补：client 索引未命中（内容不在事件窗口里）→ 仍回落 host 实时索引', async () => {
  const markdown = '## 只有 host 侧有'
  const block = makeRealHostCodeBlock({ code: markdown })
  const hostIndex = createLangIndex()
  hostIndex.record(fence('text', markdown))
  const ctx = sessionsCtx([]) // 事件窗口里没有这条围栏（例如已被裁剪）
  const b = boot({ blocks: [block], hostIndex })
  b.loaded.exports.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 0)) // 让出事件循环，冲刷批量查询
  await new Promise((resolve) => setTimeout(resolve, 0)) // 再让一步：命中后的兜底重扫
  assert.ok(b.stub.langCalls().length > 0, 'client 未命中 → 查 host 索引')
  assert.ok(block.querySelector(TEXT_BODY), 'host 索引兜底仍然有效（原行为不回归）')
})

test('⑪ 双源都不命中 → 不接管（保持官方形态）', () => {
  const block = makeRealHostCodeBlock({ code: '谁都不认识' })
  const ctx = sessionsCtx([messageEntry(13, 'assistant/message', fence('text', MD))])
  const b = boot({ blocks: [block], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(block.querySelector(TEXT_BODY), null)
  assert.equal(block.querySelector(MERMAID_HOST), null)
})

// ── ⑤ 降级：任何一环取不到 → 空表且不抛 ────────────────────────────────
/** 精简上下文：只有 effect（老宿主 / 测试桩的最小契约）。 */
const brokenCtxBase = { effect: (fn) => fn() }

test('⑫ 降级：ctx.get 抛 "without inject" / 服务缺失 / 契约残缺 → 不抛、退回 DOM 读法', () => {
  const legacy = makeCodeBlock({ lang: 'text', code: MD, fiber: false })
  legacy.querySelector('code').className = 'language-text'
  const banner = makeCodeBlock({ lang: 'txt', code: '# banner', fiber: false })
  const b = boot({ blocks: [legacy, banner] })
  const throwing = {
    effect: (fn) => fn(),
    get: (name) => {
      if (name === 'sessions') throw new Error('cannot get property "sessions" without inject')
      return undefined
    },
  }
  b.loaded.exports.apply(throwing)
  assert.ok(legacy.querySelector(TEXT_BODY), 'code.language-* 兜底生效（原契约保留）')
  assert.ok(banner.querySelector(TEXT_BODY), 'banner infostring 兜底生效（原契约保留）')

  const list = { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) }
  /** 只对 'sessions' 返回服务的 ctx（其它名字交给别的服务消费者，如设置页的 'slots'）。 */
  const ctxOf = (sessions) => ({ ...brokenCtxBase, get: (name) => (name === 'sessions' ? sessions : undefined) })
  const broken = [
    { ...brokenCtxBase }, // 无 ctx.get（精简上下文 / 旧宿主）
    ctxOf(undefined), // 服务缺失（ctx.get 返回 undefined）
    ctxOf({ list: { getSnapshot: () => ({ byId: {} }) }, binding: () => undefined }), // 无主视图会话
    ctxOf({ list, binding: () => undefined }), // binding 缺失
    ctxOf({ list, binding: () => ({ eventSource: {} }) }), // 无 getSnapshot
    ctxOf({
      list,
      binding: () => ({
        eventSource: {
          getSnapshot: () => {
            throw new Error('boom')
          },
        },
      }),
    }), // getSnapshot 抛错
    ctxOf({ list, binding: () => ({ eventSource: { getSnapshot: () => ({ entries: 'nope', revision: 1 }) } }) }), // entries 非数组
  ]
  for (const ctx of broken) {
    const block = makeRealHostCodeBlock({ code: MD })
    const c = boot({ blocks: [block], ctx })
    c.loaded.exports.apply(ctx)
    assert.equal(c.loaded.exports.fenceLangOf(block), undefined, '契约残缺 → 空表')
    assert.equal(block.querySelector(TEXT_BODY), null, '不接管（退回官方形态）')
  }
})

test('⑬ 降级：块结构残缺（无 pre / null / undefined）不抛', () => {
  const { fenceLangOf } = boot({}).loaded.exports
  assert.equal(fenceLangOf(makeElement('div')), undefined)
  assert.equal(fenceLangOf(null), undefined)
  assert.equal(fenceLangOf(undefined), undefined)
})

// ── ⑥ 刷新门控：revision / 会话切换 ─────────────────────────────────────
test('⑭ revision 未变不重复吸收新条目；revision 变化才吸收；会话切换整表重置', () => {
  const b = boot({})
  const { refreshFenceLangIndex, fenceLangOf } = b.loaded.exports
  const window = { entries: [messageEntry(20, 'assistant/message', fence('text', 'R20'))], revision: 5 }
  const ctx = sessionsCtx(window.entries, 5, 'rev-gate')
  refreshFenceLangIndex(ctx)
  assert.equal(fenceLangOf(makeRealHostCodeBlock({ code: 'R20' })), 'text')
  window.entries = [...window.entries, messageEntry(21, 'assistant/message', fence('text', 'R21'))]
  refreshFenceLangIndex(ctx) // revision 未变 → 不该看见 R21
  assert.equal(fenceLangOf(makeRealHostCodeBlock({ code: 'R21' })), undefined, 'revision 未变不吸收')
  window.revision = 6
  refreshFenceLangIndex(sessionsCtx(window.entries, 6, 'rev-gate'))
  assert.equal(fenceLangOf(makeRealHostCodeBlock({ code: 'R21' })), 'text', 'revision 变化 → 吸收新条目')
  refreshFenceLangIndex(sessionsCtx([], 1, 'other-session'))
  assert.equal(fenceLangOf(makeRealHostCodeBlock({ code: 'R20' })), undefined, '会话切换 → 整表重置')
})

// ── ⑦ 围栏解析（保守子集）+ 性能护栏 ────────────────────────────────────
test('⑮ 围栏解析：三反引号 / 三波浪号 / 未闭合 / 缩进 / 无语言 / 内层短栏', () => {
  const { collectFences, fenceInfoLang, fenceHash, fenceNormalize } = boot({}).loaded.exports
  const seen = []
  const sink = (lang, code) => seen.push([lang, code])
  collectFences('\u0060\u0060\u0060text\nA\n\u0060\u0060\u0060\n~~~js {1,3}\nB\n~~~\n', sink)
  assert.deepEqual(seen, [
    ['text', 'A'],
    ['js', 'B'],
  ])
  seen.length = 0
  collectFences('\u0060\u0060\u0060text\nA\n', sink)
  assert.deepEqual(seen, [], '未闭合的尾巴不算（成对才算）')
  seen.length = 0
  collectFences('    \u0060\u0060\u0060text\nA\n    \u0060\u0060\u0060\n', sink)
  assert.deepEqual(seen, [], '4 空格缩进不是围栏')
  seen.length = 0
  collectFences('\u0060\u0060\u0060\u0060text\n\u0060\u0060\u0060\nA\n\u0060\u0060\u0060\u0060\n', sink)
  assert.deepEqual(seen, [['text', '\u0060\u0060\u0060\nA']], '闭栏须同字符且不短于开栏')
  assert.equal(fenceInfoLang(''), '')
  assert.equal(fenceInfoLang('   '), '')
  assert.equal(fenceInfoLang(' TExt '), 'text')
  assert.equal(fenceHash(fenceNormalize('foo\n')), fenceHash(fenceNormalize('foo')), 'DOM 尾换行与围栏内容同哈希')
  assert.equal(fenceHash(fenceNormalize('a\r\nb')), fenceHash(fenceNormalize('a\nb')), 'CRLF 归一')
  assert.equal(fenceHash(''), '', '空内容不入表')
  assert.notEqual(fenceHash('a'), fenceHash('b'))
})

test('⑯ 性能护栏：超长块（> 200k）与空内容块都不参与查表', () => {
  const big = 'z'.repeat(boot({}).loaded.exports.MAX_FENCE_CODE_CHARS + 1)
  const longBlock = makeRealHostCodeBlock({ code: big })
  const emptyBlock = makeRealHostCodeBlock({ code: '' })
  const ctx = sessionsCtx([
    messageEntry(30, 'assistant/message', fence('text', big)),
    messageEntry(31, 'assistant/message', fence('text', '')),
  ])
  const b = boot({ blocks: [longBlock, emptyBlock], ctx })
  b.loaded.exports.apply(ctx)
  assert.equal(b.loaded.exports.MAX_FENCE_CODE_CHARS, 200000, '阈值是契约的一部分')
  assert.equal(b.loaded.exports.fenceLangOf(longBlock), undefined, '超长块直接放弃（不哈希）')
  assert.equal(longBlock.querySelector(TEXT_BODY), null)
  assert.equal(emptyBlock.querySelector(TEXT_BODY), null, '空内容块不入表也不接管')
})

test('⑰ 流式门控：仍在 [data-streaming] 里的块不接管，稳定后重扫才接管', () => {
  const block = makeRealHostCodeBlock({ code: MD })
  const wrap = makeElement('div', { 'data-streaming': 'true' })
  wrap.appendChild(block)
  const wrapper = makeElement('div')
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  scroll.appendChild(wrap)
  wrapper.appendChild(scroll)
  const page = installGlobals(createPage(wrapper))
  page.window.mermaid = { initialize() {}, render: () => Promise.resolve({ svg: '<svg></svg>' }) }
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(createLangIndex())
  active = () => {
    loaded.exports.teardownLangProbes()
    stub.restore()
  }
  const ctx = sessionsCtx([messageEntry(40, 'assistant/message', fence('text', MD))])
  loaded.exports.apply(ctx)
  assert.equal(block.querySelector(TEXT_BODY), null, '流式中的块跳过（内容还在补写）')
  wrap.removeAttribute('data-streaming')
  // 真实的流式结束信号：attributes 变更 + attributeName=data-streaming（共享骨架据此**立即**补扫）
  page.observers[0].callback([{ type: 'attributes', attributeName: 'data-streaming', target: wrap, addedNodes: [] }])
  assert.ok(block.querySelector(TEXT_BODY), '消息稳定后由事件流索引识别并接管')
})
