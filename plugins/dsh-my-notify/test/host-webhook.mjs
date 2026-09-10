import { test } from 'vitest'
/**
 * dsh-my-notify — 出站 webhook 集成测试（issue #92）。
 *
 * 验证端到端闭环：
 *  - 事件（end/ask/approval/remote）触发时按配置推送到 webhook（mock
 *    global fetch 记录调用，断言 URL/消息体/签名参数）；
 *  - GET /notify/api/config 返回 webhooks；PUT 保存（校验 + 规整）；
 *  - webhooks 持久化到独立 JSON 文件（patch YAML 子集无法表达对象数组），
 *    模拟重启后恢复；patch 文件不含 webhooks 字段；
 *  - GET /notify/api/webhooks 返回 webhooks + 失败记录（重试耗尽后可见）；
 *  - 非法 webhooks 输入 400；失败记录环形缓冲上限。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { createFailureLog, FAILURE_LOG_LIMIT } from '../lib/webhook-store.js'
import { patchFileOf } from 'dsh-shared'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-my-notify-webhook-'))
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
    closeHandlers: [],
    writeHead(status) {
      res.writeHeadStatus = status
    },
    write(chunk) {
      res.written.push(String(chunk))
      return true
    },
    end(value) {
      if (value !== undefined) res.written.push(String(value))
    },
    destroy() {},
    on(_event, handler) {
      if (_event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    emitClose() {
      for (const h of res.closeHandlers.splice(0)) h()
    },
  }
  return res
}

function mockRequest({ url, method = 'GET', host = '127.0.0.1:3080', body = '' } = {}) {
  return {
    url,
    method,
    headers: { host },
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

/** Boot the plugin with a mocked ctx; DSH_HOME points at dir. */
function boot(config, dir) {
  const home = dir ?? tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const listeners = {}
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {} },
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
      assert.equal(typeof dispose, 'function', 'every ctx.effect must return a disposer')
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
      if (name === 'sessionTitle') return ctx.sessionTitle
      if (name === 'webRuntime') return undefined
      return undefined
    },
    sessionTitle: {
      get(session) {
        return session?.__title === undefined ? {} : { title: session.__title }
      },
    },
  }
  apply(ctx, config)
  const api = routes.find((r) => r.path === '/notify/api' && r.kind === 'prefix')
  assert.ok(api, 'prefix route /notify/api registered')
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  }
  disposeAlls.push(disposeAll)
  return { ctx, listeners, api, home, disposeAll }
}

async function invoke(api, request, response) {
  await api.handler(request, response)
  return response
}

async function dispatchEvent(listeners, name, ...args) {
  for (const handler of [...(listeners[name] ?? [])]) {
    await handler(...args)
  }
}

const topAgent = (id) => ({
  id,
  session: { header: { cwd: '/work/alpha' }, __title: `标题-${id}` },
})

/** 等待异步 webhook 推送完成（fire-and-forget 成功路径）。 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

/** 覆盖 global fetch 的 mock（记录调用，返回固定响应）。 */
function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return handler(url, options)
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

/**
 * 精确提取 URL 的 host（CodeQL js/incomplete-url-substring-sanitization）。
 * 不能用 substring（startsWith/includes）判断 URL 是否属于可信主机——攻击者可用
 * `https://evil.com/https://qyapi.weixin.qq.com` 之类构造绕过；必须 new URL().host 精确匹配。
 */
function urlHost(url) {
  return new URL(url).host
}

