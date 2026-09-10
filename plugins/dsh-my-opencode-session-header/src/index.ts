/**
 * dsh-my-opencode-session-header — OpenCode Go 网关会话头注入（server 端）。
 *
 * 问题：opencode.ai（OpenCode Go 网关）要求每个推理请求携带
 * `x-opencode-session`，否则返回 400 MissingSessionID；DSH 的 pi-ai 适配器
 * 从不发这个头，且 DSH 的 `headers` 配置是静态字符串字典（无插值）、
 * session 头名写死——纯配置不可行。
 *
 * 方案（唯一可用拦截点）：
 *  1. `ctx.on('llm/stream', ...)`（waterfall）同步包装流，用 AsyncLocalStorage
 *     携带 { provider, 会话头值 }（options 同时带 provider 与 sessionId）；
 *  2. 安装单层 `globalThis.fetch` 补丁：请求的 provider 命中白名单且目标
 *     主机命中配置时，注入会话头（已有同名头默认不覆盖）。
 *
 * 会话头值确定性：同会话跨轮次 / 压缩 / 重试 / 重启得到同一个值。
 * 任何内部异常都吞掉并降级为原行为，绝不影响推理请求。
 */
import { resolveConfig, type Config, type ValueMode } from './config.js'
import { wrapStreamWithContext, type SessionStore } from './context.js'
import { installFetchPatch } from './fetch-patch.js'
import { sessionValueOf } from './session-value.js'
import type { DshContext } from './types.js'

export const name = 'dsh-my-opencode-session-header'

/** 插件配置（与 cordis.patch.yml 的 config 对应）。 */
export type { Config } from './config.js'

export function apply(ctx: DshContext, config?: Config | null): void {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return
  const warnOnce = createWarnOnce(ctx)
  ctx.on('llm/stream', (options: unknown, next: () => unknown) => handleStream(options, next, cfg.valueMode))
  ctx.effect(
    () =>
      installFetchPatch({
        providers: cfg.providers,
        hosts: cfg.hosts,
        headerName: cfg.headerName,
        override: cfg.override,
        warnOnce,
      }),
    'dsh-my-opencode-session-header: fetch patch',
  )
  ctx.logger?.info?.(
    `[opencode-session-header] active for providers [${cfg.providers.join(', ')}] with valueMode ${cfg.valueMode}`,
  )
}

/**
 * llm/stream waterfall handler：**必须是同步函数**（async 会让 waterfall
 * 返回 Promise，破坏下游 `yield*` 委托），先取流再决定是否包装。
 */
function handleStream(options: unknown, next: () => unknown, valueMode: ValueMode): unknown {
  const stream = next()
  const sessionId = stringOf(propertyOf(options, 'sessionId'))
  if (sessionId === '') return stream
  const store: SessionStore = {
    provider: stringOf(propertyOf(options, 'provider')),
    value: sessionValueOf(sessionId, valueMode),
  }
  return wrapStreamWithContext(store, stream)
}

/** 退化告警（首次出现时 warn 一次，之后静默）。 */
function createWarnOnce(ctx: DshContext): (message: string) => void {
  let warned = false
  return (message: string) => {
    if (warned) return
    warned = true
    ctx.logger?.warn?.(message)
  }
}

/** 属性读取（非对象或不可读时返回 undefined）。 */
function propertyOf(target: unknown, key: string): unknown {
  if (target === null || typeof target !== 'object') return undefined
  return (target as Record<string, unknown>)[key]
}

/** 字符串读取（非字符串返回空串）。 */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
