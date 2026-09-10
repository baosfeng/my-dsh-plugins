/**
 * Shared World for dsh-my-opencode-session-header Gherkin acceptance tests.
 *
 * 复用 test/lib/helpers.mjs 的 mock ctx / 惰性 fetch 流 / fetch 记录器；
 * 每个场景启动一次插件（可用 config 覆盖），After 钩子卸载并还原 fetch。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { bootPlugin, dispatchStream, mockFetch, lazyFetchStream, drain } from '../../lib/helpers.mjs'

class World {
  constructor() {
    this.realFetch = globalThis.fetch
    this.handle = null
    this.rec = null
    this.chunks = []
    this.closed = 0
    this.error = null
  }

  boot(config) {
    this.rec = mockFetch()
    globalThis.fetch = this.rec.fn
    this.handle = bootPlugin(config)
  }

  /** 消费一次推理流（fetch 发生在消费时，与 pi-ai 惰性一致）。 */
  async consume({ provider, sessionId, url, init, chunks, withSession = true } = {}) {
    const options = withSession ? { provider, sessionId } : { provider }
    const overrides = {
      onClose: () => {
        this.closed += 1
      },
      chunks: chunks ?? ['a'],
    }
    if (url !== undefined) overrides.url = url
    if (init !== undefined) overrides.init = init
    const stream = dispatchStream(this.handle.listeners, options, () => lazyFetchStream(overrides))
    this.chunks = await drain(stream)
  }

  lastHeaders() {
    return this.rec.calls.at(-1)?.headers ?? {}
  }

  headersAt(index) {
    return this.rec.calls[index]?.headers ?? {}
  }
}

setWorldConstructor(World)

After(async function () {
  await this.handle?.disposeAll()
  globalThis.fetch = this.realFetch
  this.handle = null
  this.rec = null
})
