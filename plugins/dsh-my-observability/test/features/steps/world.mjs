/**
 * Shared World + helpers for dsh-my-observability Gherkin acceptance tests.
 *
 * 三个 feature（observability / git / review）共享同一个 World 类
 * （cucumber 的 setWorldConstructor 只能调用一次）。World 支持：
 *  - mock ctx 启动插件（复用 test/lib/helpers.mjs 的 bootPlugin）；
 *  - 事件派发 / API 调用 / 响应解析；
 *  - 真实临时 git 仓库（git 工具与 diff 审查场景需要）。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dirSync } from 'tmp'
import { execFileSync } from 'node:child_process'
import { bootPlugin, mockRequest, mockResponse, dispatchEvent } from '../../lib/helpers.mjs'

class World {
  constructor() {
    this.handle = null
    this.tmpDirs = []
    this.clients = []
    this.lastResponse = null
    this.lastValue = null
    this.nextCalled = false
  }

  boot(config, opts) {
    // 场景内共享同一个 DSH_HOME（「插件重启」场景需要跨实例保留审计数据）
    this.sharedHome ??= dirSync({ unsafeCleanup: true, prefix: 'dsh-obs-feature-home-' }).name
    this.tmpDirs.push(this.sharedHome)
    this.handle = bootPlugin(config, { ...opts, home: this.sharedHome })
  }

  async dispatch(name, ...args) {
    this.lastDispatch = await dispatchEvent(this.handle.listeners, name, ...args)
    return this.lastDispatch
  }

  async invoke(url, { method = 'GET', body, host = '127.0.0.1:3080' } = {}) {
    const res = mockResponse()
    await this.handle.api.handler(mockRequest({ url, method, body, host }), res)
    this.lastResponse = { status: res.writeHeadStatus, body: res.written.join('') }
    if (res.writeHeadStatus === 200) {
      this.lastValue = JSON.parse(this.lastResponse.body).value
    }
  }

  createRepo() {
    const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-obs-feature-' }).name
    this.tmpDirs.push(dir)
    mkdirSync(join(dir, 'src'), { recursive: true })
    this.git(dir, 'init')
    this.git(dir, 'config', 'user.email', 'test@example.com')
    this.git(dir, 'config', 'user.name', 'Test Runner')
    return dir
  }

  git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' })
  }
}

setWorldConstructor(World)

After(async function () {
  this.handle?.disposeAll()
  for (const dir of this.tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
