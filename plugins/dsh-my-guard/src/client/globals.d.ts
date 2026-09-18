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
// 侧边栏能力一律走**宿主原生扩展点**（issue #187 批 1）：原生能力经 Cordis
// 服务名暴露（slots / sidebarRightTabs），不 require 任何
// @deepseek-ai/dsh-client-ui-* 包，也不消费第三方 dsh-better-sidebar 服务。
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  /** 读取可选服务；strict=false 时未就绪返回 undefined（设置页页签注册依赖它）。 */
  get?<T = unknown>(name: string, strict?: boolean): T | undefined
  slots?: SlotsService
  sidebarRightTabs?: SidebarRightTabsService
}

/** keyed 席位注册表（@deepseek-ai/dsh-client-ui-slots 的服务面子集）。 */
interface SlotsService {
  /** 槽位声明后执行 register；返回 dispose。 */
  inject(name: string, factory: () => () => void): () => void
  register(descriptor: SlotsDescriptor, component: (props: any) => unknown): () => void
}

/**
 * 席位描述符：keyed 席位（侧边栏正文/标题）用 `key`；list 型槽位
 * （`settings.plugins.tab`）用 `id`（宿主注册表的唯一键）+ `order` + `label`。
 */
interface SlotsDescriptor {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
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
  /** 页签胶囊标题（打开时捕获；另有 .title 席位负责实时标题）。 */
  title: (address: string) => string
  /** 指南页条目：order 决定相对顺序（沿用迁移前的数字 order）。 */
  guide?: Array<{ order: number; title: () => string; description?: () => string }>
}

/** 原生 keyed 席位注入的运行面（tab body / title 共用）。 */
interface NativeTabProps {
  sessionId?: string
  useTabInfo?: () => { tab?: { id?: string; title?: string; visible?: boolean } }
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

/** 主面板（原生 keyed 席位 `sidebar.right.pane.tab` 注入 visible）。 */
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

// ── 设置页契约（设置 → 插件 → 安全护栏；GET/PUT /guard/api/config）────────

/** 模式选项（三选一：id 与 host 端 GUARD_MODES 一致，label/hint 惰性求值）。 */
interface GuardSettingsModeOption {
  id: string
  label: () => string
  hint: () => string
}

/** 检测开关项（key 必须是草稿里的布尔字段名，渲染时按 key 取值）。 */
interface GuardSettingsSwitchSpec {
  key: 'poisonScan' | 'injection'
  label: () => string
  hint: () => string
}

/** 设置页草稿（服务端 value 规整后形态；冷却以秒呈现）。 */
interface GuardSettingsDraft {
  mode: string
  poisonScan: boolean
  injection: boolean
  notifyEnabled: boolean
  notifyCooldownSec: number
  customRulesCount: number
}

/** 保存流程的状态设置器组合。 */
interface GuardSettingsSetters {
  setDraft: (v: GuardSettingsDraft) => void
  setBusy: (v: boolean) => void
  setSaved: (v: boolean) => void
  setSaveError: (v: boolean) => void
}

/** 设置页纯视图入参（便于单测直接调用）。 */
interface GuardSettingsViewState extends GuardSettingsDraft {
  busy: boolean
  saved: boolean
  saveError: boolean
  setMode: (v: string) => void
  setPoisonScan: (v: boolean) => void
  setInjection: (v: boolean) => void
  setNotifyEnabled: (v: boolean) => void
  setNotifyCooldownSec: (v: number) => void
  save: () => Promise<void>
}

/** 开关行 props。 */
interface GuardSettingsSwitchProps {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}

/** 选择行 props（模式三选一）。 */
interface GuardSettingsSelectProps {
  value: string
  options: GuardSettingsModeOption[]
  onChange: (v: string) => void
}
