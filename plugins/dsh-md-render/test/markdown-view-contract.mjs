/**
 * MarkdownView 公共 API 契约（README「公共 API 契约」钉住的承诺面）。
 *
 * 承诺：require('dsh-md-render').MarkdownView 存在、是 React 组件、props 为
 *       { text: string }（非字符串降级为文本）；渲染内容来自**官方 MarkdownText**
 *       （平台 seed 模块），并带非标准表格容错与整段复制按钮；官方组件不可用时
 *       落 <pre> 兜底（真降级：原文不丢、渲染期不抛错）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createOfficialStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  vdomToDom,
} from './support/fake-dom.mjs'

/** 加载 bundle：withOfficial=false 时平台模块缺失（验证真降级）。 */
function load({ withOfficial = true } = {}) {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = withOfficial ? createOfficialStack(page, react) : { markdown: undefined, reactDom: undefined }
  const loaded = loadBundle({ page, react, markdown: stack.markdown, reactDom: stack.reactDom })
  return { page, react, loaded, stack }
}

test('MarkdownView 导出存在且是函数组件', () => {
  const { loaded } = load()
  assert.equal(typeof loaded.exports.MarkdownView, 'function', 'MarkdownView exported as a component')
})

test('MarkdownView 把文本交给官方 MarkdownText，并带上 labels 契约', () => {
  const { loaded, stack } = load()
  const node = loaded.exports.MarkdownView({ text: 'a | b\n---\n1 | 2' })
  assert.equal(node.type, 'div', 'wrapper element')
  assert.ok(String(node.props.className).includes('tzx-md'), 'wrapper carries the tzx-md contract class')
  const official = node.props.children[0]
  assert.equal(official.type, stack.markdown.MarkdownText, '交给官方 MarkdownText 组件')
  assert.equal(official.props.text, 'a | b\n--- | ---\n1 | 2', '文本先过表格容错规范化再交给官方渲染器')
  assert.ok(official.props.labels && official.props.labels.code, 'labels 透传（官方 MarkdownText 必填）')
  assert.equal(official.props.labels.code.copyLabel, '复制', 'copy label')
  assert.equal(typeof official.props.labels.footnotes, 'string', 'footnotes label')
})

test('非字符串 text 降级为文本（不抛错）', () => {
  const { loaded, stack } = load()
  const empty = loaded.exports.MarkdownView({ text: undefined })
  const numeric = loaded.exports.MarkdownView({ text: 42 })
  assert.equal(empty.props.children[0].props.text, '', 'undefined → 空串')
  assert.equal(numeric.props.children[0].props.text, '42', '数字 → 字符串')
  assert.equal(empty.props.children[0].type, stack.markdown.MarkdownText, '仍然交给官方渲染器')
})

test('官方组件不可用 → <pre> 兜底（原文不丢、渲染期不抛错）', () => {
  const { loaded, page } = load({ withOfficial: false })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '# 标题' }), page.document)
  const fallback = dom.querySelector('pre.dsh-md-render-fallback')
  assert.ok(fallback, 'fallback pre rendered')
  assert.equal(fallback.textContent, '# 标题', '原文保留')
})

test('渲染出的 DOM 带 tzx-md 容器（跨插件 DOM 契约）与官方渲染内容', () => {
  const { loaded, page } = load()
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '# 标题' }), page.document)
  assert.ok(String(dom.className).includes('tzx-md'), 'tzx-md container')
  assert.equal(dom.querySelector('.official-md-stub').getAttribute('data-text'), '# 标题', '官方渲染内容在内')
})
