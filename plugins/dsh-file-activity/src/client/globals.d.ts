/**
 * dsh-file-activity — client 端全局类型声明 + 共享服务契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、
 * dsh-shared 共享图标、client.src.js 模板常量）以及跨 part 共享的
 * **宿主原生侧边栏扩展点**契约（issue #187 批 2：不再消费 宿主侧边栏）。
 * 跨 part 文件的函数/变量引用由 TypeScript script 模式自动处理
 * （module: commonjs + 无 import/export = 全局作用域，见 tsconfig.client.json）。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void
declare function useMemo<T>(factory: () => T, deps: unknown[]): T
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
declare const TAB_KIND: string
declare const TAB_ID: string
declare const PREVIEW_ID: string
declare const AUTO_OPEN_KEY: string
declare const AUTO_OPEN_PREF_KEY: string
declare const POLL_MS: number

// ── CommonJS（apply.ts 使用 exports.inject / exports.apply / exports.__test）
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }
/** ModuleLoader require（factory 作用域注入；浏览器 bundle 里无 node 类型）。 */
declare function require(spec: string): any

// ── 宿主原生扩展点契约（client 端内部形状，全部经 Cordis 服务注入）──────

/** client 端 Context 最小契约（effect + 四个原生侧边栏服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /** 官方 slots 席位注册表（keyed / list / chain）。 */
  slots: SlotsService
  /** 原生右栏 tab 类型注册表（dsh-client-ui-sidebar-right）。 */
  sidebarRightTabs: SidebarRightTabRegistry
  /** 原生文档预览器注册表（dsh-client-ui-sidebar-documentpreview）。 */
  documentPreviews: DocumentPreviewRegistry
  /** 原生右栏导航控制器（openTab / openResource / isExpanded / active）。 */
  sidebarRight: SidebarRightController
}

/** slots 席位注册选项（settings / overlay / pane.tab 各席位共用）。 */
interface SlotRegisterOptions {
  name: string
  /** keyed 席位的 key（正文与标题席位 = tab 定义的 id）。 */
  key?: string
  /** list 席位的条目 id。 */
  id?: string
  order?: number
  label?: string | (() => string)
  locale?: string
}

/** slots 服务（宿主 dsh-client-ui-slots）。 */
interface SlotsService {
  inject(slot: string, factory: () => () => void): void
  register(options: SlotRegisterOptions, component: (props: never) => unknown): () => void
}

/** 右栏 tab 类型的静态面（原生注册契约）。 */
interface SidebarRightTabDefinition {
  /** 实现身份，全局唯一；也是正文与标题席位的 key。 */
  id: string
  /** 类型判别符（openTab 用具名 kind）。 */
  kind: string
  /** 资源地址 glob；页面类型省略。 */
  patterns?: readonly string[]
  priority?: 'extension' | 'builtin' | 'fallback'
  title: (address: string) => string
  guide?: readonly { order: number; title: () => string; description?: () => string }[]
}

/** 原生右栏 tab 类型注册表。 */
interface SidebarRightTabRegistry {
  register(definition: SidebarRightTabDefinition): () => void
  entries(): readonly SidebarRightTabDefinition[]
}

/** 原生文档预览器定义：只声明元数据，字节由宿主 document owner 读取。 */
interface DocumentPreviewDefinition {
  id: string
  /** 不带点号的后缀（tar.gz 这类复合后缀也接受）。 */
  extensions: readonly string[]
  priority?: 'builtin' | 'extension'
  title: () => string
  loading: 'text-pages' | 'bytes-complete'
}

/** 原生文档预览器注册表。 */
interface DocumentPreviewRegistry {
  register(definition: DocumentPreviewDefinition): () => void
  candidates(path: string): readonly DocumentPreviewDefinition[]
}

/** 原生右栏导航控制器（只声明本插件用到的面）。 */
interface SidebarRightController {
  openTab(kind: string, options?: { revealIfOpened?: boolean }): void
  openResource(address: string, options?: { kind?: string }): void
  isExpanded(): boolean
  active(): unknown
}
