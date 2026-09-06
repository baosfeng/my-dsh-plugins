/**
 * Smoke test for the dsh-mermaid-render host half: mounts the plugin against a
 * mocked context and asserts the mount log line (issue #155 日志体系). The
 * plugin is client-only; this host half exists so the bundle row mounts
 * cleanly and now emits a startup info log.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/** Build a mocked plugin context and run apply, returning captured logs. */
function boot() {
  const logs = []
  const ctx = {
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  }
  apply(ctx)
  return { logs }
}

test('apply logs an info line with the [dsh-mermaid-render] prefix (issue #155)', async () => {
  const { logs } = boot()
  assert.ok(logs.length >= 1, 'at least one log line emitted')
  assert.ok(logs[0].startsWith('[dsh-mermaid-render]'), 'log line carries the unified plugin prefix')
  assert.ok(logs[0].includes('已挂载'), 'log line describes the mount behavior')
})

test('apply tolerates a missing logger (optional chaining)', async () => {
  assert.doesNotThrow(() => apply({}), 'apply must not throw without a logger')
})
