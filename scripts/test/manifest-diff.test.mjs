// plugin-upgrade skill 的 scripts/lib/manifest-diff.mjs 的回归测试（issue #388）。
//
// 这是**落盘前的净化判据**：manifest-diff.txt 的每一段都来自不可信来源——
// 版本头 `a.resolved` / `b.resolved` 来自 `npm view --json` 响应，包名与 manifest 字段
// 来自下载包的 package.json——然后被 writeFileSync 写进产物目录。原实现把这些值原样
// 拼进文件，而同脚本的 commits.txt / reverts.txt 已走 lib/commit-lines.mjs 的 scrubField，
// 于是同一脚本存在两套净化口径（数据取得方式 fetch vs execFileSync 导致分叉，代码扫描
// 的 js/http-to-file-access 不追踪 execFileSync 路径，因此当时没被一并处置）。
//
// 下面每个用例都是"能穿透朴素净化"的输入，必须被折平/剥掉；同时用旧拼接实现的
// 逐字对照用例钉住**产物结构不变**（人工阅读与密度对比的消费方式不变）。
import { describe, expect, it } from 'vitest'
// 权威来源（本仓库内 skill 资产）：skills/plugin-upgrade/scripts/lib/manifest-diff.mjs
import {
  MAX_MANIFEST_FIELD_CHARS,
  MAX_MANIFEST_NAME_CHARS,
  MAX_MANIFEST_PACKAGES,
  manifestDiffText,
} from '../../skills/plugin-upgrade/scripts/lib/manifest-diff.mjs'

/** 净化前的拼接实现（原 materialize-npm.mjs 内联逻辑的逐字复刻），用于钉住产物结构。 */
const LEGACY_FIELDS = [
  'version',
  'bin',
  'files',
  'exports',
  'dependencies',
  'peerDependencies',
  'main',
  'types',
  'engines',
]

function legacyManifestDiff({ cli, from, to, packagesA, packagesB }) {
  let text = `# package.json manifest diff: ${cli} ${from} -> ${to}\n\n`
  for (const name of new Set([...packagesA.keys(), ...packagesB.keys()].sort())) {
    const fa = packagesA.get(name)
    const fb = packagesB.get(name)
    if (!fa || !fb) {
      text += `## ${name}: ${fa ? 'REMOVED in b' : 'ADDED in b'}\n\n`
      continue
    }
    const deltas = LEGACY_FIELDS.filter((f) => JSON.stringify(fa[f] ?? null) !== JSON.stringify(fb[f] ?? null)).map(
      (f) => `- ${f}:\n  a: ${JSON.stringify(fa[f] ?? null)}\n  b: ${JSON.stringify(fb[f] ?? null)}`,
    )
    if (deltas.length) text += `## ${name} (${fa.version} -> ${fb.version})\n\n${deltas.join('\n')}\n\n`
  }
  return text
}

/** 造一个最小 package.json 视图。 */
function manifest(version, extra = {}) {
  return { version, ...extra }
}

const normal = () => ({
  cli: '@deepseek-ai/dsh',
  from: '0.1.0-alpha.1',
  to: '0.1.0-alpha.2',
  packagesA: new Map([
    ['dsh-core', manifest('0.1.0-alpha.1', { main: 'lib/index.js', engines: { node: '>=20' } })],
    ['dsh-storage-sqlite', manifest('0.1.0-alpha.1', { dependencies: { 'better-sqlite3': '^11.0.0' } })],
    ['dsh-dropped', manifest('0.1.0-alpha.1', {})],
  ]),
  packagesB: new Map([
    ['dsh-core', manifest('0.1.0-alpha.2', { main: 'lib/index.mjs', engines: { node: '>=22' } })],
    ['dsh-storage-sqlite', manifest('0.1.0-alpha.2', { dependencies: { 'better-sqlite3': '^12.0.0' } })],
    ['dsh-added', manifest('0.1.0-alpha.2', { types: 'types/index.d.ts' })],
  ]),
})

/** 落盘文本里出现的所有行分隔类字符与显示控制符（净化后必须一个都不剩；\n 是产物自身的行分隔，除外）。 */
const DANGEROUS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

