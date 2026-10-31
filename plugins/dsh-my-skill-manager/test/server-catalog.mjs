/**
 * dsh-my-skill-manager — 目录根 + catalog 合并单测。
 *
 * 覆盖：四个扫描根的来源标签、官方条目优先、占位条目用扫描信息还原、
 * 仅扫描到的条目 cataloged:false、usage 附加、排序、buildCatalogView 的
 * scannedAt / projectRoot / diagnostics 形状。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  agentsHome,
  buildCatalogView,
  mergeCatalog,
  projectSkillRoots,
  skillRootsOf,
  userSkillRoots,
} from '../lib/server/catalog.js'
import { writeConfigFile } from '../lib/server/config-store.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-catalog-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

test('skill roots carry the host source labels', async () => {
  assert.equal(agentsHome(), join(home, 'agents'))
  assert.deepEqual(userSkillRoots(), [
    { path: join(home, 'skills'), source: 'user-dsh' },
    { path: join(home, 'agents', 'skills'), source: 'user-agents' },
  ])
  const repo = join(home, 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const sub = join(repo, 'pkg')
  mkdirSync(sub, { recursive: true })
  assert.deepEqual(await projectSkillRoots(sub), [
    { path: join(repo, '.dsh', 'skills'), source: 'project-dsh' },
    { path: join(repo, '.agents', 'skills'), source: 'project-agents' },
  ])
  assert.equal((await skillRootsOf()).length, 2)
  assert.equal((await skillRootsOf(sub)).length, 4)
})

test('mergeCatalog: catalog wins, placeholders restored from scan, scan-only marked uncataloged', () => {
  const rows = mergeCatalog({
    catalog: [
      {
        name: 'alpha',
        description: 'catalog alpha',
        invocation: { modelInvocable: true, userInvocable: false },
        source: 'user-dsh',
        provider: 'dsh-skill-filesystem',
      },
      {
        name: 'beta',
        description: '已禁用占位',
        invocation: { modelInvocable: false, userInvocable: false },
        source: 'disabled',
        provider: 'my-skill-manager',
      },
      {
        name: 'ghost',
        description: '已禁用占位',
        invocation: { modelInvocable: false, userInvocable: false },
        source: 'disabled',
        provider: 'my-skill-manager',
      },
    ],
    scanned: [
      { name: 'alpha', description: 'scan alpha', source: 'user-dsh', path: '/roots/alpha' },
      { name: 'beta', description: 'real beta', source: 'project-dsh', path: '/repo/.dsh/skills/beta' },
      { name: 'gamma', description: 'only scanned', source: 'user-agents', path: '/agents/skills/gamma' },
    ],
    usage: { alpha: { count: 3, lastUsedAt: 100, lastSource: 'model' } },
  })

  assert.deepEqual(
    rows.map((row) => row.name),
    ['alpha', 'beta', 'gamma', 'ghost'],
  )

  const alpha = rows.find((row) => row.name === 'alpha')
  assert.equal(alpha.description, 'catalog alpha')
  assert.equal(alpha.path, '/roots/alpha', 'catalog entry path filled from scan')
  assert.deepEqual(alpha.invocation, { modelInvocable: true, userInvocable: false })
  assert.equal(alpha.cataloged, true)
  assert.deepEqual(alpha.usage, { count: 3, lastUsedAt: 100, lastSource: 'model' })

  const beta = rows.find((row) => row.name === 'beta')
  assert.equal(beta.description, 'real beta', 'placeholder row restored from scan')
  assert.equal(beta.source, 'project-dsh')
  assert.equal(beta.path, '/repo/.dsh/skills/beta')
  assert.equal(beta.invocation, undefined)
  assert.equal(beta.cataloged, true)

  const gamma = rows.find((row) => row.name === 'gamma')
  assert.equal(gamma.cataloged, false)
  assert.equal(gamma.provider, 'filesystem')
  assert.equal(gamma.source, 'user-agents')

  const ghost = rows.find((row) => row.name === 'ghost')
  assert.deepEqual(
    ghost,
    { name: 'ghost', cataloged: true },
    'placeholder without a real directory keeps only the name',
  )
})

test('buildCatalogView scans the four roots and reports missing entries', async () => {
  const repo = join(home, 'project')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const projectSkill = join(repo, '.dsh', 'skills', 'project-skill')
  mkdirSync(projectSkill, { recursive: true })
  writeFileSync(join(projectSkill, 'SKILL.md'), '---\nname: project-skill\ndescription: from project\n---\n', 'utf8')
  const brokenDir = join(repo, '.dsh', 'skills', 'broken-skill')
  mkdirSync(brokenDir, { recursive: true }) // 缺 SKILL.md → 诊断
  await writeConfigFile(join(home, 'skills.enabled.json'), {
    global: { disabled: ['project-skill'] },
    project: { disabled: [] },
  })

  const view = await buildCatalogView({
    catalog: [
      {
        name: 'project-skill',
        description: '已禁用占位',
        invocation: { modelInvocable: false, userInvocable: false },
        source: 'disabled',
        provider: 'my-skill-manager',
      },
    ],
    cwd: join(repo, 'pkg'),
    usage: {},
  })

  assert.equal(view.cwd, join(repo, 'pkg'))
  assert.equal(view.projectRoot, repo)
  assert.equal(typeof view.scannedAt, 'number')
  assert.ok(view.scannedAt > 0)
  assert.deepEqual(
    view.skills.map((row) => row.name),
    ['project-skill'],
  )
  assert.equal(view.skills[0].description, 'from project')
  assert.equal(view.skills[0].path, projectSkill)
  assert.deepEqual(
    view.diagnostics.missing.map((issue) => `${issue.name}:${issue.reason}`),
    ['broken-skill:missing-skill-md'],
  )

  const emptyView = await buildCatalogView({ catalog: [] })
  assert.equal(emptyView.cwd, '')
  assert.equal(emptyView.projectRoot, '')
  assert.deepEqual(emptyView.skills, [])
})
