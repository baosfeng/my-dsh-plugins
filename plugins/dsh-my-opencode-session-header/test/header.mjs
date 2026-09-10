/**
 * dsh-my-opencode-session-header — host tests.
 *
 * 覆盖：opencode 路由注入 / 非 opencode provider 与 host 不注入 / 无会话上
 * 下文退化 / 已有头幂等与 override / 并发会话隔离 / 流 return() 透传 /
 * disposer 还原 fetch / valueMode uuid+raw / 配置校验 / 同步 handler 回归。
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { bootPlugin, dispatchStream, mockFetch, headersToObject, lazyFetchStream, drain } from './lib/helpers.mjs'

const realFetch = globalThis.fetch
const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/chat/completions'
let handles = []
let rec = null

beforeEach(() => {
  rec = mockFetch()
  globalThis.fetch = rec.fn
})

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.disposeAll()
  globalThis.fetch = realFetch
})

function boot(config) {
  const handle = bootPlugin(config)
  handles.push(handle)
  return handle
}

/** 消费一个会话的推理流，返回收到的 chunk。 */
async function consume(listeners, options, streamOptions) {
  const stream = dispatchStream(listeners, options, () => lazyFetchStream(streamOptions))
  assert.ok(!(stream instanceof Promise), 'llm/stream handler 必须同步返回流（async handler 会破坏下游 yield* 委托）')
  return drain(stream)
}

test('opencode provider + opencode.ai host：注入提取出的裸 UUID', async () => {
  const { listeners } = boot()
  const sessionId = 'session-9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F'
  const chunks = await consume(listeners, { provider: 'opencode', sessionId }, { chunks: ['hello', 'world'] })

  assert.deepEqual(chunks, ['hello', 'world'], '流内容原样透传')
  assert.equal(rec.calls.length, 1)
  assert.equal(rec.calls[0].url, OPENCODE_URL)
  assert.equal(rec.calls[0].headers['x-opencode-session'], '9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F', '提取裸 UUID')
  assert.equal(rec.calls[0].headers.authorization, 'Bearer test-key', '其余请求头保留')
})

test('同一会话跨轮次得到确定性的同一个值；不同会话不同值', async () => {
  const { listeners } = boot()
  const options = { provider: 'opencode-go', sessionId: 'sess-abc-11111111-2222-4333-8444-555555555555' }
  await consume(listeners, options)
  await consume(listeners, options)
  await consume(listeners, { provider: 'opencode-go', sessionId: 'sess-def-66666666-7777-4888-8999-000000000000' })

  const values = rec.calls.map((call) => call.headers['x-opencode-session'])
  assert.deepEqual(values, [
    '11111111-2222-4333-8444-555555555555',
    '11111111-2222-4333-8444-555555555555',
    '66666666-7777-4888-8999-000000000000',
  ])
})

test('非 opencode provider：不注入（零副作用）', async () => {
  const { listeners } = boot()
  await consume(listeners, { provider: 'deepseek', sessionId: 'sess-1' })
  await consume(listeners, { provider: 'anthropic', sessionId: 'sess-1' })
  const values = rec.calls.map((call) => call.headers['x-opencode-session'])
  assert.deepEqual(values, [undefined, undefined])
})

test('opencode 之外的主机：不注入（含后缀伪装域名）', async () => {
  const { listeners } = boot()
  const hosts = ['https://api.example.com/v1/chat', 'https://notopencode.ai/x', 'https://opencode.ai.evil.com/x']
  for (const url of hosts) await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url })
  assert.equal(rec.calls.length, 3)
  for (const call of rec.calls) assert.equal(call.headers['x-opencode-session'], undefined)
})

test('子域与自定义 hosts 配置命中', async () => {
  const { listeners } = boot({ hosts: ['opencode.ai', 'gateway.example.com'] })
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url: 'https://zen.opencode.ai/go/v1' })
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url: 'https://gateway.example.com/v1' })
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-1')
  assert.equal(rec.calls[1].headers['x-opencode-session'], 'sess-1')
})

test('provider 白名单可配置（自定义 provider 命中、默认名单退出）', async () => {
  const { listeners } = boot({ providers: ['my-gateway'] })
  await consume(listeners, { provider: 'my-gateway', sessionId: 'sess-1' })
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' })
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-1')
  assert.equal(rec.calls[1].headers['x-opencode-session'], undefined)
})

