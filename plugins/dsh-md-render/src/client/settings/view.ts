// ── 设置页视图：单 tab「渲染」三分组（Markdown 增强 / 思考块 / Mermaid 图表）──
// 官方 slots 扩展点：设置 → 插件 → 渲染。开关与 host 半 lib/config.js 的 schema
// 一一对应（三段命名空间化）。保存走 PUT /md-render/api/config → host 半写回 profile
// patch 文件（先合并行内已有键）+ 当即重同步 systemPrompt section（保存即生效）。
// 本文件是 part 片段：与其它片段共享 factory 作用域。文件末尾的 `export {}` 只用于
// 让 tsc 按模块作用域编译（否则 script 模式的全局作用域会让同名函数跨文件冲突）；
// scripts/build.mjs 注入前会剥掉编译产生的 exports 样板（see unwrapModule）。

/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MD_RENDER_SETTINGS_TAB_ID = 'md-render-settings'
/** 页签顺序（合并前三插件分别为 90 / 92 / 95，合一后取最前者）。 */
const MD_RENDER_SETTINGS_TAB_ORDER = 90

/** 设置页配置结构（与 host 半 MdRenderConfig 同构）。 */
interface MdRenderSettingsConfig {
  markdown?: Record<string, boolean>
  thinking?: Record<string, boolean>
  mermaid?: Record<string, boolean>
}

/** 一个开关项（label / hint 惰性求值；section + key 定位到配置树）。 */
interface MdRenderSwitchItem {
  section: 'markdown' | 'thinking' | 'mermaid'
  key: string
  label: () => string
  hint: () => string
}

/** 三分组的开关定义（顺序即渲染顺序）。 */
const MD_RENDER_SWITCH_GROUPS: { title: () => string; items: MdRenderSwitchItem[] }[] = [
  {
    title: MD_RENDER_STRINGS.groupMarkdown,
    items: [
      {
        section: 'markdown',
        key: 'copyButton',
        label: MD_RENDER_STRINGS.copyButtonLabel,
        hint: MD_RENDER_STRINGS.copyButtonHint,
      },
      {
        section: 'markdown',
        key: 'textFenceMarkdown',
        label: MD_RENDER_STRINGS.textFenceLabel,
        hint: MD_RENDER_STRINGS.textFenceHint,
      },
      {
        section: 'markdown',
        key: 'contextMarkdown',
        label: MD_RENDER_STRINGS.contextLabel,
        hint: MD_RENDER_STRINGS.contextHint,
      },
    ],
  },
  {
    title: MD_RENDER_STRINGS.groupThinking,
    items: [
      {
        section: 'thinking',
        key: 'defaultExpanded',
        label: MD_RENDER_STRINGS.thinkingLabel,
        hint: MD_RENDER_STRINGS.thinkingHint,
      },
    ],
  },
  {
    title: MD_RENDER_STRINGS.groupMermaid,
    items: [
      {
        section: 'mermaid',
        key: 'injectPrompt',
        label: MD_RENDER_STRINGS.injectPromptLabel,
        hint: MD_RENDER_STRINGS.injectPromptHint,
      },
      {
        section: 'mermaid',
        key: 'render',
        label: MD_RENDER_STRINGS.mermaidRenderLabel,
        hint: MD_RENDER_STRINGS.mermaidRenderHint,
      },
    ],
  },
]

