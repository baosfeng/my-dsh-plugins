// ── confirm-ui: ask 范式确认卡（issue #193）──────────────────────────────
// 复刻宿主 ask / approval 卡片规格（dsh-client-ui-user-questions:234、
// dsh-client-ui-approval:272-281 两段构建产物 CSS 的证据）：
//   条带（8px 状态点 + 标题 + 范围徽标）→ 20px 大卡 → 40px/12px 选项行 →
//   footer 左右分布（左反馈文字 + 右动作按钮）。
// 面板内确认与工具侧确认共用本组件，保证两边形态一致（#193 验收标准 4）：
// 统一的 DOM 契约 = .dsh-my-memory-ask-{save,delete} > .dsh-my-memory-ask-card
// > strip / body(options + fields) / footer。

/** 确认门 reason 的结构化字段（save-policy 在中文文案后追加的行约定）。 */
interface AskReasonFields {
  /** 原始 reason 全文（解析失败时仍是可读的兜底文案）。 */
  text: string
  /** 'global' | 'project' | ''（未标注）。 */
  scope: string
  /** 记忆分类（preference/fact/...），未标注时为空串。 */
  category: string
  /** 内容摘要，未标注时为空串。 */
  content: string
}

/** 结构化行取值：`范围：project` / `分类：workflow` / `内容：...`。 */
function askReasonField(text: string, label: string): string {
  const hit = new RegExp('(?:^|\\n)' + label + '：([^\\n]+)').exec(text)
  return hit === null ? '' : hit[1].trim()
}

/** 结构化行缺失时的兜底：从中文文案里认范围（老 reason / 外部来源）。 */
function fallbackScopeOf(text: string): string {
  if (text.includes('项目记忆')) return 'project'
  if (text.includes('全局记忆')) return 'global'
  return ''
}

/** 解析确认门 reason；任何异常都退化为「只有原文」的安全结果。 */
function parseAskReason(reason: unknown): AskReasonFields {
  const text = typeof reason === 'string' ? reason : ''
  try {
    const raw = askReasonField(text, '范围')
    const scope = raw === 'global' || raw === 'project' ? raw : fallbackScopeOf(text)
    return { text, scope, category: askReasonField(text, '分类'), content: askReasonField(text, '内容') }
  } catch {
    return { text, scope: '', category: '', content: '' }
  }
}

/** 范围显示名（全局 / 项目 / 未标注）。 */
function scopeTextOf(scope: string): string {
  if (scope === 'project') return strings.projectScope()
  if (scope === 'global') return strings.globalScope()
  return strings.scopeUnknown()
}

/** 条带（ask 范式）：状态点 + 标题 + 范围徽标。 */
function AskStrip({ title, scope, variant }: { title: string; scope: string; variant: string }): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-ask-strip' },
    createElement('span', { className: 'dsh-my-memory-ask-dot' }),
    createElement('span', { className: 'dsh-my-memory-ask-strip-title' }, title),
    createElement(
      'span',
      { className: `dsh-my-memory-ask-scope-badge dsh-my-memory-ask-scope-badge-${variant}` },
      scopeTextOf(scope),
    ),
  )
}

/** 选项行组：保存列全局/项目（当前项选中），删除只列该记忆所属范围。 */
function AskOptions({ variant, scope }: { variant: string; scope: string }): ReactNode {
  const scopes = variant === 'delete' ? (scope === '' ? [] : [scope]) : ['global', 'project']
  if (scopes.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-memory-ask-options', role: 'radiogroup', 'aria-label': strings.askScopeLabel() },
    scopes.map((item) =>
      createElement(
        'div',
        {
          key: item,
          className: `dsh-my-memory-ask-option${item === scope ? ' is-active' : ''}`,
          role: 'radio',
          'aria-checked': item === scope,
          title: strings.askScopeLocked(),
        },
        createElement('span', { className: 'dsh-my-memory-ask-option-dot' }),
        createElement('span', { className: 'dsh-my-memory-ask-option-text' }, scopeTextOf(item)),
      ),
    ),
  )
}

