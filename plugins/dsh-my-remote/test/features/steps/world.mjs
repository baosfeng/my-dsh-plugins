/**
 * Shared World + helpers for dsh-my-remote Gherkin acceptance tests.
 *
 * World 提供：
 *  - **隔离 DSH_HOME（cucumber Before hook 建立，早于任何 step）**；
 *  - ctx.on disposer 真正移除监听器；
 *  - boot：mock ctx + 捕获 routes（/remote/api）与 listeners；
 *  - dispatch：按事件名派发（asks 等 waterfall 事件由 steps 传 next）；
 *  - invoke：调 /remote/api handler。
 *
 * ⚠️ 真实事故的根因与防线：`writePatchFile` 曾**整文件覆盖真实生产配置**
 * （`~/.dsh/profiles/web/cordis.patch.yml`）——因为 DSH_HOME 只在 boot() 里设置，
 * 一旦写入发生在 boot 之前/之后（或 boot 抛错），`patchFileOf` 就回退 `~/.dsh`。
 * 现在：DSH_HOME 由 Before hook 提前隔离，写入走 `writeIsolatedPatchFile` 的
 * fail-closed 路径断言（见 test/helpers/isolated-home.mjs）。
 */
import { setWorldConstructor, After, Before } from '@cucumber/cucumber'
import { readFileSync } from 'node:fs'
import { currentProfile, patchFileOf } from 'dsh-shared'
import { apply } from '../../../lib/index.js'
import { SETTINGS_ROUTE_PREFIX } from '../../../lib/settings.js'
import { createAskRegistry, createApprovalRegistry } from '../../../lib/registries.js'
import { isolatedHome, writeIsolatedPatchFile } from '../../helpers/isolated-home.mjs'

export function mockResponse() {
  const res = {
    status: 0,
    written: [],
    writeHead(status) {
      res.status = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
  }
  return res
}

export function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', token, body = '' } = {}) {
  const headers = { host }
  if (token !== undefined) headers['x-remote-token'] = token
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

export function topAgent(id) {
  return { id, session: { header: { cwd: '/work' } }, options: {} }
}

class World {
  constructor() {
    this.listeners = {}
    this.api = null
    this.disposers = []
    this.homeRestore = null
    this.lastStatus = 0
    this.lastBody = null
    this.pushedEvents = []
    this.askRegistry = createAskRegistry()
    this.approvalRegistry = createApprovalRegistry()
  }

  async boot(config) {
    // DSH_HOME 已由 Before hook 隔离（早于本方法）——这里刻意**不再**改它：
    // 隔离只在 boot 内做的话，任何 boot 之外的写入都会落到真实 ~/.dsh。
    const listeners = this.listeners
    const disposers = this.disposers
    const ctx = {
      logger: { info() {}, warn() {} },
      on(name, handler) {
        ;(listeners[name] ??= []).push(handler)
        return () => {
          const list = listeners[name]
          if (list !== undefined) {
            const idx = list.indexOf(handler)
            if (idx !== -1) list.splice(idx, 1)
          }
        }
      },
      effect(fn) {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
      webServer: {
        register: (route) => {
          if (route.kind !== 'prefix') return () => {}
          if (route.path === '/remote/api') this.api = route
          if (route.path === SETTINGS_ROUTE_PREFIX) this.settingsApi = route
          return () => {}
        },
      },
      get(name) {
        if (name === 'webRuntime') return { trustedHosts: [] }
        if (name === 'agents') return undefined
        return undefined
      },
    }
    // 路由注册契约（issue #385）：注册经 `ctx.root.inject(['webServer'], cb)` 落在
    // 常驻 root 上，且 cb 相对 apply 是**异步**的（cordis 真实行为）——故 boot 之后
    // 用例需 `await this.settle()` 再断言路由已注册。
    const scope = {
      webServer: ctx.webServer,
      logger: { info() {}, warn() {} },
      get: (name) => ctx.get(name),
      effect: (fn) => {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
    }
    ctx.root = {
      inject: (deps, cb) => {
        queueMicrotask(() => cb(scope))
        return { dispose() {} }
      },
      effect: (fn) => {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
      get: (name) => ctx.get(name),
      on: () => () => {},
      logger: { info() {}, warn() {} },
    }
    this.ctx = ctx
    // 记录出站事件（替换 channels dispatch 由步骤驱动 pushEvents）
    apply(ctx, config)
    await this.settle()
    if (this.api === null) throw new Error('prefix route /remote/api not registered')
    if (this.settingsApi === undefined) throw new Error('settings route not registered')
  }

  /**
   * 把该行配置写进 profile 层 patch 文件（模拟用户手写的 yml）。
   * 落盘前经 `writeIsolatedPatchFile` 断言：DSH_HOME 已隔离 + 目标不在真实 ~/.dsh
   * 下 + 位于临时目录内；任一条不满足即抛错中止（绝不静默覆盖真实配置）。
   */
  writePatchFile(text) {
    return writeIsolatedPatchFile(patchFileOf(currentProfile()), text)
  }

  /** patch 文件原文（断言「没写坏手写内容」用）。 */
  readPatchFile() {
    return readFileSync(patchFileOf(currentProfile()), 'utf8')
  }

  /** 等一轮微任务（inject 回调异步执行，路由在其中注册）。 */
  async settle() {
    await new Promise((resolve) => setImmediate(resolve))
  }

  async dispatch(name, ...args) {
    const results = []
    for (const handler of [...(this.listeners[name] ?? [])]) {
      results.push(await handler(...args))
    }
    return results.length === 1 ? results[0] : results
  }

  async invoke(request, response) {
    await this.api.handler(request, response)
    this.lastStatus = response.status
    try {
      this.lastBody = JSON.parse(response.written.join(''))
    } catch {
      this.lastBody = null
    }
  }

  async sendCommand(payload, token) {
    const res = mockResponse()
    await this.invoke(
      mockRequest({ url: '/remote/api/command', method: 'POST', token, body: JSON.stringify(payload) }),
      res,
    )
  }

  async getStatus() {
    const res = mockResponse()
    await this.invoke(mockRequest({ url: '/remote/api/status' }), res)
  }

  /** 调设置端点（GET / PUT <SETTINGS_ROUTE_PREFIX>/settings）。 */
  async callSettings({ method = 'GET', body } = {}) {
    if (!this.settingsApi) throw new Error('settings route not registered')
    const response = mockResponse()
    await this.settingsApi.handler(
      mockRequest({
        url: `${SETTINGS_ROUTE_PREFIX}/settings`,
        method,
        ...(body === undefined ? {} : { host: '127.0.0.1:3080', body }),
      }),
      response,
    )
    this.lastStatus = response.status
    try {
      this.lastBody = JSON.parse(response.written.join(''))
    } catch {
      this.lastBody = null
    }
  }

  async getAudit() {
    const res = mockResponse()
    await this.invoke(mockRequest({ url: '/remote/api/audit' }), res)
  }
}

setWorldConstructor(World)

/**
 * 每个场景开始前就隔离 DSH_HOME（**先于任何 step**）：这是防「写入落到真实
 * ~/.dsh」的第一层防线，不依赖被测代码内部是否设置过环境变量。
 */
Before(function () {
  this.homeRestore = isolatedHome('dsh-my-remote-feature-')
})

After(async function () {
  for (const dispose of this.disposers.splice(0)) dispose()
  // 精确还原（原本未设置则删除），并清理临时目录。
  if (this.homeRestore !== null) {
    this.homeRestore.restore()
    this.homeRestore = null
  }
})
