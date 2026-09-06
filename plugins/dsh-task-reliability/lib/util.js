/**
 * dsh-task-reliability — base utilities.
 *
 * 最底层工具模块：不依赖任何其他 lib 模块（仅标准库全局）。
 * 提供 ID 生成、延时、超时包装、请求头读取与消息构造。
 * withTimeout / userMessage 由 dsh-shared 提供（issue #45 抽取），
 * 此处 re-export 保持本模块 API 面不变。
 */
export { withTimeout, userMessage } from 'dsh-shared'

export function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** 从消息 content blocks 提取文本并拼接（带 trim）。 */
export function blocksText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(
      (block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** options → 可序列化纯对象（retryableCodes Set → 数组），供 patch 文件写入/API 回填。 */
export function configToPlain(options) {
  return {
    apiToken: options.apiToken,
    retryMax: options.retryMax,
    maxLoop: options.maxLoop,
    maxVerify: options.maxVerify,
    retryableCodes: [...options.retryableCodes],
    retryBaseMs: options.retryBaseMs,
    autopilot: options.autopilot,
    steerCooldownMs: options.steerCooldownMs,
    saveDebounceMs: options.saveDebounceMs,
    resumeGraceMs: options.resumeGraceMs,
    rateMaxActions: options.rateMaxActions,
    askTimeoutMs: options.askTimeoutMs,
    autopilotGraceMs: options.autopilotGraceMs,
    watchdogIntervalMs: options.watchdogIntervalMs,
    stallTimeoutMs: options.stallTimeoutMs,
    rescueOnTruncation: options.rescueOnTruncation,
    rescueMaxPerSession: options.rescueMaxPerSession,
    rescueCooldownMs: options.rescueCooldownMs,
  }
}
