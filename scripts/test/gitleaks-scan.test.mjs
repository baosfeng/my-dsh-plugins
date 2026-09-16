// gitleaks 扫描判据的单元测试（issue #324 需求 A）。
//
// 覆盖三件事，都是「门禁看着跑了其实没生效」这类假绿的防线：
//   1. 供应链：版本 + SHA256 必须来自 scripts/ci-tools.json 的固定值，不符拒绝执行；
//   2. 净化：normalizeFindings / renderFindings / scanRecord **只输出 文件:行:规则**，
//      任何 Match / Secret 字段都不得进入输出（明文绝不进 CI 日志）；
//   3. fail-closed：扫了 0 个提交不算「干净」；工具不可用默认判失败。
import { describe, expect, it } from 'vitest'
import {
  decideScanExit,
  dedupeFindings,
  lineLabel,
  normalizeFindings,
  parseVersion,
  platformKey,
  renderFindings,
  renderScanSummary,
  scanRecord,
  sortFindings,
  toolRelease,
  verifyChecksum,
  verifyGitleaksVersion,
} from '../lib/gitleaks-scan.mjs'

/** 与 scripts/ci-tools.json 同构的工具表（测试用固定值，不读磁盘）。 */
const TOOLS = {
  gitleaks: {
    version: '8.30.1',
    checksums: { 'darwin-arm64': 'aa', 'linux-x64': 'bb' },
  },
}

describe('platformKey', () => {
  it('按 platform-arch 拼键（与 ci-tools.json 的 checksums 字段同名）', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('linux', 'x64')).toBe('linux-x64')
  })
})

describe('toolRelease', () => {
  it('解析出期望 SHA256 与版本；**不得**产出任何 URL/路径片段', () => {
    const r = toolRelease(TOOLS, 'gitleaks', 'darwin', 'arm64')
    expect(r.ok).toBe(true)
    expect(r.version).toBe('8.30.1')
    expect(r.key).toBe('darwin-arm64')
    expect(r.sha256).toBe('aa')
    // issue #108 回归：工具表是磁盘数据，其内容不得成为出站请求目标的一部分。
    // 下载地址由 scripts/check-secrets.mjs 的代码内常量（RELEASE_ORIGIN / RELEASE_PATH_PREFIX /
    // RELEASE_VERSION）拼装，本函数只返回**本地**用的校验值与版本。
    expect(Object.keys(r).sort()).toEqual(['key', 'ok', 'sha256', 'version'])
    expect(JSON.stringify(r)).not.toMatch(/https?:\/\//)
  })

  it('平台没有预置校验值 → 判不支持（fail-closed：绝不做无校验下载）', () => {
    const r = toolRelease(TOOLS, 'gitleaks', 'win32', 'x64')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('win32-x64')
  })

  it('工具未登记 → 判不支持', () => {
    expect(toolRelease(TOOLS, 'nosuchtool').ok).toBe(false)
    expect(toolRelease({}, 'gitleaks').ok).toBe(false)
  })
})

describe('verifyChecksum', () => {
  it('大小写无关；任一侧为空或不等即失败', () => {
    expect(verifyChecksum('AABB', 'aabb')).toBe(true)
    expect(verifyChecksum('aa', 'ab')).toBe(false)
    expect(verifyChecksum('', '')).toBe(false)
    expect(verifyChecksum('aa', undefined)).toBe(false)
  })
})

describe('parseVersion / verifyGitleaksVersion', () => {
  it('从 `gitleaks version X` 与裸版本串里都取得到版本', () => {
    expect(parseVersion('8.30.1')).toBe('8.30.1')
    expect(parseVersion('gitleaks version 8.30.1')).toBe('8.30.1')
    expect(parseVersion('gitleaks version 8.30.1\n')).toBe('8.30.1')
    expect(parseVersion('no version here')).toBeNull()
  })

  it('版本不一致 → 判失败并给出可操作原因（本地装了别的版本时不能与 CI 互相印证）', () => {
    expect(verifyGitleaksVersion('gitleaks version 8.30.1', '8.30.1').ok).toBe(true)
    const bad = verifyGitleaksVersion('gitleaks version 8.29.0', '8.30.1')
    expect(bad.ok).toBe(false)
    expect(bad.reason).toContain('8.29.0')
    expect(verifyGitleaksVersion('', '8.30.1').ok).toBe(false)
  })
})

describe('lineLabel', () => {
  it('单行给行号；跨行给 起-止；缺失给 ?', () => {
    expect(lineLabel({ StartLine: 12, EndLine: 12 })).toBe('12')
    expect(lineLabel({ StartLine: 12, EndLine: 15 })).toBe('12-15')
    expect(lineLabel({})).toBe('?')
    expect(lineLabel({ StartLine: 12 })).toBe('12')
  })
})

describe('normalizeFindings：净化（明文绝不外泄）', () => {
  const RAW = [
    {
      RuleID: 'generic-api-key',
      File: 'docs/x.md',
      StartLine: 3,
      EndLine: 3,
      Commit: 'abcdef0123456789',
      Match: 'token="SUPER-SECRET-VALUE"',
      Secret: 'SUPER-SECRET-VALUE',
      Line: 'const t = "SUPER-SECRET-VALUE"',
      Description: 'Detected a Generic API Key',
      Author: 'someone',
      Email: 'someone@example.com',
      Fingerprint: 'abcdef0123:docs/x.md:generic-api-key:3',
    },
  ]

  it('输出记录里只有 规则/文件/行/提交短SHA/指纹', () => {
    const [f] = normalizeFindings(RAW)
    expect(f).toEqual({
      rule: 'generic-api-key',
      file: 'docs/x.md',
      line: '3',
      commit: 'abcdef01',
      fingerprint: 'abcdef0123:docs/x.md:generic-api-key:3',
    })
  })

  it('输出记录的 JSON 里搜不到明文（Match/Secret/Line/Author/Email 全部被丢弃）', () => {
    const text = JSON.stringify(normalizeFindings(RAW))
    expect(text).not.toContain('SUPER-SECRET-VALUE')
    expect(text).not.toContain('someone@example.com')
    expect(text).not.toContain('"Match"')
    expect(text).not.toContain('"Secret"')
    expect(text).not.toContain('"Line"')
  })

  it('缺字段不抛（外部报告形态变化时按 unknown 处理，而不是崩掉门禁）', () => {
    expect(normalizeFindings([{}])[0]).toMatchObject({ rule: 'unknown', file: '?', line: '?', commit: '?' })
    expect(normalizeFindings(null)).toEqual([])
    expect(normalizeFindings(undefined)).toEqual([])
  })
})

describe('renderFindings / renderScanSummary / scanRecord：只给 文件:行:规则', () => {
  const FINDINGS = [
    { rule: 'aws-access-token', file: 'a.js', line: '1', commit: '11111111', fingerprint: null },
    { rule: 'private-key', file: 'b/c.pem', line: '7-9', commit: '22222222', fingerprint: null },
  ]

  it('渲染出 `文件:行:规则`，且不含任何密钥形态内容', () => {
    const text = renderFindings(FINDINGS)
    expect(text).toContain('a.js:1:aws-access-token')
    expect(text).toContain('b/c.pem:7-9:private-key')
  })

  it('超过 maxItems 时截断并说明（不刷屏）', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      rule: 'r',
      file: `f${i}`,
      line: '1',
      commit: 'c',
      fingerprint: null,
    }))
    const text = renderFindings(many, { maxItems: 20 })
    expect(text).toContain('另有 5 处')
  })

  it('汇总行含版本/范围/提交数/耗时，便于确认门禁真的执行了', () => {
    const text = renderScanSummary({
      ok: false,
      bin: '/tmp/gitleaks',
      version: '8.30.1',
      scope: '--all',
      commitsScanned: 692,
      findings: FINDINGS,
      ms: 4700,
      reason: '发现 2 处疑似凭据',
    })
    expect(text).toContain('gitleaks 8.30.1')
    expect(text).toContain('692 个提交')
    expect(text).toContain('4.7s')
    expect(text).toContain('a.js:1:aws-access-token')
  })

  it('scanRecord 是机器可读的净化结果（无 Match/Secret 字段）', () => {
    const rec = scanRecord({
      ok: true,
      version: '8.30.1',
      scope: '--all',
      commitsScanned: 1,
      findings: FINDINGS,
      ms: 10,
      reason: 'ok',
    })
    expect(rec.findings[0]).toEqual({ rule: 'aws-access-token', file: 'a.js', line: '1', commit: '11111111' })
    expect(JSON.stringify(rec)).not.toContain('Secret')
  })
})

