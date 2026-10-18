// 「插件可单独安装」门禁的自测（scripts/check-standalone-install.mjs + scripts/lib/standalone-install.mjs）。
//
// 为什么必须有自测：这条门禁治的是**用户侧才暴露**的故障（issue #485：单装后
// failed to import）。它失效时本机一切绿——没有任何人会发现问题。因此正反两个方向
// 都要钉住：① 未声明的裸包 / 只写 peer 的运行期依赖 / 单装入口加载失败 → 必须判红；
// ② 宿主白名单（Node 内置 / cordis / react / react-dom / @deepseek-ai/*）与
// workspace 包（peer-only 交给 check-dep-resolution）不能误伤。
//
// 判据 C 用注入的假 pack/复制/import（不真跑 npm、不联网）；CLI 层用真实 fixture
// 跑一遍完整链路（含 npm pack），最后对本仓库自身跑一次作为回归防线。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  auditOfflineInstall,
  auditPlugin,
  classifySpecifier,
  collectServerGraph,
  dependencyNamesOf,
  extractImportSpecifiers,
  findMissingDeclarations,
  findPeerOnlyRuntimeDeps,
  isHostProvided,
  renderReport,
  resolveRelativeFile,
  serverEntryOf,
  stripComments,
} from '../lib/standalone-install.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts', 'check-standalone-install.mjs')

const roots = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 写一个文件（自动建父目录）。 */
function writeFile(file, content) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/** 写一个 package.json。 */
function writePkg(dir, pkg) {
  writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

/**
 * 造一个仿本仓结构的最小仓库：plugins/<dir>/package.json + 任意源码文件。
 * 返回仓库根（清理由 afterAll 统一负责）。
 */
function makeRepo(plugins) {
  const root = mkdtempSync(join(tmpdir(), 'standalone-install-repo-'))
  roots.push(root)
  for (const plugin of plugins) {
    const dir = join(root, 'plugins', plugin.dir)
    writePkg(dir, plugin.pkg)
    for (const [rel, content] of Object.entries(plugin.files ?? {})) writeFile(join(dir, rel), content)
  }
  return root
}

/** 每个用例独立的临时沙盒（模块目录 / pack 目录 / 假根 node_modules）。 */
function makeSandbox(label = 'case') {
  const root = mkdtempSync(join(tmpdir(), `standalone-install-${label}-`))
  roots.push(root)
  return {
    dir: root,
    modulesDir: join(root, 'node_modules'),
    packsDir: join(root, '.packs'),
    repoModulesDir: join(root, 'repo-node_modules'),
  }
}

/**
 * 假 io：只把「安装依赖 / 加载入口」换成可控实现，读文件用真实 fs（fixture 就是真文件）。
 * registry 表里没有的包 → 返回 reason:'missing'（模拟根 node_modules 缺包）。
 */
function makeFakeIo({ registry = {}, workspaceDeps = {}, importResult = { status: 0, stderr: '' } } = {}) {
  const calls = { packs: [], copies: [], imports: [] }
  const io = {
    readFile: (file) => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return null
      }
    },
    exists: (file) => {
      try {
        readFileSync(file)
        return true
      } catch {
        return false
      }
    },
    installWorkspacePackage: async ({ dir, target }) => {
      calls.packs.push(basename(dir))
      mkdirSync(target, { recursive: true })
      writePkg(target, { name: basename(dir), dependencies: workspaceDeps[basename(dir)] ?? {} })
      return { ok: true }
    },
    installRegistryPackage: async ({ name, target }) => {
      calls.copies.push(name)
      const spec = registry[name]
      if (spec === undefined) return { ok: false, reason: 'missing' }
      mkdirSync(target, { recursive: true })
      writePkg(target, { name, dependencies: spec.dependencies ?? {} })
      return { ok: true }
    },
    runImport: async ({ entryFile }) => {
      calls.imports.push(entryFile)
      return typeof importResult === 'function' ? importResult(entryFile) : importResult
    },
  }
  return { io, calls }
}

/** 从 fixture 目录建相对导入图（真实 fs 注入）。 */
function graphOf(dir, entryRel) {
  return collectServerGraph({
    entry: join(dir, entryRel),
    readFile: (file) => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return null
      }
    },
    exists: (file) => {
      try {
        readFileSync(file)
        return true
      } catch {
        return false
      }
    },
  })
}

