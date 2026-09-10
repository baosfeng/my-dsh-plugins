// ── 状态与反馈展示（loading / 空 / 错误 / 操作反馈）────────────────
/** busy 状态行（旋转刷新图标 + 次级色文案）。 */
function busyState(text: string): unknown {
  return createElement('div', { className: 'dsh-my-guard-state' }, icon.refresh(14), createElement('span', null, text))
}

/** 错误反馈行（错误色文案）。 */
function errorFeedback(text: string): unknown {
  return createElement('div', { className: 'dsh-my-guard-feedback dsh-my-guard-feedback-error' }, text)
}

/** 干净结果反馈行（绿色 check + 文案）。 */
function cleanFeedback(text: string): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-guard-feedback dsh-my-guard-feedback-ok' },
    icon.check(14),
    createElement('span', null, text),
  )
}

/** 已确认反馈（绿色 check + 文案）。 */
function confirmedBadge(): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-guard-alert-confirmed' },
    icon.check(13),
    createElement('span', null, strings.confirmed()),
  )
}

/** 发现项行（严重度徽章 + 消息 + 规则）。 */
function issueRow(issue: { severity: string; message: string }, index: number, rule: string): unknown {
  return createElement(
    'div',
    { key: index, className: `dsh-my-guard-issue dsh-my-guard-issue-${issue.severity}` },
    createElement('div', { className: 'dsh-my-guard-issue-sev' }, severityLabel(issue.severity)),
    createElement('div', { className: 'dsh-my-guard-issue-msg' }, issue.message),
    createElement('div', { className: 'dsh-my-guard-issue-rule' }, rule),
  )
}

/** 加载中状态（旋转刷新图标 + 次级色文案，不阻塞布局）。 */
function LoadingState(): unknown {
  return busyState(strings.loading())
}

/** 空状态（图标 + 主文案 + hint 两行结构）。 */
function EmptyState(): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-guard-empty' },
    createElement('span', { className: 'dsh-my-guard-empty-icon' }, icon.check(20)),
    createElement('span', null, strings.emptyAlerts()),
    createElement('span', { className: 'dsh-my-guard-empty-hint' }, strings.emptyAlertsHint()),
  )
}

/** 错误状态（错误色文案 + 重试按钮）。 */
function ErrorState({ message, onRetry }: GuardErrorStateProps): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-guard-error' },
    createElement('span', { className: 'dsh-my-guard-error-text' }, `${strings.loadError()}：${message}`),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-my-guard-iconbtn',
        'aria-label': strings.retry(),
        title: strings.retry(),
        onClick: onRetry,
      },
      icon.refresh(15),
    ),
  )
}
