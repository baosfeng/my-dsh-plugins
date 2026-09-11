/**
 * Custom guard rules tests (issue #88): compile/validate, matching, merge
 * decision (mode/severity ranking), detection integration, rules routes
 * (GET /rules, POST /rules/test, POST /rules + persistence), and custom-rule
 * gate behavior (deny override in observe mode).
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  compileRule,
  compileCustomRules,
  rawRulesOf,
  matchCustomRules,
  decideDestructive,
} from '../lib/custom-rules.js'
import { detectDestructive } from '../lib/guard.js'
import {
  bootPlugin,
  createTempHome,
  bashExec,
  dispatchEvent,
  mockRequest,
  mockResponse,
  invoke,
  jsonOf,
} from './lib/helpers.mjs'

const disposeAlls = []
const tmpDirs = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

// ── 纯函数：编译 / 匹配 / 合并决策 ─────────────────────────────────────────

test('compileRule: builds a compiled rule with regex from a valid pattern', () => {
  const rule = compileRule({ pattern: 'rm -rf /tmp/secret', mode: 'deny', severity: 'high', description: '删 temp' }, 1)
  assert.ok(rule !== null)
  assert.equal(rule.custom, true)
  assert.ok(rule.regex instanceof RegExp)
  assert.equal(rule.mode, 'deny')
  assert.equal(rule.severity, 'high')
  assert.equal(rule.message, '删 temp')
  assert.equal(rule.id, 'custom-1')
})

test('compileRule: drops invalid rules (missing pattern / invalid regex / bad mode/severity)', () => {
  assert.equal(compileRule(null, 1), null)
  assert.equal(compileRule({}, 1), null)
  assert.equal(compileRule({ pattern: '' }, 1), null)
  assert.equal(compileRule({ pattern: '((((' }, 1), null)
  const badMode = compileRule({ pattern: 'abc', mode: 'nuke', severity: 'high' }, 1)
  assert.equal(badMode.mode, '', 'invalid mode inherits global')
  const badSev = compileRule({ pattern: 'abc', mode: 'ask', severity: 'critical' }, 1)
  assert.equal(badSev.severity, 'medium', 'invalid severity falls back to medium')
})

test('compileCustomRules: filters invalid rules and preserves order', () => {
  const rules = compileCustomRules([
    { pattern: 'rm -rf /tmp/x', mode: 'deny', severity: 'high', description: 'a' },
    { pattern: '' },
    { pattern: '(((' },
    { pattern: 'rm -rf /tmp/y', mode: 'ask', severity: 'low', description: 'b' },
  ])
  assert.equal(rules.length, 2)
  assert.equal(rules[0].pattern, 'rm -rf /tmp/x')
  assert.equal(rules[1].severity, 'low')
})

test('rawRulesOf: strips runtime regex for persistence', () => {
  const compiled = compileCustomRules([{ pattern: 'abc', mode: 'deny', severity: 'high', id: 'r1' }])
  const raw = rawRulesOf(compiled)
  assert.equal(raw.length, 1)
  assert.equal(raw[0].pattern, 'abc')
  assert.ok(!('regex' in raw[0]), 'raw rule has no regex')
  assert.equal(raw[0].id, 'r1')
})

test('matchCustomRules: returns compiled rules whose regex matches the command', () => {
  const compiled = compileCustomRules([
    { pattern: 'touch /etc/evil', mode: 'deny', severity: 'high' },
    { pattern: 'rm -rf /tmp/ok', mode: 'ask', severity: 'medium' },
  ])
  assert.equal(matchCustomRules('touch /etc/evil', compiled).length, 1)
  assert.equal(matchCustomRules('rm -rf /tmp/ok', compiled).length, 1)
  assert.equal(matchCustomRules('ls -la', compiled).length, 0)
})

// ── 合并决策（mode/severity 取严取高；自定义可升不降）─────────────────────

test('decideDestructive: custom rule matching a safe command produces its own mode/severity', () => {
  const options = {
    mode: 'observe',
    customRules: compileCustomRules([{ pattern: 'touch /etc/evil', mode: 'deny', severity: 'high' }]),
  }
  const decision = decideDestructive('touch /etc/evil', options)
  assert.ok(decision !== null)
  assert.equal(decision.mode, 'deny')
  assert.equal(decision.severity, 'high')
  assert.equal(decision.primary.custom, true)
})

test('decideDestructive: custom raises over builtin observe, but cannot downgrade builtin deny', () => {
  // 自定义 ask 在全局 observe 上「升级」到 ask（只升不降）。
  const raised = decideDestructive('rm -rf /', {
    mode: 'observe',
    customRules: compileCustomRules([{ pattern: 'rm -rf /', mode: 'ask', severity: 'low' }]),
  })
  assert.equal(raised.mode, 'ask', 'custom ask raises over builtin observe')
  assert.equal(raised.severity, 'high', 'builtin high wins over custom low')

  // 自定义 observe 在全局 deny 上「不降级」——内置 deny 仍拦截。
  const notDowngraded = decideDestructive('rm -rf /', {
    mode: 'deny',
    customRules: compileCustomRules([{ pattern: 'rm -rf /', mode: 'observe', severity: 'low' }]),
  })
  assert.equal(notDowngraded.mode, 'deny', 'builtin deny wins over custom observe')
})

test('decideDestructive: custom deny raises the gate over builtin observe', () => {
  const options = {
    mode: 'observe',
    customRules: compileCustomRules([{ pattern: 'mkfs', mode: 'deny', severity: 'high' }]),
  }
  const decision = decideDestructive('mkfs.ext4 /dev/sdb1', options)
  assert.equal(decision.mode, 'deny', 'custom deny raises over builtin observe')
  assert.equal(decision.severity, 'high')
})

test('detectDestructive: returns builtin first, then custom (backward compatible)', () => {
  const builtin = detectDestructive('rm -rf /')
  assert.equal(builtin.id, 'rm-root')
  const custom = detectDestructive('touch /etc/evil', compileCustomRules([{ pattern: 'touch /etc/evil' }]))
  assert.equal(custom.custom, true)
  assert.equal(detectDestructive('ls -la', compileCustomRules([{ pattern: 'touch /etc/evil' }])), null)
})

// ── 集成：自定义规则命中产生告警 + 自定义 deny 在 observe 模式拦截 ────────

test('custom rule matching a safe command records an alert with its severity', async () => {
  const { listeners, api, disposeAll } = boot({
    customRules: [{ pattern: 'touch /etc/evil', mode: 'observe', severity: 'medium', description: '写 /etc' }],
  })
  const decision = await dispatchEvent(
    listeners,
    'tools/pre-execute',
    bashExec('s-1', 'touch /etc/evil'),
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(decision, { kind: 'allow' }, 'observe custom rule passes through')
  const alerts = await fetchAlerts(api)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].type, 'destructive')
  assert.equal(alerts[0].severity, 'medium')
  assert.equal(alerts[0].detail.pattern, 'custom-1')
  disposeAll()
})

test('custom deny rule overrides observe mode and returns deny gate', async () => {
  const { listeners, disposeAll } = boot({
    mode: 'observe',
    customRules: [{ pattern: 'touch /etc/evil', mode: 'deny', severity: 'high', description: '写 /etc' }],
  })
  const decision = await dispatchEvent(
    listeners,
    'tools/pre-execute',
    bashExec('s-1', 'touch /etc/evil'),
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'deny')
  assert.ok(decision.reason.includes('拦截'))
  disposeAll()
})

test('custom ask rule returns ask gate in observe mode', async () => {
  const { listeners, disposeAll } = boot({
    mode: 'observe',
    customRules: [{ pattern: 'rm -rf /data', mode: 'ask', severity: 'high' }],
  })
  const decision = await dispatchEvent(listeners, 'tools/pre-execute', bashExec('s-1', 'rm -rf /data'), async () => ({
    kind: 'allow',
  }))
  assert.equal(decision.kind, 'ask')
  disposeAll()
})

// ── 路由：GET /rules / POST /rules/test / POST /rules（持久化）─────────────

test('GET /rules returns builtin + custom rules and notify settings', async () => {
  const { api, disposeAll } = boot({
    customRules: [{ pattern: 'touch /etc/evil', mode: 'deny', severity: 'high', description: '写 /etc' }],
    notifyEnabled: true,
    notifyCooldownMs: 30000,
  })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/rules' }), res)
  const value = jsonOf(res).value
  assert.ok(Array.isArray(value.builtin) && value.builtin.length > 0)
  assert.equal(value.custom.length, 1)
  assert.equal(value.custom[0].mode, 'deny')
  assert.equal(value.notifyEnabled, true)
  assert.equal(value.notifyCooldownMs, 30000)
  disposeAll()
})

test('POST /rules/test returns matched builtin + custom rules and merged decision', async () => {
  const { api, disposeAll } = boot({
    customRules: [{ pattern: 'mkfs', mode: 'deny', severity: 'high' }],
  })
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/guard/api/rules/test',
      method: 'POST',
      body: JSON.stringify({ command: 'mkfs.ext4 /dev/sdb1' }),
    }),
    res,
  )
  const value = jsonOf(res).value
  assert.ok(
    value.hits.some((h) => h.source === 'builtin' && h.id === 'mkfs'),
    'builtin mkfs hit',
  )
  assert.ok(
    value.hits.some((h) => h.source === 'custom' && h.mode === 'deny'),
    'custom deny hit',
  )
  assert.equal(value.decision.mode, 'deny', 'merged decision is deny')
  disposeAll()
})

test('POST /rules/test with empty command returns 400', async () => {
  const { api, disposeAll } = boot({})
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({ url: '/guard/api/rules/test', method: 'POST', body: JSON.stringify({ command: '' }) }),
    res,
  )
  assert.equal(res.writeHeadStatus, 400)
  disposeAll()
})

test('POST /rules persists custom + notify config to profile patch and updates memory', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const { api, disposeAll } = boot({}, { home })
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/guard/api/rules',
      method: 'POST',
      body: JSON.stringify({
        customRules: [{ pattern: 'touch /etc/evil', mode: 'deny', severity: 'high', description: '写 /etc' }],
        notifyEnabled: true,
        notifyCooldownMs: 15000,
      }),
    }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  const value = jsonOf(res).value
  assert.equal(value.customRules.length, 1)
  assert.equal(value.notifyEnabled, true)
  assert.equal(value.dropped, 0)

  // 持久化到 profile patch（DSH_HOME/profiles/web/cordis.patch.yml）
  const patchFile = join(home, 'profiles', 'web', 'cordis.patch.yml')
  assert.ok(existsSync(patchFile), 'patch file written')
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes(`- id: guard`), 'patch has guard row')
  assert.ok(text.includes(`notifyEnabled: true`), 'patch has notifyEnabled')
  assert.ok(text.includes(`customRules: `), 'patch has customRules')

  // 更新内存：status 反映新配置（saveConfig 已在上面 await 完成，无需额外等待）
  const statusRes = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/status' }), statusRes)
  const status = jsonOf(statusRes).value
  assert.equal(status.customRulesCount, 1)
  assert.equal(status.notifyEnabled, true)
  assert.equal(status.notifyCooldownMs, 15000)
  disposeAll()
})

test('config customRules passed as JSON string is parsed at startup', async () => {
  const { api, disposeAll } = boot({
    customRules: JSON.stringify([{ pattern: 'touch /etc/evil', mode: 'deny', severity: 'high' }]),
  })
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/status' }), res)
  const status = jsonOf(res).value
  assert.equal(status.customRulesCount, 1)
  disposeAll()
})

// ── helpers ────────────────────────────────────────────────────────────────

/** 查询告警（路由内部等 store 就绪，测试侧不需要固定 sleep）。 */
async function fetchAlerts(api) {
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/alerts' }), res)
  return jsonOf(res).value
}