describe('standalone-install 解析纯函数', () => {
  it('stripComments：去掉注释但保留字符串里的 // 与 import 原文', () => {
    const source = [
      "// import 'ghost-in-comment'",
      "const url = 'https://example.com/x'",
      "import 'real-dep'",
      '/* require("also-ghost") */',
    ].join('\n')
    const stripped = stripComments(source)
    expect(stripped).not.toContain('ghost-in-comment')
    expect(stripped).not.toContain('also-ghost')
    expect(stripped).toContain('https://example.com/x')
    expect(stripped).toContain("import 'real-dep'")
  })

  it('extractImportSpecifiers：覆盖 import/require/export-from/动态 import，忽略注释', () => {
    const source = [
      "import a from 'dep-a'",
      "import { b } from 'dep-b'",
      "export * from 'dep-c'",
      "const d = require('dep-d')",
      "const e = await import('dep-e')",
      "import 'dep-f'",
      "// import 'not-a-dep'",
    ].join('\n')
    expect(extractImportSpecifiers(source).sort()).toEqual(['dep-a', 'dep-b', 'dep-c', 'dep-d', 'dep-e', 'dep-f'])
  })

  it('classifySpecifier：相对 / Node 内置 / 裸包（@scope/x/sub → @scope/x）', () => {
    expect(classifySpecifier('./local.js').kind).toBe('relative')
    expect(classifySpecifier('../up.js').kind).toBe('relative')
    expect(classifySpecifier('/abs.js').kind).toBe('relative')
    expect(classifySpecifier('node:fs').kind).toBe('builtin')
    expect(classifySpecifier('fs').kind).toBe('builtin')
    expect(classifySpecifier('dsh-shared/async').name).toBe('dsh-shared')
    expect(classifySpecifier('@deepseek-ai/dsh-client-ui-primitives/x').name).toBe(
      '@deepseek-ai/dsh-client-ui-primitives',
    )
  })

  it('isHostProvided：Node 内置 / cordis / react / react-dom / @deepseek-ai/* 是宿主供给', () => {
    for (const name of ['node:path', 'fs', 'cordis', 'react', 'react-dom', '@deepseek-ai/dsh-x']) {
      expect(isHostProvided(name)).toBe(true)
    }
    for (const name of ['lodash', 'dsh-shared', '@scope/other']) expect(isHostProvided(name)).toBe(false)
  })

  it('serverEntryOf：exports["."].default 优先，main 兜底，缺失返回 null', () => {
    expect(serverEntryOf({ exports: { '.': { default: './lib/index.js' } }, main: './lib/old.js' })).toBe(
      'lib/index.js',
    )
    expect(serverEntryOf({ exports: { '.': './lib/index.js' } })).toBe('lib/index.js')
    expect(serverEntryOf({ main: 'lib/index.js' })).toBe('lib/index.js')
    expect(serverEntryOf({ exports: { './client': { default: './lib/client.js' } } })).toBeNull()
    expect(serverEntryOf(null)).toBeNull()
  })

  it('resolveRelativeFile：无扩展名补 .js / 目录 index.js，找不到返回 null', () => {
    const root = mkdtempSync(join(tmpdir(), 'standalone-install-resolve-'))
    roots.push(root)
    writeFile(join(root, 'a.js'), '')
    writeFile(join(root, 'dir', 'index.js'), '')
    const exists = (file) => {
      try {
        readFileSync(file)
        return true
      } catch {
        return false
      }
    }
    expect(resolveRelativeFile(join(root, 'entry.js'), './a', exists)).toBe(join(root, 'a.js'))
    expect(resolveRelativeFile(join(root, 'entry.js'), './a.js', exists)).toBe(join(root, 'a.js'))
    expect(resolveRelativeFile(join(root, 'entry.js'), './dir', exists)).toBe(join(root, 'dir', 'index.js'))
    expect(resolveRelativeFile(join(root, 'entry.js'), './missing', exists)).toBeNull()
  })

  it('dependencyNamesOf：损坏 JSON 返回空数组，不抛异常', () => {
    expect(dependencyNamesOf('{"dependencies":{"a":"1"}}')).toEqual(['a'])
    expect(dependencyNamesOf('{ not json')).toEqual([])
    expect(dependencyNamesOf(null)).toEqual([])
    expect(dependencyNamesOf('{}')).toEqual([])
  })
})