/** 开关行（布尔配置项）。 */
function MdRenderSettingsToggle(props: {
  label: () => string
  hint: () => string
  on: boolean
  onChange: (value: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-row' },
    createElement(
      'div',
      { className: 'dsh-md-render-settings-info' },
      createElement('div', { className: 'dsh-md-render-settings-label' }, props.label()),
      createElement('div', { className: 'dsh-md-render-settings-hint' }, props.hint()),
    ),
    createElement('div', {
      className: 'dsh-md-render-settings-toggle',
      'data-on': String(props.on),
      role: 'switch',
      'aria-checked': String(props.on),
      onClick: () => props.onChange(!props.on),
    }),
  )
}

/** 取开关当前值（缺失按默认开）。 */
function mdRenderSwitchOn(draft: MdRenderSettingsConfig, item: MdRenderSwitchItem): boolean {
  const section = draft[item.section]
  if (section === undefined || section === null) return true
  return section[item.key] !== false
}

/** 三分组视图。 */
function MdRenderSettingsGroups(props: {
  draft: MdRenderSettingsConfig
  onPatch: (item: MdRenderSwitchItem, value: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    ...MD_RENDER_SWITCH_GROUPS.map((group, index) =>
      createElement(
        'div',
        { className: 'dsh-md-render-settings-group', key: 'group-' + index },
        createElement('div', { className: 'dsh-md-render-settings-section-title' }, group.title()),
        ...group.items.map((item) =>
          createElement(MdRenderSettingsToggle, {
            key: item.section + '.' + item.key,
            label: item.label,
            hint: item.hint,
            on: mdRenderSwitchOn(props.draft, item),
            onChange: (value: boolean) => props.onPatch(item, value),
          }),
        ),
      ),
    ),
  )
}

/** 操作区：保存按钮 + 成功/失败提示（成功失败都留在原地，不弹窗、不静默）。 */
function MdRenderSettingsActions(props: { saved: boolean; failed: boolean; onSave: () => void }): unknown {
  return createElement(
    'div',
    { className: 'dsh-md-render-settings-actions' },
    createElement(
      'button',
      { className: 'dsh-md-render-settings-btn', onClick: props.onSave },
      MD_RENDER_STRINGS.save(),
    ),
    props.saved
      ? createElement('span', { className: 'dsh-md-render-settings-saved' }, MD_RENDER_STRINGS.saved())
      : null,
    props.failed
      ? createElement('span', { className: 'dsh-md-render-settings-error' }, MD_RENDER_STRINGS.saveFailed())
      : null,
  )
}

/** 配置加载失败视图：按失败原因给针对性提示 + 重试。 */
function MdRenderSettingsLoadError(props: { kind: string; onRetry: () => void }): unknown {
  const hint =
    props.kind === 'http:404'
      ? MD_RENDER_STRINGS.errorMissingRoute()
      : props.kind === 'http:403'
        ? MD_RENDER_STRINGS.errorForbidden()
        : MD_RENDER_STRINGS.errorNetwork()
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    createElement('div', { className: 'dsh-md-render-settings-error' }, MD_RENDER_STRINGS.loadFailed()),
    createElement('div', { className: 'dsh-md-render-settings-status' }, hint),
    createElement(
      'div',
      { className: 'dsh-md-render-settings-actions' },
      createElement(
        'button',
        { className: 'dsh-md-render-settings-btn', onClick: props.onRetry },
        MD_RENDER_STRINGS.retry(),
      ),
    ),
  )
}

/** 拉取当前生效配置（GET）；失败交 onError（kind 供提示区分）。 */
function loadMdRenderConfig(onValue: (value: MdRenderSettingsConfig) => void, onError: (kind: string) => void): void {
  fetch(CONFIG_API_URL)
    .then((res) => {
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
      return res.json()
    })
    .then((body: { ok?: boolean; value?: MdRenderSettingsConfig }) => {
      if (body === null || body.ok !== true) throw new Error('bad config response')
      onValue(body.value ?? {})
    })
    .catch((err: { status?: number }) => onError(typeof err?.status === 'number' ? 'http:' + err.status : 'network'))
}

/** 保存配置（PUT）：只发**变更的段**（host 半按段合并），成功交 onSaved。 */
function saveMdRenderConfig(draft: MdRenderSettingsConfig, onSaved: () => void, onError: (kind: string) => void): void {
  fetch(CONFIG_API_URL, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
    .then((res) => res.json())
    .then((body: { ok?: boolean }) => {
      if (body === null || body.ok !== true) throw new Error('save failed')
      // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
      setRenderOptions(draft)
      onSaved()
    })
    .catch(() => onError('save'))
}

/** 设置页主视图：加载当前配置 → 三分组开关编辑 → 保存（PUT /md-render/api/config）。 */
function mdRenderSettingsView(): unknown {
  const [config, setConfig] = useState<MdRenderSettingsConfig | null>(null)
  const [draft, setDraft] = useState<MdRenderSettingsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)

  const load = (): void => {
    setLoading(true)
    setErrorKind('')
    loadMdRenderConfig(
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
      { className: 'dsh-md-render-settings' },
      createElement('div', { className: 'dsh-md-render-settings-status' }, MD_RENDER_STRINGS.loading()),
    )
  }
  if (config === null) return createElement(MdRenderSettingsLoadError, { kind: errorKind, onRetry: load })

  const patch = (item: MdRenderSwitchItem, value: boolean): void => {
    const current = draft ?? {}
    setDraft({ ...current, [item.section]: { ...(current[item.section] ?? {}), [item.key]: value } })
  }
  const save = (): void => {
    setSaved(false)
    setErrorKind('')
    saveMdRenderConfig(
      draft ?? {},
      () => setSaved(true),
      (kind) => setErrorKind(kind),
    )
  }
  return createElement(
    'div',
    { className: 'dsh-md-render-settings' },
    createElement(MdRenderSettingsGroups, { draft: draft ?? {}, onPatch: patch }),
    createElement(MdRenderSettingsActions, { saved, failed: errorKind === 'save', onSave: save }),
  )
}
