/**
 * release-checks.test.mjs — 发版校验纯函数单元测试（issue #39 跨插件依赖校验；
 * issue #72：server 端扫描 + npm 404 阻断）。
 *
 * 覆盖：extractDshRequires / findUndeclaredPeers / rangeMin / versionGte /
 * isNpmNotFound / findUnpublishedDeps / checkClientExternals / listClientExternals /
 * collectClientSources / collectServerSources /
 * buildPluginIndex / findFreePort / inspectTagState / tagConflictHint，
 * 外加 workflow 插件清单一致性（防漂移：release-auto.yml options + ci.yml matrix）。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { dirSync } from 'tmp'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractDshRequires,
  findUndeclaredPeers,
  rangeMin,
  versionGte,
  isNpmNotFound,
  findUnpublishedDeps,
  checkClientExternals,
  listClientExternals,
  listDegradedExternals,
  findRedundantDegradedExternals,
  CLIENT_EXTERNAL_FIX_HINT,
  collectClientSources,
  collectServerSources,
  buildPluginIndex,
  findFreePort,
  inspectTagState,
  tagConflictHint,
  readmeVersionRowRe,
  releaseCommitPlan,
  resolveBumpType,
  releaseArtifactNames,
  buildRealVerifyArgs,
} from '../lib/release-checks.mjs'

// ── 发版目标版本口径（防回归：清单名必须等于本次要发布的版本）────────────
describe('发版目标版本口径', () => {
  it('--push 未显式 --bump 时默认 patch（发版必须有新目标版本）', () => {
    expect(resolveBumpType({ bump: '', push: true })).toBe('patch')
  })

  it('dry-run（无 --push）未显式 --bump 时不 bump（语义不变）', () => {
    expect(resolveBumpType({ bump: '', push: false })).toBe('')
  })

  it('显式 --bump 优先，不被默认值覆盖', () => {
    expect(resolveBumpType({ bump: 'minor', push: true })).toBe('minor')
    expect(resolveBumpType({ bump: 'major', push: false })).toBe('major')
  })

  it('清单文件名必须等于本次要发布的版本（与 tag 共用同一个 version）', () => {
    const { checklistPath, tag } = releaseArtifactNames('dsh-my-memory', '0.1.10')
    expect(tag).toBe('dsh-my-memory@v0.1.10')
    expect(checklistPath).toBe('verification/dsh-my-memory-0.1.10.md')
    const verInChecklist = checklistPath.match(/-(\d+\.\d+\.\d+)\.md$/)?.[1]
    const verInTag = tag.match(/@v(\d+\.\d+\.\d+)$/)?.[1]
    expect(verInChecklist).toBe(verInTag)
  })

  it('脚本接线：release.mjs 必须用这两个纯函数（lib 改了脚本没接 = 假修复）', () => {
    const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'release.mjs'), 'utf8')
    expect(script).toContain('resolveBumpType(')
    expect(script).toContain('releaseArtifactNames(name, version)')
    // 刻意**不**断言"源码里没有旧字面量"：那是脆弱的实现细节断言，重构即假红（本次实测教训）。
    // 口径契约由本文件「清单文件名必须等于本次要发布的版本」（纯函数输出）用例保证。
  })
})

// ── 3c 透传 --enable-plugins（显式声明，默认不启用）────────────────────────
describe('3c 透传 --enable-plugins', () => {
  const base = {
    checklistPath: 'verification/dsh-my-guardian-0.4.4.md',
    pluginName: 'dsh-my-guardian',
    version: '0.4.4',
    port: 3087,
    addonDir: 'plugins/dsh-my-guardian',
  }

  it('① 未声明时**不带**该参数 → 被生产禁用的插件照样被 3c 拦下（判据不变）', () => {
    const args = buildRealVerifyArgs(base)
    expect(args).not.toContain('--enable-plugins')
    expect(args).toContain('--clean-externals')
    expect(args).toContain('--addons')
    expect(args).toContain('plugins/dsh-my-guardian')
  })

  it('② 声明后透传该插件名（值紧跟在 flag 之后）', () => {
    const args = buildRealVerifyArgs({ ...base, enablePlugins: ['dsh-my-guardian'] })
    expect(args).toContain('--enable-plugins')
    expect(args[args.indexOf('--enable-plugins') + 1]).toBe('dsh-my-guardian')
  })

  it('③ 声明的是别的插件 → 本插件不带该参数（批量发版不串味）', () => {
    const args = buildRealVerifyArgs({ ...base, enablePlugins: ['dsh-my-memory'] })
    expect(args).not.toContain('--enable-plugins')
  })

  it('④ 参数契约不变：脚本入口、--addons / --port / --version 取值照旧', () => {
    const args = buildRealVerifyArgs(base)
    expect(args.slice(0, 2)).toEqual(['scripts/verify-real-profile.mjs', '--addons'])
    expect(args[args.indexOf('--port') + 1]).toBe('3087')
    expect(args[args.indexOf('--version') + 1]).toBe('0.4.4')
  })

  it('⑤ 脚本接线：release.mjs 必须用纯函数构造 3c 参数（旧内联数组必须退场）', () => {
    const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'release.mjs'), 'utf8')
    expect(script).toContain('buildRealVerifyArgs({')
    // 同样不断言"源码里没有 --clean-externals 字面量"——契约由纯函数用例①保证。
  })
})

// ── extractDshRequires ────────────────────────────────────────────────────
describe('extractDshRequires', () => {
  it('提取单引号 require 的 dsh-* 包', () => {
    expect(extractDshRequires("const M = require('dsh-md-render').MarkdownView")).toEqual(['dsh-md-render'])
  })

  it('提取双引号 require 的 dsh-* 包', () => {
    expect(extractDshRequires('const M = require("dsh-md-render")')).toEqual(['dsh-md-render'])
  })

  it('提取 import from 的 dsh-* 包', () => {
    expect(extractDshRequires("import M from 'dsh-md-render'")).toEqual(['dsh-md-render'])
  })

  it('子路径归为包名', () => {
    expect(extractDshRequires("require('dsh-md-render/lib/x')")).toEqual(['dsh-md-render'])
  })

  it('去重并排序', () => {
    const src = "require('dsh-b'); require('dsh-a'); require('dsh-b')"
    expect(extractDshRequires(src)).toEqual(['dsh-a', 'dsh-b'])
  })

  it('忽略非 dsh- 前缀与 scoped 官方包', () => {
    const src = "require('react'); require('@deepseek-ai/dsh-client-runtime'); require('lodash')"
    expect(extractDshRequires(src)).toEqual([])
  })

  it('空文本返回空数组', () => {
    expect(extractDshRequires('')).toEqual([])
  })

  // ── issue #203：注释 / 字符串 / 正则里的示例文本不得计入（假阳性阻断发版）──
  it('行注释里的 require 不计入（issue #203）', () => {
    const src = ["// 示例：const M = require('dsh-md-render').MarkdownView", 'const a = 1'].join('\n')
    expect(extractDshRequires(src)).toEqual([])
  })

  it('块注释里的 require 不计入（含 JSDoc 多行）', () => {
    const src = [
      '/**',
      " * 用法：require('dsh-md-render')",
      " * 子路径：require('dsh-other/lib/x')",
      ' */',
      'const a = 1',
    ].join('\n')
    expect(extractDshRequires(src)).toEqual([])
  })

  it('混合场景：注释示例与真实引用并存时只提取真实的', () => {
    const src = [
      "// 反例：require('dsh-fake')",
      "/* import M from 'dsh-fake2' */",
      "const M = require('dsh-real').MarkdownView",
      "import X from 'dsh-real2/lib/sub'",
      "export { y } from 'dsh-real3'",
    ].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real', 'dsh-real2', 'dsh-real3'])
  })

  it('字符串字面量里的示例 require 不计入（双引号/单引号/模板串）', () => {
    const src = [
      'const a = "require(\'dsh-x\')"',
      'const b = \'require("dsh-y")\'',
      "const c = `require('dsh-z')`",
    ].join('\n')
    expect(extractDshRequires(src)).toEqual([])
  })

  it('字符串里的 // 不被当作注释（URL 之后仍能提取真实依赖）', () => {
    const src = ["const url = 'https://example.com/a'", "const M = require('dsh-real')"].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('行尾注释带 URL 时不吞掉同行真实依赖，注释内示例不计入', () => {
    const src = "const M = require('dsh-real') // 见 https://example.com require('dsh-fake')"
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('正则字面量中的引号/斜杠不破坏扫描，其内部 require 文本不计入', () => {
    const withQuotes = ["const re = /['\\/]/g", "const M = require('dsh-real')"].join('\n')
    expect(extractDshRequires(withQuotes)).toEqual(['dsh-real'])
    expect(extractDshRequires(String.raw`const re = /require\('dsh-x'\)/`)).toEqual([])
  })

  it('未闭合块注释 / 未闭合字符串不抛错（截断文件容错）', () => {
    expect(extractDshRequires("/* require('dsh-x')")).toEqual([])
    expect(extractDshRequires("const s = 'abc")).toEqual([])
  })

  it('注释与字符串混排：示例不计入、真实引用计入', () => {
    const src = [
      'const help = "调用示例：require(\'dsh-fake\')"',
      "// require('dsh-fake2')",
      "const M = require('dsh-real')",
    ].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('字符串转义序列不破坏边界：转义引号/反斜杠之后仍能提取真实依赖', () => {
    const src = String.raw`const s = 'it\'s \\ ok'` + "\nconst M = require('dsh-real')"
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('未闭合单引号遇换行即终止（不吞后续真实依赖）；末尾反斜杠不抛错', () => {
    const src = ["const broken = 'oops", "const M = require('dsh-real')"].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
    expect(extractDshRequires("const s = 'abc\\")).toEqual([])
  })

  it('正则字面量含换行（非法）时按普通字符容错，后续真实依赖仍可提取', () => {
    const src = ['const re = /abc', 'def/g', "const M = require('dsh-real')"].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('表达式起始位置的正则按正则处理（文件开头 / 关键字之后）', () => {
    expect(extractDshRequires("/dsh-x/.test(s); require('dsh-real')")).toEqual(['dsh-real'])
    expect(extractDshRequires("function f() { return /dsh-x/.test(s) } require('dsh-real')")).toEqual(['dsh-real'])
  })

  it('字符串/正则之后的正斜杠按除法处理，不影响后续提取', () => {
    const src = ["const a = 'x' / 2", 'const b = /y/ / 2', "const M = require('dsh-real')"].join('\n')
    expect(extractDshRequires(src)).toEqual(['dsh-real'])
  })

  it('正则字面量到文件末尾仍未闭合时不抛错（截断文件容错）', () => {
    expect(extractDshRequires('const re = /abc')).toEqual([])
  })
})

// ── findUndeclaredPeers ───────────────────────────────────────────────────
describe('findUndeclaredPeers', () => {
  it('全部声明 → 空', () => {
    expect(findUndeclaredPeers(['dsh-md-render'], { 'dsh-md-render': '^0.1.1' })).toEqual([])
  })

  it('部分未声明 → 返回未声明列表', () => {
    expect(findUndeclaredPeers(['dsh-a', 'dsh-b'], { 'dsh-a': '^0.1.0' })).toEqual(['dsh-b'])
  })

  it('全部未声明 → 返回全部', () => {
    expect(findUndeclaredPeers(['dsh-a'], {})).toEqual(['dsh-a'])
  })
})

// ── rangeMin ───────────────────────────────────────────────────────────────
describe('rangeMin', () => {
  it.each([
    ['^0.1.1', '0.1.1'],
    ['~0.1.1', '0.1.1'],
    ['>=0.1.1', '0.1.1'],
    ['0.1.1', '0.1.1'],
    ['^0.1.1-rc.1', '0.1.1'],
  ])('范围 %s → %s', (range, expected) => {
    expect(rangeMin(range)).toBe(expected)
  })

  it('无版本号 → null', () => {
    expect(rangeMin('*')).toBeNull()
    expect(rangeMin('')).toBeNull()
  })
})

// ── versionGte ────────────────────────────────────────────────────────────
describe('versionGte', () => {
  it.each([
    ['0.1.1', '0.1.1', true],
    ['0.1.2', '0.1.1', true],
    ['1.0.0', '0.9.9', true],
    ['0.1.0', '0.1.1', false],
    ['0.1.1', '0.1', true], // 缺位按 0
  ])('%s >= %s → %s', (a, b, expected) => {
    expect(versionGte(a, b)).toBe(expected)
  })
})

// ── isNpmNotFound（issue #72：npm 404 必须阻断发版，不再被 tag 兜底放行）──
describe('isNpmNotFound', () => {
  it('npm 404（E404）→ true', () => {
    expect(
      isNpmNotFound('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/dsh-shared'),
    ).toBe(true)
  })

  it('npm 404（404 Not Found）→ true', () => {
    expect(isNpmNotFound('npm error 404 Not Found - GET https://registry.npmjs.org/dsh-shared')).toBe(true)
  })

  it('429 限流 → false（可 tag 兜底）', () => {
    expect(isNpmNotFound('npm error code E429\nnpm error 429 Too Many Requests')).toBe(false)
  })

  it('网络错误 → false（可 tag 兜底）', () => {
    expect(isNpmNotFound('npm error code ENETUNREACH\nnpm error network request to registry failed')).toBe(false)
  })

  it('空 stderr / undefined → false', () => {
    expect(isNpmNotFound('')).toBe(false)
    expect(isNpmNotFound(undefined)).toBe(false)
  })
})

// ── findUnpublishedDeps ───────────────────────────────────────────────────
describe('findUnpublishedDeps', () => {
  const pluginIndex = new Map([
    ['dsh-md-render', { dir: 'dsh-md-render', version: '0.1.1' }],
    ['dsh-other', { dir: 'dsh-other', version: '0.2.0' }],
  ])
  const published = () => true
  const tagged = () => true

  it('依赖已发布且已打 tag → 空', () => {
    expect(findUnpublishedDeps({ 'dsh-md-render': '^0.1.1' }, pluginIndex, published, tagged)).toEqual([])
  })

  it('依赖未发布 → 报错（含依赖先发版提示）', () => {
    const problems = findUnpublishedDeps({ 'dsh-md-render': '^0.1.1' }, pluginIndex, () => false, tagged)
    expect(problems).toHaveLength(1)
    expect(problems[0].dep).toBe('dsh-md-render')
    expect(problems[0].reason).toContain('未发布')
  })

  it('依赖已发布但未打 tag → 报错（发布顺序校验）', () => {
    const problems = findUnpublishedDeps({ 'dsh-md-render': '^0.1.1' }, pluginIndex, published, () => false)
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toContain('未打 tag')
  })

  it('非仓库内依赖（官方包）→ 跳过不校验', () => {
    const peers = { '@deepseek-ai/dsh-session-title': '^0.1.1', 'dsh-better-sidebar': '^0.14.0' }
    expect(findUnpublishedDeps(peers, pluginIndex, published, tagged)).toEqual([])
  })

  it('多个问题全部返回', () => {
    const peers = { 'dsh-md-render': '^0.1.1', 'dsh-other': '^0.2.0' }
    const problems = findUnpublishedDeps(peers, pluginIndex, () => false, tagged)
    expect(problems).toHaveLength(2)
  })
})

// ── checkClientExternals（issue #294：防 #290/#293 复发；判据按 leader 验收修正）──
// external 是「同 boot 图内的跨插件 client 行请求」：只有该包成为 loader entry
// （⇒ 进 dsh.profile.bundles）才有 client graph row，浏览器端 require 才命中；
// 缺包时无 stub、无隔离，整条 client factory 抛错 → 插件全部 UI 席位挂掉。
// 判据不认"移进 dependencies"（那只是落盘，插件自己的 deps 不会被 reconcile 激活），
// 认的是 dsh.client.externalDegraded（显式声明"缺失时有降级路径"）+ 3c 缺包演练。
describe('checkClientExternals', () => {
  const pluginIndex = new Map([['dsh-md-render', { dir: 'dsh-md-render', version: '0.1.8' }]])
  const published = () => true
  const tagged = () => true
  /** 构造插件 package.json（只关心 dsh.client.external / externalDegraded / deps / peers）。 */
  const pkgWith = ({ external, degraded, dependencies, peerDependencies }) => ({
    name: 'dsh-consumer',
    version: '1.0.0',
    ...(dependencies ? { dependencies } : {}),
    ...(peerDependencies ? { peerDependencies } : {}),
    ...(external
      ? { dsh: { client: { platform: 'web', external, ...(degraded ? { externalDegraded: degraded } : {}) } } }
      : {}),
  })

  it('无 dsh.client.external → 空（绝大多数插件，行为零变化）', () => {
    expect(
      checkClientExternals(pkgWith({ dependencies: { 'dsh-md-render': '^0.1.8' } }), pluginIndex, published, tagged),
    ).toEqual([])
  })

  it('合法：仓库内包在 dependencies 且已发布 + 已打 tag → 空（不要求 externalDegraded）', () => {
    const pkg = pkgWith({ external: ['dsh-md-render'], dependencies: { 'dsh-md-render': '^0.1.8' } })
    expect(checkClientExternals(pkg, pluginIndex, published, tagged)).toEqual([])
  })

  it('反例：external 未在 dependencies/peerDependencies 声明 → 阻断', () => {
    const problems = checkClientExternals(pkgWith({ external: ['dsh-md-render'] }), pluginIndex, published, tagged)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ external: 'dsh-md-render', kind: 'undeclared' })
    expect(problems[0].reason).toContain('未在 peerDependencies/dependencies 声明')
  })

  it('合法：仓库内包仅 peer 但已声明 externalDegraded → 通过（#293 的真实形态）', () => {
    const pkg = pkgWith({
      external: ['dsh-md-render'],
      degraded: ['dsh-md-render'],
      peerDependencies: { 'dsh-md-render': '^0.1.8' },
    })
    expect(checkClientExternals(pkg, pluginIndex, published, tagged)).toEqual([])
  })

  it('反例：仓库内包仅 peer 且未声明 externalDegraded → 阻断，且给出两条修法', () => {
    const pkg = pkgWith({ external: ['dsh-md-render'], peerDependencies: { 'dsh-md-render': '^0.1.8' } })
    const problems = checkClientExternals(pkg, pluginIndex, published, tagged)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ external: 'dsh-md-render', kind: 'peer-only' })
    expect(problems[0].reason).toContain('autoInstallPeers')
    expect(problems[0].reason).toContain('externalDegraded')
    // 修法①（推荐）补降级路径 + 声明；修法②移进 dependencies 且保证被激活
    expect(problems[0].reason).toContain('修法①')
    expect(problems[0].reason).toContain('修法②')
    expect(problems[0].reason).toContain('不被 reconcile 激活')
  })

  it('仅 peer + externalDegraded 里声明的是别的名字 → 仍阻断（必须逐项声明）', () => {
    const pkg = pkgWith({
      external: ['dsh-md-render'],
      degraded: ['dsh-other'],
      peerDependencies: { 'dsh-md-render': '^0.1.8' },
    })
    expect(checkClientExternals(pkg, pluginIndex, published, tagged)).toHaveLength(1)
  })

  it('反例：仓库内包在 dependencies 但未发布 → 阻断（复用 findUnpublishedDeps 判据）', () => {
    const pkg = pkgWith({ external: ['dsh-md-render'], dependencies: { 'dsh-md-render': '^0.1.9' } })
    const problems = checkClientExternals(pkg, pluginIndex, () => false, tagged)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ external: 'dsh-md-render', kind: 'unpublished' })
    expect(problems[0].reason).toContain('未发布')
  })

  it('反例：仓库内包在 dependencies 但未打 tag → 阻断（发布顺序）', () => {
    const pkg = pkgWith({ external: ['dsh-md-render'], dependencies: { 'dsh-md-render': '^0.1.8' } })
    const problems = checkClientExternals(pkg, pluginIndex, published, () => false)
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toContain('未打 tag')
  })

  it('仓库外包（官方包）仅 peer 声明 → 通过（安装语义由包管理器负责，取舍显式）', () => {
    const pkg = pkgWith({
      external: ['@deepseek-ai/dsh-client-runtime'],
      peerDependencies: { '@deepseek-ai/dsh-client-runtime': '^0.1.5-rc.2' },
    })
    expect(checkClientExternals(pkg, pluginIndex, published, tagged)).toEqual([])
  })

  it('仓库外包但完全未声明 → 仍阻断（(i) 对所有 external 生效）', () => {
    const problems = checkClientExternals(pkgWith({ external: ['dsh-better-sidebar'] }), pluginIndex, published, tagged)
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('undeclared')
  })

  it('多个 external 的问题全部返回（去重：重复项只校验一次）', () => {
    const pkg = pkgWith({ external: ['dsh-md-render', 'dsh-md-render', 'dsh-unknown'] })
    const problems = checkClientExternals(pkg, pluginIndex, published, tagged)
    expect(problems).toHaveLength(2)
    expect(problems.map((p) => p.external)).toEqual(['dsh-md-render', 'dsh-unknown'])
  })

  it('listClientExternals：非数组/含非法项/空串一律安全降级', () => {
    expect(listClientExternals({})).toEqual([])
    expect(listClientExternals({ dsh: { client: { external: 'dsh-x' } } })).toEqual([])
    expect(listClientExternals({ dsh: { client: { external: ['dsh-x', '', 42, null, 'dsh-x'] } } })).toEqual(['dsh-x'])
  })

  it('listDegradedExternals：同样的安全降级口径（去重 + 过滤非法项）', () => {
    expect(listDegradedExternals({})).toEqual([])
    expect(listDegradedExternals({ dsh: { client: { externalDegraded: 'dsh-x' } } })).toEqual([])
    expect(listDegradedExternals({ dsh: { client: { externalDegraded: ['dsh-x', '', 7, 'dsh-x'] } } })).toEqual([
      'dsh-x',
    ])
  })

  it('externalDegraded 声明了不在 external 中的项 → 冗余（不阻断，由发版输出打印 info）', () => {
    const pkg = pkgWith({
      external: ['dsh-md-render'],
      degraded: ['dsh-md-render', 'dsh-ghost'],
      peerDependencies: { 'dsh-md-render': '^0.1.8' },
    })
    expect(checkClientExternals(pkg, pluginIndex, published, tagged)).toEqual([])
    expect(findRedundantDegradedExternals(pkg)).toEqual(['dsh-ghost'])
  })

  it('无冗余声明时 findRedundantDegradedExternals 返回空（含无 externalDegraded 的插件）', () => {
    expect(findRedundantDegradedExternals({})).toEqual([])
    const pkg = pkgWith({ external: ['dsh-md-render'], degraded: ['dsh-md-render'] })
    expect(findRedundantDegradedExternals(pkg)).toEqual([])
  })

  it('修法文案：含 externalDegraded 声明形态、dependencies 备选与踩坑文档', () => {
    expect(CLIENT_EXTERNAL_FIX_HINT).toContain('externalDegraded')
    expect(CLIENT_EXTERNAL_FIX_HINT).toContain('dependencies')
    expect(CLIENT_EXTERNAL_FIX_HINT).toContain('降级')
    expect(CLIENT_EXTERNAL_FIX_HINT).toContain('docs/踩坑/')
  })
})

// ── collectClientSources ──────────────────────────────────────────────────
describe('collectClientSources', () => {
  const { name: tmp } = dirSync({ unsafeCleanup: true, prefix: 'relchk-' })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('client.src.js 优先（含 lib/parts/*.js）', () => {
    const dir = join(tmp, 'p1')
    mkdirSync(join(dir, 'lib', 'parts'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'client.src.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
    writeFileSync(join(dir, 'lib', 'parts', 'a.part.js'), '')
    writeFileSync(join(dir, 'lib', 'parts', 'b.part.js'), '')
    const files = collectClientSources(dir)
    expect(files).toContain(join(dir, 'lib', 'client.src.js'))
    expect(files).not.toContain(join(dir, 'lib', 'client.js'))
    expect(files).toHaveLength(3)
  })

  it('仅 client.src.js（无 client.js）也正确', () => {
    const dir = join(tmp, 'p1b')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'client.src.js'), '')
    expect(collectClientSources(dir)).toEqual([join(dir, 'lib', 'client.src.js')])
  })

  it('parts 目录忽略非 .js 文件', () => {
    const dir = join(tmp, 'p1c')
    mkdirSync(join(dir, 'lib', 'parts'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'client.src.js'), '')
    writeFileSync(join(dir, 'lib', 'parts', 'a.part.js'), '')
    writeFileSync(join(dir, 'lib', 'parts', 'notes.txt'), '')
    expect(collectClientSources(dir)).toEqual([
      join(dir, 'lib', 'client.src.js'),
      join(dir, 'lib', 'parts', 'a.part.js'),
    ])
  })

  it('无 client.src.js 时回退 client.js', () => {
    const dir = join(tmp, 'p2')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'client.js'), '')
    expect(collectClientSources(dir)).toEqual([join(dir, 'lib', 'client.js')])
  })

  it('无 client 文件 → 空数组', () => {
    const dir = join(tmp, 'p3')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    expect(collectClientSources(dir)).toEqual([])
  })
})

