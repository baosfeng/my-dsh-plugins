// ── i18n（浏览器语言判定）──────────────────────────────────────────
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

// 只保留两个面板（资源监控 / Git 工具）与设置页实际引用的文案；
// 轨迹回放面板移除后其专属文案（类型徽标/过滤/导出/统计）一并删除。
const strings = {
  resourceTitle: () => (isZh() ? '资源监控' : 'Resources'),
  resourceLoading: () => (isZh() ? '资源采样中…' : 'Sampling…'),
  resourceFile: () => (isZh() ? '审计文件' : 'Audit file'),
  resourceRate: () => (isZh() ? '写入速率' : 'Write rate'),
  resourceCpu: () => (isZh() ? 'CPU' : 'CPU'),
  resourceMem: () => (isZh() ? '内存' : 'Memory'),
  gitTitle: () => (isZh() ? 'Git 工具' : 'Git Tools'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  // Git 面板
  repoPlaceholder: () => (isZh() ? '如 /path/to/project' : 'e.g. /path/to/project'),
  loadRepo: () => (isZh() ? '加载' : 'Load'),
  branch: () => (isZh() ? '分支' : 'Branch'),
  staged: () => (isZh() ? '已暂存' : 'staged'),
  unstaged: () => (isZh() ? '未暂存' : 'unstaged'),
  clean: () => (isZh() ? '工作区干净' : 'Working tree clean'),
  diffTitle: () => (isZh() ? '差异' : 'Diff'),
  showDiff: () => (isZh() ? '查看差异' : 'Show diff'),
  showStagedDiff: () => (isZh() ? '查看暂存差异' : 'Staged diff'),
  emptyDiff: () => (isZh() ? '（空）' : '(empty)'),
  review: () => (isZh() ? '提交前审查' : 'Review'),
  reviewResult: () => (isZh() ? '审查结果' : 'Review result'),
  reviewPass: () => (isZh() ? '未发现问题' : 'No issues found'),
  commitTitle: () => (isZh() ? '类型化提交' : 'Typed commit'),
  commitScope: () => (isZh() ? '范围（可选）' : 'Scope (optional)'),
  commitDesc: () => (isZh() ? '描述' : 'Description'),
  commitBody: () => (isZh() ? '正文（可选）' : 'Body (optional)'),
  commit: () => (isZh() ? '提交' : 'Commit'),
  committed: () => (isZh() ? '已提交' : 'Committed'),
  commitError: () => (isZh() ? '提交失败' : 'Commit failed'),
  severityError: () => (isZh() ? '错误' : 'Error'),
  severityWarning: () => (isZh() ? '警告' : 'Warning'),
  severityInfo: () => (isZh() ? '提示' : 'Info'),
  aiVerdictApprove: () => (isZh() ? 'AI 结论：可以提交' : 'AI verdict: approve'),
  aiVerdictChanges: () => (isZh() ? 'AI 结论：建议修改' : 'AI verdict: changes'),
  aiFailed: () => (isZh() ? 'AI 审查不可用' : 'AI review unavailable'),
  // 设置页（设置 → 插件 → 可观测性，issue #383）
  settingsTitle: () => (isZh() ? '可观测性' : 'Observability'),
  settingsSectionTitle: () => (isZh() ? 'AI 审查' : 'AI review'),
  settingsAiReviewLabel: () => (isZh() ? 'AI 审查增强' : 'AI review enhancement'),
  settingsAiReviewHint: () =>
    isZh()
      ? '增量 diff 审查调用 AI agent 补充规则引擎结论（agents 服务不可用或超时自动降级为纯规则）'
      : 'Let an AI agent augment the rule-engine review of the incremental diff (degrades to rules only when the agents service is unavailable)',
  settingsAiTimeoutLabel: () => (isZh() ? 'AI 审查超时（ms）' : 'AI review timeout (ms)'),
  settingsAiTimeoutHint: () =>
    isZh()
      ? '单次 AI 审查的最长等待；非正数或非有限值在保存时回退为 60000'
      : 'Max wait per AI review; non-positive or non-finite values fall back to 60000 on save',
  settingsSave: () => (isZh() ? '保存' : 'Save'),
  settingsSaved: () => (isZh() ? '已保存并生效' : 'Saved and applied'),
  settingsSaveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
  settingsLoadFailedHint: () =>
    isZh()
      ? '无法读取 /observability/api/config：请确认服务端插件已加载（改过 server 端后需重启 dsh web）'
      : 'Cannot read /observability/api/config: make sure the host half is loaded (restart dsh web after host-side changes)',
}
