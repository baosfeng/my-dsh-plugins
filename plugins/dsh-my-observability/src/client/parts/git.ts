// ── Git 工具 + 增量 diff 审查面板 ──────────────────────────────────
const REPO_KEY = 'dsh-my-observability:repo'
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore']

function loadRepoKey(): string {
  try {
    const value = window.localStorage.getItem(REPO_KEY)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function saveRepoKey(repo: string): void {
  try {
    window.localStorage.setItem(REPO_KEY, repo)
  } catch {
    // storage is best-effort
  }
}

/** 状态条：分支 + 变更计数。 */
function StatusBar({ status }: { status: any }): unknown {
  if (status === null) return null
  const parts = [`${strings.branch()} ${status.branch}`]
  if (status.clean) parts.push(strings.clean())
  else {
    if (status.stagedCount > 0) parts.push(`${status.stagedCount} ${strings.staged()}`)
    if (status.unstagedCount > 0) parts.push(`${status.unstagedCount} ${strings.unstaged()}`)
  }
  return createElement('div', { className: 'dsh-my-observability-status' }, parts.join(' · '))
}

/** 差异文本预览。 */
function DiffView({ diff }: { diff: string }): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-section' },
    createElement('div', { className: 'dsh-my-observability-section-title' }, strings.diffTitle()),
    createElement('pre', { className: 'dsh-my-observability-diff' }, diff !== '' ? diff : strings.emptyDiff()),
  )
}

/** 严重级别 → 中文。 */
function severityText(severity: any): string {
  if (severity === 'error') return strings.severityError()
  if (severity === 'warning') return strings.severityWarning()
  return strings.severityInfo()
}

/** AI 结论文本（未启用/失败/成功三态，尽力而为）。 */
function aiTextOf(ai: any): string {
  if (ai === undefined || ai === null || !ai.enabled) return ''
  if (ai.failed) return `${strings.aiFailed()}（${ai.note ?? ''}）`
  return ai.verdict === 'approve' ? strings.aiVerdictApprove() : strings.aiVerdictChanges()
}

/** 审查报告：问题列表 + AI 结论。 */
function ReviewReport({ report }: { report: any }): unknown {
  if (report === null) return null
  const issues = report.issues || []
  const rows = issues.map((issue, index) =>
    createElement(
      'div',
      {
        key: index,
        className: `dsh-my-observability-issue dsh-my-observability-issue-${issue.severity}`,
      },
      createElement('span', { className: 'dsh-my-observability-issue-sev' }, severityText(issue.severity)),
      createElement(
        'span',
        { className: 'dsh-my-observability-issue-rule' },
        `${issue.rule}${issue.file !== '' ? ` ${issue.file}:${issue.line}` : ''}`,
      ),
      createElement('span', { className: 'dsh-my-observability-issue-msg' }, issue.message),
    ),
  )
  const aiText = aiTextOf(report.ai)
  return createElement(
    'div',
    { className: 'dsh-my-observability-section' },
    createElement('div', { className: 'dsh-my-observability-section-title' }, strings.reviewResult()),
    issues.length === 0
      ? createElement('div', { className: 'dsh-my-observability-review-ok' }, strings.reviewPass())
      : null,
    rows,
    aiText !== '' ? createElement('div', { className: 'dsh-my-observability-ai' }, aiText) : null,
  )
}

/** 提交表单字段（type/scope/description/body + 提交按钮）。 */
function CommitFields({
  form,
  update,
  busy,
  submit,
}: {
  form: any
  update: (key: string) => (e: any) => void
  busy: boolean
  submit: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-form' },
    createElement(
      'select',
      {
        className: 'dsh-my-observability-select dsh-my-observability-type',
        value: form.type,
        onChange: update('type'),
      },
      COMMIT_TYPES.map((type) => createElement('option', { key: type, value: type }, type)),
    ),
    createElement('input', {
      className: 'dsh-my-observability-input',
      placeholder: strings.commitScope(),
      value: form.scope,
      onChange: update('scope'),
    }),
    createElement('input', {
      className: 'dsh-my-observability-input',
      placeholder: strings.commitDesc(),
      value: form.description,
      onChange: update('description'),
    }),
    createElement('textarea', {
      className: 'dsh-my-observability-input dsh-my-observability-textarea',
      placeholder: strings.commitBody(),
      value: form.body,
      onChange: update('body'),
    }),
    createElement(
      'div',
      { className: 'dsh-my-observability-actions' },
      createElement(
        'button',
        {
          className: 'dsh-my-observability-btn dsh-my-observability-btn-primary',
          disabled: busy,
          onClick: submit,
        },
        strings.commit(),
      ),
    ),
  )
}

