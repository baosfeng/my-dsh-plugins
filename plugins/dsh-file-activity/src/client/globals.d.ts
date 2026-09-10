/**
 * dsh-file-activity — client 端全局类型声明 + 共享服务契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、
 * dsh-shared 共享图标、client.src.js 模板常量）以及跨 part 共享的
 * dsh-better-sidebar 服务契约。跨 part 文件的函数/变量引用由
 * TypeScript script 模式自动处理（module: commonjs + 无 import/export =
 * 全局作用域，见 tsconfig.client.json）。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void
declare function useMemo<T>(factory: () => T, deps?: unknown[]): T
declare function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => unknown,
  getSnapshot: () => T,
): T

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

// ── icon / fileIconByExt（dsh-shared/client-parts/icons.part.js，构建期拼接）
declare const icon: Record<string, (size?: number) => unknown>
declare const fileIconByExt: (ext: unknown, size?: number) => unknown

// ── 模板常量（client.src.js 的 factory 作用域）───────────────────────────
declare const TAB_ID: string
declare const AUTO_OPEN_KEY: string
declare const POLL_MS: number

// ── CommonJS（apply.ts 使用 exports.inject / exports.apply / exports.__test）
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 共享服务契约（client 端内部形状）────────────────────────────────────

/** client 端 Context 的最小契约（effect + betterSidebar 服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /** dsh-better-sidebar 服务；宿主未安装时为 undefined（apply 里显式提示）。 */
  betterSidebar?: SidebarService
}

/** dsh-better-sidebar 服务（client 端用到的扩展点）。 */
interface SidebarService {
  registerTab(options: TabRegistration): () => void
  openTab(options: { type: string; title: string; path: string }): unknown
  matchFileViewer(path: string): FileViewer | undefined
  getSnapshot?(): SidebarSnapshot | undefined
  subscribeState?(listener: () => void): () => void
}

/** 页签注册选项（registerTab）。 */
interface TabRegistration {
  id: string
  title: () => string
  icon: (size?: number) => unknown
  order: number
  single: boolean
  settings: { pluginToggles: PluginToggle[] }
  /** 页签组件：sidebar 传入 ctx/store/scope/visible，本插件再注入 dataStore。 */
  component: (props: Record<string, unknown>) => unknown
}

/** 插件设置开关（settings.pluginToggles 元素）。 */
interface PluginToggle {
  key: string
  title: () => string
  desc: () => string
  type: string
}

/** 侧边栏状态快照（仅取自动打开需要的字段）。 */
interface SidebarSnapshot {
  sessionId?: string
  state?: SidebarState
  prefs?: { pluginSettings?: Record<string, PluginSettings | undefined> }
}

/** 侧边栏布局（splits / bottomSplits 各自是一棵布局树）。 */
interface SidebarState {
  splits?: LayoutNode
  bottomSplits?: LayoutNode
}

/** 布局节点（leaf 带 tabs，split 带 children）。 */
interface LayoutNode {
  kind?: string
  tabs?: { type: string }[]
  children?: LayoutNode[]
}

/** 单个插件页签的设置（autoOpen 为自动打开开关，false 表示用户已关闭）。 */
interface PluginSettings {
  autoOpen?: boolean
}

/** 侧边栏文件查看器（matchFileViewer 的返回值）。 */
interface FileViewer {
  id: string
  /** 字节获取策略：fsRead / mediaUrl / custom / binary-download…。 */
  fetchStrategy?: string
  /** 查看器组件（取到数据后挂载）。 */
  component?: unknown
  /** custom 策略的自取数据钩子。 */
  load?: (path: string, scope: unknown) => unknown
}
