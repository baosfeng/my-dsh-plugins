// ── 整段 markdown 复制（官方只有代码块复制）────────────────────────
// 复制实现：navigator.clipboard.writeText 优先，失败回退
// document.execCommand('copy')（textarea 中转）；复制成功后按钮文案
// 切换「已复制」1.5s 后恢复；流式渲染中（[data-streaming] 祖先）由
// styles.ts 的 [data-streaming] .dsh-md-render-copy{display:none} 规则隐藏。
function fallbackCopyText(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok: boolean
  try {
    ok = document.execCommand('copy')
  } catch (_e) {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

/** 复制文本：clipboard API 优先，失败回退 execCommand；失败 reject。 */
function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).catch(() => {
      if (!fallbackCopyText(text)) throw new Error('copy failed')
    })
  }
  if (!fallbackCopyText(text)) return Promise.reject(new Error('copy failed'))
  return Promise.resolve()
}

/** 是否应跳过该元素（复制按钮自身 / 官方代码块 banner：语言名+复制按钮文案）。 */
function isCopyNoise(el: Element): boolean {
  if (el.matches('.dsh-md-render-copy') || el.matches('button')) return true
  return el.matches('[data-code-block-banner]') || el.matches('.dsh-md-render-code-head')
}

// 收集容器纯文本（跳过复制按钮与代码块 banner，避免按钮/语言名文案混入）。
// 不用 textContent 直取：textContent 包含 display:none 元素的文本，
// 按钮文案会混入；递归遍历 childNodes 并跳过噪声元素。
function collectCopyText(node: Node, out: (string | null)[]): void {
  if (node.nodeType === 3) {
    out.push(node.textContent)
    return
  }
  if (node.nodeType !== 1) return
  if (isCopyNoise(node as Element)) return
  const kids = node.childNodes
  for (let i = 0; i < kids.length; i += 1) collectCopyText(kids[i], out)
}

// kind: 'content'（tzx-md 内，复制整段纯文本；官方代码块复制按钮由官方提供）。
// 点击时从 DOM 取文本（流式结束后内容已稳定）。
// 外观与状态对齐原型（08-prototype.html 的 .md-copy）：图标 + 文案、data-state 三态
// （idle / copied / failed）、1.6s 回退；状态色与确认动效在 styles.ts。
// 失败态只在**两条通道都不通**时出现（clipboard → execCommand 兜底，原型 §C 同款三分支）。
function CopyButton({ kind }: { kind: 'content' }): unknown {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const flash = (next: 'copied' | 'failed'): void => {
    setState(next)
    if (timer) clearTimeout(timer)
    setTimer(setTimeout(() => setState('idle'), 1600))
  }
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const host = event && event.currentTarget ? event.currentTarget.closest(kind === 'content' ? '.tzx-md' : '') : null
    if (!host) return
    const out: (string | null)[] = []
    collectCopyText(host, out)
    const text = out.join('')
    if (!text) return
    copyText(text).then(
      () => flash('copied'),
      () => flash('failed'),
    )
  }
  const label = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择文本' : '复制整段 markdown'
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-md-render-copy',
      'data-state': state,
      title: label,
      'aria-label': label,
      onClick,
    },
    createElement('span', { className: 'dsh-md-render-copy-ico' }, state === 'copied' ? icon.check(14) : icon.copy(14)),
    state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制',
  )
}

exports.copyText = copyText
exports.fallbackCopyText = fallbackCopyText
