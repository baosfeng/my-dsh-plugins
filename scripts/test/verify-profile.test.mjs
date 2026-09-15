/**
 * verify-profile.test.mjs — 隔离 profile 插件软链解析与工作区预置（issue #220 防回归）。
 *
 * 复现的假验证场景：--addons 指定的插件在生产 profile 里已 link: 安装（node_modules
 * 同名软链指向**主工作区**），旧实现遇到「条目已存在」直接复用该软链 → 隔离实例
 * 加载主工作区旧版插件，而不是待验的 fork 代码（假通过 / 假失败）。
 *
 * 覆盖：readAddon / planNodeModulesLinks / linkNodeModules / checkAddonResolution
 * （含"软链指向错误路径"输入的检出与修正）/ workspace 存储预置与 Zod 约束校验，
 * 外加脚本接线防漂移（lib 改了必须真的被 verify-real-profile.mjs 调用）。
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirSync } from 'tmp'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_STATE_DIRS,
  readAddon,
  readAddonExternals,
  planNodeModulesLinks,
  linkNodeModules,
  checkAddonResolution,
  checkOmittedAbsent,
  stripProfileDeclarations,
  realpathOrNull,
  isIsoTimestamp,
  extractApiToken,
  isPluginStatePath,
  presentStateDirs,
  buildWorkspaceStorage,
  validateWorkspaceStorage,
  writeWorkspaceStorage,
  WORKSPACE_UNIT,
} from '../lib/verify-profile.mjs'

const repoRoot = join(fileURLToPath(new URL('../../', import.meta.url)))

const roots = []
/** 建一个临时工作区目录（自动清理）。 */
function tempDir(prefix = 'vprofile-') {
  const { name: dir } = dirSync({ unsafeCleanup: true, prefix })
  roots.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

/** 造一个插件目录（package.json name）。 */
function makeAddon(parent, name, dirName = name) {
  const dir = join(parent, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  return dir
}

// ── readAddon ─────────────────────────────────────────────────────────────
describe('readAddon', () => {
  it('读取 package.json 的 name 作为 node_modules 条目名', () => {
    const base = tempDir()
    const dir = makeAddon(base, 'dsh-demo')
    expect(readAddon(dir)).toEqual({ dir: realpathSync(dir), name: 'dsh-demo' })
  })

  it('无 package.json → null（供脚本报「不是插件目录」）', () => {
    const base = tempDir()
    expect(readAddon(base)).toBeNull()
  })

  it('package.json 无 name → 回落目录名', () => {
    const base = tempDir()
    const dir = join(base, 'fallback-name')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    expect(readAddon(dir).name).toBe('fallback-name')
  })
})

// ── planNodeModulesLinks（issue #220 核心规则） ────────────────────────────
describe('planNodeModulesLinks', () => {
  it('addon 与真实 profile 条目同名 → 不复用，改为指向 addon（显式优先）', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['react', 'dsh-demo', 'lodash'],
      addons: [{ dir: '/fork/plugins/dsh-demo', name: 'dsh-demo' }],
    })
    expect(plan.reuse).toEqual(['react', 'lodash'])
    expect(plan.overridden).toEqual(['dsh-demo'])
    expect(plan.addonLinks).toEqual([{ entry: 'dsh-demo', dir: '/fork/plugins/dsh-demo' }])
  })

  it('未指定 addons → 全部复用真实 profile（既有行为不回归）', () => {
    const plan = planNodeModulesLinks({ realEntries: ['react', 'dsh-demo'], addons: [] })
    expect(plan.reuse).toEqual(['react', 'dsh-demo'])
    expect(plan.overridden).toEqual([])
    expect(plan.addonLinks).toEqual([])
  })

  it('addon 未在真实 profile 安装 → 追加链接，其余照旧复用', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['react'],
      addons: [{ dir: '/fork/plugins/dsh-new', name: 'dsh-new' }],
    })
    expect(plan.reuse).toEqual(['react'])
    expect(plan.overridden).toEqual([])
    expect(plan.addonLinks).toEqual([{ entry: 'dsh-new', dir: '/fork/plugins/dsh-new' }])
  })

  it('scoped addon → scope 目录展开（避免写入真实 profile 的 scope 软链）', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['@scope', 'react'],
      addons: [{ dir: '/fork/plugins/pkg', name: '@scope/pkg' }],
    })
    expect(plan.reuse).toEqual(['react'])
    expect(plan.expand).toEqual(['@scope'])
  })

  it('无关 scope 不受影响（仍整体复用）', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['@other', 'react'],
      addons: [{ dir: '/fork/plugins/pkg', name: '@scope/pkg' }],
    })
    expect(plan.reuse).toEqual(['@other', 'react'])
    expect(plan.expand).toEqual([])
  })

  // ── issue #294：omit = external 缺包演练 ────────────────────────────────
  it('omit 的条目既不复用真实 profile，也不链接（缺包演练的核心）', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['react', 'dsh-md-render', 'lodash'],
      addons: [],
      omit: ['dsh-md-render'],
    })
    expect(plan.reuse).toEqual(['react', 'lodash'])
    expect(plan.omitted).toEqual(['dsh-md-render'])
    expect(plan.omittedAddons).toEqual([])
  })

  it('不传 omit → 与旧版逐条一致（行为不回归）', () => {
    const plan = planNodeModulesLinks({ realEntries: ['react', 'dsh-md-render'], addons: [] })
    expect(plan.reuse).toEqual(['react', 'dsh-md-render'])
    expect(plan.omitted).toEqual([])
  })

  it('omit 与 addon 同名 → omit 优先并记入 omittedAddons（不静默）', () => {
    const plan = planNodeModulesLinks({
      realEntries: ['dsh-md-render'],
      addons: [{ dir: '/fork/plugins/dsh-md-render', name: 'dsh-md-render' }],
      omit: ['dsh-md-render'],
    })
    expect(plan.addonLinks).toEqual([])
    expect(plan.omitted).toEqual(['dsh-md-render'])
    expect(plan.omittedAddons).toEqual(['dsh-md-render'])
  })

  it('omit 未在真实 profile 安装的包 → 不报错（新装用户本来就没有）', () => {
    const plan = planNodeModulesLinks({ realEntries: ['react'], addons: [], omit: ['dsh-md-render'] })
    expect(plan.reuse).toEqual(['react'])
    expect(plan.omitted).toEqual([])
  })
})

