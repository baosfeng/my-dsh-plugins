// scripts/lib/deps-matrix.mjs 的回归测试（issue #184 阶段 1 的交付门禁）。
//
// 覆盖重点（都是「判定反了会直接误导升级决策」的地方）：
//   · 版本比较：rc 序列（4.0.0-rc.8 < rc.10 < 4.0.0）、大数字段（10 > 9 而非字符串序）
//   · 声明解析：^ / >= / || 双支持 / file: / *
//   · 差距级别与分档：0.x 的 patch 也要 B、宿主随包不算可升项、policy 优先级高于自动规则
//   · 声明漂移：同一包在根与插件声明不一致时必须被标出来（issue #184 的核心病灶）
//   · 渲染：稳定排序 + 三档渲染都能在空输入 / 有漂移时不崩
import { describe, expect, it } from 'vitest'
import {
  DEP_POLICY,
  buildRows,
  classifyGap,
  compareVersions,
  findPolicy,
  parseSpec,
  parseVersion,
  renderJson,
  renderMarkdown,
  renderReport,
  resolveTier,
  summarizeRows,
} from '../lib/deps-matrix.mjs'

describe('parseVersion', () => {
  it('解析基本三段版本', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('容忍前置 v 与 build metadata', () => {
    expect(parseVersion('v2.3.4+build.7')).toMatchObject({ major: 2, minor: 3, patch: 4 })
  })

  it('解析 prerelease 段', () => {
    expect(parseVersion('4.0.0-rc.8')?.prerelease).toEqual(['rc', '8'])
  })

  it('非法输入返回 null（不猜）', () => {
    for (const bad of ['', 'abc', '1.2', '1.2.3.4', null, undefined]) {
      expect(parseVersion(bad)).toBeNull()
    }
  })
})

describe('compareVersions', () => {
  it('逐段比较（按数值而非字符串）', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })

  it('prerelease：rc.8 < rc.10 < 正式版', () => {
    expect(compareVersions('4.0.0-rc.8', '4.0.0-rc.10')).toBe(-1)
    expect(compareVersions('4.0.0-rc.10', '4.0.0')).toBe(-1)
  })

  it('prerelease：数字标识符小于字母标识符，短序列更小', () => {
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-1')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })

  it('无法解析时抛错，而不是当作相等', () => {
    expect(() => compareVersions('abc', '1.0.0')).toThrow()
  })
})

describe('parseSpec', () => {
  it('取 caret / gte 声明的下限版本', () => {
    expect(parseSpec('^1.2.3')).toMatchObject({ registry: true, floor: '1.2.3', kind: 'registry' })
    expect(parseSpec('>=0.14.0')).toMatchObject({ floor: '0.14.0' })
    expect(parseSpec('^4.0.0-rc.8')).toMatchObject({ floor: '4.0.0-rc.8' })
  })

  it('双支持声明取首支并记录分支数', () => {
    expect(parseSpec('^18.2.0 || ^19.2.0')).toMatchObject({ floor: '18.2.0', alternatives: 2 })
  })

  it('本地路径声明不进 registry 比较', () => {
    expect(parseSpec('file:plugins/dsh-shared')).toMatchObject({ registry: false, kind: 'local' })
    expect(parseSpec('workspace:*')).toMatchObject({ registry: false, kind: 'local' })
  })

  it('通配与非法范围分别归位', () => {
    expect(parseSpec('*')).toMatchObject({ kind: 'wildcard', floor: null })
    expect(parseSpec('latest')).toMatchObject({ kind: 'wildcard' })
    expect(parseSpec('')).toMatchObject({ kind: 'unknown' })
    expect(parseSpec('^not-a-version')).toMatchObject({ registry: true, floor: null, kind: 'unknown' })
  })
})

describe('classifyGap', () => {
  it('同级 / 落后三级 / 领先', () => {
    expect(classifyGap('1.2.3', '1.2.3')).toEqual({ level: 'none', behind: 0 })
    expect(classifyGap('1.2.3', '1.2.9')).toEqual({ level: 'patch', behind: 6 })
    expect(classifyGap('1.2.3', '1.5.0')).toEqual({ level: 'minor', behind: 3 })
    expect(classifyGap('1.2.3', '4.0.0')).toEqual({ level: 'major', behind: 3 })
    expect(classifyGap('1.9.0', '0.9.0')).toEqual({ level: 'ahead', behind: 0 })
  })

  it('rc → rc 记 prerelease，rc → 正式版记 stable', () => {
    expect(classifyGap('4.0.0-rc.8', '4.0.0-rc.10')).toEqual({ level: 'prerelease', behind: 0 })
    expect(classifyGap('4.0.0-rc.10', '4.0.0')).toEqual({ level: 'stable', behind: 0 })
  })

  it('缺任一侧版本时归 unknown', () => {
    expect(classifyGap(null, '1.0.0')).toEqual({ level: 'unknown', behind: null })
    expect(classifyGap('1.0.0', null)).toEqual({ level: 'unknown', behind: null })
  })
})

describe('findPolicy / resolveTier', () => {
  it('台账支持单名与 names 组（react / react-dom 同档）', () => {
    expect(findPolicy('react')).toBe(findPolicy('react-dom'))
    expect(findPolicy('reactor')).toBeNull()
    expect(DEP_POLICY.every((entry) => entry.reason && entry.verify)).toBe(true)
  })

  it('阻塞解除后必须摘掉台账条目（jscpd 5.x 解锁的防回归）', () => {
    // jscpd 曾长期以 C 档钉在 4.x（云效容器 GLIBC 2.32 < 2.33）。云效通道废弃后
    // 阻塞不再成立、已升 5.x —— 台账里若还留着这条，矩阵会永远报"有硬阻塞"。
    expect(findPolicy('jscpd')).toBeNull()
    expect(resolveTier({ name: 'jscpd', gap: { level: 'major', behind: 1 }, baseline: '5.2.0' }).tier).toBe('B')
  })

  it('台账优先级高于自动规则（react 即使 minor 差也是 D 档）', () => {
    const tier = resolveTier({ name: 'react', gap: { level: 'minor', behind: 1 }, baseline: '19.2.8' })
    expect(tier).toMatchObject({ tier: 'D', blocked: false })
  })

  it('台账里标记 blocked 的项传导为 C 档加阻塞（未来新增硬阻塞项的能力）', () => {
    DEP_POLICY.push({ name: '__blocked-fixture__', tier: 'C', blocked: true, reason: 'fixture', verify: 'fixture' })
    try {
      const tier = resolveTier({ name: '__blocked-fixture__', gap: { level: 'major', behind: 1 }, baseline: '1.0.0' })
      expect(tier).toMatchObject({ tier: 'C', blocked: true })
    } finally {
      DEP_POLICY.pop()
    }
  })

  it('台账里的 A 档在升完后显示 OK（不留假待办）', () => {
    expect(resolveTier({ name: '@types/node', gap: { level: 'none', behind: 0 }, baseline: '26.5.1' }).tier).toBe('OK')
    expect(resolveTier({ name: '@types/node', gap: { level: 'minor', behind: 1 }, baseline: '26.4.0' }).tier).toBe('A')
  })

  it('宿主随包（@deepseek-ai/dsh-*）一律 B 档', () => {
    const tier = resolveTier({ name: '@deepseek-ai/dsh-llm', gap: { level: 'major', behind: 1 }, baseline: '0.1.0' })
    expect(tier).toMatchObject({ tier: 'B', source: 'host' })
  })

  it('0.x 包的非零差距升 B（semver 不承诺兼容）', () => {
    expect(resolveTier({ name: 'tiny-lib', gap: { level: 'patch', behind: 1 }, baseline: '0.1.2' })).toMatchObject({
      tier: 'B',
    })
    expect(resolveTier({ name: 'tiny-lib', gap: { level: 'minor', behind: 1 }, baseline: '0.1.2' })).toMatchObject({
      tier: 'B',
    })
  })

  it('1.x 包的 patch / minor 归 A，major 归 B', () => {
    expect(resolveTier({ name: 'eslint', gap: { level: 'patch', behind: 1 }, baseline: '10.9.1' }).tier).toBe('A')
    expect(resolveTier({ name: 'knip', gap: { level: 'minor', behind: 1 }, baseline: '6.34.0' }).tier).toBe('A')
    expect(resolveTier({ name: 'knip', gap: { level: 'major', behind: 1 }, baseline: '6.34.0' }).tier).toBe('B')
  })

  it('无差距 / 领先归 OK，未解析归 ?', () => {
    expect(resolveTier({ name: 'prettier', gap: { level: 'none', behind: 0 }, baseline: '3.9.6' }).tier).toBe('OK')
    expect(resolveTier({ name: 'x', gap: { level: 'ahead', behind: 0 }, baseline: '1.0.0' }).tier).toBe('OK')
    expect(resolveTier({ name: 'x', gap: { level: 'unknown', behind: null }, baseline: null }).tier).toBe('?')
  })
})

describe('buildRows', () => {
  const declarations = [
    { name: 'typescript', kind: 'devDependencies', scope: 'root', spec: '^7.0.2', installed: '7.0.2' },
    {
      name: 'typescript',
      kind: 'devDependencies',
      scope: 'plugins/dsh-my-memory',
      spec: '^5.0.0',
      installed: '5.9.2',
    },
    { name: 'eslint', kind: 'devDependencies', scope: 'root', spec: '^10.9.0', installed: '10.9.1' },
    { name: 'cordis', kind: 'peerDependencies', scope: 'plugins/dsh-md-render', spec: '^4.0.0-rc.8', installed: null },
  ]

  it('检出声明漂移并按 scope 列出各变体', () => {
    const rows = buildRows(declarations, { typescript: { latest: '7.0.2' } })
    const ts = rows.find((row) => row.name === 'typescript')
    expect(ts.drift).toBe(true)
    expect(ts.specVariants).toEqual(['^5.0.0', '^7.0.2'])
    expect(ts.declaredBy).toEqual([
      { scope: 'plugins/dsh-my-memory', spec: '^5.0.0', installed: '5.9.2' },
      { scope: 'root', spec: '^7.0.2', installed: '7.0.2' },
    ])
  })

  it('主声明与实装版本以根为准（漂移时仍显示根基准）', () => {
    const rows = buildRows(declarations, { typescript: { latest: '7.0.2' } })
    const ts = rows.find((row) => row.name === 'typescript')
    expect(ts.spec).toBe('^7.0.2')
    expect(ts.installed).toBe('7.0.2')
    expect(ts.gap.level).toBe('none')
  })

  it('无根声明时取字典序首个 scope 作为主声明', () => {
    const rows = buildRows([{ name: 'cordis', kind: 'peerDependencies', scope: 'plugins/x', spec: '^4.0.0-rc.8' }], {
      cordis: { latest: '4.0.0-rc.10' },
    })
    expect(rows[0].spec).toBe('^4.0.0-rc.8')
    expect(rows[0].gap.level).toBe('prerelease')
    expect(rows[0].tier).toBe('B')
  })

  it('registry 查询失败时降到 ? 档并保留原因', () => {
    const rows = buildRows([{ name: 'ghost', kind: 'dependencies', scope: 'root', spec: '^1.0.0' }], {
      ghost: { latest: null, error: 'HTTP 503' },
    })
    expect(rows[0]).toMatchObject({ tier: '?', latest: null, error: 'HTTP 503' })
  })

  it('按包名稳定排序（两次构建结果一致）', () => {
    const first = buildRows(declarations, {}).map((row) => row.name)
    const second = buildRows([...declarations].reverse(), {}).map((row) => row.name)
    expect(first).toEqual([...first].sort())
    expect(second).toEqual(first)
  })
})

describe('summarizeRows', () => {
  it('统计各档 / 未解析 / 阻塞 / 漂移数', () => {
    const rows = buildRows(
      [
        { name: 'a', kind: 'devDependencies', scope: 'root', spec: '^1.0.0', installed: '1.0.0' },
        { name: 'b', kind: 'devDependencies', scope: 'root', spec: '^1.0.0', installed: '1.0.0' },
        { name: 'b', kind: 'devDependencies', scope: 'plugins/x', spec: '^0.9.0', installed: '0.9.0' },
        { name: 'react', kind: 'peerDependencies', scope: 'plugins/x', spec: '^18.2.0 || ^19.2.0' },
      ],
      { a: { latest: '1.0.1' }, b: { latest: '1.0.0' }, react: { latest: '19.3.0' } },
    )
    const stats = summarizeRows(rows)
    expect(stats.total).toBe(3)
    expect(stats.tiers.A).toBe(1)
    expect(stats.tiers.D).toBe(1)
    expect(stats.drifted).toBe(1)
    expect(stats.unresolved).toBe(0)
    // blocked 计数直接对行字段生效（当前台账无硬阻塞项，用人工行守住这条统计）
    expect(summarizeRows([{ tier: 'C', blocked: true, gap: { level: 'major' }, drift: false }]).blocked).toBe(1)
  })

  it('空矩阵不崩且计数为零', () => {
    expect(summarizeRows([])).toMatchObject({ total: 0, unresolved: 0, blocked: 0, drifted: 0 })
  })
})

describe('渲染', () => {
  const rows = buildRows(
    [
      { name: 'eslint', kind: 'devDependencies', scope: 'root', spec: '^10.9.0', installed: '10.9.1' },
      { name: 'typescript', kind: 'devDependencies', scope: 'root', spec: '^7.0.2', installed: '7.0.2' },
      {
        name: 'typescript',
        kind: 'devDependencies',
        scope: 'plugins/dsh-my-memory',
        spec: '^5.0.0',
        installed: '5.9.2',
      },
    ],
    { eslint: { latest: '10.10.0' }, typescript: { latest: '7.0.2' } },
  )

  it('人类可读报告含抬头、分档、engines note 与漂移小节', () => {
    const report = renderReport(rows, { scopeCount: 20, notes: ['engines.node >=22：18 个 package.json'] })
    expect(report).toContain('20 个 package.json')
    expect(report).toContain('[A] 可直接升')
    expect(report).toContain('engines.node >=22')
    expect(report).toContain('[⚠] 声明漂移')
    expect(report).toContain('plugins/dsh-my-memory')
  })

  it('无漂移时不渲染漂移小节', () => {
    const clean = buildRows([{ name: 'eslint', kind: 'devDependencies', scope: 'root', spec: '^10.9.0' }], {
      eslint: { latest: '10.9.0' },
    })
    expect(renderReport(clean)).not.toContain('声明漂移（同名依赖')
  })

  it('markdown 表格带表头、漂移列与理由', () => {
    const md = renderMarkdown(rows)
    expect(md).toContain('| 包 | 声明 | 已装 | 最新 | 差距 | 漂移 | 理由 |')
    expect(md).toContain('| `eslint` |')
    expect(md).toContain('⚠ 2 种')
    expect(md).toContain('<br>')
  })

  it('json 输出可解析且行数一致', () => {
    const parsed = JSON.parse(renderJson(rows, { scopeCount: 20, registry: 'https://registry.npmjs.org' }))
    expect(parsed).toMatchObject({ issue: 184, scopeCount: 20, registry: 'https://registry.npmjs.org' })
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.summary.drifted).toBe(1)
  })
})
