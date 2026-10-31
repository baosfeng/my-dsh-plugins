// ── components-ui：技能台的小组件（开关 / 徽标 / 使用热度 / 内联错误）──
// 全部为纯展示函数（无 hook），状态由 view 层的根组件下传。

interface ScopeSwitchProps {
  item: SkillItem
  scope: 'global' | 'project'
  checked: boolean
  disabled: boolean
  projectCtx: boolean
  mini?: boolean
  onToggle(item: SkillItem, scope: 'global' | 'project'): void
}

/** 分组头右侧的来源说明：'<source> · <provider>'（异常组显示扫描提示）。 */
function groupProviderOf(group: SkillGroup): string {
  if (group.group === 'anomaly') return strings.groupAnomalyHint()
  const first = group.items[0]
  if (first === undefined) return ''
  const parts: string[] = []
  if (first.source !== '') parts.push(first.source)
  if (first.provider !== '' && first.provider !== first.source) parts.push(first.provider)
  return parts.length === 0 ? strings.usageViaNone() : parts.join(' · ')
}

function groupLabelOf(group: SourceGroup): string {
  if (group === 'project') return strings.groupProject()
  if (group === 'user') return strings.groupUser()
  if (group === 'bundled') return strings.groupBundled()
  if (group === 'other') return strings.groupOther()
  return strings.groupAnomaly()
}

function sourceLabelOf(source: string): string {
  return groupLabelOf(groupSource(source))
}

function badgeElement(className: string, text: string, key?: string): unknown {
  const props: Record<string, unknown> = { className: 'dsh-my-skill-manager-badge ' + className }
  if (key !== undefined) props.key = key
  return createElement('span', props, text)
}

/** 状态徽标：扫描异常 → 原因 + 扫描异常；否则全局关闭 / 本项目关闭。
 *  目录扫描发现但 catalog 不可见的正常 skill 不挂「未收录」类徽标。 */
function skillBadges(item: SkillItem): unknown[] {
  if (isAnomaly(item)) {
    return [
      badgeElement('dsh-my-skill-manager-badge-warn', strings.reasonShort(item.reason), 'reason'),
      badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeScanIssue(), 'scan-issue'),
    ]
  }
  if (!item.globalOn) return [badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeGlobalOff(), 'global-off')]
  if (!item.projectOn)
    return [badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeProjectOff(), 'project-off')]
  return []
}

/** 使用热度：次数 + 最近；从未使用显示「未使用」。 */
function usageElement(item: SkillItem): unknown {
  const count = usageCountOf(item)
  if (count === 0) {
    return createElement('span', { className: 'dsh-my-skill-manager-usage' }, glyph.activity(12), strings.usageNever())
  }
  const recent = formatRecent(lastUsedOf(item))
  const title = strings.usageTitle(count, recent === '' ? strings.usageViaNone() : recent)
  return createElement(
    'span',
    { className: 'dsh-my-skill-manager-usage', title },
    glyph.activity(12),
    strings.usageTimes(count) + (recent === '' ? '' : ' · ' + recent),
  )
}

/** 卡片脚注（作用域不可用 / 已关闭的原因）。 */
function footNote(item: SkillItem, projectCtx: boolean): string {
  if (isAnomaly(item)) return strings.footAnomaly()
  if (!projectCtx) return strings.footNoProject()
  if (!item.globalOn) return strings.footGlobalOff()
  if (!item.projectOn) return strings.footProjectOff()
  return ''
}

/** 开关三态：checked / unavailable（异常或无项目上下文）/ warn（仅本项目关闭）。 */
function scopeSwitchState(props: ScopeSwitchProps): { checked: boolean; unavailable: boolean; warn: boolean } {
  const unavailable = props.disabled || (props.scope === 'project' && !props.projectCtx)
  const checked = props.scope === 'project' && !props.projectCtx ? false : props.checked
  const warn = props.scope === 'project' && !unavailable && !props.checked
  return { checked, unavailable, warn }
}

function scopeSwitchClasses(props: ScopeSwitchProps, warn: boolean): string {
  const classes = ['dsh-my-skill-manager-switch']
  if (props.mini === true) classes.push('dsh-my-skill-manager-switch-mini')
  if (warn) classes.push('dsh-my-skill-manager-switch-warn')
  return classes.join(' ')
}

/** 双作用域开关（role=switch + aria-checked；异常 / 无项目上下文时禁用）。 */
function ScopeSwitch(props: ScopeSwitchProps): unknown {
  const label = props.scope === 'global' ? strings.scopeGlobal() : strings.scopeProject()
  const state = scopeSwitchState(props)
  const buttonProps: Record<string, unknown> = {
    type: 'button',
    role: 'switch',
    className: scopeSwitchClasses(props, state.warn),
    'aria-checked': state.checked,
    'aria-label': strings.scopeAria(props.item.name, label, state.checked, state.unavailable),
    disabled: state.unavailable,
    title: strings.scopeTitle(label, state.checked, state.unavailable),
  }
  if (!state.unavailable) buttonProps.onClick = () => props.onToggle(props.item, props.scope)
  return createElement(
    'button',
    buttonProps,
    props.mini === true ? null : createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, label),
    createElement(
      'span',
      { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' },
      createElement('span', { className: 'dsh-my-skill-manager-knob' }),
    ),
  )
}

interface InlineErrorProps {
  item: SkillItem
  error: InlineErrorValue
  onRetry(item: SkillItem): void
}

/** 单行写失败的内联错误 + 重试。 */
function InlineError(props: InlineErrorProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-inline-error', role: 'alert' },
    icon.alert(14),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-inline-error-body' },
      createElement(
        'b',
        { className: 'dsh-my-skill-manager-inline-error-title' },
        strings.inlineErrorTitle(props.item.name),
      ),
      createElement('span', { className: 'dsh-my-skill-manager-inline-error-msg' }, props.error.message),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onRetry(props.item) },
      strings.retry(),
    ),
  )
}
