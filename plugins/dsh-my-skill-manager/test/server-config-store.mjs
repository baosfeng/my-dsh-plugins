/**
 * dsh-my-skill-manager — 配置存储（双作用域）单测。
 *
 * 覆盖：DSH_HOME 路径解析、配置形状规整/去重、缺失与损坏文件容错、
 * 原子写往返、项目根（.git）解析、global/project 独立保存与合并读取。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import {
  CONFIG_FILE_NAME,
  dshHome,
  emptyConfig,
  globalConfigFile,
  normalizeConfig,
  normalizeDisabledList,
  projectConfigFileOf,
  projectRootOf,
  readConfigFile,
  readDisabledLists,
  readGlobalConfig,
  readProjectConfig,
  saveDisabledList,
  writeConfigFile,
} from '../lib/server/config-store.js'

const home = dirSync({ unsafeCleanup: true, prefix: 'dsm-config-' }).name
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(home, 'agents')

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

test('dshHome / globalConfigFile honor DSH_HOME', () => {
  assert.equal(dshHome(), home)
  assert.equal(globalConfigFile(), join(home, CONFIG_FILE_NAME))
})

test('normalizeDisabledList filters non-strings, trims and dedupes', () => {
  assert.deepEqual(normalizeDisabledList(['a', 'a', '', ' b ', 42, null]), ['a', 'b'])
  assert.deepEqual(normalizeDisabledList('not-array'), [])
})

test('normalizeConfig keeps only the documented shape', () => {
  assert.deepEqual(
    normalizeConfig({ global: { disabled: ['a', 'a', 42] }, project: { disabled: 'nope' }, junk: true }),
    { global: { disabled: ['a'] }, project: { disabled: [] } },
  )
  assert.deepEqual(normalizeConfig(null), emptyConfig())
})

test('readConfigFile tolerates missing and corrupt files', async () => {
  assert.deepEqual(await readConfigFile(join(home, 'missing.json')), emptyConfig())
  const corrupt = join(home, 'corrupt.json')
  writeFileSync(corrupt, '{ not json', 'utf8')
  assert.deepEqual(await readConfigFile(corrupt), emptyConfig())
})

test('writeConfigFile persists the documented shape and creates directories', async () => {
  const file = join(home, 'nested', 'deep', CONFIG_FILE_NAME)
  await writeConfigFile(file, { global: { disabled: ['a'] }, project: { disabled: ['b'] } })
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(parsed, { global: { disabled: ['a'] }, project: { disabled: ['b'] } })
  assert.deepEqual(await readConfigFile(file), { global: { disabled: ['a'] }, project: { disabled: ['b'] } })
})

test('projectRootOf finds the nearest .git ancestor; config path follows the root', async () => {
  const repo = join(home, 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const sub = join(repo, 'packages', 'app')
  mkdirSync(sub, { recursive: true })
  assert.equal(await projectRootOf(sub), repo)
  assert.equal(await projectConfigFileOf(sub), join(repo, '.dsh', CONFIG_FILE_NAME))
})

test('saveDisabledList keeps the two scopes independent', async () => {
  const repo = join(home, 'repo2')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const sub = join(repo, 'sub')
  mkdirSync(sub, { recursive: true })

  const globalFile = await saveDisabledList({ scope: 'global', disabled: ['g1', 'g1', ''] })
  assert.equal(globalFile, globalConfigFile())
  assert.deepEqual(await readGlobalConfig(), { global: { disabled: ['g1'] }, project: { disabled: [] } })

  const projectFile = await saveDisabledList({ scope: 'project', disabled: ['p1'], cwd: sub })
  assert.equal(projectFile, join(repo, '.dsh', CONFIG_FILE_NAME))
  assert.deepEqual(await readProjectConfig(sub), { global: { disabled: [] }, project: { disabled: ['p1'] } })

  // 两个作用域互不覆盖
  assert.deepEqual(await readGlobalConfig(), { global: { disabled: ['g1'] }, project: { disabled: [] } })

  assert.deepEqual(await readDisabledLists(sub), { globalDisabled: ['g1'], projectDisabled: ['p1'] })
  assert.deepEqual(await readDisabledLists(), { globalDisabled: ['g1'], projectDisabled: [] })
})

test('a project save preserves the global section inside the same file', async () => {
  const repo = join(home, 'repo3')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const file = join(repo, '.dsh', CONFIG_FILE_NAME)
  mkdirSync(join(repo, '.dsh'), { recursive: true })
  await writeConfigFile(file, { global: { disabled: ['kept'] }, project: { disabled: [] } })
  await saveDisabledList({ scope: 'project', disabled: ['p2'], cwd: repo })
  assert.deepEqual(await readConfigFile(file), { global: { disabled: ['kept'] }, project: { disabled: ['p2'] } })
})
