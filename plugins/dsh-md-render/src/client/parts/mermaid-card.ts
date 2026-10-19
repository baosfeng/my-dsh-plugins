// ── mermaid 图表卡片（React）── 卡片挂在插件自插的容器里（不动官方节点结构）；
// 官方 <pre> 由自有 CSS 的「块级标记」规则隐藏（标记由 mermaid-scan 写，见 styles-mermaid）。
//
// 结构（原型 .mm-card 3203–3361）：头（标题胶囊 + 类型 + 工具条）/ 体（图表 · Markdown ·
// 源码 三段互斥，由根节点 data-mdr-mm-view 驱动）/ 底（常显「渲染为…」三态 + 说明）。
// 全屏 = 原生 <dialog>（顶层 / Esc / 焦点归还 / 滚动锁定由浏览器提供，90vw × 85vh）。
// 状态一律走 aria-* 与自有 data-*，类名由 React 计算 —— 不写 classList / cssText / el.style。

/** 卡片挂载序号（作用域 id 用；缩放 / 导出都按作用域 id 定位）。 */
let mmCardSeq = 0
/** 块级标记（**既有宿主契约值**：scanner / mermaid-scan 写在官方块与 host 上，自有 CSS
 *  据此隐藏官方 <pre>）。三个名字被 scanner.ts（不在本路写区）直接引用，字面量保持冻结。 */
const MERMAID_VIEW_ATTR = 'data-dsh-md-render-mermaid-view'
const MERMAID_ENTRY_ATTR = 'data-dsh-md-render-mermaid'
const MERMAID_STATE_ATTR = 'data-dsh-md-render-mermaid-state'
/** 提示条定时器（模块级单例：后一条提示覆盖前一条）。 */
let mmNoticeTimer: ReturnType<typeof setTimeout> | null = null

/** 一条短暂提示。 */
interface MmNoticeLine {
  type: string
  text: string
}

/** 渲染状态机：加载引擎 → 离屏渲染 → SVG / 失败原因；令牌机制丢弃迟到结果。 */
function useMmRender(scopeId: string, source: string, attempt: number) {
  const [status, setStatus] = useState('loading')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [tokens] = useState(() => new Map<string, object>())
  useEffect(() => {
    const token = {}
    tokens.set(scopeId, token)
    const current = (): boolean => tokens.get(scopeId) === token
    setStatus('loading')
    const started = typeof performance === 'undefined' ? 0 : performance.now()
    const pending = ensureMermaid()
    if (pending === null) {
      setError('当前环境没有可用的 document，无法渲染图表')
      setStatus('error')
      return undefined
    }
    pending
      .then((engine) => renderSvg(engine, scopeId, source))
      .then((svgText) => {
        if (!current()) return
        setSvg(svgText)
        setError(null)
        setElapsed(typeof performance === 'undefined' ? 0 : Math.max(1, Math.round(performance.now() - started)))
        setStatus('ok')
      })
      .catch((err: unknown) => {
        if (!current()) return
        setError(errMsg(err))
        setStatus('error')
      })
    return () => {
      if (tokens.get(scopeId) === token) tokens.delete(scopeId)
    }
  }, [scopeId, source, attempt, tokens])
  function begin(): void {
    tokens.delete(scopeId)
    setError(null)
    setStatus('loading')
  }
  return { status: status, svg: svg, error: error, elapsed: elapsed, begin: begin }
}

/** 短暂提示（导出成功 / 失败），2.5s 后自动消失。 */
function useMmNotice(): { notice: MmNoticeLine | null; flash: (type: string, text: string) => void } {
  const [notice, setNotice] = useState<MmNoticeLine | null>(null)
  useEffect(() => {
    return () => {
      if (mmNoticeTimer !== null) clearTimeout(mmNoticeTimer)
    }
  }, [])
  function flash(type: string, text: string): void {
    setNotice({ type: type, text: text })
    if (mmNoticeTimer !== null) clearTimeout(mmNoticeTimer)
    mmNoticeTimer = setTimeout(() => setNotice(null), 2500)
  }
  return { notice: notice, flash: flash }
}

/** 取字符串（缺失 / 空串 → 回退值；纯函数）。 */
function mmText(value: string | undefined | null, fallback: string): string {
  return value === undefined || value === null || value === '' ? fallback : value
}

/** 渲染出 SVG 后绑定缩放（懒加载 panzoom；失败自动落降级引擎）；卸载时收掉本作用域。 */
function useMmZoom(scopeId: string, zoomable: boolean, svg: string | null): void {
  useEffect(() => {
    if (!zoomable) return undefined
    const target = zoomTargetsOf(scopeId)
    if (target !== null) void bindZoom(target, scopeId)
    return undefined
  }, [scopeId, zoomable, svg])
  useEffect(() => () => destroyZoomScope(scopeId), [scopeId])
}

