'use strict'
// ── row ────────────────────────────────────────────────────────────────
/** Row head: source chip + name + status badge + failure-category badge. */
function RowHead({ entry, source }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-row-head' },
    createElement(
      'span',
      { className: 'dsh-my-guardian-source' },
      source === 'staged' ? strings.staged() : strings.promoted(),
    ),
    createElement('span', { className: 'dsh-my-guardian-name', title: entry.id }, entry.name),
    createElement(
      'span',
      { className: `dsh-my-guardian-badge dsh-my-guardian-badge-${entry.status}` },
      statusLabel(entry.status),
    ),
    typeof entry.failureType === 'string' && entry.failureType !== ''
      ? createElement(
          'span',
          {
            className: `dsh-my-guardian-category dsh-my-guardian-category-${entry.failureType}`,
            title: entry.failureType,
          },
          failureTypeLabel(entry.failureType),
        )
      : null,
  )
}
/** Row meta: entry id + failure attempts + last failure time. */
function RowMeta({ entry }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-row-meta' },
    createElement('span', null, entry.id),
    entry.attempts > 0
      ? createElement('span', { className: 'dsh-my-guardian-attempts' }, strings.attempts(entry.attempts))
      : null,
    typeof entry.lastFailedAt === 'number' && Number.isFinite(entry.lastFailedAt)
      ? createElement('span', null, formatTime(entry.lastFailedAt))
      : null,
  )
}
/** Expandable error-detail toggle (chevron + label). */
function ErrorToggle({ expanded, onToggle }) {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-my-guardian-link',
      onClick: onToggle,
    },
    expanded ? icon.chevronDown(12) : icon.chevronRight(12),
    expanded ? strings.collapseError() : strings.expandError(),
  )
}
/** Inline remove confirmation (destructive, red). */
function RemoveConfirm({ busy, onConfirm, onCancel }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-confirm' },
    createElement(
      'div',
      { className: 'dsh-my-guardian-confirm-head' },
      icon.trash(15),
      createElement('div', { className: 'dsh-my-guardian-confirm-text' }, strings.removeConfirm()),
    ),
    createElement('div', { className: 'dsh-my-guardian-confirm-desc' }, strings.removeConfirmDesc()),
    createElement(
      'div',
      { className: 'dsh-my-guardian-confirm-actions' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guardian-confirm-ok',
          disabled: busy,
          onClick: onConfirm,
        },
        icon.trash(14),
        strings.confirmRemove(),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-guardian-confirm-cancel',
          disabled: busy,
          onClick: onCancel,
        },
        icon.close(14),
        strings.cancel(),
      ),
    ),
  )
}
/** Row actions: retry (refresh) + remove (trash) circular icon buttons. */
function RowActions({ entry, busy, onRetry, onRemove }) {
  return createElement(
    'div',
    { className: 'dsh-my-guardian-actions' },
    entry.status === 'failed' || entry.status === 'frozen'
      ? createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-success',
            'aria-label': strings.retry(),
            title: strings.retry(),
            disabled: busy,
            onClick: onRetry,
          },
          icon.refresh(15),
        )
      : null,
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guardian-iconbtn dsh-my-guardian-iconbtn-danger',
        'aria-label': strings.remove(),
        title: strings.remove(),
        disabled: busy,
        onClick: onRemove,
      },
      icon.trash(15),
    ),
  )
}
/** 冻结行提示（连败停止自动重试，需手动操作）。 */
function FrozenHint({ status }) {
  if (status !== 'frozen') return null
  return createElement('div', { className: 'dsh-my-guardian-freeze-hint' }, strings.frozenHint())
}
function EntryRow({ entry, source, onAction }) {
  // 失败/冻结行默认展开错误详情（用户之前必须手动点开才看得到真正报错）。
  const [expanded, setExpanded] = useState(
    () =>
      typeof entry.lastError === 'string' &&
      entry.lastError !== '' &&
      (entry.status === 'failed' || entry.status === 'frozen'),
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasError = typeof entry.lastError === 'string' && entry.lastError !== ''
  const isDepFailure = entry.failureType === 'dependency'
  const installHint =
    isDepFailure && typeof entry.installHint === 'string' && entry.installHint !== '' ? entry.installHint : null
  const run = (kind) => {
    setBusy(true)
    Promise.resolve(onAction(kind, entry)).finally(() => setBusy(false))
  }
  return createElement(
    'div',
    { className: 'dsh-my-guardian-row' },
    createElement(RowHead, { entry, source }),
    createElement(RowMeta, { entry }),
    createElement(FrozenHint, { status: entry.status }),
    installHint
      ? createElement(
          'div',
          { className: 'dsh-my-guardian-install-hint' },
          createElement('span', { className: 'dsh-my-guardian-install-hint-label' }, strings.installHint()),
          createElement('code', null, installHint),
        )
      : null,
    hasError ? createElement(ErrorToggle, { expanded, onToggle: () => setExpanded(!expanded) }) : null,
    expanded && hasError ? createElement('pre', { className: 'dsh-my-guardian-error-detail' }, entry.lastError) : null,
    confirming
      ? createElement(RemoveConfirm, {
          busy,
          onConfirm: () => {
            setConfirming(false)
            run('remove')
          },
          onCancel: () => setConfirming(false),
        })
      : null,
    createElement(RowActions, {
      entry,
      busy,
      onRetry: () => run('retry'),
      onRemove: () => setConfirming(true),
    }),
  )
}
