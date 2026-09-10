/**
 * dsh-my-memory — client 端全局类型声明。
 *
 * 声明 __ModuleLoader__ factory 作用域里注入的共享符号（React 运行时、
 * dsh-shared 图标集、官方 UI 组件库、CommonJS 包装变量）。client parts
 * 是 script 模式片段（无 import/export），编译后按声明顺序拼接进
 * lib/client.src.js 模板，跨文件引用靠拼接作用域解析——这些符号在
 * TypeScript 里看不到，必须在此声明。
 */

// ── React（client.src.js 里 require('react') 解构得到）───────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): ReactNode
declare function useState<S>(initial: S | (() => S)): [S, React.Dispatch<React.SetStateAction<S>>]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

/** React 节点类型（client 端只做透传，不引入 react 类型包）。 */
declare type ReactNode = unknown

/** React 类型命名空间（仅用到状态设置器相关类型）。 */
declare namespace React {
  type SetStateAction<S> = S | ((prev: S) => S)
  type Dispatch<A> = (value: A) => void
}

// ── icon（dsh-shared/client-parts/icons.part.js）────────────────────────
declare const icon: Record<string, (size?: number) => ReactNode>

// ── ui（client.src.js 里 require('@deepseek-ai/dsh-client-ui-primitives')）──
declare const ui: Record<string, unknown>

// ── CommonJS（factory 作用域的 module/exports/require）───────────────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
declare function require(id: string): unknown
