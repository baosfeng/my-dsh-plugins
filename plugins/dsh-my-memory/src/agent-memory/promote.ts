/**
 * dsh-my-memory — 面板分组视图 + **跨项目晋升**（issue #502 后续）。
 *
 * 两件用户可感知的事都收在这里（route.ts 只做 HTTP 编排）：
 *
 *  A. **分组**：面板不再平铺全部文件，而是「全局一份 + 每个项目一份」。分组
 *     顺序 = 全局恒在最前，项目按最后写入时间倒序——最近写过的项目排第一，
 *     面板默认展开它（用户刚动过的多半就是它）。
 *
 *  B. **晋升建议**：同一事实被写进 ≥2 个项目层是当前最贵的重复（实测
 *     android-monitor 与 my-dsh-plugins 都记了「门禁假红」）。判据不是模型
 *     语义，而是 duplicates.ts 的**字符级相似度**（同一份确定性判据，阈值
 *     不另设），跨 project id 命中即建议晋升到 user.md。
 *
 * 晋升语义（用户点「晋升到 user.md」并确认后）：
 *  1. 追加该条进 user.md（全局层）；
 *  2. 从涉及的每个项目文件里**删掉**这条（整份覆盖重写）；
 *  3. 写入前先过 store 的校验（4 KB / 60 条 / 100 字 / 敏感信息），并复用
 *     tools.globalScopeReject 的护栏——含路径 / IP / 端口 / 仓库名的条目
 *     **不许进全局**，拒绝原因原样返回给面板展示；
 *  4. 先删项目层再写全局层：这样追加进 user.md 时不会撞上「与 projects/…
 *     重复」的去重护栏；写 user.md 失败则把已删文件回滚。
 */
import { DUPLICATE_THRESHOLD, similarity } from './duplicates.js'
import { entryLinesOf } from './paths.js'
import { globalScopeReject } from './tools.js'
import type { AgentMemoryStore } from './store.js'

/** 面板上一份记忆（本模块只依赖这几个字段，完整视图见 route.ts）。 */
export interface PanelEntry {
  name: string
  projectName?: string
  content: string
  updatedAt: number
  archived: boolean
}

/** 一个分组：全局一份 + 每个项目一份（entries 原样带正文，前端直接渲染）。 */
export interface AgentMemoryGroup<T extends PanelEntry = PanelEntry> {
  /** 稳定开关 id：global / project:<id>（避免与项目 id 撞名）。 */
  id: string
  kind: 'global' | 'project'
  /** 项目 id（hash）；全局组没有。 */
  projectId?: string
  /** 项目可读名（未记录时退回 id）。 */
  projectName?: string
  entries: T[]
  count: number
  /** 组内最晚写入时间（分组排序用）。 */
  latestUpdatedAt: number
}

/** 晋升时会被删除的一处（项目文件 + 那一行）。 */
export interface PromoteSource {
  name: string
  projectId: string
  projectName: string
  line: string
}

/** 一条跨项目晋升建议。 */
export interface PromoteSuggestion {
  /** 建议晋升的条目正文（簇里最具体的那条，不带列表符号）。 */
  text: string
  /** 各来源里最弱的一环（保守展示，不拿最强的一对误导用户）。 */
  similarity: number
  /** 涉及的项目文件（每个项目取最相似的一行）。 */
  sources: PromoteSource[]
  /** 不能进全局的原因（路径 / 地址 / 端口 / 仓库名）；null = 可晋升。 */
  blocked: string | null
}

/** 晋升结果：成功无正文，失败给可操作原因。 */
export type PromoteOutcome = { ok: true } | { ok: false; error: string }

/** 全局层文件（晋升的写入目标）。 */
const GLOBAL_FILE = 'user.md'

/** 项目层路径前缀。 */
const PROJECT_PREFIX = 'projects'

/** 项目 id（projects/<id>/<file>）或空串（全局层文件）。 */
export function projectIdOf(name: string): string {
  const parts = name.split('/')
  return parts.length === 3 && parts[0] === PROJECT_PREFIX ? (parts[1] ?? '') : ''
}

/** 项目可读名：优先索引里记过的名字，未记录时退回 id（面板显示全名而非截断）。 */
function projectLabelOf(id: string, projectNames: Record<string, string>): string {
  return projectNames[id] ?? id
}

/** 新建一个空分组（id 空串 = 全局组）。 */
function emptyGroup<T extends PanelEntry>(id: string, projectNames: Record<string, string>): AgentMemoryGroup<T> {
  if (id === '') return { id: 'global', kind: 'global', entries: [], count: 0, latestUpdatedAt: 0 }
  return {
    id: 'project:' + id,
    kind: 'project',
    projectId: id,
    projectName: projectLabelOf(id, projectNames),
    entries: [],
    count: 0,
    latestUpdatedAt: 0,
  }
}

