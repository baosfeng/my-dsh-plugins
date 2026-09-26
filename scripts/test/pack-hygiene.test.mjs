/**
 * 包发布卫生门禁回归测试（scripts/lib/pack-hygiene.mjs + scripts/check-pack-hygiene.mjs，issue #323）。
 *
 * 覆盖 issue 要求的**两个反例**（exports 指向不存在文件 / pack 含测试目录）与正例，外加
 * 三条本仓库特有的边界（都是真实踩过的形态，缺一条门禁就有假绿/假红）：
 *   ① 「源在仓库但故意不发布」的目录（`vendor/`、`client-parts/`、`src/`、`test/`）**必须通过**
 *      —— 判据是"被已发布面引用才必须在包内"，不是"不在 files 就报警"（一刀切会假红 19 个插件）；
 *   ② README 引用的 assets 存在但**不随包发布** → 必须失败（这是 3b 效果图门禁的盲区，
 *      首次全量跑靠它抓出 5 个插件的真实问题：npm/unpkg 上是裂图）；
 *   ③ pack 输出解析失败 / npm pack 失败 / 找不到插件 → 必须失败，**绝不静默变绿**（fail-closed）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirSync } from 'tmp'
import { afterAll, describe, expect, it } from 'vitest'
import {
  auditPlugin,
  collectDeclaredTargets,
  describeUnpackedEntries,
  extractReadmeRefs,
  findFieldProblems,
  findMissingTargets,
  findPackProblems,
  findReadmeRefProblems,
  parsePackJson,
} from '../lib/pack-hygiene.mjs'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-pack-hygiene.mjs')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const roots = []
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 造一个临时仓库目录（返回其根；测试结束自动清理）。 */
function makeTempRoot(prefix = 'pack-hygiene-') {
  const { name } = dirSync({ unsafeCleanup: true, prefix })
  roots.push(name)
  return name
}

