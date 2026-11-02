/** 简版通知面板（原型 v1）：事件 → 文案 → 飞书卡片 → 送达。 */

/** 面板入参（settings.ts 装配配置与保存动作）。 */
interface NotifyPanelProps {
  draft: NotifyConfig
  patch: PatchFn
  save: () => void
  saved: boolean
  error: boolean
  dirty: boolean
  volume: number
  onVolumeChange: (v: number) => void
  apiToken: string
  feishuCard: CardConfig
  hasFeishuCard: boolean
  onPatchFeishuCard: (card: CardConfig) => void
  onTest: (kind: string, sample: string, done: (ok: boolean) => void) => void
  onReset: () => void
}

/** 面板事件顺序（与服务端 MESSAGE_KEYS 一致）。 */
const PANEL_EVENTS = ['ask', 'approval', 'end', 'subagentEnd', 'remote']

/** 面板根：事件态 / 预览态 / 变量抽屉态 + 更多设置抽屉。 */
function NotifyPanel(props: NotifyPanelProps) {
  const [active, setActive] = useState<string>('ask')
  const [drawer, setDrawer] = useState<string | null>(null)
  const [groups, setGroups] = useState<VarGroup[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [status, setStatus] = useState<string>('idle')
  const [attempt, setAttempt] = useState<number>(0)
  const [target, setTarget] = useState<string>('body')
  const [caret, setCaret] = useState<number>(0)
  const [varsOpen, setVarsOpen] = useState<boolean>(false)
  const template = messageOf(props.draft.messages, active)
  useVariables(setGroups)
  usePreview(
    { messages: props.draft.messages, card: props.feishuCard } as any,
    active,
    template,
    attempt,
    setPreview,
    setStatus,
  )
  const insert = makePanelInsert(props, active, template, target, caret, setCaret)
  const notice = previewNoticeOf(status)
  const view = { active, template, groups, preview, status, notice, target, caret, varsOpen, attempt }
  const actions = { setActive, setDrawer, setVarsOpen, setTarget, setCaret, setAttempt, insert }
  return createElement(
    'div',
    { className: 'dsh-my-notify-panel' },
    panelHead(props, () => setDrawer('channel')),
    panelTabs(active, (key: string) => {
      setActive(key)
      setCaret(0)
      setVarsOpen(false)
    }),
    panelMain(props, view, actions),
    panelFoot(props),
    createElement(PanelDrawer, {
      open: drawer,
      onOpen: setDrawer,
      onClose: () => setDrawer(null),
      draft: props.draft,
      patch: props.patch,
      volume: props.volume,
      onVolumeChange: props.onVolumeChange,
      apiToken: props.apiToken,
      onTest: props.onTest,
    }),
  )
}

/** 主区：左编辑 / 右飞书卡片（状态与动作由 NotifyPanel 传入）。 */
function panelMain(props: NotifyPanelProps, view: any, actions: any) {
  return createElement(
    'main',
    { className: 'dsh-my-notify-p-grid' },
    createElement(PanelCompose, {
      active: view.active,
      template: view.template,
      enabled: panelEventEnabled(props.draft, view.active),
      onToggle: (on: boolean) => {
        if (view.active !== 'remote') props.patch(view.active, on)
      },
      onPatch: (next: MessageTemplate) => panelPatchMessage(props.draft, props.patch, view.active, next),
      onReset: () => panelPatchMessage(props.draft, props.patch, view.active, defaultMessageFor(view.active)),
      groups: view.groups,
      varsOpen: view.varsOpen,
      onToggleVars: () => actions.setVarsOpen(!view.varsOpen),
      onInsert: actions.insert,
      onTarget: (nextTarget: string, at: number) => {
        actions.setTarget(nextTarget)
        actions.setCaret(at)
      },
      draft: props.draft,
      patch: props.patch,
      onOpenChannel: () => actions.setDrawer('channel'),
    }),
    createElement(PanelPreview, {
      preview: view.preview,
      status: view.status,
      notice: view.notice,
      onRetry: () => actions.setAttempt(view.attempt + 1),
      card: props.feishuCard,
      hasChannel: props.hasFeishuCard,
      onPatchCard: props.onPatchFeishuCard,
    }),
  )
}

/** 顶栏：标题 / 说明 / 事件与渠道计数 / 更多设置。 */
function panelHead(props: NotifyPanelProps, onOpenMore: () => void) {
  const channels = panelChannelCount(props.draft)
  return createElement(
    'header',
    { className: 'dsh-my-notify-p-head' },
    createElement(
      'div',
      null,
      createElement('p', { className: 'dsh-my-notify-p-kicker' }, strings.panelKicker()),
      createElement('h1', { className: 'dsh-my-notify-p-title' }, strings.panelTitle()),
      createElement('p', { className: 'dsh-my-notify-p-lede' }, strings.panelLede()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-p-head-side' },
      createElement('p', { className: 'dsh-my-notify-p-meta' }, strings.panelMeta(PANEL_EVENTS.length, channels)),
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-notify-p-ghost', 'aria-haspopup': 'dialog', onClick: onOpenMore },
        strings.panelMore(),
      ),
    ),
  )
}

/** 事件 tabs（五类真实事件）。 */
function panelTabs(active: string, onPick: (key: string) => void) {
  return createElement(
    'nav',
    { className: 'dsh-my-notify-p-tabs', role: 'tablist', 'aria-label': strings.panelTitle() },
    PANEL_EVENTS.map((key) =>
      createElement(
        'button',
        {
          key,
          type: 'button',
          role: 'tab',
          className: 'dsh-my-notify-p-tab',
          'aria-selected': String(key === active),
          onClick: () => onPick(key),
        },
        panelEventLabel(key),
      ),
    ),
  )
}

/** 底栏：恢复默认 / 保存状态 / 保存按钮。 */
function panelFoot(props: NotifyPanelProps) {
  const kind = props.error ? 'error' : props.dirty ? 'idle' : props.saved ? 'ok' : 'idle'
  const text = props.error ? strings.saveFailed() : props.dirty ? strings.dirty() : props.saved ? strings.saved() : ''
  return createElement(
    'footer',
    { className: 'dsh-my-notify-p-actions' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-reset', onClick: props.onReset },
      strings.panelResetCopy(),
    ),
    createElement('p', { className: 'dsh-my-notify-p-status', 'data-kind': kind, 'aria-live': 'polite' }, text),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-p-btn dsh-my-notify-p-btn-primary', onClick: props.save },
      strings.panelSave(),
    ),
  )
}

