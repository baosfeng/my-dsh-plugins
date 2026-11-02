// ── 飞书卡片渲染器：preview 返回的 card JSON → 与原型一致的卡片 HTML ──
//
// 契约：输入是 server 端 buildFeishuCard 的产物（schema 2.0 的
// { schema, header, body.elements } 或 1.0 的 { config, header, elements }），
// 输出是转义后的 HTML 字符串（调用方用 dangerouslySetInnerHTML 注入）。
//
// 结构：实色 header（标题白字）+ 正文段落 + 单列字段 + 文字链按钮 + 注脚。
// 未知标签一律忽略；所有文本先转义再套标记，杜绝注入。

const CARD_PREVIEW_STYLES: string = `
.dsh-my-notify-fcard{--fcard-bg:#ffffff;--fcard-fg:#1f2329;--fcard-fg2:#646a73;--fcard-line:#e8e3d9;--fcard-btn:#2c62e0;--fcard-accent:#3f4448;width:100%;max-width:none;background:var(--fcard-bg);color:var(--fcard-fg);border:1px solid var(--fcard-line);border-radius:14px;overflow:hidden;box-shadow:0 14px 34px rgba(35,31,24,.07),0 2px 6px rgba(35,31,24,.04);font:var(--dsw-font-xxs-12);line-height:1.6}
.dsh-my-notify-fcard[data-accent="green"]{--fcard-accent:#33544a}
.dsh-my-notify-fcard[data-accent="blue"]{--fcard-accent:#2f5570}
.dsh-my-notify-fcard[data-accent="wathet"]{--fcard-accent:#3f657e}
.dsh-my-notify-fcard[data-accent="turquoise"]{--fcard-accent:#2c6660}
.dsh-my-notify-fcard[data-accent="yellow"]{--fcard-accent:#736224}
.dsh-my-notify-fcard[data-accent="orange"]{--fcard-accent:#7a4f2e}
.dsh-my-notify-fcard[data-accent="red"]{--fcard-accent:#7d3b36}
.dsh-my-notify-fcard[data-accent="carmine"]{--fcard-accent:#77384c}
.dsh-my-notify-fcard[data-accent="violet"]{--fcard-accent:#55416b}
.dsh-my-notify-fcard[data-accent="purple"]{--fcard-accent:#5a3f68}
.dsh-my-notify-fcard[data-accent="indigo"]{--fcard-accent:#3d4770}
.dsh-my-notify-fcard[data-accent="grey"]{--fcard-accent:#3f4448}
.dsh-my-notify-fcard[data-accent="default"]{--fcard-accent:#3c3c39}
.dsh-my-notify-fcard-hd{display:flex;flex-direction:column;gap:4px;padding:14px 16px 13px;background:var(--fcard-accent)}
.dsh-my-notify-fcard-app{color:rgba(255,255,255,.72);font:var(--dsw-font-xxs-12);letter-spacing:.04em}
.dsh-my-notify-fcard-title{color:#fff;font:var(--dsw-font-s-strong-14);line-height:1.5;word-break:break-word}
.dsh-my-notify-fcard-bd{display:flex;flex-direction:column;gap:10px;padding:14px 16px}
.dsh-my-notify-fcard-p{color:var(--fcard-fg);font:var(--dsw-font-xs-13);line-height:1.65;word-break:break-word}
.dsh-my-notify-fcard-p strong{font-weight:600}
.dsh-my-notify-fcard-at{color:var(--fcard-btn);margin-right:4px}
.dsh-my-notify-fcard-fields{display:grid;grid-template-columns:1fr;gap:6px;padding-top:10px;border-top:1px solid #f0ece4}
.dsh-my-notify-fcard-field{display:flex;align-items:baseline;gap:12px;min-width:0}
.dsh-my-notify-fcard-field-label{flex:none;width:56px;color:var(--fcard-fg2);font:var(--dsw-font-xxs-12)}
.dsh-my-notify-fcard-field-value{color:#43403a;font:var(--dsw-font-xxs-12);word-break:break-word}
.dsh-my-notify-fcard-acts{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding-top:10px;border-top:1px solid #f0ece4}
.dsh-my-notify-fcard-btn{color:var(--fcard-accent);font:var(--dsw-font-xxs-strong-12);cursor:default}
.dsh-my-notify-fcard-btn[data-primary="true"]{font:var(--dsw-font-xxs-strong-12)}
.dsh-my-notify-fcard-note{color:var(--fcard-fg2);font:var(--dsw-font-xxxs-11);line-height:1.6}
.dsh-my-notify-fcard-hr{height:1px;background:#f0ece4}
`

