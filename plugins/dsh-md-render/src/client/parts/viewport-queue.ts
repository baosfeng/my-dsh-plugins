// ── 视口队列：元素进入视口才执行渲染回调（增量渲染）─────────────────────────
// 背景（2026-10-24 卡死取证）：会话里每批 DOM 变更都会把「全部候选块」收集一遍并**立即渲染**，
// 长会话（实测 200+ 围栏块）里主线程被钉在同步 JS 上（/usr/bin/sample：288 帧、100% 样本）。
//
// 现在把「发现候选」与「真正渲染」拆开：扫描只登记，元素进入视口（含 rootMargin 预取）才执行。
// 未看到的块保持**宿主原生形态**——内容永远不丢，只是插件的增强（代码卡片 / 图表卡片 /
// 语言控件）延后到看见时。这同时天然解决「流式期间对大块反复重建」：同一元素同一用途的
// 回调按 key 覆盖，只保留最新一次。
//
// 契约：
//  - 一个元素可登记多个用途的回调（如围栏卡片 fence + 语言控件 lang），按登记顺序执行；
//  - 已在视口内的元素重复登记 → **同步执行**（流式块零延迟，行为与改造前一致）；
//  - 无 IntersectionObserver / 精简环境 → 一律同步执行（降级，测试与老宿主依赖它）；
//  - dispose 后断开观察并清空登记，新登记直接丢弃（不回写 DOM）。

/** 预取边距：进入视口前 400px 就渲染，滚动时不出现「先原生后变卡片」的明显跳变。 */
const VIEWPORT_ROOT_MARGIN = '400px 0px'
/** 每登记多少次顺带清一次死元素（脱离文档的元素永远等不到 IO 回调）。 */
const VIEWPORT_SWEEP_EVERY = 40
/** 待渲染表上限：会话切换后旧块可能永远等不到回调，靠这个上限保证内存有界。 */
const VIEWPORT_PENDING_MAX = 1500

interface ViewportObserverLike {
  observe(target: Element): void
  unobserve(target: Element): void
  disconnect(): void
}

interface ViewportQueueLike {
  enqueue(el: Element, key: string, run: () => void): void
  dispose(): void
}

/** 队列内部状态（拆成模块级函数后仍共享同一份，避免超长函数）。 */
interface ViewportQueueState {
  /** 待执行：[元素 → (用途 key → 回调)]，同 key 覆盖（内容变了只渲染最新一次）。 */
  pending: Map<Element, Map<string, () => void>>
  /** 当前处于视口内的元素：重复登记时同步执行，避免多等一帧。 */
  visible: WeakSet<Element>
  observer: ViewportObserverLike | null
  disposed: boolean
  sinceSweep: number
}

/** 单块渲染失败不能拖垮整批（宿主契约失配 / 渲染库缺失都走这里）。 */
function runSafely(run: () => void): void {
  try {
    run()
  } catch (_e) {
    // 有意静默：一块坏掉不影响后面的块。
  }
}

/** 执行某元素已登记的全部回调（按登记顺序），并从待执行表移除。 */
function flushViewportEntry(state: ViewportQueueState, el: Element): void {
  const runs = state.pending.get(el)
  if (runs === undefined) return
  state.pending.delete(el)
  for (const run of runs.values()) runSafely(run)
}

/** 清掉登记表里已经脱离文档的元素（observer 对死元素不会再有回调）。 */
function sweepViewportDetached(state: ViewportQueueState): void {
  for (const el of state.pending.keys()) {
    if (el.isConnected === false) {
      if (state.observer !== null) state.observer.unobserve(el)
      state.pending.delete(el)
    }
  }
}

/** 硬上限兜底：先清死元素，仍超量就按登记顺序丢掉最早的（多半在视口外很远）。 */
function enforceViewportPendingLimit(state: ViewportQueueState): void {
  if (state.pending.size <= VIEWPORT_PENDING_MAX) return
  sweepViewportDetached(state)
  let overflow = state.pending.size - VIEWPORT_PENDING_MAX
  if (overflow <= 0) return
  for (const el of state.pending.keys()) {
    if (overflow <= 0) break
    if (state.observer !== null) state.observer.unobserve(el)
    state.pending.delete(el)
    overflow -= 1
  }
}

