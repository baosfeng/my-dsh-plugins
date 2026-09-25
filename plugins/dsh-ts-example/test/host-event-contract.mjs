/**
 * 宿主事件名契约防回归（本插件订阅的会话事件域）。
 *
 * 为什么需要它：cordis 的 `interface Events` **只是类型声明**，`ctx.on('<事件名>')`
 * 运行时不校验——宿主删掉/改名一个事件后，插件侧监听**静默失效**（不报错、不告警、
 * 不抛异常），`/ts-example/api/stats` 会永远返回 `{ sessions: 0 }`。既有测试（host-smoke
 * / host-root-registration）自己 emit 监听表里的名字，所以**永远抓不到这类回归**。
 *
 * 判据来自宿主真实事件清单（test/fixtures/host-session-events.json，由
 * scripts/host-session-events.mjs 从官方参考源取证：`interface Events` 声明通道 ∪
 * 事件名派发字面量）：
 *   ① `apply()` 实际订阅的每个事件名必须命中宿主会话事件表，否则 ctx.on 静默失效；
 *   ② 参考源在场时，被订阅的事件名必须在宿主源码里逐字找到**发出点**；
 *   ③ fixture 与在场参考源的版本/清单一致（宿主升级后强制重新取证）。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import {
  dispatchSites,
  extractSessionEvents,
  readFixture,
  referenceDir,
  versionOf,
} from '../scripts/host-session-events.mjs'

/** 用最小 ctx 跑 apply，收集它实际订阅的事件名（真实行为，不读源码字面量）。 */
function listenedEvents() {
  const names = []
  const root = {
    on(event) {
      names.push(event)
      return () => {}
    },
  }
  const ctx = { root, webServer: { register: () => () => {} } }
  apply(ctx, {})
  return names.sort()
}

test('插件订阅的事件名必须存在于宿主会话事件表（不然监听静默失效、计数恒为 0）', () => {
  const listened = listenedEvents()
  assert.ok(listened.length > 0, '未捕获到任何事件订阅：测试失去意义（apply 未注册监听？）')
  const catalog = new Set(readFixture().reference.events)
  const unknown = listened.filter((event) => !catalog.has(event))
  assert.deepEqual(
    unknown,
    [],
    `宿主 ${readFixture().reference.version} 的会话事件表里没有这些事件名——ctx.on 会静默失效（不报错不告警）。` +
      `现有事件：${[...catalog].join(' / ')}`,
  )
})

test('宿主会话事件表锚定 session/created（回归锁定事件名）', () => {
  const catalog = readFixture().reference.events
  assert.ok(catalog.includes('session/created'), `会话创建事件必须叫 session/created，实际表：${catalog.join(' / ')}`)
})

test('参考源在场时：被订阅的事件名必须在宿主源码里确有发出点', () => {
  const reference = referenceDir()
  if (reference === null) {
    console.log('skip: 官方参考源不在场（CI 用冻结 fixture 判定）')
    return
  }
  for (const event of listenedEvents()) {
    const sites = dispatchSites(reference, event)
    assert.ok(
      sites.length > 0,
      `${event} 在宿主 ${versionOf(reference)} 源码里找不到发出点（只有类型声明没人派发 = 静默失效）`,
    )
  }
})

test('fixture 与在场参考源一致（宿主升级后强制重新取证）', () => {
  const reference = referenceDir()
  if (reference === null) {
    console.log('skip: 官方参考源不在场（CI 用冻结 fixture 判定）')
    return
  }
  const fixture = readFixture()
  assert.equal(
    versionOf(reference),
    fixture.reference.version,
    '参考源版本已变：跑 node scripts/host-session-events.mjs --update 重新取证并复核插件订阅',
  )
  assert.deepEqual(
    extractSessionEvents(reference),
    fixture.reference.events,
    '参考源会话事件表已变：跑 node scripts/host-session-events.mjs --update',
  )
})