test('无会话 id / 无 llm 上下文：不注入，且只 warn 一次', async () => {
  const { listeners, logs } = boot()
  // 无 sessionId → handler 不建立上下文
  await consume(listeners, { provider: 'opencode' })
  await consume(listeners, { provider: 'opencode', sessionId: '' })
  // 完全在 llm/stream 之外调用 fetch
  await globalThis.fetch(OPENCODE_URL, { headers: {} })
  await globalThis.fetch(OPENCODE_URL, { headers: {} })

  assert.equal(rec.calls.length, 4)
  for (const call of rec.calls) assert.equal(call.headers['x-opencode-session'], undefined)
  assert.equal(logs.warn.length, 1, '首次退化 warn 一次后静默')
  assert.match(logs.warn[0], /x-opencode-session/)
})

test('非 opencode 主机的无上下文请求不 warn（不产生噪音）', async () => {
  const { logs } = boot()
  await globalThis.fetch('https://api.example.com/v1/chat', {})
  await globalThis.fetch('https://api.example.com/v1/chat', {})
  assert.equal(logs.warn.length, 0)
})

test('已有 x-opencode-session 默认不覆盖（Headers / 数组 / 对象三种形态）', async () => {
  const { listeners } = boot()
  const inits = [
    { headers: new Headers({ 'X-OpenCode-Session': 'preset-1', authorization: 'Bearer k' }) },
    {
      headers: [
        ['X-OpenCode-Session', 'preset-2'],
        ['authorization', 'Bearer k'],
      ],
    },
    { headers: { 'X-OpenCode-Session': 'preset-3', authorization: 'Bearer k' } },
  ]
  for (const init of inits) await consume(listeners, { provider: 'opencode', sessionId: 'sess-real' }, { init })

  assert.deepEqual(
    rec.calls.map((call) => call.headers['x-opencode-session']),
    ['preset-1', 'preset-2', 'preset-3'],
  )
  for (const call of rec.calls) assert.equal(call.headers.authorization, 'Bearer k', '既有其它头不丢')
})

test('override: true 时覆盖已有头（三种形态）', async () => {
  const { listeners } = boot({ override: true })
  const inits = [
    { headers: new Headers({ 'x-opencode-session': 'preset-1', authorization: 'Bearer k' }) },
    {
      headers: [
        ['x-opencode-session', 'preset-2'],
        ['authorization', 'Bearer k'],
      ],
    },
    { headers: { 'x-opencode-session': 'preset-3', authorization: 'Bearer k' } },
  ]
  for (const init of inits) await consume(listeners, { provider: 'opencode', sessionId: 'sess-real' }, { init })

  for (const call of rec.calls) assert.equal(call.headers['x-opencode-session'], 'sess-real')
  for (const call of rec.calls) assert.equal(call.headers.authorization, 'Bearer k')
})

test('headerName 可配置', async () => {
  const { listeners } = boot({ headerName: 'x-my-session' })
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' })
  assert.equal(rec.calls[0].headers['x-my-session'], 'sess-1')
  assert.equal(rec.calls[0].headers['x-opencode-session'], undefined)
})

test('valueMode raw：直接用原始会话 id；uuid 模式无 UUID 时回退原串', async () => {
  const raw = boot({ valueMode: 'raw' })
  await consume(raw.listeners, { provider: 'opencode', sessionId: 'plain-session-id' })

  const uuid = boot()
  await consume(uuid.listeners, { provider: 'opencode', sessionId: 'plain-session-id' })

  assert.equal(rec.calls[0].headers['x-opencode-session'], 'plain-session-id')
  assert.equal(rec.calls[1].headers['x-opencode-session'], 'plain-session-id')
})

test('并发两个会话不串号', async () => {
  const { listeners } = boot()
  const first = dispatchStream(
    listeners,
    { provider: 'opencode', sessionId: 'a-11111111-1111-4111-8111-111111111111' },
    () => lazyFetchStream({ chunks: ['one'] }),
  )
  const second = dispatchStream(
    listeners,
    { provider: 'opencode', sessionId: 'b-22222222-2222-4222-8222-222222222222' },
    () => lazyFetchStream({ chunks: ['two'] }),
  )
  const iterA = first[Symbol.asyncIterator]()
  const iterB = second[Symbol.asyncIterator]()
  assert.equal((await iterA.next()).value, 'one')
  assert.equal((await iterB.next()).value, 'two')
  await iterA.return(undefined)
  await iterB.return(undefined)

  assert.equal(rec.calls[0].headers['x-opencode-session'], '11111111-1111-4111-8111-111111111111')
  assert.equal(rec.calls[1].headers['x-opencode-session'], '22222222-2222-4222-8222-222222222222')
})

