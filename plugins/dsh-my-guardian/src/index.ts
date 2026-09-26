/**
 * dsh-my-guardian — server half (entry point).
 *
 * Plugin guardian: staged loading, failure isolation and a safe mode for the
 * DSH profile plugin roster.
 *
 * DSH boots Cordis plugin trees all-or-nothing: any row that fails to import,
 * throws during apply, or stays pending takes the whole `dsh web` process
 * down (fail-loud). This plugin gives new/updated plugins a staging area
 * instead of the boot path:
 *
 *   cordis.staged.json (the candidate file, next to cordis.patch.yml)
 *       │  (guardian mounts each entry AFTER boot, through the live loader
 *       │   tree's root group — runtime mounts are catchable & rollback-safe)
 *       ├─ success → PROMOTED: entry moves into the guardian's own persisted
 *       │            list (state.json) and is mounted again on every start
 *       └─ failure → quarantined: attempts counter + error recorded; after
 *                    FREEZE_LIMIT consecutive failures the entry is frozen
 *                    and only a manual retry (panel / API) unfreezes it
 *
 * Safe mode (state.safeMode) skips every staged/promoted mount — a one-click
 * way to recover an environment a new plugin broke.
 *
 * Self-protection (watchdog): every async path is caught; only the loader
 * service is a hard dependency; webServer/webRuntime are optional (a CLI
 * profile without a web surface still gets staged loading, just no HTTP
 * panel). The guardian never rewrites cordis.patch.yml; its own state lives
 * at $DSH_HOME/guardian/state.json (atomic tmp+rename).
 *
 * Modules: state.ts (persistence) · events.ts (diagnostic log) · mount.ts
 * (staged/promoted mount pipeline) · api.ts (/guardian/api routes) ·
 * startup-check.ts (roster pre-check). This file only wires them together.
 */
import { watch } from 'node:fs'
import { join } from 'node:path'
import { createPersister, createState } from './state.js'
import type { SharedContext } from './state.js'
import { findRootTree, createMountOps, initialScan } from './mount.js'
import { createApi } from './api.js'
import { attachEventListeners, captureTeardownEntries, logEvent, recordTeardownReleases } from './events.js'
import { runStartupCheck } from './startup-check.js'
import type { DshContext, LoaderTree } from './types.js'

export const name = 'dsh-my-guardian'

/**
 * **顶层不声明 inject**（issue #242 的 fatal 形态修复）。
 *
 * cordis 解析顶层 `inject` 声明时若插件 ctx 已 inactive，会抛
 * `cannot get required service "loader" in inactive context` 并让整个
 * `dsh web` 启动失败（fail-loud 设计）；该错误发生在 apply **之前**，
 * apply 内的 try/catch 拦不住 —— 实测：把本插件从隔离 profile 的
 * `disabled: true` 去掉后实例直接 exit 1。
 *
 * 改为在 apply 内用 `ctx.inject([...], cb)` **局部等待**（与
 * `dsh-task-reliability/src/command.ts` 的 commands 注册同一模式）：
 * 服务就绪后回调初始化；始终拿不到时只 warn + 降级，绝不 fatal。
 */
export const inject: readonly string[] = []

/** Fallback poll interval for the staged file when fs.watch is unavailable. */
const POLL_MS = 4000

