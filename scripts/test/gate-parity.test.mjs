/**
 * 门禁覆盖一致性校验的回归测试（issue #330）—— `scripts/check-gate-parity.mjs` 与
 * `scripts/lib/ci-workflow.mjs` 的纯函数部分。
 *
 * 为什么这个测试特别重要：parity 校验器的失败模式是「**恒返回一致**」——它一旦写错，
 * 门禁看起来在跑、实际上什么都没查，而这正是本卡要根治的病（本地绿 / CI 红）。所以
 * 除了正例（真实 ci.yml + 真实本地清单 → 0 缺口），每个检测维度都必须有一条**故意违规**
 * 的反例断言它真的报出来：
 *   1. registry 声明了本地检查项、verify-local 没有            → [声明≠本地]
 *   2. verify-local 多了一个未登记的检查项                      → [本地≠声明]
 *   3. registry 的 localCommand 与本地实际命令漂移              → [命令漂移]
 *   4. 某项是否属于 CI quality 聚合步骤两边说法不一致           → [范围漂移]
 *   5. ci.yml 里出现未登记的命令步骤                            → [CI≠声明]
 *   6. registry 声明的 CI 步骤在 ci.yml 中不存在                → [声明≠CI]
 *   7. 第三方上报步骤（Coveralls）没开容错                      → [上报不得判红]（issue #350）
 * 外加 ci.yml 解析器本身的正例（job 集合、块标量 step 的内容）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  checkBestEffortInfra,
  checkCiBlockingHasLocal,
  checkExemptions,
  checkGateParity,
  checkInvocations,
  readLocalChecks,
} from '../check-gate-parity.mjs'
import { findJob, findStep, parseWorkflow, stepCommand } from '../lib/ci-workflow.mjs'
import {
  CI_QUALITY_CHECK_IDS,
  GATE_BY_ID,
  GATE_REGISTRY,
  LOCAL_CHECK_IDS,
  LOCAL_EXEMPTIONS,
  ciDeclarations,
} from '../lib/gate-registry.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflowText = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

/** 真实本地清单只取一次（子进程开销约 100ms）。 */
let localChecks
beforeAll(() => {
  localChecks = readLocalChecks()
})

describe('ci.yml 解析（lib/ci-workflow.mjs）', () => {
  it('解析出全部 job，且 quality job 的存在被看见', () => {
    const parsed = parseWorkflow(workflowText)
    const names = parsed.jobs.map((j) => j.name)
    expect(names).toContain('quality')
    expect(names).toContain('audit')
    expect(names).toContain('test')
    expect(names).toContain('resource-smoke')
    expect(names).toContain('mutation')
    // 每个 job 都在 jobs: 下被识别（不是漏读成 0 个）
    expect(names.length).toBeGreaterThanOrEqual(5)
  })

  it('quality job 的聚合步骤存在，且命令是 --ci-quality', () => {
    const step = findStep(parseWorkflow(workflowText), 'quality', 'Quality gates (concurrent, registry-driven)')
    expect(step).not.toBeNull()
    expect(stepCommand(step)).toContain('node scripts/verify-local.mjs --ci-quality')
  })

  it('run 块标量（多行脚本）被完整读出', () => {
    const step = findStep(parseWorkflow(workflowText), 'test', 'Syntax check')
    expect(stepCommand(step)).toContain('node --check')
    expect(stepCommand(step)).toContain('lib/index.js')
  })

  it('matrix 的插件列表不会被误当成 step（解析器最易踩的坑）', () => {
    const job = findJob(parseWorkflow(workflowText), 'test')
    // 19 个插件 + 3 个真实 step（setup 用 uses 声明，Syntax/Test/Upload）
    expect(job.steps.length).toBeLessThan(10)
    expect(job.steps.some((s) => s.name.includes('dsh-file-activity'))).toBe(false)
  })

  it('注释与引号被剥掉（uses 带 `# v7` 尾注仍可匹配白名单）', () => {
    const parsed = parseWorkflow(workflowText)
    const checkout = parsed.jobs[0].steps.find((s) => s.uses.startsWith('actions/checkout@'))
    expect(checkout.uses).not.toContain('#')
  })

  it('空 job / 无 steps 的 job 不会抛异常', () => {
    const parsed = parseWorkflow('jobs:\n  empty:\n    runs-on: ubuntu-latest\n')
    expect(parsed.jobs).toEqual([{ name: 'empty', steps: [] }])
  })
})

