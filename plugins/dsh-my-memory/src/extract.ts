/**
 * dsh-my-memory — rule-based memory candidate extractor (issue #78)。
 *
 * 会话结束后从用户消息自动提取记忆候选（偏好/事实/项目/技术栈/工作流），
 * 产出「待确认」候选——写入正式记忆前必须经用户确认（记忆绝不静默变更）。
 *
 * 提取方式：
 *  - extractor: 'rule'（默认，本模块实现）——确定性规则/模式匹配，
 *    无需 LLM/网络，可在离线与 CI 环境稳定测试；
 *  - extractor: 'llm'（预留占位）——独立 agent 总结式提取，留待后续接入
 *    LLM 会话（本模块返回空候选，由调用方保证不产生任何写入）。
 *
 * 候选结构：
 *   {
 *     id, category, desc, scope: 'global' | 'project', cwd?: string,
 *     source: { sessionId, at }, createdAt,
 *   }
 * category 取值与 lib/memory-scoring.js 的 CATEGORIES 一致。scope='project'
 * 的候选携带 cwd（会话工作目录），确认写入时按该 cwd 定位项目 store。
 */
import { firstSentence } from './memory-text.js'

/** 单会话提取候选上限（防膨胀；超出丢弃尾部）。 */
export const MAX_CANDIDATES_PER_SESSION = 20

/** 单条候选长度上限（字符）。 */
const MAX_CANDIDATE_LENGTH = 120

/** 候选类别类型 */
type Category = 'preference' | 'fact' | 'project' | 'stack' | 'workflow'

/** 候选作用域类型 */
type Scope = 'global' | 'project'

/** 候选结构接口 */
interface Candidate {
  id: string
  category: Category
  desc: string
  scope: Scope
  cwd?: string
  source: {
    sessionId: string
    at: number
  }
  createdAt: number
}

/** 规则接口 */
interface Rule {
  category: Category
  patterns: RegExp[]
}

/** 提取选项接口 */
interface ExtractOptions {
  now?: number
  sessionId?: string
  cwd?: string
  extractor?: 'rule' | 'llm'
  max?: number
}

/** 规则：类别 → 命中模式（正则数组）+ 项目性判定关键词。 */
const RULES: Rule[] = [
  {
    category: 'preference', // 偏好：回复语言、风格、习惯
    patterns: [
      /我喜欢/,
      /请(?:用|回复|给我|记得|记住)/,
      /记得(?:我)?/,
      /回复(?:用|必须用|要|请)/,
      /用中文/,
      /用英文/,
      /用英语/,
      /更简洁/,
      /不要太长/,
      /以后/,
      /不要再用/,
    ],
  },
  {
    category: 'fact', // 事实：身份、环境、状态
    patterns: [
      /我在(?:做|用|学|写|开发)/,
      /我用了/,
      /我在用/,
      /我住/,
      /我是(?:一个|做|写)/,
      /我的(?:项目|github|博客)/,
      /目前(?:在|用)/,
    ],
  },
  {
    category: 'project', // 项目：当前项目背景、约定
    patterns: [/本项目/, /这个项目/, /我们项目/, /项目(?:里|中|根|目录)/, /当前(?:项目|仓库)/],
  },
  {
    category: 'stack', // 技术栈：框架、依赖、工具
    patterns: [
      /用(?:的)?\s*(?:pnpm|npm|yarn|vitest|jest|mocha|react|vue|typescript|node)/i,
      /技术栈/,
      /依赖(?:管理器|管理)/,
      /包管理器/,
      /构建工具/,
      /ci\/cd/i,
    ],
  },
  {
    category: 'workflow', // 工作流：固定流程、习惯步骤
    patterns: [/每次/, /(?:提|创建)issue 前/, /提交前/, /发版前/, /先.*再/, /流程/, /习惯(?:性)?地/],
  },
]

/** 用户消息命中项目的关键词（判定候选建议 scope=project）。 */
const PROJECT_HINTS: RegExp[] = [/本项目/, /这个项目/, /我们项目/, /项目[里中根目录]/, /当前[项目仓库]/, /仓库/, /repo/]

/** 去重的候选指纹：category + 归一化 desc。 */
function candidateFingerprint(candidate: Candidate): string {
  return `${candidate.category}|${String(candidate.desc).replace(/\s+/g, '').toLowerCase()}`
}

/** 生成一个候选 id。 */
function newCandidateId(now: number): string {
  return `cand-${now}-${Math.random().toString(36).slice(2, 8)}`
}

