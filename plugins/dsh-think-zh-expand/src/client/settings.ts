// ── 设置页视图（issue #383）：思考块默认展开开关 ──────────────────────
// 官方 slots 扩展点：设置 → 插件 → 思考增强。开关语义与 host 半
// （src/index.ts 的 defaultExpanded）一一对应：**只认布尔**，缺失 / 非法一律
// 回退默认 true —— 配置面永远不能让本插件从「默认展开」变成折叠。
// 保存走 PUT /think-zh-expand/api/config → host 半写回 profile patch 文件
// （持久化）+ 更新内存生效值（保存即生效，不等 patch 热重载）。
//
// 本文件是 part 片段：无 import/export，与 index.ts 的 tsc 产物、dsh-shared
// client-parts 共享 __ModuleLoader__ factory 作用域（类型来自 globals.d.ts），
// 由 scripts/build.mjs 注入 lib/client.src.js 的设置页占位符（见该文件与
// build.mjs 的 SETTINGS_PLACEHOLDER；此处刻意不写出占位符字面量，
// 否则产物里会出现第二个同形字面量）。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**顶掉**对方那一格（静默故障）。 */
const THINK_SETTINGS_TAB_ID = 'think-zh-expand-settings'

/** 配置端点（与 host 半 src/index.ts 的 CONFIG_ROUTE_PREFIX + /config 一致）。 */
const THINK_SETTINGS_API = '/think-zh-expand/api/config'

/** 设置页样式：只用宿主语义变量（--dsw-*），跟随深浅主题，不硬编码色值。 */
const THINK_SETTINGS_STYLES: string = `
.dsh-think-zh-expand-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-think-zh-expand-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-think-zh-expand-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-think-zh-expand-settings-label{font:var(--dsw-font-xs-strong-13)}
.dsh-think-zh-expand-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-think-zh-expand-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-think-zh-expand-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-think-zh-expand-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-think-zh-expand-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-think-zh-expand-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-think-zh-expand-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-think-zh-expand-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-think-zh-expand-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-think-zh-expand-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-think-zh-expand-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`

// ── i18n（浏览器语言判定）────────────────────────────────────────────
// 判据照抄本仓库设置页惯例（dsh-my-guard / dsh-my-observability 的
// parts/i18n.ts）：navigator.language 前缀 zh；取不到时按英文。
//
// **文案一律写成惰性函数**（宿主 `settings.plugins.tab` 的 label 靠重注册跟随
// 语言切换），且**每种语言只出一份**——「中文 (English)」并排塞进同一段会让
// 设置行视觉臃肿，是本仓库已纠正的写法（原 THINK_SETTINGS_HINT 即此形态）。
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

