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
  title: (): string => (isZh() ? '记忆' : 'Memory'),
  globalSection: (): string => (isZh() ? '全局记忆' : 'Global memory'),
  projectSection: (): string => (isZh() ? '项目记忆' : 'Project memory'),
  projectHint: (): string =>
    isZh()
      ? '输入项目根路径以查看 / 编辑该项目记忆（存储于 $DSH_HOME/memory/projects/）'
      : 'Enter a project root to view/edit its project memory (stored under $DSH_HOME/memory/projects/)',
  loadProject: (): string => (isZh() ? '加载' : 'Load'),
  refresh: (): string => (isZh() ? '刷新' : 'Refresh'),
  retry: (): string => (isZh() ? '重试' : 'Retry'),
  loading: (): string => (isZh() ? '加载中…' : 'Loading…'),
  loadError: (): string => (isZh() ? '加载失败' : 'Load failed'),
  empty: (): string => (isZh() ? '暂无记忆' : 'No memories yet'),
  emptyHint: (): string => (isZh() ? '点击下方输入框添加第一条记忆' : 'Add your first memory below'),
  projectEmptyHint: (): string =>
    isZh()
      ? '当前无项目会话，请在上方输入项目根路径加载项目记忆'
      : 'No active project session; enter a project root above to load its memory',
  addPlaceholder: (): string =>
    isZh()
      ? '输入要记住的内容（建议 1-2 句话概括，如：回复使用中文）'
      : 'Type what to remember (keep it to 1-2 sentences, e.g. reply in Chinese)',
  // ── issue #105 记忆内容精简：超长提示 / 概要预览 ──
  entryTooLongHint: (current: number, limit: number): string =>
    isZh()
      ? `内容过长（${current} 字，建议 ≤ ${limit} 字），建议精简为 1-2 句`
      : `Entry too long (${current} chars, suggested ≤ ${limit}); keep it to 1-2 sentences`,
  summaryPreview: (): string =>
    isZh() ? '将保存完整内容；列表与注入显示概要：' : 'Full content is saved; list & injection show the summary: ',
  add: (): string => (isZh() ? '新增' : 'Add'),
  save: (): string => (isZh() ? '保存' : 'Save'),
  cancel: (): string => (isZh() ? '取消' : 'Cancel'),
  edit: (): string => (isZh() ? '编辑' : 'Edit'),
  delete: (): string => (isZh() ? '删除' : 'Delete'),
  confirmAdd: (): string => (isZh() ? '确认新增这条记忆？' : 'Add this memory?'),
  confirmUpdate: (): string => (isZh() ? '确认保存这条记忆的修改？' : 'Save this memory change?'),
  confirmDelete: (): string =>
    isZh() ? '确定删除这条记忆？此操作不可撤销。' : 'Delete this memory? This cannot be undone.',
  confirmSave: (): string => (isZh() ? '确认保存' : 'Confirm save'),
  confirmDeleteBtn: (): string => (isZh() ? '确认删除' : 'Confirm delete'),
  saved: (): string => (isZh() ? '已保存' : 'Saved'),
  saveFailed: (): string => (isZh() ? '操作失败' : 'Operation failed'),
  projectRoot: (): string => (isZh() ? '项目根：' : 'Project root: '),
  globalNote: (): string =>
    isZh()
      ? '全局记忆在会话开始时注入系统提示词（agent 始终携带）；存于 $DSH_HOME/memory.json'
      : 'Global memories are injected into the system prompt at session start; stored in $DSH_HOME/memory.json',
  projectNote: (): string =>
    isZh()
      ? '项目记忆按项目隔离，仅该项目会话可见；存于 $DSH_HOME/memory/projects/（按项目根路径哈希分文件）'
      : 'Project memories are scoped to this project only; stored under $DSH_HOME/memory/projects/ (one file per project-root hash)',
  confirmHint: (): string =>
    isZh() ? '所有新增 / 修改 / 删除都需要你确认' : 'Every add / edit / delete needs your confirmation',
  updatedAt: (ts: number): string =>
    isZh() ? `更新于 ${new Date(ts).toLocaleString()}` : `Updated ${new Date(ts).toLocaleString()}`,
  // ── issue #110 视觉重设计：徽标分类/数量、相对时间、排序、截断展开 ──
  globalScope: (): string => (isZh() ? '全局' : 'Global'),
  projectScope: (): string => (isZh() ? '项目' : 'Project'),
  countBadge: (label: string, n: number): string => (isZh() ? `${label} · ${n} 条` : `${label} · ${n}`),
  countOnly: (n: number): string => (isZh() ? `${n} 条` : `${n}`),
  projectBadge: (root: string, n: number): string =>
    isZh() ? `项目根：${root} · ${n} 条` : `Project root: ${root} · ${n}`,
  pathInputAria: (): string => (isZh() ? '项目根路径' : 'Project root path'),
  addInputAria: (scope: string): string =>
    isZh() ? `新增记忆内容（${scope === 'project' ? '项目' : '全局'}）` : `New memory (${scope})`,
  justNow: (): string => (isZh() ? '刚刚' : 'just now'),
  minutesAgo: (n: number): string => (isZh() ? `${n} 分钟前` : `${n} min ago`),
  hoursAgo: (n: number): string => (isZh() ? `${n} 小时前` : `${n} hr ago`),
  daysAgo: (n: number): string => (isZh() ? `${n} 天前` : `${n} d ago`),
  sortLabel: (): string => (isZh() ? '按更新时间排序' : 'Sort by updated'),
  sortNewest: (): string => (isZh() ? '最新优先' : 'Newest first'),
  sortOldest: (): string => (isZh() ? '最旧优先' : 'Oldest first'),
  expand: (): string => (isZh() ? '展开' : 'Expand'),
  collapse: (): string => (isZh() ? '收起' : 'Collapse'),
  // ── issue #78 渐进式索引记忆：待确认候选 + 元数据展示 ──
  candidatesSection: (): string => (isZh() ? '自动学习候选（待确认）' : 'Auto-learned candidates (pending)'),
  candidatesNote: (): string =>
    isZh()
      ? '会话结束后自动从对话提取的记忆候选（autoLearn 开启时）。确认后写入记忆（同主题自动提升置信度），拒绝则丢弃——记忆绝不静默变更'
      : 'Memory candidates auto-extracted from conversations (when autoLearn is on). Confirm to store them (same themes gain confidence), dismiss to drop — memories never change silently',
  candidatesEmpty: (): string => (isZh() ? '暂无待确认候选' : 'No pending candidates'),
  confirmCandidate: (): string => (isZh() ? '确认写入' : 'Confirm'),
  dismissCandidate: (): string => (isZh() ? '拒弃' : 'Dismiss'),
  candidateSource: (sessionId: string): string =>
    isZh()
      ? `来源会话：${sessionId === '' ? '(无)' : sessionId}`
      : `Source session: ${sessionId === '' ? '(none)' : sessionId}`,
  candidateScopeBadge: (scope: string): string =>
    isZh() ? (scope === 'project' ? '项目候选' : '全局候选') : scope === 'project' ? 'Project' : 'Global',
  categoryLabel: (category: string): string =>
    ({
      preference: isZh() ? '偏好' : 'Preference',
      fact: isZh() ? '事实' : 'Fact',
      project: isZh() ? '项目' : 'Project',
      stack: isZh() ? '技术栈' : 'Stack',
      workflow: isZh() ? '工作流' : 'Workflow',
    })[category] ?? (isZh() ? '事实' : 'Fact'),
  confidenceLabel: (n: number): string => (isZh() ? `置信度 ${n}` : `Confidence ${n}`),
  sourceAgentLabel: (sessionId: string): string =>
    isZh() ? `agent 保存 · ${sessionId.slice(0, 8)}` : `saved by agent · ${sessionId.slice(0, 8)}`,
  statusConflict: (): string => (isZh() ? '待处理矛盾' : 'Conflict'),
  historyLabel: (): string => (isZh() ? '演进历史' : 'History'),
  historyEntry: (action: string): string =>
    isZh()
      ? action === 'reinforce'
        ? '多次出现，置信度提升'
        : action === 'conflict'
          ? '内容更新（可能矛盾）'
          : '新增'
      : action,
  noHistory: (): string => (isZh() ? '暂无演进历史' : 'No history yet'),
  // ── issue #193 确认卡对齐 ask 范式：条带标题 / 范围 / 分类 / footer 文案 ──
  scopeUnknown: (): string => (isZh() ? '范围未标注' : 'Scope not stated'),
  askScopeLabel: (): string => (isZh() ? '记忆范围' : 'Memory scope'),
  askScopeLocked: (): string =>
    isZh() ? '范围由请求方决定，确认卡内不可更改' : 'Scope is fixed by the request and cannot be changed here',
  askCategoryLabel: (): string => (isZh() ? '分类' : 'Category'),
  askContentLabel: (): string => (isZh() ? '内容' : 'Content'),
  askSaveTitle: (): string => (isZh() ? 'agent 请求保存记忆' : 'Agent requests saving a memory'),
  askDeleteTitle: (): string => (isZh() ? 'agent 请求删除记忆' : 'Agent requests deleting a memory'),
  askAllowSave: (): string => (isZh() ? '允许保存' : 'Allow save'),
  askAllowDelete: (): string => (isZh() ? '删除这条记忆' : 'Delete this memory'),
  askDeleteArmed: (): string => (isZh() ? '确认删除（不可撤销）' : 'Confirm delete (irreversible)'),
  askReject: (): string => (isZh() ? '拒绝' : 'Reject'),
  askNoteSave: (): string =>
    isZh() ? '允许后写入记忆 · 记忆绝不静默变更' : 'Writes the memory on allow · memories never change silently',
  askNoteDelete: (): string =>
    isZh() ? '删除不可撤销 · 记忆绝不静默变更' : 'Deletion is irreversible · memories never change silently',
}

// 导出给其他 part 文件使用
