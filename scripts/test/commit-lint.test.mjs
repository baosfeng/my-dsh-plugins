// 提交信息门禁的单元测试（issue #324 需求 B）。
//
// 覆盖的是「门禁看着跑了其实没生效」的三条防线：
//   1. 范围：只校验指定范围；**空范围判失败**（"没检查"≠"检查过且干净"）；
//   2. 判定：任一提交不合格即失败（fail-closed），校验器抛错也算失败，
//      校验条数与范围条数不一致也算失败（少校验了不能绿）；
//   3. 报告：给出 短SHA + 首行 + 规则名，且带可操作修复指引（否则门禁只制造困惑）。
import { describe, expect, it } from 'vitest'
import {
  COMMIT_TYPES,
  collectFindings,
  commitRangeSpec,
  commitRecord,
  decideEmptyRange,
  renderCommitReport,
  renderFindings,
  truncateSubject,
} from '../lib/commit-lint.mjs'

/** 造一个可控的校验器（valid=false 时给出给定规则名）。 */
const linter =
  (invalid = {}) =>
  async (message) => {
    const bad = invalid[message]
    return bad ? { valid: false, errors: bad } : { valid: true, errors: [] }
  }

describe('commitRangeSpec', () => {
  it('from + to → range 模式（git 语义，不含 from）', () => {
    expect(commitRangeSpec({ from: 'aaa', to: 'bbb' })).toMatchObject({
      ok: true,
      mode: 'range',
      from: 'aaa',
      to: 'bbb',
    })
  })

  it('只有 to → single 模式，显式退化为 to^..to（commitlint 不接受 X..X）', () => {
    expect(commitRangeSpec({ to: 'bbb' })).toMatchObject({ ok: true, mode: 'single', from: 'bbb^', to: 'bbb' })
  })

  it('都没有（或空串）→ ok:false，交由 decideEmptyRange 处置', () => {
    expect(commitRangeSpec({}).ok).toBe(false)
    expect(commitRangeSpec({ from: '  ', to: '' }).ok).toBe(false)
    expect(commitRangeSpec().mode).toBe('empty')
  })
})

describe('decideEmptyRange：空范围默认 fail-closed', () => {
  it('默认判失败并说明原因（不允许静默放过）', () => {
    const v = decideEmptyRange({ reason: '范围 a..b 内没有提交' })
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('fail-closed')
  })

  it('显式 allowEmpty（仅本地调试）才放行，并在原因里留痕', () => {
    const v = decideEmptyRange({ allowEmpty: true, reason: '范围 a..b 内没有提交' })
    expect(v.ok).toBe(true)
    expect(v.reason).toContain('--allow-empty')
  })
})

describe('truncateSubject', () => {
  it('折平控制字符并截断（报告不被单条异常提交撑爆 / 不注入 ANSI）', () => {
    expect(truncateSubject('a\nb\tc')).toBe('a b c')
    expect(truncateSubject('x'.repeat(300)).length).toBe(100)
    // ESC 被折平成空格（保留可读性），其余字符原样；关键是**不得把 ANSI 转义原样带进日志**
    expect(truncateSubject('evil\u001b[31mred')).toBe('evil [31mred')
    expect(truncateSubject('evil\u001b[31mred')).not.toContain('\u001b')
  })
})

describe('collectFindings：逐条判定', () => {
  const commits = [
    { sha: 'aaaaaaaa1111', subject: 'feat(ci): #324 好的提交', message: 'ok' },
    { sha: 'bbbbbbbb2222', subject: 'update ci', message: 'bad' },
  ]

  it('全部合规 → ok，checked 等于提交数', async () => {
    const out = await collectFindings(commits, linter())
    expect(out).toMatchObject({ ok: true, checked: 2, findings: [] })
    expect(out.reason).toContain('2 条提交全部符合')
  })

  it('有一条不合规 → 失败，并带 短SHA/首行/规则名', async () => {
    const out = await collectFindings(
      commits,
      linter({ bad: [{ name: 'type-empty', message: 'type may not be empty' }] }),
    )
    expect(out.ok).toBe(false)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({ commit: 'bbbbbbbb', subject: 'update ci' })
    expect(out.findings[0].errors[0].name).toBe('type-empty')
  })

  it('校验器抛错 → 算不合格（fail-closed，不让内部异常变成绿）', async () => {
    const out = await collectFindings(commits, async () => {
      throw new Error('commitlint 崩了')
    })
    expect(out.ok).toBe(false)
    expect(out.findings).toHaveLength(2)
    expect(out.findings[0].errors[0].name).toBe('lint-error')
    expect(out.findings[0].errors[0].message).toContain('commitlint 崩了')
  })

  it('校验器返回 valid=false 但没给 errors → 仍然算不合格（不能因为没原因就放过）', async () => {
    const out = await collectFindings([commits[0]], async () => ({ valid: false, errors: [] }))
    expect(out.ok).toBe(false)
    expect(out.findings[0].errors[0].name).toBe('unknown')
  })

  it('空提交列表 → ok:true（范围为空由调用方先行判失败，不在这里伪装成通过）', async () => {
    const out = await collectFindings([], linter())
    expect(out).toMatchObject({ ok: true, checked: 0 })
  })
})

describe('renderFindings / renderCommitReport', () => {
  const findings = [
    {
      commit: 'deadbeef',
      subject: 'update ci',
      errors: [{ name: 'type-empty', message: 'type may not be empty' }],
    },
  ]

  it('渲染出 短SHA + 首行 + 规则名与原因', () => {
    const text = renderFindings(findings)
    expect(text).toContain('deadbeef')
    expect(text).toContain('update ci')
    expect(text).toContain('type-empty')
  })

  it('超过 maxItems 截断', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      commit: `c${i}`,
      subject: 's',
      errors: [{ name: 'r', message: 'm' }],
    }))
    expect(renderFindings(many, { maxItems: 10 })).toContain('另有 2 条')
  })

  it('失败报告带可操作修复指引（type 白名单 + header 上限 + 本地复现命令）', () => {
    const text = renderCommitReport({
      ok: false,
      range: 'aaa..bbb',
      checked: 2,
      findings,
      reason: '1/2 条提交不符合规范',
    })
    expect(text).toContain('❌ 失败')
    expect(text).toContain('aaa..bbb')
    expect(text).toContain('git rebase -i')
    expect(text).toContain('npm run lint:commits')
    for (const type of COMMIT_TYPES) expect(text).toContain(type)
  })

  it('通过报告不打修复指引，只给范围与条数', () => {
    const text = renderCommitReport({
      ok: true,
      range: 'aaa..bbb',
      checked: 2,
      findings: [],
      reason: '2 条提交全部符合规范',
    })
    expect(text).toContain('✅ 通过')
    expect(text).not.toContain('git rebase -i')
  })

  it('commitRecord 是机器可读结果（findings 只含 短SHA/首行/规则名与规则原因）', () => {
    const rec = commitRecord({ ok: false, range: 'a..b', checked: 1, findings, ms: 12, reason: 'r' })
    expect(rec).toMatchObject({ ok: false, range: 'a..b', checked: 1, ms: 12 })
    expect(rec.findings[0]).toMatchObject({ commit: 'deadbeef', subject: 'update ci' })
    // 不含提交正文（只留首行与规则原因，报告不泄漏/不刷屏）
    expect(Object.keys(rec.findings[0]).sort()).toEqual(['commit', 'errors', 'subject'])
  })
})
