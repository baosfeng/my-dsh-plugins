/**
 * Events tests: session/event stats (header/context/messages/requests),
 * agent/pre-step budget warn & deny, alert cooldown, passthrough.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import {
  bootPlugin,
  dispatchEvent,
  sessionEvent,
  preStepPayload,
  yieldLoop,
  mockRequest,
  mockResponse,
  invoke,
  jsonOf,
} from './lib/helpers.mjs'
import { isInjection } from '../lib/events.js'

const disposeAlls = []
const tmpDirs = []
afterAll(async () => {
  for (const disposeAll of disposeAlls.splice(0)) await disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

test('session/event: request/header updates system/tools estimates', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'request/header', {
    header: {
      system: 'abcd',
      tools: [{ name: 'bash' }],
      config: { model: 'deepseek-v4', provider: 'deepseek' },
    },
    reason: 'initial',
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.ok(stats.header.systemTokens > 0)
  assert.ok(stats.header.toolsTokens > 0)
  assert.equal(stats.model, 'deepseek-v4')
  assert.equal(stats.provider, 'deepseek')
  await handle.disposeAll()
})

test('session/event: user/message with injection source goes to inject', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'user/message', {
    content: [{ type: 'text', text: 'abcd' }],
    source: { kind: 'plugin', form: 'notice', plugin: 'dsh-x' },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.ok(stats.composition.inject > 0)
  assert.equal(stats.composition.user, 0)
  await handle.disposeAll()
})

test('session/event: assistant/message records request with real usage', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 2,
    message: {
      content: [{ type: 'text', text: 'hello world' }],
      source: { provider: 'deepseek', model: 'deepseek-v4' },
    },
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.usage.inputTokens, 100)
  assert.equal(stats.usage.outputTokens, 20)
  assert.equal(stats.usage.cacheReadTokens, 30)
  assert.equal(stats.requests.length, 1)
  assert.equal(stats.requests[0].turn, 1)
  assert.equal(stats.requests[0].step, 2)
  assert.equal(stats.requests[0].prompt, 130)
  assert.equal(stats.requests[0].total, 150)
  assert.ok(stats.composition.assistant > 0)
  await handle.disposeAll()
})

test('session/event: empty assistant message adds no composition but records usage', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [], source: { provider: 'deepseek', model: 'deepseek-v4' } },
    usage: { inputTokens: 10, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.composition.assistant, 0)
  assert.equal(stats.requests.length, 1)
  await handle.disposeAll()
})

test('session/event: tool/result adds tool composition', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'tool/result', {
    message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }] }] },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.ok(stats.composition.tool > 0)
  await handle.disposeAll()
})

test('session/event: turn/start resets turn usage', async () => {
  const handle = boot({})
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 50, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  const { session: s2, event: e2 } = sessionEvent('s-1', 'turn/start', { turn: 2 })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.usage.inputTokens, 50)
  assert.equal(stats.turnUsage.inputTokens, 0)
  assert.equal(stats.turnUsage.turn, 2)
  await handle.disposeAll()
})

test('agent/pre-step: warn mode records alert and passes through', async () => {
  const handle = boot({ perTurn: 10, mode: 'warn' })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 50, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  let nextCalled = false
  const decision = await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => {
    nextCalled = true
    return { kind: 'enter', messages: [] }
  })
  assert.equal(nextCalled, true, 'warn mode passes through next()')
  assert.equal(decision.kind, 'enter')
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.alerts.length, 1)
  assert.equal(stats.alerts[0].scope, 'turn')
  assert.equal(stats.alerts[0].blocked, false)
  await handle.disposeAll()
})

test('agent/pre-step: deny mode rejects and records blocked alert', async () => {
  const handle = boot({ perTurn: 10, mode: 'deny' })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 50, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  let nextCalled = false
  const decision = await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => {
    nextCalled = true
    return { kind: 'enter', messages: [] }
  })
  assert.equal(nextCalled, false, 'deny mode does not call next()')
  assert.deepEqual(decision, { kind: 'reject' })
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.alerts.length, 1)
  assert.equal(stats.alerts[0].blocked, true)
  await handle.disposeAll()
})

test('agent/pre-step: under budget passes through without alert', async () => {
  const handle = boot({ perTurn: 1000, mode: 'deny' })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 5, outputTokens: 1 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  const decision = await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  assert.equal(decision.kind, 'enter')
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.alerts.length, 0)
  await handle.disposeAll()
})

test('agent/pre-step: unknown session or missing agent passes through', async () => {
  const handle = boot({ perTurn: 1, mode: 'deny' })
  await yieldLoop()
  const decision1 = await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('ghost'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  assert.equal(decision1.kind, 'enter')
  const decision2 = await dispatchEvent(handle.listeners, 'agent/pre-step', { turn: 1 }, async () => ({
    kind: 'enter',
    messages: [],
  }))
  assert.equal(decision2.kind, 'enter')
  await handle.disposeAll()
})

test('agent/pre-step: alert cooldown suppresses duplicate alerts', async () => {
  const handle = boot({ perTurn: 10, mode: 'warn' })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 50, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.alerts.length, 1, 'cooldown suppresses duplicate alert')
  await handle.disposeAll()
})

test('agent/pre-step: records overflow warning when usage crosses warn threshold', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'request/context', { contextWindow: 100 })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  const { session: s2, event: e2 } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 80, outputTokens: 0 },
  })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  await yieldLoop()
  const decision = await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  assert.equal(decision.kind, 'enter', 'overflow warning never blocks the step')
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.overflows.length, 1)
  assert.equal(stats.overflows[0].kind, 'overflow')
  assert.equal(stats.overflows[0].level, 'warn')
  assert.equal(stats.overflows[0].threshold, 0.8)
  assert.ok(stats.overflows[0].time > 0)
  await handle.disposeAll()
})

test('agent/pre-step: critical overflow recorded at 95%+ usage', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'request/context', { contextWindow: 100 })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  const { session: s2, event: e2 } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 95, outputTokens: 0 },
  })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  await yieldLoop()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.overflows.length, 1)
  assert.equal(stats.overflows[0].level, 'critical')
  await handle.disposeAll()
})

test('agent/pre-step: overflow cooldown suppresses same-level duplicate', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'request/context', { contextWindow: 100 })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  const { session: s2, event: e2 } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 80, outputTokens: 0 },
  })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  await yieldLoop()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.overflows.length, 1, 'same-level overflow within cooldown suppressed')
  await handle.disposeAll()
})

test('agent/pre-step: no overflow recorded when context window unknown', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 1000, outputTokens: 0 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await yieldLoop()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.overflows.length, 0)
  await handle.disposeAll()
})

test('agent/pre-step: cumulative cacheRead never triggers overflow — only the current context length does', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await yieldLoop()
  const { session, event } = sessionEvent('s-1', 'request/context', { contextWindow: 100 })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  // 多轮请求：累计 usage（含重复 cacheRead）远超窗口，但当前上下文
  // 长度（最近一次 prompt）只占窗口 30% → 不得产生溢出预警（回归）。
  for (const usage of [
    { inputTokens: 30, cacheReadTokens: 0 },
    { inputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0 },
  ]) {
    const { session: s, event: e } = sessionEvent('s-1', 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'x' }] },
      usage,
    })
    await dispatchEvent(handle.listeners, 'session/event', s, e)
  }
  await yieldLoop()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await yieldLoop()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.usage.cacheReadTokens, 10, 'cumulative cacheRead still recorded')
  assert.equal(stats.lastPromptTokens, 30, 'context length = latest prompt (20+10)')
  assert.equal(stats.overflows.length, 0, '30% context length must not warn despite huge cumulative usage')
  await handle.disposeAll()
})

test('isInjection: source classification', () => {
  assert.equal(isInjection(null), false)
  assert.equal(isInjection({ kind: 'user' }), false)
  assert.equal(isInjection({ kind: 'plugin' }), true)
  assert.equal(isInjection({ form: 'notice' }), true)
  assert.equal(isInjection({ kind: '' }), false)
})

/** 通过 API 路由读取会话统计（与 UI 同路径）。 */
async function sessionStats(handle, sessionId) {
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: `/context/api/session?sessionId=${sessionId}` }), res)
  const body = jsonOf(res)
  assert.equal(body.ok, true, `session stats readable: ${JSON.stringify(body)}`)
  return body.value
}
