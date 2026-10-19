/**
 * MarkdownView 公共 API 契约（README「公共 API 契约」钉住的承诺面）。
 *
 * 承诺：require('dsh-md-render').MarkdownView 存在、是 React 组件、props 为
 *       { text: string }（非字符串降级为文本）；渲染内容来自**本插件自己的** markdown
 *       渲染器（解析层 marked 走 assets 懒加载），并带非标准表格容错与整段复制按钮；
 *       解析层还没就绪时落 <pre> 兜底（真降级：原文不丢、渲染期不抛错）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createRenderStack,
  createPage,
  createReactStub,
  installGlobals,
  loadBundle,
  vdomToDom,
} from './support/fake-dom.mjs'

/** 加载 bundle：assets=false 时渲染依赖缺失（验证真降级）。 */
function load({ assets = true } = {}) {
  const page = installGlobals(createPage())
  const react = createReactStub()
  const stack = createRenderStack(page, react, { assets })
  const loaded = loadBundle({ page, react, reactDom: stack.reactDom })
  return { page, react, loaded, stack }
}

test('MarkdownView 导出存在且是函数组件', () => {
  const { loaded } = load()
  assert.equal(typeof loaded.exports.MarkdownView, 'function', 'MarkdownView exported as a component')
})

test('MarkdownView 的渲染结果来自自研渲染器（自有 class + 真实标签，不经过官方组件）', () => {
  const { loaded, page } = load()
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '# 标题\n\n正文 **粗**' }), page.document)
  assert.ok(String(dom.className).includes('mdr-md'), 'wrapper carries the mdr-md contract class')
  assert.equal(dom.querySelector('h1').textContent, '标题', '自研渲染产出真实 h1（官方组件不参与）')
  assert.equal(dom.querySelector('strong').textContent, '粗', '行内 markdown 同样是自研渲染')
  assert.equal(dom.querySelector('.official-md-stub'), null, '没有任何官方渲染器产物')
})

test('文本先过表格容错（GFM 不认的两种分隔行写法被规范化）', () => {
  const { loaded, page } = load()
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: 'a | b\n---\n1 | 2' }), page.document)
  assert.ok(dom.querySelector('table'), '分隔行没有管道符的写法也能渲染成真表格')
  assert.equal(dom.querySelectorAll('th').length, 2, '两个表头单元格')
  assert.equal(dom.querySelectorAll('td').length, 2, '两个数据单元格')
})

test('非字符串 text 降级为文本（不抛错）', () => {
  const { loaded, page } = load()
  const empty = vdomToDom(loaded.exports.MarkdownView({ text: undefined }), page.document)
  const numeric = vdomToDom(loaded.exports.MarkdownView({ text: 42 }), page.document)
  assert.equal(empty.textContent.replace('复制', '').trim(), '', 'undefined → 空串')
  assert.equal(numeric.textContent.replace('复制', '').trim(), '42', '数字 → 字符串')
})

test('解析层未就绪 → <pre> 兜底（原文不丢、渲染期不抛错）', () => {
  const { loaded, page } = load({ assets: false })
  const dom = vdomToDom(loaded.exports.MarkdownView({ text: '# 标题' }), page.document)
  const fallback = dom.querySelector('pre.mdr-md-plain')
  assert.ok(fallback, 'fallback pre rendered')
  assert.equal(fallback.textContent, '# 标题', '原文保留')
})
