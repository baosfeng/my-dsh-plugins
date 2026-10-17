/**
 * 收尾整树卸载期「释放了哪些 entry」—— 用**真实 loader + 真实 cordis 卸载**取证
 * （issue #438 第二种形态）。
 *
 * 为什么必须有它：`test/teardown-dispose-persist.mjs` 的 fake tree 是我们自己写的，
 * 它能证明「差集逻辑对」，证明不了「真实 cordis 整树卸载时 loader 树在收尾 disposer
 * 开始执行的那一刻**仍然完整**（快照抓得到）、以及 `ctx.on` 监听器确实与 teardown
 * 同批被摘除（所以必须走快照）。后者只有真实宿主代码能证明。
 *
 * 断言四件事：
 *  1. 收尾 disposer 执行时 tree.store 仍含全部 entry（快照前提成立）；
 *  2. 真实整树卸载之后 store 变空 → 差集 = 全部 entry；
 *  3. 收尾释放记录数 == 释放的 entry 数（逐条同 id）；
 *  4. 运行期事件通道依旧有效（remove() 仍记 entry-dispose），与快照不重复记账。
 *
 * 无已装宿主（CI 不装宿主）时 skip —— 与 host-event-live.mjs 同一策略。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  attachEventListeners,
  captureTeardownEntries,
  diffReleasedEntries,
  recordTeardownReleases,
} from '../lib/events.js'
import { installedHostDir, versionOf } from '../scripts/host-events.mjs'

const hostDir = installedHostDir()
const live = hostDir === null ? test.skip : test

if (hostDir === null) {
  console.log('skip: 已装宿主不在场（本套件用真实 loader 取证，CI 无宿主安装）')
}

/** 条件轮询：不赌墙钟（setTimeout(0) 只让出事件循环，见 scripts/lib/test-sleeps.mjs）。 */
async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 真实 cordis Context + 真实 Loader 服务（与 dsh 启动同一份宿主代码）。 */
async function bootLoader() {
  const hostModules = join(hostDir, 'node_modules', '@deepseek-ai')
  const cordis = await import(pathToFileURL(join(hostModules, 'cordis', 'lib', 'index.js')).href)
  const loader = await import(pathToFileURL(join(hostModules, 'cordis-plugin-loader', 'lib', 'index.js')).href)
  const app = new cordis.Context()
  app.plugin(loader.Loader)
  await waitFor(() => (typeof app.loader?.root?.create === 'function' ? app.loader : undefined))
  return app
}

/** 最小 SharedContext：事件环形缓冲 + persistSoon 计数。 */
function makeShared() {
  return {
    state: { events: [] },
    persistCount: 0,
    persistSoon() {
      this.persistCount += 1
    },
  }
}

/** 探针插件：写进临时目录，用绝对路径当 loader specifier（loader 真实 import 它）。 */
function makeProbePlugin(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-release-'))
  const file = join(dir, 'index.js')
  writeFileSync(file, 'export const name = ' + JSON.stringify(tag) + '\nexport function apply() {}\n')
  return { dir, file }
}

/** 取 loader 根树的 entry store（真实 Loader 服务的形状）。 */
function treeStoreOf(app) {
  // 整树卸载后 loader 服务本身可能已下线（root 为 undefined）—— 读取必须容忍
  return app.loader?.root?.tree?.store
}

