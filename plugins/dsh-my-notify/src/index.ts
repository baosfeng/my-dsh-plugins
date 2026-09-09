/**
 * dsh-my-notify — host half.
 *
 * Watches DSH agent lifecycle events and broadcasts browser notices through a
 * Server-Sent Events (SSE) channel to every subscribed client tab:
 *
 *  - `agent/status` idle           → kind `end`      （本轮对话结束）
 *  - `tools/pre-execute` 命中 ask  → kind `ask`      （等待用户回答问题）
 *  - `approval/request`            → kind `approval`（等待用户批准）
 *
 * 所有约定均为「只读观察」：对 waterfall 事件（tools/pre-execute、
 * approval/request）只调用 next() 透传，绝不改变工具/审批流程。
 *
 * 远程 hook 扩展接口：`POST /notify/api/trigger` —— 任意本机进程（或经
 * 反向代理 + 配置 apiToken 的远程服务）可以推送自定义通知 `kind: remote`，
 * 与内建触发共用同一条 SSE 广播通道，后续扩展（cron、CI、其他插件）都走
 * 这里。
 *
 * 通道：
 *  - GET  /notify/api/stream  — SSE 长连接（EventSource 消费）
 *  - GET  /notify/api/info    — 当前触发开关（供客户端/调试）
 *  - POST /notify/api/trigger — 远程触发（webhook）
 *
 * 安全：所有请求先做 loopback 信任围栏（与 /api 网关一致的契约）；配置
 * `apiToken` 后 trigger 额外要求 `x-notify-token` 头，供远程主机调用。
 *
 * 注意：可选服务（webRuntime / sessionTitle）一律经 `ctx.get` 读取——未
 * 注入时对 Cordis Context 做属性访问不可靠。
 *
 * 模块结构（按职责拆分，P2 G12b）：
 *  - fence.js     — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - session.ts   — 会话信息 helper（顶层判定 / 标题 / ask 摘要）
 *  - notice.ts    — SSE 客户端集合 + 通知构造 + 去重 + 心跳
 *  - listeners.ts — 事件监听（agent/status、tools/pre-execute、approval/request）
 *  - routes.ts    — /notify/api 路由（stream / trigger / info / config / webhooks）
 *  - webhook/     — 出站 webhook（issue #92）：adapters.ts 渠道适配
 *    （formatMessage / sign）、pusher.ts 推送调度（超时/重试/失败记录）
 *  - webhook-store.ts — webhooks 配置持久化（JSON 文件）+ 失败记录
 */
import { createNoticeBus } from './notice.js'
import { attachListeners } from './listeners.js'
import { createTokenMeter } from './token-meter.js'
import { registerNotifyRoutes } from './routes.js'
import { createWebhookStore } from './webhook-store.js'
import { dispatchWebhooks } from './webhook/pusher.js'
import { currentProfile, patchFileOf, profileDirOf, writePatchConfig } from 'dsh-shared'
import { join } from 'node:path'
import type { DshContext, NoticeFrame, NotifyOptions, PluginConfig, TokenMeter, WebhookConfig } from './types.js'

export const name = 'dsh-my-notify'

export const inject = ['webServer']

export function apply(ctx: DshContext, config: PluginConfig): void {
  // ── 配置（应用层 config 覆盖，默认全部开启）─────────────────────────
  const options: NotifyOptions = buildOptions(config)

  // ── 出站 webhook 存储：JSON 文件持久化 + 失败记录（issue #92）──────
  const webhookStore = createWebhookStore({
    file: join(profileDirOf(currentProfile()), 'notify-webhooks.json'),
    logger: ctx.logger,
  })
  // 应用层 config（cordis.patch.yml）优先；否则从 JSON 文件加载
  // （设置页保存的 webhooks，重启恢复）。
  options.webhooks = Array.isArray(config?.webhooks) ? config.webhooks : webhookStore.load()

  // ── 会话 token 计量：跨配置重载共享，end 通知取全量 usage（issue #109）───
  const tokenMeter: TokenMeter = createTokenMeter()

  // ── 通知总线：客户端集合 + 去重 + 心跳，监听与路由共享 ──────────────
  const bus = createNoticeBus(options)

  // 通知出口：广播 SSE 的同时按配置分发到出站 webhook（异步推送，
  // 不阻塞事件路径；失败记录进 store，设置页可见）。
  //
  // 子代理通知统一过滤（issue #112）：`agentType: 'subagent'` 的通知帧仅在
  // `subagentEnd` 开启时才广播。过滤集中在这个出口做，SSE（bus.emitNotice）
  // 与 webhook（dispatchWebhooks）两条通道行为一致，都继承全局开关——即使
  // 上游误判把子代理当顶层产生子代理标记帧，也无法绕过开关双通道轰炸。
  const emitNotice = (notice: NoticeFrame): void => {
    if (notice?.agentType === 'subagent' && !options.subagentEnd) return
    bus.emitNotice(notice)
    dispatchWebhooks(options.webhooks, notice, {
      onFailure: (failure) => webhookStore.failures.add(failure),
      formatOpts: { askFull: options.askMode !== 'summary' },
    })
  }

  // ── 事件监听（只读观察；waterfall 一律透传 next()）──────────────────
  let listenerDisposers = attachListeners(ctx, options, emitNotice, tokenMeter)

  // 配置保存：持久化到 profile patch 文件 + 更新内存 + 重载监听器。
  // patch 文件写入完整配置（当前值 + 新值合并），重启后完整恢复；
  // DSH 的 watchUserPatches 会热重载 patch 文件（保存即生效）。
  // webhooks 是对象数组（patch YAML 子集无法表达），单独写 JSON 文件。
  const onConfigChange = async (next: Partial<NotifyOptions>): Promise<void> => {
    const merged = { ...options, ...next }
    await writePatchConfig(patchFileOf(currentProfile()), 'notify', patchConfigOf(merged))
    if (next.webhooks !== undefined) {
      options.webhooks = next.webhooks
      await webhookStore.save(next.webhooks)
    }
    Object.assign(options, next)
    for (const dispose of listenerDisposers.splice(0)) dispose()
    listenerDisposers = attachListeners(ctx, options, emitNotice, tokenMeter)
  }

  // ── 路由（SSE / trigger / info / config / webhooks + 心跳清理）──────
  registerNotifyRoutes(ctx, options, bus, onConfigChange, emitNotice, webhookStore)
}

/** 应用层配置 → options（默认值 + 类型规整）。 */
function buildOptions(config: PluginConfig): NotifyOptions {
  const c = config ?? {}
  return {
    end: notFalse(c.end),
    ask: notFalse(c.ask),
    approval: notFalse(c.approval),
    subagentEnd: whenTrue(c.subagentEnd),
    askMode: c.askMode === 'summary' ? 'summary' : 'full',
    webBaseUrl: str(c.webBaseUrl),
    apiToken: str(c.apiToken),
    dedupeMs: num(c.dedupeMs, 3000),
    webhooks: [],
  }
}

/** 布尔开关默认开启：缺省/true → true，false → false。 */
function notFalse(value: unknown): boolean {
  return value !== false
}

/** 仅显式 true 才开启（subagentEnd/子代理）。 */
function whenTrue(value: unknown): boolean {
  return value === true
}

/** 字符串字段规整：缺失/非字符串回退空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 数值字段规整：非有限回退 fallback。 */
function num(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

/** 从 patch 配置中剥离 webhooks（对象数组无法 YAML 子集序列化）。 */
function patchConfigOf(merged: NotifyOptions): Record<string, unknown> {
  const rest = { ...merged } as Record<string, unknown>
  delete rest.webhooks
  return rest
}
