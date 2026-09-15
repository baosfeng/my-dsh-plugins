/**
 * reviewer-assignment.mjs — PR 自动指派 reviewer 的候选解析与「自审过滤」（issue #304）。
 *
 * 背景（`Auto Assign Reviewers` workflow 曾在**每个**普通 PR 上必然失败）：
 *   `.github/workflows/auto-assign-reviewers.yml` 把所有命中的文件类型都映射到同一个
 *   账号（`reviewers.add('baosfeng')`），而个人仓库的 PR 作者通常就是该账号本人 →
 *   `pulls.requestReviewers` 返回 422
 *   `Review cannot be requested from pull request author`
 *   （run 34969856346 / run 34766636038 同类），整个 job 失败，自动指派**从未真正生效**。
 *
 * 契约（本模块只做纯计算）：不触网、不读环境变量、不依赖 GitHub 上下文，因此可以在 CI
 *   之外用 vitest 直接验证「自审被过滤」与「无可用候选人时优雅跳过」两条判据。
 *   workflow 通过 `await import(...)` 加载本模块，把「谁可以被请求 review」与「是否该
 *   跳过」的判定收敛到一处，避免 YAML 内联逻辑漂移。
 */

/** 无效候选人（空值、非字符串）不算候选人，避免 422 之外的无意义请求。 */
const isUsableLogin = (login) => typeof login === 'string' && login.trim().length > 0

/**
 * 解析本次 PR 可请求的 reviewer 列表。
 *
 * @param {object} input
 * @param {string[]} [input.candidateReviewers] 按文件类型命中的候选账号（可含重复/空值）
 * @param {string} [input.prAuthor] PR 作者账号（GitHub 不允许请求作者自审）
 * @returns {{
 *   candidates: string[],   // 去重去空后的原始候选
 *   eligible: string[],     // 过滤 PR 作者后可实际请求的账号（requestReviewers 的入参）
 *   skippedSelf: string[],  // 因「等于 PR 作者」被跳过的账号
 *   skipReason: null | 'no-candidate' | 'only-pr-author'  // 非 null 表示应优雅跳过
 * }}
 */
export function resolveReviewers({ candidateReviewers = [], prAuthor = '' } = {}) {
  const candidates = [...new Set(candidateReviewers.filter(isUsableLogin))].map((login) => login.trim())
  const eligible = candidates.filter((login) => login !== prAuthor)
  const skippedSelf = candidates.filter((login) => login === prAuthor)

  // 只有在「过滤后无可请求对象」时才跳过；有可用对象就必须真的发起指派。
  let skipReason = null
  if (eligible.length === 0) {
    skipReason = candidates.length === 0 ? 'no-candidate' : 'only-pr-author'
  }

  return { candidates, eligible, skippedSelf, skipReason }
}

/**
 * 生成给 workflow 日志用的一行可诊断摘要（不含控制字符，可安全进 GitHub Actions 日志）。
 *
 * @param {ReturnType<typeof resolveReviewers>} plan
 * @param {string} [prAuthor] PR 作者账号
 * @returns {string}
 */
export function describeAssignment(plan, prAuthor = '') {
  const list = (items) => (items.length > 0 ? items.join(', ') : '(无)')
  const parts = [`候选 ${list(plan.candidates)}`, `过滤 PR 作者(${prAuthor || '未知'})后可用 ${list(plan.eligible)}`]
  if (plan.skipReason === 'only-pr-author') parts.push('跳过：唯一候选是 PR 作者本人（GitHub 不允许自审）')
  else if (plan.skipReason === 'no-candidate') parts.push('跳过：本次改动没有命中任何候选账号')
  return parts.join('；')
}
