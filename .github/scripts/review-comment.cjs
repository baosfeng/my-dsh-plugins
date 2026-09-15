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

module.exports = { ANSI_ESCAPE_RE, stripAnsi, countEscapes, reviewMarker, upsertReviewComment }
