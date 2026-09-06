// ── 设置页视图（issue #84）：各增强功能开关可视化 ──────────────────
// 官方 slots 扩展点：设置 → 插件 → 渲染 页签。开关列表与 server 端
// （lib/index.js buildOptions + lib/routes.js SWITCH_KEYS）一一对应；
// issue #146 起支持选择型配置（复制按钮位置 / 代码主题，server 端
// SELECT_KEYS）——新增「代码块外观」区块，枚举下拉保存同走
// PUT /md/api/config。保存写入 profile patch 文件（持久化），DSH 的
// watchUserPatches 热重载后 client 重新 apply（保存即生效）；保存成功
// 后立即 setRenderOptions 应用新配置（当前页面无需等待重载）。
const SETTINGS_STYLES = `
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
.dsh-md-render-settings-select{flex:none;height:28px;min-width:150px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);cursor:pointer}
.dsh-md-render-settings-select:hover{border-color:var(--dsw-alias-border-l3)}
.dsh-md-render-settings-select:focus{outline:none;border-color:var(--dsw-alias-accent-primary)}
.dsh-md-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-md-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-md-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

/** 开关定义（key 与 server 端 SWITCH_KEYS / config.part.js 一致）。 */
const SETTINGS_SWITCHES = [
  { key: 'copyButton', label: '复制按钮', hint: '代码块与整段内容一键复制（位置/外观见下方配置，issue #74）' },
  { key: 'syntaxHighlight', label: '语法高亮', hint: '代码块关键字/字符串/注释等着色（issue #80）' },
  { key: 'languageLabel', label: '语言标签', hint: '代码块头部显示语言名（issue #80）' },
  { key: 'lineNumbers', label: '行号', hint: '代码块左侧行号（issue #80）' },
  { key: 'taskList', label: '任务列表', hint: '- [ ] / - [x] 渲染为 checkbox（issue #81）' },
  { key: 'strikethrough', label: '删除线', hint: '~~text~~ 渲染为删除线（issue #81）' },
  { key: 'image', label: '图片', hint: '![alt](url) 渲染为图片（issue #81）' },
  { key: 'nestedList', label: '嵌套列表', hint: '按缩进层级嵌套列表（issue #81）' },
  { key: 'mathStructures', label: '公式结构', hint: '行内 $...$ 与块级 $$...$$ 公式渲染（issue #82）' },
  { key: 'tableSort', label: '表头排序', hint: '点击表头按列排序（issue #83）' },
  { key: 'tableFold', label: '长表格折叠', hint: '超过 20 行的表格默认折叠（issue #83）' },
]

/** 代码块复制按钮位置选项（issue #146）：key 与 server 端 SELECT_KEYS 一致。 */
const COPY_POSITION_OPTIONS = [
  { id: 'bottom-right', label: '右下角', hint: '按钮浮在代码块右下角（hover 显示，issue #74 原始诉求）' },
  { id: 'header', label: '头部', hint: '按钮固定在代码块头部、与语言标签同排（issue #80 布局）' },
]

/** 代码主题选项（issue #146）：id 与 server 端 SELECT_KEYS / styles.part.js 色板一致。 */
const CODE_THEME_OPTIONS = [
  { id: 'bright', label: '明亮高对比', hint: '默认主题：柔和白底 + 深色 token，白底清晰不刺眼' },
  { id: 'github-light', label: 'GitHub Light', hint: 'GitHub 官方亮色配色' },
  { id: 'github-dark', label: 'GitHub Dark', hint: 'GitHub 官方暗色配色' },
  { id: 'one-dark', label: 'One Dark', hint: 'Atom One Dark 编辑器配色' },
  { id: 'nord', label: 'Nord', hint: '北极清新配色调（暗色）' },
]

/** 开关行（布尔配置项）。 */
function SettingsSwitchRow({ label, hint, on, onChange }) {
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

/** 开关区块（全部增强项）。 */
function renderSwitchesSection(draft, patch) {
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
        onChange: (v) => patch(item.key, v),
      }),
    ),
  )
}

/** 选择行（枚举配置项，issue #146：复制按钮位置 / 代码主题）。 */
function SettingsSelectRow({ label, hint, value, options, onChange }) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-md-render-settings-info' },
      createElement('div', { className: 'dsh-md-render-settings-label' }, label),
      createElement('div', { className: 'dsh-md-render-settings-hint' }, hint),
    ),
    createElement(
      'select',
      {
        className: 'dsh-md-render-settings-select',
        value: value,
        onChange: (e) => onChange(e.target.value),
      },
      ...options.map((o) => createElement('option', { key: o.id, value: o.id }, o.label)),
    ),
  )
}

/** 代码块外观区块（issue #146：复制按钮位置 + 代码主题选择）。 */
function renderAppearanceSection(draft, patch) {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-section' },
    createElement('div', { className: 'dsh-md-render-settings-section-title' }, '代码块外观'),
    createElement(SettingsSelectRow, {
      label: '复制按钮位置',
      hint: COPY_POSITION_OPTIONS.find((o) => o.id === draft.copyButtonPosition)?.hint ?? COPY_POSITION_OPTIONS[0].hint,
      value:
        draft.copyButtonPosition && COPY_POSITION_OPTIONS.some((o) => o.id === draft.copyButtonPosition)
          ? draft.copyButtonPosition
          : COPY_POSITION_OPTIONS[0].id,
      options: COPY_POSITION_OPTIONS,
      onChange: (v) => patch('copyButtonPosition', v),
    }),
    createElement(SettingsSelectRow, {
      label: '代码主题',
      hint: CODE_THEME_OPTIONS.find((o) => o.id === draft.codeTheme)?.hint ?? CODE_THEME_OPTIONS[0].hint,
      value:
        draft.codeTheme && CODE_THEME_OPTIONS.some((o) => o.id === draft.codeTheme)
          ? draft.codeTheme
          : CODE_THEME_OPTIONS[0].id,
      options: CODE_THEME_OPTIONS,
      onChange: (v) => patch('codeTheme', v),
    }),
  )
}

/** 保存配置（PUT /md/api/config），成功/失败更新状态。 */
function saveConfig(draft, setSaved, setErrorKind) {
  setSaved(false)
  setErrorKind('')
  fetch('/md/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
      setRenderOptions(pickRenderOptions(draft))
      setSaved(true)
    })
    .catch(() => setErrorKind('save'))
}

/** 配置加载失败视图：失败原因（http 状态/网络）+ 针对性提示 + 重试。 */
function LoadErrorView({ errorKind, onRetry }) {
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
function MdRenderSettingsView() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
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
      .then((body) => {
        if (body === null || body.ok !== true) throw new Error('bad config response')
        setConfig(body.value)
        setDraft(body.value)
        setLoading(false)
      })
      .catch((err) => {
        setLoading(false)
        setConfig(null)
        // 区分失败原因：404 = /md/api 路由未注册（服务端插件未加载），
        // 403 = 安全围栏拒绝，其余为网络/响应异常。之前只显示笼统的
        // "配置加载失败"，用户无法判断是插件没启用还是临时网络问题。
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
  const patch = (key, value) => setDraft({ ...draft, [key]: value })
  const save = () => saveConfig(draft, setSaved, setErrorKind)
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    renderSwitchesSection(draft, patch),
    renderAppearanceSection(draft, patch),
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
function attachSettingsTab(ctx) {
  // ctx.get 缺省（测试桩/精简上下文）时静默跳过，不影响渲染能力。
  const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined
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
  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'md-render-settings',
            order: 90,
            label: () => '渲染',
          },
          MdRenderSettingsView,
        ),
      ),
    'dsh-md-render: settings tab registration',
  )
}
