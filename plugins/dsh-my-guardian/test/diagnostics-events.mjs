/**
 * 诊断事件日志（lib/events.js）防回归测试。
 *
 * 背景：`events.ts` 是覆盖率最低的 server 模块（branch 55%，全插件最低），
 * 而其中未覆盖的 `entryLabelOf` 恰好是最危险的路径——它读 loader entry 的
 * 可读标识时**绝不能碰 `entry.id` getter**：loader 在 Entry 构造函数中 emit
 * `loader/entry-init`，此时 `parent.tree` 尚未就绪，访问 getter 会抛
 * "Cannot read properties of undefined (reading 'tree')"，把整个 DSH 启动
 * 拖垮（守护插件自己炸启动，真机复现过）。本套件把这个约束连同环形缓冲上限、
 * HMR 失败监听器的两个消息分支一起锁死。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { attachEventListeners, logEvent } from '../lib/events.js'

/** 最小 cordis ctx：记录监听的 loader 事件 + 警告。 */
function makeCtx() {
  const handlers = new Map()
  const warnings = []
  return {
    handlers,
    warnings,
    on: (event, listener) => {
      handlers.set(event, listener)
    },
    logger: { warn: (message) => warnings.push(message) },
  }
}

/** 最小 SharedContext：只有事件环形缓冲与 persistSoon 被用到。 */
function makeShared() {
  return {
    state: { events: [] },
    persistCount: 0,
    persistSoon() {
      this.persistCount += 1
    },
  }
}

test('logEvent：追加事件、截断超长消息（ERROR_SNIP=300）并转换非字符串', () => {
  const shared = makeShared()
  logEvent(shared, 'promote', 'x'.repeat(500))
  assert.equal(shared.state.events.length, 1)
  assert.equal(shared.state.events[0].type, 'promote')
  assert.equal(shared.state.events[0].message.length, 300, '消息截断到 ERROR_SNIP')
  assert.ok(typeof shared.state.events[0].time === 'number', '事件带时间戳')

  logEvent(shared, 'quarantine', { toString: () => 'object message' })
  assert.equal(shared.state.events[1].message, 'object message', '非字符串消息经 String() 转换')
})

test('logEvent：环形缓冲只保留最近 EVENT_LIMIT=20 条', () => {
  const shared = makeShared()
  for (let i = 0; i < 25; i += 1) logEvent(shared, 'skip', `event-${i}`)
  assert.equal(shared.state.events.length, 20, '超过上限后裁剪到 20 条')
  assert.equal(shared.state.events[0].message, 'event-5', '保留最近 20 条（丢最早 5 条）')
  assert.equal(shared.state.events.at(-1).message, 'event-24')
})

test('attachEventListeners：entry-init / partial-dispose 写入诊断事件', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  assert.deepEqual([...ctx.handlers.keys()].sort(), [
    'hmr/config-update-failed',
    'loader/entry-init',
    'loader/partial-dispose',
  ])

  ctx.handlers.get('loader/entry-init')({ options: { id: 'dsh-bad' } })
  ctx.handlers.get('loader/partial-dispose')({ options: { id: 'dsh-bad' } })
  assert.deepEqual(
    shared.state.events.map((event) => [event.type, event.message]),
    [
      ['entry-init', 'entry dsh-bad initialized'],
      ['entry-dispose', 'entry dsh-bad disposed'],
    ],
  )
})

test('attachEventListeners：hmr/config-update-failed 记录消息、告警并落盘', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  const onFailure = ctx.handlers.get('hmr/config-update-failed')

  onFailure('cordis.yml', new Error('boom'))
  assert.equal(shared.state.events[0].type, 'update-failed')
  assert.equal(shared.state.events[0].message, 'cordis.yml: boom', 'Error 取 message')
  assert.deepEqual(ctx.warnings, ['[dsh-my-guardian] config update failed (rolled back): cordis.yml'])
  assert.equal(shared.persistCount, 1, '失败后立刻落盘（重启后仍能诊断）')

  onFailure('other.yml', 'plain failure')
  assert.equal(shared.state.events[1].message, 'other.yml: plain failure', '非 Error 原样字符串化')

  const bare = makeCtx()
  delete bare.logger
  const bareShared = makeShared()
  attachEventListeners(bare, bareShared)
  assert.doesNotThrow(
    () => bare.handlers.get('hmr/config-update-failed')('x.yml', new Error('y')),
    'logger 缺失时不得抛异常（可选链降级）',
  )
})

test('entryLabelOf：优先 options.id，回落 options.name，缺失为 "?"', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)
  const onInit = ctx.handlers.get('loader/entry-init')

  const cases = [
    [{ options: { id: 'by-id', name: 'by-name' } }, 'entry by-id initialized'],
    [{ options: { id: null, name: 'fallback-name' } }, 'entry fallback-name initialized'],
    [{ options: { name: 'only-name' } }, 'entry only-name initialized'],
    [{ options: { id: undefined, name: '' } }, 'entry ? initialized', '空 name 不采用'],
    [{ options: {} }, 'entry ? initialized'],
    [{}, 'entry ? initialized', '无 options'],
    [{ options: null }, 'entry ? initialized'],
    [null, 'entry ? initialized'],
    ['string-entry', 'entry ? initialized'],
    [42, 'entry ? initialized'],
    [{ options: { id: 7, name: 'n' } }, 'entry 7 initialized', '数字 id 字符串化'],
  ]
  for (const [entry, expected, note] of cases) {
    shared.state.events.length = 0
    onInit(entry)
    assert.equal(shared.state.events[0].message, expected, note ?? JSON.stringify(entry))
  }
})

test('entryLabelOf：绝不触碰 entry.id getter（会抛 "reading tree" 把启动拖垮）', () => {
  const ctx = makeCtx()
  const shared = makeShared()
  attachEventListeners(ctx, shared)

  let getterReads = 0
  const entry = {
    options: { name: 'safe-name' },
    get id() {
      getterReads += 1
      throw new Error("Cannot read properties of undefined (reading 'tree')")
    },
  }
  assert.doesNotThrow(
    () => ctx.handlers.get('loader/entry-init')(entry),
    'loader 在 Entry 构造函数中 emit entry-init 时 id getter 不可用，读取它会让 DSH 起不来',
  )
  assert.equal(getterReads, 0, 'entry.id getter 一次都不能被访问')
  assert.equal(shared.state.events[0].message, 'entry safe-name initialized', '退回 options.name')
})
