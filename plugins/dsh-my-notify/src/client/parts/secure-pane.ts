/** 远程触发测试的样例 JSON（文案随语言切换；仅作输入框初值）。 */
function remoteSampleJson(): string {
  return JSON.stringify({ title: strings.sampleTitle(), body: strings.sampleBody() }, null, 2)
}

/** 分区 5：高级与安全（apiToken 密文切换 / 站点根 / 远程触发测试 / 导入导出）。 */
function renderSecurePane(
  draft: NotifyConfig,
  patch: PatchFn,
  apiToken: string,
  onTest: (kind: string, sample: string, done: (ok: boolean) => void) => void,
) {
  const [shown, setShown] = useState<boolean>(false)
  // 未发送 / 发送中 / 成功 / 失败（含原因 + 8s 超时）
  const [testState, setTestState] = useState<string>('unsent')
  const [testError, setTestError] = useState<string>('')
  const [sample, setSample] = useState<string>(() => remoteSampleJson())
  const [imported, setImported] = useState<string>('')
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

/** 接口与站点卡片（apiToken 密文切换 / 重新生成 / webBaseUrl）。 */
function secureTokenCard(ctx: any) {
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
          onChange: (event: any) => patch('apiToken', event.target.value),
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
        onChange: (v: string) => patch('webBaseUrl', v),
      }),
      createElement('div', { className: 'dsh-my-notify-hint' }, strings.settingsApiTokenHint()),
    ),
  )
}

/** 远程触发结果文案（未发送 / 发送中 / 成功 / 失败原因 / 超时）。 */
function testLineOf(state: string, error: string): string {
  if (state === 'sending') return strings.secureRemoteSending()
  if (state === 'ok') return strings.secureRemoteOk()
  if (state === 'fail') return strings.secureRemoteFail() + (error !== '' ? '：' + error : '')
  if (state === 'timeout') return strings.secureRemoteTimeout()
  return strings.secureRemoteUnsent()
}

/** 触发一次远程发送（8s 超时；结束必有终态）。 */
function runRemoteTest(
  sample: string,
  setState: (v: string) => void,
  setError: (v: string) => void,
  onTest: (kind: string, sample: string, done: (ok: boolean, reason?: string) => void) => void,
) {
  setState('sending')
  setError('')
  let settled = false
  const finish = (state: string, reason: string) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    setState(state)
    setError(reason)
  }
  const timer = setTimeout(() => finish('timeout', ''), 8000)
  onTest('remote', sample, (ok: boolean, reason?: string) => finish(ok ? 'ok' : 'fail', ok ? '' : (reason ?? '')))
}

/** 远程触发测试卡片（样例 JSON / 发送 / 结果态）。 */
function secureRemoteCard(ctx: any) {
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
        onChange: (event: any) => setSample(event.target.value),
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

/** 配置导出 / 导入卡片（JSON 展示 + 导入应用）。 */
function secureImportCard(ctx: any) {
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
        onChange: (event: any) => setImported(event.target.value),
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