// ── collectServerSources（issue #72：server 端 import 纳入跨插件依赖扫描）──
describe('collectServerSources', () => {
  const { name: tmp } = dirSync({ unsafeCleanup: true, prefix: 'relsrv-' })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('收集 lib/*.js（排除 client.js / client.src.js 与 parts/ 子目录）', () => {
    const dir = join(tmp, 'p1')
    mkdirSync(join(dir, 'lib', 'parts'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'index.js'), '')
    writeFileSync(join(dir, 'lib', 'routes.js'), '')
    writeFileSync(join(dir, 'lib', 'client.js'), '')
    writeFileSync(join(dir, 'lib', 'client.src.js'), '')
    writeFileSync(join(dir, 'lib', 'parts', 'a.part.js'), '')
    const files = collectServerSources(dir)
    expect(files).toEqual([join(dir, 'lib', 'index.js'), join(dir, 'lib', 'routes.js')])
  })

  it('无 lib 目录 → 空数组', () => {
    const dir = join(tmp, 'p2')
    mkdirSync(dir, { recursive: true })
    expect(collectServerSources(dir)).toEqual([])
  })

  it('lib 目录存在但无 .js 文件 → 空数组', () => {
    const dir = join(tmp, 'p3')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'notes.txt'), '')
    expect(collectServerSources(dir)).toEqual([])
  })
})

