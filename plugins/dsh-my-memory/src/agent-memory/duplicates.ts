/**
 * dsh-my-memory — 条目去重（写入护栏，issue #502 后续）。
 *
 * 为什么不让 agent 自己判断：提示词已经要求「先读再写、已有同主题就合并」，
 * 但它只覆盖「同一份文件」。实测 67 条真实记忆里仍出现两类重复——跨层
 * （全局 user.md 与本项目 pitfalls.md 写了同一句 Request Entity Too Large）
 * 和跨项目——都发生在「写项目层时不会去翻全局层 / 别的项目」的时刻。
 *
 * 这里只做**确定性**判断：字符级 trigram Jaccard。实测同库 67 条两两比对，
 * 除了那对几乎逐字的重复（0.652）之外最高分低于 0.3，所以 0.5 的阈值不误伤。
 *
 * 能抓：复制粘贴式的字面重复（同一句写进两个文件、跨项目照抄）。
 * 抓不到：同义改写（「verify 门禁并发假红」对「门禁九项并行时 vitest 超时」
 * 只有 0.13）。那类靠写作者先 agent_memory_list 看全量再合并——工具层不
 * 假装自己能做语义判断。
 */
import { entryLinesOf } from './paths.js'

/** 判定重复的相似度阈值（trigram Jaccard）。 */
export const DUPLICATE_THRESHOLD = 0.5

/** 比较前的归一化：去掉不影响语义的空白与标点。 */
const STRIP = /[\s，。；：、！？「」（）()[\]【】…—–·,.!?;:"“”\-]/g

/** 拒绝提示里每行最多展示多少字（错误信息自己不该变成一大段）。 */
const HINT_CHARS = 24

/**
 * 低于这个长度（归一化后）不做相似度判断，只认「完全相同」。
 *
 * 为什么：短句的 trigram 太少，0.5 的阈值会把「偏好 1」与「偏好 10」、「不要
 * 写日期」与「不要写数字」判成重复（实测 0.5）。短句要么字面完全相同（那是
 * 真重复），要么只是共用模板——不是重复。
 */
const MIN_COMPARE_CHARS = 12

/** 归一化：去空白/标点、转小写（中英混排也能比）。 */
function normalizeForCompare(text: string): string {
  return text.replace(STRIP, '').toLowerCase()
}

/** 字符 3-gram 集合（3 字以上才有区分度，短句退化为整串）。 */
function trigrams(text: string): Set<string> {
  const normalized = normalizeForCompare(text)
  const grams = new Set<string>()
  if (normalized === '') return grams
  if (normalized.length < 3) {
    grams.add(normalized)
    return grams
  }
  for (let i = 0; i + 3 <= normalized.length; i += 1) grams.add(normalized.slice(i, i + 3))
  return grams
}

/**
 * 短句的相似度：只认完全相同，否则 0。
 *
 * 短句 trigram 太少，0.5 的阈值会把「偏好 1」与「偏好 10」判成重复；
 * 这里返回 null 表示「不是短句，走正常 Jaccard」。
 */
function shortTextScore(leftRaw: string, rightRaw: string): number | null {
  if (leftRaw.length >= MIN_COMPARE_CHARS && rightRaw.length >= MIN_COMPARE_CHARS) return null
  return leftRaw === rightRaw ? 1 : 0
}

/** 两条文本的 Jaccard 相似度（0–1）。 */
export function similarity(a: string, b: string): number {
  const leftRaw = normalizeForCompare(a)
  const rightRaw = normalizeForCompare(b)
  if (leftRaw === '' || rightRaw === '') return 0
  const short = shortTextScore(leftRaw, rightRaw)
  if (short !== null) return short
  const left = trigrams(leftRaw)
  const right = trigrams(rightRaw)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/** 一条已有条目（文件 + 正文）。 */
interface EntryRef {
  name: string
  line: string
}

/** 命中的重复条目（按分数取最高）。 */
interface DuplicateHit extends EntryRef {
  score: number
}

/** 在池子里找与 target 最相似且过阈值的条目；没有则 null。 */
function findDuplicate(target: string, pool: EntryRef[]): DuplicateHit | null {
  let best: DuplicateHit | null = null
  for (const item of pool) {
    const score = similarity(target, item.line)
    if (score < DUPLICATE_THRESHOLD) continue
    if (best === null || score > best.score) best = { name: item.name, line: item.line, score }
  }
  return best
}

/** 同一份内容内部的两条重复。 */
function findInternalDuplicate(lines: string[]): { a: string; b: string; score: number } | null {
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const score = similarity(lines[i] ?? '', lines[j] ?? '')
      if (score >= DUPLICATE_THRESHOLD) return { a: lines[i] ?? '', b: lines[j] ?? '', score }
    }
  }
  return null
}

/** 提示里展示的一条条目（截断）。 */
function hint(line: string): string {
  const chars = [...line]
  return chars.length <= HINT_CHARS ? line : chars.slice(0, HINT_CHARS).join('') + '…'
}

/**
 * 写入前的重复检查：本次要写的条目不能彼此重复，也不能与**其他文件**重复。
 *
 * 比对基准是「其他文件」而不是整库：同一文件里被这次整份写入替换掉的旧条目
 * 不在比对范围，否则「把一条改个措辞」会被自己的旧版本锁死。
 *
 * @returns null 表示放行；否则返回给 agent 的可操作提示。
 */
export function duplicateError(input: {
  name: string
  content: string
  entries: Array<{ name: string; lines: string[] }>
}): string | null {
  const incoming = entryLinesOf(input.content)
  if (incoming.length === 0) return null
  const internal = findInternalDuplicate(incoming)
  if (internal !== null) {
    return `本次写入里「${hint(internal.a)}」与「${hint(internal.b)}」重复，先合并或加限定语区分再写`
  }
  const pool = input.entries
    .filter((entry) => entry.name !== input.name)
    .flatMap((entry) => entry.lines.map((line) => ({ name: entry.name, line })))
  for (const line of incoming) {
    const hit = findDuplicate(line, pool)
    if (hit !== null) {
      return `「${hint(line)}」与 ${hit.name} 的「${hint(hit.line)}」重复（相似度 ${hit.score.toFixed(2)}），先合并再写；确属不同事实就改写措辞区分`
    }
  }
  return null
}