/** 在临时仓库里造一个插件：`files` 是 { 相对路径: 内容 }。 */
function makePlugin(root, name, { pkg, files = {}, readme = null }) {
  const dir = join(root, 'plugins', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  if (readme !== null) writeFileSync(join(dir, 'README.md'), readme)
  return dir
}

/** 一个形态正确的最小 DSH 插件 package.json（正例基线）。 */
const goodPkg = (extra = {}) => ({
  name: 'dsh-demo',
  version: '1.0.0',
  main: 'lib/index.js',
  exports: {
    '.': { default: './lib/index.js' },
    './client': { default: './lib/client.js' },
    './package.json': './package.json',
  },
  files: ['lib', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE'],
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  ...extra,
})

/** 正例插件的磁盘内容（lib/index.js、lib/client.js、cordis.patch.yml + 三个文档）。 */
const goodFiles = () => ({
  'lib/index.js': 'module.exports = {}\n',
  'lib/client.js': 'module.exports = {}\n',
  'cordis.patch.yml': '- id: demo\n',
  'README.md': '# demo\n',
  'CHANGELOG.md': '## [1.0.0]\n',
  LICENSE: 'MIT\n',
})

/** 正例插件的真实 npm pack 结果（不含 test/src/vendor 等）。 */
const goodPacked = () => [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'lib/index.js',
  'lib/client.js',
  'cordis.patch.yml',
]

const runCli = (args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })

describe('findMissingTargets：反例 ① exports/main/types/patch 指向不存在的文件', () => {
  it('exports["./client"] 指向不存在的文件 → 报错（可执行修法）', () => {
    const pkg = goodPkg()
    const problems = findMissingTargets(pkg, (rel) => rel !== 'lib/client.js')
    expect(problems.map((p) => p.code)).toEqual(['target-missing'])
    expect(problems[0].where).toContain('exports../client.default')
    expect(problems[0].why).toContain('Cannot find module')
    expect(problems[0].fix).toContain('lib/client.js')
  })

  it('dsh.bundle.patch / main / types 缺失各自报出，且 patch 的理由指向"装不上"', () => {
    const pkg = goodPkg({ main: 'lib/missing.js', types: 'lib/missing.d.ts' })
    const problems = findMissingTargets(pkg, (rel) => !rel.startsWith('lib/missing') && rel !== 'cordis.patch.yml')
    expect(problems.map((p) => p.code)).toEqual(['target-missing', 'target-missing', 'target-missing'])
    const patch = problems.find((p) => p.where.includes('dsh.bundle.patch'))
    expect(patch.why).toContain('装不上')
  })

  it('全部存在 → 0 问题（正例）', () => {
    expect(findMissingTargets(goodPkg(), () => true)).toEqual([])
  })

  it('collectDeclaredTargets 覆盖 exports 条件对象/数组并去重', () => {
    const pkg = {
      exports: { '.': { import: './lib/index.mjs', default: './lib/index.js' }, './x': ['./lib/x.js', './lib/x.js'] },
      main: 'lib/index.js',
    }
    expect(collectDeclaredTargets(pkg).map((t) => t.relPath)).toEqual(['lib/index.mjs', 'lib/index.js', 'lib/x.js'])
  })
})

describe('findFieldProblems：dsh.* 字段自洽（需求 3）', () => {
  it('声明 dsh.client 却没有 exports["./client"] → 报错', () => {
    const pkg = goodPkg({ exports: { '.': { default: './lib/index.js' } } })
    expect(findFieldProblems(pkg, () => true).map((p) => p.code)).toEqual(['client-export-missing'])
  })

  it('有 exports["./client"] 却没声明 dsh.client → 报错（装了没反应）', () => {
    const pkg = goodPkg({ dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(findFieldProblems(pkg, () => true).map((p) => p.code)).toEqual(['client-decl-missing'])
  })

  it('dsh.client.platform 不是 web → 报错', () => {
    const pkg = goodPkg({ dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'node' } } })
    expect(findFieldProblems(pkg, () => true).map((p) => p.code)).toEqual(['client-platform'])
  })

  it('有 lib/client.js 却既无 exports["./client"] 也无 dsh.client → 报错', () => {
    const pkg = { name: 'dsh-demo', main: 'lib/index.js', exports: { '.': { default: './lib/index.js' } } }
    expect(findFieldProblems(pkg, (rel) => rel === 'lib/client.js').map((p) => p.code)).toEqual([
      'client-bundle-undeclared',
    ])
  })

  it('有 cordis.patch.yml 却未声明 dsh.bundle.patch → 报错；preset 资产包豁免', () => {
    const pkg = { name: 'dsh-demo', main: 'lib/index.js' }
    expect(findFieldProblems(pkg, (rel) => rel === 'cordis.patch.yml').map((p) => p.code)).toEqual(['patch-undeclared'])
    const preset = { name: 'dsh-preset', dsh: { kind: 'preset' } }
    expect(findFieldProblems(preset, (rel) => rel === 'cordis.patch.yml')).toEqual([])
  })

  it('形态正确 → 0 问题（正例）', () => {
    expect(findFieldProblems(goodPkg(), () => true)).toEqual([])
  })
})

describe('findPackProblems：反例 ② pack 含测试目录 / 缺必需项', () => {
  it('pack 里出现 test/ → 报错（含为什么与修法）', () => {
    const problems = findPackProblems({
      pkg: goodPkg(),
      packedPaths: ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'lib/index.js', 'test/demo.test.mjs'],
      exists: () => true,
    })
    const packed = problems.find((p) => p.code === 'packed-test')
    expect(packed).toBeDefined()
    expect(packed.where).toContain('test/demo.test.mjs')
    expect(packed.fix).toContain('files')
  })

  it('src / coverage / reports / node_modules / .DS_Store / *.log 全部命中红线', () => {
    const problems = findPackProblems({
      pkg: goodPkg(),
      packedPaths: [
        ...goodPacked(),
        'src/a.ts',
        'coverage/lcov.info',
        'reports/x.html',
        'node_modules/dep/index.js',
        '.DS_Store',
        'debug.log',
      ],
      exists: () => true,
    })
    expect(problems.map((p) => p.code).sort()).toEqual([
      'packed-coverage',
      'packed-ds-store',
      'packed-log',
      'packed-node-modules',
      'packed-reports',
      'packed-src',
    ])
  })

  it('README/CHANGELOG 不在包里 → 报错（同 code 合并成一条，列出全部命中处）', () => {
    const pkg = goodPkg()
    const problems = findPackProblems({
      pkg,
      packedPaths: ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'],
      exists: (rel) => rel === 'README.md' || rel === 'CHANGELOG.md',
    })
    const missing = problems.filter((p) => p.code === 'pack-missing-required')
    expect(missing).toHaveLength(1)
    expect(missing[0].where).toContain('2 处')
    expect(missing[0].where).toContain('README.md')
    expect(missing[0].where).toContain('CHANGELOG.md')
    // LICENSE 仓库里没有 → 不该报
    expect(problems.some((p) => p.where.includes('LICENSE'))).toBe(false)
  })

  it('exports 指向的文件不在包里（files 白名单漏了）→ 报错', () => {
    const problems = findPackProblems({
      pkg: goodPkg(),
      packedPaths: ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'lib/index.js'],
      exists: () => true,
    })
    expect(problems.map((p) => p.code)).toEqual(['pack-missing-target'])
    expect(problems[0].where).toContain('exports../client.default')
  })

  it('干净的包 → 0 问题（正例）', () => {
    expect(
      findPackProblems({
        pkg: goodPkg(),
        packedPaths: [
          'package.json',
          'README.md',
          'CHANGELOG.md',
          'LICENSE',
          'lib/index.js',
          'lib/client.js',
          'cordis.patch.yml',
        ],
        exists: () => true,
      }),
    ).toEqual([])
  })
})

