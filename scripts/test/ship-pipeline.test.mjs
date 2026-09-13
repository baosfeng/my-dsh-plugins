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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'ship.mjs')

/** 跑一次 CLI（只测只读路径：--help / 参数错误 / --dry-run 之前就失败的分支）。 */
function runCli(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: 60_000 })
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
