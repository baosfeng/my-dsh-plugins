/**
 * dsh-my-memory — memory text helpers (issue #105, TypeScript 源码)。
 *
 * 记忆内容精简的共享纯函数，服务手动保存引导、面板概要/详情两级展示与
 * 系统提示词注入的语义截断——同时为 #78（自动提取记忆）预留同一套
 * `maxEntryLength` 精简概念，后续自动提取可直接复用 `summarizeDesc`。
 *
 * 设计契约（存储兼容）：**完整 desc 永远保留在存储里**，本模块只负责
 * 「展示/注入用概要」的计算，绝不修改存储内容。
 *
 * 句子边界：中英文句号、感叹号、问号、分号、换行（含连续省略号），
 * 保证概要/注入截断尽量停在句子边界、不截断在句子中间。
 */

/** 建议单条记忆长度上限（字符）。超过即提示精简（issue #105，「>50 字提示」）。 */
export const DEFAULT_MAX_ENTRY_LENGTH = 50

/** 单条记忆注入系统提示词的长度上限（字符，issue #38 原有默认）。 */
export const DEFAULT_MAX_DESC_LENGTH = 200

/** 句子边界字符（中英文句末标点 + 分号 + 换行；省略号吸收入前一句）。 */
const SENTENCE_BOUNDARY = /[。！？!?；;\n….]+/u

/**
 * 取一段文本的首句（含边界标点；连续省略号/标点并入前一句）。
 * 无任何句子边界时返回整段文本。
 */
export function firstSentence(text: unknown): string {
  const value = String(text ?? '')
  const match = SENTENCE_BOUNDARY.exec(value)
  if (match === null) return value
  let end = match.index + 1
  // 吸收连续的省略号/标点（「……」「！！！」）——仍属于同一句
  while (end < value.length && SENTENCE_BOUNDARY.test(value[end])) end += 1
  return value.slice(0, end)
}

/**
 * 语义截断 desc 到长度上限（issue #105 概要优先）：
 *  - 单句且不超限 → 原样返回；
 *  - 多句 → 返回**完整首句**（概要），无论总长是否超限——解释性话语
 *    不稀释关键信息、不占用注入空间；
 *  - 首句本身超限（无句边界的超长单句）→ 退化为字符截断 + 「…」。
 *  任何分支都不截断在句子中间（句子边界完整保留）。
 */
export function summarizeDesc(desc: unknown, maxLength: number): string {
  const value = String(desc ?? '')
  const first = firstSentence(value)
  if (first === value) {
    if (value.length <= maxLength) return value
    return `${value.slice(0, maxLength)}…`
  }
  if (first.length <= maxLength) return first
  return `${first.slice(0, maxLength)}…`
}

/** 是否超过建议长度上限（用于保存/输入时的精简提示）。 */
export function isOverEntryLimit(desc: unknown, maxLength: number = DEFAULT_MAX_ENTRY_LENGTH): boolean {
  return String(desc ?? '').length > maxLength
}
