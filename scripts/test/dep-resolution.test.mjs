// 依赖解析一致性门禁的自测（scripts/check-dep-resolution.mjs + scripts/lib/dep-resolution.mjs）。
//
// 为什么必须有自测：这条门禁是**治假绿**的（本地绿、CI 红），它自己要是失效，就等于
// 假绿重新开了口子，而且失效时**看起来是绿的**——没有任何人会发现。所以正反两个方向
// 都要有断言：① 存在遮蔽副本 → 判红并打印遮蔽路径/版本；② 解析到 workspace 源码 → 判绿。
//
// 反向用例覆盖三种真实形态：
//   shadowed   —— plugins/<p>/node_modules/<pkg> 是**实体副本**（本次事故形态，registry 陈旧副本）
//   shadowed   —— 副本恰好**同版本**（版本号看不出来，只有落点能判）
//   unresolved —— 声明了却解析不到（树损坏 / 依赖没装）
// 正向用例覆盖两种合法形态：
//   workspace link（根 node_modules/<pkg> -> ../plugins/<pkg>，本仓实际形态）
//   插件目录内自链（plugins/<p>/node_modules/<pkg> -> ../../<pkg>，npm workspace 的另一种布局）
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  checkDependencyResolution,
  classifyResolution,
  declaredDependencyNames,
  isInsideDir,
  isInsideNodeModules,
  readJson,
  renderViolations,
  resolveFrom,
  workspacePackages,
} from '../lib/dep-resolution.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK_SCRIPT = join(REPO_ROOT, 'scripts', 'check-dep-resolution.mjs')

const roots = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 写一个 package.json。 */
function writePkg(dir, pkg) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
}

/**
 * 造一个仿本仓结构的仓库：
 *   plugins/dsh-shared/package.json   （workspace 包 0.1.6）
 *   plugins/consumer/package.json     （声明 dsh-shared ^0.1.4）
 * 是否建立「根 node_modules 的 workspace link」由调用方决定（决定正/反向形态）。
 */
