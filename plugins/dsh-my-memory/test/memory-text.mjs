/**
 * dsh-my-memory — memory-text helpers (issue #105): first-sentence
 * extraction, semantic truncation (never cuts mid-sentence when a boundary
 * fits), and the configurable entry-length guidance (maxEntryLength).
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_MAX_ENTRY_LENGTH, firstSentence, isOverEntryLimit, summarizeDesc } from '../lib/memory-text.js'

test('firstSentence returns the whole text when there is no boundary', () => {
  assert.equal(firstSentence('没有句号的短内容'), '没有句号的短内容')
  assert.equal(firstSentence(''), '')
  assert.equal(firstSentence('   '), '   ')
})

test('firstSentence cuts at the first sentence boundary (zh + en punctuation)', () => {
  assert.equal(firstSentence('回复使用中文。代码注释也要中文。'), '回复使用中文。')
  assert.equal(firstSentence('第一句！第二句？第三句'), '第一句！')
  assert.equal(firstSentence('一；二。三'), '一；')
  assert.equal(firstSentence('First sentence. Second one.'), 'First sentence.')
  assert.equal(firstSentence('一\n二'), '一\n')
})

test('firstSentence absorbs trailing ellipsis / repeated punctuation into one sentence', () => {
  assert.equal(firstSentence('真的吗……当然。'), '真的吗……')
  assert.equal(firstSentence('真的吗！！！当然'), '真的吗！！！')
  assert.equal(firstSentence('一……二。'), '一……')
})

test('summarizeDesc keeps short descs untouched', () => {
  assert.equal(summarizeDesc('短内容', 50), '短内容')
  assert.equal(summarizeDesc('abc', 3), 'abc')
  assert.equal(summarizeDesc('', 50), '')
})

test('summarizeDesc returns the FULL first sentence when it fits (no mid-sentence cut)', () => {
  const desc = '回复必须使用中文。代码注释也要中文。'
  assert.equal(summarizeDesc(desc, 10), '回复必须使用中文。', 'first sentence kept whole within the cap')
  assert.ok(!summarizeDesc(desc, 10).includes('代码'), 'second sentence cut off at the boundary')
})

test('summarizeDesc falls back to char truncation only for a boundary-less long single sentence', () => {
  assert.equal(summarizeDesc('a'.repeat(64), 60), `${'a'.repeat(60)}…`)
  assert.equal(summarizeDesc('无任何句子边界的超长内容内容', 6), '无任何句子边…')
})

test('summarizeDesc truncates an over-long first sentence at the char cap', () => {
  // 首句本身超长（无句边界），即使全文多句也按字符截断（不引入后面的句子）
  const desc = 'a'.repeat(120) + '。后面的句子不该出现。'
  const cut = summarizeDesc(desc, 10)
  assert.equal(cut, 'aaaaaaaaaa…', 'char-truncated within the first sentence')
  assert.ok(!cut.includes('后面的句子'), 'later sentence never appears')
})

test('isOverEntryLimit flags text beyond the cap and allows a custom cap', () => {
  assert.equal(isOverEntryLimit('短'), false)
  assert.equal(isOverEntryLimit('x'.repeat(51)), true, 'default cap is 50 (issue #105 suggestion)')
  assert.equal(isOverEntryLimit('x'.repeat(51), 60), false, 'custom cap honored')
  assert.equal(isOverEntryLimit('x'.repeat(DEFAULT_MAX_ENTRY_LENGTH)), false, 'exactly at the cap is allowed')
  assert.equal(isOverEntryLimit('', 50), false)
})

test('DEFAULT_MAX_ENTRY_LENGTH is 50 as suggested by issue #105', () => {
  assert.equal(DEFAULT_MAX_ENTRY_LENGTH, 50)
})

// ── 注入专用摘要：只给结论，不给解释（渐进式注入）────────────────────

test('summarizeForInjection 剥掉长括号（解释性举例），保留短括号（命令/简称）', async () => {
  const { summarizeForInjection } = await import('../lib/memory-text.js')
  assert.equal(
    summarizeForInjection('禁止用 adb 操作手机界面（monkey 启动 App、input swipe、keyevent 等一律不行）', 200),
    '禁止用 adb 操作手机界面',
    '长括号是解释，剥掉',
  )
  assert.equal(
    summarizeForInjection('数值单位用 K/M/B（万/亿）', 200),
    '数值单位用 K/M/B（万/亿）',
    '短括号是信息，保留',
  )
})

test('summarizeForInjection 只取首句并受长度上限约束', async () => {
  const { summarizeForInjection } = await import('../lib/memory-text.js')
  assert.equal(
    summarizeForInjection('项目统一放 IdeaProjects；历史仓库不用迁。补充说明很长很长。', 200),
    '项目统一放 IdeaProjects；',
    '取首句（分号也是边界）',
  )
  assert.equal(summarizeForInjection('甲'.repeat(50), 10), '甲'.repeat(10) + '…', '无句边界 → 字符截断 + 省略号')
})

test('summarizeForInjection 剥完为空时回退原文（不能把条目注成空行）', async () => {
  const { summarizeForInjection } = await import('../lib/memory-text.js')
  assert.equal(
    summarizeForInjection('（这是一段很长的纯解释性括注内容，不该让条目变空）', 200),
    '（这是一段很长的纯解释性括注内容，不该让条目变空）',
  )
})
