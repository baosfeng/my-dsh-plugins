import { test } from 'vitest'
/**
 * dsh-my-remote — 集成冒烟测试（端到端闭环，覆盖 issue #75 验收主路径）。
 *
 * 闭环 1（ask）：事件下行 → 外部收到 ask → POST /remote/api/command 远程回答
 *   → ask 事件 handler 短路返回 { value: { answers } }（agent 据此继续）。
 * 闭环 2（approval）：事件下行 → POST command approve → approval/request
 *   handler 返回 'allowed-once'（工具放行）。
 * 闭环 3（end）：agent/status idle → 事件下行 + 未决议 ask/approval fail-closed。
 * 闭环 4（status/audit）：查询接口可见 pending 与审计。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-my-remote-smoke-'))
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    status: 0,
    written: [],
    writeHead(status) {
      res.status = status
    },
    write(chunk) {
      res.written.push(String(chunk))
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', headers = {}, body = '' } = {}) {
  return {
    url,
    method,
    headers: { host, ...headers },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** boot：mock ctx + webServer + fetch；返回 listeners/routes/helper。 */
function boot(config = {}, fetchImpl) {
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempDir()
  const listeners = {}
  const routes = []
  const disposers = []
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
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'webRuntime') return undefined
      return undefined
    },
  }
  const originalFetch = globalThis.fetch
  if (fetchImpl !== undefined) globalThis.fetch = fetchImpl
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/remote/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route /remote/api registered')
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
    if (fetchImpl !== undefined) globalThis.fetch = originalFetch
  }
  disposeAlls.push(disposeAll)
  return { ctx, listeners, api, disposeAll }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

async function dispatchEvent(listeners, name, ...args) {
  const results = []
  for (const handler of [...(listeners[name] ?? [])]) {
    results.push(await handler(...args))
  }
  // 单 handler 时直接返回结果（避免数组包装）；多 handler 返回数组
  return results.length === 1 ? results[0] : results
}

/** 顶层 agent。 */
const topAgent = (id) => ({ id, session: { header: { cwd: '/work' } }, options: {} })

/** 推送 spy（记录出站事件）。 */
function installFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options })
    return { ok: true }
  }
}

test('remote control integration suite', async () => {
  try {
    const webhooks = [{ name: '中转服务', url: 'https://relay.example.com/hook', events: ['ask', 'approval', 'end'] }]
    const calls = []
    const { listeners, api } = boot({ webhooks }, installFetch(calls))

    // ── 闭环 1：ask 事件下行 + 远程回答短路 ──────────────────────────
    {
      const exec = {
        name: 'ask_user_question',
        agent: topAgent('s1'),
        arguments: {
          questions: [{ id: 'q1', question: '是否继续部署?', options: [{ label: '继续' }, { label: '取消' }] }],
        },
      }
      const neverNext = () => new Promise(() => {})
      const askPromise = dispatchEvent(listeners, 'tools/execute', exec, neverNext)
      // 等下行推送完成
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(calls.length, 1, 'ask event pushed once')
      const pushed = JSON.parse(calls[0].options.body)
      assert.equal(pushed.kind, 'ask')
      assert.equal(pushed.sessionId, 's1')
      assert.equal(pushed.questions[0].options.length, 2, 'question options carried for external rendering')

      // status 查询显示 pending ask
      const statusRes = mockResponse()
      await invoke(api, mockRequest({ url: '/remote/api/status' }), statusRes)
      const statusBody = JSON.parse(statusRes.written.join(''))
      assert.equal(statusBody.value.asks.length, 1, 'pending ask visible in status')

      // 远程回答
      const answerRes = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/remote/api/command',
          method: 'POST',
          body: JSON.stringify({ action: 'answer', sessionId: 's1', answers: [{ id: 'q1', selected: ['继续'] }] }),
        }),
        answerRes,
      )
      assert.equal(answerRes.status, 200, 'remote answer accepted')
      const answerBody = JSON.parse(answerRes.written.join(''))
      assert.equal(answerBody.ok, true)

      // ask handler 短路返回注入结果
      const askOutcome = await askPromise
      assert.deepEqual(
        askOutcome,
        { value: { answers: [{ id: 'q1', selected: ['继续'] }] } },
        'agent receives the answer',
      )
      calls.length = 0
    }

    // ── 闭环 2：approval 事件下行 + 远程批准短路 ─────────────────────
    {
      const req = { agent: topAgent('s2'), reason: '需要执行 bash 命令', toolName: 'bash' }
      const neverNext = () => new Promise(() => {})
      const approvalPromise = dispatchEvent(listeners, 'approval/request', req, neverNext)
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(calls.length, 1, 'approval event pushed')
      const pushed = JSON.parse(calls[0].options.body)
      assert.equal(pushed.kind, 'approval')
      assert.equal(pushed.reason, '需要执行 bash 命令')
      assert.equal(pushed.toolName, 'bash')
      calls.length = 0

      const statusRes = mockResponse()
      await invoke(api, mockRequest({ url: '/remote/api/status' }), statusRes)
      const statusBody = JSON.parse(statusRes.written.join(''))
      assert.equal(statusBody.value.approvals.length, 1, 'pending approval visible in status')

      const approveRes = mockResponse()
      await invoke(
        api,
        mockRequest({
          url: '/remote/api/command',
          method: 'POST',
          body: JSON.stringify({ action: 'approve', sessionId: 's2', outcome: 'allowed-once' }),
        }),
        approveRes,
      )
      assert.equal(approveRes.status, 200, 'remote approval accepted')
      const outcome = await approvalPromise
      assert.equal(outcome, 'allowed-once', 'approval request resolved allowed-once')
      calls.length = 0
    }

    // ── 闭环 3：end 事件下行 + 会话结束 fail-closed 清理 ─────────────
    {
      const req = { agent: topAgent('s3'), reason: 'x' }
      const approvalPromise = dispatchEvent(listeners, 'approval/request', req, () => new Promise(() => {}))
      await new Promise((resolve) => setTimeout(resolve, 10))
      // 会话结束（idle）→ pending approval fail-closed rejected + end 下行
      await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s3'), status: 'idle' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      // calls 含 approval 事件（1 次）与 end 事件（1 次）；最后一条为 end
      assert.equal(calls.length, 2, 'approval + end events pushed')
      assert.equal(JSON.parse(calls[calls.length - 1].options.body).kind, 'end')
      const outcome = await approvalPromise
      assert.equal(outcome, 'rejected', 'session end fails closed')
      calls.length = 0
    }

    // ── 闭环 4：审计可见（拒绝 + 令牌失败留痕） ──────────────────────
    {
      const auditRes = mockResponse()
      await invoke(api, mockRequest({ url: '/remote/api/audit' }), auditRes)
      const auditBody = JSON.parse(auditRes.written.join(''))
      assert.ok(auditBody.value.entries.length >= 2, 'answer/approve 审计已记录')
      assert.ok(
        auditBody.value.entries.some((e) => e.action === 'answer' && e.ok === true),
        'answer audited',
      )
      assert.ok(
        auditBody.value.entries.some((e) => e.action === 'approve' && e.ok === true),
        'approve audited',
      )
    }

    // min 1 explicit assertion per closure is guaranteed above
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()
    console.log('ALL REMOTE CONTROL INTEGRATION TESTS PASSED')
  } catch (err) {
    console.error(err)
    for (const disposeAll of disposeAlls.splice(0)) disposeAll()
    throw err
  } finally {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
}, 15_000)
