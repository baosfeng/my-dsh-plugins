// ── candidates: 待确认候选 / 元数据行 / 演进历史（issue #78）────────────────
// 拆分自 view-rows.part.js：与条目卡片解耦，控制单文件行数（≤400 门禁）。

/** 候选条目类型 */
interface CandidateItem {
  id: string
  desc: string
  category?: string
  scope?: string
  createdAt?: number
  source?: { sessionId?: string }
}

/** 记忆条目类型（包含元数据） */
interface MemoryItemWithMeta {
  id: string
  desc: string
  category?: string
  confidence?: number
  updatedAt?: number
  history?: Array<{ action: string; at: number }>
  status?: string
  /** 来源会话（issue #209）：agent 自动保存的条目带 sessionId，手动新增为空。 */
  source?: { sessionId?: string }
}

/** 一条待确认候选（issue #78）：分类徽标 + 描述 + 范围 + 来源 + 确认/拒弃。 */
function CandidateRow({
  candidate,
  busy,
  onConfirm,
  onDismiss,
}: {
  candidate: CandidateItem
  busy: boolean
  onConfirm: () => void
  onDismiss: () => void
}): ReactNode {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-candidate' },
    createElement(
      'div',
      { className: 'dsh-my-memory-row-head' },
      createElement(
        'div',
        { className: 'dsh-my-memory-row-desc-wrap' },
        createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(candidate.category)),
        createElement('span', { className: 'dsh-my-memory-desc' }, candidate.desc),
      ),
      createElement(
        'div',
        { className: 'dsh-my-memory-actions' },
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-confirm',
            label: `${strings.confirmCandidate()} ${candidate.id}`,
            onClick: onConfirm,
          },
          icon.check(14),
        ),
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
            label: `${strings.dismissCandidate()} ${candidate.id}`,
            onClick: onDismiss,
          },
          icon.close(14),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-memory-meta' },
      createElement('span', { className: 'dsh-my-memory-meta-icon' }, icon.clock(11)),
      relativeTime(candidate.createdAt),
      createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
      strings.candidateScopeBadge(candidate.scope),
      createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
      strings.candidateSource(candidate.source?.sessionId),
    ),
    busy ? createElement('div', { className: 'dsh-my-memory-entry-hint' }, strings.loading()) : null,
  )
}

/** 演进历史控件：展开/收起按钮 + 历史条目列表（有 history 才渲染）。 */
function HistoryControl({
  item,
  isExpanded,
  onToggle,
}: {
  item: MemoryItemWithMeta
  isExpanded: boolean
  onToggle: () => void
}): ReactNode {
  const hasHistory = Array.isArray(item.history) && item.history.length > 0
  if (!hasHistory) return null
  return createElement(
    'span',
    null,
    createElement(
      'button',
      {
        className: 'dsh-my-memory-expand',
        'aria-label': isExpanded ? strings.collapse() : strings.historyLabel(),
        onClick: onToggle,
      },
      icon.chevronDown(14),
      isExpanded ? strings.collapse() : strings.historyLabel(),
    ),
    isExpanded
      ? item.history.map((entry, index) =>
          createElement(
            'span',
            { key: `${entry.at}-${index}`, className: 'dsh-my-memory-history-entry' },
            `${strings.historyEntry(entry.action)} · ${relativeTime(entry.at)}`,
          ),
        )
      : null,
  )
}

/** 记忆条目元数据行（issue #78）：分类徽标 + 置信度 + 矛盾标记 + 演进历史
 *  （展开时显示 history 列表）。confidence 缺失/非数字时不渲染置信度徽标
 *  （之前直接拼 "置信度 ${n}"，缺失时出现"置信度 undefined"）。 */
function MetadataRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: MemoryItemWithMeta
  isExpanded: boolean
  onToggle: () => void
}): ReactNode {
  const hasConfidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0
  return createElement(
    'div',
    { className: 'dsh-my-memory-meta' },
    createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(item.category)),
    hasConfidence
      ? createElement('span', { className: 'dsh-my-memory-conf-badge' }, strings.confidenceLabel(item.confidence))
      : null,
    item.status === 'conflict-pending'
      ? createElement('span', { className: 'dsh-my-memory-conflict-badge' }, strings.statusConflict())
      : null,
    typeof item.source?.sessionId === 'string' && item.source.sessionId !== ''
      ? createElement(
          'span',
          { className: 'dsh-my-memory-source-badge' },
          strings.sourceAgentLabel(item.source.sessionId),
        )
      : null,
    createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
    createElement('span', { className: 'dsh-my-memory-meta-icon' }, icon.clock(11)),
    relativeTime(item.updatedAt),
    createElement(HistoryControl, { item, isExpanded, onToggle }),
  )
}

/** 待确认候选区块（issue #78）：自动提取的记忆候选，确认后写入（渐进
 *  合并）、拒弃则丢弃——记忆绝不静默变更。 */
function CandidatesBlock({
  candidates,
  busy,
  onConfirmCandidate,
  onDismissCandidate,
}: {
  candidates: CandidateItem[]
  busy: boolean
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
}): ReactNode {
  const list = Array.isArray(candidates) ? candidates : []
  return createElement(
    'div',
    { className: 'dsh-my-memory-candidates' },
    createElement(
      'div',
      { className: 'dsh-my-memory-section-head' },
      createElement('span', { className: 'dsh-my-memory-section-title' }, strings.candidatesSection()),
      createElement(
        ui.Pill,
        { className: 'dsh-my-memory-badge' },
        strings.countBadge(strings.candidatesSection(), list.length),
      ),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.candidatesNote()),
    list.length === 0
      ? createElement('div', { className: 'dsh-my-memory-empty' }, strings.candidatesEmpty())
      : list.map((candidate) =>
          createElement(CandidateRow, {
            key: candidate.id,
            candidate,
            busy,
            onConfirm: () => onConfirmCandidate(candidate.id),
            onDismiss: () => onDismissCandidate(candidate.id),
          }),
        ),
  )
}

// 导出给其他 part 文件使用
