/**
 * dsh-my-plugin-manager — manage.js unit tests (spawn mocked).
 *
 * 唯一保留的 CLI 能力是更新检查（`dsh plugin outdated --json`）——安装 / 卸载 /
 * 启停已随 UI 下线（官方插件页与 `dsh plugin add|remove` 承担），对应用例一并删除。
 */
import { test } from 'vitest'
import { vi } from 'vitest'
import assert from 'node:assert/strict'

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

const { runDsh, pluginArgs, outdatedPlugins } = await import('../lib/manage.js')

/** Drive the last spawned child: emit output, then close or error. */
function settleLast({ stdout = '', stderr = '', code = 0, error = null }) {
  const last = spawned[spawned.length - 1]
  if (stdout !== '') for (const cb of last.listeners.stdout) cb(stdout)
  if (stderr !== '') for (const cb of last.listeners.stderr) cb(stderr)
  if (error !== null) last.listeners.error?.(new Error(error))
  else last.listeners.close?.(code)
}

test('pluginArgs builds the dsh plugin CLI args', () => {
  assert.deepEqual(pluginArgs('web', 'outdated', '--json'), ['plugin', '--profile', 'web', 'outdated', '--json'])
})

test('runDsh resolves ok on close 0 and collects output', async () => {
  const promise = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
  settleLast({ stdout: 'added\n', code: 0 })
  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.code, 0)
  assert.ok(result.stdout.includes('added'))
})

test('runDsh resolves not-ok on nonzero close and on spawn error', async () => {
  const p1 = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
  settleLast({ stderr: 'ERR 123', code: 1 })
  const r1 = await p1
  assert.equal(r1.ok, false)
  assert.equal(r1.code, 1)

  const p2 = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
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
  const p = runDsh(['plugin', '--profile', 'web', 'outdated', '--json'])
  const last = spawned[spawned.length - 1]
  last.listeners.error?.(null)
  const r = await p
  assert.equal(r.ok, false)
  assert.ok(typeof r.error === 'string')
})

test('outdatedPlugins spawns the documented CLI args', async () => {
  const p = outdatedPlugins('web')
  settleLast({ stdout: '{}', code: 0 })
  await p
  const last = spawned[spawned.length - 1]
  assert.equal(last.command, 'dsh')
  assert.deepEqual(last.args, ['plugin', '--profile', 'web', 'outdated', '--json'])
})

test('manage.js exposes no install/uninstall/enable/disable writers', async () => {
  const mod = await import('../lib/manage.js')
  for (const gone of ['installPlugin', 'uninstallPlugin', 'updatePlugin', 'enablePlugin', 'disablePlugin']) {
    assert.equal(mod[gone], undefined, `${gone} 已随重复能力下线`)
  }
})