describe('manifestDiffText：产物结构不变', () => {
  it('正常输入与净化前的拼接输出逐字一致', () => {
    const input = normal()
    expect(manifestDiffText(input)).toBe(legacyManifestDiff(input))
  })

  it('ADDED / REMOVED / 无差异包的行格式与旧实现一致', () => {
    const input = normal()
    const text = manifestDiffText(input)
    expect(text).toContain('## dsh-dropped: REMOVED in b\n\n')
    expect(text).toContain('## dsh-added: ADDED in b\n\n')
    expect(text).toContain('- main:\n  a: "lib/index.js"\n  b: "lib/index.mjs"')
    // 无字段差异的包不出标题行
    const input2 = {
      ...input,
      packagesA: new Map([['same', manifest('1.0.0')]]),
      packagesB: new Map([['same', manifest('1.0.0')]]),
    }
    expect(manifestDiffText(input2)).toBe(
      '# package.json manifest diff: @deepseek-ai/dsh 0.1.0-alpha.1 -> 0.1.0-alpha.2\n\n',
    )
  })

  it('空输入仍有版本头，不抛', () => {
    const empty = { cli: '@deepseek-ai/dsh', from: '1.0.0', to: '1.0.1', packagesA: new Map(), packagesB: new Map() }
    expect(manifestDiffText(empty)).toBe('# package.json manifest diff: @deepseek-ai/dsh 1.0.0 -> 1.0.1\n\n')
  })
})

describe('manifestDiffText：不可信字段落盘前净化', () => {
  it('缺口自证：净化前的拼接实现会把注入内容原样落盘（本用例证明这些断言真能抓到缺口）', () => {
    const injected = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0\n## forged-pkg: ADDED in b',
      to: '1.0.1',
      packagesA: new Map([['evil\u2028pkg', manifest('1.0.0', {})]]),
      packagesB: new Map([['evil\u2028pkg', manifest('1.0.1', { main: 'x' })]]),
    }
    const before = legacyManifestDiff(injected)
    expect(before).toContain('\n## forged-pkg: ADDED in b')
    expect(before).toContain('\u2028')
    expect(before).toMatch(DANGEROUS)
    const after = manifestDiffText(injected)
    expect(after).not.toContain('\n## forged-pkg: ADDED in b')
    expect(after).not.toMatch(DANGEROUS)
  })

  it('版本头里的 CRLF / Unicode 行分隔符不能伪造出第二行', () => {
    const input = {
      cli: 'npm-pkg',
      from: `1.0.0\n## fake-pkg (9.9.9 -> 9.9.9)`,
      to: '2.0.0\u2028[injected] 2026-01-01',
      packagesA: new Map(),
      packagesB: new Map(),
    }
    const text = manifestDiffText(input)
    const headerLines = text.split('\n')
    expect(headerLines[0]).toBe(
      '# package.json manifest diff: npm-pkg 1.0.0 ## fake-pkg (9.9.9 -> 9.9.9) -> 2.0.0 [injected] 2026-01-01',
    )
    // 版本头只有一行（其后紧跟空行，再无注入内容）
    expect(headerLines[1]).toBe('')
    expect(headerLines[2]).toBe('')
    expect(text).not.toMatch(/[\u2028\u2029\r]/)
  })

  it('包名里的换行 / 双向控制符不能伪造标题行，也不落盘显示控制符', () => {
    const bidi = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'
    const input = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0',
      to: '1.0.1',
      packagesA: new Map([[`evil\n## forged-pkg: ADDED in b\u2028${bidi}x`, manifest('1.0.0', {})]]),
      packagesB: new Map([[`evil\n## forged-pkg: ADDED in b\u2028${bidi}x`, manifest('1.0.1', { main: 'x' })]]),
    }
    const text = manifestDiffText(input)
    const headings = text.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toHaveLength(1)
    expect(headings[0]).toBe('## evil ## forged-pkg: ADDED in b x (1.0.0 -> 1.0.1)')
    expect(text).not.toMatch(DANGEROUS)
  })

  it('manifest 字段值里的控制字符 / Unicode 行分隔符 / 双向控制符不落盘原文', () => {
    const bidi = '\u202erelease\u202c'
    const input = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0',
      to: '1.0.1',
      packagesA: new Map([['pkg', manifest('1.0.0', { bin: { evil: 'a\u2028b', esc: 'ansi\u001b[31mred', bidi } })]]),
      packagesB: new Map([['pkg', manifest('1.0.1', { bin: { evil: 'c', esc: 'plain', bidi: 'plain' } })]]),
    }
    const text = manifestDiffText(input)
    // 落盘文本里不得再有这些字符的原文（U+2028/U+2029 折平，C0/C1 与双向控制符删除）
    expect(text).not.toContain('\u2028')
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\u202e')
    expect(text).not.toContain('\u202c')
    expect(text).not.toMatch(DANGEROUS)
    expect(text).toContain('a b')
  })

  it('manifest 字段值里的 JSON 转义序列仍可读（不因净化退化）', () => {
    const input = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0',
      to: '1.0.1',
      packagesA: new Map([['pkg', manifest('1.0.0', { main: 'lib/a.js' })]]),
      packagesB: new Map([['pkg', manifest('1.0.1', { main: 'lib/b.js' })]]),
    }
    expect(manifestDiffText(input)).toContain('  a: "lib/a.js"\n  b: "lib/b.js"')
  })
})

