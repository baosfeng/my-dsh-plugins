/**
 * Shared mock helpers for dsh-my-opencode-session-header host tests.
 *
 * 模拟 cordis ctx（on / effect / logger）、llm/stream waterfall 派发、惰性
 * fetch 流（真正 fetch 发生在消费时，与 pi-ai Models.streamSimple 一致）与
 * fetch 记录器。测试文件在 test/*.mjs；本文件位于 test/lib/，不参与收集。
 */
import { apply } from '../../lib/index.js'

/** 记录型 logger（info / warn 分桶）。 */
export function mockLogger() {
  const info = []
  const warn = []
  return {
    info,
    warn,
    logger: { info: (message) => info.push(String(message)), warn: (message) => warn.push(String(message)) },
  }
}

/** 启动插件（mock ctx），返回 { ctx, listeners, logs, disposeAll }。 */
export function bootPlugin(config, opts = {}) {
  const listeners = {}
  const disposers = []
  const { logger, info, warn } = mockLogger()
  const ctx = {
    logger,
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => remove(listeners[name], handler)
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }
  apply(ctx, opts.config ?? config)
  return {
    ctx,
    listeners,
    logs: { info, warn },
    async disposeAll() {
      for (const dispose of disposers.splice(0)) {
        if (typeof dispose === 'function') await dispose()
      }
    },
  }
}

function remove(list, item) {
  const index = list.indexOf(item)
  if (index !== -1) list.splice(index, 1)
}

/** 模拟 cordis waterfall：handler(options, next) 链式调用，返回值即最终流。 */
export function dispatchStream(listeners, options, next) {
  const handlers = [...(listeners['llm/stream'] ?? [])]
  const invoke = (index) => (index >= handlers.length ? next() : handlers[index](options, () => invoke(index + 1)))
  return invoke(0)
}

/** fetch 记录器（固定 200 响应，记录每次调用的 URL 与请求头）。 */
export function mockFetch() {
  const calls = []
  const fn = async (input, init) => {
    calls.push(recordOf(input, init))
    return { ok: true, status: 200, headers: {} }
  }
  return { fn, calls }
}

function recordOf(input, init) {
  try {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    // init.headers 优先；Request 形态的 input 从其自身 headers 读取。
    const raw = init?.headers ?? (input !== null && typeof input === 'object' ? input.headers : undefined)
    return { url, headers: headersToObject(raw) }
  } catch {
    return { url: '<unreadable>', headers: {} }
  }
}

/** 请求头三种形态（Headers / 数组 / 普通对象）→ 小写键普通对象。 */
export function headersToObject(headers) {
  const out = {}
  if (headers === undefined || headers === null) return out
  if (Array.isArray(headers)) {
    for (const entry of headers) out[String(entry[0]).toLowerCase()] = String(entry[1])
    return out
  }
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value)
    })
    return out
  }
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value)
  return out
}

/**
 * 惰性流：真正 fetch 发生在消费（迭代）时——与 pi-ai Models.streamSimple
 * 的惰性一致，因此 ALS 上下文必须在每次 next() 内建立才有效。
 */
export function lazyFetchStream({
  url = 'https://opencode.ai/zen/go/v1/chat/completions',
  init = { headers: { authorization: 'Bearer test-key' } },
  chunks = ['a', 'b'],
  onClose,
} = {}) {
  return (async function* lazyStream() {
    try {
      await globalThis.fetch(url, init)
      for (const chunk of chunks) yield chunk
    } finally {
      if (typeof onClose === 'function') onClose()
    }
  })()
}

/** 全量消费流。 */
export async function drain(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
