/**
 * dsh-my-notify — 模板变量目录与取值（server 端统一变量引擎）。
 *
 * 变量按命名空间分组（session / event / ask / tool / approval / tokens /
 * notify），供两处消费：
 *  - 模板渲染：`{{session.title}}` 等占位符的取值来源（template.ts）；
 *  - 设置页展示：GET /notify/api/variables 返回 VAR_GROUPS（分组 / 名称 /
 *    说明 / 示例），UI 据此渲染变量提示。
 *
 * 兼容：旧语法 `{title}` / `{kind}` / `{note}` / `{tokens}` / `{question}` /
 * `{sessionUrl}` / `{time}` 经 LEGACY_ALIASES 映射到同值新变量。
 * 全部为纯函数 + 常量：缺失 / 非法输入回退空串，绝不在渲染路径抛错。
 */
import { readFileSync } from 'node:fs'
import type { TokenUsage } from '../types.js'

/** 事件类型 → 中文标签（与 client 端 i18n 文案一致）。 */
const KIND_LABELS: Record<string, string> = {
  end: '会话已结束',
  ask: '需要你回答',
  approval: '等待你的批准',
  remote: '提示',
}

/** 事件类型中文标签（未知类型回退「提示」）。 */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? KIND_LABELS.remote!
}

/** 渠道标识 → 中文名（模板变量 notify.channelName）。 */
const CHANNEL_NAMES: Record<string, string> = {
  wecom: '企业微信群机器人',
  feishu: '飞书群机器人',
  dingtalk: '钉钉群机器人',
  generic: '通用中转',
  browser: '浏览器通知',
}

/** 渠道中文名（未知渠道回退渠道标识本身，再回退「通知」）。 */
export function channelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? (channel !== '' ? channel : '通知')
}

/** 变量取值入参（通知帧 + 会话上下文 + 渠道上下文；全部可选，缺失回退空串）。 */
export interface VarInput {
  /** 事件类型：end / ask / approval / remote。 */
  kind?: string
  /** 会话 id。 */
  sessionId?: string
  /** 会话标题（已渲染的会话名）。 */
  title?: string
  /** 摘要（ask 为问题摘要，approval 为审批原因）。 */
  note?: string
  /** 工具名（approval 触发工具）。 */
  toolName?: string
  /** 顶层 / 子代理。 */
  agentType?: 'top' | 'subagent'
  /** token 用量（含缓存 / 推理 / 请求数；缺失即「不可用」）。 */
  tokens?: TokenUsage | null
  /** 会话耗时（秒）。 */
  duration?: number | null
  /** 会话链接。 */
  sessionUrl?: string
  /** 完整问题文本（ask）。 */
  question?: string
  /** 问题列表（ask）。 */
  questions?: string[]
  /** 事件时间（毫秒时间戳）。 */
  time?: number
  /** 会话工作目录。 */
  cwd?: string
  /** 模型名。 */
  model?: string
  /** 供应商。 */
  provider?: string
  /** agent preset 名。 */
  preset?: string
  /** 父会话 id。 */
  parentId?: string
  /** 审批原因（本地化文本；宿主未提供时与 note 同源）。 */
  approvalReasonLocalized?: string
  /** 渠道标识（notify.channel）。 */
  channel?: string
  /** 插件版本（notify.pluginVersion；缺省读 package.json）。 */
  pluginVersion?: string
}

/** 单个变量的目录条目。 */
interface VarItem {
  /** 模板里书写的占位符名（不含花括号），如 `session.title`。 */
  name: string
  /** 中文说明。 */
  description: string
  /** 示例值。 */
  example: string
}

/** 变量分组（设置页变量面板按分组展示）。 */
export interface VarGroup {
  /** 分组键（`session` / `event` / ...）。 */
  group: string
  /** 分组中文名。 */
  label: string
  /** 组内变量。 */
  items: VarItem[]
}

/** 旧语法别名 → 新变量名（同值，保证旧模板不改一个字）。 */
export const LEGACY_ALIASES: Record<string, string> = {
  title: 'session.title',
  kind: 'event.name',
  note: 'event.note',
  tokens: 'tokens.text',
  question: 'ask.question',
  sessionUrl: 'session.url',
  time: 'event.time',
}

