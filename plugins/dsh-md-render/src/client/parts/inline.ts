// ── 行内渲染：单元格内的 code / strong / em / link / del / img ──
// 与 dsh-think-zh-expand 的 mdInline 同规则（CommonMark 语义）：
// N 个反引号开闭配对、**bold**、[link](url)、*em*；issue #81 增补
// **删除线** ~~text~~ 与 **图片** ![alt](url)（图片须先于链接）。返回
// DocumentFragment（无匹配时含单个文本节点）。零运行时依赖。
// 各分支拆为小函数（domXxx），控制 renderInline 圈复杂度 ≤ 10。
function domCode(m: RegExpExecArray): HTMLElement {
  const el = document.createElement('code')
  el.textContent = m[2]
  return el
}

function domStrong(m: RegExpExecArray): HTMLElement {
  const el = document.createElement('strong')
  el.textContent = m[3].slice(2, -2)
  return el
}

function domImg(m: RegExpExecArray): HTMLElement {
  const img = document.createElement('img')
  img.src = m[5]
  img.alt = m[4] || 'image'
  img.className = 'dsh-md-render-img'
  img.setAttribute('loading', 'lazy')
  return img
}

function domLink(m: RegExpExecArray): HTMLElement | string {
  const lm = m[6].match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (!lm) return m[6]
  const a = document.createElement('a')
  a.href = lm[2]
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.textContent = lm[1]
  return a
}

function domDel(m: RegExpExecArray): HTMLElement {
  const el = document.createElement('del')
  el.className = 'dsh-md-render-del'
  el.textContent = m[7]
  return el
}

function domEm(m: RegExpExecArray): HTMLElement {
  const el = document.createElement('em')
  el.textContent = m[8].slice(1, -1)
  return el
}

function inlineDomMatch(m: RegExpExecArray): HTMLElement | string {
  if (m[1] !== undefined) return domCode(m)
  if (m[3] !== undefined) return domStrong(m)
  // issue #84：image 关闭 → 单元格内图片语法保持原文。
  if (m[4] !== undefined && renderOptions.image) return domImg(m)
  if (m[4] !== undefined) return m[0]
  if (m[6] !== undefined) return domLink(m)
  // issue #84：strikethrough 关闭 → 单元格内删除线保持原文。
  if (m[7] !== undefined && renderOptions.strikethrough) return domDel(m)
  if (m[7] !== undefined) return m[0]
  return domEm(m)
}

function renderInline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  // 行内代码 / 粗体 / 图片 / 链接 / 删除线 / 斜体（图片须先于链接）。
  const re =
    /(`+)([^`\n][^\n]*?)\1(?!`)|(\*\*[^*]+\*\*)|!\[([^\]]*)\]\(([^)]+)\)|(\[[^\]]+\]\([^)]+\))|~~([^~]+)~~|(\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
    const node = inlineDomMatch(m)
    if (typeof node === 'string') frag.appendChild(document.createTextNode(node))
    else if (node) frag.appendChild(node)
    last = m.index + m[0].length
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  return frag
}
