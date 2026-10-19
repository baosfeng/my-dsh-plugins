/**
 * 需求 2（issue #470）：mermaid 渲染失败时**主次反转** —— 源码是第一位的主视觉。
 *
 * 判据：error 分支的 vdom 里 ① 源码 <pre> 是**第一个**节点（首屏即源码）；
 * ② 失败原因降为**一行灰字提示**（不再有红底加粗标题）；③ **保留「重试」**；
 * ④ 失败态把视图钉在 code（预览按钮禁用、不显示为激活）。
 *
 * 与「绝不静默丢内容」的关系：一致且加强 —— 源码仍完整可见，只是从「报错为主」翻成
 * 「源码为主、提示为辅」。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  makeElement,
  vdomToDom,
} from './support/fake-dom.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'flowchart TD\n  A["提交订单"] --> B[校验]'
const HERE = dirname(fileURLToPath(import.meta.url))
const CARD_SRC = readFileSync(join(HERE, '..', 'src', 'client', 'parts', 'mermaid-card.ts'), 'utf8')
const TOOLBAR_SRC = readFileSync(join(HERE, '..', 'src', 'client', 'parts', 'mermaid-toolbar.ts'), 'utf8')

function setup() {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded }
}

test('失败态：源码 <pre> 是第一个节点（首屏即源码），内容完整', () => {
  const { loaded, page } = setup()
  const dom = vdomToDom(
    loaded.exports.MmDiagramError({ error: 'Syntax error in text', source: SOURCE, onRetry() {} }),
    page.document,
  )
  const first = dom.childNodes[0]
  assert.equal(first.tagName, 'PRE', '第一个节点是 <pre>')
  assert.ok(String(first.className).includes('mdr-mm-error-src'), '源码容器类')
  assert.equal(first.textContent, SOURCE, '源码一字不差')
  assert.equal(dom.querySelectorAll('pre').length, 1, '只有一份源码')
})

test('失败原因降为一行灰字提示（不再有红底加粗标题），且保留原因原文', () => {
  const { loaded, page } = setup()
  const dom = vdomToDom(
    loaded.exports.MmDiagramError({ error: 'Syntax error in text', source: SOURCE, onRetry() {} }),
    page.document,
  )
  const msg = dom.querySelector('.mdr-mm-error-msg')
  assert.ok(msg, '有一行提示')
  assert.ok(msg.textContent.includes('Syntax error in text'), '保留失败原因')
  assert.ok(msg.textContent.includes('渲染失败'), '仍有可读前缀')
  // 旧的红底横幅 / 加粗标题类名不得回来。
  for (const gone of ['.mdr-mm-error-title', '.mdr-mm-error-head', '.mdr-mm-error-line']) {
    assert.equal(dom.querySelector(gone), null, '不再有 ' + gone)
  }
})

test('保留「重试」按钮，且点击触发 onRetry（引擎加载失败可恢复）', () => {
  const { loaded, page } = setup()
  let retries = 0
  const dom = vdomToDom(
    loaded.exports.MmDiagramError({ error: 'boom', source: SOURCE, onRetry: () => (retries += 1) }),
    page.document,
  )
  const retry = dom.querySelector('button.mdr-mm-retry')
  assert.ok(retry, '重试按钮仍在')
  assert.equal(retry.getAttribute('data-mdr-tip'), '重试渲染', '浮层文案')
  retry.fire('click')
  assert.equal(retries, 1, 'onRetry 被调用一次')
})

test('失败态视图钉在「代码」态：预览按钮禁用且不显示为激活', () => {
  // 卡片把 status 传给视图分段：失败态 → previewDisabled；未就绪不绑缩放。
  assert.ok(TOOLBAR_SRC.includes("previewDisabled: props.status === 'error'"), '预览按钮由失败态门控')
  assert.ok(CARD_SRC.includes("const zoomable = ready && view === 'diagram'"), '失败态不绑缩放')
  assert.ok(CARD_SRC.includes("'data-mdr-mm-view': view"), '视图状态由根节点属性驱动')
})

test('loading / 正常态不受影响（源码容器只在 error / code 视图出现）', () => {
  const { loaded, page } = setup()
  const loading = vdomToDom(
    loaded.exports.MmDiagram({ status: 'loading', svg: null, error: null, source: SOURCE, onRetry() {} }),
    page.document,
  )
  assert.ok(String(loading.className).includes('mdr-mm-loading'), 'loading 态')
  assert.equal(loading.querySelectorAll('pre').length, 0, 'loading 态不显示源码')
  const code = vdomToDom(
    loaded.exports.MmDiagram({ status: 'ok', svg: null, error: null, source: SOURCE, onRetry() {} }),
    page.document,
  )
  assert.equal(code.tagName, 'PRE', '无 SVG 时退化为源码 <pre>')
  assert.ok(String(code.className).includes('mdr-mm-code'), '源码视图类')
  assert.equal(code.textContent, SOURCE, '源码视图内容 = 源码（不含图表）')
})
