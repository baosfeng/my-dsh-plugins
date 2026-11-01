import { afterAll, test } from 'vitest'
/**
 * dsh-my-notify — 变量目录 / 预览接口 / 配置模型扩展 集成测试。
 *
 * 覆盖契约：
 *  - GET  /notify/api/variables 返回变量目录（分组 / 名称 / 说明 / 示例）；
 *  - POST /notify/api/preview 返回 { ok: true, value: { card, text, vars } }，
 *    支持 sample 覆盖与 card 配置（2.0 / 1.0、配色、字段、@、按钮）；
 *  - GET /notify/api/config 返回全部新字段（sound / toast / system / messages），
 *    PUT 坏字段 fail-open（回退默认值而不是整批失败）；
 *  - 服务端广播前渲染：messages 模板改写 SSE 帧的 title / note（含 subagentEnd）；
 *  - 远程触发：显式 title / body 优先于 messages.remote 模板；
 *  - 旧配置兼容：旧 template / {var} 语法与旧 webhook 形状继续工作。
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { dirSync } from 'tmp'
import { apply } from '../lib/index.js'
import { formatMessage } from '../lib/webhook/adapters.js'
import { formatChannelMessage } from '../lib/notify/channels.js'

const tmpDirs = []
const disposeAlls = []

function tempDir() {
  const dir = dirSync({ unsafeCleanup: true, prefix: 'dsh-my-notify-preview-' }).name
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
    on(event, handler) {
      if (event === 'close') res.closeHandlers.push(handler)
    },
    removeListener() {},
    body() {
      return JSON.parse(res.written.join(''))
    },
    frames() {
      return res.written.filter((chunk) => chunk.startsWith('data: ')).map((chunk) => JSON.parse(chunk.slice(6)))
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
function boot(config, dir) {
  const home = dir ?? tempDir()
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const listeners = {}
  const routes = []
  const disposers = []
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    on(name, handler) {
      ;(listeners[name] ??= []).push(handler)
      return () => {
        const list = listeners[name]
        const idx = list === undefined ? -1 : list.indexOf(handler)
        if (idx !== -1) list.splice(idx, 1)
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
  return { ctx, listeners, api, home }
}

async function invoke(api, request, response = mockResponse()) {
  await api.handler(request, response)
  return response
}

async function dispatchEvent(listeners, name, ...args) {
  for (const handler of [...(listeners[name] ?? [])]) await handler(...args)
}

const topAgent = (id) => ({ id, session: { header: { cwd: '/work/alpha' }, __title: `标题-${id}` } })

const notice = { kind: 'end', sessionId: 's1', title: '标题', note: '摘要', agentType: 'top', time: 1700000000000 }

afterAll(() => {
  for (const dispose of disposeAlls.splice(0)) dispose()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('notify variables / preview / config suite', async () => {
  // ── 1. GET /notify/api/variables：分组目录 ─────────────────────────────
  {
    const { api } = boot({})
    const res = await invoke(api, mockRequest({ url: '/notify/api/variables' }))
    assert.equal(res.writeHeadStatus, 200)
    const body = res.body()
    assert.equal(body.ok, true)
    assert.equal(body.value.length, 7, 'seven variable groups')
    const session = body.value.find((group) => group.group === 'session')
    assert.ok(
      session.items.some((item) => item.name === 'session.title'),
      'session.title catalogued',
    )
    const item = session.items.find((entry) => entry.name === 'session.title')
    assert.equal(typeof item.description, 'string')
    assert.equal(typeof item.example, 'string')
  }

  // ── 2. POST preview：默认样例（end）返回 { card, text, vars } ──────────
  {
    const { api } = boot({})
    const res = await invoke(
      api,
      mockRequest({ url: '/notify/api/preview', method: 'POST', body: JSON.stringify({ kind: 'end' }) }),
    )
    assert.equal(res.writeHeadStatus, 200)
    const body = res.body()
    assert.equal(body.ok, true)
    assert.equal(body.value.card.schema, '2.0')
    assert.equal(body.value.card.header.title.content, '演示项目')
    assert.equal(body.value.vars['session.title'], '演示项目')
    assert.equal(body.value.vars['tokens.total'], '2000')
    assert.equal(body.value.vars['notify.channel'], 'feishu')
    assert.ok(body.value.text.includes('会话已结束'), 'text carries the event label')
    assert.equal(body.value.card.header.template, 'green', 'automatic color by kind (end → green)')
    assert.ok(body.value.text.includes('token 消耗'), 'text carries rich end fields')
  }

  // ── 3. preview sample 覆盖：标题 / 问题 / 耗时 ─────────────────────────
  {
    const { api } = boot({})
    const res = await invoke(
      api,
      mockRequest({
        url: '/notify/api/preview',
        method: 'POST',
        body: JSON.stringify({
          kind: 'ask',
          sample: { title: '自定义会话', question: '部署吗？', questions: ['部署吗？'] },
        }),
      }),
    )
    const value = res.body().value
    assert.equal(value.vars['session.title'], '自定义会话')
    assert.equal(value.card.header.title.content, '自定义会话')
    assert.equal(value.vars['ask.count'], '1')
    assert.ok(value.text.includes('部署吗？'))
    assert.ok(value.card.header.template === 'blue', 'preview keeps the kind color')
  }

  // ── 4. preview card 配置：1.0 / 显式配色 / 字段裁剪 / @ / 按钮 ──────────
  {
    const { api } = boot({})
    const res = await invoke(
      api,
      mockRequest({
        url: '/notify/api/preview',
        method: 'POST',
        body: JSON.stringify({
          kind: 'end',
          card: {
            schemaVersion: '1.0',
            template: 'red',
            fields: ['tokens.text', 'session.model', 'nope.var'],
            buttonText: '查看会话',
            mentionOpenIds: ['ou_demo', ''],
          },
        }),
      }),
    )
    const card = res.body().value.card
    assert.equal(card.config.wide_screen_mode, true)
    assert.ok(Array.isArray(card.elements), '1.0 elements at top level')
    assert.equal(card.header.template, 'red')
    const contents = card.elements.filter((el) => typeof el.text?.content === 'string').map((el) => el.text.content)
    assert.ok(
      contents.some((line) => line.includes('Token 消耗')),
      'field label mapped from variable name',
    )
    assert.ok(
      contents.some((line) => line.includes('模型')),
      'second field rendered',
    )
    assert.ok(!contents.some((line) => line.includes('nope.var')), 'unknown variable dropped')
    assert.ok(
      contents.some((line) => line.includes('ou_demo')),
      'open_id mention rendered',
    )
    assert.ok(!contents.some((line) => line.includes('id=>')), 'empty mention stripped')
    const action = card.elements.find((el) => el.tag === 'action')
    assert.equal(action.actions[0].behaviors[0].default_url, 'https://dsh.local/sessions/ses_demo')
  }

  // ── 5. preview 模板：titleTemplate / bodyTemplate + 未知 kind 回退 ─────
  {
    const { api } = boot({})
    const res = await invoke(
      api,
      mockRequest({
        url: '/notify/api/preview',
        method: 'POST',
        body: JSON.stringify({
          kind: 'bogus',
          titleTemplate: 'T: {{session.title}}',
          bodyTemplate: 'B: {{event.name}} / {{session.durationText}}',
        }),
      }),
    )
    const value = res.body().value
    assert.equal(value.card.header.title.content, 'T: 演示项目')
    assert.equal(value.text, 'B: 会话已结束 / 1 分 23 秒')
  }

  // ── 6. GET config 包含全部新字段；PUT 坏字段 fail-open ────────────────
  {
    const { api } = boot({})
    const defaults = (await invoke(api, mockRequest({ url: '/notify/api/config' }))).body().value
    assert.deepEqual(defaults.sound, { enabled: true, preset: 'chime', volume: 0.6 })
    assert.deepEqual(defaults.toast, { enabled: true, durationMs: 4000, position: 'top-right', maxStack: 3 })
    assert.deepEqual(defaults.system, { enabled: true, requireInteraction: false })
    assert.equal(defaults.messages.end.title, '{{session.title}}')
    assert.ok(defaults.messages.subagentEnd !== undefined && defaults.messages.remote !== undefined)

    const put = await invoke(
      api,
      mockRequest({
        url: '/notify/api/config',
        method: 'PUT',
        body: JSON.stringify({
          sound: { enabled: 'yes', volume: 9, preset: '' },
          toast: { position: 'middle', maxStack: 99, durationMs: 10 },
          system: { requireInteraction: 'yes' },
          messages: { end: { title: '结束', body: '' }, ask: 'oops' },
        }),
      }),
    )
    assert.equal(put.writeHeadStatus, 200, 'invalid nested fields never reject the whole save')
    const next = (await invoke(api, mockRequest({ url: '/notify/api/config' }))).body().value
    // 预设白名单 chime|drop|deep：非法值回默认 chime（与 client 实播音色一致）
    assert.deepEqual(next.sound, { enabled: true, preset: 'chime', volume: 1 })
    assert.deepEqual(next.toast, { enabled: true, durationMs: 1000, position: 'top-right', maxStack: 10 })
    assert.deepEqual(next.system, { enabled: true, requireInteraction: false })
    assert.deepEqual(next.messages.end, { title: '结束', body: '{{event.note}}' })
    assert.equal(next.messages.ask.title, '{{session.title}}', 'invalid ask template keeps default')
  }

  // ── 7. 广播前渲染：messages 模板改写 SSE 帧 title / note（含 subagentEnd）──
  {
    const { api, listeners } = boot({
      subagentEnd: true,
      messages: {
        end: { title: '结束：{{session.title}}', body: '{{event.name}}' },
        subagentEnd: { title: '子代理完成' },
      },
    })
    const stream = await invoke(api, mockRequest({ url: '/notify/api/stream' }))
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('s1'), status: 'idle' })
    const top = stream.frames().at(-1)
    assert.equal(top.title, '结束：alpha', 'top-level end uses the end template (cwd basename fallback)')
    assert.equal(top.note, '会话已结束')
    await dispatchEvent(listeners, 'agent/status', {
      agent: { id: 'sub1', session: { header: { cwd: '/work/sub', origin: 'subagent' }, __title: '子' } },
      status: 'idle',
    })
    assert.equal(stream.frames().at(-1).title, '子代理完成', 'subagent end uses the subagentEnd template')
  }

  // ── 8. 远程触发：显式 title / body 优先于 messages.remote 模板 ─────────
  {
    const { api, listeners } = boot({ messages: { remote: { title: '模板标题', body: '模板正文' } } })
    const stream = await invoke(api, mockRequest({ url: '/notify/api/stream' }))
    const explicit = await invoke(
      api,
      mockRequest({
        url: '/notify/api/trigger',
        method: 'POST',
        body: JSON.stringify({ title: 'CI 完成', body: '构建成功', sessionId: 'r1' }),
      }),
    )
    assert.equal(explicit.writeHeadStatus, 200)
    assert.equal(stream.frames().at(-1).title, 'CI 完成', 'explicit title wins over the template')
    assert.equal(stream.frames().at(-1).note, '构建成功', 'explicit body wins over the template')
    await dispatchEvent(listeners, 'agent/status', { agent: topAgent('noop'), status: 'idle' })
    await invoke(
      api,
      mockRequest({ url: '/notify/api/trigger', method: 'POST', body: JSON.stringify({ sessionId: 'r2' }) }),
    )
    assert.equal(stream.frames().at(-1).title, '模板标题', 'without explicit values the template applies')
  }

  // ── 9. 渠道高级格式化：飞书 interactive / 模板字段 / 旧配置兼容 ────────
  {
    const interactive = formatChannelMessage(
      { name: 'f', channel: 'feishu', url: 'https://open.feishu.cn/hook/x', msgType: 'interactive' },
      { ...notice, sessionUrl: 'https://dsh.local/sessions/s1', tokens: { input: 1, output: 2, total: 3 } },
    )
    assert.equal(interactive.msg_type, 'interactive')
    assert.equal(interactive.card.schema, '2.0')
    assert.equal(interactive.card.header.title.content, '标题')
    assert.equal(interactive.card.header.template, 'green')

    // 设置页卡片设计器的短键字段（token / duration / tool / question / link）
    // 在真实推送时映射回模板变量，不能因短键查不到变量而被裁掉
    const designed = formatChannelMessage(
      {
        name: 'f',
        channel: 'feishu',
        url: 'https://open.feishu.cn/hook/y',
        msgType: 'interactive',
        card: { fields: ['token', 'duration', 'link'] },
      },
      {
        ...notice,
        duration: 83,
        sessionUrl: 'https://dsh.local/sessions/s1',
        tokens: { input: 1, output: 2, total: 3 },
      },
    )
    const designedLines = designed.card.body.elements
      .filter((el) => typeof el.text?.content === 'string')
      .map((el) => el.text.content)
    assert.ok(
      designedLines.some((line) => line.includes('Token 消耗')),
      'short key token → tokens.text',
    )
    assert.ok(
      designedLines.some((line) => line.includes('会话耗时')),
      'short key duration → session.durationText',
    )
    assert.ok(
      designedLines.some((line) => line.includes('会话链接')),
      'short key link → session.url',
    )

    const templated = formatChannelMessage(
      {
        name: 'w',
        channel: 'wecom',
        url: 'https://qyapi.weixin.qq.com/hook',
        titleTemplate: '提醒：{{session.title}}',
        bodyTemplate: '{{event.name}} · {{tokens.text}}',
      },
      { ...notice, tokens: { input: 1, output: 2, total: 3 } },
    )
    assert.equal(templated.text.content, '会话已结束 · 输入 1 / 输出 2 / 总计 3')

    // 旧配置（template + {var} 旧语法）逐字兼容
    const legacy = formatMessage(
      {
        name: 'w',
        channel: 'wecom',
        url: 'https://qyapi.weixin.qq.com/hook',
        msgType: 'markdown',
        template: '**{title}**\n{kind}',
      },
      notice,
    )
    assert.equal(legacy.markdown.content, '**标题**\n会话已结束')
  }

  // ── 10. 旧 webhook 配置：PUT 保存仍成功，GET 回读字段不变 ──────────────
  {
    const { api } = boot({})
    const oldConfig = {
      webhooks: [
        {
          name: 'legacy',
          channel: 'wecom',
          url: 'https://qyapi.weixin.qq.com/hook',
          events: ['end'],
          enabled: true,
          msgType: 'text',
          template: '',
        },
      ],
    }
    const put = await invoke(
      api,
      mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify(oldConfig) }),
    )
    assert.equal(put.writeHeadStatus, 200, 'legacy webhook config still saves')
    const saved = (await invoke(api, mockRequest({ url: '/notify/api/config' }))).body().value.webhooks
    assert.equal(saved[0].name, 'legacy')
    assert.equal(saved[0].channel, 'wecom')
    assert.deepEqual(saved[0].events, ['end'])
  }

  // ── 11. S1 自动配色：template '' + accentByKind → 按 kind 取色（保存前后一致）──
  {
    const { api } = boot({})
    const cases = [
      ['end', 'green'],
      ['ask', 'blue'],
      ['approval', 'orange'],
      ['remote', 'grey'],
      ['subagentEnd', 'violet'],
    ]
    for (const [kind, color] of cases) {
      const res = await invoke(
        api,
        mockRequest({
          url: '/notify/api/preview',
          method: 'POST',
          body: JSON.stringify({ kind, card: { template: '', accentByKind: true } }),
        }),
      )
      assert.equal(res.body().value.card.header.template, color, `${kind} keeps automatic color`)
    }
    const explicit = await invoke(
      api,
      mockRequest({
        url: '/notify/api/preview',
        method: 'POST',
        body: JSON.stringify({ kind: 'end', card: { template: 'default', accentByKind: true } }),
      }),
    )
    assert.equal(explicit.body().value.card.header.template, 'default', 'explicit default color is not rewritten')
    const disabled = await invoke(
      api,
      mockRequest({
        url: '/notify/api/preview',
        method: 'POST',
        body: JSON.stringify({ kind: 'approval', card: { template: '', accentByKind: false } }),
      }),
    )
    assert.equal(disabled.body().value.card.header.template, 'default', 'accentByKind=false disables automatic color')
  }

  // ── 12. S2 会话链接：ask / approval / remote 三条路径都填 sessionUrl ─────
  {
    const { api, listeners } = boot({ webBaseUrl: 'http://dsh.local' })
    const stream = await invoke(api, mockRequest({ url: '/notify/api/stream' }))
    await dispatchEvent(
      listeners,
      'tools/pre-execute',
      { name: 'ask_user_question', agent: topAgent('a1'), arguments: { questions: [{ question: '部署？' }] } },
      async () => {},
    )
    assert.equal(stream.frames().at(-1).sessionUrl, 'http://dsh.local/sessions/a1', 'ask carries the session link')
    await dispatchEvent(
      listeners,
      'approval/request',
      { agent: topAgent('p1'), reason: '原因', toolName: 'bash' },
      async () => {},
    )
    assert.equal(stream.frames().at(-1).sessionUrl, 'http://dsh.local/sessions/p1', 'approval carries the session link')
    await invoke(
      api,
      mockRequest({
        url: '/notify/api/trigger',
        method: 'POST',
        body: JSON.stringify({ body: 'ok', sessionId: 'r9' }),
      }),
    )
    assert.equal(stream.frames().at(-1).sessionUrl, 'http://dsh.local/sessions/r9', 'remote carries the session link')
    for (const frame of stream.frames()) assert.ok(typeof frame.sessionUrl === 'string')
  }

  // ── 13. S3 提示音预设白名单：chime|drop|deep，非法值回 chime ─────────────
  {
    const { api } = boot({})
    const put = await invoke(
      api,
      mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify({ sound: { preset: 'drop' } }) }),
    )
    assert.equal(put.writeHeadStatus, 200)
    assert.equal((await invoke(api, mockRequest({ url: '/notify/api/config' }))).body().value.sound.preset, 'drop')
    await invoke(
      api,
      mockRequest({ url: '/notify/api/config', method: 'PUT', body: JSON.stringify({ sound: { preset: 'mp3' } }) }),
    )
    assert.equal(
      (await invoke(api, mockRequest({ url: '/notify/api/config' }))).body().value.sound.preset,
      'chime',
      'unknown preset falls back to chime',
    )
  }

  console.log('ALL NOTIFY PREVIEW TESTS PASSED')
})
