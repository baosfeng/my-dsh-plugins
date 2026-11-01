/**
 * dsh-my-notify — 飞书 interactive 卡片构建（schema 2.0 / 1.0 双版本）。
 *
 * 输出即飞书自定义机器人的请求体 `card` 字段（外层
 * `{ msg_type: 'interactive', card }` 由 channels.ts 组装）：
 *  - 2.0：`{ schema: '2.0', header, body: { elements } }`（元素在 body.elements）
 *  - 1.0：`{ config, header, elements }`（元素在顶层 elements）
 *
 * 硬约束（飞书官方）：
 *  - 请求体上限 20KB：正文按 UTF-8 字节截断并追加续行提示，截断后仍保证
 *    整个卡片 JSON ≤ CARD_BYTES_LIMIT；
 *  - 元素上限 200：字段先裁剪（最多 10 项）再兜底截断元素数组；
 *  - @ 只支持 open_id / user_id：空项、含 `<>= 空白` 的非法项一律剥离，
 *    全部为空时不生成 @ 行；
 *  - header.template 只允许 13 色：非法值回退事件配色（accentByKind）或 default。
 *
 * 全部纯函数，无 IO / 无全局状态。
 */
import { formatTime } from './vars.js'

/**
 * 飞书自定义机器人请求体上限（字节，含本卡片 JSON）。
 *
 * 依据：官方限制写「20KB」按十进制 20000 字节计（不是 20 * 1024 = 20480）；
 * 再留 400 字节余量取 19600——飞书侧统计口径（转义 / 附加字段 / 编码）与本地
 * JSON.stringify 可能略有差异，按 20480 卡边界时实测 20464 字节仍会被拒。
 */
export const CARD_BYTES_LIMIT = 19_600

/** 卡片元素上限。 */
export const CARD_ELEMENT_LIMIT = 200

/** 卡片字段上限。 */
const CARD_FIELD_LIMIT = 10

/** 飞书 header.template 允许的 13 种配色。 */
export const CARD_COLORS = [
  'blue',
  'wathet',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'carmine',
  'violet',
  'purple',
  'indigo',
  'grey',
  'default',
] as const

/** 卡片字段（label / value 均已是渲染后文本）。 */
export interface CardField {
  /** 字段名（如「Token 消耗」）。 */
  label: string
  /** 字段值（如「输入 100 / 输出 50」）。 */
  value: string
}

/** 卡片构建入参。 */
export interface CardInput {
  /** 事件类型：end / ask / approval / remote。 */
  kind: string
  /** 顶层 / 子代理（end + subagent 用独立配色）。 */
  agentType?: 'top' | 'subagent'
  /** 卡片标题。 */
  title: string
  /** 正文（markdown 文本，超 20KB 自动截断）。 */
  content: string
  /** 字段列表（已按 card.fields 裁剪）。 */
  fields?: CardField[]
  /** 跳转按钮文案（与 sessionUrl 同时存在才渲染按钮）。 */
  buttonText?: string
  /** 会话链接（open_url 按钮目标）。 */
  sessionUrl?: string
  /** @ 的 open_id / user_id 列表。 */
  mentionOpenIds?: string[]
  /** 是否 @ 所有人。 */
  mentionAll?: boolean
  /** 显式配色（13 色之一）。 */
  template?: string
  /** 按事件类型自动配色（默认 true）。 */
  accentByKind?: boolean
  /** 卡片结构版本（默认 2.0）。 */
  schemaVersion?: '2.0' | '1.0'
  /** 事件时间（毫秒时间戳，用于底部时间注脚）。 */
  time?: number
}

/** 事件类型 → 配色（accentByKind）。 */
const KIND_COLORS: Record<string, string> = {
  end: 'green',
  subagentEnd: 'violet',
  ask: 'blue',
  approval: 'orange',
  remote: 'grey',
}

/**
 * 事件配色：end 绿 / ask 蓝 / approval 橙 / remote 灰；子代理 end 用紫色。
 *
 * @example
 *   kindColor('approval') // → 'orange'
 *   kindColor('end', 'subagent') // → 'violet'
 */
export function kindColor(kind: string, agentType?: 'top' | 'subagent'): string {
  if (kind === 'subagentEnd' || (kind === 'end' && agentType === 'subagent')) return 'violet'
  return KIND_COLORS[kind] ?? 'default'
}

/** 配色合法化：非法 / 缺失回退事件配色（不自动配色时用 default）。 */
function resolveColor(input: CardInput): string {
  const explicit = typeof input.template === 'string' && (CARD_COLORS as readonly string[]).includes(input.template)
  if (explicit) return input.template as string
  return input.accentByKind === false ? 'default' : kindColor(input.kind, input.agentType)
}

/** @ 项合法性：非空、不含空白与 `<>=&`（防注入），长度 ≤ 64。 */
function isValidMentionId(value: string): boolean {
  if (value === '' || value.length > 64) return false
  return !/[\s<>=&]/.test(value)
}

/**
 * @ 行文本：`<at id=ou_xxx></at>`；mentionAll 追加 `<at id=all></at>`；
 * 全部为空返回空串（调用方据此不生成 @ 元素）。
 *
 * @example
 *   mentionLine(['ou_1', '', 'bad id'], true) // → '<at id=ou_1></at> <at id=all></at>'
 */
