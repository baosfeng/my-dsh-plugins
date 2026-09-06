/**
 * Shared World + helpers for dsh-my-remote Gherkin acceptance tests.
 *
 * World 提供：
 *  - 临时 DSH_HOME（插件无配置保存也不需要，但保持与其他插件一致）；
 *  - ctx.on disposer 真正移除监听器；
 *  - boot：mock ctx + 捕获 routes（/remote/api）与 listeners；
 *  - dispatch：按事件名派发（asks 等 waterfall 事件由 steps 传 next）；
 *  - invoke：调 /remote/api handler。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../../lib/index.js'
import { createAskRegistry, createApprovalRegistry } from '../../../lib/registries.js'

export function mockResponse() {
  const res = {
    status: 0,
    written: [],
    writeHead(status) {
      res.status = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
  }
  return res
}

export function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', token, body = '' } = {}) {
  const headers = { host }
  if (token !== undefined) headers['x-remote-token'] = token
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

export function topAgent(id) {
  return { id, session: { header: { cwd: '/work' } }, options: {} }
}

class World {
  constructor() {
    this.listeners = {}
    this.api = null
    this.disposers = []
    this.tmpDirs = []
    this.oldHome = undefined
    this.lastStatus = 0
    this.lastBody = null
    this.pushedEvents = []
    this.askRegistry = createAskRegistry()
    this.approvalRegistry = createApprovalRegistry()
  }

  boot(config) {
    const home = mkdtempSync(join(tmpdir(), 'dsh-my-remote-feature-'))
    this.tmpDirs.push(home)
    this.oldHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const listeners = this.listeners
    const disposers = this.disposers
    const ctx = {
      logger: { info() {}, warn() {} },
      on(name, handler) {
        ;(listeners[name] ??= []).push(handler)
        return () => {
          const list = listeners[name]
          if (list !== undefined) {
            const idx = list.indexOf(handler)
            if (idx !== -1) list.splice(idx, 1)
          }
        }
      },
      effect(fn) {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
      webServer: {
        register: (route) => {
          if (route.kind === 'prefix' && route.path === '/remote/api') this.api = route
          return () => {}
        },
      },
      get(name) {
        if (name === 'webRuntime') return { trustedHosts: [] }
        if (name === 'agents') return undefined
        return undefined
      },
    }
    this.ctx = ctx
    // 记录出站事件（替换 channels dispatch 由步骤驱动 pushEvents）
    apply(ctx, config)
    if (this.api === null) throw new Error('prefix route /remote/api not registered')
  }

  async dispatch(name, ...args) {
    const results = []
    for (const handler of [...(this.listeners[name] ?? [])]) {
      results.push(await handler(...args))
    }
    return results.length === 1 ? results[0] : results
  }

  async invoke(request, response) {
    await this.api.handler(request, response)
    this.lastStatus = response.status
    try {
      this.lastBody = JSON.parse(response.written.join(''))
    } catch {
      this.lastBody = null
    }
  }

  async sendCommand(payload, token) {
    const res = mockResponse()
    await this.invoke(
      mockRequest({ url: '/remote/api/command', method: 'POST', token, body: JSON.stringify(payload) }),
      res,
    )
  }

  async getStatus() {
    const res = mockResponse()
    await this.invoke(mockRequest({ url: '/remote/api/status' }), res)
  }

  async getAudit() {
    const res = mockResponse()
    await this.invoke(mockRequest({ url: '/remote/api/audit' }), res)
  }
}

setWorldConstructor(World)

After(async function () {
  for (const dispose of this.disposers.splice(0)) dispose()
  if (this.oldHome !== undefined) process.env.DSH_HOME = this.oldHome
  for (const dir of this.tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
