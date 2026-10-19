// ── 设置页视图：渲染 / 关于 双 tab + 三组开关 + 恢复默认 ────────────────
// 官方 slots 扩展点：设置 → 插件 → 渲染（以及 >= 0.1.7 的组合包详情页，见 index.ts）。
// 原型结构（dsh-md-render.html 3843–4064）：插件头 / 双 tab / 渲染面板（3 组开关 +
// 注入说明）/ 底部保存 · 恢复默认 · 已保存 / 关于面板。
// 保存走 PUT /md-render/api/config → host 半写回 profile patch 并重同步 systemPrompt；
// 同时 setRenderOptions(draft) 让当前页面立即生效。本文件是 part 片段（共享 factory 作用域）。
interface MdRenderSettingsConfig {
  markdown?: Record<string, boolean>
  thinking?: Record<string, boolean>
  mermaid?: Record<string, boolean>
}
interface MdRenderSwitchItem {
  section: 'markdown' | 'thinking' | 'mermaid'
  key: string
  label: () => string
  hint: () => string
}
interface MdRenderSwitchGroup {
  icon: string
  title: () => string
  count: () => string
  pill: 'success' | 'accent'
  items: MdRenderSwitchItem[]
  note: (() => string) | null
}
/** 开关项构造器（压掉三组表格的重复字段）。 */
function mdRenderItem(
  section: 'markdown' | 'thinking' | 'mermaid',
  key: string,
  label: () => string,
  hint: () => string,
): MdRenderSwitchItem {
  return { section: section, key: key, label: label, hint: hint }
}
/** 三组开关（顺序即渲染顺序；覆盖 host 半 schema 的全部布尔键）。 */
const MD_RENDER_SWITCH_GROUPS: MdRenderSwitchGroup[] = [
  {
    icon: 'markdown',
    title: MD_RENDER_STRINGS.groupMarkdown,
    count: MD_RENDER_STRINGS.count3,
    pill: 'success',
    items: [
      mdRenderItem('markdown', 'copyButton', MD_RENDER_STRINGS.copyTitle, MD_RENDER_STRINGS.copyDesc),
      mdRenderItem('markdown', 'textFenceMarkdown', MD_RENDER_STRINGS.fenceTitle, MD_RENDER_STRINGS.fenceDesc),
      mdRenderItem('markdown', 'contextMarkdown', MD_RENDER_STRINGS.contextTitle, MD_RENDER_STRINGS.contextDesc),
    ],
    note: null,
  },
  {
    icon: 'pencil',
    title: MD_RENDER_STRINGS.groupThinking,
    count: MD_RENDER_STRINGS.count1,
    pill: 'success',
    items: [mdRenderItem('thinking', 'defaultExpanded', MD_RENDER_STRINGS.thinkTitle, MD_RENDER_STRINGS.thinkDesc)],
    note: null,
  },
  {
    icon: 'chart',
    title: MD_RENDER_STRINGS.groupMermaid,
    count: MD_RENDER_STRINGS.injected,
    pill: 'accent',
    items: [
      mdRenderItem('mermaid', 'render', MD_RENDER_STRINGS.mermaidTitle, MD_RENDER_STRINGS.mermaidDesc),
      mdRenderItem('mermaid', 'injectPrompt', MD_RENDER_STRINGS.injectTitle, MD_RENDER_STRINGS.injectDesc),
    ],
    note: MD_RENDER_STRINGS.noteMermaid,
  },
]
/** 取开关当前值：缺失 / 非布尔 → 默认开（与 host 半 schema 同口径）。纯函数。 */
function mdrSwitchOn(
  draft: MdRenderSettingsConfig | null,
  section: 'markdown' | 'thinking' | 'mermaid',
  key: string,
): boolean {
  if (draft === null || draft === undefined) return true
  const sec = draft[section]
  if (sec === null || sec === undefined) return true
  return sec[key] !== false
}
/** 默认草稿（全部开启）；「恢复默认」与加载失败兜底共用。纯函数。 */
function mdrDefaultDraft(): MdRenderSettingsConfig {
  return {
    markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
    thinking: { defaultExpanded: true },
    mermaid: { injectPrompt: true, render: true },
  }
}
/** 图标快捷方式（共享图标集；显式尺寸）。 */
function mdrSetIcon(name: string, size: number): unknown {
  return icon[name](size)
}
/** 插件头部：图标 + 标题（含包名徽标）+ 简介 + 状态徽标。 */
function MdrSetHead(): unknown {
  return createElement(
    'div',
    { className: 'mdr-set-head' },
    createElement('div', { className: 'mdr-set-icon' }, mdrSetIcon('markdown', 18)),
    createElement(
      'div',
      { className: 'mdr-set-info' },
      createElement(
        'div',
        { className: 'mdr-set-title' },
        createElement('span', null, MD_RENDER_STRINGS.headTitle()),
        createElement('span', { className: 'mdr-pill mdr-pill-accent' }, MD_RENDER_STRINGS.packageName),
      ),
      createElement('p', { className: 'mdr-set-sub' }, MD_RENDER_STRINGS.headSub()),
    ),
    createElement(
      'div',
      { className: 'mdr-set-meta' },
      createElement('span', { className: 'mdr-pill mdr-pill-success' }, MD_RENDER_STRINGS.enabled()),
    ),
  )
}
/** 双 tab 头（渲染 / 关于）+ 右侧提示。 */
function MdrSetTabs(props: { tab: 'render' | 'about'; onTab: (tab: 'render' | 'about') => void }): unknown {
  const tab = (value: 'render' | 'about', label: () => string): unknown =>
    createElement(
      'button',
      {
        type: 'button',
        role: 'tab',
        className: 'mdr-seg-btn' + (props.tab === value ? ' is-active' : ''),
        'data-mdr-set-tab': value,
        'aria-selected': props.tab === value,
        onClick: () => props.onTab(value),
      },
      label(),
    )
  return createElement(
    'div',
    { className: 'mdr-set-tabs' },
    createElement(
      'div',
      { className: 'mdr-seg', role: 'tablist', 'aria-label': '渲染插件页签' },
      tab('render', MD_RENDER_STRINGS.tabRender),
      tab('about', MD_RENDER_STRINGS.tabAbout),
    ),
    createElement('span', { className: 'mdr-set-tab-hint' }, MD_RENDER_STRINGS.tabHint()),
  )
}
/** 开关行（标题 + 说明 + 右侧 44×26 开关）。 */
function MdrSetSwitchRow(props: {
  item: MdRenderSwitchItem
  on: boolean
  onChange: (value: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'mdr-set-row' },
    createElement(
      'div',
      { className: 'mdr-set-row-text' },
      createElement('div', { className: 'mdr-set-row-title' }, props.item.label()),
      createElement('p', { className: 'mdr-set-row-desc' }, props.item.hint()),
    ),
    createElement(
      'div',
      { className: 'mdr-set-ctrl' },
      createElement('button', {
        type: 'button',
        className: 'mdr-switch',
        role: 'switch',
        'aria-checked': props.on,
        'aria-label': props.item.label(),
        onClick: () => props.onChange(!props.on),
      }),
    ),
  )
}
/** 一个分组：分组头（图标 + 标题 + 计数徽标）+ 开关行 + 可选说明块。 */
function MdrSetGroup(props: {
  group: MdRenderSwitchGroup
  draft: MdRenderSettingsConfig
  onPatch: (item: MdRenderSwitchItem, value: boolean) => void
}): unknown {
  return createElement(
    'div',
    { className: 'mdr-set-group' },
    createElement(
      'div',
      { className: 'mdr-set-group-head' },
      mdrSetIcon(props.group.icon, 15),
      createElement('h3', null, props.group.title()),
      createElement('span', { className: 'mdr-pill mdr-pill-' + props.group.pill }, props.group.count()),
    ),
    ...props.group.items.map((item) =>
      createElement(MdrSetSwitchRow, {
        key: item.section + '.' + item.key,
        item: item,
        on: mdrSwitchOn(props.draft, item.section, item.key),
        onChange: (value: boolean) => props.onPatch(item, value),
      }),
    ),
    props.group.note === null
      ? null
      : createElement(
          'p',
          { className: 'mdr-set-note' },
          createElement('strong', null, MD_RENDER_STRINGS.noteMermaidStrong()),
          createElement('span', null, props.group.note()),
        ),
  )
}
/** 底部操作：保存 / 恢复默认 / 已保存 / 失败 / 说明。 */
function MdrSetActions(props: { saved: boolean; failed: boolean; onSave: () => void; onReset: () => void }): unknown {
  return createElement(
    'div',
    { className: 'mdr-set-actions' },
    createElement(
      'button',
      { type: 'button', className: 'mdr-set-save', onClick: props.onSave },
      mdrSetIcon('check', 13),
      createElement('span', null, MD_RENDER_STRINGS.save()),
    ),
    createElement(
      'button',
      { type: 'button', className: 'mdr-set-reset', onClick: props.onReset },
      MD_RENDER_STRINGS.reset(),
    ),
    props.saved
      ? createElement(
          'span',
          { className: 'mdr-set-saved' },
          mdrSetIcon('check', 12),
          createElement('span', null, MD_RENDER_STRINGS.saved()),
        )
      : null,
    props.failed ? createElement('span', { className: 'mdr-set-error' }, MD_RENDER_STRINGS.saveFailed()) : null,
    createElement('span', { className: 'mdr-set-foot-hint' }, MD_RENDER_STRINGS.footHint()),
  )
}
/** 关于面板：版本 / 扩展点 / 依赖 / 文档。 */
function MdrSetAbout(): unknown {
  const row = (title: () => string, desc: string): unknown =>
    createElement(
      'div',
      { className: 'mdr-set-row' },
      createElement(
        'div',
        { className: 'mdr-set-row-text' },
        createElement('div', { className: 'mdr-set-row-title' }, title()),
        createElement('p', { className: 'mdr-set-row-desc' }, desc),
      ),
    )
  return createElement(
    'div',
    { className: 'mdr-set-panel', role: 'tabpanel', 'aria-label': '关于' },
    createElement(
      'div',
      { className: 'mdr-set-group' },
      createElement(
        'div',
        { className: 'mdr-set-group-head' },
        mdrSetIcon('help', 15),
        createElement('h3', null, MD_RENDER_STRINGS.groupAbout()),
      ),
      row(MD_RENDER_STRINGS.versionTitle, MD_RENDER_STRINGS.versionDesc()),
      row(MD_RENDER_STRINGS.slotsTitle, MD_RENDER_STRINGS.slotsDesc()),
      row(MD_RENDER_STRINGS.depsTitle, MD_RENDER_STRINGS.depsDesc()),
      row(MD_RENDER_STRINGS.docsTitle, MD_RENDER_STRINGS.docsDesc()),
    ),
  )
}
/** 渲染面板：三组开关 + 底部操作（tab 切换只控制显隐）。 */
function MdrRenderPanel(props: {
  hidden: boolean
  draft: MdRenderSettingsConfig
  saved: boolean
  failed: boolean
  onPatch: (item: MdRenderSwitchItem, value: boolean) => void
  onSave: () => void
  onReset: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'mdr-set-panel', role: 'tabpanel', 'aria-label': '渲染设置', hidden: props.hidden },
    ...MD_RENDER_SWITCH_GROUPS.map((group, index) =>
      createElement(MdrSetGroup, { key: 'group-' + index, group: group, draft: props.draft, onPatch: props.onPatch }),
    ),
    createElement(MdrSetActions, {
      saved: props.saved,
      failed: props.failed,
      onSave: props.onSave,
      onReset: props.onReset,
    }),
  )
}
/** 配置加载失败视图：按失败原因给针对性提示 + 重试。 */
function MdrSetLoadError(props: { kind: string; onRetry: () => void }): unknown {
  const hint =
    props.kind === 'http:404'
      ? MD_RENDER_STRINGS.errorMissingRoute()
      : props.kind === 'http:403'
        ? MD_RENDER_STRINGS.errorForbidden()
        : MD_RENDER_STRINGS.errorNetwork()
  return createElement(
    'div',
    { className: 'mdr-set mdr-root' },
    createElement('div', { className: 'mdr-set-error' }, mdrSetIcon('alert', 13), MD_RENDER_STRINGS.loadFailed()),
    createElement('div', { className: 'mdr-set-status' }, hint),
    createElement(
      'div',
      { className: 'mdr-set-actions' },
      createElement(
        'button',
        { type: 'button', className: 'mdr-set-reset', onClick: props.onRetry },
        MD_RENDER_STRINGS.retry(),
      ),
    ),
  )
}
/** 设置状态（加载 → 草稿 → 保存 / 恢复默认）；拆出主组件压函数长度。 */
function useMdRenderSettings() {
  const [draft, setDraft] = useState<MdRenderSettingsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKind, setErrorKind] = useState('')
  const [saved, setSaved] = useState(false)
  const load = (): void => {
    setLoading(true)
    setErrorKind('')
    mdRenderLoadConfig(
      (value) => {
        setDraft(value)
        setLoading(false)
      },
      (kind) => {
        setDraft(null)
        setLoading(false)
        setErrorKind(kind)
      },
    )
  }
  useEffect(() => {
    load()
  }, [])
  const save = (next: MdRenderSettingsConfig): void => {
    setSaved(false)
    setErrorKind('')
    mdRenderSaveConfig(
      next,
      () => setSaved(true),
      (kind) => setErrorKind(kind),
    )
  }
  const patch = (item: MdRenderSwitchItem, value: boolean): void => {
    const current = draft ?? mdrDefaultDraft()
    setSaved(false)
    setDraft({ ...current, [item.section]: { ...(current[item.section] ?? {}), [item.key]: value } })
  }
  const reset = (): void => {
    const defaults = mdrDefaultDraft()
    setDraft(defaults)
    save(defaults)
  }
  return {
    draft: draft,
    loading: loading,
    errorKind: errorKind,
    saved: saved,
    load: load,
    save: save,
    patch: patch,
    reset: reset,
  }
}
/** 设置页主视图（渲染 / 关于 双 tab）。 */
function MdrSettingsView(): unknown {
  const [tab, setTab] = useState<'render' | 'about'>('render')
  const state = useMdRenderSettings()
  if (state.loading) {
    return createElement(
      'div',
      { className: 'mdr-set mdr-root' },
      createElement('div', { className: 'mdr-set-status' }, MD_RENDER_STRINGS.loading()),
    )
  }
  if (state.draft === null) return createElement(MdrSetLoadError, { kind: state.errorKind, onRetry: state.load })
  return createElement(
    'div',
    { className: 'mdr-set mdr-root' },
    createElement(MdrSetHead),
    createElement(MdrSetTabs, { tab: tab, onTab: (next: 'render' | 'about') => setTab(next) }),
    createElement(MdrRenderPanel, {
      hidden: tab !== 'render',
      draft: state.draft,
      saved: state.saved,
      failed: state.errorKind === 'save',
      onPatch: state.patch,
      onSave: () => state.save(state.draft ?? mdrDefaultDraft()),
      onReset: state.reset,
    }),
    tab === 'about' ? createElement(MdrSetAbout) : null,
  )
}
exports.mdrSwitchOn = mdrSwitchOn
exports.mdrDefaultDraft = mdrDefaultDraft
exports.MD_RENDER_SWITCH_GROUPS = MD_RENDER_SWITCH_GROUPS
exports.MdrSettingsView = MdrSettingsView
