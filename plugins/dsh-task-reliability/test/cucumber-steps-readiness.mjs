/**
 * cucumber-steps-readiness.mjs — cucumber 步骤「读盘前先等落盘就绪」的确定性复现与防回归。
 *
 * issue #253（CI run 34732200802，job = test (dsh-task-reliability)）：
 *   Failed scenario: 校验模式会话结束后校验完成度（task-reliability.feature:53）
 *   那么任务状态变为 done（steps/task-reliability.steps.mjs:324）
 *   AssertionError: 'checking' !== 'done'
 *
 * #239 只把 **vitest 侧** 6 处「固定 sleep → 读盘」改成「drainSaves() → 读盘」；
 * cucumber 步骤里的 4 处读盘点仍是 `setTimeout(20/30ms) → readFileSync`。落盘是
 * fire-and-forget 的（save → 防抖 timer → fs/promises writeFile+rename 串行链），
 * CI 高负载下 30ms 不够，于是读到滞后的 'checking'。
 *
 * 本文件不靠多跑几次碰运气：用 vi.mock 给 writeFile 注入 60ms 延迟，把「写还没完成」
 * 变成确定性事实，然后**驱动真实的 cucumber 步骤定义**（不复制步骤逻辑）：
 *   - 慢 IO 下读盘步骤必须仍读到最新状态（修复前 RED：'checking' !== 'done' / ENOENT）；
 *   - 就绪判据是 drainSaves()（确定性信号），不是墙钟。
 */
import { test, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** vi.mock 工厂会被提升执行，共享句柄必须经 vi.hoisted 创建（避免 TDZ）。 */
const h = vi.hoisted(() => ({ steps: new Map(), World: null, ioDelayMs: 0 }))

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 注入慢 IO：writeFile 延迟由 h.ioDelayMs 控制。
 * 场景先把「旧状态」写实（delay=0），再打开延迟——于是盘上是确凿的旧值，
 * 精确复现 CI 的 'checking' !== 'done'（而不是笼统的「可能读到旧状态」）。
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFile: async (...args) => {
      if (h.ioDelayMs > 0) await tick(h.ioDelayMs)
      return actual.writeFile(...args)
    },
  }
})

/** 用收集器替换 cucumber 注册 API：拿到 step handler，但不启动 cucumber 运行时。 */
vi.mock('@cucumber/cucumber', () => ({
  Given: (expression, fn) => h.steps.set(`Given ${expression}`, fn),
  When: (expression, fn) => h.steps.set(`When ${expression}`, fn),
  Then: (expression, fn) => h.steps.set(`Then ${expression}`, fn),
  setWorldConstructor: (ctor) => {
    h.World = ctor
  },
  After: () => {},
}))

const worlds = []
afterAll(() => {
  h.ioDelayMs = 0
  for (const world of worlds.splice(0)) world.cleanup()
})

const step = (key) => {
  const fn = h.steps.get(key)
  assert.ok(fn, `step 已注册：${key}（当前：${[...h.steps.keys()].join(' | ')}）`)
  return fn
}

/** 读盘上状态（条件轮询用；不受 node:fs/promises mock 影响）。 */
function diskStatus(world) {
  try {
    return JSON.parse(readFileSync(join(world.dir, 'task-reliability.json'), 'utf8')).tasks[0]?.status
  } catch {
    return undefined
  }
}

/** 条件驱动（非固定 sleep）：等盘上出现指定状态，用于把「旧值」写实。 */
async function waitForDiskStatus(world, expected, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (diskStatus(world) === expected) return
    await tick(5)
  }
  assert.fail(`盘上状态未在 ${timeoutMs}ms 内变为 ${expected}（当前 ${diskStatus(world)}）`)
}

async function newWorld() {
  await import('./features/steps/world.mjs')
  await import('./features/steps/task-reliability.steps.mjs')
  assert.ok(h.World, 'World 构造器已注册')
  const world = new h.World()
  worlds.push(world)
  return world
}

test('慢 IO 下「任务状态变为 done」读盘前等待就绪信号（issue #253 的 CI 失败形态）', async () => {
  const world = await newWorld()
  h.ioDelayMs = 0
  await step('Given 任务可靠性插件已启动').call(world)
  await step('Given 会话 {string} 注册了校验模式任务').call(world, 's-1')
  await step('When 代理 {string} 变为空闲').call(world, 's-1')
  // 先把旧状态（checking）写实——CI 失败时盘上就是这个值
  await waitForDiskStatus(world, 'checking')
  h.ioDelayMs = 60
  await step('When 校验代理结论为已完成').call(world)
  await step('Then 任务状态变为 done').call(world)
})

test('慢 IO 下「任务注册表已写入持久化文件」读盘前等待就绪信号', async () => {
  const world = await newWorld()
  h.ioDelayMs = 60
  await step('Given 任务可靠性插件已启动').call(world)
  await step('When 我注册会话 {string} 的任务 {string}').call(world, 's-1', '开发一个功能')
  await step('Then 任务注册表已写入持久化文件').call(world)
})

test('慢 IO 下「任务记录 resumeAt」读盘前等待就绪信号', async () => {
  const world = await newWorld()
  h.ioDelayMs = 0
  await step('Given 任务可靠性插件已启动').call(world)
  await step('Given 会话 {string} 注册了活动任务').call(world, 's-1')
  await waitForDiskStatus(world, 'active')
  h.ioDelayMs = 60
  // 重启触发 resumeActiveTasks：更新 resumeAt 后 fire-and-forget 落盘
  await step('When 插件重新启动').call(world)
  await step('Then 任务记录 resumeAt').call(world)
})
