'use strict'
function useVariables(setGroups) {
  useEffect(() => {
    if (typeof fetch !== 'function') return
    fetch('/notify/api/variables')
      .then((res) => res.json())
      .then((body) => {
        if (body !== null && body !== undefined && body.ok === true) setGroups(normalizeVarGroups(body.value))
      })
      .catch(() => {})
  }, [])
}
function usePreview(props, active, template, attempt, setPreview, setStatus) {
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
function makeInsert(props, active, template, target, caret, setCaret) {
  return (name) => {
    const field = target === 'title' ? template.title : template.body
    const next = insertVar(field, caret, name)
    props.onPatchMessage(
      active,
      target === 'title' ? { title: next.value, body: template.body } : { title: template.title, body: next.value },
    )
    setCaret(next.caret)
  }
}
function askModeControl(props) {
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
function copyEditorColumn(props) {
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
function CopyEditorPane(props) {
  const [active, setActive] = useState('end')
  const [groups, setGroups] = useState([])
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('idle')
  const [attempt, setAttempt] = useState(0)
  const [bandOpen, setBandOpen] = useState(true)
  const [varsOpen, setVarsOpen] = useState(false)
  const [target, setTarget] = useState('body')
  const [caret, setCaret] = useState(0)
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
        onPick: (key) => {
          setActive(key)
          setCaret(0)
        },
        enabledOf: props.enabledOf,
      }),
      copyEditorColumn({
        active,
        template,
        enabled: props.enabledOf(active),
        onToggle: (on) => props.onToggleEvent(active, on),
        onReset: () => props.onPatchMessage(active, defaultMessageFor(active)),
        onTitle: (v, at) => {
          setTarget('title')
          setCaret(at)
          props.onPatchMessage(active, { title: v, body: template.body })
        },
        onBody: (v, at) => {
          setTarget('body')
          setCaret(at)
          props.onPatchMessage(active, { title: template.title, body: v })
        },
        askMode: props.askMode ?? 'full',
        onAskMode: (v) => props.onAskMode?.(v),
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
function defaultMessageFor(key) {
  const defaults = defaultMessages()
  const fallback = defaults[key] ?? defaults.end
  return { title: fallback.title, body: fallback.body }
}
function copyEditorHead(props) {
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
function copyEditorFields(props) {
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
        onChange: (event) => props.onTitle(event.target.value, event.target.selectionStart ?? 0),
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
        onChange: (event) => props.onBody(event.target.value, event.target.selectionStart ?? 0),
      }),
    ),
  ]
}
