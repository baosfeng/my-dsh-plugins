/**
 * Shared mock helpers for dsh-my-observability host tests.
 *
 * 提供 mock ctx / request / response、插件启动（apply）、事件派发与
 * 临时 DSH_HOME 管理（store 持久化测试需要）。测试文件在 test/*.mjs，
 * 本文件位于 test/lib/ 子目录，vitest include（test/*.mjs）不会收集它。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../lib/index.js'

/** 临时 DSH_HOME 目录（配合 cleanupHome 使用）。 */
export function createTempHome(prefix = 'dsh-observability-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupHome(home) {
  rmSync(home, { recursive: true, force: true })
}

export function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    writeHeadHeaders: null,
    written: [],
    ended: false,
    closeHandlers: [],
    writeHead(status, headers) {
      res.writeHeadStatus = status
      res.writeHeadHeaders = headers
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      res.ended = true
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

export function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', secFetchSite, origin, body = '' } = {}) {
  const headers = { host }
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite
  if (origin !== undefined) headers.origin = origin
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** 顶层 agent 结构（含会话标题辅助字段）。 */
export function topAgent(id, extra = {}) {
  return {
    id,
    session: { header: { cwd: '/work/alpha', ...extra }, __title: `标题-${id}` },
  }
}

/** 启动插件（mock ctx + 临时 DSH_HOME），返回 { ctx, listeners, api, disposeAll }。
 *  opts.home 提供既有 DSH_HOME（重启恢复测试共享存储）；此时 disposeAll
 *  不删除该目录（由测试负责清理）。 */
export function bootPlugin(config, opts = {}) {
  const ownsHome = opts.home === undefined
  const home = opts.home ?? createTempHome()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const listeners = {}
  const routes = []
  const disposers = []
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
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'webRuntime') return opts.webRuntime === undefined ? { trustedHosts: [] } : opts.webRuntime
      if (name === 'agents') return opts.agents
      return undefined
    },
  }
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/observability/api' && r.kind === 'prefix')
  if (api === undefined) throw new Error('prefix route /observability/api not registered')
  return {
    ctx,
    listeners,
    api,
    home,
    async disposeAll() {
      for (const dispose of disposers.splice(0)) await dispose()
      if (oldHome !== undefined) process.env.DSH_HOME = oldHome
      else delete process.env.DSH_HOME
      if (ownsHome) cleanupHome(home)
    },
  }
}

/** 派发事件到所有监听器（模拟 cordis 派发）；返回最后一个 handler 的返回值。 */
export async function dispatchEvent(listeners, name, ...args) {
  let last
  for (const handler of [...(listeners[name] ?? [])]) {
    last = await handler(...args)
  }
  return last
}

/** 调用插件 API handler。 */
export async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

/** 解析响应 JSON 文本。 */
export function jsonOf(response) {
  return JSON.parse(response.written.join(''))
}
