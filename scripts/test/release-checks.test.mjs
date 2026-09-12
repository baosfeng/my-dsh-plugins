/**
 * release-checks.test.mjs — 发版校验纯函数单元测试（issue #39 跨插件依赖校验；
 * issue #72：server 端扫描 + npm 404 阻断）。
 *
 * 覆盖：extractDshRequires / findUndeclaredPeers / rangeMin / versionGte /
 * isNpmNotFound / findUnpublishedDeps / collectClientSources / collectServerSources /
 * buildPluginIndex / findFreePort / inspectTagState / tagConflictHint，
 * 外加 workflow 插件清单一致性（防漂移：release-auto.yml options + ci.yml matrix）。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractDshRequires,
  findUndeclaredPeers,
  rangeMin,
  versionGte,
  isNpmNotFound,
  findUnpublishedDeps,
  collectClientSources,
  collectServerSources,
  buildPluginIndex,
  findFreePort,
  inspectTagState,
  tagConflictHint,
} from '../lib/release-checks.mjs'

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

// ── collectClientSources ──────────────────────────────────────────────────
describe('collectClientSources', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'relchk-'))
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
  const tmp = mkdtempSync(join(tmpdir(), 'relsrv-'))
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
  const tmp = mkdtempSync(join(tmpdir(), 'relidx-'))
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
    const dir = mkdtempSync(join(tmpdir(), 'reltag-'))
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
    const dir = mkdtempSync(join(tmpdir(), 'reltag-'))
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

// ── workflow 插件清单一致性（防漂移）──────────────────────────────────────
// 事故背景：dsh-my-opencode-session-header 新增后 release-auto.yml 的插件选项未
// 同步，手动触发发版时选不到该插件。把「workflow 清单 == plugins/ 目录」固化成
// 测试：新增/改名插件忘记同步任一清单，npm run test:scripts 即失败。
describe('workflow 插件清单一致性', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const pluginDirs = readdirSync(join(repoRoot, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const optionsAfter = (file, startRe, endRe) => {
    const yml = readFileSync(join(repoRoot, file), 'utf8')
    const section = yml.split(startRe)[1]?.split(endRe)[0] ?? ''
    return [...section.matchAll(/^ +- (.+)$/gm)].map((m) => m[1].trim()).sort()
  }

  it('release-auto.yml 的 plugins 选项与 plugins/ 目录完全一致', () => {
    const listed = optionsAfter('.github/workflows/release-auto.yml', /^ {6}plugins:$/m, /^ {6}bump:$/m)
    expect(listed.length).toBeGreaterThan(0) // 解析失效时明确失败，而非静默空列表
    expect(listed).toEqual(pluginDirs)
  })

  it('ci.yml 的 matrix.plugin 与 plugins/ 目录完全一致', () => {
    const listed = optionsAfter('.github/workflows/ci.yml', /^ {8}plugin:$/m, /^ {4}steps:$/m)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed).toEqual(pluginDirs)
  })
})
