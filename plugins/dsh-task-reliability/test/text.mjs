/**
 * Unit tests for lib/text.js — 会话文本提取（顶层会话判定 / 最后 assistant
 * 文本 / 会话摘要）。直接 import 纯函数，覆盖 P2 拆分后子模块的全部逻辑
 * 分支（变异测试补盲：text.js 拆分后变异分 50.81% → 目标 ≥90%）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { isTopLevelAgent, lastAssistantText, summarizeSession } from '../lib/text.js'

// ── isTopLevelAgent ──────────────────────────────────────────────────────
function headerOf(overrides) {
  return { session: { header: { origin: 'user', ...overrides } } }
}

test('isTopLevelAgent: 缺失/空 header → false', () => {
  assert.equal(isTopLevelAgent(undefined), false)
  assert.equal(isTopLevelAgent(null), false)
  assert.equal(isTopLevelAgent({}), false)
  assert.equal(isTopLevelAgent({ session: {} }), false)
  assert.equal(isTopLevelAgent({ session: { header: null } }), false)
})

test('isTopLevelAgent: subagent origin → false', () => {
  assert.equal(isTopLevelAgent({ session: { header: { origin: 'subagent' } } }), false)
})

test('isTopLevelAgent: delegationDepth > 0 → false，0 → true', () => {
  assert.equal(isTopLevelAgent(headerOf({ delegationDepth: 1 })), false)
  assert.equal(isTopLevelAgent(headerOf({ delegationDepth: 0 })), true)
})

test('isTopLevelAgent: 普通顶层会话 → true', () => {
  assert.equal(isTopLevelAgent(headerOf({})), true)
  assert.equal(isTopLevelAgent({ session: { header: { origin: 'user', delegationDepth: 0 } } }), true)
})

// ── lastAssistantText ────────────────────────────────────────────────────
function textEvent(type, text) {
  return { type, data: { message: { content: [{ type: 'text', text }] } } }
}

test('lastAssistantText: 无事件/空事件/非数组 → 空串', () => {
  assert.equal(lastAssistantText(undefined), '')
  assert.equal(lastAssistantText({}), '')
  assert.equal(lastAssistantText({ events: [] }), '')
  assert.equal(lastAssistantText({ events: 'not-array' }), '')
})

test('lastAssistantText: 跳过非 assistant 消息', () => {
  const events = [
    { type: 'user/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
    { type: 'tool/executed', data: {} },
  ]
  assert.equal(lastAssistantText({ events }), '')
})

test('lastAssistantText: 空块/非 text 块/message 为空 → 跳过', () => {
  const events = [
    { type: 'assistant/message', data: { message: { content: [] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'tool', text: 'x' }] } } },
    { type: 'assistant/message', data: { message: null } },
    { type: 'assistant/message', data: { message: { content: 'str' } } },
    textEvent('assistant/message', 'real-answer'),
  ]
  assert.equal(lastAssistantText({ events }), 'real-answer')
})

test('lastAssistantText: 取最后一条非空 assistant 文本（从后向前）', () => {
  const events = [textEvent('assistant/message', 'first'), textEvent('assistant/message', 'last')]
  assert.equal(lastAssistantText({ events }), 'last')
  assert.equal(lastAssistantText({ events: [textEvent('assistant/message', '')] }), '')
})

test('lastAssistantText: snapshotEvents 优先（新 API），events 兜底（旧 API），都没有 → 空串（issue #165）', () => {
  const events = [textEvent('assistant/message', 'snapshot-answer')]
  // 有 snapshotEvents（0.1.2-rc.1 新 API）：优先使用，events 被忽略
  assert.equal(lastAssistantText({ snapshotEvents: () => events, events: [] }), 'snapshot-answer')
  // 只有 events（旧 API）：兜底使用
  assert.equal(lastAssistantText({ events }), 'snapshot-answer')
  // 都没有：返回空串（不崩溃）
  assert.equal(lastAssistantText({}), '')
  assert.equal(lastAssistantText(undefined), '')
})

test('lastAssistantText: 多文本块按换行拼接', () => {
  const events = [
    {
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      },
    },
  ]
  assert.equal(lastAssistantText({ events }), 'a\nb')
})

// ── summarizeSession ─────────────────────────────────────────────────────
test('summarizeSession: 无事件 → 回退文本含 desc', () => {
  const s = summarizeSession({}, '任务描述X')
  assert.ok(s.includes('任务描述X'))
  assert.ok(s.includes('无法读取会话历史'))
  assert.ok(summarizeSession(undefined, 'd').includes('d'))
})

test('summarizeSession: 用户/助手消息带前缀拼接', () => {
  const events = [
    { type: 'user/message', data: { message: { content: [{ type: 'text', text: 'hello' }] } } },
    textEvent('assistant/message', 'world'),
  ]
  const s = summarizeSession({ events }, 'd')
  assert.ok(s.includes('用户: hello'))
  assert.ok(s.includes('助手: world'))
  assert.ok(s.startsWith('用户: hello'))
})

test('summarizeSession: 非消息事件被过滤', () => {
  const events = [
    { type: 'meta/status', data: {} },
    { type: 'user/message', data: { message: { content: [] } } },
    { type: 'user/message', data: {} },
  ]
  assert.equal(summarizeSession({ events }, 'd'), '（无法读取会话历史）任务描述：d')
})

test('summarizeSession: 长文本截断到 600 字符（含前缀）', () => {
  const long = 'x'.repeat(700)
  const events = [textEvent('assistant/message', long)]
  const s = summarizeSession({ events }, 'd')
  assert.ok(s.startsWith('助手: '))
  assert.equal(s.length, 600 + 4) // '助手: ' 4 字符 + 600 截断
  assert.ok(!s.includes('x'.repeat(601)))
})

test('summarizeSession: 600 字符边界不截断', () => {
  const exact = 'y'.repeat(600)
  const s = summarizeSession({ events: [textEvent('assistant/message', exact)] }, 'd')
  assert.ok(s.includes(exact))
})

test('summarizeSession: 仅取最近 40 条事件', () => {
  const events = Array.from({ length: 60 }, (_, i) => ({
    type: 'user/message',
    data: { message: { content: [{ type: 'text', text: `u${i}` }] } },
  }))
  const s = summarizeSession({ events }, 'd')
  assert.ok(!s.includes('u0'))
  assert.ok(!s.includes('u19'))
  assert.ok(s.includes('u59'))
})

test('summarizeSession: 摘要超 SUMMARY_MAX_CHARS(8000) 时截尾部', () => {
  const events = Array.from({ length: 50 }, (_, i) => textEvent('assistant/message', `m${i}-` + 'y'.repeat(400)))
  const s = summarizeSession({ events }, 'd')
  assert.ok(s.length <= 8000)
  assert.ok(s.endsWith('y'), '保留尾部')
})
