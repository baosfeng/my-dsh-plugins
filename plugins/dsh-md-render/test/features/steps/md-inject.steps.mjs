/**
 * Step definitions：dsh-md-render 精简后的 Gherkin 验收（真增量注入点）。
 *
 * 与 vitest 套件共用 test/support/fake-dom.mjs（假 DOM + bundle 加载器 + 平台组件桩）：
 * 验收判据是**接线**——把哪个块的哪段文本交给官方 MarkdownText、容器插在哪里、
 * 原文是否保留、非目标内容是否一动不动的。
 */
import { Given, When, Then, Before, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { createLangIndex } from '../../../lib/lang-index.js'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  installLangFetchStub,
  loadBundle,
  makeCodeBlock,
  makeContextPre,
  makeElement,
  makeRealHostCodeBlock,
  vdomToDom,
} from '../../support/fake-dom.mjs'

setWorldConstructor(function World() {
  this.page = null
  this.loaded = null
  this.stack = null
  this.scroll = null
  this.row = null
  this.block = null
  this.pre = null
  this.official = true
  this.langStub = null
  /** 插件 ctx（client 侧围栏语言索引的来源；缺省 = 只有 effect 的精简上下文）。 */
  this.ctx = null
  /** 需求 4 的「渲染为…」控件 / 需求 1 的图表 DOM 夹具。 */
  this.switchBtn = null
  this.zoom = null
  this.panzoomCalls = []
})

Before(function () {
  this.scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  this.row = makeElement('div')
})

After(function () {
  // 清掉语言索引查询桩 + 未命中的重试定时器（场景之间不串味）。
  if (this.langStub !== null) this.langStub.restore()
  if (this.loaded !== null) this.loaded.exports.teardownLangProbes()
  this.loaded = null
})

/** 按当前 world 组装页面并加载产物（官方组件在/不在由 this.official 决定）。 */
function boot(world) {
  world.page = installGlobals(createPage(world.scroll))
  const react = createReactStub()
  const stack = world.official ? createRenderStack(world.page, react) : { reactDom: undefined, assets: null }
  world.stack = stack
  world.loaded = loadBundle({ page: world.page, react, reactDom: stack.reactDom })
}

Given('会话里有语言标记为 {word} 的围栏块，内容是一段 markdown', function (lang) {
  this.block = makeCodeBlock({ lang, code: '## 标题\n\n- 一\n- 二' })
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('宿主把上下文注入正文渲染为纯文本块', function () {
  this.pre = makeContextPre('## 子 agent 回传\n\n要点 **加粗**')
  this.row.appendChild(this.pre)
  this.scroll.appendChild(this.row)
  boot(this)
})

Given('会话里有语言标记为 {word} 的围栏块', function (lang) {
  this.block = makeCodeBlock({ lang, code: 'const a = 1' })
  this.scroll.appendChild(this.block)
})

/**
 * 真实宿主 DOM 形态（issue #466）：banner 只有本地化标签「代码块」、`<code>` 无 language-*，
 * 语言只能从 host 半的语言索引（按块内容哈希）拿到。索引桩接的是 host 半**真实现**。
 */
Given('宿主 banner 只显示本地化标签「代码块」的 {word} 围栏块，且该围栏已登记进 host 语言索引', function (lang) {
  const code = '## 标题\n\n- 一\n- 二'
  this.block = makeRealHostCodeBlock({ code, label: '代码块' })
  this.scroll.appendChild(this.block)
  const index = createLangIndex()
  index.record(['```' + lang, code, '```'].join('\n'))
  boot(this)
  this.langStub = installLangFetchStub(index)
})

Given('平台官方渲染组件不可用', function () {
  this.official = false
  boot(this)
})

When('插件扫描会话 DOM', function () {
  if (this.loaded === null) boot(this)
  this.loaded.exports.apply(this.ctx ?? { effect: (fn) => fn() })
})

/** 扫描 + 让出事件循环一次（冲刷语言索引查询与本插件随后的重扫），再断言。 */
When('插件扫描会话 DOM 并等待语言索引查询完成', async function () {
  if (this.loaded === null) boot(this)
  this.loaded.exports.apply({ effect: (fn) => fn() })
  await new Promise((resolve) => setTimeout(resolve, 0)) // 让出事件循环（非固定等待）
})

When('点击该块的切换按钮', function () {
  this.block.querySelector('button.dsh-md-render-text-toggle').fire('click')
})

// ── 合并后三个核心行为（思考默认展开 / mermaid 卡片 / 与 text 围栏分流）──────

Given('会话里有一条折叠的官方思考行', function () {
  const root = makeElement('div', { 'data-variant': 'think' })
  const row = makeElement('div', { 'data-disclosure-row': 'true', 'aria-expanded': 'false' })
  this.thinkClicks = 0
  // 官方折叠行的真实行为：点击 → 自身状态机展开（本插件只派发点击，不改外观）
  row.addEventListener('click', () => {
    this.thinkClicks += 1
    row.setAttribute('aria-expanded', 'true')
  })
  root.appendChild(row)
  this.scroll.appendChild(root)
  this.thinkRow = row
})

Given('会话里有一个 mermaid 图表代码块', function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n  A["提交订单 (v2)"] --> B[校验]', fiber: false })
  this.block.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话里同时有 text 与 mermaid 围栏块', function () {
  this.textBlock = makeCodeBlock({ lang: 'text', code: '## 标题' })
  this.mermaidBlock = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n  A --> B', fiber: false })
  this.mermaidBlock.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.textBlock)
  this.scroll.appendChild(this.mermaidBlock)
  boot(this)
})

