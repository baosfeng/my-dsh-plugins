'use strict'

/**
 * PR 审查评论共享工具（issue #303）。
 *
 * 缺陷背景：
 * 1. ANSI 乱码——CI 上 prettier / npm audit 等输出带颜色转义（`ESC[33m…ESC[39m`），
 *    原实现把文件原样拼进 `issues.createComment` 的 body，GitHub 不解析转义序列，
 *    页面上显示为 `[33mwarn[39m]` 之类的怪字符；
 * 2. 评论只追加不更新——每次 push 都新建一份报告，评论数线性增长。
 *
 * 本模块提供两个纯函数 + 一个 upsert：
 * - `stripAnsi`：剥离 ANSI/CSI 转义序列（兜底，不依赖上游命令是否支持 --no-color）；
 * - `reviewMarker` / `countEscapes`：sticky 评论标记与量化自检；
 * - `upsertReviewComment`：按 marker 命中既有 bot 评论则 update，否则 create。
 *
 * 使用 CommonJS 的原因：`actions/github-script` 通过
 * `createRequire($GITHUB_WORKSPACE + '/')` 注入 `require`，只接受 CJS 入口；
 * 同目录 `review-comment.test.cjs` 用 `node --test` 直接跑，保证逻辑可离线验证。
 * 放在 `.github/scripts/`：与既有 CI 专用脚本（extract-release-body.mjs / notify-failure.mjs）一致，
 * 且该目录不在 knip 的 project 范围内（不会被报 unused files）。
 */

/** CSI 转义序列：ESC [ 参数 ; 参数 … 终止字母（m/K/H 等）。 */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[A-Za-z]/g

/** 剥离 ANSI 转义序列；非字符串输入按空串处理。 */
function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_ESCAPE_RE, '')
}

/** 统计 ESC(0x1B) 个数，用于日志/验收时量化“评论里还有没有乱码”。 */
function countEscapes(text) {
  return (String(text ?? '').match(/\u001b/g) || []).length
}

/**
 * sticky 评论标记。放在 body 首行，GitHub 渲染时不可见（HTML 注释），
 * 供下一次运行查找同一条评论并原地更新。
 */
function reviewMarker(id) {
  return `<!-- dsh-review:${id} -->`
}

/**
 * 写入或更新某类审查报告评论（sticky）。
 *
 * @param {object} params
 * @param {object} params.github  actions/github-script 注入的 octokit 客户端
 * @param {object} params.context actions/github-script 注入的 context
 * @param {string} params.id     报告标识（marker 后缀，例如 `code-quality`）
 * @param {string} params.heading 评论标题行（例如 `## 🔍 代码质量审查报告`）
 * @param {string} params.report  报告正文（可含 ANSI 转义，会被剥离）
 * @returns {Promise<{action: 'created'|'updated', commentId: number, escapeCount: number}>}
 */
async function upsertReviewComment({ github, context, id, heading, report }) {
  const marker = reviewMarker(id)
  const body = `${marker}\n${heading}\n\n${stripAnsi(report)}`
  const owner = context.repo.owner
  const repo = context.repo.repo
  const issue_number = context.issue.number

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  })
  const existing = comments.find(
    (comment) =>
      comment.user && comment.user.type === 'Bot' && typeof comment.body === 'string' && comment.body.includes(marker),
  )

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
    return { action: 'updated', commentId: existing.id, escapeCount: countEscapes(body) }
  }

  const created = await github.rest.issues.createComment({ owner, repo, issue_number, body })
  return { action: 'created', commentId: created.data.id, escapeCount: countEscapes(body) }
}

/** 结论三态（issue #303：严禁把「没真正跑」写成通过）。 */
const OUTCOMES = { PASS: '通过', FAIL: '不通过', UNKNOWN: '未能判定' }

const HISTORY_RE = /<!-- dsh-review-history: ([^>]*?) -->/

