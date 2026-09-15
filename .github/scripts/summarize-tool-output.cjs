'use strict'

/**
 * 审查工具输出的中文摘要器（issue #303 诉求 1/3）。
 *
 * 背景：审查 job 原来把工具原始输出（英文 + ANSI 颜色）`cat` 进报告再发成 PR 评论，
 * 于是评论里出现「[33m」「Expected indentation…」这类既乱码又不专业的内容，
 * 「❌ 代码复杂度超标」评论区是重灾区（eslint compact 输出）。
 *
 * 本模块把各工具输出归一为**结构化中文摘要**：
 * - 只保留「文件:行 — 中文说明 — 实测值/阈值」这类可读信息；
 * - 逐条去 ANSI、去 npm/CI 噪声行；
 * - 默认最多 N 条，超出提示「完整输出见 CI 日志」；
 * - 规则名 / 严重级别用中文映射表（只覆盖实际会出现的项，未覆盖的保留原名并标注）。
 *
 * 用法（CLI，供 workflow 的 shell 调用）：
 *   node .github/scripts/summarize-tool-output.cjs --kind eslint --input complexity-report.txt --max 20
 */

const { stripAnsi } = require('./review-comment.cjs')

/** ESLint 规则 → 中文说明（只收录本项目实际会触发的规则，未收录的保留原名）。 */
const ESLINT_RULE_ZH = {
  complexity: '圈复杂度超标',
  'max-depth': '嵌套层级过深',
  'max-lines': '文件行数超标',
  'max-lines-per-function': '函数行数超标',
  'max-params': '函数参数过多',
  'max-statements': '语句数过多',
  'no-console': '不应使用 console',
  'no-unused-vars': '存在未使用的变量',
  'no-undef': '使用了未定义的变量',
  'no-empty': '存在空语句块',
  eqeqeq: '应使用严格相等',
  'prefer-const': '应使用 const',
  'no-var': '不应使用 var',
}

/** npm audit 严重级别 → 中文。 */
const SEVERITY_ZH = {
  critical: '严重',
  high: '高',
  moderate: '中',
  low: '低',
  info: '提示',
}

function zhRule(rule) {
  return ESLINT_RULE_ZH[rule] ? `${ESLINT_RULE_ZH[rule]}（${rule}）` : `ESLint 规则 ${rule}`
}

function zhSeverity(severity) {
  const key = String(severity || '').toLowerCase()
  return SEVERITY_ZH[key] ? `${SEVERITY_ZH[key]}（${key}）` : key || '未知'
}

/** 去掉工具输出里的进度行 / npm 噪声 / 空行。 */
function cleanLines(text) {
  return stripAnsi(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      if (/^Checking formatting\.\.\.$/.test(t)) return false
      if (/^# npm audit report$/i.test(t)) return false
      if (/^(npm notice|npm warn deprecated|npm error code)/.test(t)) return false
      if (/^To address all issues/.test(t)) return false
      if (/^(Run|Will install|fix available via)/.test(t)) return false
      if (/^> /.test(t)) return false
      return true
    })
}

/** 通用兜底：剥色 + 限行 + 截断提示。 */
function summarizeGeneric(raw, { max = 20 } = {}) {
  const lines = cleanLines(raw)
  const shown = lines.slice(0, max)
  const out = shown.map((line) => `- ${line}`)
  if (lines.length > shown.length) {
    out.push(`- _（以上为前 ${shown.length} 条，共 ${lines.length} 条；完整输出见 CI 日志）_`)
  }
  return out
}

/**
 * ESLint compact 输出 → 中文列表。
 * 输入形如：`/path/a.js: line 12, col 3, Error - Function 'f' has a complexity of 12. Maximum allowed is 10. (complexity)`
 */
function summarizeEslint(raw, { max = 20 } = {}) {
  const lines = cleanLines(raw)
  const items = []
  let matched = 0
  for (const line of lines) {
    const m = /^(.*?):\s*line\s*(\d+),\s*col\s*(\d+),\s*(Error|Warning)\s*-\s*(.*?)(?:\s*\(([^()]+)\))?$/.exec(
      line.trim(),
    )
    if (!m) continue
    matched += 1
    const [, file, lineNo, , severity, message, rule] = m
    const value = /complexity of (\d+).*Maximum allowed is (\d+)/.exec(message)
    if (value) {
      items.push(`- \`${file}:${lineNo}\` — ${zhRule(rule || 'complexity')}：实测 ${value[1]}，阈值 ${value[2]}`)
    } else {
      const level = severity === 'Warning' ? '警告' : '错误'
      items.push(`- \`${file}:${lineNo}\` — ${rule ? zhRule(rule) : 'ESLint 问题'}（${level}）：${message}`)
    }
  }
  if (matched === 0) return summarizeGeneric(raw, { max })
  const shown = items.slice(0, max)
  if (items.length > shown.length) {
    shown.push(`- _（以上为前 ${shown.length} 条，共 ${items.length} 条；完整输出见 CI 日志）_`)
  }
  return shown
}

