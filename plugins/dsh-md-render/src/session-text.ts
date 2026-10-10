/**
 * dsh-md-render — 会话事件 → 消息 markdown 原文（host half，issue #466）。
 *
 * 只认官方事件契约（`docs/persistence-catalog.zh.md`）：
 *  - `user/message`     → `data` 就是 `UserMessage`（`content` 是 content block 数组）；
 *  - `assistant/message`→ `data.message` 才是消息。
 * 其余事件类型 / 结构不符一律忽略（返回 0），不抛错、不改事件流（只读观察）。
 *
 * 消息里**每一段文本**都要扫（不只看正文）：`reasoning` 思考块同样按 markdown 渲染，
 * 里面的围栏块与正文一样会走官方 `CodeBlock`。
 */
import type { LangIndex } from './lang-index.js'

/** content block 的文本（type 为 `text` / `reasoning` 且 `text` 是字符串）。 */
function textOfBlock(block: unknown): string {
  if (block === null || typeof block !== 'object') return ''
  const { type, text } = block as { type?: unknown; text?: unknown }
  if (type !== 'text' && type !== 'reasoning') return ''
  return typeof text === 'string' ? text : ''
}

/** 单条消息 → 逐 content block 记录围栏；返回登记的块数。 */
export function recordMessage(index: LangIndex, message: unknown): number {
  const content = (message as { content?: unknown } | null | undefined)?.content
  if (!Array.isArray(content)) return 0
  let fences = 0
  for (const block of content) {
    const text = textOfBlock(block)
    if (text !== '') fences += index.record(text)
  }
  return fences
}

/** session/event → 记录围栏（事件结构不符 → 0；任何异常都不冒泡到事件总线）。 */
export function recordSessionEvent(index: LangIndex, event: unknown): number {
  if (event === null || typeof event !== 'object') return 0
  const { type, data } = event as { type?: unknown; data?: unknown }
  try {
    if (type === 'user/message') return recordMessage(index, data)
    if (type === 'assistant/message') return recordMessage(index, (data as { message?: unknown } | null)?.message)
    return 0
  } catch {
    return 0
  }
}