/** 变量目录（GET /notify/api/variables 的返回值；顺序即展示顺序）。 */
export const VAR_GROUPS: VarGroup[] = [
  {
    group: 'session',
    label: '会话',
    items: [
      { name: 'session.title', description: '会话标题（无标题时为空串）', example: 'my-dsh-plugins' },
      { name: 'session.id', description: '会话 id', example: 'ses_1a2b3c' },
      {
        name: 'session.url',
        description: '会话链接（配置 webBaseUrl 后生成）',
        example: 'https://dsh.local/sessions/ses_1a2b3c',
      },
      { name: 'session.cwd', description: '会话工作目录', example: '/Users/me/project' },
      { name: 'session.model', description: '模型名', example: 'deepseek-v4' },
      { name: 'session.provider', description: '模型供应商', example: 'deepseek' },
      { name: 'session.agentLevel', description: '会话层级：顶层 / 子代理', example: '顶层' },
      { name: 'session.parentId', description: '父会话 id（子代理才有）', example: 'ses_parent' },
      { name: 'session.preset', description: 'agent preset 名', example: 'default' },
      { name: 'session.durationSeconds', description: '会话耗时（整数秒）', example: '83' },
      { name: 'session.durationText', description: '会话耗时（中文可读，如 1 分 23 秒）', example: '1 分 23 秒' },
    ],
  },
  {
    group: 'event',
    label: '事件',
    items: [
      { name: 'event.kind', description: '事件类型原值：end / ask / approval / remote', example: 'end' },
      { name: 'event.name', description: '事件类型中文名', example: '会话已结束' },
      { name: 'event.note', description: '事件摘要（ask 为问题摘要，approval 为审批原因）', example: '确认部署' },
      { name: 'event.time', description: '事件时间（YYYY-MM-DD HH:mm，本地时区）', example: '2025-01-02 09:30' },
    ],
  },
  {
    group: 'ask',
    label: '提问',
    items: [
      { name: 'ask.question', description: '完整问题文本（多问题带序号）', example: '问题 1：确认部署' },
      { name: 'ask.summary', description: '问题摘要（首行，最多 80 字）', example: '确认部署' },
      { name: 'ask.count', description: '问题数量', example: '1' },
    ],
  },
  {
    group: 'tool',
    label: '工具',
    items: [{ name: 'tool.name', description: '触发审批的工具名', example: 'bash' }],
  },
  {
    group: 'approval',
    label: '审批',
    items: [
      { name: 'approval.reason', description: '审批原因（宿主原文）', example: 'sandbox escalation' },
      {
        name: 'approval.reasonLocalized',
        description: '审批原因（本地化文本，无翻译时与 reason 同值）',
        example: 'sandbox escalation',
      },
    ],
  },
  {
    group: 'tokens',
    label: 'Token',
    items: [
      { name: 'tokens.input', description: '输入 token 数', example: '100' },
      { name: 'tokens.output', description: '输出 token 数', example: '50' },
      { name: 'tokens.total', description: '总 token 数（input + output）', example: '150' },
      { name: 'tokens.cacheRead', description: '缓存命中 token 数', example: '20' },
      { name: 'tokens.cacheWrite', description: '缓存写入 token 数', example: '10' },
      { name: 'tokens.reasoning', description: '推理 token 数', example: '5' },
      { name: 'tokens.requests', description: 'assistant 消息条数（请求数）', example: '3' },
      {
        name: 'tokens.text',
        description: 'token 消耗文本（无数据为「不可用」）',
        example: '输入 100 / 输出 50 / 总计 150',
      },
    ],
  },
  {
    group: 'notify',
    label: '通知自身',
    items: [
      {
        name: 'notify.channel',
        description: '渠道标识：wecom / feishu / dingtalk / generic / browser',
        example: 'feishu',
      },
      { name: 'notify.channelName', description: '渠道中文名', example: '飞书群机器人' },
      { name: 'notify.pluginVersion', description: '插件版本号', example: '0.4.3' },
    ],
  },
]

/** 插件版本号（读 package.json；失败回退空串，绝不打断渲染）。 */
let cachedVersion: string | undefined
function pluginVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const file = new URL('../../package.json', import.meta.url)
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
    cachedVersion = typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    cachedVersion = ''
  }
  return cachedVersion
}

/**
 * 构建模板变量表（键为命名空间全名，值与通知帧 / 会话上下文一一对应）。
 *
 * 纯函数、全字段兜底：缺失 / 非法输入回退空串，未知事件类型回退「提示」，
 * 调用方无需 try/catch。
 *
 * @example
 *   buildVars({ kind: 'end', title: '演示项目', duration: 83 })['session.durationText']
 *   // → '1 分 23 秒'
 */
export function buildVars(input: VarInput = {}): Record<string, string> {
  const i = input ?? {}
  return {
    ...sessionVars(i),
    ...eventVars(i),
    ...askVars(i),
    ...tokenVars(i.tokens ?? null),
    ...notifyVars(i),
  }
}

