/**
 * dsh-my-memory — system-prompt injection (TypeScript 源码)。
 *
 * Registers one section (`dsh-my-memory`, order -95 — before the deployment
 * persona at 0 and before dsh-think-zh's -90) whose text is a provider
 * evaluated at every prompt assembly: it reads the GLOBAL memory cache and
 * renders the strongest `maxItems` entries picked by the issue #78 smart
 * scoring (relevance to the current session + recency + confidence — NOT a
 * plain top-N by newest), each summarized to `maxDescLength` characters —
 * the summary prefers the full first sentence and never cuts mid-sentence
 * (issue #105). An empty memory renders an empty section, which the prompt
 * renderer drops — so the injection costs nothing until the user actually
 * stores memories. Because the text is re-evaluated per assembly, a memory
 * saved mid-session is visible to the agent on the very next turn without a
 * restart.
 */
import { DEFAULT_MAX_DESC_LENGTH, summarizeDesc } from './memory-text.js'
import { decayConfidence, pickForInjection } from './memory-scoring.js'
import type { MemoryItem, StoreInstance } from './memory-types.js'

/** Default cap on how many global memories are injected. */
const DEFAULT_MAX_ITEMS = 5

/** 插件配置接口（prompt 相关）。 */
export interface PromptConfig {
  /** 最大注入条目数（默认 5）。 */
  maxItems?: number
  /** 单条描述最大长度（默认 200）。 */
  maxDescLength?: number
  /** 降权阈值（毫秒，默认 90 天）。 */
  decayMs?: number
}

/**
 * Truncate one desc to the length cap, preferring the full first sentence
 * (semantic truncation — never cuts mid-sentence when a sentence boundary
 * fits; issue #105). Kept as the historical export name for callers/tests;
 * the implementation now lives in memory-text.js.
 */
export function truncateDesc(desc: unknown, maxLength: number): string {
  return summarizeDesc(desc, maxLength)
}

/** Render the injected section text for a picked list of global memories. */
export function renderMemorySection(
  items: MemoryItem[],
  { maxItems, maxDescLength }: { maxItems: number; maxDescLength: number },
): string {
  const picked = items.slice(0, maxItems)
  if (picked.length === 0) return ''
  const lines = picked.map((item) => `- ${truncateDesc(item.desc, maxDescLength)}`)
  return `## 用户记忆（全局）
以下是你需要始终携带的用户长期偏好与关键约定（来自 dsh-my-memory 插件）：
${lines.join('\n')}`
}

/** The current-session context handed to the smart picker (keywords only). */
function contextOf(): { keywords: string[] } {
  // 未来可扩展：从当前会话标题/首条消息提取关键词（#78 相关性维度）。
  // 现为空的上下文 → 相关性权重不生效，score 退化为 时效性 + 置信度。
  return { keywords: [] }
}

/** Build the system-prompt section registration for a global store. */
export function createMemorySection(
  globalStore: StoreInstance,
  config: PromptConfig | undefined,
): {
  name: string
  order: number
  text: () => string
} {
  const maxItems = Number.isInteger(config?.maxItems) && config!.maxItems! > 0 ? config!.maxItems! : DEFAULT_MAX_ITEMS
  const maxDescLength =
    Number.isInteger(config?.maxDescLength) && config!.maxDescLength! > 0
      ? config!.maxDescLength!
      : DEFAULT_MAX_DESC_LENGTH
  const decayMs = Number.isInteger(config?.decayMs) && config!.decayMs! > 0 ? config!.decayMs! : undefined
  return {
    name: 'dsh-my-memory',
    order: -95,
    text: () => {
      // issue #78 智能注入：先做长期未用降权（时效性），再按 相关性 +
      // 时效性 + 置信度 评分选 top-N（替代简单按 updatedAt 取最新 N 条）。
      const decayed = decayConfidence(globalStore.list(), Date.now(), decayMs)
      const picked = pickForInjection(decayed.items, contextOf(), { maxItems }).picked
      return renderMemorySection(picked, { maxItems, maxDescLength })
    },
  }
}