function makeRepo({ linkWorkspace = false, staleVersion = null, withPluginLocalLink = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dep-resolution-'))
  roots.push(root)
  writePkg(join(root, 'plugins', 'dsh-shared'), { name: 'dsh-shared', version: '0.1.6', main: 'index.js' })
  writeFileSync(join(root, 'plugins', 'dsh-shared', 'index.js'), 'export const v = "workspace"\n')
  writePkg(join(root, 'plugins', 'consumer'), {
    name: 'consumer',
    version: '1.0.0',
    dependencies: { 'dsh-shared': '^0.1.4', lodash: '^4.0.0' },
  })
  writeFileSync(join(root, 'plugins', 'consumer', 'index.js'), "import 'dsh-shared'\n")
  if (linkWorkspace) {
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(join('..', 'plugins', 'dsh-shared'), join(root, 'node_modules', 'dsh-shared'), 'dir')
  }
  if (withPluginLocalLink) {
    mkdirSync(join(root, 'plugins', 'consumer', 'node_modules'), { recursive: true })
    symlinkSync(join('..', '..', 'dsh-shared'), join(root, 'plugins', 'consumer', 'node_modules', 'dsh-shared'), 'dir')
  }
  if (staleVersion !== null) {
    const stale = join(root, 'plugins', 'consumer', 'node_modules', 'dsh-shared')
    writePkg(stale, { name: 'dsh-shared', version: staleVersion, main: 'index.js' })
    writeFileSync(join(stale, 'index.js'), 'export const v = "stale"\n')
  }
  return root
}

/** 跑真实 CLI，返回 { status, stdout, stderr }。 */
function runCheck(root) {
  try {
    const stdout = execFileSync(process.execPath, [CHECK_SCRIPT, '--root', root], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

describe('dep-resolution 判定内核（纯函数）', () => {
  it('readJson：缺失 / 损坏的 JSON 返回 null，不抛异常（判定要能容忍损坏的树）', () => {
    expect(readJson(join(tmpdir(), 'definitely-not-here-12345.json'))).toBeNull()
    const dir = mkdtempSync(join(tmpdir(), 'dep-resolution-bad-'))
    roots.push(dir)
    writeFileSync(join(dir, 'bad.json'), '{ not json')
    expect(readJson(join(dir, 'bad.json'))).toBeNull()
  })

  it('workspacePackages：只认带 name 的 package.json；无 plugins 目录返回空表', () => {
    const root = makeRepo()
    expect([...workspacePackages(root).keys()]).toEqual(['consumer', 'dsh-shared'])
    expect(workspacePackages(join(root, 'nope')).size).toBe(0)
    // 目录存在但没有 package.json / 没有 name → 不算 workspace 包
    mkdirSync(join(root, 'plugins', 'no-pkg'), { recursive: true })
    writePkg(join(root, 'plugins', 'nameless'), { version: '1.0.0' })
    expect([...workspacePackages(root).keys()]).toEqual(['consumer', 'dsh-shared'])
  })

  it('declaredDependencyNames：合并 dependencies / devDependencies / peerDependencies', () => {
    const root = makeRepo()
    writePkg(join(root, 'plugins', 'multi'), {
      name: 'multi',
      dependencies: { a: '1' },
      devDependencies: { b: '1' },
      peerDependencies: { c: '1' },
    })
    expect(declaredDependencyNames(join(root, 'plugins', 'multi')).sort()).toEqual(['a', 'b', 'c'])
    expect(declaredDependencyNames(join(root, 'plugins', 'dsh-shared'))).toEqual([])
    expect(declaredDependencyNames(join(root, 'plugins', 'not-there'))).toEqual([])
  })

  it('isInsideNodeModules / isInsideDir：按路径分段判，不做字符串前缀误判', () => {
    expect(isInsideNodeModules('/a/node_modules/b')).toBe(true)
    expect(isInsideNodeModules('/a/node_modulesx/b')).toBe(false)
    expect(isInsideDir('/a/b', '/a/b/c')).toBe(true)
    expect(isInsideDir('/a/b', '/a/bc')).toBe(false) // 前缀相同但不是子路径
    expect(isInsideDir('/a/b', '/a/b')).toBe(false) // 自身不算「之内」
  })

  it('resolveFrom：解析不到返回 null（不抛）', () => {
    const root = makeRepo()
    expect(resolveFrom(join(root, 'plugins', 'consumer'), 'definitely-not-installed-xyz')).toBeNull()
  })

  it('classifyResolution：workspace 源码 → ok；node_modules 实体副本 → shadowed（带版本漂移）', () => {
    const okRoot = makeRepo({ linkWorkspace: true })
    const okPkgs = workspacePackages(okRoot)
    expect(
      classifyResolution(join(okRoot, 'plugins', 'consumer'), 'dsh-shared', okPkgs.get('dsh-shared'), okRoot).status,
    ).toBe('ok')

    const badRoot = makeRepo({ staleVersion: '0.1.4' })
    const badPkgs = workspacePackages(badRoot)
    const result = classifyResolution(
      join(badRoot, 'plugins', 'consumer'),
      'dsh-shared',
      badPkgs.get('dsh-shared'),
      badRoot,
    )
    expect(result.status).toBe('shadowed')
    expect(result.version).toBe('0.1.4')
    expect(result.expected).toBe('0.1.6')
  })

  it('classifyResolution：声明了却解析不到 → unresolved', () => {
    const root = makeRepo()
    const pkgs = workspacePackages(root)
    expect(
      classifyResolution(join(root, 'plugins', 'consumer'), 'dsh-shared', pkgs.get('dsh-shared'), root).status,
    ).toBe('unresolved')
  })
})

describe('dep-resolution 全仓扫描', () => {
  it('正向：解析到 workspace 源码 → 无违规（本仓实际形态：根 node_modules link）', () => {
    const root = makeRepo({ linkWorkspace: true })
    const { checked, violations } = checkDependencyResolution(root)
    expect(violations).toEqual([])
    expect(checked).toBe(1) // consumer → dsh-shared（lodash 是第三方，不检查）
  })

  it('正向：插件目录内自链指向 workspace 源码也算一致（npm workspace 的另一种布局）', () => {
    const root = makeRepo({ withPluginLocalLink: true })
    expect(checkDependencyResolution(root).violations).toEqual([])
  })

  it('反向：node_modules 里的陈旧实体副本 → 判红并带路径与版本漂移', () => {
    const root = makeRepo({ staleVersion: '0.1.4' })
    const { violations } = checkDependencyResolution(root)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      plugin: 'consumer',
      name: 'dsh-shared',
      status: 'shadowed',
      version: '0.1.4',
    })
    const text = renderViolations(violations, root)
    expect(text).toContain('plugins/consumer/node_modules/dsh-shared') // 遮蔽路径（相对仓库根）
    expect(text).toContain('0.1.4')
    expect(text).toContain('0.1.6')
  })

  it('反向：副本与 workspace **同版本**时也判红（只有落点能判，版本号看不出来）', () => {
    const root = makeRepo({ staleVersion: '0.1.6' })
    const { violations } = checkDependencyResolution(root)
    expect(violations).toHaveLength(1)
    expect(renderViolations(violations, root)).toContain('版本相同')
  })

  it('反向：解析失败（声明了但没装）→ 判红并给出「解析失败」提示', () => {
    const root = makeRepo()
    const { violations } = checkDependencyResolution(root)
    expect(violations).toHaveLength(1)
    expect(violations[0].status).toBe('unresolved')
    expect(renderViolations(violations, root)).toContain('解析失败')
  })

  it('不误伤：包自己（dsh-shared 自身）与第三方依赖都不进检查', () => {
    const root = makeRepo({ linkWorkspace: true })
    writePkg(join(root, 'plugins', 'dsh-shared', 'node_modules', 'lodash'), { name: 'lodash', version: '4.0.0' })
    const { checked, violations } = checkDependencyResolution(root)
    expect(checked).toBe(1)
    expect(violations).toEqual([])
  })
})

describe('dep-resolution CLI（scripts/check-dep-resolution.mjs）', () => {
  it('正向：干净解析路径 → 退出码 0 且打印检查条数', () => {
    const root = makeRepo({ linkWorkspace: true })
    const { status, stdout } = runCheck(root)
    expect(status).toBe(0)
    expect(stdout).toContain('依赖解析一致性门禁通过')
  })

  it('反向：存在遮蔽副本 → 退出码 1，stderr 打印遮蔽路径与版本', () => {
    const root = makeRepo({ staleVersion: '0.1.4' })
    const { status, stderr } = runCheck(root)
    expect(status).toBe(1)
    expect(stderr).toContain('plugins/consumer/node_modules/dsh-shared')
    expect(stderr).toContain('0.1.4')
    expect(stderr).toContain('依赖解析一致性门禁失败')
  })

  it('--json：机器可读输出含 violations（退出码仍为 1，供 issue/PR 留痕）', () => {
    const root = makeRepo({ staleVersion: '0.1.4' })
    // 用 spawnSync：--json 在**判红时**也打印 JSON 且退出码 1，execFileSync 会丢 stdout。
    const r = spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root, '--json'], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.violations).toHaveLength(1)
    expect(parsed.violations[0].name).toBe('dsh-shared')
    expect(parsed.violations[0].version).toBe('0.1.4')
  })

  it('--root 缺参数 → 退出码 2（静默用错根会得出错误结论）', () => {
    try {
      execFileSync(process.execPath, [CHECK_SCRIPT, '--root'], { encoding: 'utf8' })
      throw new Error('应当以退出码 2 失败')
    } catch (error) {
      expect(error.status).toBe(2)
    }
  })

  it('对本仓库自身跑一遍 → 退出码 0（回归防线：本仓不得再有遮蔽副本）', () => {
    const { status } = runCheck(REPO_ROOT)
    expect(status).toBe(0)
  })
})