Then('该思考行被展开', function () {
  assert.equal(this.thinkRow.getAttribute('aria-expanded'), 'true', '行已展开')
})

Then('该行只被点击一次（用户手动折叠后不再干预）', function () {
  assert.equal(this.thinkClicks, 1, '恰好派发一次点击')
  this.thinkRow.setAttribute('aria-expanded', 'false')
  this.loaded.exports.apply(this.ctx ?? { effect: (fn) => fn() })
  assert.equal(this.thinkClicks, 1, '已处理过的行不再派发（尊重用户手动折叠）')
})

Then('该块挂上图表卡片容器', function () {
  const host = this.block.querySelector('div.dsh-md-render-mermaid-host')
  assert.ok(host, '卡片 host 已挂上')
  assert.equal(this.block.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '块进入预览视图')
})

Then('官方代码块结构保持不变', function () {
  assert.equal(this.block.querySelectorAll('pre').length, 1, '官方 pre 未被移除')
  assert.equal(
    this.block.querySelector('code').textContent,
    'flowchart TD\n  A["提交订单 (v2)"] --> B[校验]',
    '源码未改写',
  )
})

Then('text 块只被 markdown 接管', function () {
  assert.ok(this.textBlock.querySelector('div.dsh-md-render-text-md'), 'text 块 markdown 化')
  assert.equal(this.textBlock.querySelector('div.dsh-md-render-mermaid-host'), null, 'text 块无卡片 host')
})

Then('mermaid 块只被图表卡片接管', function () {
  assert.ok(this.mermaidBlock.querySelector('div.dsh-md-render-mermaid-host'), 'mermaid 块挂卡片')
  assert.equal(this.mermaidBlock.querySelector('div.dsh-md-render-text-md'), null, 'mermaid 块未被 markdown 接管')
})

Then('该块内出现官方渲染的 markdown 容器', function () {
  const body = this.block.querySelector('div.dsh-md-render-text-md')
  assert.ok(body, '渲染容器已追加')
  assert.ok(String(body.className).includes('tzx-md'), '容器带 tzx-md 契约类')
  assert.equal(body.querySelector('h2').textContent, '标题', '自研渲染产出真实 h2（官方组件不参与）')
  assert.equal(body.querySelectorAll('li').length, 2, '列表渲染为真 li')
  assert.equal(body.querySelector('.official-md-stub'), null, '没有任何官方渲染器产物')
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), 'markdown', '初始为 markdown 视图')
})

