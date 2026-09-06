import { describe, it, expect } from 'vitest'
/**
 * dsh-my-remote — 事件层单测。
 *
 * 验证三类监听的注册与语义：
 *  - end：agent/status idle → 事件下行 + 注册表清理（fail-closed）
 *  - ask：tools/execute 命中 ask_user_question → 推事件 + 注册 + race；
 *    远程回答短路注入 { value: { answers } }；本机回答透传；超时空回答；
 *    会话结束 expired → deny
 *  - approval：approval/request → 推事件 + 注册 + race；远程 allowed-once/
 *    rejected 短路；本机透传；abort → cancelled；超时 fail-closed rejected
 */
import { createAskRegistry, createApprovalRegistry } from '../lib/registries.js'
import { attachEvents } from '../lib/events.js'
import { isTopLevelAgent } from '../lib/session.js'

/** 不 resolve 的 next（模拟本机无操作/UI 挂起）。 */
const neverNext = () => new Promise(() => {})

/** 构造 shared（可覆盖）；ctx 为 mock ctx，listeners 供提取 handler。 */
function makeShared(overrides = {}) {
  const { ctx, listeners } = makeCtx()
  const shared = {
    ctx,
    listeners,
    options: { end: true, ask: true, approval: true, askTimeoutMs: 0, approvalTimeoutMs: 0 },
    askRegistry: createAskRegistry(),
    approvalRegistry: createApprovalRegistry(),
    channels: { dispatch: () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    titleOf: () => 'T',
    isTopLevelAgent,
    ...overrides,
  }
  return shared
}

/** mock ctx：记录 listeners，get 返回 undefined。 */
function makeCtx() {
  const listeners = {}
  const ctx = {
    on: (name, handler) => {
      ;(listeners[name] ??= []).push(handler)
      return () => {
        const list = listeners[name]
        if (list !== undefined) {
          const idx = list.indexOf(handler)
          if (idx !== -1) list.splice(idx, 1)
        }
      }
    },
    get: () => undefined,
  }
  return { ctx, listeners }
}

/** 顶层 agent 结构。 */
function topAgent(id) {
  return { id, session: { header: { cwd: '/work' } }, options: {} }
}

/** 提取 dispatcher 记录。 */
function dispatchSpy() {
  const events = []
  return {
    dispatch: (event) => events.push(event),
    events,
  }
}

/** 事件名 → 最后一个注册的 handler（listeners 为 makeCtx 的监听表）。 */
function handlerOf(listeners, name) {
  const list = listeners[name]
  expect(list).toBeDefined(`listener ${name} registered`)
  return list[list.length - 1]
}

describe('end listener', () => {
  it('idle event dispatches end frame and cleans registries', () => {
    const channels = dispatchSpy()
    const shared = makeShared({ channels })
    const disposers = attachEvents(shared.ctx, shared)
    const agent = topAgent('s1')
    shared.askRegistry.register('s1', [], {})
    shared.approvalRegistry.register('s1', {})
    handlerOf(shared.listeners, 'agent/status')({ agent, status: 'idle' })
    expect(channels.events).toHaveLength(1)
    expect(channels.events[0]).toMatchObject({ kind: 'end', sessionId: 's1', title: 'T' })
    expect(shared.askRegistry.peek('s1')).toBeUndefined('ask cleaned')
    expect(shared.approvalRegistry.peek('s1')).toBeUndefined('approval cleaned')
    for (const dispose of disposers) dispose()
  })

  it('non-idle status and subagent are ignored', () => {
    const channels = dispatchSpy()
    const shared = makeShared({ channels })
    const disposers = attachEvents(shared.ctx, shared)
    handlerOf(shared.listeners, 'agent/status')({ agent: topAgent('s1'), status: 'running' })
    const subagent = { id: 'sub1', session: { header: { origin: 'subagent' } }, options: {} }
    handlerOf(shared.listeners, 'agent/status')({ agent: subagent, status: 'idle' })
    expect(channels.events).toHaveLength(0)
    for (const dispose of disposers) dispose()
  })
})

describe('ask interceptor', () => {
  it('remote answer short-circuits with { value: { answers } }', async () => {
    const channels = dispatchSpy()
    const shared = makeShared({ channels })
    const disposers = attachEvents(shared.ctx, shared)
    const exec = {
      name: 'ask_user_question',
      agent: topAgent('s1'),
      arguments: { questions: [{ id: 'q1', question: '继续?' }] },
    }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const pending = handler(exec, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // ask 事件已下行 + 注册表有条目
    expect(channels.events).toHaveLength(1)
    expect(channels.events[0]).toMatchObject({ kind: 'ask', sessionId: 's1' })
    expect(channels.events[0].questions).toEqual([{ id: 'q1', header: '', question: '继续?', options: [] }])
    expect(shared.askRegistry.peek('s1')).toBeDefined()
    // 远程回答（指令层路径）
    shared.askRegistry.resolve('s1', [{ id: 'q1', selected: ['是'] }])
    const result = await pending
    expect(result).toEqual({ value: { answers: [{ id: 'q1', selected: ['是'] }] } })
    for (const dispose of disposers) dispose()
  })

  it('local answer passes through next() result', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const exec = { name: 'ask_user_question', agent: topAgent('s1'), arguments: { questions: [] } }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const result = await handler(exec, async () => ({ answers: [{ id: 'q1', selected: ['本地'] }] }))
    expect(result).toEqual({ answers: [{ id: 'q1', selected: ['本地'] }] })
    expect(shared.askRegistry.peek('s1')).toBeUndefined('cleaned after local answer')
    for (const dispose of disposers) dispose()
  })

  it('non-ask tools pass through untouched', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const exec = { name: 'bash', agent: topAgent('s1'), arguments: {} }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    let nextCalled = false
    const result = await handler(exec, async () => {
      nextCalled = true
      return { output: 'ok' }
    })
    expect(nextCalled).toBe(true)
    expect(result).toEqual({ output: 'ok' })
    expect(shared.askRegistry.listPending()).toEqual([])
    for (const dispose of disposers) dispose()
  })

  it('timeout returns empty answers (model decides)', async () => {
    const shared = makeShared({
      options: { end: true, ask: true, approval: true, askTimeoutMs: 10, approvalTimeoutMs: 0 },
    })
    const disposers = attachEvents(shared.ctx, shared)
    const exec = { name: 'ask_user_question', agent: topAgent('s1'), arguments: { questions: [{ id: 'q1' }] } }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const result = await handler(exec, neverNext)
    expect(result).toEqual({ value: { answers: [] } })
    expect(shared.askRegistry.listPending()).toEqual([])
    for (const dispose of disposers) dispose()
  })

  it('session ended before remote answer → deny', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const exec = { name: 'ask_user_question', agent: topAgent('s1'), arguments: { questions: [{ id: 'q1' }] } }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const pending = handler(exec, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    shared.askRegistry.cleanSession('s1') // 模拟会话结束
    const result = await pending
    expect(result.kind).toBe('deny')
    expect(result.reason).toContain('session ended')
    for (const dispose of disposers) dispose()
  })

  it('subagent ask is not intercepted', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const subagent = { id: 'sub1', session: { header: { origin: 'subagent' } }, options: {} }
    const exec = { name: 'ask_user_question', agent: subagent, arguments: { questions: [] } }
    const handler = handlerOf(shared.listeners, 'tools/execute')
    let nextCalled = false
    await handler(exec, async () => {
      nextCalled = true
      return 'ok'
    })
    expect(nextCalled).toBe(true)
    for (const dispose of disposers) dispose()
  })
})