/** 把一个条目录进它所属的分组（原地累加）。 */
function addToGroup<T extends PanelEntry>(
  groups: Map<string, AgentMemoryGroup<T>>,
  entry: T,
  projectNames: Record<string, string>,
): void {
  const id = projectIdOf(entry.name)
  const group = groups.get(id) ?? emptyGroup<T>(id, projectNames)
  group.entries.push(entry)
  group.count += 1
  group.latestUpdatedAt = Math.max(group.latestUpdatedAt, entry.updatedAt)
  groups.set(id, group)
}

/** 分组顺序：全局恒在最前，项目按最后写入时间倒序（同时刻按 id 稳定排序）。 */
function compareGroups(a: AgentMemoryGroup, b: AgentMemoryGroup): number {
  if (a.kind !== b.kind) return a.kind === 'global' ? -1 : 1
  return b.latestUpdatedAt - a.latestUpdatedAt || a.id.localeCompare(b.id)
}

/**
 * 面板分组：全局一份 + 每个项目一份。
 *
 * 只装**活跃**条目——已归档的记忆在面板里是单独的归档区（只读 + 恢复），
 * 混进分组会让「恢复」按钮和普通卡片的编辑操作混在一起。
 */
export function buildGroups<T extends PanelEntry>(
  entries: readonly T[],
  projectNames: Record<string, string>,
): AgentMemoryGroup<T>[] {
  const groups = new Map<string, AgentMemoryGroup<T>>()
  for (const entry of entries) if (!entry.archived) addToGroup(groups, entry, projectNames)
  return [...groups.values()].sort(compareGroups)
}

/** 项目层的一条（跨项目比对的最小单位：文件 + 项目 + 行）。 */
interface ProjectLine {
  name: string
  projectId: string
  projectName: string
  line: string
}

/** 抽取所有活跃项目层条目行（全局层文件不参与跨项目比对——它们已经是全局）。 */
function projectLines(entries: readonly PanelEntry[], projectNames: Record<string, string>): ProjectLine[] {
  const out: ProjectLine[] = []
  for (const entry of entries) {
    if (entry.archived) continue
    const projectId = projectIdOf(entry.name)
    if (projectId === '') continue
    // 条目自带的 projectName 是面板视图已经查好的名字，优先用它（没有时退回索引/id）。
    const projectName = entry.projectName ?? projectLabelOf(projectId, projectNames)
    for (const line of entryLinesOf(entry.content)) out.push({ name: entry.name, projectId, projectName, line })
  }
  return out
}

/** 并查集查根（路径压缩）。 */
function rootOf(parent: number[], index: number): number {
  let current = index
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]] ?? current
    current = parent[current] ?? current
  }
  return current
}

/** 并查集连边：相似即同簇（传递闭包，同一事实的两种措辞不会被拆成两簇）。 */
function link(parent: number[], left: number, right: number): void {
  const a = rootOf(parent, left)
  const b = rootOf(parent, right)
  if (a !== b) parent[b] = a
}

/**
 * 把项目层条目行按相似度聚簇（阈值与去重护栏同一个：duplicates.DUPLICATE_THRESHOLD）。
 *
 * 传递闭包而不是「两两成对」：A≈B、B≈C 时 A 与 C 也算同一事实——否则同一
 * 事实的三个变体会冒出多条互相重叠的建议。
 */
function clusterLines(lines: readonly ProjectLine[]): ProjectLine[][] {
  const parent = lines.map((_, index) => index)
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (similarity(lines[i]?.line ?? '', lines[j]?.line ?? '') >= DUPLICATE_THRESHOLD) link(parent, i, j)
    }
  }
  const buckets = new Map<number, ProjectLine[]>()
  lines.forEach((line, index) => {
    const key = rootOf(parent, index)
    buckets.set(key, [...(buckets.get(key) ?? []), line])
  })
  return [...buckets.values()]
}

/** 一簇里最具体的那条（最长；等长取先出现者，保证同一份数据永远给同一条建议）。 */
function representativeOf(cluster: readonly ProjectLine[]): ProjectLine {
  return cluster.reduce((best, line) => (line.line.length > best.line.length ? line : best))
}

/** 带分数的来源（分数只用于挑行与算相似度，不发给前端）。 */
interface ScoredSource extends PromoteSource {
  score: number
}

/** 每个项目各取一行：与代表行最相似的那行（同分取先出现者，结果确定）。 */
function sourcesOf(cluster: readonly ProjectLine[], text: string): ScoredSource[] {
  const byProject = new Map<string, ScoredSource>()
  for (const line of cluster) {
    const score = similarity(line.line, text)
    const seen = byProject.get(line.projectId)
    if (seen !== undefined && seen.score >= score) continue
    byProject.set(line.projectId, {
      name: line.name,
      projectId: line.projectId,
      projectName: line.projectName,
      line: line.line,
      score,
    })
  }
  return [...byProject.values()].sort((a, b) => a.projectId.localeCompare(b.projectId))
}

/** 去掉分数后的来源（发给面板的那一份）。 */
function sourceOf({ name, projectId, projectName, line }: ScoredSource): PromoteSource {
  return { name, projectId, projectName, line }
}