describe('门禁登记表自检（lib/gate-registry.mjs）', () => {
  it('id 唯一，且每条都有权威执行点与理由', () => {
    expect(GATE_BY_ID.size).toBe(GATE_REGISTRY.length)
    for (const gate of GATE_REGISTRY) {
      expect(gate.authority, `${gate.id} 缺 authority`).toBeTruthy()
      expect(gate.why, `${gate.id} 缺 why`).toBeTruthy()
      expect(gate.cost, `${gate.id} 缺 cost`).toBeTruthy()
      expect(gate.local === null || typeof gate.localCommand === 'string', `${gate.id} 本地命令缺失`).toBeTruthy()
    }
  })

  it('每条规则都有至少一个执行点（本地或 CI）', () => {
    for (const gate of GATE_REGISTRY) {
      expect(gate.local !== null || Boolean(gate.ci), `${gate.id} 没有任何执行点`).toBe(true)
    }
  })

  it('LOCAL_CHECK_IDS / CI_QUALITY_CHECK_IDS 与登记内容一致', () => {
    expect(LOCAL_CHECK_IDS).toEqual(GATE_REGISTRY.filter((g) => g.local !== null).map((g) => g.id))
    expect(CI_QUALITY_CHECK_IDS).toEqual(GATE_REGISTRY.filter((g) => g.ci?.job === 'quality').map((g) => g.id))
    // quality 聚合步骤之外的规则必须有独立 job（否则它其实没在 CI 跑）
    // ci 为 null 的是本地专属检查（merge-ref：CI 自身就是 merge ref），不要求独立 job
    for (const gate of GATE_REGISTRY.filter((g) => g.ci && g.ci.job !== 'quality')) {
      expect(gate.ci.job, `${gate.id} 的 CI 位置可疑`).toBeTruthy()
    }
    expect(ciDeclarations().length).toBeGreaterThanOrEqual(GATE_REGISTRY.length)
  })
})

describe('parity 校验：正例与六个维度的反例', () => {
  it('真实 ci.yml + 真实本地清单 → 0 缺口', () => {
    expect(checkGateParity({ workflowText, localChecks })).toEqual([])
  })

  it('[声明≠本地] verify-local 少了 registry 声明的检查项', () => {
    const gaps = checkGateParity({ workflowText, localChecks: localChecks.filter((c) => c.id !== 'knip') })
    expect(gaps.some((g) => g.startsWith('[声明≠本地]') && g.includes('knip'))).toBe(true)
  })

  it('[本地≠声明] verify-local 多了一个未登记的检查项', () => {
    const ghost = { id: 'ghost-check', label: 'ghost', optional: false, ciQuality: true, command: 'node x.mjs' }
    const gaps = checkGateParity({ workflowText, localChecks: [...localChecks, ghost] })
    expect(gaps.some((g) => g.startsWith('[本地≠声明]') && g.includes('ghost-check'))).toBe(true)
  })

  it('[命令漂移] 本地实际命令与 registry 声明不一致', () => {
    const drifted = localChecks.map((c) => (c.id === 'lint' ? { ...c, command: 'npx eslint .' } : c))
    const gaps = checkGateParity({ workflowText, localChecks: drifted })
    expect(gaps.some((g) => g.startsWith('[命令漂移]') && g.includes('lint'))).toBe(true)
  })

  it('[范围漂移] ciQuality 标记两边不一致（本地少跑/多跑一条规则）', () => {
    const drifted = localChecks.map((c) => (c.id === 'format' ? { ...c, ciQuality: false } : c))
    const gaps = checkGateParity({ workflowText, localChecks: drifted })
    expect(gaps.some((g) => g.startsWith('[范围漂移]') && g.includes('format'))).toBe(true)
  })

  it('[CI≠声明] ci.yml 里出现未登记的命令步骤', () => {
    const sneaky = `${workflowText}\n      - name: Sneaky extra gate\n        run: npx eslint plugins/ --max-warnings 0\n`
    const gaps = checkGateParity({ workflowText: sneaky, localChecks })
    expect(gaps.some((g) => g.startsWith('[CI≠声明]') && g.includes('Sneaky extra gate'))).toBe(true)
  })

  it('[声明≠CI] registry 声明的 CI 步骤在 ci.yml 中不存在', () => {
    const withoutQuality = workflowText.replace(/--ci-quality/g, '--no-such-mode')
    const gaps = checkGateParity({ workflowText: withoutQuality, localChecks })
    expect(gaps.some((g) => g.startsWith('[声明≠CI]'))).toBe(true)
  })

  it('基础设施步骤（checkout / setup-node / npm ci / coveralls）不算未登记门禁', () => {
    const gaps = checkGateParity({ workflowText, localChecks })
    expect(gaps.filter((g) => g.includes('actions/checkout') || g.includes('npm ci'))).toEqual([])
  })

  it('continue-on-error 被解析出来（issue #350 的容错开关）', () => {
    const parsed = parseWorkflow(workflowText)
    const infra = parseWorkflow(
      'jobs:\n  j:\n    steps:\n      - name: a\n        uses: x/y@v1\n        continue-on-error: true\n      - name: b\n        run: echo hi\n',
    )
    expect(findStep(infra, 'j', 'a').continueOnError).toBe(true)
    expect(findStep(infra, 'j', 'b').continueOnError).toBe(false)
    // 真实 ci.yml 的两个 Coveralls 上报步骤都必须开着容错
    expect(findStep(parsed, 'test', 'Upload coverage to Coveralls').continueOnError).toBe(true)
    expect(findStep(parsed, 'coverage-finish', 'Coveralls finished').continueOnError).toBe(true)
  })
})

