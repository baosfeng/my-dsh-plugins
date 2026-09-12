// scripts/lib/npm-audit.mjs 防回归单测（issue #199）。
//
// 背景：npm audit 依赖 registry 的 security advisories 端点，npmmirror 等镜像没有实现它
// （404 [NOT_IMPLEMENTED]）。此时若只看退出码，一个「没真正查过」的 audit 与一个
// 「查过且干净」的 audit 无法区分 —— 门禁假绿。本文件锁定三件事：
//   1. audit 参数/环境必须钉在官方 registry，且禁用 registry 重写；
//   2. 判定必须基于输出里的结构化报告，而不是退出码；
//   3. 「端点未实现」必须被识别为「未执行」并给出可操作原因。
import { describe, expect, it } from 'vitest'

import {
  AUDIT_LEVEL,
  AUDIT_REGISTRY,
  auditCmdArgs,
  auditCommandHint,
  auditEnv,
  extractJsonObject,
  parseAuditOutput,
  renderAuditReport,
  summarizeAuditJson,
  summarizeCounts,
} from '../lib/npm-audit.mjs'

// ── 构造 npm audit --json 的两种真实输出形态 ─────────────────────────────────
const CLEAN_REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    dependencies: { prod: 176, dev: 714, optional: 91, peer: 182, total: 1056 },
  },
})

const VULNERABLE_REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: { qs: { name: 'qs', severity: 'moderate', isDirect: false } },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 2, high: 0, critical: 0, total: 2 },
    dependencies: { prod: 176, dev: 714, optional: 91, peer: 182, total: 1056 },
  },
})

// 实测抓取的镜像源失败输出（npm 11 + npmmirror）。
const MIRROR_FAILURE = [
  'npm warn audit 404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet',
  "{ error: '[NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet' }",
  'npm error audit endpoint returned an error',
].join('\n')

describe('audit 必须打到官方 registry', () => {
  it('给定官方 registry 常量，且不是镜像域名', () => {
    expect(AUDIT_REGISTRY).toBe('https://registry.npmjs.org')
    expect(AUDIT_REGISTRY).not.toContain('npmmirror')
  })

  it('命令参数固定为 audit + moderate 门槛 + json（结构化判定）', () => {
    expect(auditCmdArgs()).toEqual(['audit', '--audit-level=moderate', '--json'])
    expect(AUDIT_LEVEL).toBe('moderate')
  })

  it('环境变量钉住官方 registry 并禁用重写（否则 npm 会按本机镜像改回去）', () => {
    expect(auditEnv()).toEqual({
      npm_config_registry: 'https://registry.npmjs.org',
      npm_config_replace_registry_host: 'never',
    })
  })

  it('复现命令带官方 registry 双保险（用户 npm 配置是镜像时也能直接跑）', () => {
    expect(auditCommandHint()).toContain('npm_config_registry=https://registry.npmjs.org')
    expect(auditCommandHint()).toContain('npm_config_replace_registry_host=never')
  })
})

