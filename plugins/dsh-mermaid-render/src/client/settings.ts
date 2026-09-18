// ── 设置页视图（issue #383）：向系统提示词注入 mermaid 能力说明 ──────────
// 官方 slots 扩展点：设置 → 插件 → Mermaid 渲染 页签。开关语义与 host 半
// （lib/config.js）一一对应：**仅显式 false 关闭**（缺失/非法值按默认开）。
// 保存走 PUT /mermaid-render/api/config → host 半写回 profile patch 文件
// （持久化）+ 当即重同步 systemPrompt section（保存即生效，不等热重载）。
//
// 本文件是 part 片段：无 import/export，与 index.ts 的 tsc 产物、dsh-shared
// client-parts 共享 __ModuleLoader__ factory 作用域（类型来自 globals.d.ts），
// 由 scripts/build.mjs 按 lib/client.src.js 的模板占位符注入本作用域。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MERMAID_SETTINGS_TAB_ID = 'mermaid-render-settings'
/** 配置端点（与 host 半 lib/routes.js 的 API_PREFIX 拼法一致）。 */
const MERMAID_SETTINGS_API = '/mermaid-render/api/config'

// ── i18n（#383 显示效果修复）：设置页文案按语言取**单语**，不再中英并排 ────
// 语言来源两级（都是浏览器全局，与单文件 bundle 形态无关）：
//  1. **宿主 locale 优先**：dsh-client-locale 把当前 UI 语言同步到 `<html lang>`
//     （syncDocumentLanguage：'zh-CN' | 'en' | 外部语言 id），宿主切语言即更新。
//     只看 navigator.language 会停在浏览器语言、与宿主 UI 语言不一致（浏览器
//     英文 + 宿主中文时最明显）。
//  2. 回退 `navigator.language`（宿主 locale 尚未同步 / 精简环境），与
//     dsh-my-guard / dsh-my-observability / dsh-my-notify 的 client i18n 同款。
// 函数名带 mermaid 前缀：本文件是 part 片段，与 index.ts 产物、dsh-shared 共享
// parts 同处一个 factory 作用域，带前缀才不会与将来的共享 part 撞名。

/** 宿主当前 UI 语言（读不到 / 未同步时返回空串）。 */
function mermaidHostLang(): string {
  try {
    const lang = document.documentElement.lang
    return typeof lang === 'string' ? lang : ''
  } catch {
    return ''
  }
}

/** 浏览器语言（宿主 locale 不可用时的回退；navigator 缺失回退英文）。 */
function mermaidBrowserLang(): string {
  try {
    return (navigator.language || 'en').toLowerCase()
  } catch {
    return 'en'
  }
}

/** 当前是否中文：宿主 `<html lang>` 优先，其次浏览器语言，再其次英文。 */
function mermaidIsZh(): boolean {
  const host = mermaidHostLang().toLowerCase()
  if (host.startsWith('zh')) return true
  if (host.startsWith('en')) return false
  // 非中英（未同步 / 外部语言包如 ja）：交给浏览器语言判定
  return mermaidBrowserLang().startsWith('zh')
}

/**
 * 设置页文案：全部是**惰性函数**（渲染期求值）。宿主切语言后重注册页签 / 重渲染
 * 组件即取到新语言；写成模块加载期的常量就跟随不了语言切换。
 */
const MERMAID_SETTINGS_STRINGS = {
  tab: () => 'Mermaid',
  toggleLabel: () => (mermaidIsZh() ? '向系统提示词注入 mermaid 能力说明' : 'Inject mermaid capability note'),
  toggleHint: () =>
    mermaidIsZh()
      ? '默认开启；关闭后已有代码块照常渲染，只是不再主动引导模型画图'
      : 'On by default; when off, existing blocks still render — the model is just no longer nudged',
  loading: () => (mermaidIsZh() ? '加载中…' : 'Loading…'),
  save: () => (mermaidIsZh() ? '保存' : 'Save'),
  saved: () => (mermaidIsZh() ? '已保存' : 'Saved'),
  saveFailed: () => (mermaidIsZh() ? '保存失败' : 'Save failed'),
  loadFailed: () => (mermaidIsZh() ? '配置加载失败' : 'Failed to load config'),
  retry: () => (mermaidIsZh() ? '重试' : 'Retry'),
  errorMissingRoute: () =>
    mermaidIsZh()
      ? '服务端插件未加载：/mermaid-render/api 路由不存在（确认已安装并启用 dsh-mermaid-render 后重启 DSH，HTTP 404）'
      : 'Host half not loaded: the /mermaid-render/api route is missing (install and enable dsh-mermaid-render, then restart DSH — HTTP 404)',
  errorForbidden: () =>
    mermaidIsZh()
      ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
      : 'Blocked by the trust fence (403): check your network/proxy settings',
  errorNetwork: () =>
    mermaidIsZh()
      ? '网络错误或响应异常：请检查 DSH 服务是否正常运行'
      : 'Network error or bad response: check that the DSH server is running',
}

