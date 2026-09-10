/**
 * dsh-task-reliability — 结构化插件事件（issue #154）。
 *
 * 干预/ask 决策/救场/verify/恢复等关键行为以结构化事件发出，供
 * dsh-my-observability 等插件采集审计（时间线可查「为什么」）。
 * 全部 best-effort：emit 失败静默，绝不影响主流程。
 *
 * 事件名约定：`<插件前缀>/<行为类别>`，payload 统一为
 * `{ sessionId, action, reason, ...params }`（会话 id / 动作 / 原因 /
 * 关键参数）。observability 侧按前缀显式注册监听（见其 lib/audit.js）。
 */
import type { AnyObject, DshContext } from './types.js'

/** 插件事件名（observability 采集清单与此保持一致）。 */
export const PLUGIN_EVENTS = Object.freeze({
  /** 干预：循环打断 / 任务继续 / 循环上限。 */
  INTERVENTION: 'task-reliability/intervention',
  /** ask 决策：超时自动决策 / 立即拦截 / 迟到回答。 */
  ASK_DECISION: 'task-reliability/ask-decision',
  /** 救场：停滞任务看门狗唤醒。 */
  RESCUE: 'task-reliability/rescue',
  /** 校验：verify 开始 / 结论 / 降级。 */
  VERIFY: 'task-reliability/verify',
  /** 恢复：重启后任务恢复。 */
  RESUME: 'task-reliability/resume',
})

/**
 * 发出插件事件（best-effort）。
 * @param ctx cordis 上下文（shared.ctx）
 * @param name 事件名（PLUGIN_EVENTS 之一）
 * @param payload { sessionId, action, reason, ...params }
 */
export function emitPluginEvent(ctx: DshContext, name: string, payload: AnyObject): void {
  try {
    ctx.emit(name, payload)
  } catch {
    // best-effort：事件审计失败不影响主流程
  }
}
