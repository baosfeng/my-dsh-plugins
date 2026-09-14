/**
 * dsh-my-skill-manager — config + disabler provider unit tests.
 *
 * 覆盖：配置规范化/容错、项目根查找、全局/项目禁用合并、占位 provider
 * 的 list/get 行为（cwd 敏感）、配置原子写。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { findProjectRoot } from 'dsh-shared'
import { normalizeConfig, readConfigFile, writeConfigFile, globalConfigFile } from '../lib/config.js'
import { createDisablerProvider, disabledNamesOf } from '../lib/provider.js'

const dir = dirSync({ unsafeCleanup: true, prefix: 'dsm-provider-test-' }).name
process.env.DSH_HOME = dir

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('global config file honors DSH_HOME', () => {
  assert.equal(globalConfigFile(), join(dir, 'skills.enabled.json'))
})

test('normalizeConfig keeps only known shape and dedupes', () => {
  const c = normalizeConfig({
    global: { disabled: ['a', 'a', '', 42, 'b'] },
    project: { disabled: 'not-array' },
    junk: true,
  })
  assert.deepEqual(c.global.disabled, ['a', 'b'])
  assert.deepEqual(c.project.disabled, [])
  assert.deepEqual(normalizeConfig(null), { global: { disabled: [] }, project: { disabled: [] } })
})

test('readConfigFile tolerates missing and corrupt files', async () => {
  const missing = join(dir, 'nope.json')
  assert.deepEqual(await readConfigFile(missing), {
    global: { disabled: [] },
    project: { disabled: [] },
  })
  writeFileSync(join(dir, 'bad.json'), 'not json{{{')
  assert.deepEqual(await readConfigFile(join(dir, 'bad.json')), {
    global: { disabled: [] },
    project: { disabled: [] },
  })
})

test('writeConfigFile persists and round-trips', async () => {
  const file = join(dir, 'roundtrip.json')
  await writeConfigFile(file, { global: { disabled: ['x'] }, project: { disabled: [] } })
  const loaded = await readConfigFile(file)
  assert.deepEqual(loaded.global.disabled, ['x'])
})

test('findProjectRoot walks up to the nearest .git', async () => {
  mkdirSync(join(dir, 'proj', 'sub', 'deep'), { recursive: true })
  mkdirSync(join(dir, 'proj', '.git'))
  assert.equal(await findProjectRoot(join(dir, 'proj', 'sub', 'deep')), join(dir, 'proj'))
  assert.equal(await findProjectRoot(join(dir, 'proj')), join(dir, 'proj'))
  // no .git anywhere: falls back to cwd itself
  assert.equal(await findProjectRoot(join(dir, 'noproj')), join(dir, 'noproj'))
})

test('disabledNamesOf merges global + project lists for a cwd', async () => {
  mkdirSync(join(dir, 'repo2', '.git'), { recursive: true })
  mkdirSync(join(dir, 'repo2', '.dsh'), { recursive: true })
  writeFileSync(join(dir, 'skills.enabled.json'), JSON.stringify({ global: { disabled: ['g1'] } }))
  writeFileSync(
    join(dir, 'repo2', '.dsh', 'skills.enabled.json'),
    JSON.stringify({ project: { disabled: ['p1', 'g1'] } }),
  )
  const names = await disabledNamesOf(join(dir, 'repo2', 'sub'))
  assert.deepEqual(names, ['g1', 'p1'], 'project overrides/extends global')
  const noCwd = await disabledNamesOf(undefined)
  assert.deepEqual(noCwd, ['g1'], 'without cwd only the global list applies')
})

test('disabler provider lists rank-0 placeholders and never loads', async () => {
  const provider = createDisablerProvider()
  assert.equal(provider.name, 'my-skill-manager')
  const candidates = await provider.list({ cwd: undefined })
  assert.deepEqual(
    candidates.map((c) => c.name),
    ['g1'],
  )
  assert.equal(candidates[0].rank, 0)
  assert.equal(candidates[0].provider, 'my-skill-manager')
  assert.equal(candidates[0].invocation.modelInvocable, false)
  assert.equal(await provider.get(candidates[0]), undefined, 'disabled skill body must not load')
})
