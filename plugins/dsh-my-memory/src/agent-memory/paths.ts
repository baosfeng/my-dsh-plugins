/**
 * dsh-my-memory — agent 记忆的路径与常量（issue #502）。
 *
 * 「agent 记忆」是**第四套独立体系**：agent 自主维护的跨会话记忆，与全局
 * 记忆 / 项目记忆 / 全局提示词完全隔离（独立目录、独立工具、独立元数据）。
 *
 * 设计契约（issue #502 验收标准）：
 *  - **零常驻注入**：不注册 systemPrompt.section，正文只在 agent 主动
 *    `agent_memory_read` 时进入上下文，不命中则零成本；
 *  - **文件是存储、不是接口**：正文是纯 markdown，元数据（创建/最后读取/
 *    读取次数）单独存 index.json，**agent 永不可见、不可写**——时间戳与
 *    热度可被篡改就等于遗忘机制失效，故必须封装；
 *  - **正文不带日期**：时间戳全在 index.json，正文一个多余字符都没有。
 */
import { join } from 'node:path'
import { dshHome } from '../store.js'

/** 单文件字节上限（4 KB）：约 1k token，超限 memory_write 报错要求先整理。 */
export const MAX_FILE_BYTES = 4096

/** 单文件条目上限（60 条）。 */
export const MAX_ENTRIES = 60

/** 单条正文长度上限（字符，一句话原则的硬兜底）。 */
export const MAX_ENTRY_CHARS = 100

/** 冷记忆归档阈值（毫秒，默认 180 天未读）。 */
export const DEFAULT_ARCHIVE_MS = 180 * 24 * 60 * 60 * 1000

/** agent 记忆的根目录：$DSH_HOME/agent-memory。 */
function agentMemoryDir(): string {
  return join(dshHome(), 'agent-memory')
}

/** 元数据文件（agent 不可见、不可写）。 */
export function indexFile(): string {
  return join(agentMemoryDir(), 'index.json')
}

/** 归档目录（不进索引、不列出）。 */
export function archiveDir(): string {
  return join(agentMemoryDir(), 'archive')
}

/**
 * 允许的记忆文件名白名单（相对 agent-memory 根，正斜杠分隔）。
 *
 * 白名单而非黑名单：agent 只能读写这几个位置，路径逃逸（`../`、符号链接、
 * 绝对路径）在结构上就不可能发生，无需再做 realpath 校验。
 *
 * `archive/` 不在白名单里：归档区由系统独占搬运，agent 既不该写进去，也
 * 不该读出来（「不常用就不进上下文」正是归档的意义）。
 */
const ALLOWED_FILES: readonly string[] = Object.freeze(['MEMORY.md', 'user.md', 'feedback.md'])

/** 是否当前项目作用域的路径（projects/<id>/...）。 */
const PROJECT_PREFIX = 'projects/'

/** 项目作用域内的文件名（projects/<id>/ 之下）。 */
const PROJECT_FILES: readonly string[] = Object.freeze(['MEMORY.md', 'decisions.md', 'pitfalls.md'])

/** 规范化分隔符并去掉开头的 ./（纯字符串处理，不做合法性判断）。 */
function cleanSpelling(name: string): string {
  return name.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 基础合法性：非空、非绝对路径、无 NUL、无 . / .. 段。 */
function hasSafeSegments(cleaned: string): boolean {
  if (cleaned === '' || cleaned.startsWith('/') || cleaned.includes('\0')) return false
  return !cleaned.split('/').some((part) => part === '' || part === '.' || part === '..')
}

/** 是否属于项目作用域 projects/<id>/<白名单文件名>（id 只允许字母数字与连字符）。 */
function isProjectFile(parts: string[]): boolean {
  if (parts.length !== 3) return false
  if (parts[0] !== PROJECT_PREFIX.slice(0, -1)) return false
  if (!/^[0-9a-zA-Z-]+$/.test(parts[1] ?? '')) return false
  return PROJECT_FILES.includes(parts[2] ?? '')
}

/**
 * 规范化一个 agent 传入的文件名并做白名单校验。
 *
 * 白名单而非黑名单：agent 只能读写这几个位置，路径逃逸（`../`、符号链接、
 * 绝对路径）在结构上就不可能发生，无需再做 realpath 校验。
 *
 * @param name - agent 传入的相对路径（正/反斜杠均可）。
 * @returns 规范化后的相对路径；非法时返回 null（调用方拒绝）。
 */
export function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const cleaned = cleanSpelling(name)
  if (!hasSafeSegments(cleaned)) return null
  if (ALLOWED_FILES.includes(cleaned)) return cleaned
  return isProjectFile(cleaned.split('/')) ? cleaned : null
}

/** 拼出绝对路径（调用前必须已经过 normalizeName 校验）。 */
export function absoluteFileOf(name: string): string {
  return join(agentMemoryDir(), ...name.split('/'))
}

/**
 * 归档后的物理路径（`archive/<name>`）。
 *
 * 只给**面板**读正文与恢复用：agent 通道仍只认 `absoluteFileOf`，所以归档
 * 记忆对 agent 不可读——「不常用就不进上下文」的语义不被恢复能力破坏。
 */
export function archivedAbsoluteOf(name: string): string {
  return join(archiveDir(), ...name.split('/'))
}
