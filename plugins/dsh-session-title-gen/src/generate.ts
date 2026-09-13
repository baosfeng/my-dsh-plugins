/**
 * dsh-session-title-gen — 单会话标题生成流程（issue #232 拆分：控制 apply 体量）。
 *
 * 纯逻辑 + 注入依赖：宿主 ctx 不再参与，便于测试与审查。
 */

import { workspaceNameOf } from './workspace.js'
import { foldTitle, generateTitle, isStructuredTitle, sessionEvents } from './title.js'
import type { TitleConfig } from './title.js'
import type { LlmService, Session, SessionEvent } from './types.js'

/** 本插件写入标题的 source.provider 标识。 */
export const PROVIDER_ID = 'dsh-session-title-gen'

/** generateSessionTitle 的输入。 */
export interface GenerateSessionInput {
  session: Session
  llm: LlmService
  warn: (message: string) => void
  config: TitleConfig
}

/**
 * Generate and append the structured title for one session.
 *
 * 任何失败都不 append（核心标题保留、不阻塞会话），但会经 `warn` 留下痕迹。
 * @param input - { session, llm, warn, config }.
 */
export async function generateSessionTitle({ session, llm, warn, config }: GenerateSessionInput): Promise<void> {
  try {
    const cwd = session.header?.cwd
    const workspace = await workspaceNameOf(cwd)
    if (workspace === '') {
      // 不接受"静默无前缀"（issue #232）：取不到工作区名时把事实写进日志，
      // 让"标题缺 [工作区] 前缀"可被发现、可排查，而不是无声降级。
      warn(
        `session "${session.id}": no workspace name resolved (session header cwd=${
          typeof cwd === 'string' ? JSON.stringify(cwd) : String(cwd)
        }); the generated title carries no [workspace] prefix`,
      )
    }
    const messages = collectMessages(session)
    if (messages.length === 0) return
    const route = routeOf(session)
    const signal = AbortSignal.any([AbortSignal.timeout(config.timeoutMs)])
    const result = await generateTitle({ llm }, { session, workspace, messages, route, signal, config })
    session.append('session/title', {
      title: result.title,
      messageSeqs: messages.map((message) => message.seq),
      source: { kind: 'provider', provider: PROVIDER_ID, model: result.model },
    })
  } catch (error) {
    warn(`session "${session.id}": structured title generation failed: ${String(error)}`)
  }
}

/** 是否跳过生成：已有我们生成的 / 用户手动 / 结构化标题。 */
export function shouldSkip(session: Session): boolean {
  const current = foldTitle(session)
  if (current === undefined) return false
  if (current.source?.kind === 'user') return true
  if (current.source?.provider === PROVIDER_ID) return true
  return isStructuredTitle(current.title)
}

/** 是否为人类用户消息（过滤插件注入）。 */
export function isUserMessage(event: SessionEvent): boolean {
  return event?.data?.source?.kind === 'user'
}

/** 收集会话中人类用户消息（文本 + seq）。 */
export function collectMessages(session: Session): Array<{ seq: number; text: string }> {
  const messages: Array<{ seq: number; text: string }> = []
  for (const event of sessionEvents(session) as SessionEvent[]) {
    if (!isUserMessage(event)) continue
    const text = textOf(event)
    if (text === '') continue
    messages.push({ seq: event.seq, text })
  }
  return messages
}

/** 提取 user/message 事件的文本内容（text blocks 拼接）。 */
function textOf(event: SessionEvent): string {
  const blocks = event.data?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim()
}

/** 会话请求路由（provider/model），无则 undefined。 */
function routeOf(session: Session): { provider?: string; model?: string } | undefined {
  const config = session.requestHeader?.()?.config
  if (config === null || typeof config !== 'object') return undefined
  return { provider: config.provider, model: config.model }
}
