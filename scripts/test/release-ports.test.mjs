/**
 * release-ports.test.mjs — 发版端口预分配单元测试（issue #246）。
 *
 * 为什么值得单测：批量并行发版时每个插件起一个隔离 DSH 实例，端口撞车 = 两个实例
 * 抢同一个端口，表现为「莫名其妙的启动失败」。原实现在每个插件内部各自
 * `findFreePort(3087)`，串行时不会撞，一并行就会同时拿到 3087。
 */
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:net'
import { findFreePorts } from '../lib/release-checks.mjs'

/** 占用端口并返回释放函数（验证「已占用端口不会被分配」）。 */
const occupy = (port) =>
  new Promise((resolve) => {
    const server = createServer()
    server.listen(port, () => resolve(() => new Promise((done) => server.close(done))))
  })

describe('findFreePorts（批量并行发版的端口预留）', () => {
  it('返回指定数量、升序、互不相同的端口', async () => {
    const ports = await findFreePorts(3300, 3)
    expect(ports).toHaveLength(3)
    expect([...ports].sort((a, b) => a - b)).toEqual(ports)
    expect(new Set(ports).size).toBe(3)
  })

  it('跳过已被占用的端口', async () => {
    const release = await occupy(3310)
    try {
      const [first] = await findFreePorts(3310, 1)
      expect(first).toBe(3311)
    } finally {
      await release()
    }
  })

  it('count <= 0 返回空数组（不做无意义探测）', async () => {
    expect(await findFreePorts(3312, 0)).toEqual([])
    expect(await findFreePorts(3312, -1)).toEqual([])
  })

  it('非法起始端口回落到 3087 段且仍返回可用端口', async () => {
    const ports = await findFreePorts(Number.NaN, 1)
    expect(ports).toHaveLength(1)
    expect(ports[0]).toBeGreaterThanOrEqual(3087)
  })
})
