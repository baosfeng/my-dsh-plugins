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

/**
 * 结论三态（issue #303 / #311：严禁把「没真正跑」写成通过）。
 * ⚠️ `FLAKY`（疑似抖动）**不是结论**，只是历史摘要里的一个分类（同一 commit 的判定通过但
 * 观测到环境抖动）——结论永远只可能是三态之一，见 review-verdict.cjs 的 historyOutcome。
 */
const OUTCOMES = { PASS: '通过', FAIL: '不通过', UNKNOWN: '未能判定', FLAKY: '疑似抖动' }

/** 抖动计数标记（隐藏注释，issue #311）：它只用于历史摘要与提示，绝不改变结论。 */
const FLAKY_RE = /<!--\s*dsh-flaky:\s*(\d+)\s*-->/

function flakyMarker(count) {
  return `<!-- dsh-flaky: ${count} -->`
}

/** 统计报告里的抖动次数（可能有多条检查各自标注）。 */
function countFlaky(text) {
  const glob = new RegExp(FLAKY_RE.source, 'g')
  let total = 0
  let m = glob.exec(text)
  while (m !== null) {
    total += Number(m[1])
    m = glob.exec(text)
  }
  return total
}

/** 从一份三段结构报告里提取结论 / 统计 / 证据行。 */
function parseReport(md) {
  const text = stripAnsi(String(md || ''))
  const conclusion = (/##\s*结论\s*\n+\s*([^\n]+)/.exec(text) || [])[1]
  const stats = (/统计：([^\n]+)/.exec(text) || [])[1]
  const hint = (/^- \*\*提示（非门禁）\*\*：([^\n]+)/m.exec(text) || [])[1]
  // 抖动计数（issue #311）：job 报告里的隐藏标记，用来把「本次存在疑似环境抖动」记进历史摘要，
  // 而不改变三段结构里的结论（抖动不是结论）。
  const flaky = countFlaky(text)
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
    flaky,
  }
}

/** 按行数上限截断，超限追加指向日志/artifact 的说明（禁止刷屏）。 */
function truncateLines(text, maxLines = 30, hint = '完整结果见 CI 日志 / artifact') {
  const lines = String(text || '').split('\n')
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, Math.max(0, maxLines - 1)), `_（内容超长已截断，${hint}）_`].join('\n')
}

/**
 * 按预算装配报告（issue #311）。
 *
 * 为什么不能「先拼好再整体截断」（原实现的真实缺陷，本地实测复现）：固定三段结构里
 * `## 结论` 在头、`## 建议` 在尾，整体截断会把**建议段**（以及写在末尾的历史标记）整段吃掉——
 * 一份 4 条检查的报告被截断后 `## 建议` 直接消失，读者拿不到「下一步该做什么」。
 *
 * 因此：头（结论/统计/历史/提示）与尾（建议）**永不截断**；正文分两类：
 *   - essential：必须可见（每条检查的唯一结论、证据段的标题）
 *   - optional ：可整块丢弃（证据明细、未覆盖清单），丢弃时**显式说明丢了几块**并指向 CI 日志
 * 整块丢弃（而非按行腰斩）保证不会留下「#### 名称」这种无内容的悬空标题。
 */
function fitReport(head, essential, optional, tail, maxLines = 30, hint = '完整结果见 CI 日志 / artifact') {
  const budget = Math.max(1, maxLines - head.length - tail.length - 2) // 两处分段空行
  const all = [...essential]
  let dropped = 0
  for (const block of optional) {
    if (all.length + block.length + 1 <= budget) all.push('', ...block)
    else dropped += 1
  }
  if (dropped > 0) all.push('', `_（另有 ${dropped} 块明细因超长省略，${hint}）_`)
  const fitted = all.length > budget ? [...all.slice(0, Math.max(0, budget - 1)), `_（内容超长已截断，${hint}）_`] : all
  return [...head, '', ...fitted, '', ...tail].join('\n')
}

/** 把各 job 报告汇总成一条「结论优先、超限即截断」的总评论。 */
function buildConsolidated(
  reports,
  { maxLines = 30, historyLine = '', historyComment = '', sha = '', notes = [] } = {},
) {
  const parsed = reports.map((r) => ({ name: r.name, ...parseReport(r.md) }))
  const count = (name) => parsed.filter((p) => p.conclusion === name).length
  const outcome =
    count(OUTCOMES.FAIL) > 0 ? OUTCOMES.FAIL : count(OUTCOMES.UNKNOWN) > 0 ? OUTCOMES.UNKNOWN : OUTCOMES.PASS
  const flaky = parsed.reduce((sum, p) => sum + (p.flaky || 0), 0)
  // 隐藏的历史标记放最前：截断永远只牺牲中间的证据正文，绝不牺牲「下一轮还能读到历史」
  const head = [...(historyComment ? [historyComment] : []), '## 结论', '', outcome, '']
  head.push(
    `统计：通过 ${count(OUTCOMES.PASS)} 项 / 不通过 ${count(OUTCOMES.FAIL)} 项 / 未能判定 ${count(OUTCOMES.UNKNOWN)} 项`,
  )
  // 判定对象与历史摘要（issue #311）：让「同一 commit 的结论变过没有」一眼可查
  if (historyLine || sha) {
    const scope = sha ? `（本次判定对象 commit ${sha}）` : ''
    head.push('', historyLine ? `历史：${historyLine}${scope}` : `判定对象：commit ${sha}`)
  }
  if (flaky > 0) {
    head.push(
      '',
      `⚠️ 提示：同一 commit 观测到疑似环境抖动 ×${flaky}（失败/超时那几次按环境抖动标注，**不作为代码问题**，结论以成功的那次为准）。`,
      '',
      flakyMarker(flaky),
    )
  }
  for (const note of notes) head.push('', `⚠️ ${note}`)

  const body = ['## 关键证据', '']
  for (const p of parsed) {
    const first = p.evidence[0] ? ` — ${p.evidence[0].replace(/^-\s*/, '')}` : ''
    const shown = p.detail && p.detail !== p.conclusion ? p.detail : p.conclusion
    const hintText = p.hint ? `（${p.hint}）` : ''
    body.push(`- **${p.name}**：${shown}${first}${hintText}`)
  }
  const notCovered = parsed.flatMap((p) => p.notCovered)
  const optional = []
  if (notCovered.length > 0) {
    optional.push([
      `## 未覆盖检查（${notCovered.length} 项）`,
      '',
      '不代表通过，也不阻塞合并；需接入自动化才能覆盖。',
      '',
      ...notCovered.slice(0, 5).map((item) => `- ${item}`),
      ...(notCovered.length > 5 ? [`- _（另有 ${notCovered.length - 5} 项，完整见 artifact）_`] : []),
    ])
  }

  const tail = ['## 建议', '', '- 先处理「不通过」与「未能判定」项；完整明细见本次运行 artifact 与 CI 日志。']
  return fitReport(head, body, optional, tail, maxLines, '完整结果见本次运行 artifact 与 CI 日志')
}

module.exports = {
  ANSI_ESCAPE_RE,
  stripAnsi,
  countEscapes,
  reviewMarker,
  upsertReviewComment,
  OUTCOMES,
  FLAKY_RE,
  flakyMarker,
  countFlaky,
  parseReport,
  truncateLines,
  fitReport,
  buildConsolidated,
}
