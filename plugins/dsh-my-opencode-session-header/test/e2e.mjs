/**
 * dsh-my-opencode-session-header — 真实端到端验证（不经任何 fetch mock）。
 *
 * 起一个本地 HTTP 服务，用**真实 undici fetch** 发请求，断言：
 *  ① 补丁对真实 globalThis.fetch 生效（SDK 每次请求解析 globalThis.fetch）；
 *  ② x-opencode-session 真的出现在线上请求头里；
 *  ③ AsyncLocalStorage 上下文在真实异步链（惰性流消费 → fetch）上正确传播；
 *  ④ 卸载后 globalThis.fetch 还原为真实实现。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { bootPlugin, dispatchStream, lazyFetchStream, drain } from './lib/helpers.mjs'

const servers = []

afterAll(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

/** 启动记录出站请求头的本地服务，返回 { url, received, close }。 */
async function startProbe() {
  const received = []
  const server = createServer((request, response) => {
    received.push({
      session: request.headers['x-opencode-session'],
      authorization: request.headers.authorization,
    })
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/v1/chat/completions`, received }
}

test('真实 fetch 端到端：会话头出现在线上请求，卸载后 fetch 还原', async () => {
  const realFetch = globalThis.fetch
  const probe = await startProbe()
  const sessionId = 'session-9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F'
  const handle = bootPlugin({ hosts: ['127.0.0.1'] })
  try {
    assert.notEqual(globalThis.fetch, realFetch, 'apply 后 globalThis.fetch 已被包装')
    const options = { provider: 'opencode', sessionId }
    for (const chunk of await drain(
      dispatchStream(handle.listeners, options, () =>
        lazyFetchStream({ url: probe.url, init: { headers: { authorization: 'Bearer real-key' } } }),
      ),
    )) {
      void chunk
    }
    await drain(dispatchStream(handle.listeners, options, () => lazyFetchStream({ url: probe.url })))

    assert.equal(probe.received.length, 2)
    assert.equal(probe.received[0].session, '9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F', '真实请求头已注入')
    assert.equal(probe.received[0].authorization, 'Bearer real-key', '既有头不丢')
    assert.equal(probe.received[1].session, '9F8E7D6C-5B4A-4392-8170-0A1B2C3D4E5F', '同会话跨轮次同值')
  } finally {
    await handle.disposeAll()
  }
  assert.equal(globalThis.fetch, realFetch, 'disposer 还原真实 fetch')
})