describe('判据 A：server 面依赖完整性（静态）', () => {
  it('正向：裸包都在 dependencies → 无缺口', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', main: 'lib/index.js', dependencies: { 'dsh-shared': '^1.0.0' } },
        files: { 'lib/index.js': "import 'dsh-shared'\nimport { join } from 'node:path'\n" },
      },
    ])
    const dir = join(root, 'plugins', 'p')
    const graph = graphOf(dir, 'lib/index.js')
    expect(findMissingDeclarations({ pkg: { dependencies: { 'dsh-shared': '^1.0.0' } }, graph })).toEqual([])
  })

  it('反向：运行期 import 的裸包没声明 → missing-declaration，并带引用文件', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', main: 'lib/index.js', dependencies: {} },
        files: {
          'lib/index.js': "import { join } from 'node:path'\nimport './helper.js'\n",
          'lib/helper.js': "import x from 'left-pad'\n",
        },
      },
    ])
    const dir = join(root, 'plugins', 'p')
    const graph = graphOf(dir, 'lib/index.js')
    const problems = findMissingDeclarations({ pkg: { dependencies: {} }, graph })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ code: 'missing-declaration', name: 'left-pad' })
    expect(problems[0].from).toEqual([join(dir, 'lib', 'helper.js')])
  })

  it('正向：宿主白名单（cordis / react / @deepseek-ai/*）不算缺声明', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', main: 'lib/index.js', dependencies: {} },
        files: {
          'lib/index.js': [
            "import 'cordis'",
            "import 'react'",
            "import 'react-dom/client'",
            "import '@deepseek-ai/dsh-client-ui-primitives'",
            "import 'node:fs'",
          ].join('\n'),
        },
      },
    ])
    const dir = join(root, 'plugins', 'p')
    const graph = graphOf(dir, 'lib/index.js')
    expect(findMissingDeclarations({ pkg: { dependencies: {} }, graph })).toEqual([])
  })

  it('同名裸包在多文件被 import 时合并成一条（报告不刷屏）', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', main: 'lib/index.js', dependencies: {} },
        files: {
          'lib/index.js': "import 'lodash'\nimport './a.js'\nimport './b.js'\n",
          'lib/a.js': "import 'lodash'\n",
          'lib/b.js': "import 'lodash'\n",
        },
      },
    ])
    const dir = join(root, 'plugins', 'p')
    const graph = graphOf(dir, 'lib/index.js')
    const problems = findMissingDeclarations({ pkg: { dependencies: {} }, graph })
    expect(problems).toHaveLength(1)
    expect(problems[0].from).toHaveLength(3)
  })
})

describe('判据 B：非宿主包写成 peer', () => {
  it('反向：peer 里的第三方包不在 dependencies → peer-only-runtime', () => {
    const problems = findPeerOnlyRuntimeDeps({
      pkg: { peerDependencies: { lodash: '^4.0.0' }, dependencies: {} },
      workspaceNames: new Set(),
    })
    expect(problems).toEqual([{ code: 'peer-only-runtime', name: 'lodash' }])
  })

  it('正向：宿主包 peer、peer+dependencies 同时声明、workspace 包 peer 都不报', () => {
    const problems = findPeerOnlyRuntimeDeps({
      pkg: {
        peerDependencies: { cordis: '^4', react: '^19', 'dsh-shared': '^0.1.4', lodash: '^4' },
        dependencies: { lodash: '^4.0.0' },
      },
      workspaceNames: new Set(['dsh-shared']),
    })
    expect(problems).toEqual([])
  })
})

