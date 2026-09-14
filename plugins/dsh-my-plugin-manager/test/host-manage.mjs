/**
 * dsh-my-plugin-manager — manage.js unit tests (spawn mocked; version reads real).
 */
import { test, afterAll } from 'vitest'
import { vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'

// ── mock child_process.spawn ───────────────────────────────────────────────
const spawned = []
vi.mock('node:child_process', () => ({
  spawn: (command, args, options) => {
    const listeners = { stdout: [], stderr: [], error: null, close: null }
    const handle = {
      stdout: {
        on: (event, cb) => {
          if (event === 'data') listeners.stdout.push(cb)
        },
      },
      stderr: {
        on: (event, cb) => {
          if (event === 'data') listeners.stderr.push(cb)
        },
      },
      on: (event, cb) => {
        if (event === 'error') listeners.error = cb
        if (event === 'close') listeners.close = cb
      },
    }
    spawned.push({ command, args, options, handle, listeners })
    return handle
  },
}))

const {
  runDsh,
  pluginArgs,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  outdatedPlugins,
  installedVersionOf,
  enablePlugin,
  disablePlugin,
} = await import('../lib/manage.js')

/** Drive the last spawned child: emit output, then close or error. */
function settleLast({ stdout = '', stderr = '', code = 0, error = null }) {
  const last = spawned[spawned.length - 1]
  if (stdout !== '') for (const cb of last.listeners.stdout) cb(stdout)
  if (stderr !== '') for (const cb of last.listeners.stderr) cb(stderr)
  if (error !== null) last.listeners.error?.(new Error(error))
  else last.listeners.close?.(code)
}

const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-manage-test-' }).name

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('pluginArgs builds the dsh plugin CLI args', () => {
  assert.deepEqual(pluginArgs('web', 'add', 'dsh-x'), ['plugin', '--profile', 'web', 'add', 'dsh-x'])
})

test('runDsh resolves ok on close 0 and collects output', async () => {
  const promise = runDsh(['plugin', '--profile', 'web', 'add', 'x'])
  settleLast({ stdout: 'added\n', code: 0 })
  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.code, 0)
  assert.ok(result.stdout.includes('added'))
})

test('runDsh resolves not-ok on nonzero close and on spawn error', async () => {
  const p1 = runDsh(['plugin', '--profile', 'web', 'remove', 'x'])
  settleLast({ stderr: 'ERR 123', code: 1 })
  const r1 = await p1
  assert.equal(r1.ok, false)
  assert.equal(r1.code, 1)

  const p2 = runDsh(['plugin', '--profile', 'web', 'add', 'x'])
  settleLast({ error: 'spawn dsh ENOENT' })
  const r2 = await p2
  assert.equal(r2.ok, false)
  assert.equal(r2.code, -1)
  assert.ok(r2.error.includes('ENOENT'))
})

test('outdatedPlugins parses pnpm outdated --json', async () => {
  const promise = outdatedPlugins('web')
  settleLast({
    stdout: JSON.stringify({
      'dsh-a': { current: '1.0.0', latest: '1.1.0' },
      'dsh-b': { current: '2.0.0', latest: '2.0.0' },
    }),
    code: 0,
  })
  const result = await promise
  assert.equal(result.ok, true)
  assert.deepEqual(result.outdated, [
    { name: 'dsh-a', current: '1.0.0', latest: '1.1.0' },
    { name: 'dsh-b', current: '2.0.0', latest: '2.0.0' },
  ])
})

test('outdatedPlugins reports CLI failures and non-JSON output', async () => {
  const p1 = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
  settleLast({ stderr: 'no lockfile', code: 1 })
  const r1 = await p1
  assert.equal(r1.ok, false)
  assert.ok(r1.stderr.includes('no lockfile'), 'runDsh surfaces stderr on nonzero close')

  const p2 = outdatedPlugins('web')
  settleLast({ stdout: 'not json at all', code: 0 })
  const r2 = await p2
  assert.equal(r2.ok, false)
  assert.ok(r2.error.includes('JSON'), 'outdatedPlugins wraps non-JSON output')
})

test('installPlugin / uninstallPlugin route to add / remove', async () => {
  const p1 = installPlugin('web', 'dsh-x')
  settleLast({ stdout: 'ok', code: 0 })
  const r1 = await p1
  assert.equal(r1.ok, true)
  assert.deepEqual(spawned[spawned.length - 1].args, ['plugin', '--profile', 'web', 'add', 'dsh-x'])

  const p2 = uninstallPlugin('web', 'dsh-x')
  settleLast({ stdout: '', code: 0 })
  await p2
  assert.deepEqual(spawned[spawned.length - 1].args, ['plugin', '--profile', 'web', 'remove', 'dsh-x'])
})

