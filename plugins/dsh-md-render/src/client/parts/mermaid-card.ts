// ── mermaid 图表卡片（React）── 卡片只挂在本插件自插的容器里（不改官方节点结构）；
// 官方 `<pre>` 由自有 CSS 的 `[data-dsh-md-render-mermaid-view]` 规则隐藏。

/** 卡片 host 标记（entryId）。 */
const MERMAID_ENTRY_ATTR = 'data-dsh-md-render-mermaid'
/** 渲染态（loading / ok / error；写在 host 上，与 React 提交时机解耦）。 */
const MERMAID_STATE_ATTR = 'data-dsh-md-render-mermaid-state'
/** 视图标记（preview / code；驱动自有 CSS 隐藏官方 pre）。 */
const MERMAID_VIEW_ATTR = 'data-dsh-md-render-mermaid-view'
/** 卡片根 / SVG 容器类名（mermaid-zoom 共用）。 */
const MERMAID_CARD_CLASS = 'dsh-md-render-mermaid-card'
const MERMAID_SVG_CLASS = 'dsh-md-render-mermaid-svg'
/** 变换层类名：panzoom 只变换它，外层容器负责裁剪。 */
const MERMAID_CANVAS_CLASS = 'dsh-md-render-mermaid-canvas'
/** 挂载序号（entryId 用）。 */
let mermaidSeq = 0
/** 「更多」菜单触发按钮的标记（Esc 归还焦点时按 entryId 找它）。 */
const MENU_BTN_ATTR = 'data-dsh-md-render-menu-btn'

/** 通知状态。 */
interface Notice {
  type: 'ok' | 'error'
  text: string
}

/** 记录一条渲染态转移（写到卡片 host 的真实 DOM 属性上）。 */
function noteRenderState(entryId: string, state: string): void {
  if (typeof document === 'undefined' || document === null) return
  const host = document.querySelector('[' + MERMAID_ENTRY_ATTR + '="' + entryId + '"]')
  if (host && typeof host.setAttribute === 'function') host.setAttribute(MERMAID_STATE_ATTR, state)
}

/** 渲染状态机（加载引擎 → 离屏渲染 → SVG / 失败原因）；令牌机制丢弃迟到结果。 */
function useMermaidRender(entryId: string, source: string, attempt: number) {
  const [status, setStatus] = useState('loading')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tokens] = useState(() => new Map<string, object>())
  useEffect(() => {
    const token = {}
    tokens.set(entryId, token)
    const current = (): boolean => tokens.get(entryId) === token
    setStatus('loading')
    noteRenderState(entryId, 'loading')
    ensureMermaid()
      .then((m) => renderSvg(m, entryId, source))
      .then((svgText) => {
        if (!current()) return
        setSvg(svgText)
        setError(null)
        setStatus('ok')
        noteRenderState(entryId, 'ok')
      })
      .catch((err: unknown) => {
        if (!current()) return
        setError(errMsg(err))
        setStatus('error')
        noteRenderState(entryId, 'error')
      })
    return () => {
      if (tokens.get(entryId) === token) tokens.delete(entryId)
    }
  }, [entryId, source, attempt, tokens])
  /** 立刻回到 loading（重试时先重置视图、并作废在飞的一轮，不等 effect 跑完）。 */
  function begin(): void {
    tokens.delete(entryId)
    setError(null)
    setStatus('loading')
    noteRenderState(entryId, 'loading')
  }
  return { status, svg, error, begin }
}

/** 导出结果提示条（成功/失败），无提示时返回 null。 */
function renderNotice(notice: Notice | null) {
  if (!notice) return null
  return createElement(
    'div',
    { className: 'dsh-md-render-mermaid-notice dsh-md-render-mermaid-notice-' + notice.type },
    notice.text,
  )
}

