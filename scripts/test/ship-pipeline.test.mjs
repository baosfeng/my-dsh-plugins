/**
 * 提交流水线回归测试（scripts/ship.mjs + scripts/lib/ship-pipeline.mjs，issue #240）。
 *
 * 这一组测试的重点**不是功能，而是安全性**：ship 会推送并创建 PR（不可逆的外发动作），
 * 所以每一条 fail-closed 判据都必须是可断言的：
 *   1. 默认不外发 —— 没写 --push/--pr 就是"什么都不推"，而不是"默认同意"；
 *   2. 受保护分支 —— main / master 上直接拒绝；
 *   3. --pr 必须先 --push；
 *   4. 提交信息不合规提前失败（省掉一轮 hook 往返）；
 *   5. 本地校验失败 → 不开 PR（fail-closed）。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirSync } from 'tmp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  COMMIT_TYPES,
  PROTECTED_BRANCHES,
  externalActionPlan,
  guardProtectedBranch,
  parseShipArgs,
  planShipSteps,
  renderShipPlan,
  renderShipResult,
  validateCommitMessage,
} from '../lib/ship-pipeline.mjs'

const scriptDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(scriptDir, 'ship.mjs')
const libPath = join(scriptDir, 'lib', 'ship-pipeline.mjs')

const tempRoots = []

/**
 * 跑一次 CLI。默认 cwd = 本仓库（只用于不依赖 git 状态的用例）；
 * 需要特定 git 状态的用例必须用 cwd 指向构造出来的隔离仓库 ——
 * **不要赌当前仓库长什么样**：这正是 issue #240 那次 "本地过、CI 挂" 的教训
 * （CI 在 push 到 main 时 checkout 在受保护分支，本地却在特性分支）。
 */
function runCli(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    ...(cwd ? { cwd } : {}),
  })
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * 造一个**完全可控**的迷你仓库：只含 ship.mjs 与其 lib 依赖，外加一个初始提交。
 * 分支名可以指定 —— 受保护分支（main）与特性分支的行为差异必须在这里显式构造，
 * 而不是依赖跑测试时恰好检出在哪个分支上。
 */
