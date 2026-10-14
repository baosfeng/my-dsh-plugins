// ── mermaid 卡片工具条（React）── 从 mermaid-card.ts 拆出（单文件行数门禁 ≤400）。
// 常驻四项：视图切换 / 缩放分段（− 百分比 + 收在一个胶囊）/ 全屏浮窗 /「更多」菜单；
// 低频操作（适应容器 / 适应宽度 / 导出三件）收在菜单里 —— 用户口径「外面有的，里面就别再有」，
// 所以全屏浮窗只常驻、菜单里不再重复提供。
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
        'aria-label': label,
        'data-dsh-md-render-tip': label,
      },
      iconNode,
    )
  return createElement(
    'div',
    { className: 'dsh-md-render-mermaid-view-toggle', role: 'group', 'aria-label': 'view mode' },
    // 「预览」用眼睛图标（比 file 更贴语义）。
    btn('预览', 'preview', icon.eye(14), previewDisabled === true),
    btn('代码', 'code', icon.code(14), false),
  )
}

/** 缩放分段：− / 百分比 / + 收进**一个**胶囊 —— 视觉上算一个控件，卡片头因此只需一行。
 *  百分比是**显示值**（zoom-math.ts 更新其 textContent），不是动作名 —— 所以保留文字、不进浮层。
 *  「实际大小 100%」不设按钮：双击图表与键盘 0 两条路径都在（提示写在菜单「适应容器」项里）。 */
function ZoomSeg({ entryId }: { entryId: string }) {
  const btn = (ariaLabel: string, tip: string, iconNode: unknown, action: () => void) =>
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-md-render-mermaid-eb',
        onClick: action,
        'aria-label': ariaLabel,
        'data-dsh-md-render-tip': tip,
      },
      iconNode,
    )
  return createElement(
    'div',
    { className: 'dsh-md-render-seg', role: 'group', 'aria-label': '图表缩放' },
    btn('缩小', '缩小（键盘 −，或触控板双指捏合）', icon.minus(14), () => zoomEntry(entryId, 'out')),
    // 实时缩放百分比：小图放大 25% 肉眼几乎无感，用数字给出明确反馈。
    createElement('span', { className: 'dsh-md-render-mermaid-zoom-pct' }, '100%'),
    btn('放大', '放大（键盘 +，或触控板双指捏合）', icon.plus(14), () => zoomEntry(entryId, 'in')),
  )
}

/** 菜单项（模块级：不依赖组件状态，也让 CardMenu 保持在尺寸门禁内）。 */
function menuItemNode(label: string, iconNode: unknown, onSelect: () => void, disabled: boolean): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      className: 'dsh-md-render-menu-item',
      onClick: onSelect,
      disabled,
      'aria-label': label,
    },
    iconNode,
    createElement('span', null, label),
  )
}

/** 造一个「按 label 生成菜单项」的工厂：点完立刻关（菜单留着会挡住图表，让人以为点了没反应）。 */
function makeMenuItem(close: () => void) {
  return (label: string, iconNode: unknown, action: () => void, disabled: boolean): unknown =>
    menuItemNode(
      label,
      iconNode,
      () => {
        close()
        action()
      },
      disabled,
    )
}

/** 全屏浮窗：**常驻**在卡片头（用户口径「全屏要放在外面」，不藏在「更多」里）——
 *  它是「把图放大看」的主入口，属高频；菜单里因此不再重复提供它。 */
function FullscreenButton({ entryId, disabled }: { entryId: string; disabled: boolean }) {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-md-render-mermaid-eb',
      onClick: () => toggleCardOverlay(entryId),
      disabled,
      'aria-label': '全屏浮窗',
      'data-dsh-md-render-tip': '全屏浮窗（Esc 关闭）',
    },
    icon.maximize(14),
  )
}

/** 菜单触发器（模块级，同上）。 */
function menuTriggerNode(entryId: string, open: boolean, onToggle: () => void): unknown {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-md-render-mermaid-eb',
      [MENU_BTN_ATTR]: entryId,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': '更多操作',
      'data-dsh-md-render-tip': '更多操作',
      onClick: (e: { stopPropagation?: () => void }) => {
        // 阻止冒泡：否则 document 的"点外关闭"会立刻把刚打开的菜单关掉
        if (typeof e.stopPropagation === 'function') e.stopPropagation()
        onToggle()
      },
    },
    icon.more(14),
  )
}

/**
 * 「更多」菜单：把**低频**操作收起来（缩放模式 / 导出），别让它们长期霸占卡片头。
 * 全屏浮窗**不在菜单里** —— 用户口径「全屏要放在外面」，它是常驻的 FullscreenButton。
 * 用户口径「外面有的，里面就别有了」：原「渲染为 Markdown / 源码」已删
 * —— 它与常驻的「预览 / 代码」是同一意图的两套入口。
 * 关闭路径：再点触发按钮 / 点菜单外 / Esc；Esc 都把焦点还给触发按钮（键盘用户不丢位置）。
 * 定位纯 CSS（styles.ts 的 .dsh-md-render-menu 贴到工具条右下方）—— 不写 el.style。
 */
function CardMenu({
  entryId,
  ready,
  zoomable,
  onPng,
  onSvg,
  onCopy,
}: {
  entryId: string
  ready: boolean
  zoomable: boolean
  onPng: () => void
  onSvg: () => void
  onCopy: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      const btn = document.querySelector('[' + MENU_BTN_ATTR + '="' + entryId + '"]') as { focus?: () => void } | null
      if (btn !== null && typeof btn.focus === 'function') btn.focus()
    }
    // 点菜单外的任何地方都关；触发按钮的点击已 stopPropagation，不会误关刚打开的自己。
    const onDoc = (): void => setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onDoc)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDoc)
    }
  }, [open, entryId])
  const item = makeMenuItem(() => setOpen(false))
  return createElement(
    'div',
    null,
    menuTriggerNode(entryId, open, () => setOpen(!open)),
    createElement(
      'div',
      { className: 'dsh-md-render-menu', role: 'menu', 'aria-label': '更多操作', hidden: !open },
      item('适应容器', icon.fit(14), () => zoomEntry(entryId, 'fit'), !zoomable),
      item('适应宽度', icon.fill(14), () => zoomEntry(entryId, 'fill'), !zoomable),
      createElement('hr', { key: 'menu-sep', className: 'dsh-md-render-menu-sep' }),
      item('下载 PNG', icon.download(14), onPng, !ready),
      item('下载 SVG', icon.download(14), onSvg, !ready),
      item('复制代码', icon.copy(14), onCopy, false),
    ),
  )
}

exports.ViewToggle = ViewToggle
exports.ZoomSeg = ZoomSeg
exports.CardMenu = CardMenu
exports.FullscreenButton = FullscreenButton
