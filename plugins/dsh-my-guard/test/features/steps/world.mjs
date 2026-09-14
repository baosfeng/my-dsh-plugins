/**
 * Shared World + helpers for dsh-my-guard Gherkin acceptance tests.
 *
 * 三个 feature（guard / poison / injection）共享同一个 World 类
 * （cucumber 的 setWorldConstructor 只能调用一次）。World 支持：
 *  - mock ctx 启动插件（复用 test/lib/helpers.mjs 的 bootPlugin）；
 *  - 事件派发 / API 调用 / 响应解析；
 *  - 临时包目录构造（投毒扫描场景需要）。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { bootPlugin, mockRequest, mockResponse, dispatchEvent, settle } from '../../lib/helpers.mjs'

class World {
  constructor() {
    this.handle = null
    this.tmpDirs = []
    this.lastResponse = null
    this.lastValue = null
    this.lastDecision = null
  }

  boot(config, opts) {
    // 场景内共享同一个 DSH_HOME（「插件重启」场景需要跨实例保留告警数据）
    this.sharedHome ??= dirSync({ unsafeCleanup: true, prefix: 'dsh-guard-feature-home-' }).name
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

  createPackage(pkg, files = {}) {
    const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-guard-feature-pkg-' }).name
    this.tmpDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name)
      mkdirSync(join(dir, name.split('/').slice(0, -1).join('/')), { recursive: true })
      writeFileSync(full, content)
    }
    return dir
  }

  async waitForAlerts(minCount) {
    for (let i = 0; i < 20; i += 1) {
      await settle(50)
      const res = mockResponse()
      await this.handle.api.handler(mockRequest({ url: '/guard/api/alerts' }), res)
      const value = JSON.parse(res.written.join('')).value
      if (value.length >= minCount) return value
    }
    return []
  }
}

setWorldConstructor(World)

After(async function () {
  this.handle?.disposeAll()
  for (const dir of this.tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
