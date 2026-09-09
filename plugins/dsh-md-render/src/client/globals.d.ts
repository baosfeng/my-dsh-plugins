/**
 * dsh-md-render — client 端全局类型声明。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、
 * dsh-shared 图标等）。跨 part 文件的函数/变量引用由 TypeScript
 * script 模式自动处理（module: commonjs + 无 import/export = 全局作用域）。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── React 事件类型（copy.ts / settings.ts 使用 React.MouseEvent 等）─────
declare namespace React {
  interface MouseEvent<T = Element> {
    currentTarget: T
    target: EventTarget
  }
  interface ChangeEvent<T = Element> {
    currentTarget: T & { value: string; checked: boolean }
    target: EventTarget & { value: string; checked: boolean }
  }
}

// ── icon（dsh-shared/client-parts/icons.part.js）────────────────────────
declare const icon: Record<string, (...args: unknown[]) => unknown>

// ── CommonJS（apply.ts 使用 exports.inject / exports.apply）─────────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
