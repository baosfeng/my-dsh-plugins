#!/usr/bin/env node
/**
 * ship.mjs — 「提交 → 推送 → 开 PR」一条命令的流水线（issue #240）。
 *
 *   node scripts/ship.mjs -m "fix(x): #123 修好某问题"                     # 只提交（默认，不外发）
 *   node scripts/ship.mjs -m "..." --push                                # 提交 + 推送
 *   node scripts/ship.mjs -m "..." --push --pr --title "fix(x): #123 ..." # 提交 + 推送 + 开 PR
 *   node scripts/ship.mjs -m "..." --push --pr --issue 240 --draft
 *   node scripts/ship.mjs -m "..." --dry-run                             # 只打印计划
 *
 * 它解决的痛点是**串行等待**：常见做法是「本地跑 verify → push → 开 PR → 干等 CI」，
 * 其中「本地 verify」与「CI」本可以同时跑。本脚本的顺序是：
 *
 *   commit（保留 pre-commit 门禁）→ 启动 verify-local（后台）→ 同时 git push
 *   → 等 verify 结果 → 通过才开 PR
 *
 * 为什么 push 用 --no-verify：pre-push 钩子会**串行**再跑一遍 verify-local，
 * 那样"与 CI 并行"就无从谈起。本脚本用 --no-verify 跳过钩子，**但自己一定会跑**
 * verify-local，且**校验失败时拒绝开 PR 并以非零退出** —— 门禁没有被削弱，
 * 只是从"推送前阻塞"改成了"推送后并行"。
 * （若你更信任钩子：不加 --push，自己 `git push` 就是原来的串行路径。）
 *
 * 安全模型（AGENTS.md「写操作默认拒绝」）：
 *   · 默认只提交，不外发；--push / --pr 是**显式同意**参数；
 *   · 拒绝在 main / master 上执行；
 *   · 执行前先打印计划；--dry-run 只打印。
 *
 * 退出码：0 成功；1 前置/校验/推送失败；2 用法错误。
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  externalActionPlan,
  guardProtectedBranch,
  parseShipArgs,
  planShipSteps,
  renderShipPlan,
  renderShipResult,
  validateCommitMessage,
} from './lib/ship-pipeline.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseShipArgs(process.argv.slice(2))
const log = (text = '') => process.stdout.write(`${text}\n`)

if (options.help) {
  log(`ship.mjs — 提交流水线（issue #240）

  -m, --message <文本>   提交信息（conventional commits；也可用 -F <文件>）
      --push             显式同意：推送到 origin
      --pr               显式同意：创建 PR（必须与 --push 同用）
      --title <文本>     PR 标题（默认取提交信息首行）
      --issue <编号>     PR 正文里加 Closes #<编号>
      --base <分支>      PR 目标分支（默认 main）
      --draft            建草稿 PR
      --dry-run          只打印计划，不做任何写操作

默认只做本地提交；没有 --push/--pr 就不会碰外部状态。`)
  process.exit(0)
}
if (options.errors.length > 0) {
  for (const err of options.errors) console.error(`✖ ${err}`)
  process.exit(2)
}

/**
 * 跑一次 git。
 *
 * ⚠️ stdin 语义（issue #337）—— 本文件最容易踩的坑：
 * `git commit -F -` 里的 `-` 表示「从 **stdin** 读提交信息」，所以提交信息必须通过
 * `input` 真的写进子进程。旧写法是 `git(['commit','-F','-'], { inherit: true })`，
 * `stdio: 'inherit'` 让 git 继承父进程的 stdin，脚本从未把 `-m/--message-file` 的内容
 * 写进去，于是：
 *   · 非交互（agent / CI / 重定向 / stdin 是 /dev/null）：stdin 立即 EOF →
 *     `Aborting commit due to empty commit message`，**必然失败**；
 *   · 交互终端：git 静默等终端输入、不打任何提示 → 看起来"卡住"。
 * 所以：**只要给了 `input`，stdin 就必须是 `pipe`**（write 得进去才读得到）。
 * stdout/stderr 仍按 `inherit` 透传 —— pre-commit 门禁的输出照旧实时可见，
 * 且此处**不加 `--no-verify`**，门禁一行都没被绕过。
 */
