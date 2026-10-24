// ── components-state：加载骨架 / 失败重试 / 四种空态 / Toast ────────────

interface StatePanelProps {
  kind: 'loading' | 'error' | 'empty'
  variant: string
  query: string
  message: string
  onRescan(): void
  onClearSearch(): void
  onResetFilters(): void
  onShowAll(): void
}

/** 加载骨架：一节标题 + 6 张占位卡（不阻塞布局）。 */
function loadingPanel(): unknown {
  const cards: unknown[] = []
  for (let index = 0; index < 6; index += 1) {
    const width = index % 2 === 0 ? 'dsh-my-skill-manager-w55' : 'dsh-my-skill-manager-w70'
    cards.push(
      createElement(
        'div',
        { key: 'skel:' + String(index), className: 'dsh-my-skill-manager-skel-card' },
        createElement('div', { className: 'dsh-my-skill-manager-skel-line dsh-my-skill-manager-w25' }),
        createElement('div', { className: 'dsh-my-skill-manager-skel-line ' + width }),
        createElement('div', { className: 'dsh-my-skill-manager-skel-line dsh-my-skill-manager-w40' }),
      ),
    )
  }
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-state' },
    createElement(
      'div',
      {
        className: 'dsh-my-skill-manager-skeleton',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': strings.loadingAria(),
      },
      createElement('div', { className: 'dsh-my-skill-manager-skel-head' }),
      cards,
    ),
  )
}

/** 失败态：真实错误文案 + 重试扫描。 */
function errorPanel(message: string, props: StatePanelProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-state' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-error', role: 'alert' },
      icon.alert(28),
      createElement('h2', {}, strings.errorTitle()),
      createElement('p', {}, strings.errorHint() + ' ', message === '' ? null : createElement('code', {}, message)),
      createElement(
        'div',
        { className: 'dsh-my-skill-manager-empty-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-primary',
            onClick: () => props.onRescan(),
          },
          icon.refresh(14),
          strings.retryScan(),
        ),
      ),
    ),
  )
}

interface EmptyCopy {
  iconName: 'package' | 'search' | 'folder'
  title: string
  body: string
}

/** 四种空态文案：无数据 / 搜索无结果 / 筛选无结果 / 无项目上下文。 */
function emptyCopy(props: StatePanelProps): EmptyCopy {
  if (props.variant === 'noresult') {
    return { iconName: 'search', title: strings.emptyNoResultTitle(props.query), body: strings.emptyNoResultBody() }
  }
  if (props.variant === 'filtered') {
    return { iconName: 'search', title: strings.emptyFilteredTitle(), body: strings.emptyFilteredBody() }
  }
  if (props.variant === 'noproject') {
    return { iconName: 'folder', title: strings.emptyNoProjectTitle(), body: strings.emptyNoProjectBody() }
  }
  return { iconName: 'package', title: strings.emptyNoDataTitle(), body: strings.emptyNoDataBody() }
}

function emptyIcon(iconName: string): unknown {
  if (iconName === 'search') return icon.search(28)
  if (iconName === 'folder') return icon.folder(28)
  return glyph.package(28)
}

function actionButton(label: string, primary: boolean, onClick: () => void, withIcon: boolean): unknown {
  const className = 'dsh-my-skill-manager-btn' + (primary ? ' dsh-my-skill-manager-btn-primary' : '')
  return createElement(
    'button',
    { key: label, type: 'button', className, onClick },
    withIcon ? icon.refresh(14) : null,
    label,
  )
}

function emptyActionsNoResult(props: StatePanelProps): unknown[] {
  return [
    actionButton(strings.emptyClearSearch(), true, () => props.onClearSearch(), false),
    actionButton(strings.emptyResetFilters(), false, () => props.onResetFilters(), false),
  ]
}

function emptyActionsNoProject(props: StatePanelProps): unknown[] {
  return [
    actionButton(strings.emptyShowAll(), true, () => props.onShowAll(), false),
    actionButton(strings.emptyRescan(), false, () => props.onRescan(), true),
  ]
}

function emptyActions(props: StatePanelProps): unknown[] {
  if (props.variant === 'noresult') return emptyActionsNoResult(props)
  if (props.variant === 'filtered') {
    return [actionButton(strings.emptyResetFilters(), true, () => props.onResetFilters(), false)]
  }
  if (props.variant === 'noproject') return emptyActionsNoProject(props)
  return [actionButton(strings.emptyRescan(), true, () => props.onRescan(), true)]
}

/** 无项目上下文时的禁用开关预览。 */
function previewSwitch(): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-empty-preview' },
    createElement(
      'button',
      {
        type: 'button',
        role: 'switch',
        className: 'dsh-my-skill-manager-switch',
        'aria-checked': false,
        'aria-label': strings.emptyNoProjectToggle(),
        disabled: true,
      },
      createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, strings.scopeProject()),
      createElement(
        'span',
        { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' },
        createElement('span', { className: 'dsh-my-skill-manager-knob' }),
      ),
    ),
    createElement('span', {}, strings.emptyNoProjectPreview()),
  )
}

function emptyPanel(props: StatePanelProps): unknown {
  const copy = emptyCopy(props)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-state' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-empty' },
      emptyIcon(copy.iconName),
      createElement('h2', {}, copy.title),
      createElement('p', {}, copy.body),
      props.variant === 'noproject' ? previewSwitch() : null,
      createElement('div', { className: 'dsh-my-skill-manager-empty-actions' }, emptyActions(props)),
    ),
  )
}

function StatePanel(props: StatePanelProps): unknown {
  if (props.kind === 'loading') return loadingPanel()
  if (props.kind === 'error') return errorPanel(props.message, props)
  return emptyPanel(props)
}

interface ToastProps {
  toast: ToastValue | null
}

function Toast(props: ToastProps): unknown {
  if (props.toast === null) return null
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-toast', role: 'status', 'aria-live': 'polite', 'data-kind': props.toast.kind },
    createElement('span', { className: 'dsh-my-skill-manager-toast-dot', 'aria-hidden': 'true' }),
    createElement('span', {}, props.toast.message),
  )
}
