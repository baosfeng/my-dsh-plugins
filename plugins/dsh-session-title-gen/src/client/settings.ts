// ── 设置页视图与页签注册（issue #385）：会话标题生成的 8 项配置 ───────────
// 官方 slots 扩展点：设置 → 插件 → 会话标题生成。字段与 host 半一一对应
// （enabled / template / provider / model / maxTitleBytes / maxInputBytes /
// maxOutputTokens / timeoutMs），语义与默认值口径以 src/config.ts 为唯一来源：
// 非法值只影响该字段（host 回退默认并把规整后的值回给本页回填）。
// 保存走 PUT 到插件配置端点 → host 半写回 profile patch（持久化）+ 更新内存生效值
// （保存即生效，不等 patch 热重载、不必重启 DSH）。
//
// 本文件是 part 片段：无 import/export，与 index.ts 的 tsc 产物、strings.ts 的文案件、
// dsh-shared client-parts 共享 __ModuleLoader__ factory 作用域（类型来自 globals.d.ts），
// 由 scripts/build.mjs 注入 lib/client.src.js 的设置页占位符（见该文件与 build.mjs 的
// 设置页占位符常量；此处刻意不写出该占位符字面量，否则产物里会出现第二个同形字面量）。

/** 设置页样式前缀（UI 规范：`dsh-<插件名>-`）。 */
const SESSION_TITLE_SETTINGS_CLASS = 'dsh-session-title-gen-settings'

