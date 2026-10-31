// ── agent 记忆：分组折叠 + 跨项目晋升（issue #502 后续）────────────────
// 从 agent-memory.ts 析出（单文件 400 行 / 单函数 70 行门禁）。卡片、编辑、
// 删除确认仍在 agent-memory.ts：这里只有「外面这层」——分组头、晋升建议、
// 晋升确认层。跨 part 引用（createElement/strings/icon/ui/AskConfirmCard）
// 由拼接作用域解析。

/** 分组标题文案：`全局 · N 条` / `项目名 · N 条`。 */
function agentGroupLabel(group: AgentMemoryGroup): string {
  const name =
    group.kind === 'global' ? strings.agentMemoryScopeGlobal() : (group.projectName ?? group.projectId ?? '')
  return strings.agentMemoryGroupLabel(name, group.count)
}

/**
 * 一个可折叠分组：头（项目名 · N 条）+ 展开后的卡片。
 *
 * 卡片由调用方渲染（它持有编辑态 / 草稿 / 动作），这里只负责「折叠」这一个
 * 关注点——否则卡片 props 会再抄一遍，两处迟早不同步。
 */
function AgentMemoryGroupBlock({
  group,
  expanded,
  onToggle,
  renderCards,
}: {
  group: AgentMemoryGroup
  expanded: boolean
  onToggle: () => void
  renderCards: () => ReactNode
}): ReactNode {
  return createElement(
    'section',
    { className: 'dsh-my-memory-agent-group' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-memory-agent-group-head',
        'aria-expanded': expanded,
        'aria-label': agentGroupLabel(group),
        onClick: onToggle,
      },
      expanded ? icon.chevronDown(14) : icon.chevronRight(14),
      createElement(
        'span',
        { className: 'dsh-my-memory-agent-group-name', title: group.projectId ?? '' },
        agentGroupLabel(group),
      ),
    ),
    expanded ? createElement('div', { className: 'dsh-my-memory-list' }, renderCards()) : null,
  )
}

/** 一条晋升建议：正文 + 涉及项目 + 相似度 + 「晋升到 user.md」按钮。 */
function AgentMemorySuggestRow({
  suggestion,
  onPromote,
}: {
  suggestion: PromoteSuggestion
  onPromote: (text: string) => void
}): ReactNode {
  const blocked = suggestion.blocked !== null
  const projects = suggestion.sources.map((source) => source.projectName).join(' / ')
  return createElement(
    'div',
    { className: 'dsh-my-memory-agent-suggest-row' },
    createElement('p', { className: 'dsh-my-memory-agent-suggest-text' }, suggestion.text),
    createElement(
      'p',
      { className: 'dsh-my-memory-agent-suggest-meta' },
      strings.agentMemorySuggestMeta(projects, Math.round(suggestion.similarity * 100)),
    ),
    blocked
      ? createElement(
          'p',
          { className: 'dsh-my-memory-agent-suggest-blocked' },
          strings.agentMemorySuggestBlocked(suggestion.blocked ?? ''),
        )
      : null,
    createElement(
      ui.Button,
      {
        variant: 'outline',
        size: 'sm',
        disabled: blocked,
        onClick: () => onPromote(suggestion.text),
      },
      strings.agentMemoryPromoteBtn(),
    ),
  )
}

/**
 * 晋升建议区块（面板顶部）：同一事实被写进 ≥2 个项目层时才出现。
 *
 * 被全局层护栏拒绝的条目**照样列出来**并给原因——静默隐藏会让用户以为
 * 面板漏了东西，而「为什么不能进全局」正是他要的信息。
 */
function AgentMemorySuggests({
  suggestions,
  onPromote,
}: {
  suggestions: PromoteSuggestion[]
  onPromote: (text: string) => void
}): ReactNode {
  if (suggestions.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-memory-agent-suggest' },
    createElement(
      'p',
      { className: 'dsh-my-memory-agent-suggest-title' },
      strings.agentMemorySuggestTitle(suggestions.length),
    ),
    suggestions.map((suggestion) =>
      createElement(AgentMemorySuggestRow, { key: suggestion.text, suggestion, onPromote }),
    ),
  )
}

/** 晋升确认层（复用 ask 范式卡片）：一次要改全局层 + 多个项目文件。 */
function AgentMemoryPromoteConfirm({
  suggestion,
  onCancel,
  onConfirm,
}: {
  suggestion: PromoteSuggestion
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-overlay', role: 'presentation' },
    createElement(AskConfirmCard, {
      variant: 'save',
      title: strings.agentMemoryPromoteTitle(),
      scope: 'global',
      category: '',
      content: suggestion.text,
      showSummary: false,
      note: strings.agentMemoryPromoteNote(suggestion.sources.length),
      allowLabel: strings.agentMemoryPromoteBtn(),
      onAllow: onConfirm,
      onReject: onCancel,
    }),
  )
}