test('消费方 early break：return() 透传关闭内层流（不泄漏）', async () => {
  const { listeners } = boot()
  let closed = 0
  const stream = dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () =>
    lazyFetchStream({
      chunks: ['a', 'b', 'c'],
      onClose: () => {
        closed += 1
      },
    }),
  )
  for await (const chunk of stream) {
    assert.equal(chunk, 'a')
    break
  }
  assert.equal(closed, 1, '内层流的 finally（资源释放）被触发')
})

test('流内错误向上传播（不吞异常）', async () => {
  const { listeners } = boot()
  async function* failing() {
    await globalThis.fetch(OPENCODE_URL, { headers: {} })
    yield 'a'
    throw new Error('boom')
  }
  const stream = dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => failing())
  await assert.rejects(async () => {
    for await (const chunk of stream) void chunk
  }, /boom/)
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-1', '抛错前注入仍生效')
})

test('disposer 还原 fetch；他人 patch 不被误还原', async () => {
  const first = boot()
  assert.notEqual(globalThis.fetch, rec.fn, 'apply 后 fetch 已被包装')
  await first.disposeAll()
  assert.equal(globalThis.fetch, rec.fn, 'disposer 还原为安装前的 fetch')

  const second = boot()
  const foreign = async () => 'foreign'
  globalThis.fetch = foreign
  await second.disposeAll()
  assert.equal(globalThis.fetch, foreign, '当前 fetch 不是我们装的 → 不还原')
  globalThis.fetch = rec.fn
})

test('卸载时 globalThis.fetch 被替换为非函数 / 异形对象：不崩且不还原', async () => {
  const first = boot()
  globalThis.fetch = 'not-a-function'
  await first.disposeAll()
  assert.equal(globalThis.fetch, 'not-a-function', '非函数 fetch：什么都不做')

  const second = boot()
  const impostor = Object.assign(() => 'impostor', { dshOpencodeSessionHeaderLayer: {} })
  globalThis.fetch = impostor
  await second.disposeAll()
  assert.equal(globalThis.fetch, impostor, '同名标记但无摘除句柄：不误还原')

  globalThis.fetch = rec.fn
})

test('重复 apply（双挂载）乱序卸载：摘除自己那层、不残留、不误还原', async () => {
  const first = boot()
  const second = boot()
  const outer = globalThis.fetch
  assert.notEqual(outer, rec.fn)

  await first.disposeAll()
  assert.equal(globalThis.fetch, outer, '内层先卸载：外层补丁保持不变')

  // 外层仍在工作（内层摘除不影响注入）
  await consume(second.listeners, { provider: 'opencode', sessionId: 'sess-x' })
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-x')

  await second.disposeAll()
  assert.equal(globalThis.fetch, rec.fn, '全部卸载后还原为原始 fetch')
})

test('内部异常一律吞掉并降级为原行为', async () => {
  const { listeners } = boot()
  const evil = new Proxy(
    {},
    {
      get() {
        throw new Error('boom')
      },
    },
  )
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url: evil })
  assert.equal(rec.calls.length, 1, '请求仍以原行为发出')
  assert.equal(rec.calls[0].headers['x-opencode-session'], undefined)
})