// ── buildPluginIndex ──────────────────────────────────────────────────────
describe('buildPluginIndex', () => {
  const { name: tmp } = dirSync({ unsafeCleanup: true, prefix: 'relidx-' })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('按 package.json name 建索引（目录名 ≠ 包名也正确）', () => {
    mkdirSync(join(tmp, 'plugins', 'dir-a'), { recursive: true })
    mkdirSync(join(tmp, 'plugins', 'dir-b'), { recursive: true })
    mkdirSync(join(tmp, 'plugins', 'dir-c'), { recursive: true })
    writeFileSync(join(tmp, 'plugins', 'dir-a', 'package.json'), JSON.stringify({ name: 'dsh-a', version: '1.2.3' }))
    writeFileSync(join(tmp, 'plugins', 'dir-b', 'package.json'), JSON.stringify({ name: 'dsh-b', version: '0.1.0' }))
    writeFileSync(join(tmp, 'plugins', 'dir-c', 'package.json'), JSON.stringify({ name: 'dsh-c', version: '0.0.1' }))
    const index = buildPluginIndex(tmp)
    expect(index.get('dsh-a')).toEqual({ dir: 'dir-a', version: '1.2.3' })
    expect(index.get('dsh-b')).toEqual({ dir: 'dir-b', version: '0.1.0' })
    expect(index.get('dsh-c')).toEqual({ dir: 'dir-c', version: '0.0.1' })
    expect(index.size).toBe(3)
  })

  it('无 package.json 的目录跳过', () => {
    const dir = join(tmp, 'plugins', 'no-pkg')
    mkdirSync(dir, { recursive: true })
    expect(buildPluginIndex(tmp).has('no-pkg')).toBe(false)
  })
})

