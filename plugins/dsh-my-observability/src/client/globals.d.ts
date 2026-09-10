/**
 * dsh-my-observability — client 端全局类型声明。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks 与 dsh-shared
 * 共享图标）。跨 part 文件的函数/变量引用由 TypeScript script 模式自动处理
 * （module: commonjs + 无 import/export = 全局作用域）。
 *
 * 说明：片段文件共享同一个 factory 作用域（lib/client.src.js 模板 +
 * scripts/build.mjs 拼接），因此这里声明的是「拼接后可见」的符号；
 * strings / apiJson / ReplayPanel 等由 parts 自身声明，TS 跨文件解析。
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

// ── icon（dsh-shared/client-parts/icons.part.js）─────────────────────────
declare const icon: Record<string, (size?: number) => unknown>

// ── audit-view 片段（lib/audit-view.js：server 端 tsc 产物，scripts/build.mjs
//    剥离 `export` 前缀后拼进 factory 作用域，server/client 共用模块）──────
declare function applyAuditFilter(events: any, criteria?: any): any[]
declare function computeToolStats(events: any, topN?: number): any[]
declare function highlightSegments(text: any, keyword: any): any[]
declare function auditToJson(events: any, space?: number): string
declare function auditToCsv(events: any, labels?: any): string

// ── CommonJS（client.src.js 模板注入 exports/module；apply 挂载入口）─────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