function makeIsolatedRepo({ branch = 'main' } = {}) {
  const { name: dir } = dirSync({ unsafeCleanup: true, prefix: 'ship-test-' })
  tempRoots.push(dir)
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  copyFileSync(scriptPath, join(dir, 'scripts', 'ship.mjs'))
  copyFileSync(libPath, join(dir, 'scripts', 'lib', 'ship-pipeline.mjs'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', branch, '.'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'ship-test'])
  writeFileSync(join(dir, 'README.md'), '# isolated\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'chore: init'])
  return dir
}

/** 隔离仓库里的 ship.mjs 路径（runCli 默认用本仓库那份，这里显式指向副本）。 */
const isolatedScript = (dir) => join(dir, 'scripts', 'ship.mjs')

/** 在隔离仓库里跑 CLI（用仓库内那份副本，保证 root 推导正确）。 */
function runInRepo(dir, args) {
  const result = spawnSync(process.execPath, [isolatedScript(dir), ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('写操作默认拒绝（fail-closed）', () => {
  it('默认只提交：没给 --push/--pr 时，外发动作列表为空', () => {
    const plan = externalActionPlan({})
    expect(plan.required).toBe(false)
    expect(plan.actions).toEqual([])
    expect(plan.reason).toContain('写操作默认拒绝')
  })

  it('--push / --pr 才算显式同意（且动作可枚举）', () => {
    expect(externalActionPlan({ push: true }).actions).toEqual(['push'])
    expect(externalActionPlan({ push: true, pr: true }).actions).toEqual(['push', 'pr'])
  })

  it('--dry-run 即使带了 --push/--pr 也不外发', () => {
    const plan = externalActionPlan({ push: true, pr: true, dryRun: true })
    expect(plan.required).toBe(false)
    expect(plan.actions).toEqual([])
  })

  it('解析器默认 push/pr 均为 false（不能靠"没写参数"滑进推送）', () => {
    const o = parseShipArgs(['-m', 'fix(x): #1 修好'])
    expect(o.push).toBe(false)
    expect(o.pr).toBe(false)
  })
})

describe('受保护分支', () => {
  it('main / master 一律拒绝', () => {
    for (const branch of PROTECTED_BRANCHES) {
      const guard = guardProtectedBranch(branch)
      expect(guard.ok).toBe(false)
      expect(guard.reason).toContain('受保护分支')
    }
  })

  it('特性分支放行；detached HEAD 拒绝', () => {
    expect(guardProtectedBranch('fix/240-dx').ok).toBe(true)
    expect(guardProtectedBranch('').ok).toBe(false)
  })
})

describe('参数解析与提交信息校验', () => {
  it('--pr 必须与 --push 同用', () => {
    expect(parseShipArgs(['-m', 'fix(x): #1 修好', '--pr']).errors.join()).toContain('--pr 必须与 --push')
    expect(parseShipArgs(['-m', 'fix(x): #1 修好', '--push', '--pr']).errors).toEqual([])
  })

  it('缺提交信息 / 未知参数都报错', () => {
    expect(parseShipArgs(['--push']).errors.join()).toContain('缺少提交信息')
    expect(parseShipArgs(['-m', 'fix(x): #1 修好', '--force']).errors.join()).toContain('未知参数')
  })

  it('提交信息必须符合 conventional commits 白名单', () => {
    expect(validateCommitMessage('fix(dx): #240 修好').ok).toBe(true)
    expect(validateCommitMessage('perf(dx): #240 更快').ok).toBe(false) // perf 不在本仓库白名单
    expect(validateCommitMessage('随便写一句').ok).toBe(false)
    expect(validateCommitMessage('fix: ').ok).toBe(false)
    expect(COMMIT_TYPES).toContain('chore')
  })
})

describe('计划与结果渲染', () => {
  it('步骤顺序：提交 → 推送 → 并行校验 → PR', () => {
    const ids = planShipSteps({ push: true, pr: true }).map((s) => s.id)
    expect(ids).toEqual(['preflight', 'commit', 'push', 'verify', 'pr'])
    expect(planShipSteps({}).map((s) => s.id)).toEqual(['preflight', 'commit'])
  })

  it('执行前打印计划（含"外发动作"一行，作为最后一道可读防线）', () => {
    const text = renderShipPlan({
      branch: 'fix/240-dx',
      message: 'fix(x): #1 修好\n\n正文',
      steps: planShipSteps({ push: true }),
      external: externalActionPlan({ push: true }),
    })
    expect(text).toContain('fix/240-dx')
    expect(text).toContain('fix(x): #1 修好')
    expect(text).not.toContain('正文') // 只打印首行
    expect(text).toContain('已显式同意外发：push')
  })

  it('任一步失败 → 整体判失败且后续步骤不执行', () => {
    const ok = renderShipResult({ commit: { ok: true, detail: 'a' }, verify: { ok: true, detail: 'b' } })
    expect(ok.ok).toBe(true)
    const bad = renderShipResult({
      commit: { ok: true, detail: 'a' },
      verify: { ok: false, detail: 'exit 1' },
      pr: { ok: false, detail: '前置步骤未通过' },
    })
    expect(bad.ok).toBe(false)
    expect(bad.text).toContain('❌')
  })
})

describe('CLI 端到端（只读路径）', () => {
  it('--help 打印用法且退出码 0', () => {
    const { code, out } = runCli(['--help'])
    expect(code).toBe(0)
    expect(out).toContain('提交流水线')
    expect(out).toContain('没有 --push/--pr 就不会碰外部状态')
  })

  it('缺提交信息时退出码 2（用法错误与执行失败可区分）', () => {
    const { code, out } = runCli(['--push'])
    expect(code).toBe(2)
    expect(out).toContain('缺少提交信息')
  })

  it('提交信息不合规时退出码 2 且不再往下走', () => {
    const { code, out } = runCli(['-m', '随手写的提交信息', '--push'])
    expect(code).toBe(2)
    expect(out).toContain('不合规')
  })
})

describe('参数解析的完整开关面', () => {
  it('--base / --title / --issue / --draft / --dry-run / --json 都被识别并带默认值', () => {
    const o = parseShipArgs([
      '-m',
      'fix(x): #1 修好',
      '--push',
      '--pr',
      '--title',
      'T',
      '--issue',
      '240',
      '--base',
      'dev',
      '--draft',
      '--dry-run',
      '--json',
    ])
    expect(o).toMatchObject({
      title: 'T',
      issue: '240',
      base: 'dev',
      draft: true,
      dryRun: true,
      json: true,
      push: true,
      pr: true,
    })
    expect(o.errors).toEqual([])
    // 默认值：目标分支 main、非草稿、非 dry-run
    expect(parseShipArgs(['-m', 'fix(x): #1 修好'])).toMatchObject({ base: 'main', draft: false, dryRun: false })
  })

  it('-F / --message-file 二选一即可（长提交信息走文件）', () => {
    expect(parseShipArgs(['-F', '/tmp/msg.txt']).messageFile).toBe('/tmp/msg.txt')
    expect(parseShipArgs(['--message-file', '/tmp/msg.txt']).messageFile).toBe('/tmp/msg.txt')
    expect(parseShipArgs(['-F', '/tmp/msg.txt']).errors).toEqual([])
  })

  it('参数缺值时报「缺少参数值」而不是静默用 undefined', () => {
    expect(parseShipArgs(['-m']).errors.join()).toContain('缺少参数值')
    expect(parseShipArgs(['-m', 'fix(x): #1 修好', '--base']).errors.join()).toContain('缺少参数值')
  })

  it('--help 时不因缺提交信息而报错（帮助必须随时可看）', () => {
    expect(parseShipArgs(['--help']).errors).toEqual([])
    expect(parseShipArgs(['-h']).help).toBe(true)
  })
})

/**
 * issue #240 的真实 CI 失败防回归：**退出码语义必须与 git 状态无关**。
 *
 * 事故原文：main 红了 —— run 的 quality job 报
 *   AssertionError: expected 1 to be 2   @ scripts/test/ship-pipeline.test.mjs
 * 根因是 ship.mjs 把「分支守卫」（环境检查，exit 1）放在了「提交信息校验」（用法检查，
 * exit 2）之前；CI 在 push 到 main 时检出在受保护分支 → 用法错误被环境错误掩盖。
 * 下面三个用例用**显式构造的隔离仓库**锁死这条语义，不再赌跑测试时在哪个分支上。
 */
describe('退出码语义与 git 状态解耦（issue #240 防回归）', () => {
  it('用法错误优先：受保护分支上，不合规的提交信息仍返回 2 且报用法原因', () => {
    const repo = makeIsolatedRepo({ branch: 'main' })
    expect(
      spawnSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    ).toBe('main')
    const { code, out } = runInRepo(repo, ['-m', '随手写的提交信息', '--push'])
    expect(code).toBe(2)
    expect(out).toContain('不合规')
    expect(out).not.toContain('受保护分支')
  })

  it('环境错误：受保护分支 + 合规提交信息 → 1，且明确点出分支', () => {
    const repo = makeIsolatedRepo({ branch: 'main' })
    const { code, out } = runInRepo(repo, ['-m', 'fix(x): #240 修好', '--push'])
    expect(code).toBe(1)
    expect(out).toContain('受保护分支')
  })

  it('特性分支上用法错误仍是 2（与分支无关）', () => {
    const repo = makeIsolatedRepo({ branch: 'fix/240-x' })
    expect(runInRepo(repo, ['-m', '随手写的提交信息', '--push']).code).toBe(2)
  })

  it('环境错误：特性分支 + 合规提交信息 + 无改动 → 1，提示没有可提交的改动', () => {
    const repo = makeIsolatedRepo({ branch: 'fix/240-x' })
    const { code, out } = runInRepo(repo, ['-m', 'fix(x): #240 修好', '--push'])
    expect(code).toBe(1)
    expect(out).toContain('没有可提交的改动')
  })
})

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
})