// ── findFreePort ──────────────────────────────────────────────────────────
describe('findFreePort', () => {
  it('返回的端口可再次监听（空闲）', async () => {
    const port = await findFreePort(3087)
    expect(port).toBeGreaterThanOrEqual(3087)
    const { createServer } = await import('node:net')
    await new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(port, () => server.close(resolve))
    })
  })
})

// ── inspectTagState / tagConflictHint（tag 管理防护）────────────────────────
// 防回归：发版重跑时「tag 已存在」必须分三支——缺失正常打、指向 HEAD 幂等跳过
// （仅推送）、指向其他 commit 报错拒绝覆盖（绝不自动 force）。
describe('inspectTagState（tag 管理防护）', () => {
  const tmpRepos = []
  const makeRepo = () => {
    const { name: dir } = dirSync({ unsafeCleanup: true, prefix: 'reltag-' })
    tmpRepos.push(dir)
    const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
    run('init', '-q')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    run('commit', '-q', '--allow-empty', '-m', 'init')
    return { dir, run }
  }
  afterAll(() => {
    for (const dir of tmpRepos) rmSync(dir, { recursive: true, force: true })
  })

  it('tag 不存在 → absent（正常打 tag 分支）', () => {
    const { dir } = makeRepo()
    expect(inspectTagState(dir, 'dsh-x@v1.0.0')).toEqual({ state: 'absent' })
  })

  it('tag 已存在且指向 HEAD → same-head（幂等跳过、仅推送分支）', () => {
    const { dir, run } = makeRepo()
    run('tag', 'dsh-x@v1.0.0')
    const head = run('rev-parse', 'HEAD')
    expect(inspectTagState(dir, 'dsh-x@v1.0.0')).toEqual({ state: 'same-head', tagSha: head, headSha: head })
  })

  it('tag 已存在但指向其他 commit → conflict（报错分支，绝不自动 force）', () => {
    const { dir, run } = makeRepo()
    run('tag', 'dsh-x@v1.0.0')
    const tagged = run('rev-parse', 'HEAD')
    run('commit', '-q', '--allow-empty', '-m', 'next')
    const head = run('rev-parse', 'HEAD')
    expect(head).not.toBe(tagged)
    expect(inspectTagState(dir, 'dsh-x@v1.0.0')).toEqual({ state: 'conflict', tagSha: tagged, headSha: head })
  })

  it('annotated tag 解引用到 commit（^{commit}）', () => {
    const { dir, run } = makeRepo()
    run('tag', '-a', 'dsh-x@v1.0.0', '-m', 'release')
    const head = run('rev-parse', 'HEAD')
    expect(inspectTagState(dir, 'dsh-x@v1.0.0')).toEqual({ state: 'same-head', tagSha: head, headSha: head })
  })

  it('非 git 目录 → absent（rev-parse 失败不穿透抛错）', () => {
    const { name: dir } = dirSync({ unsafeCleanup: true, prefix: 'reltag-' })
    tmpRepos.push(dir)
    expect(inspectTagState(dir, 'dsh-x@v1.0.0')).toEqual({ state: 'absent' })
  })

  it('tagConflictHint 只给人工处理选项，且明确不自动 force', () => {
    const text = tagConflictHint('dsh-x@v1.0.0').join('\n')
    expect(text).toContain('git tag -d dsh-x@v1.0.0')
    expect(text).toContain('git push origin -f dsh-x@v1.0.0')
    expect(text).toContain('不提供 --force-tag 自动覆盖')
  })
})

