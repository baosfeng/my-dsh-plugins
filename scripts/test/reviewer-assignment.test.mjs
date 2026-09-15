/**
 * reviewer-assignment.test.mjs — PR 自动指派判据与 CI 降级语义测试（issue #304）。
 *
 * 覆盖三层：
 *   1. **纯函数判据**：自审过滤（唯一候选 = PR 作者 → 优雅跳过而不是请求自审）、
 *      多人候选只过滤作者本身、去重去空、无候选时的跳过原因；
 *   2. **仓库不变量**（防回归）：`auto-assign-reviewers.yml` 必须走
 *      `resolveReviewers`，不得回退成「把候选集合原样丢给 requestReviewers」的必然失败写法；
 *      `dependabot-auto-merge.yml` 的 approve 步骤必须保留「权限错误降级、其它错误照失败」语义；
 *   3. **降级语义实测**：从 `dependabot-auto-merge.yml` **提取真实的 approve run 段**，
 *      用假 `gh` 模拟「成功 / 无 approve 权限 / 其它错误」三种输出，断言
 *      权限错误时 step 退出码为 0（PR 上不再假红灯）、其它错误仍为非 0（不是静默忽略一切错误）。
 *
 * 证据来源：run 34969856346（Auto Assign Reviewers failure，
 * `Review cannot be requested from pull request author`）、
 * run 34766636038（Dependabot Auto-Merge failure / PR #286，
 * `GitHub Actions is not permitted to approve pull requests`）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveReviewers, describeAssignment } from '../lib/reviewer-assignment.mjs'

const readWorkflow = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')

const ASSIGN_WORKFLOW = 'auto-assign-reviewers.yml'
const AUTO_MERGE_WORKFLOW = 'dependabot-auto-merge.yml'

/**
 * 从 workflow 文本里提取某个 step 的 `run: |` 块正文（缩进感知，无第三方 YAML 依赖）。
 * 这里刻意解析**真实文件**而不是复制一份脚本，保证测的就是 CI 会执行的那段。
 */
function extractRunBlock(ymlText, stepNameFragment) {
  const lines = ymlText.split('\n')
  const start = lines.findIndex((line) => line.includes(stepNameFragment))
  if (start < 0) throw new Error(`未找到步骤：${stepNameFragment}`)
  const runAt = lines.findIndex((line, idx) => idx > start && /^\s*run: \|/.test(line))
  if (runAt < 0) throw new Error(`步骤 ${stepNameFragment} 没有 run: | 块`)
  const runIndent = lines[runAt].search(/\S/)
  const body = []
  for (let i = runAt + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (line.search(/\S/) <= runIndent) break
    body.push(line.slice(runIndent + 2))
  }
  return body.join('\n')
}

/** 假 `gh`：按 GH_STUB_MODE 复现真实 gh 的三类行为（错误走 stderr，退出码与真身一致）。 */
const FAKE_GH = `#!/usr/bin/env bash
echo "fake-gh $*"
case "$GH_STUB_MODE" in
  success) exit 0 ;;
  not-permitted)
    echo "failed to create review: GraphQL: GitHub Actions is not permitted to approve pull requests. (addPullRequestReview)" >&2
    exit 1 ;;
  other-error)
    echo "HTTP 404: Not Found (https://api.github.com/repos/o/r/pulls/1/reviews)" >&2
    exit 1 ;;
  *) echo "unknown stub mode" >&2; exit 2 ;;
esac
`

/** 在临时目录里用假 gh 执行真实的 approve run 段，返回 { status, stdout }。 */
function runApproveStep(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'approve-step-'))
  const ghPath = join(dir, 'gh')
  writeFileSync(ghPath, FAKE_GH)
  chmodSync(ghPath, 0o755)
  const scriptPath = join(dir, 'step.sh')
  writeFileSync(scriptPath, extractRunBlock(readWorkflow(AUTO_MERGE_WORKFLOW), 'Approve minor and patch updates'))

  const result = spawnSync('bash', ['-e', scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PR_URL: 'https://example.invalid/pull/1',
      GH_STUB_MODE: mode,
    },
  })
  return { status: result.status, stdout: `${result.stdout}${result.stderr}` }
}

