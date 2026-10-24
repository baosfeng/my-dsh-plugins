/**
 * dsh-my-skill-manager — client 端全局类型声明 + 共享类型契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、dsh-shared
 * 图标集、CommonJS 变量）。跨 part 文件的函数/变量引用由 TypeScript script
 * 模式自动处理（module: commonjs + 无 import/export = 全局作用域，见
 * tsconfig.client.json）。
 *
 * 数据契约以 docs/原型重构/impl-contract-skill-manager.md 为准；服务端
 * /my-skill-manager/api/list|detail|rescan|session|config 的取值见 api.ts。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── icon（dsh-shared/client-parts/icons.part.js，构建期拼接）─────────────
declare const icon: Record<string, (size?: number) => unknown>
/** dsh-shared 图标集的 SVG 外壳（glyphs.ts 复用它补充本插件专用图标）。 */
declare function iconSvg(children: unknown[], size: number): unknown

// ── CommonJS（apply.ts 使用 exports.apply；factory 作用域提供）───────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 服务端原始 payload（字段一律防御性解析，见 api.ts normalizeList）──────

/** /list 里的一条 skill（服务端字段名与形状，未知字段按 unknown 收）。 */
interface ServerSkillRow {
  name?: unknown
  description?: unknown
  source?: unknown
  provider?: unknown
  path?: unknown
  cataloged?: unknown
  invocation?: unknown
  usage?: unknown
}

/** /list 里 diagnostics.missing 的一条。 */
interface ServerMissingRow {
  name?: unknown
  path?: unknown
  reason?: unknown
}

/** /list 原始 payload（契约形状；globalDisabled/projectDisabled 为名字数组）。 */
interface ServerListPayload {
  cwd?: unknown
  projectRoot?: unknown
  scannedAt?: unknown
  skills?: unknown
  globalDisabled?: unknown
  projectDisabled?: unknown
  diagnostics?: unknown
  usage?: unknown
}

/** /detail 原始 value。 */
interface ServerDetailPayload {
  name?: unknown
  path?: unknown
  content?: unknown
  truncated?: unknown
}

// ── client 端归一化后的模型（model.ts 产出，view/components 消费）────────

/** 视图分组：项目 / 用户 / 内置 / 其他 / 扫描异常。 */
type SourceGroup = 'project' | 'user' | 'bundled' | 'other' | 'anomaly'

/** 使用统计（count 次，lastUsedAt epoch ms，lastSource 调用方）。 */
interface UsageValue {
  count: number
  lastUsedAt: number
  lastSource: 'model' | 'user'
}

/** 调用能力（模型可调用 / 用户可调用）。 */
interface InvocationValue {
  modelInvocable: boolean
  userInvocable: boolean
}

/** /list 归一化结果。 */
interface ListValue {
  cwd: string
  projectRoot: string
  scannedAt: number
  skills: ServerSkillRow[]
  globalDisabled: string[]
  projectDisabled: string[]
  missing: ServerMissingRow[]
  usage: Record<string, UsageValue>
}

/** 列表里的一行（skills[] + diagnostics.missing 的统一视图模型）。 */
interface SkillItem {
  /** 稳定 key：'skill:<name>' 或 'missing:<path>'。 */
  key: string
  name: string
  description: string
  source: string
  group: SourceGroup
  provider: string
  path: string
  /** 宿主 catalog 是否收录（false = 仅目录扫描发现，仍是可管理的正常 skill）。 */
  cataloged: boolean
  /** 来自 diagnostics.missing（连扫描都没解析出来的条目，不进 skills[]）。 */
  missing: boolean
  /** 扫描异常原因码（仅 missing 行有值；其余为空串）。 */
  reason: string
  invocation: InvocationValue | null
  usage: UsageValue | null
  /** 全局作用域是否启用（由 globalDisabled 推导）。 */
  globalOn: boolean
  /** 本项目作用域是否启用（由 projectDisabled 推导）。 */
  projectOn: boolean
}

/** 排序键。 */
type SortKey = 'name' | 'usage' | 'recent' | 'source'

/** 视图模式。 */
type ViewMode = 'cards' | 'table'

/** 状态筛选。 */
type StatusFilter = 'all' | 'enabled' | 'disabled' | 'anomaly'

/** 来源筛选（anomaly 对应 diagnostics.missing 的「扫描异常」组）。 */
type SourceFilter = 'all' | SourceGroup

/** 概览数字的筛选键。 */
type StatKey = 'all' | 'enabled' | 'disabled' | 'anomaly'

/** 列表派生计数。 */
interface CountsValue {
  all: number
  enabled: number
  disabled: number
  anomaly: number
  project: number
  user: number
  bundled: number
  other: number
  unused: number
}

/** /detail 归一化结果。 */
interface DetailValue {
  name: string
  path: string
  content: string
  truncated: boolean
}

/** 筛选状态（搜索框 + 来源 + 状态 + 只看未使用）。 */
interface FilterState {
  query: string
  source: string
  status: string
  unusedOnly: boolean
}

/** SKILL.md 详情加载状态。 */
interface DetailEntry {
  status: 'loading' | 'ready' | 'error'
  content: string
  truncated: boolean
  message: string
}

/** 单行写失败的内联错误（含重试所需的目标禁用名单）。 */
interface InlineErrorValue {
  key: string
  scope: 'global' | 'project'
  message: string
  disabled: string[]
}

/** toast 内容。 */
interface ToastValue {
  id: number
  message: string
  kind: 'default' | 'success' | 'error'
}

/** 卡片/表格共用的交互回调（由 view.ts 注入）。 */
interface SkillViewHandlers {
  onToggleDetail(item: SkillItem): void
  onToggleScope(item: SkillItem, scope: 'global' | 'project'): void
  onToggleSelect(key: string): void
  onCopyPath(item: SkillItem): void
  onCopyMd(item: SkillItem): void
  onRetryInline(item: SkillItem): void
  onRetryDetail(item: SkillItem): void
}

/** 卡片/表格共用的展示状态（由 view.ts 注入）。 */
interface SkillViewShared {
  projectCtx: boolean
  selectionMode: boolean
  selected: string[]
  expanded: string[]
  details: Record<string, DetailEntry>
  inlineError: InlineErrorValue | null
  handlers: SkillViewHandlers
}

/** 卡片流分组。 */
interface SkillGroup {
  group: SourceGroup
  items: SkillItem[]
}

// ── 宿主 client 服务契约 ─────────────────────────────────────────────────

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