/** IntersectionObserver 回调：维护可见集合、冲刷可见元素的待渲染项。 */
function handleViewportEntries(
  state: ViewportQueueState,
  records: Array<{ target: Element; isIntersecting: boolean }>,
): void {
  if (state.disposed) return
  for (const record of records) {
    const el = record.target
    if (el.isConnected === false) {
      if (state.observer !== null) state.observer.unobserve(el)
      state.pending.delete(el)
      state.visible.delete(el)
      continue
    }
    if (record.isIntersecting) {
      state.visible.add(el)
      flushViewportEntry(state, el)
    } else {
      state.visible.delete(el)
    }
  }
}

/** 登记一条「可见时执行」；已可见则同步执行；已脱离文档则不登记。 */
function enqueueIntoViewport(state: ViewportQueueState, el: Element, key: string, run: () => void): void {
  if (state.disposed || el.isConnected === false) return
  state.sinceSweep += 1
  if (state.visible.has(el)) {
    runSafely(run)
  } else {
    const runs = state.pending.get(el)
    if (runs === undefined) state.pending.set(el, new Map([[key, run]]))
    else runs.set(key, run)
    if (state.observer !== null) state.observer.observe(el)
  }
  if (state.sinceSweep >= VIEWPORT_SWEEP_EVERY) {
    state.sinceSweep = 0
    enforceViewportPendingLimit(state)
  }
}

/**
 * 建一个视口队列。环境不支持 IntersectionObserver 时返回 null —— 调用方据此走同步**降级**。
 */
function createViewportQueue(rootMargin: string): ViewportQueueLike | null {
  const Ctor = typeof IntersectionObserver === 'function' ? IntersectionObserver : undefined
  if (Ctor === undefined) return null
  const state: ViewportQueueState = {
    pending: new Map(),
    visible: new WeakSet(),
    observer: null,
    disposed: false,
    sinceSweep: 0,
  }
  try {
    const handle = (records: Array<{ target: Element; isIntersecting: boolean }>) =>
      handleViewportEntries(state, records)
    state.observer = new Ctor(handle, {
      root: null,
      rootMargin,
      threshold: 0,
    } as IntersectionObserverInit) as unknown as ViewportObserverLike
  } catch (_e) {
    return null
  }
  return {
    enqueue: (el, key, run) => enqueueIntoViewport(state, el, key, run),
    dispose: () => {
      state.disposed = true
      state.pending.clear()
      if (state.observer !== null) state.observer.disconnect()
      state.observer = null
    },
  }
}

/** 单例队列 + 装配计数（HMR / 双挂载时新旧 fiber 的 install / teardown 可能交错）。 */
let viewportQueue: ViewportQueueLike | null = null
let viewportQueueRefs = 0
/** teardown 之后不要再接新活（与「从未装配 → 同步降级」区分开）。 */
let viewportQueueTornDown = false

/** 装配视口队列（installScanner 调用；重复装配只建一次，靠引用计数配对销毁）。 */
function installViewportQueue(): void {
  viewportQueueRefs += 1
  if (viewportQueue !== null) return
  viewportQueueTornDown = false
  viewportQueue = createViewportQueue(VIEWPORT_ROOT_MARGIN)
}

/** teardown：最后一个持有者释放时才真正断开（未执行的登记一并丢弃）。 */
function disposeViewportQueue(): void {
  if (viewportQueueRefs > 0) viewportQueueRefs -= 1
  if (viewportQueueRefs > 0) return
  if (viewportQueue !== null) viewportQueue.dispose()
  viewportQueue = null
  viewportQueueTornDown = true
}

/**
 * 登记「元素可见时执行」。队列不存在（降级 / 已 teardown）→ 立即执行（或丢弃）。
 *
 * @param el  目标元素（围栏块 / 上下文块 / 图表块）
 * @param key 用途标识：同一元素同一 key 的旧回调会被覆盖
 * @param run 渲染动作（必须幂等：重复执行只做签名比对）
 */
function enqueueWhenVisible(el: Element, key: string, run: () => void): void {
  if (viewportQueue === null) {
    // 已 teardown：不再渲染（残留的 mutation 不该把 DOM 改回来）。
    if (viewportQueueTornDown) return
    runSafely(run)
    return
  }
  viewportQueue.enqueue(el, key, run)
}

exports.VIEWPORT_ROOT_MARGIN = VIEWPORT_ROOT_MARGIN
exports.VIEWPORT_PENDING_MAX = VIEWPORT_PENDING_MAX
exports.runSafely = runSafely
exports.createViewportQueue = createViewportQueue
exports.installViewportQueue = installViewportQueue
exports.disposeViewportQueue = disposeViewportQueue
exports.enqueueWhenVisible = enqueueWhenVisible