test('Request 形态的 input：头注入不丢失既有头', async () => {
  const { listeners } = boot()
  const request = new Request(OPENCODE_URL, { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{}' })
  const stream = dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-req' }, () =>
    (async function* () {
      await globalThis.fetch(request)
      yield 'ok'
    })(),
  )
  assert.deepEqual(await drain(stream), ['ok'])

  assert.equal(rec.calls.length, 1)
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-req')
  assert.equal(rec.calls[0].headers.authorization, 'Bearer k')
})

test('启动日志：一行可辨识的生效日志', () => {
  const { logs } = boot()
  assert.equal(logs.info.length, 1)
  assert.equal(
    logs.info[0],
    '[opencode-session-header] active for providers [opencode, opencode-go] with valueMode uuid',
  )
})

test('enabled: false：不注册监听、不装 fetch patch、无日志', () => {
  const { listeners, logs } = boot({ enabled: false })
  assert.deepEqual(listeners['llm/stream'] ?? [], [])
  assert.equal(globalThis.fetch, rec.fn)
  assert.deepEqual(logs, { info: [], warn: [] })
})

test('配置校验：空数组与非法值明确报错', () => {
  const cases = [
    [{ providers: [] }, /providers/],
    [{ providers: 'opencode' }, /providers/],
    [{ providers: ['opencode', ''] }, /providers/],
    [{ hosts: [] }, /hosts/],
    [{ hosts: ['https://opencode.ai'] }, /hosts/],
    [{ hosts: ['opencode.ai/path'] }, /hosts/],
    [{ headerName: '' }, /headerName/],
    [{ headerName: 'bad header' }, /headerName/],
    [{ valueMode: 'md5' }, /valueMode/],
    [{ enabled: 'yes' }, /enabled/],
    [{ override: 1 }, /override/],
  ]
  for (const [config, pattern] of cases) {
    assert.throws(() => bootPlugin(config), pattern, `应拒绝 ${JSON.stringify(config)}`)
  }
})

test('配置为 undefined / null 时使用默认值', async () => {
  const plain = bootPlugin(undefined)
  handles.push(plain)
  await consume(plain.listeners, { provider: 'opencode', sessionId: 'sess-1' })
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-1')

  const nulled = bootPlugin(null)
  handles.push(nulled)
  await consume(nulled.listeners, { provider: 'opencode', sessionId: 'sess-2' })
  assert.equal(rec.calls[1].headers['x-opencode-session'], 'sess-2')
})

test('非流对象 / 迭代器工厂抛错 / 原始值：原样透传（不破坏调用方）', () => {
  const { listeners } = boot()
  const notStream = { kind: 'not-a-stream' }
  assert.equal(
    dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => notStream),
    notStream,
  )

  const broken = {
    [Symbol.asyncIterator]() {
      throw new Error('nope')
    },
  }
  assert.equal(
    dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => broken),
    broken,
  )
  assert.equal(
    dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => 42),
    42,
  )
  assert.equal(
    dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => null),
    null,
  )
})

test('options 非对象 / 缺 provider：不注入也不崩', async () => {
  const { listeners } = boot()
  await consume(listeners, null)
  await consume(listeners, 'weird-options')
  await consume(listeners, { sessionId: 'sess-1' })
  assert.equal(rec.calls.length, 3)
  for (const call of rec.calls) assert.equal(call.headers['x-opencode-session'], undefined)
})

test('不可解析 URL / 非对象 input：不注入（降级为原 fetch）', async () => {
  const { listeners } = boot()
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url: 'not a url' })
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-1' }, { url: 42 })
  assert.equal(rec.calls.length, 2)
  for (const call of rec.calls) assert.equal(call.headers['x-opencode-session'], undefined)
})

test('URL 实例形态的 input：正常注入', async () => {
  const { listeners } = boot()
  await consume(listeners, { provider: 'opencode', sessionId: 'sess-url' }, { url: new URL(OPENCODE_URL) })
  assert.equal(rec.calls[0].url, OPENCODE_URL)
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-url')
})

test('内层迭代器没有 return()：early break 不抛错', async () => {
  const { listeners } = boot()
  const result = { done: false, value: 'x' }
  const bare = { next: async () => result }
  const stream = dispatchStream(listeners, { provider: 'opencode', sessionId: 'sess-1' }, () => ({
    [Symbol.asyncIterator]: () => bare,
  }))
  for await (const chunk of stream) {
    assert.equal(chunk, 'x')
    break
  }
})

test('headersToObject helper 与三形态归一（测试夹具自检）', () => {
  assert.deepEqual(headersToObject(new Headers({ A: '1' })), { a: '1' })
  assert.deepEqual(headersToObject([['B', '2']]), { b: '2' })
  assert.deepEqual(headersToObject({ C: '3' }), { c: '3' })
  assert.deepEqual(headersToObject(undefined), {})
})
