// ── i18n ──────────────────────────────────────────────────────────────
function isZh(): boolean {
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
  trackingHint: () =>
    isZh()
      ? '自动跟踪带目标的会话（goal），任务未完成自动继续'
      : 'Auto-track goal sessions; unfinished tasks auto-continue',
  verifyHint: () =>
    isZh()
      ? '任务结束后用独立校验 agent 判断完成度，未完成自动继续'
      : 'Verify completion with a separate agent; continue when unfinished',
  autopilotHint: () =>
    isZh()
      ? '出行模式：拦截询问自动决策，问题记录待确认'
      : 'Travel mode: intercept asks, decide autonomously, collect questions',
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
  loops: (n: number) => (isZh() ? `继续 ${n} 次` : `${n} continues`),
  verifies: (n: number) => (isZh() ? `校验 ${n} 次` : `${n} verifies`),
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
  settingsAskTimeoutMsHint: () =>
    isZh()
      ? '询问用户超时后自动继续，问题记录待确认（0 = 禁用）'
      : 'Auto-continue after ask timeout, question queued (0 = disabled)',
  settingsAutopilotGraceMs: () => (isZh() ? '自主决策缓冲（毫秒）' : 'Autopilot grace (ms)'),
  settingsAutopilotGraceMsHint: () =>
    isZh()
      ? '自主决策模式下 ask 先展示给用户，缓冲超时后才自动决策（0 = 立即拦截）'
      : 'Autopilot shows asks first; auto-decide after grace (0 = intercept immediately)',
  settingsWatchdog: () => (isZh() ? '停滞看门狗' : 'Stall watchdog'),
  settingsWatchdogIntervalMs: () => (isZh() ? '看门狗检查间隔（毫秒）' : 'Watchdog interval (ms)'),
  settingsWatchdogIntervalMsHint: () =>
    isZh() ? '定期检查活动任务是否停滞（0 = 禁用）' : 'Periodic stall check (0 = disabled)',
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
  settingsApiTokenHint: () =>
    isZh()
      ? '配置后远程触发需携带 x-task-reliability-token 头'
      : 'Remote triggers must send x-task-reliability-token when set',
  settingsRescue: () => (isZh() ? '截断救场' : 'Truncation rescue'),
  settingsRescueOnTruncation: () => (isZh() ? '输出截断自动补完' : 'Auto-complete truncated output'),
  settingsRescueOnTruncationHint: () =>
    isZh()
      ? '回合因输出上限/异常中断且输出不完整时，自动注入继续指令补完（普通对话同样生效）'
      : 'Auto-inject a continue prompt when a turn ends truncated/errored with incomplete output (plain chats too)',
  settingsRescueMaxPerSession: () => (isZh() ? '每会话救场上限' : 'Max rescues per session'),
  settingsRescueMaxPerSessionHint: () =>
    isZh() ? '每会话自动补完次数上限，防无限循环' : 'Cap of auto-completes per session (anti-loop)',
  settingsRescueCooldownMs: () => (isZh() ? '救场冷却（毫秒）' : 'Rescue cooldown (ms)'),
  settingsRescueCooldownMsHint: () => (isZh() ? '两次自动补完之间的最小间隔' : 'Min interval between auto-completes'),
  save: () => (isZh() ? '保存' : 'Save'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
}
