/**
 * Shared World + helpers for dsh-my-notify Gherkin acceptance tests.
 *
 * 两个 steps 文件（notify.steps.mjs / notify-config.steps.mjs）共享同一个
 * World 类：cucumber 的 setWorldConstructor 只能调用一次，重复定义会互相
 * 覆盖并导致步骤定义 ambiguous。World 支持：
 *  - 临时 DSH_HOME（配置 API 写 profile patch 文件需要）；
 *  - ctx.on disposer 真正移除监听器（配置保存后监听器重载可验证）；
 *  - 配置读写方法（GET/PUT /notify/api/config）。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../../../lib/index.js'

/** 解析 "key=value key2=value2" 为对象（布尔/数字/字符串）。 */
export function parsePairs(text) {
  const result = {}
  for (const part of text.split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (value === 'true') result[key] = true
    else if (value === 'false') result[key] = false
    else if (/^\d+$/.test(value)) result[key] = Number(value)
    else result[key] = value
  }
  return result
}

export function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
    closeHandlers: [],
    writeHead(status) {
      res.writeHeadStatus = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
    on(_event, handler) {
      if (_event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    emitClose() {
      for (const h of res.closeHandlers.splice(0)) h()
    },
  }
  return res
}

export function mockRequest({
  url,
  method = 'GET',
  host = '127.0.0.1:3080',
  secFetchSite,
  origin,
  token,
  body = '',
} = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  if (token !== undefined) headers['x-notify-token'] = token
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

export function topAgent(id, extra = {}) {
  return {
    id,
    session: { header: { cwd: '/work/alpha', ...extra }, __title: `标题-${id}` },
  }
}

class World {
  constructor() {
    this.listeners = {}
    this.api = null
    this.clients = []
    this.nextCalled = false
    this.lastResponse = null
    this.lastConfig = null
    this.disposers = []
    this.tmpDirs = []
    this.oldHome = undefined
  }

  boot(config) {
    const home = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-feature-' }).name
    this.tmpDirs.push(home)
    this.oldHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const listeners = this.listeners
    const disposers = this.disposers
    const ctx = {
      logger: { warn() {} },
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
          if (route.kind === 'prefix' && route.path === '/notify/api') this.api = route
          return () => {}
        },
      },
      get(name) {
        if (name === 'sessionTitle') return ctx.sessionTitle
        if (name === 'webRuntime') return { trustedHosts: [] }
        return undefined
      },
      sessionTitle: {
        get(session) {
          return session?.__title === undefined ? {} : { title: session.__title }
        },
      },
    }
    this.ctx = ctx
    apply(ctx, config)
    if (this.api === null) throw new Error('prefix route /notify/api not registered')
  }

  async dispatch(name, ...args) {
    for (const handler of [...(this.listeners[name] ?? [])]) {
      await handler(...args)
    }
  }

  async invoke(request, response) {
    await this.api.handler(request, response)
  }

  async getConfig() {
    const res = mockResponse()
    await this.invoke(mockRequest({ url: '/notify/api/config' }), res)
    this.lastResponse = { status: res.writeHeadStatus }
    this.lastConfig = JSON.parse(res.written.join('')).value
  }

  async putConfig(payload) {
    const res = mockResponse()
    await this.invoke(
      mockRequest({
        url: '/notify/api/config',
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
      res,
    )
    this.lastResponse = { status: res.writeHeadStatus }
  }

  noticesOf(client) {
    return client.written.filter((c) => c.includes('data: '))
  }
}

setWorldConstructor(World)

After(async function () {
  for (const dispose of this.disposers.splice(0)) dispose()
  if (this.oldHome !== undefined) process.env.DSH_HOME = this.oldHome
  for (const dir of this.tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
