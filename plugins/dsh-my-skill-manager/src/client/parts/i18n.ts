// ── i18n：全部文案按 <html lang> 二选一（中 / 英）────────────────────────
// 判定沿用仓库既有写法：宿主 locale 写入的 <html lang> 优先，空则回退
// navigator.language；任何异常都兜底英文。文案一律是 thunk（函数），
// 每次渲染重新求值，切语言无需重新注册 tab（slots label 也是 thunk）。
function isZh(): boolean {
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

/** 单语取值：按当前语言返回中/英之一，不并排。 */
function pick(zh: string, en: string): string {
  return isZh() ? zh : en
}

/** 诊断原因 → { 短标签, 说明, 建议 }（未知原因原样显示）。 */
const REASON_META: Record<string, { label: [string, string]; reason: [string, string]; suggestion: [string, string] }> =
  {
    'broken-symlink': {
      label: ['坏符号链接', 'Broken symlink'],
      reason: [
        '符号链接的目标不存在，扫描时被跳过。',
        'The symlink target no longer exists, so the entry was skipped during the scan.',
      ],
      suggestion: [
        '恢复目标目录，或在确认无用后移除该符号链接，然后重新扫描。',
        'Restore the target directory, or remove the link if it is no longer needed, then rescan.',
      ],
    },
    'missing-skill-md': {
      label: ['缺 SKILL.md', 'Missing SKILL.md'],
      reason: [
        '目录存在，但缺少 SKILL.md，无法解析技能元信息。',
        'The directory exists but has no SKILL.md, so its metadata cannot be parsed.',
      ],
      suggestion: [
        '在目录内补写 SKILL.md（含 name / description frontmatter），或删除该目录后重新扫描。',
        'Add a SKILL.md with name/description frontmatter, or delete the directory, then rescan.',
      ],
    },
    'missing-frontmatter': {
      label: ['缺 frontmatter', 'Missing frontmatter'],
      reason: ['SKILL.md 顶部缺少 YAML frontmatter。', 'SKILL.md has no YAML frontmatter at the top.'],
      suggestion: [
        '在 SKILL.md 顶部补写 frontmatter（至少 name 与 description），然后重新扫描。',
        'Add frontmatter (at least name and description) at the top of SKILL.md, then rescan.',
      ],
    },
    'invalid-name': {
      label: ['名称非法', 'Invalid name'],
      reason: [
        '技能名称不符合 kebab-case 规范（小写字母、数字与连字符）。',
        'The skill name is not valid kebab-case (lowercase letters, digits and hyphens).',
      ],
      suggestion: [
        '把目录名与 frontmatter 的 name 改为 kebab-case，然后重新扫描。',
        'Rename the directory and the frontmatter name to kebab-case, then rescan.',
      ],
    },
    'parse-failed': {
      label: ['解析失败', 'Parse failed'],
      reason: [
        'frontmatter 解析失败或字段类型异常，扫描时被跳过。',
        'Frontmatter parsing failed or a field has the wrong type, so the scan skipped it.',
      ],
      suggestion: [
        '检查 frontmatter 的 YAML 语法与字段类型后重新扫描。',
        'Check the frontmatter YAML syntax and field types, then rescan.',
      ],
    },
  }

const strings = {
  title: (): string => pick('Skill 管理', 'Skill Manager'),
  // ── 命令条 ──────────────────────────────────────────────────────────
  searchPlaceholder: (): string => pick('搜索名称、描述或路径', 'Search name, description or path'),
  searchAria: (): string => pick('搜索技能', 'Search skills'),
  searchClear: (): string => pick('清空搜索', 'Clear search'),
  shortcutHint: (): string => '⌘K',
  rescanning: (): string => pick('扫描中…', 'Scanning…'),
  rescanAria: (): string => pick('重新扫描技能目录', 'Rescan skill directories'),
  statsAria: (): string => pick('概览筛选', 'Overview filters'),
  statAll: (): string => pick('全部', 'All'),
  statEnabled: (): string => pick('启用', 'Enabled'),
  statDisabled: (): string => pick('禁用', 'Disabled'),
  statAnomaly: (): string => pick('异常', 'Issues'),
  diagEntry: (): string => pick('诊断', 'Diagnostics'),
  diagEntryAria: (count: number): string =>
    pick(`打开异常诊断，当前 ${count} 项异常`, `Open diagnostics, ${count} issues`),
  projectNote: (): string => pick('未绑定项目 · 本项目作用域不可用', 'No project bound · scope unavailable'),
  // ── 筛选 ────────────────────────────────────────────────────────────
  filterButton: (): string => pick('筛选', 'Filter'),
  filterButtonAria: (count: number): string =>
    count > 0
      ? pick(`筛选，已生效 ${count} 项条件`, `Filter, ${count} active conditions`)
      : pick('打开筛选', 'Open filters'),
  filterTitle: (): string => pick('筛选', 'Filter'),
  filterClose: (): string => pick('关闭', 'Close'),
  filterReset: (): string => pick('重置', 'Reset'),
  filterSourceGroup: (): string => pick('按来源筛选', 'Filter by source'),
  filterStatusGroup: (): string => pick('按状态筛选', 'Filter by status'),
  filtersSource: (): string => pick('来源', 'Source'),
  filterAll: (): string => pick('全部', 'All'),
  filtersStatus: (): string => pick('状态', 'Status'),
  filterAllStatus: (): string => pick('全部状态', 'All statuses'),
  sourceProject: (): string => pick('本项目', 'Project'),
  sourceUser: (): string => pick('用户', 'User'),
  sourceBundled: (): string => pick('内置', 'Built-in'),
  sourceOther: (): string => pick('其他', 'Other'),
  sourceAnomaly: (): string => pick('异常', 'Issues'),
  unusedOnly: (): string => pick('只看未使用', 'Unused only'),
  // ── 工具条 ──────────────────────────────────────────────────────────
  resultCountUnit: (): string => pick('项结果', 'results'),
  scanTime: (time: string): string => pick(`上次扫描 ${time}`, `Last scan ${time}`),
  viewAria: (): string => pick('视图切换', 'View mode'),
  viewCards: (): string => pick('卡片流', 'Cards'),
  viewTable: (): string => pick('紧凑表', 'Table'),
  sortAria: (): string => pick('排序方式', 'Sort by'),
  sortName: (): string => pick('名称', 'Name'),
  sortUsage: (): string => pick('使用次数', 'Uses'),
  sortRecent: (): string => pick('最近使用', 'Recent'),
  sortSource: (): string => pick('来源', 'Source'),
  sortDirAria: (dir: string): string =>
    pick(
      `切换排序方向（当前${dir === 'asc' ? '升序' : '降序'}）`,
      `Toggle sort direction (currently ${dir === 'asc' ? 'ascending' : 'descending'})`,
    ),
  selectAria: (): string => pick('进入选择模式', 'Enter selection mode'),
  // ── 分组 ────────────────────────────────────────────────────────────
  groupProject: (): string => pick('本项目', 'This project'),
  groupUser: (): string => pick('用户', 'User'),
  groupBundled: (): string => pick('内置', 'Built-in'),
  groupOther: (): string => pick('其他', 'Other'),
  groupAnomaly: (): string => pick('异常', 'Issues'),
  groupAnomalyHint: (): string => pick('扫描失败 · 需要修复', 'Scan failed · needs a fix'),
  cardOpenAria: (name: string, expanded: boolean): string =>
    pick(`${expanded ? '收起' : '展开'} ${name} 的详情`, `${expanded ? 'Collapse' : 'Expand'} details for ${name}`),
  badgeGlobalOff: (): string => pick('全局关闭', 'Global off'),
  badgeProjectOff: (): string => pick('本项目关闭', 'Project off'),
  badgeScanIssue: (): string => pick('扫描异常', 'Scan issue'),
  usageNever: (): string => pick('未使用', 'Never used'),
  usageTimes: (count: number): string => pick(`${count} 次`, `${count} uses`),
  usageTitle: (count: number, recent: string): string =>
    pick(`调用 ${count} 次，最近 ${recent}`, `Used ${count} times, last ${recent}`),
  // ── 双作用域开关 ────────────────────────────────────────────────────
  scopeGlobal: (): string => pick('全局', 'Global'),
  scopeProject: (): string => pick('本项目', 'This project'),
  scopeAria: (name: string, scope: string, on: boolean, disabled: boolean): string =>
    pick(
      `${name} ${scope}作用域：${on ? '已启用' : '已禁用'}${disabled ? '（不可切换）' : ''}`,
      `${name} ${scope} scope: ${on ? 'enabled' : 'disabled'}${disabled ? ' (unavailable)' : ''}`,
    ),
  scopeTitle: (scope: string, on: boolean, disabled: boolean): string => {
    const state = disabled ? pick('不可切换', 'unavailable') : on ? pick('启用', 'on') : pick('关闭', 'off')
    return pick(`${scope}作用域：${state}`, `${scope} scope: ${state}`)
  },
  footAnomaly: (): string => pick('扫描异常 · 不可管理', 'Scan issue · not manageable'),
  footNoProject: (): string => pick('未绑定项目 · 本项目不可用', 'No project · this scope unavailable'),
  footGlobalOff: (): string => pick('全局关闭 · 本项目不生效', 'Globally off · project scope inactive'),
  footProjectOff: (): string => pick('本项目作用域已关闭', 'Project scope is off'),
  // ── 焦点详情 ────────────────────────────────────────────────────────
  detailPath: (): string => pick('路径', 'Path'),
  detailProvider: (): string => 'Provider',
  detailInvocation: (): string => pick('调用能力', 'Invocation'),
  detailSource: (): string => pick('来源', 'Source'),
  detailCollected: (): string => pick('已收录', 'Cataloged'),
  detailDiscovered: (): string => pick('目录发现', 'Scan-discovered'),
  detailScanIssue: (): string => pick('扫描异常', 'Scan issue'),
  detailScopes: (): string => pick('作用域', 'Scopes'),
  detailReason: (): string => pick('原因', 'Reason'),
  detailSuggestion: (): string => pick('建议', 'Suggestion'),
  scopeUnavailable: (): string => pick('扫描异常 · 不可用', 'Scan issue · unavailable'),
  scopeState: (on: boolean): string => (on ? pick('启用', 'on') : pick('关闭', 'off')),
  capModel: (): string => pick('模型可调用', 'Model invocable'),
  capUser: (): string => pick('用户可调用', 'User invocable'),
  previewTitle: (): string => 'SKILL.md',
  previewFirstLines: (): string => pick('前 15 行', 'First 15 lines'),
  previewUnavailable: (): string => pick('无法读取', 'Unavailable'),
  previewLoading: (): string => pick('读取中…', 'Loading…'),
  previewEmpty: (): string => pick('（SKILL.md 为空）', '(SKILL.md is empty)'),
  copyFull: (): string => pick('复制全文', 'Copy all'),
  copyPathAria: (name: string): string => pick(`复制 ${name} 的路径`, `Copy path of ${name}`),
  copyMdAria: (name: string): string => pick(`复制 ${name} 的 SKILL.md 全文`, `Copy full SKILL.md of ${name}`),
  copyPathDone: (): string => pick('已复制路径', 'Path copied'),
  copyMdDone: (): string => pick('已复制 SKILL.md 全文', 'Full SKILL.md copied'),
  copyFailed: (): string => pick('复制失败，请手动选择文本', 'Copy failed, select the text manually'),
  copyEmpty: (): string => pick('没有可复制的内容', 'Nothing to copy'),
  retry: (): string => pick('重试', 'Retry'),
  usageCallsUnit: (): string => pick('次调用', 'calls'),
  usageVia: (via: string): string =>
    via === 'model' ? pick('模型调用', 'Model call') : via === 'user' ? pick('用户调用', 'User call') : '—',
  usageRecent: (time: string): string => pick(`最近 ${time}`, `Last ${time}`),
  usageViaNone: (): string => '—',
  truncatedNote: (): string => pick('（已截断至 256KB）', '(truncated to 256KB)'),
  // ── 内联错误 / toast ────────────────────────────────────────────────
  inlineErrorTitle: (name: string): string => pick(`未能更新「${name}」`, `Could not update "${name}"`),
  updateFailedToast: (): string => pick('更新失败 · 可在行内重试', 'Update failed · retry inline'),
  toggleOnToast: (name: string, scope: string): string =>
    pick(`已启用「${name}」 · ${scope}`, `Enabled "${name}" · ${scope}`),
  toggleOffToast: (name: string, scope: string): string =>
    pick(`已禁用「${name}」 · ${scope}`, `Disabled "${name}" · ${scope}`),
  // ── 批量条 ──────────────────────────────────────────────────────────
  bulkSelected: (count: number): string => pick(`已选 ${count} 项`, `${count} selected`),
  bulkSkip: (count: number): string => pick(`${count} 项异常将跳过`, `${count} issues will be skipped`),
  bulkEnable: (): string => pick('启用', 'Enable'),
  bulkDisable: (): string => pick('禁用', 'Disable'),
  bulkExit: (): string => pick('退出', 'Exit'),
  bulkExitAria: (): string => pick('退出选择模式', 'Exit selection mode'),
  bulkEnableAria: (): string => pick('批量启用所选技能', 'Enable selected skills'),
  bulkDisableAria: (): string => pick('批量禁用所选技能', 'Disable selected skills'),
  confirmTitle: (count: number): string =>
    pick(
      `确认禁用 ${count} 项技能？全局与本项目作用域都会关闭。`,
      `Disable ${count} skills? Both the global and project scopes will be turned off.`,
    ),
  confirmSkipNote: (count: number): string => pick(`${count} 项异常将跳过。`, `${count} issues will be skipped.`),
  confirmDisable: (): string => pick('确认禁用', 'Disable'),
  confirmCancel: (): string => pick('取消', 'Cancel'),
  // ── 空态 / 加载 / 失败 ───────────────────────────────────────────────
  loadingAria: (): string => pick('正在读取技能目录', 'Reading skill directories'),
  emptyNoDataTitle: (): string => pick('技能台还是空的', 'The skill deck is empty'),
  emptyNoDataBody: (): string =>
    pick(
      '没有扫描到任何 skill。确认项目与用户技能目录存在后，重新扫描一次。',
      'No skills were found. Check the project and user skill directories, then rescan.',
    ),
  emptyNoResultTitle: (query: string): string => pick(`没有找到「${query}」`, `No matches for "${query}"`),
  emptyNoResultBody: (): string =>
    pick(
      '试试缩短关键词，或清除来源与状态筛选后再看一次。',
      'Try a shorter keyword, or clear the source and status filters and search again.',
    ),
  emptyFilteredTitle: (): string => pick('没有符合条件的技能', 'No skills match'),
  emptyFilteredBody: (): string =>
    pick(
      '当前来源与状态筛选组合下没有结果。重置筛选，或换一个来源继续看。',
      'No results for this combination of source and status filters. Reset the filters or pick another source.',
    ),
  emptyNoProjectTitle: (): string => pick('没有可用的项目上下文', 'No project context'),
  emptyNoProjectBody: (): string =>
    pick(
      '当前窗口没有打开项目。项目级 skill 不会出现在技能台，卡片上的「本项目」开关也暂不可用。',
      'No project is open in this window. Project skills are not listed and the project scope switch is unavailable.',
    ),
  emptyNoProjectPreview: (): string => pick('未绑定项目 · 已禁用', 'No project · disabled'),
  emptyNoProjectToggle: (): string =>
    pick('本项目作用域（未绑定项目，已禁用）', 'Project scope (no project bound, disabled)'),
  emptyClearSearch: (): string => pick('清除搜索', 'Clear search'),
  emptyResetFilters: (): string => pick('重置筛选', 'Reset filters'),
  emptyRescan: (): string => pick('重新扫描', 'Rescan'),
  emptyShowAll: (): string => pick('查看全部来源', 'Show all sources'),
  errorTitle: (): string => pick('扫描失败', 'Scan failed'),
  errorHint: (): string =>
    pick(
      '读取技能目录时出错。请检查目录权限或宿主日志后重试。',
      'Reading the skill directories failed. Check directory permissions or the host log, then retry.',
    ),
  retryScan: (): string => pick('重试扫描', 'Retry scan'),
  listFailedFallback: (): string => pick('读取技能目录失败', 'Failed to read skill directories'),
  rescanFailedFallback: (): string => pick('重新扫描失败', 'Rescan failed'),
  detailFailedFallback: (): string => pick('读取 SKILL.md 失败', 'Failed to read SKILL.md'),
  saveFailedFallback: (): string => pick('保存失败', 'Failed to save'),
  scanDoneToast: (all: number, anomaly: number): string =>
    pick(`扫描完成 · ${all} 项，${anomaly} 项异常`, `Scan complete · ${all} skills, ${anomaly} issues`),
  scanFailedToast: (): string => pick('扫描失败', 'Scan failed'),
  projectUnavailableToast: (): string =>
    pick('未绑定项目，本项目作用域不可用', 'No project bound; project scope unavailable'),
  noEligibleToast: (): string => pick('所选项目没有可切换的普通技能', 'No ordinary skills in the selection'),
  batchFailedToast: (): string => pick('批量更新失败', 'Bulk update failed'),
  batchOnToast: (count: number): string => pick(`已启用 ${count} 项`, `Enabled ${count} skills`),
  batchOffToast: (count: number): string => pick(`已禁用 ${count} 项`, `Disabled ${count} skills`),
  batchSkipToast: (count: number): string => pick(` · 跳过 ${count} 项异常`, ` · skipped ${count} issues`),
  // ── 诊断台 ──────────────────────────────────────────────────────────
  diagTitle: (): string => pick('诊断', 'Diagnostics'),
  diagSubtitle: (count: number, time: string): string =>
    pick(`${count} 项异常 · 上次扫描 ${time}`, `${count} issues · last scan ${time}`),
  diagBack: (): string => pick('返回技能台', 'Back to the skill deck'),
  diagRescan: (): string => pick('重新扫描', 'Rescan'),
  diagFoot: (): string =>
    pick(
      '扫描范围：本项目 · 用户 · 内置。修复目录后重新扫描即可恢复收录。',
      'Scope: project · user · built-in. Fix the directory and rescan to restore it.',
    ),
  diagEmpty: (): string => pick('没有异常条目', 'No issues found'),
  diagReason: (): string => pick('原因', 'Reason'),
  diagSuggestion: (): string => pick('建议', 'Suggestion'),
  // ── 紧凑表 ──────────────────────────────────────────────────────────
  tableAria: (): string => pick('技能紧凑表', 'Compact skill table'),
  colName: (): string => pick('名称', 'Name'),
  colSource: (): string => pick('来源', 'Source'),
  colUsage: (): string => pick('使用', 'Uses'),
  colRecent: (): string => pick('最近', 'Recent'),
  colScope: (): string => pick('作用域', 'Scopes'),
  colScopeTitle: (): string => pick('作用域：左为全局，右为本项目', 'Scopes: left global, right this project'),
  selectAllAria: (): string => pick('选择当前视图全部技能', 'Select all skills in the current view'),
  selectRowAria: (name: string): string => pick(`选择 ${name}`, `Select ${name}`),
  sortByAria: (label: string): string => pick(`按${label}排序`, `Sort by ${label}`),
  recentNever: (): string => pick('从未使用', 'Never used'),
  // ── 诊断原因 ────────────────────────────────────────────────────────
  reasonShort: (reason: string): string => {
    const meta = REASON_META[reason]
    return meta === undefined ? reason : pick(meta.label[0], meta.label[1])
  },
  reasonText: (reason: string): string => {
    const meta = REASON_META[reason]
    return meta === undefined ? reason : pick(meta.reason[0], meta.reason[1])
  },
  reasonSuggestion: (reason: string): string => {
    const meta = REASON_META[reason]
    return meta === undefined ? '' : pick(meta.suggestion[0], meta.suggestion[1])
  },
}