/** 图表区：加载中 / 失败态（源码为主 + 一行原因 + 重试）/ 渲染出的 SVG。 */
function MmDiagram(props: {
  status: string
  svg: string | null
  error: string | null
  source: string
  onRetry: () => void
}): unknown {
  if (props.status === 'loading') {
    return createElement(
      'div',
      { className: 'mdr-mm-loading' },
      mmIcon('refresh', 14),
      createElement('span', null, '渲染中…'),
    )
  }
  if (props.status === 'error')
    return createElement(MmDiagramError, { error: props.error, source: props.source, onRetry: props.onRetry })
  if (props.svg === null) return createElement('pre', { className: 'mdr-mm-code' }, props.source)
  return createElement('div', { className: 'mdr-mm-canvas', dangerouslySetInnerHTML: { __html: props.svg } })
}

/** 失败态：源码是主视觉（DOM 第一个节点 = 首屏内容），失败原因降为一行灰字。 */
function MmDiagramError(props: { error: string | null; source: string; onRetry: () => void }): unknown {
  return createElement(
    'div',
    { className: 'mdr-mm-error' },
    createElement('pre', { className: 'mdr-mm-error-src' }, props.source),
    createElement(
      'div',
      { className: 'mdr-mm-error-msg' },
      mmIcon('alert', 13),
      createElement('span', null, '图表渲染失败：' + String(props.error ?? '')),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mdr-icon-btn mdr-mm-retry',
          onClick: props.onRetry,
          'aria-label': '重试',
          'data-mdr-tip': '重试渲染',
        },
        mmIcon('refresh', 12),
      ),
    ),
  )
}

/** Markdown 视图：把源码当 markdown 渲染（marked 未就绪 → 退回纯文本，绝不留白）。 */
function MmMarkdownPanel(props: { view: MmView; source: string }): unknown {
  const [host, setHost] = useState<Element | null>(null)
  const [rendered, setRendered] = useState(true)
  useEffect(() => {
    if (props.view !== 'markdown' || host === null) return undefined
    setRendered(renderMarkdownInto(host, props.source))
    return () => unmountMarkdownIn(host)
  }, [props.view, props.source, host])
  return createElement(
    'div',
    { className: 'mdr-mm-md' },
    createElement('div', { ref: setHost }),
    rendered ? null : createElement('div', { className: 'mdr-mm-md-fallback' }, props.source),
  )
}

/** 提示条（成功 / 失败一行，无提示时返回 null）。 */
function MmNoticeBar(props: { notice: MmNoticeLine | null }): unknown {
  if (props.notice === null) return null
  return createElement(
    'div',
    { className: 'mdr-mm-notice', 'data-mdr-mm-notice': props.notice.type },
    mmIcon(props.notice.type === 'ok' ? 'check' : 'alert', 13),
    createElement('span', null, props.notice.text),
  )
}

/** 打开原生模态（已打开 / 伪 DOM → 静默跳过）。 */
function mmDialogShow(dialogEl: HTMLDialogElement): void {
  try {
    if (typeof dialogEl.showModal === 'function' && dialogEl.open !== true) dialogEl.showModal()
  } catch (_e) {
    /* 已打开 / 伪 DOM：不阻断渲染 */
  }
}

/** 关闭原生模态（已关闭 / 伪 DOM → 静默跳过）。 */
function mmDialogClose(dialogEl: HTMLDialogElement): void {
  try {
    if (typeof dialogEl.close === 'function' && dialogEl.open === true) dialogEl.close()
  } catch (_e) {
    /* 已关闭 */
  }
}

