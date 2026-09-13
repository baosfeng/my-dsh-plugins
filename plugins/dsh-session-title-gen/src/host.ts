/**
 * dsh-session-title-gen — 宿主契约适配（issue #232）。
 *
 * DSH 0.1.5-rc.1 下 profile 插件与宿主 root 存在三处可见性差异，任何一处踩错
 * 都会让插件**静默失效**（不报错、标题退回核心机制、缺 `[工作区]` 前缀）：
 *  1. 事件实例隔离：`ctx.events !== ctx.root.events`，会话事件只在 root 派发；
 *  2. 插件 ctx 在 apply 返回后 inactive，动态取服务抛
 *     `cannot get required service "llm" in inactive context`；
 *  3. loader 会回收插件 fiber 上的 effect，root 监听器不能用 `ctx.effect` 托管。
 *
 * 本模块把这些适配收敛在一处，供 index.ts 保持薄 apply。
 */

import type { DshContext, Logger, LlmService } from './types.js'

/**
 * root 上的 session/event 监听器注册表（每个 root ctx 一份）。
 *
 * 以 root ctx 为键保存 disposer：插件重载时先移除上一个监听器，避免同一事件
 * 被多个残留监听器重复处理（root 注册不随插件 fiber 卸载自动清理）。
 */
const rootListeners = new WeakMap<object, () => void>()

/**
 * Register the session/event listener where the host actually dispatches it.
 * @param listenCtx - the context to register on (root when available).
 * @param handler - listener receiving (session, event).
 * @returns the registered context (for diagnostics/tests).
 */
export function listenSessionEvents(
  listenCtx: DshContext,
  handler: (session: unknown, event: unknown) => void | Promise<void>,
): void {
  rootListeners.get(listenCtx)?.()
  // { global: true } 跳过 cordis 的 scope 过滤（@deepseek-ai/dsh-scope 的 carrier
  // filter）；缺了它，打有 scope tag 的监听器会被静默排除。
  rootListeners.set(listenCtx, listenCtx.on('session/event', handler, { global: true }))
}

/**
 * Resolve the llm service from a listener-safe source.
 * @param primary - root context, whose services stay reachable for the app lifetime.
 * @param fallback - instance captured while the plugin ctx was still active.
 * @returns a usable llm service.
 */
export function selectLlm(primary: DshContext, fallback: LlmService): LlmService {
  try {
    const fromRoot = (primary as { llm?: LlmService }).llm
    if (fromRoot !== undefined) return fromRoot
  } catch {
    // root 不暴露该服务时回退到 apply 期捕获的实例
  }
  return fallback
}

/**
 * Build a logging function that can never break title generation.
 * @param logger - plugin logger captured while the ctx was still active.
 * @returns a warn sink that swallows its own failures.
 */
export function createWarn(logger?: Logger): (message: string) => void {
  return (message: string) => {
    try {
      logger?.warn?.(message)
    } catch {
      // 日志失败不影响标题生成
    }
  }
}
