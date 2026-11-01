/**
 * dsh-my-notify — 模板渲染（单次扫描，新旧语法共存）。
 *
 * 支持两种占位符：
 *  - 新语法 `{{namespace.var}}`（如 `{{session.title}}`）
 *  - 旧语法 `{var}`（如 `{title}`，取值同 LEGACY_ALIASES 映射的新变量）
 *
 * 渲染规则：
 *  - **单次扫描**：模板只过一遍，变量值里的花括号不会被二次解析（避免用户
 *    内容里的 `{x}` 被误替换、也避免递归注入）；
 *  - **未识别原样保留**：未知占位符（含拼写错误）原样输出，便于用户发现；
 *  - 空模板返回空串；变量缺失按空串参与渲染（由 buildVars 保证全量键存在）。
 *
 * 结构：render 只负责扫描循环，nextToken 切出「一个字面片段或一个占位符」，
 * resolveToken / lookup 负责取值，每个函数圈复杂度 ≤10。
 */
import { LEGACY_ALIASES } from './vars.js'

/** 扫描出的一个片段：字面量 + 可选占位符键 + 下一个扫描起点。 */
interface Token {
  /** 占位符未知时原样输出的文本。 */
  literal: string
  /** 命中的占位符键（字面量片段为 undefined）。 */
  key?: string
  /** 下一个扫描起点。 */
  end: number
}

/**
 * 渲染模板（单次扫描；未识别占位符原样保留）。
 *
 * @example
 *   render('{{session.title}} 已结束', { 'session.title': '演示项目' })
 *   // → '演示项目 已结束'
 *   render('{title}-{unknown}', { 'session.title': 'A' })
 *   // → 'A-{unknown}'
 */
export function render(template: string | undefined, vars: Record<string, string>): string {
  if (typeof template !== 'string' || template === '') return ''
  const table = vars ?? {}
  let out = ''
  let index = 0
  while (index < template.length) {
    const token = nextToken(template, index)
    out += resolveToken(table, token)
    index = token.end
  }
  return out
}

/** 片段输出：命中键取变量值，未命中（或非占位符）输出原文本。 */
function resolveToken(table: Record<string, string>, token: Token): string {
  if (token.key === undefined) return token.literal
  const value = lookup(table, token.key)
  return value === undefined ? token.literal : value
}

/** 从 start 切出下一个片段（字面量或占位符）。 */
function nextToken(template: string, start: number): Token {
  const ch = template[start]!
  if (ch !== '{') return { literal: ch, end: start + 1 }
  const isDouble = template[start + 1] === '{'
  const openAt = isDouble ? start + 2 : start + 1
  const closeToken = isDouble ? '}}' : '}'
  const closeAt = template.indexOf(closeToken, openAt)
  if (closeAt === -1) return { literal: ch, end: start + 1 }
  const key = template.slice(openAt, closeAt).trim()
  const literal = template.slice(start, closeAt + closeToken.length)
  const end = closeAt + closeToken.length
  // 空键 / 含嵌套花括号 / 跨行 → 不是占位符，原样输出
  if (key === '' || key.includes('{') || key.includes('\n')) return { literal, end }
  return { literal, key, end }
}

/** 查表：先全名，再按别名映射（`{title}` → `session.title`）。 */
function lookup(table: Record<string, string>, key: string): string | undefined {
  const direct = table[key]
  if (direct !== undefined) return direct
  const alias = LEGACY_ALIASES[key]
  return alias === undefined ? undefined : table[alias]
}
