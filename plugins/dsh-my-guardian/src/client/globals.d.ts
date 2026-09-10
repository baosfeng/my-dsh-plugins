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
 *  3. 跨 part 共享的运行时契约（client Context、betterSidebar 服务、
 *     /guardian/api/* 返回的数据形状、组件 props 依赖的数据结构）。
 *
 * document / navigator / fetch / window / setInterval 等浏览器全局由
 * tsconfig.client.json 的 `lib: ["es2022", "dom"]` 提供，无需重复声明。
 *
 * 本文件只被 tsconfig.client.json 加载（根 tsconfig 已 exclude
 * `plugins/*/ src / client /**`），不会污染仓库级类型环境。
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
/** 侧边栏页签 id。 */
declare const TAB_ID: string
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

/** dsh-better-sidebar 服务（本插件只用到 registerTab）。 */
interface SidebarService {
  registerTab(options: {
    id: string
    title: () => string
    order: number
    single: boolean
    component: (props: { scope: PanelScope; visible: boolean }) => ElementLike
  }): () => void
}

/** 页签 scope（betterSidebar 注入）。 */
interface PanelScope {
  sessionId: string
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
  /** 失败分类（issue #86）：'dependency' / 'code' / 'other'。 */
  failureType?: string | null
  /** 依赖缺失时的安装建议命令。 */
  installHint?: string | null
  missingDeps?: string[]
}

/** 一条守护事件（EventList 渲染源）。 */
interface GuardianEvent {
  type: string
  message: string
  time: number | string
}

/** 启动名册预检发现的问题（issue #144，StartupIssuesBlock 渲染源）。 */
interface StartupIssue {
  /** 'unresolvable' / 'dependency' / 'duplicate-id'（未知类型原样回显）。 */
  type: string
  entryId: string
  name: string
  message: string
  fix?: string | null
  remove?: string | null
  missingDeps?: string[]
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