/** 信息行：分类 / 内容（+ 超长时的概要预览，沿用 #105 契约）。 */
function AskFields({
  category,
  content,
  showSummary,
}: {
  category: string
  content: string
  showSummary: boolean
}): ReactNode {
  const fields = [
    category === ''
      ? null
      : createElement(AskField, {
          key: 'category',
          label: strings.askCategoryLabel(),
          value: strings.categoryLabel(category),
        }),
    content === ''
      ? null
      : createElement(AskField, { key: 'content', label: strings.askContentLabel(), value: content }),
  ]
  return createElement(
    'div',
    { className: 'dsh-my-memory-ask-fields' },
    ...fields,
    showSummary ? createElement(SummaryPreview, { desc: content }) : null,
  )
}

/** 单条「标签：值」信息行。 */
function AskField({ label, value }: { label: string; value: string }): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-ask-field' },
    createElement('span', { className: 'dsh-my-memory-ask-field-label' }, label),
    createElement('span', { className: 'dsh-my-memory-ask-field-value' }, value),
  )
}

/** footer（ask 范式）：左反馈文字 + 右动作按钮，gap 8/12px。 */
function AskFooter({
  note,
  allowLabel,
  rejectLabel,
  variant,
  onAllow,
  onReject,
  disabled,
}: {
  note: string
  allowLabel: string
  rejectLabel: string
  variant: string
  onAllow: () => void
  onReject: () => void
  disabled?: boolean
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-ask-footer' },
    createElement('span', { className: 'dsh-my-memory-ask-feedback' }, note),
    createElement(
      'div',
      { className: 'dsh-my-memory-ask-actions' },
      createElement(
        'button',
        {
          className: `dsh-my-memory-confirm-ok dsh-my-memory-confirm-ok-${variant}`,
          disabled: disabled === true,
          onClick: onAllow,
        },
        variant === 'delete' ? icon.trash(14) : icon.check(14),
        allowLabel,
      ),
      createElement(
        'button',
        { className: 'dsh-my-memory-confirm-cancel', disabled: disabled === true, onClick: onReject },
        icon.close(14),
        rejectLabel,
      ),
    ),
  )
}

/** 确认卡输入（面板侧与工具侧共用）。 */
interface AskConfirmCardProps {
  variant: 'save' | 'delete'
  title: string
  scope: string
  category?: string
  content?: string
  showSummary?: boolean
  note: string
  allowLabel: string
  /** 二次确认（危险操作）armed 后的按钮文案；不给则不做二次确认。 */
  armedLabel?: string
  onAllow: () => void
  onReject: () => void
  disabled?: boolean
}

/**
 * ask 范式确认卡（单一视觉实现，两处复用）。
 * `armedLabel` 存在时按钮走两步：首次点击只 arm，再次点击才执行——危险
 * 操作（删除）的二次确认；面板侧因已有「图标 → 确认面板」两步，不启用。
 */
function AskConfirmCard(props: AskConfirmCardProps): ReactNode {
  const [armed, setArmed] = useState(false)
  const isDelete = props.variant === 'delete'
  const twoStep = props.armedLabel !== undefined && props.armedLabel !== ''
  const handleAllow = (): void => {
    if (twoStep && !armed) {
      setArmed(true)
      return
    }
    props.onAllow()
  }
  const allowLabel = armed && props.armedLabel !== undefined ? props.armedLabel : props.allowLabel
  return createElement(
    'div',
    { className: `dsh-my-memory-ask dsh-my-memory-ask-${props.variant}` },
    createElement(
      'div',
      { className: 'dsh-my-memory-confirm dsh-my-memory-ask-card' },
      createElement(AskStrip, { title: props.title, scope: props.scope, variant: props.variant }),
      createElement(
        'div',
        { className: 'dsh-my-memory-ask-body' },
        createElement(AskOptions, { variant: props.variant, scope: props.scope }),
        createElement(AskFields, {
          category: props.category ?? '',
          content: props.content ?? '',
          showSummary: props.showSummary === true && !isDelete,
        }),
      ),
      createElement(AskFooter, {
        note: props.note,
        allowLabel,
        rejectLabel: strings.askReject(),
        variant: props.variant,
        onAllow: handleAllow,
        onReject: props.onReject,
        disabled: props.disabled,
      }),
    ),
  )
}

// 导出给其他 part 文件使用