describe('manifestDiffText：上限防御', () => {
  it('超长包名按上限截断（标题行不被撑爆）', () => {
    const longName = 'n'.repeat(500)
    const input = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0',
      to: '1.0.1',
      packagesA: new Map([[longName, manifest('1.0.0', {})]]),
      packagesB: new Map([[longName, manifest('1.0.1', { main: 'x' })]]),
    }
    const heading = manifestDiffText(input)
      .split('\n')
      .find((line) => line.startsWith('## '))
    expect(heading).toBe(`## ${'n'.repeat(MAX_MANIFEST_NAME_CHARS)} (1.0.0 -> 1.0.1)`)
  })

  it('超长字段值按上限截断（单个 manifest 字段不撑爆产物）', () => {
    const huge = 'x'.repeat(MAX_MANIFEST_FIELD_CHARS + 5_000)
    const input = {
      cli: '@deepseek-ai/dsh',
      from: '1.0.0',
      to: '1.0.1',
      packagesA: new Map([['pkg', manifest('1.0.0', { files: [huge] })]]),
      packagesB: new Map([['pkg', manifest('1.0.0', { files: ['small'] })]]),
    }
    const line = manifestDiffText(input)
      .split('\n')
      .find((l) => l.startsWith('  a: '))
    expect(line.length).toBe('  a: '.length + MAX_MANIFEST_FIELD_CHARS)
  })

  it('超长版本号按上限截断', () => {
    const input = {
      cli: '@deepseek-ai/dsh',
      from: 'v'.repeat(500),
      to: '1.0.1',
      packagesA: new Map(),
      packagesB: new Map(),
    }
    expect(manifestDiffText(input).split('\n')[0]).toBe(
      `# package.json manifest diff: @deepseek-ai/dsh ${'v'.repeat(MAX_MANIFEST_NAME_CHARS)} -> 1.0.1`,
    )
  })

  it('包条数按上限截断（异常闭包不撑爆产物）', () => {
    const packagesA = new Map()
    const packagesB = new Map()
    for (let i = 0; i < MAX_MANIFEST_PACKAGES + 20; i++) {
      // 名称零填充，保证字典序稳定且与插入顺序解耦
      const name = `pkg-${String(i).padStart(6, '0')}`
      packagesA.set(name, manifest('1.0.0', { main: 'a' }))
      packagesB.set(name, manifest('1.0.1', { main: 'b' }))
    }
    const headings = manifestDiffText({ cli: '@deepseek-ai/dsh', from: '1.0.0', to: '1.0.1', packagesA, packagesB })
      .split('\n')
      .filter((line) => line.startsWith('## '))
    expect(headings).toHaveLength(MAX_MANIFEST_PACKAGES)
    expect(headings[0]).toContain('pkg-000000')
    expect(headings.at(-1)).toContain(`pkg-${String(MAX_MANIFEST_PACKAGES - 1).padStart(6, '0')}`)
  })
})
