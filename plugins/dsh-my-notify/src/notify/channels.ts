/**
 * dsh-my-notify — 各出站渠道的高级格式化（wecom / feishu / dingtalk / generic）。
 *
 * 统一流程：buildVars（变量快照）→ render（titleTemplate / bodyTemplate /
 * 旧 template）→ 按渠道 + msgType 组装消息 JSON：
 *  - wecom    企业微信群机器人：text / markdown
 *  - feishu   飞书自定义机器人：text / post / **interactive（卡片）**
 *  - dingtalk 钉钉自定义机器人：text / markdown
 *  - generic  通用中转：原始通知帧（可附渲染后的 message）
 *
 * 兼容性：旧字段 `template` 仍然生效（bodyTemplate 未配置时作为正文模板），
 * 旧模板语法 `{title}` 由 template.ts 的别名表解析；默认富格式正文（类型 +
 * token / 耗时 / 链接、审批工具名）逐字保持不变。
 *
 * 纯函数：不发起网络请求、不读环境；未知渠道 / 未知 msgType 一律降级为
 * generic / text，绝不抛错。
 */
import type { NoticeFrame, TokenUsage, WebhookConfig } from '../types.js'
import { buildVars, kindLabel } from './vars.js'
import { render } from './template.js'
import { buildFeishuCard, type CardField } from './card.js'
import { normalizeCard } from './config.js'

/** 渠道消息体。 */
export type ChannelBody = Record<string, unknown>

/** 格式化选项：ask 是否展开完整问题；插件版本（notify.pluginVersion）。 */
export interface ChannelFormatOpts {
  /** false 时 ask 正文回退问题摘要（默认 true = 完整问题）。 */
  askFull?: boolean
  /** 插件版本（缺省读 package.json）。 */
  pluginVersion?: string
}

/** 渠道类型：webhook 配置字段为 channel（兼容 type 别名）。 */
function channelType(channel: WebhookConfig | Record<string, unknown>): string | undefined {
  const c = channel as Record<string, unknown>
  return (c.channel as string) ?? (c.type as string)
}

/** 通知摘要：note 优先，回退 toolName，再回退空串。 */
function noticeNote(notice: NoticeFrame): string {
  if (typeof notice.note === 'string' && notice.note !== '') return notice.note
  if (typeof notice.toolName === 'string' && notice.toolName !== '') return notice.toolName
  return ''
}

/** ask 主内容：默认完整问题（多问题全部列出），`opts.askFull === false` 时回退摘要。 */
function askContent(notice: NoticeFrame, opts?: ChannelFormatOpts): string {
  const full = typeof notice.question === 'string' && notice.question !== ''
  if (full && opts?.askFull !== false) return notice.question!
  return noticeNote(notice)
}

/** 消息正文内容：ask 用完整问题（或摘要），approval 用原因，其余用 note。 */
function noticeContent(notice: NoticeFrame, opts?: ChannelFormatOpts): string {
  if (notice.kind === 'ask') return askContent(notice, opts)
  if (notice.kind === 'approval') return typeof notice.note === 'string' ? notice.note : ''
  return noticeNote(notice)
}

/** 消息正文行：`类型：内容`（内容为空时只显示类型）。 */
function noticeLine(notice: NoticeFrame, opts?: ChannelFormatOpts): string {
  const label = kindLabel(notice.kind)
  const content = noticeContent(notice, opts)
  return content !== '' ? `${label}：${content}` : label
}

/** 富格式附加行（end：token/耗时/链接；approval：工具名）。 */
function enrichLines(notice: NoticeFrame): string[] {
  const lines: string[] = []
  if (notice.kind === 'end') {
    const tokens = tokensLine(notice.tokens)
    if (tokens !== '') lines.push(`token 消耗：${tokens}`)
    const duration = durationLine(notice.duration)
    if (duration !== '') lines.push(`会话耗时：${duration}`)
    if (typeof notice.sessionUrl === 'string' && notice.sessionUrl !== '') {
      lines.push(`会话链接：${notice.sessionUrl}`)
    }
  }
  if (notice.kind === 'approval') {
    if (typeof notice.toolName === 'string' && notice.toolName !== '') {
      lines.push(`调用工具：${notice.toolName}`)
    }
  }
  return lines
}

/** token 消耗文本（无数据 → 「不可用」）。 */
function tokensLine(tokens: TokenUsage | null | undefined): string {
  if (tokens === null || tokens === undefined || typeof tokens !== 'object') return '不可用'
  const input = nonNegative(tokens.input)
  const output = nonNegative(tokens.output)
  const total = nonNegative(tokens.total)
  if (input === 0 && output === 0 && total === 0) return '不可用'
  return `输入 ${input} / 输出 ${output} / 总计 ${total}`
}