describe('dedupeFindings / sortFindings', () => {
  it('同一 文件:行:规则 只留一条（全历史扫描里多次出现同一处）', () => {
    const list = [
      { rule: 'r1', file: 'b.js', line: '2', commit: 'aaaa1111', fingerprint: null },
      { rule: 'r1', file: 'b.js', line: '2', commit: 'bbbb2222', fingerprint: null },
      { rule: 'r1', file: 'a.js', line: '10', commit: 'cccc3333', fingerprint: null },
    ]
    const out = dedupeFindings(list)
    expect(out).toHaveLength(2)
    expect(out.map((f) => `${f.file}:${f.line}`)).toEqual(['a.js:10', 'b.js:2'])
  })

  it('sortFindings 按 文件 → 行号（数值） → 规则 排序', () => {
    const out = sortFindings([
      { rule: 'r', file: 'a.js', line: '10', commit: 'c', fingerprint: null },
      { rule: 'r', file: 'a.js', line: '2', commit: 'c', fingerprint: null },
    ])
    expect(out.map((f) => f.line)).toEqual(['2', '10'])
  })
})

describe('decideScanExit：fail-closed', () => {
  it('有命中 → 失败', () => {
    const v = decideScanExit({ available: true, findings: [{ rule: 'r' }] })
    expect(v.code).toBe(1)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('1 处')
  })

  it('扫过且干净 → 通过', () => {
    expect(decideScanExit({ available: true, findings: [] })).toMatchObject({ code: 0, ok: true, skipped: false })
  })

  it('工具不可用：默认失败（CI 语义），只有显式 allowMissing 才跳过', () => {
    const hard = decideScanExit({ available: false, findings: [], error: '无法下载' })
    expect(hard).toMatchObject({ code: 1, ok: false, skipped: false })
    const soft = decideScanExit({ available: false, findings: [], allowMissing: true, error: '无法下载' })
    expect(soft).toMatchObject({ code: 0, ok: true, skipped: true })
  })
})
