/**
 * scheduler-throttle-conflict.mjs — 「写入节奏只能有一个来源」契约测试（issue #198 收尾）。
 *
 * 症状：状态**永不落盘且没有报错**（日志里只有一条 "write blocked N time(s) — dropping pending snapshot"）。
 * 根因：`createWriteScheduler` 与 `atomicWriteJson` **同时启用节流**时，谁快谁说了算——
 *   调度器的 `drain()` 走**非 force** 路径，写回调里 `atomicWriteJson` 的节流窗口若**比调度器间隔更长**，
 *   这次写会被拒 → 调度器重排（默认 3 次，都在原语窗口内）→ 耗尽后**放弃** → 内存状态再也没机会落盘。
 *   （若两者窗口相同则不丢：调度器的推迟恰好覆盖原语窗口——但这是巧合，任一方调整就破。）
 * 修法：**节奏单一来源**——用了调度器，快照原语必须 `minIntervalMs: 0`（反之亦然）。
 * 实测：dsh-my-context / dsh-my-skill-manager 原为「调度器 1s + 原语默认 1s」（巧合安全，已在本批统一为
 *   单一来源）；本测试的 A2 用例锁定的「调度器间隔 < 原语窗口」配置会真实丢状态。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWriteScheduler } from '../lib/scheduler.js'
import { atomicWriteJson } from '../lib/persist.js'

const dirs = []
function tempFile(name) {
  const dir = mkdtempSync(join(tmpdir(), 'shared-throttle-'))
  dirs.push(dir)
  return join(dir, name)
}
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('A2 反例（真实丢状态）：调度器间隔 < 快照原语节流窗口 → drain 后最新状态丢失', async () => {
  const file = tempFile('bad.json')
  const state = { n: 0 }
  const warned = []
  const scheduler = createWriteScheduler({
    debounceMs: 0,
    minIntervalMs: 100, // 调度器节奏比原语窗口（默认 1000ms）快
    maxWriteRetries: 2, // 2 次重排 × 100ms = 200ms < 1000ms → 必然耗尽放弃
    logger: { warn: (message) => warned.push(String(message)) },
    prefix: '[conflict]',
    // ❌ 反例：快照原语仍用默认 minIntervalMs（1000ms）
    write: ({ force }) => atomicWriteJson(file, state, undefined, '[conflict]', { force }),
  })
  state.n = 1
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).n, 1, '第一次写（窗口外）正常落盘')
  state.n = 2
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(
    JSON.parse(readFileSync(file, 'utf8')).n,
    1,
    '反例证据：第二次变更被快照原语节流拒掉、重排耗尽后放弃 → 盘上仍是旧状态（静默丢状态）',
  )
  assert.ok(
    warned.some((message) => message.includes('write blocked')),
    '唯一线索是日志里的一条 warn（不抛错、不失败）',
  )
})

test('A1 巧合安全（不得依赖）：调度器间隔 = 原语窗口 → 不丢状态，但这是脆弱巧合', async () => {
  const file = tempFile('same.json')
  const state = { n: 0 }
  const scheduler = createWriteScheduler({
    debounceMs: 0,
    minIntervalMs: 1000, // 与原语默认窗口相同
    prefix: '[coincidence]',
    write: ({ force }) => atomicWriteJson(file, state, undefined, '[coincidence]', { force }),
  })
  state.n = 1
  scheduler.schedule()
  await scheduler.drain()
  state.n = 2
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(
    JSON.parse(readFileSync(file, 'utf8')).n,
    2,
    '调度器推迟（1s）恰好覆盖原语窗口 → 不丢；但任一方调整间隔即退化为 A2',
  )
})

test('契约（节奏单一来源）：快照原语 minIntervalMs: 0 → drain 后最新状态必在盘上', async () => {
  const file = tempFile('good.json')
  const state = { n: 0 }
  const scheduler = createWriteScheduler({
    debounceMs: 0,
    minIntervalMs: 100, // 甚至比原语默认窗口快得多，也不丢
    prefix: '[ok]',
    // ✅ 正确用法：节奏由调度器单一控制，快照原语关节流
    write: ({ force }) => atomicWriteJson(file, state, undefined, '[ok]', { force, minIntervalMs: 0 }),
  })
  state.n = 1
  scheduler.schedule()
  await scheduler.drain()
  state.n = 2
  scheduler.schedule()
  await scheduler.drain()
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).n, 2, 'drain 后最新状态落盘（不依赖墙钟、不依赖间隔巧合）')
})
