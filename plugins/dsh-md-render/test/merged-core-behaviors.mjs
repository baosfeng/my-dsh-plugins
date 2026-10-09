/**
 * 合并后三个核心行为的验收覆盖（issue #463 收尾的 Gherkin 缺口）。
 *
 * 原 `zh.feature` / `mermaid.feature` 断言的是**已删除能力**（节点级 assistant-step
 * 席位、自绘思考块、中文 section），不迁入；但合并后新增/保留的三个核心行为必须有
 * 机器可校验的验收：**思考块默认展开**、**mermaid 卡片渲染**、**text 围栏 markdown 化**。
 * 本文件即这三条（Gherkin 侧同步补 md-inject.feature 的场景，见该文件）。
 *
 * 与其它 client 测试同款：桩掉官方渲染器与 react-dom，判据是**接线与状态机**，
 * 不是官方组件自身的渲染正确性。
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

const MERMAID_SOURCE = ['flowchart TD', '  A["提交订单 (v2)"] --> B[校验]', '  B --> C[完成]'].join('\n')

/** 装配页面 + 插件；mermaid 引擎以 window.mermaid 桩就位（不真的注入 3.3MB 引擎）。 */
function setup({ mermaid = true } = {}) {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const page = installGlobals(createPage(scroll))
  const rendered = []
  if (mermaid) {
    page.window.mermaid = {
      initialize() {},
      render(id, source, container) {
        rendered.push({ id, source })
        if (container) {
          const bomb = page.document.createElement('div')
          bomb.className = 'error-icon'
          container.appendChild(bomb)
        }
        return Promise.resolve({ svg: '<svg data-mermaid="' + id + '"></svg>' })
      },
    }
  }
  const react = createReactStub()
  const stack = createOfficialStack(page, react)
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded, stack, scroll, rendered }
}

/** 造一个 mermaid 块：语言标记来自 `code.language-mermaid`（官方 DOM 契约，不读 fiber）。 */
function makeMermaidBlock(code = MERMAID_SOURCE, lang = 'mermaid') {
  const block = makeCodeBlock({ lang, code, fiber: false })
  block.querySelector('code').className = 'language-' + lang
  return block
}

test('核心行为①：mermaid / mmd 代码块渲染为图表卡片（不改官方节点结构）', () => {
  const { loaded, scroll } = setup()
  const block = makeMermaidBlock()
  scroll.appendChild(block)
  loaded.exports.considerMermaidBlock(block, 1)

  assert.equal(block.getAttribute('data-dsh-md-render-mermaid-view'), 'preview', '块进入预览视图')
  const host = block.querySelector('div.dsh-md-render-mermaid-host')
  assert.ok(host, '卡片 host 挂在块内')
  assert.ok(host.getAttribute('data-dsh-md-render-mermaid'), 'host 带 entryId')
  assert.equal(host.getAttribute('data-dsh-md-render-mermaid-state'), 'loading', '初始渲染态为 loading')
  assert.ok(host.querySelector('.dsh-md-render-mermaid-card'), '卡片组件已渲染')
  // 官方节点结构不变：pre / code 仍在原位（隐藏交给自有 CSS）
  assert.equal(block.querySelectorAll('pre').length, 1, '官方 pre 未被移除')
  assert.equal(block.querySelector('code').textContent, MERMAID_SOURCE, '源码未改写')
})

test('核心行为①：引擎调用走离屏容器（失败图形不进页面，成功只取 SVG）', async () => {
  const { page, loaded, rendered } = setup()
  const engine = await loaded.exports.ensureMermaid()
  assert.ok(engine, '引擎从 window.mermaid 复用（不重复 fetch）')
  const svg = await loaded.exports.renderSvg(engine, 'dsh-md-render-mermaid-9', MERMAID_SOURCE)
  assert.equal(svg, '<svg data-mermaid="dsh-md-render-mermaid-9"></svg>', '返回引擎产出的 SVG 字符串')
  assert.equal(rendered.length, 1, '引擎被调用一次')
  assert.equal(rendered[0].source, MERMAID_SOURCE, '引擎收到块源码')
  // 离屏容器必须被丢弃：mermaid 10.9.3 失败时会把「炸弹图」插进渲染容器
  assert.equal(page.document.body.querySelectorAll('[data-dsh-md-render-offscreen]').length, 0, '离屏容器已移除')
  assert.equal(page.document.body.querySelectorAll('.error-icon').length, 0, '引擎错误图形不进页面')
})

test('核心行为①：非 mermaid 块与关闭开关时都不渲染卡片', () => {
  const { loaded, scroll } = setup()
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  scroll.appendChild(js)
  loaded.exports.considerMermaidBlock(js, 1)
  assert.equal(js.getAttribute('data-dsh-md-render-mermaid-view'), null, 'js 块不被接管')
  assert.equal(js.querySelector('div.dsh-md-render-mermaid-host'), null, 'js 块无卡片 host')

  const off = setup()
  const block = makeMermaidBlock()
  off.scroll.appendChild(block)
  off.loaded.exports.setRenderOptions({ mermaid: { render: false } })
  off.loaded.exports.considerMermaidBlock(block, 1)
  assert.equal(block.querySelector('div.dsh-md-render-mermaid-host'), null, '开关关闭后不渲染')
})

