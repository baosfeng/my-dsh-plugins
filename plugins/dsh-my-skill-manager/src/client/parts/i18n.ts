// ── i18n ──────────────────────────────────────────────────────────────
function isZh(): boolean {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

/** 诊断原因 → 可读文案（未知原因原样返回）。 */
const DIAG_REASONS: Record<string, string> = {
  'broken-symlink': '符号链接无法解析（目标不存在）',
  'missing-skills-md': '目录缺少 SKILL.md',
  'missing-frontmatter': '缺少 YAML frontmatter',
  'missing-name-description': 'frontmatter 缺少 name 或 description',
  'invalid-name': 'skill 名称不符合 kebab-case 规范',
  unparseable: 'frontmatter 解析失败或字段异常（官方扫描器未收录）',
}

const strings = {
  title: (): string => (isZh() ? 'Skill 管理' : 'Skill Manager'),
  globalSection: (): string => (isZh() ? '全局' : 'Global'),
  projectSection: (): string => (isZh() ? '当前项目' : 'Current project'),
  refresh: (): string => (isZh() ? '刷新' : 'Refresh'),
  enabled: (): string => (isZh() ? '启用' : 'Enabled'),
  disabled: (): string => (isZh() ? '已禁用' : 'Disabled'),
  loading: (): string => (isZh() ? '加载中…' : 'Loading…'),
  loadError: (): string => (isZh() ? '加载失败' : 'Load failed'),
  empty: (): string => (isZh() ? '暂无 skill' : 'No skills yet'),
  emptyHint: (): string =>
    isZh() ? 'skill 目录为空或尚未扫描，点击右上角刷新重新扫描' : 'No skills found yet; click refresh to rescan',
  sourceProject: (source: string): string => (isZh() ? `项目（${source}）` : `project (${source})`),
  sourceGlobal: (source: string): string => (isZh() ? `全局（${source}）` : `global (${source})`),
  notCataloged: (): string => (isZh() ? '未收录' : 'Not cataloged'),
  notCatalogedHint: (): string =>
    isZh()
      ? '该 skill 存在于目录但未被官方目录收录（不注入会话）；可能是 filesystem 发现未启用或扫描器跳过'
      : 'This skill exists on disk but is not in the official catalog (not injected); filesystem discovery may be disabled or the scanner skipped it',
  disabledHint: (): string =>
    isZh()
      ? '禁用的 skill 不再注入本项目/全局会话：模型不可见、不可加载（占位覆盖）'
      : 'A disabled skill is no longer injected into this scope: the model cannot see or load it (placeholder override)',
  projectRoot: (): string => (isZh() ? '项目根：' : 'Project root: '),
  saved: (): string => (isZh() ? '已保存' : 'Saved'),
  saveFailed: (): string => (isZh() ? '保存失败' : 'Save failed'),
  diagnosticsTitle: (): string => (isZh() ? '扫描诊断' : 'Scan diagnostics'),
  diagBadge: (): string => (isZh() ? '跳过' : 'Skipped'),
  diagnosticsHint: (): string =>
    isZh()
      ? '以下条目存在于 skill 目录但未被收录（可能被官方扫描器跳过）：'
      : 'These entries exist in a skill directory but were not cataloged (likely skipped by the scanner):',
  diagReason: (reason: string): string => (isZh() ? (DIAG_REASONS[reason] ?? reason) : reason),
  // ── usage statistics (issue #91) ──────────────────────────────────────
  usageCount: (n: number): string => (isZh() ? `使用 ${n} 次` : `Used ${n} times`),
  usageNever: (): string => (isZh() ? '未使用' : 'Never used'),
  usageLast: (t: string): string => (isZh() ? `最近 ${t}` : `Last used ${t}`),
  usageSourceModel: (): string => (isZh() ? '模型' : 'model'),
  usageSourceUser: (): string => (isZh() ? '用户' : 'user'),
  sortName: (): string => (isZh() ? '名称' : 'Name'),
  sortCount: (): string => (isZh() ? '次数' : 'Uses'),
  sortLastUsed: (): string => (isZh() ? '最近' : 'Recent'),
  unusedOnly: (): string => (isZh() ? '未使用' : 'Unused'),
  unusedOnlyHint: (): string => (isZh() ? '只看未使用的 skill' : 'Show only unused skills'),
  usageHint: (): string =>
    isZh()
      ? '使用统计记录 skill 被加载/注入的次数与最近时间（模型 skill 工具 / 用户 /name 手势），持久化于 $DSH_HOME/skills.usage.json'
      : 'Usage tracks how often a skill was loaded/injected (model skill tool / user /name gesture), persisted in $DSH_HOME/skills.usage.json',
}
