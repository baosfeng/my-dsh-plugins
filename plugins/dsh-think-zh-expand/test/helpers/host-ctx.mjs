/**
 * dsh-think-zh-expand — host 半测试用 ctx 桩，按 **cordis 4 真实契约**构造。
 *
 * 为什么需要这个桩（本 bug 的教训）：旧测试把 ctx 桩成 `get: () => webServer`
 * ＋ `effect: (fn) => fn()`，于是「用 ctx.get 一次性取服务、注册挂在会被回收的
 * 插件 fiber 上」这两处真实缺陷在测试里都看不见 —— 桩比真实宿主宽松，测试就在
 * 错误契约上变绿，真实环境则 404。契约依据（vendor/cordis@4.0.2）：
 *
 *  - `ctx.inject(deps, cb)` = `registry.inject` → `plugin({ inject, apply: cb })`
 *    子 fiber（src/registry.ts:296-302）；deps 全部就绪才执行 cb，服务**晚到**
 *    也会补执行（src/fiber.ts:614-630 `_refresh` → `_setEpoch`），始终缺失则
 *    cb 永不执行且无异常（子 fiber 停在 PENDING）。
 *  - cb 相对 `apply` 是**异步**的（实测：apply 返回 → 微任务 → cb），故断言前
 *    必须 `await host.settle()`。
 *  - `ctx.get(name, strict)` 带就绪检查（provider fiber 非 ACTIVE 即 undefined，
 *    src/reflect.ts:233-247）且**没有重试** —— 服务晚到时一次性取值永久错过。
 *  - `ctx.root` 是常驻应用根 ctx（src/context.ts:21-22,70-75）；profile 插件自身
 *    fiber 会被 loader 回收，挂在它上面的 `ctx.effect` 随之一并注销（路由 404，
 *    见 docs/踩坑/宿主运行时陷阱.md）。故注册必须落到 root 链上。
 *  - 宿主 `WebServer.register` 对重复 (kind, path) **直接抛错**
 *    （packages/host/webserver/src/index.ts:160-161），这里同样复刻。
 */

/** 建一个插件 ctx 桩。`webServer`：'ready'（apply 前已就绪）/ 'late'（随后就绪）/ 'never'；
 *  `root: false` 模拟没有常驻 root 的极简/老宿主（ctx.root 缺失）；
 *  `scopeWebServer: false` 模拟 inject 回调的 scope 上仍无该服务（宿主契约异常）。 */
export function createHostCtx({ webServer = 'ready', logger = true, root = true, scopeWebServer = true } = {}) {
  const sections = []
  const routes = []
  const logs = []
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
    systemPrompt: { section: (section) => (sections.push(section), () => {}) },
    logger: makeLogger(),
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') rootEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(rootEffects),
  }
  rootCtx.root = rootCtx

  /** profile 插件自身 ctx：fiber 会被 loader 回收，其 effect 随之注销。 */
  const ctx = {
    systemPrompt: { section: (section) => (sections.push(section), () => {}) },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') pluginEffects.push(dispose)
      return dispose
    },
    get: (name) => (name === 'webServer' && ready ? service : undefined),
    inject: scopedInject(pluginEffects),
    root: root ? rootCtx : undefined,
  }
  if (logger) ctx.logger = makeLogger()

  return {
    ctx,
    rootCtx,
    sections,
    routes,
    logs,
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
