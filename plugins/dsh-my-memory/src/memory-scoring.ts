/**
 * dsh-my-memory — progressive memory scoring / indexing (issue #78, TypeScript 源码)。
 *
 * 渐进式索引记忆的纯函数核心：结构化索引元数据、同主题渐进合并（置信度
 * 提升/内容更新/矛盾标记）、长期未用降权、以及按「相关性 + 时效性 +
 * 置信度」评分的智能注入选择（替代简单 top-N）。
 *
 * 设计约束：
 *  - 本模块是纯函数（无 I/O、无状态），全部逻辑可直接单测；
 *  - 存储兼容旧数据：`withDefaults` 给缺元数据的旧条目回退默认值，
 *    旧条目（无 category/source/confidence）按 category=fact、
 *    confidence=1 处理，绝不因缺字段丢失或崩溃；
 *  - 记忆绝不静默变更由调用方保证：自动提取只产生「候选」（待确认），
 *    本模块的合并只在用户确认写入时执行。
 */
import type * as MemoryTypes from './memory-types.js'

export type MemoryItem = MemoryTypes.MemoryItem
export type CandidateItem = MemoryTypes.CandidateItem
export type Category = MemoryTypes.Category
export type InjectionScore = MemoryTypes.InjectionScore
export type InjectionOptions = MemoryTypes.InjectionOptions
export type InjectionContext = MemoryTypes.InjectionContext

/** 记忆分类（issue #78 结构化索引）。 */
export const CATEGORIES = ['preference', 'fact', 'project', 'stack', 'workflow'] as const

/** 默认分类（旧数据/未标注候选回退）。 */
export const DEFAULT_CATEGORY: Category = 'fact'

/** 升权上限（超过不再累加，避免单条目无限膨胀）。 */
export const MAX_CONFIDENCE = 5

/** 降权后置信度下限（≥1，条目不会因降权消失）。 */
export const MIN_CONFIDENCE = 1

/** 默认降权阈值：90 天（issue #78「长期未用」语义）。 */
export const DEFAULT_DECAY_MS = 90 * 24 * 60 * 60 * 1000

/** 默认时效半衰期：7 天（issue #78「时效性」语义）。 */
export const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

