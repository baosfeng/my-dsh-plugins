/**
 * dsh-my-skill-manager — skill 使用统计。
 *
 * 计数口径：包装 `ctx.skills.get()`——正文被加载（模型 skill 工具 / 用户
 * `/name` 手势注入）即计一次；来源判定由 `tools/pre-execute` 标记：命中
 * skill 工具的调用记 model，其余记 user。
 *
 * 落盘：`$DSH_HOME/skills.usage.json`（缺省 ~/.dsh/…），防抖 500ms + 最小
 * 间隔 1s（dsh-shared createWriteScheduler 串行链）+ 原子写（tmp + rename）。
 * 启动异步加载；加载完成前的计数缓冲后回放，不丢事件；drain() 是确定性
 * 就绪信号。
 *
 * 数据形状：
 *   { "skills": { "<name>": { "count": N, "lastUsedAt": ts, "lastSource": "model"|"user" } } }
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, createWriteScheduler } from 'dsh-shared'
import { dshHome } from './config-store.js'
import type { Logger, SkillsService, SkillViewOptions } from './types.js'

/** 统计文件名。 */
export const USAGE_FILE_NAME = 'skills.usage.json'

/** 防抖窗口（ms）。 */
const USAGE_DEBOUNCE_MS = 500

/** 最小写间隔（ms）：与 atomicWriteJson 默认护栏窗口对齐。 */
const USAGE_MIN_INTERVAL_MS = 1000

/** 使用来源：model = 模型 skill 工具；user = 用户手势注入等。 */
export type UsageSource = 'model' | 'user'

/** 单个 skill 的统计条目。 */
export interface UsageEntry {
  count: number
  lastUsedAt: number
  lastSource: UsageSource
}

/** 统计快照：{ name: entry }。 */
export type UsageSnapshot = Record<string, UsageEntry>

/** 统计文件路径。 */
export function usageFile(): string {
  return join(dshHome(), USAGE_FILE_NAME)
}

/** createUsageStore 入参。 */
export interface UsageStoreOptions {
  file: string
  logger?: Logger | undefined
  /** 测试可缩短防抖 / 间隔。 */
  debounceMs?: number | undefined
  minIntervalMs?: number | undefined
  /** 时间源（测试注入）。 */
  now?: (() => number) | undefined
}

/** 使用统计 store。 */
export interface UsageStore {
  readonly file: string
  /** 加载完成信号（测试 / 就绪判据）。 */
  ready(): Promise<void>
  /** 当前统计快照。 */
  snapshot(): UsageSnapshot
  /** 记录一次使用（防抖持久化）。 */
  record(name: string, source: UsageSource): void
  /** 等待所有挂起写入结束（确定性就绪信号）。 */
  drain(): Promise<void>
  /** 立即强写（dispose / 退出前）。 */
  flush(): Promise<void>
}

/** 条目规整：count <= 0 或结构非法返回 undefined。 */
function normalizeUsageEntry(raw: unknown): UsageEntry | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const source = raw as { count?: unknown; lastUsedAt?: unknown; lastSource?: unknown }
  const count = typeof source.count === 'number' && Number.isFinite(source.count) ? Math.floor(source.count) : 0
  if (count <= 0) return undefined
  const lastUsedAt = typeof source.lastUsedAt === 'number' && Number.isFinite(source.lastUsedAt) ? source.lastUsedAt : 0
  const lastSource: UsageSource = source.lastSource === 'model' ? 'model' : 'user'
  return { count, lastUsedAt, lastSource }
}

/** 解析统计文件内容（结构不合法 → undefined）。 */
function parseUsageSnapshot(text: string | undefined | null): UsageSnapshot | undefined {
  if (text === undefined || text === null || text === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    const skills = (parsed as { skills?: unknown } | null | undefined)?.skills
    if (skills === null || typeof skills !== 'object') return undefined
    const snapshot: UsageSnapshot = {}
    for (const [name, raw] of Object.entries(skills as Record<string, unknown>)) {
      const entry = normalizeUsageEntry(raw)
      if (entry !== undefined) snapshot[name] = entry
    }
    return snapshot
  } catch {
    return undefined
  }
}

