/**
 * dsh-session-title-gen — 宿主可见性防回归（issue #232）。
 *
 * 锁定 DSH 0.1.5-rc.1 下的三条宿主契约，任何一条回退都会让插件**静默失效**
 * （标题退回核心机制、缺 [工作区] 前缀）：
 *  1. session/event 必须注册在 **root** 且带 { global: true }：profile 插件的
 *     ctx.events 与 root 的 events 服务是两个实例，注册在插件自身 ctx 上收不到
 *     任何宿主会话事件（实测）。
 *  2. 会话事件读取走 snapshotEvents()：0.1.5-rc.1 起 Session.events 已变
 *     private，读 events 得到 undefined，消息收集静默为空。
 *  3. 取不到工作区名时不静默：仍生成标题，但必须写 warn 日志。
 */
import { describe, it, expect } from 'vitest'
import { apply } from '../lib/index.js'

/** 记录注册的宿主 ctx。 */
function mockHost({ warnMessages = [] } = {}) {
  const registered = []
  const host = {
    logger: {
      warn(message) {
        warnMessages.push(message)
      },
      info() {},
    },
    on(name, handler, options) {
      registered.push({ name, handler, options })
      return () => {}
    },
    effect(callback) {
      return callback()
    },
    llm: {
      stream() {
        return (async function* stream() {
          yield { type: 'text-delta', index: 0, text: '解读目录 README 内容' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  }
  return { host, registered }
}

/** 构造 mock 插件 ctx：root 指向宿主 ctx（模拟 profile 插件的隔离 ctx）。 */
function mockPluginCtx(hostCtx, ctxOverrides = {}) {
  return {
    root: hostCtx,
    logger: hostCtx.logger,
    on() {
      throw new Error('插件自身 ctx 上不应注册 session/event（issue #232：收不到宿主事件）')
    },
    effect(callback) {
      return callback()
    },
    llm: hostCtx.llm,
    ...ctxOverrides,
  }
}

function userMessage(text) {
  return { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

function sessionWith({ cwd, snapshot = true }) {
  const events = [userMessage('帮我看看这个目录的 README')]
  const session = {
    id: 's-232',
    header: cwd === undefined ? {} : { cwd },
    append(type, data) {
      const event = { type, seq: events.length, time: Date.now(), data }
      events.push(event)
      return event
    },
    requestHeader() {
      return { config: { provider: 'deepseek', model: 'deepseek-chat' } }
    },
  }
  if (snapshot) {
    // 0.1.5-rc.1：只有 snapshotEvents()，没有 events 数组
    session.snapshotEvents = () => events
  } else {
    session.events = events
  }
  return { session, events }
}

/** 取 root 上注册的 session/event 监听器。 */
async function dispatchTo(registered, session, event) {
  for (const entry of registered.filter((item) => item.name === 'session/event')) {
    await entry.handler(session, event)
  }
}

describe('宿主可见性防回归（issue #232）', () => {
  it('session/event 注册在 root 且带 { global: true }，不注册到插件自身 ctx', () => {
    const { host, registered } = mockHost()
    apply(mockPluginCtx(host), {})

    expect(registered.map((item) => item.name)).toEqual(['session/event'])
    expect(registered[0].options).toEqual({ global: true })
  })

  it('Session.events 不可用时经 snapshotEvents() 生成带 [工作区] 前缀的标题', async () => {
    const { host, registered } = mockHost()
    apply(mockPluginCtx(host), {})
    const { session, events } = sessionWith({ cwd: '/private/tmp/tg232-plain' })

    await dispatchTo(registered, session, userMessage('帮我看看这个目录的 README'))

    const title = events.find((event) => event.type === 'session/title')
    expect(title?.data.title).toBe('[tg232-plain] 解读目录 README 内容')
    expect(title?.data.source).toEqual({
      kind: 'provider',
      provider: 'dsh-session-title-gen',
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    })
  })

  it('旧宿主的 events 数组回退仍可用', async () => {
    const { host, registered } = mockHost()
    apply(mockPluginCtx(host), {})
    const { session, events } = sessionWith({ cwd: '/Users/me/proj', snapshot: false })

    await dispatchTo(registered, session, userMessage('帮我看看这个目录的 README'))

    const title = events.find((event) => event.type === 'session/title')
    expect(title?.data.title).toBe('[proj] 解读目录 README 内容')
  })

  it('取不到工作区名时不静默：仍生成标题且写 warn 日志', async () => {
    const warnMessages = []
    const { host, registered } = mockHost({ warnMessages })
    apply(mockPluginCtx(host), {})
    const { session, events } = sessionWith({ cwd: undefined })

    await dispatchTo(registered, session, userMessage('帮我看看这个目录的 README'))

    const title = events.find((event) => event.type === 'session/title')
    expect(title?.data.title).toBe('解读目录 README 内容')
    expect(warnMessages.some((message) => message.includes('no workspace name resolved'))).toBe(true)
  })

  it('插件 ctx 失活后仍能取到 llm 服务（root 优先）', async () => {
    const { host, registered } = mockHost()
    const pluginCtx = mockPluginCtx(host)
    apply(pluginCtx, {})
    // 模拟 apply 结束后的插件 ctx：动态访问 llm 会抛错（inactive context）
    Object.defineProperty(pluginCtx, 'llm', {
      get() {
        throw new Error('cannot get required service "llm" in inactive context')
      },
    })
    const { session, events } = sessionWith({ cwd: '/private/tmp/tg232-plain' })

    await dispatchTo(registered, session, userMessage('帮我看看这个目录的 README'))

    expect(events.some((event) => event.type === 'session/title')).toBe(true)
  })
})
