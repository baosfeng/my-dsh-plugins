/**
 * dsh-my-guardian — state management: constants, persisted state (state.json)
 * and the candidate file (cordis.staged.json) helpers.
 *
 * All file writes are atomic (tmp + rename) and never throw to callers — the
 * guardian must never take the process down over a persistence failure.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared'
import type { Logger } from 'dsh-shared'
import type { MismatchIssue } from './dep-precheck.js'

/** Consecutive failures before an entry freezes (manual retry required). */
export const FREEZE_LIMIT = 3

/** Keep at most this many diagnostic events in the state. */
export const EVENT_LIMIT = 20

/** How many characters of an error message to keep in state. */
export const ERROR_SNIP = 300

/** 日志前缀（落盘护栏 warn 用）。 */
const PREFIX = '[dsh-my-guardian]'

/**
 * 状态快照字节上限（护栏兜底，issue #198 收尾）：events ≤ EVENT_LIMIT(20) 条
 * （每条消息截断到 ERROR_SNIP=300 字符），staged/promoted 条目数 = 受管插件数
 * （数十量级），单条 config 大小由用户配置决定 → 4MB 是保守上限。
 * 超限**拒绝写入并 warn**（保留上一份完好快照），不再随条目增长无界放大磁盘占用。
 */
const STATE_MAX_BYTES = 4 * 1024 * 1024

/** 候选文件字节上限（同上；条目来自扫描结果，数量级与受管插件数一致）。 */
const STAGED_MAX_BYTES = 4 * 1024 * 1024

/** 启动预检报告字节上限（issues 条目数 = 受管插件数）。 */
const REPORT_MAX_BYTES = 4 * 1024 * 1024

/** Guardian state dir: $DSH_HOME/guardian (fallback: ~/.dsh/guardian). */
function guardianDir(): string {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return join(home, 'guardian')
  return join(homedir(), '.dsh', 'guardian')
}

/** Guard entry record (staged or promoted). */
export interface EntryRecord {
  name: string
  config?: unknown
  attempts: number
  lastError: string | null
  lastFailedAt: number | null
  frozen: boolean
  /** 'dependency-missing' / 'dependency-mismatch' / 'code' / 'other'（#410 起细分）。
   *  旧快照里的 'dependency' 仍被 client 端渲染（向后兼容）。 */
  failureType: string | null
  /** 硬缺失的 peer（与 mismatchedDeps 分开：装着但版本不满足的不算缺失，#410）。 */
  missingDeps: string[]
  /** 版本不满足的 peer：声明范围 vs 实装版本（#410）。 */
  mismatchedDeps: MismatchIssue[]
  installHint: string | null
  promotedAt?: number
}

/** Guardian persisted state document. */
export interface GuardianStateDoc {
  version: number
  safeMode: boolean
  staged: Record<string, EntryRecord>
  promoted: Record<string, EntryRecord>
  events: DiagnosticEvent[]
}

/** Diagnostic event in the state ring buffer. */
export interface DiagnosticEvent {
  time: number
  type: string
  message: string
}

/** Startup issues payload written to startup-issues.json. */
export interface StartupIssuesPayload {
  version: number
  checkedAt: number
  profileDir: string
  issues: StartupIssue[]
  /** 被跳过的宿主供给行数（#424 A′）：不误报，但也绝不静默跳过。 */
  skippedHostRows: number
  /** 人类可读的跳过说明（skippedHostRows > 0 时非空）。 */
  notes: string[]
}

/** One startup issue. */
export interface StartupIssue {
  /** 'unresolvable' / 'dependency-missing' / 'dependency-mismatch' / 'duplicate-id'。
   *  旧报告里的 'dependency' 仍被 client 端渲染（向后兼容）。 */
  type: string
  entryId: string
  name: string
  message: string
  /** 可执行的修复命令；没有可安全执行的命令时为 null（宿主提供的包不给命令，#410）。 */
  fix: string | null
  remove?: string
  missingDeps?: string[]
  mismatchedDeps?: MismatchIssue[]
  installHint?: string | null
}

