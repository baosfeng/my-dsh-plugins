// ── 设置页视图：保留增强功能的开关可视化 ────────────────────────────
// 官方 slots 扩展点：设置 → 插件 → 渲染 页签。开关列表与 server 端
// （lib/index.js buildOptions + lib/routes.js SWITCH_KEYS）一一对应；
// 保存写入 profile patch 文件（持久化），DSH 的 watchUserPatches 热重载后
// client 重新 apply（保存即生效）；保存成功后立即 setRenderOptions 应用新
// 配置（当前页面无需等待重载）。
// 精简后只剩三个开关（表格 / 公式 / 代码块高亮等开关随自实现渲染下线，
// 迁移说明见 README「配置」与 CHANGELOG）。
const SETTINGS_STYLES: string = `
.dsh-md-render-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-md-render-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-md-render-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-md-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-md-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-md-render-settings-label{font:var(--dsw-font-xs-strong-13)}
.dsh-md-render-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-md-render-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-md-render-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-md-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-md-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-md-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`
/** 开关定义（key 与 server 端 SWITCH_KEYS / config.ts 一致）。 */
interface SettingsSwitch {
  key: string
  label: string
  hint: string
}

const SETTINGS_SWITCHES: SettingsSwitch[] = [
  { key: 'copyButton', label: '整段复制', hint: 'MarkdownView 整段内容一键复制（官方只有代码块复制）' },
  {
    key: 'textFenceMarkdown',
    label: 'text 围栏块渲染',
    hint: '语言标记为 text / plaintext / txt 的围栏块按 markdown 渲染，每块可切回原文',
  },
  {
    key: 'contextMarkdown',
    label: '上下文注入块渲染',
    hint: '宿主以纯文本呈现的上下文注入正文（子 agent 消息 / AGENTS.md）按 markdown 渲染',
  },
]

/** 开关行（布尔配置项）。 */
function SettingsSwitchRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-md-render-settings-info' },
      createElement('div', { className: 'dsh-md-render-settings-label' }, label),
      createElement('div', { className: 'dsh-md-render-settings-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-md-render-settings-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 开关区块（保留的全部增强项）。 */
function renderSwitchesSection(draft: Record<string, unknown>, patch: (key: string, value: unknown) => void): unknown {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-section' },
    createElement('div', { className: 'dsh-md-render-settings-section-title' }, '渲染增强'),
    ...SETTINGS_SWITCHES.map((item) =>
      createElement(SettingsSwitchRow, {
        key: item.key,
        label: item.label,
        hint: item.hint,
        on: draft[item.key] === true,
        onChange: (v: boolean) => patch(item.key, v),
      }),
    ),
  )
}
/** 保存配置（PUT /md/api/config），成功/失败更新状态。 */
function saveConfig(
  draft: Record<string, unknown>,
  setSaved: (v: boolean) => void,
  setErrorKind: (v: string) => void,
): void {
  setSaved(false)
  setErrorKind('')
  fetch('/md/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body: { ok?: boolean }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
      setRenderOptions(pickRenderOptions(draft))
      setSaved(true)
    })
    .catch(() => setErrorKind('save'))
}

/** 配置加载失败视图：失败原因（http 状态/网络）+ 针对性提示 + 重试。 */
function LoadErrorView({ errorKind, onRetry }: { errorKind: string; onRetry: () => void }): unknown {
  const hint =
    errorKind === 'http:404'
      ? '服务端插件未加载：/md/api 路由不存在（请确认已安装并启用 dsh-md-render 后重启 DSH）'
      : errorKind === 'http:403'
        ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
        : '网络错误或响应异常：请检查 DSH 服务是否正常运行'
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    createElement('div', { className: 'dsh-md-render-settings-error' }, '配置加载失败'),
    createElement('div', { className: 'dsh-md-render-settings-status' }, hint),
    createElement(
      'div',
      { className: 'dsh-md-render-settings-actions' },
      createElement('button', { className: 'dsh-md-render-settings-btn', onClick: onRetry }, '重试'),
    ),
  )
}

/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT /md/api/config）。 */
function MdRenderSettingsView(): unknown {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)

  const load = () => {
    setLoading(true)
    setErrorKind('')
    fetch('/md/api/config')
      .then((res) => {
        if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
        return res.json()
      })
      .then((body: { ok?: boolean; value?: Record<string, unknown> }) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        setConfig(body.value!)
        setDraft(body.value!)
        setLoading(false)
      })
      .catch((err: { status?: number }) => {
        setLoading(false)
        setConfig(null)
        // 区分失败原因：404 = /md/api 路由未注册（服务端插件未加载），
        // 403 = 安全围栏拒绝，其余为网络/响应异常。
        setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network')
      })
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-md-render-settings' },
      createElement('div', { className: 'dsh-md-render-settings-status' }, '加载中…'),
    )
  }
  if (config === null) {
    return createElement(LoadErrorView, { errorKind, onRetry: load })
  }
  const patch = (key: string, value: unknown) => setDraft({ ...draft!, [key]: value })
  const save = () => saveConfig(draft!, setSaved, setErrorKind)
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    renderSwitchesSection(draft!, patch),
    createElement(
      'div',
      { className: 'dsh-md-render-settings-actions' },
      createElement('button', { className: 'dsh-md-render-settings-btn', onClick: save }, '保存'),
      saved ? createElement('span', { className: 'dsh-md-render-settings-saved' }, '已保存') : null,
      errorKind ? createElement('span', { className: 'dsh-md-render-settings-error' }, '保存失败') : null,
    ),
  )
}

/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx: {
  get?: (name: string, strict?: boolean) => unknown
  effect: (fn: () => void | (() => void), label?: string) => void
}): void {
  // ctx.get 缺省（测试桩/精简上下文）时静默跳过，不影响渲染能力。
  const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined
  if (slots === undefined) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-md-render-settings', 'styles')
    style.textContent = SETTINGS_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-md-render: settings styles')
  ctx.effect(() => {
    ;(slots as { inject: (slot: string, fn: () => unknown) => unknown }).inject('settings.plugins.tab', () =>
      (slots as { register: (opts: unknown, component: unknown) => unknown }).register(
        {
          name: 'settings.plugins.tab',
          id: 'md-render-settings',
          order: 90,
          label: () => '渲染',
        },
        MdRenderSettingsView,
      ),
    )
    return undefined
  }, 'dsh-md-render: settings tab registration')
}
