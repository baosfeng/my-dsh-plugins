/**
 * 「loader 事件真会触发」集成测试（issue #429）。
 *
 * 为什么需要它：cordis 的 `ctx.on('<事件名>')` **运行时不校验事件名** —— 名字写错、宿主
 * 删掉事件、或订阅位置根本收不到，都是"静默失效"（不报错、不告警、不抛异常）。既有测试
 * （diagnostics-events.mjs / host-event-contract.mjs）只能证明"注册用了官方事件名"，证明不了
 * "事件真的会到达监听器"——后者必须让**真实的宿主代码**去派发。
 *
 * 本套件用**已装宿主**的真实 `@deepseek-ai/cordis` + `@deepseek-ai/cordis-plugin-loader`
 * 起一棵真实 loader 树，挂真实的 attachEventListeners，再 create/remove 一个 entry：
 *   - `create()` → loader 在 Entry **构造函数**里 emit `loader/entry-init`；
 *   - `remove()` → `EntryGroup.remove()` emit `loader/partial-dispose`。
 * 断言诊断记录确实出现、且带**可用标识**（issue #429 的第二个缺陷：构造函数期
 * `entry.options` 还是 `{}`，同步读取只能记成 "entry ? initialized"）。
 *
 * 无已装宿主（CI 不装宿主）时 skip —— 与 host-event-contract 的 fixture 一致测试同一策略。
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { attachEventListeners } from '../lib/events.js'
import { installedHostDir, versionOf } from '../scripts/host-events.mjs'

const hostDir = installedHostDir()
const live = hostDir === null ? test.skip : test

if (hostDir === null) {
  console.log('skip: 已装宿主不在场（本套件用真实 loader 取证，CI 无宿主安装）')
}

/** 条件轮询：不赌墙钟。setTimeout(0) 只让出事件循环，见 scripts/lib/test-sleeps.mjs 分类表。 */
async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 真实 cordis Context + 真实 Loader 服务（模块从已装宿主解析，与 dsh 启动同一份代码）。 */
async function bootLoader() {
  const hostModules = join(hostDir, 'node_modules', '@deepseek-ai')
  const cordis = await import(pathToFileURL(join(hostModules, 'cordis', 'lib', 'index.js')).href)
  const loader = await import(pathToFileURL(join(hostModules, 'cordis-plugin-loader', 'lib', 'index.js')).href)
  const app = new cordis.Context()
  app.plugin(loader.Loader)
  await waitFor(() => (typeof app.loader?.root?.create === 'function' ? app.loader : undefined))
  return app
}

/** 最小 SharedContext：只用事件环形缓冲与 persistSoon。 */
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
function makeProbePlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-my-guardian-live-'))
  const file = join(dir, 'index.js')
  writeFileSync(file, 'export const name = "gh429-probe"\nexport function apply() {}\n')
  return { dir, file }
}

live(`真实 loader（${versionOf(hostDir)}）：create 触发 loader/entry-init，诊断记录带真实 entry id`, async () => {
  const app = await bootLoader()
  const shared = makeShared()
  attachEventListeners(app, shared)
  const probe = makeProbePlugin()
  try {
    await app.loader.root.create({ id: 'gh429-probe', name: probe.file })
    await waitFor(() => shared.state.events.some((event) => event.type === 'entry-init'))
    const record = shared.state.events.find((event) => event.type === 'entry-init')
    assert.equal(
      record.message,
      'entry gh429-probe initialized',
      '构造函数期 options 还是 {}，记录要等一个 microtask 才能带上真实 id（否则退化成 "entry ? initialized"）',
    )
  } finally {
    rmSync(probe.dir, { recursive: true, force: true })
  }
})

live(`真实 loader（${versionOf(hostDir)}）：remove 触发 loader/partial-dispose，诊断记录带真实 entry id`, async () => {
  const app = await bootLoader()
  const shared = makeShared()
  attachEventListeners(app, shared)
  const probe = makeProbePlugin()
  try {
    await app.loader.root.create({ id: 'gh429-probe', name: probe.file })
    await waitFor(() => shared.state.events.some((event) => event.type === 'entry-init'))
    app.loader.root.remove('gh429-probe')
    await waitFor(() => shared.state.events.some((event) => event.type === 'entry-dispose'))
    const record = shared.state.events.find((event) => event.type === 'entry-dispose')
    assert.equal(record.message, 'entry gh429-probe disposed', 'dispose 期 options 已就绪，标识必须是真实 id')
  } finally {
    rmSync(probe.dir, { recursive: true, force: true })
  }
})
