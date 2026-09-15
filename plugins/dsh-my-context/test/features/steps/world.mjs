/**
 * Shared World + helpers for dsh-my-context Gherkin acceptance tests.
 *
 * World 支持：mock ctx 启动插件（复用 test/lib/helpers.mjs 的 bootPlugin）、
 * 事件派发 / API 调用 / 响应解析。场景内共享同一个 DSH_HOME（「插件重启」
 * 场景需要跨实例保留统计数据）。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { bootPlugin, mockRequest, mockResponse, dispatchEvent } from '../../lib/helpers.mjs'

class World {
  constructor() {
    this.handle = null
    this.tmpDirs = []
    this.lastResponse = null
    this.lastValue = null
    this.lastDecision = null
  }

  boot(config, opts) {
    // 场景内共享同一个 DSH_HOME（「插件重启」场景需要跨实例保留统计数据）
    this.sharedHome ??= dirSync({ unsafeCleanup: true, prefix: 'dsh-context-feature-home-' }).name
    this.tmpDirs.push(this.sharedHome)
    this.handle = bootPlugin(config, { ...opts, home: this.sharedHome })
  }

  async dispatch(name, ...args) {
    this.lastDecision = await dispatchEvent(this.handle.listeners, name, ...args)
    return this.lastDecision
  }

  async invoke(url, { method = 'GET', body, host = '127.0.0.1:3080' } = {}) {
    const res = mockResponse()
    await this.handle.api.handler(mockRequest({ url, method, body, host }), res)
    this.lastResponse = { status: res.writeHeadStatus, body: res.written.join('') }
    if (res.writeHeadStatus === 200) {
      this.lastValue = JSON.parse(this.lastResponse.body).value
    }
  }

  /** 读取会话统计（GET /context/api/session）。 */
  async sessionStats(sessionId) {
    await this.invoke(`/context/api/session?sessionId=${sessionId}`)
    assert.equal(this.lastResponse.status, 200, `session ${sessionId} stats readable`)
    return this.lastValue
  }
}

setWorldConstructor(World)

After(async function () {
  await this.handle?.disposeAll()
  for (const dir of this.tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
