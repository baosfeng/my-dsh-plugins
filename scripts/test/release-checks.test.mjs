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
import { execFileSync, spawnSync } from 'node:child_process'
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
    const dir = mkdtempSync(join(tmpdir(), 'relwf-'))
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
