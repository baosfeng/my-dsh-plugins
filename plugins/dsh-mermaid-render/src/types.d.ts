/**
 * dsh-mermaid-render — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（logger）。
 * DSH 运行时模块（cordis）由宿主提供，本声明是插件与运行时之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 日志器。 */
  logger?: {
    info(msg: string): void
    warn(msg: string): void
    error(msg: string): void
  }
}
