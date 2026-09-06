/**
 * dsh-session-title-gen — host smoke tests.
 *
 * mock ctx 启动插件，派发 session/event 验证：
 *  - 首条人类消息触发结构化标题生成并 append session/title
 *  - 已有结构化标题 / 用户手动标题不重复生成
 *  - 核心生成的非结构化标题触发重新生成（覆盖）
 *  - LLM 失败不 append（回退核心机制，不阻塞会话）
 *  - enabled: false 不监听
 *
 * 模拟真实事件流：事件先 append 进 session log（构造时放入 events），
 * 再触发 session/event 回调（dispatch 只调用监听器）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { apply } from '../lib/index.js'

/** 构造 mock session（append 写入 log，模拟 log-backed 事件源）。 */
function mockSession(id, cwd, events = []) {
  const log = events.map((event, index) => ({ ...event, seq: index }))
  return {
    id,
    header: { cwd },
    events: log,
    append(type, data) {
      const event = { type, seq: log.length, time: Date.now(), data }
      log.push(event)
      return event
    },
    requestHeader() {
      return { config: { provider: 'deepseek', model: 'deepseek-chat' } }
    },
  }
}

/** 构造 user/message 事件。 */
function userMessage(text, source = { kind: 'user' }) {
  return { type: 'user/message', data: { content: [{ type: 'text', text }], source } }
}

/** 构造 session/title 事件。 */
function titleEvent(title, source) {
  return { type: 'session/title', data: { title, messageSeqs: [0], source } }
}

/** 启动插件，返回 { listeners, dispose }。 */
function boot(config, llmChunks) {
  const listeners = {}
  const disposers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    llm: {
      stream() {
        return (async function* stream() {
          for (const chunk of llmChunks) yield chunk
        })()
      },
    },
  }
  apply(ctx, config)
  return {
    listeners,
    dispose() {
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

/** 派发事件到所有监听器（事件已存在于 session log，此处只触发回调）。 */
async function dispatch(listeners, name, ...args) {
  for (const handler of listeners[name] ?? []) {
    await handler(...args)
  }
}

const STOP_CHUNKS = [
  { type: 'text-delta', index: 0, text: '修复 #143 记忆页签崩溃' },
  { type: 'finish', reason: { kind: 'stop' } },
]

describe('dsh-session-title-gen host', () => {
  let booted

  beforeEach(() => {
    booted = undefined
  })

  afterEach(() => {
    booted?.dispose()
  })

  it('首条人类消息后生成结构化标题并 append session/title', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [userMessage('修复 #143 记忆页签崩溃')])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(1)
    expect(titles[0].data.title).toBe('[my-dsh-plugins] 修复 #143 记忆页签崩溃')
    expect(titles[0].data.source).toEqual({
      kind: 'provider',
      provider: 'dsh-session-title-gen',
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    expect(titles[0].data.messageSeqs).toEqual([0])
  })

  it('已有我们生成的结构化标题时不重复生成', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [
      titleEvent('[my-dsh-plugins] 修复 #143 记忆页签崩溃', { kind: 'provider', provider: 'dsh-session-title-gen' }),
    ])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(1)
  })

  it('用户手动标题（source: user）不被覆盖', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [titleEvent('用户手动标题', { kind: 'user' })])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(1)
    expect(titles[0].data.title).toBe('用户手动标题')
  })

  it('核心生成的非结构化标题触发重新生成并覆盖', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [
      userMessage('修复 #143 记忆页签崩溃'),
      titleEvent('修复 #143 记忆页签崩溃', { kind: 'provider', provider: 'session-title-first-prompt-llm' }),
    ])
    await dispatch(
      booted.listeners,
      'session/event',
      session,
      titleEvent('修复 #143 记忆页签崩溃', { kind: 'provider', provider: 'session-title-first-prompt-llm' }),
    )

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(2)
    expect(titles.at(-1).data.title).toBe('[my-dsh-plugins] 修复 #143 记忆页签崩溃')
    expect(titles.at(-1).data.source.provider).toBe('dsh-session-title-gen')
  })

  it('LLM 失败时不 append（回退核心机制，不阻塞会话）', async () => {
    booted = boot({}, [])
    const session = mockSession('s-1', '/work/my-dsh-plugins', [userMessage('修复 #143 记忆页签崩溃')])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(0)
  })

  it('插件注入消息（source.kind: plugin）不触发生成', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [
      userMessage('系统注入', { kind: 'plugin', plugin: 'x' }),
    ])
    await dispatch(booted.listeners, 'session/event', session, userMessage('系统注入', { kind: 'plugin', plugin: 'x' }))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(0)
  })

  it('enabled: false 时不监听任何事件', async () => {
    booted = boot({ enabled: false }, STOP_CHUNKS)
    expect(booted.listeners['session/event']).toBeUndefined()
  })

  it('无 cwd 的会话生成无归属标题（仅描述）', async () => {
    booted = boot({}, STOP_CHUNKS)
    const session = mockSession('s-1', '', [userMessage('修复 #143 记忆页签崩溃')])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles).toHaveLength(1)
    expect(titles[0].data.title).toBe('修复 #143 记忆页签崩溃')
  })

  it('自定义模板生效', async () => {
    booted = boot({ template: '{workspace}: {description}' }, STOP_CHUNKS)
    const session = mockSession('s-1', '/work/my-dsh-plugins', [userMessage('修复 #143 记忆页签崩溃')])
    await dispatch(booted.listeners, 'session/event', session, userMessage('修复 #143 记忆页签崩溃'))

    const titles = session.events.filter((e) => e.type === 'session/title')
    expect(titles[0].data.title).toBe('my-dsh-plugins: 修复 #143 记忆页签崩溃')
  })
})
