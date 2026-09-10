/**
 * dsh-my-opencode-session-header — 头形态归一化与路由判定边界测试。
 *
 * 直接单测 lib/headers.js 与 lib/fetch-patch.js 的导出：三形态头（Headers /
 * 数组 / 对象）的幂等判定与写入不可变语义、主机判定边界、Request 构造器
 * 缺失时的安全降级。
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { hasHeader, withHeader } from '../lib/headers.js'
import { hostMatches } from '../lib/fetch-patch.js'
import { bootPlugin, dispatchStream, mockFetch, drain } from './lib/helpers.mjs'

const realFetch = globalThis.fetch
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

test('hostMatches：精确、子域、大小写与非法输入', () => {
  assert.equal(hostMatches('https://opencode.ai/zen/go', ['opencode.ai']), true)
  assert.equal(hostMatches('https://ZEN.OpenCode.AI/x', ['opencode.ai']), true)
  assert.equal(hostMatches('https://opencode.ai.evil.com/x', ['opencode.ai']), false)
  assert.equal(hostMatches('https://notopencode.ai/x', ['opencode.ai']), false)
  assert.equal(hostMatches('not a url', ['opencode.ai']), false)
  assert.equal(hostMatches('https://opencode.ai/x', []), false)
})

test('hasHeader / withHeader：三形态 + 不可变写入 + 边界输入', () => {
  const headers = new Headers({ 'X-A': '1' })
  assert.equal(hasHeader(headers, 'x-a'), true)
  const copied = withHeader(headers, 'x-opencode-session', 'v')
  assert.equal(headers.has('x-opencode-session'), false, '不改动入参 Headers 实例')
  assert.equal(new Headers(copied).get('x-opencode-session'), 'v')
  assert.equal(new Headers(copied).get('x-a'), '1', '其它头保留')

  const array = [
    ['X-A', '1'],
    ['x-opencode-session', 'old'],
  ]
  assert.equal(hasHeader(array, 'X-OPENCODE-SESSION'), true)
  assert.deepEqual(withHeader(array, 'X-OpenCode-Session', 'new'), [
    ['X-A', '1'],
    ['X-OpenCode-Session', 'new'],
  ])
  assert.deepEqual(array[1], ['x-opencode-session', 'old'], '不改动入参数组')

  const plain = { 'X-A': '1', 'X-OpenCode-Session': 'old' }
  assert.equal(hasHeader(plain, 'x-opencode-session'), true)
  assert.deepEqual(withHeader(plain, 'x-opencode-session', 'new'), { 'X-A': '1', 'x-opencode-session': 'new' })
  assert.deepEqual(plain, { 'X-A': '1', 'X-OpenCode-Session': 'old' }, '不改动入参对象')

  // 边界：非容器值（判定为"没有该头"，写入退化为新建普通对象）
  assert.equal(hasHeader(undefined, 'x'), false)
  assert.equal(hasHeader(null, 'x'), false)
  assert.equal(hasHeader(42, 'x'), false)
  assert.equal(hasHeader('nope', 'x'), false)
  assert.deepEqual(withHeader(undefined, 'x', 'v'), { x: 'v' })
  assert.deepEqual(withHeader(42, 'x', 'v'), { x: 'v' })
})

test('Request 构造器不可用时安全降级（仍在 init 之外注入）', async () => {
  const handle = bootPlugin()
  handles.push(handle)
  const saved = globalThis.Request
  try {
    globalThis.Request = undefined
    const stream = dispatchStream(handle.listeners, { provider: 'opencode', sessionId: 'sess-1' }, () =>
      (async function* () {
        await globalThis.fetch('https://opencode.ai/zen/go/v1/chat/completions')
        yield 'ok'
      })(),
    )
    assert.deepEqual(await drain(stream), ['ok'])
  } finally {
    globalThis.Request = saved
  }
  assert.equal(rec.calls[0].headers['x-opencode-session'], 'sess-1')
})