/** 设置页文案（按当前语言返回单语；每次调用重新判定语言，不缓存）。 */
const THINK_SETTINGS_STRINGS = {
  // 页签名按浏览器语言切换。历史上英文页签刻意避开 'Thinking'（当时本插件有
  // 全局 DOM 中文化词表会改写它）；该词表已随 issue #428 移除。
  tabLabel: () => (isZh() ? '思考增强' : 'Thinking blocks'),
  rowLabel: () => (isZh() ? '思考默认展开' : 'Expand thinking by default'),
  // 英文 hint 语义两层：① 开关默认开 ②「关闭后」点标题仍可手动展开。刻意不用
  // 「已展开 + 无条件去点标题展开」的句式（自相矛盾，且丢了「关闭后」这个前提）。
  rowHint: () =>
    isZh()
      ? '思考块默认展开；关闭后仍可点击标题手动展开'
      : 'On by default; when turned off you can still expand a thinking block by clicking its title',
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadFailed: () => (isZh() ? '配置加载失败' : 'Failed to load settings'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  save: () => (isZh() ? '保存' : 'Save'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  errorRouteMissing: () =>
    isZh()
      ? '服务端插件未加载：' + THINK_SETTINGS_API + ' 不存在（请确认已安装并启用 dsh-think-zh-expand 后重启 DSH）'
      : 'Server plugin not loaded: ' +
        THINK_SETTINGS_API +
        ' is missing (install and enable dsh-think-zh-expand, then restart DSH)',
  errorForbidden: () =>
    isZh()
      ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
      : 'Rejected by the security fence (403): check network/proxy settings',
  errorNetwork: () =>
    isZh()
      ? '网络错误或响应异常：请检查 DSH 服务是否正常运行'
      : 'Network error or unexpected response: check that the DSH server is running',
}

/** 开关行（布尔配置项）。 */
function ThinkSettingsToggleRow({
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
    { className: 'dsh-think-zh-expand-settings-row' },
    createElement(
      'div',
      { className: 'dsh-think-zh-expand-settings-info' },
      createElement('div', { className: 'dsh-think-zh-expand-settings-label' }, label),
      createElement('div', { className: 'dsh-think-zh-expand-settings-hint' }, hint),
    ),
    createElement('div', {
      className: 'dsh-think-zh-expand-settings-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 开关初值 / 回退默认：true = 思考默认展开（与 host 半 DEFAULT_EXPANDED 同语义）。 */
const THINK_SETTINGS_DEFAULT = true

/** 配置快照 → 开关值：只有布尔 defaultExpanded 生效，其余（含缺失）回退 true。 */
function resolveSettingValue(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return THINK_SETTINGS_DEFAULT
  const raw = (value as { defaultExpanded?: unknown }).defaultExpanded
  return typeof raw === 'boolean' ? raw : THINK_SETTINGS_DEFAULT
}

/** 保存成功后在 client 侧同步生效值（本页立即生效，不必等 patch 热重载）。 */
function applySavedValue(value: unknown): void {
  const setter = exports.setDefaultExpanded
  if (typeof setter === 'function') (setter as (v: unknown) => unknown)(value)
}

/** 加载失败提示：区分 404（服务端插件未加载）/ 403（安全围栏）/ 网络异常。 */
function thinkSettingsErrorHint(errorKind: string): string {
  if (errorKind === 'http:404') return THINK_SETTINGS_STRINGS.errorRouteMissing()
  if (errorKind === 'http:403') return THINK_SETTINGS_STRINGS.errorForbidden()
  return THINK_SETTINGS_STRINGS.errorNetwork()
}

/** 配置加载失败视图：失败原因（http 状态 / 网络）+ 针对性提示 + 重试。 */
function ThinkSettingsLoadError({ errorKind, onRetry }: { errorKind: string; onRetry: () => void }): unknown {
  return createElement(
    'div',
    { className: 'dsh-think-zh-expand-settings' },
    createElement('div', { className: 'dsh-think-zh-expand-settings-error' }, THINK_SETTINGS_STRINGS.loadFailed()),
    createElement('div', { className: 'dsh-think-zh-expand-settings-status' }, thinkSettingsErrorHint(errorKind)),
    createElement(
      'div',
      { className: 'dsh-think-zh-expand-settings-actions' },
      createElement(
        'button',
        { className: 'dsh-think-zh-expand-settings-btn', onClick: onRetry },
        THINK_SETTINGS_STRINGS.retry(),
      ),
    ),
  )
}

/** 拉取当前配置并回填视图（成功 / 失败都落到状态上，不静默）。 */
function loadThinkSettings(
  apply: (value: boolean) => void,
  setLoading: (v: boolean) => void,
  setErrorKind: (v: string) => void,
): void {
  setLoading(true)
  setErrorKind('')
  fetch(THINK_SETTINGS_API)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body: { ok?: boolean; value?: unknown }) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      apply(resolveSettingValue(body.value))
      setLoading(false)
    })
    .catch((err: { status?: number }) => {
      setLoading(false)
      // 404 = 路由未注册（服务端插件未加载），403 = 安全围栏拒绝，其余为网络/响应异常。
      setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network')
    })
}

/** 保存开关值（PUT 配置端点）；成功即同步 client 生效值并提示，失败提示不静默。 */
function saveThinkSettings(value: boolean, setSaved: (v: boolean) => void, setFailed: (v: boolean) => void): void {
  setSaved(false)
  setFailed(false)
  fetch(THINK_SETTINGS_API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultExpanded: value }),
  })
    .then((res) => res.json())
    .then((body: { ok?: boolean }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      applySavedValue({ defaultExpanded: value })
      setSaved(true)
    })
    .catch(() => setFailed(true))
}

