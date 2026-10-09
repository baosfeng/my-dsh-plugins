/**
 * Step definitions：dsh-md-render 精简后的 Gherkin 验收（真增量注入点）。
 *
 * 与 vitest 套件共用 test/support/fake-dom.mjs（假 DOM + bundle 加载器 + 平台组件桩）：
 * 验收判据是**接线**——把哪个块的哪段文本交给官方 MarkdownText、容器插在哪里、
 * 原文是否保留、非目标内容是否一动不动的。
 */
import { Given, When, Then, Before, After, setWorldConstructor } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeCodeBlock,
  makeContextPre,
  makeElement,
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
})

Before(function () {
  this.scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  this.row = makeElement('div')
})

After(function () {
  if (this.loaded !== null) this.loaded = null
})

/** 按当前 world 组装页面并加载产物（官方组件在/不在由 this.official 决定）。 */
function boot(world) {
  world.page = installGlobals(createPage(world.scroll))
  const react = createReactStub()
  const stack = world.official ? createOfficialStack(world.page, react) : { markdown: undefined, reactDom: undefined }
  world.stack = stack
  world.loaded = loadBundle({ page: world.page, react, markdown: stack.markdown, reactDom: stack.reactDom })
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

Given('平台官方渲染组件不可用', function () {
  this.official = false
  boot(this)
})

When('插件扫描会话 DOM', function () {
  if (this.loaded === null) boot(this)
  this.loaded.exports.apply({ effect: (fn) => fn() })
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
  this.loaded.exports.apply({ effect: (fn) => fn() })
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
  assert.equal(
    body.querySelector('.official-md-stub').getAttribute('data-text'),
    '## 标题\n\n- 一\n- 二',
    '文本交给官方渲染器',
  )
  assert.equal(this.block.getAttribute('data-dsh-md-render-text-view'), 'markdown', '初始为 markdown 视图')
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
  assert.equal(
    body.querySelector('.official-md-stub').getAttribute('data-text'),
    '## 子 agent 回传\n\n要点 **加粗**',
    '文本交给官方渲染器',
  )
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