/** 设置页样式：只用宿主语义变量（--dsw-*），跟随深浅主题，不硬编码色值。 */
const SESSION_TITLE_SETTINGS_STYLES: string = `
.${SESSION_TITLE_SETTINGS_CLASS}{display:flex;flex-direction:column;gap:8px;padding:12px}
.${SESSION_TITLE_SETTINGS_CLASS}-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.${SESSION_TITLE_SETTINGS_CLASS}-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:auto}
.${SESSION_TITLE_SETTINGS_CLASS}-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.${SESSION_TITLE_SETTINGS_CLASS}-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.${SESSION_TITLE_SETTINGS_CLASS}-input{flex:none;width:190px;max-width:46%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.${SESSION_TITLE_SETTINGS_CLASS}-input:focus{outline:none;border-color:var(--dsw-alias-accent)}
.${SESSION_TITLE_SETTINGS_CLASS}-input-multiline{width:100%;max-width:none;min-height:48px;resize:vertical;line-height:1.5}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.${SESSION_TITLE_SETTINGS_CLASS}-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.${SESSION_TITLE_SETTINGS_CLASS}-actions{display:flex;align-items:center;gap:8px;padding-top:2px}
.${SESSION_TITLE_SETTINGS_CLASS}-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.${SESSION_TITLE_SETTINGS_CLASS}-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${SESSION_TITLE_SETTINGS_CLASS}-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.${SESSION_TITLE_SETTINGS_CLASS}-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.${SESSION_TITLE_SETTINGS_CLASS}-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

// ── 表单状态 ─────────────────────────────────────────────────────────

/** 文本项（template 多行，provider / model 单行）。 */
const SESSION_TITLE_TEXT_FIELDS = ['template', 'provider', 'model'] as const

/** 数字项（host 侧只认正整数，非法值回退默认）。 */
const SESSION_TITLE_NUMBER_FIELDS = ['maxTitleBytes', 'maxInputBytes', 'maxOutputTokens', 'timeoutMs'] as const

/** 设置页暴露的字段顺序（enabled 开关在最前）。 */
const SESSION_TITLE_FIELDS = ['enabled', ...SESSION_TITLE_TEXT_FIELDS, ...SESSION_TITLE_NUMBER_FIELDS] as const

type SessionTitleField = (typeof SESSION_TITLE_FIELDS)[number]

/** 表单值：数字项以字符串存（受控 input 的 value 是字符串），提交时再规整。 */
interface SessionTitleForm {
  enabled: boolean
  template: string
  provider: string
  model: string
  maxTitleBytes: string
  maxInputBytes: string
  maxOutputTokens: string
  timeoutMs: string
}

/** 首屏（配置未到达前）的表单初值：与 host 半 src/config.ts 的 DEFAULT_SETTINGS 同口径。 */
const SESSION_TITLE_FALLBACK_FORM: SessionTitleForm = {
  enabled: true,
  template: '[{workspace}] {description}',
  provider: '',
  model: '',
  maxTitleBytes: '80',
  maxInputBytes: '4096',
  maxOutputTokens: '64',
  timeoutMs: '30000',
}

/** 数字文本规整：数字原样，其余回退 fallback。 */
function sessionTitleNumberText(value: unknown, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback
}

/** 配置快照（GET / PUT 响应）→ 表单值：逐字段规整，缺失 / 非法回退初值。 */
function sessionTitleFormOf(value: unknown): SessionTitleForm {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : SESSION_TITLE_FALLBACK_FORM.enabled,
    template:
      typeof raw.template === 'string' && raw.template !== '' ? raw.template : SESSION_TITLE_FALLBACK_FORM.template,
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    maxTitleBytes: sessionTitleNumberText(raw.maxTitleBytes, SESSION_TITLE_FALLBACK_FORM.maxTitleBytes),
    maxInputBytes: sessionTitleNumberText(raw.maxInputBytes, SESSION_TITLE_FALLBACK_FORM.maxInputBytes),
    maxOutputTokens: sessionTitleNumberText(raw.maxOutputTokens, SESSION_TITLE_FALLBACK_FORM.maxOutputTokens),
    timeoutMs: sessionTitleNumberText(raw.timeoutMs, SESSION_TITLE_FALLBACK_FORM.timeoutMs),
  }
}

/** 表单值 → PUT payload：数字项非正数 / 非数字 / 空提交 null（host 按非法值回退默认）。 */
function sessionTitleNumberOrNull(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() !== '' && Number.isFinite(value) ? value : null
}

function sessionTitlePayloadOf(form: SessionTitleForm): Record<string, unknown> {
  return {
    enabled: form.enabled,
    template: form.template,
    provider: form.provider,
    model: form.model,
    maxTitleBytes: sessionTitleNumberOrNull(form.maxTitleBytes),
    maxInputBytes: sessionTitleNumberOrNull(form.maxInputBytes),
    maxOutputTokens: sessionTitleNumberOrNull(form.maxOutputTokens),
    timeoutMs: sessionTitleNumberOrNull(form.timeoutMs),
  }
}

// ── 视图 ─────────────────────────────────────────────────────────────

type SessionTitleChange = (field: SessionTitleField, value: string | boolean) => void

/** 设置行（左：标题 + 说明；右：控件）。 */
function SessionTitleSettingsRow(props: { label: string; hint: string; control: unknown }): unknown {
  return createElement(
    'div',
    { className: SESSION_TITLE_SETTINGS_CLASS + '-row' },
    createElement(
      'div',
      { className: SESSION_TITLE_SETTINGS_CLASS + '-info' },
      createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-label' }, props.label),
      createElement('div', { className: SESSION_TITLE_SETTINGS_CLASS + '-hint' }, props.hint),
    ),
    props.control,
  )
}

/** 布尔项控件：button role=switch（UI 规范禁止原生 checkbox）。 */
function sessionTitleToggle(form: SessionTitleForm, onChange: SessionTitleChange): unknown {
  const on = form.enabled
  return createElement('button', {
    type: 'button',
    className: SESSION_TITLE_SETTINGS_CLASS + '-toggle',
    'data-field': 'enabled',
    'data-on': String(on),
    role: 'switch',
    'aria-checked': String(on),
    onClick: () => onChange('enabled', !on),
  })
}

/** 文本 / 数字项控件（template 用多行输入）。 */
function sessionTitleInput(
  field: Exclude<SessionTitleField, 'enabled'>,
  form: SessionTitleForm,
  onChange: SessionTitleChange,
): unknown {
  const multiline = field === 'template'
  const numeric = (SESSION_TITLE_NUMBER_FIELDS as readonly string[]).includes(field)
  const className = multiline
    ? SESSION_TITLE_SETTINGS_CLASS + '-input ' + SESSION_TITLE_SETTINGS_CLASS + '-input-multiline'
    : SESSION_TITLE_SETTINGS_CLASS + '-input'
  return createElement(multiline ? 'textarea' : 'input', {
    className,
    'data-field': field,
    type: numeric ? 'number' : 'text',
    value: String(form[field]),
    onChange: (event: { target?: { value?: unknown } }) => onChange(field, String(event?.target?.value ?? '')),
  })
}

/** 8 项配置行（顺序固定：开关 → 3 文本 → 4 数字）。 */
function sessionTitleFieldRows(form: SessionTitleForm, onChange: SessionTitleChange): unknown[] {
  return SESSION_TITLE_FIELDS.map((field) =>
    createElement(SessionTitleSettingsRow, {
      key: field,
      label: SESSION_TITLE_SETTINGS_STRINGS.fields[field].label(),
      hint: SESSION_TITLE_SETTINGS_STRINGS.fields[field].hint(),
      control: field === 'enabled' ? sessionTitleToggle(form, onChange) : sessionTitleInput(field, form, onChange),
    }),
  )
}

/** 加载失败提示：区分 404（服务端插件未加载）/ 403（安全围栏）/ 网络异常。 */
function sessionTitleErrorHint(errorKind: string): string {
  if (errorKind === 'http:404') return SESSION_TITLE_SETTINGS_STRINGS.errorRouteMissing()
  if (errorKind === 'http:403') return SESSION_TITLE_SETTINGS_STRINGS.errorForbidden()
  return SESSION_TITLE_SETTINGS_STRINGS.errorNetwork()
}

/** 配置加载失败视图：失败原因（http 状态 / 网络）+ 针对性提示 + 重试。 */
function SessionTitleSettingsLoadError(props: { errorKind: string; onRetry: () => void }): unknown {
  const cls = SESSION_TITLE_SETTINGS_CLASS
  return createElement(
    'div',
    { className: cls },
    createElement('div', { className: cls + '-error' }, SESSION_TITLE_SETTINGS_STRINGS.loadFailed()),
    createElement('div', { className: cls + '-status' }, sessionTitleErrorHint(props.errorKind)),
    createElement(
      'div',
      { className: cls + '-actions' },
      createElement(
        'button',
        { type: 'button', className: cls + '-btn', onClick: props.onRetry },
        SESSION_TITLE_SETTINGS_STRINGS.retry(),
      ),
    ),
  )
}

/** 拉取当前配置并回填表单（成功 / 失败都落到状态上，不静默）。 */
function loadSessionTitleSettings(
  apply: (form: SessionTitleForm) => void,
  setLoading: (v: boolean) => void,
  setErrorKind: (v: string) => void,
): void {
  setLoading(true)
  setErrorKind('')
  fetch(SESSION_TITLE_SETTINGS_API)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body: { ok?: boolean; value?: unknown }) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      apply(sessionTitleFormOf(body.value))
      setLoading(false)
    })
    .catch((err: { status?: number }) => {
      setLoading(false)
      // 404 = 路由未注册（服务端插件未加载），403 = 安全围栏拒绝，其余为网络/响应异常。
      setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network')
    })
}

/** 保存表单（PUT 完整 8 项）；成功用 host 规整后的值回填 + 提示，失败提示不静默。 */
function saveSessionTitleSettings(
  form: SessionTitleForm,
  apply: (form: SessionTitleForm) => void,
  setSaved: (v: boolean) => void,
  setFailed: (v: boolean) => void,
): void {
  setSaved(false)
  setFailed(false)
  fetch(SESSION_TITLE_SETTINGS_API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sessionTitlePayloadOf(form)),
  })
    .then((res) => res.json())
    .then((body: { ok?: boolean; value?: unknown }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      // host 已把非法字段回退为默认值：用响应回填，用户看到的是**实际生效值**。
      apply(sessionTitleFormOf(body.value))
      setSaved(true)
    })
    .catch(() => setFailed(true))
}

/** 设置页主视图：加载当前配置 → 编辑 8 项 → 保存（PUT 配置端点）。 */
function SessionTitleSettingsView(): unknown {
  const [form, setForm] = useState<SessionTitleForm>(SESSION_TITLE_FALLBACK_FORM)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const cls = SESSION_TITLE_SETTINGS_CLASS

  const load = (): void => loadSessionTitleSettings(setForm, setLoading, setErrorKind)
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: cls },
      createElement('div', { className: cls + '-status' }, SESSION_TITLE_SETTINGS_STRINGS.loading()),
    )
  }
  if (errorKind !== '') return createElement(SessionTitleSettingsLoadError, { errorKind, onRetry: load })

  // 函数式更新：同一批里连续改多个字段（宿主可能合并渲染）不会用陈旧闭包互相覆盖。
  const onChange: SessionTitleChange = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }) as SessionTitleForm)
  return createElement(
    'div',
    { className: cls },
    sessionTitleFieldRows(form, onChange),
    createElement(
      'div',
      { className: cls + '-actions' },
      createElement(
        'button',
        {
          type: 'button',
          className: cls + '-btn',
          onClick: () => saveSessionTitleSettings(form, setForm, setSaved, setFailed),
        },
        SESSION_TITLE_SETTINGS_STRINGS.save(),
      ),
      saved ? createElement('span', { className: cls + '-saved' }, SESSION_TITLE_SETTINGS_STRINGS.saved()) : null,
      failed ? createElement('span', { className: cls + '-error' }, SESSION_TITLE_SETTINGS_STRINGS.saveFailed()) : null,
    ),
  )
}

// ── 页签注册 ─────────────────────────────────────────────────────────

/** client 端 part 片段看到的 slots 服务（只用到 inject / register）。 */
interface SessionTitleSettingsSlots {
  inject(name: string, callback: () => unknown): unknown
  register(options: { name: string; id: string; order: number; label: () => string }, component: () => unknown): unknown
}

/** client 端 ctx 的最小契约（只需要 effect 与 cordis 的 get）。 */
interface SessionTitleSettingsCtx {
  effect(callback: () => void | (() => void), label?: string): void
  get?(name: string, strict?: boolean): unknown
}

/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false**——cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client 挂掉。
 */
function attachSettingsTab(ctx: SessionTitleSettingsCtx): void {
  // 样式注入走共享实现，位置在任何早退分支之前（服务判空 / HMR 时样式不会丢）。
  installStyles(
    ctx,
    'data-dsh-session-title-gen-settings',
    SESSION_TITLE_SETTINGS_STYLES,
    'dsh-session-title-gen: settings styles',
  )
  const slots =
    typeof ctx.get === 'function' ? (ctx.get('slots', false) as SessionTitleSettingsSlots | undefined) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: SESSION_TITLE_SETTINGS_TAB_ID,
          order: 93,
          // 惰性：宿主靠重注册跟随语言切换，这里每次取都按当前宿主/浏览器语言判定。
          label: () => SESSION_TITLE_SETTINGS_STRINGS.tabLabel(),
        },
        SessionTitleSettingsView,
      ),
    )
    return undefined
  }, 'dsh-session-title-gen: settings tab registration')
}
