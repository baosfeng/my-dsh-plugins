/**
 * dsh-my-skill-manager — skill usage statistics (issue #91).
 *
 * 记录每个 skill 被加载/使用的情况：使用次数累计 + 最近使用时间 + 使用来源
 * （model = 模型通过 skill 工具加载；user = 用户 /name 手势注入等）。
 *
 * 持久化：$DSH_HOME/skills.usage.json（fallback ~/.dsh/skills.usage.json）。
 * 写入调度用 dsh-shared 的 createWriteScheduler（issue #198：防抖 500ms +
 * 最小间隔 1s + 串行链），落盘用 atomicWriteJson（默认护栏：1s 节流兜底 +
 * 1MB 字节上限——usage 状态自身有界，条目数 = 已知 skill 数）。
 * 启动异步加载：结构不合法回退空状态；加载完成前 record 的变更缓冲在
 * pending 队列，加载后回放（不丢事件）；drainUsage() 是确定性就绪信号。
 *
 * 数据形状：
 *   { "skills": { "<name>": { "count": N, "lastUsedAt": ts, "lastSource": "model"|"user" } } }
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared'
import type { WriteScheduler } from 'dsh-shared'
import type { Logger } from './types.js'

/** 防抖间隔（ms）。 */
const PERSIST_DEBOUNCE_MS = 500

/** 落盘最小间隔（ms）：与 atomicWriteJson 默认节流窗口一致（护栏不误伤正常节奏）。 */
const PERSIST_MIN_INTERVAL_MS = 1000

/** 使用来源：model = 模型 skill 工具；user = 用户手势注入等。 */
export type UsageSource = 'model' | 'user'

/** 单个 skill 的使用条目。 */
export interface UsageEntry {
  count: number
  lastUsedAt: number
  lastSource: UsageSource
}

/** 统计快照：{ name: entry }。 */
export type UsageSnapshot = Record<string, UsageEntry>

/** store 的可序列化状态（构造期即确定的部分）。 */
interface UsageStoreCore {
  file: string
  logger: Logger | undefined
  byName: Map<string, UsageEntry>
  ready: boolean
  pending: Array<() => void>
  scheduler: WriteScheduler
}

/** 使用统计 store（异步加载启动；readyPromise 在加载完成后 resolve）。 */
export interface UsageStore extends UsageStoreCore {
  readyPromise: Promise<void>
  /** @internal 由 createUsageStore 注入，供 onLoaded 唤醒 readyPromise。 */
  _resolveReady: () => void
}

/** createUsageStore 的入参。 */
export interface UsageStoreOptions {
  file: string
  logger?: Logger
}

/** 全局使用统计文件：$DSH_HOME/skills.usage.json（fallback ~/.dsh/...）。 */
export function usageFile(): string {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return `${home}/skills.usage.json`
  return `${homedir()}/.dsh/skills.usage.json`
}

/** 创建使用统计 store（异步加载启动；readyPromise 在加载完成后 resolve）。 */
export function createUsageStore({ file, logger }: UsageStoreOptions): UsageStore {
  const core = {
    file,
    logger,
    byName: new Map<string, UsageEntry>(),
    ready: false,
    pending: [] as Array<() => void>,
  } as UsageStoreCore
  core.scheduler = createWriteScheduler({
    debounceMs: PERSIST_DEBOUNCE_MS,
    minIntervalMs: PERSIST_MIN_INTERVAL_MS,
    logger,
    prefix: '[dsh-my-skill-manager]',
    write: ({ force }) =>
      atomicWriteJson(core.file, { skills: usageSnapshot(core) }, core.logger, '[dsh-my-skill-manager]', { force }),
  })
  // 属性顺序与迁移前一致：core 字段先建，readyPromise/_resolveReady 后挂。
  const store = core as UsageStore
  store.readyPromise = new Promise<void>((resolve) => {
    store._resolveReady = resolve
  })
  void readFile(file, 'utf8')
    .then((text) => onLoaded(store, text))
    .catch(() => onLoaded(store, ''))
  return store
}

/** 状态加载完成：解析/规整 + 合并本进程已产生的变更 + 回放缓冲 + 落盘。 */
function onLoaded(store: UsageStore, text: string): void {
  const parsed = parseLoaded(text)
  if (parsed !== undefined) {
    // 磁盘数据为基底，内存已有变更（加载完成前 record 的）覆盖。
    for (const [name, entry] of Object.entries(parsed)) {
      if (!store.byName.has(name)) store.byName.set(name, entry)
    }
  }
  store.ready = true
  store._resolveReady()
  const pending = store.pending.splice(0)
  for (const run of pending) run()
  if (pending.length > 0 || parsed !== undefined) store.scheduler.schedule()
}

/** 解析已持久化的统计（结构不合法时回退 undefined）。 */
function parseLoaded(text: string | undefined | null): UsageSnapshot | undefined {
  if (text === undefined || text === null || text === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    const skills = (parsed as { skills?: unknown } | null | undefined)?.skills
    if (skills === null || typeof skills !== 'object') return undefined
    const result: UsageSnapshot = {}
    for (const [name, raw] of Object.entries(skills as Record<string, unknown>)) {
      const entry = normalizeEntry(raw)
      if (entry !== undefined) result[name] = entry
    }
    return result
  } catch {
    return undefined
  }
}

/** 条目结构规整：过滤非法字段，回退默认值；count <= 0 的条目丢弃。 */
function normalizeEntry(raw: unknown): UsageEntry | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const source = raw as { count?: unknown; lastUsedAt?: unknown; lastSource?: unknown }
  const count = typeof source.count === 'number' && Number.isFinite(source.count) ? Math.floor(source.count) : 0
  if (count <= 0) return undefined
  const lastUsedAt = typeof source.lastUsedAt === 'number' && Number.isFinite(source.lastUsedAt) ? source.lastUsedAt : 0
  const lastSource: UsageSource = source.lastSource === 'model' ? 'model' : 'user'
  return { count, lastUsedAt, lastSource }
}

/** 记录一次 skill 使用：次数 +1、更新最近时间与来源，防抖持久化。 */
export function recordUsage(store: UsageStore, name: string, source: UsageSource): void {
  const entry = store.byName.get(name) ?? { count: 0, lastUsedAt: 0, lastSource: 'user' }
  entry.count += 1
  entry.lastUsedAt = Date.now()
  entry.lastSource = source === 'model' ? 'model' : 'user'
  store.byName.set(name, entry)
  if (store.ready) store.scheduler.schedule()
  else store.pending.push(() => store.scheduler.schedule())
}

/** 当前统计快照：{ name: { count, lastUsedAt, lastSource } }。 */
export function usageSnapshot(store: UsageStoreCore): UsageSnapshot {
  const result: UsageSnapshot = {}
  for (const [name, entry] of store.byName) {
    result[name] = { count: entry.count, lastUsedAt: entry.lastUsedAt, lastSource: entry.lastSource }
  }
  return result
}

/** 立即冲刷持久化（dispose 时调用；返回落盘 Promise）。 */
export function flushUsage(store: UsageStore): Promise<void> {
  return store.scheduler.flush()
}

/** 等待所有挂起写入结束（确定性就绪信号：await 后内存与磁盘一致）。 */
export function drainUsage(store: UsageStore): Promise<void> {
  return store.scheduler.drain()
}