/** 飞书卡片品牌色（唯一出现原始 hex 的地方；文字色均满足 ≥4.5:1）。 */
const CARD_PALETTE: Record<string, string> = {
  '--fcard-bg': '#ffffff',
  '--fcard-fg': '#1f2329',
  '--fcard-fg2': '#646a73',
  '--fcard-line': '#dee0e3',
  '--fcard-btn': '#2c62e0',
}

/** 飞书 header.template 的 13 种官方配色（与服务端 CARD_COLORS 对齐）。 */
const CARD_COLORS = [
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
]

/** 卡片主题色（面板给 4 个显式色；其余官方色照实渲染）。 */
const CARD_ACCENTS: SelectOption[] = [
  { value: 'green', label: () => strings.accentGreen() },
  { value: 'blue', label: () => strings.accentBlue() },
  { value: 'orange', label: () => strings.accentOrange() },
  { value: 'grey', label: () => strings.accentGrey() },
]

/** 卡片字段候选（card.fields 的取值是模板变量名，与 server 端 fieldLabelOf 对齐）。 */
const CARD_FIELD_OPTIONS: SelectOption[] = [
  { value: 'tokens.text', label: () => strings.fieldTokens() },
  { value: 'session.durationText', label: () => strings.fieldDuration() },
  { value: 'tool.name', label: () => strings.fieldTool() },
  { value: 'ask.question', label: () => strings.fieldQuestion() },
  { value: 'session.url', label: () => strings.fieldLink() },
  { value: 'event.time', label: () => strings.fieldTime() },
]

/** 卡片字段候选的显示名（未知变量名回退变量名本身）。 */
function cardFieldLabel(name: string): string {
  const option = CARD_FIELD_OPTIONS.find((o) => o.value === name)
  return option !== undefined ? option.label() : name
}

/** HTML 转义（卡片文本来自用户模板，必须全量转义）。 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 卡片主题色（13 种官方色；非法 / 缺失回退 grey）。 */
function cardAccentOf(card: any): string {
  const template = card !== null && typeof card === 'object' ? card.header?.template : undefined
  return typeof template === 'string' && CARD_COLORS.includes(template) ? template : 'grey'
}

/** 卡片标题（header.title.content；缺失回退空串）。 */
function cardTitleOf(card: any): string {
  const title = card !== null && typeof card === 'object' ? card.header?.title?.content : undefined
  return typeof title === 'string' ? title : ''
}

/** 元素数组（2.0 在 body.elements，1.0 在顶层 elements）。 */
function cardElementsOf(card: any): any[] {
  if (card === null || typeof card !== 'object') return []
  const list = Array.isArray(card.body?.elements) ? card.body.elements : card.elements
  return Array.isArray(list) ? list : []
}

/** lark_md 简化渲染：先转义，再把 **粗体** / 换行 / <at> 标记换成 HTML。 */
function larkMdHtml(text: unknown): string {
  const safe = escapeHtml(text)
  const withAt = safe.replace(
    /&lt;at id=([\w-]+)&gt;&lt;\/at&gt;/g,
    (_m, id) => `<span class="dsh-my-notify-fcard-at">@${id === 'all' ? strings.fcardMentionAll() : id}</span>`,
  )
  return withAt.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
}

/** 字段行（label 加粗 + 值）。 */
function cardFieldHtml(text: any): string {
  const raw = typeof text?.content === 'string' ? text.content : ''
  // server 端字段形如 "**Token 消耗**：1,200"，拆出标签与值两列更贴近客户端
  const match = /^\*\*([^*]+)\*\*[：:]?\s*([\s\S]*)$/.exec(raw)
  const label = match !== null ? match[1] : ''
  const value = match !== null ? match[2] : raw
  const labelHtml = label !== '' ? `<span class="dsh-my-notify-fcard-field-label">${escapeHtml(label)}</span>` : ''
  return `<div class="dsh-my-notify-fcard-field">${labelHtml}<span class="dsh-my-notify-fcard-field-value">${escapeHtml(value)}</span></div>`
}

