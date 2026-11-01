import { afterAll, test } from 'vitest'
/**
 * dsh-my-notify — webhook 配置 PUT → GET 往返测试（P0 集成回归）。
 *
 * 覆盖契约：
 *  - normalizeWebhook 保留全部新字段（titleTemplate / bodyTemplate / card /
 *    retry），设置页卡片设计器保存后不被清空；
 *  - msgType 按渠道白名单（feishu 支持 interactive，wecom/dingtalk 只 text /
 *    markdown，generic 恒 text），选 interactive 保存后不被改写成 text；
 *  - events 允许 subagentEnd（抽屉勾「子代理结束」不再 400）；
 *  - 坏值逐字段 fail-open（不抛错、不整条丢弃）：msgType / card.fields /
 *    retry.attempts / card.template 非法时回退默认值。
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-roundtrip-' }).name
  tmpDirs.push(dir)
  return dir
}

function mockResponse() {
  const res = {
    writeHeadStatus: 0,
    written: [],
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
    on() {},
    removeListener() {},
    body() {
      return JSON.parse(res.written.join(''))
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

/** 启动插件（mock ctx + 临时 DSH_HOME）。 */
function boot(config) {
  const home = tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    on() {
      return () => {}
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
    get() {
      return undefined
    },
  }
  apply(ctx, config)
  const api = routes.find((route) => route.path === '/notify/api' && route.kind === 'prefix')
  assert.ok(api, 'prefix route /notify/api registered')
  disposeAlls.push(() => {
    for (const dispose of disposers.splice(0)) dispose()
    process.env.DSH_HOME = oldHome
  })
  return { api }
}

async function invoke(api, request) {
  const response = mockResponse()
  await api.handler(request, response)
  return response
}

