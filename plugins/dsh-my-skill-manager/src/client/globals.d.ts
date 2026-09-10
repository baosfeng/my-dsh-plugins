/**
 * dsh-my-skill-manager — client 端全局类型声明 + 共享类型契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、官方 UI
 * 组件库、dsh-shared 图标集、CommonJS 变量）。跨 part 文件的函数/变量引用
 * 由 TypeScript script 模式自动处理（module: commonjs + 无 import/export =
 * 全局作用域，见 tsconfig.client.json）。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── 官方 UI 组件库（require('@deepseek-ai/dsh-client-ui-primitives')）─────
declare const ui: {
  Button: unknown
  Pill: unknown
  IconRefreshOutline14: unknown
}

// ── icon（dsh-shared/client-parts/icons.part.js，构建期拼接）─────────────
declare const icon: Record<string, (size?: number) => unknown>

// ── CommonJS（apply.ts 使用 exports.apply；factory 作用域提供）───────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 共享类型契约（client 端内部形状）────────────────────────────────────

/** 一条 skill 列表行（服务端 /list 的 skills 元素）。 */
interface SkillRowValue {
  name: string
  description?: string
  source?: string
  provider?: string
  disabled?: boolean
  /** 仅目录扫描补充的条目为 false（未被官方目录收录）。 */
  cataloged?: boolean
}

/** 一条使用统计条目。 */
interface UsageEntryValue {
  count: number
  lastUsedAt: number
  lastSource?: string
}

/** 使用统计映射：name → entry。 */
type UsageMap = Record<string, UsageEntryValue>

/** 一条扫描诊断条目。 */
interface DiagItem {
  name: string
  path: string
  reason: string
}

/** 诊断块数据。 */
interface ListDiagnostics {
  missing: DiagItem[]
}

/** 服务端 /list 原始 payload（字段防御性解析，见 api.ts normalizeList）。 */
interface ServerListPayload {
  skills?: unknown
  global?: { disabled?: unknown }
  project?: unknown
  cwd?: unknown
  projectRoot?: unknown
  diagnostics?: unknown
  usage?: unknown
}

/** client 端内部列表状态（normalizeList 的输出）。 */
interface ListValue {
  skills: SkillRowValue[]
  globalDisabled: string[]
  projectDisabled: string[]
  cwd: string
  projectRoot: string
  diagnostics: ListDiagnostics
  usage: UsageMap
}

/** client 端 Context（cordis 的最小契约）。 */
interface ClientContext {
  get(name: string, strict?: boolean): unknown
  effect(callback: () => void | (() => void), label?: string): void
}

/** 官方 slots 扩展点服务（settings.plugins.tab 注册）。 */
interface SlotsService {
  inject(name: string, register: () => unknown): () => void
  register(options: TabRegistration, component: unknown): unknown
}

/** 设置页 tab 注册选项。 */
interface TabRegistration {
  name: string
  id: string
  order: number
  label: () => string
}
