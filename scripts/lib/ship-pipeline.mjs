/**
 * ship-pipeline.mjs — 「提交 → 推送 → 开 PR」流水线的纯函数件（issue #240）。
 *
 * 为什么需要它：owner 要求「能早点提交的就提交、能流水线处理的就流水线处理」。
 * 子 agent 的常见做法是「本地跑完 verify-local → 再 push → 再开 PR → 再干等 CI」，
 * 其中「干等」是纯浪费：CI 与本地校验完全可以同时跑。
 *
 * 本模块只做**判定**（不碰 git、不碰网络），便于单测；IO 侧在 scripts/ship.mjs。
 *
 * 安全模型（AGENTS.md「写操作默认拒绝」）：
 *   · 默认什么都不外发 —— 只有显式给出 --push / --pr 才动外部状态；
 *   · 拒绝向 main / master 推送（流水线只服务特性分支）；
 *   · --pr 必须与 --push 同时给（PR 需要远程分支）。
 */

/** commitlint 的 type 白名单（与 .commitlintrc.json 保持一致）。 */
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci']

/** 受保护分支：流水线不服务它们（推 main 是破坏性动作，必须走人工）。 */
export const PROTECTED_BRANCHES = ['main', 'master']

/**
 * 解析参数。刻意让 push / pr 默认 false：
 * 「没写 --push」必须是「不推送」，而不是「默认推送」。
 */
export function parseShipArgs(argv = []) {
  const args = [...argv]
  const options = {
    message: null,
    messageFile: null,
    push: false,
    pr: false,
    draft: false,
    title: null,
    issue: null,
    base: 'main',
    dryRun: false,
    json: false,
    help: false,
    errors: [],
  }
  const value = (flag) => {
    const next = args.shift()
    if (next === undefined) options.errors.push(`${flag}：缺少参数值`)
    return next
  }
  while (args.length > 0) {
    const flag = args.shift()
    switch (flag) {
      case '--message':
      case '-m':
        options.message = value(flag)
        break
      case '--message-file':
      case '-F':
        options.messageFile = value(flag)
        break
      case '--title':
        options.title = value(flag)
        break
      case '--issue':
        options.issue = value(flag)
        break
      case '--base':
        options.base = value(flag) ?? 'main'
        break
      case '--push':
        options.push = true
        break
      case '--pr':
        options.pr = true
        break
      case '--draft':
        options.draft = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--json':
        options.json = true
        break
      case '-h':
      case '--help':
        options.help = true
        break
      default:
        options.errors.push(`未知参数：${flag}`)
    }
  }
  if (!options.help && !options.message && !options.messageFile) {
    options.errors.push('缺少提交信息：--message "<type>(<scope>): <描述>" 或 --message-file <路径>')
  }
  if (options.pr && !options.push) {
    options.errors.push('--pr 必须与 --push 同时给（PR 需要先有远程分支）')
  }
  return options
}

/** 提交信息必须符合 conventional commits（与 commitlint 同一条规则，提前失败省一轮 hook）。 */
export function validateCommitMessage(message) {
  const text = String(message ?? '').trim()
  if (!text) return { ok: false, reason: '提交信息为空' }
  const firstLine = text.split('\n')[0]
  const match = /^([a-z]+)(\(([^)]+)\))?(!)?: (.+)$/.exec(firstLine)
  if (!match) {
    return { ok: false, reason: `首行不是 conventional commits 格式：${firstLine.slice(0, 40)}` }
  }
  if (!COMMIT_TYPES.includes(match[1])) {
    return { ok: false, reason: `type "${match[1]}" 不在白名单（${COMMIT_TYPES.join('/')}）` }
  }
  // 组序：1=type 2=scope 整体 3=scope 4=破坏性标记(!) 5=subject —— 别数错（漏掉 4 会把 ! 当 subject）
  const subject = match[5] ?? ''
  if (!subject.trim()) return { ok: false, reason: 'subject 为空' }
  return { ok: true, type: match[1], scope: match[3] ?? null, subject }
}

/** 受保护分支判定（返回 ok=false 时流水线必须中止）。 */
export function guardProtectedBranch(branch) {
  const name = String(branch ?? '').trim()
  if (!name) return { ok: false, reason: '无法确定当前分支（detached HEAD？）' }
  if (PROTECTED_BRANCHES.includes(name)) {
    return { ok: false, reason: `拒绝在受保护分支 ${name} 上跑流水线（推送 main 必须人工决策）` }
  }
  return { ok: true, reason: `分支 ${name}` }
}

/**
 * 外发动作的确认要求。
 * 判据：**显式给出 --push / --pr 才算同意**；两者都没有时脚本只做本地提交。
 * 返回的 required=false 表示"不需要外发"，不是"默认同意"。
 */
export function externalActionPlan({ push = false, pr = false, dryRun = false } = {}) {
  if (dryRun) return { required: false, actions: [], reason: '--dry-run：不外发任何动作' }
  const actions = []
  if (push) actions.push('push')
  if (pr) actions.push('pr')
  if (actions.length === 0)
    return { required: false, actions, reason: '未给 --push/--pr：只做本地提交（写操作默认拒绝）' }
  return { required: true, actions, reason: `已显式同意外发：${actions.join(' + ')}` }
}

/** 流水线步骤清单（纯数据，供 CLI 执行与单测断言顺序）。 */
export function planShipSteps({ push = false, pr = false } = {}) {
  const steps = [
    { id: 'preflight', label: '前置检查（分支 / 提交信息 / 是否有改动）' },
    { id: 'commit', label: 'git commit（保留 pre-commit 门禁）' },
  ]
  if (push) {
    steps.push({ id: 'push', label: 'git push（跳过 pre-push，改由下一步并行校验承担）' })
    steps.push({ id: 'verify', label: 'verify-local --fast（与 CI 并行执行）' })
  }
  if (pr) steps.push({ id: 'pr', label: 'ghops pr create（校验失败则不建 PR）' })
  return steps
}

/**
 * 渲染执行计划。**先打印再执行**：让人一眼看见"即将推送/开 PR"，
 * 这是 fail-closed 的最后一道人工可读防线。
 */
export function renderShipPlan({ branch, message, steps = [], external = null } = {}) {
  const lines = []
  lines.push(`提交流水线 → 分支 ${branch ?? '?'}`)
  lines.push(`  提交信息首行：${String(message ?? '').split('\n')[0]}`)
  for (const step of steps) lines.push(`  · ${step.label}`)
  if (external) lines.push(`  外发动作：${external.reason}`)
  return lines.join('\n')
}

/** 结果汇总（CLI 末尾打印；ok=false 时调用方必须非零退出）。 */
export function renderShipResult({ commit = null, push = null, verify = null, pr = null } = {}) {
  const lines = []
  if (commit) lines.push(`${commit.ok ? '✔' : '✖'} commit：${commit.detail}`)
  if (push) lines.push(`${push.ok ? '✔' : '✖'} push：${push.detail}`)
  if (verify) lines.push(`${verify.ok ? '✔' : '✖'} 本地校验（verify-local --fast）：${verify.detail}`)
  if (pr) lines.push(`${pr.ok ? '✔' : '✖'} PR：${pr.detail}`)
  const failed = [commit, push, verify, pr].filter((item) => item && !item.ok)
  const ok = failed.length === 0
  lines.unshift(ok ? '✅ 流水线完成' : '❌ 流水线中断（后续步骤未执行）')
  return { text: lines.join('\n'), ok }
}
