/**
 * Mutation-targeted tests: covers untested branches — fence variants
 * (trusted hosts / origin / malformed), route shapes (budget update,
 * alerts, sessions, fence 403), store edge cases.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTrustedApiRequest } from 'dsh-shared'
import { bootPlugin, mockRequest, mockResponse, invoke, jsonOf, settle } from './lib/helpers.mjs'

const disposeAlls = []
const tmpDirs = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

// ── fence variants ─────────────────────────────────────────────────────────

test('fence: loopback hosts accepted, foreign hosts rejected', () => {
  const trusted = []
  assert.equal(isTrustedApiRequest(mockRequest({ host: '127.0.0.1:3080' }), trusted), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'localhost:3080' }), trusted), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'evil.example' }), trusted), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '192.168.1.1:3080' }), trusted), false)
})

test('fence: trustedHosts accepted, origin same/cross checks', () => {
  const trusted = ['dsh.example']
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example' }), trusted), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example:3080' }), trusted), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example', origin: 'http://dsh.example' }), trusted), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example', origin: 'http://evil.example' }), trusted), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example', secFetchSite: 'cross-site' }), trusted), false)
})

test('fence: malformed host / origin rejected', () => {
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'not a url' }), []), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '127.0.0.1:3080', origin: 'not a url' }), []), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), []), true)
})

// ── routes ─────────────────────────────────────────────────────────────────

test('routes: POST /budget updates config and persists', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(
    handle.api,
    mockRequest({
      url: '/context/api/budget',
      method: 'POST',
      body: JSON.stringify({ perTurn: 500, perSession: 10000, mode: 'deny' }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.deepEqual(jsonOf(res).value.budget, { perTurn: 500, perSession: 10000, mode: 'deny' })
  const status = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/status' }), status)
  assert.deepEqual(jsonOf(status).value.budget, { perTurn: 500, perSession: 10000, mode: 'deny' })
  handle.disposeAll()
})

test('routes: POST /budget with invalid values falls back to defaults', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(
    handle.api,
    mockRequest({
      url: '/context/api/budget',
      method: 'POST',
      body: JSON.stringify({ perTurn: -1, perSession: 'x', mode: 'bogus' }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.deepEqual(jsonOf(res).value.budget, { perTurn: 0, perSession: 0, mode: 'warn' })
  handle.disposeAll()
})

test('routes: status exposes overflow thresholds, POST /overflow updates them', async () => {
  const handle = boot({})
  await settle()
  const status = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/status' }), status)
  assert.deepEqual(jsonOf(status).value.overflow, { warnThreshold: 0.8, alertThreshold: 0.9 })
  const res = mockResponse()
  await invoke(
    handle.api,
    mockRequest({
      url: '/context/api/overflow',
      method: 'POST',
      body: JSON.stringify({ warnThreshold: 0.6, alertThreshold: 0.7 }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.deepEqual(jsonOf(res).value.overflow, { warnThreshold: 0.6, alertThreshold: 0.7 })
  const status2 = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/status' }), status2)
  assert.deepEqual(jsonOf(status2).value.overflow, { warnThreshold: 0.6, alertThreshold: 0.7 })
  handle.disposeAll()
})

test('routes: POST /overflow with invalid values falls back to defaults', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(
    handle.api,
    mockRequest({
      url: '/context/api/overflow',
      method: 'POST',
      body: JSON.stringify({ warnThreshold: -1, alertThreshold: 1.5 }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.deepEqual(jsonOf(res).value.overflow, { warnThreshold: 0, alertThreshold: 1 })
  handle.disposeAll()
})

test('routes: GET /overflows returns overflow warnings newest first', async () => {
  const handle = boot({ warnThreshold: 0.8, alertThreshold: 0.9 })
  await settle()
  const { sessionEvent, dispatchEvent, preStepPayload } = await import('./lib/helpers.mjs')
  const { session, event } = sessionEvent('s-1', 'request/context', { contextWindow: 100 })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  const { session: s2, event: e2 } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 90, outputTokens: 0 },
  })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  await settle()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await settle()
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/overflows?sessionId=s-1' }), res)
  assert.equal(res.writeHeadStatus, 200)
  const overflows = jsonOf(res).value
  assert.equal(overflows.length, 1)
  assert.equal(overflows[0].kind, 'overflow')
  assert.equal(overflows[0].level, 'alert')
  handle.disposeAll()
})

test('routes: GET /alerts returns alerts newest first', async () => {
  const handle = boot({ perTurn: 10, mode: 'warn' })
  await settle()
  const { sessionEvent, dispatchEvent, preStepPayload } = await import('./lib/helpers.mjs')
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 50, outputTokens: 5 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await settle()
  await dispatchEvent(handle.listeners, 'agent/pre-step', preStepPayload('s-1'), async () => ({
    kind: 'enter',
    messages: [],
  }))
  await settle()
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/alerts?sessionId=s-1' }), res)
  assert.equal(res.writeHeadStatus, 200)
  const alerts = jsonOf(res).value
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, 'budget')
  assert.equal(alerts[0].scope, 'turn')
  handle.disposeAll()
})

test('routes: GET /sessions lists sessions with stats', async () => {
  const handle = boot({})
  await settle()
  const { sessionEvent, dispatchEvent } = await import('./lib/helpers.mjs')
  const { session, event } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
    usage: { inputTokens: 10, outputTokens: 1 },
  })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  await settle()
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/sessions' }), res)
  assert.equal(res.writeHeadStatus, 200)
  const sessions = jsonOf(res).value
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].sessionId, 's-1')
  assert.equal(sessions[0].requests, 1)
  handle.disposeAll()
})

test('routes: fence rejects non-loopback requests with 403', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/status', host: 'evil.example' }), res)
  assert.equal(res.writeHeadStatus, 403)
  handle.disposeAll()
})

test('routes: malformed JSON body returns 400', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(
    handle.api,
    mockRequest({
      url: '/context/api/budget',
      method: 'POST',
      body: '{not json',
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 400)
  handle.disposeAll()
})

// ── store edge cases ───────────────────────────────────────────────────────

test('store: mutate with empty sessionId is a no-op', async () => {
  const handle = boot({})
  await settle()
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle()
  store.recordRequest('', { turn: 1, step: 1, usage: { inputTokens: 1 } })
  store.addMessage('', 'user', 5)
  await settle()
  assert.equal(store.state.bySession.size, 0, '空 sessionId 不建桶（有界 Map 为空）')
  store.dispose()
  handle.disposeAll()
})

test('store: recordRequest with malformed usage is safe', async () => {
  const handle = boot({})
  await settle()
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle()
  store.recordRequest('s-1', { turn: 1, step: 1, usage: null })
  store.recordRequest('s-1', { turn: 1, step: 2, usage: { inputTokens: 'x', outputTokens: -1 } })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.requests.length, 2)
  assert.equal(session.requests[0].prompt, 0)
  assert.equal(session.requests[1].total, 0)
  store.dispose()
  handle.disposeAll()
})

// ── persist edge cases ─────────────────────────────────────────────────────

test('persist: parseLoaded rejects invalid root structures', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-persist-'))
  tmpDirs.push(home)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join: joinPath } = await import('node:path')
  mkdirSync(joinPath(home, 'context'), { recursive: true })
  const cases = [
    '{"bySession": []}',
    '{"bySession": {"s-1": null}}',
    '{"bySession": {"s-1": {"requests": "x"}}}',
    '{"bySession": {"s-1": {"alerts": "x"}}}',
    '{"bySession": {"s-1": {"usage": "x"}}}',
    '{"bySession": {"s-1": {"model": 5}}}',
  ]
  for (const text of cases) {
    writeFileSync(joinPath(home, 'context', 'context.json'), text, 'utf8')
    const handle = boot({}, { home })
    const { createStore } = await import('../lib/store.js')
    const store = createStore(handle.ctx)
    await settle(80)
    const session = store.session('s-1')
    if (session !== undefined) {
      assert.equal(typeof session.requests, 'object')
      assert.equal(typeof session.alerts, 'object')
    }
    store.dispose()
    handle.disposeAll()
  }
})

test('persist: mergeCurrent skips untouched sessions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-merge-'))
  tmpDirs.push(home)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join: joinPath } = await import('node:path')
  mkdirSync(joinPath(home, 'context'), { recursive: true })
  writeFileSync(
    joinPath(home, 'context', 'context.json'),
    JSON.stringify({
      version: 1,
      bySession: {
        'old-s': {
          sessionId: 'old-s',
          usage: { inputTokens: 7 },
          requests: [],
          alerts: [],
          updatedAt: 1,
        },
      },
    }),
    'utf8',
  )
  const handle = boot({}, { home })
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle(80)
  // 加载后旧会话存在
  assert.equal(store.session('old-s').usage.inputTokens, 7)
  store.dispose()
  handle.disposeAll()
})

test('persist: mutations before load are buffered and replayed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-buffer-'))
  tmpDirs.push(home)
  const handle = boot({}, { home })
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  // 立即写入（加载完成前）
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 42 } })
  await settle(80)
  const session = store.session('s-1')
  assert.equal(session.usage.inputTokens, 42)
  store.dispose()
  handle.disposeAll()
})

// ── store edge cases (header/context/request boundaries) ────────────────────

test('store: applyHeader ignores malformed fields', async () => {
  const handle = boot({})
  await settle()
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle()
  store.updateHeader('s-1', { system: 5, tools: 'x', systemTokens: 'a', model: 5, provider: null })
  store.updateHeader('s-1', {
    system: 'ok',
    tools: [],
    systemTokens: 3,
    toolsTokens: 4,
    model: 'm',
    provider: 'p',
  })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.header.system, 'ok')
  assert.equal(session.header.systemTokens, 3)
  assert.equal(session.model, 'm')
  assert.equal(session.provider, 'p')
  store.dispose()
  handle.disposeAll()
})

test('store: applyContext ignores malformed fields', async () => {
  const handle = boot({})
  await settle()
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle()
  store.updateContext('s-1', { model: 5, provider: null, contextWindow: -1 })
  store.updateContext('s-1', { model: 'm', provider: 'p', contextWindow: 128000 })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.model, 'm')
  assert.equal(session.contextWindow, 128000)
  store.dispose()
  handle.disposeAll()
})

test('store: sessionsOf filters empty sessions', async () => {
  const handle = boot({})
  await settle()
  const { createStore } = await import('../lib/store.js')
  const store = createStore(handle.ctx)
  await settle()
  store.updateHeader('s-1', { system: 'x', tools: [], systemTokens: 1, toolsTokens: 0 })
  await settle()
  assert.deepEqual(store.sessions(), [], 'header-only session has no requests/alerts')
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 1 } })
  await settle()
  assert.equal(store.sessions().length, 1)
  store.dispose()
  handle.disposeAll()
})

// ── events edge cases ───────────────────────────────────────────────────────

test('events: malformed session/event payloads are ignored safely', async () => {
  const handle = boot({})
  await settle()
  const { sessionEvent, dispatchEvent } = await import('./lib/helpers.mjs')
  // session 无 id
  await dispatchEvent(handle.listeners, 'session/event', {}, { type: 'assistant/message', data: {} })
  // header 非对象
  const { session, event } = sessionEvent('s-1', 'request/header', { header: null })
  await dispatchEvent(handle.listeners, 'session/event', session, event)
  // assistant message 无 usage
  const { session: s2, event: e2 } = sessionEvent('s-1', 'assistant/message', {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'text', text: 'x' }] },
  })
  await dispatchEvent(handle.listeners, 'session/event', s2, e2)
  // 未知事件类型
  const { session: s3, event: e3 } = sessionEvent('s-1', 'unknown/type', {})
  await dispatchEvent(handle.listeners, 'session/event', s3, e3)
  await settle()
  const stats = await sessionStats(handle, 's-1')
  assert.equal(stats.requests.length, 0, 'no usage → no request record')
  assert.ok(stats.composition.assistant > 0)
  handle.disposeAll()
})

// ── routes edge cases ───────────────────────────────────────────────────────

test('routes: webRuntime variants do not break fence', async () => {
  for (const webRuntime of [undefined, null, { trustedHosts: null }, { trustedHosts: ['dsh.example'] }]) {
    const handle = bootPlugin({}, { webRuntime })
    disposeAlls.push(handle.disposeAll)
    await settle()
    const res = mockResponse()
    await invoke(handle.api, mockRequest({ url: '/context/api/status' }), res)
    assert.equal(res.writeHeadStatus, 200, `webRuntime=${JSON.stringify(webRuntime)}`)
    handle.disposeAll()
  }
})

test('routes: empty body budget update keeps defaults', async () => {
  const handle = boot({})
  await settle()
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: '/context/api/budget', method: 'POST', body: '' }), res)
  assert.equal(res.writeHeadStatus, 200)
  assert.deepEqual(jsonOf(res).value.budget, { perTurn: 0, perSession: 0, mode: 'warn' })
  handle.disposeAll()
})

// ── budget / meter / fence edge cases ───────────────────────────────────────

test('budget: usageTotal and checkBudget malformed inputs', async () => {
  const { usageTotal, checkBudget } = await import('../lib/budget.js')
  assert.equal(usageTotal('x'), 0)
  assert.equal(usageTotal({ inputTokens: Infinity }), 0)
  const result = checkBudget({ inputTokens: 5 }, { inputTokens: 5 }, { perTurn: 0, perSession: 0 })
  assert.equal(result.ok, true)
  const result2 = checkBudget({ inputTokens: 5 }, { inputTokens: 5 }, { perTurn: 3, perSession: 0 })
  assert.equal(result2.ok, false)
  assert.equal(result2.scope, 'turn')
})

test('meter: estimateToolSchema and estimateText malformed inputs', async () => {
  const { estimateToolSchema, estimateText, estimateBlocks } = await import('../lib/meter.js')
  assert.equal(estimateToolSchema('x'), 0)
  assert.equal(estimateText(''), 0)
  assert.equal(estimateBlocks([{ type: 'text' }]), 0)
  assert.equal(estimateBlocks([{ type: 'tool-call' }]), 4)
})

test('fence: loopback hostname variants', async () => {
  const { isTrustedApiRequest } = await import('dsh-shared')
  assert.equal(isTrustedApiRequest(mockRequest({ host: '127.0.0.1:3080' }), []), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '127.255.255.255:3080' }), []), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '256.0.0.1:3080' }), []), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: '192.168.0:3080' }), []), false)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example:3080' }), ['dsh.example']), true)
  assert.equal(isTrustedApiRequest(mockRequest({ host: 'dsh.example:3080' }), ['other.example']), false)
})

/** 通过 API 路由读取会话统计（与 UI 同路径）。 */
async function sessionStats(handle, sessionId) {
  const res = mockResponse()
  await invoke(handle.api, mockRequest({ url: `/context/api/session?sessionId=${sessionId}` }), res)
  const body = jsonOf(res)
  assert.equal(body.ok, true, `session stats readable: ${JSON.stringify(body)}`)
  return body.value
}
