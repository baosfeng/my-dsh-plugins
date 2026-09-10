/**
 * dsh-my-context — host half.
 *
 * 上下文透镜 + 成本治理：
 *  1. 上下文透镜：监听 `session/event` 统计每次请求的 token 用量与上下文
 *     构成（system/tools/user/inject/assistant/tool 分类估算 + 真实 usage
 *     input/output/cacheRead/cacheWrite），按会话隔离、重启后恢复
 *     （持久化 $DSH_HOME/context/context.json，防抖 + 原子写）；
 *  2. 成本治理：token 计量（真实 usage 累加）+ 每轮/每会话预算配置
 *     （token 上限），超限提醒（warn）/拦截（deny，agent/pre-step 返回
 *     { kind: 'reject' } 结束本轮）。
 *
 * 模块结构：
 *  - fence.js    — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - meter.js    — token 估算（与 dsh token-meter 一致的固定密度纯函数）
 *  - store.js    — 会话上下文统计存储（会话隔离 / 重启恢复 / 上限 / 原子持久化）
 *  - budget.js   — 预算检查与配置校验（纯函数）
 *  - events.js   — 事件监听（session/event 统计 + agent/pre-step 预算拦截）
 *  - routes.js   — /context/api 路由
 */
import { createStore } from './store.js'
import { attachContextListeners } from './events.js'
import { registerContextRoutes } from './routes.js'
import { normalizeBudgetConfig } from './budget.js'
import { normalizeOverflowConfig } from './overflow.js'
import type { DshContext } from './types.js'
import type { StoreType } from './events.js'

export const name = 'dsh-my-context'

export const inject = ['webServer']

export function apply(ctx: DshContext, config: unknown): void {
  // ── 配置（应用层 config 覆盖，默认全部关闭；POST /budget / /overflow 可动态更新）──
  const options = { current: normalizeBudgetConfig(config), overflow: normalizeOverflowConfig(config) }

  // ── 上下文统计存储：会话隔离 + 持久化 + 重启恢复 ──────────────────────
  const store = createStore(ctx) as unknown as StoreType

  // ── 事件监听（只读观察 + 预算拦截）───────────────────────────────────
  attachContextListeners(ctx, store, options)

  // ── 路由（查询 / 预算配置）────────────────────────────────────────────
  registerContextRoutes(ctx, store, options)

  // ── 卸载冲刷：清防抖定时器 + 立即落盘 ────────────────────────────────
  ctx.effect(() => store.dispose, 'dsh-my-context: persistence teardown')
}