describe('判据 C：离线单装冒烟（注入假 pack / 复制 / import）', () => {
  it('正向：主包成包 + workspace 依赖成包 + registry 依赖复制 + 入口加载成功 → 无缺口', async () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', main: 'lib/index.js', dependencies: { 'dsh-shared': '^1', tmp: '^0.2.7' } },
        files: { 'lib/index.js': "import 'dsh-shared'\nimport 'tmp'\n" },
      },
      { dir: 'dsh-shared', pkg: { name: 'dsh-shared', main: 'index.js' }, files: { 'index.js': '' } },
    ])
    const dir = join(root, 'plugins', 'p')
    const sandbox = makeSandbox('ok')
    const { io, calls } = makeFakeIo({ registry: { tmp: {} } })
    const result = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: { 'dsh-shared': '^1', tmp: '^0.2.7' } },
      dir,
      workspaceDirs: new Map([['dsh-shared', join(root, 'plugins', 'dsh-shared')]]),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(result.violations).toEqual([])
    expect(result.installed.sort()).toEqual(['dsh-shared', 'tmp'])
    expect(calls.packs).toContain('dsh-shared') // workspace 依赖走了 pack
    expect(calls.copies).toEqual(['tmp']) // registry 依赖走了实体复制
    expect(calls.imports[0]).toBe(join(sandbox.modulesDir, 'p', 'lib', 'index.js'))
  })

  it('依赖闭包：依赖包自己的 dependencies 也会被安装（否则用户侧仍缺包）', async () => {
    const root = makeRepo([{ dir: 'p', pkg: { name: 'p', main: 'lib/index.js' }, files: { 'lib/index.js': '' } }])
    const sandbox = makeSandbox('closure')
    const { io, calls } = makeFakeIo({ registry: { outer: { dependencies: { inner: '^1' } }, inner: {} } })
    const result = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: { outer: '^1' } },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(result.violations).toEqual([])
    expect(calls.copies.sort()).toEqual(['inner', 'outer'])
  })

  it('反向：根 node_modules 缺依赖 → unresolvable-dependency（fail-closed，信息含「根 devDependencies 缺少」）', async () => {
    const root = makeRepo([{ dir: 'p', pkg: { name: 'p', main: 'lib/index.js' }, files: { 'lib/index.js': '' } }])
    const sandbox = makeSandbox('missing')
    const { io } = makeFakeIo({ registry: {} })
    const result = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: { 'not-in-root': '^1' } },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].code).toBe('unresolvable-dependency')
    expect(result.violations[0].message).toContain('根 devDependencies 缺少 not-in-root')
  })

  it('反向：入口 import 失败（ERR_MODULE_NOT_FOUND）→ import-failed + stderr 首段', async () => {
    const root = makeRepo([{ dir: 'p', pkg: { name: 'p', main: 'lib/index.js' }, files: { 'lib/index.js': '' } }])
    const sandbox = makeSandbox('import-failure')
    const { io } = makeFakeIo({
      importResult: { status: 1, stderr: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package\n    at ...' },
    })
    const result = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: {} },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({ code: 'import-failed', name: 'p' })
    expect(result.violations[0].stderr).toContain('ERR_MODULE_NOT_FOUND')
  })

  it('反向：退出码 0 但 stderr 出现 ERR_MODULE_NOT_FOUND → 仍判红（不放过警告形态）', async () => {
    const root = makeRepo([{ dir: 'p', pkg: { name: 'p', main: 'lib/index.js' }, files: { 'lib/index.js': '' } }])
    const sandbox = makeSandbox('stderr-warning')
    const { io } = makeFakeIo({ importResult: { status: 0, stderr: 'x ERR_MODULE_NOT_FOUND y' } })
    const result = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: {} },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(result.violations.map((item) => item.code)).toEqual(['import-failed'])
  })

  it('反向：打包失败 / 没有 server 入口 → 都判红（fail-closed）', async () => {
    const root = makeRepo([{ dir: 'p', pkg: { name: 'p' }, files: {} }])
    const sandbox = makeSandbox('no-entry')
    const { io: base } = makeFakeIo()
    const io = {
      ...base,
      installWorkspacePackage: async () => ({ ok: false, reason: 'pack-failed', error: 'npm pack 失败（exit 1）' }),
    }
    const packedFailure = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: {} },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io,
      entryRel: 'lib/index.js',
    })
    expect(packedFailure.violations[0].code).toBe('pack-failed')

    const { io: okIo } = makeFakeIo()
    const noEntry = await auditOfflineInstall({
      pkg: { name: 'p', dependencies: {} },
      dir: join(root, 'plugins', 'p'),
      workspaceDirs: new Map(),
      sandbox,
      io: okIo,
      entryRel: null,
    })
    expect(noEntry.violations[0].code).toBe('import-failed')
    expect(noEntry.violations[0].message).toContain('server 入口')
  })
})

