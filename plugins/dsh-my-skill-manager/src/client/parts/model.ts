// ── model：列表派生模型（分组 / 计数 / 筛选 / 排序 / 格式化 / 复制）──────
// 服务端只给「原始事实」（skills[] + 两个禁用名单 + diagnostics + usage），
// 所有视图状态都在这里推导：来源分组、全局/本项目开关、概览计数、
// 筛选与排序、时间格式化。保持纯函数，便于单测与渲染层复用。
//
// 语义要点（0.2.1 修正）：cataloged:false 只表示「该行由目录扫描发现、当前
// 调用方看不到宿主 catalog 条目」（skills.list() 不带 scope 时只读 global
// 层），它仍然是可管理的正常 skill —— 照常按 source 分组、两个开关照常用
// 两个禁用名单推导。异常只认 diagnostics.missing[]（missing:true）的行。

/** 卡片流分组顺序：项目 → 用户 → 内置 → 其他 → 扫描异常。 */
const SOURCE_GROUP_ORDER: Record<SourceGroup, number> = {
  project: 0,
  user: 1,
  bundled: 2,
  other: 3,
  anomaly: 4,
}

/** 宿主官方 source 字符串 → 视图分组（project-* / user-* / bundled|runtime / 其他）。 */
function groupSource(source: string): SourceGroup {
  const value = source.toLowerCase()
  if (value.indexOf('project') !== -1) return 'project'
  if (value.indexOf('user') !== -1 || value.indexOf('agent') !== -1) return 'user'
  if (value.indexOf('bundled') !== -1 || value.indexOf('builtin') !== -1 || value.indexOf('runtime') !== -1) {
    return 'bundled'
  }
  return 'other'
}

/** 一行是否异常：只认 diagnostics.missing[]（扫描失败的条目）。 */
function isAnomaly(item: SkillItem): boolean {
  return item.missing
}

/** usage 次数（无统计 = 0）。 */
function usageCountOf(item: SkillItem): number {
  return item.usage === null ? 0 : item.usage.count
}

/** 最近使用时间戳（无统计 = 0）。 */
function lastUsedOf(item: SkillItem): number {
  return item.usage === null ? 0 : item.usage.lastUsedAt
}

/** skills[] 的一行 → SkillItem（名称为空返回 null）。 */
function toSkillItem(row: ServerSkillRow, list: ListValue): SkillItem | null {
  const name = asString(row.name).trim()
  if (name === '') return null
  const source = asString(row.source)
  return {
    key: 'skill:' + name,
    name,
    description: asString(row.description),
    source,
    // 扫描发现的正常 skill 也按来源分组；cataloged 只影响详情里的中性说明。
    group: groupSource(source),
    provider: asString(row.provider),
    path: asString(row.path),
    cataloged: row.cataloged !== false,
    missing: false,
    reason: '',
    invocation: normalizeInvocation(row.invocation),
    usage: normalizeUsage(row.usage) ?? list.usage[name] ?? null,
    // 双作用域只看两个禁用名单，不依赖宿主 catalog 可见性。
    globalOn: list.globalDisabled.indexOf(name) === -1,
    projectOn: list.projectDisabled.indexOf(name) === -1,
  }
}

/** diagnostics.missing[] 的一条 → 异常行（name/path 都为空返回 null）。 */
function missingToItem(entry: ServerMissingRow): SkillItem | null {
  const name = asString(entry.name).trim()
  const path = asString(entry.path).trim()
  if (name === '' && path === '') return null
  const reason = asString(entry.reason)
  return {
    key: 'missing:' + (path === '' ? name : path),
    name: name === '' ? path : name,
    description: '',
    source: '',
    group: 'anomaly',
    provider: '',
    path,
    cataloged: false,
    missing: true,
    reason: reason === '' ? 'parse-failed' : reason,
    invocation: null,
    usage: null,
    globalOn: false,
    projectOn: false,
  }
}

/** 去重后追加一行（key 已存在则跳过）。 */
function pushUnique(items: SkillItem[], seen: Set<string>, item: SkillItem | null): void {
  if (item === null) return
  if (seen.has(item.key)) return
  seen.add(item.key)
  items.push(item)
}

/** /list → 每行一个 SkillItem（skills[] + diagnostics.missing[]）。 */
function buildItems(list: ListValue): SkillItem[] {
  const items: SkillItem[] = []
  const seen = new Set<string>()
  for (const row of list.skills) pushUnique(items, seen, toSkillItem(row, list))
  for (const entry of list.missing) pushUnique(items, seen, missingToItem(entry))
  return items
}

/** 概览计数：全部 = 启用 + 禁用 + 异常；来源计数按分组；未使用按调用次数 0。 */
function countsOf(items: SkillItem[]): CountsValue {
  const counts: CountsValue = {
    all: 0,
    enabled: 0,
    disabled: 0,
    anomaly: 0,
    project: 0,
    user: 0,
    bundled: 0,
    other: 0,
    unused: 0,
  }
  for (const item of items) {
    counts.all += 1
    if (item.group !== 'anomaly') counts[item.group] += 1
    if (isAnomaly(item)) counts.anomaly += 1
    else if (item.globalOn) counts.enabled += 1
    else counts.disabled += 1
    // 「只看未使用」只统计可管理的 skill（扫描失败的条目没有使用语义）。
    if (!isAnomaly(item) && usageCountOf(item) === 0) counts.unused += 1
  }
  return counts
}

/** 来源筛选（all 表示不筛）。 */
function matchesSource(item: SkillItem, source: string): boolean {
  return source === 'all' || item.group === source
}

