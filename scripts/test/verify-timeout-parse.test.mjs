/**
 * verify-timeout-parse.test.mjs —— 超时配置解析的边界单测（fail-closed 的第一道闸）。
 *
 * 与行为级的 verify-timeout.test.mjs 分工：那边钉「脚本整体行为」（exit code / stderr / 默认值），
 * 这边钉「解析函数的每个分支」——尤其是历史上被静默接受的 0 / 空 / 非数字。
 */
import { describe, it, expect } from 'vitest'
import { CLOSE_KEYWORDS, isValidTimeoutMs, parseTimeoutSeconds, timeoutConfigError } from '../lib/verify-timeout.mjs'

describe('parseTimeoutSeconds：未配置 → null（调用方回落默认值）', () => {
  it('undefined / null 都表示「没配」，不是「关闭」', () => {
    expect(parseTimeoutSeconds(undefined)).toEqual({ ok: true, seconds: null })
    expect(parseTimeoutSeconds(null)).toEqual({ ok: true, seconds: null })
  })
})

describe('parseTimeoutSeconds：正秒数是唯一合法的数值形态', () => {
  it('字符串与数字都接受，并四舍五入到整秒', () => {
    expect(parseTimeoutSeconds('300')).toEqual({ ok: true, seconds: 300 })
    expect(parseTimeoutSeconds(45)).toEqual({ ok: true, seconds: 45 })
    expect(parseTimeoutSeconds(' 120 ')).toEqual({ ok: true, seconds: 120 })
    expect(parseTimeoutSeconds('0.6')).toEqual({ ok: true, seconds: 1 })
  })
})

describe('parseTimeoutSeconds：显式关闭关键字（语义清晰，必须写出来）', () => {
  it('none / off 及其大小写、空格变体 → 0', () => {
    for (const keyword of CLOSE_KEYWORDS) {
      expect(parseTimeoutSeconds(keyword)).toEqual({ ok: true, seconds: 0 })
      expect(parseTimeoutSeconds(` ${keyword.toUpperCase()} `)).toEqual({ ok: true, seconds: 0 })
    }
  })
})

describe('parseTimeoutSeconds：0 / 负数 / 空 / 非数字 / 含糊关键字 → 非法（fail-closed）', () => {
  it('不再有任何「静默关闭」或「静默回落」的输入', () => {
    const illegal = ['0', '-1', '-0.5', '0.4', '', '   ', 'abc', '10s', '1,5', 'false', 'no', 'disable', 'disabled']
    for (const raw of illegal) {
      const parsed = parseTimeoutSeconds(raw)
      expect(parsed.ok, `${JSON.stringify(raw)} 必须非法`).toBe(false)
      expect(parsed.seconds).toBeUndefined()
    }
  })
})

describe('timeoutConfigError：报错必须可自愈（合法范围 + 正确关闭方式）', () => {
  it('回显非法值、给出合法范围与显式关闭写法', () => {
    const msg = timeoutConfigError({ name: 'VERIFY_STEP_TIMEOUT', raw: '0' })
    expect(msg).toContain('VERIFY_STEP_TIMEOUT')
    expect(msg).toContain('"0"')
    expect(msg).toContain('正秒数')
    expect(msg).toContain('VERIFY_STEP_TIMEOUT=none')
  })

  it('可按调用点替换关闭写法（命令行参数用空格形式）并追加提示', () => {
    const msg = timeoutConfigError({
      name: '--timeout',
      raw: 'abc',
      closeForm: '--timeout none',
      hint: '也可用 VERIFY_NO_TIMEOUT=1。',
    })
    expect(msg).toContain('--timeout none')
    expect(msg).toContain('VERIFY_NO_TIMEOUT=1')
  })

  it('未设置值也能渲染（不抛异常、不回显 undefined）', () => {
    const msg = timeoutConfigError({ name: 'VERIFY_TIMEOUT', raw: undefined })
    expect(msg).toContain('(未设置)')
  })
})

describe('isValidTimeoutMs：执行层防线', () => {
  it('非负整数合法（0 只表示已显式关闭）', () => {
    for (const value of [0, 1, 120_000]) expect(isValidTimeoutMs(value)).toBe(true)
  })

  it('负数 / NaN / 小数 / 非数字 / Infinity 非法（绝不落进「falsy → 无上限」老路径）', () => {
    for (const value of [-1, Number.NaN, 1.5, '120', null, undefined, Number.POSITIVE_INFINITY]) {
      expect(isValidTimeoutMs(value), String(value)).toBe(false)
    }
  })
})