/** 类型化提交表单：type/scope/description/body → POST /git/commit。 */
function CommitForm({ repo, onCommitted }: { repo: string; onCommitted: () => void }): unknown {
  const [form, setForm] = useState({ type: 'feat', scope: '', description: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackKind, setFeedbackKind] = useState('ok')
  const update = (key: string) => (e: any) => setForm({ ...form, [key]: e.target.value })
  const submit = async () => {
    if (form.description.trim() === '') {
      setFeedback(strings.commitError())
      setFeedbackKind('error')
      return
    }
    setBusy(true)
    try {
      const value = await apiJson('/observability/api/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath: repo, ...form }),
      })
      setFeedback(`${strings.committed()}：${value.hash} ${value.message}`)
      setFeedbackKind('ok')
      setForm({ ...form, scope: '', description: '', body: '' })
      onCommitted()
    } catch (err) {
      setFeedback(`${strings.commitError()}：${err instanceof Error ? err.message : String(err)}`)
      setFeedbackKind('error')
    } finally {
      setBusy(false)
    }
  }
  return createElement(
    'div',
    { className: 'dsh-my-observability-section' },
    createElement('div', { className: 'dsh-my-observability-section-title' }, strings.commitTitle()),
    createElement(CommitFields, { form, update, busy, submit }),
    feedback !== ''
      ? createElement(
          'div',
          { className: `dsh-my-observability-feedback dsh-my-observability-feedback-${feedbackKind}` },
          feedback,
        )
      : null,
  )
}

/** 仓库路径行：输入 + 加载按钮。 */
function RepoRow({
  repo,
  onRepoChange,
  onLoad,
}: {
  repo: string
  onRepoChange: (value: string) => void
  onLoad: () => void
}): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-repo-row' },
    createElement('input', {
      className: 'dsh-my-observability-input dsh-my-observability-repo-input',
      placeholder: strings.repoPlaceholder(),
      value: repo,
      onChange: (e) => onRepoChange(e.target.value),
    }),
    createElement('button', { className: 'dsh-my-observability-btn', onClick: onLoad }, strings.loadRepo()),
  )
}

/** 操作按钮组：diff / staged diff / 审查。 */
function GitActions({ onDiff, onReview }: { onDiff: (staged: boolean) => void; onReview: () => void }): unknown {
  return createElement(
    'div',
    { className: 'dsh-my-observability-actions' },
    createElement(
      'button',
      { className: 'dsh-my-observability-btn', onClick: () => onDiff(false) },
      strings.showDiff(),
    ),
    createElement(
      'button',
      { className: 'dsh-my-observability-btn', onClick: () => onDiff(true) },
      strings.showStagedDiff(),
    ),
    createElement(
      'button',
      { className: 'dsh-my-observability-btn dsh-my-observability-btn-primary', onClick: onReview },
      strings.review(),
    ),
  )
}

/** 拉取仓库状态（错误写入 setError）。 */
async function fetchStatus(
  path: string,
  setStatus: (value: any) => void,
  setError: (value: string) => void,
): Promise<void> {
  if (path === '') return
  try {
    setStatus(await apiJson(`/observability/api/git/status?repo=${encodeURIComponent(path)}`))
    setError('')
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}

/** 拉取差异文本（staged 切换；错误写入 setError）。 */
async function fetchDiff(
  path: string,
  staged: boolean,
  setDiff: (value: string) => void,
  setError: (value: string) => void,
): Promise<void> {
  if (path === '') return
  try {
    const value = await apiJson(`/observability/api/git/diff?repo=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`)
    setDiff(value.text)
    setError('')
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}

/** 运行提交前审查（错误写入 setError）。 */
async function runReview(
  path: string,
  setReport: (value: any) => void,
  setError: (value: string) => void,
): Promise<void> {
  if (path === '') return
  try {
    setReport(
      await apiJson('/observability/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath: path }),
      }),
    )
    setError('')
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}

/** Git 面板主组件：仓库状态 / diff / 审查 / 类型化提交。 */
function GitPanel(): unknown {
  const [repo, setRepo] = useState(loadRepoKey)
  const [status, setStatus] = useState(null)
  const [diff, setDiff] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  const onCommitted = async () => {
    setDiff('')
    setReport(null)
    await fetchStatus(repo, setStatus, setError)
  }

  return createElement(
    'div',
    { className: 'dsh-my-observability-panel' },
    createElement(RepoRow, {
      repo,
      onRepoChange: (value) => {
        setRepo(value)
        saveRepoKey(value)
      },
      onLoad: () => fetchStatus(repo, setStatus, setError),
    }),
    error !== '' ? createElement('div', { className: 'dsh-my-observability-empty' }, error) : null,
    createElement(StatusBar, { status }),
    createElement(GitActions, {
      onDiff: (staged) => fetchDiff(repo, staged, setDiff, setError),
      onReview: () => runReview(repo, setReport, setError),
    }),
    createElement(DiffView, { diff }),
    createElement(ReviewReport, { report }),
    createElement(CommitForm, { repo, onCommitted }),
  )
}
