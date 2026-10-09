/**
 * dsh-my-memory — 全局提示词（global prompt，issue #465）类型定义。
 *
 * 与记忆条目**结构上互不兼容**（不共享任何字段）：提示词只有
 * title / text / enabled / order / builtin + 时间戳，没有分类、置信度、
 * 来源、演进历史、状态等记忆语义字段——两个 store 之间无法互相读取，
 * 这是「存储隔离」的结构性防线。
 */

/** 内置种子标识（迁移来源；用户可停用/删除，删除后不复活）。 */
export type PromptBuiltin = 'builtin:think-zh'

/** 一条全局提示词。 */
export interface PromptItem {
  id: string
  /** 列表显示名（注入标题）。 */
  title: string
  /** 注入正文（完整注入，不评分不截断——只受 maxPromptLength 安全阀限制）。 */
  text: string
  /** 是否注入；**非 true 一律不注入**（缺字段/脏数据按不注入处理）。 */
  enabled: boolean
  /** 注入排序键（升序；同 order 按 createdAt）。 */
  order: number
  /** 内置种子标识（仅种子条目有）。 */
  builtin?: PromptBuiltin
  createdAt: number
  updatedAt: number
}

/** 提示词文件结构。 */
export interface PromptStore {
  items: PromptItem[]
}

/** 提示词存储实例（独立 store，不含任何记忆能力：无评分、无检索、无候选）。 */
export interface PromptStoreInstance {
  state: PromptStore
  load(): Promise<void>
  flush(): Promise<void>
  dispose(): void
  /** 按 order 升序（同 order 按 createdAt）返回全部条目。 */
  list(): PromptItem[]
  add(input: { title?: string; text: string; order?: number }, now?: number): Promise<PromptItem | null>
  update(
    id: string,
    changes: { title?: string; text?: string; enabled?: boolean; order?: number },
    now?: number,
  ): Promise<PromptItem | null>
  toggle(id: string, enabled: boolean, now?: number): Promise<PromptItem | null>
  reorder(id: string, direction: 'up' | 'down', now?: number): Promise<boolean>
  remove(id: string): Promise<boolean>
}

/** 注入条数上限的默认值（安全阀；store 与注入模块共用同一常量，避免两处漂移）。 */
export const DEFAULT_MAX_PROMPT_ITEMS = 20

/** 单条正文上限的默认值（字符，超出截断 + warn）。 */
export const DEFAULT_MAX_PROMPT_LENGTH = 1000

/** 提示词排序：order 升序，同 order 按 createdAt 升序（再按 id 保证稳定）。
 *  放在类型模块里，使注入模块不必依赖存储模块（provider 内零磁盘 IO 的结构保证）。 */
export function byPromptOrder(a: PromptItem, b: PromptItem): number {
  if (a.order !== b.order) return a.order - b.order
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
