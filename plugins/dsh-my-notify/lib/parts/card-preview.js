'use strict'
const CARD_PREVIEW_STYLES = `.dsh-my-notify-fcard{--fcard-bg:#ffffff;--fcard-fg:#1f2329;--fcard-fg2:#646a73;--fcard-line:#dee0e3;--fcard-btn:#2c62e0;--fcard-green:#1e7a12;--fcard-blue:#2c62e0;--fcard-orange:#a35a00;--fcard-grey:#5c626b;--fcard-accent:var(--fcard-grey);background:var(--fcard-bg);color:var(--fcard-fg);border:1px solid var(--fcard-line);border-radius:12px;overflow:hidden;box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-xxs-12);line-height:1.6;max-width:340px}.dsh-my-notify-fcard[data-accent="green"]{--fcard-accent:var(--fcard-green)}.dsh-my-notify-fcard[data-accent="blue"]{--fcard-accent:var(--fcard-blue)}.dsh-my-notify-fcard[data-accent="orange"]{--fcard-accent:var(--fcard-orange)}.dsh-my-notify-fcard[data-accent="grey"]{--fcard-accent:var(--fcard-grey)}.dsh-my-notify-fcard-hd{display:flex;align-items:center;gap:6px;padding:6px 12px;border-top:3px solid var(--fcard-accent);background:color-mix(in srgb, var(--fcard-accent) 8%, var(--fcard-bg));min-height:24px}.dsh-my-notify-fcard-mark{width:8px;height:8px;border-radius:50%;background:var(--fcard-accent);flex:none}.dsh-my-notify-fcard-app{font:var(--dsw-font-xxs-12);color:var(--fcard-fg2)}.dsh-my-notify-fcard-title{padding:10px 12px 0;font:var(--dsw-font-s-strong-14);color:var(--fcard-fg)}.dsh-my-notify-fcard-bd{display:flex;flex-direction:column;gap:8px;padding:8px 12px 12px}.dsh-my-notify-fcard-p{color:var(--fcard-fg);word-break:break-word}.dsh-my-notify-fcard-p strong{font-weight:600}.dsh-my-notify-fcard-at{color:var(--fcard-btn);margin-right:4px}.dsh-my-notify-fcard-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.dsh-my-notify-fcard-field{display:flex;flex-direction:column;gap:1px;min-width:0}.dsh-my-notify-fcard-field-label{color:var(--fcard-fg2);font:var(--dsw-font-xxs-12)}.dsh-my-notify-fcard-field-value{color:var(--fcard-fg);font:var(--dsw-font-xxs-12);word-break:break-word}.dsh-my-notify-fcard-acts{display:flex;flex-wrap:wrap;gap:6px}.dsh-my-notify-fcard-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 14px;border-radius:4px;border:1px solid var(--fcard-line);background:var(--fcard-bg);color:var(--fcard-fg);font:var(--dsw-font-xxs-12)}.dsh-my-notify-fcard-btn[data-primary="true"]{border-color:var(--fcard-btn);background:var(--fcard-btn);color:var(--fcard-bg)}.dsh-my-notify-fcard-note{font:var(--dsw-font-xxs-12);color:var(--fcard-fg2);border-top:1px solid var(--fcard-line);padding-top:6px}.dsh-my-notify-fcard-hr{height:1px;background:var(--fcard-line)}
`
const CARD_PALETTE = {
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
  const hit = CARD_ACCENTS.find((option) => option.value === template)
  return hit !== undefined ? hit.value : 'grey'
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
      return `<span class="dsh-my-notify-fcard-btn" data-primary="${primary}">${escapeHtml(label)}</span>`
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
    `<div class="dsh-my-notify-fcard-hd"><span class="dsh-my-notify-fcard-mark"></span>` +
    `<span class="dsh-my-notify-fcard-app">${escapeHtml(strings.fcardApp())}</span></div>` +
    titleHtml +
    `<div class="dsh-my-notify-fcard-bd">${body}</div></div>`
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
