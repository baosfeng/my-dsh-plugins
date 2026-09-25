/**
 * verify-real-profile-timeout.test.mjs —— `--timeout` 入参的 fail-closed 防回归测试。
 *
 * 缺陷形态（fail-open 家族，与 verify-local 同一套超时规则）：
 *   verify-real-profile 的 `--timeout` 过去是裸 `Number(value())`，直接进
 *   `const deadline = Date.now() + options.timeoutSec * 1000` + `while (Date.now() < deadline)`：
 *     · `--timeout Infinity` / `1e999` → deadline = Infinity → 等待循环**恒真** →
 *       实例挂死时无限等待（发版门禁 release.mjs 3c 会一起挂住）—— 真 fail-open；
 *     · `--timeout 0` / 负数 / `abc` → NaN/过期 deadline → 判「未就绪」，但报错文案是
 *       「实例 NaNs 内未就绪」，把配置错误伪装成「实例没起来」（静默掩盖）。
 * 修后契约：解析规则复用 scripts/lib/verify-timeout.mjs（与 verify-local 同一套，不漂移），
 * 非法值一律启动即 exit 1，消息给出合法范围与原因；本脚本不支持关闭上限（none / off 同样拒绝）。
 *
 * 为什么用 `--help` 观察：`if (options.help)` 紧跟 parseArgs 之后、任何 profile 复刻 /
 * 实例启动之前就退出（不读真实 profile、不建临时目录、不 spawn 实例），因此既能证明
 * 「配置非法时根本不进入验证流程」，又完全无副作用、毫秒级。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../verify-real-profile.mjs', import.meta.url))

/** 运行 verify-real-profile（默认只带 --help：0 副作用、提前退出）。 */
function runProfile(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 非法超时值：0 / 负数 / 空 / 非数字 / 无穷大 / 家族里的「关闭」关键字。 */
const ILLEGAL = ['0', '-1', '-0.5', '0.4', '', ' ', 'abc', 'Infinity', '1e999', 'none', 'off', 'false']

describe('--timeout 必须有限且为正秒数（fail-closed，不静默 NaN / 不无限等待）', () => {
  for (const raw of ILLEGAL) {
    it(`--timeout ${JSON.stringify(raw)} → exit 1，并说明合法范围`, () => {
      const r = runProfile(['--timeout', raw, '--help'])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('--timeout')
      expect(r.stderr).toContain('正秒数')
      expect(r.stderr).toContain('fail-open')
      // 配置非法时不得进入验证流程（连帮助都不打印）
      expect(r.stdout).not.toContain('用法:')
    })
  }

  it('--timeout 缺值 → exit 1（不静默变成 NaN）', () => {
    const r = runProfile(['--timeout'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--timeout')
    expect(r.stderr).toContain('正秒数')
  })

  it('none / off 被识别为家族的「关闭」关键字后拒绝（本脚本必须有限等待）', () => {
    for (const raw of ['none', 'off']) {
      const r = runProfile(['--timeout', raw, '--help'])
      expect(r.status, raw).toBe(1)
      expect(r.stderr).toContain(raw)
    }
  })
})

describe('合法正秒数照旧可用（放宽 ≠ 关闭，向后兼容）', () => {
  for (const raw of ['90', '120', '0.6']) {
    it(`--timeout ${raw} → exit 0 且正常打印帮助`, () => {
      const r = runProfile(['--timeout', raw, '--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('用法:')
      expect(r.stderr).toBe('')
    })
  }

  it('不传 --timeout → exit 0（默认 90s 不变）', () => {
    const r = runProfile(['--help'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--timeout <sec>')
    expect(r.stderr).toBe('')
  })
})