// ── linkNodeModules（真实 fs） ────────────────────────────────────────────
describe('linkNodeModules', () => {
  it('核心防回归：真实 profile 已有同名软链（指向主工作区）→ 重写为指向 addon', () => {
    const base = tempDir()
    const mainWorkspace = makeAddon(base, 'dsh-demo', 'main-workspace/dsh-demo')
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const realNode = join(base, 'real-node-modules')
    mkdirSync(realNode, { recursive: true })
    symlinkSync(mainWorkspace, join(realNode, 'dsh-demo')) // 生产 profile 的 link: 安装
    const simNode = join(base, 'sim-node-modules')

    const result = linkNodeModules({
      simNode,
      realNode,
      addons: [{ dir: forkAddon, name: 'dsh-demo' }],
    })

    expect(realpathSync(join(simNode, 'dsh-demo'))).toBe(realpathSync(forkAddon))
    expect(realpathSync(join(simNode, 'dsh-demo'))).not.toBe(realpathSync(mainWorkspace))
    expect(result.overridden).toEqual([{ entry: 'dsh-demo', was: mainWorkspace }])
    // 真实 profile 的软链绝不能被改写（只动模拟目录）
    expect(realpathSync(join(realNode, 'dsh-demo'))).toBe(realpathSync(mainWorkspace))
  })

  it('检出并修正「已存在但指向错误路径」的软链（残留/手工目录）', () => {
    const base = tempDir()
    const wrong = makeAddon(base, 'dsh-demo', 'wrong/dsh-demo')
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const realNode = join(base, 'real-node-modules')
    mkdirSync(realNode, { recursive: true })
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })
    symlinkSync(wrong, join(simNode, 'dsh-demo')) // 错误的既有软链

    const result = linkNodeModules({ simNode, realNode, addons: [{ dir: forkAddon, name: 'dsh-demo' }] })

    expect(realpathSync(join(simNode, 'dsh-demo'))).toBe(realpathSync(forkAddon))
    expect(result.replaced).toEqual([{ entry: 'dsh-demo', was: wrong }])
  })

  it('悬空软链（existsSync=false）也能被替换', () => {
    const base = tempDir()
    const ghost = join(base, 'ghost-target')
    const realNode = join(base, 'real-node-modules')
    mkdirSync(realNode, { recursive: true })
    symlinkSync(ghost, join(realNode, 'dsh-demo')) // 指向不存在路径
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const simNode = join(base, 'sim-node-modules')

    linkNodeModules({ simNode, realNode, addons: [{ dir: forkAddon, name: 'dsh-demo' }] })
    expect(realpathSync(join(simNode, 'dsh-demo'))).toBe(realpathSync(forkAddon))
  })

  it('未指定 addons → 模拟目录条目全部指向真实 profile（行为不变）', () => {
    const base = tempDir()
    const realNode = join(base, 'real-node-modules')
    const reactDir = join(realNode, 'react')
    mkdirSync(reactDir, { recursive: true })
    writeFileSync(join(reactDir, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0' }))
    const simNode = join(base, 'sim-node-modules')

    const result = linkNodeModules({ simNode, realNode, addons: [] })
    expect(readlinkSync(join(simNode, 'react'))).toBe(join(realNode, 'react'))
    expect(result.linked).toEqual([])
  })

  it('scoped addon → 真实 scope 目录展开为逐条软链，且不写入真实 profile', () => {
    const base = tempDir()
    const realNode = join(base, 'real-node-modules')
    mkdirSync(join(realNode, '@scope'), { recursive: true })
    const other = makeAddon(join(realNode, '@scope'), '@scope/other', 'other')
    const forkAddon = makeAddon(base, '@scope/pkg', 'fork/pkg')
    const simNode = join(base, 'sim-node-modules')

    linkNodeModules({ simNode, realNode, addons: [{ dir: forkAddon, name: '@scope/pkg' }] })

    expect(realpathSync(join(simNode, '@scope/pkg'))).toBe(realpathSync(forkAddon))
    expect(realpathSync(join(simNode, '@scope/other'))).toBe(realpathSync(other))
    // 模拟目录里的 @scope 是真目录（不是指向真实 profile 的软链）
    expect(lstatSync(join(simNode, '@scope')).isSymbolicLink()).toBe(false)
  })
})

