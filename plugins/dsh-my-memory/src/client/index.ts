/**
 * dsh-my-memory — client 端入口（TypeScript 源码，单文件包装器）。
 *
 * 构建流程：
 * 1. `tsc -p tsconfig.client.json` 编译 src/client/parts/*.ts → lib/.client-build/parts/*.js
 * 2. `node scripts/build.mjs` 将编译后的 parts 拼接到 lib/client.src.js 模板
 * 3. 输出 lib/client.js（DSH 实际服务的 __ModuleLoader__ bundle）
 *
 * 约束：client 端 TS 源码为多文件（parts 拆分），但编译后拼接为单文件。
 * 每个 part 文件编译为独立的 CommonJS 模块，然后注入到 factory 作用域中。
 */

// ── DSH 运行时类型（client 端最小契约，手写声明）──────────────────────

/** client 端 Context（cordis Context 最小契约 + slots 服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  slots?: SlotsService
}

/** slots 服务（官方扩展点）。 */
interface SlotsService {
  register(options: {
    id: string
    type: string
    order?: number
    component: (props: { scope: { sessionId: string }; visible: boolean }) => unknown
  }): () => void
}

// ── 插件体 ─────────────────────────────────────────────────────────────

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const service = ctx.slots
  if (service === undefined) return
  ctx.effect(
    () =>
      service.register({
        id: 'dsh-my-memory:settings',
        type: 'settings',
        order: 100,
        component: (props) => {
          // 这个组件会在构建时被替换为实际的 parts 编译产物
          // 实际实现在 lib/parts/apply.part.ts 中
          return null
        },
      }),
    'dsh-my-memory: settings tab registration',
  )
}

// ── 类型导出（供 parts 使用）───────────────────────────────────────────

/** 记忆条目接口。 */
export interface MemoryItem {
  id: string
  desc: string
  createdAt: number
  updatedAt: number
  category?: string
  source?: string
  confidence?: number
  relatedIds?: string[]
  history?: Array<{
    desc: string
    updatedAt: number
    category?: string
  }>
  status?: 'active' | 'archived' | 'pending'
}

/** 候选记忆条目接口。 */
export interface CandidateItem {
  id: string
  desc: string
  source: string
  sessionId: string
  createdAt: string
  status: 'pending' | 'confirmed' | 'dismissed'
}

/** 记忆作用域类型。 */
export type MemoryScope = 'global' | 'project'

/** API 响应接口。 */
export interface ApiResponse<T> {
  ok: boolean
  value?: T
  error?: string
}

/** 记忆列表响应。 */
export interface MemoryListResponse {
  scope: MemoryScope
  cwd: string
  projectRoot: string
  items: MemoryItem[]
}

/** 候选列表响应。 */
export interface CandidateListResponse {
  items: CandidateItem[]
}

/** 配置响应。 */
export interface ConfigResponse {
  maxEntryLength: number
  maxDescLength?: number
}