describe('auditPlugin 汇总与报告渲染', () => {
  it('正向：声明完整 + 依赖可装 + 入口可加载 → 0 缺口，并统计 server 裸包', async () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'p', version: '1.0.0', main: 'lib/index.js', dependencies: { 'dsh-shared': '^1' } },
        files: { 'lib/index.js': "import 'dsh-shared'\nimport 'node:path'\n" },
      },
      { dir: 'dsh-shared', pkg: { name: 'dsh-shared', main: 'index.js' }, files: { 'index.js': '' } },
    ])
    const sandbox = makeSandbox('audit-ok')
    const { io } = makeFakeIo()
    const result = await auditPlugin({
      plugin: 'p',
      dir: join(root, 'plugins', 'p'),
      pkg: { name: 'p', version: '1.0.0', main: 'lib/index.js', dependencies: { 'dsh-shared': '^1' } },
      workspaceDirs: new Map([['dsh-shared', join(root, 'plugins', 'dsh-shared')]]),
      sandbox,
      io,
    })
    expect(result.violations).toEqual([])
    expect(result.bareImports).toEqual(['dsh-shared']) // Node 内置不计入
    expect(result.serverFiles).toBe(1)
    const text = renderReport({ root, results: [result], violations: [], checked: 1 })
    expect(text).toContain('standalone-install 通过')
    expect(text).toContain('1 个插件')
  })

  it('反向：A + B + C 同时命中时逐条打上插件名，且相对导入缺失进入附注', async () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: {
          name: 'p',
          main: 'lib/index.js',
          dependencies: {},
          peerDependencies: { dayjs: '^1' },
        },
        files: { 'lib/index.js': "import 'left-pad'\nimport './missing.js'\n" },
      },
    ])
    const dir = join(root, 'plugins', 'p')
    const sandbox = makeSandbox('audit-bad')
    const { io } = makeFakeIo({
      importResult: { status: 1, stderr: 'node:internal/x\nError [ERR_MODULE_NOT_FOUND]: nope' },
    })
    const pkg = { name: 'p', main: 'lib/index.js', dependencies: {}, peerDependencies: { dayjs: '^1' } }
    const result = await auditPlugin({ plugin: 'p', dir, pkg, workspaceDirs: new Map(), sandbox, io })
    expect(result.violations.map((violation) => violation.code).sort()).toEqual([
      'import-failed',
      'missing-declaration',
      'peer-only-runtime',
    ])
    // 每条缺口都带插件目录名（报告与 --json 消费方据此定位）
    expect(result.violations.every((violation) => violation.plugin === 'p')).toBe(true)
    // 引用位置转成插件目录内相对路径
    expect(result.violations.find((violation) => violation.code === 'missing-declaration').from).toEqual([
      'lib/index.js',
    ])
    expect(result.graphUnresolved).toEqual([{ specifier: './missing.js', from: 'lib/index.js' }])
    const text = renderReport({ root, results: [result], violations: result.violations, checked: 1 })
    expect(text).toContain('附注：')
    expect(text).toContain('plugins/p: lib/index.js → ./missing.js')
    expect(text).toContain('stderr：Error [ERR_MODULE_NOT_FOUND]: nope')
  })

  it('反向：A（缺声明）与 B（peer-only）同时报，渲染含插件名/类型/包名/建议/复现命令', () => {
    const violations = [
      {
        plugin: 'p',
        code: 'missing-declaration',
        name: 'left-pad',
        specifier: 'left-pad',
        from: ['lib/index.js'],
      },
      { plugin: 'p', code: 'peer-only-runtime', name: 'dayjs' },
    ]
    const results = [{ plugin: 'p', name: 'p', entry: 'lib/index.js', bareImports: ['left-pad'], graphUnresolved: [] }]
    const text = renderReport({ root: '/repo', results, violations, checked: 2 })
    expect(text).toContain('plugins/p')
    expect(text).toContain('[missing-declaration] left-pad')
    expect(text).toContain('[peer-only-runtime] dayjs')
    expect(text).toContain('为什么：')
    expect(text).toContain('建议：')
    expect(text).toContain('复现：node scripts/check-standalone-install.mjs')
    expect(text).toContain('合计 2 处缺口')
  })
})