function git(args, { inherit = false, input, allowFail = false } = {}) {
  const stdin = input === undefined ? (inherit ? 'inherit' : 'ignore') : 'pipe'
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
    stdio: [stdin, inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'],
  })
  const out = inherit ? '' : `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (!allowFail && (result.status ?? 1) !== 0) {
    console.error(`✖ git ${args.join(' ')} 失败：\n${out}`)
    process.exit(1)
  }
  return { code: result.status ?? 1, out }
}

// ── 前置检查 ────────────────────────────────────────────────────────────────
// ⚠️ 顺序即语义：**用法校验（退出码 2）必须全部先于环境校验（退出码 1）**。
// 反例（issue #240 的真实 CI 失败）：CI 在 push 到 main 时 checkout 到受保护分支，
// 若分支守卫先跑，提交信息写错的人会拿到「拒绝在受保护分支上跑流水线」（exit 1），
// 而真正的原因（信息不合规，exit 2）被掩盖 —— 退出码再也无法区分
// 「我命令写错了」和「环境不对」。测试也因此变成"本地过、CI 挂"。
const message = options.messageFile ? readFileSync(options.messageFile, 'utf8') : options.message
const messageCheck = validateCommitMessage(message)
if (!messageCheck.ok) {
  console.error(`✖ 提交信息不合规：${messageCheck.reason}`)
  console.error('  格式：<type>(<scope>): <描述>，type ∈ ' + 'feat/fix/docs/style/refactor/test/chore/ci')
  process.exit(2)
}
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out
const branchGuard = guardProtectedBranch(branch)
if (!branchGuard.ok) {
  console.error(`✖ ${branchGuard.reason}`)
  process.exit(1)
}
const dirty = git(['status', '--porcelain']).out
if (!dirty) {
  console.error('✖ 没有可提交的改动（工作区与暂存区都是干净的）')
  process.exit(1)
}
const steps = planShipSteps({ push: options.push, pr: options.pr })
const external = externalActionPlan({ push: options.push, pr: options.pr, dryRun: options.dryRun })
log(renderShipPlan({ branch, message, steps, external }))
if (options.dryRun) {
  log('\n（--dry-run：未执行任何动作）')
  process.exit(0)
}

// ── 1) 提交（保留 pre-commit 门禁）──────────────────────────────────────────
// `-m` 与 `-F <文件>` 两个入口在上面的 `message` 处已统一成字符串，这里一律经
// stdin 交给 `git commit -F -`（见 git() 的 stdin 注释，issue #337）。
git(['add', '-A'])
git(['commit', '-F', '-'], { inherit: true, input: message })
const headCommit = git(['log', '--oneline', '-1']).out
log(`\n✔ commit：${headCommit}`)

const result = { commit: { ok: true, detail: headCommit } }
let verifyCode = 0

// ── 2) 推送 + 并行的本地校验 ────────────────────────────────────────────────
if (options.push && external.required) {
  // 先起本地校验（后台），再推送 —— 两者并行，省掉"等本地校验"的那段墙钟。
  // issue #330 + 规范第十四节「本地绿 ⇒ CI 绿」：与 pre-push 同款，默认跑 **CI 等价全量**
  // （不再默认 --fast）——本地多花几十秒换掉一次约半小时的 CI 往返。
  // 显式快速通道：SHIP_VERIFY_MODE=fast node scripts/ship.mjs ...
  const verifyArgs = process.env.SHIP_VERIFY_MODE === 'fast' ? ['--fast'] : ['--full']
  const verify = spawn(process.execPath, ['scripts/verify-local.mjs', ...verifyArgs], {
    cwd: root,
    stdio: 'inherit',
  })
  const pushRes = git(['push', '--no-verify', '-u', 'origin', 'HEAD'], { allowFail: true })
  if (pushRes.code === 0) {
    result.push = { ok: true, detail: pushRes.out.split('\n').slice(-1)[0] || 'ok' }
  } else {
    result.push = { ok: false, detail: pushRes.out.split('\n').slice(-1)[0] || 'push 失败' }
  }
  verifyCode = await new Promise((resolve) => verify.on('exit', (code) => resolve(code ?? 1)))
  result.verify = {
    ok: verifyCode === 0,
    detail: verifyCode === 0 ? '全部通过（与 CI 并行执行）' : `exit ${verifyCode}：本地校验未通过`,
  }
}

// ── 3) 开 PR（本地校验失败则不建）───────────────────────────────────────────
if (options.pr && result.verify?.ok && result.push?.ok) {
  const title = options.title ?? message.split('\n')[0]
  const bodyLines = [options.issue ? `Closes #${options.issue}` : '由 scripts/ship.mjs 创建']
  const args = [
    'pr',
    'create',
    'baosfeng/my-dsh-plugins',
    '--title',
    title,
    '--body',
    bodyLines.join('\n'),
    '--head',
    branch,
    '--base',
    options.base,
  ]
  if (options.draft) args.push('--draft')
  const prRes = spawnSync(process.env.GHOPS_BIN ?? 'ghops', args, { cwd: root, encoding: 'utf8' })
  const prOut = `${prRes.stdout ?? ''}${prRes.stderr ?? ''}`.trim()
  result.pr = prRes.error
    ? { ok: false, detail: `找不到 ghops（${prRes.error.code}）：手工执行 ghops pr create ...` }
    : { ok: (prRes.status ?? 1) === 0, detail: prOut.split('\n').slice(-1)[0] || 'ok' }
} else if (options.pr) {
  result.pr = { ok: false, detail: '前置步骤未通过，已跳过开 PR（fail-closed）' }
}

const summary = renderShipResult(result)
log(`\n${summary.text}`)
process.exit(summary.ok ? 0 : 1)