describe('README 发布面引用：相对路径 + unpkg（3b 门禁的盲区）', () => {
  it('extractReadmeRefs 认 markdown/HTML 相对路径与 unpkg，且只认本包', () => {
    const readme = [
      '![a](./assets/a.png)',
      '<img src="assets/b.png" />',
      '![c](https://unpkg.com/dsh-demo/assets/c.png)',
      '![other](https://unpkg.com/dsh-other/assets/d.png)',
      '![doc](./docs/guide.md)',
    ].join('\n')
    expect(extractReadmeRefs(readme, 'dsh-demo').map((r) => r.relPath)).toEqual([
      'assets/a.png',
      'assets/b.png',
      'assets/c.png',
    ])
  })

  it('引用的资产存在但不随包发布 → 报错（本次抓出的真实问题形态）', () => {
    const refs = extractReadmeRefs('![a](./assets/a.png)', 'dsh-demo')
    const problems = findReadmeRefProblems(refs, { exists: () => true, isPacked: () => false })
    expect(problems.map((p) => p.code)).toEqual(['readme-ref-unpacked'])
    expect(problems[0].fix).toContain('"assets"')
  })

  it('unpkg 引用（本包）未发布时理由指向 404，相对路径指向 npm 页面裂图', () => {
    const unpacked = findReadmeRefProblems(
      [{ kind: 'unpkg', relPath: 'assets/x.png', raw: 'https://unpkg.com/dsh-demo/assets/x.png' }],
      { exists: () => true, isPacked: () => false },
    )
    expect(unpacked[0].why).toContain('unpkg')
    const relative = findReadmeRefProblems([{ kind: 'relative', relPath: 'assets/x.png', raw: 'assets/x.png' }], {
      exists: () => true,
      isPacked: () => false,
    })
    expect(relative[0].why).toContain('npm 页面')
  })

  it('引用的资产仓库里就不存在 → 报错；已随包发布 → 通过', () => {
    const refs = extractReadmeRefs('![a](./assets/a.png)', 'dsh-demo')
    expect(findReadmeRefProblems(refs, { exists: () => false, isPacked: () => false }).map((p) => p.code)).toEqual([
      'readme-ref-missing',
    ])
    expect(findReadmeRefProblems(refs, { exists: () => true, isPacked: () => true })).toEqual([])
  })
})

describe('「源在仓库但故意不发布」的表达（不许一刀切）', () => {
  it('vendor/ client-parts/ src/ test/ 未发布 → 不报警，只作 info 列出', () => {
    const result = auditPlugin({
      pkg: goodPkg(),
      readme: '# demo\n',
      packedPaths: goodPacked(),
      repoEntries: [
        { name: 'lib', isDirectory: true },
        { name: 'vendor', isDirectory: true },
        { name: 'src', isDirectory: true },
        { name: 'test', isDirectory: true },
        { name: 'client-parts', isDirectory: true },
        { name: 'tsconfig.json', isDirectory: false },
      ],
      exists: () => true,
    })
    expect(result.problems).toEqual([])
    expect(result.unpacked.map((u) => u.name)).toEqual(['client-parts', 'src', 'test', 'tsconfig.json', 'vendor'])
    expect(result.unpacked.every((u) => u.unexpected === false)).toBe(true)
  })

  it('未发布的目录若被 README 引用 → 报警（"故意不发"与"漏发"的判据分界）', () => {
    const result = auditPlugin({
      pkg: goodPkg(),
      readme: '# demo\n![a](./assets/a.png)\n',
      packedPaths: goodPacked(),
      repoEntries: [{ name: 'assets', isDirectory: true }],
      exists: () => true,
    })
    expect(result.problems.map((p) => p.code)).toEqual(['readme-ref-unpacked'])
    expect(result.unpacked.map((u) => u.name)).toEqual(['assets'])
  })

  it('新出现的未发布目录标记 unexpected=true（提示确认，仍不报警）', () => {
    const entries = [
      { name: 'vendor', isDirectory: true },
      { name: 'weird-new-dir', isDirectory: true },
      { name: 'tsconfig.json', isDirectory: false },
    ]
    expect(describeUnpackedEntries(entries, ['package.json'])).toEqual([
      { name: 'tsconfig.json', unexpected: false },
      { name: 'vendor', unexpected: false },
      { name: 'weird-new-dir', unexpected: true },
    ])
  })
})