/**
 * 进全局层的护栏：复用 tools.globalScopeReject（**不改它的判据**）。
 *
 * 面板没有会话 cwd，但这条内容恰恰出自那几个项目——把 /<项目名> 当 cwd
 * 传进去，globalScopeReject 的 basename 判据就变成「是否点名了涉及的项目」，
 * 与它原本「点名当前仓库就不许进全局」的语义完全一致。空串兜底覆盖路径 /
 * IP / 端口的纯文本判据。
 */
function rejectReason(text: string, projectNames: readonly string[]): string | null {
  for (const name of projectNames) {
    const reason = globalScopeReject(GLOBAL_FILE, '- ' + text, '/' + name)
    if (reason !== null) return reason
  }
  return globalScopeReject(GLOBAL_FILE, '- ' + text, '')
}

/** 一簇 → 一条建议；跨不到 2 个项目就不算「跨项目」，返回 null。 */
function suggestionOf(cluster: readonly ProjectLine[]): PromoteSuggestion | null {
  const text = representativeOf(cluster).line
  const sources = sourcesOf(cluster, text)
  if (sources.length < 2) return null
  return {
    text,
    similarity: sources.reduce((min, source) => Math.min(min, source.score), 1),
    sources: sources.map(sourceOf),
    blocked: rejectReason(
      text,
      sources.map((source) => source.projectName),
    ),
  }
}

/**
 * 跨项目晋升建议：同一事实出现在 ≥2 个不同项目层里。
 *
 * 排序：涉及项目越多越靠前，其次相似度高，最后按文本稳定排序——面板顶部
 * 只放最值得处理的那几条。
 */
export function buildSuggestions(
  entries: readonly PanelEntry[],
  projectNames: Record<string, string>,
): PromoteSuggestion[] {
  const out: PromoteSuggestion[] = []
  for (const cluster of clusterLines(projectLines(entries, projectNames))) {
    const suggestion = suggestionOf(cluster)
    if (suggestion !== null) out.push(suggestion)
  }
  return out.sort(
    (a, b) => b.sources.length - a.sources.length || b.similarity - a.similarity || a.text.localeCompare(b.text),
  )
}

/** 去掉与 text 相似的条目行（非条目行原样保留，整份覆盖重写用）。 */
function withoutLines(content: string, text: string): string {
  return content
    .split('\n')
    .filter((line) => {
      if (!/^\s*-\s+\S/.test(line)) return true
      return similarity(line.replace(/^\s*-\s+/, '').trim(), text) < DUPLICATE_THRESHOLD
    })
    .join('\n')
}

/** 追加一条条目（与既有正文以换行分隔；文件末尾有无换行都不产生空行）。 */
function appendLine(content: string, text: string): string {
  const entry = '- ' + text
  const body = content.replace(/\n+$/, '')
  return body === '' ? entry : body + '\n' + entry
}

/** 一次待写的整份覆盖（before 用于失败回滚）。 */
interface Rewrite {
  name: string
  before: string
  after: string
}

/** 规划「删掉该条」的重写；任一文件已变样（行不在了）→ null（建议已过期）。 */
async function planRewrites(store: AgentMemoryStore, suggestion: PromoteSuggestion): Promise<Rewrite[] | null> {
  const out: Rewrite[] = []
  for (const source of suggestion.sources) {
    const before = await store.readForPanel(source.name)
    if (before === null) return null
    const after = withoutLines(before, suggestion.text)
    if (after === before) return null
    out.push({ name: source.name, before, after })
  }
  return out
}

/** 回滚已写入的项目文件（尽力而为：回滚失败不掩盖原始错误）。 */
async function rollback(store: AgentMemoryStore, done: readonly Rewrite[]): Promise<void> {
  for (const rewrite of done) await store.write(rewrite.name, rewrite.before)
}

/**
 * 执行晋升：项目层删该条 → 追加进 user.md（写全局失败则回滚项目层）。
 *
 * 顺序不可颠倒：先写 user.md 会撞上 duplicates 的「与 projects/… 重复」护栏
 * ——那条重复正是我们要合并掉的东西。所以先删再写，写失败再把删掉的恢复回去。
 */
export async function promoteToGlobal(
  store: AgentMemoryStore,
  suggestion: PromoteSuggestion,
): Promise<PromoteOutcome> {
  if (suggestion.blocked !== null) return { ok: false, error: '不能进全局层：' + suggestion.blocked }
  const before = (await store.readForPanel(GLOBAL_FILE)) ?? ''
  const after = appendLine(before, suggestion.text)
  const invalid = store.validate(after)
  if (invalid !== null) return { ok: false, error: invalid }
  const rewrites = await planRewrites(store, suggestion)
  if (rewrites === null) return { ok: false, error: '这条建议已变化（项目文件里没有对应条目了），刷新面板后再试' }
  const done: Rewrite[] = []
  for (const rewrite of rewrites) {
    const result = await store.write(rewrite.name, rewrite.after)
    if (!result.ok) {
      await rollback(store, done)
      return { ok: false, error: result.error }
    }
    done.push(rewrite)
  }
  const appended = await store.write(GLOBAL_FILE, after)
  if (!appended.ok) {
    await rollback(store, done)
    return { ok: false, error: appended.error }
  }
  return { ok: true }
}