/** 候选 desc：整句保留（首句语义），超长截断（不截断在句子中间）。 */
function candidateDescOf(sentence: string): string {
  const trimmed = String(sentence ?? '').trim()
  const first = firstSentence(trimmed)
  return trimmed === '' ? '' : first.length <= MAX_CANDIDATE_LENGTH ? first : `${first.slice(0, MAX_CANDIDATE_LENGTH)}…`
}

/** 消息是否含项目性关键词（建议 scope=project；否则 global）。 */
function suggestsProject(text: string): boolean {
  return PROJECT_HINTS.some((re) => re.test(text))
}

/** 一条句子命中某类规则时构造候选（scope 建议由项目关键词 + cwd 决定）。 */
function candidateOfSentence(
  sentence: string,
  desc: string,
  rule: Rule,
  now: number,
  sessionId: string,
  cwd: string,
): Candidate {
  const scope: Scope = suggestsProject(sentence) && cwd !== '' ? 'project' : 'global'
  return {
    id: newCandidateId(now),
    category: rule.category,
    desc,
    scope,
    cwd: scope === 'project' ? cwd : undefined,
    source: { sessionId, at: now },
    createdAt: now,
  }
}

/** 对单个句子运行全部规则，产出命中的候选（无命中返回空数组）。 */
function candidatesOfSentence(
  sentence: string,
  desc: string,
  now: number,
  sessionId: string,
  cwd: string,
): Candidate[] {
  const hits: Candidate[] = []
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(sentence))) {
      hits.push(candidateOfSentence(sentence, desc, rule, now, sessionId, cwd))
    }
  }
  return hits
}

/** 将候选去重并入列表；达到上限返回 true（提取应停止）。 */
function pushCandidate(candidates: Candidate[], seen: Set<string>, candidate: Candidate, max: number): boolean {
  const fingerprint = candidateFingerprint(candidate)
  if (seen.has(fingerprint)) return candidates.length >= max
  seen.add(fingerprint)
  candidates.push(candidate)
  return candidates.length >= max
}

/** 收集候选的上下文参数接口 */
interface CollectContext {
  now: number
  sessionId: string
  cwd: string
  max: number
  candidates: Candidate[]
  seen: Set<string>
}

/** 对消息列表做双层循环收集候选（已达上限返回 true → 提前结束）。 */
function collectCandidates(texts: string[], ctx: CollectContext): boolean {
  for (const text of texts) {
    const sentences = text === '' ? [] : splitSentences(text)
    for (const sentence of sentences) {
      const desc = candidateDescOf(sentence)
      const hits = desc === '' ? [] : candidatesOfSentence(sentence, desc, ctx.now, ctx.sessionId, ctx.cwd)
      for (const candidate of hits) {
        if (pushCandidate(ctx.candidates, ctx.seen, candidate, ctx.max)) return true
      }
    }
  }
  return false
}

/**
 * 规则提取：从用户消息列表提取记忆候选（确定性；无命中返回空数组）。
 *  - messages: 用户消息文本数组（已去插件注入；含真实用户输入）；
 *  - opts: { now, sessionId, cwd, extractor, max }——extractor 为 'llm'
 *    时返回空候选（预留占位，不产生写入）；max 覆盖单会话上限。
 * 返回候选数组（按原文顺序，已去重，scope 建议 global/project）。
 */
export function extractCandidates(messages: unknown, opts: ExtractOptions = {}): Candidate[] {
  if (opts.extractor === 'llm') return []
  const now = Number.isFinite(opts.now) ? opts.now! : Date.now()
  const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : ''
  const cwd = typeof opts.cwd === 'string' && opts.cwd !== '' ? opts.cwd : ''
  const max = Number.isInteger(opts.max) && opts.max! > 0 ? opts.max! : MAX_CANDIDATES_PER_SESSION
  const texts = Array.isArray(messages)
    ? messages.filter((m: unknown): m is string => typeof m === 'string').map((m: string) => m.trim())
    : []
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  collectCandidates(texts, { now, sessionId, cwd, max, candidates, seen })
  return candidates
}

/** 拆句：按句子边界拆分（中英文句末标点 + 分号 + 换行）；边界缺失时整段。 */
export function splitSentences(text: unknown): string[] {
  const value = String(text ?? '')
  const trimmed = value.trim()
  if (trimmed === '') return []
  const parts = value
    .split(/(?<=[。！？!?；;\n])/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return parts.length > 0 ? parts : [trimmed]
}
