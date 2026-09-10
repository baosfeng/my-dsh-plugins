/**
 * dsh-my-guard — client 端全局类型声明 + 共享契约。
 *
 * 声明 __ModuleLoader__ factory 作用域注入的变量（React hooks、dsh-shared
 * 共享图标、CJS 的 exports）以及跨 part 共享的数据/组件契约。跨 part 文件的
 * 函数与变量引用由 TypeScript script 模式自动处理（module: commonjs + 无
 * import/export = 全局作用域，见 tsconfig.client.json）。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * plugins/ * /src/client/ **），不会污染仓库级类型环境。
 */

// ── React（由 factory 作用域的 require('react') 注入）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
declare function useState<T = any>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── icon（dsh-shared/client-parts/icons.part.js，构建期按文件系统路径拼接）──
// 共享图标集：icon.<name>(size) 返回 React 元素树（stroke=currentColor）。
declare const icon: Record<string, (size?: number) => unknown>

// ── CommonJS（client.src.js 模板在 factory 作用域提供的 module/exports）──
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── client 端 Context 的最小契约（lib/client.src.js 模板的 apply(ctx)）────
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  betterSidebar?: BetterSidebarService
}

/** 侧边栏页签注册服务（dsh-better-sidebar）。 */
interface BetterSidebarService {
  registerTab(options: {
    id: string
    title: string | (() => string)
    order?: number
    single?: boolean
    component: (props: GuardPanelProps) => unknown
  }): () => void
}

// ── server → client 数据契约（GET /guard/api/alerts 的 value 元素）────────

/** 告警详情（按类型携带不同字段：命令/文件/规则 + 说明 + 命中原文）。 */
interface GuardAlertDetail {
  command?: string
  file?: string
  rule?: string
  pattern?: string
  explain?: string
  snippet?: string
}

/** 单条护栏告警（破坏性命令 / 投毒扫描 / 提示注入）。 */
interface GuardAlert {
  id: number
  type: string
  severity: string
  time: number | string
  message: string
  sessionId?: string
  confirmed?: boolean
  detail?: GuardAlertDetail
}

/** 投毒扫描发现项。 */
interface GuardFinding {
  file: string
  pattern: string
  severity: string
  message: string
}

/** POST /guard/api/scan 的 value。 */
interface GuardScanResult {
  ok?: boolean
  findings?: GuardFinding[]
}

/** 护栏规则命中项（内置与自定义统一形态）。 */
interface GuardRuleHit {
  id: string
  mode: string
  severity: string
  message: string
  source: string
}

/** 合并决策（多条规则命中时取最严格）。 */
interface GuardRuleDecision {
  mode: string
  severity: string
}

/** POST /guard/api/rules/test 的 value。 */
interface GuardRuleTestResult {
  hits?: GuardRuleHit[]
  decision?: GuardRuleDecision
}

/** 自定义护栏规则（POST /guard/api/rules 的请求体与响应 customRules 元素）。 */
interface GuardCustomRule {
  pattern: string
  mode: string
  severity: string
  description: string
}

/** GET / POST /guard/api/rules 的 value。 */
interface GuardRulesResponse {
  custom?: GuardCustomRule[]
  customRules?: GuardCustomRule[]
  notifyEnabled?: boolean
  notifyCooldownMs?: number
  dropped?: number
}

// ── 状态设置器契约（抽出来传参的 setState 组合）──────────────────────────

/** loadAlerts 的 setter 组合。 */
interface GuardAlertSetters {
  setAlerts: (v: GuardAlert[] | ((prev: GuardAlert[]) => GuardAlert[])) => void
  setError: (v: string) => void
  setLoading: (v: boolean) => void
}

/** runScan 的 setter 组合。 */
interface GuardScanSetters {
  setResult: (v: GuardScanResult | null) => void
  setBusy: (v: boolean) => void
  setError: (v: string) => void
}

// ── 组件 props 契约 ─────────────────────────────────────────────────────

/** 主面板（betterSidebar 页签注入 visible）。 */
interface GuardPanelProps {
  visible?: boolean
}

/** 告警 meta 行 / 详情行。 */
interface GuardAlertProps {
  alert: GuardAlert
}

/** 单条告警行（确认按钮回调传告警 id）。 */
interface GuardAlertRowProps extends GuardAlertProps {
  onConfirm: (id: number) => void
}

/** 错误状态（重试按钮）。 */
interface GuardErrorStateProps {
  message: string
  onRetry: () => void
}

/** 扫描结果展示。 */
interface GuardScanResultProps {
  result: GuardScanResult | null
}

/** 注入检测结果展示。 */
interface GuardPromptResultProps {
  hits: GuardRuleHit[]
}

/** 规则测试结果展示。 */
interface GuardRuleTestResultProps {
  result: GuardRuleTestResult | null
}

/** 单条自定义规则行（编辑/删除回调都带 index）。 */
interface GuardRuleEntryProps {
  rule: GuardCustomRule
  index: number
  onChange: (index: number, patch: Partial<GuardCustomRule>) => void
  onRemove: (index: number) => void
}

/** RuleSettings 渲染视图（纯函数视图层入参，便于单测直接调用）。 */
interface GuardRuleSettingsView {
  customRules: GuardCustomRule[]
  notifyEnabled: boolean
  notifyCooldownSec: number
  busy: boolean
  feedback: string
  error: string
  changeRule: (index: number, patch: Partial<GuardCustomRule>) => void
  addRule: () => void
  removeRule: (index: number) => void
  save: () => Promise<void>
  setNotifyEnabled: (v: boolean) => void
  setNotifyCooldownSec: (v: number) => void
}
