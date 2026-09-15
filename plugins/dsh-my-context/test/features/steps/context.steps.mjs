/**
 * Step definitions for dsh-my-context Gherkin acceptance tests (context.feature).
 *
 * World + helpers live in world.mjs. Steps boot the plugin against a mocked
 * ctx, drive session/event + agent/pre-step events and API routes, and assert
 * on recorded context stats and budget alerts.
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { sessionEvent, preStepPayload, yieldLoop } from '../../lib/helpers.mjs'

// ── Given ─────────────────────────────────────────────────────────────────
Given('上下文透镜插件已启动', async function () {
  this.boot({})
  await yieldLoop()
})

Given('上下文透镜插件已启动且每轮预算为 {int}', async function (perTurn) {
  this.boot({ perTurn })
  await yieldLoop()
})

Given('上下文透镜插件已启动且每轮预算为 {int} 且模式为拦截', async function (perTurn) {
  this.boot({ perTurn, mode: 'deny' })
  await yieldLoop()
})

// ── When ──────────────────────────────────────────────────────────────────
When('会话 {string} 的请求头包含系统提示与工具', async function (sessionId) {
  const { session, event } = sessionEvent(sessionId, 'request/header', {
    header: {
      system: '你是助手',
      tools: [{ name: 'bash' }, { name: 'read' }],
      config: { model: 'deepseek-v4', provider: 'deepseek' },
    },
    reason: 'initial',
  })
  await this.dispatch('session/event', session, event)
  await yieldLoop()
})

When('会话 {string} 的模型返回带用量统计的回复', async function (sessionId) {
  this.lastSessionId = sessionId
  const input = sessionId === 's-2' ? 200 : 100
  const { session, event } = sessionEvent(sessionId, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      content: [{ type: 'text', text: '回复内容' }],
      source: { provider: 'deepseek', model: 'deepseek-v4' },
    },
    usage: { inputTokens: input, outputTokens: 20, cacheReadTokens: 30 },
  })
  await this.dispatch('session/event', session, event)
  await yieldLoop()
})

When('会话 {string} 收到来自插件的注入消息', async function (sessionId) {
  const { session, event } = sessionEvent(sessionId, 'user/message', {
    content: [{ type: 'text', text: '注入内容' }],
    source: { kind: 'plugin', form: 'notice', plugin: 'dsh-x' },
  })
  await this.dispatch('session/event', session, event)
  await yieldLoop()
})

When('插件重启', async function () {
  await this.handle.disposeAll() // 等旧实例落盘完成，避免它的延迟写落到新实例的读之后（issue #335）
  await yieldLoop()
  this.handle = null
  this.boot({})
  await yieldLoop()
})

When('代理 {string} 准备执行下一步', async function (agentId) {
  await this.dispatch('agent/pre-step', preStepPayload(agentId), async () => ({
    kind: 'enter',
    messages: [],
  }))
})

When('通过接口更新预算为每轮 {int} 且模式为拦截', async function (perTurn) {
  await this.invoke('/context/api/budget', {
    method: 'POST',
    body: JSON.stringify({ perTurn, perSession: 0, mode: 'deny' }),
  })
})

When('会话 {string} 的上下文窗口为 {int}', async function (sessionId, window) {
  const { session, event } = sessionEvent(sessionId, 'request/context', { contextWindow: window })
  await this.dispatch('session/event', session, event)
  await yieldLoop()
})

When('会话 {string} 的模型返回 {int} 输入 token 的回复', async function (sessionId, input) {
  this.lastSessionId = sessionId
  const { session, event } = sessionEvent(sessionId, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      content: [{ type: 'text', text: '回复内容' }],
      source: { provider: 'deepseek', model: 'deepseek-v4' },
    },
    usage: { inputTokens: input, outputTokens: 0 },
  })
  await this.dispatch('session/event', session, event)
  await yieldLoop()
})

When('通过接口把溢出预警阈值设为预警 {int} 告警 {int}', async function (warn, alert) {
  await this.invoke('/context/api/overflow', {
    method: 'POST',
    body: JSON.stringify({ warnThreshold: warn / 100, alertThreshold: alert / 100 }),
  })
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('会话 {string} 的系统构成大于 0', async function (sessionId) {
  const stats = await this.sessionStats(sessionId)
  assert.ok(stats.composition.system > 0)
})

Then('会话 {string} 的工具构成大于 0', async function (sessionId) {
  const stats = await this.sessionStats(sessionId)
  assert.ok(stats.composition.tools > 0)
})

Then('会话 {string} 的输入 token 等于 {int}', async function (sessionId, count) {
  const stats = await this.sessionStats(sessionId)
  assert.equal(stats.usage.inputTokens, count)
})

Then('会话 {string} 的请求数等于 {int}', async function (sessionId, count) {
  const stats = await this.sessionStats(sessionId)
  assert.equal(stats.requests.length, count)
})

Then('请求的 prompt token 等于 {int}', async function (count) {
  const stats = await this.sessionStats(this.lastSessionId)
  assert.equal(stats.requests[0].prompt, count)
})

Then('会话 {string} 的注入构成大于 0', async function (sessionId) {
  const stats = await this.sessionStats(sessionId)
  assert.ok(stats.composition.inject > 0)
})

Then('会话 {string} 的用户构成等于 {int}', async function (sessionId, count) {
  const stats = await this.sessionStats(sessionId)
  assert.equal(stats.composition.user, count)
})

Then('产生 {int} 条预算告警', async function (count) {
  const stats = await this.sessionStats(this.lastSessionId)
  assert.equal(stats.alerts.length, count)
})

Then('下一步未被拦截', function () {
  assert.equal(this.lastDecision.kind, 'enter')
})

Then('下一步被拦截', function () {
  assert.deepEqual(this.lastDecision, { kind: 'reject' })
})

Then('状态接口返回的预算配置为每轮 {int} 且模式为拦截', async function (perTurn) {
  await this.invoke('/context/api/status')
  assert.equal(this.lastValue.budget.perTurn, perTurn)
  assert.equal(this.lastValue.budget.mode, 'deny')
})

Then('产生 {int} 条溢出预警', async function (count) {
  const stats = await this.sessionStats(this.lastSessionId)
  assert.equal(stats.overflows.length, count)
})

Then('溢出预警级别为 {string}', async function (level) {
  const stats = await this.sessionStats(this.lastSessionId)
  assert.equal(stats.overflows[0].level, level)
})