/** div 元素（正文段落 / 字段）。 */
function cardDivHtml(element: any): string {
  if (Array.isArray(element.fields) && element.fields.length > 0) {
    const cells = element.fields.map((field: any) => cardFieldHtml(field?.text)).join('')
    return `<div class="dsh-my-notify-fcard-fields">${cells}</div>`
  }
  const content = element.text?.content
  if (typeof content !== 'string' || content === '') return ''
  return `<div class="dsh-my-notify-fcard-p">${larkMdHtml(content)}</div>`
}

/** action 元素（主 / 次按钮，渲染成文字链）。 */
function cardActionHtml(element: any): string {
  const actions = Array.isArray(element.actions) ? element.actions : []
  const buttons = actions
    .map((action: any) => {
      const label = typeof action?.text?.content === 'string' ? action.text.content : ''
      if (label === '') return ''
      const primary = action.type === 'primary' ? 'true' : 'false'
      return `<span class="dsh-my-notify-fcard-btn" data-primary="${primary}">${escapeHtml(label)} →</span>`
    })
    .join('')
  return buttons === '' ? '' : `<div class="dsh-my-notify-fcard-acts">${buttons}</div>`
}

/** note 元素（页脚注脚）。 */
function cardNoteHtml(element: any): string {
  const parts = Array.isArray(element.elements) ? element.elements : []
  const text = parts
    .map((part: any) => (typeof part?.content === 'string' ? part.content : ''))
    .filter((part: string) => part !== '')
    .join(' · ')
  return text === '' ? '' : `<div class="dsh-my-notify-fcard-note">${escapeHtml(text)}</div>`
}

/** 单个元素 → HTML（未知标签返回空串）。 */
function cardElementHtml(element: any): string {
  if (element === null || typeof element !== 'object') return ''
  if (element.tag === 'div') return cardDivHtml(element)
  if (element.tag === 'action') return cardActionHtml(element)
  if (element.tag === 'note') return cardNoteHtml(element)
  if (element.tag === 'hr') return '<div class="dsh-my-notify-fcard-hr"></div>'
  return ''
}

/** 卡片 JSON → 原型卡片 HTML（实色 header + 标题 + 正文 + 字段 + 文字链 + 注脚）。 */
function renderFeishuCardHtml(card: any): string {
  const accent = cardAccentOf(card)
  const title = cardTitleOf(card)
  const body = cardElementsOf(card)
    .map((element) => cardElementHtml(element))
    .filter((html) => html !== '')
    .join('')
  const titleHtml = title !== '' ? `<div class="dsh-my-notify-fcard-title">${escapeHtml(title)}</div>` : ''
  return (
    `<div class="dsh-my-notify-fcard" data-accent="${accent}" role="img" aria-label="${escapeHtml(title)}">` +
    `<div class="dsh-my-notify-fcard-hd"><span class="dsh-my-notify-fcard-app">${escapeHtml(strings.fcardApp())}</span>` +
    titleHtml +
    `</div><div class="dsh-my-notify-fcard-bd">${body}</div></div>`
  )
}

/** 卡片统计（设计器页脚：N 个字段 · 配色 header · N 个按钮）。 */
function cardMetaOf(card: any): string {
  const elements = cardElementsOf(card)
  let fields = 0
  let buttons = 0
  for (const element of elements) {
    if (element?.tag === 'div' && Array.isArray(element.fields)) fields += element.fields.length
    if (element?.tag === 'action' && Array.isArray(element.actions)) buttons += element.actions.length
  }
  const accentOption = CARD_ACCENTS.find((option) => option.value === cardAccentOf(card))
  const accentLabel = accentOption !== undefined ? accentOption.label() : cardAccentOf(card)
  return strings.dzMeta(fields, accentLabel, buttons)
}
