/**
 * dsh-my-skill-manager — rank-0 占位 provider 单测。
 *
 * 覆盖：全局 + 项目禁用名单合并（cwd 敏感）、候选条目的 rank/provider/
 * invocation/description、get() 返回 undefined、无配置时零候选。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { saveDisabledList } from '../lib/server/config-store.js'
import { DISABLED_PROVIDER, DISABLED_RANK, createDisablerProvider, disabledNamesOf } from '../lib/server/disabler.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-disabler-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

const repo = join(home, 'repo')
mkdirSync(join(repo, '.git'), { recursive: true })

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

test('disabledNamesOf merges global and cwd-scoped project names', async () => {
  await saveDisabledList({ scope: 'global', disabled: ['global-a', 'shared'] })
  await saveDisabledList({ scope: 'project', disabled: ['shared', 'project-b'], cwd: repo })

  assert.deepEqual(await disabledNamesOf(), ['global-a', 'shared'])
  assert.deepEqual((await disabledNamesOf(repo)).sort(), ['global-a', 'project-b', 'shared'])
})

test('provider exposes rank-0 placeholder candidates for disabled names only', async () => {
  const provider = createDisablerProvider()
  assert.equal(provider.name, DISABLED_PROVIDER)

  const globalOnly = await provider.list({})
  assert.deepEqual(globalOnly.map((candidate) => candidate.name).sort(), ['global-a', 'shared'])

  const withProject = await provider.list({ cwd: repo })
  assert.deepEqual(withProject.map((candidate) => candidate.name).sort(), ['global-a', 'project-b', 'shared'])
  for (const candidate of withProject) {
    assert.equal(candidate.rank, DISABLED_RANK)
    assert.equal(candidate.provider, DISABLED_PROVIDER)
    assert.equal(candidate.source, 'disabled')
    assert.deepEqual(candidate.invocation, { modelInvocable: false, userInvocable: false })
    assert.ok(candidate.description.length > 0, 'host requires a non-empty description')
  }

  assert.equal(await provider.get(withProject[0], {}), undefined, 'disabled skills never load their body')
})

test('no config means no candidates (catalog stays byte-identical)', async () => {
  const emptyHome = dirSync({ unsafeCleanup: true, prefix: 'dsm-disabler-empty-' }).name
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = emptyHome
  try {
    const provider = createDisablerProvider()
    assert.deepEqual(await provider.list({}), [])
    assert.deepEqual(await disabledNamesOf(), [])
  } finally {
    process.env.DSH_HOME = previous
    rmSync(emptyHome, { recursive: true, force: true })
  }
})