// 测试 7 需等待真实重试退避（≈7s），默认 20s 超时在高负载下会偶发超时
// （实测：本机并发跑 3 个迁移 agent 时该用例耗时 900s+ → flaky 让 CI 随机红），
// 显式放宽到 120s，只影响"等多久算超时"，不改变任何断言。
test(
  'webhook integration suite',
  { timeout: 120_000 },
  async () => {
    try {
      // ── 1. 事件触发推送：end 事件 → 匹配 webhook 收到推送 ──────────────
      {
        const webhooks = [
          {
            name: '企微-工作群',
            channel: 'wecom',
            url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
            events: ['end'],
            enabled: true,
          },
          { name: '只收审批', channel: 'generic', url: 'https://b.example/hook', events: ['approval'], enabled: true },
        ]
        const { listeners } = boot({ webhooks })
        const mock = installFetch(() => ({ ok: true }))
        try {
          await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
          await flush()
          assert.equal(mock.calls.length, 1, 'only the end-matching webhook is pushed')
          assert.equal(urlHost(mock.calls[0].url), 'qyapi.weixin.qq.com', 'wecom URL used')
          const body = JSON.parse(mock.calls[0].options.body)
          assert.equal(body.msgtype, 'text')
          assert.ok(body.text.content.includes('标题-s1'), 'message carries the session title')
          assert.ok(body.text.content.includes('会话已结束'), 'message carries the event label')
        } finally {
          mock.restore()
        }
      }

      // ── 2. ask 事件推送（飞书签名进 body） ──────────────────────────────
      {
        const webhooks = [
          {
            name: '飞书',
            channel: 'feishu',
            secret: 'sec-1',
            url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x',
            events: ['ask'],
            enabled: true,
          },
        ]
        const { listeners } = boot({ webhooks })
        const mock = installFetch(() => ({ ok: true }))
        try {
          await dispatchEvent(
            listeners,
            'tools/pre-execute',
            { name: 'ask_user_question', agent: topAgent('a1'), arguments: { questions: [{ header: '确认部署' }] } },
            async () => {},
          )
          await flush()
          assert.equal(mock.calls.length, 1, 'ask event pushed')
          const body = JSON.parse(mock.calls[0].options.body)
          assert.equal(body.msg_type, 'text')
          assert.ok(body.content.text.includes('需要你回答：问题 1：确认部署'), 'ask carries the full question')
          assert.equal(typeof body.timestamp, 'string', 'feishu sign timestamp in body')
          assert.equal(typeof body.sign, 'string', 'feishu sign in body')
        } finally {
          mock.restore()
        }
      }

      // ── 3. remote 事件（trigger 路由）推送 ─────────────────────────────
      {
        const webhooks = [
          {
            name: '通用',
            channel: 'generic',
            url: 'https://relay.example.com/hook',
            events: ['remote'],
            enabled: true,
          },
        ]
        const { api } = boot({ webhooks })
        const mock = installFetch(() => ({ ok: true }))
        try {
          const res = mockResponse()
          await invoke(
            api,
            mockRequest({
              url: '/notify/api/trigger',
              method: 'POST',
              body: JSON.stringify({ title: 'CI 完成', body: '构建成功' }),
            }),
            res,
          )
          assert.equal(res.writeHeadStatus, 200, 'trigger accepted')
          await flush()
          assert.equal(mock.calls.length, 1, 'remote event pushed to generic webhook')
          const body = JSON.parse(mock.calls[0].options.body)
          assert.equal(body.kind, 'remote')
          assert.equal(body.title, 'CI 完成')
          assert.equal(body.note, '构建成功')
        } finally {
          mock.restore()
        }
      }

      // ── 3b. end 事件推送携带 token 消耗/耗时/会话链接（issue #109） ─────
      {
        const webhooks = [
          {
            name: '企微-富字段',
            channel: 'wecom',
            url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
            events: ['end'],
            enabled: true,
          },
        ]
        const { listeners } = boot({ webhooks, webBaseUrl: 'https://dsh.local/' })
        const mock = installFetch(() => ({ ok: true }))
        try {
          // 先计量会话 token（assistant/message 真实 usage）
          await dispatchEvent(
            listeners,
            'session/event',
            { id: 's1' },
            { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 50 } } },
          )
          await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
          await flush()
          assert.equal(mock.calls.length, 1, 'end webhook pushed')
          const body = JSON.parse(mock.calls[0].options.body)
          assert.ok(body.text.content.includes('标题-s1'), 'carries the session title')
          assert.ok(body.text.content.includes('会话已结束'), 'carries the event label')
          assert.ok(body.text.content.includes('token 消耗：输入 100 / 输出 50 / 总计 150'), 'token usage carried')
          assert.ok(body.text.content.includes('会话耗时：'), 'duration carried')
          assert.ok(body.text.content.includes('会话链接：https://dsh.local/sessions/s1'), 'session link carried')
        } finally {
          mock.restore()
        }
      }

      // ── 3b2. webBaseUrl 尾斜杠边界 → sessionUrl 语义不变（修复 CodeQL js/polynomial-redos，告警 #12） ──
      {
        const cases = [
          // 无尾斜杠：原串返回
          { webBaseUrl: 'https://dsh.local', expected: 'https://dsh.local/sessions/s1' },
          // 单尾斜杠：去掉
          { webBaseUrl: 'https://dsh.local/', expected: 'https://dsh.local/sessions/s1' },
          // 多尾斜杠：全部去掉
          { webBaseUrl: 'https://dsh.local///', expected: 'https://dsh.local/sessions/s1' },
          // 纯斜杠串：base 为空 → 相对路径会话链接
          { webBaseUrl: '///', expected: '/sessions/s1' },
          // 只含查询串（无尾斜杠）：原串返回
          { webBaseUrl: '?x=1', expected: '?x=1/sessions/s1' },
          // 空串：不产出会话链接（模板变量可回退）
          { webBaseUrl: '', expected: '' },
        ]
        for (const { webBaseUrl, expected } of cases) {
          const webhooks = [
            {
              name: 'generic-边界',
              channel: 'generic',
              url: 'https://g.example/hook',
              events: ['end'],
              enabled: true,
            },
          ]
          const { listeners } = boot({ webhooks, webBaseUrl })
          const mock = installFetch(() => ({ ok: true }))
          try {
            await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
            await flush()
            assert.equal(mock.calls.length, 1, `webBaseUrl=${JSON.stringify(webBaseUrl)} pushes end webhook`)
            const body = JSON.parse(mock.calls[0].options.body)
            assert.equal(body.sessionUrl, expected, `webBaseUrl=${JSON.stringify(webBaseUrl)} produces sessionUrl`)
          } finally {
            mock.restore()
          }
        }
      }

      // ── 3c. 模板变量渲染推送到 webhook（issue #109） ────────────────────
      {
        const webhooks = [
          {
            name: '模板',
            channel: 'wecom',
            url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
            events: ['ask'],
            enabled: true,
            template: '**{title}**\n{kind}\n{question}\n{note}',
          },
        ]
        const { listeners } = boot({ webhooks })
        const mock = installFetch(() => ({ ok: true }))
        try {
          await dispatchEvent(
            listeners,
            'tools/pre-execute',
            {
              name: 'ask_user_question',
              agent: topAgent('a2'),
              arguments: { questions: [{ question: '请回答这个问题' }] },
            },
            async () => {},
          )
          await flush()
          assert.equal(mock.calls.length, 1, 'ask webhook pushed via template')
          const body = JSON.parse(mock.calls[0].options.body)
          assert.equal(body.msgtype, 'text', 'template channel renders as text')
          assert.equal(
            body.text.content,
            '**标题-a2**\n需要你回答\n问题 1：请回答这个问题\n请回答这个问题',
            'template vars rendered',
          )
        } finally {
          mock.restore()
        }
      }

      // ── 4. GET /config 返回 webhooks（默认空数组） ─────────────────────
      {
        const { api } = boot({})
        const res = mockResponse()
        await invoke(api, mockRequest({ url: '/notify/api/config' }), res)
        const body = JSON.parse(res.written.join(''))
        assert.deepEqual(body.value.webhooks, [], 'default webhooks is an empty array')
      }

      // ── 5. PUT /config 保存 webhooks → GET 读回 + 规整 ────────────────
      {
        const { api } = boot({})
        const put = mockResponse()
        await invoke(
          api,
          mockRequest({
            url: '/notify/api/config',
            method: 'PUT',
            body: JSON.stringify({
              webhooks: [
                {
                  name: '企微',
                  channel: 'wecom',
                  url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
                  secret: 's',
                  events: ['end', 'ask', 'end'],
                  enabled: true,
                  msgType: 'markdown',
                },
              ],
            }),
          }),
          put,
        )
        assert.equal(put.writeHeadStatus, 200, 'webhooks saved')
        const get = mockResponse()
        await invoke(api, mockRequest({ url: '/notify/api/config' }), get)
        const body = JSON.parse(get.written.join(''))
        assert.deepEqual(
          body.value.webhooks,
          [
            {
              name: '企微',
              channel: 'wecom',
              url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
              secret: 's',
              events: ['end', 'ask'],
              enabled: true,
              msgType: 'markdown',
              template: '',
            },
          ],
          'events deduped, defaults filled',
        )
      }

      // ── 6. 持久化：JSON 文件写入；patch 文件不含 webhooks；重启恢复 ────
      {
        const { api, home, disposeAll } = boot({})
        const saved = [
          {
            name: '钉钉',
            channel: 'dingtalk',
            url: 'https://oapi.dingtalk.com/robot/send?access_token=t',
            secret: 'sec',
            events: ['approval'],
            enabled: true,
            msgType: 'text',
            template: '',
          },
        ]
        const put = mockResponse()
        await invoke(
          api,
          mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify({ webhooks: saved }) }),
          put,
        )
        assert.equal(put.writeHeadStatus, 200)
        const webhookFile = join(home, 'profiles', 'web', 'notify-webhooks.json')
        assert.ok(existsSync(webhookFile), 'webhooks JSON file written')
        assert.deepEqual(JSON.parse(readFileSync(webhookFile, 'utf8')), saved, 'JSON file carries the saved webhooks')
        const patchText = readFileSync(patchFileOf('web'), 'utf8')
        assert.ok(!patchText.includes('webhooks'), 'patch file must not contain the webhooks field')
        disposeAll()

        // 模拟重启：同一 DSH_HOME 重新 apply → webhooks 恢复
        const oldHome = process.env.DSH_HOME
        process.env.DSH_HOME = home
        const { api: api2 } = boot({}, home)
        process.env.DSH_HOME = oldHome
        const get = mockResponse()
        await invoke(api2, mockRequest({ url: '/notify/api/config' }), get)
        const body = JSON.parse(get.written.join(''))
        assert.deepEqual(body.value.webhooks, saved, 'webhooks survive a simulated restart')
      }

      // ── 7. GET /notify/api/webhooks 返回列表 + 失败记录（重试耗尽后） ──
      {
        const webhooks = [
          { name: 'w', channel: 'generic', url: 'https://a.example/hook', events: ['end'], enabled: true },
        ]
        const { api, listeners } = boot({ webhooks })
        const mock = installFetch(() => {
          throw new Error('boom')
        })
        try {
          await dispatchEvent(listeners, 'agent/status', { agent: topAgent('f1'), status: 'idle' })
          // 失败记录只在重试耗尽（1s+2s+4s ≈ 7s）后写入：轮询等待出现
          const deadline = Date.now() + 12_000
          let failures = []
          while (Date.now() < deadline) {
            const res = mockResponse()
            await invoke(api, mockRequest({ url: '/notify/api/webhooks' }), res)
            const body = JSON.parse(res.written.join(''))
            assert.deepEqual(body.value.webhooks, webhooks, 'webhooks listed')
            failures = body.value.failures
            if (failures.length > 0) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          assert.equal(failures.length, 1, 'one failure recorded after retries exhausted')
          assert.equal(failures[0].webhookName, 'w')
          assert.equal(failures[0].error, 'boom')
        } finally {
          mock.restore()
        }
      }

      // ── 8. 非法 webhooks 输入 → 400 ────────────────────────────────────
      {
        const { api } = boot({})
        const badChannel = mockResponse()
        await invoke(
          api,
          mockRequest({
            url: '/notify/api/config',
            method: 'PUT',
            body: JSON.stringify({ webhooks: [{ name: 'x', channel: 'slack', url: 'https://a' }] }),
          }),
          badChannel,
        )
        assert.equal(badChannel.writeHeadStatus, 400, 'unknown channel rejected')

        const noName = mockResponse()
        await invoke(
          api,
          mockRequest({
            url: '/notify/api/config',
            method: 'PUT',
            body: JSON.stringify({ webhooks: [{ channel: 'wecom', url: 'https://a' }] }),
          }),
          noName,
        )
        assert.equal(noName.writeHeadStatus, 400, 'missing name rejected')

        const badEvent = mockResponse()
        await invoke(
          api,
          mockRequest({
            url: '/notify/api/config',
            method: 'PUT',
            body: JSON.stringify({ webhooks: [{ name: 'x', channel: 'wecom', url: 'https://a', events: ['cron'] }] }),
          }),
          badEvent,
        )
        assert.equal(badEvent.writeHeadStatus, 400, 'unknown event rejected')

        const notArray = mockResponse()
        await invoke(
          api,
          mockRequest({
            url: '/notify/api/config',
            method: 'PUT',
            body: JSON.stringify({ webhooks: { name: 'x' } }),
          }),
          notArray,
        )
        assert.equal(notArray.writeHeadStatus, 400, 'non-array webhooks rejected')
      }

      // ── 9. 失败记录环形缓冲：超限丢最旧 ────────────────────────────────
      {
        const log = createFailureLog(3)
        for (let i = 0; i < 5; i += 1) log.add({ time: i, webhookName: `w${i}` })
        const list = log.list()
        assert.equal(list.length, 3, 'buffer capped')
        assert.deepEqual(
          list.map((f) => f.time),
          [2, 3, 4],
          'oldest entries dropped',
        )
        assert.equal(FAILURE_LOG_LIMIT, 50, 'default limit is 50')
      }

      // 清理
      for (const disposeAll of disposeAlls.splice(0)) disposeAll()

      console.log('ALL WEBHOOK INTEGRATION TESTS PASSED')
    } catch (err) {
      console.error(err)
      for (const disposeAll of disposeAlls.splice(0)) disposeAll()
      throw err
    } finally {
      for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    }
  },
  20_000,
)

