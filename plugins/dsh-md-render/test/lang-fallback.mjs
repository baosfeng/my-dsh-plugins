/**
 * 需求 3（issue #470）：无语言围栏块的 markdown 兜底。
 *
 * 口径已拍板：**只有「确证无语言」才兜底**（client 事件流索引给出语言 ''），
 * **「识别失败」一律不接管**（拿不到语言信息 —— 老宿主 / 精简上下文 / 索引为空 /
 * DOM 只给本地化标签「代码块」且 host 索引未命中）。
 * 两者在 resolveFenceLangEx 里靠 `confirmed` 区分：'' + confirmed 才是确证。
 *
 * 代价用户已知情：真纯文本（日志 / 目录树）也会被当 markdown 渲染，
 * 但每块都有「查看原文」一键还原。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex } from '../lib/lang-index.js'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeCodeBlock,
  makeElement,
  makeRealHostCodeBlock,
} from './support/fake-dom.mjs'

const TEXT_BODY = 'div.dsh-md-render-text-md'
const TOGGLE = 'button.dsh-md-render-text-toggle'
const VIEW_ATTR = 'data-dsh-md-render-text-view'
const HOST_LABEL = '代码块'
const BODY = '## 标题\n\n- 一\n- 二'

const entry = (seq, markdown) => ({
  type: 'event',
  event: {
    seq,
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: markdown }] } },
  },
})

/** 假会话服务（ctx.get('sessions', false)；与 Gherkin steps 同款）。 */
function sessionCtx(entries) {
  const eventSource = { getSnapshot: () => ({ entries, hasMore: false, revision: 1 }) }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
    binding: (id) => (id === 's1' ? { sessionId: 's1', eventSource } : undefined),
  }
  return { effect: (fn) => fn(), get: (name) => (name === 'sessions' ? sessions : undefined) }
}

/** 装配：宿主 0.2.0-rc.2 形态的块（banner 只有本地化标签，<code> 无 language-*）。 */
function setup({ entries = null, block = null, langIndex = null, fail = false } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const target = block ?? makeRealHostCodeBlock({ code: BODY, label: HOST_LABEL })
  scroll.appendChild(target)
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  const stub = installLangFetchStub(langIndex ?? createLangIndex(), { fail })
  const ctx = entries === null ? { effect: (fn) => fn() } : sessionCtx(entries)
  loaded.exports.apply(ctx)
  return { page, loaded, stack, scroll, block: target, stub }
}

const stubText = (block) => {
  const stub = block.querySelector('.official-md-stub')
  return stub === null ? null : stub.getAttribute('data-text')
}

test("确证无语言（client 事件流索引给 ''）→ 按 markdown 兜底渲染，一键可切回原文", () => {
  const fence = ['```', BODY, '```'].join('\n')
  const { block, stack } = setup({ entries: [entry(1, fence)] })
  const body = block.querySelector(TEXT_BODY)
  assert.ok(body, '无语言块获得 markdown 渲染容器')
  assert.equal(stubText(block), BODY, '原文进入官方渲染器')
  assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', '初始为 markdown 视图')
  const toggle = block.querySelector(TOGGLE)
  assert.ok(toggle, '兜底块同样带「查看原文」')
  assert.equal(toggle.textContent, '查看原文', '按钮文案')
  toggle.fire('click')
  assert.equal(block.getAttribute(VIEW_ATTR), 'source', '一键切回原文视图')
  assert.equal(block.querySelectorAll(TEXT_BODY).length, 1, '容器未重复')
  assert.equal(stack.markdown.calls.length, 1, '官方渲染器恰好被调用一次')
})

test('识别失败（拿不到语言）→ 原样保留官方代码块（反回归，绝不误伤）', () => {
  // ① 没有会话事件流（精简上下文 / 老宿主）→ 索引恒为空 → 无确证
  const noCtx = setup({ entries: null })
  assert.equal(noCtx.block.querySelector(TEXT_BODY), null, '拿不到语言时不接管')
  assert.equal(noCtx.block.getAttribute(VIEW_ATTR), null, '无视图属性')
  assert.equal(noCtx.block.querySelector(TOGGLE), null, '无切换按钮')

  // ② host 索引未命中（索引只登记本插件接管的语言，js / java 同样查不到 —— 不可区分）
  const miss = setup({ entries: null, langIndex: createLangIndex() })
  assert.equal(miss.block.querySelector(TEXT_BODY), null, 'host 索引未命中不算确证')
})

test('md / markdown 围栏块纳入 markdown 接管（明确安全的集合扩充）', () => {
  for (const lang of ['md', 'markdown']) {
    const block = makeCodeBlock({ lang, code: BODY })
    const { stack } = setup({ block })
    assert.ok(block.querySelector(TEXT_BODY), lang + ' 块被接管')
    assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', lang + ' 默认 markdown 视图')
    assert.equal(stubText(block), BODY, lang + ' 内容进入官方渲染器')
    assert.equal(stack.markdown.calls.length, 1, lang + ' 恰好渲染一次')
  }
})

test('兜底块与同名语言块签名互不串扰；重复扫描幂等', () => {
  const fence = ['```', BODY, '```'].join('\n')
  const { loaded, block } = setup({ entries: [entry(1, fence)] })
  const first = block.querySelector(TEXT_BODY)
  loaded.exports.apply(sessionCtx([entry(1, fence)]))
  assert.equal(block.querySelector(TEXT_BODY), first, '同容器复用（幂等）')
  assert.equal(block.querySelectorAll(TEXT_BODY).length, 1, '无重复容器')
  assert.equal(block.querySelectorAll(TOGGLE).length, 1, '无重复按钮')
})

test('普通语言块（js / bash）仍不被 markdown 接管（反回归）', () => {
  for (const lang of ['js', 'bash']) {
    const { block } = setup({ entries: [entry(1, ['```' + lang, 'const a = 1', '```'].join('\n'))], block: null })
    assert.equal(block.querySelector(TEXT_BODY), null, lang + ' 块不接管')
  }
})