// ── issue #294：external 缺包演练（omit / 推导 / fail-closed 校验）──────────
describe('issue #294 external 缺包演练', () => {
  it('linkNodeModules 应用 omit：真实 profile 里已装的包不进入隔离实例', () => {
    const base = tempDir()
    const realNode = join(base, 'real-node-modules')
    const mdDir = join(realNode, 'dsh-md-render')
    mkdirSync(mdDir, { recursive: true })
    writeFileSync(join(mdDir, 'package.json'), JSON.stringify({ name: 'dsh-md-render', version: '0.1.8' }))
    const reactDir = join(realNode, 'react')
    mkdirSync(reactDir, { recursive: true })
    writeFileSync(join(reactDir, 'package.json'), JSON.stringify({ name: 'react', version: '19.0.0' }))
    const simNode = join(base, 'sim-node-modules')

    const result = linkNodeModules({ simNode, realNode, addons: [], omit: ['dsh-md-render'] })

    expect(result.omitted).toEqual(['dsh-md-render'])
    expect(lstatSync(join(simNode, 'dsh-md-render'), { throwIfNoEntry: false })).toBeUndefined()
    // 其余条目照旧复用（pnpm 依赖解析不受影响）
    expect(readlinkSync(join(simNode, 'react'))).toBe(join(realNode, 'react'))
    // 真实 profile 不被改写（仍是真实目录，不是被删/被改写的软链）
    expect(lstatSync(mdDir).isDirectory()).toBe(true)
  })

  it('scoped 包走 scope 展开分支时，omit 的子条目同样被跳过', () => {
    const base = tempDir()
    const realNode = join(base, 'real-node-modules')
    mkdirSync(join(realNode, '@deepseek-ai'), { recursive: true })
    for (const name of ['dsh-client-runtime', 'dsh-web-app']) {
      const dir = join(realNode, '@deepseek-ai', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '1.0.0' }))
    }
    const simNode = join(base, 'sim-node-modules')
    const forkAddon = makeAddon(base, '@scope/pkg', 'fork/pkg')

    const result = linkNodeModules({
      simNode,
      realNode,
      addons: [{ dir: forkAddon, name: '@scope/pkg' }],
      omit: ['@deepseek-ai/dsh-client-runtime'],
    })

    expect(result.omitted).toContain('@deepseek-ai/dsh-client-runtime')
    expect(lstatSync(join(simNode, '@deepseek-ai', 'dsh-client-runtime'), { throwIfNoEntry: false })).toBeUndefined()
    expect(realpathSync(join(simNode, '@deepseek-ai', 'dsh-web-app'))).toBe(
      realpathSync(join(realNode, '@deepseek-ai', 'dsh-web-app')),
    )
  })

  it('checkOmittedAbsent：条目确实缺席 → ok；被复用进来 → ok=false 并列出 leaked', () => {
    const base = tempDir()
    const realNode = join(base, 'real-node-modules')
    mkdirSync(join(realNode, 'dsh-md-render'), { recursive: true })
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })

    expect(checkOmittedAbsent({ simNode, omitted: ['dsh-md-render'] }).ok).toBe(true)

    // 接线写错（漏传 omit）→ 该条目被复用进 simNode：必须被抓住，不允许假通过
    symlinkSync(join(realNode, 'dsh-md-render'), join(simNode, 'dsh-md-render'))
    const leaked = checkOmittedAbsent({ simNode, omitted: ['dsh-md-render'] })
    expect(leaked.ok).toBe(false)
    expect(leaked.leaked.map((item) => item.entry)).toEqual(['dsh-md-render'])
  })

  it('stripProfileDeclarations：剔除 dependencies + bundles，且不修改原对象', () => {
    const profilePkg = {
      name: 'web',
      dependencies: { 'dsh-md-render': 'link:/x/dsh-md-render', 'dsh-better-sidebar': '^0.18.1' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-md-render', 'dsh-my-remote'] } },
    }
    const { pkg, removed } = stripProfileDeclarations(profilePkg, ['dsh-md-render'])

    expect(removed.sort()).toEqual(['dependencies.dsh-md-render', 'dsh.profile.bundles.dsh-md-render'].sort())
    expect(pkg.dependencies).toEqual({ 'dsh-better-sidebar': '^0.18.1' })
    expect(pkg.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-my-remote'])
    // 原对象不被修改（纯函数；调用方可能还要用它做别的判定）
    expect(profilePkg.dependencies['dsh-md-render']).toBe('link:/x/dsh-md-render')
    expect(profilePkg.dsh.profile.bundles).toContain('dsh-md-render')
  })

  it('stripProfileDeclarations：包未在 profile 声明 → removed 为空（不报错）', () => {
    const { pkg, removed } = stripProfileDeclarations({ dependencies: {}, dsh: { profile: { bundles: [] } } }, [
      'dsh-x',
    ])
    expect(removed).toEqual([])
    expect(pkg.dependencies).toEqual({})
  })

  it('readAddonExternals：读 dsh.client.external（去重 + 非法项安全降级）', () => {
    const base = tempDir()
    const withExternal = makeAddon(base, 'dsh-consumer', 'consumer')
    writeFileSync(
      join(withExternal, 'package.json'),
      JSON.stringify({
        name: 'dsh-consumer',
        version: '1.0.0',
        dsh: { client: { platform: 'web', external: ['dsh-md-render', 'dsh-md-render', 42, ''] } },
      }),
    )
    expect(readAddonExternals(withExternal)).toEqual(['dsh-md-render'])

    const withoutExternal = makeAddon(base, 'dsh-plain', 'plain')
    expect(readAddonExternals(withoutExternal)).toEqual([])
    expect(readAddonExternals(join(base, 'not-exist'))).toEqual([])
  })
})

