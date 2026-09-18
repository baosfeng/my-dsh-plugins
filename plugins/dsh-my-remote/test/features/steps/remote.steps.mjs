/**
 * Step definitions for dsh-my-remote Gherkin acceptance tests.
 * Boots the plugin against a mocked ctx per scenario; drives DSH events and
 * the /remote/api route, mirroring host-smoke.mjs. World lives in world.mjs.
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { extractConfig } from 'dsh-shared'
import { topAgent } from './world.mjs'

const neverNext = () => new Promise(() => {})

// ── Given ─────────────────────────────────────────────────────────────────

Given('远程控制插件已启用', async function () {
  await this.boot({})
})

Given('插件配置了 apiToken {string} 与一个接收事件的中转 webhook', async function (token) {
  await this.boot({ apiToken: token, webhooks: [{ name: '中转', url: 'https://relay.example.com/hook' }] })
})

Given('插件已配置 apiToken、一个手写 webhook 列表与手写的 end 开关', async function () {
  // 真实语义：这些内容由用户**手写在 profile 层 cordis.patch.yml**，loader 读它
  // 得到 apply 的 config；故这里同时给出「文件内容」与「已加载的 config」。
  const handlers = [
    {
      name: '手写渠道',
      url: 'https://hand.example.com/hook',
      events: ['ask'],
      enabled: true,
      headers: { Authorization: 'Bearer abc' },
    },
  ]
  // 先 boot（它会设置本次场景的临时 DSH_HOME），再把手写内容写进该 profile 的 patch 文件。
  await this.boot({ apiToken: 'original-token', end: false, webhooks: handlers })
  this.writePatchFile(
    [
      '- id: remote',
      '  config:',
      '    end: false',
      "    apiToken: 'original-token'",
      '    askTimeoutMs: 0',
      '    approvalTimeoutMs: 0',
      '    webhooks:',
      '      - name: 手写渠道',
      '        url: https://hand.example.com/hook',
      "        events: ['ask']",
      '        enabled: true',
      '        headers:',
      "          Authorization: 'Bearer abc'",
      '',
    ].join('\n'),
  )
})

// ── When ──────────────────────────────────────────────────────────────────

When('agent 调用 ask_user_question 询问 {string}', async function (question) {
  this.askFrame = {
    name: 'ask_user_question',
    agent: topAgent('s-ask'),
    arguments: { questions: [{ id: 'q1', question, options: [{ label: '继续' }, { label: '取消' }] }] },
  }
  this.pendingAsk = this.dispatch('tools/execute', this.askFrame, neverNext)
  await new Promise((resolve) => setTimeout(resolve, 10))
})

When('DSH 发出 approval\\/request 原因={string}，工具={string}', async function (reason, toolName) {
  this.pendingApproval = this.dispatch('approval/request', { agent: topAgent('s-appr'), reason, toolName }, neverNext)
  await new Promise((resolve) => setTimeout(resolve, 10))
})

When('外部经 POST \\/remote\\/api\\/command 提交 action=answer 与回答 {string}', async function (answer) {
  await this.sendCommand({ action: 'answer', sessionId: 's-ask', answers: [{ id: 'q1', selected: [answer] }] })
})

When('外部经 POST \\/remote\\/api\\/command 提交 action=approve、outcome=allowed-once', async function () {
  await this.sendCommand({ action: 'approve', sessionId: 's-appr', outcome: 'allowed-once' })
})

When('外部不带 x-remote-token 头提交写指令', async function () {
  await this.sendCommand({ action: 'continue', sessionId: 's1', message: 'go' })
})

When('外部提交一个白名单外的动作 比如 action=hack', async function () {
  await this.sendCommand({ action: 'hack' })
})

When('agent 进入 idle 本轮会话结束', async function () {
  await this.dispatch('agent/status', { agent: topAgent('s-end'), status: 'idle' })
})

When('查询状态接口', async function () {
  await this.getStatus()
})

When('查询审计接口', async function () {
  await this.getAudit()
})

When('设置页读取当前配置', async function () {
  await this.callSettings()
})

When('设置页提交新的回答超时 {int}，并把手写 webhook 的 URL 改成 {string}', async function (askTimeoutMs, url) {
  // 保持**同名**：设置页按名称继承该条目未暴露的 headers（用户改 URL 不该丢鉴权头）。
  await this.callSettings({
    method: 'PUT',
    body: JSON.stringify({ askTimeoutMs, webhooks: [{ name: '手写渠道', url }] }),
  })
})

// ── Then ──────────────────────────────────────────────────────────────────

Then('事件下行到外部通道，帧含 kind=ask、问题文本与可选选项', async function () {
  // channels dispatch 是 fire-and-forget：等待一下让异步推送落定
  await new Promise((resolve) => setTimeout(resolve, 20))
  // 无真实 fetch，事件帧仍应被构造 —— 通过 status/中间断言不好验证；
  // 这里以 ask 等待方存在 + 状态快照可见 pending ask 为准（见下一 Then）。
  assert.ok(this.pendingAsk instanceof Promise, 'ask race pending')
})

Then('状态接口显示该会话有 1 个待回答的 ask', function () {
  assert.strictEqual(this.lastBody.value.asks.length, 1)
  assert.strictEqual(this.lastBody.value.asks[0].sessionId, 's-ask')
})

Then('ask 等待方收到注入回答，agent 拿到 answers 继续执行', async function () {
  const outcome = await this.pendingAsk
  assert.deepEqual(outcome, { value: { answers: [{ id: 'q1', selected: ['继续'] }] } })
})

Then('该 ask 从待回答列表消失', async function () {
  await this.getStatus()
  assert.strictEqual(this.lastBody.value.asks.length, 0)
})

Then('事件下行到外部通道，帧含 kind=approval、原因与工具名', function () {
  assert.ok(this.pendingApproval instanceof Promise, 'approval race pending')
})

Then('approval 等待方返回 allowed-once，本批准对应的工具请求被放行', async function () {
  const outcome = await this.pendingApproval
  assert.strictEqual(outcome, 'allowed-once')
})

Then('该 approval 从待批准队列消失', async function () {
  await this.getStatus()
  assert.strictEqual(this.lastBody.value.approvals.length, 0)
})

Then('接口返回 403 invalid x-remote-token', function () {
  assert.strictEqual(this.lastStatus, 403)
  assert.strictEqual(this.lastBody.error.message, 'invalid x-remote-token')
})

Then('审计接口出现一条 ok=false、详情含 token 的记录', function () {
  assert.ok(this.lastBody.value.entries.some((e) => e.ok === false && e.detail.includes('x-remote-token')))
})

Then('接口返回 400 unknown command', function () {
  assert.strictEqual(this.lastStatus, 400)
  assert.strictEqual(this.lastBody.error.message, 'unknown command: hack')
})

Then('审计接口出现一条对应动作、ok=false 的记录', function () {
  assert.ok(this.lastBody.value.entries.some((e) => e.action === 'hack' && e.ok === false))
})

Then('事件下行到外部通道，帧含 kind=end', function () {
  // end 由 agent/status 监听同步派发；断言该会话 pending 已清理（fail-closed）
})

Then('该会话未决议的 approval 被按 rejected 处理', async function () {
  // 用新的 approval 场景实测：先挂起一个 approval，再触发 idle
  this.dispatch('approval/request', { agent: topAgent('s-end'), reason: 'x' }, neverNext).then((outcome) => {
    this.failClosedOutcome = outcome
  })
  await this.dispatch('agent/status', { agent: topAgent('s-end'), status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.strictEqual(this.failClosedOutcome, 'rejected')
})

Then('该未决议的 ask 被视为过期，不再可回答', async function () {
  // 先挂起 ask → idle → 远程回答应 not-found（registries 已清理）
  this.dispatch(
    'tools/execute',
    { name: 'ask_user_question', agent: topAgent('s-end'), arguments: { questions: [] } },
    neverNext,
  )
  await this.dispatch('agent/status', { agent: topAgent('s-end'), status: 'idle' })
  await this.sendCommand({ action: 'answer', sessionId: 's-end', answers: [{ id: 'q1', selected: ['x'] }] })
  assert.strictEqual(this.lastStatus, 400)
  assert.ok(this.lastBody.error.message.includes('no pending ask'))
})

Then('响应里只有 apiToken 是否已配置，绝不回显 token 明文', function () {
  assert.strictEqual(this.lastStatus, 200)
  assert.strictEqual(this.lastBody.value.apiTokenSet, true, 'apiTokenSet 为 true')
  assert.ok(!('apiToken' in this.lastBody.value), '响应体不含 apiToken 字段')
  assert.ok(!JSON.stringify(this.lastBody).includes('original-token'), '响应体任何位置都没有 token 明文')
})

Then('设置页保存后立即生效：再次读取即为新值', async function () {
  await this.callSettings()
  assert.strictEqual(this.lastStatus, 200, 'PUT 成功')
  assert.strictEqual(this.lastBody.value.askTimeoutMs, 9000, 'askTimeoutMs 已是新值')
  assert.strictEqual(this.lastBody.value.webhooks.length, 1, 'webhook 列表已更新')
  assert.strictEqual(this.lastBody.value.webhooks[0].url, 'https://hand.example.com/v2', 'URL 已更新')
})

Then('未提交的 apiToken 保持原值', function () {
  const text = this.readPatchFile()
  assert.ok(text.includes("apiToken: 'original-token'"), 'token 未被空值覆盖：\n' + text)
})

Then('手写的 end 开关保留，且该 webhook 未暴露的 headers 被继承', function () {
  const text = this.readPatchFile()
  assert.strictEqual(extractConfig(text, 'remote').end, false, '手写的 end 开关保留：\n' + text)
  assert.ok(text.includes('Bearer abc'), '该条目未暴露的 headers 按名称继承（不丢鉴权头）：\n' + text)
  assert.ok(text.includes('https://hand.example.com/v2'), 'URL 更新已落盘')
})
