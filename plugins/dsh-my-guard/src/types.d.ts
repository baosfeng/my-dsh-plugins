/**
 * dsh-my-guard — DSH 运行时类型声明（server 端）。
 *
 * 手写最小契约：插件只用 ctx 的少量 API（on / effect / get / webServer）。
 * DSH 运行时模块（cordis / webServer）由宿主提供，本声明是插件与运行时
 * 之间的类型契约。
 *
 * 说明：本文件是 .d.ts（纯类型，无产物输出）；server 端源码经
 * `import type { ... } from './types.js'` 引用（nodenext 的 .js → .d.ts 映射）。
 */

/** Cordis 事件监听器（DSH 事件如 tools/pre-execute、session/event）。 */
export type EventHandler = (...args: unknown[]) => void

/** DSH server 端 Context（cordis Context 的最小契约）。 */
export interface DshContext {
  /** 监听 DSH 事件；返回 disposer。 */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /** 注册副作用（返回 disposer 的注册函数直接返回其返回值）。 */
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务（未加载返回 undefined）。 */
  get<T>(name: string): T | undefined
  /** webServer 服务（inject 声明后可用）。 */
  webServer?: WebServerService
  /** 日志器 */
  logger: Logger
}

/** webServer 服务（HTTP 路由注册）。 */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (request: ServerRequest, response: ServerResponse) => void | Promise<void>
  }): () => void
  /** 监听端口 */
  port?: number
  /** 监听地址 */
  host?: string
}

/** DSH HTTP 请求（node:http IncomingMessage 的最小契约）。 */
export interface ServerRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}

/** DSH HTTP 响应（node:http ServerResponse 的最小契约）。 */
export interface ServerResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

/** 日志器 */
export interface Logger {
  warn(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

/** 告警记录 */
export interface Alert {
  id?: number
  time?: number
  confirmed?: boolean
  confirmedAt?: number
  type: string
  sessionId?: string
  severity: string
  message: string
  detail?: Record<string, unknown>
}

/** 护栏模式 */
export type GuardMode = 'observe' | 'ask' | 'deny'

/** 严重级别 */
export type Severity = 'low' | 'medium' | 'high'

/** 破坏性命令模式 */
export interface DestructivePattern {
  id: string
  re: RegExp
  message: string
}

/** 编译后的自定义规则 */
export interface CompiledRule {
  id: string
  pattern: string
  regex: RegExp
  mode: string
  severity: Severity
  description: string
  message: string
  custom: boolean
}

/** 破坏性命令决策结果 */
export interface DestructiveDecision {
  mode: GuardMode
  severity: Severity
  primary: DestructivePattern | CompiledRule
  matched: Array<{ rule: DestructivePattern | CompiledRule; mode: GuardMode; severity: Severity }>
}

/** 告警存储 */
export interface AlertStore {
  state: { version: number; alerts: Alert[] }
  record(alert: Alert): Alert
  alerts(sessionId?: string, type?: string, limit?: number): Alert[]
  count(): number
  confirm(id: number): boolean
  dispose(): void
}

/** 护栏选项 */
export interface GuardOptions {
  mode: GuardMode
  poisonScan: boolean
  injection: boolean
  customRules: CompiledRule[]
  notifyEnabled: boolean
  notifyCooldownMs: number
  notifyToken: string
  notifyBaseUrl: string
}

/** 通知结果 */
export interface NotifyResult {
  sent: boolean
  reason?: string
}

/** 通知器 */
export interface Notifier {
  notify(alert: Alert): NotifyResult
  state(): Record<string, number>
}

/** 扫描发现项 */
export interface Finding {
  id: string
  severity: Severity
  message: string
  file?: string
  pattern?: string
  script?: string
}

/** 扫描结果 */
export interface ScanResult {
  ok: boolean
  findings?: Finding[]
  scannedFiles?: number
  scannedBytes?: number
  error?: string
}

/** 提示注入检测命中 */
export interface InjectionHit {
  id: string
  severity: Severity
  message: string
  explain: string
}

/** 配置保存接口 */
export interface SaveConfigPayload {
  customRules?: unknown[]
  notifyEnabled?: boolean
  notifyCooldownMs?: number
}

/** 配置保存结果 */
export interface SaveConfigResult {
  customRules: Array<{ id: string; pattern: string; mode: string; severity: string; description: string }>
  notifyEnabled: boolean
  notifyCooldownMs: number
  dropped: number
}