// ── workflow 插件清单一致性与输入语义（防漂移；issue #204）──────────────────
// 事故背景一：dsh-my-opencode-session-header 新增后 release-auto.yml 的插件选项未
// 同步，手动触发发版时选不到该插件。
// 事故背景二（#204）：release-auto.yml 的 plugins 输入原是 type: choice，但注释与
// PLUGINS 组装按「可多选」设计——GitHub Actions 的 choice 只渲染单选下拉（原生
// 不支持 multiple），批量发版入口在 UI 上根本用不了。
// 修复：输入改为自由文本（逗号/空格/换行分隔）+ run 内 fail-fast 白名单校验，且
// 允许值运行时取自 plugins/ 目录（不硬编码清单 → 不可能漂移）。本组测试把三件事
// 固化成可执行断言：① 注释语义 == UI 实际能力；② 用户输入不插值进 shell；
// ③ workflow 里那段真实校验脚本的行为（合法通过 / 非法 fail-fast 并列出允许值）。
describe('workflow 插件清单一致性与输入语义（#204 防漂移）', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const pluginDirs = readdirSync(join(repoRoot, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const wfFile = '.github/workflows/release-auto.yml'

  const optionsAfter = (file, startRe, endRe) => {
    const yml = readFileSync(join(repoRoot, file), 'utf8')
    const section = yml.split(startRe)[1]?.split(endRe)[0] ?? ''
    return [...section.matchAll(/^ +- (.+)$/gm)].map((m) => m[1].trim()).sort()
  }

  /**
   * 抽出 workflow 中某个 step 的 `run: |` 脚本正文（剥离 YAML 缩进）。
   * 测试直接执行 workflow 里那段真实脚本，而不是它的复制品——复制品会与
   * workflow 漂移，等于没测。
   */
  const runScriptOf = (file, stepId) => {
    const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n')
    const idIdx = lines.findIndex((l) => l.trim() === `id: ${stepId}`)
    if (idIdx < 0) return null
    const runIdx = lines.findIndex((l, i) => i > idIdx && /^\s+run: \|$/.test(l))
    if (runIdx < 0) return null
    const indent = lines[runIdx].search(/\S/)
    const body = []
    for (let i = runIdx + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() !== '' && line.search(/\S/) <= indent) break
      body.push(line.trim() === '' ? '' : line.slice(indent + 2))
    }
    return `${body.join('\n')}\n`
  }

  /** 抽出 workflow 里所有 `run: |` 脚本（用于「run 内不得插值」的整体断言）。 */
  const allRunScripts = (file) => {
    const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n')
    const scripts = []
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s+run: \|$/.test(lines[i])) continue
      const indent = lines[i].search(/\S/)
      const body = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        if (line.trim() !== '' && line.search(/\S/) <= indent) break
        body.push(line.trim() === '' ? '' : line.slice(indent + 2))
      }
      scripts.push(body.join('\n'))
    }
    return scripts
  }

  const tmpDirs = []
  afterAll(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  })

  /** 在仓库根用 env 传参执行 workflow 的校验脚本（与 workflow 同口径）。 */
  const execValidation = (rawPlugins) => {
    const script = runScriptOf(wfFile, 'resolve-plugins')
    expect(script).not.toBeNull()
    const { name: dir } = dirSync({ unsafeCleanup: true, prefix: 'relwf-' })
    tmpDirs.push(dir)
    const scriptPath = join(dir, 'resolve-plugins.sh')
    const outPath = join(dir, 'github_output')
    writeFileSync(scriptPath, script)
    writeFileSync(outPath, '')
    const res = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, RAW_PLUGINS: rawPlugins, GITHUB_OUTPUT: outPath },
    })
    return {
      status: res.status,
      log: `${res.stdout ?? ''}${res.stderr ?? ''}`,
      output: readFileSync(outPath, 'utf8'),
    }
  }

  // ── 语义一致性：注释/描述声明的能力 == UI 实际能力（#204 的核心矛盾）──
  it('plugins 输入是自由文本（choice 不支持 multiple），且注释不再声称可多选', () => {
    const section =
      readFileSync(join(repoRoot, wfFile), 'utf8')
        .split(/^ {6}plugins:$/m)[1]
        ?.split(/^ {6}bump:$/m)[0] ?? ''
    expect(section).not.toBe('') // 解析失效时明确失败，而非静默通过
    expect(section).toMatch(/^ +type: string$/m)
    expect(section).not.toMatch(/^ +type: choice$/m)
    expect(section).not.toMatch(/可多选|多选插件|按住 Ctrl/)
  })

  it('bump 输入保持枚举单选（choice：patch/minor/major）', () => {
    const section =
      readFileSync(join(repoRoot, wfFile), 'utf8')
        .split(/^ {6}bump:$/m)[1]
        ?.split(/^ {4}steps:$/m)[0] ?? ''
    expect(section).toMatch(/^ +type: choice$/m)
    expect([...section.matchAll(/^ +- (patch|minor|major)$/gm)].map((m) => m[1])).toEqual(['patch', 'minor', 'major'])
  })

  it('不再硬编码插件清单：允许值运行时取自 plugins/ 目录', () => {
    const yml = readFileSync(join(repoRoot, wfFile), 'utf8')
    expect(yml).not.toMatch(/^ +- dsh-[a-z0-9-]+$/m) // 再出现 options 列表项即重新引入漂移
    expect(runScriptOf(wfFile, 'resolve-plugins')).toContain('plugins/*/')
  })

  it('用户输入只经 env 传入，绝不插值进 run 脚本（脚本注入防护）', () => {
    const lines = readFileSync(join(repoRoot, wfFile), 'utf8').split('\n')
    const injected = lines.filter((l) => l.includes('${{ inputs.'))
    expect(injected.length).toBeGreaterThan(0) // 解析/重构失效时明确失败
    for (const line of injected) {
      const t = line.trim()
      if (t.startsWith('#')) continue // 注释里的字面量只是说明，不参与执行
      expect(t, `inputs.* 只能出现在 step env 映射行：${t}`).toMatch(
        /^(RAW_PLUGINS|BUMP): \$\{\{ inputs\.(plugins|bump) \}\}$/,
      )
    }
    // 真正的注入面是 run 脚本：里面不得出现任何插值语法
    for (const script of allRunScripts(wfFile)) expect(script).not.toContain('${{')
  })

  // ── 校验脚本行为：直接跑 workflow 里那段 shell ──────────────────────────
  describe('插件名校验脚本行为', () => {
    it('单个插件名 → 通过并输出该名字', () => {
      const res = execValidation('dsh-md-render')
      expect(res.status, res.log).toBe(0)
      expect(res.output.trim()).toBe('plugins=dsh-md-render')
    })

    it('逗号 / 空格 / 换行 / 中文逗号分隔多个插件 → 通过（UI 上真能批量）', () => {
      const rawInputs = [
        'dsh-md-render,dsh-my-guard',
        'dsh-md-render dsh-my-guard',
        'dsh-md-render\n, dsh-my-guard',
        'dsh-md-render，dsh-my-guard',
      ]
      for (const raw of rawInputs) {
        const res = execValidation(raw)
        expect(res.status, `输入 ${JSON.stringify(raw)} 应通过；日志：${res.log}`).toBe(0)
        expect(res.output.trim()).toBe('plugins=dsh-md-render dsh-my-guard')
      }
    })

    it('一次传完 plugins/ 全部目录名 → 通过（允许值 == 目录，无漂移）', () => {
      const res = execValidation(pluginDirs.join(','))
      expect(res.status, res.log).toBe(0)
      expect(res.output.trim()).toBe(`plugins=${pluginDirs.join(' ')}`)
    })

    it('重复名字去重（同一插件不会被发两次）', () => {
      const res = execValidation('dsh-md-render,dsh-md-render, dsh-md-render')
      expect(res.status, res.log).toBe(0)
      expect(res.output.trim()).toBe('plugins=dsh-md-render')
    })

    it('非法插件名 → fail-fast：列出非法值 + 全部允许值，且不产出清单', () => {
      const res = execValidation('dsh-md-render,dsh-nonexistent,dsh-typo')
      expect(res.status).not.toBe(0)
      expect(res.log).toContain('dsh-nonexistent')
      expect(res.log).toContain('dsh-typo')
      for (const name of pluginDirs) expect(res.log).toContain(`  - ${name}`)
      expect(res.output.trim()).toBe('')
    })

    it('空输入 / 纯分隔符 → fail-fast 并提示输入格式', () => {
      for (const raw of ['', '   ', ',,,']) {
        const res = execValidation(raw)
        expect(res.status, `输入 ${JSON.stringify(raw)} 应失败`).not.toBe(0)
        expect(res.log).toContain('plugins 输入为空')
      }
    })

    it('命令替换不被执行（env 传参 + 白名单双重防护）', () => {
      const probe = 'pwned-204'
      const res = execValidation(`$(touch ${probe}),dsh-md-render`)
      expect(res.status).not.toBe(0)
      expect(readdirSync(repoRoot)).not.toContain(probe)
    })
  })

  it('ci.yml 的 matrix.plugin 与 plugins/ 目录完全一致', () => {
    const listed = optionsAfter('.github/workflows/ci.yml', /^ {8}plugin:$/m, /^ {4}steps:$/m)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed).toEqual(pluginDirs)
  })
})

