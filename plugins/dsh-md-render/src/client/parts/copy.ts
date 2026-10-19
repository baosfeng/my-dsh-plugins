// ── 复制按钮（B 路）：idle / copied / failed 三态 ─────────────────────────
// 复用面：围栏卡（复制代码原文）、整段 markdown（复制整段纯文本）。
// 通道：navigator.clipboard.writeText 优先，失败回退 document.execCommand('copy')
// （textarea 中转）；两条通道都不通 → failed 态（1.6s 后回 idle）。
// 纪律：不写 el.style / classList / cssText —— textarea 的隐藏与定位全走
// STYLES_CODE 的 .mdr-copy-sink 类名（只 setAttribute 自有标记）。

/** 复制按钮基类 / 文案 / 复位时长（原型 1.6s 回退）。 */
const MDR_COPY_CLASS = 'mdr-copy'
const MDR_COPY_LABEL_CLASS = 'mdr-copy-label'
const MDR_COPY_SINK_CLASS = 'mdr-copy-sink'
const MDR_COPY_RESET_MS = 1600

/** 复制失败兜底：隐藏 textarea + execCommand('copy')（无样式写入，类名负责隐藏）。 */
function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined' || document === null || !document.body) return false
  const sink = document.createElement('textarea')
  sink.value = text
  sink.className = MDR_COPY_SINK_CLASS
  sink.setAttribute('readonly', '')
  sink.setAttribute('aria-hidden', 'true')
  document.body.appendChild(sink)
  let ok = false
  try {
    sink.select()
    ok = typeof document.execCommand === 'function' ? !!document.execCommand('copy') : false
  } catch (_e) {
    ok = false
  }
  if (sink.parentNode) sink.parentNode.removeChild(sink)
  return ok
}

/** 复制文本：clipboard API 优先，失败回退 execCommand；两条通道失败 → reject。 */
function copyText(text: string): Promise<void> {
  const clipboard =
    typeof navigator !== 'undefined' && navigator !== null
      ? (navigator as { clipboard?: unknown }).clipboard
      : undefined
  const writeText =
    clipboard !== null && clipboard !== undefined
      ? (clipboard as { writeText?: (value: string) => Promise<void> }).writeText
      : undefined
  if (typeof writeText === 'function') {
    return writeText.call(clipboard, text).catch(() => {
      if (!fallbackCopyText(text)) throw new Error('copy failed')
    })
  }
  if (!fallbackCopyText(text)) return Promise.reject(new Error('copy failed'))
  return Promise.resolve()
}

/** 复制按钮文案（状态语义：idle=复制 / copied=已复制 / failed=复制失败）。 */
function mdrCopyLabel(state: string): string {
  if (state === 'copied') return '已复制'
  if (state === 'failed') return '复制失败'
  return '复制'
}

/** 复制按钮类名（状态用语义类，不用 classList）。 */
function mdrCopyClassName(state: string, extra: string | undefined): string {
  const classes = ['mdr-btn', MDR_COPY_CLASS]
  if (state === 'copied') classes.push('is-copied')
  if (state === 'failed') classes.push('is-failed')
  if (typeof extra === 'string' && extra !== '') classes.push(extra)
  return classes.join(' ')
}

/**
 * 从 DOM 容器收集纯文本（跳过按钮 / 语言胶囊等噪声），供「不传 text」的调用面在
 * 点击时按容器现取（整段 markdown 复制）。
 */
function mdrCollectText(node: unknown, out: string[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return
  const item = node as { nodeType?: number; textContent?: string; childNodes?: unknown }
  if (item.nodeType === 3) {
    if (typeof item.textContent === 'string') out.push(item.textContent)
    return
  }
  if (item.nodeType !== 1 || mdrCollectSkip(item)) return
  const kids = Array.isArray(item.childNodes) ? item.childNodes : []
  for (const kid of kids) mdrCollectText(kid, out)
}

/** 噪声元素（按钮 / 胶囊 / 卡片头尾）：不计入整段复制的纯文本。 */
function mdrCollectSkip(item: object): boolean {
  const el = item as { matches?: (selector: string) => boolean }
  if (typeof el.matches !== 'function') return false
  try {
    return el.matches('button,.mdr-pill,.mdr-fence-head,.mdr-fence-foot')
  } catch (_e) {
    return false /* 选择器不成立 → 继续收集 */
  }
}

/** 点击时从最近容器取整段纯文本（text 为空时的兜底）。 */
function mdrCopyTextOf(target: unknown): string {
  const el = target as { closest?: (selector: string) => unknown } | null
  if (el === null || el === undefined || typeof el.closest !== 'function') return ''
  const host = el.closest('.mdr-md,.tzx-md,.mdr-ctx-body')
  if (host === null || host === undefined) return ''
  const out: string[] = []
  mdrCollectText(host, out)
  return out.join('')
}

/**
 * 复制按钮（契约导出）：props = { text, tip, className? }。
 * text 为空串时退化为「点击时从最近 .mdr-md 容器取纯文本」。
 */
function MdrCopyButton(props: { text: string; tip: string; className?: string }): unknown {
  const [state, setState] = useState('idle')
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const flash = (next: string): void => {
    setState(next)
    if (timer !== null) clearTimeout(timer)
    setTimer(setTimeout(() => setState('idle'), MDR_COPY_RESET_MS))
  }
  const onClick = (event: unknown): void => {
    const target = event === null || event === undefined ? null : (event as { currentTarget?: unknown }).currentTarget
    const text = typeof props.text === 'string' && props.text !== '' ? props.text : mdrCopyTextOf(target)
    if (text === '') {
      flash('failed')
      return
    }
    copyText(text).then(
      () => flash('copied'),
      () => flash('failed'),
    )
  }
  const label = mdrCopyLabel(state)
  return createElement(
    'button',
    {
      type: 'button',
      className: mdrCopyClassName(state, props.className),
      'data-mdr-state': state,
      'data-mdr-tip': state === 'idle' ? props.tip : label,
      'aria-label': label,
      onClick,
    },
    createElement('span', { className: MDR_COPY_LABEL_CLASS }, label),
  )
}

exports.MDR_COPY_CLASS = MDR_COPY_CLASS
exports.MDR_COPY_RESET_MS = MDR_COPY_RESET_MS
exports.fallbackCopyText = fallbackCopyText
exports.copyText = copyText
exports.mdrCopyLabel = mdrCopyLabel
exports.mdrCopyClassName = mdrCopyClassName
exports.mdrCopyTextOf = mdrCopyTextOf
exports.MdrCopyButton = MdrCopyButton