live(
  '真实 loader（' + versionOf(hostDir) + '）：整树卸载时 loader 树在收尾 disposer 起手仍完整，释放集合=快照差集',
  async () => {
    const app = await bootLoader()
    const shared = makeShared()
    attachEventListeners(app, shared)
    const probes = ['gh438-a', 'gh438-b', 'gh438-c'].map((id) => ({ id, plugin: makeProbePlugin(id) }))
    let beforeSeen = null
    let storeAfterTeardown = 'no-teardown'
    let storeAfterFullUnload
    app.effect(
      () => async () => {
        // 收尾 disposer 起手：真实 loader 树必须**仍然完整**（快照差集的前提）
        beforeSeen = captureTeardownEntries(treeStoreOf(app))
        // await 让出：同批 disposer 在此期间推进（真实 Fiber._unload 的 Promise.all 语义）
        await Promise.resolve()
        storeAfterTeardown = treeStoreOf(app)
        recordTeardownReleases(shared, beforeSeen)
      },
      'gh438: teardown',
    )
    try {
      for (const { id, plugin } of probes) await app.loader.root.create({ id, name: plugin.file })
      await waitFor(() => shared.state.events.filter((e) => e.type === 'entry-init').length >= probes.length)
      assert.ok(Object.keys(treeStoreOf(app) ?? {}).length >= probes.length, '三个探针 entry 必须真的进了 loader 树')

      // 真实整树卸载（等价于宿主进程收尾时 root fiber 的 _unload）
      app.fiber.dispose()
      await waitFor(() => beforeSeen !== null && storeAfterTeardown !== 'no-teardown')
      await waitFor(() => treeStoreOf(app) === undefined || Object.keys(treeStoreOf(app) ?? {}).length === 0)
      storeAfterFullUnload = treeStoreOf(app)

      // ① 快照前提：收尾 disposer 起手时树仍含全部探针 entry（这是差集成立的前提）
      for (const { id } of probes) {
        assert.ok(beforeSeen.has(id), '收尾 disposer 起手时 loader 树必须仍含 entry ' + id + '（快照前提）')
      }
      // ② 真实整树卸载之后 store 归零 → 差集 = 全部 entry，且条数与释放数一致
      assert.ok(
        storeAfterFullUnload === undefined || Object.keys(storeAfterFullUnload).length === 0,
        '整树卸载后 loader 树必须清空（差集才有意义）',
      )
      const released = diffReleasedEntries(beforeSeen, storeAfterFullUnload)
      const releasedProbeIds = released.filter((id) => probes.some((p) => p.id === id))
      assert.deepEqual(
        releasedProbeIds,
        probes.map((p) => p.id),
        '收尾释放集合必须与快照差集逐条一致（数量与释放的 entry 数相等）',
      )
      // ③ 收尾窗口内的记录全部落盘（persistSoon 被调用）
      assert.ok(shared.persistCount >= probes.length, '每条收尾释放都要排队落盘')
    } finally {
      for (const { plugin } of probes) rmSync(plugin.dir, { recursive: true, force: true })
    }
  },
)

live('真实 loader（' + versionOf(hostDir) + '）：运行期 remove 仍走事件通道（快照只补收尾）', async () => {
  const app = await bootLoader()
  const shared = makeShared()
  attachEventListeners(app, shared)
  const plugin = makeProbePlugin('gh438-runtime')
  app.effect(
    () => async () => {
      recordTeardownReleases(shared, captureTeardownEntries(treeStoreOf(app)))
    },
    'gh438: teardown',
  )
  try {
    await app.loader.root.create({ id: 'gh438-runtime', name: plugin.file })
    await waitFor(() => shared.state.events.some((e) => e.message === 'entry gh438-runtime initialized'))
    app.loader.root.remove('gh438-runtime')
    await waitFor(() => shared.state.events.some((e) => e.type === 'entry-dispose'))
    assert.deepEqual(
      shared.state.events.filter((e) => e.type === 'entry-dispose').map((e) => e.message),
      ['entry gh438-runtime disposed'],
      '运行期卸载仍由事件通道记录（快照差集不得把它记成第二条）',
    )
    app.fiber.dispose()
    await waitFor(() => treeStoreOf(app) === undefined || Object.keys(treeStoreOf(app) ?? {}).length === 0)
    assert.deepEqual(
      shared.state.events.filter((e) => e.type === 'entry-dispose').map((e) => e.message),
      ['entry gh438-runtime disposed'],
      '已释放的 entry 不得在收尾期被重复记录',
    )
  } finally {
    rmSync(plugin.dir, { recursive: true, force: true })
  }
})
