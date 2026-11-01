// ── 文案视图（工作台）：事件列表 + 编辑器 + 变量树 + 底部五形态预览带 ────
//
// 布局：宽容器三列（168 / 1fr / 208）+ 底部预览带；窄容器（容器查询 <860）
// 事件列表降级为下拉、变量树进抽屉、预览带 3 列横向滚动。所有逻辑函数
// （预览去抖 / 变量插入 / 卡片渲染）保持与视觉无关，直接复用。

/** 变量目录加载（GET /notify/api/variables；失败时变量库为空）。 */
function useVariables(setGroups: (list: VarGroup[]) => void) {
  useEffect(() => {
    if (typeof fetch !== 'function') return
    fetch('/notify/api/variables')
      .then((res) => res.json())
      .then((body) => {
        if (body !== null && body !== undefined && body.ok === true) setGroups(normalizeVarGroups(body.value))
      })
      .catch(() => {
        // 变量目录是增强信息：拉取失败时变量树为空，不影响编辑与保存
      })
  }, [])
}

/** 300ms 去抖预览调度（事件 / 模板 / 卡片 / 重试变化都会重新请求）。 */
function usePreview(
  props: CopyEditorPaneProps,
  active: string,
  template: MessageTemplate,
  attempt: number,
  setPreview: (v: PreviewResult | null) => void,
  setStatus: (v: string) => void,
) {
  useEffect(() => {
    setStatus('loading')
    const scheduler = createPreviewScheduler((payload) => {
      void requestPreview(payload).then((value) => {
        setPreview(value)
        setStatus(value === null ? 'error' : 'ready')
      })
    }, 300)
    scheduler.schedule(previewPayload(active, props.messages, props.card))
    return () => scheduler.cancel()
  }, [active, template.title, template.body, props.card, attempt])
}

/** 变量插入动作（写入最近一次编辑的字段，并移动光标）。 */
function makeInsert(
  props: CopyEditorPaneProps,
  active: string,
  template: MessageTemplate,
  target: string,
  caret: number,
  setCaret: (v: number) => void,
) {
  return (name: string) => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    props.onPatchMessage(
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
  }
}

/** 询问模式分段控件（仅 ask 事件：完整问题 / 仅摘要 → config.askMode）。 */
function askModeControl(props: { askMode: string; onChange: (v: string) => void }) {
  const options = [
    { value: 'full', label: () => strings.askModeFull() },
    { value: 'summary', label: () => strings.askModeSummary() },
  ]
  return createElement(
    'div',
    { className: 'dsh-my-notify-ed', 'data-role': 'ask-mode' },
    createElement(
      'div',
      { className: 'dsh-my-notify-lbl' },
      createElement('span', null, strings.askModeTitle()),
      createElement('span', null, props.askMode),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.askModeTitle() },
      options.map((option) =>
        createElement(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dsh-my-notify-seg',
            role: 'tab',
            'aria-selected': String(option.value === props.askMode),
            onClick: () => props.onChange(option.value),
          },
          option.label(),
        ),
      ),
    ),
    createElement('div', { className: 'dsh-my-notify-hint' }, strings.askModeHint()),
  )
}

/** 编辑器列（事件头 + 启用开关 + 标题 / 正文 + 变量入口 + 错误态）。 */
function copyEditorColumn(props: {
  active: string
  askMode: string
  onAskMode: (v: string) => void
  template: MessageTemplate
  enabled: boolean
  onToggle: (on: boolean) => void
  onReset: () => void
  onTitle: (v: string, caret: number) => void
  onBody: (v: string, caret: number) => void
  onOpenVars: () => void
  varCount: number
  saveError: boolean
  onRetrySave: () => void
}) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-col' },
    createElement(
      'div',
      { className: 'dsh-my-notify-ed' },
      createElement(
        'div',
        { className: 'dsh-my-notify-ed-hd' },
        createElement('h2', null, eventLabelOf(props.active)),
        createElement('span', { className: 'dsh-my-notify-badge' }, props.active),
        createElement('span', { className: 'dsh-my-notify-grow' }),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onOpenVars },
          strings.varOpen(),
        ),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onReset },
          strings.resetDefaults(),
        ),
      ),
      createElement(SwitchRow, {
        label: strings.editorEnabled(),
        hint: strings.editorEnabledHint(),
        on: props.enabled,
        onChange: props.onToggle,
      }),
      props.active === 'ask' ? askModeControl({ askMode: props.askMode, onChange: props.onAskMode }) : null,
      copyEditorFields(props),
      createElement('div', { className: 'dsh-my-notify-hint' }, strings.varCount(props.varCount)),
      props.saveError
        ? createElement(
            'div',
            { className: 'dsh-my-notify-errbox', role: 'alert' },
            createElement('span', null, strings.saveFailed()),
            createElement(
              'button',
              { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onRetrySave },
              strings.previewRetry(),
            ),
          )
        : null,
    ),
  )
}

