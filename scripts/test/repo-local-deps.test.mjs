// plugin-upgrade skill 的 scripts/lib/repo-local-deps.mjs + verify-runtime.mjs 的
// directory route 归因测试。
//
// 这是**兼容性结论可信度判据**：verify-runtime 的 directory route 把插件目录 cpSync 到
// 孤立临时位置，而本仓库插件的依赖 `dsh-shared` 是仓库内 link 形态（根 node_modules/
// dsh-shared → ../plugins/dsh-shared）。副本向上找不到 node_modules，于是
// `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-shared'` —— 这是**工具自身的环境构造
// 缺陷**，若被归因成 plugin-code / 依赖问题，就会把"工具局限"误报成"插件在新宿主下
// 激活失败"，直接误导迁移结论。
//
// 下面每个用例都钉住一条：副本必须能解析仓库内依赖；解析不成功时也必须判为
// 「环境不适用」，绝不归因 plugin-code。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// 权威来源（本仓库内 skill 资产）
import {
  REPO_LOCAL_NOTE,
  prepareDirectoryCopy,
  repoLocalDependencyNames,
} from '../../skills/plugin-upgrade/scripts/lib/repo-local-deps.mjs'
import { diagnoseBootLog } from '../../skills/plugin-upgrade/scripts/verify-runtime.mjs'

/** 实测得到的真实失败日志（裸 cpSync 后 `node -e "import('.../plugin-src/lib/index.js')"`）。 */
const REAL_LOG = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dsh-shared' imported from /tmp/dsh-verify-x/plugin-src/lib/index.js
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:766:56)
    code: 'ERR_MODULE_NOT_FOUND'
Node.js v26.7.0`

const roots = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 造一个仿本仓库结构的 git 仓库：link 形态 dsh-shared + 注册表形态 lodash + 消费者插件。 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'repo-local-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fake-repo', private: true }))
  mkdirSync(join(root, 'plugins', 'dsh-shared'), { recursive: true })
  writeFileSync(
    join(root, 'plugins', 'dsh-shared', 'package.json'),
    JSON.stringify({ name: 'dsh-shared', version: '0.1.4', main: 'index.js' }),
  )
  writeFileSync(join(root, 'plugins', 'dsh-shared', 'index.js'), 'export const v = 1\n')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  // 仓库内 link 形态（npm link / 手工链）：物理源码在仓库内、node_modules 之外。
  symlinkSync(join('..', 'plugins', 'dsh-shared'), join(root, 'node_modules', 'dsh-shared'), 'dir')
  // 注册表形态依赖（实体目录）：绝不能被当成仓库内依赖去建链。
  mkdirSync(join(root, 'node_modules', 'lodash'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', 'lodash', 'package.json'),
    JSON.stringify({ name: 'lodash', version: '4.0.0' }),
  )
  const consumer = join(root, 'plugins', 'consumer')
  mkdirSync(join(consumer, 'lib'), { recursive: true })
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', dependencies: { 'dsh-shared': '^0.1.4', lodash: '^4.0.0' } }),
  )
  writeFileSync(join(consumer, 'lib', 'index.js'), "import 'dsh-shared'\n")
  execFileSync('git', ['-C', root, 'init', '-q'])
  return { root, consumer }
}

/** 从某个插件位置解析一个裸依赖；解析不到返回 null。 */
function resolveFrom(pluginDir, name) {
  try {
    return createRequire(join(pluginDir, 'package.json')).resolve(name)
  } catch {
    return null
  }
}

describe('repoLocalDependencyNames', () => {
  it('只认「解析到仓库内、且不在任何 node_modules 内」的 link 形态依赖', () => {
    const { root, consumer } = makeRepo()
    expect(repoLocalDependencyNames(consumer, { repoRoot: root })).toEqual(['dsh-shared'])
  })

  it('没有 git 仓库上下文时不误报（返回空，退化为旧行为而不是乱建链）', () => {
    const { consumer } = makeRepo()
    expect(repoLocalDependencyNames(consumer, { repoRoot: null })).toEqual([])
  })

  it('接受相对路径（CLI 传 "plugins/x" 这类 spec 时必须可用）', () => {
    const { root, consumer } = makeRepo()
    const relPath = relative(process.cwd(), consumer)
    expect(repoLocalDependencyNames(relPath, { repoRoot: root })).toEqual(['dsh-shared'])
  })
})

describe('prepareDirectoryCopy（directory route 的隔离副本）', () => {
  it('副本内必须能解析仓库内 link 依赖：不能裸 cpSync 到孤立目录', () => {
    const { root, consumer } = makeRepo()
    const copy = join(root, '..', `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    roots.push(copy)
    const prep = prepareDirectoryCopy(consumer, copy, { repoRoot: root })
    expect(prep.repoLocalDeps).toEqual(['dsh-shared'])
    // 修复前：副本里找不到 node_modules -> 解析抛 ERR_MODULE_NOT_FOUND -> null
    expect(resolveFrom(copy, 'dsh-shared')).not.toBeNull()
    expect(resolveFrom(copy, 'lodash')).toBeNull() // 注册表依赖不进链（由 profile 安装负责）
  })
})

describe('diagnoseBootLog 对仓库内依赖解析失败的归因', () => {
  it('绝不归因 plugin-code：判为环境构造问题（环境不适用）', () => {
    const d = diagnoseBootLog(REAL_LOG, { repoLocalDependencyNames: ['dsh-shared'] })
    expect(d.verdict).toBe('env-repo-local-dependency')
    expect(d.attribution).toBe('environment-construction')
    expect(d.attribution).not.toBe('plugin-code')
    expect(REPO_LOCAL_NOTE).toContain('源码位于仓库内')
  })

  it('不误伤：注册表依赖解析失败仍走既有的 dependency-resolution 归因', () => {
    const log = REAL_LOG.replaceAll('dsh-shared', 'lodash')
    const d = diagnoseBootLog(log, { repoLocalDependencyNames: ['dsh-shared'] })
    expect(d.verdict).toBe('load-crash-module-resolve')
    expect(d.attribution).toBe('dependency-resolution')
  })

  it('不传上下文时行为完全不变（向后兼容既有调用方）', () => {
    const d = diagnoseBootLog(REAL_LOG)
    expect(d.verdict).toBe('load-crash-module-resolve')
  })
})
