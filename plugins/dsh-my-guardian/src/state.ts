/**
 * dsh-my-guardian — state management: constants, persisted state (state.json)
 * and the candidate file (cordis.staged.json) helpers.
 *
 * All file writes are atomic (tmp + rename) and never throw to callers — the
 * guardian must never take the process down over a persistence failure.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Consecutive failures before an entry freezes (manual retry required). */
export const FREEZE_LIMIT = 3

/** Keep at most this many diagnostic events in the state. */
export const EVENT_LIMIT = 20

/** How many characters of an error message to keep in state. */
export const ERROR_SNIP = 300

/** Unique suffix for temp files (same-process instances must not collide). */
let tmpSeq = 0
function uniqueSuffix(): string {
  tmpSeq += 1
  return `${process.pid}-${Date.now().toString(36)}-${tmpSeq}`
}

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
  failureType: string | null
  missingDeps: string[]
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
}

/** One startup issue. */
export interface StartupIssue {
  type: string
  entryId: string
  name: string
  message: string
  fix: string | null
  remove?: string
  missingDeps?: string[]
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
  const dir = guardianDir()
  const file = join(dir, 'startup-issues.json')
  const tmp = `${file}.tmp-${uniqueSuffix()}`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(payload), 'utf8')
    await rename(tmp, file)
  } catch {
    // the report is diagnostic-only: a write failure must not break boot
  }
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

/** Persist state atomically (tmp + rename). Never throws to callers. */
async function persistState(state: GuardianStateDoc): Promise<void> {
  const dir = guardianDir()
  const file = join(dir, 'state.json')
  const tmp = `${file}.tmp-${uniqueSuffix()}`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(state), 'utf8')
    await rename(tmp, file)
  } catch {
    // persistence must never take the guardian down
  }
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
  persistSoon: () => void
  /** 写链 drain：await 它即保证此前所有 persistSoon 都已落盘完成。
   *  卸载/disposer 返回它，调用方不必再用固定 sleep 赌写盘跑完。 */
  flushPersist: () => Promise<void>
  /** teardown 已开始：此后的扫描入口（watcher/轮询）与 persistSoon 一律失效（#217）。
   *  只 await 已知的异步路径不够——watcher 回调、轮询 tick、飞行中的 HTTP
   *  handler 都可能在 teardown 之后才 persistSoon，把旧实例快照覆盖到下一个
   *  实例已写好的 state.json 上。 */
  disposed: boolean
  /** 收尾快照：teardown 唯一允许在 disposed 之后落盘的写（卸载后的最终状态）。 */
  persistFinal: () => void
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

/** Serialize state writes on a promise chain (drain in order). */
export function createPersister(shared: SharedContext): {
  persistSoon: () => void
  persistFinal: () => void
  flush: () => Promise<void>
} {
  const enqueue = (): void => {
    shared.writeChain = shared.writeChain.then(() => persistState(shared.state))
  }
  const persistSoon = (): void => {
    // teardown 已开始：本实例的任何延迟写都不该落到共享 state.json 上
    if (shared.disposed) return
    enqueue()
  }
  /** 收尾快照（teardown 专用）：绕过 disposed 守卫写一次最终状态。 */
  const persistFinal = (): void => enqueue()
  /** 确定性 drain 信号：resolve 时链上所有快照（含本 tick 排队的）都已落盘。 */
  const flush = (): Promise<void> => shared.writeChain
  return { persistSoon, persistFinal, flush }
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

/** Write the candidate file atomically. Returns an error object or null. */
export async function writeStagedFile(file: string, entries: unknown[]): Promise<Error | null> {
  const tmp = `${file}.tmp-${uniqueSuffix()}`
  try {
    await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
    return null
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Shorten an error for the state record. */
export function errorSnip(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return message.length > ERROR_SNIP ? `${message.slice(0, ERROR_SNIP)}…` : message
}
