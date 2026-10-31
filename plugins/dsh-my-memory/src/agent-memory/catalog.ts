/**
 * dsh-my-memory — agent 记忆的**目录**（issue #502 后续：常驻目录）。
 *
 * 为什么需要它：记忆正文零常驻是对的，但「不读就不知道有什么、读了才知道」
 * 是个死结——按需读取把「想起来去 list」的负担压在模型自觉上，靠不住
 * （Claude Code 的解法就是把索引常驻，不给模型忘记的机会）。
 *
 * 所以本模块只做一件事：把 agent 自己写过的条目**一行一条**排成目录，
 * 挂进系统提示词的固定段。它不做任何判断、不打分、不筛相关性——目录不是
 * 「系统替 agent 想」，只是把 agent 自己的目录摆出来。
 *
 * 成本边界（硬上限，绝不静默膨胀）：
 *  - 40 行 / 3 KB，超出按文件顺序截断，末尾给「还有 N 条，read 对应文件」；
 *  - 单行摘要 32 字，超长截断；
 *  - 内容恒定 → 前缀缓存可命中；写入/删除后重建一次，只失效一次。
 */
import { readFileSync } from 'node:fs'

import { absoluteFileOf, listExistingFilesSync } from './paths.js'

/** 目录最多展示的行数（超过按文件顺序截断，末尾给剩余条数）。 */
export const MAX_CATALOG_LINES = 60

/** 目录正文的字节上限（UTF-8，约 1.5k 汉字）。 */
const MAX_CATALOG_BYTES = 4096

/** 单行摘要的字符上限（超出截断，避免一条长记忆把整份目录吃掉）。 */
const CATALOG_LINE_CHARS = 32

/** 截断一条摘要（按字符，不切坏代理对）。 */
export function truncateEntry(line: string, limit: number = CATALOG_LINE_CHARS): string {
  const chars = [...line]
  return chars.length <= limit ? line : chars.slice(0, limit).join('') + '…'
}

/**
 * 目录里的展示优先级：全局偏好最先，其次反馈，最后项目层。
 *
 * 为什么必须排：目录是硬截断的，谁排后面谁就看不见。按文件名排会把
 * user.md（全局偏好，跨项目都该生效）排到 projects/ 之后——实测过，
 * 13 条全局偏好被一个项目的 16 条坑挤到截断之外，一条都没露出来。
 */
function catalogRank(name: string): number {
  if (name === 'user.md') return 0
  if (name === 'feedback.md') return 1
  if (name.startsWith('projects/')) return 2
  return 3
}

/**
 * 把「文件 → 条目行」渲染成目录正文。
 *
 * @param entries - 每个文件的条目行（调用方给的文件顺序无关，本函数按
 *   「全局偏好 → 反馈 → 项目层」重排，保证最重要的先占位）。
 * @returns 一行一条的目录；空库返回空串（调用方给「还没有记忆」的说明）。
 */
export function renderCatalog(entries: Array<{ name: string; lines: string[] }>): string {
  const rows: string[] = []
  let bytes = 0
  let dropped = 0
  const ordered = [...entries].sort((a, b) => catalogRank(a.name) - catalogRank(b.name) || a.name.localeCompare(b.name))
  for (const entry of ordered) {
    for (const line of entry.lines) {
      const row = entry.name + ' · ' + truncateEntry(line)
      const size = Buffer.byteLength(row, 'utf8') + 1
      if (rows.length >= MAX_CATALOG_LINES || bytes + size > MAX_CATALOG_BYTES) {
        dropped += 1
        continue
      }
      rows.push(row)
      bytes += size
    }
  }
  if (dropped > 0) rows.push('（另有 ' + dropped + ' 条未展开，用 agent_memory_read 读对应文件）')
  return rows.join('\n')
}

/** 目录排除 MEMORY.md（索引本身由系统生成，不该自我描述）。 */
function isCatalogFile(name: string): boolean {
  return name !== 'MEMORY.md'
}

/** 同步读一个文件的条目行；缺失或读失败返回空数组。 */
function entryLinesSync(name: string): string[] {
  try {
    const text = readFileSync(absoluteFileOf(name), 'utf8')
    return text
      .split('\n')
      .filter((line) => /^\s*-\s+\S/.test(line))
      .map((line) => line.replace(/^\s*-\s+/, '').trim())
  } catch {
    return []
  }
}

/**
 * 目录缓存：text() 同步返回当前目录（系统提示词每轮求值都要它），
 * refresh() 在写入/删除后重建。
 *
 * 为什么同步：宿主组装系统提示词是同步的（section.text()），目录必须是
 * 已算好的字符串；重建走异步，写完立刻刷新，下一轮组装即生效。
 */
export interface AgentMemoryCatalog {
  /** 当前目录正文（同步，读缓存）。 */
  text: () => string
  /** 启动时同步装载一次：否则首轮组装会拿到空目录，agent 以为记忆库是空的。 */
  prime: () => void
  /** 重建目录（写入/删除/归档后调用）。 */
  refresh: () => Promise<void>
}

/**
 * 构造目录缓存。
 *
 * @param source - 提供「文件 → 条目行」的函数；由 store 实现（已含 index 加载与归档过滤）。
 */
export function createAgentMemoryCatalog(
  source: () => Promise<Array<{ name: string; lines: string[] }>>,
): AgentMemoryCatalog {
  let cached = ''

  return {
    text: () => cached,

    prime() {
      // 以文件系统为准（索引丢键时条目不该跟着消失）：扫描根级白名单 + projects/<id>/。
      const entries = listExistingFilesSync()
        .filter(isCatalogFile)
        .map((name) => ({ name, lines: entryLinesSync(name) }))
      cached = renderCatalog(entries.filter((entry) => entry.lines.length > 0))
    },

    async refresh() {
      try {
        cached = renderCatalog(await source())
      } catch {
        // 目录重建失败不覆盖旧值：宁可展示上一次的目录，也不要把「读不到」当空库。
      }
    },
  }
}
