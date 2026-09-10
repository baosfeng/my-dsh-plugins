/**
 * dsh-my-observability — host half.
 *
 * 可观测性 + Git 工程工具：
 *  1. 事件审计：监听 agent/status、llm/stream、tools/* 事件，记录审计
 *     日志（agent 行为可追溯），按会话隔离、重启后恢复（持久化
 *     $DSH_HOME/observability/audit.json，防抖 + 原子写）；
 *  2. 轨迹回放：/observability/api 查询接口供侧边栏时间轴面板消费；
 *  3. 结构化 Git：类型化提交（Conventional Commits）+ 状态/差异查询；
 *  4. 增量 diff 审查：提交前规则引擎审查 + 可选 AI agent 增强。
 *
 * 模块结构：
 *  - fence.js    — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - store.js    — 审计事件存储（会话隔离 / 重启恢复 / 上限 / 原子持久化）
 *  - audit.js    — 事件监听（agent/status、llm/stream、tools/pre-execute、tools/execute）
 *  - git.js      — 结构化 Git 操作（类型化提交 / status / diff）
 *  - diff.js     — unified diff 解析（纯函数）
 *  - review.js   — 增量 diff 审查规则引擎（纯函数）
 *  - ai.js       — 可选 AI 审查增强（agents.create，失败降级）
 *  - routes.js   — /observability/api 路由
 */
import { createStore } from './store.js'
import { attachAuditListeners } from './audit.js'
import { registerObservabilityRoutes } from './routes.js'
import { createResourceMonitor } from './resource-monitor.js'
import type { ObservabilityOptions } from './routes.js'
import type { DshContext } from './types.js'

/** 插件配置（cordis.patch.yml config）。 */
export interface ObservabilityConfig {
  aiReview?: boolean
  aiTimeoutMs?: number
  resourceIntervalMs?: number
  resourceLimits?: Record<string, number>
}

export const name = 'dsh-my-observability'

export const inject = ['webServer']

export function apply(ctx: DshContext, config?: ObservabilityConfig): void {
  // ── 配置（应用层 config 覆盖，默认全部开启）─────────────────────────
  const options: ObservabilityOptions = {
    aiReview: config?.aiReview !== false,
    aiTimeoutMs:
      Number.isFinite(config?.aiTimeoutMs) && (config?.aiTimeoutMs as number) > 0
        ? (config?.aiTimeoutMs as number)
        : 60000,
  }

  // ── 审计存储：会话隔离 + 持久化 + 重启恢复 ──────────────────────────
  const store = createStore(ctx)

  // ── 事件监听（只读观察；waterfall 一律透传 next()）──────────────────
  attachAuditListeners(ctx, store.record)

  // ── 资源监控 + 降级看门狗（15s 采样 CPU/内存/审计写入速率；写放大/文件
  //    超限连续触发时自动降级停落盘，资源回归后自动恢复——issue #127）────
  const monitor = createResourceMonitor(ctx, {
    intervalMs: config?.resourceIntervalMs,
    limits: config?.resourceLimits,
    onDegrade: () => {
      store.setPersistEnabled(false)
      ctx.logger.warn(
        '[dsh-my-observability] 资源看门狗：审计写入速率/文件大小连续超限，已暂停落盘（事件仍在内存，恢复后全量快照补齐）',
      )
    },
    onRecover: () => {
      store.setPersistEnabled(true)
      ctx.logger.warn('[dsh-my-observability] 资源看门狗：写入速率回归正常，已恢复审计落盘')
    },
  })
  monitor.start()

  // ── 路由（查询 / git 工具 / diff 审查 / 资源）───────────────────────
  registerObservabilityRoutes(ctx, store, monitor, options)

  // ── 卸载冲刷：清防抖定时器 + 立即落盘 + 停采样 ──────────────────────
  ctx.effect(() => {
    monitor.stop()
    return store.dispose
  }, 'dsh-my-observability: persistence teardown')
}