describe('approval interceptor', () => {
  it('remote approve short-circuits with allowed-once', async () => {
    const channels = dispatchSpy()
    const shared = makeShared({ channels })
    const disposers = attachEvents(shared.ctx, shared)
    const req = { agent: topAgent('s1'), reason: 'rm -rf /', toolName: 'bash' }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const pending = handler(req, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(channels.events).toHaveLength(1)
    expect(channels.events[0]).toMatchObject({
      kind: 'approval',
      sessionId: 's1',
      reason: 'rm -rf /',
      toolName: 'bash',
    })
    expect(shared.approvalRegistry.peek('s1')).toBeDefined()
    shared.approvalRegistry.decide('s1', 'allowed-once')
    const result = await pending
    expect(result).toBe('allowed-once')
    for (const dispose of disposers) dispose()
  })

  it('remote reject short-circuits with rejected', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const req = { agent: topAgent('s1') }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const pending = handler(req, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    shared.approvalRegistry.decide('s1', 'rejected')
    const result = await pending
    expect(result).toBe('rejected')
    for (const dispose of disposers) dispose()
  })

  it('illegal remote outcome sanitized to rejected (fail-closed)', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const req = { agent: topAgent('s1') }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const pending = handler(req, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    shared.approvalRegistry.decide('s1', 'hax')
    const result = await pending
    expect(result).toBe('rejected')
    for (const dispose of disposers) dispose()
  })

  it('local decision passes through next() result', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const req = { agent: topAgent('s1') }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const result = await handler(req, async () => 'allowed-once')
    expect(result).toBe('allowed-once')
    expect(shared.approvalRegistry.listPending()).toEqual([])
    for (const dispose of disposers) dispose()
  })

  it('abort signal resolves cancelled', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const controller = new AbortController()
    const req = { agent: topAgent('s1'), signal: controller.signal }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const pending = handler(req, neverNext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    const result = await pending
    expect(result).toBe('cancelled')
    for (const dispose of disposers) dispose()
  })

  it('timeout fails closed with rejected', async () => {
    const shared = makeShared({
      options: { end: true, ask: true, approval: true, askTimeoutMs: 0, approvalTimeoutMs: 10 },
    })
    const disposers = attachEvents(shared.ctx, shared)
    const req = { agent: topAgent('s1') }
    const handler = handlerOf(shared.listeners, 'approval/request')
    const result = await handler(req, neverNext)
    expect(result).toBe('rejected')
    for (const dispose of disposers) dispose()
  })

  it('subagent approval is not intercepted', async () => {
    const shared = makeShared()
    const disposers = attachEvents(shared.ctx, shared)
    const subagent = { id: 'sub1', session: { header: { delegationDepth: 1 } }, options: {} }
    const handler = handlerOf(shared.listeners, 'approval/request')
    let nextCalled = false
    await handler({ agent: subagent }, async () => {
      nextCalled = true
      return 'ok'
    })
    expect(nextCalled).toBe(true)
    for (const dispose of disposers) dispose()
  })
})

