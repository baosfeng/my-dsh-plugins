/**
 * dsh-shared — JSON Lines 增量追加存储原语（防写放大）。
 *
 * 背景：9/2 审计插件事故——每次防抖落盘都全量重写整个状态文件
 * （writeFile(tmp, JSON.stringify(全量 state))），事件流持续时每小时数 GB。
 * jsonlAppender 把持久化成本压到「事件本体字节」量级：
 *  - append() 只排队新事件行，防抖批量 appendFile（写放大 ≤ 1 + 小系数）；
 *  - 累计行数达到 compactLines 阈值时触发宿主 onCompact 回调（宿主用
 *    snapshot() 原子重写全量行，文件大小有界）；
 *  - dispose() 冲刷全部挂起数据；stats() 暴露写入字节/次数（资源看板用）。
 *
 * 用法（宿主模式）：
 *   const store = jsonlAppender(file, { flushMs: 500, compactLines: 5000, onCompact: () => {
 *     store.snapshot(renderAllLines())   // 宿主用当前全量数据生成行
 *   }, logger })
 *   store.append(event); ... ; store.dispose()
 */
import { mkdir, rename, writeFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './types.js'

/** jsonlAppender 选项。 */
export interface JsonlOptions {
  /** 防抖窗口（毫秒），默认 500。 */
  flushMs?: number
  /** compact 阈值（行数），默认 5000。 */
  compactLines?: number
  /** 日志器（可选 warn）。 */
  logger?: Logger
  /** 阈值回调（可选）。 */
  onCompact?: (() => void) | null
  /** 日志前缀。 */
  prefix?: string
}

/** 内部句柄状态。 */
interface JsonlHandle {
  file: string
  queue: string[]
  queued: number
  total: number
  bytesWritten: number
  writes: number
  flushTimer: ReturnType<typeof setTimeout> | null
  compactTimer: ReturnType<typeof setTimeout> | null
  compacting: boolean
  dirtyChain: Promise<void>
  flushMs: number
  compactLines: number
  logger: Logger | undefined
  onCompact: (() => void) | null
  prefix: string
}

/** jsonlAppender 统计信息。 */
export interface JsonlStats {
  total: number
  bytesWritten: number
  writes: number
}

/** jsonlAppender 句柄接口。 */
export interface JsonlHandleInterface {
  append: (value: unknown) => void
  flush: () => void
  snapshot: (lines: string[]) => Promise<void>
  dispose: () => Promise<void>
  stats: () => JsonlStats
}

/**
 * 创建 jsonl 追加器句柄（file 为绝对/相对路径）。
 * options: flushMs（防抖，默认 500）、compactLines（阈值，默认 5000）、
 *          logger（可选 warn）、onCompact（阈值回调，可选）、prefix（日志前缀）。
 */
export function jsonlAppender(file: string, options: JsonlOptions = {}): JsonlHandleInterface {
  const { flushMs = 500, compactLines = 5000, logger, onCompact = null, prefix = '[jsonl]' } = options
  const handle: JsonlHandle = {
    file,
    queue: [],
    queued: 0,
    total: 0,
    bytesWritten: 0,
    writes: 0,
    flushTimer: null,
    compactTimer: null,
    compacting: false,
    dirtyChain: Promise.resolve(),
    flushMs,
    compactLines,
    logger,
    onCompact,
    prefix,
  }
  return {
    append: (value) => append(handle, value),
    flush: () => flushNow(handle),
    snapshot: (lines) => snapshot(handle, lines),
    dispose: () => dispose(handle),
    stats: () => ({ total: handle.total, bytesWritten: handle.bytesWritten, writes: handle.writes }),
  }
}

/** 追加一个可序列化对象（行入队；防抖批量落盘；达阈值调度 compact 回调）。 */
function append(handle: JsonlHandle, value: unknown): void {
  handle.queue.push(JSON.stringify(value))
  handle.queued += 1
  handle.total += 1
  scheduleFlush(handle)
  if (handle.queued >= handle.compactLines) scheduleCompact(handle)
}

/** 防抖批量追加落盘：一次 append 全部待写行（写放大=增量）。 */
function scheduleFlush(handle: JsonlHandle): void {
  if (handle.flushTimer !== null) return
  handle.flushTimer = setTimeout(() => {
    handle.flushTimer = null
    flushNow(handle)
  }, handle.flushMs)
}

function flushNow(handle: JsonlHandle): void {
  if (handle.queue.length === 0) return
  const text = `${handle.queue.join('\n')}\n`
  handle.queue = []
  handle.dirtyChain = handle.dirtyChain
    .then(async () => {
      await mkdir(dirname(handle.file), { recursive: true })
      await appendFile(handle.file, text, 'utf8')
      handle.bytesWritten += text.length
      handle.writes += 1
    })
    .catch((error) =>
      handle.logger?.warn(`${handle.prefix} append failed: ${error instanceof Error ? error.message : String(error)}`),
    )
}

/** 紧凑调度（防抖合并；回调由宿主决定快照内容）。 */
function scheduleCompact(handle: JsonlHandle): void {
  if (handle.compactTimer !== null || handle.compacting) return
  handle.compactTimer = setTimeout(() => {
    handle.compactTimer = null
    handle.compacting = true
    try {
      handle.onCompact?.()
    } finally {
      handle.compacting = false
    }
  }, 0)
}

/** 宿主快照：原子重写全量行（tmp+rename），并清挂起队列/计数（防重复）。 */
async function snapshot(handle: JsonlHandle, lines: string[]): Promise<void> {
  const tmp = `${handle.file}.tmp-${process.pid}`
  handle.dirtyChain = handle.dirtyChain
    .then(async () => {
      await mkdir(dirname(handle.file), { recursive: true })
      const text = lines.length > 0 ? `${lines.join('\n')}\n` : ''
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, handle.file)
      handle.queue = []
      handle.queued = 0
      handle.bytesWritten += text.length
      handle.writes += 1
    })
    .catch((error) =>
      handle.logger?.warn(
        `${handle.prefix} snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  return handle.dirtyChain
}

/** 卸载冲刷：清定时器 + 立即落盘 + 挂起 compact 兜底。 */
function dispose(handle: JsonlHandle): Promise<void> {
  if (handle.flushTimer !== null) {
    clearTimeout(handle.flushTimer)
    handle.flushTimer = null
  }
  if (handle.compactTimer !== null) {
    clearTimeout(handle.compactTimer)
    handle.compactTimer = null
  }
  flushNow(handle)
  if (handle.queued >= handle.compactLines) {
    handle.compacting = true
    try {
      handle.onCompact?.()
    } finally {
      handle.compacting = false
    }
  }
  return handle.dirtyChain
}

/** 解析 jsonl 文本为行数组（空行/非 JSON 行跳过）。 */
export function parseJsonlLines(text: string): string[] {
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      JSON.parse(line)
      lines.push(line)
    } catch {
      // 截断/损坏行忽略
    }
  }
  return lines
}