/** 全屏浮窗（原生 <dialog>）：克隆出来的 SVG 走独立作用域，缩放与卡片互不影响。 */
function MdrMmDialog(props: {
  open: boolean
  scopeId: string
  title: string
  kind: string
  svg: string | null
  elapsed: number
  onClose: () => void
  onExportSvg: () => void
}): unknown {
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null)
  const fsId = props.scopeId + '-fs'
  useEffect(() => {
    if (dialogEl === null) return undefined
    const onCancel = (event: Event): void => {
      event.preventDefault()
      props.onClose()
    }
    const onClose = (): void => props.onClose()
    dialogEl.addEventListener('cancel', onCancel)
    dialogEl.addEventListener('close', onClose)
    if (props.open) mmDialogShow(dialogEl)
    else mmDialogClose(dialogEl)
    return () => {
      dialogEl.removeEventListener('cancel', onCancel)
      dialogEl.removeEventListener('close', onClose)
      mmDialogClose(dialogEl)
      destroyZoomScope(fsId)
    }
  }, [dialogEl, fsId, props.open])
  useEffect(() => {
    if (!props.open) return undefined
    const target = zoomTargetsOf(fsId)
    if (target !== null) void bindZoom(target, fsId)
    return undefined
  }, [fsId, props.open, props.svg])
  return createElement(
    'dialog',
    {
      className: 'mdr-mm-dialog',
      ref: setDialogEl,
      'aria-label': 'mermaid 全屏',
      onClick: (event: { target?: unknown; currentTarget?: unknown }) => {
        if (event.target === event.currentTarget) props.onClose()
      },
    },
    createElement(MdrMmDialogHead, {
      fsId: fsId,
      title: props.title,
      kind: props.kind,
      onClose: props.onClose,
      onExportSvg: props.onExportSvg,
    }),
    createElement(
      'div',
      { className: 'mdr-mm-dialog-body mdr-mm-frame', 'data-mdr-mm': fsId, 'data-mdr-mm-fs': 'open' },
      createElement('div', { className: 'mdr-mm-canvas', dangerouslySetInnerHTML: { __html: props.svg ?? '' } }),
    ),
    createElement(
      'div',
      { className: 'mdr-mm-dialog-foot' },
      createElement('span', null, 'Esc 关闭 · 缩放只影响显示，不改变导出尺寸'),
      createElement('span', { className: 'mdr-mm-spacer' }),
      createElement('span', { className: 'mdr-mm-meta' }, '图表渲染耗时 ' + String(props.elapsed) + 'ms'),
    ),
  )
}

/** Mermaid 图表卡片（签名冻结：source / kind / title）。 */
function MdrMermaidCard(props: { source: string; kind: string; title: string }): unknown {
  const [scopeId] = useState(() => 'mdr-mm-' + ++mmCardSeq)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<MmView>('diagram')
  const [fsOpen, setFsOpen] = useState(false)
  const source = String(props.source ?? '')
  const kind = mmText(props.kind, mermaidKindOf(source))
  const title = mmText(props.title, kind)
  const { status, svg, error, elapsed, begin } = useMmRender(scopeId, source, attempt)
  const { notice, flash } = useMmNotice()
  const exportActions = makeExportHandlers(scopeId, source, flash)
  const ready = status === 'ok' && svg !== null
  const zoomable = ready && view === 'diagram'
  useMmZoom(scopeId, zoomable, svg)
  function retry(): void {
    resetMermaidEngine()
    begin()
    setAttempt((n) => n + 1)
  }
  return createElement(
    'div',
    {
      // mdr-root：通用控件（.mdr-icon-btn / .mdr-seg / .mdr-btn）的 token 作用域。
      className: 'mdr-mm-card mdr-root',
      'data-mdr-mm': scopeId,
      // 图表标记：其它注入点（lang-switch）据此跳过「渲染为…」控件，避免两套入口并存。
      'data-mdr-mermaid': 'true',
      'data-mdr-mm-state': status,
      'data-mdr-mm-view': view,
    },
    createElement(MmCardHead, {
      title: title,
      kind: kind,
      status: status,
      view: view,
      ready: ready,
      zoomable: zoomable,
      scopeId: scopeId,
      onView: (next: 'diagram' | 'source') => setView(next),
      onOpenFullscreen: () => setFsOpen(true),
      exportActions: exportActions,
    }),
    createElement(MmNoticeBar, { notice: notice }),
    createElement(
      'div',
      { className: 'mdr-mm-body mdr-mm-frame' },
      createElement(MmDiagram, { status: status, svg: svg, error: error, source: source, onRetry: retry }),
    ),
    createElement(MmMarkdownPanel, { view: view, source: source }),
    createElement('pre', { className: 'mdr-mm-code' }, source),
    createElement(MdrMmModeBar, {
      view: view,
      onView: (next: MmView) => setView(next),
      meta: () => kind + ' · 由 dsh-md-render 渲染',
    }),
    createElement(MdrMmDialog, {
      open: fsOpen && ready,
      scopeId: scopeId,
      title: title,
      kind: kind,
      svg: svg,
      elapsed: elapsed,
      onClose: () => setFsOpen(false),
      onExportSvg: exportActions.onSvg,
    }),
  )
}

exports.MdrMermaidCard = MdrMermaidCard
exports.MmDiagram = MmDiagram
exports.MmDiagramError = MmDiagramError
exports.MERMAID_VIEW_ATTR = MERMAID_VIEW_ATTR
exports.MERMAID_ENTRY_ATTR = MERMAID_ENTRY_ATTR
exports.MERMAID_STATE_ATTR = MERMAID_STATE_ATTR