/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT 配置端点）。 */
function ThinkSettingsView(): unknown {
  const [value, setValue] = useState(THINK_SETTINGS_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = (): void => loadThinkSettings(setValue, setLoading, setErrorKind)
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return createElement(
      'div',
      { className: 'dsh-think-zh-expand-settings' },
      createElement('div', { className: 'dsh-think-zh-expand-settings-status' }, THINK_SETTINGS_STRINGS.loading()),
    )
  }
  if (errorKind !== '') {
    return createElement(ThinkSettingsLoadError, { errorKind, onRetry: load })
  }
  return createElement(
    'div',
    { className: 'dsh-think-zh-expand-settings' },
    createElement(ThinkSettingsToggleRow, {
      label: THINK_SETTINGS_STRINGS.rowLabel(),
      hint: THINK_SETTINGS_STRINGS.rowHint(),
      on: value,
      onChange: setValue,
    }),
    createElement(
      'div',
      { className: 'dsh-think-zh-expand-settings-actions' },
      createElement(
        'button',
        { className: 'dsh-think-zh-expand-settings-btn', onClick: () => saveThinkSettings(value, setSaved, setFailed) },
        THINK_SETTINGS_STRINGS.save(),
      ),
      saved
        ? createElement('span', { className: 'dsh-think-zh-expand-settings-saved' }, THINK_SETTINGS_STRINGS.saved())
        : null,
      failed
        ? createElement(
            'span',
            { className: 'dsh-think-zh-expand-settings-error' },
            THINK_SETTINGS_STRINGS.saveFailed(),
          )
        : null,
    ),
  )
}

/** client 端 part 片段看到的 slots 服务（只用到 inject / register）。 */
interface ThinkSettingsSlots {
  inject(name: string, callback: () => unknown): unknown
  register(options: { name: string; id: string; order: number; label: () => string }, component: () => unknown): unknown
}

/** client 端 ctx 的最小契约（只需要 effect 与 cordis 的 get）。 */
interface ThinkSettingsCtx {
  effect(callback: () => void | (() => void), label?: string): void
  get?(name: string, strict?: boolean): unknown
}

/**
 * 注册设置页签。两处刻意的写法：
 *  - `ctx.get('slots', false)`：**必须传 strict=false**——cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client（含思考块渲染）挂掉。
 */
function attachSettingsTab(ctx: ThinkSettingsCtx): void {
  // 样式注入走共享实现，位置在任何早退分支之前（服务判空 / HMR 时样式不会丢）。
  installStyles(ctx, 'data-dsh-think-zh-expand-settings', THINK_SETTINGS_STYLES, 'dsh-think-zh-expand: settings styles')
  const slots = typeof ctx.get === 'function' ? (ctx.get('slots', false) as ThinkSettingsSlots | undefined) : undefined
  if (slots === undefined || slots === null) return
  ctx.effect(() => {
    slots.inject('settings.plugins.tab', () =>
      slots.register(
        {
          name: 'settings.plugins.tab',
          id: THINK_SETTINGS_TAB_ID,
          order: 92,
          // 惰性：宿主靠重注册跟随语言切换，这里每次取都按当前 navigator.language 判定。
          label: () => THINK_SETTINGS_STRINGS.tabLabel(),
        },
        ThinkSettingsView,
      ),
    )
    return undefined
  }, 'dsh-think-zh-expand: settings tab registration')
}
