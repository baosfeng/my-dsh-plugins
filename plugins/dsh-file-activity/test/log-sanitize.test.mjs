// plugins/dsh-file-activity/test/log-sanitize.mjs 的回归测试（CodeQL #314 告警 #85/#86）。
//
// e2e-cdp.mjs 启动真实 Chrome、不进 CI，它的日志净化如果没有测试就是"改了没人知道"。
// 这里直接跑 e2e 用的那份实现（同一模块），钉住两条：
//   1. 换行/行分隔符被折平，日志正文**不可能**跨行；
//   2. 其余控制字符被转义、字段被引号界定，伪造的 `[e2e] …` 无法自成一条日志。
import { describe, expect, it } from 'vitest'
import { sanitizeLogField } from './log-sanitize.mjs'

describe('sanitizeLogField（e2e 日志字段净化）', () => {
  it('换行/回车/U+2028/U+2029 一律折成空格（日志行不可被截断伪造）', () => {
    for (const sep of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      const out = sanitizeLogField(`ok${sep}[e2e] 伪造行`)
      expect(out).not.toContain('\n')
      expect(out).not.toContain('\r')
      expect(out).not.toContain('\u2028')
      expect(out).not.toContain('\u2029')
      // 折平后只可能是"被引号界定的一行"，且伪造段只能待在引号内
      expect(out.startsWith('"ok')).toBe(true)
      expect(out.endsWith('伪造行"')).toBe(true)
      expect(out.split('\n')).toHaveLength(1)
    }
    // 换行折成空格（CRLF 是两个控制字符 → 两个空格，不影响"单行"结论）
    expect(sanitizeLogField('a\nb')).toBe('"a b"')
    expect(sanitizeLogField('a\rb')).toBe('"a b"')
  })

  it('其余控制字符被转义（制表符不会原样进日志）', () => {
    expect(sanitizeLogField('a\tb')).toBe('"a\\tb"')
    expect(sanitizeLogField('esc\u001b[31mred')).toBe('"esc\\u001b[31mred"')
  })

  it('普通值被引号界定，且都是单行字符串', () => {
    expect(sanitizeLogField('plain')).toBe('"plain"')
    expect(sanitizeLogField(42)).toBe('"42"')
    expect(sanitizeLogField(undefined)).toBe('"undefined"')
  })
})