describe('attachEvents respects options', () => {
  it('disables end/ask/approval listeners by options', () => {
    const shared = makeShared({
      options: { end: false, ask: false, approval: false, askTimeoutMs: 0, approvalTimeoutMs: 0 },
    })
    const disposers = attachEvents(shared.ctx, shared)
    expect(shared.listeners['agent/status']).toBeUndefined()
    expect(shared.listeners['tools/execute']).toBeUndefined()
    expect(shared.listeners['approval/request']).toBeUndefined()
    expect(disposers).toHaveLength(0)
  })
})

describe('event logging (issue #155)', () => {
  it('end dispatch logs an info line with sessionId and [dsh-my-remote] prefix', () => {
    const logs = []
    const shared = makeShared({ logger: { info: (m) => logs.push(m), warn: () => {} } })
    const disposers = attachEvents(shared.ctx, shared)
    const handler = handlerOf(shared.listeners, 'agent/status')
    handler({ agent: topAgent('sess-1'), status: 'idle' })
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('[dsh-my-remote]')
    expect(logs[0]).toContain('会话结束事件已下行')
    expect(logs[0]).toContain('sess-1')
    for (const dispose of disposers) dispose()
  })

  it('ask dispatch logs an info line with question count', async () => {
    const logs = []
    const shared = makeShared({ logger: { info: (m) => logs.push(m), warn: () => {} } })
    const disposers = attachEvents(shared.ctx, shared)
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const exec = { name: 'ask_user_question', agent: topAgent('sess-2'), arguments: { question: 'q?' } }
    await handler(exec, async () => ({ value: { answers: [] } }))
    expect(logs.some((m) => m.includes('ask 事件已下行') && m.includes('sess-2'))).toBe(true)
    for (const dispose of disposers) dispose()
  })

  it('ask timeout logs a warn line with sessionId', async () => {
    const warns = []
    const shared = makeShared({
      options: { end: true, ask: true, approval: true, askTimeoutMs: 5, approvalTimeoutMs: 0 },
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    })
    const disposers = attachEvents(shared.ctx, shared)
    const handler = handlerOf(shared.listeners, 'tools/execute')
    const exec = { name: 'ask_user_question', agent: topAgent('sess-3'), arguments: { question: 'q?' } }
    const result = await handler(exec, neverNext)
    expect(result).toEqual({ value: { answers: [] } })
    expect(warns.some((m) => m.includes('ask 等待远程回答超时') && m.includes('sess-3'))).toBe(true)
    for (const dispose of disposers) dispose()
  })

  it('approval dispatch logs an info line with tool name', async () => {
    const logs = []
    const shared = makeShared({ logger: { info: (m) => logs.push(m), warn: () => {} } })
    const disposers = attachEvents(shared.ctx, shared)
    const handler = handlerOf(shared.listeners, 'approval/request')
    await handler({ agent: topAgent('sess-4'), toolName: 'bash', reason: 'r' }, async () => 'allowed-once')
    expect(logs.some((m) => m.includes('approval 事件已下行') && m.includes('sess-4') && m.includes('bash'))).toBe(true)
    for (const dispose of disposers) dispose()
  })

  it('approval timeout logs a warn line (fail-closed)', async () => {
    const warns = []
    const shared = makeShared({
      options: { end: true, ask: true, approval: true, askTimeoutMs: 0, approvalTimeoutMs: 5 },
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    })
    const disposers = attachEvents(shared.ctx, shared)
    const handler = handlerOf(shared.listeners, 'approval/request')
    const result = await handler({ agent: topAgent('sess-5'), toolName: 'bash', reason: 'r' }, neverNext)
    expect(result).toBe('rejected')
    expect(warns.some((m) => m.includes('approval 等待远程批准超时') && m.includes('sess-5'))).toBe(true)
    for (const dispose of disposers) dispose()
  })
})
