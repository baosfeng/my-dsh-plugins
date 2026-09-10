/**
 * dsh-my-opencode-session-header — Gherkin step definitions.
 *
 * 步骤复用 World 的 mock ctx / 惰性 fetch 流，断言出站请求头与退化行为。
 */
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { dispatchStream, lazyFetchStream } from '../../lib/helpers.mjs'

Given('会话头注入插件已启动', function () {
  this.boot()
})

Given('会话头注入插件已启动且覆盖开关开启', function () {
  this.boot({ override: true })
})

When('provider {string} 的会话 {string} 向 {string} 发起推理', async function (provider, sessionId, url) {
  await this.consume({ provider, sessionId, url })
})

When('provider {string} 的会话 {string} 向 {string} 再次发起推理', async function (provider, sessionId, url) {
  await this.consume({ provider, sessionId, url })
})

When(
  'provider {string} 的会话 {string} 向 {string} 发起推理且已带会话头 {string}',
  async function (provider, sessionId, url, preset) {
    await this.consume({
      provider,
      sessionId,
      url,
      init: { headers: { 'x-opencode-session': preset, authorization: 'Bearer k' } },
    })
    assert.equal(this.lastHeaders().authorization, 'Bearer k', '其它请求头必须保留')
  },
)

When('provider {string} 未提供会话 id 向 {string} 发起推理', async function (provider, url) {
  await this.consume({ provider, url, withSession: false })
})

When('provider {string} 的会话 {string} 与会话 {string} 的推理流被交替消费', async function (provider, first, second) {
  const streamOf = (sessionId, chunks) =>
    dispatchStream(this.handle.listeners, { provider, sessionId }, () => lazyFetchStream({ chunks }))
  const iterA = streamOf(first, ['one'])[Symbol.asyncIterator]()
  const iterB = streamOf(second, ['two'])[Symbol.asyncIterator]()
  await iterA.next()
  await iterB.next()
  await iterA.return(undefined)
  await iterB.return(undefined)
})

When('消费方在第一个 chunk 后中断 provider {string} 的会话 {string} 的推理流', async function (provider, sessionId) {
  const stream = dispatchStream(this.handle.listeners, { provider, sessionId }, () =>
    lazyFetchStream({
      chunks: ['a', 'b'],
      onClose: () => {
        this.closed += 1
      },
    }),
  )
  for await (const chunk of stream) {
    void chunk
    break
  }
})

When('插件被卸载', async function () {
  await this.handle.disposeAll()
})

When('用 providers 为空数组的配置启动插件', function () {
  try {
    this.boot({ providers: [] })
  } catch (error) {
    this.error = error
  }
})

Then('出站请求头 {string} 为 {string}', function (name, value) {
  assert.equal(this.lastHeaders()[name], value)
})

Then('出站请求头 {string} 不存在', function (name) {
  assert.equal(this.lastHeaders()[name], undefined)
})

Then('第 {int} 个出站请求头 {string} 为 {string}', function (index, name, value) {
  assert.equal(this.headersAt(index)[name], value)
})

Then('每一轮出站请求头 {string} 均为 {string}', function (name, value) {
  assert.ok(this.rec.calls.length >= 2, '至少两轮请求')
  for (const call of this.rec.calls) assert.equal(call.headers[name], value)
})

Then('流内容为 {string}', function (expected) {
  assert.deepEqual(this.chunks, [expected])
})

Then('产生了 {int} 条退化告警', function (count) {
  assert.equal(this.handle.logs.warn.length, count)
})

Then('内层流已被关闭', function () {
  assert.equal(this.closed, 1)
})

Then('globalThis.fetch 已还原为安装前的值', function () {
  assert.equal(globalThis.fetch, this.rec.fn)
})

Then('启动报错信息包含 {string}', function (fragment) {
  assert.ok(this.error instanceof Error, '启动应当抛出错误')
  assert.match(String(this.error.message), new RegExp(fragment))
})
