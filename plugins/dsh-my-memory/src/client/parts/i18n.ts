// ── i18n ──────────────────────────────────────────────────────────────
function isZh(): boolean {
  // 宿主 locale（dsh-client-locale 同步到 <html lang>）优先；空则回退浏览器语言。
  try {
    const host = (document.documentElement.lang || '').toLowerCase()
    if (host !== '') return host.startsWith('zh')
  } catch {
    /* 非浏览器环境（node 渲染）无 document */
  }
  try {
    return (navigator.language || 'en').toLowerCase().startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: (): string => (isZh() ? '记忆' : 'Memory'),
  globalSection: (): string => (isZh() ? '全局记忆' : 'Global memory'),
  projectSection: (): string => (isZh() ? '项目记忆' : 'Project memory'),
  retry: (): string => (isZh() ? '重试' : 'Retry'),
  loading: (): string => (isZh() ? '加载中…' : 'Loading…'),
  loadError: (): string => (isZh() ? '加载失败' : 'Load failed'),
  empty: (): string => (isZh() ? '暂无记忆' : 'No memories yet'),
  emptyHint: (): string => (isZh() ? '在下方输入框添加第一条记忆' : 'Add your first memory below'),
  projectEmptyHint: (): string =>
    isZh()
      ? '当前无项目会话；打开项目会话后，这里会显示该项目的记忆'
      : 'No active project session; open one to see its project memory',
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
  updatedPrefix: (): string => (isZh() ? '更新于 ' : 'Updated '),
  updatedAt: (ts: number): string =>
    isZh() ? `更新于 ${new Date(ts).toLocaleString()}` : `Updated ${new Date(ts).toLocaleString()}`,
  // ── issue #110 视觉重设计：徽标分类/数量、相对时间、排序、截断展开 ──
  globalScope: (): string => (isZh() ? '全局' : 'Global'),
  projectScope: (): string => (isZh() ? '项目' : 'Project'),
  countOnly: (n: number): string => (isZh() ? `${n} 条` : `${n}`),
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
  conflictNote: (): string =>
    isZh()
      ? '内容曾更新，与旧版本存在差异，待你处理：确认保留当前版本，或改写后再保存。'
      : 'Updated content differs from the previous version — review it.',
  sourceLabel: (): string => (isZh() ? '来源会话' : 'Source session'),
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
  // ── issue #465 全局提示词（与记忆并列但完全隔离）──
  promptsSection: (): string => (isZh() ? '全局提示词' : 'Global prompts'),
  // ── agent 记忆（issue #502）：第四个 tab ──
  agentMemorySection: (): string => (isZh() ? 'Agent 记忆' : 'Agent memory'),
  agentMemoryNote: (): string =>
    isZh()
      ? 'agent 自主维护的跨会话记忆，与上面的全局/项目记忆相互独立。正文不注入上下文——只有 agent 主动读取时才消耗 token；这里的时间与次数只给你看，agent 看不到也改不了。'
      : 'Cross-session memory the agent maintains on its own, independent of the global/project memory above. Bodies are never injected into context — only an explicit read by the agent costs tokens; the timestamps and counts below are for you only (the agent cannot see or change them).',
  agentMemoryEmpty: (): string => (isZh() ? '还没有记忆' : 'No memories yet'),
  agentMemoryEmptyHint: (): string =>
    isZh()
      ? '这是正常状态——agent 只在遇到下次会话仍有用、且代码里推不出来的信息时才会写。'
      : 'That is normal: the agent only writes when something is useful in a later session and cannot be derived from the code.',
  agentMemoryCreated: (value: string): string => (isZh() ? `创建 ${value}` : `created ${value}`),
  agentMemoryRead: (count: number, value: string): string =>
    isZh() ? `读过 ${count} 次（最近 ${value}）` : `read ${count}× (last ${value})`,
  agentMemoryArchived: (): string => (isZh() ? '已归档（长期未读）' : 'archived (long unread)'),
  agentMemoryArchiveTitle: (count: number): string => (isZh() ? `已归档（${count}）` : `Archived (${count})`),
  agentMemoryNever: (): string => (isZh() ? '从未' : 'never'),
  agentMemoryToday: (): string => (isZh() ? '今天' : 'today'),
  agentMemoryDaysAgo: (days: number): string => (isZh() ? `${days} 天前` : `${days}d ago`),
  agentMemoryEdit: (): string => (isZh() ? '编辑' : 'Edit'),
  agentMemoryCancel: (): string => (isZh() ? '取消' : 'Cancel'),
  agentMemorySave: (): string => (isZh() ? '保存' : 'Save'),
  agentMemoryDelete: (): string => (isZh() ? '删除' : 'Delete'),
  agentMemoryRestore: (): string => (isZh() ? '恢复' : 'Restore'),
  agentMemorySaveFailed: (): string => (isZh() ? '保存失败' : 'Save failed'),
  promptsScope: (): string => (isZh() ? '全局提示词' : 'Global prompts'),
  promptsNote: (): string =>
    isZh()
      ? '每轮组装时全量按序注入系统提示（启用即注入、停用即不注入；不参与记忆的评分与条数上限）——存于 $DSH_HOME/memory/prompts.json'
      : 'Every enabled prompt is injected into the system prompt in full order each turn (disabled = not injected; never scored or capped by the memory limits) — stored in $DSH_HOME/memory/prompts.json',
  promptsEmpty: (): string => (isZh() ? '暂无提示词' : 'No prompts yet'),
  promptsEmptyHint: (): string => (isZh() ? '在下方新增第一条全局提示词' : 'Add your first global prompt below'),
  promptsAddPlaceholder: (): string => (isZh() ? '提示词标题（如：中文思考）' : 'Prompt title (e.g. Think in Chinese)'),
  promptsTextPlaceholder: (): string =>
    isZh() ? '提示词正文（将完整注入系统提示）' : 'Prompt body (injected in full into the system prompt)',
  promptsAddInputAria: (): string => (isZh() ? '新增提示词标题' : 'New prompt title'),
  promptsTextInputAria: (): string => (isZh() ? '新增提示词正文' : 'New prompt body'),
  promptEnabled: (): string => (isZh() ? '已启用' : 'Enabled'),
  promptDisabled: (): string => (isZh() ? '已停用' : 'Disabled'),
  promptToggleOn: (): string => (isZh() ? '启用' : 'Enable'),
  promptToggleOff: (): string => (isZh() ? '停用' : 'Disable'),
  promptMoveUp: (): string => (isZh() ? '上移' : 'Move up'),
  promptMoveDown: (): string => (isZh() ? '下移' : 'Move down'),
  promptBuiltin: (): string => (isZh() ? '内置' : 'Builtin'),
  promptHint: (): string =>
    isZh()
      ? '启用的提示词全量按序注入，不评分不截断'
      : 'Enabled prompts are injected in full order — never scored, never truncated',
  confirmAddPrompt: (): string => (isZh() ? '确认新增这条提示词？' : 'Add this prompt?'),
  confirmUpdatePrompt: (): string => (isZh() ? '确认保存这条提示词的修改？' : 'Save this prompt change?'),
  confirmDeletePrompt: (): string =>
    isZh() ? '确定删除这条提示词？此操作不可撤销。' : 'Delete this prompt? This cannot be undone.',
  promptCount: (n: number): string => (isZh() ? `${n} 条` : `${n}`),
}

// 导出给其他 part 文件使用
