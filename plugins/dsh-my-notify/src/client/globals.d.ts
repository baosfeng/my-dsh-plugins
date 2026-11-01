/**
 * dsh-my-notify — client 端全局类型声明 + 共享服务契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、dsh-shared
 * 共享图标、CJS 的 exports）以及跨 part 共享的服务/数据结构契约。跨 part
 * 文件的函数/变量引用由 TypeScript script 模式自动处理（module: commonjs +
 * 无 import/export = 全局作用域，见 tsconfig.client.json）。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * plugins/<名>/src/client/**），不会污染仓库级类型环境。
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
  /** 询问呈现模式：完整问题 / 仅摘要。 */
  askMode?: string
  apiToken?: string
  webBaseUrl?: string
  dedupeMs?: number
  webhooks?: WebhookEntry[]
  quietHours?: { enabled: boolean; start: string; end: string }
  sound?: SoundConfig
  toast?: ToastConfig
  system?: SystemConfig
  messages?: MessagesConfig
}

/** 单条出站 webhook 配置（issue #92）。 */
interface WebhookEntry {
  name: string
  channel: string
  url: string
  secret: string
  events: string[]
  enabled?: boolean
  /** text / markdown / post / interactive（interactive 仅飞书）。 */
  msgType: string
  template?: string
  /** 标题模板（为空回退会话标题）。 */
  titleTemplate?: string
  /** 正文模板（为空回退默认富格式正文）。 */
  bodyTemplate?: string
  /** 飞书卡片配置（msgType = interactive 时生效）。 */
  card?: CardConfig
  /** 重试配置。 */
  retry?: RetryConfig
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
  /** 抽屉底部「删除渠道」（可选：新增流程不传）。 */
  onDelete?: () => void
  /** 测试发送（done 回调标记成功 / 失败）。 */
  onTest: (done: (ok: boolean) => void) => void
}

/** 出站 webhook 区块（WebhookSection）入参。 */
interface WebhookSectionProps {
  webhooks: WebhookEntry[]
  failures?: WebhookFailure[]
  /** 远程触发 token（测试发送时带 x-notify-token 头）。 */
  apiToken?: string
  onPatchWebhooks: (webhooks: WebhookEntry[]) => void
}
// ── 高级配置契约（GET /notify/api/config 的 value.sound / toast / system /
// messages；与 src/types.d.ts 的 SoundConfig / ToastConfig / SystemConfig /
// MessagesConfig 对齐，client 端只读不写类型源以保持两半独立）───────────

/** 提示音配置（preset 由 client 端解释为音色）。 */
interface SoundConfig {
  enabled: boolean
  preset: string
  volume: number
}

/** 页面 toast 配置（位置 / 时长 / 最大堆叠）。 */
interface ToastConfig {
  enabled: boolean
  durationMs: number
  position: string
  maxStack: number
}

/** 系统通知配置。 */
interface SystemConfig {
  enabled: boolean
  requireInteraction: boolean
}

/** 单条事件文案模板。 */
interface MessageTemplate {
  title: string
  body: string
}

/** 五类事件的文案模板（服务端已填默认值）。 */
interface MessagesConfig {
  end?: MessageTemplate
  ask?: MessageTemplate
  approval?: MessageTemplate
  subagentEnd?: MessageTemplate
  remote?: MessageTemplate
}

/** 飞书卡片配置（msgType = interactive 时生效）。 */
interface CardConfig {
  schemaVersion?: string
  template?: string
  fields?: string[]
  buttonText?: string
  mentionOpenIds?: string[]
  mentionAll?: boolean
  accentByKind?: boolean
}

/** 推送重试配置。 */
interface RetryConfig {
  attempts?: number
  backoffMs?: number
}

/** 模板变量目录条目（GET /notify/api/variables 的 value[].items[]）。 */
interface VarItem {
  name: string
  description: string
  example: string
}

/** 模板变量分组。 */
interface VarGroup {
  group: string
  label: string
  items: VarItem[]
}

/** 预览结果（POST /notify/api/preview 的 value）。 */
interface PreviewResult {
  card: Record<string, any>
  text: string
  vars: Record<string, string>
}

/** 设置面板表单装配入参（分隔 / 状态条 / 分区内容共用）。 */
interface SettingsFormProps {
  draft: NotifyConfig
  patch: PatchFn
  pane: string
  onPane: (pane: string) => void
  save: () => void
  saved: boolean
  error: boolean
  dirty: boolean
  volume: number
  onVolumeChange: (v: number) => void
  failures: WebhookFailure[]
  apiToken: string
  /** 文案分区的卡片外观来源（飞书 interactive 渠道）。 */
  feishuCard: CardConfig
  onTest: (kind: string, sample: string, done: (ok: boolean) => void) => void
  onReset: () => void
}

/** 文案与变量分区入参。 */
interface CopyEditorPaneProps {
  messages: MessagesConfig | undefined
  card: CardConfig | undefined
  /** 事件是否启用（映射 config.end/ask/approval/subagentEnd；remote 恒为开）。 */
  enabledOf: (key: string) => boolean
  /** 切换事件启用态。 */
  onToggleEvent: (key: string, on: boolean) => void
  /** 询问模式（config.askMode：full / summary，仅 ask 事件显示分段控件）。 */
  askMode?: string
  onAskMode?: (mode: string) => void
  /** 保存失败态（编辑器顶部错误条 + 重试）。 */
  saveError?: boolean
  onRetrySave?: () => void
  onPatchMessage: (key: string, template: MessageTemplate) => void
}
