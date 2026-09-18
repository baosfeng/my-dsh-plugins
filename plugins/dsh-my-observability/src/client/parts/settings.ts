// ── 设置页签（issue #383）：设置 → 插件 → 可观测性 ────────────────────
// 只暴露 README 已记录的 aiReview / aiTimeoutMs 两项；其余键（aiProvider /
// aiModel / aiCwd / resourceIntervalMs / resourceLimits）继续由用户在
// cordis.patch.yml 手写（服务端写回时会合并保留原条目已存在的键）。
//
// 保存 → PUT /observability/api/config → 写回 profile patch 文件；DSH 的
// watchUserPatches 热重载 patch 后重新 apply（保存即生效）。保存成功后面板
// 只更新本地状态：这两项在服务端生效，前端无缓存需要同步。
//
// 片段文件：无 import/export，共享 factory 作用域（apiJson / strings /
// createElement 由 replay.js / i18n.js / 模板提供）。
const SETTINGS_API = '/observability/api/config'

/** 设置页样式：只用自己的类名前缀 + 宿主语义 token（随 effect 注入/卸载）。 */
const SETTINGS_STYLES: string = `
.dsh-my-observability-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-observability-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-observability-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-observability-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-observability-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-observability-settings-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-my-observability-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-my-observability-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-observability-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-observability-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-observability-settings-input{flex:none;width:120px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-observability-settings-input:focus{outline:none;border-color:var(--dsw-alias-interactive-primary)}
.dsh-my-observability-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-my-observability-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-observability-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-observability-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-observability-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-observability-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

/** 开关行（布尔配置项）。 */
function SettingsToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  onChange: (value: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings-row' },
    createElement(
      'div',
      { className: 'dsh-my-observability-settings-info' },
      createElement('div', { className: 'dsh-my-observability-settings-label' }, label),
      createElement('div', { className: 'dsh-my-observability-settings-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-my-observability-settings-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 数字输入行（AI 审查超时 ms）。 */
function SettingsNumberRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: unknown
  onChange: (value: number) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings-row' },
    createElement(
      'div',
      { className: 'dsh-my-observability-settings-info' },
      createElement('div', { className: 'dsh-my-observability-settings-label' }, label),
      createElement('div', { className: 'dsh-my-observability-settings-hint' }, hint),
    ),
    createElement('input', {
      className: 'dsh-my-observability-settings-input',
      type: 'number',
      min: '1',
      step: '1000',
      value: String(value),
      onChange: (e: any) => onChange(Number(e.target.value)),
    }),
  )
}

/** 保存配置：PUT 配置端点；失败只显示失败提示（绝不误报已保存）。 */
function saveSettings(draft: any, setSaved: (value: boolean) => void, setSaveError: (value: boolean) => void): void {
  setSaved(false)
  setSaveError(false)
  apiJson(SETTINGS_API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then(() => setSaved(true))
    .catch(() => setSaveError(true))
}

/** 配置加载失败视图（读不到配置时不显示表单，避免用默认值覆盖真实配置）。 */
function SettingsLoadError({ onRetry }: { onRetry: () => void }): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings' },
    createElement('div', { className: 'dsh-my-observability-settings-error' }, strings.loadError()),
    createElement('div', { className: 'dsh-my-observability-settings-status' }, strings.settingsLoadFailedHint()),
    createElement(
      'div',
      { className: 'dsh-my-observability-settings-actions' },
      createElement('button', { className: 'dsh-my-observability-settings-btn', onClick: onRetry }, strings.retry()),
    ),
  )
}

/** 加载态（配置未返回前的占位，避免先渲染出默认值表单再被回填覆盖）。 */
function SettingsLoading(): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings' },
    createElement('div', { className: 'dsh-my-observability-settings-status' }, strings.loading()),
  )
}

/** 配置区块：区块标题 + 两个配置行（AI 审查开关 / 超时）。 */
function SettingsConfigSection({
  draft,
  patch,
}: {
  draft: any
  patch: (key: string, value: unknown) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings-section' },
    createElement('div', { className: 'dsh-my-observability-settings-section-title' }, strings.settingsSectionTitle()),
    createElement(SettingsToggleRow, {
      label: strings.settingsAiReviewLabel(),
      hint: strings.settingsAiReviewHint(),
      on: draft.aiReview !== false,
      onChange: (value: boolean) => patch('aiReview', value),
    }),
    createElement(SettingsNumberRow, {
      label: strings.settingsAiTimeoutLabel(),
      hint: strings.settingsAiTimeoutHint(),
      value: draft.aiTimeoutMs,
      onChange: (value: number) => patch('aiTimeoutMs', value),
    }),
  )
}

/** 保存区块：保存按钮 + 成功/失败提示（互斥，保存失败绝不显示"已保存"）。 */
function SettingsActions({
  save,
  saved,
  saveError,
}: {
  save: () => void
  saved: boolean
  saveError: boolean
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings-actions' },
    createElement('button', { className: 'dsh-my-observability-settings-btn', onClick: save }, strings.settingsSave()),
    saved ? createElement('span', { className: 'dsh-my-observability-settings-saved' }, strings.settingsSaved()) : null,
    saveError
      ? createElement('span', { className: 'dsh-my-observability-settings-error' }, strings.settingsSaveFailed())
      : null,
  )
}

/** 设置页视图：GET 回填 → 编辑 → 保存（各区块拆成子组件，控制单函数长度）。 */
function ObservabilitySettingsView(): unknown {
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const load = () => {
    setLoading(true)
    setSaved(false)
    setSaveError(false)
    apiJson(SETTINGS_API)
      .then((value: any) => {
        setDraft(value)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        setFailed(true)
      })
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) return createElement(SettingsLoading, null)
  if (draft === null) return createElement(SettingsLoadError, { onRetry: load })

  const patch = (key: string, value: unknown) => setDraft({ ...draft, [key]: value })
  return createElement(
    'div',
    { className: 'dsh-my-observability-settings' },
    createElement(SettingsConfigSection, { draft, patch }),
    createElement(SettingsActions, {
      save: () => saveSettings(draft, setSaved, setSaveError),
      saved,
      saveError,
    }),
  )
}

/** 附加设置页签：slots 服务缺失（精简上下文 / 宿主未提供）时静默跳过。 */
function attachObservabilitySettingsTab(ctx: ClientContext): void {
  // strict=false：首屏时 slots 提供者 fiber 可能尚未 active，strict 模式的
  // ctx.get 返回 undefined → 页签静默消失（要等 HMR 才出现）。取到实例即可，
  // 注册本身由 slots.inject 等待槽位声明。
  const slots = typeof ctx.get === 'function' ? ctx.get<SettingsSlotsService>('slots', false) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-observability-settings', 'styles')
    style.textContent = SETTINGS_STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-observability: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            // id 必须全局唯一（list 型槽位的 tab key）：复用别人的 id 会顶掉
            // 对方那一格（宿主契约：fresh id 追加在已有条目旁）。
            id: 'dsh-my-observability-settings',
            order: 92,
            label: () => strings.settingsTitle(),
          },
          ObservabilitySettingsView as (props: any) => unknown,
        ),
      ),
    'dsh-my-observability: settings tab registration',
  )
}
