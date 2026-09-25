/**
 * verify-timeout.test.mjs —— 超时配置 fail-closed 的防回归测试（行为级）。
 *
 * 缺陷形态（fail-open）：`VERIFY_STEP_TIMEOUT=0` / `VERIFY_TIMEOUT=0` / `--timeout 0` 曾被
 * 解析层静默接受为「关闭超时上限」，执行层再用 `if (timeoutMs > 0)` 静默不设上限 ——
 * 非交互环境里把「配置为 0 / 空 / 非法」当成「无上限放行」，正是 AGENTS.md
 * 「写操作默认拒绝（fail-closed）」明令禁止的形态。
 *
 * 修后契约（本文件逐条钉住，每条都能独立变红）：
 *   ① 0 / 负数 / 空 / 非数字 → 启动即报错退出（exit 1），消息给出合法范围与正确关闭方式；
 *   ② 「无上限」只能由语义清晰的显式开关取得（VERIFY_TIMEOUT=none / VERIFY_STEP_TIMEOUT=none /
 *      VERIFY_NO_TIMEOUT=1），且必须在 stderr 打印显式警告，绝不静默；
 *   ③ 默认行为不变：不设环境变量时整体上限 300s、单步上限 120s（min 规则照旧）；
 *   ④ 报错与警告一律走 stderr —— stdout 留给 `--list --json` 的机器可读输出（门禁脚本消费）。
 *
 * 为什么用 `--list` / `--help` 观察：两者都在超时解析**之后**、任何检查项之前退出
 * （实测 0.04s，不读 git、不写工作区），因此既能证明「配置非法时根本不会开始跑检查」，
 * 又不给 test:scripts 增加可感知耗时。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../verify-local.mjs', import.meta.url))

/** 运行 verify-local；只带受控的 VERIFY_* 环境，避免调用方环境污染结论。 */
function runVerify({ env = {}, args = ['--list'] } = {}) {
  const base = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith('VERIFY_') || key === 'RUN_TIMEOUT_SEC') delete base[key]
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...base, ...env },
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 非法配置：过去全部被静默当成「关闭上限」或「回落默认」，现在必须硬失败。 */
const ILLEGAL = [
  ['VERIFY_STEP_TIMEOUT', '0'],
  ['VERIFY_STEP_TIMEOUT', '-1'],
  ['VERIFY_STEP_TIMEOUT', '0.4'],
  ['VERIFY_STEP_TIMEOUT', ''],
  ['VERIFY_STEP_TIMEOUT', ' '],
  ['VERIFY_STEP_TIMEOUT', 'abc'],
  ['VERIFY_STEP_TIMEOUT', 'false'],
  ['VERIFY_STEP_TIMEOUT', 'disable'],
  ['VERIFY_TIMEOUT', '0'],
  ['VERIFY_TIMEOUT', '-30'],
  ['VERIFY_TIMEOUT', 'ten'],
]

describe('超时配置 fail-closed：0 / 负数 / 空 / 非数字一律报错，不静默放行', () => {
  for (const [name, value] of ILLEGAL) {
    it(`${name}=${JSON.stringify(value)} → exit 1，并提示合法范围与关闭方式`, () => {
      const r = runVerify({ env: { [name]: value } })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(name)
      expect(r.stderr).toContain('none')
      // 配置非法时不得开始跑任何检查项（--list 的清单也没输出）
      expect(r.stdout).not.toContain('audit')
    })
  }

  it('--timeout 0 / -5 / abc → exit 1（命令行与环境变量同一口径）', () => {
    for (const raw of ['0', '-5', 'abc']) {
      const r = runVerify({ args: ['--timeout', raw, '--list'] })
      expect(r.status, `--timeout ${raw}`).toBe(1)
      expect(r.stderr).toContain('--timeout')
      expect(r.stderr).toContain('none')
    }
  })
})

describe('「无上限」只能由显式开关取得，且必须可见（不静默）', () => {
  it('VERIFY_NO_TIMEOUT=1 仍等价于关闭整体上限，并打印显式警告', () => {
    const r = runVerify({ env: { VERIFY_NO_TIMEOUT: '1' } })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('显式关闭')
  })

  it('VERIFY_TIMEOUT=none 显式关闭整体上限（语义清晰的关键字，而不是 0）', () => {
    const r = runVerify({ env: { VERIFY_TIMEOUT: 'none' } })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('显式关闭')
  })

  it('VERIFY_STEP_TIMEOUT=none 显式关闭单步上限', () => {
    const r = runVerify({ env: { VERIFY_STEP_TIMEOUT: 'none' } })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('显式关闭')
  })

  it('--timeout none 显式关闭整体上限', () => {
    const r = runVerify({ args: ['--timeout', 'none', '--list'] })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('显式关闭')
  })

  it('关闭整体上限 ≠ 关闭单步上限（VERIFY_TIMEOUT=none 时单步仍是默认 120s）', () => {
    const r = runVerify({ env: { VERIFY_TIMEOUT: 'none' }, args: ['--help'] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('单个子进程超时（当前 120s）')
  })
})

describe('默认行为不变（不设环境变量时默认上限存在且 > 0）', () => {
  it('默认整体 300s / 单步 120s，且无「已关闭」警告', () => {
    const r = runVerify({ args: ['--help'] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('整体超时上限（当前 300s）')
    expect(r.stdout).toContain('单个子进程超时（当前 120s）')
    expect(r.stderr).not.toContain('显式关闭')
  })

  it('VERIFY_TIMEOUT=900 → 整体 900s，单步仍 120s', () => {
    const r = runVerify({ env: { VERIFY_TIMEOUT: '900' }, args: ['--help'] })
    expect(r.stdout).toContain('整体超时上限（当前 900s）')
    expect(r.stdout).toContain('单个子进程超时（当前 120s）')
  })

  it('VERIFY_TIMEOUT=45 → 单步随整体收紧到 45s', () => {
    const r = runVerify({ env: { VERIFY_TIMEOUT: '45' }, args: ['--help'] })
    expect(r.stdout).toContain('整体超时上限（当前 45s）')
    expect(r.stdout).toContain('单个子进程超时（当前 45s）')
  })

  it('VERIFY_STEP_TIMEOUT=600 → 单步显式放宽到 600s（放宽 ≠ 关闭）', () => {
    const r = runVerify({ env: { VERIFY_STEP_TIMEOUT: '600' }, args: ['--help'] })
    expect(r.stdout).toContain('单个子进程超时（当前 600s）')
  })

  it('VERIFY_NO_TIMEOUT=0 不等于关闭（只有精确的 1 才是显式开关）', () => {
    const r = runVerify({ env: { VERIFY_NO_TIMEOUT: '0' }, args: ['--help'] })
    expect(r.stdout).toContain('整体超时上限（当前 300s）')
  })
})
