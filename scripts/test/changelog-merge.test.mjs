/**
 * changelog-merge.test.mjs — `--bump` 消费 `## [Unreleased]` 段的判据与三种边界（issue：0.3.0 事故）。
 *
 * 事故：release.mjs 只在第一个 `## [` 前插新段，Unreleased 从不被消费。发 dsh-my-memory
 * 0.3.0 后 CHANGELOG 变成「## [0.3.0]（3 条 git 摘要）→ ## [Unreleased]（几十条手写细节，
 * 写的正是 0.3.0）→ ## [0.2.0] …」，手写细节滞留在文件中间。
 *
 * 本文件钉死三件事：
 *   ① **无 Unreleased 段 / 空 Unreleased 段 → 与旧写法逐字节一致**（回归不退化，oracle 是
 *      旧写法本身，内联在下面 legacyMerge 里）；
 *   ② **有 Unreleased 段 → 手写细节优先**（小节结构原样保留、被覆盖的 git 摘要不重复、
 *      没被覆盖的摘要不丢、Unreleased 段消失）；
 *   ③ **接线**：release.mjs 必须真的调用本模块（lib 改了脚本没接 = 假修复），且不许回退到
 *      `changelog.indexOf('## [')` 的拼接写法。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gitSummaryCore, isCoveredByHandwritten, mergeUnreleasedIntoVersion } from '../lib/changelog-merge.mjs'

const DATE = '2026-11-01'

/** 旧实现（release.mjs 修复前）：只找第一个 `## [` 把新段插到它前面，从不看 Unreleased。 */
function legacyMerge(changelog, version, logLines) {
  const section = [
    `## [${version}] - ${DATE}`,
    '',
    '### 变更',
    '',
    ...logLines.map((l) => `- ${l.replace(/^\w+\s+/, '')}`),
    '',
  ].join('\n')
  const idx = changelog.indexOf('## [')
  return changelog.slice(0, idx) + section + '\n' + changelog.slice(idx)
}

/** 无 Unreleased 段的基线：prologue + 两个版本段。 */
const NO_UNRELEASED = `# Changelog

## [0.2.0] - 2026-10-23

### 变更

- feat(x): 旧版本条目一
- fix(x): 旧版本条目二

## [0.1.0] - 2026-09-01

### 变更

- feat(x): 更早的条目
`

const LOG = [
  'c0d5eb67 fix(y): 目录上限上调至 100 行 / 8 KB，真实库 91 条全量可见',
  '9f1c2ab feat(y): agent 自主维护的跨会话记忆（#502） (#504)',
  '1a2b3c4 fix(ci): 修好 mutation 沙箱导入与 qs 中等漏洞（两个长期红的 job） (#501)',
]

