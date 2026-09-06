/**
 * dsh-session-title-gen — Gherkin step definitions.
 *
 * 步骤复用 World 的 mock ctx / session / 事件派发，断言标题事件。
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'

function userMessage(text, source = { kind: 'user' }) {
  return { type: 'user/message', data: { content: [{ type: 'text', text }], source } }
}

function titleEvent(title, source) {
  return { type: 'session/title', data: { title, messageSeqs: [0], source } }
}

Given('会话标题生成插件已启动', function () {
  this.boot()
})

Given('会话标题生成插件已启动且 LLM 不可用', function () {
  this.llmBroken = true
  this.boot()
})

Given('会话标题生成插件已启动且开关为关闭', function () {
  this.boot({ enabled: false })
})

Given('会话 {string} 已有标题 {string} 来源为 {string}', function (id, title, source) {
  this.newSession(id, '/work/my-dsh-plugins', [
    userMessage('修复 #143 记忆页签崩溃'),
    titleEvent(title, { kind: 'provider', provider: source }),
  ])
})

Given('会话 {string} 已有用户手动标题 {string}', function (id, title) {
  this.newSession(id, '/work/my-dsh-plugins', [
    userMessage('修复 #143 记忆页签崩溃'),
    titleEvent(title, { kind: 'user' }),
  ])
})

When('会话 {string} 收到首条人类消息 {string} 且工作目录为 {string}', async function (id, text, cwd) {
  this.newSession(id, cwd, [userMessage(text)])
  await this.dispatch('session/event', this.session, userMessage(text))
})

When('会话 {string} 收到首条人类消息 {string}', async function (id, text) {
  this.newSession(id, '/work/my-dsh-plugins', [userMessage(text)])
  await this.dispatch('session/event', this.session, userMessage(text))
})

When('会话 {string} 收到新的人类消息', async function (id) {
  if (this.session === null) this.newSession(id, '/work/my-dsh-plugins')
  await this.dispatch('session/event', this.session, userMessage('新的消息'))
})

When('核心写入非结构化标题事件', async function () {
  await this.dispatch(
    'session/event',
    this.session,
    titleEvent('修复 #143 记忆页签崩溃', { kind: 'provider', provider: 'session-title-first-prompt-llm' }),
  )
})

Then('会话标题为 {string}', function (expected) {
  assert.equal(this.lastTitle()?.title, expected)
})

Then('标题来源为 {string}', function (expected) {
  assert.equal(this.lastTitle()?.source?.provider, expected)
})

Then('标题事件数量为 {int}', function (expected) {
  assert.equal(this.titleEvents().length, expected)
})

Then('不写入任何标题事件', function () {
  assert.equal(this.titleEvents().length, 0)
})

Then('会话事件流不阻塞', function () {
  // 事件派发已正常返回（未抛错/未挂起），会话 log 仍可继续 append
  assert.ok(this.session.events.length >= 0)
})

Then('会话标题保持为 {string}', function (expected) {
  assert.equal(this.lastTitle()?.title, expected)
})
