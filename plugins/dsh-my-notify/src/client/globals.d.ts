/**
 * dsh-my-notify — client 端全局类型声明 + 共享服务契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、dsh-shared
 * 共享图标、CJS 的 exports）以及跨 part 共享的服务/数据结构契约。跨 part
 * 文件的函数/变量引用由 TypeScript script 模式自动处理（module: commonjs +
 * 无 import/export = 全局作用域，见 tsconfig.client.json）。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * plugins/*/ src / client /**），不会污染仓库级类型环境。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── React 事件类型（事件参数在 strict: false 下为隐式 any，此处仅备用）──
declare namespace React {
  interface ChangeEvent<T = Element> {
    currentTarget: T
    target: EventTarget & { value: string; checked: boolean }
  }
}

// ── icon（dsh-shared/client-parts/icons.part.js，构建期按文件系统路径拼接）
// 共享图标集：icon.<name>(size) 返回 React 元素树（toast 里转成 SVG DOM）。
declare const icon: Record<string, (size?: number) => unknown>

// ── CommonJS（client.src.js 模板在 factory 作用域提供的 module/exports）──
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── window 扩展：Safari 前缀 AudioContext（lib.dom 未声明）───────────────
interface Window {
  webkitAudioContext?: typeof AudioContext
}

// ── client 端 Context 的最小契约（apply(ctx) 用到的扩展点）──────────────
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /** cordis 服务查找；strict=false 时提供者 fiber 未 active 也返回实例。 */
  get(name: string, strict?: boolean): any
}

/** 会话服务（点击通知/系统通知时跳转会话；openSessionFor 内做能力探测）。 */
interface SessionsService {
  open(sessionId: string): void
}

/** 官方 slots 扩展点（设置页 tab 注册，issue #27）。 */
interface SettingsSlotsService {
  inject(name: string, register: () => unknown): () => void
  register(options: { name: string; id: string; order: number; label: () => string }, component: () => unknown): unknown
}

// ── 跨 part 共享的数据契约（server 通知帧 / 配置 / webhook）──────────────

/** server 推送到 /notify/api/stream 的通知帧。 */
interface NotifyNotice {
  type?: string
  kind?: string
  sessionId?: string
  title?: string
  toolName?: string
  note?: string
}

/** server 端配置（GET/PUT /notify/api/config 的 value）。 */
interface NotifyConfig {
  end?: boolean
  ask?: boolean
  approval?: boolean
  subagentEnd?: boolean
  apiToken?: string
  dedupeMs?: number
  webhooks?: WebhookEntry[]
}

/** 单条出站 webhook 配置（issue #92）。 */
interface WebhookEntry {
  name: string
  channel: string
  url: string
  secret: string
  events: string[]
  enabled?: boolean
  msgType: string
  template?: string
}

/** webhook 推送失败记录（GET /notify/api/webhooks 的 value.failures）。 */
interface WebhookFailure {
  time: number | string
  webhookName: string
  channel: string
  attempts: number
  error: string
}

/** 下拉选项（label 惰性求值以跟随语言切换）。 */
interface SelectOption {
  value: string
  label: () => string
}

/** 设置项 patch 函数（键 + 新值，写入 draft 副本）。 */
type PatchFn = (key: string, value: any) => void

/** setState 布尔包装（保存中/保存失败标记）。 */
type SetBool = (v: boolean) => void

/** 开关行（SwitchRow）入参。 */
interface SwitchRowProps {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}

/** 输入行（TextRow）入参。 */
interface TextRowProps {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  type?: string
}

/** 音量滑杆行（VolumeRow）入参。 */
interface VolumeRowProps {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
}

/** webhook 列表行（WebhookRow）入参。 */
interface WebhookRowProps {
  webhook: WebhookEntry
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
}

/** webhook 编辑表单（WebhookEditor）入参。 */
interface WebhookEditorProps {
  draft: WebhookEntry
  onChange: (webhook: WebhookEntry) => void
  onSave: () => void
  onCancel: () => void
}

/** 出站 webhook 区块（WebhookSection）入参。 */
interface WebhookSectionProps {
  webhooks: WebhookEntry[]
  failures?: WebhookFailure[]
  onPatchWebhooks: (webhooks: WebhookEntry[]) => void
}