const sections = (text) => text.split('\n').filter((l) => /^## /.test(l))

describe('边界①：无 Unreleased 段 → 与旧写法逐字节一致', () => {
  const { text, stats } = mergeUnreleasedIntoVersion(NO_UNRELEASED, { version: '0.3.0', date: DATE, logLines: LOG })

  it('输出与该版本修复前的旧写法完全相同（回归不许退化）', () => {
    expect(text).toBe(legacyMerge(NO_UNRELEASED, '0.3.0', LOG))
  })

  it('段结构：新版本在最前，旧版本顺序不变', () => {
    expect(sections(text)).toEqual(['## [0.3.0] - 2026-11-01', '## [0.2.0] - 2026-10-23', '## [0.1.0] - 2026-09-01'])
  })

  it('摘要一条不落，且统计如实报告「没有 Unreleased 被消费」', () => {
    expect(text).toContain('- fix(y): 目录上限上调至 100 行 / 8 KB')
    expect(stats).toEqual({
      consumedUnreleased: false,
      handwrittenBullets: 0,
      droppedGitBullets: 0,
      keptGitBullets: 3,
      staleUnreleased: 0,
    })
  })
})

describe('边界②：空 Unreleased 段 → 与无 Unreleased 段输出一致，空壳被删除', () => {
  const withEmpty = NO_UNRELEASED.replace('## [0.2.0] - 2026-10-23', '## [Unreleased]\n\n## [0.2.0] - 2026-10-23')

  it('空壳不占用版本位：输出等于无 Unreleased 的结果', () => {
    const { text } = mergeUnreleasedIntoVersion(withEmpty, { version: '0.3.0', date: DATE, logLines: LOG })
    expect(text).toBe(legacyMerge(NO_UNRELEASED, '0.3.0', LOG))
  })

  it('空壳被删除（不残留第二个 ## [Unreleased]）', () => {
    const { text, stats } = mergeUnreleasedIntoVersion(withEmpty, { version: '0.3.0', date: DATE, logLines: LOG })
    expect(text).not.toContain('## [Unreleased]')
    expect(stats.consumedUnreleased).toBe(true)
    expect(stats.handwrittenBullets).toBe(0)
  })

  it('只有标题与空行的空壳同样被删除', () => {
    const blank = NO_UNRELEASED.replace('## [0.2.0] - 2026-10-23', '## [Unreleased]\n\n\n## [0.2.0] - 2026-10-23')
    const { text } = mergeUnreleasedIntoVersion(blank, { version: '0.3.0', date: DATE, logLines: LOG })
    expect(text).toBe(legacyMerge(NO_UNRELEASED, '0.3.0', LOG))
  })
})

describe('边界③：有 Unreleased 段 → 手写细节优先，摘要不重复也不丢', () => {
  const withUnreleased = `# Changelog

## [0.2.0] - 2026-10-23

### 变更

- feat(x): 旧版本条目一

## [Unreleased]

### 新功能

- **agent 记忆（issue #502）**：第四套独立体系——agent 自主维护的跨会话记忆，与全局记忆完全隔离。
  - 子条目：4 个工具 + 三道硬门禁

### 修复

- fix(y): **目录预算重排**——实测用户库里 67 条记忆只能显示 41 条；上限 60 行 / 4 KB → **100 行 / 8 KB**，发版前用真实库复核，两种规模全量可见。

### 变更

- chore(test): 手写条目一

## [0.1.0] - 2026-09-01

### 变更

- feat(x): 更早的条目
`

  const { text, stats } = mergeUnreleasedIntoVersion(withUnreleased, { version: '0.3.0', date: DATE, logLines: LOG })
  const lines = text.split('\n')
  const startOf = (heading) => lines.findIndex((l) => l.startsWith(heading))
  const newSection = lines.slice(startOf('## [0.3.0]'), startOf('## [0.2.0]')).join('\n')

  it('Unreleased 段被消费：文件里不再有 ## [Unreleased]', () => {
    expect(text).not.toContain('## [Unreleased]')
    expect(sections(text)).toEqual(['## [0.3.0] - 2026-11-01', '## [0.2.0] - 2026-10-23', '## [0.1.0] - 2026-09-01'])
  })

  it('手写细节与小节结构原样进新版本段（顺序与文字都不改写）', () => {
    expect(newSection).toContain('### 新功能')
    expect(newSection).toContain('### 修复')
    expect(newSection).toContain('### 变更')
    expect(newSection.indexOf('### 新功能')).toBeLessThan(newSection.indexOf('### 修复'))
    expect(newSection.indexOf('### 修复')).toBeLessThan(newSection.indexOf('### 变更'))
    expect(newSection).toContain('  - 子条目：4 个工具 + 三道硬门禁')
    expect(newSection).toContain('**目录预算重排**')
  })

  it('已被手写条目覆盖的 git 摘要不重复（2 条判重丢弃）', () => {
    expect(newSection).not.toContain('目录上限上调至')
    expect(newSection).not.toContain('agent 自主维护的跨会话记忆（#502）')
    expect(stats.droppedGitBullets).toBe(2)
  })

  it('没被覆盖的摘要不丢：并入既有「变更」小节（不另起同名小节）', () => {
    expect(newSection).toContain('- fix(ci): 修好 mutation 沙箱导入与 qs 中等漏洞')
    expect(stats.keptGitBullets).toBe(1)
    expect(newSection.match(/### 变更/g)).toHaveLength(1)
    // 并入位置：手写的「变更」条目之后
    expect(newSection.indexOf('手写条目一')).toBeLessThan(newSection.indexOf('修好 mutation 沙箱导入'))
  })

  it('段间空行正常（不引入三连换行）', () => {
    expect(text).not.toMatch(/\n\n\n/)
  })

  it('统计如实报告消费结果', () => {
    expect(stats).toEqual({
      consumedUnreleased: true,
      handwrittenBullets: 4,
      droppedGitBullets: 2,
      keptGitBullets: 1,
      staleUnreleased: 0,
    })
  })

  it('幂等：再合并一次（此时已无 Unreleased）产出等价于旧写法，不重复插入', () => {
    const second = mergeUnreleasedIntoVersion(text, { version: '0.3.1', date: DATE, logLines: LOG })
    expect(second.stats.consumedUnreleased).toBe(false)
    expect(second.text).toBe(legacyMerge(text, '0.3.1', LOG))
  })
})

describe('遗留 Unreleased 段：只消费第一个，其余原样保留', () => {
  const withStale = `# Changelog

## [0.2.0] - 2026-10-23

### 变更

- feat(x): 旧版本条目一

## [Unreleased]

### 修复

- fix(y): 本次待发的手写条目

## [0.1.0] - 2026-09-01

### 变更

- feat(x): 更早的条目

## [Unreleased]

### 新增

- **全局提示词**：更早的遗留段（不属于本次版本）
`

  const { text, stats } = mergeUnreleasedIntoVersion(withStale, { version: '0.3.0', date: DATE, logLines: [] })

  it('第二个 Unreleased 原样保留并计数（归属不可推断，不猜）', () => {
    expect(stats.staleUnreleased).toBe(1)
    expect(sections(text)).toEqual([
      '## [0.3.0] - 2026-11-01',
      '## [0.2.0] - 2026-10-23',
      '## [0.1.0] - 2026-09-01',
      '## [Unreleased]',
    ])
    expect(text).toContain('**全局提示词**：更早的遗留段')
  })

  it('没有 git 摘要时只搬手写正文，不凭空造「### 变更」', () => {
    expect(text).toContain('- fix(y): 本次待发的手写条目')
    const newSection = text.slice(text.indexOf('## [0.3.0]'), text.indexOf('## [0.2.0]'))
    expect(newSection).not.toContain('### 变更')
  })
})

describe('位置边界：Unreleased 在文件首 / 文件尾 / 文件里没有任何二级标题', () => {
  it('Unreleased 是第一个段（没有 # Changelog 前导）→ 新段在最前，不残留前导空行', () => {
    const text = `## [Unreleased]

### 修复

- fix(y): 手写条目

## [0.1.0] - 2026-09-01

- feat(x): 更早的条目
`
    const { text: out } = mergeUnreleasedIntoVersion(text, { version: '0.2.0', date: DATE, logLines: [] })
    expect(out.startsWith('## [0.2.0] - 2026-11-01')).toBe(true)
    expect(out).toBe(`## [0.2.0] - 2026-11-01

### 修复

- fix(y): 手写条目

## [0.1.0] - 2026-09-01

- feat(x): 更早的条目
`)
  })

  it('Unreleased 是最后一个段 → 摘掉后不留多余空行', () => {
    const text = `# Changelog

## [0.1.0] - 2026-09-01

- feat(x): 更早的条目

## [Unreleased]

### 修复

- fix(y): 手写条目
`
    const { text: out } = mergeUnreleasedIntoVersion(text, { version: '0.2.0', date: DATE, logLines: [] })
    expect(out).toBe(`# Changelog

## [0.2.0] - 2026-11-01

### 修复

- fix(y): 手写条目

## [0.1.0] - 2026-09-01

- feat(x): 更早的条目
`)
  })

  it('文件里没有任何二级标题（只有前导）→ 新段追加在末尾', () => {
    const out = mergeUnreleasedIntoVersion('# Changelog\n\n还没有任何版本段。\n', {
      version: '0.1.0',
      date: DATE,
      logLines: ['abc1234 fix(y): 第一条'],
    }).text
    expect(out).toBe(`# Changelog

还没有任何版本段。

## [0.1.0] - 2026-11-01

### 变更

- fix(y): 第一条
`)
  })

  it('version 缺失 → TypeError（fail-closed，不生成半截段落）', () => {
    expect(() => mergeUnreleasedIntoVersion('# Changelog\n', { date: DATE })).toThrow(TypeError)
    expect(() => mergeUnreleasedIntoVersion('# Changelog\n', { version: '  ' })).toThrow(TypeError)
  })
})

describe('判据：gitSummaryCore / isCoveredByHandwritten（真实 0.3.0 三条摘要）', () => {
  /** 真实取自行 0.3.0 发版后 CHANGELOG 的手写正文。 */
  const handwritten = [
    '**目录预算重排**——实测用户库里 67 条记忆，目录只能显示 41 条（39% 不可见）；上限 60 行 / 4 KB → **100 行 / 8 KB**。发版前用真实库复核：67 条时 5333 字节 / 91 条时 7176 字节，两种规模都**全量可见**。',
    '**agent 记忆（issue #502）**：第四套独立体系——agent 自主维护的跨会话记忆，与全局记忆 / 项目记忆 / 全局提示词完全隔离。',
    '- **breaking**: 移除「自动学习候选记忆」：删除 autoLearn / extractor 配置。',
  ]

  it('摘要主体去掉短 hash、conventional 前缀与 PR 引用', () => {
    expect(gitSummaryCore('c0d5eb67 fix(dsh-my-memory)!: 目录上限上调至 100 行 (#502)')).toBe('目录上限上调至 100 行')
  })

  it('被手写细节覆盖的两条判重；无关的 CI 摘要保留（真实数据 0.70 / 1.00 / 0.14）', () => {
    expect(isCoveredByHandwritten(LOG[0], handwritten)).toBe(true)
    expect(isCoveredByHandwritten(LOG[1], handwritten)).toBe(true)
    expect(isCoveredByHandwritten(LOG[2], handwritten)).toBe(false)
  })

  it('过短摘要 / 空摘要不判重（宁可重复一条，也不误删）', () => {
    expect(isCoveredByHandwritten('abc1234 fix: 修复', handwritten)).toBe(false)
    expect(isCoveredByHandwritten('', handwritten)).toBe(false)
    expect(isCoveredByHandwritten(LOG[0], [])).toBe(false)
  })
})

describe('接线：release.mjs 必须真的用本模块（lib 改了脚本没接 = 假修复）', () => {
  const source = readFileSync(new URL('../release.mjs', import.meta.url), 'utf8')

  it('import 了 mergeUnreleasedIntoVersion 并调用', () => {
    expect(source).toContain("from './lib/changelog-merge.mjs'")
    expect(source).toContain('mergeUnreleasedIntoVersion(changelog, { version: next, date, logLines })')
    expect(source).toContain('writeFileSync(changelogPath, merged.text)')
  })

  it('不许回退到「只找第一个 ## [ 就插到前面」的旧拼接', () => {
    expect(source).not.toContain("changelog.indexOf('## [')")
    expect(source).not.toMatch(/const section = \[/)
  })
})