/** 会话耗时文本：秒 / 分秒 / 时分秒；无耗时返回空串。 */
function durationLine(duration: unknown): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return ''
  const totalSeconds = Math.round(duration)
  if (totalSeconds === 0) return '0 秒'
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  if (totalSeconds < 3600) {
    const min = Math.floor(totalSeconds / 60)
    const sec = totalSeconds % 60
    return sec !== 0 ? `${min} 分 ${sec} 秒` : `${min} 分`
  }
  const hour = Math.floor(totalSeconds / 3600)
  const min = Math.floor((totalSeconds % 3600) / 60)
  return `${hour} 小时 ${min} 分`
}

/** 非负数值，非法回退 0。 */
function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 消息标题（回退「DSH 通知」）。 */
function noticeTitle(notice: NoticeFrame): string {
  return typeof notice.title === 'string' && notice.title !== '' ? notice.title : 'DSH 通知'
}

/** 默认消息正文：`类型：内容` + 附加行。 */
export function messageLine(notice: NoticeFrame, opts?: ChannelFormatOpts): string {
  return [noticeLine(notice, opts), ...enrichLines(notice)].filter((line) => line !== '').join('\n')
}

/**
 * 卡片字段短键 → 变量全名（设置页卡片设计器保存的是 token / duration / tool /
 * question / link 这类短键，渲染时要映射回模板变量）。
 */
const FIELD_ALIASES: Record<string, string> = {
  token: 'tokens.text',
  duration: 'session.durationText',
  tool: 'tool.name',
  question: 'ask.question',
  link: 'session.url',
}

/** 卡片字段键解析：短键映射为变量全名，已是全名则原样返回。 */
export function fieldVarOf(name: string): string {
  return FIELD_ALIASES[name] ?? name
}

/** 卡片字段短标签（card.fields 里的变量名 → 卡片显示名）。 */
const FIELD_LABELS: Record<string, string> = {
  'session.title': '会话',
  'session.id': '会话 ID',
  'session.url': '会话链接',
  'session.cwd': '工作目录',
  'session.model': '模型',
  'session.provider': '供应商',
  'session.agentLevel': '会话层级',
  'session.preset': 'Preset',
  'session.durationText': '会话耗时',
  'session.durationSeconds': '会话耗时（秒）',
  'event.name': '事件',
  'event.note': '摘要',
  'event.time': '时间',
  'ask.question': '问题',
  'ask.summary': '问题摘要',
  'ask.count': '问题数',
  'tool.name': '工具',
  'approval.reason': '审批原因',
  'tokens.text': 'Token 消耗',
  'tokens.total': 'Token 总数',
  'tokens.input': '输入 token',
  'tokens.output': '输出 token',
  'tokens.cacheRead': '缓存命中',
  'tokens.cacheWrite': '缓存写入',
  'tokens.reasoning': '推理 token',
  'tokens.requests': '请求数',
}

/** 字段短标签（未知变量名回退原变量名）。 */
export function fieldLabelOf(name: string): string {
  const key = fieldVarOf(name)
  return FIELD_LABELS[key] ?? key
}

/** 把 card.fields（变量名列表）解析为卡片字段（缺值 / 空值跳过）。 */
function resolveCardFields(names: string[], vars: Record<string, string>): CardField[] {
  const fields: CardField[] = []
  for (const name of names) {
    const value = vars[fieldVarOf(name)]
    if (value === undefined || value.trim() === '') continue
    fields.push({ label: fieldLabelOf(name), value })
  }
  return fields
}

/**
 * 按渠道格式化一条通知（唯一的渠道组装入口）。
 *
 * @example
 *   formatChannelMessage({ channel: 'feishu', msgType: 'interactive' }, notice)
 *   // → { msg_type: 'interactive', card: { schema: '2.0', ... } }
 */
export function formatChannelMessage(
  channel: WebhookConfig,
  notice: NoticeFrame,
  opts: ChannelFormatOpts = {},
): ChannelBody {
  const type = channelType(channel)
  const msgType = channel.msgType ?? 'text'
  const vars = buildVars({ ...notice, channel: type ?? '', pluginVersion: opts.pluginVersion ?? '' })
  const title = resolveTitle(channel, vars, notice)
  if (type === 'feishu' && msgType === 'interactive') return feishuCardBody(channel, notice, title, vars)
  return templateOrDefault(channel, notice, opts, { type, msgType, title, vars })
}

/** 已解析的标题 / 正文上下文（拆分函数间传递，避免重复计算）。 */
interface BodyContext {
  type: string | undefined
  msgType: string
  title: string
  vars: Record<string, string>
}

