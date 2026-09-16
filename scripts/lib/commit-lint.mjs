/**
 * commit-lint.mjs — 提交信息门禁的**纯判据件**（issue #324 需求 B）。
 *
 * 为什么 CI 层还要一道（本地已有 .husky/commit-msg + commitlint）：
 *   1. hook 可被 `--no-verify` / 网页端编辑 / 其他客户端绕过；
 *   2. 直接把整个历史丢给 commitlint 会**恒红**——实测 639 个非 merge 提交里 61 条
 *      不合格（9.5%：body-max-line-length 28 / header-max-length 14 / subject-case 11 /
 *      type-enum 5 / subject-empty 4 / type-empty 4，2026-09-15 实测）。
 *      所以本门禁**只校验本次变更范围内的提交**（PR 的 base..head；main 上是本次推送区间）。
 *      历史欠账不进门禁，但也不被"顺手"当作可通过的现状（见 renderCommitReport 的提示）。
 *
 * 本模块只做纯计算（不做 git IO、不调 commitlint），IO 在 scripts/check-commit-messages.mjs：
 *   · commitRangeSpec()    —— 由 from/to 推导「交给 commitlint 的范围」；空范围显式判失败
 *   · collectFindings()    —— 把 (message, lintResult) 收敛成 finding 清单（fail-closed）
 *   · renderCommitReport() —— 渲染结论（含"为什么会红/怎么改"的可操作说明）
 *
 * 「空范围」为什么必须判失败：与 docs/踩坑/npm-audit在镜像源下静默失效.md 同一条教训——
 * **「没检查」与「检查过且干净」必须区分开**。CI 里范围解析失败（浅克隆、base 写错、
 * 事件字段缺失）都会表现成"0 个提交"，静默放过就是一道假门禁。
 */

/**
 * 与 .commitlintrc.json 保持一致的 type 白名单——**只用于**在报告里给出可操作提示
 * （真正的判定在 commitlint；本模块不重复实现规则，避免两处规则漂移）。
 * 注意：这里刻意不含 commitlint 默认的 build/perf/revert，因为本仓库的
 * .commitlintrc.json 明确用 type-enum 覆盖了默认集合（见该文件）。
 */
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci']

/** 提交信息首行（commitlint 的 header）长度上限——config-conventional 默认值 100。 */
const SUBJECT_MAX = 100

/**
 * 由 from/to 推导校验范围。返回 { ok, from, to, mode, reason }。
 *   · mode='range'  ：from 与 to 都有值 → 用 from..to（git 语义，**不含 from**）
 *   · mode='single' ：只有 to → **只校验 to 这一个提交**（from 为 null，调用方走单提交路径）
 *   · mode='empty'  ：都没有 → ok:false（由调用方按 --allow-empty 决定是否放行）
 *
 * 为什么单提交**不能**写成 `X^..X`（直觉写法，实测两种坏结果）：
 *   1. `X` 是根提交时 `X^` 不存在 → `fatal: ambiguous argument`（本地夹具里撞到过）；
 *   2. 浅克隆（CI 的 `actions/checkout` 默认 `fetch-depth: 1`）里父提交不在本地 → 同样解析失败，
 *      而"只查最新一个提交"恰恰是浅历史下唯一**能**做的判定。
 * 所以单提交模式完全不依赖父提交：调用方直接对 `X` 取 `git log -1`。
 */
export function commitRangeSpec({ from = null, to = null } = {}) {
  const f = typeof from === 'string' && from.trim() !== '' ? from.trim() : null
  const t = typeof to === 'string' && to.trim() !== '' ? to.trim() : null
  if (f && t) return { ok: true, from: f, to: t, mode: 'range', reason: `${f}..${t}（不含 ${f}）` }
  if (t) return { ok: true, from: null, to: t, mode: 'single', reason: `${t}（只校验这 1 个提交，不需要父提交）` }
  return {
    ok: false,
    from: null,
    to: null,
    mode: 'empty',
    reason: '未给出任何范围内的提交（既没有 --from/--to，也没有可推导的范围）',
  }
}