/** PUT webhooks → 返回 GET 回读的 webhooks[0]。 */
async function roundtrip(webhook) {
  const { api } = boot({})
  const put = await invoke(
    api,
    mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify({ webhooks: [webhook] }) }),
  )
  assert.equal(put.writeHeadStatus, 200, 'config save accepted')
  const get = await invoke(api, mockRequest({ url: '/notify/api/config' }))
  return get.body().value.webhooks[0]
}

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('notify webhook config roundtrip suite', async () => {
  // ── 1. 全字段往返：card / retry / titleTemplate / bodyTemplate / interactive ──
  {
    const saved = await roundtrip({
      name: '飞书卡片',
      channel: 'feishu',
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x',
      secret: 'sec',
      events: ['end', 'subagentEnd', 'remote'],
      enabled: true,
      msgType: 'interactive',
      template: '',
      titleTemplate: '提醒：{{session.title}}',
      bodyTemplate: '{{event.name}} · {{tokens.text}}',
      card: {
        schemaVersion: '1.0',
        template: 'red',
        fields: ['token', 'duration', 'bogus', 'tokens.text', 'token'],
        buttonText: '查看会话',
        mentionOpenIds: ['ou_a', '', 'bad id', 'ou_a'],
        mentionAll: true,
        accentByKind: false,
      },
      retry: { attempts: 2, backoffMs: 500 },
    })
    assert.deepEqual(saved, {
      name: '飞书卡片',
      channel: 'feishu',
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x',
      secret: 'sec',
      events: ['end', 'subagentEnd', 'remote'],
      enabled: true,
      msgType: 'interactive',
      template: '',
      titleTemplate: '提醒：{{session.title}}',
      bodyTemplate: '{{event.name}} · {{tokens.text}}',
      card: {
        schemaVersion: '1.0',
        template: 'red',
        fields: ['token', 'duration', 'tokens.text'],
        buttonText: '查看会话',
        mentionOpenIds: ['ou_a'],
        mentionAll: true,
        accentByKind: false,
      },
      retry: { attempts: 2, backoffMs: 500 },
    })
  }

  // ── 2. msgType 按渠道白名单：interactive 不被改写，非法值回 text ──────────
  {
    const feishu = await roundtrip({ name: 'f', channel: 'feishu', url: 'https://x/1', msgType: 'interactive' })
    assert.equal(feishu.msgType, 'interactive', 'feishu keeps interactive')
    const wecom = await roundtrip({ name: 'w', channel: 'wecom', url: 'https://x/2', msgType: 'interactive' })
    assert.equal(wecom.msgType, 'text', 'wecom rejects interactive')
    const dingtalk = await roundtrip({ name: 'd', channel: 'dingtalk', url: 'https://x/3', msgType: 'post' })
    assert.equal(dingtalk.msgType, 'text', 'dingtalk rejects post')
    const generic = await roundtrip({ name: 'g', channel: 'generic', url: 'https://x/4', msgType: 'markdown' })
    assert.equal(generic.msgType, 'text', 'generic is always text')
    const wecomMarkdown = await roundtrip({ name: 'wm', channel: 'wecom', url: 'https://x/5', msgType: 'markdown' })
    assert.equal(wecomMarkdown.msgType, 'markdown')
  }

  // ── 3. events 允许 subagentEnd；空模板回退 undefined（不落空串） ──────────
  {
    const saved = await roundtrip({
      name: 'e',
      channel: 'wecom',
      url: 'https://x/6',
      events: ['subagentEnd', 'ask', 'subagentEnd'],
      titleTemplate: '   ',
      bodyTemplate: '',
    })
    assert.deepEqual(saved.events, ['subagentEnd', 'ask'], 'subagentEnd accepted and deduped')
    assert.ok(!('titleTemplate' in saved), 'blank titleTemplate is dropped')
    assert.ok(!('bodyTemplate' in saved), 'blank bodyTemplate is dropped')
  }

  // ── 4. 坏值逐字段回退默认，不抛错、不整条丢弃 ────────────────────────────
  {
    const saved = await roundtrip({
      name: 'bad',
      channel: 'feishu',
      url: 'https://x/7',
      msgType: 'xxx',
      card: {
        schemaVersion: '9',
        template: 'rainbow',
        fields: ['token', 'hack', 42, '  ', 'tool'],
        buttonText: 5,
        mentionOpenIds: ['', 'a b', 'ou_ok'],
        mentionAll: 'yes',
        accentByKind: 'no',
      },
      retry: { attempts: 99, backoffMs: 1 },
    })
    assert.equal(saved.msgType, 'text', 'illegal msgType falls back to text')
    assert.deepEqual(saved.card, {
      schemaVersion: '2.0',
      template: '',
      fields: ['token', 'tool'],
      buttonText: '',
      mentionOpenIds: ['ou_ok'],
      mentionAll: false,
      accentByKind: true,
    })
    assert.deepEqual(saved.retry, { attempts: 5, backoffMs: 100 }, 'attempts clamped to 0..5, backoff to 100..60000')
  }

  // ── 4b. S1 自动配色：template '' / 缺省 → 保持「未指定」，不被写成 default ──
  {
    const auto = await roundtrip({
      name: 'auto',
      channel: 'feishu',
      url: 'https://x/9',
      msgType: 'interactive',
      card: { template: '', accentByKind: true },
    })
    assert.equal(auto.card.template, '', 'empty template stays unspecified (automatic color survives)')
    assert.equal(auto.card.accentByKind, true)
    const explicit = await roundtrip({
      name: 'explicit',
      channel: 'feishu',
      url: 'https://x/10',
      msgType: 'interactive',
      card: { template: 'default', accentByKind: true },
    })
    assert.equal(explicit.card.template, 'default', 'explicit default color is preserved as-is')
  }

  // ── 5. 未提供新字段时给出完整默认卡 + 默认重试（client 面板不缺字段） ────
  {
    const saved = await roundtrip({ name: 'old', channel: 'wecom', url: 'https://x/8' })
    assert.deepEqual(saved.card, {
      schemaVersion: '2.0',
      template: '',
      fields: [],
      buttonText: '',
      mentionOpenIds: [],
      mentionAll: false,
      accentByKind: true,
    })
    assert.deepEqual(saved.retry, { attempts: 3, backoffMs: 1000 })
    assert.equal(saved.msgType, 'text')
    assert.equal(saved.template, '')
  }

  console.log('ALL NOTIFY CONFIG ROUNDTRIP TESTS PASSED')
})
