/**
 * 需求 2（issue #470）：mermaid 渲染失败时**主次反转** —— 源码是第一位的主视觉。
 *
 * 判据：error 分支的 vdom 里 ① 源码 <pre> 是**第一个**节点；② 失败原因降为**一行灰字提示**
 * （不再有红底加粗标题）；③ **保留「重试」**（引擎加载失败是真实可恢复场景）；
 * ④ 失败态把视图钉到 code（预览按钮禁用且不显示为激活，避免假象）。
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

const SOURCE = 'flowchart TD\n  A["提交订单"] --> B[校验]'

function setup() {
  const scroll = makeElement('div', { 'data-conversation-scroll': 'true' })
  const page = installGlobals(createPage(scroll))
  const react = createReactStub()
  const stack = createRenderStack(page, react)
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  loaded.exports.apply({ effect: (fn) => fn() })
  return { page, loaded }
}

/** 渲染 error 态卡片主体（等价于真实卡片 status === 'error' 的那一帧）。 */
function errorBody(loaded, page) {
  let retries = 0
  const vdom = loaded.exports.CardBody({
    status: 'error',
    mode: 'code',
    error: 'Syntax error in text',
    source: SOURCE,
    svg: null,
    onRetry: () => {
      retries += 1
    },
  })
  return { dom: vdomToDom(vdom, page.document), retries: () => retries }
}

test('失败态：源码 <pre> 是第一个节点（首屏即源码），内容完整', () => {
  const { loaded, page } = setup()
  const { dom } = errorBody(loaded, page)
  const first = dom.childNodes[0]
  assert.equal(first.tagName, 'PRE', '第一个节点是 <pre>')
  assert.equal(String(first.className).includes('dsh-md-render-mermaid-code'), true, '源码容器类')
  assert.equal(first.textContent, SOURCE, '源码一字不差')
  assert.equal(dom.querySelectorAll('pre').length, 1, '只有一份源码')
})

test('失败原因降为一行灰字提示（不再有红底加粗标题），且保留原因原文', () => {
  const { loaded, page } = setup()
  const { dom } = errorBody(loaded, page)
  const line = dom.querySelector('.dsh-md-render-mermaid-error-line')
  assert.ok(line, '有一行提示')
  const msg = dom.querySelector('.dsh-md-render-mermaid-error-msg')
  assert.ok(msg.textContent.includes('Syntax error in text'), '保留失败原因')
  assert.ok(msg.textContent.includes('渲染失败'), '仍有可读前缀')
  assert.equal(dom.querySelectorAll('.dsh-md-render-mermaid-error-title').length, 0, '没有加粗红标题')
  assert.equal(dom.querySelectorAll('.dsh-md-render-mermaid-error-head').length, 0, '没有红底横幅头')
})

test('保留「重试」按钮，且点击触发 onRetry（引擎加载失败可恢复）', () => {
  const { loaded, page } = setup()
  const { dom, retries } = errorBody(loaded, page)
  const retry = dom.querySelector('button.dsh-md-render-mermaid-retry')
  assert.ok(retry, '重试按钮仍在')
  assert.equal(retry.getAttribute('data-dsh-md-render-tip'), '重试渲染', '浮层文案')
  retry.fire('click')
  assert.equal(retries(), 1, 'onRetry 被调用一次')
})

test('失败态视图钉在「代码」态：预览按钮禁用且不显示为激活', () => {
  const { loaded, page } = setup()
  const toggle = vdomToDom(
    loaded.exports.ViewToggle({ mode: 'code', setMode: () => {}, previewDisabled: true }),
    page.document,
  )
  const preview = toggle.querySelectorAll('button').find((b) => b.getAttribute('data-dsh-md-render-tip') === '预览')
  const code = toggle.querySelectorAll('button').find((b) => b.getAttribute('data-dsh-md-render-tip') === '代码')
  assert.equal(preview.getAttribute('disabled'), 'true', '预览按钮禁用')
  assert.notEqual(preview.getAttribute('aria-pressed'), 'true', '预览不显示为激活')
  assert.equal(code.getAttribute('aria-pressed'), 'true', '代码态才是激活态')
})

test('loading / 正常态不受影响（源码容器只在 error / code 视图出现）', () => {
  const { loaded, page } = setup()
  const loading = vdomToDom(
    loaded.exports.CardBody({
      status: 'loading',
      mode: 'preview',
      error: null,
      source: SOURCE,
      svg: null,
      onRetry: () => {},
    }),
    page.document,
  )
  assert.ok(String(loading.className).includes('dsh-md-render-mermaid-loading'), 'loading 态')
  assert.equal(loading.querySelectorAll('pre').length, 0, 'loading 态不显示源码')
  const code = vdomToDom(
    loaded.exports.CardBody({
      status: 'ok',
      mode: 'code',
      error: null,
      source: SOURCE,
      svg: '<svg></svg>',
      onRetry: () => {},
    }),
    page.document,
  )
  assert.equal(code.tagName, 'PRE', '代码视图渲染的是源码 <pre>')
  assert.equal(code.textContent, SOURCE, '代码视图内容 = 源码（不含图表）')
})
