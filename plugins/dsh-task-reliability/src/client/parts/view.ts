// ── 任务列表页视图 ────────────────────────────────────────────────────

/**
 * 侧边栏「任务可靠性」页签视图。
 *
 * 每 6s 轮询 server 端注册表（info / tasks / questions 三个 GET），模式开关与
 * 任务操作走对应的 POST，post 后再 load() 立即刷新（不等下一个轮询周期）。
 * visible === false（页签未显示）时不轮询，避免隐藏页签空转。
 */
function Panel({ scope, visible }): ElementLike {
  const sessionId = scope?.sessionId ?? ''
  const [info, setInfo] = useState<ModeInfo>({ tracking: false, verify: false, autopilot: false })
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [questions, setQuestions] = useState<QuestionRecord[]>([])
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    try {
      const infoRes = await apiFetch('/task-reliability/api/info')
      const tasksRes = await apiFetch('/task-reliability/api/tasks')
      const qRes = await apiFetch('/task-reliability/api/questions')
      if (infoRes.body?.ok) setInfo(infoRes.body.value as ModeInfo)
      if (tasksRes.body?.ok) setTasks(tasksRes.body.value as TaskRecord[])
      if (qRes.body?.ok) setQuestions(qRes.body.value as QuestionRecord[])
      setLoadError('')
    } catch {
      setLoadError(strings.loadError())
    }
  }

  useEffect(() => {
    if (visible === false) return undefined
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [visible])

  const setMode = async (patch: Partial<ModeInfo>) => {
    await post('/task-reliability/api/mode', patch)
    void load()
  }

  const taskAction = async (id: string, action: string) => {
    await post(`/task-reliability/api/tasks/${id}/${action}`, {})
    void load()
  }

  const answerQuestion = async (id: string, answer: string) => {
    await post(`/task-reliability/api/questions/${id}/answer`, { answer })
    void load()
  }

  const register = async (description: string, mode: string) => {
    await post('/task-reliability/api/tasks', { sessionId, description, mode })
    void load()
  }

  return createElement(
    'div',
    { className: 'dtr-panel' },
    loadError !== '' ? createElement('div', { className: 'dtr-empty' }, loadError) : null,
    createElement(
      'div',
      { className: 'dtr-section' },
      createElement(Switch, {
        label: strings.tracking(),
        hint: strings.trackingHint(),
        on: info.tracking === true,
        onChange: (value) => setMode({ tracking: value }),
      }),
      createElement(Switch, {
        label: strings.verify(),
        hint: strings.verifyHint(),
        on: info.verify === true,
        onChange: (value) => setMode({ verify: value }),
      }),
      createElement(Switch, {
        label: strings.autopilot(),
        hint: strings.autopilotHint(),
        on: info.autopilot === true,
        onChange: (value) => setMode({ autopilot: value }),
      }),
    ),
    createElement(RegisterForm, { onRegister: register }),
    createElement(
      'div',
      { className: 'dtr-section' },
      createElement('div', { className: 'dtr-section-title' }, strings.tasks()),
      tasks.length === 0
        ? createElement('div', { className: 'dtr-empty' }, strings.noTasks())
        : tasks.map((task) => createElement(TaskRow, { key: task.id, task, onAction: taskAction })),
    ),
    createElement(
      'div',
      { className: 'dtr-section' },
      createElement('div', { className: 'dtr-section-title' }, strings.questions()),
      questions.filter((q) => q.answer === undefined).length === 0
        ? createElement('div', { className: 'dtr-empty' }, strings.noQuestions())
        : questions
            .filter((q) => q.answer === undefined)
            .map((q) => createElement(QuestionRow, { key: q.id, question: q, onAnswer: answerQuestion })),
    ),
  )
}
