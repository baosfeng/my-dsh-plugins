/**
 * dsh-my-notify — 五类事件的默认文案与文案渲染（服务端广播前统一渲染）。
 *
 * 设计要点：
 *  - **默认值即「保持原字段」**：默认 title 模板为 `{{session.title}}`、默认
 *    body 模板为该事件原有的摘要字段，因此未配置 messages 时通知帧的
 *    title / note 与历史行为逐字一致（设置页升级不会突然改写文案）；
 *  - **空串不覆盖默认**：用户在 messages 里清空某项时，该项回退 `defaults.ts`
 *    的默认模板，绝不用空串顶替（否则页面 toast 会整条变空）；
 *  - **fail-open**：模板非法 / 渲染异常 → 原样回退通知帧原值，推送路径不抛错。
 *
 * 渲染时机（契约）：`emitNotice` 广播前就把 title / note 渲染成最终文本，
 * client 端不再实现模板引擎——页面 toast 与系统通知直接显示渲染后的值。
 */
import type { MessagesConfig, NoticeFrame, ResolvedMessages } from '../types.js'
import { buildVars } from './vars.js'
import { render } from './template.js'

/** 默认文案（五类事件；占位符即新语法变量）。 */
export const DEFAULT_MESSAGES: ResolvedMessages = {
  end: { title: '{{session.title}}', body: '{{event.note}}' },
  ask: { title: '{{session.title}}', body: '{{ask.summary}}' },
  approval: { title: '{{session.title}}', body: '{{approval.reason}}' },
  subagentEnd: { title: '{{session.title}}', body: '{{event.note}}' },
  remote: { title: '{{session.title}}', body: '{{event.note}}' },
}

/** 文案键（事件类型 + 子代理 end 独立成键）。 */
const MESSAGE_KEYS = ['end', 'ask', 'approval', 'subagentEnd', 'remote'] as const

/** 文案键（设置页 / 预览接口共用）。 */
export type MessageKey = (typeof MESSAGE_KEYS)[number]

/**
 * 把用户配置的 messages 逐字段合并到默认文案（fail-open：非字符串 / 空串
 * 一律回退默认值，非法对象回退全部默认值）。
 *
 * @example
 *   resolveMessages({ end: { title: '会话结束' } }).end
 *   // → { title: '会话结束', body: '{{event.note}}' }
 */
export function resolveMessages(value: unknown): ResolvedMessages {
  const result: ResolvedMessages = cloneDefaults()
  if (value === null || typeof value !== 'object') return result
  const source = value as Record<string, unknown>
  for (const key of MESSAGE_KEYS) {
    const item = source[key]
    if (item === null || typeof item !== 'object') continue
    const templates = item as Record<string, unknown>
    result[key] = {
      title: pickTemplate(templates.title, DEFAULT_MESSAGES[key].title),
      body: pickTemplate(templates.body, DEFAULT_MESSAGES[key].body),
    }
  }
  return result
}

/** 深拷贝默认文案（避免调用方改到常量）。 */
function cloneDefaults(): ResolvedMessages {
  return {
    end: { ...DEFAULT_MESSAGES.end },
    ask: { ...DEFAULT_MESSAGES.ask },
    approval: { ...DEFAULT_MESSAGES.approval },
    subagentEnd: { ...DEFAULT_MESSAGES.subagentEnd },
    remote: { ...DEFAULT_MESSAGES.remote },
  }
}

/** 单个模板取值：非字符串 / 空串 → 默认模板。 */
function pickTemplate(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/**
 * 事件 → 文案键：end 且 agentType 为 subagent 时用 subagentEnd 模板，
 * 未知事件回退 remote。
 */
export function messageKeyOf(kind: string | undefined, agentType?: 'top' | 'subagent'): MessageKey {
  if (kind === 'end') return agentType === 'subagent' ? 'subagentEnd' : 'end'
  if (kind === 'subagentEnd' || kind === 'ask' || kind === 'approval' || kind === 'remote') return kind
  return 'remote'
}

/** 文案渲染上下文（渠道信息 + 插件版本）。 */
export interface RenderContext {
  /** 渠道标识（notify.channel）。 */
  channel?: string
  /** 插件版本（缺省读 package.json）。 */
  pluginVersion?: string
}

/**
 * 渲染一条通知帧的 title / note（fail-open：异常时原样返回入参）。
 *
 * @example
 *   renderNoticeMessages({ kind: 'end', title: '演示项目' }, resolveMessages({}), { channel: 'browser' })
 *   // → { title: '演示项目', note: '' }
 */
export function renderNoticeMessages(
  notice: NoticeFrame,
  messages: ResolvedMessages,
  context: RenderContext = {},
): NoticeFrame {
  try {
    const template = messages[messageKeyOf(notice.kind, notice.agentType)]
    const vars = buildVars({
      ...notice,
      channel: context.channel ?? '',
      pluginVersion: context.pluginVersion ?? '',
    })
    const preserve = Array.isArray(notice.preserve) ? notice.preserve : []
    return {
      ...notice,
      // 用户显式给出的 title / body 优先于模板（远程触发契约），不被覆盖
      title: preserve.includes('title') ? notice.title : render(template.title, vars),
      note: preserve.includes('note') ? notice.note : render(template.body, vars),
    }
  } catch {
    // 渲染尽力而为：任何异常都回退原始帧，绝不打断推送路径
    return notice
  }
}