describe('parseAuditOutput 判定「是否真正执行」', () => {
  it('干净仓库：取到报告且计数全零 → 有效执行', () => {
    const verdict = parseAuditOutput({ ok: true, out: CLEAN_REPORT })
    expect(verdict.effective).toBe(true)
    expect(verdict.reason).toContain('0 漏洞')
  })

  it('有漏洞：取到报告 → 有效执行（是否放行由退出码决定）', () => {
    const verdict = parseAuditOutput({ ok: false, code: 1, out: VULNERABLE_REPORT })
    expect(verdict).toMatchObject({ effective: true, report: expect.objectContaining({ auditReportVersion: 2 }) })
    expect(verdict.reason).toContain('moderate 2')
  })

  it('镜像源 [NOT_IMPLEMENTED]：没有报告 → 未执行，且原因点名端点未实现', () => {
    const verdict = parseAuditOutput({ ok: false, code: 1, out: MIRROR_FAILURE })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.stringContaining('端点未实现') })
  })

  it('退出码为 0 但没有结构化报告（假绿）→ 判为未执行，绝不当作通过', () => {
    const verdict = parseAuditOutput({ ok: true, code: 0, out: 'found 0 vulnerabilities' })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.any(String) })
  })

  it('网络失败：未执行，原因取错误首行', () => {
    const verdict = parseAuditOutput({
      ok: false,
      code: 1,
      out: '',
      error: '命令超过单步上限 120.0s 仍未返回，已强制终止其进程组\n  命令：npm audit',
    })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.stringContaining('超过单步上限') })
  })

  it('输出被 npm warn 行污染时仍能截出 JSON 报告', () => {
    const verdict = parseAuditOutput({ ok: true, out: 'npm warn something\n' + CLEAN_REPORT })
    expect(verdict).toMatchObject({ effective: true, report: expect.objectContaining({ auditReportVersion: 2 }) })
  })

  it('JSON 缺 metadata → 未执行（advisory 数据没取到）', () => {
    const verdict = parseAuditOutput({ ok: true, out: '{"auditReportVersion":2}' })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.any(String) })
  })

  it('输出不是 JSON → 未执行', () => {
    const verdict = parseAuditOutput({ ok: true, out: '{ not json at all }' })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.any(String) })
  })

  it('空输入 → 未执行（不抛异常）', () => {
    expect(parseAuditOutput().effective).toBe(false)
    expect(parseAuditOutput({}).effective).toBe(false)
  })
})

describe('输出摘要', () => {
  it('只列非零等级，全零时明确说 0 漏洞', () => {
    expect(summarizeCounts({ info: 0, low: 0, moderate: 2, high: 1, critical: 0 })).toBe('high 1 / moderate 2')
    expect(summarizeCounts({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 })).toBe('0 漏洞')
  })

  it('计数不可用时不误报为 0 漏洞', () => {
    expect(summarizeCounts(undefined)).toBe('漏洞计数不可用')
  })

  it('带上依赖总数便于判断审计规模', () => {
    const summary = summarizeAuditJson(JSON.parse(CLEAN_REPORT))
    expect(summary).toBe('0 漏洞，审计 1056 个依赖')
  })
})

// 构造 npm audit --json 中单条漏洞的形态（字段名与真实报告一致）。
const vulnEntry = (over = {}) => ({
  name: 'qs',
  severity: 'moderate',
  isDirect: false,
  range: '2.2.5 - 6.15.3',
  via: [
    {
      name: 'qs',
      title: 'qs array-limit bypass via bracket-key comma parsing',
      url: 'https://github.com/advisories/GHSA-x5fp-wj9c-mxmx',
      severity: 'moderate',
      range: '>= 6.14.2, <= 6.15.3',
    },
  ],
  nodes: ['node_modules/qs'],
  fixAvailable: true,
  ...over,
})

const reportWith = (vulnerabilities, total = 2) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: total, high: 0, critical: 0, total },
    dependencies: { total: 1056 },
  },
})

