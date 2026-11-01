'use strict'
function editorField(label, control) {
  return createElement(
    'div',
    { className: 'dsh-my-notify-webhook-field' },
    createElement('div', { className: 'dsh-my-notify-webhook-field-label' }, label),
    control,
  )
}
function textInput(value, placeholder, onChange) {
  return createElement('input', {
    className: 'dsh-my-notify-webhook-input',
    value,
    placeholder,
    onChange: (event) => onChange(event.target.value),
  })
}
function selectInput(value, options, onChange) {
  return createElement(
    'select',
    { className: 'dsh-my-notify-webhook-select', value, onChange: (event) => onChange(event.target.value) },
    options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label())),
  )
}
function testStateSetter(set) {
  return (ok) => set(ok ? 'ok' : 'fail')
}
function WebhookEditor(props) {
  const draft = props.draft
  const patch = (key, value) => props.onChange({ ...draft, [key]: value })
  const [secretShown, setSecretShown] = useState(false)
  const [testState, setTestState] = useState('')
  const events = Array.isArray(draft.events) ? draft.events : []
  const toggleEvent = (event) => {
    patch('events', events.includes(event) ? events.filter((e) => e !== event) : [...events, event])
  }
  const ctx = {
    draft,
    patch,
    secretShown,
    setSecretShown,
    events,
    toggleEvent,
    card: cardOf(draft),
    testState,
    setTestState,
    onTest: props.onTest,
    onChange: props.onChange,
    onCancel: props.onCancel,
    onSave: props.onSave,
    onDelete: props.onDelete,
  }
  return createElement(
    'div',
    {
      className: 'dsh-my-notify-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': strings.channelEditTitle(),
    },
    createElement('div', { className: 'dsh-my-notify-drawer-scrim', onClick: props.onCancel }),
    createElement(
      'div',
      {
        className: 'dsh-my-notify-drawer-panel',
        tabIndex: -1,
        onKeyDown: (event) => {
          if (event !== null && event.key === 'Escape') {
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            props.onCancel()
          }
        },
      },
      editorHead(ctx),
      createElement(
        'div',
        { className: 'dsh-my-notify-drawer-bd' },
        editorBasicsFields(ctx),
        editorChannelFields(ctx),
        editorContentFields(ctx),
      ),
      editorFooter(ctx),
    ),
  )
}
function editorHead(ctx) {
  const { draft, onCancel } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-hd' },
    createElement(
      'span',
      { className: 'dsh-my-notify-ch-mark', 'data-brand': draft.channel },
      brandMarkOf(draft.channel),
    ),
    createElement('h3', { className: 'dsh-my-notify-label' }, draft.name !== '' ? draft.name : strings.channelAddNew()),
    createElement(
      'span',
      { className: 'dsh-my-notify-badge', 'data-kind': 'accent' },
      msgTypeLabel(draft.channel, draft.msgType),
    ),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', 'aria-label': strings.closeToast(), onClick: onCancel },
      '×',
    ),
  )
}
function editorFooter(ctx) {
  const { onDelete, onCancel, onSave } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-drawer-ft' },
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn dsh-my-notify-btn-danger', onClick: onDelete },
      strings.channelDelete(),
    ),
    createElement('span', { className: 'dsh-my-notify-grow' }),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn', onClick: onCancel },
      strings.webhookCancel(),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-notify-btn dsh-my-notify-btn-primary', onClick: onSave },
      strings.channelSave(),
    ),
  )
}
function editorBasicsFields(ctx) {
  const { draft, patch, secretShown, setSecretShown } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-grid2' },
      editorField(
        strings.channelName(),
        textInput(draft.name, strings.webhookNamePlaceholder(), (v) => patch('name', v)),
      ),
      editorField(
        strings.channelType(),
        selectInput(draft.channel, CHANNEL_OPTIONS, (v) => {
          const options = msgTypeOptions(v)
          const keep = options.some((o) => o.value === draft.msgType) ? draft.msgType : options[0].value
          ctx.onChange({ ...draft, channel: v, msgType: keep })
        }),
      ),
    ),
    editorField(
      strings.webhookUrl(),
      textInput(draft.url, strings.webhookUrlPlaceholder(), (v) => patch('url', v)),
    ),
    editorField(
      strings.channelSecret() + ' ' + strings.channelSecretHint(),
      createElement(
        'span',
        { className: 'dsh-my-notify-inp-group' },
        createElement('input', {
          className: 'dsh-my-notify-webhook-input',
          type: secretShown ? 'text' : 'password',
          value: draft.secret ?? '',
          placeholder: strings.webhookSecretPlaceholder(),
          'aria-label': strings.channelSecret(),
          onChange: (event) => patch('secret', event.target.value),
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            'aria-pressed': String(secretShown),
            onClick: () => setSecretShown(!secretShown),
          },
          secretShown ? strings.secureHide() : strings.secureShow(),
        ),
      ),
    ),
  ]
}
function editorChannelFields(ctx) {
  const { draft, events, toggleEvent, patch } = ctx
  return [
    createElement(
      'div',
      { className: 'dsh-my-notify-webhook-field' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.channelEventsSubscribe()),
      createElement(
        'div',
        { className: 'dsh-my-notify-webhook-events' },
        EVENT_OPTIONS.map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-chip',
              'aria-pressed': String(events.includes(option.value)),
              'aria-label': option.label(),
              onClick: () => toggleEvent(option.value),
            },
            option.label(),
          ),
        ),
      ),
    ),
    editorField(
      strings.webhookMsgType(),
      createElement(
        'div',
        { className: 'dsh-my-notify-segmented', role: 'tablist', 'aria-label': strings.webhookMsgType() },
        msgTypeOptions(draft.channel).map((option) =>
          createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-my-notify-seg',
              role: 'tab',
              'aria-selected': String(option.value === draft.msgType),
              onClick: () => patch('msgType', option.value),
            },
            option.label(),
          ),
        ),
      ),
    ),
  ]
}
function editorContentFields(ctx) {
  const { draft, patch, testState, setTestState, onTest } = ctx
  return [
    draft.channel === 'feishu' && draft.msgType === 'interactive'
      ? createElement(WebhookDesigner, { draft, onChange: ctx.onChange })
      : null,
    editorField(
      strings.webhookTemplate(),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: draft.bodyTemplate ?? draft.template ?? '',
        placeholder: strings.webhookTemplatePlaceholder(),
        'aria-label': strings.webhookTemplate(),
        onChange: (event) => patch('bodyTemplate', event.target.value),
      }),
    ),
    editorField(
      strings.retryAttempts(),
      textInput(String(draft.retry?.attempts ?? 3), '3', (v) =>
        patch('retry', { ...(draft.retry ?? {}), attempts: Number(v) || 0 }),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-actions' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-notify-btn',
          onClick: () => {
            setTestState('sending')
            void onTest(testStateSetter(setTestState))
          },
        },
        strings.channelTestSend(),
      ),
      testState === 'ok'
        ? createElement('span', { className: 'dsh-my-notify-saved' }, strings.secureRemoteOk())
        : testState === 'fail'
          ? createElement('span', { className: 'dsh-my-notify-error' }, strings.secureRemoteFail())
          : null,
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.channelTestHint()),
    ),
  ]
}
