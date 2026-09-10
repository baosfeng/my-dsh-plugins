/**
 * dsh-task-reliability — client 端全局类型声明 + 跨 part 共享契约。
 *
 * client 端源码是「拼接片段」（无 import/export，见 tsconfig.client.json），
 * tsc 以 script 模式编译，因此本文件声明的类型对所有 parts 可见。
 *
 * 声明两类东西：
 *  1. `__ModuleLoader__` factory 作用域注入的变量（模板 lib/client.src.js 里
 *     的 `require('react')` 解构、`module`/`exports`）；
 *  2. 跨 part 共享的运行时契约（client Context、官方 slots 扩展点、HTTP API
 *     返回的数据形状）。
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
/** 侧边栏页签 id（模板常量）。 */
declare const TAB_ID: string
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

/** dsh-better-sidebar 服务（client 端只用到 registerTab）。 */
interface SidebarService {
  registerTab(options: {
    id: string
    title: () => string
    order: number
    single: boolean
    component: (props: { scope: PanelScope; visible: boolean }) => ElementLike
  }): () => void
}

/** 官方 slots 扩展点（@deepseek-ai/dsh-client-ui-renderer 提供，issue #27）。 */
interface SlotsService {
  register(descriptor: { name: string; id: string; order: number; label: () => string }, component: unknown): unknown
  /** 槽位声明后执行 register；返回 dispose。 */
  inject(name: string, register: () => unknown): () => void
}

/** 页签 scope（betterSidebar 注入，仅取当前会话 id）。 */
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