/** 返回 shared（含 `flushPersist()` 确定性就绪信号）供宿主/测试等待落盘；Cordis 忽略返回值。 */
export function apply(ctx: DshContext): SharedContext | undefined {
  // Watchdog self-protection: the guardian itself must never take the process
  // down. Any synchronous failure inside apply degrades the guardian (no
  // staged loading) instead of failing the whole boot (fail-loud).
  try {
    return applyWithScopedServices(ctx)
  } catch (error) {
    ctx.logger?.warn(
      `[dsh-my-guardian] apply failed — guardian degraded: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

/**
 * 以局部 inject 等待 loader/timer 后初始化（见上方 inject 注释）。
 *
 * - 服务已就绪：cordis 同步回调 → 返回 shared（行为与旧实现一致）；
 * - 服务晚到：apply 先返回 undefined（宿主忽略返回值），就绪后回调初始化；
 * - 服务始终缺失：**只 warn + 降级**，绝不抛错（看门狗自身不得 fatal）；
 * - 无 `ctx.inject` 的宿主/单测 mock：按旧路径直接初始化（依赖由调用方保证）。
 */
function applyWithScopedServices(ctx: DshContext): SharedContext | undefined {
  // 优先用常驻 root ctx 承载局部 inject（issue #242：profile 插件自身的 ctx 可能
  // 在加载时序里 inactive；root 常驻）。
  const hostCtx = (ctx as { root?: DshContext }).root ?? ctx
  const inject = (hostCtx as { inject?: (names: string[], callback: (scoped: DshContext) => void) => unknown }).inject
  if (typeof inject !== 'function') return applyInner(ctx)
  let shared: SharedContext | undefined
  let initialized = false
  inject.call(hostCtx, ['loader', 'timer'], (scoped: DshContext) => {
    initialized = true
    // 回调可能是**异步**的（服务晚到才触发）：此时异常不再落在外层 try/catch 里，
    // 必须在这里兜住——看门狗自身绝不能把进程带崩（fail-loud 会 exit 1）。
    try {
      shared = applyInner(scoped)
    } catch (error) {
      scoped.logger?.warn(
        `[dsh-my-guardian] scoped init failed — guardian degraded: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
  if (!initialized) {
    ctx.logger?.warn(
      '[dsh-my-guardian] loader/timer 服务尚未就绪 — guardian 等待局部 inject；本次 apply 暂不初始化（不 fatal）',
    )
  }
  return shared
}

function applyInner(ctx: DshContext): SharedContext | undefined {
  const root = findRootTree(ctx.loader)
  if (root === null) {
    ctx.logger?.warn('[dsh-my-guardian] no include tree found — guardian inactive')
    return undefined
  }
  const shared = createShared(root)
  wireServices(ctx, shared)
  scheduleInitialScan(ctx, shared)
  startWatchers(ctx, shared)
  registerTeardown(ctx, shared)
  registerStatusQuery(ctx, shared)
  return shared
}

/** Mutable per-instance runtime context shared by every sub-module. */
function createShared({ tree, profileDir }: { tree: LoaderTree; profileDir: string }): SharedContext {
  let markBooted: () => void = () => {}
  const bootPromise = new Promise<void>((resolve) => {
    markBooted = resolve
  })
  const shared: SharedContext = {
    state: createState(),
    ready: false,
    attempted: new Set(),
    mounted: new Set(),
    writeChain: Promise.resolve(),
    watcher: null,
    apiRegistered: false,
    tree,
    profileDir,
    stagedFile: join(profileDir, 'cordis.staged.json'),
    // startup-roster pre-check (issue #144): filled by runStartupCheck
    startupIssues: [],
    startupCheckedAt: null,
    startupSkippedHostRows: 0,
    startupNotes: [],
    persistSoon: () => {},
    persistFinal: async () => {},
    flushPersist: () => Promise.resolve(),
    beginClosingWrites: () => {},
    settleClosingWrites: async () => {},
    bootPromise,
    markBooted,
    disposed: false,
    logEvent: (_type: string, _message: string) => {},
    // Mount ops — filled by wireServices via Object.assign
    conflictOf: () => null,
    mount: async () => {},
    unmount: async () => {},
    mountWithState: async () => 'skipped',
    processStagedEntry: async () => {},
    mountPromoted: async () => {},
    scanStaged: async () => {},
    retryEntry: async () => null,
    removeEntry: async () => {},
    // API ops — filled by wireServices via Object.assign
    ensureApi: () => {},
    snapshot: () => ({}),
  }
  return shared
}

/** Bind persister, event log, mount ops, API and listeners onto shared. */
function wireServices(ctx: DshContext, shared: SharedContext): void {
  const persister = createPersister(shared, ctx.logger)
  shared.persistSoon = persister.persistSoon
  shared.persistFinal = persister.persistFinal
  shared.flushPersist = persister.flush
  shared.beginClosingWrites = persister.beginClosingWrites
  shared.settleClosingWrites = persister.settleClosingWrites
  shared.logEvent = (type: string, message: string) => logEvent(shared, type, message)
  Object.assign(shared, createMountOps(shared))
  Object.assign(shared, createApi(ctx, shared))
  attachEventListeners(ctx, shared)
}

// ── run after boot settles ──────────────────────────────────────────────
function scheduleInitialScan(ctx: DshContext, shared: SharedContext): void {
  void Promise.resolve().then(() => {
    // Startup-roster static pre-check (issue #144): best-effort, MUST never
    // block or break the boot — a pre-check failure only records a report.
    //
    // #217: best-effort 的是「失败不阻断」，不是「可以缺席启动就绪信号」。
    // 预检的产物（startupIssues / startupCheckedAt 快照 + startup-issue 事件
    // 落盘）同样是启动结果：它晚于 bootPromise 完成时，API 会读到空
    // startupIssues、teardown 会在它落盘前返回（旧快照覆盖下一个实例）。
    const startupCheck = runStartupCheck(ctx, shared).catch((error) => {
      ctx.logger?.warn(
        `[dsh-my-guardian] startup pre-check failed (recorded only): ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    const scan = initialScan(shared).catch((error) => {
      // the scan must never take the process down
      ctx.logger?.warn(
        `[dsh-my-guardian] initial scan failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    // 无论成败都放行 API：扫描/预检失败只降级，不能让 API 永久挂起
    void Promise.all([scan, startupCheck]).finally(() => shared.markBooted())
  })
}

// ── staged file watching (new candidates at runtime) + poll fallback ────
function startWatchers(ctx: DshContext, shared: SharedContext): void {
  try {
    shared.watcher = watch(shared.stagedFile, () => {
      if (!shared.ready) return
      void shared.scanStaged().catch(() => {})
    })
  } catch {
    shared.watcher = null
  }

  ctx.timer.interval(() => {
    if (!shared.ready) return
    shared.ensureApi()
    void shared.scanStaged().catch(() => {})
  }, POLL_MS)
}

/** 插件状态查询（#155 聚合层）：返回 guardian 加载状态 + 最近事件。 */
function registerStatusQuery(ctx: DshContext, shared: SharedContext): void {
  ctx.on('plugin:status-query', (arg: unknown) => {
    const { plugin } = arg as { plugin?: string }
    if (plugin !== 'dsh-my-guardian') return undefined
    const lastActions = (shared.state.events ?? []).slice(-5).map((e) => ({
      time: e.time ?? Date.now(),
      type: e.type ?? 'event',
      detail: e.message ?? '',
    }))
    return {
      ok: true,
      value: {
        plugin: 'dsh-my-guardian',
        config: { keys: ['safeMode', 'stagedFile'] },
        running: shared.ready,
        stats: { mounted: shared.mounted.size, safeMode: shared.state.safeMode === true },
        lastActions,
      },
    }
  })
}

/** teardown: unmount everything the guardian mounted, then drain the closing window.
 *
 *  disposer 返回 promise：await 它即保证「本实例启动路径 settle + 卸载 +
 *  收尾窗口排空落盘」完成，返回后本实例不再产生任何写。
 *  #189 只补了「写链 drain」+ async disposer：它覆盖不到 fire-and-forget 的
 *  启动预检（独立异步链，晚于 drain 才 persistSoon）；#217 把 bootPromise
 *  （现已含 initialScan + runStartupCheck）也等进来；#438 再把「同批并发 disposer
 *  晚到的 loader/partial-dispose」也等进来（收尾写入窗口 + 排空，见下）。
 *  见 docs/踩坑/README.md。 */
function registerTeardown(ctx: DshContext, shared: SharedContext): void {
  ctx.effect(
    () => async () => {
      if (shared.watcher !== null) {
        try {
          shared.watcher.close()
        } catch {
          // ignore
        }
        shared.watcher = null
      }
      // 立刻进入收尾态：此后本实例不再扫描、不再接受任何持久化——
      // 飞行中的 HTTP handler、已排队的 watcher/轮询回调都可能在 teardown
      // 返回之后才 persistSoon，把旧实例快照覆盖到下一个实例的 state.json 上。
      // （initialScan 也会因为 disposed 而不再把 ready 置回 true。）
      shared.disposed = true
      shared.ready = false
      // #438 第二种形态：**先同步抓一份 loader 树 entry 快照**（此刻树还完整 —— 实测
      // teardown 进入时 tree.store 有全部 entry，同批 group 释放之后才变空；同步读取
      // 也保证快照先于同批 disposer 的任何 await 让出）。收尾期事件通道收不到
      // （ctx.on 监听器与 teardown disposer 同批被摘除），差集是唯一可靠的「释放了谁」。
      const releasedBefore = captureTeardownEntries(shared.tree.store)
      // #438 第一种形态：打开收尾写入窗口。宿主卸载整树时同批 disposer 由 Promise.all
      // 并发执行、顺序无保证，同一批里其它 entry 的 loader/partial-dispose 可能晚于本实例
      // 的收尾快照才到达；窗口内先记账（persistSoon 不再直接丢弃），由下面的排空负责落盘。
      shared.beginClosingWrites()
      // #217: 再等本实例的启动路径（initialScan + 启动预检）settle。只 drain
      // 「已排队的写」不够——启动预检是 fire-and-forget 的独立异步链，它可能在
      // teardown 返回之后才 persistSoon（CI 上表现为随机红）。
      await shared.bootPromise
      // unmount 内部已吞异常（best effort），逐个 await 期间它们各自入链
      await Promise.all([...shared.mounted].map((id) => shared.unmount(id)))
      // #438 第二种形态：unmount 之后读一次树，记下本轮释放掉的 entry（与释放数一致）。
      recordTeardownReleases(shared, releasedBefore)
      // #438: 排空收尾窗口（强写 + 让出宏任务循环；判据是「收尾写活动静止」，不是
      // 墙钟猜测，轮数有上界）。返回时内存状态必已落盘、窗口随即关闭 —— 此后本实例
      // 不再产生任何写，旧快照不会覆盖下一个实例写好的 state.json（#217）。
      await shared.settleClosingWrites()
    },
    'dsh-my-guardian: teardown',
  )
}
