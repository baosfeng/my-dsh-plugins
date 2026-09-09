/**
 * dsh-my-guardian — client 端入口（TypeScript 源码，仅用于类型检查）。
 *
 * 构建流程：本文件不直接编译。client 端使用 parts 拼接模式——
 * src/client/parts/*.part.js 通过 scripts/build.mjs 拼接进
 * lib/client.src.js 模板，输出 lib/client.js。
 *
 * 本文件存在的目的：让 tsconfig.client.json 的 typecheck 通过。
 * 实际 client 逻辑在 parts/*.part.js 中（文本拼接，无 import/export）。
 */

// ── DSH 运行时类型（client 端最小契约，手写声明）──────────────────────

/** client 端 Context（cordis Context 最小契约 + betterSidebar 服务）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  get(name: string, strict?: boolean): unknown
}

/** better-sidebar 服务（侧边栏页签注册）。 */
interface BetterSidebarService {
  registerTab(options: {
    id: string
    title: string | (() => string)
    order?: number
    single?: boolean
    component: (props: { scope: { sessionId: string }; visible: boolean }) => unknown
  }): () => void
}

// ── 插件体（实际实现在 parts 中，这里仅声明类型）─────────────────────

// exports.inject = ['betterSidebar']
// exports.apply = function apply(ctx: ClientContext): void { ... }

export {}
