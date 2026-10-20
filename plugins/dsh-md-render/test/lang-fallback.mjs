/**
 * 无语言 / 识别失败围栏块的归属（issue #470 需求 3 的口径，自研渲染后重述）。
 *
 *  · **确证无语言**（client 事件流索引给空串）→ **看内容**（fence-content.ts）：明显是
 *    markdown 文档才自研 markdown 渲染（#470 需求 3 的原始意图），否则按代码卡接管。
 *    真实会话取证（2026-10-20 android-monitor）：208 个围栏里 200 个无标记，绝大多数是代码；
 *  · **识别失败**（DOM 只给本地化标签「代码块」且索引拿不到答案）→ 仍按**代码块**接管，
 *    但语言位**留空**：绝不编造语言名，也绝不把它误判成 markdown（真纯文本被当 markdown 会走样）；
 *  · text / plaintext / txt / md / markdown 一律 markdown（明确的安全集合）；
 *  · 其他已知语言（js / bash…）一律自研代码块。
 *
 * 两者在 resolveFenceLangEx 里靠 `confirmed` 区分：'' + confirmed 才是「确证无语言」。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createLangIndex } from '../lib/lang-index.js'
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

const MD_BODY = 'div.mdr-block-md'
const CODE_HOST = 'div.mdr-block'
const CODE_LANG = 'span.mdr-fence-pill'
const TOGGLE = 'button.mdr-rm-btn[data-mdr-option="source"]'
const VIEW_ATTR = 'data-mdr-view'
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
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  const stub = installLangFetchStub(langIndex ?? createLangIndex(), { fail })
  const ctx = entries === null ? { effect: (fn) => fn() } : sessionCtx(entries)
  loaded.exports.apply(ctx)
  return { page, loaded, stack, scroll, block: target, stub }
}

test("确证无语言（client 事件流索引给 ''）→ 按 markdown 渲染，一键可切回原文", () => {
  const fence = ['```', BODY, '```'].join('\n')
  const { block } = setup({ entries: [entry(1, fence)] })
  const body = block.querySelector(MD_BODY)
  assert.ok(body, '无语言块获得自研 markdown 渲染容器')
  assert.equal(body.querySelector('h2').textContent, '标题', '自研渲染产出真实 h2')
  assert.equal(body.querySelectorAll('li').length, 2, '列表渲染为真 li')
  assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', '初始为 markdown 视图')
  const toggle = block.querySelector(TOGGLE)
  assert.ok(toggle, '兜底块同样带「查看原文」')
  assert.equal(toggle.getAttribute('data-mdr-tip'), '渲染为源码', '还原入口文案（底栏三态）')
  toggle.fire('click')
  assert.equal(block.getAttribute('data-dsh-md-render-lang-force'), 'source', '一键切回原文视图（覆盖值）')
  assert.equal(block.querySelectorAll(MD_BODY).length, 0, '源码视图下 markdown 容器已拆干净')
})

test('识别失败（拿不到语言）→ 按代码块接管，语言位留空（不接管成 markdown，也不编造语言名）', () => {
  // ① 没有会话事件流（精简上下文 / 老宿主）→ 索引恒为空 → 无确证
  const noCtx = setup({ entries: null })
  assert.ok(noCtx.block.querySelector(CODE_HOST), '按代码块接管')
  assert.equal(noCtx.block.querySelector(MD_BODY), null, '不被误判成 markdown')
  assert.equal(noCtx.block.querySelector(CODE_LANG).textContent, '', '语言位留空')
  assert.equal(noCtx.block.getAttribute(VIEW_ATTR), 'code', 'code 视图')
  assert.ok(noCtx.block.querySelector(TOGGLE), '代码视图的还原入口同样在底栏三态里')

  // ② host 索引未命中（索引里没有这条内容）→ 同样不算确证
  const miss = setup({ entries: null, langIndex: createLangIndex() })
  assert.equal(miss.block.querySelector(MD_BODY), null, 'host 索引未命中不算确证')
  assert.equal(miss.block.querySelector(CODE_LANG).textContent, '', '语言位留空')
})

test('md / markdown 围栏块纳入 markdown 接管（明确安全的集合扩充）', () => {
  for (const lang of ['md', 'markdown']) {
    const block = makeCodeBlock({ lang, code: BODY })
    setup({ block })
    assert.ok(block.querySelector(MD_BODY), lang + ' 块被接管')
    assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', lang + ' 默认 markdown 视图')
    assert.equal(block.querySelector('h2').textContent, '标题', lang + ' 内容由自研渲染器渲染')
  }
})

test('兜底块与同名语言块签名互不串扰；重复扫描幂等', () => {
  const fence = ['```', BODY, '```'].join('\n')
  const { loaded, block } = setup({ entries: [entry(1, fence)] })
  const first = block.querySelector(MD_BODY)
  loaded.exports.apply(sessionCtx([entry(1, fence)]))
  assert.equal(block.querySelector(MD_BODY), first, '同容器复用（幂等）')
  assert.equal(block.querySelectorAll(MD_BODY).length, 1, '无重复容器')
  assert.equal(block.querySelectorAll(TOGGLE).length, 1, '无重复按钮')
})

test('普通语言块（js / bash）走自研代码块视图（不再是「不接管」）', () => {
  for (const lang of ['js', 'bash']) {
    const host = makeCodeBlock({ lang, code: 'const a = 1' })
    const { block } = setup({ entries: [entry(1, ['```' + lang, 'const a = 1', '```'].join('\n'))], block: host })
    assert.equal(block.querySelector(MD_BODY), null, lang + ' 块不被 markdown 接管')
    assert.equal(block.getAttribute(VIEW_ATTR), 'code', lang + ' 块走代码视图')
    assert.equal(block.querySelector(CODE_LANG).textContent, lang, lang + ' 块 banner 是真实语言名')
  }
})

// ── 防回归（真实会话取证）：无语言围栏的内容是代码时**不得** markdown 化 ────────
// 2026-10-20 android-monitor 会话实测：208 个围栏里 200 个无语言标记，绝大多数是
// Kotlin / SQL / shell 代码。旧口径「确证无语言 → 一律 markdown」把换行吃成一坨。
const KOTLIN = [
  'private const val GRID_COLUMNS = 6',
  '@Composable',
  'internal fun BoxScope.Sheet() {',
  '  val rows = categories.chunked(GRID_COLUMNS)',
  '}',
].join('\n')

test('确证无语言 + 内容是代码 → 按代码卡渲染（等宽保留换行），语言用推断值', () => {
  const fence = ['```', KOTLIN, '```'].join('\n')
  const { block } = setup({
    entries: [entry(1, fence)],
    block: makeRealHostCodeBlock({ code: KOTLIN, label: HOST_LABEL }),
  })
  assert.equal(block.querySelector(MD_BODY), null, '不被误判成 markdown（代码结构不被折叠）')
  assert.ok(block.querySelector(CODE_HOST), '按代码卡接管')
  assert.equal(block.getAttribute(VIEW_ATTR), 'code', 'code 视图')
  assert.equal(block.querySelector(CODE_LANG).textContent.toLowerCase(), 'kotlin', '内容识别出 Kotlin')
  assert.equal(block.getAttribute('data-mdr-lang-inferred'), 'content', '推断语言带标识（不冒充原文标注）')
  const codeEl = block.querySelector('code.mdr-fence-text') ?? block.querySelector('code')
  assert.ok(codeEl !== null && codeEl.textContent.includes('GRID_COLUMNS'), '源码完整交给代码卡')
  assert.ok(codeEl.textContent.includes('\n'), '保留换行（不被 markdown 折叠成一坨）')
})

test('确证无语言 + 内容是 markdown 文档 → 仍按 markdown 渲染（#470 需求 3 保留）', () => {
  const doc = ['## 分类抽屉改 6 列', '', '| 项 | 值 |', '| --- | --- |', '| 图标 | 32dp |'].join('\n')
  const fence = ['```', doc, '```'].join('\n')
  const { block } = setup({
    entries: [entry(1, fence)],
    block: makeRealHostCodeBlock({ code: doc, label: HOST_LABEL }),
  })
  assert.ok(block.querySelector(MD_BODY), 'markdown 文档仍被 markdown 化')
  assert.equal(block.getAttribute(VIEW_ATTR), 'markdown', 'markdown 视图')
})
