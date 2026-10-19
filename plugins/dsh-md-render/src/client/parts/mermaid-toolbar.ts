// ── mermaid 卡片工具条（React）──────────────────────────────────────────
// 常驻：视图分段（预览 / 代码，带文字）+ 缩放分段（− 100% +）+ 全屏 + 更多；
// 低频操作收进「更多」菜单（导出 PNG / SVG、缩放模式、复制代码）—— 用户口径
// 「外面有的，里面就别再有」，所以全屏只常驻、菜单里不重复。
// 底栏「渲染为… 图表 / Markdown / 源码」**常显**（三态互斥，不藏进菜单）。
// 所有状态走 aria-* / 属性，类名由 React 计算（不碰 classList / el.style）。

/** 视图三段（卡片正文一次只显示一段）。 */
type MmView = 'diagram' | 'markdown' | 'source'

/** 图标快捷方式（共享图标集；显式尺寸，CSS 不参与图标几何）。 */
function mmIcon(name: string, size: number): unknown {
  return icon[name](size)
}

/** 预览 / 代码 视图分段（渲染失败时禁用预览，避免只剩激活态假象）。 */
function MdrMmViewSeg(props: {
  view: MmView
  onView: (view: 'diagram' | 'source') => void
  previewDisabled: boolean
}): unknown {
  const btn = (label: string, value: 'diagram' | 'source', iconNode: unknown, disabled: boolean): unknown =>
    createElement(
      'button',
      {
        type: 'button',
        className: 'mdr-seg-btn' + (props.view === value ? ' is-active' : ''),
        onClick: () => props.onView(value),
        disabled: disabled,
        'aria-pressed': props.view === value,
        'data-mdr-tip': label,
      },
      iconNode,
      createElement('span', null, label),
    )
  return createElement(
    'div',
    { className: 'mdr-seg', role: 'group', 'aria-label': '图表视图切换' },
    btn('预览', 'diagram', mmIcon('eye', 12), props.previewDisabled),
    btn('代码', 'source', mmIcon('code', 12), false),
  )
}

/** 缩放分段：− / 百分比 / + 收进一个胶囊（百分比是显示值，由 zoom-math 更新）。 */
function MdrMmZoomSeg(props: { scopeId: string }): unknown {
  const btn = (label: string, tip: string, iconNode: unknown, action: string): unknown =>
    createElement(
      'button',
      {
        type: 'button',
        className: 'mdr-icon-btn',
        onClick: () => zoomEntry(props.scopeId, action),
        'aria-label': label,
        'data-mdr-tip': tip,
      },
      iconNode,
    )
  return createElement(
    'div',
    { className: 'mdr-mm-zoom', role: 'group', 'aria-label': '图表缩放' },
    btn('缩小', '缩小（键盘 −）', mmIcon('minus', 12), 'out'),
    createElement('span', { className: 'mdr-mm-zoom-val' }, '100%'),
    btn('放大', '放大（键盘 +）', mmIcon('plus', 12), 'in'),
  )
}

/** 全屏按钮：打开原生 <dialog>（常驻高频入口）。 */
function MdrMmFullscreen(props: { onOpen: () => void; disabled: boolean }): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mdr-icon-btn',
      onClick: props.onOpen,
      disabled: props.disabled,
      'aria-label': '全屏',
      'data-mdr-tip': '全屏（Esc 关闭）',
    },
    mmIcon('maximize', 14),
  )
}

/** 菜单项（模块级，压组件圈复杂度）。 */
function mmMenuItemNode(
  label: string,
  iconNode: unknown,
  onSelect: () => void,
  opts: { role?: string; checked?: boolean; disabled?: boolean; check?: unknown } = {},
): unknown {
  const props: Record<string, unknown> = {
    type: 'button',
    role: opts.role ?? 'menuitem',
    className: 'mdr-mm-menu-item',
    onClick: onSelect,
    disabled: opts.disabled === true,
    'aria-label': label,
  }
  if (opts.role === 'menuitemradio') props['aria-checked'] = opts.checked === true
  return createElement(
    'button',
    props,
    iconNode,
    createElement('span', null, label),
    opts.check === undefined ? null : opts.check,
  )
}

