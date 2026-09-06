/**
 * dsh-task-reliability — client half (browser).
 *
 * 侧边栏「任务可靠性」页签：
 *  - 三个模式开关：可靠性跟踪（自动跟踪 goal 任务）、完成度校验（任务默认
 *    校验模式）、自主决策（出行模式：拦截 ask 自动决策 + 自动批准）；
 *  - 活动任务列表：状态徽标 / 描述 / 循环次数 / 校验次数，操作：标记完成、
 *    暂停、恢复、删除（全部走 /task-reliability/api/* HTTP API）；
 *  - 待确认问题列表：自主决策模式拦截下的 ask 问题，可远程/本地回答；
 *  - 注册任务：以当前会话 id 预填，可改会话、描述、模式。
 *
 * 数据源：server 端持久化注册表（/task-reliability/api/*），页签每 6s 轮询。
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation 注入、
 * fiber teardown 卸载。
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-reliability',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    const TAB_ID = 'task-reliability:panel'
    const POLL_MS = 6000

    // ── i18n ──────────────────────────────────────────────────────────────
    function isZh() {
      try {
        const lang = (navigator.language || 'en').toLowerCase()
        return lang.startsWith('zh')
      } catch {
        return false
      }
    }

    const strings = {
      title: () => (isZh() ? '任务可靠性' : 'Task Reliability'),
      tracking: () => (isZh() ? '可靠性跟踪' : 'Reliability tracking'),
      verify: () => (isZh() ? '完成度校验' : 'Completion verify'),
      autopilot: () => (isZh() ? '自主决策' : 'Autopilot'),
      trackingHint: () => (isZh() ? '自动跟踪带目标的会话（goal），任务未完成自动继续' : 'Auto-track goal sessions; unfinished tasks auto-continue'),
      verifyHint: () => (isZh() ? '任务结束后用独立校验 agent 判断完成度，未完成自动继续' : 'Verify completion with a separate agent; continue when unfinished'),
      autopilotHint: () => (isZh() ? '出行模式：拦截询问自动决策，问题记录待确认' : 'Travel mode: intercept asks, decide autonomously, collect questions'),
      tasks: () => (isZh() ? '活动任务' : 'Active tasks'),
      questions: () => (isZh() ? '待确认问题' : 'Pending questions'),
      noTasks: () => (isZh() ? '暂无任务' : 'No tasks'),
      noQuestions: () => (isZh() ? '暂无待确认问题' : 'No pending questions'),
      register: () => (isZh() ? '注册任务' : 'Register task'),
      done: () => (isZh() ? '完成' : 'Done'),
      pause: () => (isZh() ? '暂停' : 'Pause'),
      resume: () => (isZh() ? '恢复' : 'Resume'),
      delete: () => (isZh() ? '删除' : 'Delete'),
      answer: () => (isZh() ? '回答' : 'Answer'),
      statusActive: () => (isZh() ? '进行中' : 'Active'),
      statusChecking: () => (isZh() ? '校验中' : 'Verifying'),
      statusDone: () => (isZh() ? '已完成' : 'Done'),
      statusFailed: () => (isZh() ? '失败' : 'Failed'),
      statusPaused: () => (isZh() ? '已暂停' : 'Paused'),
      modeDirect: () => (isZh() ? '直接继续' : 'Direct'),
      modeVerify: () => (isZh() ? '校验' : 'Verify'),
      desc: () => (isZh() ? '任务描述' : 'Description'),
      descPlaceholder: () => (isZh() ? '例如：开发一个功能并测试通过' : 'e.g. Build a feature and pass tests'),
      loops: (n) => (isZh() ? `继续 ${n} 次` : `${n} continues`),
      verifies: (n) => (isZh() ? `校验 ${n} 次` : `${n} verifies`),
      loadError: () => (isZh() ? '加载失败' : 'Load failed'),
      autoSession: () => (isZh() ? '当前会话' : 'Current session'),
      // 设置页（issue #27 配置可视化）
      settingsTitle: () => (isZh() ? '任务可靠性' : 'Task Reliability'),
      settingsRetry: () => (isZh() ? '超时重试' : 'Retry'),
      settingsRetryMax: () => (isZh() ? '最大重试次数' : 'Max retries'),
      settingsRetryMaxHint: () => (isZh() ? '超时/瞬态错误自动重试上限' : 'Cap for auto-retry on timeout/transient errors'),
      settingsRetryBaseMs: () => (isZh() ? '重试退避基数（毫秒）' : 'Retry backoff base (ms)'),
      settingsRetryBaseMsHint: () => (isZh() ? '指数退避：base × 2^n' : 'Exponential backoff: base × 2^n'),
      settingsRetryableCodes: () => (isZh() ? '可重试错误码' : 'Retryable codes'),
      settingsRetryableCodesHint: () => (isZh() ? '逗号分隔的错误码列表' : 'Comma-separated error codes'),
      settingsLoop: () => (isZh() ? '自动继续' : 'Auto-continue'),
      settingsMaxLoop: () => (isZh() ? '每任务继续上限' : 'Max continues per task'),
      settingsMaxLoopHint: () => (isZh() ? '任务未完成自动继续的次数上限' : 'Cap for auto-continue of unfinished tasks'),
      settingsMaxVerify: () => (isZh() ? '校验次数上限' : 'Max verifies'),
      settingsMaxVerifyHint: () => (isZh() ? '完成度校验 agent 的校验次数上限' : 'Cap for completion-verification runs'),
      settingsSteerCooldownMs: () => (isZh() ? '继续冷却（毫秒）' : 'Continue cooldown (ms)'),
      settingsSteerCooldownMsHint: () => (isZh() ? '两次自动继续之间的最小间隔' : 'Min interval between auto-continues'),
      settingsAskTimeoutMs: () => (isZh() ? 'ask 超时（毫秒）' : 'Ask timeout (ms)'),
      settingsAskTimeoutMsHint: () => (isZh() ? '询问用户超时后自动继续，问题记录待确认（0 = 禁用）' : 'Auto-continue after ask timeout, question queued (0 = disabled)'),
      settingsAutopilotGraceMs: () => (isZh() ? '自主决策缓冲（毫秒）' : 'Autopilot grace (ms)'),
      settingsAutopilotGraceMsHint: () => (isZh() ? '自主决策模式下 ask 先展示给用户，缓冲超时后才自动决策（0 = 立即拦截）' : 'Autopilot shows asks first; auto-decide after grace (0 = intercept immediately)'),
      settingsWatchdog: () => (isZh() ? '停滞看门狗' : 'Stall watchdog'),
      settingsWatchdogIntervalMs: () => (isZh() ? '看门狗检查间隔（毫秒）' : 'Watchdog interval (ms)'),
      settingsWatchdogIntervalMsHint: () => (isZh() ? '定期检查活动任务是否停滞（0 = 禁用）' : 'Periodic stall check (0 = disabled)'),
      settingsStallTimeoutMs: () => (isZh() ? '停滞判定阈值（毫秒）' : 'Stall threshold (ms)'),
      settingsStallTimeoutMsHint: () => (isZh() ? '任务超过该时长无进展则自动唤醒' : 'Wake tasks idle longer than this'),
      settingsPersist: () => (isZh() ? '持久化与速率' : 'Persistence & rate'),
      settingsSaveDebounceMs: () => (isZh() ? '落盘防抖（毫秒）' : 'Save debounce (ms)'),
      settingsSaveDebounceMsHint: () => (isZh() ? '任务状态写入磁盘的防抖窗口' : 'Debounce window for state writes'),
      settingsResumeGraceMs: () => (isZh() ? '恢复宽限（毫秒）' : 'Resume grace (ms)'),
      settingsResumeGraceMsHint: () => (isZh() ? '启动后延迟恢复任务的时间' : 'Delay before resuming tasks on boot'),
      settingsRateMaxActions: () => (isZh() ? '每分钟动作上限' : 'Max actions/min'),
      settingsRateMaxActionsHint: () => (isZh() ? '自动继续的全局速率限制' : 'Global rate limit for auto-continues'),
      settingsAutopilot: () => (isZh() ? '自主决策（默认开启）' : 'Autopilot (default on)'),
      settingsAutopilotHint: () => (isZh() ? '新会话默认进入自主决策模式' : 'New sessions default to autopilot mode'),
      settingsSecurity: () => (isZh() ? '安全' : 'Security'),
      settingsApiToken: () => (isZh() ? '远程触发 Token' : 'Remote trigger token'),
      settingsApiTokenHint: () => (isZh() ? '配置后远程触发需携带 x-task-reliability-token 头' : 'Remote triggers must send x-task-reliability-token when set'),
      settingsRescue: () => (isZh() ? '截断救场' : 'Truncation rescue'),
      settingsRescueOnTruncation: () => (isZh() ? '输出截断自动补完' : 'Auto-complete truncated output'),
      settingsRescueOnTruncationHint: () => (isZh() ? '回合因输出上限/异常中断且输出不完整时，自动注入继续指令补完（普通对话同样生效）' : 'Auto-inject a continue prompt when a turn ends truncated/errored with incomplete output (plain chats too)'),
      settingsRescueMaxPerSession: () => (isZh() ? '每会话救场上限' : 'Max rescues per session'),
      settingsRescueMaxPerSessionHint: () => (isZh() ? '每会话自动补完次数上限，防无限循环' : 'Cap of auto-completes per session (anti-loop)'),
      settingsRescueCooldownMs: () => (isZh() ? '救场冷却（毫秒）' : 'Rescue cooldown (ms)'),
      settingsRescueCooldownMsHint: () => (isZh() ? '两次自动补完之间的最小间隔' : 'Min interval between auto-completes'),
      save: () => (isZh() ? '保存' : 'Save'),
      saved: () => (isZh() ? '已保存' : 'Saved'),
      saveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
      loading: () => (isZh() ? '加载中…' : 'Loading…'),
      loadError: () => (isZh() ? '加载失败' : 'Load failed'),
    }

    // ── API helpers ───────────────────────────────────────────────────────
    async function apiFetch(path, options) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      const text = await response.text()
      try {
        return { status: response.status, body: JSON.parse(text || 'null') }
      } catch {
        return { status: response.status, body: null }
      }
    }

    function post(path, payload) {
      return apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
    }

    // ── 样式（DSH 语义 token，随 activation 注入）───────────────────────
    const STYLES = `
.dtr-panel{display:flex;flex-direction:column;gap:12px;padding:12px;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}
.dtr-section{display:flex;flex-direction:column;gap:8px}
.dtr-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dtr-switch-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dtr-switch-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-switch-label{font:var(--dsw-font-xs-strong-13)}
.dtr-switch-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
/* issue #58: toggle 开关开/关一眼可分——关态灰色轨道（tertiary 混合，
   不再白底融入面板背景），开态圆点换对比墨色；与 dsh-my-notify / 
   dsh-my-skill-manager 的开关方案一致。开启色用 success-primary（绿色）：
   --dsw-alias-state-info-primary 在 DSH 主题中未定义（dsh-client-ui-theme
   仅定义 business/error/success/warn），var() 无效会渲染为透明（PR #63 实测） */
