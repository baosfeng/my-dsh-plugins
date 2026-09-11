/**
 * Shared mock helpers for dsh-my-guard host tests.
 *
 * 提供 mock ctx / request / response、插件启动（apply）、事件派发与
 * 临时 DSH_HOME 管理（store 持久化测试需要）。测试文件在 test/*.mjs，
 * 本文件位于 test/lib/ 子目录，vitest include（test/*.mjs）不会收集它。
 *
 * 等待异步结果一律用 waitFor（条件轮询），不要用 settle（固定墙钟）——
 * 后者在 CI 容器高负载下会让"等待不足"变成随机失败（docs/踩坑/）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../lib/index.js'

/** 临时 DSH_HOME 目录（配合 cleanupHome 使用）。 */
export function createTempHome(prefix = 'dsh-guard-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function cleanupHome(home) {
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

/** 构造 tools/pre-execute 的 exec 对象（bash 工具形态）。 */
export function bashExec(agentId, command, extra = {}) {
  return {
    name: 'bash',
    callId: 'call-1',
    agent: { id: agentId },
    arguments: { command },
    ...extra,
  }
}

/** 构造 user/message 会话事件。 */
export function userMessageEvent(text, source = { kind: 'user' }) {
  return { type: 'user/message', data: { content: [{ type: 'text', text }], source } }
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
      return undefined
    },
  }
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/guard/api' && r.kind === 'prefix')
  if (api === undefined) throw new Error('prefix route /guard/api not registered')
  return {
    ctx,
    listeners,
    api,
    home,
    disposeAll() {
      for (const dispose of disposers.splice(0)) dispose()
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

/** 等待防抖持久化落盘。
 *
 *  ⚠️ 这是**固定墙钟等待**：只适用于「等一段真实时间语义」（如防抖窗口本身）
 *  或「断言某事没有发生」。凡是要等异步结果**出现**的断言，一律改用 `waitFor`
 *  ——固定 sleep 在 CI 容器高负载下必然偶发假失败（实测：dsh-my-guard 的
 *  "加载前缓冲的告警" 用例 600ms 等不到异步加载完成，见 docs/踩坑/）。 */
export function settle(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询直到 predicate 为真（返回该真值）；超时抛错。
 *  与 settle 的区别：条件满足即返回（更快），不满足则带原因失败（而非静默过期）。 */
export async function waitFor(predicate, { timeout = 2000, interval = 10, message = 'waitFor 超时' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`${message}（等待 ${timeout}ms 仍未满足）`)
    await settle(interval)
  }
}

/** 读取 JSON 文件（不存在/内容损坏返回 undefined）——配合 waitFor 断言落盘内容。 */
export function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}