/** 文案视图根（工作台）：事件列表 / 编辑器 / 变量树 + 预览带。 */
function CopyEditorPane(props: CopyEditorPaneProps) {
  const [active, setActive] = useState<string>('end')
  const [groups, setGroups] = useState<VarGroup[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [status, setStatus] = useState<string>('idle')
  const [attempt, setAttempt] = useState<number>(0)
  const [bandOpen, setBandOpen] = useState<boolean>(true)
  const [varsOpen, setVarsOpen] = useState<boolean>(false)
  const [target, setTarget] = useState<string>('body')
  const [caret, setCaret] = useState<number>(0)
  const template = messageOf(props.messages, active)
  useVariables(setGroups)
  usePreview(props, active, template, attempt, setPreview, setStatus)
  const insert = makeInsert(props, active, template, target, caret, setCaret)
  const notice = previewNoticeOf(status)
  const groupsTotal = varCountOf(groups)
  return createElement(
    'div',
    { className: 'dsh-my-notify-wb' },
    createElement(
      'div',
      { className: 'dsh-my-notify-cols' },
      createElement(EventList, {
        active,
        onPick: (key: string) => {
          setActive(key)
          setCaret(0)
        },
        enabledOf: props.enabledOf,
      }),
      copyEditorColumn({
        active,
        template,
        enabled: props.enabledOf(active),
        onToggle: (on: boolean) => props.onToggleEvent(active, on),
        onReset: () => props.onPatchMessage(active, defaultMessageFor(active)),
        onTitle: (v: string, at: number) => {
          setTarget('title')
          setCaret(at)
          props.onPatchMessage(active, { title: v, body: template.body })
        },
        onBody: (v: string, at: number) => {
          setTarget('body')
          setCaret(at)
          props.onPatchMessage(active, { title: template.title, body: v })
        },
        askMode: props.askMode ?? 'full',
        onAskMode: (v: string) => props.onAskMode?.(v),
        onOpenVars: () => setVarsOpen(!varsOpen),
        varCount: groupsTotal,
        saveError: props.saveError === true,
        onRetrySave: props.onRetrySave ?? (() => {}),
      }),
      createElement(VariableTree, { groups, onInsert: insert }),
      varsOpen ? createElement(VarDrawer, { groups, onInsert: insert, onClose: () => setVarsOpen(false) }) : null,
    ),
    createElement(PreviewBand, {
      preview,
      status,
      notice,
      attempt,
      onRetry: () => setAttempt(attempt + 1),
      open: bandOpen,
      onToggle: () => setBandOpen(!bandOpen),
      feishuIndependent: props.card !== undefined && props.card !== null,
      title: strings.previewLoading(),
    }),
  )
}

/** 单个事件的默认模板（「恢复默认」用）。 */
function defaultMessageFor(key: string): MessageTemplate {
  const defaults = defaultMessages() as any
  const fallback = defaults[key] ?? defaults.end
  return { title: fallback.title, body: fallback.body }
}

/** 编辑器头部（事件名 + 类型徽标 + 变量入口 + 恢复默认）。 */
function copyEditorHead(props: { active: string; onOpenVars: () => void; onReset: () => void }) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-ed-hd' },
    createElement('h2', null, eventLabelOf(props.active)),
    createElement('span', { className: 'dsh-my-notify-badge' }, props.active),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onOpenVars },
      strings.varOpen(),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: props.onReset },
      strings.resetDefaults(),
    ),
  )
}

/** 标题 / 正文两个模板字段（含字数计数与光标位回传）。 */
function copyEditorFields(props: {
  template: MessageTemplate
  onTitle: (v: string, caret: number) => void
  onBody: (v: string, caret: number) => void
}) {
  return [
    createElement(
      'div',
      { key: 'title' },
      createElement(
        'div',
        { className: 'dsh-my-notify-lbl' },
        createElement('span', null, strings.tplTitle()),
        createElement('span', null, props.template.title.length + ' / 52'),
      ),
      createElement('input', {
        className: 'dsh-my-notify-inp2',
        value: props.template.title,
        'aria-label': strings.tplTitle(),
        onFocus: () => props.onTitle(props.template.title, props.template.title.length),
        onChange: (event: any) => props.onTitle(event.target.value, event.target.selectionStart ?? 0),
      }),
    ),
    createElement(
      'div',
      { key: 'body' },
      createElement(
        'div',
        { className: 'dsh-my-notify-lbl' },
        createElement('span', null, strings.tplBody()),
        createElement('span', null, props.template.body.length + ' / 180'),
      ),
      createElement('textarea', {
        className: 'dsh-my-notify-ta2',
        value: props.template.body,
        'aria-label': strings.tplBody(),
        onFocus: () => props.onBody(props.template.body, props.template.body.length),
        onChange: (event: any) => props.onBody(event.target.value, event.target.selectionStart ?? 0),
      }),
    ),
  ]
}
