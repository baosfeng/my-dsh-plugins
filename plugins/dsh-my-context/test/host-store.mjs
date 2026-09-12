/**
 * Store tests: session isolation, usage accumulation, request records,
 * alert records, FIFO caps, persistence & restart recovery.
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, stateFile } from '../lib/store.js'
import { createState, createSession, zeroUsage } from '../lib/state.js'
import { MAX_SESSIONS } from '../lib/constants.js'
import { bootPlugin, settle } from './lib/helpers.mjs'

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

test('createState / createSession / zeroUsage shapes', () => {
  const state = createState()
  assert.equal(state.version, 1)
  assert.equal(state.bySession.size, 0, '空状态：bySession 为空的有界 Map（issue #198）')
  assert.equal(state.bySession.maxSize, MAX_SESSIONS, '会话数上限显式声明')
  const session = createSession('s-1')
  assert.equal(session.sessionId, 's-1')
  assert.deepEqual(session.usage, zeroUsage())
  assert.deepEqual(session.composition, {
    system: 0,
    tools: 0,
    user: 0,
    inject: 0,
    assistant: 0,
    tool: 0,
  })
  assert.deepEqual(session.requests.items(), [], '明细数组为有界 FIFO 列表（issue #198）')
  assert.deepEqual(session.alerts.items(), [])
})

test('store: recordRequest accumulates usage and snapshots composition', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  store.addMessage('s-1', 'user', 10)
  store.addMessage('s-1', 'assistant', 20)
  store.recordRequest('s-1', {
    turn: 1,
    step: 1,
    usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 50 },
  })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.usage.inputTokens, 100)
  assert.equal(session.usage.outputTokens, 30)
  assert.equal(session.usage.cacheReadTokens, 50)
  assert.equal(session.turnUsage.inputTokens, 100)
  assert.equal(session.requests.length, 1)
  const request = session.requests[0]
  assert.equal(request.prompt, 150)
  assert.equal(request.output, 30)
  assert.equal(request.total, 180)
  assert.equal(request.user, 10)
  assert.equal(request.assistant, 20)
  assert.equal(session.lastPromptTokens, 150, 'lastPromptTokens = latest request prompt')
  disposeAll()
})

test('store: lastPromptTokens tracks the latest request, not the cumulative total', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  // 多轮请求：cacheRead 每轮都很大且会重复累计（usage 口径），
  // 但"当前上下文长度"必须等于最近一次请求的 prompt。
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 900 } })
  store.recordRequest('s-1', {
    turn: 2,
    step: 1,
    usage: { inputTokens: 50, cacheReadTokens: 950, cacheWriteTokens: 5 },
  })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.usage.inputTokens, 150, 'cumulative input still accumulates')
  assert.equal(session.usage.cacheReadTokens, 1850, 'cumulative cacheRead still accumulates')
  assert.equal(session.lastPromptTokens, 1005, 'context length = latest prompt (50+950+5)')
  assert.equal(session.requests[session.requests.length - 1].prompt, 1005)
  disposeAll()
})

test('store: startTurn resets turn usage but keeps session usage', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 } })
  store.startTurn('s-1', 2)
  store.recordRequest('s-1', { turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 1 } })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.usage.inputTokens, 105)
  assert.equal(session.turnUsage.inputTokens, 5)
  assert.equal(session.turnUsage.turn, 2)
  disposeAll()
})

test('store: sessions are isolated per sessionId', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  store.recordRequest('s-1', { turn: 1, step: 1, usage: { inputTokens: 10 } })
  store.recordRequest('s-2', { turn: 1, step: 1, usage: { inputTokens: 20 } })
  await settle()
  assert.equal(store.session('s-1').usage.inputTokens, 10)
  assert.equal(store.session('s-2').usage.inputTokens, 20)
  assert.equal(store.session('s-3'), undefined)
  const sessions = store.sessions()
  assert.equal(sessions.length, 2)
  disposeAll()
})

test('store: requests FIFO cap at MAX_REQUESTS_PER_SESSION', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  for (let i = 0; i < 520; i++) {
    store.recordRequest('s-1', { turn: 1, step: i, usage: { inputTokens: 1 } })
  }
  await settle()
  const session = store.session('s-1')
  assert.equal(session.requests.length, 500)
  assert.equal(session.requests[0].step, 20)
  disposeAll()
})

test('store: alerts FIFO cap and id assignment', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  for (let i = 0; i < 60; i++) {
    store.recordAlert('s-1', {
      kind: 'budget',
      scope: 'turn',
      limit: 10,
      used: 20,
      mode: 'warn',
      blocked: false,
    })
  }
  await settle()
  const session = store.session('s-1')
  assert.equal(session.alerts.length, 50)
  assert.equal(session.alerts[0].id, 11)
  disposeAll()
})

test('store: updateHeader / updateContext', async () => {
  const { ctx, disposeAll } = boot({})
  const store = createStore(ctx)
  await settle()
  store.updateHeader('s-1', {
    system: 'sys',
    tools: [{ name: 'bash' }],
    systemTokens: 10,
    toolsTokens: 5,
    model: 'deepseek-v4',
    provider: 'deepseek',
  })
  store.updateContext('s-1', { model: 'deepseek-v4', provider: 'deepseek', contextWindow: 128000 })
  await settle()
  const session = store.session('s-1')
  assert.equal(session.header.system, 'sys')
  assert.equal(session.header.systemTokens, 10)
  assert.equal(session.header.toolsTokens, 5)
  assert.equal(session.model, 'deepseek-v4')
  assert.equal(session.provider, 'deepseek')
  assert.equal(session.contextWindow, 128000)
  disposeAll()
})

test('store: persistence survives restart (recovery)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-restart-'))
  tmpDirs.push(home)
  const first = boot({}, { home })
  const store = createStore(first.ctx)
  await settle()
  store.recordRequest('s-1', {
    turn: 1,
    step: 1,
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
  })
  store.recordAlert('s-1', {
    kind: 'budget',
    scope: 'turn',
    limit: 10,
    used: 150,
    mode: 'deny',
    blocked: true,
  })
  store.dispose()
  await settle(80)
  first.disposeAll()

  const second = boot({}, { home })
  const store2 = createStore(second.ctx)
  await settle(80)
  const session = store2.session('s-1')
  assert.ok(session, 'session recovered after restart')
  assert.equal(session.usage.inputTokens, 100)
  assert.equal(session.usage.cacheReadTokens, 30)
  assert.equal(session.requests.length, 1)
  assert.equal(session.lastPromptTokens, 130, 'lastPromptTokens recovered after restart')
  assert.equal(session.alerts.length, 1)
  assert.equal(session.alerts[0].blocked, true)
  store2.dispose()
  second.disposeAll()
})

test('store: stateFile respects DSH_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-home-'))
  tmpDirs.push(home)
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal(stateFile(), join(home, 'context', 'context.json'))
  } finally {
    if (old !== undefined) process.env.DSH_HOME = old
    else delete process.env.DSH_HOME
  }
})

test('store: corrupt persisted file falls back to empty state', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-context-corrupt-'))
  tmpDirs.push(home)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join: joinPath } = await import('node:path')
  mkdirSync(joinPath(home, 'context'), { recursive: true })
  writeFileSync(joinPath(home, 'context', 'context.json'), '{not json', 'utf8')
  const handle = boot({}, { home })
  const store = createStore(handle.ctx)
  await settle(80)
  assert.equal(store.state.bySession.size, 0, '损坏文件回退空的有界 Map')
  store.dispose()
  handle.disposeAll()
})
