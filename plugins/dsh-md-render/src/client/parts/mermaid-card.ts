// ── mermaid 图表卡片（React）── 卡片只挂在本插件自插的容器里（不改官方节点结构）；
// 官方 `<pre>` 由自有 CSS 的 `[data-dsh-md-render-mermaid-view]` 规则隐藏。

/** 共享图标集（dsh-shared/client-parts/icons.part.js，构建期拼接进本作用域）。 */
declare const icon: Record<string, (size?: number) => unknown>

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

/** 导出按钮组：下载 PNG / 下载 SVG / 复制代码。 */
function ExportButtons({
  status,
  onPng,
  onSvg,
  onCopy,
}: {
  status: string
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}) {
  const ready = status === 'ok'
  const btn = (label: string, iconNode: unknown, onClick: () => void, disabled: boolean) =>
    createElement(
      'button',
      { type: 'button', className: 'dsh-md-render-mermaid-eb', onClick, disabled, title: label, 'aria-label': label },
      iconNode,
      createElement('span', null, label),
    )
  return createElement(
    'div',
    { className: 'dsh-md-render-mermaid-export', role: 'group', 'aria-label': 'export' },
    btn('下载 PNG', icon.download(14), onPng, !ready),
    btn('下载 SVG', icon.download(14), onSvg, !ready),
    btn('复制代码', icon.copy(14), onCopy, false),
  )
}

/** 预览 / 代码 视图切换；渲染失败时禁用预览（否则只剩激活态假象）。 */
function ViewToggle({
  mode,
  setMode,
  previewDisabled,
}: {
  mode: 'preview' | 'code'
  setMode: (mode: 'preview' | 'code') => void
  previewDisabled?: boolean
}) {
  const btn = (label: string, value: 'preview' | 'code', iconNode: unknown, disabled: boolean) =>
    createElement(
      'button',
      {
        type: 'button',
        className:
          mode === value ? 'dsh-md-render-mermaid-vt dsh-md-render-mermaid-vt-active' : 'dsh-md-render-mermaid-vt',
        onClick: () => setMode(value),
        disabled,
        'aria-pressed': mode === value,
      },
      iconNode,
      createElement('span', null, label),
    )
  return createElement(
    'div',
    { className: 'dsh-md-render-mermaid-view-toggle', role: 'group', 'aria-label': 'view mode' },
    btn('预览', 'preview', icon.file(14), previewDisabled === true),
    btn('代码', 'code', icon.code(14), false),
  )
}

/** 缩放 / 浮窗工具条：全屏（浮窗）/ 适应 / 铺满 / 100% / ±。
 *  title 兼作**快捷键与手势的发现入口** —— 键盘 + - 0 与方向键、双击切换、双指捏合
 *  此前都实现了但**没有任何提示**（市面做法见调研：viewer.js / draw.io 都在文档明列快捷键）。
 *  aria-label 保持简短（屏幕阅读器读的是它，不能塞整句提示）。 */
function ZoomBar({ entryId }: { entryId: string }) {
  const btn = (label: string, ariaLabel: string, title: string, action: () => void) =>
    createElement(
      'button',
      { type: 'button', className: 'dsh-md-render-mermaid-eb', onClick: action, title, 'aria-label': ariaLabel },
      createElement('span', null, label),
    )
  return createElement(
    'div',
    { className: 'dsh-md-render-mermaid-zoom', role: 'group', 'aria-label': '图表缩放' },
    // 实时缩放百分比：小图放大 25% 肉眼几乎无感，用数字给出明确反馈。
    createElement('span', { className: 'dsh-md-render-mermaid-zoom-pct' }, '100%'),
    btn('全屏', '全屏浮窗', '全屏浮窗（Esc 关闭）', () => toggleCardOverlay(entryId)),
    btn('适应', '适应容器', '适应容器：完整显示整张图（双击图表可在「适应 / 实际大小」间切换）', () =>
      zoomEntry(entryId, 'fit'),
    ),
    // 铺满 = 按容器宽度填满（PhotoSwipe 的 fill / Panzoom 的 cover）：宽图比「适应」更实用。
    btn('铺满', '适应宽度', '适应宽度：按容器宽度铺满，高度超出时可拖动平移', () => zoomEntry(entryId, 'fill')),
    btn('100%', '实际大小', '实际大小 100%（键盘 0 复位、双击在适应与实际大小间切换）', () =>
      zoomEntry(entryId, 'full'),
    ),
    btn('−', '缩小', '缩小（键盘 −，或触控板双指捏合）', () => zoomEntry(entryId, 'out')),
    btn('+', '放大', '放大（键盘 +，或触控板双指捏合）', () => zoomEntry(entryId, 'in')),
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
            title: '重试渲染',
            'aria-label': '重试',
          },
          icon.refresh(13),
          createElement('span', null, '重试'),
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
function MermaidCard({
  entryId,
  source,
  onForce,
}: {
  entryId: string
  source: string
  onForce?: (value: string) => void
}) {
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
        icon.file(12),
        createElement('span', null, 'Mermaid 图表'),
      ),
      createElement(
        'div',
        { className: 'dsh-md-render-mermaid-card-actions' },
        createElement(ExportButtons, { status, ...exportActions }),
        // 语言手动切换（需求 4）：卡片头承载另外两项。
        onForce ? createElement(CardLangSwitch, { onForce }) : null,
        createElement(ViewToggle, { mode: view, setMode, previewDisabled: status === 'error' }),
      ),
    ),
    renderNotice(notice),
    // 缩放条放图表上方：卡片底部会被宿主输入框浮层盖住 → 幽灵按钮。
    svg && view === 'preview' ? createElement(ZoomBar, { entryId }) : null,
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
exports.ZoomBar = ZoomBar
exports.CardBody = CardBody
exports.ViewToggle = ViewToggle
exports.MermaidCard = MermaidCard