// ── checkAddonResolution（fail-closed 可见性检查） ─────────────────────────
describe('checkAddonResolution', () => {
  it('解析路径指向主工作区（错误路径）→ ok=false 且列出 mismatch', () => {
    const base = tempDir()
    const mainWorkspace = makeAddon(base, 'dsh-demo', 'main/dsh-demo')
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })
    symlinkSync(mainWorkspace, join(simNode, 'dsh-demo'))

    const result = checkAddonResolution({ simNode, addons: [{ dir: forkAddon, name: 'dsh-demo' }] })
    expect(result.ok).toBe(false)
    expect(result.mismatches).toHaveLength(1)
    expect(result.entries[0].actual).toBe(realpathSync(mainWorkspace))
    expect(result.entries[0].expected).toBe(realpathSync(forkAddon))
  })

  it('解析路径等于 addon → ok=true', () => {
    const base = tempDir()
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })
    symlinkSync(forkAddon, join(simNode, 'dsh-demo'))
    expect(checkAddonResolution({ simNode, addons: [{ dir: forkAddon, name: 'dsh-demo' }] }).ok).toBe(true)
  })

  it('addon 路径经软链别名（/tmp → /private/tmp 场景）时不误报', () => {
    const base = tempDir()
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const alias = join(base, 'tmp-alias')
    symlinkSync(base, alias, 'dir')
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })
    symlinkSync(join(alias, 'fork/dsh-demo'), join(simNode, 'dsh-demo'))

    const result = checkAddonResolution({ simNode, addons: [{ dir: join(alias, 'fork/dsh-demo'), name: 'dsh-demo' }] })
    expect(result.ok).toBe(true)
  })

  it('悬空软链 → actual=null，ok=false（不静默放过）', () => {
    const base = tempDir()
    const forkAddon = makeAddon(base, 'dsh-demo', 'fork/dsh-demo')
    const simNode = join(base, 'sim-node-modules')
    mkdirSync(simNode, { recursive: true })
    symlinkSync(join(base, 'missing'), join(simNode, 'dsh-demo'))

    const result = checkAddonResolution({ simNode, addons: [{ dir: forkAddon, name: 'dsh-demo' }] })
    expect(result.entries[0].actual).toBeNull()
    expect(result.ok).toBe(false)
  })

  it('realpathOrNull 对不存在路径返回 null（不抛错）', () => {
    expect(realpathOrNull(join(dirSync({ unsafeCleanup: true }).name, 'definitely-missing-220'))).toBeNull()
  })
})

