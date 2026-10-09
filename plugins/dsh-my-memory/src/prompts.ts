/**
 * dsh-my-memory — 全局提示词系统提示注入（issue #465）。
 *
 * **一个 section**（不是每条一个）：section 数不随条目增长，且 section 的
 * order **没有运行时修改接口**（换 order 只能 dispose 后全量重注册）——
 * 排序只能在 provider 内按条目 order 字段自排。
 *
 * 与记忆注入（prompt.ts）的关键差异（**注入隔离**）：
 *  - 记忆：评分（相关性 + 时效性 + 置信度）+ 降权 + 取 top-N + 逐条摘要截断；
 *  - 提示词：**全量、按序、不评分、不截断**——指令是「永不因评分丢失」的。
 *
 * 生效契约：provider 每次组装读**内存态** store（写操作先改内存再调度落盘），
 * 故新增/编辑/启停/排序在**下一轮组装即生效**，无需重注册、无需重启。
 * 本模块因此**不 import 任何存储/文件模块**（provider 内零磁盘 IO）——
 * 测试用源码断言钉死这条（test/prompts.mjs）。
 */
import type { PromptItem } from './prompt-types.js'
import { byPromptOrder, DEFAULT_MAX_PROMPT_ITEMS, DEFAULT_MAX_PROMPT_LENGTH } from './prompt-types.js'

/** section 名：**固定字面量**——它是重复注册的幂等键，也参与「同 order 按
 *  name code-unit 排序」，绝不能由用户输入或条目 id 派生。 */
export const PROMPT_SECTION_NAME = 'dsh-my-memory:prompts'

/** section 顺序：-85（记忆 -95 与中文指令 -90 之后、persona 0 之前）。 */
export const PROMPT_SECTION_ORDER = -85

/** 注入配置（安全阀；非法值回落默认）。
 *  键名与记忆注入的 maxItems / maxDescLength 同构（配置项 maxPromptItems /
 *  maxPromptLength 由 index.ts 组装时映射到这里），避免两套命名漂移。 */
export interface PromptsSectionConfig {
  /** 注入条数上限（对应配置 maxPromptItems，默认 20）。 */
  maxItems?: number
  /** 单条正文上限，字符（对应配置 maxPromptLength，默认 1000）。 */
  maxLength?: number
  /** warn 通道（截断/超限时告警，绝不静默）。 */
  logger?: { warn(message: string): void }
}

/** 提示词只读视图（store 的 list()；注入只依赖这一个方法）。 */
export interface PromptSource {
  list(): PromptItem[]
}

/** 按 order 升序排列（同 order 按 createdAt；导出供测试直接断言）。 */
export function sortPrompts(items: PromptItem[]): PromptItem[] {
  return items.slice().sort(byPromptOrder)
}

/** 截断超长正文（超出上限截断 + 省略号）；未超长原样返回。 */
export function truncatePromptText(text: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return ''
  const value = typeof text === 'string' ? text : ''
  return value.length <= maxLength ? value : value.slice(0, maxLength) + '…'
}

/** 注入条目选择：只保留 enabled===true 且正文非空者，按 order 升序取前 maxItems 条。 */
function pickPrompts(items: PromptItem[], maxItems: number): PromptItem[] {
  return sortPrompts(items)
    .filter((item) => item.enabled === true && typeof item.text === 'string' && item.text.trim() !== '')
    .slice(0, maxItems)
}

/** 渲染注入文本：总标题 + 每条 '### {title}' + 正文（空行分隔）。 */
export function renderPromptsSection(
  items: PromptItem[],
  { maxItems, maxLength }: { maxItems: number; maxLength: number },
): string {
  const picked = pickPrompts(items, maxItems)
  if (picked.length === 0) return ''
  const blocks = picked.map((item) => {
    const body = truncatePromptText(item.text, maxLength).trim()
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    return title === '' ? body : '### ' + title + '\n' + body
  })
  return [
    '## 全局提示词（用户在 dsh-my-memory 中设置）',
    '以下是用户显式启用、必须始终遵守的指令（全量按序注入，不评分不截断）：',
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

/** 单次求值的节流告警器：上限问题每进程只报一次，避免组装热路径刷屏。 */
function createWarnOnce(logger: PromptsSectionConfig['logger']) {
  const warned = new Set<string>()
  return (key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    try {
      logger?.warn(message)
    } catch {
      // 日志失败不得影响组装
    }
  }
}

/** 构建提示词 section 注册对象（text 为 provider，每次组装求值）。 */
export function createPromptsSection(
  source: PromptSource,
  config: PromptsSectionConfig | undefined,
): { name: string; order: number; text: () => string } {
  const maxItems =
    Number.isInteger(config?.maxItems) && config!.maxItems! > 0 ? config!.maxItems! : DEFAULT_MAX_PROMPT_ITEMS
  const maxLength =
    Number.isInteger(config?.maxLength) && config!.maxLength! > 0 ? config!.maxLength! : DEFAULT_MAX_PROMPT_LENGTH
  const warnOnce = createWarnOnce(config?.logger)
  return {
    name: PROMPT_SECTION_NAME,
    order: PROMPT_SECTION_ORDER,
    text: () => {
      // 只读内存态（list() 返回条目快照），不做任何磁盘 IO、不做评分。
      const items = source.list()
      const enabled = items.filter((item) => item.enabled === true && typeof item.text === 'string')
      if (enabled.length > maxItems) {
        warnOnce(
          'maxPromptItems',
          '[dsh-my-memory] 启用的提示词 ' + enabled.length + ' 条超过 maxPromptItems=' + maxItems + '，超出部分不注入',
        )
      }
      if (enabled.some((item) => item.text.length > maxLength)) {
        warnOnce('maxPromptLength', '[dsh-my-memory] 提示词正文超过 maxPromptLength=' + maxLength + '，注入时已截断')
      }
      return renderPromptsSection(items, { maxItems, maxLength })
    },
  }
}
