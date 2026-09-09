// ── 复制按钮（issue #74）：代码块 / 整段内容一键复制 ─────────────
// 复制实现：navigator.clipboard.writeText 优先，失败回退
// document.execCommand('copy')（textarea 中转）；复制成功后按钮文案
// 切换「已复制」1.5s 后恢复；流式渲染中（[data-streaming] 祖先）由
// styles.ts 的 `[data-streaming] .dsh-md-render-copy{display:none}`
// 规则隐藏（按钮始终渲染，流式结束自动可见）。
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

function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).catch(() => {
      if (!fallbackCopyText(text)) throw new Error('copy failed')
    })
  }
  if (!fallbackCopyText(text)) return Promise.reject(new Error('copy failed'))
  return Promise.resolve()
}

// 收集容器纯文本（跳过复制按钮，避免按钮文案混入复制内容）。
// 不用 textContent 直取：textContent 包含 display:none 元素的文本，
// 按钮文案会混入；递归遍历 childNodes 并跳过 .dsh-md-render-copy。
function collectCopyText(node: Node, out: (string | null)[]): void {
  if (node.nodeType === 3) {
    out.push(node.textContent)
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  // 跳过复制按钮与代码块头部（语言标签，issue #80），避免文案混入复制内容。
  if (el.matches('.dsh-md-render-copy') || el.matches('.dsh-md-render-code-head')) return
  const kids = node.childNodes
  for (let i = 0; i < kids.length; i += 1) collectCopyText(kids[i], out)
}

// kind: 'code'（md-code-block 内，复制 code 文本）| 'content'（tzx-md 内，
// 复制整段纯文本）。点击时从 DOM 取文本（流式结束后内容已稳定）。
function CopyButton({ kind }: { kind: 'code' | 'content' }): unknown {
  const [copied, setCopied] = useState(false)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const host =
      event && event.currentTarget ? event.currentTarget.closest(kind === 'code' ? '.md-code-block' : '.tzx-md') : null
    if (!host) return
    let text: string
    if (kind === 'code') {
      const codeEl = host.querySelector('code')
      text = codeEl ? (codeEl.textContent ?? '') : ''
    } else {
      const out: (string | null)[] = []
      collectCopyText(host, out)
      text = out.join('')
    }
    if (!text) return
    copyText(text).then(
      () => {
        setCopied(true)
        if (timer) clearTimeout(timer)
        setTimer(setTimeout(() => setCopied(false), 1500))
      },
      () => {},
    )
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-md-render-copy' + (copied ? ' dsh-md-render-copy-done' : ''),
      title: copied ? '已复制' : '复制',
      'aria-label': copied ? '已复制' : '复制',
      onClick,
    },
    copied ? '已复制' : '复制',
  )
}
