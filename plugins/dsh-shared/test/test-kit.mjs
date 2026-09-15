/**
 * test-kit/wait.mjs 的回归测试（issue #335）。
 *
 * 防复发机制本身也要有测试：工具语义错了，所有下游插件的等待都会跟着错。
 * 覆盖三条契约：
 *  1. `waitFor` 条件成立即返回（不白等）、超时抛错并**报出等的是什么条件**；
 *  2. `sleepFor` 必须带理由（把「我不知道什么时候完成」写进代码）；
 *  3. `yieldLoop` 必然晚于已排队的 microtask（与机器负载无关的让出语义）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleepFor, waitFor, waitForFile, yieldLoop } from '../test-kit/wait.mjs'

test('waitFor：条件立即成立时立刻返回该值，不做无谓等待', async () => {
  const started = Date.now()
  const value = await waitFor(() => 'ready')
  assert.equal(value, 'ready')
  assert.ok(Date.now() - started < 50, '条件已满足就不该再等轮询间隔')
})

test('waitFor：异步条件满足即返回（比固定 sleep 更快，语义更强）', async () => {
  let ready = false
  setTimeout(() => {
    ready = true
  }, 30) // sleep-ok: 人为延时构造被测的异步副作用，不是在等它完成
  const value = await waitFor(() => ready && 'ok', { message: '等待异步条件' })
  assert.equal(value, 'ok')
})

test('waitFor：超时抛错，且错误信息报出「等的是什么条件 + 等了多久」', async () => {
  await assert.rejects(
    () => waitFor(() => false, { timeout: 40, interval: 5, message: '等待落盘出现标记' }),
    (error) => {
      assert.match(error.message, /等待落盘出现标记/, '必须带上调用方给的条件描述')
      assert.match(error.message, /40ms/, '必须报出等待时长')
      return true
    },
  )
})

test('waitFor：未给 message 时从 predicate 源码生成条件描述', async () => {
  await assert.rejects(() => waitFor(() => false, { timeout: 30, interval: 5 }), /waitFor 超时：等待条件成立：/)
})

test('sleepFor：必须带理由（否则等于「我不知道什么时候完成」的裸 sleep）', async () => {
  assert.throws(() => sleepFor('', 10), /必须给出等待理由/) // sleep-ok: 被测对象就是「空理由必须抛错」，不产生等待
  assert.throws(() => sleepFor(undefined, 10), /必须给出等待理由/) // sleep-ok: 同上（undefined 理由）
  const started = Date.now()
  await sleepFor('观察窗口：断言没有新的告警产生', 20)
  assert.ok(Date.now() - started >= 15, '带理由的固定等待按给定时长执行')
})

test('yieldLoop：必然晚于已排队的 microtask（不依赖机器负载）', async () => {
  const order = []
  Promise.resolve().then(() => order.push('microtask'))
  await yieldLoop()
  order.push('after-yield')
  assert.deepEqual(order, ['microtask', 'after-yield'])
})

test('waitForFile：文件出现并满足条件后返回；文件不存在时轮询而非抛 ENOENT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wait-kit-'))
  try {
    const file = join(dir, 'state.json')
    setTimeout(() => writeFileSync(file, '{"n":1}', 'utf8'), 20) // sleep-ok: 人为延时构造「落盘晚于读取」
    const text = await waitForFile(file, (content) => content.includes('"n":1') && content, {
      message: '等待状态文件写出',
    })
    assert.equal(text, '{"n":1}')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
