// ── 设置页主视图 + 页签注册（issue #385）──────────────────────────────────
// 官方 slots 扩展点：设置 → 插件 → 远程控制。视图本体见 settings-views.js /
// settings-webhooks.js；本文件负责状态编排与页签注册。
//
// 本文件是 part 片段（构建期拼接进 __ModuleLoader__ factory 作用域），无 import/export。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）。 */
const MY_REMOTE_SETTINGS_TAB_ID = 'my-remote-settings'

/** 配置端点（与 host 半 src/settings.ts 的 SETTINGS_ROUTE_PATH 一致）。 */
const MY_REMOTE_SETTINGS_API = '/remote/settings/api/settings'

/** 可用事件 kind（与 host 半 settings-model.ts 的 EVENT_KINDS / channels.ts 一致）。 */
const MY_REMOTE_EVENTS = ['ask', 'approval', 'end']

/** 设置页主视图：加载配置 → 编辑 → 保存（PUT 配置端点）。 */
function MyRemoteSettingsView() {
  const [snapshot, setSnapshot] = useState(null)
  const [draft, setDraft] = useState(null)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = () => {
    myRemoteLoad(
      (next) => {
        setSnapshot(next)
        setDraft(next)
      },
      setLoading,
      setErrorKind,
    )
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) return myRemoteStatusView(MY_REMOTE_STRINGS.loading(), 'dsh-my-remote-status')
  if (draft === null || snapshot === null || errorKind !== '') {
    return createElement(MyRemoteLoadError, { errorKind, onRetry: load })
  }
  const onSaved = (next) => {
    setSnapshot(next)
    setDraft(next)
    setToken('')
  }
  return createElement(
    'div',
    { className: 'dsh-my-remote-settings' },
    myRemoteTokenSection(snapshot, token, setToken),
    myRemoteTimeoutSection(draft, setDraft),
    createElement(MyRemoteWebhookSection, {
      webhooks: draft.webhooks,
      onChange: (webhooks) => setDraft({ ...draft, webhooks }),
    }),
    myRemoteSaveRow(draft, token, onSaved, saved, failed, setSaved, setFailed),
  )
}

/** 单行状态视图（加载中 / 其它纯文本状态）。 */
function myRemoteStatusView(text, className) {
  return createElement('div', { className: 'dsh-my-remote-settings' }, createElement('div', { className }, text))
}

/** 鉴权区块：token 输入（密码型，留空则不修改）。 */
function myRemoteTokenSection(snapshot, token, setToken) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.tokenSection()),
    createElement(MyRemoteTextRow, {
      label: MY_REMOTE_STRINGS.tokenLabel(),
      hint: snapshot.apiTokenSet ? MY_REMOTE_STRINGS.tokenHint() : MY_REMOTE_STRINGS.tokenHintEmpty(),
      value: token,
      type: 'password',
      placeholder: MY_REMOTE_STRINGS.tokenPlaceholder(),
      onChange: setToken,
    }),
  )
}

/** 超时区块：两个非负整数输入。 */
function myRemoteTimeoutSection(draft, setDraft) {
  const timeoutRow = (label, hint, key) =>
    createElement(MyRemoteTextRow, {
      label,
      hint,
      value: String(draft[key]),
      type: 'number',
      onChange: (v) => setDraft({ ...draft, [key]: myRemoteNormalizeTimeout(Number(v), draft[key]) }),
    })
  return createElement(
    'div',
    { className: 'dsh-my-remote-section' },
    createElement('div', { className: 'dsh-my-remote-section-title' }, MY_REMOTE_STRINGS.timeoutSection()),
    timeoutRow(MY_REMOTE_STRINGS.askTimeoutLabel(), MY_REMOTE_STRINGS.askTimeoutHint(), 'askTimeoutMs'),
    timeoutRow(MY_REMOTE_STRINGS.approvalTimeoutLabel(), MY_REMOTE_STRINGS.approvalTimeoutHint(), 'approvalTimeoutMs'),
  )
}

/** 保存行：保存按钮 + 成功 / 失败提示（写操作必须给反馈，禁止静默）。 */
function myRemoteSaveRow(draft, token, onSaved, saved, failed, setSaved, setFailed) {
  return createElement(
    'div',
    { className: 'dsh-my-remote-actions' },
    createElement(
      'button',
      {
        'data-role': 'settings-save',
        className: 'dsh-my-remote-btn',
        onClick: () => myRemoteSave(myRemoteBuildPayload(draft, token), onSaved, setSaved, setFailed),
      },
      MY_REMOTE_STRINGS.save(),
    ),
    saved ? createElement('span', { className: 'dsh-my-remote-saved' }, MY_REMOTE_STRINGS.saved()) : null,
    failed ? createElement('span', { className: 'dsh-my-remote-error' }, MY_REMOTE_STRINGS.saveFailed()) : null,
  )
}

// ── 页签注册 ───────────────────────────────────────────────────────────────

/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false** —— cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client 挂掉。
 */
function attachSettingsTab(ctx) {
  // 样式注入位置在任何早退分支之前（服务判空 / HMR 时样式不会丢）。
  installStyles(ctx, 'data-dsh-my-remote-settings', MY_REMOTE_SETTINGS_STYLES, 'dsh-my-remote: settings styles')
  const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: MY_REMOTE_SETTINGS_TAB_ID,
          order: 93,
          // 惰性：宿主靠重注册跟随语言切换，这里每次取都按当前语言判定。
          label: () => MY_REMOTE_STRINGS.tabLabel(),
        },
        MyRemoteSettingsView,
      ),
    )
    return undefined
  }, 'dsh-my-remote: settings tab registration')
}
