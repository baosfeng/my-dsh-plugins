/**
 * release-concurrency.test.mjs — 发版并发调度单元测试（issue #246）。
 *
 * 覆盖四条硬约束（这些正是「并行不得削弱门禁」的判据）：
 *   1. 保序：结果必须按输入顺序返回，调用方才能按原顺序汇总/报告；
 *   2. 有界：同时运行的任务数不超过 limit（否则批量发版会把机器打爆）；
 *   3. 不 reject：单个任务失败不影响其余任务执行完（批量语义「一个失败不影响其他」）；
 *   4. 异常也只是结果：调度器不替调用方决定放行/阻断（fail-closed 判定权在调用方）。
 */
import { describe, it, expect } from 'vitest'
import {
  mapWithConcurrency,
  normalizeConcurrency,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
} from '../lib/release-concurrency.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe('normalizeConcurrency（并发度解析）', () => {
  it('单任务强制 1（不做无意义并发）', () => {
    expect(normalizeConcurrency(undefined, 1)).toBe(1)
    expect(normalizeConcurrency(8, 1)).toBe(1)
  })

  it('未指定 → 默认 3（资源口径与 AGENTS.md 并行上限一致）', () => {
    expect(normalizeConcurrency(undefined, 5)).toBe(DEFAULT_CONCURRENCY)
    expect(DEFAULT_CONCURRENCY).toBe(3)
  })

  it('非法取值（非数字 / 0 / 负数 / 空串）→ 回落默认值', () => {
    for (const raw of ['abc', '0', '-4', '', null, '1.5.2']) {
      expect(normalizeConcurrency(raw, 5)).toBe(DEFAULT_CONCURRENCY)
    }
  })

  it('超过上限 → 夹到 MAX_CONCURRENCY（不放大到任务数）', () => {
    expect(normalizeConcurrency(999, 100)).toBe(MAX_CONCURRENCY)
  })

  it('不超过任务数：并发度大于任务数时按任务数收敛', () => {
    expect(normalizeConcurrency(5, 2)).toBe(2)
    expect(normalizeConcurrency('2', 5)).toBe(2)
  })

  it('任务数非法（0 / 负数 / 小数）按单任务处理', () => {
    expect(normalizeConcurrency(4, 0)).toBe(1)
    expect(normalizeConcurrency(4, -1)).toBe(1)
    expect(normalizeConcurrency(4, 1.5)).toBe(1)
  })
})

describe('mapWithConcurrency（有界并发、保序、不 reject）', () => {
  it('结果按输入顺序返回（并发完成顺序不影响）', async () => {
    const items = [30, 5, 20, 1]
    const out = await mapWithConcurrency(items, 4, async (ms) => {
      await sleep(ms)
      return ms * 2
    })
    expect(out.map((r) => r.value)).toEqual([60, 10, 40, 2])
    expect(out.every((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('同时运行的任务数不超过 limit', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await sleep(10)
      inFlight -= 1
      return true
    })
    expect(peak).toBe(3)
  })

  it('单任务失败不影响其余任务全部执行完（批量「一个失败不影响其他」）', async () => {
    const seen = []
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      seen.push(n)
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(seen.sort()).toEqual([1, 2, 3])
    expect(out[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(out[1].status).toBe('rejected')
    expect(out[1].reason.message).toBe('boom')
    expect(out[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('同步抛错也捕获成 rejected（不只 async worker）', async () => {
    const out = await mapWithConcurrency([1], 1, () => {
      throw new Error('sync-boom')
    })
    expect(out[0].status).toBe('rejected')
  })

  it('worker 拿到输入下标（调用方据此分配端口/命名）', async () => {
    const out = await mapWithConcurrency(['a', 'b'], 2, (item, index) => `${index}:${item}`)
    expect(out.map((r) => r.value)).toEqual(['0:a', '1:b'])
  })

  it('空列表 → 空结果且不启动任何 worker', async () => {
    let calls = 0
    const out = await mapWithConcurrency([], 3, () => {
      calls += 1
    })
    expect(out).toEqual([])
    expect(calls).toBe(0)
  })

  it('limit 非法 / 超过任务数 / 非数组输入都不炸', async () => {
    expect((await mapWithConcurrency([1, 2], 0, (n) => n)).map((r) => r.value)).toEqual([1, 2])
    expect((await mapWithConcurrency([1, 2], 99, (n) => n)).map((r) => r.value)).toEqual([1, 2])
    expect(await mapWithConcurrency(undefined, 3, (n) => n)).toEqual([])
  })
})