// ── workspace 落盘状态预置（隐性 Zod 约束） ────────────────────────────────
describe('workspace 存储预置', () => {
  it('buildWorkspaceStorage 生成三段式文档（unit 头 + ISO 时间戳 + 空 sessionIds）', () => {
    const doc = buildWorkspaceStorage({
      workspacePath: '/private/tmp/ws',
      title: 'ws',
      workspaceId: 'id-1',
      now: '2026-09-12T00:00:00.000Z',
    })
    expect(doc.unit).toEqual({ name: 'workspace', version: 2 })
    expect(doc.global).toEqual({ initialized: true, workspaceIds: ['id-1'], archivedSessionIds: [] })
    expect(doc.tables.workspaces['id-1']).toEqual({
      path: '/private/tmp/ws',
      title: 'ws',
      sessionIds: [],
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    })
    expect(validateWorkspaceStorage(doc)).toEqual([])
  })

  it('createdAt 写成数字（隐性 Zod 失败点）→ 报错', () => {
    const doc = buildWorkspaceStorage({ workspacePath: '/private/tmp/ws', title: 'ws', workspaceId: 'id-1' })
    doc.tables.workspaces['id-1'].createdAt = 1757289600000
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/createdAt 必须是 ISO-8601 字符串/)
  })

  it('unit 头错误（缺 version / 版本不符）→ 报错', () => {
    const doc = buildWorkspaceStorage({ workspacePath: '/private/tmp/ws', title: 'ws', workspaceId: 'id-1' })
    doc.unit = { name: 'workspace', version: 1 }
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/unit.version 必须是 2/)
    doc.unit = { name: 'other', version: 2 }
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/unit.name 必须是 'workspace'/)
    delete doc.unit
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/缺少 unit 头部/)
  })

  it('global.initialized=false → 报错（会走未初始化引导流程）', () => {
    const doc = buildWorkspaceStorage({ workspacePath: '/private/tmp/ws', title: 'ws', workspaceId: 'id-1' })
    doc.global.initialized = false
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/initialized 必须是 true/)
  })

  it('tables.workspaces 不是对象 / 记录缺字段 → 报错', () => {
    expect(validateWorkspaceStorage({ unit: WORKSPACE_UNIT, global: {}, tables: {} }).join(' ')).toMatch(
      /tables.workspaces 必须是对象/,
    )
    const doc = buildWorkspaceStorage({ workspacePath: '/private/tmp/ws', title: 'ws', workspaceId: 'id-1' })
    doc.tables.workspaces['id-1'] = { path: '', title: 1, sessionIds: 'x' }
    const errors = validateWorkspaceStorage(doc).join(' ')
    expect(errors).toMatch(/path 必须是非空字符串/)
    expect(errors).toMatch(/title 必须是字符串/)
    expect(errors).toMatch(/sessionIds 必须是数组/)
    doc.tables.workspaces['id-2'] = 'not-an-object'
    expect(validateWorkspaceStorage(doc).join(' ')).toMatch(/id-2 不是对象/)
    expect(validateWorkspaceStorage(null)).toEqual(['存储文档不是 JSON 对象'])
  })

  it('writeWorkspaceStorage：path 取 realpath（macOS /tmp 软链）+ 写入后可回读', () => {
    const base = tempDir()
    const { name: target } = dirSync({ dir: base, unsafeCleanup: true, prefix: 'ws-' })
    const alias = join(base, 'tmp-alias')
    symlinkSync(base, alias, 'dir')
    const simHome = join(base, 'sim-home')

    const result = writeWorkspaceStorage({
      simHome,
      workspacePath: join(alias, basename(target)),
      title: 'demo',
      workspaceId: 'id-1',
      now: '2026-09-12T00:00:00.000Z',
    })

    expect(result.path).toBe(realpathSync(target))
    expect(result.path).not.toContain('tmp-alias')
    const written = JSON.parse(readFileSync(result.file, 'utf8'))
    expect(written.tables.workspaces['id-1'].path).toBe(realpathSync(target))
    expect(validateWorkspaceStorage(written)).toEqual([])
  })

  it('writeWorkspaceStorage：workspace 目录不存在 → 抛错（fail-closed）', () => {
    const base = tempDir()
    expect(() =>
      writeWorkspaceStorage({ simHome: join(base, 'h'), workspacePath: join(base, 'missing'), title: 'x' }),
    ).toThrow(/--workspace 目录不存在/)
  })

  it('isIsoTimestamp：ISO 字符串 true，数字/空串/乱码 false', () => {
    expect(isIsoTimestamp('2026-09-12T00:00:00.000Z')).toBe(true)
    expect(isIsoTimestamp(1757289600000)).toBe(false)
    expect(isIsoTimestamp('')).toBe(false)
    expect(isIsoTimestamp('not-a-date')).toBe(false)
  })
})