/** 同主题大意描述（供主题归一化比较）。 */
function normalizeText(text: unknown): string {
  return String(text ?? '')
    .replace(/[\s，。！？、；：,.!?;:·…—_'"""''()（）【】]+/gu, '')
    .toLowerCase()
}

/** 规范化后的主题 key（category + 归一文本）。 */
export function themeKeyOf(item: Partial<MemoryItem>): string {
  return `${categoryOf(item)}|${normalizeText(descOf(item))}`
}

/** 归一化任意分类取值（枚举外/缺失回退默认分类）。 */
export function normalizeCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : DEFAULT_CATEGORY
}

/** 分类的中文标签（展示层单一来源，与 CATEGORIES 同键）。 */
const CATEGORY_LABELS: Record<Category, string> = {
  preference: '偏好',
  fact: '事实',
  project: '项目',
  stack: '技术栈',
  workflow: '工作流',
}

/** 取分类的中文标签（非法/缺失回退默认分类的标签；issue #192 工具输出用）。 */
export function categoryLabelOf(value: unknown): string {
  return CATEGORY_LABELS[normalizeCategory(value)]
}

/** 取条目的分类（缺省回退默认）。 */
function categoryOf(item: Partial<MemoryItem> | null | undefined): Category {
  return normalizeCategory(item?.category)
}

/** 取条目的 desc（容错）。 */
function descOf(item: Partial<MemoryItem> | null | undefined): string {
  return typeof item?.desc === 'string' ? item.desc : ''
}

/**
 * 两个条目是否「同一主题」（issue #78 渐进合并的同主题判定）：
 *  - 归一化文本完全相等时：同分类必然同主题；跨分类仅在至少一方是默认
 *    fact（用户手动条目未分类）时合并——自动提取的候选带明确分类
 *    （如同一句话「本项目用 vitest 测试」会产出 project 与 stack 两个
 *    候选），跨明确分类不合并，避免多维度候选坍缩成一个条目；
 *  - 归一化文本不同时：要求分类相同，且互为包含或互为**子序列**
 *    （保持顺序删掉若干字符后相等）——大意一致、措辞/程度不同
 *    （「回复使用中文」↔「回复必须使用中文」）；语义分歧
 *    （「回复使用中文」↔「回复使用英文」）不算同主题。
 */
export function sameTheme(a: Partial<MemoryItem>, b: Partial<MemoryItem>): boolean {
  const na = normalizeText(descOf(a))
  const nb = normalizeText(descOf(b))
  const ca = categoryOf(a)
  const cb = categoryOf(b)
  const nonEmpty = na !== '' && nb !== ''
  const sameText = na === nb
  const sameCategory = ca === cb
  const defaultCategory = ca === DEFAULT_CATEGORY || cb === DEFAULT_CATEGORY
  const contains = na.includes(nb) || nb.includes(na)
  const subsequence = isSubsequence(na, nb) || isSubsequence(nb, na)
  const equalTextMatch = sameCategory || defaultCategory
  const similarTextMatch = sameCategory && (contains || subsequence)
  return nonEmpty && (sameText ? equalTextMatch : similarTextMatch)
}

/** a 是否为 b 的子序列（保持顺序；短论文本按字符逐个匹配）。 */
function isSubsequence(a: string, b: string): boolean {
  const usable = a !== '' && a.length <= b.length * 2 + 2
  let index = 0
  for (const char of b) {
    if (usable && char === a[index]) index += 1
    if (index === a.length) return usable
  }
  return usable && index === a.length
}

/** 补齐条目元数据默认值（兼容旧数据；不修改原对象）。 */
export function withDefaults(item: Partial<MemoryItem> | null | undefined, now: number = Date.now()): MemoryItem {
  return {
    id: stringOr(item?.id, ''),
    desc: descOf(item),
    createdAt: finiteOr(item?.createdAt, now),
    updatedAt: finiteOr(item?.updatedAt, now),
    category: categoryOf(item),
    confidence: confidenceOf(item),
    status: statusOf(item),
    source: sourceOf(item?.source),
    relatedIds: stringListOf(item?.relatedIds),
    history: Array.isArray(item?.history) ? item.history : [],
  }
}

/** 字符串字段容错：非字符串回退默认值。 */
function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** 数值字段容错：非有限数回退默认值。 */
function finiteOr(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

/** 置信度容错：≥1 的有限数保留，否则 1。 */
function confidenceOf(item: Partial<MemoryItem> | null | undefined): number {
  return Number.isFinite(item?.confidence) && item!.confidence! >= 1 ? item!.confidence! : 1
}

/** 状态容错：仅 'conflict-pending' 被识别，其余一律 active。 */
function statusOf(item: Partial<MemoryItem> | null | undefined): 'active' | 'conflict-pending' {
  return item?.status === 'conflict-pending' ? 'conflict-pending' : 'active'
}

/** 关联 id 列表容错：只保留字符串元素。 */
function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
}

/** 来源对象（会话 id + 时间）；非法输入返回空来源。 */
function sourceOf(source: unknown): { sessionId: string; at: number } {
  if (source !== null && typeof source === 'object') {
    const sourceObj = source as Record<string, unknown>
    return {
      sessionId: stringOr(sourceObj.sessionId, ''),
      at: finiteOr(sourceObj.at, 0),
    }
  }
  return { sessionId: '', at: 0 }
}

/** 结构化的 source 构造器（供候选/确认写入使用）。 */
export function makeSource(sessionId: unknown, at: unknown): { sessionId: string; at: number } {
  return {
    sessionId: stringOr(sessionId, ''),
    at: finiteOr(at, 0),
  }
}

/**
 * 将一条（已确认的）记忆候选合并进条目列表（渐进式更新，issue #78）：
 *  - 无同主题条目 → 新增（confidence=1，source/history 记录来源）；
 *  - 同主题且归一化文本一致 → 置信度提升（confidence+1，上限 MAX_CONFIDENCE）、
 *    desc 更新为最新、updatedAt 刷新（内容更新），history 记录 reinforce；
 *  - 同主题但文本分歧（大意一致措辞不同）→ 以新 desc 生效 + 标记
 *    status='conflict-pending'（矛盾标记待确认：用户确认了此候选，旧版本
 *    留在 history 供演进查看），history 记录 conflict。
 * 返回 { items, outcome }——outcome: 'added' | 'reinforced' | 'conflicted'。
 */
export function mergeCandidate(
  items: MemoryItem[],
  candidate: Partial<MemoryItem>,
  now: number = Date.now(),
): { items: MemoryItem[]; outcome: 'added' | 'reinforced' | 'conflicted' } {
  const list = Array.isArray(items) ? items : []
  const candidateWithDefaults = withDefaults(candidate, now)
  const index = list.findIndex(
    (item) =>
      sameTheme(withDefaults(item, now), candidateWithDefaults) ||
      themeKeyOf(item) === themeKeyOf(candidateWithDefaults),
  )
  if (index === -1) {
    return { items: [...list, candidateWithDefaults], outcome: 'added' }
  }
  const existing = withDefaults(list[index], now)
  const merged = { ...existing }
  merged.confidence = Math.min(MAX_CONFIDENCE, (existing.confidence ?? 1) + 1)
  merged.desc = candidateWithDefaults.desc
  merged.updatedAt = now
  const sameText = normalizeText(existing.desc) === normalizeText(candidateWithDefaults.desc)
  if (!sameText) merged.status = 'conflict-pending'
  merged.history = [
    ...(Array.isArray(existing.history) ? existing.history : []),
    {
      at: now,
      action: sameText ? 'reinforce' : 'conflict',
      desc: existing.desc,
    },
  ]
  const next = list.slice()
  next[index] = merged
  return { items: next, outcome: sameText ? 'reinforced' : 'conflicted' }
}

/**
 * 长期未用降权（issue #78）：条目 updatedAt 距今超过 thresholdMs（默认
 * 90 天 → halfLife）时 confidence 递减，但不低于 MIN_CONFIDENCE。
 * 返回 { items }——降权后仍活跃的条目列表（不淘汰条目，降权保障注入
 * 排序自然靠后；淘汰属用户显式删除）。
 */
export function decayConfidence(
  items: MemoryItem[],
  now: number = Date.now(),
  thresholdMs: number = DEFAULT_DECAY_MS,
): { items: MemoryItem[] } {
  const list = Array.isArray(items) ? items : []
  return {
    items: list.map((item) => {
      const normalized = withDefaults(item, now)
      const age = now - (Number.isFinite(normalized.updatedAt) ? normalized.updatedAt : now)
      if (age <= thresholdMs) return normalized
      const decayed = Math.max(MIN_CONFIDENCE, (normalized.confidence ?? 1) - 1)
      if (decayed === normalized.confidence) return normalized
      return { ...normalized, confidence: decayed }
    }),
  }
}

/** 评分权重（默认 relevance 0.5 / recency 0.3 / confidence 0.2）。 */
function weightOf(weights: Record<string, unknown> | undefined, key: string, fallback: number): number {
  return Number.isFinite(weights?.[key]) ? (weights![key] as number) : fallback
}

/** 评分选项归一化（非法值回退默认）。 */
function scoreOptionsOf(options: InjectionOptions | undefined): {
  now: number
  halfLifeMs: number
  maxConfidence: number
  weights: { relevance: number; recency: number; confidence: number }
} {
  return {
    now: finiteOr(options?.now, Date.now()),
    halfLifeMs: finiteOr(options?.halfLifeMs, DEFAULT_HALF_LIFE_MS),
    maxConfidence: finiteOr(options?.maxConfidence, 1),
    weights: {
      relevance: weightOf(options?.weights as Record<string, unknown>, 'relevance', 0.5),
      recency: weightOf(options?.weights as Record<string, unknown>, 'recency', 0.3),
      confidence: weightOf(options?.weights as Record<string, unknown>, 'confidence', 0.2),
    },
  }
}

/**
 * 单条注入评分（issue #78 智能注入）：score = 相关性 + 时效性 + 置信度。
 *  - relevance：context 关键词在 desc 中命中的占比（[0,1]）；
 *  - recency：时间衰减因子 exp(-age / halfLifeMs)（[0,1]，越新越接近 1）；
 *  - confidenceFactor：confidence 相对 maxConfidence 归一化（[0,1]）。
 * 权重默认 relevance 0.5 / recency 0.3 / confidence 0.2（可注入覆盖）。
 */
export function scoreForInjection(
  item: Partial<MemoryItem>,
  context: InjectionContext,
  opts?: InjectionOptions,
): InjectionScore {
  const options = scoreOptionsOf(opts)
  const keywords = Array.isArray(context?.keywords) ? context.keywords : []
  const normalized = withDefaults(item, options.now)
  const relevance = relevanceOf(descOf(normalized), keywords)
  const age = Math.max(0, options.now - normalized.updatedAt)
  const recency = Math.exp(-age / options.halfLifeMs)
  // confidence 归一化到 [0,1]（上限用列表最大置信度，缺省 1 时直接用 confidence）。
  const confidenceFactor = options.maxConfidence > 0 ? Math.min(1, normalized.confidence / options.maxConfidence) : 1
  return {
    id: normalized.id,
    item: normalized,
    score:
      options.weights.relevance * relevance +
      options.weights.recency * recency +
      options.weights.confidence * confidenceFactor,
  }
}

/** 相关性：context 关键词中命中 desc 的比例（无关键词 → 0；命中全无 → 0）。 */
export function relevanceOf(desc: unknown, keywords: string[]): number {
  const text = String(desc ?? '').toLowerCase()
  if (keywords.length === 0) return 0
  const hits = keywords.filter(
    (keyword) => typeof keyword === 'string' && keyword !== '' && text.includes(keyword.toLowerCase()),
  )
  return hits.length / keywords.length
}

/**
 * 智能注入选择（issue #78 替代简单 top-N）：
 * 按 scoreForInjection 对全部条目评分，取最高分的 maxItems 条（含来源元
 * 数据），返回 { picked }（新数组，不修改原列表）。条目列表应为全局记忆
 * （decay 已应用时效果最佳）。
 */
export function pickForInjection(
  items: Array<Partial<MemoryItem>>,
  context: InjectionContext,
  opts?: InjectionOptions & { maxItems?: number },
): { picked: MemoryItem[] } {
  const options = opts ?? {}
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems! > 0 ? options.maxItems! : 5
  const list = Array.isArray(items) ? items : []
  // 只考虑格式良好的条目（id + desc 齐全）——junk 输入（null/字符串）直接跳过
  const wellFormed = list.filter((item) => item !== null && typeof item === 'object' && descOf(item) !== '')
  const maxConfidence = Math.max(
    1,
    ...wellFormed.map((item) => (Number.isFinite(item?.confidence) ? item.confidence! : 1)),
  )
  const scored = wellFormed
    .map((item) => scoreForInjection(item, context, { ...options, maxConfidence }))
    .sort((a, b) => b.score - a.score)
  return { picked: scored.slice(0, maxItems).map((entry) => entry.item) }
}

/** 分类的展示标签（zh；供工具/测试使用）。 */
export function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    preference: '偏好',
    fact: '事实',
    project: '项目',
    stack: '技术栈',
    workflow: '工作流',
  }
  return labels[category] ?? '事实'
}