export function mentionLine(openIds: unknown, mentionAll: boolean): string {
  const list = Array.isArray(openIds) ? openIds : []
  const parts: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!isValidMentionId(id)) continue
    parts.push(`<at id=${id}></at>`)
  }
  if (mentionAll) parts.push('<at id=all></at>')
  return parts.join(' ')
}

/** 字段文本（lark_md）：`**label**：value`；多行值压成单行避免撑爆布局。 */
function fieldLine(field: CardField): string {
  const label = field.label.trim()
  const value = field.value.replace(/\s*\n\s*/g, ' ').trim()
  if (label === '') return value
  return `**${label}**：${value}`
}

/** 按 UTF-8 字节截断文本（不切断多字节字符）。 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let out = ''
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (used + size > maxBytes) break
    used += size
    out += ch
  }
  return out
}

/** JSON 序列化后的 UTF-8 字节数（与飞书侧计算口径一致）。 */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/**
 * 构建飞书卡片（默认 schema 2.0；1.0 需显式指定）。
 *
 * @example
 *   buildFeishuCard({ kind: 'end', title: '会话已结束', content: '已完成' })
 *   // → { schema: '2.0', header: {...}, body: { elements: [...] } }
 */
export function buildFeishuCard(input: CardInput): Record<string, unknown> {
  const safe = normalizeInput(input)
  const elements = buildElements(safe, safe.content)
  const card = assemble(safe, elements)
  if (jsonBytes(card) <= CARD_BYTES_LIMIT) return card
  return shrinkToLimit(safe)
}

/** 入参兜底：全部字段规整，构建路径不抛错。 */
function normalizeInput(
  input: CardInput,
): Required<Pick<CardInput, 'kind' | 'title' | 'content'>> & Omit<CardInput, 'kind' | 'title' | 'content'> {
  const i = (input ?? {}) as CardInput
  return {
    ...i,
    kind: typeof i.kind === 'string' && i.kind !== '' ? i.kind : 'remote',
    title: typeof i.title === 'string' ? i.title : '',
    content: typeof i.content === 'string' ? i.content : '',
  }
}

/** 组装卡片外壳（header + 元素容器）。 */
function assemble(input: CardInput, elements: Record<string, unknown>[]): Record<string, unknown> {
  const header = {
    title: { tag: 'plain_text', content: input.title !== '' ? input.title : 'DSH 通知' },
    template: resolveColor(input),
  }
  if (input.schemaVersion === '1.0') {
    return { config: { wide_screen_mode: true }, header, elements }
  }
  return { schema: '2.0', header, body: { elements } }
}

/** 构建元素数组：@ 行 → 正文 → 字段 → 按钮 → 时间注脚，总数 ≤ 200。 */
function buildElements(input: CardInput, content: string): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = []
  const mentions = mentionLine(input.mentionOpenIds, input.mentionAll === true)
  if (mentions !== '') elements.push({ tag: 'div', text: { tag: 'lark_md', content: mentions } })
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: content !== '' ? content : '（无正文）' } })
  const fields = Array.isArray(input.fields) ? input.fields.slice(0, CARD_FIELD_LIMIT) : []
  for (const field of fields) {
    const line = fieldLine(field)
    if (line === '') continue
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: line } })
  }
  elements.push(...actionElements(input))
  const footer = `${kindLabelOf(input.kind)} · ${formatTime(input.time)}`
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footer }] })
  return elements.slice(0, CARD_ELEMENT_LIMIT)
}

/** 跳转按钮元素（无链接或无文案 → 空数组）。 */
function actionElements(input: CardInput): Record<string, unknown>[] {
  const url = typeof input.sessionUrl === 'string' ? input.sessionUrl : ''
  const text = typeof input.buttonText === 'string' ? input.buttonText.trim() : ''
  if (url === '' || text === '') return []
  return [
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: text },
          type: 'primary',
          behaviors: [{ type: 'open_url', default_url: url }],
        },
      ],
    },
  ]
}

/** 事件中文标签（页脚用；避免与 vars.ts 循环引用）。 */
function kindLabelOf(kind: string): string {
  const labels: Record<string, string> = {
    end: '会话已结束',
    ask: '需要你回答',
    approval: '等待你的批准',
    remote: '提示',
  }
  return labels[kind] ?? '提示'
}

/** 超限收缩：按剩余预算截断正文并追加续行提示，保证最终 ≤ 20KB。 */
function shrinkToLimit(input: CardInput): Record<string, unknown> {
  const hint =
    input.sessionUrl !== undefined && input.sessionUrl !== ''
      ? '\n…（内容过长已截断，完整内容见会话链接）'
      : '\n…（内容过长已截断）'
  const skeleton = assemble(input, buildElements(input, ''))
  const budget = CARD_BYTES_LIMIT - jsonBytes(skeleton) - Buffer.byteLength(hint, 'utf8')
  const head = truncateUtf8(input.content, budget > 0 ? budget : 0)
  const card = assemble(input, buildElements(input, head !== '' ? head + hint : hint.trim()))
  if (jsonBytes(card) <= CARD_BYTES_LIMIT) return card
  // 兜底：字段 / 按钮全部丢弃，只留截断后的正文（极端入参也不超过上限）
  const fallback = assemble(input, buildElements({ ...input, fields: [], mentionOpenIds: [] }, hint.trim()))
  return jsonBytes(fallback) <= CARD_BYTES_LIMIT ? fallback : assemble({ ...input, fields: [], mentionOpenIds: [] }, [])
}