/** 卡片主体：loading / error（含源码与重试）/ 代码视图 / 渲染出的 SVG。 */
function CardBody({
  status,
  mode,
  error,
  source,
  svg,
  onRetry,
}: {
  status: string
  mode: string
  error: string | null
  source: string
  svg: string | null
  onRetry: () => void
}) {
  if (status === 'loading') {
    return createElement(
      'div',
      { className: 'dsh-md-render-mermaid-loading' },
      icon.refresh(14),
      createElement('span', null, '渲染中…'),
    )
  }
  if (status === 'error') {
    // 主次反转：源码是主视觉，失败原因降为一行灰字；「重试」是加载失败的唯一恢复路径。
    return createElement(
      'div',
      { className: 'dsh-md-render-mermaid-error' },
      createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source),
      createElement(
        'div',
        { className: 'dsh-md-render-mermaid-error-line' },
        icon.alert(13),
        createElement(
          'span',
          { className: 'dsh-md-render-mermaid-error-msg' },
          'Mermaid 渲染失败：' + String(error ?? ''),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-md-render-mermaid-eb dsh-md-render-mermaid-retry',
            onClick: onRetry,
            'aria-label': '重试',
            'data-dsh-md-render-tip': '重试渲染',
          },
          icon.refresh(13),
        ),
      ),
    )
  }
  if (mode === 'code' || !svg) return createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source)
  return createElement(
    'div',
    { className: MERMAID_SVG_CLASS },
    createElement('div', { className: MERMAID_CANVAS_CLASS, dangerouslySetInnerHTML: { __html: svg } }),
  )
}

/** Mermaid 图表卡片组件。 */
function MermaidCard({ entryId, source }: { entryId: string; source: string }) {
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [notice, setNotice] = useState<Notice | null>(null)
  const { status, svg, error, begin } = useMermaidRender(entryId, source, attempt)

  /** 重试：先清引擎加载缓存（上次可能就失败在加载），再重跑渲染。 */
  function retry(): void {
    resetMermaidEngine()
    begin()
    setAttempt((n) => n + 1)
  }
  /** 短暂提示（成功/失败），2.5s 后自动消失。 */
  function flashNotice(type: string, text: string): void {
    setNotice({ type: type as 'ok' | 'error', text })
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => setNotice(null), 2500)
  }
  const exportActions = makeExportHandlers(entryId, source, flashNotice)
  // 失败态把视图钉到 code：按钮激活态与实际显示一致。
  const view = status === 'error' ? 'code' : mode
  /** 可缩放 = 已渲染出图且停在预览态（缩放分段与菜单里的缩放项都按它启用）。 */
  const zoomable = svg !== null && view === 'preview'
  // 渲染出 SVG 后绑定缩放 / 平移（懒加载 panzoom；失败只标记卡片，不再静默）。
  // 清理时收掉本卡片的浮窗：组件卸载 / 切到代码视图都不留浮窗。
  useEffect(() => {
    if (status !== 'ok' || view !== 'preview') return undefined
    const target = zoomTargetsOf(entryId)
    if (target !== null) bindZoom(target)
    return () => closeOverlayOf(entryId)
  }, [entryId, status, view])
  return createElement(
    'div',
    { className: MERMAID_CARD_CLASS },
    createElement(
      'div',
      { className: 'dsh-md-render-mermaid-card-head' },
      createElement(
        'div',
        { className: 'dsh-md-render-mermaid-card-title' },
        // 「图表」用 chart 图标（原来借用 file，语义不准）。
        icon.chart(12),
        createElement('span', null, 'Mermaid 图表'),
      ),
      // 卡片头**最多一行**：视图切换 → 缩放分段（算一个控件）→ 全屏浮窗（常驻）→「更多」（低频收纳）。
      createElement(
        'div',
        { className: 'dsh-md-render-mermaid-card-actions' },
        createElement(ViewToggle, { mode: view, setMode, previewDisabled: status === 'error' }),
        zoomable ? createElement(ZoomSeg, { entryId }) : null,
        // 全屏浮窗**常驻**（用户口径：全屏放在外面，不藏进「更多」）—— 未出图 / 代码视图下禁用
        createElement(FullscreenButton, { entryId, disabled: !zoomable }),
        createElement(CardMenu, { entryId, ready: status === 'ok', zoomable, ...exportActions }),
      ),
    ),
    renderNotice(notice),
    createElement(CardBody, { status, mode: view, error, source, svg, onRetry: retry }),
  )
}

/** 提示条定时器（模块级单例：后一条提示覆盖前一条）。 */
let noticeTimer: ReturnType<typeof setTimeout> | null = null

exports.MERMAID_ENTRY_ATTR = MERMAID_ENTRY_ATTR
exports.MERMAID_STATE_ATTR = MERMAID_STATE_ATTR
exports.MERMAID_VIEW_ATTR = MERMAID_VIEW_ATTR
exports.noteRenderState = noteRenderState
exports.MERMAID_CARD_CLASS = MERMAID_CARD_CLASS
exports.MERMAID_SVG_CLASS = MERMAID_SVG_CLASS
exports.MERMAID_CANVAS_CLASS = MERMAID_CANVAS_CLASS
exports.CardBody = CardBody
exports.MermaidCard = MermaidCard
