// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  tabTitle: () => (isZh() ? '上下文透镜' : 'Context'),
  allSessions: () => (isZh() ? '全部会话' : 'All sessions'),
  noSessions: () =>
    isZh()
      ? '暂无会话统计——开始一段对话后，上下文占用会出现在这里'
      : 'No session stats yet — context usage will appear here after a conversation',
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  overview: () => (isZh() ? '概览' : 'Overview'),
  totalTokens: () => (isZh() ? '累计 token' : 'Total tokens'),
  inputTokens: () => (isZh() ? '输入' : 'Input'),
  outputTokens: () => (isZh() ? '输出' : 'Output'),
  cacheRead: () => (isZh() ? '缓存命中' : 'Cache read'),
  cacheWrite: () => (isZh() ? '缓存写入' : 'Cache write'),
  cacheHitRate: () => (isZh() ? 'KV 缓存命中率' : 'KV cache hit rate'),
  contextWindow: () => (isZh() ? '上下文窗口' : 'Context window'),
  model: () => (isZh() ? '模型' : 'Model'),
  composition: () => (isZh() ? '上下文构成' : 'Composition'),
  catSystem: () => (isZh() ? '系统提示' : 'System'),
  catTools: () => (isZh() ? '工具' : 'Tools'),
  catUser: () => (isZh() ? '用户' : 'User'),
  catInject: () => (isZh() ? '注入' : 'Injected'),
  catAssistant: () => (isZh() ? '助手' : 'Assistant'),
  catTool: () => (isZh() ? '工具结果' : 'Tool results'),
  requests: () => (isZh() ? '请求记录' : 'Requests'),
  noRequests: () => (isZh() ? '暂无请求记录' : 'No requests yet'),
  turnStep: (turn: number, step: number) => (isZh() ? `轮 ${turn} · 步 ${step}` : `turn ${turn} · step ${step}`),
  prompt: () => (isZh() ? '提示' : 'Prompt'),
  output: () => (isZh() ? '输出' : 'Output'),
  budget: () => (isZh() ? '预算' : 'Budget'),
  budgetPerTurn: () => (isZh() ? '每轮上限' : 'Per-turn limit'),
  budgetPerSession: () => (isZh() ? '每会话上限' : 'Per-session limit'),
  budgetOff: () => (isZh() ? '不限制' : 'Unlimited'),
  modeWarn: () => (isZh() ? '提醒' : 'Warn'),
  modeDeny: () => (isZh() ? '拦截' : 'Deny'),
  save: () => (isZh() ? '保存' : 'Save'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveError: () => (isZh() ? '保存失败' : 'Save failed'),
  alerts: () => (isZh() ? '预算告警' : 'Budget alerts'),
  noAlerts: () => (isZh() ? '暂无预算告警' : 'No budget alerts'),
  alertTurn: () => (isZh() ? '每轮超限' : 'Turn limit exceeded'),
  alertSession: () => (isZh() ? '每会话超限' : 'Session limit exceeded'),
  alertBlocked: () => (isZh() ? '已拦截' : 'Blocked'),
  alertWarned: () => (isZh() ? '已提醒' : 'Warned'),
  // ── 上下文溢出预警（issue #87）──────────────────────────────────
  contextUsage: () => (isZh() ? '上下文占用' : 'Context usage'),
  contextUsageUnknown: () => (isZh() ? '上下文窗口未知' : 'Context window unknown'),
  levelNormal: () => (isZh() ? '正常' : 'Normal'),
  levelWarn: () => (isZh() ? '预警' : 'Warning'),
  levelAlert: () => (isZh() ? '告警' : 'Alert'),
  levelCritical: () => (isZh() ? '严重' : 'Critical'),
  overflowSection: () => (isZh() ? '溢出预警' : 'Overflow alerts'),
  noOverflows: () => (isZh() ? '暂无溢出预警' : 'No overflow alerts'),
  overflowRatio: () => (isZh() ? '已用占比' : 'Usage'),
  overflowThreshold: (n: number) => (isZh() ? `阈值 ${(n * 100).toFixed(0)}%` : `threshold ${(n * 100).toFixed(0)}%`),
  suggestTitle: (level: string) => {
    if (isZh()) {
      if (level === 'critical') return '建议：上下文接近上限，开启新会话'
      if (level === 'alert') return '建议：尽快压缩或开启新会话'
      return '建议：留意上下文占用'
    }
    if (level === 'critical') return 'Suggestion: context near limit, start a new session'
    if (level === 'alert') return 'Suggestion: compact soon or start a new session'
    return 'Suggestion: watch context usage'
  },
  suggestNewSession: () => (isZh() ? '开启新会话，归档当前上下文' : 'Start a new session and archive this context'),
  suggestCompact: () =>
    isZh() ? '总结/压缩历史对话后再继续' : 'Summarize/compact the conversation history before continuing',
  suggestComposition: (list: string) =>
    isZh() ? `查看上下文构成占比（${list} 占比最高）` : `Review composition shares (${list} dominate)`,
  warnThresholdLabel: () => (isZh() ? '预警阈值' : 'Warn threshold'),
  alertThresholdLabel: () => (isZh() ? '告警阈值' : 'Alert threshold'),
  overflowConfig: () => (isZh() ? '溢出阈值' : 'Overflow thresholds'),
  tokens: (n: number) => (isZh() ? `${n.toLocaleString()} tokens` : `${n.toLocaleString()} tokens`),
  percent: (n: number) => `${(n * 100).toFixed(1)}%`,
  empty: () => (isZh() ? '（空）' : '(empty)'),
}
