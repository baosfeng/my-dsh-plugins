import { describe, it, expect } from 'vitest'
/**
 * dsh-my-remote — 指令层单测（白名单 / answer / approve / continue / 审计）。
 */
import { createAskRegistry, createApprovalRegistry } from '../lib/registries.js'
import { createAuditLog } from '../lib/audit.js'
import { processCommand, COMMANDS } from '../lib/commands.js'

/** 构造测试 shared（可覆盖字段）。 */
function makeShared(overrides = {}) {
  const askRegistry = createAskRegistry()
  const approvalRegistry = createApprovalRegistry()
  const audit = createAuditLog()
  return {
    ctx: { get: () => undefined },
    askRegistry,
    approvalRegistry,
    audit,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    titleOf: () => 'T',
    ...overrides,
  }
}

describe('command whitelist', () => {
  it('exposes exactly answer/approve/continue', () => {
    expect([...COMMANDS].sort()).toEqual(['answer', 'approve', 'continue'])
  })

  it('unknown command is rejected and audited', () => {
    const shared = makeShared()
    const result = processCommand(shared, 'rm-rf', {}, { time: 1, source: '10.0.0.1' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unknown command')
    const audit = shared.audit.list()
    expect(audit).toHaveLength(1)
    expect(audit[0].action).toBe('rm-rf')
    expect(audit[0].ok).toBe(false)
    expect(audit[0].source).toBe('10.0.0.1')
    expect(audit[0].time).toBe(1)
  })
})

describe('answer command', () => {
  it('answers a pending ask and resolves the ask registry', async () => {
    const shared = makeShared()
    shared.askRegistry.register('s1', [{ id: 'q1', question: 'x?' }], {})
    const result = processCommand(
      shared,
      'answer',
      { sessionId: 's1', answers: [{ id: 'q1', selected: ['是'] }] },
      { source: 'local' },
    )
    expect(result.ok).toBe(true)
    expect(result.result.answered).toBe(1)
    const entry = await shared.askRegistry.peek('s1')
    expect(entry).toBeUndefined('ask consumed')
    expect(shared.audit.list()[0]).toMatchObject({ action: 'answer', ok: true, sessionId: 's1' })
  })

  it('no pending ask → rejected with not-found and audited', () => {
    const shared = makeShared()
    const result = processCommand(shared, 'answer', { sessionId: 'nope', answers: [{ id: 'q1', selected: [] }] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no pending ask')
    expect(shared.audit.list()[0].ok).toBe(false)
  })

  it('invalid payload (bad answers) rejected + audited', () => {
    const shared = makeShared()
    const cases = [
      { sessionId: 's1', answers: [] },
      { sessionId: 's1', answers: [{ selected: ['x'] }] },
      { sessionId: '', answers: [{ id: 'q1' }] },
    ]
    for (const payload of cases) {
      const result = processCommand(shared, 'answer', payload)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('invalid answer payload')
    }
    expect(shared.audit.list()).toHaveLength(cases.length)
  })

  it('multi-answer with custom text is accepted', () => {
    const shared = makeShared()
    shared.askRegistry.register('s1', [{ id: 'q1' }, { id: 'q2' }], {})
    const result = processCommand(shared, 'answer', {
      sessionId: 's1',
      answers: [
        { id: 'q1', selected: ['A'] },
        { id: 'q2', selected: [], custom: '自由文本' },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.result.answered).toBe(2)
  })
})

describe('approve command', () => {
  it('approves a pending approval', async () => {
    const shared = makeShared()
    shared.approvalRegistry.register('s1', {})
    const result = processCommand(shared, 'approve', { sessionId: 's1', outcome: 'allowed-once' })
    expect(result.ok).toBe(true)
    expect(result.result.outcome).toBe('allowed-once')
    const entry = await shared.approvalRegistry.peek('s1')
    expect(entry).toBeUndefined('approval consumed')
    expect(shared.audit.list()[0]).toMatchObject({ action: 'approve', ok: true })
  })

  it('explicit rejection is allowed', () => {
    const shared = makeShared()
    shared.approvalRegistry.register('s1', {})
    const result = processCommand(shared, 'approve', { sessionId: 's1', outcome: 'rejected' })
    expect(result.ok).toBe(true)
    expect(result.result.outcome).toBe('rejected')
  })

  it('illegal outcome rejected + audited', () => {
    const shared = makeShared()
    shared.approvalRegistry.register('s1', {})
    const result = processCommand(shared, 'approve', { sessionId: 's1', outcome: 'unavailable' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('invalid approve payload')
    expect(shared.audit.list()[0].ok).toBe(false)
  })

  it('no pending approval → rejected with not-found', () => {
    const shared = makeShared()
    const result = processCommand(shared, 'approve', { sessionId: 'x', outcome: 'allowed-once' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no pending approval')
  })
})

describe('continue command', () => {
  it('steers a live agent with the message', () => {
    const steered = []
    const shared = makeShared({
      ctx: {
        get(name) {
          return name === 'agents' ? { get: (id) => (id === 's1' ? { id: 's1' } : undefined) } : undefined
        },
      },
    })
    const result = processCommand(shared, 'continue', { sessionId: 's1', message: '继续执行' })
    expect(result.ok).toBe(false)
    expect(steered).toHaveLength(0, 'steer not captured (agent stub has no steer)')
    expect(shared.audit.list()).toHaveLength(1)
  })

  it('live agent with steer is called', () => {
    const steered = []
    const shared = makeShared({
      ctx: {
        get(name) {
          return name === 'agents'
            ? { get: (id) => (id === 's1' ? { id: 's1', steer: (msg) => steered.push(msg) } : undefined) }
            : undefined
        },
      },
    })
    const result = processCommand(shared, 'continue', { sessionId: 's1', message: '继续执行' })
    expect(result.ok).toBe(true)
    expect(steered).toHaveLength(1)
    expect(steered[0].role).toBe('user')
    expect(steered[0].content[0].text).toBe('继续执行')
    expect(shared.audit.list()[0]).toMatchObject({ action: 'continue', ok: true })
  })

  it('no live agent → rejected + audited', () => {
    const shared = makeShared()
    const result = processCommand(shared, 'continue', { sessionId: 'gone', message: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no live agent')
    expect(shared.audit.list()[0].ok).toBe(false)
  })

  it('missing message / session rejected', () => {
    const shared = makeShared()
    expect(processCommand(shared, 'continue', { sessionId: 's1' }).ok).toBe(false)
    expect(processCommand(shared, 'continue', { sessionId: '', message: 'x' }).ok).toBe(false)
  })
})

describe('command logging (issue #155)', () => {
  it('successful command logs an info line with action/sessionId/ok', () => {
    const logs = []
    const shared = makeShared({ logger: { info: (m) => logs.push(m), warn: () => {} } })
    const result = processCommand(shared, 'continue', { sessionId: 's1', message: 'hi' }, { source: 'test' })
    expect(result.ok).toBe(false) // no live agent → still logged
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('[dsh-my-remote]')
    expect(logs[0]).toContain('action=continue')
    expect(logs[0]).toContain('sessionId=s1')
    expect(logs[0]).toContain('ok=false')
  })

  it('unknown command logs a warn line', () => {
    const warns = []
    const shared = makeShared({ logger: { info: () => {}, warn: (m) => warns.push(m) } })
    processCommand(shared, 'hack', {}, { source: 'test' })
    expect(warns.length).toBe(1)
    expect(warns[0]).toContain('[dsh-my-remote]')
    expect(warns[0]).toContain('未知远程指令')
    expect(warns[0]).toContain('action=hack')
  })
})