/**
 * 发版时同步根 README 插件表版本的正则（防复发：与 check-docs.mjs 同口径）。
 * 背景：表里出现 6 字符版本（0.5.10）后，prettier 会按列宽把 5 字符版本写成
 * `| 0.1.5  |`；旧正则只容忍 1 个空格 → 同步静默失败 → pre-push 的
 * docs consistency 门禁拦下 push（发版脚本写的文档过不了自己的门禁）。
 */
describe('readmeVersionRowRe（README 插件表版本同步）', () => {
  const row = (version, pad) =>
    `| [dsh-shared](plugins/dsh-shared/README.md)${' '.repeat(pad)} | ${version}${' '.repeat(7 - version.length)}| 共享工具包 |`

  it('容忍 prettier 列对齐：版本号后 2 个空格也能同步', () => {
    const re = readmeVersionRowRe('dsh-shared')
    const line = row('0.1.5', 41)
    expect(line).toContain('| 0.1.5  |')
    expect(re.test(line)).toBe(true)
    const replaced = line.replace(re, (_m, p1, p2) => `${p1}0.1.6${p2}`)
    expect(replaced).toContain('| 0.1.6')
    expect(replaced).not.toContain('0.1.5')
  })

  it('同样容忍版本号后 1 个空格（无对齐填充）', () => {
    const re = readmeVersionRowRe('dsh-shared')
    expect(re.test('| [dsh-shared](plugins/dsh-shared/README.md) | 0.1.5 | x |')).toBe(true)
  })

  it('版本号里的 . 已转义：不会把 0x1x5 当成匹配', () => {
    const re = readmeVersionRowRe('dsh-shared')
    expect(re.test('| [dsh-shared](plugins/dsh-shared/README.md) | 0x1x5 | x |')).toBe(false)
  })

  it('只匹配同名插件行：前缀相同的插件名不会误伤', () => {
    const re = readmeVersionRowRe('dsh-shared')
    expect(re.test('| [dsh-shared-extra](plugins/dsh-shared-extra/README.md) | 0.1.5 | x |')).toBe(false)
  })
})

