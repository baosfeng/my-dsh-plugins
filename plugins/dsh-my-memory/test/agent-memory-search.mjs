/**
 * dsh-my-memory — agent 记忆的条目级搜索（agent_memory_search / store.search）。
 *
 * 覆盖：关键词命中（大小写不敏感）、多词 AND、只匹配条目行、limit、
 * 空查询、前缀过滤与归档排除（经 store 的 search 门面）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { searchEntries } from '../lib/agent-memory/search.js'

const FILES = {
  'user.md': '# 用户偏好\n- 回复使用中文\n- 不要写长文\n',
  'projects/aaa/pitfalls.md': '# 项目踩坑\n- 门禁会假红，先串行复跑\n- 中文注释保持原文\n',
}

function readOf(map) {
  return (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null)
}

test('按关键词命中条目，大小写不敏感，返回文件与行号', () => {
  const hits = searchEntries(Object.keys(FILES), readOf(FILES), '中文', 20)
  assert.equal(hits.length, 2, '两个文件各命中一条')
  assert.deepEqual(
    hits.map((h) => h.name),
    ['user.md', 'projects/aaa/pitfalls.md'],
  )
  assert.equal(hits[0].line, 2, '行号是 1-based 且指向条目行')
  assert.equal(hits[0].text, '回复使用中文', '去掉 "- " 前缀')
  assert.equal(searchEntries(Object.keys(FILES), readOf(FILES), '中文注释', 5).length, 1)
})

test('多个词以空格分隔时全部命中才算（AND）', () => {
  assert.equal(searchEntries(Object.keys(FILES), readOf(FILES), '中文 回复', 20).length, 1, '两个词同一行')
  assert.equal(searchEntries(Object.keys(FILES), readOf(FILES), '中文 门禁', 20).length, 0, '分处两行不算命中')
})

test('只匹配条目行，标题文字不参与（避免噪音）', () => {
  const hits = searchEntries(Object.keys(FILES), readOf(FILES), '用户偏好', 20)
  assert.equal(hits.length, 0, '标题行（# 用户偏好）不算条目')
})

test('limit 截断与空查询', () => {
  const hits = searchEntries(Object.keys(FILES), readOf(FILES), '中文', 1)
  assert.equal(hits.length, 1, 'limit 生效')
  assert.deepEqual(searchEntries(Object.keys(FILES), readOf(FILES), '   ', 20), [], '空查询不返回任何结果')
  assert.deepEqual(searchEntries(Object.keys(FILES), readOf(FILES), '', 20), [])
})

test('读取失败的文件跳过，不抛错', () => {
  const hits = searchEntries(['missing.md', 'user.md'], readOf(FILES), '中文', 20)
  assert.equal(hits.length, 1, '缺失文件被跳过')
})
