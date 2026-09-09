/**
 * dsh-my-guard — custom guard rules（自定义护栏规则，issue #88）。
 *
 * 用户可添加自定义 bash 危险模式（正则），与内置破坏性命令模式合并生效：
 *  - compileCustomRules(rawRules) — 校验/编译用户规则（非法正则/缺 pattern 丢弃）；
 *  - matchCustomRules(command, compiledRules) — 命中自定义规则列表；
 *  - decideDestructive(command, options) — 合并内置 + 自定义规则，产出
 *    决策（mode/severity/primary/matched），供护栏监听器使用；
 *  - rawRulesOf(compiledRules) — 序列化回可持久化形态（剥离 regex）。
 *
 * 合并语义（PR 说明）：
 *  - 自定义规则**扩展**破坏性检测集，与内置规则并列匹配；
 *  - 最终 mode = 命中的全部规则中最严格者（deny > ask > observe），
 *    自定义规则只升不降——内置 deny 不会被自定义 observe 降级，安全；
 *  - 最终 severity = 命中的全部规则中最严重者（high > medium > low）；
 *  - 自定义规则自身的 mode（缺省继承全局 mode）与 severity 参与该合并。
 */
import { GUARD_MODES, SEVERITY_LEVELS, DESTRUCTIVE_PATTERNS } from './constants.js'
import type { GuardMode, Severity, CompiledRule, DestructivePattern, DestructiveDecision, GuardOptions } from './types.js'

/** 模式严格度排序（越大越严格）。 */
const MODE_RANK: Record<string, number> = { observe: 0, ask: 1, deny: 2 }

/** 严重度排序（越大越严重）。 */
const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

/** 编译单条自定义规则；非法返回 null（缺 pattern / 非法正则）。 */
export function compileRule(raw: Record<string, unknown>, index: number): CompiledRule | null {
  const pattern = patternOf(raw)
  if (pattern === '') return null
  const regex = regexOf(pattern)
  if (regex === null) return null
  return {
    id: idOf(raw, index),
    pattern,
    regex,
    mode: modeOf(raw),
    severity: severityOf(raw),
    description: descriptionOf(raw),
    message: messageOf(raw, pattern),
    custom: true,
  }
}

/** 提取 pattern；非字符串/空 → 空串（视为非法）。 */
function patternOf(raw: Record<string, unknown>): string {
  if (raw === null || typeof raw !== 'object') return ''
  return typeof raw.pattern === 'string' ? raw.pattern.trim() : ''
}

/** 编译正则；非法返回 null。 */
function regexOf(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/** 规则 id；缺省 `custom-<index>`。 */
function idOf(raw: Record<string, unknown>, index: number): string {
  return typeof raw.id === 'string' && raw.id !== '' ? raw.id : `custom-${index}`
}

/** 模式；非法值置空（继承全局模式）。 */
function modeOf(raw: Record<string, unknown>): string {
  return GUARD_MODES.includes(raw.mode as GuardMode) ? (raw.mode as string) : ''
}

/** 严重级；非法值回退 medium。 */
function severityOf(raw: Record<string, unknown>): Severity {
  return SEVERITY_LEVELS.includes(raw.severity as Severity) ? (raw.severity as Severity) : 'medium'
}

/** 描述；非字符串视为 ''。 */
function descriptionOf(raw: Record<string, unknown>): string {
  return typeof raw.description === 'string' ? raw.description.trim() : ''
}

/** 展示消息；缺描述时用 pattern。 */
function messageOf(raw: Record<string, unknown>, pattern: string): string {
  const description = descriptionOf(raw)
  return description !== '' ? description : pattern
}

/** 编译自定义规则列表（逐条校验，非法丢弃）。 */
export function compileCustomRules(input: unknown): CompiledRule[] {
  if (!Array.isArray(input) || input.length === 0) return []
  const out: CompiledRule[] = []
  for (let i = 0; i < input.length; i += 1) {
    const rule = compileRule(input[i] as Record<string, unknown>, i + 1)
    if (rule !== null) out.push(rule)
  }
  return out
}

/** 剥离 regex 等运行时字段，回退为可持久化的原始形态。 */
export function rawRulesOf(compiledRules: unknown): Array<{ id: string; pattern: string; mode: string; severity: string; description: string }> {
  if (!Array.isArray(compiledRules) || compiledRules.length === 0) return []
  return (compiledRules as CompiledRule[]).map((rule) => ({
    id: rule.id,
    pattern: rule.pattern,
    mode: rule.mode,
    severity: rule.severity,
    description: rule.description,
  }))
}

/** 命中的自定义规则列表（已编译，带 regex）。 */
export function matchCustomRules(command: string, compiledRules: unknown): CompiledRule[] {
  if (!Array.isArray(compiledRules) || compiledRules.length === 0) return []
  const hits: CompiledRule[] = []
  for (const rule of compiledRules as CompiledRule[]) {
    if (rule.regex.test(command)) hits.push(rule)
  }
  return hits
}

/** 首个内置破坏性命令命中（无命中返回 null）。 */
export function firstBuiltinMatch(command: string): DestructivePattern | null {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.re.test(command)) return pattern
  }
  return null
}

/**
 * 破坏性命令决策：合并内置 + 自定义规则。
 * 返回 { mode, severity, primary, matched }；无命中返回 null。
 *  - mode = 命中的全部规则中最严格者；severity = 最严重者；
 *  - primary = 内置命中优先，否则首个自定义命中（用于告警消息/详情）。
 */
export function decideDestructive(command: string, options: GuardOptions | undefined): DestructiveDecision | null {
  const builtinHit = firstBuiltinMatch(command)
  const customHits = matchCustomRules(command, options?.customRules)
  const matched = buildMatched(builtinHit, customHits, options)
  if (matched.length === 0) return null
  const { mode, severity } = mostRestrictive(matched)
  const primary = builtinHit !== null ? builtinHit : customHits[0]
  return { mode, severity, primary, matched }
}

/** 构建命中项列表（内置 + 自定义，各带 mode/severity）。 */
function buildMatched(
  builtinHit: DestructivePattern | null,
  customHits: CompiledRule[],
  options: GuardOptions | undefined
): Array<{ rule: DestructivePattern | CompiledRule; mode: GuardMode; severity: Severity }> {
  const matched: Array<{ rule: DestructivePattern | CompiledRule; mode: GuardMode; severity: Severity }> = []
  if (builtinHit !== null) {
    matched.push({ rule: builtinHit, mode: options?.mode ?? 'observe', severity: 'high' })
  }
  for (const rule of customHits) {
    const mode: GuardMode = rule.mode !== '' ? (rule.mode as GuardMode) : (options?.mode ?? 'observe')
    matched.push({ rule, mode, severity: rule.severity })
  }
  return matched
}

/** 最严格 mode + 最严重 severity（deny > ask > observe；high > medium > low）。 */
function mostRestrictive(matched: Array<{ rule: DestructivePattern | CompiledRule; mode: GuardMode; severity: Severity }>): { mode: GuardMode; severity: Severity } {
  let mode: GuardMode = matched[0].mode
  let severity: Severity = matched[0].severity
  for (const entry of matched) {
    if ((MODE_RANK[entry.mode] ?? 0) > (MODE_RANK[mode] ?? 0)) mode = entry.mode
    if ((SEVERITY_RANK[entry.severity] ?? 0) > (SEVERITY_RANK[severity] ?? 0)) severity = entry.severity
  }
  return { mode, severity }
}
