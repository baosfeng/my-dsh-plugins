/**
 * dsh-mermaid-render — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（systemPrompt.section / logger）。
 * DSH 运行时模块（cordis / systemPrompt）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** systemPrompt 服务（inject 声明后可用）。 */
  systemPrompt?: SystemPromptService
  /** 日志器。 */
  logger?: {
    info(msg: string): void
    warn(msg: string): void
    error(msg: string): void
  }
}

/** systemPrompt 服务（system-prompt section 注册）。 */
export interface SystemPromptService {
  /** 注册一条有序 section；同名重复注册会抛错。返回 disposer。 */
  section(options: { name: string; order: number; text: string | (() => string) }): () => void
}
