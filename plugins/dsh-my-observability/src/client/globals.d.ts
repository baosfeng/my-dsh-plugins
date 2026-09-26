/**
 * dsh-my-observability — client 端全局类型声明。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks 与 dsh-shared
 * 共享图标）。跨 part 文件的函数/变量引用由 TypeScript script 模式自动处理
 * （module: commonjs + 无 import/export = 全局作用域）。
 *
 * 说明：片段文件共享同一个 factory 作用域（lib/client.src.js 模板 +
 * scripts/build.mjs 拼接），因此这里声明的是「拼接后可见」的符号；
 * strings / apiJson / ResourcePanel 等由 parts 自身声明，TS 跨文件解析。
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

// ── CommonJS（client.src.js 模板注入 exports/module；apply 挂载入口）─────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 宿主原生扩展点契约（issue #187 批 1）────────────────────────────────
// 侧边栏能力一律走宿主原生扩展点：原生能力经 Cordis 服务名暴露
// （slots / sidebarRightTabs），不 require 任何 @deepseek-ai/dsh-client-ui-*
// 包，也不消费第三方 dsh-better-sidebar 服务。

/** client 端 Context（cordis Context 最小契约 + 原生扩展点服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /**
   * 读取可选服务。设置页 slots 必须用 strict=false 读取：首屏时提供者 fiber
   * 可能尚未 active，strict 模式返回 undefined 会让页签静默消失。
   */
  get?<T = unknown>(name: string, strict?: boolean): T | undefined
  slots?: SlotsService
  sidebarRightTabs?: SidebarRightTabsService
}

/**
 * 设置页槽位服务（`settings.plugins.tab` 是 list 型槽位：descriptor 用
 * **id**（tab key，必须全局唯一，复用别人的 id 会顶掉对方那一格），
 * 而侧边栏的 keyed 席位用 key。
 */
interface SettingsSlotsService {
  inject(name: string, factory: () => unknown): () => void
  register(
    options: { name: string; id: string; order: number; label: () => string },
    component: (props: any) => unknown,
  ): unknown
}

/** keyed 席位注册表（@deepseek-ai/dsh-client-ui-slots 的服务面子集）。 */
interface SlotsService {
  inject(name: string, factory: () => () => void): () => void
  register(descriptor: { name: string; key: string }, component: (props: any) => unknown): () => void
}

/** 页签类型注册表（@deepseek-ai/dsh-client-ui-sidebar-right 的服务面子集）。 */
interface SidebarRightTabsService {
  register(definition: SidebarTabDefinition): () => void
}

/** 原生页签类型定义（右栏 register 的入参子集）。 */
interface SidebarTabDefinition {
  id: string
  kind: string
  title: (address: string) => string
  guide?: Array<{ order: number; title: () => string; description?: () => string }>
}

/** 原生 keyed 席位注入的运行面（tab body / title 共用）。 */
interface NativeTabProps {
  sessionId?: string
  useTabInfo?: () => { tab?: { id?: string; title?: string; visible?: boolean } }
}