describe('standalone-install CLI（scripts/check-standalone-install.mjs）', () => {
  function runCheck(args) {
    const result = spawnSync(process.execPath, [CHECK_SCRIPT, ...args], { encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

  it('--help：退出码 0 并打印用法', () => {
    const { status, stdout } = runCheck(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('node scripts/check-standalone-install.mjs')
  })

  it('--root 缺参数 → 退出码 2（静默用错根会得出错误结论）', () => {
    expect(runCheck(['--root']).status).toBe(2)
    expect(runCheck(['--root', '--json']).status).toBe(2)
  })

  it('正向 fixture：真实 npm pack + 解压 + import 全链路 → 退出码 0', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: {
          name: 'standalone-fixture-p',
          version: '1.0.0',
          type: 'module',
          main: 'lib/index.js',
          dependencies: { 'standalone-fixture-shared': '^1.0.0' },
          files: ['lib'],
        },
        files: {
          'lib/index.js': "import 'standalone-fixture-shared'\nexport const name = 'p'\n",
        },
      },
      {
        dir: 'shared',
        pkg: {
          name: 'standalone-fixture-shared',
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          files: ['index.js'],
        },
        files: { 'index.js': 'export const v = 1\n' },
      },
    ])
    const { status, stdout } = runCheck(['--root', root])
    expect(status).toBe(0)
    expect(stdout).toContain('standalone-install 通过：2 个插件')
    expect(stdout).toContain('离线单装 + 入口加载全部成功')
  })

  it('反向 fixture：import 了没声明的裸包 → 退出码 1，stderr 定位插件/类型/包名/建议', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: { name: 'standalone-fixture-bad', version: '1.0.0', type: 'module', main: 'lib/index.js', files: ['lib'] },
        files: { 'lib/index.js': "import 'left-pad'\nexport const name = 'p'\n" },
      },
    ])
    const { status, stderr } = runCheck(['--root', root])
    expect(status).toBe(1)
    expect(stderr).toContain('plugins/p')
    expect(stderr).toContain('[missing-declaration] left-pad')
    expect(stderr).toContain('建议：')
    expect(stderr).toContain('复现：node scripts/check-standalone-install.mjs')
  })

  it('--json：输出 { ok, checked, violations }，便于脚本消费', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: {
          name: 'standalone-fixture-json',
          version: '1.0.0',
          type: 'module',
          main: 'lib/index.js',
          files: ['lib'],
        },
        files: { 'lib/index.js': 'export const name = "p"\n' },
      },
    ])
    const { status, stdout } = runCheck(['--root', root, '--json'])
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.violations).toEqual([])
    expect(typeof parsed.checked).toBe('number')
    expect(parsed.plugins).toBe(1)
  })

  it('--json：判红时同样输出 violations（退出码 1，供 issue/PR 留痕）', () => {
    const root = makeRepo([
      {
        dir: 'p',
        pkg: {
          name: 'standalone-fixture-json-bad',
          version: '1.0.0',
          type: 'module',
          main: 'lib/index.js',
          files: ['lib'],
        },
        files: { 'lib/index.js': "import 'left-pad'\nexport const name = 'p'\n" },
      },
    ])
    const { status, stdout } = runCheck(['--root', root, '--json'])
    expect(status).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.violations.some((violation) => violation.code === 'missing-declaration')).toBe(true)
  })

  it('反向 fixture：files 漏了被 import 的产物 → 单装后入口加载失败，退出码 1', () => {
    // 真实事故形态②：源码目录里文件都在（判据 A 不报），但 files 白名单漏了它，
    // 用户装到的 tarball 缺文件 → 启动即 failed to import。只有「真装一次再 import」抓得到。
    const root = makeRepo([
      {
        dir: 'p',
        pkg: {
          name: 'standalone-fixture-files',
          version: '1.0.0',
          type: 'module',
          main: 'lib/index.js',
          files: ['lib/index.js'],
        },
        files: {
          'lib/index.js': "import './helper.js'\nexport const name = 'p'\n",
          'lib/helper.js': 'export const helper = 1\n',
        },
      },
    ])
    const { status, stderr } = runCheck(['--root', root])
    expect(status).toBe(1)
    expect(stderr).toContain('plugins/p')
    expect(stderr).toContain('[import-failed]')
    expect(stderr).toContain('ERR_MODULE_NOT_FOUND')
    expect(stderr).toContain('files 漏文件')
    expect(stderr.trim().split('\n').at(-1)).toContain('复现：node scripts/check-standalone-install.mjs')
  })

  it('对本仓库自身跑一遍 → 退出码 0（回归防线：12 个插件都必须可单独安装）', () => {
    const { status, stdout } = runCheck([])
    expect(status).toBe(0)
    expect(stdout).toContain('standalone-install 通过：12 个插件')
  })
})