/**
 * Persist the startup-roster pre-check report (issue #144) atomically at
 * $DSH_HOME/guardian/startup-issues.json. The report is written even when
 * the roster is healthy (empty issues + checkedAt) so the file doubles as a
 * "last checked" marker; missing/corrupt file only means "never written".
 * Never throws to callers — the guardian must not take the process down.
 */
export async function writeStartupIssuesFile(payload: StartupIssuesPayload): Promise<void> {
  // 走 shared 快照原语（原子写 + 显式 4MB 上限 + 拦截计数）；失败只 warn，
  // 不上抛——报告是诊断产物，不能因此让 guardian 启动失败。
  await atomicWriteJson(join(guardianDir(), 'startup-issues.json'), payload, undefined, PREFIX, {
    minIntervalMs: 0,
    maxBytes: REPORT_MAX_BYTES,
  })
}

/** Empty state document. */
export function createState(): GuardianStateDoc {
  return { version: 1, safeMode: false, staged: {}, promoted: {}, events: [] }
}

/** Load persisted state (missing/corrupt file → fresh state). */
export async function loadState(): Promise<GuardianStateDoc> {
  try {
    const raw = await readFile(join(guardianDir(), 'state.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && parsed.version === 1) return parsed
  } catch {
    // first run or unreadable file: start fresh
  }
  return createState()
}

/** 状态文件绝对路径（$DSH_HOME/guardian/state.json）。 */
function stateFilePath(): string {
  return join(guardianDir(), 'state.json')
}

/** Shared runtime context for the guardian instance. */
export interface SharedContext {
  state: GuardianStateDoc
  ready: boolean
  attempted: Set<string>
  mounted: Set<string>
  writeChain: Promise<void>
  watcher: import('node:fs').FSWatcher | null
  apiRegistered: boolean
  tree: import('./types.js').LoaderTree
  profileDir: string
  stagedFile: string
  startupIssues: StartupIssue[]
  startupCheckedAt: number | null
  /** 预检跳过统计（#424 A′）：宿主供给行被跳过但可见。 */
  startupSkippedHostRows: number
  /** 预检跳过说明（#424 A′）。 */
  startupNotes: string[]
  persistSoon: () => void
  /** 写链 drain：await 它即保证此前所有 persistSoon 都已落盘完成。
   *  卸载/disposer 返回它，调用方不必再用固定 sleep 赌写盘跑完。 */
  flushPersist: () => Promise<void>
  /** teardown 已开始：此后的扫描入口（watcher/轮询）与 persistSoon 一律失效（#217）。
   *  只 await 已知的异步路径不够——watcher 回调、轮询 tick、飞行中的 HTTP
   *  handler 都可能在 teardown 之后才 persistSoon，把旧实例快照覆盖到下一个
   *  实例已写好的 state.json 上。
   *  ⚠️ 例外是**收尾写入窗口**（#438，见 beginClosingWrites）：窗口内到达的收尾写
   *  由 settleClosingWrites 排空落盘，窗口一关即完全失效。 */
  disposed: boolean
  /** 收尾强写：绕过 disposed 守卫写一次当前状态并等落盘完成（teardown 专用）。 */
  persistFinal: () => Promise<void>
  /** 打开收尾写入窗口（#438）：teardown 第一步调用（与 disposed=true 同步）。
   *  宿主卸载整树时同批 disposer 由 Promise.all 并发执行、顺序无保证，窗口内到达的
   *  loader/partial-dispose 先记账，由 settleClosingWrites 排空落盘。 */
  beginClosingWrites: () => void
  /** 排空收尾窗口内的写入并关闭窗口；resolve 时内存状态必已落盘（#438）。
   *  窗口关闭后 persistSoon 一律失效（#217：旧实例不得覆盖下一个实例的 state.json）。 */
  settleClosingWrites: () => Promise<void>
  /** 启动就绪（loadState + staged/promoted 挂载 + API 注册 + 启动预检）完成的
   *  确定性信号：API 分派与 teardown 前 await 它，查询/卸载语义与「启动耗时」无关。 */
  bootPromise: Promise<void>
  markBooted: () => void
  logEvent: (type: string, message: string) => void
  // Mount ops (mixed in by createMountOps)
  conflictOf: (id: string) => string | null
  mount: (id: string, options: { name: string; config?: unknown }) => Promise<void>
  unmount: (id: string) => Promise<void>
  mountWithState: (
    kind: 'staged' | 'promoted',
    id: string,
    entry: { name: string; config?: unknown },
  ) => Promise<'mounted' | 'failed' | 'skipped'>
  processStagedEntry: (id: string, entry: unknown) => Promise<void>
  mountPromoted: () => Promise<void>
  scanStaged: () => Promise<void>
  retryEntry: (id: string) => Promise<string | null>
  removeEntry: (id: string) => Promise<void>
  // API ops (mixed in by createApi)
  ensureApi: () => void
  snapshot: () => unknown
}

/**
 * 状态落盘（issue #198 收尾：接入 dsh-shared 原语，不再自写串行链）：
 *  - `createWriteScheduler`：防抖 500ms + 最小间隔 1s + 串行链 + `drain()` 确定性就绪信号。
 *    原实现每次 persistSoon 立即排一次全量写（mount 链上 5 处调用 → 多次写放大）；
 *  - `atomicWriteJson`：tmp+rename 原子写 + **显式 4MB 字节上限** + 拦截计数
 *    （`atomicWriteStats()`）与 warn（不静默）；
 *  - teardown 收尾（#438）：`beginClosingWrites()` 打开**收尾写入窗口** →
 *    `settleClosingWrites()` 用「强写 + 让出宏任务」循环排空窗口（判据是收尾写活动静止，
 *    不是墙钟猜测），返回时最终快照必已落盘、窗口随即关闭 —— 此后 persistSoon 一律失效
 *    （#217：不让旧实例覆盖下一个实例的状态）。
 *    为什么需要窗口：宿主卸载整树时同批 disposer 由 `Promise.all` 并发执行、顺序无保证
 *    （vendor/cordis 的 fiber `_unload`），任一 entry 的 `loader/partial-dispose` 都可能
 *    晚于本实例的收尾快照到达；「只落一次快照 + 之后无 flush 钩子」的旧实现会让它永久丢失。
 */
/** 收尾排空的最大轮数（有界：异常情况下退出体验也不能被无限拖长）。 */
const CLOSING_MAX_ROUNDS = 6

/** 收尾排空收敛所需的「连续无新写入」轮数（每轮 = 一次强写 + 一次宏任务让出）。 */
const CLOSING_QUIET_ROUNDS = 2

/**
 * 让出一轮宏任务（不做任何时长假设）：给「同批并发 disposer」的微任务/宏任务链推进机会。
 * 收尾排空靠「原子写（真实 IO）+ 让出」推进，而不是用固定 sleep 猜时长
 * （见 plugins/dsh-shared/test-kit/wait.mjs 与 scripts/check-test-sleeps.mjs）。
 */
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** 状态落盘句柄（createPersister 的返回；teardown 与测试共用同一契约）。 */
export interface Persister {
  persistSoon: () => void
  /** 收尾强写：force 写一次当前状态并等落盘完成。 */
  persistFinal: () => Promise<void>
  /** 确定性 drain 信号：resolve 时所有挂起/在飞快照（含防抖窗口内的）都已落盘。 */
  flush: () => Promise<void>
  /** 打开收尾写入窗口（#438）：随后到达的收尾写先记账，由 settleClosingWrites 落盘。 */
  beginClosingWrites: () => void
  /** 排空收尾窗口内的写入并关闭窗口；resolve 时内存状态必已落盘（#438）。 */
  settleClosingWrites: () => Promise<void>
}

export function createPersister(shared: SharedContext, logger?: Logger): Persister {
  const scheduler = createWriteScheduler({
    debounceMs: 500,
    // 与 atomicWriteJson 默认节流窗口一致（调度间隔 < 护栏窗口会拦下正常节奏）
    minIntervalMs: 1000,
    logger,
    prefix: PREFIX,
    // 节奏**单一来源**：调度器负责防抖 + 最小间隔，快照原语 `minIntervalMs: 0` 关节流。
    // 若两处都启用 1s 节流，`drain()`（非 force）的写会被原语节流拒掉 → 调度器重排耗尽后
    // 放弃 → 状态永不落盘（实测：guardian 的 promote 流程读盘断言失败）。
    write: ({ force }) =>
      atomicWriteJson(stateFilePath(), shared.state, logger, PREFIX, {
        force,
        minIntervalMs: 0,
        maxBytes: STATE_MAX_BYTES,
      }),
  })
  /**
   * 收尾写入窗口（#438）：teardown 开始（disposed=true）后，同批并发 disposer 仍可能
   * emit loader/partial-dispose。窗口内 persistSoon 只记账（不排调度器的防抖写），
   * 由 settleClosingWrites() 的「强写 + 让出」循环排空并落盘。
   */
  let closing = false
  let closingDirty = false
  const persistSoon = (): void => {
    if (closing) {
      // 收尾窗口内：先记账，settleClosingWrites() 会把它排空落盘
      closingDirty = true
      return
    }
    // teardown 已开始且不在收尾窗口：本实例的任何延迟写都不该落到共享 state.json 上
    if (shared.disposed) return
    scheduler.schedule()
  }
  /** 收尾强写（teardown 专用）：绕过 disposed 守卫 force 写一次并等落盘完成。 */
  const persistFinal = (): Promise<void> => scheduler.flush()
  /** 确定性 drain 信号：resolve 时所有挂起/在飞快照（含防抖窗口内的）都已落盘。 */
  const flush = (): Promise<void> => scheduler.drain()
  /** 打开收尾写入窗口（#438）：teardown 第一步调用（与 disposed=true 同步）。 */
  const beginClosingWrites = (): void => {
    closing = true
  }
  /**
   * 排空收尾窗口并关闭它（#438）。
   *
   * 每轮 = 一次强写（真实原子写，必然让出多个事件循环轮次）+ 一次宏任务让出，
   * 之后检查窗口内是否又有新写入；**连续 CLOSING_QUIET_ROUNDS 轮无新写入**即收敛。
   * 判据是「收尾写活动静止」这一可观测事实，不是墙钟猜测；轮数有上界，退出体验不被拖长。
   */
  const settleClosingWrites = async (): Promise<void> => {
    closing = true
    let quiet = 0
    try {
      for (let round = 0; round < CLOSING_MAX_ROUNDS && quiet < CLOSING_QUIET_ROUNDS; round += 1) {
        closingDirty = false
        await persistFinal()
        await yieldMacrotask()
        quiet = closingDirty ? 0 : quiet + 1
      }
    } finally {
      // 窗口关闭：此后 persistSoon 一律失效（#217：旧实例不得覆盖下一个实例的快照）
      closing = false
    }
  }
  return { persistSoon, persistFinal, flush, beginClosingWrites, settleClosingWrites }
}

/** Read the candidate file; missing/corrupt → []. */
export async function readStagedFile(file: string): Promise<unknown[]> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // missing or malformed: treat as empty
  }
  return []
}

/**
 * Write the candidate file atomically. Returns an error object or null.
 * 走 shared 快照原语（紧凑 JSON：消除原 `JSON.stringify(entries, null, 2)` 的缩进放大；
 * 显式 4MB 上限；`minIntervalMs: 0` 因为这是挂载流程里的显式低频写，节奏由调用方决定）。
 */
export async function writeStagedFile(file: string, entries: unknown[]): Promise<Error | null> {
  const written = await atomicWriteJson(file, entries, undefined, PREFIX, {
    minIntervalMs: 0,
    maxBytes: STAGED_MAX_BYTES,
  })
  return written ? null : new Error('staged file write blocked by shared guardrails (byte limit / IO)')
}

/** Shorten an error for the state record. */
export function errorSnip(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return message.length > ERROR_SNIP ? `${message.slice(0, ERROR_SNIP)}…` : message
}
