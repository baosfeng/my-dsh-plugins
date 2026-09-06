/**
 * Smoke test for the dsh-md-render host half: mounts the plugin against a
 * mocked context and asserts the host-half contract (name + inject +
 * apply registers the /md/api config surface, issue #84 配置化).
 * The client half is browser-only (lib/client.js, __ModuleLoader__ format);
 * CI checks its syntax with `node --check`.
 *
 * NOTE: assertions live INSIDE test() (not at module top level) so Stryker's
 * vitest-runner correctly attributes mutant kills to this test file.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { name, apply } from '../lib/index.js'

test('host half exposes the plugin name and apply', async () => {
  assert.equal(name, 'dsh-md-render', 'plugin name')
  assert.equal(typeof apply, 'function', 'apply is a function')
})

test('inject declares webServer (host config API needs it)', async () => {
  const mod = await import('../lib/index.js')
  assert.ok(Array.isArray(mod.inject), 'inject is an array')
  assert.ok(mod.inject.includes('webServer'), 'webServer injected')
})

test('apply registers the /md/api config routes', async () => {
  const routes = []
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {} },
    get() {
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(registration) {
        routes.push(registration)
        return () => {
          const i = routes.indexOf(registration)
          if (i !== -1) routes.splice(i, 1)
        }
      },
    },
  }
  apply(ctx, {})
  assert.equal(routes.length, 1, 'one route registration')
  assert.equal(routes[0].path, '/md/api', 'config API prefix')
  for (const dispose of disposers.splice(0)) dispose()
})