describe('resolveReviewers：自审过滤与优雅跳过（issue #304）', () => {
  it('唯一候选就是 PR 作者时，过滤为不可请求并给出 only-pr-author 跳过原因', () => {
    const plan = resolveReviewers({ candidateReviewers: ['baosfeng'], prAuthor: 'baosfeng' })

    expect(plan.eligible).toEqual([])
    expect(plan.skippedSelf).toEqual(['baosfeng'])
    expect(plan.skipReason).toBe('only-pr-author')
  })

  it('多候选时只剔除作者本人，其余照常请求（回归：曾把作者一起请求 → 422）', () => {
    const plan = resolveReviewers({ candidateReviewers: ['baosfeng', 'reviewer-a'], prAuthor: 'baosfeng' })

    expect(plan.eligible).toEqual(['reviewer-a'])
    expect(plan.skippedSelf).toEqual(['baosfeng'])
    expect(plan.skipReason).toBeNull()
  })

  it('作者不在候选集合里时，候选全部可用（dependabot 之外的普通 PR 常态）', () => {
    const plan = resolveReviewers({ candidateReviewers: ['reviewer-a', 'reviewer-b'], prAuthor: 'someone-else' })

    expect(plan.eligible).toEqual(['reviewer-a', 'reviewer-b'])
    expect(plan.skipReason).toBeNull()
  })

  it('无候选时跳过原因是 no-candidate（不是硬失败）', () => {
    const plan = resolveReviewers({ candidateReviewers: [], prAuthor: 'baosfeng' })

    expect(plan.eligible).toEqual([])
    expect(plan.skipReason).toBe('no-candidate')
  })

  it('候选去重并剔除空值/空白，避免无意义请求', () => {
    const plan = resolveReviewers({
      candidateReviewers: ['reviewer-a', 'reviewer-a', '', '  ', null],
      prAuthor: 'baosfeng',
    })

    expect(plan.candidates).toEqual(['reviewer-a'])
    expect(plan.eligible).toEqual(['reviewer-a'])
  })

  it('describeAssignment 明确说出「过滤后可用的账号」与跳过原因，便于日志定位', () => {
    const skipped = describeAssignment(
      resolveReviewers({ candidateReviewers: ['baosfeng'], prAuthor: 'baosfeng' }),
      'baosfeng',
    )
    expect(skipped).toContain('过滤 PR 作者(baosfeng)后可用 (无)')
    expect(skipped).toContain('跳过')
    expect(skipped).not.toContain('\u001b')

    const assigned = describeAssignment(
      resolveReviewers({ candidateReviewers: ['baosfeng', 'reviewer-a'], prAuthor: 'baosfeng' }),
      'baosfeng',
    )
    expect(assigned).toContain('reviewer-a')
    expect(assigned).not.toContain('跳过')
  })
})

describe('仓库不变量：workflow 不得回退成必然失败的写法（issue #304）', () => {
  it('auto-assign-reviewers.yml 走 resolveReviewers，且不再直接派发候选集合', () => {
    const yml = readWorkflow(ASSIGN_WORKFLOW)

    expect(yml).toContain('scripts/lib/reviewer-assignment.mjs')
    expect(yml).toContain('resolveReviewers')
    // 旧写法：把含作者本人在内的候选集合直接交给 requestReviewers → 422
    expect(yml).not.toContain('reviewers: Array.from(reviewers)')
    // 无可用对象时必须走优雅跳过，而不是硬失败
    expect(yml).toContain('plan.eligible.length === 0')
    expect(yml).toContain('core.notice')
  })

  it('dependabot-auto-merge.yml 的 approve 步骤保留「权限错误降级 + 其它错误失败」语义', () => {
    const yml = readWorkflow(AUTO_MERGE_WORKFLOW)

    expect(yml).not.toContain('run: gh pr review --approve "$PR_URL"')
    expect(yml).toContain("grep -qi 'not permitted to approve'")
    expect(yml).toContain('::warning')
    expect(yml).toContain('::error')
    expect(yml).toContain('exit "$status"')
  })
})

describe('dependabot Auto-Merge：approve 失败时的降级语义（实测真实 run 段）', () => {
  it('approve 成功 → step 退出码 0', () => {
    const { status, stdout } = runApproveStep('success')

    expect(stdout).toContain('已自动 approve')
    expect(status).toBe(0)
  })

  it('无 approve 权限（平台策略）→ 打 warning 且 step 退出码仍为 0（不再假红灯）', () => {
    const { status, stdout } = runApproveStep('not-permitted')

    expect(stdout).toContain('::warning')
    expect(stdout).toContain('not permitted to approve')
    expect(stdout).toContain('issue #304')
    expect(status).toBe(0)
  })

  it('其它错误（非权限原因）→ 仍以非 0 退出并打 error（不是静默忽略一切错误）', () => {
    const { status, stdout } = runApproveStep('other-error')

    expect(stdout).toContain('::error')
    expect(stdout).toContain('HTTP 404')
    expect(status).not.toBe(0)
  })
})
