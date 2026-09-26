/**
 * dsh-my-plugin-manager — client 端全局类型声明。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、
 * dsh-shared 共享图标、client.src.js 模板注入的 MarkdownView）。
 * 跨 part 文件的函数/变量引用由 TypeScript script 模式自动处理
 * （module: commonjs + 无 import/export = 全局作用域）。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── React 事件类型（事件参数在 strict: false 下为隐式 any，此处仅备用）──
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

// ── icon / badgeIcon（dsh-shared/client-parts/icons.part.js）─────────────
declare const icon: Record<string, (size?: number) => unknown>
declare function badgeIcon(badge: string[], size?: number): unknown

// ── MarkdownView（client.src.js 模板：installMarkdownViewFallback，共享部件
//    dsh-shared/client-parts/markdown-fallback.part.js）────────────────────
//    渲染内核 = 宿主官方 baseline `@deepseek-ai/dsh-client-ui-primitives` 的
//    `MarkdownText`（平台 seed 模块，零安装零体积）；缺它时落到本插件 <pre>。
//    外部内核级（dsh-md-render）已被显式旁路：官方禁止特性插件通过
//    dsh.client.external / runtime-import 取另一个特性插件的值
//    （packages/client/AGENTS.md）。
declare const MarkdownView: (props: { text: string }) => unknown

// ── CommonJS（apply.ts 使用 exports.apply）──────────────────────────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