/**
 * 防复发：版本文件必须无条件进入提交集合。
 * `--bump` 与 `--push` 分两步跑时 bumped=false，但工作区里的版本变更仍需提交，
 * 否则 tag 指向的 commit 里 package.json 版本是旧的 → CI 的 tag↔版本校验拒绝发布。
 */
describe('releaseCommitPlan（发版提交计划）', () => {
  const plan = (succeeded, bump = 'patch') => releaseCommitPlan(succeeded, bump)

  it('bumped=false（版本由上一次运行写入）也要提交 package.json 与 CHANGELOG', () => {
    const { files } = plan([{ name: 'dsh-md-render', version: '0.1.9', bumped: false }])
    expect(files).toContain('plugins/dsh-md-render/package.json')
    expect(files).toContain('plugins/dsh-md-render/CHANGELOG.md')
    expect(files).toContain('README.md')
    expect(files).toContain('AGENTS.md')
  })

  it('发版前功能级验证清单随发版提交（漏了它清单会留在工作区未跟踪、丢失留痕）', () => {
    const { files } = plan([{ name: 'dsh-my-remote', version: '0.1.4', bumped: true }])
    expect(files).toContain('verification/dsh-my-remote-0.1.4.md')
  })

  it('批量发版时每个插件各自的清单都入列（版本号各自对应，不串味）', () => {
    const { files } = plan([
      { name: 'a-plugin', version: '1.0.0', bumped: true },
      { name: 'b-plugin', version: '2.0.0', bumped: false },
    ])
    expect(files).toContain('verification/a-plugin-1.0.0.md')
    expect(files).toContain('verification/b-plugin-2.0.0.md')
  })

  it('bumped=true 的 commit 消息带 bump 类型，bumped=false 的是文档同步', () => {
    const { messages } = plan([
      { name: 'a-plugin', version: '1.2.4', bumped: true },
      { name: 'b-plugin', version: '0.1.0', bumped: false },
    ])
    expect(messages[0]).toContain('a-plugin v1.2.4')
    expect(messages[0]).toContain('自动 bump patch')
    expect(messages[1]).toContain('b-plugin')
    expect(messages[1]).not.toContain('自动 bump')
  })
})