/** Prettier --check 输出 → 待格式化文件列表。 */
function summarizePrettier(raw, { max = 20 } = {}) {
  const files = cleanLines(raw)
    // 剥色后 prettier 的 `[33mwarn[39m file` 会变成 `warn file`，两种形态都要识别
    .map((line) => /^(?:\[warn\]|warn)\s+(.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((file) => !/^Code style issues found/.test(file))
  if (files.length === 0) return summarizeGeneric(raw, { max })
  const shown = files.slice(0, max).map((file) => `- \`${file}\` — 需要按 Prettier 规则重新格式化`)
  if (files.length > shown.length) {
    shown.push(`- _（以上为前 ${shown.length} 个文件，共 ${files.length} 个；完整输出见 CI 日志）_`)
  }
  return shown
}

/** npm audit 人类可读输出 → 中文漏洞摘要。 */
function summarizeNpmAudit(raw, { max = 20 } = {}) {
  const lines = cleanLines(raw)
  const items = []
  for (let i = 0; i < lines.length; i += 1) {
    const pkg = /^([@\w./-]+)\s+(<[^ ]+|[^ ]*\s*-.*)?$/.exec(lines[i].trim())
    if (!pkg) continue
    const name = pkg[1]
    const range = (pkg[2] || '').trim()
    const severityLine = (lines[i + 1] || '').trim()
    const sev = /^Severity:\s*(\w+)/i.exec(severityLine)
    if (!sev) continue
    const title = (lines[i + 2] || '').trim().replace(/\s*-\s*https?:\/\/\S+$/, '')
    items.push(
      `- \`${name}\`${range ? `（受影响版本 ${range.replace(/^-/, '').trim() || range}）` : ''} — 严重级别 ${zhSeverity(sev[1])} — ${title || '见公告'}`,
    )
  }
  const countLine = lines.find((l) => /vulnerabilit(y|ies)/i.test(l))
  const shown = items.slice(0, max)
  if (items.length > shown.length) {
    shown.push(`- _（以上为前 ${shown.length} 条，共 ${items.length} 条；完整输出见 CI 日志）_`)
  }
  if (countLine) shown.unshift(`- ${countLine.trim()}`)
  return shown.length > 0 ? shown : summarizeGeneric(raw, { max })
}

/** tsc 输出 → 结构化列表（错误码与消息保留原文，类型错误无法可靠中译）。 */
function summarizeTsc(raw, { max = 20 } = {}) {
  const lines = cleanLines(raw)
  const items = []
  for (const line of lines) {
    const m = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line.trim())
    if (m) {
      items.push(`- \`${m[1]}:${m[2]}\` — ${m[5]}（${m[4] === 'warning' ? '警告' : '错误'}）：${m[6]}`)
    } else if (/^\S.*error TS\d+/.test(line.trim())) {
      items.push(`- ${line.trim()}`)
    }
  }
  if (items.length === 0) return summarizeGeneric(raw, { max })
  const shown = items.slice(0, max)
  if (items.length > shown.length) {
    shown.push(`- _（以上为前 ${shown.length} 条，共 ${items.length} 条；完整输出见 CI 日志）_`)
  }
  return shown
}

const SUMMARIZERS = {
  eslint: summarizeEslint,
  complexity: summarizeEslint,
  prettier: summarizePrettier,
  'npm-audit': summarizeNpmAudit,
  tsc: summarizeTsc,
  generic: summarizeGeneric,
}

/** 统一入口：按 kind 选择摘要器；未知 kind 退化为通用摘要。 */
function summarizeToolOutput(kind, raw, options = {}) {
  const fn = SUMMARIZERS[kind] || summarizeGeneric
  const body = fn(raw, options)
  return body.length > 0 ? body.join('\n') : '- 无输出'
}

module.exports = {
  ESLINT_RULE_ZH,
  SEVERITY_ZH,
  cleanLines,
  summarizeGeneric,
  summarizeEslint,
  summarizePrettier,
  summarizeNpmAudit,
  summarizeTsc,
  summarizeToolOutput,
}

/* istanbul ignore next -- CLI 入口，逻辑已由上面的函数覆盖 */
if (require.main === module) {
  const fs = require('fs')
  const args = process.argv.slice(2)
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
  }
  const kind = opt('kind', 'generic')
  const input = opt('input', '')
  const max = Number.parseInt(opt('max', '20'), 10)
  let raw = ''
  try {
    raw = input ? fs.readFileSync(input, 'utf8') : fs.readFileSync(0, 'utf8')
  } catch {
    raw = ''
  }
  process.stdout.write(`${summarizeToolOutput(kind, raw, { max })}\n`)
}