/** 有正文模板 → 用渲染结果；否则走渠道默认富格式。 */
function templateOrDefault(
  channel: WebhookConfig,
  notice: NoticeFrame,
  opts: ChannelFormatOpts,
  context: BodyContext,
): ChannelBody {
  const templateText = resolveBodyTemplate(channel, context.vars)
  if (templateText !== '') return wrapContent(context.type, context.msgType, context.title, templateText, notice)
  return defaultBody(context.type, context.msgType, context.title, notice, opts)
}

/** 渠道默认消息体（未知渠道按 generic 处理，尽力而为不打断推送路径）。 */
function defaultBody(
  type: string | undefined,
  msgType: string,
  title: string,
  notice: NoticeFrame,
  opts: ChannelFormatOpts,
): ChannelBody {
  if (type === 'generic') return { ...notice } as ChannelBody
  const line = messageLine(notice, opts)
  if (type === 'wecom') return wecomMessage(msgType, title, line)
  if (type === 'feishu') return feishuMessage(msgType, title, line)
  if (type === 'dingtalk') return dingtalkMessage(msgType, title, line)
  return { ...notice } as ChannelBody
}

/** 标题：titleTemplate 渲染优先，空渲染结果回退会话标题。 */
function resolveTitle(channel: WebhookConfig, vars: Record<string, string>, notice: NoticeFrame): string {
  const rendered = render(channel.titleTemplate, vars).trim()
  return rendered !== '' ? rendered : noticeTitle(notice)
}

/** 正文模板：bodyTemplate 优先，旧 template 兜底；均未配置返回空串。 */
function resolveBodyTemplate(channel: WebhookConfig, vars: Record<string, string>): string {
  const template = channel.bodyTemplate ?? channel.template
  if (typeof template !== 'string' || template === '') return ''
  return render(template, vars)
}

/** 飞书 interactive 卡片消息体（配置全 fail-open，缺省值来自 config.ts）。 */
function feishuCardBody(
  channel: WebhookConfig,
  notice: NoticeFrame,
  title: string,
  vars: Record<string, string>,
): ChannelBody {
  const card = normalizeCard(channel.card)
  const content = resolveBodyTemplate(channel, vars) || messageLine(notice)
  return {
    msg_type: 'interactive',
    card: buildFeishuCard({
      kind: notice.kind,
      agentType: notice.agentType,
      title,
      content,
      fields: resolveCardFields(card.fields ?? [], vars),
      buttonText: card.buttonText ?? '',
      sessionUrl: typeof notice.sessionUrl === 'string' ? notice.sessionUrl : '',
      mentionOpenIds: card.mentionOpenIds ?? [],
      mentionAll: card.mentionAll === true,
      template: card.template ?? '',
      accentByKind: card.accentByKind !== false,
      schemaVersion: card.schemaVersion === '1.0' ? '1.0' : '2.0',
      time: notice.time,
    }),
  }
}

/** 完整文本 → 渠道消息 JSON（title 仅作为 post/markdown 元数据，content 用已渲染文本）。 */
function wrapContent(
  type: string | undefined,
  msgType: string,
  title: string,
  text: string,
  notice: NoticeFrame,
): ChannelBody {
  if (type === 'wecom') {
    if (msgType === 'markdown') return { msgtype: 'markdown', markdown: { content: text } }
    return { msgtype: 'text', text: { content: text } }
  }
  if (type === 'feishu') {
    if (msgType === 'post') {
      return {
        msg_type: 'post',
        content: { post: { zh_cn: { title, content: [[{ tag: 'text', text }]] } } },
      }
    }
    return { msg_type: 'text', content: { text } }
  }
  if (type === 'dingtalk') {
    if (msgType === 'markdown') {
      return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${text}` } }
    }
    return { msgtype: 'text', text: { content: text } }
  }
  return { ...(notice as unknown as ChannelBody), message: text }
}

/** 企微消息：text / markdown。 */
function wecomMessage(msgType: string, title: string, line: string): ChannelBody {
  if (msgType === 'markdown') {
    return { msgtype: 'markdown', markdown: { content: `**${title}**\n${line}` } }
  }
  return { msgtype: 'text', text: { content: `${title}\n${line}` } }
}

/** 飞书消息：text / post（interactive 走 feishuCardBody）。 */
function feishuMessage(msgType: string, title: string, line: string): ChannelBody {
  if (msgType === 'post') {
    return {
      msg_type: 'post',
      content: { post: { zh_cn: { title, content: [[{ tag: 'text', text: line }]] } } },
    }
  }
  return { msg_type: 'text', content: { text: `${title}\n${line}` } }
}

/** 钉钉消息：text / markdown。 */
function dingtalkMessage(msgType: string, title: string, line: string): ChannelBody {
  if (msgType === 'markdown') {
    return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${line}` } }
  }
  return { msgtype: 'text', text: { content: `${title}\n${line}` } }
}
