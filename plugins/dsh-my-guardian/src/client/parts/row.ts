// ── row ────────────────────────────────────────────────────────────────
/** Row head: source chip + name + status badge + failure-category badge. */
function RowHead({ entry, source }: { entry: GuardianEntry; source: EntrySource }) {
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
function RowMeta({ entry }: { entry: GuardianEntry }) {
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
function ErrorToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
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
function RemoveConfirm({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
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
function RowActions({
  entry,
  busy,
  onRetry,
  onRemove,
}: {
  entry: GuardianEntry
  busy: boolean
  onRetry: () => void
  onRemove: () => void
}) {
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

/** 依赖类失败（#410 分两类；'dependency' 是 pre-#410 的旧分类，含 mount 期 module 解析失败）。 */
function isDependencyFailure(type: unknown): boolean {
  return type === 'dependency' || type === 'dependency-missing' || type === 'dependency-mismatch'
}

/** 依赖失败行展示的安装命令；其他失败类型、空命令、宿主提供的包（无命令）都不展示（#410）。 */
function installCommandOf(entry: GuardianEntry): string | null {
  if (!isDependencyFailure(entry.failureType)) return null
  return typeof entry.installHint === 'string' && entry.installHint !== '' ? entry.installHint : null
}

/** 版本不满足明细行（#410）：声明范围 vs 实装版本；无明细时不渲染。 */
function MismatchHint({ entry }: { entry: GuardianEntry }) {
  const labels = mismatchLabels(entry)
  if (labels.length === 0) return null
  return createElement(
    'div',
    { className: 'dsh-my-guardian-mismatch' },
    createElement('span', { className: 'dsh-my-guardian-mismatch-label' }, strings.failureDependencyMismatch()),
    labels.map((label, index) => createElement('code', { key: index }, label)),
  )
}

/** 冻结行提示（连败停止自动重试，需手动操作）。 */
function FrozenHint({ status }: { status: string }) {
  if (status !== 'frozen') return null
  return createElement('div', { className: 'dsh-my-guardian-freeze-hint' }, strings.frozenHint())
}

function EntryRow({
  entry,
  source,
  onAction,
}: {
  entry: GuardianEntry
  source: EntrySource
  onAction: GuardianAction
}) {
  // 失败/冻结行默认展开错误详情（用户之前必须手动点开才看得到真正报错）。
  const [expanded, setExpanded] = useState<boolean>(
    () =>
      typeof entry.lastError === 'string' &&
      entry.lastError !== '' &&
      (entry.status === 'failed' || entry.status === 'frozen'),
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasError = typeof entry.lastError === 'string' && entry.lastError !== ''
  const installHint = installCommandOf(entry)

  const run = (kind: string) => {
    setBusy(true)
    Promise.resolve(onAction(kind, entry)).finally(() => setBusy(false))
  }

  return createElement(
    'div',
    { className: 'dsh-my-guardian-row' },
    createElement(RowHead, { entry, source }),
    createElement(RowMeta, { entry }),
    createElement(FrozenHint, { status: entry.status }),
    createElement(MismatchHint, { entry }),
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