describe('parsePackJson：fail-closed', () => {
  it('解析 npm pack --json 的数组形态与对象形态', () => {
    const paths = [{ path: 'lib/index.js' }, { path: 'README.md' }]
    expect(parsePackJson(JSON.stringify([{ files: paths, entryCount: 2, unpackedSize: 10 }])).paths).toEqual([
      'lib/index.js',
      'README.md',
    ])
    expect(parsePackJson(JSON.stringify({ files: ['a.js'] })).paths).toEqual(['a.js'])
  })

  it('非 JSON / 缺 files / 非法条目 → 抛错（绝不静默返回空包）', () => {
    expect(() => parsePackJson('npm error boom')).toThrow(/不是合法 JSON/)
    expect(() => parsePackJson('{"name":"x"}')).toThrow(/缺少 files 数组/)
    expect(() => parsePackJson('{"files":[{"nopath":1}]}')).toThrow(/非法条目/)
    expect(() => parsePackJson('{"files":[""]}')).toThrow(/非法条目/)
  })
})

describe('CLI 端到端（真实 npm pack）', () => {
  it('形态正确的插件 → exit 0', () => {
    const root = makeTempRoot('pack-cli-ok-')
    makePlugin(root, 'dsh-demo', { pkg: goodPkg(), files: goodFiles(), readme: '# demo\n' })
    const cli = runCli(['--root', root])
    expect(cli.status).toBe(0)
    expect(cli.stdout).toContain('✅ 通过')
    expect(cli.stdout).toContain('实测耗时')
  }, 30_000)

  it('files 白名单放进 test/ → exit 1，并指出 test 文件（反例 ② 端到端）', () => {
    const root = makeTempRoot('pack-cli-test-')
    const pkg = goodPkg({ files: ['lib', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE', 'test'] })
    makePlugin(root, 'dsh-demo', {
      pkg,
      files: { ...goodFiles(), 'test/demo.test.mjs': 'x\n' },
      readme: '# demo\n',
    })
    const cli = runCli(['--root', root])
    expect(cli.status).toBe(1)
    expect(cli.stdout).toContain('packed-test')
    expect(cli.stdout).toContain('test/demo.test.mjs')
    expect(cli.stdout).toContain('修法')
  }, 30_000)

  it('exports 指向不存在文件 → exit 1（反例 ① 端到端）', () => {
    const root = makeTempRoot('pack-cli-exports-')
    const files = goodFiles()
    delete files['lib/client.js']
    makePlugin(root, 'dsh-demo', { pkg: goodPkg(), files, readme: '# demo\n' })
    const cli = runCli(['--root', root])
    expect(cli.status).toBe(1)
    expect(cli.stdout).toContain('target-missing')
    expect(cli.stdout).toContain('lib/client.js')
  }, 30_000)

  it('显式指定的插件不存在 → exit 1（找不到插件即失败，绝不静默变绿）', () => {
    const root = makeTempRoot('pack-cli-missing-')
    makePlugin(root, 'dsh-demo', { pkg: goodPkg(), files: goodFiles(), readme: '# demo\n' })
    const cli = runCli(['--root', root, '--plugin', 'dsh-nope'])
    expect(cli.status).toBe(1)
    expect(cli.stderr).toContain('找不到插件')
  }, 30_000)

  it('--json 输出机器可读结果；--list 只列内容不判定', () => {
    const root = makeTempRoot('pack-cli-json-')
    makePlugin(root, 'dsh-demo', { pkg: goodPkg(), files: goodFiles(), readme: '# demo\n' })
    const asJson = runCli(['--root', root, '--json'])
    expect(asJson.status).toBe(0)
    const parsed = JSON.parse(asJson.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.scanned).toBe(1)
    expect(parsed.results[0].packedPaths).toContain('lib/client.js')

    const list = runCli(['--root', root, '--list'])
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('lib/index.js')
  }, 40_000)

  it('用法错误（--plugin 缺取值）→ exit 2', () => {
    const cli = runCli(['--plugin'])
    expect(cli.status).toBe(2)
    expect(cli.stderr).toContain('用法')
  })
})

describe('真实仓库回归（全仓库 0 问题）', () => {
  it('全仓库通过，且报出实测耗时', () => {
    const cli = runCli(['--root', repoRoot])
    expect(cli.status).toBe(0)
    // 不硬编码插件数（插件增删会让数字漂移假红）：只校验「扫描数 = 通过数」即 0 问题
    const summary = /✅ 通过：(\d+)\/(\d+)/.exec(cli.stdout)
    expect(summary?.[1]).toBeDefined()
    expect(summary?.[1]).toBe(summary?.[2])
    expect(cli.stdout).toMatch(/实测耗时：pack 合计 \d+ms/)
  }, 60_000)
})