Then('该块被按代码块接管（语言位留空）', function () {
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), 'code', '代码视图')
  assert.equal(
    this.block.querySelector('span.dsh-md-render-code-lang').textContent,
    '',
    '语言无从确证时留空，不写「代码块」也不瞎猜',
  )
})

Then('该块带「查看原文」切换按钮', function () {
  const toggle = this.block.querySelector('button.dsh-md-render-text-toggle')
  assert.ok(toggle, '切换按钮已挂上')
  assert.equal(toggle.textContent, '查看原文', '按钮文案')
})

Then('该块进入原文视图', function () {
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), 'source', '切到原文视图')
  assert.equal(this.block.querySelectorAll('div.dsh-md-render-text-md').length, 1, '容器未重复')
})

Then('该纯文本块旁出现官方渲染的 markdown 容器', function () {
  const body = this.row.querySelector('div.dsh-md-render-context-md')
  assert.ok(body, '渲染容器已插入')
  assert.equal(this.pre.previousElementSibling, body, '容器插在原文之前')
  assert.equal(body.querySelector('h2').textContent, '子 agent 回传', '自研渲染产出真实 h2')
  assert.equal(body.querySelector('strong').textContent, '加粗', '加粗渲染为真 strong')
})

Then('原文纯文本块被隐藏', function () {
  assert.equal(this.pre.hidden, true, '原文置 hidden')
  assert.equal(this.pre.textContent, '## 子 agent 回传\n\n要点 **加粗**', '原文内容未改写')
})

Then('没有任何块被接管', function () {
  assert.equal(this.block.querySelector('div.dsh-md-render-text-md'), null, '目标语言之外的块不接管')
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), null, '无视图属性')
  assert.equal(this.scroll.querySelectorAll('div.dsh-md-render-text-md').length, 0, '没有任何渲染容器')
})

// ── client 侧围栏语言索引：会话事件流（含历史）───────────────────────────
// 判据是**接线**：语言来自 ctx.sessions.binding(id).eventSource 的原始 Session 事件，
// 按「规范化代码内容哈希 + 文档序 FIFO」映射回 DOM 块；DOM 只给本地化标签「代码块」、
// host 实时索引为空（冷启动 / 历史会话）时也能接管；无语言 / 有歧义一律退回官方形态。
// R1（真实 cordis 4.0.4 实测）：ctx.get('sessions', false) **无需 inject**，inject 保持 []。

/** 宿主 0.2.0-rc.2 对 shiki 不认识的语言显示的本地化标签（banner 文本）。 */
const HOST_LABEL = '代码块'
const FENCE = '```'
const FENCE_BODY = '## 标题\n\n- 一\n- 二'

/** 围栏 markdown（lang 为空 = 无语言围栏）。 */
function fenceMarkdown(lang, body) {
  return [lang === '' ? FENCE : FENCE + lang, body, FENCE].join('\n')
}

/** 造一条 durable 事件条目（surfaceOp = append）。 */
function messageEntry(seq, markdown) {
  return {
    type: 'event',
    event: {
      seq,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: markdown }] } },
    },
  }
}

/** 假会话服务 + 插件 ctx（ctx.get('sessions', false)；**不声明 inject**）。 */
function sessionCtx(entries) {
  const eventSource = { getSnapshot: () => ({ entries, hasMore: false, revision: 1 }) }
  const sessions = {
    list: { getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }) },
    binding: (id) => (id === 's1' ? { sessionId: 's1', eventSource } : undefined),
  }
  return { effect: (fn) => fn(), get: (name) => (name === 'sessions' ? sessions : undefined) }
}

/** 造一个「0.2.0-rc.2 契约」的代码块：banner 只有本地化标签，<code> 无 language-*。 */
function hostBlock(code) {
  return makeRealHostCodeBlock({ code, label: HOST_LABEL })
}