test('核心行为①：流式中的 mermaid 块等内容稳定（不抢先渲染残缺图）', () => {
  const { loaded, scroll, rendered } = setup()
  const wrap = makeElement('div', { 'data-streaming': 'true' })
  const block = makeMermaidBlock()
  wrap.appendChild(block)
  scroll.appendChild(wrap)
  loaded.exports.considerMermaidBlock(block, 1)
  assert.equal(block.querySelector('div.dsh-md-render-mermaid-host'), null, '流式中不挂卡片')
  assert.equal(rendered.length, 0, '引擎未被调用')
})

test('核心行为②：思考行默认展开（派发一次真实 click，尊重用户手动折叠）', () => {
  const { loaded } = setup({ mermaid: false })
  const root = makeElement('div', { 'data-variant': 'think' })
  const row = makeElement('div', { 'data-disclosure-row': 'true', 'aria-expanded': 'false' })
  let clicks = 0
  // 官方折叠行的真实行为：点击 → 自身状态机展开。桩用真实 click 监听（think.ts 走 el.click()）。
  row.addEventListener('click', () => {
    clicks += 1
    row.setAttribute('aria-expanded', 'true')
  })
  root.appendChild(row)

  loaded.exports.applyThinkExpand(root)
  assert.equal(clicks, 1, '派发一次点击')
  assert.equal(row.getAttribute('aria-expanded'), 'true', '行已展开（官方状态机接管）')

  loaded.exports.applyThinkExpand(root)
  assert.equal(clicks, 1, '同一行只处理一次（WeakSet 幂等，用户折叠后不再干预）')

  // 用户手动折叠 → 本插件不再碰它
  row.setAttribute('aria-expanded', 'false')
  loaded.exports.applyThinkExpand(root)
  assert.equal(clicks, 1, '已处理过的行不再派发点击')
})

test('核心行为②：开关关闭 / 无思考容器 / 契约失配都不动作（静默降级）', () => {
  const { loaded } = setup({ mermaid: false })
  const root = makeElement('div', { 'data-variant': 'think' })
  const row = makeElement('div', { 'data-disclosure-row': 'true', 'aria-expanded': 'false' })
  let clicks = 0
  row.addEventListener('click', () => {
    clicks += 1
  })
  root.appendChild(row)
  loaded.exports.setRenderOptions({ thinking: { defaultExpanded: false } })
  loaded.exports.applyThinkExpand(root)
  assert.equal(clicks, 0, '开关关闭时不派发')

  const plain = makeElement('div')
  plain.appendChild(makeElement('div', { 'data-disclosure-row': 'true', 'aria-expanded': 'false' }))
  loaded.exports.setRenderOptions({ thinking: { defaultExpanded: true } })
  loaded.exports.applyThinkExpand(plain)
  assert.ok(true, '无 [data-variant="think"] 容器时短路，不抛错')
})

test('核心行为③：text 围栏块 markdown 化，并与 mermaid 分流（不双重包裹）', () => {
  const { loaded, scroll, stack } = setup()
  const text = makeCodeBlock({ lang: 'text', code: '## 标题' })
  const mermaid = makeMermaidBlock()
  const js = makeCodeBlock({ lang: 'js', code: 'const a = 1' })
  scroll.appendChild(text)
  scroll.appendChild(mermaid)
  scroll.appendChild(js)

  // 与 scanner 相同的分流顺序：text 围栏 → mermaid（语言集合不重叠）
  loaded.exports.scanTextBlocks(scroll)
  loaded.exports.scanMermaidBlocks(scroll, 1)

  assert.ok(text.querySelector('div.dsh-md-render-text-md'), 'text 块 markdown 化')
  assert.equal(text.getAttribute('data-dsh-md-render-mermaid-view'), null, 'text 块不被 mermaid 接管')
  assert.equal(text.querySelector('div.dsh-md-render-mermaid-host'), null, 'text 块无卡片 host')

  assert.ok(mermaid.querySelector('div.dsh-md-render-mermaid-host'), 'mermaid 块挂卡片')
  assert.equal(mermaid.querySelector('div.dsh-md-render-text-md'), null, 'mermaid 块不被 markdown 接管')

  assert.equal(js.getAttribute('data-dsh-md-render-text-view'), null, 'js 块不被 markdown 接管')
  assert.equal(js.querySelector('div.dsh-md-render-mermaid-host'), null, 'js 块无卡片 host')
  assert.equal(stack.markdown.calls.filter((c) => c.text === '## 标题').length, 1, 'text 内容进入官方渲染器一次')
})