/** 状态筛选：启用 / 禁用看全局作用域（含扫描发现的正常行）；异常只认扫描失败。 */
function matchesStatus(item: SkillItem, status: string): boolean {
  if (status === 'enabled') return !isAnomaly(item) && item.globalOn
  if (status === 'disabled') return !isAnomaly(item) && !item.globalOn
  if (status === 'anomaly') return isAnomaly(item)
  return true
}

/** 只看未使用（只筛可管理的 skill；扫描失败的条目不计入）。 */
function matchesUnused(item: SkillItem, unusedOnly: boolean): boolean {
  return !unusedOnly || (!isAnomaly(item) && usageCountOf(item) === 0)
}

/** 搜索名称 / 描述 / 路径 / provider / source。 */
function matchesQuery(item: SkillItem, query: string): boolean {
  if (query === '') return true
  const haystack = (
    item.name +
    ' ' +
    item.description +
    ' ' +
    item.path +
    ' ' +
    item.provider +
    ' ' +
    item.source
  ).toLowerCase()
  return haystack.indexOf(query) !== -1
}

/** 搜索 + 来源 + 状态 + 只看未使用（可叠加）。 */
function filterItems(items: SkillItem[], filters: FilterState): SkillItem[] {
  const query = filters.query.trim().toLowerCase()
  return items.filter(
    (item) =>
      matchesSource(item, filters.source) &&
      matchesStatus(item, filters.status) &&
      matchesUnused(item, filters.unusedOnly) &&
      matchesQuery(item, query),
  )
}

/** 四种排序：名称 / 使用次数 / 最近使用 / 来源（稳定：来源再按名称）。 */
function sortItems(items: SkillItem[], key: SortKey, dir: string): SkillItem[] {
  const factor = dir === 'asc' ? 1 : -1
  return items.slice().sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'en')
    let result = 0
    if (key === 'name') result = byName
    else if (key === 'usage') result = usageCountOf(a) - usageCountOf(b) || byName
    else if (key === 'recent') result = lastUsedOf(a) - lastUsedOf(b) || byName
    else result = SOURCE_GROUP_ORDER[a.group] - SOURCE_GROUP_ORDER[b.group] || byName
    return result * factor
  })
}

/** 按来源分组（保持排序结果内部的相对顺序）。 */
function groupItems(items: SkillItem[]): SkillGroup[] {
  const order: SourceGroup[] = ['project', 'user', 'bundled', 'other', 'anomaly']
  const groups: SkillGroup[] = []
  for (const group of order) {
    const members = items.filter((item) => item.group === group)
    if (members.length > 0) groups.push({ group, items: members })
  }
  return groups
}

/** 在禁用名单里启用/禁用一个名字（返回新数组，不改原值）。 */
function toggleNameInList(list: string[], name: string, disabled: boolean): string[] {
  const present = list.indexOf(name) !== -1
  if (disabled && !present) return list.concat([name])
  if (!disabled && present) return list.filter((entry) => entry !== name)
  return list.slice()
}

/** 批量：把一组名字统一设为启用/禁用。 */
function applyDisabledForNames(list: string[], names: string[], disabled: boolean): string[] {
  let next = list.slice()
  for (const name of names) next = toggleNameInList(next, name, disabled)
  return next
}

function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value)
}

/** epoch ms → HH:mm:ss（扫描时间）；0 → —。 */
function formatClock(ts: number): string {
  if (ts <= 0) return '—'
  const date = new Date(ts)
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
}

/** epoch ms → MM-DD HH:mm（最近使用）；0 → ''。 */
function formatRecent(ts: number): string {
  if (ts <= 0) return ''
  const date = new Date(ts)
  return (
    pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  )
}

/** 取前 N 行（SKILL.md 预览）。 */
function firstLines(text: string, count: number): string {
  return text.split('\n').slice(0, count).join('\n')
}

/** 由筛选状态推导当前高亮的概览数字。 */
function activeStatOf(filters: FilterState): string {
  if (filters.status === 'enabled') return 'enabled'
  if (filters.status === 'disabled') return 'disabled'
  if (filters.status === 'anomaly' || filters.source === 'anomaly') return 'anomaly'
  if (filters.source === 'all' && !filters.unusedOnly) return 'all'
  return ''
}

/** 点击卡片/表行时判定是否点在交互元素上（是则不触发展开）。 */
function isInteractiveEvent(event: unknown): boolean {
  if (event === null || typeof event !== 'object') return false
  const target = (event as { target?: unknown }).target
  if (target === null || typeof target !== 'object') return false
  const closest = (target as { closest?: unknown }).closest
  if (typeof closest !== 'function') return false
  return (
    (closest as (selector: string) => unknown).call(target, 'button,input,a,label,pre,code,textarea,select') !== null
  )
}

/** 复制到剪贴板：Clipboard API 优先，失败回退 textarea + execCommand。 */
function copyToClipboard(text: string): Promise<boolean> {
  if (text === '') return Promise.resolve(false)
  try {
    const nav = navigator as Navigator & { clipboard?: { writeText?: (value: string) => Promise<void> } }
    if (nav.clipboard !== undefined && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard.writeText(text).then(
        () => true,
        () => fallbackCopy(text),
      )
    }
  } catch {
    /* 无 Clipboard API 时走回退 */
  }
  return fallbackCopy(text)
}

function fallbackCopy(text: string): Promise<boolean> {
  try {
    if (typeof document === 'undefined' || document === null || document.body === null) return Promise.resolve(false)
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
    document.body.removeChild(area)
    return Promise.resolve(ok === true)
  } catch {
    return Promise.resolve(false)
  }
}
