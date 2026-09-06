/**
 * dsh-session-title-gen — structured session title generation (issue #160).
 *
 * 监听会话首条人类消息，用 LLM 生成类似 git commit 的结构化标题
 * （先归属后描述，如 `[my-dsh-plugins] 修复 #143 记忆页签崩溃`），经核心
 * `session/title` 事件写入（log-backed，重启保留）。
 *
 * 与核心 dsh-session-title 的协作：
 *  - 核心 bundle 已注册唯一 provider（session-title-first-prompt-llm），
 *    本插件不注册 provider，直接 append session/title 事件覆盖；
 *  - 核心 fallback/provider 生成的非结构化标题会触发本插件重新生成
 *    （监听 session/title 事件兜底竞态）；
 *  - 生成失败不 append（核心标题保留，不阻塞会话）。
 */

import { workspaceNameOf } from './workspace.js'
import { DEFAULT_TEMPLATE, foldTitle, generateTitle, isStructuredTitle } from './title.js'

export const name = 'dsh-session-title-gen'
export const inject = ['llm']

/** 本插件写入标题的 source.provider 标识。 */
const PROVIDER_ID = 'dsh-session-title-gen'

/** 默认配置（可被 cordis.patch.yml config 覆盖）。 */
const DEFAULTS = {
  enabled: true,
  template: DEFAULT_TEMPLATE,
  provider: undefined,
  model: undefined,
  maxTitleBytes: 80,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 30000,
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return
  const state = new Map()

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'user/message') {
      if (!isUserMessage(event)) return
      return maybeGenerate(session)
    } else if (event?.type === 'session/title') {
      return maybeGenerate(session)
    }
  })

  ctx.effect(
    () => () => {
      state.clear()
    },
    'dsh-session-title-gen: state lifecycle',
  )

  /** 生成结构化标题（fire-and-forget；任何失败静默回退核心机制）。 */
  async function maybeGenerate(session) {
    if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return
    if (shouldSkip(session)) return
    if (state.get(session.id)?.generating) return
    const promise = doGenerate(session)
    state.set(session.id, { generating: promise })
    try {
      await promise
    } finally {
      state.delete(session.id)
    }
  }

  /** 执行生成：解析工作区名 → LLM 生成 → append session/title。 */
  async function doGenerate(session) {
    try {
      const workspace = await workspaceNameOf(session.header?.cwd)
      const messages = collectMessages(session)
      if (messages.length === 0) return
      const route = routeOf(session)
      const signal = AbortSignal.any([AbortSignal.timeout(cfg.timeoutMs)])
      const result = await generateTitle(ctx, { session, workspace, messages, route, signal, config: cfg })
      session.append('session/title', {
        title: result.title,
        messageSeqs: messages.map((message) => message.seq),
        source: { kind: 'provider', provider: PROVIDER_ID, model: result.model },
      })
    } catch (error) {
      ctx.logger?.warn?.(`session "${session.id}": structured title generation failed: ${String(error)}`)
    }
  }
}

/** 是否跳过生成：已有我们生成的 / 用户手动 / 结构化标题。 */
function shouldSkip(session) {
  const current = foldTitle(session)
  if (current === undefined) return false
  if (current.source?.kind === 'user') return true
  if (current.source?.provider === PROVIDER_ID) return true
  return isStructuredTitle(current.title)
}

/** 是否为人类用户消息（过滤插件注入）。 */
function isUserMessage(event) {
  return event?.data?.source?.kind === 'user'
}

/** 收集会话中人类用户消息（文本 + seq）。 */
function collectMessages(session) {
  const events = session?.events
  if (!Array.isArray(events)) return []
  const messages = []
  for (const event of events) {
    if (!isUserMessage(event)) continue
    const text = textOf(event)
    if (text === '') continue
    messages.push({ seq: event.seq, text })
  }
  return messages
}

/** 提取 user/message 事件的文本内容（text blocks 拼接）。 */
function textOf(event) {
  const blocks = event.data?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** 会话请求路由（provider/model），无则 undefined。 */
function routeOf(session) {
  const config = session.requestHeader?.()?.config
  if (config === null || typeof config !== 'object') return undefined
  return { provider: config.provider, model: config.model }
}

/** 配置解析：缺省值 + 类型护栏。 */
function resolveConfig(config) {
  const candidate = config ?? {}
  return {
    enabled: candidate.enabled !== false,
    template: nonEmptyString(candidate.template, DEFAULTS.template),
    provider: nonEmptyString(candidate.provider, DEFAULTS.provider),
    model: nonEmptyString(candidate.model, DEFAULTS.model),
    maxTitleBytes: positiveInt(candidate.maxTitleBytes, DEFAULTS.maxTitleBytes),
    maxInputBytes: positiveInt(candidate.maxInputBytes, DEFAULTS.maxInputBytes),
    maxOutputTokens: positiveInt(candidate.maxOutputTokens, DEFAULTS.maxOutputTokens),
    timeoutMs: positiveInt(candidate.timeoutMs, DEFAULTS.timeoutMs),
  }
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value !== '' ? value : fallback
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
