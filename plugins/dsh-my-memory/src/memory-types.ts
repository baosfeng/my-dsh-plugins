/**
 * dsh-my-memory — 共享类型定义。
 *
 * 统一 store.ts 和 memory-scoring.ts 中的类型定义，
 * 避免类型不兼容的问题。
 */

/** 记忆分类类型。 */
export type Category = 'preference' | 'fact' | 'project' | 'stack' | 'workflow'

/** 记忆条目接口（统一定义）。 */
export interface MemoryItem {
  id: string
  desc: string
  createdAt: number
  updatedAt: number
  category: Category
  source: { sessionId: string; at: number }
  confidence: number
  relatedIds: string[]
  history: Array<{
    at: number
    action: string
    desc: string
  }>
  status: 'active' | 'conflict-pending'
}

/** 候选记忆条目接口（统一定义）。 */
export interface CandidateItem {
  id: string
  desc: string
  category: Category
  scope: 'global' | 'project'
  source: { sessionId: string; at: number }
  createdAt: number
  cwd?: string
}

/** 记忆存储结构。 */
export interface MemoryStore {
  items: MemoryItem[]
}

/** 候选存储结构。 */
export interface CandidateStore {
  items: CandidateItem[]
}

/** 存储实例接口。 */
export interface StoreInstance {
  state: MemoryStore
  load(): Promise<void>
  flush(): Promise<void>
  dispose(): void
  list(): MemoryItem[]
  add(item: string | Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>, now?: number): Promise<MemoryItem>
  mergeAdd(candidate: unknown, now?: number): Promise<{ item: unknown; outcome: string }>
  update(id: string, changes: string | Partial<MemoryItem>, now?: number): Promise<MemoryItem | null>
  remove(id: string): Promise<boolean>
}

/** 候选存储实例接口。 */
export interface CandidateStoreInstance {
  state: CandidateStore
  load(): Promise<void>
  flush(): Promise<void>
  dispose(): void
  list(): CandidateItem[]
  addRaw(item: unknown): Promise<CandidateItem | undefined>
  remove(id: string): Promise<boolean>
}

/** 注入评分结果接口。 */
export interface InjectionScore {
  id: string
  item: MemoryItem
  score: number
}

/** 注入选项接口。 */
export interface InjectionOptions {
  now?: number
  halfLifeMs?: number
  maxConfidence?: number
  maxItems?: number
  weights?: {
    relevance?: number
    recency?: number
    confidence?: number
  }
}

/** 注入上下文接口。 */
export interface InjectionContext {
  keywords: string[]
}
