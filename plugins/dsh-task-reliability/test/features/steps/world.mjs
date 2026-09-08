/**
 * Shared World + helpers for dsh-task-reliability Gherkin acceptance tests.
 *
 * 两个 steps 文件（task-reliability.steps.mjs / task-reliability-config.steps.mjs）
 * 共享同一个 World 类：cucumber 的 setWorldConstructor 只能调用一次，重复
 * 定义会互相覆盖并导致步骤定义 ambiguous。World 支持：
 *  - 临时 DSH_HOME（配置 API 写 profile patch 文件需要）；
 *  - 配置读写方法（GET/PUT /task-reliability/api/config）；
 *  - 模拟重启（同一目录重新 boot）。
 */
import { setWorldConstructor, After } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../../lib/index.js'

class World {
  constructor() {
    this.listeners = {}
    this.api = null
    this.dir = ''
    this.dirs = []
    this.mainAgent = null
    this.verifyAgent = null
    this.verifyIdle = null
    this.agents = null
    this.policies = []
    this.calls = { create: [], resume: [] }
    this.nextCalled = false
    this.lastDecision = null
    this.lastResponse = null
    this.lastConfig = null
    this.commandDefs = []
    this.lastCommandResult = null
    this.disposers = []
    this.oldHome = process.env.DSH_HOME
  }

  boot(config = {}, dirOverride) {
    this.dir = dirOverride ?? mkdtempSync(join(tmpdir(), 'dsh-task-rel-feature-'))
    if (dirOverride === undefined) this.dirs.push(this.dir)
    process.env.DSH_HOME = this.dir
    const listeners = this.listeners
    const disposers = this.disposers
    this.mainAgent = this.makeAgent('s-1')
    this.verifyAgent = this.makeAgent('verify-s-1', { origin: 'subagent' })
    // 校验代理的可控完成点：whenIdle 挂起，直到结论 step resolve
    this.verifyIdle = Promise.withResolvers()
    this.verifyAgent.whenIdle = () => this.verifyIdle.promise
    const calls = this.calls
    const verifyAgent = this.verifyAgent
    const mainAgent = this.mainAgent
    const agents = {
      get: () => undefined,
      async create(options) {
        calls.create.push(options)
        return { agent: verifyAgent, async dispose() {} }
      },
      async resume(options) {
        calls.resume.push(options)
        return { agent: mainAgent, async dispose() {} }
      },
    }
    this.agents = agents
    const commandDefs = this.commandDefs
    const commands = {
      register(def) {
        commandDefs.push(def)
        return () => {}
      },
    }
    const ctx = {
      logger: { info() {}, warn() {} },
      // 可选依赖局部等待（cordis ctx.inject）：commands 在本 World 中始终可用，
      // 立即执行回调并注册 /task 命令（与真实 ctx.inject 就绪即执行语义一致）。
      inject(names, callback) {
        const needed = Array.isArray(names) ? names : Object.keys(names ?? {})
        if (needed.every((n) => n === 'commands'))
          callback(
            {
              commands,
              effect: (fn) => {
                const dispose = fn()
                disposers.push(dispose)
                return dispose
              },
            },
            undefined,
          )
        return { dispose() {} }
      },
      on(name, handler) {
        ;(listeners[name] ??= []).push(handler)
        return () => {}
      },
      effect(fn) {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
      webServer: {
        register: (route) => {
          if (route.kind === 'prefix' && route.path === '/task-reliability/api') this.api = route
          return () => {}
        },
      },
      get(name) {
        if (name === 'agents') return agents
        if (name === 'sessionQuery')
          return {
            async readSession() {
              return { events: [] }
            },
          }
        if (name === 'goals')
          return {
            get() {
              return undefined
            },
          }
        if (name === 'approval')
          return {
            setPolicy(agent, policy) {
              this.policies.push({ agentId: agent.id, policy })
            },
          }
        if (name === 'commands') return commands
        if (name === 'webRuntime') return { trustedHosts: [] }
        return undefined
      },
    }
    const shared = apply(ctx, {
      saveDebounceMs: 0,
      resumeGraceMs: 60000,
      steerCooldownMs: 0,
      retryBaseMs: 0,
      ...config,
    })
    this.store = shared.store
  }

  makeAgent(id, opts = {}) {
    return {
      id,
      options: { provider: 'deepseek', model: 'deepseek-chat' },
      session: {
        header: { cwd: '/work', ...(opts.origin !== undefined ? { origin: opts.origin } : {}) },
        events: [],
      },
      steered: [],
      followed: [],
      steer(message) {
        this.steered.push(message)
      },
      followup(message) {
        this.followed.push(message)
      },
      whenIdle() {
        return Promise.resolve()
      },
    }
  }

  async callApi(url, method = 'GET', body) {
    const headers = { host: '127.0.0.1:3080' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = {
      writeHeadStatus: 0,
      written: [],
      writeHead(status) {
        this.writeHeadStatus = status
      },
      write(chunk) {
        this.written.push(String(chunk))
        return true
      },
      end(value) {
        if (value !== undefined) this.written.push(String(value))
      },
    }
    await this.api.handler(
      {
        url,
        method,
        headers,
        async *[Symbol.asyncIterator]() {
          if (body !== undefined) yield JSON.stringify(body)
        },
      },
      response,
    )
    this.lastResponse = {
      status: response.writeHeadStatus,
      body: JSON.parse(response.written.join('') || 'null'),
    }
  }

  async getConfig() {
    await this.callApi('/task-reliability/api/config', 'GET')
    this.lastConfig = this.lastResponse.body.value
  }

  async putConfig(payload) {
    await this.callApi('/task-reliability/api/config', 'PUT', payload)
  }

  dispatch(name, ...args) {
    const handlers = this.listeners[name] ?? []
    assert.ok(handlers.length > 0, `listener ${name} registered`)
    return handlers[handlers.length - 1](...args)
  }

  cleanup() {
    for (const dispose of this.disposers.splice(0)) dispose()
    for (const dir of this.dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    process.env.DSH_HOME = this.oldHome
  }
}

setWorldConstructor(World)

After(function () {
  this.cleanup()
})
