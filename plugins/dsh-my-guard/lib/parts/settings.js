'use strict'
// ── 设置页（设置 → 插件 → 安全护栏，issue #383）─────────────────────
// 官方 slots 扩展点：可视化编辑应用层配置（mode / poisonScan / injection /
// 通知设置），保存 PUT /guard/api/config → host 写 profile patch 并立即生效。
// 依赖：strings（i18n）、apiJson（panel.js）；本片段在 RULES 之后、STYLES
// 之前拼接（跨片段引用依赖 scripts/build.mjs 的 pieces 顺序）。
//
// customRules（正则规则列表）**不在这里编辑**：侧边栏「安全护栏」面板已有
// 完整编辑器，设置页只显示条数 + 指引——两套 JSON 编辑器并存必然口径分裂。
const SETTINGS_TAB_ID = 'guard-settings'
// 页签顺序：与共存插件的设置页签错开（md-render 90 / notify 91）。
const SETTINGS_TAB_ORDER = 92
// 冷却缺省值（与 host 端 DEFAULT_NOTIFY_COOLDOWN_MS 同值；此处仅用于展示兜底）。
const SETTINGS_DEFAULT_COOLDOWN_MS = 60000
/** 设置页开关行（布尔配置项；key 必须是草稿里的布尔字段名）。 */
const SETTINGS_SWITCHES = [
  { key: 'poisonScan', label: () => strings.settingsPoisonLabel(), hint: () => strings.settingsPoisonHint() },
  { key: 'injection', label: () => strings.settingsInjectionLabel(), hint: () => strings.settingsInjectionHint() },
]
/** 模式选项（三选一；id 与 host 端 GUARD_MODES 一致）。 */
const SETTINGS_MODE_OPTIONS = [
  { id: 'observe', label: () => strings.modeObserve(), hint: () => strings.settingsModeObserveHint() },
  { id: 'ask', label: () => strings.modeAsk(), hint: () => strings.settingsModeAskHint() },
  { id: 'deny', label: () => strings.modeDeny(), hint: () => strings.settingsModeDenyHint() },
]
const SETTINGS_STYLES = `
.dsh-my-guard-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-my-guard-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-my-guard-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-my-guard-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-my-guard-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-my-guard-settings-label{font:var(--dsw-font-xs-strong-13)}
.dsh-my-guard-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
/* 开关：关态灰色轨道（浅色主题下不与面板背景融合），开态换成功色 + 墨色圆点 */
.dsh-my-guard-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-my-guard-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-my-guard-settings-select{flex:none;height:28px;min-width:150px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-my-guard-settings-select:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-my-guard-settings-input{flex:none;width:88px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-my-guard-settings-input:focus{outline:none;border-color:var(--dsw-alias-interactive-primary)}
.dsh-my-guard-settings-unit{flex:none;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-guard-settings-rules-value{flex:none;font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-secondary)}
.dsh-my-guard-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-my-guard-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-my-guard-settings-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-my-guard-settings-btn:disabled{opacity:.4;cursor:default}
.dsh-my-guard-settings-btn-primary{border-color:var(--dsw-alias-interactive-primary);background:color-mix(in srgb, var(--dsw-alias-interactive-primary) 16%, transparent)}
.dsh-my-guard-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-my-guard-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-my-guard-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`
/** 设置页样式注入（随 activation 注入 / teardown 卸载）。 */
function injectSettingsStyles() {
  if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-my-guard-settings', 'styles')
  style.textContent = SETTINGS_STYLES
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}
/** 服务端 value → 草稿（缺字段回退默认；冷却毫秒 → 秒，与侧边栏面板同一口径）。 */
function settingsDraftOf(value) {
  const raw = value ?? {}
  const cooldownMs = typeof raw.notifyCooldownMs === 'number' ? raw.notifyCooldownMs : SETTINGS_DEFAULT_COOLDOWN_MS
  return {
    mode: typeof raw.mode === 'string' ? raw.mode : 'observe',
    poisonScan: raw.poisonScan !== false,
    injection: raw.injection !== false,
    notifyEnabled: raw.notifyEnabled === true,
    notifyCooldownSec: Math.max(0, Math.round(cooldownMs / 1000)),
    customRulesCount: typeof raw.customRulesCount === 'number' ? raw.customRulesCount : 0,
  }
}
/** 当前模式选项（非法/未知值回退第一项，避免下拉空白）。 */
function selectedModeOf(mode) {
  return SETTINGS_MODE_OPTIONS.find((option) => option.id === mode) ?? SETTINGS_MODE_OPTIONS[0]
}
/** 开关行。 */
function settingsSwitchRow(props) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-row' },
    createElement(
      'div',
      { className: 'dsh-my-guard-settings-info' },
      createElement('div', { className: 'dsh-my-guard-settings-label' }, props.label),
      createElement('div', { className: 'dsh-my-guard-settings-hint' }, props.hint),
    ),
    createElement('div', {
      className: 'dsh-my-guard-settings-toggle',
      'data-on': String(props.on),
      role: 'switch',
      'aria-checked': String(props.on),
      onClick: () => props.onChange(!props.on),
    }),
  )
}
/** 选择行（模式三选一）。 */
function settingsSelectRow(props) {
  return createElement(
    'select',
    {
      className: 'dsh-my-guard-settings-select',
      value: props.value,
      'aria-label': strings.settingsModeTitle(),
      onChange: (e) => props.onChange(e.target.value),
    },
    ...props.options.map((option) => createElement('option', { key: option.id, value: option.id }, option.label())),
  )
}
/** 模式区块（下拉 + 当前模式说明）。 */
function settingsModeSection(view) {
  const current = selectedModeOf(view.mode)
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-section' },
    createElement('div', { className: 'dsh-my-guard-settings-section-title' }, strings.settingsModeTitle()),
    createElement(
      'div',
      { className: 'dsh-my-guard-settings-row' },
      createElement(
        'div',
        { className: 'dsh-my-guard-settings-info' },
        createElement('div', { className: 'dsh-my-guard-settings-label' }, current.label()),
        createElement('div', { className: 'dsh-my-guard-settings-hint' }, current.hint()),
      ),
      settingsSelectRow({ value: current.id, options: SETTINGS_MODE_OPTIONS, onChange: view.setMode }),
    ),
  )
}
/** 检测开关区块（投毒扫描 / 提示注入检测）。 */
function settingsScanSection(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-section' },
    createElement('div', { className: 'dsh-my-guard-settings-section-title' }, strings.settingsScanTitle()),
    ...SETTINGS_SWITCHES.map((item) =>
      createElement(settingsSwitchRow, {
        key: item.key,
        label: item.label(),
        hint: item.hint(),
        on: view[item.key] === true,
        onChange: (v) => (item.key === 'poisonScan' ? view.setPoisonScan(v) : view.setInjection(v)),
      }),
    ),
  )
}
/** 告警通知区块（通知开关 + 冷却秒数）。 */
function settingsNotifySection(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-section' },
    createElement('div', { className: 'dsh-my-guard-settings-section-title' }, strings.settingsNotifyTitle()),
    createElement(settingsSwitchRow, {
      label: strings.notifyLabel(),
      hint: strings.notifyHint(),
      on: view.notifyEnabled,
      onChange: view.setNotifyEnabled,
    }),
    createElement(
      'div',
      { className: 'dsh-my-guard-settings-row' },
      createElement(
        'div',
        { className: 'dsh-my-guard-settings-info' },
        createElement('div', { className: 'dsh-my-guard-settings-label' }, strings.cooldownLabel()),
        createElement('div', { className: 'dsh-my-guard-settings-hint' }, strings.settingsCooldownHint()),
      ),
      createElement('input', {
        className: 'dsh-my-guard-settings-input',
        type: 'number',
        min: '0',
        value: view.notifyCooldownSec,
        'aria-label': strings.cooldownLabel(),
        onChange: (e) => view.setNotifyCooldownSec(Number(e.target.value) || 0),
      }),
      createElement('span', { className: 'dsh-my-guard-settings-unit' }, strings.settingsCooldownUnit()),
    ),
  )
}
/** 自定义规则区块（只读条数 + 指引到侧边栏面板）。 */
function settingsRulesSection(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-section' },
    createElement('div', { className: 'dsh-my-guard-settings-section-title' }, strings.settingsRulesTitle()),
    createElement(
      'div',
      { className: 'dsh-my-guard-settings-row' },
      createElement(
        'div',
        { className: 'dsh-my-guard-settings-info' },
        createElement('div', { className: 'dsh-my-guard-settings-label' }, strings.settingsRulesTitle()),
        createElement('div', { className: 'dsh-my-guard-settings-hint' }, strings.settingsRulesHint()),
      ),
      createElement(
        'div',
        { className: 'dsh-my-guard-settings-rules-value' },
        strings.settingsRulesCount(view.customRulesCount),
      ),
    ),
  )
}
/** 保存区（按钮 + 成功/失败提示）。 */
function settingsActions(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings-actions' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-settings-btn dsh-my-guard-settings-btn-primary',
        disabled: view.busy,
        onClick: () => void view.save(),
      },
      strings.settingsSave(),
    ),
    view.saved ? createElement('span', { className: 'dsh-my-guard-settings-saved' }, strings.settingsSaved()) : null,
    view.saveError
      ? createElement('span', { className: 'dsh-my-guard-settings-error' }, strings.settingsSaveFailed())
      : null,
  )
}
/** 设置页纯视图（入参即状态，便于单测直接调用）。 */
function guardSettingsView(view) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings' },
    settingsModeSection(view),
    settingsScanSection(view),
    settingsNotifySection(view),
    settingsRulesSection(view),
    settingsActions(view),
    view.busy ? createElement('div', { className: 'dsh-my-guard-settings-status' }, strings.loading()) : null,
  )
}
/** 加载中视图。 */
function settingsLoadingView() {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings' },
    createElement('div', { className: 'dsh-my-guard-settings-status' }, strings.loading()),
  )
}
/** 加载失败视图（原因 + 重试）。 */
function settingsLoadErrorView(reason, retry) {
  return createElement(
    'div',
    { className: 'dsh-my-guard-settings' },
    createElement('div', { className: 'dsh-my-guard-settings-error' }, strings.settingsLoadFailed()),
    createElement('div', { className: 'dsh-my-guard-settings-hint' }, reason),
    createElement(
      'div',
      { className: 'dsh-my-guard-settings-actions' },
      createElement(
        'button',
        { type: 'button', className: 'dsh-my-guard-settings-btn', onClick: retry },
        strings.settingsRetry(),
      ),
    ),
  )
}
/** 保存：PUT /guard/api/config（毫秒回传），响应回写草稿（host 校验后的真值）。 */
function persistGuardSettings(current, setters) {
  setters.setBusy(true)
  setters.setSaved(false)
  setters.setSaveError(false)
  return apiJson('/guard/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: current.mode,
      poisonScan: current.poisonScan,
      injection: current.injection,
      notifyEnabled: current.notifyEnabled,
      notifyCooldownMs: current.notifyCooldownSec * 1000,
    }),
  })
    .then((value) => {
      setters.setDraft(settingsDraftOf(value))
      setters.setSaved(true)
    })
    .catch(() => setters.setSaveError(true))
    .finally(() => setters.setBusy(false))
}
/** 设置页视图：加载生效配置 → 编辑 → 保存（PUT /guard/api/config）。 */
function GuardSettingsView() {
  const [draft, setDraft] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoadError('')
    void apiJson('/guard/api/config')
      .then((value) => {
        if (alive) setDraft(settingsDraftOf(value))
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [reloadTick])
  if (loadError !== '') {
    return settingsLoadErrorView(loadError, () => {
      setLoadError('')
      setReloadTick(reloadTick + 1)
    })
  }
  if (draft === null) return settingsLoadingView()
  const patchDraft = (patch) => setDraft({ ...draft, ...patch })
  return guardSettingsView({
    ...draft,
    busy,
    saved,
    saveError,
    setMode: (mode) => patchDraft({ mode }),
    setPoisonScan: (v) => patchDraft({ poisonScan: v }),
    setInjection: (v) => patchDraft({ injection: v }),
    setNotifyEnabled: (v) => patchDraft({ notifyEnabled: v }),
    setNotifyCooldownSec: (v) => patchDraft({ notifyCooldownSec: v }),
    save: () => persistGuardSettings(draft, { setDraft, setBusy, setSaved, setSaveError }),
  })
}
/**
 * 取 slots 服务：优先非 strict 的 ctx.get('slots', false)。
 * strict 模式下首屏 provider fiber 尚未 active，ctx.slots 会是 undefined，
 * 注册代码被静默跳过（设置页看不到页签，HMR 后才出现，见 dsh-my-notify
 * settings.ts 的实测结论）；取到实例即可，注册本身由 slots.inject 等待槽位
 * 声明，实际渲染发生在之后。
 */
function settingsSlotsOf(ctx) {
  if (typeof ctx.get === 'function') return ctx.get('slots', false)
  return ctx.slots
}
/** 注册设置页页签（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx) {
  const slots = settingsSlotsOf(ctx)
  if (slots === undefined) return
  ctx.effect(() => injectSettingsStyles(), 'dsh-my-guard: settings styles')
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: SETTINGS_TAB_ID,
            order: SETTINGS_TAB_ORDER,
            label: () => strings.settingsTab(),
          },
          GuardSettingsView,
        ),
      ),
    'dsh-my-guard: settings tab',
  )
}