/** session.* 变量（标题 / id / 链接 / 目录 / 模型 / 层级 / preset / 耗时）。 */
function sessionVars(i: VarInput): Record<string, string> {
  const durationSeconds = secondsOf(i.duration)
  return {
    'session.title': str(i.title),
    'session.id': str(i.sessionId),
    'session.url': str(i.sessionUrl),
    'session.cwd': str(i.cwd),
    'session.model': str(i.model),
    'session.provider': str(i.provider),
    'session.agentLevel': i.agentType === 'subagent' ? '子代理' : '顶层',
    'session.parentId': str(i.parentId),
    'session.preset': str(i.preset),
    'session.durationSeconds': durationSeconds === null ? '' : String(durationSeconds),
    'session.durationText': formatDuration(durationSeconds),
  }
}

/** event.* 变量（原值 / 中文名 / 摘要 / 时间）。 */
function eventVars(i: VarInput): Record<string, string> {
  const kind = eventKind(i)
  return {
    'event.kind': kind,
    'event.name': kindLabel(kind),
    'event.note': str(i.note),
    'event.time': formatTime(i.time),
  }
}

/** 事件类型：非空字符串原样，否则回退 remote。 */
function eventKind(i: VarInput): string {
  return typeof i.kind === 'string' && i.kind !== '' ? i.kind : 'remote'
}

/** 问题列表：只保留非空字符串项。 */
function questionsOf(i: VarInput): string[] {
  const list = Array.isArray(i.questions) ? i.questions : []
  return list.filter((q) => typeof q === 'string' && q !== '')
}

/** ask.* / tool.* / approval.* 变量。 */
function askVars(i: VarInput): Record<string, string> {
  const questions = questionsOf(i)
  const question = str(i.question) !== '' ? str(i.question) : str(i.note)
  const localized = str(i.approvalReasonLocalized)
  return {
    'ask.question': question,
    'ask.summary': str(i.note),
    'ask.count': String(questionCount(questions, question)),
    'tool.name': str(i.toolName),
    'approval.reason': str(i.note),
    'approval.reasonLocalized': localized !== '' ? localized : str(i.note),
  }
}

/** 问题数量：有列表用列表长度，否则按是否有问题文本计 1 / 0。 */
function questionCount(questions: string[], question: string): number {
  if (questions.length > 0) return questions.length
  return question !== '' ? 1 : 0
}

/** tokens.* 变量（数值字段缺省为空串，文本缺省「不可用」）。 */
function tokenVars(tokens: TokenUsage | null): Record<string, string> {
  return {
    'tokens.input': tokenText(tokens, 'input'),
    'tokens.output': tokenText(tokens, 'output'),
    'tokens.total': tokenText(tokens, 'total'),
    'tokens.cacheRead': tokenText(tokens, 'cacheRead'),
    'tokens.cacheWrite': tokenText(tokens, 'cacheWrite'),
    'tokens.reasoning': tokenText(tokens, 'reasoning'),
    'tokens.requests': tokenText(tokens, 'requests'),
    'tokens.text': formatTokens(tokens),
  }
}

/** notify.* 变量（渠道标识 / 中文名 / 插件版本）。 */
function notifyVars(i: VarInput): Record<string, string> {
  const version = str(i.pluginVersion)
  return {
    'notify.channel': str(i.channel),
    'notify.channelName': channelName(str(i.channel)),
    'notify.pluginVersion': version !== '' ? version : pluginVersion(),
  }
}

/** 字符串字段规整：非字符串回退空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 非负数值，非法回退 0。 */
function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 耗时（秒）→ 整数秒；缺失 / 非法返回 null。 */
function secondsOf(duration: unknown): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null
  return Math.round(duration)
}

/** token 用量文本：输入 / 输出 / 总计；无量返回「不可用」。 */
function formatTokens(tokens: TokenUsage | null | undefined): string {
  if (tokens === null || tokens === undefined || typeof tokens !== 'object') return '不可用'
  const input = nonNegative(tokens.input)
  const output = nonNegative(tokens.output)
  const total = nonNegative(tokens.total)
  if (input === 0 && output === 0 && total === 0) return '不可用'
  return `输入 ${input} / 输出 ${output} / 总计 ${total}`
}

/** 单个 token 字段文本：无用量返回空串（避免「不可用」混进数字字段）。 */
function tokenText(tokens: TokenUsage | null, key: keyof TokenUsage): string {
  if (tokens === null || typeof tokens !== 'object') return ''
  const value = tokens[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : ''
}

/** 耗时文本：秒 / 分秒 / 时分秒；无耗时返回空串。 */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return ''
  if (seconds === 0) return '0 秒'
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) {
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    return sec !== 0 ? `${min} 分 ${sec} 秒` : `${min} 分`
  }
  const hour = Math.floor(seconds / 3600)
  const min = Math.floor((seconds % 3600) / 60)
  return `${hour} 小时 ${min} 分`
}

/** 事件时间文本：`YYYY-MM-DD HH:mm`（本地时区）。 */
export function formatTime(time: unknown): string {
  const date = typeof time === 'number' && Number.isFinite(time) ? new Date(time) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