describe('第三方上报步骤不得判红（issue #350）', () => {
  it('真实 ci.yml：所有上报类基础设施步骤都带 continue-on-error → 0 缺口', () => {
    expect(checkBestEffortInfra(parseWorkflow(workflowText))).toEqual([])
    expect(checkGateParity({ workflowText, localChecks })).toEqual([])
  })

  it('[上报不得判红] 去掉容错 → 逐个报出（否则「下载抖动判红」会静默复发）', () => {
    const noTolerance = workflowText.replace(/^ {8}continue-on-error: true\n/gm, '')
    const gaps = checkGateParity({ workflowText: noTolerance, localChecks })
    const reported = gaps.filter((g) => g.startsWith('[上报不得判红]'))
    expect(reported.length).toBe(2) // test 的 Upload + coverage-finish 的 finished
    expect(reported.some((g) => g.includes('Upload coverage to Coveralls'))).toBe(true)
    expect(reported.some((g) => g.includes('coverage-finish'))).toBe(true)
  })
})

describe('「本地绿 ⇒ CI 绿」三类失败用例（规范第十四节）', () => {
  it('①[CI 有本地无] CI 的阻断步骤在本地找不到对应检查项', () => {
    // 模拟 issue #330 第 5 条的原始形态：CI 跑逐插件 tsc，本地只跑根 tsc
    const withoutPlugins = localChecks.filter((c) => c.id !== 'typecheck-plugins')
    const gaps = checkGateParity({ workflowText, localChecks: withoutPlugins })
    expect(gaps.some((g) => g.startsWith('[CI 有本地无]'))).toBe(true)
    // 直接调纯函数也应报出（用真实 ci.yml）
    const parsed = parseWorkflow(workflowText)
    expect(checkCiBlockingHasLocal(parsed, withoutPlugins).length).toBeGreaterThan(0)
    expect(checkCiBlockingHasLocal(parsed, localChecks)).toEqual([])
  })

  it('②[本地有 CI 无]（#333 的形态：只注册了本地、ci.yml 没有 step）', () => {
    const noQualityStep = workflowText.replace('run: node scripts/verify-local.mjs --ci-quality', 'run: echo skipped')
    const gaps = checkGateParity({ workflowText: noQualityStep, localChecks })
    expect(gaps.some((g) => g.startsWith('[声明≠CI]'))).toBe(true)
  })

  it('③[注册未调用] 命令引用的 npm script / 脚本文件不存在', () => {
    // 少一个 package.json script → 必须报出（本仓库先例：audit 静默不生效、eslint 检查从未运行）
    const missing = new Set(['lint:size']) // registry 里 client-size/pack-hygiene 等都走 node scripts/，故意删一个真实被引用的
    const gaps = checkInvocations(missing)
    expect(gaps.some((g) => g.startsWith('[注册未调用]'))).toBe(true)
    // 完整 package.json scripts 时不应有缺口
    const full = new Set(['test:scripts', 'lint:size', 'check:client-modules', 'check:links'])
    expect(checkInvocations(full)).toEqual([])
  })

  it('白名单必须显式、带充分理由、且不得以「本地慢」为借口', () => {
    // 真实白名单：只有 audit，且通过校验
    expect(checkExemptions(localChecks)).toEqual([])
    // 伪造一条以「慢」为理由的豁免 → 必须被拒
    const slowExemption = {
      id: 'knip',
      kind: 'ci-env',
      reason: '本地跑太慢所以跳过，交给 CI 去跑就好了，理由足够长了吧',
    }
    const saved = LOCAL_EXEMPTIONS.splice(0, LOCAL_EXEMPTIONS.length, slowExemption)
    try {
      const gaps = checkExemptions(localChecks)
      expect(gaps.some((g) => g.includes('不是豁免理由'))).toBe(true)
    } finally {
      LOCAL_EXEMPTIONS.splice(0, LOCAL_EXEMPTIONS.length, ...saved)
    }
  })

  it('「默认跳过」必须与白名单一致（防静默降级）', () => {
    const sneaky = localChecks.map((c) => (c.id === 'knip' ? { ...c, optional: true } : c))
    const gaps = checkExemptions(sneaky)
    expect(gaps.some((g) => g.includes('不在 LOCAL_EXEMPTIONS 里'))).toBe(true)
  })
})