Given('会话事件流里有语言标记为 {word} 的围栏块，内容是一段 markdown', function (lang) {
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown(lang, FENCE_BODY))])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话事件流里有语言标记为 {word} 的围栏块', function (lang) {
  const source = 'flowchart TD\n  A --> B'
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown(lang, source))])
  this.block = hostBlock(source)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('宿主 DOM 里的该代码块在 0.2.0-rc.2 契约下没有任何语言标记', function () {
  assert.equal(this.block.querySelector('code').className, '', 'code 不带 language-*')
  assert.equal(
    this.block.querySelector('[data-code-block-banner]').firstElementChild.textContent,
    HOST_LABEL,
    'banner 只有本地化标签「代码块」',
  )
})

Given('会话事件流里的围栏块没有语言标记', function () {
  this.ctx = sessionCtx([messageEntry(1, fenceMarkdown('', FENCE_BODY))])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话事件流里同一段内容既是 text 又是 mermaid 围栏', function () {
  this.ctx = sessionCtx([
    messageEntry(1, fenceMarkdown('text', FENCE_BODY)),
    messageEntry(2, fenceMarkdown('mermaid', FENCE_BODY)),
  ])
  this.block = hostBlock(FENCE_BODY)
  this.scroll.appendChild(this.block)
  boot(this)
})

Given('会话 DOM 里该内容只有一块', function () {
  assert.equal(this.scroll.querySelectorAll('div.md-code-block').length, 1, '夹具只有一块（候选数 2 ≠ 块数 1）')
})

Given('会话事件流不可用', function () {
  this.ctx = { effect: (fn) => fn() } // 无 ctx.get → 空表 → 退回 DOM 契约读法
})

Given('会话里有一个代码块在 DOM 上带有语言标记 text', function () {
  this.block = makeCodeBlock({ lang: 'text', code: FENCE_BODY })
  this.scroll.appendChild(this.block)
  boot(this)
})
// ── 需求 3（#470）：确证无语言 → markdown 兜底；识别失败 → 保持官方代码块 ────────

Then('该块被按 markdown 兜底渲染', function () {
  const body = this.block.querySelector('div.dsh-md-render-text-md')
  assert.ok(body, '无语言块按 markdown 兜底渲染')
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), 'markdown', '初始 markdown 视图')
  assert.equal(body.querySelector('h2').textContent, '标题', '自研渲染产出真实 h2')
})

Then('该块不挂图表卡片', function () {
  assert.equal(this.block.querySelector('div.dsh-md-render-mermaid-host'), null, '绝不误伤为图表卡片')
})

Given('宿主 DOM 里有一个只显示本地化标签「代码块」的围栏块', function () {
  this.block = hostBlock('真纯文本，但语言无从确证')
  this.scroll.appendChild(this.block)
  boot(this)
})

// ── 需求 2（#470）：失败态源码为主、错误提示降为一行灰字、保留重试、视图钉 code ──

Given('一个 mermaid 卡片处于渲染失败状态', function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B', fiber: false })
  this.block.querySelector('code').className = 'language-mermaid'
  this.scroll.appendChild(this.block)
  boot(this)
})

When('渲染卡片主体', function () {
  const { CardBody } = this.loaded.exports
  const vdom = CardBody({
    status: 'error',
    mode: 'code',
    error: 'Syntax error in text',
    source: 'flowchart TD\n A --> B',
    svg: null,
    onRetry: () => {},
  })
  this.cardBody = vdomToDom(vdom, this.page.document)
  const toggle = vdomToDom(
    this.loaded.exports.ViewToggle({ mode: 'code', setMode: () => {}, previewDisabled: true }),
    this.page.document,
  )
  this.previewBtn = toggle.querySelectorAll('button').find((b) => b.textContent.includes('预览'))
  this.retryBtn = this.cardBody.querySelector('.dsh-md-render-mermaid-retry')
})

Then('卡片主体的第一个节点是源码 <pre>', function () {
  const first = this.cardBody._nodes[0]
  assert.equal(first.tagName, 'PRE', '第一个节点就是 <pre>')
  assert.equal(first.textContent, 'flowchart TD\n A --> B', '首屏即源码')
})

