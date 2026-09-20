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

  it('Unicode 行分隔符 U+2028/U+2029 语义等同换行 → 折成空格', () => {
    // 有些消费者（编辑器/日志行解析/`split(/\r?\n/)` 之外的宽松按行处理）把这两个字符当行分隔，
    // 只处理 \r\n\t 时它们会穿透净化落盘，从而在产物里伪造出第二行。
    expect(scrubField('a\u2028b')).toBe('a b')
    expect(scrubField('a\u2029b')).toBe('a b')
    expect(scrubField('a\u2028\u2029b')).toBe('a b')
  })

  it('双向控制符（Trojan Source 类显示欺骗）→ 删除', () => {
    const bidi = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'
    expect(scrubField(`fix ${bidi}evil`)).toBe('fix evil')
    expect(scrubField('\u202erelease\u202c')).toBe('release')
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

  it('Unicode 行分隔符与双向控制符不能穿透到行文本', () => {
    const lines = commitLines([
      {
        sha: 'a'.repeat(40),
        commit: { author: { date: '2026-01-02T00:00:00Z' }, message: 'fix\u2028[fake] 2026-01-02 injected' },
      },
      {
        sha: 'b'.repeat(40),
        commit: { author: { date: '2026-01-03T00:00:00Z' }, message: '\u202erevert\u202c x' },
      },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('aaaaaaaaaa (2026-01-02) fix [fake] 2026-01-02 injected')
    expect(lines[1]).toBe('bbbbbbbbbb (2026-01-03) revert x')
    expect(lines.join('\n')).not.toMatch(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/)
  })

  it('条数上限：超长数组按 MAX_COMMITS 截断（保留前若干条，顺序不变）', () => {
    // 上限取 1000 = GitHub compare API 单页实际上限（250）的 4 倍余量：
    // 正常响应永远够用，异常/恶意响应无法把产物撑爆。
    const many = Array.from({ length: 1000 + 500 }, (_, i) => ({
      sha: `sha${i}`,
      commit: { author: { date: '2026-01-02T00:00:00Z' }, message: `m${i}` },
    }))
    const lines = commitLines(many)
    expect(lines).toHaveLength(1000)
    expect(lines[0]).toContain('m0')
    expect(lines.at(-1)).toContain('m999')
    // 未超限时不做任何改动（不误截断）
    expect(commitLines(many.slice(0, 250))).toHaveLength(250)
  })
})

describe('revertLines', () => {
  it('挑出 revert 行（大小写不敏感），判定与老实现一致', () => {
    const lines = ['aaa (2026-01-01) fix x', 'bbb (2026-01-02) Revert "fix x"', 'ccc (2026-01-03) REVERT']
    expect(revertLines(lines)).toEqual([lines[1], lines[2]])
    expect(revertLines([])).toEqual([])
  })
})
