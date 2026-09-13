/**
 * release-timing.test.mjs — 发版阶段耗时表单元测试（issue #246）。
 *
 * 覆盖：显示宽度（中文占 2 列，表格才不歪）、表格渲染（缺列/空表不炸）、
 * 时间线（mark/phase/skip/合计/占比），以及三条「不许撒谎」的判据：
 *   - 「跳过」与「0 ms」必须区分（形态豁免不能伪装成耗时 0）；
 *   - phase 里抛错也要留下耗时记录（失败点之前的阶段耗时不丢）；
 *   - totalMs 为 0 时占比显示 '-'，不产生 NaN%。
 */
import { describe, it, expect } from 'vitest'
import { createTimeline, displayWidth, formatTable } from '../lib/release-timing.mjs'

/** 可控时钟：每次 now() 前进 step 毫秒。 */
const clock = (step) => {
  let t = 1000
  return () => {
    const value = t
    t += step
    return value
  }
}

describe('displayWidth（终端显示宽度）', () => {
  it('ASCII 每字符 1 列', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('')).toBe(0)
  })

  it('中文/全角标点每字符 2 列', () => {
    expect(displayWidth('中文')).toBe(4)
    expect(displayWidth('，。')).toBe(4)
  })

  it('中英混排按各自宽度累加', () => {
    expect(displayWidth('阶段 x1')).toBe(7)
  })

  it('undefined/null 当空串处理（不抛错）', () => {
    expect(displayWidth(undefined)).toBe(0)
    expect(displayWidth(null)).toBe(0)
  })
})

describe('formatTable（定宽表格渲染）', () => {
  it('按显示宽度补齐：中文列与英文列右边界对齐', () => {
    const table = formatTable(['阶段', '耗时'], [['测试', '1 ms']])
    const lines = table.split('\n')
    expect(lines).toHaveLength(3)
    expect(displayWidth(lines[0])).toBe(displayWidth(lines[2]))
  })

  it('缺失单元格按空串补齐（不出现 undefined）', () => {
    const table = formatTable(['a', 'b'], [['only-a']])
    expect(table).not.toContain('undefined')
  })

  it('空行集只渲染表头与分隔线', () => {
    expect(formatTable(['a'], []).split('\n')).toHaveLength(2)
  })

  it('超宽单元格不截断（宁可歪也不丢信息）', () => {
    expect(formatTable(['a'], [['中文单元格']])).toContain('中文单元格')
  })
})

describe('createTimeline（阶段耗时记录）', () => {
  it('phase 记录耗时（含 await 的异步阶段）', async () => {
    const tl = createTimeline({ now: clock(100) })
    const value = await tl.phase('门禁', async () => 'ok')
    expect(value).toBe('ok')
    const [entry] = tl.entries()
    expect(entry.name).toBe('门禁')
    expect(entry.ms).toBe(100)
    expect(entry.skipped).toBe(false)
  })

  it('phase 内抛错也留下耗时记录（失败点之前的阶段不丢）', async () => {
    const tl = createTimeline({ now: clock(50) })
    await expect(tl.phase('测试', () => Promise.reject(new Error('red')))).rejects.toThrow('red')
    expect(tl.entries().map((e) => e.name)).toEqual(['测试'])
  })

  it('mark 记录外部测量值并支持备注', () => {
    const tl = createTimeline({ now: clock(1) })
    tl.mark('npm view', 2554, 'E404 分支')
    const [entry] = tl.entries()
    expect(entry.name).toBe('npm view')
    expect(entry.ms).toBe(2554)
    expect(entry.note).toBe('E404 分支')
    expect(entry.skipped).toBe(false)
  })

  it('mark 对非数字耗时归零（表格不出现 NaN）', () => {
    const tl = createTimeline({ now: clock(1) })
    tl.mark('x', Number.NaN)
    expect(tl.entries()[0].ms).toBe(0)
  })

  it('skip 与 0 ms 可区分（跳过不是「耗时 0」）', () => {
    const tl = createTimeline({ now: clock(1) })
    tl.skip('真实环境验证', 'dsh.kind=library 豁免')
    const [entry] = tl.entries()
    expect(entry.skipped).toBe(true)
    expect(entry.note).toBe('dsh.kind=library 豁免')
    expect(tl.format()).toContain('跳过')
  })

  it('entries 返回副本：外部改动不影响时间线', () => {
    const tl = createTimeline({ now: clock(1) })
    tl.mark('a', 5)
    tl.entries().push({ name: 'fake', ms: 1 })
    expect(tl.entries()).toHaveLength(1)
  })

  it('format 含合计行与占比；totalMs 为 0 时占比为 -（不产生 NaN）', () => {
    const frozen = createTimeline({ now: () => 0 })
    frozen.mark('a', 0)
    const text = frozen.format('标题')
    expect(text).toContain('标题')
    expect(text).toContain('合计')
    expect(text).toContain('-')
    expect(text).not.toContain('NaN')
  })

  it('format 按启动顺序排列（并发阶段重叠时表格不冒充串行）', async () => {
    let t = 0
    const tl = createTimeline({ now: () => t })
    const first = tl.phase('先启动后完成', async () => {
      await Promise.resolve() // 让它在「后启动」的阶段之后才落账
      t = 900
    })
    t = 100
    const second = tl.phase('后启动先完成', () => {
      t = 110
    })
    await second
    await first
    // 记录顺序是「后启动先完成」在前，但表格必须按 start 排——否则并发流水线会被误读成串行
    expect(tl.entries()[0].name).toBe('后启动先完成')
    const text = tl.format()
    expect(text.indexOf('先启动后完成')).toBeLessThan(text.indexOf('后启动先完成'))
  })

  it('format 占比以合计为分母', () => {
    // 手工时钟：两个阶段各 500ms，合计推进到 1000ms → 各占 50%
    let t = 1000
    const tl = createTimeline({ now: () => t })
    tl.mark('一半', 500)
    tl.mark('另一半', 500)
    t = 2000
    expect(tl.format()).toContain('50.0%')
  })
})
