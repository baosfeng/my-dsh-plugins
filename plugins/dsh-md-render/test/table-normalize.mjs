/**
 * 非标准表格容错（normalizeTables）—— 本插件相对官方 GFM 的**唯一真增量**。
 *
 * 判据来自对官方解析链的**实测**（micromark-extension-gfm@3 + mdast-util-gfm@3，
 * 与 ui-primitives/src/markdown/parse.ts:16,29-30 同一套扩展）：
 *   · GFM **接受**：无首尾管道符、紧凑分隔行、单横线分隔（-|-）、表格前有普通
 *     段落文本、数据行列数不等、只有表头、逐列对齐标记 → 这些不需要我们做任何
 *     事，官方自己就渲染成表格（本文件用「规范化后逐字不变」钉住这一点）；
 *   · GFM **不接受**：分隔行完全没有管道符（被当 setext 标题）、分隔行单元格数
 *     与表头不等（整段不识别）→ normalizeTables 把它规范化为合法 GFM 分隔行，
 *     再交给官方组件渲染（本插件不自实现任何渲染）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createPage, createReactStub, installGlobals, loadBundle } from './support/fake-dom.mjs'

const page = installGlobals(createPage())
const loaded = loadBundle({ page, react: createReactStub() })
const normalizeTables = loaded.exports.normalizeTables
assert.equal(typeof normalizeTables, 'function', 'normalizeTables 由产物导出')

test('GFM 已接受的写法一字不动（官方自己渲染成表格）', () => {
  const unchanged = [
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'a | b\n--- | ---\n1 | 2',
    'a | b\n---|---\n1 | 2',
    'a | b\n-|-\n1 | 2',
    'a | b | c\n-|-|-\n1 | 2 | 3',
    'a|b\n-|-\n1|2',
    '前缀 **文本**\na | b\n--- | ---\n1 | 2',
    '| :--- | :---: | ---: |\n| --- | --- | --- |\n| 1 | 2 | 3 |',
    'a | b\n--- | ---',
    'a | b\n--- | ---\n1\n2 | 3 | 4',
    '普通段落\n\n没有任何表格',
  ]
  for (const text of unchanged) {
    assert.equal(normalizeTables(text), text, '保持不变：' + JSON.stringify(text))
  }
})

test('分隔行没有管道符（GFM 视为 setext 标题）→ 规范化为合法分隔行', () => {
  assert.equal(normalizeTables('a | b\n---\n1 | 2'), 'a | b\n--- | ---\n1 | 2')
  assert.equal(normalizeTables('some | pipe\n---'), 'some | pipe\n--- | ---')
  assert.equal(normalizeTables('a | b\n:---:\n1 | 2'), 'a | b\n:---: | ---\n1 | 2')
  assert.equal(normalizeTables('a | b | c\n-\n1 | 2 | 3'), 'a | b | c\n--- | --- | ---\n1 | 2 | 3')
})

test('分隔行列数与表头不等（GFM 整段不识别）→ 补齐 / 裁剪到表头列数', () => {
  assert.equal(normalizeTables('a | b | c\n--- | ---\n1 | 2'), 'a | b | c\n--- | --- | ---\n1 | 2')
  assert.equal(normalizeTables('a | b\n--- | --- | ---\n1 | 2'), 'a | b\n--- | ---\n1 | 2')
})

test('对齐标记：合法 GFM 分隔行原样保留，列数不等时逐列保留对齐语义', () => {
  // 合法（列数一致）→ GFM 自己认，一字不动
  const valid = 'a | b | c\n:-- | :-: | --:\n1 | 2 | 3'
  assert.equal(normalizeTables(valid), valid, '合法 GFM 对齐分隔行不改动')
  // 列数与表头不等 → 规范化，并把已有对齐标记逐列保留（缺列补左对齐）
  assert.equal(normalizeTables('a | b | c\n:-- | :-:\n1 | 2 | 3'), 'a | b | c\n:--- | :---: | ---\n1 | 2 | 3')
})

test('多行文本里只改需要改的那一行（含非表格行一字不动）', () => {
  const input = ['# 标题', '', 'a | b', '---', '1 | 2', '', '结尾段落'].join('\n')
  const expected = ['# 标题', '', 'a | b', '--- | ---', '1 | 2', '', '结尾段落'].join('\n')
  assert.equal(normalizeTables(input), expected)
})

test('引用块内的管道行不误伤（GFM 的引用内表格语法不同）', () => {
  const input = '> a | b\n> ---\n'
  assert.equal(normalizeTables(input), input)
})

test('非字符串输入按文本处理（不抛错）', () => {
  assert.equal(normalizeTables(undefined), 'undefined')
  assert.equal(normalizeTables(null), 'null')
})
