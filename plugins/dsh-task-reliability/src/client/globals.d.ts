/**
 * dsh-task-reliability — client 端全局类型声明 + 跨 part 共享契约。
 *
 * client 端源码是「拼接片段」（无 import/export，见 tsconfig.client.json），
 * tsc 以 script 模式编译，因此本文件声明的类型对所有 parts 可见。
 *
 * 声明两类东西：
 *  1. `__ModuleLoader__` factory 作用域注入的变量（模板 lib/client.src.js 里
 *     的 `require('react')` 解构、`module`/`exports`）；
 *  2. 跨 part 共享的运行时契约（client Context、宿主原生侧边栏扩展点 +
 *     官方 slots 扩展点、HTTP API 返回的数据形状）。
 *
 * 侧边栏能力一律走宿主原生扩展点（issue #187 批 1）：原生能力经 Cordis 服务名
 * 暴露（sidebarRightTabs / slots），不 require 任何
 * @deepseek-ai/dsh-client-ui-* 包，也不消费第三方 dsh-better-sidebar 服务。
 *
 * document / navigator / fetch / setInterval 等浏览器全局由 tsconfig.client.json
 * 的 `lib: ["es2022", "dom"]` 提供，无需在此重复声明。
 */

// ── React（模板里 require('react') 解构出的三个 hook）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): ElementLike
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]

// ── CommonJS（apply/设置页 part 使用 exports.apply / exports.__test）─────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 模板常量（lib/client.src.js 的 factory 作用域）──────────────────────
/** 迁移前 better-sidebar 的 tab id（现为原生页签 kind）。 */
declare const TAB_ID: string
/** 原生页签类型实现身份（包名；全局唯一，也是席位的 key）。 */
declare const TAB_ID_PKG: string
/** 指南页相对顺序（沿用迁移前的数字 order）。 */
declare const TAB_ORDER: number
/** 任务/问题列表轮询间隔（模板常量，6000ms）。 */
declare const POLL_MS: number

// ── 宿主扩展点契约（client 端用到的子集）───────────────────────────────

/**
 * client 端 Context 的最小契约。
 *
 * `get(name, strict)`：cordis 服务查询；strict=false 时服务提供者 fiber 尚未
 * active 不发警告、返回 undefined（首屏时序，见 apply/settings part 注释）。
 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  get(name: string, strict?: boolean): unknown
}

/** 页签类型注册表（@deepseek-ai/dsh-client-ui-sidebar-right 的服务面子集）。 */
interface SidebarRightTabsService {
  register(definition: SidebarTabDefinition): () => void
}

/** 原生页签类型定义（右栏 register 的入参子集）。 */
interface SidebarTabDefinition {
  /** 实现身份，全局唯一；同时是 body/title 席位注册用的 key（惯例 = 包名）。 */
  id: string
  /** 类型判别符（沿用迁移前 better-sidebar 的 tab id）。 */
  kind: string
  /** 页签胶囊标题（打开时捕获）。 */
  title: (address: string) => string
  /** 指南页条目：`id` 在提供方内稳定唯一（宿主必填），order 决定相对顺序（沿用迁移前的数字 order）。 */
  guide?: Array<{ id: string; order: number; title: () => string; description?: () => string }>
}

/** 原生 keyed 席位注入的运行面（tab body / title 共用）。 */
interface NativeTabProps {
  sessionId?: string
  useTabInfo?: () => { tab?: { id?: string; title?: string; visible?: boolean } }
}

/** 官方 slots 扩展点（@deepseek-ai/dsh-client-ui-renderer 提供，issue #27 / #187）。 */
interface SlotsService {
  /** keyed 席位（sidebar.right.pane.tab / .title）：按 key 注册组件。 */
  register(
    descriptor: { name: string; key: string } | { name: string; id: string; order: number; label: () => string },
    component: unknown,
  ): unknown
  /** 槽位声明后执行 register；返回 dispose。 */
  inject(name: string, register: () => unknown): () => void
}

/** 页签 scope（原生 tabInfo 注入，仅取当前会话 id）。 */
interface PanelScope {
  sessionId?: string
}

// ── HTTP API 数据形状（server 端 /task-reliability/api/*）────────────────

/** 三个模式开关的状态（GET /api/info 的 value）。 */
interface ModeInfo {
  tracking?: boolean
  verify?: boolean
  autopilot?: boolean
}

/** 一条注册任务（GET /api/tasks 的 value[]）。 */
interface TaskRecord {
  id: string
  description?: string
  /** 'active' / 'checking' / 'done' / 'failed' / 'paused'（未知按 active 渲染）。 */
  status?: string
  /** 'direct' / 'verify'（verify 在元信息里显示为「校验」）。 */
  mode?: string
  loopCount?: number
  verifyCount?: number
}

/** 一条被拦截的 ask 问题（GET /api/questions 的 value[]）。 */
interface QuestionRecord {
  id: string
  question: string
  /** 已回答时存在（已答问题不再出现在待确认列表）。 */
  answer?: string
}

/** 设置页表单字段（SETTINGS_SECTIONS 元素）。 */
interface SettingsRow {
  label: () => string
  hint: () => string
  key: string
  fallback: string | number | boolean
  numeric?: boolean
  switch?: boolean
}

/** 设置页分组（标题 + 字段行）。 */
interface SettingsSection {
  title: () => string
  rows: SettingsRow[]
}

/** 设置页配置（GET / PUT /api/config 的 value；字段由 server 端 Config 决定）。 */
type SettingsConfig = Record<string, unknown>
/** 设置页草稿：配置字段 + retryableCodesText（逗号分隔文本，保存时还原为数组）。 */
type SettingsDraft = Record<string, unknown> & { retryableCodesText?: string }

/** apiFetch 的返回（body 非 JSON 时为 null）。 */
interface ApiResult {
  status: number
  body: { ok?: boolean; value?: unknown } | null
}

// ── createElement 产物的最小形状（测试遍历元素树时使用）─────────────────
interface ElementLike {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}
