// ── components-detail：焦点详情（左信息列 + 右 SKILL.md 预览 / 使用统计）──

interface FocusDetailProps {
  id: string
  item: SkillItem
  detail: DetailEntry | undefined
  projectCtx: boolean
  handlers: SkillViewHandlers
}

function capElement(text: string): unknown {
  return createElement('span', { className: 'dsh-my-skill-manager-cap' }, text)
}

function metaRow(label: string, ...values: unknown[]): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-meta-row' },
    createElement('dt', {}, label),
    createElement('dd', {}, ...values),
  )
}

/** 调用能力标签：模型可调用 / 用户可调用；都没有则「不可调用」。 */
function detailCaps(item: SkillItem): unknown[] {
  const caps: unknown[] = []
  if (item.invocation !== null) {
    if (item.invocation.modelInvocable) caps.push(capElement(strings.capModel()))
    if (item.invocation.userInvocable) caps.push(capElement(strings.capUser()))
  }
  // 扫描发现的条目没有 invocation 字段：显示「—」表示未知，不臆断为不可调用。
  if (caps.length === 0) caps.push(capElement(strings.usageViaNone()))
  return caps
}

/** 作用域说明：异常行不可用；否则「全局 启用/关闭 · 本项目 启用/关闭」。 */
function detailScopeText(item: SkillItem, anomaly: boolean): string {
  if (anomaly) return strings.scopeUnavailable()
  return (
    strings.scopeGlobal() +
    ' ' +
    strings.scopeState(item.globalOn) +
    ' · ' +
    strings.scopeProject() +
    ' ' +
    strings.scopeState(item.projectOn)
  )
}

/** 来源说明：扫描失败 → 异常；目录发现 → 中性「目录发现」；否则「已收录」。 */
function detailSourceText(item: SkillItem, anomaly: boolean): string {
  if (anomaly) return strings.groupAnomaly() + ' · ' + strings.detailScanIssue()
  const origin = item.source === '' ? strings.groupOther() : sourceLabelOf(item.source)
  return origin + ' · ' + (item.cataloged ? strings.detailCollected() : strings.detailDiscovered())
}

/** 右列预览体：异常 → 原因块；加载中 / 失败 / 空 / 正文（前 15 行）。 */
function detailPreview(item: SkillItem, detail: DetailEntry | undefined, handlers: SkillViewHandlers): unknown {
  if (isAnomaly(item)) {
    return createElement(
      'div',
      { className: 'dsh-my-skill-manager-missing' },
      createElement('b', {}, strings.reasonShort(item.reason)),
      createElement('span', {}, strings.reasonText(item.reason)),
      createElement('code', {}, item.path === '' ? strings.usageViaNone() : item.path),
    )
  }
  if (detail === undefined || detail.status === 'loading') {
    return createElement(
      'div',
      { className: 'dsh-my-skill-manager-preview-state', role: 'status' },
      strings.previewLoading(),
    )
  }
  if (detail.status === 'error') {
    return createElement(
      'div',
      { className: 'dsh-my-skill-manager-preview-state dsh-my-skill-manager-preview-state-error', role: 'alert' },
      detail.message,
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-my-skill-manager-preview-retry',
          onClick: () => handlers.onRetryDetail(item),
        },
        icon.refresh(12),
        strings.retry(),
      ),
    )
  }
  if (detail.content.trim() === '') {
    return createElement('div', { className: 'dsh-my-skill-manager-preview-state' }, strings.previewEmpty())
  }
  return createElement('pre', { className: 'dsh-my-skill-manager-pre' }, firstLines(detail.content, 15))
}

/** 右列标题：SKILL.md / 前 15 行 + 复制全文（异常行没有可复制内容）。 */
function detailPreviewHead(item: SkillItem, anomaly: boolean, handlers: SkillViewHandlers): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-preview-head' },
    createElement('span', {}, strings.previewTitle()),
    createElement(
      'em',
      { className: 'dsh-my-skill-manager-preview-note' },
      anomaly ? strings.previewUnavailable() : strings.previewFirstLines(),
    ),
    anomaly
      ? null
      : createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-skill-manager-mini-btn',
            'aria-label': strings.copyMdAria(item.name),
            onClick: () => handlers.onCopyMd(item),
          },
          icon.copy(12),
          strings.copyFull(),
        ),
  )
}

/** 使用统计：次数 / 最近 / 调用方。 */
function detailStats(item: SkillItem): unknown {
  const recent = formatRecent(lastUsedOf(item))
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-usage-stats' },
    createElement('span', {}, createElement('b', {}, String(usageCountOf(item))), ' ' + strings.usageCallsUnit()),
    createElement('span', {}, strings.usageRecent(recent === '' ? strings.usageViaNone() : recent)),
    createElement('span', {}, strings.usageVia(item.usage === null ? '' : item.usage.lastSource)),
  )
}

/** 左列：描述 + 路径（复制）/ Provider / 调用能力 / 来源 / 作用域 / 异常原因与建议。 */
function detailLeft(item: SkillItem, anomaly: boolean, handlers: SkillViewHandlers): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-detail-col' },
    createElement('p', { className: 'dsh-my-skill-manager-detail-desc' }, item.description),
    createElement(
      'dl',
      { className: 'dsh-my-skill-manager-meta' },
      metaRow(
        strings.detailPath(),
        createElement(
          'code',
          { className: 'dsh-my-skill-manager-meta-code' },
          item.path === '' ? strings.usageViaNone() : item.path,
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-my-skill-manager-icon-btn dsh-my-skill-manager-icon-btn-sm',
            'aria-label': strings.copyPathAria(item.name),
            onClick: () => handlers.onCopyPath(item),
          },
          icon.copy(13),
        ),
      ),
      metaRow(strings.detailProvider(), item.provider === '' ? strings.usageViaNone() : item.provider),
      metaRow(strings.detailInvocation(), ...detailCaps(item)),
      metaRow(strings.detailSource(), detailSourceText(item, anomaly)),
      metaRow(strings.detailScopes(), detailScopeText(item, anomaly)),
      anomaly ? metaRow(strings.detailReason(), strings.reasonText(item.reason)) : null,
      anomaly ? metaRow(strings.detailSuggestion(), strings.reasonSuggestion(item.reason)) : null,
    ),
  )
}

/** 右列：预览标题 + 预览体 + 截断提示 + 使用统计。 */
function detailRight(
  item: SkillItem,
  anomaly: boolean,
  detail: DetailEntry | undefined,
  handlers: SkillViewHandlers,
): unknown {
  const truncated = detail !== undefined && detail.truncated
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-detail-col dsh-my-skill-manager-detail-col-right' },
    detailPreviewHead(item, anomaly, handlers),
    detailPreview(item, detail, handlers),
    truncated
      ? createElement('div', { className: 'dsh-my-skill-manager-preview-state' }, strings.truncatedNote())
      : null,
    detailStats(item),
  )
}

/** 焦点详情：两列网格（左信息 / 右预览 + 统计）。 */
function FocusDetail(props: FocusDetailProps): unknown {
  const anomaly = isAnomaly(props.item)
  return createElement(
    'div',
    { className: 'dsh-my-skill-manager-detail', id: props.id },
    detailLeft(props.item, anomaly, props.handlers),
    detailRight(props.item, anomaly, props.detail, props.handlers),
  )
}
