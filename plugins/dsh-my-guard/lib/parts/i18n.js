'use strict'
// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}
const strings = {
  tabTitle: () => (isZh() ? '安全护栏' : 'Guard'),
  alertsTitle: () => (isZh() ? '告警记录' : 'Alerts'),
  scanTitle: () => (isZh() ? '投毒扫描' : 'Poison scan'),
  promptTitle: () => (isZh() ? '提示注入检测' : 'Injection check'),
  emptyAlerts: () =>
    isZh()
      ? '暂无告警——破坏性命令、投毒内容与提示注入命中会出现在这里'
      : 'No alerts yet — destructive commands, poisoned packages and injection hits will appear here',
  emptyAlertsHint: () =>
    isZh()
      ? '执行危险命令、安装可疑包或输入注入文本时，护栏会在这里生成告警'
      : 'Run a dangerous command, install a suspicious package or paste injection text to see alerts here',
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  scanning: () => (isZh() ? '扫描中…' : 'Scanning…'),
  checking: () => (isZh() ? '检测中…' : 'Checking…'),
  typeDestructive: () => (isZh() ? '破坏性命令' : 'Destructive'),
  typePoison: () => (isZh() ? '投毒扫描' : 'Poison'),
  typeInjection: () => (isZh() ? '提示注入' : 'Injection'),
  sevHigh: () => (isZh() ? '高' : 'high'),
  sevMedium: () => (isZh() ? '中' : 'medium'),
  sevLow: () => (isZh() ? '低' : 'low'),
  confirmed: () => (isZh() ? '已确认' : 'confirmed'),
  confirm: () => (isZh() ? '确认' : 'Confirm'),
  confirmAria: () => (isZh() ? '确认此告警' : 'Confirm this alert'),
  scanPlaceholder: () => (isZh() ? '包名或本地路径，如 dsh-my-guard' : 'package name or path, e.g. dsh-my-guard'),
  scan: () => (isZh() ? '扫描' : 'Scan'),
  scanResult: () => (isZh() ? '扫描结果' : 'Scan result'),
  scanClean: () => (isZh() ? '未发现可疑内容' : 'No suspicious content found'),
  scanError: () => (isZh() ? '扫描失败' : 'Scan failed'),
  findings: (count) => (isZh() ? `${count} 个发现项` : `${count} finding(s)`),
  promptPlaceholder: () => (isZh() ? '输入要检测的文本…' : 'text to check…'),
  check: () => (isZh() ? '检测' : 'Check'),
  checkResult: () => (isZh() ? '检测结果' : 'Result'),
  checkClean: () => (isZh() ? '未命中注入规则' : 'No injection rules hit'),
  checkHits: (count) => (isZh() ? `命中 ${count} 条规则` : `${count} rule(s) hit`),
  file: () => (isZh() ? '文件' : 'file'),
  rule: () => (isZh() ? '规则' : 'rule'),
  // ── 告警可读性（issue #1xx：让用户看懂告警）──────────────────────────
  sessionShort: (id) => (isZh() ? `会话 ${id}` : `session ${id}`),
  hitSnippet: () => (isZh() ? '命中原文' : 'Matched text'),
  falsePositiveHint: () =>
    isZh()
      ? '如为误报：点击「确认」标记为已处理，该告警将弱化显示'
      : 'If this is a false positive, click "Confirm" to mark it as handled (it will be dimmed)',
  noTarget: () => (isZh() ? '请输入包名或路径' : 'Enter a package name or path'),
  noText: () => (isZh() ? '请输入要检测的文本' : 'Enter text to check'),
  modeLabel: () => (isZh() ? '护栏模式' : 'Guard mode'),
  modeObserve: () => (isZh() ? '观察（只告警）' : 'Observe'),
  modeAsk: () => (isZh() ? '确认（审批）' : 'Ask'),
  modeDeny: () => (isZh() ? '拦截' : 'Deny'),
  // ── 自定义护栏规则 + 告警通知（issue #88）───────────────────────────
  rulesTitle: () => (isZh() ? '自定义护栏规则' : 'Custom guard rules'),
  rulesHint: () =>
    isZh()
      ? '添加自定义 bash 危险模式（正则），与内置规则合并生效；命中取最严格模式'
      : 'Add custom bash danger patterns (regex); merged with built-in rules; most-restrictive mode wins',
  addRule: () => (isZh() ? '添加规则' : 'Add rule'),
  saveRules: () => (isZh() ? '保存规则' : 'Save rules'),
  deleteRule: () => (isZh() ? '删除' : 'Delete'),
  deleteRuleAria: () => (isZh() ? '删除此规则' : 'Delete this rule'),
  patternPlaceholder: () => (isZh() ? '正则，如 touch /etc/evil' : 'regex, e.g. touch /etc/evil'),
  descriptionPlaceholder: () => (isZh() ? '描述（可选）' : 'description (optional)'),
  severityLabel: () => (isZh() ? '严重级' : 'Severity'),
  notifyLabel: () => (isZh() ? '告警通知' : 'Alert notification'),
  notifyHint: () => (isZh() ? '高严重级告警经 dsh-my-notify 推送' : 'High-severity alerts pushed via dsh-my-notify'),
  cooldownLabel: () => (isZh() ? '冷却(秒)' : 'Cooldown (s)'),
  saveRulesOk: () => (isZh() ? '规则已保存（已生效）' : 'Rules saved (active)'),
  droppedRule: (count) =>
    isZh()
      ? `已保存 ${count} 条，丢弃 ${count} 条非法规则（正则无效/缺 pattern）`
      : `Saved, ${count} invalid rule(s) dropped`,
  loadRulesError: () => (isZh() ? '规则加载失败' : 'Failed to load rules'),
  noCommand: () => (isZh() ? '请输入命令' : 'Enter a command'),
  ruleTestTitle: () => (isZh() ? '规则测试' : 'Rule test'),
  ruleTestPlaceholder: () => (isZh() ? '输入命令，预览命中哪些规则…' : 'type a command to preview matching rules…'),
  ruleTest: () => (isZh() ? '测试' : 'Test'),
  ruleTestResult: () => (isZh() ? '命中规则' : 'Matching rules'),
  noRuleHit: () => (isZh() ? '未命中任何护栏规则' : 'No guard rule matched'),
  ruleHitSource: (source) => (isZh() ? (source === 'builtin' ? '内置' : '自定义') : source),
  effectiveDecision: () => (isZh() ? '合并决策' : 'Effective'),
  emptyRules: () =>
    isZh() ? '暂无自定义规则——点击「添加规则」创建' : 'No custom rules — click "Add rule" to create one',
  // ── 设置页（设置 → 插件 → 安全护栏，issue #383）─────────────────────
  settingsTab: () => (isZh() ? '安全护栏' : 'Guard'),
  settingsModeTitle: () => (isZh() ? '护栏模式' : 'Guard mode'),
  settingsScanTitle: () => (isZh() ? '检测开关' : 'Detections'),
  settingsNotifyTitle: () => (isZh() ? '告警通知' : 'Alert notification'),
  settingsRulesTitle: () => (isZh() ? '自定义护栏规则' : 'Custom guard rules'),
  settingsModeObserveHint: () =>
    isZh()
      ? '只记录告警，不改变工具执行与审批流程'
      : 'Records alerts only; tool execution and approval flow stay unchanged',
  settingsModeAskHint: () =>
    isZh()
      ? '命中时触发 DSH 原生审批，确认后才执行'
      : 'Triggers the native DSH approval prompt; runs only after confirmation',
  settingsModeDenyHint: () =>
    isZh() ? '命中时直接拦截，工具返回错误' : 'Blocks the tool call outright and returns an error',
  settingsPoisonLabel: () => (isZh() ? '投毒扫描' : 'Poison scan'),
  settingsPoisonHint: () =>
    isZh()
      ? '检测 dsh plugin add 安装的包内容（可疑脚本 / 密钥 / 恶意依赖）'
      : 'Scans packages installed via dsh plugin add (suspicious scripts / secrets / malicious deps)',
  settingsInjectionLabel: () => (isZh() ? '提示注入检测' : 'Injection detection'),
  settingsInjectionHint: () =>
    isZh()
      ? '检测用户消息中的 prompt injection / jailbreak 尝试'
      : 'Detects prompt-injection / jailbreak attempts in user messages',
  settingsCooldownHint: () =>
    isZh() ? '同一类型告警的通知间隔' : 'Minimum interval between notifications of the same alert type',
  settingsCooldownUnit: () => (isZh() ? '秒' : 's'),
  settingsRulesCount: (count) => (isZh() ? `${count} 条` : `${count} rule(s)`),
  settingsRulesHint: () =>
    isZh()
      ? '正则规则列表在侧边栏「安全护栏」面板编辑保存；本页只显示条数'
      : 'Edit the regex rule list in the sidebar "Guard" panel; this page only shows the count',
  settingsSave: () => (isZh() ? '保存设置' : 'Save settings'),
  settingsSaved: () => (isZh() ? '已保存并生效' : 'Saved and active'),
  settingsSaveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  settingsLoadFailed: () => (isZh() ? '配置加载失败' : 'Failed to load config'),
  settingsRetry: () => (isZh() ? '重试' : 'Retry'),
}