test('installedVersionOf reads plain and scoped packages', () => {
  mkdirSync(join(dir, 'node_modules', 'dsh-a'), { recursive: true })
  mkdirSync(join(dir, 'node_modules', '@scope', 'dsh-b'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'dsh-a', 'package.json'), JSON.stringify({ name: 'dsh-a', version: '0.3.1' }))
  writeFileSync(
    join(dir, 'node_modules', '@scope', 'dsh-b', 'package.json'),
    JSON.stringify({ name: '@scope/dsh-b', version: '1.2.3' }),
  )
  assert.equal(installedVersionOf(dir, 'dsh-a'), '0.3.1')
  assert.equal(installedVersionOf(dir, '@scope/dsh-b'), '1.2.3')
  assert.equal(installedVersionOf(dir, 'ghost-pkg'), '', 'missing package → empty version')
})

test('outdatedPlugins fallback chains and shape normalization', async () => {
  // stderr 空、stdout 有值 → error 取 stdout
  const p1 = outdatedPlugins('web')
  settleLast({ stdout: 'something went wrong', code: 1 })
  const r1 = await p1
  assert.equal(r1.ok, false)
  assert.ok(r1.error.includes('something went wrong'))

  // 全部为空 → exit code
  const p2 = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
  settleLast({ code: 7 })
  const r2 = await p2
  assert.equal(r2.ok, false)

  // stdout 空字符串 → 解析为 {} → 无 outdated
  const p3 = outdatedPlugins('web')
  settleLast({ stdout: '', code: 0 })
  const r3 = await p3
  assert.equal(r3.ok, true)
  assert.deepEqual(r3.outdated, [])

  // info 字段非字符串 → 归一化为 ''
  const p4 = outdatedPlugins('web')
  settleLast({ stdout: JSON.stringify({ 'dsh-x': { current: 1, latest: null } }), code: 0 })
  const r4 = await p4
  assert.deepEqual(r4.outdated, [{ name: 'dsh-x', current: '', latest: '' }])
})

test('runDsh handles a null spawn error object', async () => {
  const p = runDsh(['plugin', '--profile', 'web', 'add', 'x'])
  const last = spawned[spawned.length - 1]
  last.listeners.error?.(null)
  const r = await p
  assert.equal(r.ok, false)
  assert.ok(typeof r.error === 'string')
})

test('updatePlugin calls dsh plugin update', async () => {
  const p = updatePlugin('web', 'dsh-file-activity')
  settleLast({ code: 0 })
  const r = await p
  assert.equal(r.ok, true)
  const last = spawned[spawned.length - 1]
  assert.deepEqual(last.args, ['plugin', '--profile', 'web', 'update', 'dsh-file-activity'])
})

test('updatePlugin handles failure', async () => {
  const p = updatePlugin('web', 'dsh-file-activity')
  settleLast({ code: 1, stderr: 'update failed' })
  const r = await p
  assert.equal(r.ok, false)
  assert.ok(r.stderr.includes('update failed'))
})

test('enablePlugin enables a plugin in cordis.patch.yml', async () => {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-enable-test-' }).name
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(
    patchPath,
    `- insert:\n    - id: test-plugin\n      name: 'dsh-test-plugin'\n      enabled: false\n`,
    'utf8',
  )

  const r = await enablePlugin(dir, 'dsh-test-plugin')
  assert.equal(r.ok, true)

  const content = readFileSync(patchPath, 'utf8')
  assert.ok(content.includes('enabled: true'))
})

test('disablePlugin disables a plugin in cordis.patch.yml', async () => {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-disable-test-' }).name
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(
    patchPath,
    `- insert:\n    - id: test-plugin\n      name: 'dsh-test-plugin'\n      enabled: true\n`,
    'utf8',
  )

  const r = await disablePlugin(dir, 'dsh-test-plugin')
  assert.equal(r.ok, true)

  const content = readFileSync(patchPath, 'utf8')
  assert.ok(content.includes('enabled: false'))
})

test('enablePlugin creates entry if not found', async () => {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-enable-new-test-' }).name
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, `- insert:\n    - id: other-plugin\n      name: 'dsh-other-plugin'\n`, 'utf8')

  const r = await enablePlugin(dir, 'dsh-test-plugin')
  assert.equal(r.ok, true)

  const content = readFileSync(patchPath, 'utf8')
  assert.ok(content.includes('dsh-test-plugin'))
  assert.ok(content.includes('enabled: true'))
})

test('disablePlugin creates entry if not found', async () => {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-disable-new-test-' }).name
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, `- insert:\n    - id: other-plugin\n      name: 'dsh-other-plugin'\n`, 'utf8')

  const r = await disablePlugin(dir, 'dsh-test-plugin')
  assert.equal(r.ok, true)

  const content = readFileSync(patchPath, 'utf8')
  assert.ok(content.includes('dsh-test-plugin'))
  assert.ok(content.includes('enabled: false'))
})

test('enablePlugin handles missing file', async () => {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dpm-enable-missing-test-' }).name

  const r = await enablePlugin(dir, 'dsh-test-plugin')
  assert.equal(r.ok, true)

  const patchPath = join(dir, 'cordis.patch.yml')
  const content = readFileSync(patchPath, 'utf8')
  assert.ok(content.includes('dsh-test-plugin'))
  assert.ok(content.includes('enabled: true'))
})