// ── 10. URL host 精确校验：substring 检查可被构造 URL 绕过，host 精确匹配须拒绝 ──
test('URL host sanitization rejects bypass (CodeQL js/incomplete-url-substring-sanitization)', () => {
  const TRUSTED_HOST = 'qyapi.weixin.qq.com'
  const isTrustedUrl = (url) => {
    try {
      return urlHost(url) === TRUSTED_HOST
    } catch {
      return false
    }
  }

  // 可信主机：正常通过
  assert.ok(isTrustedUrl('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc'), 'trusted wecom URL')
  assert.ok(isTrustedUrl('https://qyapi.weixin.qq.com/'), 'trusted wecom root')

  // 绕过场景：若用 substring/startsWith 判断会误判为可信，host 精确匹配必须全部拒绝
  assert.ok(!isTrustedUrl('http://evil.com/qyapi.weixin.qq.com'), 'path trick rejected')
  assert.ok(!isTrustedUrl('https://qyapi.weixin.qq.com.evil.com/hook'), 'suffix host trick rejected')
  assert.ok(!isTrustedUrl('https://evil.com/?next=https://qyapi.weixin.qq.com'), 'query trick rejected')
  assert.ok(!isTrustedUrl('https://qyapi.weixin.qq.com@evil.com/hook'), 'userinfo trick rejected')

  // 畸形 URL 安全地返回失败而不是抛错
  assert.ok(!isTrustedUrl('not a url'), 'malformed url safely rejected')
})