/** 菜单关闭路径：点菜单外 / Esc（触发按钮的点击已 stopPropagation）。 */
function useMenuDismiss(open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    const onDoc = (): void => onDismiss()
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onDoc)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDoc)
    }
  }, [open, onDismiss])
}

/** 「更多」触发按钮（阻止冒泡：否则 document 的「点外关闭」会立刻关掉刚打开的菜单）。 */
function MmMenuTrigger(props: { open: boolean; onToggle: () => void }): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mdr-icon-btn',
      'aria-haspopup': 'menu',
      'aria-expanded': props.open ? 'true' : 'false',
      'aria-label': '更多',
      'data-mdr-tip': '更多',
      onClick: (e: { stopPropagation?: () => void }) => {
        if (typeof e.stopPropagation === 'function') e.stopPropagation()
        props.onToggle()
      },
    },
    mmIcon('more', 14),
  )
}

/** 菜单内容：导出 / 缩放模式（menuitemradio + 勾）/ 复制代码。 */
function MmMenuBody(props: {
  open: boolean
  fit: 'container' | 'width'
  ready: boolean
  zoomable: boolean
  onFit: (value: 'container' | 'width') => void
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}): unknown {
  const fitItem = (value: 'container' | 'width', label: string, iconName: string): unknown =>
    mmMenuItemNode(label, mmIcon(iconName, 13), () => props.onFit(value), {
      role: 'menuitemradio',
      checked: props.fit === value,
      disabled: !props.zoomable,
      check: props.fit === value ? createElement('span', { className: 'mdr-mm-check' }, mmIcon('check', 12)) : null,
    })
  return createElement(
    'div',
    { className: 'mdr-mm-menu', role: 'menu', 'aria-label': '更多操作', hidden: !props.open },
    mmMenuItemNode('导出 PNG', mmIcon('file', 13), props.onPng, { disabled: !props.ready }),
    mmMenuItemNode('导出 SVG', mmIcon('download', 13), props.onSvg, { disabled: !props.ready }),
    createElement('div', { className: 'mdr-mm-menu-sep' }),
    createElement('div', { className: 'mdr-mm-menu-label' }, '缩放模式'),
    fitItem('container', '适应容器', 'fit'),
    fitItem('width', '适应宽度', 'wrap'),
    createElement('div', { className: 'mdr-mm-menu-sep' }),
    mmMenuItemNode('复制代码', mmIcon('copy', 13), props.onCopy),
  )
}

/** 「更多」菜单：低频操作收纳（触发按钮 + 内容 + 关闭策略）。 */
function MdrMmMenu(props: {
  scopeId: string
  ready: boolean
  zoomable: boolean
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}): unknown {
  const [open, setOpen] = useState(false)
  const [fit, setFit] = useState<'container' | 'width'>('container')
  useMenuDismiss(open, () => setOpen(false))
  const pickFit = (value: 'container' | 'width'): void => {
    setFit(value)
    setOpen(false)
    zoomEntry(props.scopeId, value === 'container' ? 'fit' : 'fill')
  }
  const pickExport =
    (action: () => void): (() => void) =>
    () => {
      setOpen(false)
      action()
    }
  return createElement(
    'div',
    { className: 'mdr-mm-more' },
    createElement(MmMenuTrigger, { open: open, onToggle: () => setOpen(!open) }),
    createElement(MmMenuBody, {
      open: open,
      fit: fit,
      ready: props.ready,
      zoomable: props.zoomable,
      onFit: pickFit,
      onPng: pickExport(props.onPng),
      onSvg: pickExport(props.onSvg),
      onCopy: pickExport(props.onCopy),
    }),
  )
}

