'use strict'
const CARD_PREVIEW_STYLES = `
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
const CARD_PALETTE = {
  '--fcard-bg': '#ffffff',
  '--fcard-fg': '#1f2329',
  '--fcard-fg2': '#646a73',
  '--fcard-line': '#dee0e3',
  '--fcard-btn': '#2c62e0',
}
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
const CARD_ACCENTS = [
  { value: 'green', label: () => strings.accentGreen() },
  { value: 'blue', label: () => strings.accentBlue() },
  { value: 'orange', label: () => strings.accentOrange() },
  { value: 'grey', label: () => strings.accentGrey() },
]
const CARD_FIELD_OPTIONS = [
  { value: 'tokens.text', label: () => strings.fieldTokens() },
  { value: 'session.durationText', label: () => strings.fieldDuration() },
  { value: 'tool.name', label: () => strings.fieldTool() },
  { value: 'ask.question', label: () => strings.fieldQuestion() },
  { value: 'session.url', label: () => strings.fieldLink() },
  { value: 'event.time', label: () => strings.fieldTime() },
]
function cardFieldLabel(name) {
  const option = CARD_FIELD_OPTIONS.find((o) => o.value === name)
  return option !== undefined ? option.label() : name
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function cardAccentOf(card) {
  const template = card !== null && typeof card === 'object' ? card.header?.template : undefined
  return typeof template === 'string' && CARD_COLORS.includes(template) ? template : 'grey'
}
function cardTitleOf(card) {
  const title = card !== null && typeof card === 'object' ? card.header?.title?.content : undefined
  return typeof title === 'string' ? title : ''
}
function cardElementsOf(card) {
  if (card === null || typeof card !== 'object') return []
  const list = Array.isArray(card.body?.elements) ? card.body.elements : card.elements
  return Array.isArray(list) ? list : []
}
function larkMdHtml(text) {
  const safe = escapeHtml(text)
  const withAt = safe.replace(
    /&lt;at id=([\w-]+)&gt;&lt;\/at&gt;/g,
    (_m, id) => `<span class="dsh-my-notify-fcard-at">@${id === 'all' ? strings.fcardMentionAll() : id}</span>`,
  )
  return withAt.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
}
function cardFieldHtml(text) {
  const raw = typeof text?.content === 'string' ? text.content : ''
  const match = /^\*\*([^*]+)\*\*[：:]?\s*([\s\S]*)$/.exec(raw)
  const label = match !== null ? match[1] : ''
  const value = match !== null ? match[2] : raw
  const labelHtml = label !== '' ? `<span class="dsh-my-notify-fcard-field-label">${escapeHtml(label)}</span>` : ''
  return `<div class="dsh-my-notify-fcard-field">${labelHtml}<span class="dsh-my-notify-fcard-field-value">${escapeHtml(value)}</span></div>`
}
function cardDivHtml(element) {
  if (Array.isArray(element.fields) && element.fields.length > 0) {
    const cells = element.fields.map((field) => cardFieldHtml(field?.text)).join('')
    return `<div class="dsh-my-notify-fcard-fields">${cells}</div>`
  }
  const content = element.text?.content
  if (typeof content !== 'string' || content === '') return ''
  return `<div class="dsh-my-notify-fcard-p">${larkMdHtml(content)}</div>`
}
function cardActionHtml(element) {
  const actions = Array.isArray(element.actions) ? element.actions : []
  const buttons = actions
    .map((action) => {
      const label = typeof action?.text?.content === 'string' ? action.text.content : ''
      if (label === '') return ''
      const primary = action.type === 'primary' ? 'true' : 'false'
      return `<span class="dsh-my-notify-fcard-btn" data-primary="${primary}">${escapeHtml(label)} →</span>`
    })
    .join('')
  return buttons === '' ? '' : `<div class="dsh-my-notify-fcard-acts">${buttons}</div>`
}
function cardNoteHtml(element) {
  const parts = Array.isArray(element.elements) ? element.elements : []
  const text = parts
    .map((part) => (typeof part?.content === 'string' ? part.content : ''))
    .filter((part) => part !== '')
    .join(' · ')
  return text === '' ? '' : `<div class="dsh-my-notify-fcard-note">${escapeHtml(text)}</div>`
}
function cardElementHtml(element) {
  if (element === null || typeof element !== 'object') return ''
  if (element.tag === 'div') return cardDivHtml(element)
  if (element.tag === 'action') return cardActionHtml(element)
  if (element.tag === 'note') return cardNoteHtml(element)
  if (element.tag === 'hr') return '<div class="dsh-my-notify-fcard-hr"></div>'
  return ''
}
function renderFeishuCardHtml(card) {
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
function cardMetaOf(card) {
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
