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
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readAddon,
  planNodeModulesLinks,
  linkNodeModules,
  checkAddonResolution,
  realpathOrNull,
  isIsoTimestamp,
  buildWorkspaceStorage,
  validateWorkspaceStorage,
  writeWorkspaceStorage,
  WORKSPACE_UNIT,
} from '../lib/verify-profile.mjs'

const repoRoot = join(fileURLToPath(new URL('../../', import.meta.url)))

const roots = []
/** 建一个临时工作区目录（自动清理）。 */
function tempDir(prefix = 'vprofile-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
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
    expect(realpathOrNull(join(tmpdir(), 'definitely-missing-220'))).toBeNull()
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
    const target = mkdtempSync(join(base, 'ws-'))
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
})