/** 面板里写回单条事件模板（空串由服务端回退默认）。 */
function panelPatchMessage(draft: NotifyConfig, patch: PatchFn, key: string, template: MessageTemplate): void {
  const messages = { ...(draft.messages ?? defaultMessages()) } as any
  messages[key] = template
  patch('messages', messages)
}

/** 事件启用态（remote 恒开）。 */
function panelEventEnabled(draft: NotifyConfig, key: string): boolean {
  if (key === 'remote') return true
  return (draft as any)[key] === true
}

/** 已启用渠道数（顶栏计数）。 */
function panelChannelCount(draft: NotifyConfig): number {
  const list = Array.isArray(draft.webhooks) ? draft.webhooks : []
  return list.filter((webhook) => webhook.enabled !== false).length
}

/** 变量插入：写入最近编辑的字段，插入后回到该光标位。 */
function makePanelInsert(
  props: NotifyPanelProps,
  active: string,
  template: MessageTemplate,
  target: string,
  caret: number,
  setCaret: (v: number) => void,
) {
  return (name: string): void => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    panelPatchMessage(
      props.draft,
      props.patch,
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      const id = target === 'title' ? 'dsh-my-notify-title' : 'dsh-my-notify-body'
      const node = document.getElementById(id) as any
      if (node !== null && typeof node.setSelectionRange === 'function') {
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      }
    }, 0)
  }
}
