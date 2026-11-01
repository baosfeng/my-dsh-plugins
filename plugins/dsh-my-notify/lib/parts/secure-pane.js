'use strict'
function remoteSampleJson() {
  return JSON.stringify({ title: strings.sampleTitle(), body: strings.sampleBody() }, null, 2)
}
function renderSecurePane(draft, patch, apiToken, onTest) {
  const [shown, setShown] = useState(false)
  const [testState, setTestState] = useState('unsent')
  const [testError, setTestError] = useState('')
  const [sample, setSample] = useState(() => remoteSampleJson())
  const [imported, setImported] = useState('')
  const token = typeof draft.apiToken === 'string' ? draft.apiToken : ''
  const regenerate = () => {
    const next = 'ntf_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
    patch('apiToken', next)
  }
  const ctx = {
    draft,
    patch,
    apiToken,
    shown,
    setShown,
    token,
    regenerate,
    testState,
    setTestState,
    testError,
    setTestError,
    sample,
    setSample,
    imported,
    setImported,
    onTest,
  }
  return createElement(
    'div',
    { className: 'dsh-my-notify-pane', role: 'tabpanel', 'aria-label': strings.paneSecure() },
    createElement(
      'div',
      { className: 'dsh-my-notify-pane-hd' },
      createElement('h2', null, strings.paneSecure()),
      createElement('span', { className: 'dsh-my-notify-hint' }, strings.secureHint()),
    ),
    secureTokenCard(ctx),
    createElement('div', { className: 'dsh-my-notify-grid2' }, secureRemoteCard(ctx), secureImportCard(ctx)),
    createElement('div', { className: 'dsh-my-notify-status' }, apiToken !== '' ? strings.settingsApiTokenHint() : ''),
  )
}
function secureTokenCard(ctx) {
  const { draft, patch, shown, setShown, token, regenerate } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.secureApiToken()),
      createElement(
        'span',
        { className: 'dsh-my-notify-badge', 'data-kind': 'warn' },
        token !== '' ? strings.settingsApiToken() : strings.channelDisabled(),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement(
        'div',
        { className: 'dsh-my-notify-inp-group' },
        createElement('input', {
          className: 'dsh-my-notify-webhook-input',
          type: shown ? 'text' : 'password',
          value: token,
          placeholder: 'ntf_…',
          'aria-label': strings.secureApiToken(),
          onChange: (event) => patch('apiToken', event.target.value),
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            'aria-pressed': String(shown),
            onClick: () => setShown(!shown),
          },
          shown ? strings.secureHide() : strings.secureShow(),
        ),
        createElement(
          'button',
          { type: 'button', className: 'dsh-my-notify-btn', onClick: regenerate },
          strings.secureRegenerate(),
        ),
      ),
      createElement(TextRow, {
        label: strings.secureBaseUrl(),
        hint: strings.secureBaseUrlHint(),
        value: typeof draft.webBaseUrl === 'string' ? draft.webBaseUrl : '',
        onChange: (v) => patch('webBaseUrl', v),
      }),
      createElement('div', { className: 'dsh-my-notify-hint' }, strings.settingsApiTokenHint()),
    ),
  )
}
function testLineOf(state, error) {
  if (state === 'sending') return strings.secureRemoteSending()
  if (state === 'ok') return strings.secureRemoteOk()
  if (state === 'fail') return strings.secureRemoteFail() + (error !== '' ? '：' + error : '')
  if (state === 'timeout') return strings.secureRemoteTimeout()
  return strings.secureRemoteUnsent()
}
function runRemoteTest(sample, setState, setError, onTest) {
  setState('sending')
  setError('')
  let settled = false
  const finish = (state, reason) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    setState(state)
    setError(reason)
  }
  const timer = setTimeout(() => finish('timeout', ''), 8000)
  onTest('remote', sample, (ok, reason) => finish(ok ? 'ok' : 'fail', ok ? '' : (reason ?? '')))
}
function secureRemoteCard(ctx) {
  const { sample, setSample, testState, setTestState, testError, setTestError, onTest } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement(
      'div',
      { className: 'dsh-my-notify-card-hd' },
      createElement('h3', null, strings.secureRemoteTitle()),
    ),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.secureRemoteSample()),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: sample,
        'aria-label': strings.secureRemoteSample(),
        onChange: (event) => setSample(event.target.value),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn dsh-my-notify-btn-primary',
            disabled: testState === 'sending',
            onClick: () => runRemoteTest(sample, setTestState, setTestError, onTest),
          },
          testState === 'sending' ? strings.secureRemoteSending() : strings.secureRemoteSend(),
        ),
        createElement('span', { className: 'dsh-my-notify-hint' }, strings.channelTestHint()),
      ),
      createElement(
        'div',
        {
          className:
            testState === 'ok'
              ? 'dsh-my-notify-saved'
              : testState === 'fail' || testState === 'timeout'
                ? 'dsh-my-notify-error'
                : 'dsh-my-notify-status',
          role: 'status',
        },
        testLineOf(testState, testError),
      ),
    ),
  )
}
function secureImportCard(ctx) {
  const { draft, patch, imported, setImported, testState, setTestState } = ctx
  return createElement(
    'div',
    { className: 'dsh-my-notify-card' },
    createElement('div', { className: 'dsh-my-notify-card-hd' }, createElement('h3', null, strings.secureExport())),
    createElement(
      'div',
      { className: 'dsh-my-notify-card-bd' },
      createElement('pre', { className: 'dsh-my-notify-code' }, JSON.stringify(draft, null, 2)),
      createElement('span', { className: 'dsh-my-notify-webhook-field-label' }, strings.secureImport()),
      createElement('textarea', {
        className: 'dsh-my-notify-webhook-input dsh-my-notify-textarea',
        value: imported,
        placeholder: '{ "dedupeMs": 60000 }',
        'aria-label': strings.secureImport(),
        onChange: (event) => setImported(event.target.value),
      }),
      createElement(
        'div',
        { className: 'dsh-my-notify-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-notify-btn',
            onClick: () => {
              try {
                const parsed = JSON.parse(imported)
                if (parsed !== null && typeof parsed === 'object') patch('__import__', parsed)
              } catch {
                setTestState('fail')
              }
            },
          },
          strings.secureImport(),
        ),
      ),
    ),
  )
}