/** 底栏：常显「渲染为… 图表 / Markdown / 源码」+ 右侧渲染说明。 */
function MdrMmModeBar(props: { view: MmView; onView: (view: MmView) => void; meta: () => string }): unknown {
  const btn = (value: MmView, label: string, iconNode: unknown): unknown =>
    createElement(
      'button',
      {
        type: 'button',
        className: 'mdr-mm-mode',
        onClick: () => props.onView(value),
        'aria-pressed': props.view === value,
        'aria-label': '渲染为' + label,
      },
      iconNode,
      createElement('span', null, label),
    )
  return createElement(
    'div',
    { className: 'mdr-mm-foot' },
    createElement('span', { className: 'mdr-mm-foot-label' }, '渲染为…'),
    createElement(
      'div',
      { className: 'mdr-mm-modes', role: 'group', 'aria-label': '围栏块渲染方式' },
      btn('diagram', '图表', mmIcon('chart', 11)),
      btn('markdown', 'Markdown', mmIcon('markdown', 11)),
      btn('source', '源码', mmIcon('code', 11)),
    ),
    createElement('span', { className: 'mdr-mm-spacer' }),
    createElement('span', { className: 'mdr-mm-meta' }, props.meta()),
  )
}

/** 卡片头：标题胶囊 + 类型 + 工具条（视图分段 / 缩放 / 全屏 / 更多）。 */
function MmCardHead(props: {
  title: string
  kind: string
  status: string
  view: MmView
  ready: boolean
  zoomable: boolean
  scopeId: string
  onView: (view: 'diagram' | 'source') => void
  onOpenFullscreen: () => void
  exportActions: ExportHandlers
}): unknown {
  return createElement(
    'div',
    { className: 'mdr-mm-head' },
    createElement(
      'span',
      { className: 'mdr-mm-title', title: props.title },
      mmIcon('chart', 11),
      createElement('span', null, props.title),
    ),
    createElement('span', { className: 'mdr-mm-kind' }, props.kind),
    createElement(
      'div',
      { className: 'mdr-mm-toolbar' },
      createElement(MdrMmViewSeg, {
        view: props.view,
        previewDisabled: props.status === 'error',
        onView: props.onView,
      }),
      createElement(MdrMmZoomSeg, { scopeId: props.scopeId }),
      createElement(MdrMmFullscreen, { onOpen: props.onOpenFullscreen, disabled: !props.ready }),
      createElement(MdrMmMenu, {
        scopeId: props.scopeId,
        ready: props.ready,
        zoomable: props.zoomable,
        onPng: props.exportActions.onPng,
        onSvg: props.exportActions.onSvg,
        onCopy: props.exportActions.onCopy,
      }),
    ),
  )
}

/** 全屏 dialog 头：标题 + 路径 + 操作（缩放 / 导出 SVG / 关闭）。 */
function MdrMmDialogHead(props: {
  fsId: string
  title: string
  kind: string
  onClose: () => void
  onExportSvg: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'mdr-mm-dialog-head' },
    createElement('span', { className: 'mdr-mm-title' }, mmIcon('chart', 11), createElement('span', null, props.title)),
    createElement('span', { className: 'mdr-mm-dialog-path' }, 'mermaid 围栏块 · ' + props.kind),
    createElement(
      'div',
      { className: 'mdr-mm-dialog-actions' },
      createElement(MdrMmZoomSeg, { scopeId: props.fsId }),
      createElement(
        'button',
        { type: 'button', className: 'mdr-btn', onClick: props.onExportSvg },
        mmIcon('download', 12),
        createElement('span', null, '导出 SVG'),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mdr-icon-btn',
          onClick: props.onClose,
          'aria-label': '关闭全屏',
          'data-mdr-tip': '关闭（Esc）',
        },
        mmIcon('close', 14),
      ),
    ),
  )
}
