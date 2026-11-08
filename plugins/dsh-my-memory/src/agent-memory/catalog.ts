/**
 * dsh-my-memory — agent 记忆的**目录缓存与自愈**（issue #502 后续）。
 *
 * 为什么需要它：记忆正文零常驻是对的，但「不读就不知道有什么、读了才知道」
 * 是个死结——按需读取把「想起来去 list」的负担压在模型自觉上，靠不住。
 * 所以目录常驻，内容恒定（前缀缓存友好），写入/删除后重建一次。
 *
 * 本文件只负责「什么时候重建」：启动同步装一次（prime）、本进程写入后 refresh、
 * 窗口外按 ≤1s 节流的磁盘指纹自愈（命令行脚本 / 第二个窗口写的条目也能看见）。
 * 具体的分组与排版在 catalog-render.ts。
 */
import { readFileSync, statSync } from 'node:fs'

import { absoluteFileOf, entryLinesOf, indexFile, listExistingFilesSync } from './paths.js'
import { renderCatalog } from './catalog-render.js'
import type { CatalogEntry } from './catalog-render.js'

export { MAX_CATALOG_BYTES, MAX_CATALOG_LINES, catalogPrefix, renderCatalog, truncateEntry } from './catalog-render.js'
function isCatalogFile(name: string): boolean {
  return name !== 'MEMORY.md'
}

/** 同步读一个文件的条目行；缺失或读失败返回空数组。 */
function entryLinesSync(name: string): string[] {
  try {
    return entryLinesOf(readFileSync(absoluteFileOf(name), 'utf8'))
  } catch {
    return []
  }
}

/** 目录校验的默认节流阈值（毫秒）：系统提示词每轮求值都调 text()，不能每轮 stat。 */
const DEFAULT_REVALIDATE_MS = 1000

/**
 * 磁盘指纹：文件 → mtime(ms)。
 *
 * 为什么是 mtime 而不是内容摘要：校验发生在系统提示词的同步求值里，内容摘要
 * 要把每个文件都读一遍——那等于取消了缓存本身。mtime 只要 stat，代价恒定。
 */
export type CatalogStamp = Record<string, number>

/** 默认指纹：stat 一遍磁盘上真实存在的记忆文件（不读正文）。 */
function diskStamp(): CatalogStamp {
  const stamp: CatalogStamp = {}
  for (const name of listExistingFilesSync()) {
    if (!isCatalogFile(name)) continue
    try {
      stamp[name] = statSync(absoluteFileOf(name)).mtimeMs
    } catch {
      // 刚被删除/不可读：跳过——列表本身的变化会让指纹不等
    }
  }
  return stamp
}

/** 指纹归一化为可比对的字符串（按文件名排序，保证顺序稳定）。 */
function stampKey(stamp: CatalogStamp): string {
  return Object.keys(stamp)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => name + ':' + String(stamp[name]))
    .join('\n')
}

/**
 * 同步读项目名映射（index.json 的 `projects` 字段）。
 *
 * 目录渲染是同步的（section.text()），所以这里只能同步读一次小文件（通常
 * 几百字节）。读失败/缺失一律降级为空表——展示名不值得让目录构建失败。
 */
function projectNamesSync(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(indexFile(), 'utf8')) as { projects?: unknown }
    const projects = raw.projects
    if (projects !== null && typeof projects === 'object') return projects as Record<string, string>
  } catch {
    // 缺失或损坏：退回 id 前 6 位
  }
  return {}
}