Then('失败原因只占一行灰字提示', function () {
  const line = this.cardBody._nodes.find(
    (n) => n.nodeType === 1 && String(n.className).includes('dsh-md-render-mermaid-error-line'),
  )
  assert.ok(line, '有一行提示')
  const msg = line._nodes.find(
    (n) => n.nodeType === 1 && String(n.className).includes('dsh-md-render-mermaid-error-msg'),
  )
  assert.ok(msg.textContent.includes('Syntax error in text'), '保留失败原因')
  assert.equal(this.cardBody.querySelectorAll('.dsh-md-render-mermaid-error-title').length, 0, '不再有红底加粗标题')
})

Then('保留「重试」按钮', function () {
  assert.ok(this.retryBtn, '重试按钮仍在（引擎加载失败是真实可恢复场景）')
  assert.ok(this.retryBtn.textContent.includes('重试'), '文案')
})

Then('视图被钉在「代码」态（预览按钮禁用，不显示为激活假象）', function () {
  assert.equal(this.previewBtn.getAttribute('disabled'), 'true', '预览按钮被禁用')
  assert.notEqual(this.previewBtn.getAttribute('aria-pressed'), 'true', '不显示为激活')
})

// ── 需求 4（#470）：语言手动切换（用户显式意图 != 猜语言）─────────────────

const SWITCH = 'div.dsh-md-render-lang-switch'
const LANG_BTN = 'button.dsh-md-render-mermaid-vt'

Then('该块带三选一的「渲染为…」控件', function () {
  assert.ok(this.block.querySelector(SWITCH), '控件已注入')
  assert.deepEqual(
    this.block.querySelectorAll(LANG_BTN).map((b) => b.textContent),
    ['图表', 'Markdown', '源码'],
    '三个选项',
  )
})

When('点击该控件的「{word}」', function (label) {
  const btn = this.block.querySelectorAll(LANG_BTN).find((b) => b.textContent === label)
  assert.ok(btn, '控件里有「' + label + '」')
  btn.fire('click')
})

Then('该块被按 markdown 渲染', function () {
  assert.ok(this.block.querySelector('div.dsh-md-render-text-md'), '已 markdown 化')
})

Then('该块还原为官方代码块', function () {
  assert.equal(this.block.querySelector('div.dsh-md-render-text-md'), null, '渲染容器已拆干净')
  assert.equal(this.block.querySelectorAll('pre').length, 1, '官方 pre 仍在原位')
})

Then('覆盖值写在块的 data-dsh-md-render-lang-force 上（刷新后仍记得）', function () {
  assert.equal(this.block.getAttribute('data-dsh-md-render-lang-force'), 'source', '覆盖值在块属性上')
  const saved = this.page.window.sessionStorage.getItem('dsh-md-render:lang-force')
  assert.ok(String(saved).includes('source'), '并落会话存储（刷新后仍记得）')
})

Then('该块没有任何语言覆盖值', function () {
  assert.equal(this.loaded.exports.fenceForceOf(this.block), undefined, '没点过 = 没有任何覆盖')
  assert.equal(this.block.getAttribute('data-dsh-md-render-lang-force'), null, '块上也没有')
})

// ── 需求 1（#470）：图表全屏 + 缩放 / 平移 ───────────────────────────────

const ENTRY = 'dsh-md-render-mermaid-7'

/** panzoom 桩（记录构造与调用；断言库被懒加载并作用在自有 SVG 容器上）。 */
function panzoomStub(calls) {
  function Panzoom(element, options) {
    const api = {
      element,
      options,
      scale: 1,
      zoom: (scale, opts) => {
        calls.push(['zoom', scale, opts])
        api.scale = scale
        return scale
      },
      pan: (x, y, opts) => {
        calls.push(['pan', x, y, opts])
        return { x, y }
      },
      reset: (opts) => {
        calls.push(['reset', opts])
        return { x: 0, y: 0 }
      },
      getScale: () => api.scale,
      setOptions: () => {},
      destroy: () => calls.push(['destroy']),
    }
    calls.push(['new', element, options])
    return api
  }
  return Panzoom
}

