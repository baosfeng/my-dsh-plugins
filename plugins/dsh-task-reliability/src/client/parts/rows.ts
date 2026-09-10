// ── 组件 ──────────────────────────────────────────────────────────────

/** 任务状态 → 徽标文案（未知状态按「进行中」渲染）。 */
function statusLabel(status?: string): string {
  switch (status) {
    case 'checking':
      return strings.statusChecking()
    case 'done':
      return strings.statusDone()
    case 'failed':
      return strings.statusFailed()
    case 'paused':
      return strings.statusPaused()
    default:
      return strings.statusActive()
  }
}

/** 任务状态 → 徽标样式类（未知状态按 active 渲染）。 */
function statusClass(status?: string): string {
  switch (status) {
    case 'checking':
      return 'dtr-badge-checking'
    case 'done':
      return 'dtr-badge-done'
    case 'failed':
      return 'dtr-badge-failed'
    case 'paused':
      return 'dtr-badge-paused'
    default:
      return 'dtr-badge-active'
  }
}

/** 模式开关行（任务列表页顶部三个开关，点击整行右侧 toggle 切换）。 */
function Switch({ label, hint, on, onChange }): ElementLike {
  return createElement(
    'div',
    { className: 'dtr-switch-row' },
    createElement(
      'div',
      { className: 'dtr-switch-info' },
      createElement('div', { className: 'dtr-switch-label' }, label),
      createElement('div', { className: 'dtr-switch-hint' }, hint),
    ),
    createElement('div', {
      className: 'dtr-toggle',
      'data-on': String(on),
      role: 'switch',
      'aria-checked': String(on),
      onClick: () => onChange(!on),
    }),
  )
}

/** 单条任务行：状态徽标 + 描述 + 元信息（模式/继续次数/校验次数）+ 操作按钮。 */
function TaskRow({ task, onAction }): ElementLike {
  const meta: string[] = []
  if (task.mode === 'verify') meta.push(strings.modeVerify())
  if (task.loopCount > 0) meta.push(strings.loops(task.loopCount))
  if (task.verifyCount > 0) meta.push(strings.verifies(task.verifyCount))
  return createElement(
    'div',
    { className: 'dtr-task' },
    createElement(
      'div',
      { className: 'dtr-task-head' },
      createElement('span', { className: `dtr-badge ${statusClass(task.status)}` }, statusLabel(task.status)),
    ),
    createElement('div', { className: 'dtr-desc' }, task.description),
    meta.length > 0 ? createElement('div', { className: 'dtr-task-meta' }, meta.join(' · ')) : null,
    createElement(
      'div',
      { className: 'dtr-actions' },
      task.status !== 'done'
        ? createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'done') }, strings.done())
        : null,
      task.status === 'active' || task.status === 'checking'
        ? createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'pause') }, strings.pause())
        : createElement(
            'button',
            { className: 'dtr-btn', onClick: () => onAction(task.id, 'resume') },
            strings.resume(),
          ),
      createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'delete') }, strings.delete()),
    ),
  )
}

/** 单条待确认问题：已回答显示答案文本，未回答显示输入框 + 回答按钮。 */
function QuestionRow({ question, onAnswer }): ElementLike {
  const [value, setValue] = useState('')
  if (question.answer !== undefined) {
    return createElement(
      'div',
      { className: 'dtr-question' },
      createElement('div', { className: 'dtr-question-text' }, question.question),
      createElement('div', { className: 'dtr-answered' }, `${strings.answer()}：${question.answer}`),
    )
  }
  return createElement(
    'div',
    { className: 'dtr-question' },
    createElement('div', { className: 'dtr-question-text' }, question.question),
    createElement('textarea', {
      className: 'dtr-textarea',
      value,
      placeholder: strings.answer(),
      onChange: (event) => setValue(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dtr-actions' },
      createElement(
        'button',
        {
          className: 'dtr-btn',
          onClick: () => {
            if (value.trim() !== '') {
              onAnswer(question.id, value.trim())
              setValue('')
            }
          },
        },
        strings.answer(),
      ),
    ),
  )
}

/** 注册任务表单：描述 + 模式（direct/verify）切换，提交后清空描述。 */
function RegisterForm({ onRegister }): ElementLike {
  const [desc, setDesc] = useState('')
  const [mode, setMode] = useState('direct')
  return createElement(
    'div',
    { className: 'dtr-section' },
    createElement('div', { className: 'dtr-section-title' }, strings.register()),
    createElement('textarea', {
      className: 'dtr-textarea',
      value: desc,
      placeholder: strings.descPlaceholder(),
      onChange: (event) => setDesc(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dtr-actions' },
      createElement(
        'button',
        {
          className: 'dtr-btn',
          onClick: () => {
            if (desc.trim() !== '') {
              onRegister(desc.trim(), mode)
              setDesc('')
            }
          },
        },
        strings.register(),
      ),
      createElement(
        'button',
        {
          className: 'dtr-btn',
          onClick: () => setMode(mode === 'verify' ? 'direct' : 'verify'),
        },
        mode === 'verify' ? strings.modeVerify() : strings.modeDirect(),
      ),
    ),
  )
}
