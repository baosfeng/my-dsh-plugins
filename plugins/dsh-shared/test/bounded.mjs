/**
 * dsh-shared 有界容器原语测试（issue #198 第二批）。
 *
 * 审计缺口：各插件自己 splice 截断数组 / 字典根本没有上限（my-context 的
 * bySession 会话数无界）。本文件锁定两个原语的契约：
 *
 *  - boundedMap：LRU（默认，get/set 都算使用）/ FIFO 上限 + 淘汰计数 + onEvict +
 *    toJSON（磁盘 JSON 形态与普通对象一致，替换 Record 不改变持久化格式）；
 *  - boundList：FIFO 上限 + 淘汰计数 + items() 零拷贝数组（JSON.stringify 兼容）。
 *
 * 淘汰语义必须**明确**：超上限时立刻淘汰（不是"下次再说"），淘汰条数可读
 * （evicted），并回调通知（onEvict）供资源观测。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { boundedMap, boundList, DEFAULT_BOUND_LIST_SIZE } from '../lib/bounded.js'

test('boundedMap：LRU 超限淘汰最久未使用（get 命中刷新顺序）+ 淘汰计数', () => {
  const map = boundedMap({ maxSize: 2 })
  map.set('a', 1)
  map.set('b', 2)
  assert.equal(map.get('a'), 1, 'a 命中并刷新为最近使用')
  map.set('c', 3)
  assert.equal(map.size, 2, '上限 2')
  assert.equal(map.has('a'), true, '最近使用的 a 保留')
  assert.equal(map.has('b'), false, '最久未使用的 b 被淘汰')
  assert.equal(map.evicted, 1, '淘汰计数可读')
  assert.deepEqual(map.stats(), { size: 2, maxSize: 2, evicted: 1 })
})

test('boundedMap：FIFO 策略下 get 不刷新顺序（淘汰最早插入）', () => {
  const map = boundedMap({ maxSize: 2, policy: 'fifo' })
  map.set('a', 1)
  map.set('b', 2)
  assert.equal(map.get('a'), 1)
  map.set('c', 3)
  assert.equal(map.has('a'), false, 'FIFO：a 先插入先淘汰（get 不影响顺序）')
  assert.equal(map.has('b'), true)
})

test('boundedMap：覆盖已有 key 不触发淘汰，只更新值', () => {
  const map = boundedMap({ maxSize: 2 })
  map.set('a', 1)
  map.set('b', 2)
  map.set('a', 11)
  assert.equal(map.size, 2)
  assert.equal(map.evicted, 0, '覆盖不算新增，不淘汰')
  assert.equal(map.get('a'), 11)
})

test('boundedMap：onEvict 回调携带被淘汰的键值（资源观测可挂钩）', () => {
  const evictedPairs = []
  const map = boundedMap({ maxSize: 1, policy: 'fifo', onEvict: (key, value) => evictedPairs.push([key, value]) })
  map.set('a', { n: 1 })
  map.set('b', { n: 2 })
  assert.deepEqual(evictedPairs, [['a', { n: 1 }]], '回调收到被淘汰键值')
})

test('boundedMap：toJSON 保持「普通对象」磁盘格式（替换 Record 不改变持久化形态）', () => {
  const map = boundedMap({ maxSize: 5 })
  map.set('s-1', { requests: 1 })
  map.set('s-2', { requests: 2 })
  const text = JSON.stringify({ version: 1, bySession: map })
  assert.equal(text, '{"version":1,"bySession":{"s-1":{"requests":1},"s-2":{"requests":2}}}')
  // 淘汰后 JSON 同步收缩（不是只在内存里有界）
  const small = boundedMap({ maxSize: 1, policy: 'fifo' })
  small.set('s-1', 1)
  small.set('s-2', 2)
  assert.equal(JSON.stringify(small), '{"s-2":2}')
})

test('boundedMap：maxSize 必须为正整数（fail-fast，不静默退化为无界）', () => {
  assert.throws(() => boundedMap({ maxSize: 0 }), RangeError, 'maxSize=0 拒绝')
  assert.throws(() => boundedMap({ maxSize: -1 }), RangeError, '负数拒绝')
  assert.throws(() => boundedMap({ maxSize: 1.5 }), RangeError, '非整数拒绝')
})

test('boundList：FIFO 超限淘汰最旧 + 淘汰计数 + onEvict', () => {
  const evictedCounts = []
  const list = boundList({ maxSize: 3, onEvict: (n) => evictedCounts.push(n) })
  for (const i of [1, 2, 3]) list.push(i)
  assert.equal(list.size, 3)
  assert.equal(list.evicted, 0)
  list.push(4)
  assert.deepEqual(list.items(), [2, 3, 4], 'FIFO：最旧的 1 被淘汰')
  assert.equal(list.evicted, 1, '淘汰计数可读')
  assert.deepEqual(evictedCounts, [1], 'onEvict 收到淘汰条数')
  list.pushAll([5, 6, 7])
  assert.deepEqual(list.items(), [5, 6, 7], '批量 push 后仍在上限内')
  assert.equal(list.evicted, 4, '累计淘汰 4 条')
})

test('boundList：items() 零拷贝 + JSON.stringify 得到普通数组（持久化兼容）', () => {
  const list = boundList({ maxSize: 2, items: [1, 2, 3] })
  assert.deepEqual(list.items(), [2, 3], '初始条目超限时保留尾部（与 splice(-max) 语义一致）')
  assert.equal(list.evicted, 1, '初始裁剪也计入淘汰')
  assert.equal(JSON.stringify({ requests: list }), '{"requests":[2,3]}')
  assert.equal(Array.isArray(list.items()), true, 'items() 是真数组（零拷贝，供读写复用）')
})

test('boundList：默认上限有界（不传 maxSize 也不会无限增长）', () => {
  assert.equal(Number.isInteger(DEFAULT_BOUND_LIST_SIZE) && DEFAULT_BOUND_LIST_SIZE > 0, true)
  const list = boundList()
  for (let i = 0; i < DEFAULT_BOUND_LIST_SIZE + 10; i += 1) list.push(i)
  assert.equal(list.size, DEFAULT_BOUND_LIST_SIZE, '默认上限生效')
  assert.equal(list.evicted, 10)
})

test('boundList：clear 重置内容但保留累计淘汰计数（统计不倒退）', () => {
  const list = boundList({ maxSize: 1 })
  list.push(1)
  list.push(2)
  assert.equal(list.evicted, 1)
  list.clear()
  assert.equal(list.size, 0)
  assert.deepEqual(list.items(), [])
  assert.equal(list.evicted, 1, 'clear 不改写历史淘汰统计')
})

test('boundList：maxSize 必须为正整数（fail-fast）', () => {
  assert.throws(() => boundList({ maxSize: 0 }), RangeError)
  assert.throws(() => boundList({ maxSize: 2.5 }), RangeError)
})
