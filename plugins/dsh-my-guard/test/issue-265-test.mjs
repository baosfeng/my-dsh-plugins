/**
 * Issue #265: dsh-my-guard 安装前投毒扫描对带引号包名静默跳过
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { extractPluginAdd } from '../lib/guard.js'
import { scanPackageTarget } from '../lib/poison.js'

test('extractPluginAdd: handles quoted package names', () => {
  // 无引号包名
  assert.equal(extractPluginAdd('dsh plugin add dsh-my-guard'), 'dsh-my-guard')

  // 带双引号包名
  assert.equal(extractPluginAdd('dsh plugin add "dsh-my-guard"'), 'dsh-my-guard')

  // 带单引号包名
  assert.equal(extractPluginAdd("dsh plugin add 'dsh-my-guard'"), 'dsh-my-guard')

  // 带引号的 link
  assert.equal(extractPluginAdd('dsh plugin add "link:/tmp/foo"'), '/tmp/foo')
  assert.equal(extractPluginAdd("dsh plugin add 'link:/tmp/foo'"), '/tmp/foo')

  // 无引号的 link
  assert.equal(extractPluginAdd('dsh plugin add link:/tmp/foo'), '/tmp/foo')

  // 带引号的路径
  assert.equal(extractPluginAdd('dsh plugin add "/tmp/foo"'), '/tmp/foo')
  assert.equal(extractPluginAdd("dsh plugin add '/tmp/foo'"), '/tmp/foo')

  // 含空格路径（需要引号）
  assert.equal(extractPluginAdd('dsh plugin add "/tmp/my path"'), '/tmp/my path')
  assert.equal(extractPluginAdd("dsh plugin add '/tmp/my path'"), '/tmp/my path')

  // 带 profile 参数
  assert.equal(extractPluginAdd('dsh plugin --profile web add "dsh-my-guard"'), 'dsh-my-guard')
  assert.equal(extractPluginAdd("dsh plugin --profile web add 'dsh-my-guard'"), 'dsh-my-guard')

  // 无效输入
  assert.equal(extractPluginAdd('echo hi'), '')
  assert.equal(extractPluginAdd('dsh plugin list'), '')
  assert.equal(extractPluginAdd(''), '')
})

test('scanPackageTarget: reports alerts for unresolvable targets', async () => {
  const alerts = []

  // 测试带引号的无效包名
  await scanPackageTarget('"invalid-package"', (alert) => {
    alerts.push(alert)
  })

  // 应该收到告警
  assert.ok(alerts.length > 0, '应该收到至少一个告警')
  assert.equal(alerts[0].type, 'poison')
  assert.equal(alerts[0].severity, 'low')
  assert.ok(alerts[0].message.includes('无法解析投毒扫描目标'))
})

test('scanPackageTarget: reports alerts for quoted paths that cannot be resolved', async () => {
  const alerts = []

  // 测试带引号的路径（可能不存在）
  await scanPackageTarget('"/tmp/nonexistent-path-12345"', (alert) => {
    alerts.push(alert)
  })

  // 应该收到告警（因为路径不存在）
  assert.ok(alerts.length > 0, '应该收到至少一个告警')
  assert.equal(alerts[0].type, 'poison')
})