describe('renderAuditReport 人类可读清单（失败时替代裸 JSON）', () => {
  it('摘要 + 受影响版本 + 修复建议 + 传入路径', () => {
    const text = renderAuditReport(reportWith({ qs: vulnEntry() }))
    expect(text).toContain('漏洞摘要：moderate 2，审计 1056 个依赖')
    expect(text).toContain('[moderate] qs')
    expect(text).toContain('受影响版本：2.2.5 - 6.15.3')
    expect(text).toContain('修复：可自动修复')
    expect(text).toContain('经由：node_modules/qs')
  })

  it('公告明细带链接（可直接点开确认真伪）', () => {
    const text = renderAuditReport(reportWith({ qs: vulnEntry() }))
    expect(text).toContain('https://github.com/advisories/GHSA-x5fp-wj9c-mxmx')
    expect(text).toContain('moderate  https://github.com/advisories')
  })

  it('多条漏洞按严重级别降序（critical 在前）', () => {
    const text = renderAuditReport(
      reportWith({
        lowpkg: vulnEntry({ name: 'lowpkg', severity: 'low' }),
        critpkg: vulnEntry({ name: 'critpkg', severity: 'critical' }),
      }),
    )
    expect(text.indexOf('[critical] critpkg')).toBeLessThan(text.indexOf('[low] lowpkg'))
  })

  it('fixAvailable 为对象时给出目标版本，semver-major 额外标注', () => {
    const text = renderAuditReport(
      reportWith({
        qs: vulnEntry({ fixAvailable: { name: 'typed-rest-client', version: '3.1.2', isSemVerMajor: true } }),
      }),
    )
    expect(text).toContain('typed-rest-client@3.1.2（semver-major，需评估破坏性）')
  })

  it('直接依赖不画「经由」（它自己就是漏洞源）', () => {
    const text = renderAuditReport(reportWith({ qs: vulnEntry({ isDirect: true }) }))
    expect(text).not.toContain('经由：')
  })

  it('依赖链过长时截断（不刷屏）', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => 'node_modules/' + n)
    const text = renderAuditReport(reportWith({ qs: vulnEntry({ nodes }) }))
    expect(text).toContain('> …')
  })

  it('修复命令指向 npm audit fix 且带官方 registry 双保险', () => {
    const text = renderAuditReport(reportWith({ qs: vulnEntry() }))
    expect(text).toContain('npm audit fix --audit-level=moderate')
    expect(text).toContain('npm_config_replace_registry_host=never')
  })

  it('无漏洞报告只输出摘要（不画空的修复段）', () => {
    const text = renderAuditReport(JSON.parse(CLEAN_REPORT))
    expect(text).toBe('漏洞摘要：0 漏洞，审计 1056 个依赖')
  })
})

describe('extractJsonObject 从夹带 npm 日志的输出里取 JSON', () => {
  it('剥离前后的 warn/error 行', () => {
    const text = extractJsonObject('npm warn foo\n' + CLEAN_REPORT + '\nnpm error bar')
    expect(JSON.parse(text).auditReportVersion).toBe(2)
  })

  it('没有 JSON 时原样返回（交由调用方处理）', () => {
    expect(extractJsonObject('no json here')).toBe('no json here')
  })
})

describe('parseAuditOutput 把结构化报告交给调用方渲染', () => {
  it('effective=true 时带回 report 对象', () => {
    const verdict = parseAuditOutput({ ok: false, code: 1, out: VULNERABLE_REPORT })
    expect(verdict.report.vulnerabilities.qs.severity).toBe('moderate')
  })
})

// 实测踩过的误判：npm 在「端点未实现」与「网络不通」两种情况下都会打印
// "audit endpoint returned an error"。早先按该字样判定，把代理 TLS 失败误报成
// 「registry 不支持 audit」，把排查方向带偏。下面三例锁死这条分界。
describe('结构化报告缺失时的原因归类', () => {
  it('代理 TLS 失败 → 归为网络问题，不得误报成端点未实现', () => {
    const proxyFailure = [
      'npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: Client network socket disconnected before secure TLS connection was established',
      'npm error audit endpoint returned an error',
      '{',
      '  "message": "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: Client network socket disconnected before secure TLS connection was established"',
      '  "error": { "summary": "", "detail": "" }',
      '}',
    ].join('\n')
    const verdict = parseAuditOutput({ ok: false, code: 1, out: proxyFailure })
    expect(verdict).toEqual({ effective: false, report: undefined, reason: expect.any(String) })
    expect(verdict.reason).toContain('网络/代理问题')
    expect(verdict.reason).not.toContain('端点未实现')
  })

  it('端点未实现 → 明确指向 registry 的 advisories 端点', () => {
    const verdict = parseAuditOutput({ ok: false, code: 1, out: MIRROR_FAILURE })
    expect(verdict.reason).toContain('端点未实现')
    expect(verdict.reason).toContain('NOT_IMPLEMENTED')
  })

  it('诊断文本优先取 JSON 错误体的 message（npm error 行长且难读）', () => {
    const out = [
      'npm error audit endpoint returned an error',
      '{',
      '  "message": "request failed, reason: socket disconnected"',
      '}',
    ].join('\n')
    expect(parseAuditOutput({ ok: false, out }).reason).toContain('request failed, reason: socket disconnected')
  })
})
