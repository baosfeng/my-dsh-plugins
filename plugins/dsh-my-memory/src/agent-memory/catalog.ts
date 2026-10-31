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
 *  - 70 行 / 6 KB，超出按「全局优先 + 项目轮转」丢弃，末尾给剩余条数；
 *  - 单行摘要 30 字，超长截断；
 *  - 内容恒定 → 前缀缓存可命中；写入/删除后重建一次，只失效一次。
 *
 * 为什么是「全局优先 + 项目轮转」而不是整体按文件名排：实测（67 条真实
 * 记忆）整体排序时 android-monitor 的 21 条一条都进不了目录——先到先得
 * 会让排在后面的项目整段消失。轮转让每个项目都有代表，全局偏好仍整体
 * 优先（它们是跨项目的，不该被任何单项目挤掉）。
 */
import { readFileSync, statSync } from 'node:fs'

import { absoluteFileOf, entryLinesOf, indexFile, listExistingFilesSync } from './paths.js'

/** 目录最多展示的行数（超出按「全局优先 + 项目轮转」丢弃，末尾给剩余条数）。 */
export const MAX_CATALOG_LINES = 70

/** 目录正文的字节上限（UTF-8，约 2k 汉字）。 */
const MAX_CATALOG_BYTES = 6144

/** 单行摘要的字符上限（超出截断，避免一条长记忆把整份目录吃掉）。 */
const CATALOG_LINE_CHARS = 30

/** 项目名在目录里的最大长度（超出截断，防止长仓库名吃掉预算）。 */
const MAX_LABEL_CHARS = 16

/** 目录里的一行（文件名 + 条目文本）。 */
interface CatalogEntry {
  name: string
  lines: string[]
}

/** 截断一条摘要（按字符，不切坏代理对）。 */
export function truncateEntry(line: string, limit: number = CATALOG_LINE_CHARS): string {
  const chars = [...line]
  return chars.length <= limit ? line : chars.slice(0, limit).join('') + '…'
}

/**
 * 目录里的展示优先级：全局偏好最先，其次反馈，最后项目层。
 *
 * 为什么必须排：目录是硬截断的，谁排后面谁就看不见。全局偏好跨项目生效，
 * 不该被任何一个项目的条目挤掉——所以它们整体优先占预算。
 */
function catalogRank(name: string): number {
  if (name === 'user.md') return 0
  if (name === 'feedback.md') return 1
  if (name.startsWith('projects/')) return 2
  return 3
}

/** 项目层文件名在目录里的单字标记。 */
function fileMark(file: string): string {
  if (file === 'decisions.md') return '决'
  if (file === 'pitfalls.md') return '坑'
  return '文'
}

/**
 * 一行的前缀：`u` / `f` / `<项目名>/决|坑`。
 *
 * 全路径前缀平均 29.3 字节、占整行 29%——压缩后（约 13 字节）同一份预算能
 * 多装约 16% 的条目。项目名缺失时退回 id 前 6 位（老数据没记录过名字）。
 */
export function catalogPrefix(name: string, projectNames: Record<string, string> = {}): string {
  if (name === 'user.md') return 'u'
  if (name === 'feedback.md') return 'f'
  const parts = name.split('/')
  if (parts.length === 3 && parts[0] === 'projects') {
    const id = parts[1] ?? ''
    const label = (projectNames[id] ?? id.slice(0, 6)).slice(0, MAX_LABEL_CHARS)
    return label + '/' + fileMark(parts[2] ?? '')
  }
  return name
}

/**
 * 展平条目并决定顺序：全局层整体优先，项目层按「每个文件轮流出一条」。
 *
 * 轮转而不是顺序：项目层条目数会随使用不断增长，顺序排列时后出现的项目
 * 永远排在截断线外（实测 21 条整段消失）。轮转让每个文件至少露头一次。
 */
function orderEntries(entries: CatalogEntry[]): Array<{ name: string; line: string }> {
  const sorted = [...entries].sort((a, b) => catalogRank(a.name) - catalogRank(b.name) || a.name.localeCompare(b.name))
  const globals = sorted.filter((entry) => catalogRank(entry.name) < 2)
  const projects = sorted.filter((entry) => catalogRank(entry.name) >= 2)
  const out: Array<{ name: string; line: string }> = []
  for (const entry of globals) for (const line of entry.lines) out.push({ name: entry.name, line })
  const depth = projects.reduce((max, entry) => Math.max(max, entry.lines.length), 0)
  for (let i = 0; i < depth; i += 1) {
    for (const entry of projects) {
      const line = entry.lines[i]
      if (line !== undefined) out.push({ name: entry.name, line })
    }
  }
  return out
}

/**
 * 把「文件 → 条目行」渲染成目录正文。
 *
 * @param entries - 每个文件的条目行（顺序无关，本函数按「全局优先 + 项目轮转」重排）。
 * @param projectNames - 项目 id → 可读名（缺失时退回 id 前 6 位）。
 * @returns 一行一条的目录；空库返回空串（调用方给「还没有记忆」的说明）。
 */
export function renderCatalog(entries: CatalogEntry[], projectNames: Record<string, string> = {}): string {
  const rows: string[] = []
  let bytes = 0
  let dropped = 0
  for (const { name, line } of orderEntries(entries)) {
    const row = catalogPrefix(name, projectNames) + ' · ' + truncateEntry(line)
    const size = Buffer.byteLength(row, 'utf8') + 1
    if (rows.length >= MAX_CATALOG_LINES || bytes + size > MAX_CATALOG_BYTES) {
      dropped += 1
      continue
    }
    rows.push(row)
    bytes += size
  }
  if (dropped > 0) rows.push('（另有 ' + dropped + ' 条未展开，用 agent_memory_list 看全量）')
  return rows.join('\n')
}

/** 目录排除 MEMORY.md（索引本身由系统生成，不该自我描述）。 */
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

  const rebuild = (entries: CatalogEntry[]): void => {
    cached = renderCatalog(
      entries.filter((entry) => entry.lines.length > 0),
      projectNamesSync(),
    )
  }

  /**
   * 以文件系统为准重建（prime 与自愈共用）：扫描根级白名单 + projects/<id>/。
   * 顺序是「先取指纹、再读正文」：中途有别的进程写入时指纹偏旧，下次校验会
   * 自然重扫一次——宁可多扫一次，不可把新内容永久挡在缓存外。
   */
  const reloadFromDisk = (): void => {
    snapshot = stampKey(readStamp())
    rebuild(
      listExistingFilesSync()
        .filter(isCatalogFile)
        .map((name) => ({ name, lines: entryLinesSync(name) })),
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
        const mark = stampKey(readStamp())
        rebuild(await source())
        snapshot = mark
        checkedAt = now()
      } catch {
        // 目录重建失败不覆盖旧值：宁可展示上一次的目录，也不要把「读不到」当空库。
      }
    },
  }
}