/** 设置页样式：只用宿主语义变量（--dsw-* / --ds-*），跟随深浅主题。 */
const MERMAID_SETTINGS_STYLES: string = `
.dsh-mermaid-render-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-mermaid-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-mermaid-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-mermaid-render-settings-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-mermaid-render-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-mermaid-render-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-mermaid-render-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-mermaid-render-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-mermaid-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-mermaid-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-mermaid-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mermaid-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-mermaid-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-mermaid-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

/** 开关行入参（label / hint 是惰性文案函数：渲染期按当前语言求值）。 */
interface MermaidSettingsToggleProps {
  label: () => string
  hint: () => string
  on: boolean
  onChange: (value: boolean) => void
}

/** 开关行（布尔配置项）：文案与开关垂直居中，hint 单语一行。 */
function MermaidSettingsToggle(props: MermaidSettingsToggleProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-mermaid-render-settings-info' },
      createElement('div', { className: 'dsh-mermaid-render-settings-label' }, props.label()),
      createElement('div', { className: 'dsh-mermaid-render-settings-hint' }, props.hint()),
    ),
    createElement('div', {
      className: 'dsh-mermaid-render-settings-toggle',
      'data-on': String(props.on),
      role: 'switch',
      'aria-checked': String(props.on),
      onClick: () => props.onChange(!props.on),
    }),
  )
}

/** 加载失败视图入参。 */
interface MermaidSettingsErrorProps {
  kind: string
  onRetry: () => void
}

/**
 * 加载失败视图：区分失败原因给可操作提示（404 = 服务端插件未加载 / 403 =
 * 安全围栏拒绝 / 其余为网络异常），并提供重试按钮——不静默、不显示空表单。
 */
function MermaidSettingsLoadError(props: MermaidSettingsErrorProps): unknown {
  const hint =
    props.kind === 'http:404'
      ? MERMAID_SETTINGS_STRINGS.errorMissingRoute()
      : props.kind === 'http:403'
        ? MERMAID_SETTINGS_STRINGS.errorForbidden()
        : MERMAID_SETTINGS_STRINGS.errorNetwork()
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-settings' },
    createElement('div', { className: 'dsh-mermaid-render-settings-error' }, MERMAID_SETTINGS_STRINGS.loadFailed()),
    createElement('div', { className: 'dsh-mermaid-render-settings-status' }, hint),
    createElement(
      'div',
      { className: 'dsh-mermaid-render-settings-actions' },
      createElement(
        'button',
        { className: 'dsh-mermaid-render-settings-btn', onClick: props.onRetry },
        MERMAID_SETTINGS_STRINGS.retry(),
      ),
    ),
  )
}

/** 配置视图入参（switch 值 + 操作区回调）。 */
interface MermaidSettingsConfigViewProps {
  draft: { injectPrompt?: boolean }
  saved: boolean
  failed: boolean
  onPatch: (value: boolean) => void
  onSave: () => void
}

/** 操作区：保存按钮 + 成功/失败提示（成功失败都留在原地，不弹窗、不静默）。 */
function MermaidSettingsActions(props: { saved: boolean; failed: boolean; onSave: () => void }): unknown {
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-settings-actions' },
    createElement(
      'button',
      { className: 'dsh-mermaid-render-settings-btn', onClick: props.onSave },
      MERMAID_SETTINGS_STRINGS.save(),
    ),
    props.saved
      ? createElement('span', { className: 'dsh-mermaid-render-settings-saved' }, MERMAID_SETTINGS_STRINGS.saved())
      : null,
    props.failed
      ? createElement('span', { className: 'dsh-mermaid-render-settings-error' }, MERMAID_SETTINGS_STRINGS.saveFailed())
      : null,
  )
}

/** 配置视图（开关 + 操作区）；加载中/加载失败由主视图提前返回。 */
function MermaidSettingsConfigView(props: MermaidSettingsConfigViewProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-mermaid-render-settings' },
    createElement(MermaidSettingsToggle, {
      label: MERMAID_SETTINGS_STRINGS.toggleLabel,
      hint: MERMAID_SETTINGS_STRINGS.toggleHint,
      on: props.draft.injectPrompt !== false,
      onChange: props.onPatch,
    }),
    createElement(MermaidSettingsActions, { saved: props.saved, failed: props.failed, onSave: props.onSave }),
  )
}

/** 拉取当前生效配置（GET）；成功交 onValue、失败交 onError（kind 供提示区分）。 */
function loadMermaidSettingsConfig(
  onValue: (value: { injectPrompt?: boolean }) => void,
  onError: (kind: string) => void,
): void {
  fetch(MERMAID_SETTINGS_API)
    .then((res) => {
      // 保留 HTTP 状态：加载失败提示要区分「路由未注册（404）」与网络异常。
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body: { ok?: boolean; value?: { injectPrompt?: boolean } }) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      onValue(body.value ?? {})
    })
    .catch((err: { status?: number }) => onError(typeof err?.status === 'number' ? 'http:' + err.status : 'network'))
}

/** 保存配置（PUT）：成功 onSaved、失败 onError('save')——都只改视图状态。 */
function saveMermaidSettingsConfig(
  draft: { injectPrompt?: boolean } | null,
  onSaved: () => void,
  onError: (kind: string) => void,
): void {
  fetch(MERMAID_SETTINGS_API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft ?? {}),
  })
    .then((res) => res.json())
    .then((body: { ok?: boolean }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      onSaved()
    })
    .catch(() => onError('save'))
}

/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT 插件配置端点）。 */
function MermaidRenderSettingsView(): unknown {
  const [config, setConfig] = useState<{ injectPrompt?: boolean } | null>(null)
  const [draft, setDraft] = useState<{ injectPrompt?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)

  const load = (): void => {
    setLoading(true)
    setErrorKind('')
    loadMermaidSettingsConfig(
      (value) => {
        setConfig(value)
        setDraft(value)
        setLoading(false)
      },
      (kind) => {
        setConfig(null)
        setLoading(false)
        setErrorKind(kind)
      },
    )
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-mermaid-render-settings' },
      createElement('div', { className: 'dsh-mermaid-render-settings-status' }, MERMAID_SETTINGS_STRINGS.loading()),
    )
  }
  if (config === null) return createElement(MermaidSettingsLoadError, { kind: errorKind, onRetry: load })

  const save = (): void => {
    setSaved(false)
    setErrorKind('')
    saveMermaidSettingsConfig(
      draft,
      () => setSaved(true),
      (kind) => setErrorKind(kind),
    )
  }
  return createElement(MermaidSettingsConfigView, {
    draft: draft ?? {},
    saved,
    failed: errorKind === 'save',
    onPatch: (value: boolean) => setDraft({ ...(draft ?? {}), injectPrompt: value }),
    onSave: save,
  })
}

/** 官方 slots 扩展点（设置页 tab 注册）的最小契约。 */
interface MermaidSettingsSlots {
  inject(name: string, register: () => unknown): unknown
  register(options: { name: string; id: string; order: number; label: () => string }, component: () => unknown): unknown
}

/** client 端 ctx 的最小契约（只需要 effect 与 cordis 的 get）。 */
interface MermaidSettingsCtx {
  effect(callback: () => void | (() => void), label?: string): void
  get?(name: string, strict?: boolean): unknown
}

/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false**——cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）
 *    时返回 undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为
 *    拿不到 slots 就让整个 client（含 mermaid 渲染）挂掉。
 */
function attachSettingsTab(ctx: MermaidSettingsCtx): void {
  // 设置页样式走共享注入器（幂等 + 随 fiber teardown 卸载）；与卡片样式一样
  // 无条件最先注入，不进任何早退分支（服务判空/HMR 时样式会丢，见共享 part 注释）。
  installStyles(ctx, 'data-dsh-mermaid-render-settings', MERMAID_SETTINGS_STYLES, 'dsh-mermaid-render: settings styles')
  const slots =
    typeof ctx.get === 'function' ? (ctx.get('slots', false) as MermaidSettingsSlots | undefined) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: MERMAID_SETTINGS_TAB_ID,
          order: 95,
          // 惰性函数：宿主靠重注册 + 每次求值跟随语言切换（不得写成常量）。
          label: MERMAID_SETTINGS_STRINGS.tab,
        },
        MermaidRenderSettingsView,
      ),
    )
    return undefined
  }, 'dsh-mermaid-render: settings tab registration')
}
