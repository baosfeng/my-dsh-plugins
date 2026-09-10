/**
 * dsh-my-context — client 端全局类型声明 + 共享数据契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、CJS 的
 * module/exports）以及跨 part 共享的数据/组件入参契约。跨 part 文件的
 * 函数/变量引用由 TypeScript script 模式自动处理（module: commonjs +
 * 无 import/export = 全局作用域，见 tsconfig.client.json）。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * plugins/*/ src / client /**），不会污染仓库级类型环境。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── CommonJS（lib/client.src.js 模板在 factory 作用域提供的 module/exports）──
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 插件体契约（模板 exports.apply(ctx) / betterSidebar 注册页签）─────────
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  betterSidebar?: BetterSidebarService
}

interface BetterSidebarService {
  registerTab(options: {
    id: string
    title: () => string
    order?: number
    single?: boolean
    component: (props: { visible?: boolean; scope?: { sessionId: string } }) => unknown
  }): () => void
}

// ── server 端数据结构（GET /context/api/* 的 value，字段全部按需取值）────

/** 累计 token 用量（每次请求的新增项，cacheRead/Write 为计价项）。 */
interface CtxUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** 单次请求记录（轮/步 + prompt/output + 缓存读写）。 */
interface CtxRequest {
  turn: number
  step: number
  prompt: number
  output: number
  cacheRead: number
  cacheWrite: number
  time: number | string
}

/** 预算告警记录（scope=turn/session，blocked=拦截）。 */
interface CtxAlert {
  id: string
  scope: string
  blocked: boolean
  used: number
  limit: number
  time: number | string
}

/** 溢出预警记录（level=normal/warn/alert/critical，threshold=触发阈值）。 */
interface CtxOverflowRecord {
  id: string
  level: string
  used: number
  window: number
  ratio: number
  threshold: number
  time: number | string
}

/** 上下文构成分类 → token 数（system/tools/user/inject/assistant/tool）。 */
interface CtxComposition {
  [key: string]: number | undefined
}

/** 单会话统计（GET /context/api/session 的 value）。 */
interface CtxSession {
  sessionId: string
  model: string
  contextWindow: number
  usage?: CtxUsage
  composition: CtxComposition
  requests: CtxRequest[]
  alerts: CtxAlert[]
  overflows: CtxOverflowRecord[]
  /** 最近一次请求的 prompt token（旧数据缺失时回退 requests 末条）。 */
  lastPromptTokens?: number
}

/** 会话列表项（GET /context/api/sessions 的 value[]）。 */
interface CtxSessionListItem {
  sessionId: string
}

/** 预算配置（GET /context/api/status 的 value.budget）。 */
interface CtxBudget {
  perTurn: number
  perSession: number
  mode: string
}

/** 溢出阈值配置（GET /context/api/status 的 value.overflow）。 */
interface CtxOverflowConfig {
  warnThreshold: number
  alertThreshold: number
}

/** ContextPanel 轮询写入的 setState 集合（loadContextData 的入参）。 */
interface CtxSetters {
  setSessions(list: CtxSessionListItem[]): void
  setSessionId(id: string): void
  setSession(stats: CtxSession | null): void
  setBudget(budget: CtxBudget): void
  setOverflow(overflow: CtxOverflowConfig): void
  setError(message: string): void
  setLoading(loading: boolean): void
}

// ── 组件入参契约 ─────────────────────────────────────────────────────────

interface CtxStatProps {
  value: string
  label: string
}

interface CtxOverviewCardProps {
  session: CtxSession
}

interface CtxCompositionBarProps {
  composition: CtxComposition
}

interface CtxRequestRowProps {
  request: CtxRequest
}

interface CtxRequestListProps {
  requests: CtxRequest[]
}

interface CtxBudgetFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

interface CtxBudgetSettingsProps {
  budget: CtxBudget
  onSaved: () => void
}

interface CtxAlertListProps {
  alerts: CtxAlert[]
}

interface CtxContextUsageCardProps {
  session: CtxSession
  overflow: CtxOverflowConfig
}

interface CtxMeter {
  used: number
  window: number
  ratio: number
  level: string
}

interface CtxCompressSuggestionsProps {
  meter: CtxMeter
  session: CtxSession
}

interface CtxOverflowListProps {
  overflows: CtxOverflowRecord[]
}

interface CtxOverflowSectionProps {
  overflows: CtxOverflowRecord[]
}

interface CtxThresholdFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

interface CtxOverflowSettingsProps {
  overflow: CtxOverflowConfig
  onSaved: () => void
}

interface CtxContextPanelProps {
  visible?: boolean
  scope?: { sessionId: string }
}