/** 从既有 sticky 评论里取历史结论序列。 */
function readHistory(previousBody, { keep = 5 } = {}) {
  const m = HISTORY_RE.exec(String(previousBody || ''))
  if (!m) return []
  return m[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(-keep)
}

/** 历史结论 → 一行中文摘要（让「结论变了」可解释）。 */
function renderHistory(outcomes) {
  if (outcomes.length === 0) return ''
  const parts = []
  for (const name of [OUTCOMES.PASS, OUTCOMES.FAIL, OUTCOMES.UNKNOWN]) {
    const n = outcomes.filter((o) => o === name).length
    if (n > 0) parts.push(`${name} ×${n}`)
  }
  return `最近 ${outcomes.length} 次检查：${parts.join('、')}`
}

/** 追加本次结论并渲染历史行 + 要写回 body 的隐藏注释。 */
function mergeHistory(previousBody, outcome, { keep = 5 } = {}) {
  const outcomes = [...readHistory(previousBody, { keep: keep - 1 }), outcome].slice(-keep)
  return {
    outcomes,
    historyLine: renderHistory(outcomes),
    historyComment: `<!-- dsh-review-history: ${outcomes.join(',')} -->`,
  }
}

/** 从一份三段结构报告里提取结论 / 统计 / 证据行。 */
function parseReport(md) {
  const text = stripAnsi(String(md || ''))
  const conclusion = (/##\s*结论\s*\n+\s*([^\n]+)/.exec(text) || [])[1]
  const stats = (/统计：([^\n]+)/.exec(text) || [])[1]
  const hint = (/^- \*\*提示（非门禁）\*\*：([^\n]+)/m.exec(text) || [])[1]
  const notCovered = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^- \*\*未覆盖检查\*\*：/.test(l))
    .map((l) => l.replace(/^- \*\*未覆盖检查\*\*：/, ''))
  // 只从「## 关键证据」段里取证据行，避免把「## 建议」里的条目当证据
  const evidenceBlock = (/##\s*关键证据[^\n]*\n([\s\S]*?)(?:\n##\s|$)/.exec(text) || [])[1] || text
  const evidence = evidenceBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^-\s+\S/.test(l) && !l.includes('提示（非门禁）') && !l.includes('未覆盖检查'))
    .slice(0, 2)
  const detail = conclusion ? conclusion.trim() : OUTCOMES.UNKNOWN
  const normalized = detail.startsWith(OUTCOMES.FAIL)
    ? OUTCOMES.FAIL
    : detail.startsWith(OUTCOMES.UNKNOWN)
      ? OUTCOMES.UNKNOWN
      : detail.startsWith(OUTCOMES.PASS)
        ? OUTCOMES.PASS
        : OUTCOMES.UNKNOWN
  return {
    conclusion: normalized,
    detail,
    hint: hint ? hint.trim() : '',
    notCovered,
    stats: stats ? stats.trim() : '',
    evidence,
  }
}

/** 按行数上限截断，超限追加指向日志/artifact 的说明（禁止刷屏）。 */
function truncateLines(text, maxLines = 30, hint = '完整结果见 CI 日志 / artifact') {
  const lines = String(text || '').split('\n')
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, Math.max(0, maxLines - 1)), `_（内容超长已截断，${hint}）_`].join('\n')
}

/** 把各 job 报告汇总成一条「结论优先、超限即截断」的总评论。 */
function buildConsolidated(reports, { maxLines = 30, historyLine = '', historyComment = '' } = {}) {
  const parsed = reports.map((r) => ({ name: r.name, ...parseReport(r.md) }))
  const count = (name) => parsed.filter((p) => p.conclusion === name).length
  const outcome =
    count(OUTCOMES.FAIL) > 0 ? OUTCOMES.FAIL : count(OUTCOMES.UNKNOWN) > 0 ? OUTCOMES.UNKNOWN : OUTCOMES.PASS
  const lines = ['## 结论', '', outcome, '']
  lines.push(
    `统计：通过 ${count(OUTCOMES.PASS)} 项 / 不通过 ${count(OUTCOMES.FAIL)} 项 / 未能判定 ${count(OUTCOMES.UNKNOWN)} 项`,
    '',
  )
  if (historyLine) lines.push(`历史：${historyLine}`, '')
  lines.push('## 关键证据', '')
  for (const p of parsed) {
    const first = p.evidence[0] ? ` — ${p.evidence[0].replace(/^-\s*/, '')}` : ''
    const shown = p.detail && p.detail !== p.conclusion ? p.detail : p.conclusion
    const hint = p.hint ? `（${p.hint}）` : ''
    lines.push(`- **${p.name}**：${shown}${first}${hint}`)
  }
  const notCovered = parsed.flatMap((p) => p.notCovered)
  if (notCovered.length > 0) {
    lines.push(
      '',
      `## 未覆盖检查（${notCovered.length} 项）`,
      '',
      '不代表通过，也不阻塞合并；需接入自动化才能覆盖。',
      '',
    )
    for (const item of notCovered.slice(0, 5)) lines.push(`- ${item}`)
    if (notCovered.length > 5) lines.push(`- _（另有 ${notCovered.length - 5} 项，完整见 artifact）_`)
  }
  lines.push('', '## 建议', '', '- 先处理「不通过」项；完整明细见本次运行 artifact 与 CI 日志。')
  if (historyComment) lines.push('', historyComment)
  return truncateLines(lines.join('\n'), maxLines)
}

module.exports = {
  ANSI_ESCAPE_RE,
  stripAnsi,
  countEscapes,
  reviewMarker,
  upsertReviewComment,
  OUTCOMES,
  readHistory,
  renderHistory,
  mergeHistory,
  parseReport,
  truncateLines,
  buildConsolidated,
}
