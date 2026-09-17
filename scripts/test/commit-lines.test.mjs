// plugin-upgrade skill 的 scripts/lib/commit-lines.mjs 的回归测试（原属已并入的 dsh-upgrade-audit skill）。（CodeQL #314 告警 #29/#30）。
//
// 这是**落盘前的净化判据**：commits.txt / reverts.txt 的每一行都来自
// `api.github.com` 的响应，然后被 writeFileSync 写进产物目录。原实现直接把
// `c.commit.message.split('\n')[0]` 拼进文件——多行消息、`\r`、ANSI 转义都能进产物。
// 下面每个用例都是那类输入，必须被折平/剥掉。
import { describe, expect, it } from 'vitest'
// 权威来源（本仓库内 skill 资产）：skills/plugin-upgrade/scripts/lib/commit-lines.mjs
import { commitLines, revertLines, scrubField } from '../../skills/plugin-upgrade/scripts/lib/commit-lines.mjs'

describe('scrubField', () => {
  it('折平换行/回车/制表，剥掉其余控制字符（含 NUL 与 DEL）', () => {
    expect(scrubField('a\nb\rc\td')).toBe('a b c d')
    expect(scrubField('evil\u001b[31mred')).toBe('evil[31mred')
    expect(scrubField('nul\u0000here')).toBe('nulhere')
    expect(scrubField('del\u007fhere')).toBe('delhere')
  })

  it('超长字段按上限截断（产物不被单条消息撑爆）', () => {
    expect(scrubField('x'.repeat(500)).length).toBe(200)
    expect(scrubField('x'.repeat(500), 12)).toBe('x'.repeat(12))
  })

  it('非字符串输入不抛（null/数字/对象都有确定输出）', () => {
    expect(scrubField(null)).toBe('')
    expect(scrubField(42)).toBe('42')
    expect(scrubField({ a: 1 })).toBe('[object Object]')
  })
})

describe('commitLines', () => {
  it('每条提交固定一行 `sha (日期) 首行摘要`', () => {
    const lines = commitLines([
      { sha: 'abcdef1234567890', commit: { author: { date: '2026-01-02T03:04:05Z' }, message: '首行\n次行机密' } },
    ])
    expect(lines).toEqual(['abcdef1234 (2026-01-02) 首行'])
  })

  it('注入尝试：消息里带 CRLF + 伪造行 → 折平为同一行，不产生第二行', () => {
    const lines = commitLines([
      {
        sha: 'f'.repeat(40),
        commit: { author: { date: '2026-01-02T00:00:00Z' }, message: 'fix\n\n[fake] 2026-01-02 injected' },
      },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('\n')
    expect(lines[0].split('\n')).toHaveLength(1)
  })

  it('字段缺失/类型异常不抛，且 sha/日期截到 10 字符', () => {
    expect(commitLines([{}])).toEqual([' () '])
    expect(commitLines([null])).toEqual([' () '])
    expect(commitLines(undefined)).toEqual([])
    expect(commitLines('not-an-array')).toEqual([])
  })
})

describe('revertLines', () => {
  it('挑出 revert 行（大小写不敏感），判定与老实现一致', () => {
    const lines = ['aaa (2026-01-01) fix x', 'bbb (2026-01-02) Revert "fix x"', 'ccc (2026-01-03) REVERT']
    expect(revertLines(lines)).toEqual([lines[1], lines[2]])
    expect(revertLines([])).toEqual([])
  })
})
