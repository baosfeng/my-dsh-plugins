/**
 * dsh-my-memory — agent 记忆的元数据索引（issue #502）。
 *
 * `index.json` 是**系统独占**的事实来源：创建时间、最后读取时间、读取次数、
 * 归档时间。agent 通过工具**读不到也写不到**它——这正是遗忘机制可信的前提：
 * 若 agent 能改 `lastReadAt`，它就能让死记忆永生，遗忘形同虚设。
 *
 * 文件形状：
 *   { "files": { "user.md": { "createdAt", "updatedAt", "lastReadAt", "readCount", "archivedAt?" } } }
 *
 * 缺失/损坏一律降级为空索引（与 store.ts 的防御式读取一致），绝不因元数据
 * 损坏丢掉正文。
 */
import { readFile } from 'node:fs/promises'
import { atomicWriteJson } from 'dsh-shared'
import { indexFile } from './paths.js'

/** 单个文件的元数据。 */
export interface FileMeta {
  /** 首次写入时间（ms）。 */
  createdAt: number
  /** 最后写入时间（ms）。 */
  updatedAt: number
  /** 最后被 agent 读取的时间（ms）；0 表示从未读过。 */
  lastReadAt: number
  /** 被 agent 读取的累计次数。 */
  readCount: number
  /** 归档时间（ms）；存在即表示已移入 archive/。 */
  archivedAt?: number
}

/** 元数据索引。 */
export interface AgentMemoryIndex {
  files: Record<string, FileMeta>
}

/** 日志接口（与其它模块保持同构，避免引入宿主类型依赖）。 */
export interface IndexLogger {
  warn(message: string): void
}

/** 空条目（首次出现时的时间戳基准）。 */
function freshMeta(now: number): FileMeta {
  return { createdAt: now, updatedAt: now, lastReadAt: 0, readCount: 0 }
}

/** 读取并解析索引文件；缺失/损坏 → 空索引（正文仍在，元数据从此刻重建）。 */
async function readIndex(): Promise<AgentMemoryIndex> {
  try {
    const raw = JSON.parse(await readFile(indexFile(), 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object' || !('files' in raw)) return { files: {} }
    const files = (raw as AgentMemoryIndex).files
    return { files: files !== null && typeof files === 'object' ? files : {} }
  } catch {
    return { files: {} }
  }
}

/** 写入时间戳。 */
function markWritten(meta: FileMeta, at: number): void {
  meta.updatedAt = at
}

/** 读取时间戳 + 计数自增（遗忘机制的唯一事实来源）。 */
function markRead(meta: FileMeta, at: number): void {
  meta.lastReadAt = at
  meta.readCount += 1
}

/** 归档时间戳。 */
function markArchivedAt(meta: FileMeta, at: number): void {
  meta.archivedAt = at
}

/** agent 记忆元数据索引的读写门面。 */
export function createIndexStore({ logger }: { logger?: IndexLogger } = {}): {
  load: () => Promise<AgentMemoryIndex>
  state: () => AgentMemoryIndex
  touchWrite: (name: string, now?: number) => Promise<void>
  touchRead: (name: string, now?: number) => Promise<void>
  markArchived: (name: string, now?: number) => Promise<void>
  drop: (name: string) => Promise<void>
  metaOf: (name: string) => FileMeta | undefined
  flush: () => Promise<void>
} {
  let cache: AgentMemoryIndex = { files: {} }
  let loaded = false

  const persist = async (): Promise<void> => {
    try {
      await atomicWriteJson(indexFile(), cache, logger, '[dsh-my-memory] agent-memory index', {
        minIntervalMs: 0,
      })
    } catch (error) {
      logger?.warn(`agent-memory: 元数据写入失败（正文不受影响）：${String(error)}`)
    }
  }

  const load = async (): Promise<AgentMemoryIndex> => {
    if (loaded) return cache
    loaded = true
    cache = await readIndex()
    return cache
  }

  /** 取或建一条元数据（原地更新 cache）。 */
  const ensure = (name: string, now: number): FileMeta => {
    const existing = cache.files[name]
    if (existing !== undefined) return existing
    const created = freshMeta(now)
    cache.files[name] = created
    return created
  }

  /** 统一的「改一条元数据再落盘」入口。 */
  const mutate = async (
    name: string,
    apply: (meta: FileMeta, now: number) => void,
    now = Date.now(),
  ): Promise<void> => {
    await load()
    apply(ensure(name, now), now)
    await persist()
  }

  return {
    load,
    state: () => cache,
    metaOf: (name) => cache.files[name],
    touchWrite: (name, now?) => mutate(name, markWritten, now),
    touchRead: (name, now?) => mutate(name, markRead, now),
    markArchived: (name, now?) => mutate(name, markArchivedAt, now),
    async drop(name) {
      await load()
      delete cache.files[name]
      await persist()
    },
    flush: persist,
  }
}

/** 元数据索引实例类型。 */
export type IndexStore = ReturnType<typeof createIndexStore>
