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
    effect: () => () => {},
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
  assert.doesNotThrow(() => apply({ effect: () => () => {} }), 'apply must not throw without a logger')
})

// ══ issue #298 回归：访问 ctx.<service> 必须在 inject 里声明 ══════════════
/**
 * 背景：`ctx.webServer?.register(...)` 在 cordis 4 下 **get 阶段**就抛
 * `cannot get property "webServer" without inject`（可选链挡不住：它保护的是
 * undefined 的方法调用，不是抛错的属性读取）。本插件曾在 `inject` 里漏掉
 * webServer，导致真实实例 `plugin tree failed to load`、apply 即崩。
 *
 * 插件测试此前不覆盖「真实 cordis 语境下 apply」，所以 CI 抓不到。这里做一条
 * **静态一致性断言**（对源码做，而不是只对产物）：任何 `ctx.<名字>` 若不是
 * cordis Context 的内建成员，就必须出现在 `inject` 里 —— 直接钉住缺陷类别，
 * 而不是这一处具体修法。真实运行时的语义断言由隔离实例验证（release 门禁 3c）
 * 覆盖，两者互补。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inject as builtInject } from '../lib/index.js'

/** cordis Context 的内建成员（非服务，不需要 inject）。 */
const CONTEXT_BUILTINS = new Set([
  'effect',
  'logger',
  'on',
  'off',
  'emit',
  'bail',
  'parallel',
  'waterfall',
  'start',
  'stop',
  'plugin',
  'inject',
  'isolate',
  'reflect',
  'root',
  'scope',
  'fiber',
  'events',
  'registry',
  'get',
  'set',
  'provide',
  'accessor',
  'mixin',
  'extend',
  'internal',
])

const SRC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts')

/** 从源码里抽出所有 `ctx.<名字>` 引用。 */
function ctxServicesUsed(source) {
  const found = new Set()
  for (const m of source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) found.add(m[1])
  return [...found]
}

test('产物 inject 声明了 webServer（#298：静态资源路由需要它）', () => {
  assert.ok(Array.isArray(builtInject), 'inject 是数组')
  assert.ok(builtInject.includes('systemPrompt'), 'systemPrompt 已声明')
  assert.ok(builtInject.includes('webServer'), 'webServer 已声明 —— 否则 ctx.webServer 读取即抛')
})

test('源码里访问的每个 ctx.<service> 都在 inject 里声明（#298 缺陷类别）', () => {
  const used = ctxServicesUsed(readFileSync(SRC_PATH, 'utf8'))
  assert.ok(used.length > 0, '抽到了 ctx.* 引用（正则没漂移）')
  const undeclared = used.filter((name) => !CONTEXT_BUILTINS.has(name) && !builtInject.includes(name))
  assert.deepEqual(
    undeclared,
    [],
    '以下 ctx.<service> 被访问但未在 inject 声明（cordis 4 会在 get 阶段抛 "without inject"）：' +
      JSON.stringify(undeclared),
  )
})