/** 由内存 Map 生成快照（拷贝，调用方可安全序列化）。 */
function snapshotOf(byName: ReadonlyMap<string, UsageEntry>): UsageSnapshot {
  const snapshot: UsageSnapshot = {}
  for (const [name, entry] of byName) snapshot[name] = { ...entry }
  return snapshot
}

/** 创建统计 store（异步加载启动；record 在加载完成前进入缓冲）。 */
export function createUsageStore(options: UsageStoreOptions): UsageStore {
  const byName = new Map<string, UsageEntry>()
  const buffered: Array<() => void> = []
  const now = options.now ?? (() => Date.now())
  let loaded = false
  let resolveReady = (): void => {}
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const scheduler = createWriteScheduler({
    debounceMs: options.debounceMs ?? USAGE_DEBOUNCE_MS,
    minIntervalMs: options.minIntervalMs ?? USAGE_MIN_INTERVAL_MS,
    logger: options.logger,
    prefix: '[dsh-my-skill-manager]',
    // 节奏由调度器负责（含 drain 的排队写），落盘原语关节流避免双护栏互相拒绝。
    write: ({ force }) =>
      atomicWriteJson(options.file, { skills: snapshotOf(byName) }, options.logger, '[dsh-my-skill-manager]', {
        force,
        minIntervalMs: 0,
      }),
  })
  const schedule = (): void => {
    if (loaded) scheduler.schedule()
    else buffered.push(() => scheduler.schedule())
  }
  const finishLoad = (parsed: UsageSnapshot | undefined): void => {
    if (parsed !== undefined) {
      // 磁盘数据为基底；加载完成前内存里的变更优先。
      for (const [name, entry] of Object.entries(parsed)) {
        if (!byName.has(name)) byName.set(name, entry)
      }
    }
    loaded = true
    resolveReady()
    const pending = buffered.splice(0)
    for (const run of pending) run()
    if (parsed !== undefined || pending.length > 0) scheduler.schedule()
  }
  void readFile(options.file, 'utf8')
    .then((text) => finishLoad(parseUsageSnapshot(text)))
    .catch(() => finishLoad(undefined))
  return {
    file: options.file,
    ready: () => readyPromise,
    snapshot: () => snapshotOf(byName),
    record: (name, source) => {
      const entry = byName.get(name) ?? { count: 0, lastUsedAt: 0, lastSource: 'user' as UsageSource }
      entry.count += 1
      entry.lastUsedAt = now()
      entry.lastSource = source === 'model' ? 'model' : 'user'
      byName.set(name, entry)
      schedule()
    },
    drain: async () => {
      await readyPromise
      await scheduler.drain()
    },
    flush: async () => {
      await readyPromise
      await scheduler.flush()
    },
  }
}

/** 模型调用标记：tools/pre-execute 记下最近一次模型 skill 工具调用。 */
export interface ModelCallTracker {
  mark(name: string): void
  /** 命中同名 skill 时返回 true 并消费标记；否则 false。 */
  claim(name: string): boolean
}

/** 创建模型调用标记器。 */
export function createModelCallTracker(): ModelCallTracker {
  let pending: string | null = null
  return {
    mark: (name) => {
      pending = name
    },
    claim: (name) => {
      if (pending !== name) return false
      pending = null
      return true
    },
  }
}

/** 包装 `skills.get`：正文加载成功即计数（来源由标记器判定）；返回还原函数。 */
export function wrapSkillGet(skills: SkillsService, usage: UsageStore, tracker?: ModelCallTracker): () => void {
  const original = skills.get
  if (typeof original !== 'function') return () => {}
  const bound = original.bind(skills)
  skills.get = async (name: string, options?: SkillViewOptions) => {
    const skill = await bound(name, options)
    const fromModel = tracker?.claim(name) ?? false
    if (skill !== undefined) usage.record(name, fromModel ? 'model' : 'user')
    return skill
  }
  return () => {
    skills.get = original
  }
}
