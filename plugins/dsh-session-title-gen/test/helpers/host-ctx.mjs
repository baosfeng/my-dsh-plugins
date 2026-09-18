/**
 * dsh-session-title-gen — host 半测试用 ctx 桩，按 **cordis 4 真实契约**构造（issue #385）。
 *
 * 为什么需要这个桩（与 dsh-think-zh-expand 同一教训）：宽松 mock（`get: () => webServer`
 * ＋ `effect: (fn) => fn()`）看不见两处真实缺陷 ——「用 ctx.get 一次性取服务、无重试」
 * 与「注册挂在会被 loader 回收的插件 fiber 上」，测试会在错误契约上变绿、真实环境 404。
 * 契约依据（vendor/cordis@4.0.2）：
 *
 *  - `ctx.inject(deps, cb)` 是子 fiber：deps 全部就绪才执行 cb，服务**晚到**也补执行；
 *    始终缺失则 cb 永不执行且无异常（子 fiber 停在 PENDING）。
 *  - cb 相对 `apply` 是**异步**的（apply 返回 → 微任务 → cb），断言前必须 `await host.settle()`。
 *  - `ctx.get(name, strict)` 带就绪检查且**没有重试** —— 服务晚到时一次性取值永久错过。
 *  - `ctx.root` 是常驻应用根 ctx；profile 插件自身 fiber 会被 loader 回收，挂在它上面的
 *    `ctx.effect` 随之一并注销（路由 404）。
 *  - 宿主 `WebServer.register` 对重复 (kind, path) **直接抛错**，这里同样复刻。
 *
 * 另外本插件的 session/event 监听必须落在 root（见 src/host.ts）：桩把**插件自身 ctx**
 * 上的 `on` 记进 `pluginListeners`，root 上的记进 `listeners` —— 注册错地方时断言直接失败。
 */

/** 构造 LLM 服务桩：产出固定 text-delta + finish（标题 = 该文本，经模板格式化）。 */
function makeLlm(text = '修复 #385 设置页面板') {
  return {
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** 建一个插件 ctx 桩。`webServer`：'ready'（apply 前已就绪）/ 'late'（随后就绪）/ 'never'；
 *  `root: false` 模拟没有常驻 root 的极简/老宿主（ctx.root 缺失）；
 *  `scopeWebServer: false` 模拟 inject 回调的 scope 上仍无该服务（宿主契约异常）。 */
export function createHostCtx({ webServer = 'ready', logger = true, root = true, scopeWebServer = true } = {}) {
  const routes = []
  const logs = []
  /** root 上的 session/event 注册（正确位置）。 */
  const listeners = []
  /** 插件自身 ctx 上的 session/event 注册（错误位置：收不到宿主事件）。 */
  const pluginListeners = []
  /** 插件自身 fiber 上的 effect disposer（loader 回收该 fiber 时执行）。 */
  const pluginEffects = []
  /** 常驻 root 链上的 effect disposer（不随插件 fiber 回收）。 */
  const rootEffects = []
  const pending = []
  let ready = webServer === 'ready'

  const service = {
    register(route) {
      if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
        throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      }
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  const makeLogger = () => ({
    info: (message) => logs.push(`info:${message}`),
    warn: (message) => logs.push(`warn:${message}`),
    error: (message) => logs.push(`error:${message}`),
  })

  /** 注册表：记录到 bucket，返回幂等 disposer。 */
  const makeRegister = (bucket) => (name, handler, options) => {
    const entry = { name, handler, options }
    bucket.push(entry)
    return () => {
      const index = bucket.indexOf(entry)
      if (index >= 0) bucket.splice(index, 1)
    }
  }

  /** root 子 scope（inject 回调实参）：effect 落 `bucket`，registration 归服务。 */
  const makeScope = (bucket) => ({
    webServer: scopeWebServer ? service : undefined,
    logger: makeLogger(),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') bucket.push(dispose)
      return dispose
    },
  })

  /** 服务就绪后把挂起的 inject 回调排进微任务（复刻真实 cb 的异步时机）。 */
  const flushPending = () => {
    if (!ready) return
    for (const start of pending.splice(0)) queueMicrotask(start)
  }

  const scopedInject = (bucket) => (names, callback) => {
    if (!Array.isArray(names) || !names.includes('webServer')) {
      throw new Error(`host-ctx stub: unsupported inject deps (${String(names)})`)
    }
    pending.push(() => callback(makeScope(bucket)))
    flushPending()
    return { dispose: () => {} }
  }

  /** 常驻 root ctx（与真实宿主同生命周期）。 */
  const rootCtx = {
    logger: makeLogger(),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') rootEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(rootEffects),
    on: makeRegister(listeners),
    llm: makeLlm(),
  }
  rootCtx.root = rootCtx

  /** profile 插件自身 ctx：fiber 会被 loader 回收，其 effect 随之注销。 */
  const ctx = {
    // 桩默认提供 logger（可关：`logger: false` 时模拟无日志能力的宿主）
    logger: logger ? makeLogger() : undefined,
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') pluginEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(pluginEffects),
    on: makeRegister(pluginListeners),
    llm: rootCtx.llm,
    root: root ? rootCtx : undefined,
  }

  return {
    ctx,
    rootCtx,
    routes,
    logs,
    listeners,
    pluginListeners,
    /** 服务晚到：就绪后补执行挂起的 inject 回调。 */
    provideWebServer() {
      ready = true
      flushPending()
    },
    /** 模拟 loader 回收 profile 插件自身 fiber（真实：apply 结束后即发生）。 */
    recyclePluginFiber() {
      while (pluginEffects.length > 0) pluginEffects.pop()()
    },
    /** 模拟常驻 root 链卸载（fiber 释放 → 其上 effect disposer 执行）。 */
    teardownRoot() {
      while (rootEffects.length > 0) rootEffects.pop()()
    },
    /** 排空微任务队列（inject 回调在微任务里执行）。 */
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  }
}

/** 构造 mock 会话（append 写入 log，模拟 log-backed 事件源；snapshotEvents 为当前宿主形态）。 */
export function mockSession(id = 's-385', cwd = '/work/my-dsh-plugins', text = '帮我加设置页') {
  const events = [
    { type: 'user/message', seq: 0, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } },
  ]
  return {
    id,
    header: { cwd },
    snapshotEvents: () => events,
    append(type, data) {
      const event = { type, seq: events.length, time: 0, data }
      events.push(event)
      return event
    },
    requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-chat' } }),
    events,
  }
}

/** 派发一次 session/event 到桩上收集的 root 监听器（返回处理后的会话事件数量）。 */
export async function dispatchSessionEvent(host, session, event) {
  const handlers = host.listeners.filter((entry) => entry.name === 'session/event')
  for (const entry of handlers) await entry.handler(session, event)
  return handlers.length
}