// ── 脚本接线防漂移（lib 改了必须真的被调用） ───────────────────────────────
describe('verify-real-profile.mjs 接线', () => {
  const source = readFileSync(join(repoRoot, 'scripts', 'verify-real-profile.mjs'), 'utf8')

  it('从 scripts/lib/verify-profile.mjs 引入三个核心函数', () => {
    expect(source).toContain('lib/verify-profile.mjs')
    for (const fn of ['linkNodeModules', 'checkAddonResolution', 'writeWorkspaceStorage']) {
      expect(source).toContain(fn)
    }
  })

  it('启动实例前调用 checkAddonResolution，且 mismatch 时退出（不静默继续）', () => {
    const checkAt = source.indexOf('checkAddonResolution(')
    const spawnAt = source.indexOf("spawn(dshBin, ['--profile'")
    expect(checkAt).toBeGreaterThan(-1)
    expect(spawnAt).toBeGreaterThan(-1)
    expect(checkAt).toBeLessThan(spawnAt)
    expect(source).toContain('resolution.ok')
  })

  it('不再复用同名真实 profile 软链（旧 EEXIST 绕过的写法已移除）', () => {
    expect(source).not.toContain('if (!existsSync(target)) symlinkSync')
  })

  // issue #294：缺包演练必须真的被脚本接线（lib 改了脚本没接是最容易的假修复）
  it('--clean-externals / --omit-node-modules 接线：推导 omit 并传给 linkNodeModules', () => {
    expect(source).toContain('--clean-externals')
    expect(source).toContain('--omit-node-modules')
    expect(source).toContain('readAddonExternals')
    expect(source).toMatch(/linkNodeModules\(\{[^}]*omit: omitEntries/)
  })

  it('缺包演练 fail-closed：启动实例前校验 omit 条目确实不可解析，leak 即退出', () => {
    expect(source).toContain('checkOmittedAbsent')
    const checkAt = source.indexOf('checkOmittedAbsent({ simNode')
    const spawnAt = source.indexOf("spawn(dshBin, ['--profile'")
    expect(checkAt).toBeGreaterThan(-1)
    expect(spawnAt).toBeGreaterThan(-1)
    expect(checkAt).toBeLessThan(spawnAt)
    expect(source).toContain('缺包演练未生效（fail-closed）')
  })

  it('启动日志扫描覆盖缺包类症状（failed to import loader entry / missed the module table / Element type is invalid）', () => {
    for (const keyword of [
      'failed to import loader entry',
      'missed the module table',
      'Element type is invalid',
      'Cannot find module',
    ]) {
      expect(source).toContain(keyword)
    }
  })

  it('发版门禁 3c 默认启用 --clean-externals（release.mjs 接线，防"开关加了没人用"）', () => {
    const release = readFileSync(join(repoRoot, 'scripts', 'release.mjs'), 'utf8')
    const gateAt = release.indexOf('async function realVerifyGate')
    expect(gateAt).toBeGreaterThan(-1)
    const gateBody = release.slice(gateAt, gateAt + 2000)
    expect(gateBody).toContain("'--clean-externals'")
  })

  it('启动实例前 fail-closed 端口预检（#294 实测：残留实例 → 0.2s 假就绪）', () => {
    expect(source).toContain('isPortInUse')
    const portAt = source.indexOf('await isPortInUse(options.port)')
    const spawnAt = source.indexOf("spawn(dshBin, ['--profile'")
    expect(portAt).toBeGreaterThan(-1)
    expect(portAt).toBeLessThan(spawnAt)
    expect(source).toContain('已被占用')
  })

  it('缺包演练同时剔除隔离 profile 配置（只删 node_modules 会 boot 失败）', () => {
    expect(source).toContain('stripProfileDeclarations')
    const stripAt = source.indexOf('stripProfileDeclarations(')
    const dumpAt = source.indexOf('dump-config id 唯一性')
    expect(stripAt).toBeGreaterThan(-1)
    expect(dumpAt).toBeGreaterThan(-1)
    expect(stripAt).toBeLessThan(dumpAt) // 必须在 dump-config / 启动之前完成
  })
})

/**
 * issue #240：插件自维护的启停状态必须被剥离。
 * 不剥离 → 生产里被关掉的插件在隔离实例里同样被强制 off（client bundle 不进 manifest、
 * server API 404），看起来像"插件坏了"，实际是验证环境自己把插件关了。
 */
describe('插件自维护启停状态的剥离（issue #240）', () => {
  it('状态目录清单包含 dshmarket 的 .dsh-market', () => {
    expect(PLUGIN_STATE_DIRS).toContain('.dsh-market')
  })

  it('isPluginStatePath 只命中状态目录自身与其内容', () => {
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/.dsh-market')).toBe(true)
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/.dsh-market/state.json')).toBe(true)
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/.dsh-market/log.ndjson')).toBe(true)
    // 不能误伤：同名前缀的普通文件、其它插件目录、node_modules 照旧保留
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/.dsh-market.json')).toBe(false)
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/package.json')).toBe(false)
    expect(isPluginStatePath('/home/u/.dsh/profiles/web/node_modules')).toBe(false)
    expect(isPluginStatePath('')).toBe(false)
  })

  it('presentStateDirs 只报告真实存在的状态目录（不存在 → 不打印"已剥离"噪音）', () => {
    const profile = tempDir('vprofile-state-')
    expect(presentStateDirs(profile)).toEqual([])
    mkdirSync(join(profile, '.dsh-market'), { recursive: true })
    expect(presentStateDirs(profile)).toEqual(['.dsh-market'])
  })

  it('token 只认显式来源：启动输出的 token= 或凭据文件里的 token 字段', () => {
    expect(extractApiToken({ logText: 'dsh web: http://127.0.0.1:3098/?token=abc123DEF456ghi' })).toMatchObject({
      token: 'abc123DEF456ghi',
      source: '启动输出',
    })
    expect(
      extractApiToken({ credentialsText: 'version: 1\nrecords:\n  x:\n    token: tok_ABCDEFGHIJ\n' }),
    ).toMatchObject({
      token: 'tok_ABCDEFGHIJ',
      source: '.credentials.yaml',
    })
    expect(extractApiToken({}).token).toBeNull()
  })

  it('绝不把 credentials 里的 secret 当成 token（issue #257 实测：两者不同，冒充只会被拒）', () => {
    const credentials =
      'version: 1\nrecords:\n  client-conn/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: dmur_xq-laImABCDEFGHIJKLMNOPQRSTUVWXYZ012345678\n'
    const found = extractApiToken({ credentialsText: credentials })
    expect(found.token).toBeNull()
    expect(found.source).toBeNull()
  })

  it('脚本接线：verify-real-profile 真的用 extractApiToken（防"lib 改了脚本没接"）', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'verify-real-profile.mjs'), 'utf8')
    expect(script).toContain('extractApiToken')
    // 拿不到凭据时必须显式失败，不允许静默跳过（"绿得没有意义"比红更危险）
    expect(script).toContain('API 冒烟无法进行')
    expect(script).toContain('不能假绿')
  })

  it('脚本接线：复刻时真正调用剥离判定并打印提示（防"lib 改了脚本没接"）', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'verify-real-profile.mjs'), 'utf8')
    expect(script).toContain('isPluginStatePath')
    expect(script).toContain('presentStateDirs')
    expect(script).toContain('已剥离插件自维护的启停状态')
    // 剥离必须发生在 cpSync 的 filter 里，而不是复制完再删（后者会连带复制出噪音）
    const filterAt = script.indexOf('isPluginStatePath(src)')
    const copyAt = script.indexOf('cpSync(realProfile, simProfile')
    expect(copyAt).toBeGreaterThan(-1)
    expect(filterAt).toBeGreaterThan(copyAt)
  })
})