/**
 * 目录缓存：text() 同步返回当前目录（系统提示词每轮求值都要它），
 * refresh() 在写入/删除后重建；此外 text() 自己按节流阈值做一次磁盘指纹校验。
 *
 * 为什么同步：宿主组装系统提示词是同步的（section.text()），目录必须是
 * 已算好的字符串；重建走异步，写完立刻刷新，下一轮组装即生效。
 *
 * 为什么要自己校验（跨进程自愈）：onChange→refresh() 只覆盖**本进程**的写入。
 * 命令行脚本写记忆、第二个 DSH 窗口、用户手改文件，本进程的目录永远是旧的，
 * 也没有任何周期性兜底。所以 text() 里加一节流指纹校验：窗口外 stat 一遍，
 * 指纹变了才同步重建；没变必须原样返回（前缀缓存友好，也不每轮读正文）。
 */
export interface AgentMemoryCatalog {
  /** 当前目录正文（同步读缓存；窗口外顺带做一次节流指纹校验）。 */
  text: () => string
  /** 启动时同步装载一次：否则首轮组装会拿到空目录，agent 以为记忆库是空的。 */
  prime: () => void
  /** 重建目录（本进程写入/删除/归档后调用）。 */
  refresh: () => Promise<void>
}

/** 目录缓存的构造参数（阈值 / 时钟 / 指纹可注入：测试不必 sleep 真实的一秒）。 */
export interface AgentMemoryCatalogOptions {
  /** 校验节流阈值（毫秒，默认 1000）：距上次校验不足该值就跳过 stat。 */
  revalidateMs?: number
  /** 时钟（默认 Date.now）。 */
  now?: () => number
  /** 磁盘指纹来源（默认 stat 白名单文件；注入后可直接断言 stat 次数）。 */
  stamp?: () => CatalogStamp
}

/**
 * 构造目录缓存。
 *
 * @param source - 提供「文件 → 条目行」的函数；由 store 实现（已含 index 加载与归档过滤）。
 * @param options - 节流阈值 / 时钟 / 指纹（默认取生产值；测试注入以免 sleep）。
 */
export function createAgentMemoryCatalog(
  source: () => Promise<CatalogEntry[]>,
  options: AgentMemoryCatalogOptions = {},
): AgentMemoryCatalog {
  const revalidateMs = options.revalidateMs ?? DEFAULT_REVALIDATE_MS
  const now = options.now ?? Date.now
  const readStamp = options.stamp ?? diskStamp

  let cached = ''
  let snapshot = ''
  let checkedAt = Number.NEGATIVE_INFINITY

  const rebuild = (entries: CatalogEntry[], recency: CatalogStamp): void => {
    cached = renderCatalog(
      entries.filter((entry) => entry.lines.length > 0),
      projectNamesSync(),
      { recency },
    )
  }

  /**
   * 以文件系统为准重建（prime 与自愈共用）：扫描根级白名单 + projects/<id>/。
   * 顺序是「先取指纹、再读正文」：中途有别的进程写入时指纹偏旧，下次校验会
   * 自然重扫一次——宁可多扫一次，不可把新内容永久挡在缓存外。
   */
  const reloadFromDisk = (): void => {
    const stamp = readStamp()
    snapshot = stampKey(stamp)
    rebuild(
      listExistingFilesSync()
        .filter(isCatalogFile)
        .map((name) => ({ name, lines: entryLinesSync(name) })),
      stamp,
    )
    checkedAt = now()
  }

  /** 节流校验：窗口内直接返回；窗口外 stat 一遍，指纹变了才重建。 */
  const revalidate = (at: number): void => {
    if (at - checkedAt < revalidateMs) return
    checkedAt = at
    if (stampKey(readStamp()) !== snapshot) reloadFromDisk()
  }

  return {
    text: () => {
      revalidate(now())
      return cached
    },

    prime() {
      reloadFromDisk()
    },

    async refresh() {
      try {
        // 同 reloadFromDisk：先取指纹再读正文，写入竞态只会导致多扫一次。
        const stamp = readStamp()
        rebuild(await source(), stamp)
        snapshot = stampKey(stamp)
        checkedAt = now()
      } catch {
        // 目录重建失败不覆盖旧值：宁可展示上一次的目录，也不要把「读不到」当空库。
      }
    },
  }
}
