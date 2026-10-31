// ── components-diag：诊断台整页（异常条目 / 路径复制 / 返回 / 重新扫描）──

interface DiagnosticsPageProps {
  items: SkillItem[]
  scanTime: string
  onBack(): void
  onRescan(): void
  onCopyPath(item: SkillItem): void
}

/** 一条异常：名称 + 原因标签 + 路径（复制）+ 原因 + 建议。 */
function diagCard(item: SkillItem, onCopyPath: (item: SkillItem) => void): unknown {
  return createElement(
    'article',
    { key: item.key, className: 'dsh-my-skill-manager-diag-card' },
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-diag-card-head' },
      icon.alert(16),
      createElement(
        'div',
        {},
        createElement('h3', {}, item.name),
        createElement('p', {}, strings.reasonShort(item.reason)),
      ),
      badgeElement('dsh-my-skill-manager-badge-warn', strings.badgeScanIssue()),
    ),
    createElement(
      'dl',
      { className: 'dsh-my-skill-manager-diag-meta' },
      metaRow(
        strings.detailPath(),
        createElement('code', { className: 'dsh-my-skill-manager-meta-code' }, item.path),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-skill-manager-icon-btn dsh-my-skill-manager-icon-btn-sm',
            'aria-label': strings.copyPathAria(item.name),
            onClick: () => onCopyPath(item),
          },
          icon.copy(13),
        ),
      ),
      metaRow(strings.diagReason(), strings.reasonText(item.reason)),
      metaRow(strings.diagSuggestion(), strings.reasonSuggestion(item.reason)),
    ),
  )
}

/** 诊断台头部：返回 + 标题/计数 + 重新扫描。 */
function diagHead(props: DiagnosticsPageProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-diag-head' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-skill-manager-icon-btn',
        'aria-label': strings.diagBack(),
        onClick: () => props.onBack(),
      },
      glyph.back(16),
    ),
    createElement(
      'div',
      { className: 'dsh-my-skill-manager-diag-title' },
      createElement('h2', {}, strings.diagTitle()),
      createElement('p', {}, strings.diagSubtitle(props.items.length, props.scanTime)),
    ),
    createElement(
      'button',
      { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onRescan() },
      icon.refresh(13),
      strings.diagRescan(),
    ),
  )
}

/** 诊断台整页：头部 + 异常卡片（空则一行提示）+ 底部扫描范围说明。 */
function DiagnosticsPage(props: DiagnosticsPageProps): unknown {
  const body =
    props.items.length === 0
      ? createElement('div', { className: 'dsh-my-skill-manager-diag-empty' }, strings.diagEmpty())
      : props.items.map((item) => diagCard(item, props.onCopyPath))
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-diag' },
    diagHead(props),
    body,
    createElement('p', { className: 'dsh-my-skill-manager-diag-foot' }, strings.diagFoot()),
  )
}