/** 首行截断（报告里回显提交信息首行；已提交的 header 本就是公开内容，但仍防刷屏）。 */
export function truncateSubject(subject, max = SUBJECT_MAX) {
  const text = String(subject ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * 收敛校验结果。**fail-closed**：只要有一条提交校验不通过（或校验器本身抛错），
 * 结论就是失败；`checked` 与实际校验条数不一致（少校验了）也算失败。
 *
 * @param {Array<{sha:string, subject:string}>} commits 范围内提交（调用方从 git 取）
 * @param {(message:string) => Promise<{valid:boolean, errors:Array<{name:string,message:string}>}>} lintOne
 *        逐条提交的校验器（注入以便单测；生产实现是 @commitlint/lint + .commitlintrc.json）
 * @returns {{ok:boolean, checked:number, findings:Array, reason:string}}
 */
export async function collectFindings(commits, lintOne) {
  const findings = []
  let checked = 0
  for (const commit of commits) {
    checked += 1
    let result
    try {
      result = await lintOne(commit.message)
    } catch (error) {
      findings.push({
        commit: shortSha(commit.sha),
        subject: truncateSubject(commit.subject),
        errors: [{ name: 'lint-error', message: `校验器抛错：${String(error?.message ?? error).slice(0, 120)}` }],
      })
      continue
    }
    if (result?.valid === true) continue
    const errors = (result?.errors ?? []).map((e) => ({
      name: String(e?.name ?? 'unknown'),
      message: String(e?.message ?? '').slice(0, 160),
    }))
    findings.push({
      commit: shortSha(commit.sha),
      subject: truncateSubject(commit.subject),
      // 校验器返回"不合法但没有任何原因"时不能当作通过（fail-closed）：
      errors:
        errors.length > 0 ? errors : [{ name: 'unknown', message: '校验失败但未给出原因（commitlint 未返回 errors）' }],
    })
  }
  const ok = findings.length === 0
  return {
    ok,
    checked,
    findings,
    reason: ok ? `${checked} 条提交全部符合规范` : `${findings.length}/${checked} 条提交不符合规范`,
  }
}

/** 提交短 SHA（报告定位用）。 */
function shortSha(sha) {
  const s = String(sha ?? '')
  return s.length >= 8 ? s.slice(0, 8) : s || '?'
}

/** 逐条渲染 finding（`短SHA 首行` + 失败规则与原因）。超 maxItems 截断，避免刷屏。 */
export function renderFindings(findings, { maxItems = 10 } = {}) {
  const lines = []
  for (const f of findings.slice(0, maxItems)) {
    lines.push(`  ✖ ${f.commit}  ${f.subject}`)
    for (const e of f.errors.slice(0, 4)) lines.push(`      · ${e.name}：${e.message}`)
    if (f.errors.length > 4) lines.push(`      · …另有 ${f.errors.length - 4} 条规则问题`)
  }
  if (findings.length > maxItems)
    lines.push(`  …另有 ${findings.length - maxItems} 条提交不合格（已截断，完整清单见 CI 日志）`)
  return lines.join('\n')
}

/**
 * 渲染结论。ok=false 时给出**可操作**的修复指引（否则门禁只会制造困惑）。
 * notes 由调用方追加（例如「本次范围为空」这类上下文）。
 */
export function renderCommitReport({ ok, range, checked, findings, reason, notes = [] }) {
  const lines = []
  lines.push(`${ok ? '✅ 通过' : '❌ 失败'} — 提交信息规范（只校验本次变更范围）`)
  lines.push(`  范围：${range}`)
  lines.push(`  结论：${reason}`)
  for (const note of notes) lines.push(`  提示：${note}`)
  if (findings.length > 0) {
    lines.push(`  不合格提交（短 SHA + 首行；规则名与原因）：`)
    lines.push(renderFindings(findings))
    lines.push('  修复：git rebase -i <base> 后 `git commit --amend` / `reword` 改写首行为')
    lines.push(`        \`type(scope): #编号 摘要\`，type ∈ ${COMMIT_TYPES.join('/')}，scope 可省略（多个用逗号）；`)
    lines.push('        header ≤ 100 字符（中文摘要长时把细节移到正文，正文每行 ≤ 100 字符）。')
    lines.push('        本地自查：npm run lint:commits -- --from <base> --to HEAD')
  }
  return lines.join('\n')
}

/** 机器可读结果（供 --json / 子 agent 消费）。 */
export function commitRecord({ ok, range, checked, findings, ms, reason }) {
  return { ok, range, checked, ms, reason, findings }
}

/**
 * 「无法确定校验范围」的诊断（**不是**提交信息不合规）。
 *
 * 为什么单独一条：CI 在 `pull_request` 下校验 `base.sha..head.sha`，而 `actions/checkout`
 * 默认 `fetch-depth: 1` —— 两个 SHA 都不在本地仓库里，git 只回一句
 * `fatal: Invalid revision range A..B`。实测（issue #324 首个 CI 运行）这行输出被误读成
 * "提交信息写错了"，而真正该做的是给 checkout 加 `fetch-depth: 0`。
 *
 * 纯函数（浅克隆与否由调用方探测后传入），便于单测。
 */
export function renderRangeFailure({ spec, gitError, isShallow = null }) {
  const shallowText =
    isShallow === true ? '是（git rev-parse --is-shallow-repository = true）' : isShallow === false ? '否' : '未知'
  return [
    '❌ 无法确定校验范围 —— **不是**提交信息不合规（fail-closed：范围解析不了绝不当作"通过"）',
    `  范围：${spec?.reason ?? '(未指定)'}`,
    `  git 报错：${gitError}`,
    `  本仓库是浅克隆：${shallowText}`,
    '  常见原因：CI 的 actions/checkout 用了默认 fetch-depth: 1，base/head 两个 SHA 都取不到',
    '  修法：该 job 的 checkout 加 `fetch-depth: 0`（或显式 `git fetch origin <base>`）',
    `  本地复现/自查：npm run lint:commits -- --from <base> --to <head>（本次为 ${spec?.from ?? '?'} .. ${spec?.to ?? '?'}）`,
  ].join('\n')
}

/**
 * 「空范围」的处置：默认判失败（fail-closed）；只有调用方显式传 allowEmpty（仅本地调试用）
 * 才放行并打印原因。CI 永远不传该开关，因此门禁不会被这条路悄悄放宽。
 */
export function decideEmptyRange({ allowEmpty = false, reason }) {
  if (allowEmpty) return { ok: true, reason: `${reason}（--allow-empty：本地显式放行，CI 不会这么传）` }
  return { ok: false, reason: `${reason} —— fail-closed 判失败（无法确定校验范围时绝不当作"通过"）` }
}