.dtr-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background 120ms var(--ds-ease-in-out),border-color 120ms var(--ds-ease-in-out)}
.dtr-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dtr-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform 120ms var(--ds-ease-in-out),background 120ms var(--ds-ease-in-out)}
.dtr-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dtr-task{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.dtr-task-head{display:flex;align-items:center;gap:6px;min-width:0}
.dtr-badge{flex:none;font:var(--dsw-font-xxxs-strong-11);border-radius:4px;padding:1px 6px}
.dtr-badge-active{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)}
.dtr-badge-checking{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}
.dtr-badge-done{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}
.dtr-badge-failed{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)}
.dtr-badge-paused{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent)}
.dtr-task-desc,.dtr-desc{font:var(--dsw-font-xxs-12);line-height:1.5;word-break:break-word;color:var(--dsw-alias-label-primary)}
.dtr-task-meta{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dtr-actions{display:flex;gap:6px;flex-wrap:wrap}
.dtr-btn{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;cursor:pointer}
.dtr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dtr-question{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-2)}
.dtr-question-text{font:var(--dsw-font-xxs-12);line-height:1.5}
.dtr-input{font:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;width:100%;box-sizing:border-box}
.dtr-textarea{resize:vertical;min-height:44px;font:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;width:100%;box-sizing:border-box}
.dtr-empty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:8px 0}
.dtr-answered{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
`

    // ── 组件 ──────────────────────────────────────────────────────────────
    function statusLabel(status) {
      switch (status) {
        case 'checking': return strings.statusChecking()
        case 'done': return strings.statusDone()
        case 'failed': return strings.statusFailed()
        case 'paused': return strings.statusPaused()
        default: return strings.statusActive()
      }
    }

    function statusClass(status) {
      switch (status) {
        case 'checking': return 'dtr-badge-checking'
        case 'done': return 'dtr-badge-done'
        case 'failed': return 'dtr-badge-failed'
        case 'paused': return 'dtr-badge-paused'
        default: return 'dtr-badge-active'
      }
    }

    function Switch({ label, hint, on, onChange }) {
      return createElement('div', { className: 'dtr-switch-row' },
        createElement('div', { className: 'dtr-switch-info' },
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

    function TaskRow({ task, onAction }) {
      const meta = []
      if (task.mode === 'verify') meta.push(strings.modeVerify())
      if (task.loopCount > 0) meta.push(strings.loops(task.loopCount))
      if (task.verifyCount > 0) meta.push(strings.verifies(task.verifyCount))
      return createElement('div', { className: 'dtr-task' },
        createElement('div', { className: 'dtr-task-head' },
          createElement('span', { className: `dtr-badge ${statusClass(task.status)}` }, statusLabel(task.status)),
        ),
        createElement('div', { className: 'dtr-desc' }, task.description),
        meta.length > 0 ? createElement('div', { className: 'dtr-task-meta' }, meta.join(' · ')) : null,
        createElement('div', { className: 'dtr-actions' },
          task.status !== 'done' ? createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'done') }, strings.done()) : null,
          task.status === 'active' || task.status === 'checking'
            ? createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'pause') }, strings.pause())
            : createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'resume') }, strings.resume()),
          createElement('button', { className: 'dtr-btn', onClick: () => onAction(task.id, 'delete') }, strings.delete()),
        ),
      )
    }

    function QuestionRow({ question, onAnswer }) {
      const [value, setValue] = useState('')
      if (question.answer !== undefined) {
        return createElement('div', { className: 'dtr-question' },
          createElement('div', { className: 'dtr-question-text' }, question.question),
          createElement('div', { className: 'dtr-answered' }, `${strings.answer()}：${question.answer}`),
        )
      }
      return createElement('div', { className: 'dtr-question' },
        createElement('div', { className: 'dtr-question-text' }, question.question),
        createElement('textarea', {
          className: 'dtr-textarea',
          value,
          placeholder: strings.answer(),
          onChange: (event) => setValue(event.target.value),
        }),
        createElement('div', { className: 'dtr-actions' },
          createElement('button', {
            className: 'dtr-btn',
            onClick: () => {
              if (value.trim() !== '') {
                onAnswer(question.id, value.trim())
                setValue('')
              }
            },
          }, strings.answer()),
        ),
      )
    }

    function RegisterForm({ onRegister }) {
      const [desc, setDesc] = useState('')
      const [mode, setMode] = useState('direct')
      return createElement('div', { className: 'dtr-section' },
        createElement('div', { className: 'dtr-section-title' }, strings.register()),
        createElement('textarea', {
          className: 'dtr-textarea',
          value: desc,
          placeholder: strings.descPlaceholder(),
          onChange: (event) => setDesc(event.target.value),
        }),
        createElement('div', { className: 'dtr-actions' },
          createElement('button', {
            className: 'dtr-btn',
            onClick: () => {
              if (desc.trim() !== '') {
                onRegister(desc.trim(), mode)
                setDesc('')
              }
            },
          }, strings.register()),
          createElement('button', {
            className: 'dtr-btn',
            onClick: () => setMode(mode === 'verify' ? 'direct' : 'verify'),
          }, mode === 'verify' ? strings.modeVerify() : strings.modeDirect()),
        ),
      )
    }

    function Panel({ scope, visible }) {
      const sessionId = scope?.sessionId ?? ''
      const [info, setInfo] = useState({ tracking: false, verify: false, autopilot: false })
      const [tasks, setTasks] = useState([])
      const [questions, setQuestions] = useState([])
      const [loadError, setLoadError] = useState('')

      const load = async () => {
        try {
          const infoRes = await apiFetch('/task-reliability/api/info')
          const tasksRes = await apiFetch('/task-reliability/api/tasks')
          const qRes = await apiFetch('/task-reliability/api/questions')
          if (infoRes.body?.ok) setInfo(infoRes.body.value)
          if (tasksRes.body?.ok) setTasks(tasksRes.body.value)
          if (qRes.body?.ok) setQuestions(qRes.body.value)
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

      const setMode = async (patch) => {
        await post('/task-reliability/api/mode', patch)
        void load()
      }

      const taskAction = async (id, action) => {
        await post(`/task-reliability/api/tasks/${id}/${action}`, {})
        void load()
      }

      const answerQuestion = async (id, answer) => {
        await post(`/task-reliability/api/questions/${id}/answer`, { answer })
        void load()
      }

      const register = async (description, mode) => {
        await post('/task-reliability/api/tasks', { sessionId, description, mode })
        void load()
      }

      return createElement('div', { className: 'dtr-panel' },
        loadError !== '' ? createElement('div', { className: 'dtr-empty' }, loadError) : null,
        createElement('div', { className: 'dtr-section' },
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
        createElement('div', { className: 'dtr-section' },
          createElement('div', { className: 'dtr-section-title' }, strings.tasks()),
          tasks.length === 0
            ? createElement('div', { className: 'dtr-empty' }, strings.noTasks())
            : tasks.map((task) => createElement(TaskRow, { key: task.id, task, onAction: taskAction })),
        ),
        createElement('div', { className: 'dtr-section' },
          createElement('div', { className: 'dtr-section-title' }, strings.questions()),
          questions.filter((q) => q.answer === undefined).length === 0
            ? createElement('div', { className: 'dtr-empty' }, strings.noQuestions())
            : questions
                .filter((q) => q.answer === undefined)
                .map((q) => createElement(QuestionRow, { key: q.id, question: q, onAnswer: answerQuestion })),
        ),
      )
    }

    // ── 设置页视图（issue #27 配置可视化，官方 slots 扩展点）────────────
    const SETTINGS_STYLES = `
.dtr-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dtr-settings-section{display:flex;flex-direction:column;gap:8px}
.dtr-settings-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dtr-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dtr-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dtr-settings-label{font:var(--dsw-font-xs-strong-13)}
.dtr-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dtr-settings-input{flex:none;width:180px;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dtr-settings-actions{display:flex;align-items:center;gap:8px}
.dtr-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dtr-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
.dtr-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
`

    function SettingsSwitchRow({ label, hint, on, onChange }) {
      return createElement('div', { className: 'dtr-settings-row' },
        createElement('div', { className: 'dtr-settings-info' },
          createElement('div', { className: 'dtr-settings-label' }, label),
          createElement('div', { className: 'dtr-settings-hint' }, hint),
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

    function SettingsTextRow({ label, hint, value, onChange, type }) {
      return createElement('div', { className: 'dtr-settings-row' },
        createElement('div', { className: 'dtr-settings-info' },
          createElement('div', { className: 'dtr-settings-label' }, label),
          createElement('div', { className: 'dtr-settings-hint' }, hint),
        ),
        createElement('input', {
          className: 'dtr-settings-input',
          type: type ?? 'text',
          value,
          onChange: (event) => onChange(event.target.value),
        }),
      )
    }

    /** 设置页表单字段数据（label/hint/key/fallback/类型），驱动渲染。 */
    const SETTINGS_SECTIONS = [
      {
        title: () => strings.settingsRetry(),
        rows: [
          { label: () => strings.settingsRetryMax(), hint: () => strings.settingsRetryMaxHint(), key: 'retryMax', fallback: 3, numeric: true },
          { label: () => strings.settingsRetryBaseMs(), hint: () => strings.settingsRetryBaseMsHint(), key: 'retryBaseMs', fallback: 1000, numeric: true },
          { label: () => strings.settingsRetryableCodes(), hint: () => strings.settingsRetryableCodesHint(), key: 'retryableCodesText', fallback: '' },
        ],
      },
      {
        title: () => strings.settingsLoop(),
        rows: [
          { label: () => strings.settingsMaxLoop(), hint: () => strings.settingsMaxLoopHint(), key: 'maxLoop', fallback: 8, numeric: true },
          { label: () => strings.settingsMaxVerify(), hint: () => strings.settingsMaxVerifyHint(), key: 'maxVerify', fallback: 3, numeric: true },
          { label: () => strings.settingsSteerCooldownMs(), hint: () => strings.settingsSteerCooldownMsHint(), key: 'steerCooldownMs', fallback: 8000, numeric: true },
          { label: () => strings.settingsAskTimeoutMs(), hint: () => strings.settingsAskTimeoutMsHint(), key: 'askTimeoutMs', fallback: 1800000, numeric: true },
        ],
      },
      {
        title: () => strings.settingsPersist(),
        rows: [
          { label: () => strings.settingsSaveDebounceMs(), hint: () => strings.settingsSaveDebounceMsHint(), key: 'saveDebounceMs', fallback: 500, numeric: true },
          { label: () => strings.settingsResumeGraceMs(), hint: () => strings.settingsResumeGraceMsHint(), key: 'resumeGraceMs', fallback: 2000, numeric: true },
          { label: () => strings.settingsRateMaxActions(), hint: () => strings.settingsRateMaxActionsHint(), key: 'rateMaxActions', fallback: 12, numeric: true },
        ],
      },
      {
        title: () => strings.settingsWatchdog(),
        rows: [
          { label: () => strings.settingsWatchdogIntervalMs(), hint: () => strings.settingsWatchdogIntervalMsHint(), key: 'watchdogIntervalMs', fallback: 300000, numeric: true },
          { label: () => strings.settingsStallTimeoutMs(), hint: () => strings.settingsStallTimeoutMsHint(), key: 'stallTimeoutMs', fallback: 600000, numeric: true },
        ],
      },
      {
        title: () => strings.settingsSecurity(),
        rows: [
          { label: () => strings.settingsAutopilot(), hint: () => strings.settingsAutopilotHint(), key: 'autopilot', fallback: false, switch: true },
          { label: () => strings.settingsAutopilotGraceMs(), hint: () => strings.settingsAutopilotGraceMsHint(), key: 'autopilotGraceMs', fallback: 20000, numeric: true },
          { label: () => strings.settingsApiToken(), hint: () => strings.settingsApiTokenHint(), key: 'apiToken', fallback: '' },
        ],
      },
      {
        title: () => strings.settingsRescue(),
        rows: [
          { label: () => strings.settingsRescueOnTruncation(), hint: () => strings.settingsRescueOnTruncationHint(), key: 'rescueOnTruncation', fallback: true, switch: true },
          { label: () => strings.settingsRescueMaxPerSession(), hint: () => strings.settingsRescueMaxPerSessionHint(), key: 'rescueMaxPerSession', fallback: 2, numeric: true },
          { label: () => strings.settingsRescueCooldownMs(), hint: () => strings.settingsRescueCooldownMsHint(), key: 'rescueCooldownMs', fallback: 30000, numeric: true },
        ],
      },
    ]

    /** 渲染单个设置行（switch 或 text/number 输入）。 */
    function settingsRow(row, draft, patch, num) {
      if (row.switch === true) {
        return createElement(SettingsSwitchRow, {
          label: row.label(),
          hint: row.hint(),
          on: draft[row.key] === true,
          onChange: (v) => patch(row.key, v),
        })
      }
      return createElement(SettingsTextRow, {
        label: row.label(),
        hint: row.hint(),
        value: String(draft[row.key] ?? row.fallback),
        type: row.numeric === true ? 'number' : 'text',
        onChange: row.numeric === true ? num(row.key) : (v) => patch(row.key, v),
      })
    }

    /** 渲染设置分组（标题 + 字段行）。 */
    function settingsSection(section, draft, patch, num) {
      return createElement('div', { className: 'dtr-settings-section' },
        createElement('div', { className: 'dtr-settings-title' }, section.title()),
        ...section.rows.map((row) => settingsRow(row, draft, patch, num)),
      )
    }

    /** 设置页主视图：加载当前配置 → 表单编辑 → 保存（PUT /task-reliability/api/config）。 */
    function TaskReliabilitySettingsView() {
      const [config, setConfig] = useState(null)
      const [draft, setDraft] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(false)
      const [saved, setSaved] = useState(false)

      useEffect(() => {
        fetch('/task-reliability/api/config')
          .then((res) => res.json())
          .then((body) => {
            if (body === null || body.ok !== true) throw new Error('bad config response')
            setConfig(body.value)
            setDraft({ ...body.value, retryableCodesText: (body.value.retryableCodes ?? []).join(', ') })
            setLoading(false)
          })
          .catch(() => {
            setLoading(false)
            setError(true)
          })
      }, [])

      const save = () => {
        setSaved(false)
        setError(false)
        const payload = {
          ...draft,
          retryableCodes: (draft.retryableCodesText ?? '')
            .split(',')
            .map((code) => code.trim())
            .filter((code) => code !== ''),
        }
        delete payload.retryableCodesText
        fetch('/task-reliability/api/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((res) => res.json())
          .then((body) => {
            if (body === null || body.ok !== true) throw new Error('save failed')
            setSaved(true)
          })
          .catch(() => setError(true))
      }

      if (loading) {
        return createElement('div', { className: 'dtr-settings' }, createElement('div', { className: 'dtr-settings-status' }, strings.loading()))
      }
      if (config === null) {
        return createElement('div', { className: 'dtr-settings' }, createElement('div', { className: 'dtr-settings-error' }, strings.loadError()))
      }
      const patch = (key, value) => setDraft({ ...draft, [key]: value })
      const num = (key) => (value) => patch(key, Number(value))
      return createElement('div', { className: 'dtr-settings' },
        ...SETTINGS_SECTIONS.map((section) => settingsSection(section, draft, patch, num)),
        createElement('div', { className: 'dtr-settings-actions' },
          createElement('button', { className: 'dtr-btn', onClick: save }, strings.save()),
          saved ? createElement('span', { className: 'dtr-settings-saved' }, strings.saved()) : null,
          error ? createElement('span', { className: 'dtr-settings-error' }, strings.saveFailed()) : null,
        ),
      )
    }

    /** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
    function attachSettingsTab(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
        const style = document.createElement('style')
        style.setAttribute('data-dsh-task-reliability-settings', 'styles')
        style.textContent = SETTINGS_STYLES
        document.head.appendChild(style)
        return () => {
          if (style.parentNode !== null) style.parentNode.removeChild(style)
        }
      }, 'dsh-task-reliability: settings styles')
      ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        id: 'task-reliability-settings',
        order: 92,
        label: () => strings.settingsTitle(),
      }, TaskReliabilitySettingsView)), 'dsh-task-reliability: settings tab registration')
    }

    exports.apply = function apply(ctx) {
      // 样式注入（与 fiber 同生命周期）。
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
        const style = document.createElement('style')
        style.setAttribute('data-dsh-task-reliability', 'styles')
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => {
          if (style.parentNode !== null) style.parentNode.removeChild(style)
        }
      }, 'dsh-task-reliability: styles')

      const betterSidebar = ctx.get('betterSidebar')
      if (betterSidebar !== undefined && betterSidebar !== null && typeof betterSidebar.registerTab === 'function') {
        ctx.effect(() => betterSidebar.registerTab({
          id: TAB_ID,
          title: () => strings.title(),
          order: 70,
          single: true,
          component: ({ scope, visible }) => createElement(Panel, { scope, visible }),
        }), 'dsh-task-reliability: tab')
      }

      // 设置页 tab（官方 slots 扩展点，issue #27 配置可视化）。
      attachSettingsTab(ctx)
    }

    return module.exports
  },
})
