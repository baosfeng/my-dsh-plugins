/**
 * dsh-shared — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：本库是纯工具库，不依赖 DSH 运行时。
 * 仅声明 HTTP 相关的最小类型（node:http IncomingMessage/ServerResponse 的子集）。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */
export {};
