// ── 飞书卡片渲染器：preview 返回的 card JSON → 近似飞书客户端外观的 HTML ──
//
// 契约：输入是 server 端 buildFeishuCard 的产物（schema 2.0 的
// { schema, header, body.elements } 或 1.0 的 { config, header, elements }），
// 输出是转义后的 HTML 字符串（调用方用 dangerouslySetInnerHTML 注入）。
//
// 元素支持（server 只会产出这几种）：
//  - div + text.lark_md → 正文段落（**粗体** / 换行 / <at id=…> 简化渲染）
//  - div + fields[]      → 两列字段
//  - action + actions[]  → 主按钮
//  - note + elements[]   → 页脚注脚
//  - hr                  → 分隔线
//
// 未知标签一律忽略（绝不抛错）；所有文本先转义再套标记，杜绝注入。

const CARD_PREVIEW_STYLES: string = `.dsh-my-notify-fcard{--fcard-bg:#ffffff;--fcard-fg:#1f2329;--fcard-fg2:#646a73;--fcard-line:#dee0e3;--fcard-btn:#2c62e0;--fcard-green:#1e7a12;--fcard-blue:#2c62e0;--fcard-orange:#a35a00;--fcard-grey:#5c626b;--fcard-accent:var(--fcard-grey);background:var(--fcard-bg);color:var(--fcard-fg);border:1px solid var(--fcard-line);border-radius:12px;overflow:hidden;box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-xxs-12);line-height:1.6;max-width:340px}.dsh-my-notify-fcard[data-accent="green"]{--fcard-accent:var(--fcard-green)}.dsh-my-notify-fcard[data-accent="blue"]{--fcard-accent:var(--fcard-blue)}.dsh-my-notify-fcard[data-accent="orange"]{--fcard-accent:var(--fcard-orange)}.dsh-my-notify-fcard[data-accent="grey"]{--fcard-accent:var(--fcard-grey)}.dsh-my-notify-fcard-hd{display:flex;align-items:center;gap:6px;padding:6px 12px;border-top:3px solid var(--fcard-accent);background:color-mix(in srgb, var(--fcard-accent) 8%, var(--fcard-bg));min-height:24px}.dsh-my-notify-fcard-mark{width:8px;height:8px;border-radius:50%;background:var(--fcard-accent);flex:none}.dsh-my-notify-fcard-app{font:var(--dsw-font-xxs-12);color:var(--fcard-fg2)}.dsh-my-notify-fcard-title{padding:10px 12px 0;font:var(--dsw-font-s-strong-14);color:var(--fcard-fg)}.dsh-my-notify-fcard-bd{display:flex;flex-direction:column;gap:8px;padding:8px 12px 12px}.dsh-my-notify-fcard-p{color:var(--fcard-fg);word-break:break-word}.dsh-my-notify-fcard-p strong{font-weight:600}.dsh-my-notify-fcard-at{color:var(--fcard-btn);margin-right:4px}.dsh-my-notify-fcard-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.dsh-my-notify-fcard-field{display:flex;flex-direction:column;gap:1px;min-width:0}.dsh-my-notify-fcard-field-label{color:var(--fcard-fg2);font:var(--dsw-font-xxs-12)}.dsh-my-notify-fcard-field-value{color:var(--fcard-fg);font:var(--dsw-font-xxs-12);word-break:break-word}.dsh-my-notify-fcard-acts{display:flex;flex-wrap:wrap;gap:6px}.dsh-my-notify-fcard-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 14px;border-radius:4px;border:1px solid var(--fcard-line);background:var(--fcard-bg);color:var(--fcard-fg);font:var(--dsw-font-xxs-12)}.dsh-my-notify-fcard-btn[data-primary="true"]{border-color:var(--fcard-btn);background:var(--fcard-btn);color:var(--fcard-bg)}.dsh-my-notify-fcard-note{font:var(--dsw-font-xxs-12);color:var(--fcard-fg2);border-top:1px solid var(--fcard-line);padding-top:6px}.dsh-my-notify-fcard-hr{height:1px;background:var(--fcard-line)}
`

/** 飞书卡片品牌色（唯一出现原始 hex 的地方；文字色均满足 ≥4.5:1）。 */
const CARD_PALETTE: Record<string, string> = {
  '--fcard-bg': '#ffffff',
  '--fcard-fg': '#1f2329',
  '--fcard-fg2': '#646a73',
  '--fcard-line': '#dee0e3',
  '--fcard-btn': '#2c62e0',
  '--fcard-green': '#1e7a12',
  '--fcard-blue': '#2c62e0',
  '--fcard-orange': '#a35a00',
  '--fcard-grey': '#5c626b',
}

/** 卡片主题色（与 server 端 13 色的常用 4 色 + 事件自动配色对齐）。 */
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

/** 卡片主题色（非法 / 缺失回退 grey）。 */
function cardAccentOf(card: any): string {
  const template = card !== null && typeof card === 'object' ? card.header?.template : undefined
  const hit = CARD_ACCENTS.find((option) => option.value === template)
  return hit !== undefined ? hit.value : 'grey'
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

/** div 元素（正文段落 / 两列字段）。 */
function cardDivHtml(element: any): string {
  if (Array.isArray(element.fields) && element.fields.length > 0) {
    const cells = element.fields.map((field: any) => cardFieldHtml(field?.text)).join('')
    return `<div class="dsh-my-notify-fcard-fields">${cells}</div>`
  }
  const content = element.text?.content
  if (typeof content !== 'string' || content === '') return ''
  return `<div class="dsh-my-notify-fcard-p">${larkMdHtml(content)}</div>`
}

/** action 元素（主 / 次按钮）。 */
function cardActionHtml(element: any): string {
  const actions = Array.isArray(element.actions) ? element.actions : []
  const buttons = actions
    .map((action: any) => {
      const label = typeof action?.text?.content === 'string' ? action.text.content : ''
      if (label === '') return ''
      const primary = action.type === 'primary' ? 'true' : 'false'
      return `<span class="dsh-my-notify-fcard-btn" data-primary="${primary}">${escapeHtml(label)}</span>`
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

/** 卡片 JSON → 近似飞书客户端外观的 HTML（header 彩色条 + 标题 + 正文 + 字段 + 按钮 + 注脚）。 */
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
    `<div class="dsh-my-notify-fcard-hd"><span class="dsh-my-notify-fcard-mark"></span>` +
    `<span class="dsh-my-notify-fcard-app">${escapeHtml(strings.fcardApp())}</span></div>` +
    titleHtml +
    `<div class="dsh-my-notify-fcard-bd">${body}</div></div>`
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