Given('一个图表卡片已渲染出 SVG', function () {
  this.block = makeCodeBlock({ lang: 'mermaid', code: 'flowchart TD\n A --> B', fiber: false })
  const host = makeElement('div', { className: 'dsh-md-render-mermaid-host', 'data-dsh-md-render-mermaid': ENTRY })
  this.host = host
  this.card = makeElement('div', { className: 'dsh-md-render-mermaid-card' })
  this.card.requestFullscreen = () => Promise.resolve()
  this.frame = makeElement('div', { className: 'dsh-md-render-mermaid-svg' })
  this.box = makeElement('div', { className: 'dsh-md-render-mermaid-canvas' })
  const svg = makeElement('svg')
  svg.viewBox = { baseVal: { width: 600, height: 400 } }
  svg._rect = { width: 300, height: 200 }
  this.box.appendChild(svg)
  this.frame.appendChild(this.box)
  this.card.appendChild(this.frame)
  host.appendChild(this.card)
  this.block.appendChild(host)
  this.scroll.appendChild(this.block)
  boot(this)
  this.page.window.Panzoom = panzoomStub(this.panzoomCalls)
  this.loaded.exports.apply({ effect: (fn) => fn() })
  // 工具条由卡片渲染（此处直接渲染 vdom，等价于真实卡片里的按钮组）
  const bar = vdomToDom(this.loaded.exports.ZoomBar({ entryId: ENTRY }), this.page.document)
  this.card.appendChild(bar)
})

/** 点工具条上的按钮（走真实 onClick）。 */
function clickBar(world, label) {
  const btn = world.card.querySelectorAll('button').find((b) => b.textContent === label)
  assert.ok(btn, '工具条里有「' + label + '」')
  btn.fire('click')
}

When('点击「{word}」缩放', function (label) {
  clickBar(this, label)
})

Then('缩放库被懒加载并作用在该卡片自有的 SVG 容器上', async function () {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const made = this.panzoomCalls.find((c) => c[0] === 'new')
  assert.ok(made, 'panzoom 已被构造')
  assert.equal(made[1], this.box, '作用在自有变换层上（不碰官方元素）')
  assert.equal(this.frame.getAttribute('data-dsh-md-render-zoom'), 'on', '外层容器切到裁剪态')
  assert.equal(this.panzoomCalls.filter((c) => c[0] === 'new').length, 1, '只绑一次（幂等）')
})

When('点击「全屏」', function () {
  this.zoomBefore = this.panzoomCalls.filter((c) => c[0] !== 'destroy').length
  clickBar(this, '全屏')
})

Then('页面内出现自有浮窗面板（不用浏览器全屏）', function () {
  assert.equal(this.card.getAttribute('data-dsh-md-render-fs'), 'open', '卡片带浮窗态标记')
  const panel = this.page.document.querySelector('[data-dsh-md-render-fs-panel]')
  assert.ok(panel, '页面内出现自有浮窗面板')
  assert.equal(panel.tagName, 'DIALOG', '用页面内 <dialog> 模态，不碰 Fullscreen API')
  assert.equal(panel._open, true, '已 showModal（遮罩 / Esc / 焦点 / 滚动锁定由它兜底）')
  assert.equal(this.host.parentNode, panel, '宿主（React 根容器）搬进面板')
  assert.equal(this.card.parentNode, this.host, '卡片留在宿主里（合成事件委托不断）')
})

When('点击浮窗内的「关闭」', function () {
  const panel = this.page.document.querySelector('[data-dsh-md-render-fs-panel]')
  const btn = panel.querySelectorAll('button').find((b) => b.textContent === '关闭')
  assert.ok(btn, '浮窗里有「关闭」按钮')
  btn.fire('click')
})

Then('卡片还回原位置且缩放状态保留', function () {
  assert.equal(this.page.document.querySelector('[data-dsh-md-render-fs-panel]'), null, '面板已移除')
  assert.equal(this.host.parentNode, this.block, '宿主回原父节点')
  assert.equal(this.card.getAttribute('data-dsh-md-render-fs'), null, '浮窗态标记已清')
  assert.equal(this.panzoomCalls.filter((c) => c[0] === 'destroy').length, 0, '不销毁实例（变换保留在元素上）')
  assert.ok(this.zoomBefore > 0, '关闭前确实有过工具条/绑定动作')
})
