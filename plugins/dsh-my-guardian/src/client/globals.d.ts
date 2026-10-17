/**
 * dsh-my-guardian — client 端全局类型声明 + 跨 part 共享契约。
 *
 * client 端源码是「拼接片段」（无 import/export，见 tsconfig.client.json），
 * tsc 以 script 模式编译，因此本文件声明的类型对所有 parts 可见
 * （跨文件函数/变量引用同理，由 TS 的全局作用域处理）。
 *
 * 声明三类东西：
 *  1. `__ModuleLoader__` factory 作用域注入的变量（模板 lib/client.src.js 里
 *     `require('react')` 解构出的三个 hook、`module`/`exports`、模板常量
 *     TAB_ID / POLL_MS）；
 *  2. 构建期拼接的共享片段提供的符号（dsh-shared 的 `icon` 图标集）；
 *  3. 跨 part 共享的运行时契约（client Context、宿主原生侧边栏扩展点服务、
 *     /guardian/api/* 返回的数据形状、组件 props 依赖的数据结构）。
 *
 * document / navigator / fetch / window / setInterval 等浏览器全局由
 * tsconfig.client.json 的 `lib: ["es2022", "dom"]` 提供，无需重复声明。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * `plugins/<名>/src/client/**`），不会污染仓库级类型环境。
 */

// ── React（模板里 require('react') 解构出的三个 hook）────────────────────
declare function createElement(type: unknown, props?: unknown, ...children: unknown[]): ElementLike
declare function useState<T = unknown>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void

// ── 共享片段（dsh-shared/client-parts/icons.part.js，构建期按文件系统路径
//    拼接）：icon.<name>(size) 返回 React 元素树 ──────────────────────────
declare const icon: Record<string, (size?: number) => unknown>

// ── CommonJS（模板 factory 作用域提供的 module / exports）────────────────
declare const exports: Record<string, unknown>
declare const module: { exports: Record<string, unknown> }

// ── 模板常量（lib/client.src.js 的 factory 作用域）──────────────────────
/** 迁移前 better-sidebar 的 tab id（现为原生页签 kind）。 */
declare const TAB_ID: string
/** 原生页签类型实现身份（包名；全局唯一，也是席位的 key）。 */
declare const TAB_ID_PKG: string
/** 指南页相对顺序（沿用迁移前的数字 order）。 */
declare const TAB_ORDER: number
/** 面板可见时的轮询间隔（5000ms）。 */
declare const POLL_MS: number

// ── 宿主扩展点契约（client 端用到的子集）───────────────────────────────

/**
 * client 端 Context 的最小契约。
 *
 * `get(name, strict)`：cordis 服务查询；strict=false 时服务提供者 fiber 尚未
 * active 也返回实例（首屏时序，见 apply part 注释），未安装该服务时返回
 * undefined。
 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  get(name: string, strict?: boolean): any
}

// 侧边栏能力一律走宿主原生扩展点（issue #187 批 1）：原生能力经 Cordis 服务名
// 暴露（sidebarRightTabs / slots），不 require 任何
// @deepseek-ai/dsh-client-ui-* 包，也不消费第三方 dsh-better-sidebar 服务。

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

/** keyed 席位注册表（@deepseek-ai/dsh-client-ui-slots 的服务面子集）。 */
interface SlotsService {
  inject(name: string, factory: () => () => void): () => void
  register(descriptor: { name: string; key: string }, component: (props: NativeTabProps) => unknown): () => void
}

/** 原生 keyed 席位注入的运行面（tab body / title 共用）。 */
interface NativeTabProps {
  sessionId?: string
  useTabInfo?: () => { tab?: { id?: string; title?: string; visible?: boolean } }
}

// ── /guardian/api/* 的数据形状（server 端 api.ts 的返回）────────────────

/** 一条候选/转正插件条目（status/attempts/lastError/… 由 server 端状态机给出）。 */
interface GuardianEntry {
  id: string
  name: string
  /** 'running' / 'pending' / 'failed' / 'frozen'（未知状态原样回显）。 */
  status: string
  /** 连续失败次数（>0 时行内展示「失败 N 次」）。 */
  attempts: number
  lastError?: string | null
  lastFailedAt?: number | null
  /** 失败分类：#410 起为 'dependency-missing' / 'dependency-mismatch'，另有
   *  'code' / 'other'；pre-#410 的旧记录是 'dependency'（仍渲染出徽章）。 */
  failureType?: string | null
  /** 依赖的安装建议命令；宿主提供的包不提供命令时为 null（#410）。 */
  installHint?: string | null
  /** 硬缺失的 peer（#410 起不含版本不满足者）。 */
  missingDeps?: string[]
  /** 版本不满足的 peer：声明范围 vs 实装版本（#410）。 */
  mismatchedDeps?: MismatchedDep[]
}

/** 一个版本不满足的 peer（server 端 dep-precheck 的 MismatchIssue）。 */
interface MismatchedDep {
  name: string
  expected: string
  found: string
}

/** 一条守护事件（EventList 渲染源）。 */
interface GuardianEvent {
  type: string
  message: string
  time: number | string
}

/** 启动名册预检发现的问题（issue #144，StartupIssuesBlock 渲染源）。 */
interface StartupIssue {
  /** 'unresolvable' / 'dependency-missing' / 'dependency-mismatch' / 'duplicate-id'
   *  （未知类型与 pre-#410 的 'dependency' 原样/兼容回显）。 */
  type: string
  entryId: string
  name: string
  message: string
  /** 修复命令；宿主提供的包无可执行命令时为 null（#410）。 */
  fix?: string | null
  remove?: string | null
  missingDeps?: string[]
  mismatchedDeps?: MismatchedDep[]
}

/** GET /guardian/api/state 的 value。 */
interface GuardianState {
  safeMode: boolean
  staged: GuardianEntry[]
  promoted: GuardianEntry[]
  events: GuardianEvent[]
  startupIssues?: StartupIssue[]
  startupCheckedAt?: number
  /** client 端在首次成功加载后置 true。 */
  loaded: boolean
}

// ── 跨 part 共享的辅助类型 ──────────────────────────────────────────────

/** 条目来源（候选区 / 已转正名册）。 */
type EntrySource = 'staged' | 'promoted'

/** 列表行规格：一条条目 + 它的来源（EntryList / EntryRow 的输入）。 */
interface EntryRowSpec {
  entry: GuardianEntry
  source: EntrySource
}

/** 列表行动作：retry / remove，返回 promise 时行内 busy 状态跟随其结束。 */
type GuardianAction = (kind: string, entry: GuardianEntry) => unknown

/** createElement 产物的最小形状（测试遍历元素树时使用）。 */
interface ElementLike {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}
