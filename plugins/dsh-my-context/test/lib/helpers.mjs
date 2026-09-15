/**
 * Shared mock helpers for dsh-my-context host tests.
 *
 * 提供 mock ctx / request / response、插件启动（apply）、事件派发与
 * 临时 DSH_HOME 管理（store 持久化测试需要）。测试文件在 test/*.mjs，
 * 本文件位于 test/lib/ 子目录，vitest include（test/*.mjs）不会收集它。
 *
 * ⚠️ 等待工具（issue #335）：本文件**不再导出裸 settle(ms)**。固定墙钟等待是
 * 「我不知道什么时候完成」的自白，曾经让同一条用例在 CI 上复活 5 次（#310/#313/
 * #317/#335）。请按判据选：
 *   · 等异步结果**出现**（加载/落盘/信号）→ `await store.whenReady()` 或 `waitFor(...)`
 *   · 让出事件循环（等已排队的 microtask/宏任务）→ `yieldLoop()`
 *   · **真实时间语义**（防抖窗口）/ **断言某事没发生** → `sleepFor('理由', ms)`
 * 统一实现在 dsh-shared/test-kit/wait.mjs（跨插件共享，别再写第四份轮询）。
 */
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../../lib/index.js'

// 统一等待工具（issue #335）：跨插件共享实现，别再写第四份轮询。
// 用 `export *` 而不是逐个具名导出，是为了让"库里有什么工具"与"测试能用什么"始终一致
// （逐个列会漏，而漏掉的那个就会被人就地重新实现一遍 —— 这正是前 4 次复发的形态之一）。
export * from '../../../dsh-shared/test-kit/wait.mjs'

/** 临时 DSH_HOME 目录（配合 cleanupHome 使用）。 */
function createTempHome(prefix = 'dsh-context-test-') {
  return dirSync({ unsafeCleanup: true, prefix }).name
}

function cleanupHome(home) {
  // maxRetries/retryDelay：与「多 agent 并行测试资源冲突」同一防线——即便有写者
  // 恰好在删目录的窗口里落盘，也重试而不是抛 ENOTEMPTY（issue #335 实测踩到过）。
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
}

/**
 * 测试用 store 工厂（issue #335）：创建 store、**登记到 ctx**（disposeAll 时一并卸载）、
 * 默认等加载就绪。
 *
 * 为什么必须登记：测试自建的 store 有自己的 500ms 防抖写。用例结束只 `disposeAll()`
 * （卸载插件实例）而漏掉它，那次写就会落到「临时目录已被删除」之后 —— 实测症状是
 * `ENOTEMPTY, Directory not empty`（清理时正好有写者在重建目录）与幽灵目录。
 * 登记之后，`disposeAll()` 会先卸载这些 store 并等落盘完成再删目录。
 *
 * `waitReady: false` 用于「加载完成前的事件必须缓冲」这类用例（不能提前等就绪）。
 */
export async function bootStore(ctx, { waitReady = true } = {}) {
  const { createStore } = await import('../../lib/store.js')
  const store = createStore(ctx)
  ;(ctx.__stores ??= []).push(store)
  if (waitReady) await store.whenReady()
  return store
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

/** 构造 session/event 事件（session 对象 + event 载荷）。 */
export function sessionEvent(sessionId, type, data, extra = {}) {
  return {
    session: { id: sessionId },
    event: { type, seq: 1, time: Date.now(), data, ...extra },
  }
}

/** 构造 agent/pre-step payload（agent.id = 会话 id）。 */
export function preStepPayload(agentId, turn = 1, step = 1) {
  return { agent: { id: agentId }, turn, step, signal: new AbortController().signal }
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
  const api = routes.find((r) => r.path === '/context/api' && r.kind === 'prefix')
  if (api === undefined) throw new Error('prefix route /context/api not registered')
  return {
    ctx,
    listeners,
    api,
    home,
    /** 卸载并**等落盘完成**（返回 Promise）。issue #335：disposer 的落盘是异步的，
     *  fire-and-forget 会让「旧实例的延迟写」落在下一个用例/下一个实例启动之后
     *  （重启恢复用例尤其明显：新实例读到旧内容，或哨兵被旧快照覆盖）。
     *  先卸载测试自建的 store（见 bootStore），再卸载插件实例，最后才删临时目录。
     *  不 await 时行为与原先一致（兼容既有调用点）。 */
    async disposeAll() {
      const results = []
      for (const store of ctx.__stores?.splice(0) ?? []) results.push(store.dispose())
      for (const dispose of disposers.splice(0)) results.push(dispose())
      if (oldHome !== undefined) process.env.DSH_HOME = oldHome
      else delete process.env.DSH_HOME
      await Promise.allSettled(results)
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
