/**
 * Step definitions for dsh-my-guard Gherkin acceptance tests (settings-config.feature).
 *
 * 设置页配置读写：GET /guard/api/config 读生效配置；PUT /guard/api/config
 * 校验后写回 profile patch 并立即生效（非法值回退默认）。
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { yieldLoop } from '../../../../dsh-shared/test-kit/wait.mjs'

// ── Given ─────────────────────────────────────────────────────────────────
Given('安全护栏插件已启动且配置 {string} 为 {string}', async function (key, value) {
  this.boot({ [key]: value })
  // 让出事件循环等 apply 里已排队的初始化任务跑完：不赌固定时长（负载无关），
  // 也不引入条件——本 feature 的断言只看配置值与 patch 文件，与 store 加载无关。
  await yieldLoop()
})

// ── When ─────────────────────────────────────────────────────────────────
When('通过设置页接口读取配置', async function () {
  await this.invoke('/guard/api/config')
})

When('通过设置页接口保存配置 {string} 为 {string}', async function (key, value) {
  await this.invoke('/guard/api/config', { method: 'PUT', body: JSON.stringify({ [key]: value }) })
})

// ── Then ──────────────────────────────────────────────────────────────────
Then('配置中 {string} 为 {string}', function (key, value) {
  assert.equal(this.lastResponse.status, 200)
  assert.equal(this.lastValue[key], value)
})

Then('设置页配置已持久化且 {string} 为 {string}', function (key, value) {
  assert.equal(this.lastResponse.status, 200)
  assert.equal(this.lastValue[key], value)
  const patchFile = join(this.sharedHome, 'profiles', 'web', 'cordis.patch.yml')
  assert.ok(existsSync(patchFile), 'patch 文件已写入')
  const patch = readFileSync(patchFile, 'utf8')
  assert.ok(patch.includes(`${key}:`), `patch 含 ${key} 行`)
  assert.ok(patch.includes(value), `patch 含新值 ${value}`)
})

Then('设置页配置中 {string} 回退为 {string}', function (key, value) {
  assert.equal(this.lastResponse.status, 200, '非法值不报错，回退默认后照常保存')
  assert.equal(this.lastValue[key], value)
})
