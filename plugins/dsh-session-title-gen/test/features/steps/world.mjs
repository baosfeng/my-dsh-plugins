/**
 * Shared World for dsh-session-title-gen Gherkin acceptance tests.
 *
 * World 复用 host-smoke 的 mock ctx 启动方式：mock llm.stream（可注入
 * chunks 或抛错）、mock session（append 写入 log）、事件派发。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { apply } from '../../../lib/index.js'

class World {
  constructor() {
    this.handle = null
    this.session = null
    this.llmChunks = [
      { type: 'text-delta', index: 0, text: '修复 #143 记忆页签崩溃' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    this.llmBroken = false
  }

  boot(config = {}) {
    const listeners = {}
    const disposers = []
    const chunks = this.llmChunks
    const broken = () => this.llmBroken
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
        stream: () => {
          if (broken()) throw new Error('llm unavailable')
          return (async function* stream() {
            for (const chunk of chunks) yield chunk
          })()
        },
      },
    }
    apply(ctx, config)
    this.handle = { listeners, disposers }
  }

  newSession(id, cwd, events = []) {
    const log = events.map((event, index) => ({ ...event, seq: index }))
    this.session = {
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
    return this.session
  }

  async dispatch(name, ...args) {
    for (const handler of this.handle.listeners[name] ?? []) {
      await handler(...args)
    }
  }

  titleEvents() {
    return this.session.events.filter((e) => e.type === 'session/title')
  }

  lastTitle() {
    const titles = this.titleEvents()
    return titles.length === 0 ? undefined : titles.at(-1).data
  }
}

setWorldConstructor(World)

After(function () {
  for (const dispose of this.handle?.disposers ?? []) dispose()
  this.handle = null
  this.session = null
  this.llmBroken = false
})
