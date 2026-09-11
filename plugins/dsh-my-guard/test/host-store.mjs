/**
 * Store tests: alert recording, query filters, persistence + restart
 * recovery, pending buffering, confirm, FIFO cap, corrupt file fallback.
 *
 * 等待约定：**不使用固定 sleep 等异步结果**（settle 只在"等真实定时器窗口"
 * 或"断言某事未发生"时使用）。凡是等异步结果出现的断言一律用 waitFor 条件轮询
 * 或 store.whenReady() 这类确定性信号——固定 sleep 在 CI 高负载下会随机红。
 */
import { test, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ALERTS } from '../lib/constants.js'
import { createStore } from '../lib/store.js'
import {
  bootPlugin,
  createTempHome,
  mockRequest,
  mockResponse,
  invoke,
  jsonOf,
  readJsonFile,
  waitFor,
  dispatchEvent,
} from './lib/helpers.mjs'

const disposeAlls = []
const tmpDirs = []
afterAll(() => {
  for (const disposeAll of disposeAlls.splice(0)) disposeAll()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function boot(config, opts) {
  const handle = bootPlugin(config, opts)
  disposeAlls.push(handle.disposeAll)
  return handle
}

function bashExec(agentId, command) {
  return {
    name: 'bash',
    callId: `call-${Math.random()}`,
    agent: { id: agentId },
    arguments: { command },
  }
}

function dispatch(listeners, exec, next) {
  return dispatchEvent(listeners, 'tools/pre-execute', exec, next)
}

/** 查询告警（路由内部等 store 就绪，测试侧无需固定 sleep）。 */
async function fetchAlerts(api, query = '') {
  const res = mockResponse()
  await invoke(api, mockRequest({ url: `/guard/api/alerts${query}` }), res)
  return jsonOf(res).value
}

/** 落盘断言：等持久化文件里出现 n 条告警（条件轮询，不猜墙钟）。 */
function waitPersisted(file, n, timeout = 2000) {
  return waitFor(
    () => {
      const parsed = readJsonFile(file)
      return parsed?.alerts?.length === n ? parsed : undefined
    },
    { timeout, message: `等待 ${file} 落盘 ${n} 条告警` },
  )
}

/** 受控 Promise（测试自己决定异步加载何时完成）。 */
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 磁盘历史告警（id/time 与新建告警不同，避免混同）。 */
function diskAlert(overrides = {}) {
  return {
    id: 42,
    time: 1_700_000_000_000,
    confirmed: false,
    type: 'destructive',
    severity: 'high',
    message: '历史告警',
    sessionId: 's-old',
    ...overrides,
  }
}

/** 在指定 DSH_HOME 下运行（store 单测直接 createStore，需要环境变量指向临时 home）。 */
async function inHome(home, run) {
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run()
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
  }
}

test('alerts are returned newest-first with type filter and limit', async () => {
  const { listeners, api, disposeAll } = boot({})
  const next = async () => ({ kind: 'allow' })
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), next)
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), next)
  await dispatch(listeners, bashExec('s-1', 'ls -la'), next)
  const all = await fetchAlerts(api)
  assert.equal(all.length, 2)
  assert.ok(all[0].time >= all[1].time, 'newest first')
  const filtered = await fetchAlerts(api, '?type=destructive')
  assert.equal(filtered.length, 2)
  const limited = await fetchAlerts(api, '?limit=1')
  assert.equal(limited.length, 1)
  const bySession = await fetchAlerts(api, '?sessionId=s-1')
  assert.equal(bySession.length, 2)
  const otherSession = await fetchAlerts(api, '?sessionId=s-other')
  assert.equal(otherSession.length, 0)
  disposeAll()
})

test('alerts persist and survive a plugin restart', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const first = boot({}, { home })
  await dispatch(first.listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  first.disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(first.disposeAll), 1)
  // 确定性等待卸载冲刷落盘（不再用 600ms 固定 sleep 猜写入是否完成）
  await waitPersisted(join(home, 'guard', 'alerts.json'), 1)

  const second = boot({}, { home })
  const alerts = await fetchAlerts(second.api)
  assert.equal(alerts.length, 1, 'alert restored after restart')
  assert.equal(alerts[0].type, 'destructive')
  second.disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(second.disposeAll), 1)
})

test('alerts recorded before load completes are buffered, not lost', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const first = boot({}, { home })
  await dispatch(first.listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  first.disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(first.disposeAll), 1)
  await waitPersisted(join(home, 'guard', 'alerts.json'), 1)

  const second = boot({}, { home })
  // 立即记录（加载可能未完成）→ 缓冲；查询侧由 /guard/api 等 store 就绪，
  // 因此这里不需要任何 sleep 就能确定性地看到「磁盘历史 + 缓冲告警」
  await dispatch(second.listeners, bashExec('s-2', 'rm -rf /'), async () => ({ kind: 'allow' }))
  const alerts = await fetchAlerts(second.api)
  assert.equal(alerts.length, 2, 'buffered alert merged with loaded state')
  second.disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(second.disposeAll), 1)
})

test('alerts recorded right after boot are queryable without any wall-clock wait', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const { listeners, api, disposeAll } = boot({}, { home })
  // 关键：记录后**不 sleep、不轮询**，直接查询。此刻异步加载一定还没完成
  //（readFile 至少需要一个 IO tick），刚记录的告警仍必须可见——
  // 这就是 CI 上偶发失败（600ms 内没等到加载完成 → 只见 1 条）的确定性复现。
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  const alerts = await fetchAlerts(api)
  assert.equal(alerts.length, 1, 'boot 后立即记录的告警必须可查询')
  disposeAll()
})

test('store: slow load merges buffered alerts deterministically (injected load gate)', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const file = join(home, 'guard', 'alerts.json')
  mkdirSync(join(home, 'guard'), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, alerts: [diskAlert()] }))

  const gate = deferred()
  await inHome(home, async () => {
    const store = createStore(
      {},
      {
        // 受控慢加载：读取被 gate 挂起 → 确定性地制造「加载慢于事件到达」
        readFile: async () => {
          await gate.promise
          return readFileSync(file, 'utf8')
        },
      },
    )
    const buffered = store.record({
      sessionId: 's-new',
      type: 'destructive',
      severity: 'high',
      message: '加载期间的告警',
    })
    gate.resolve()
    // 确定性信号：加载 + 缓冲回放都已完成（替代"sleep 一会儿猜加载好了没"）
    await store.whenReady()
    assert.equal(store.count(), 2, '磁盘历史 + 加载期间缓冲的告警')
    assert.equal(store.state.alerts.length, 2, 'store.state 引用保持有效')
    assert.deepEqual(
      store.alerts().map((alert) => alert.message),
      ['加载期间的告警', '历史告警'],
      '最新在前',
    )
    assert.equal(store.confirm(buffered.id), true, '缓冲告警可确认')
    store.dispose()
  })
})

test('store: dispose while load is pending persists history + buffered alerts at once', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const file = join(home, 'guard', 'alerts.json')
  mkdirSync(join(home, 'guard'), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, alerts: [diskAlert()] }))

  const gate = deferred()
  const snapshots = []
  await inHome(home, async () => {
    const store = createStore(
      {},
      {
        // 加载挂起（本进程还没读到磁盘历史），写盘只记录快照（不碰真实文件）
        readFile: async () => {
          await gate.promise
          return readFileSync(file, 'utf8')
        },
        writeFile: async (_file, text) => {
          snapshots.push(JSON.parse(text))
        },
      },
    )
    store.record({ sessionId: 's-new', type: 'destructive', severity: 'high', message: '卸载前的告警' })
    store.dispose() // 加载尚未完成就卸载
    gate.resolve() // 之后加载才完成
    await waitFor(() => snapshots.some((snapshot) => snapshot.alerts.length === 2), {
      timeout: 1500,
      message: '等待卸载后落盘（历史 + 缓冲告警）',
    })
    // 首次落盘就必须是完整状态：加载完成前先写「缺历史」的快照会在真实
    // teardown（进程退出，后续防抖写不再发生）时永久丢掉磁盘历史
    assert.equal(snapshots[0].alerts.length, 2, '卸载后的首次落盘必须包含磁盘历史')
    assert.deepEqual(snapshots[0].alerts.map((alert) => alert.message).sort(), ['卸载前的告警', '历史告警'].sort())
  })
})

test('confirm marks an alert as confirmed', async () => {
  const { listeners, api, disposeAll } = boot({})
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  const alerts = await fetchAlerts(api)
  const id = alerts[0].id
  assert.equal(alerts[0].confirmed, false)
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({ url: '/guard/api/alerts/confirm', method: 'POST', body: JSON.stringify({ id }) }),
    res,
  )
  assert.equal(res.writeHeadStatus, 200)
  assert.equal(jsonOf(res).value.confirmed, true)
  const after = await fetchAlerts(api)
  assert.equal(after[0].confirmed, true)
  assert.ok(typeof after[0].confirmedAt === 'number')
  disposeAll()
})

test('confirm with unknown id returns confirmed:false', async () => {
  const { api, disposeAll } = boot({})
  const res = mockResponse()
  await invoke(
    api,
    mockRequest({
      url: '/guard/api/alerts/confirm',
      method: 'POST',
      body: JSON.stringify({ id: 9999 }),
    }),
    res,
  )
  assert.equal(jsonOf(res).value.confirmed, false)
  disposeAll()
})

test('corrupt state file falls back to empty state', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  mkdirSync(join(home, 'guard'), { recursive: true })
  writeFileSync(join(home, 'guard', 'alerts.json'), 'not json{{{')
  const { api, disposeAll } = boot({}, { home })
  const alerts = await fetchAlerts(api)
  assert.deepEqual(alerts, [])
  disposeAll()
})

test('invalid alert entries are filtered on load', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  mkdirSync(join(home, 'guard'), { recursive: true })
  writeFileSync(
    join(home, 'guard', 'alerts.json'),
    JSON.stringify({
      version: 1,
      alerts: [
        { time: 1, type: 'destructive', message: 'ok' },
        { time: 'bad', type: 'destructive', message: 'bad time' },
        { type: 'no-time' },
      ],
    }),
  )
  const { api, disposeAll } = boot({}, { home })
  const alerts = await fetchAlerts(api)
  assert.equal(alerts.length, 1)
  disposeAll()
})

test('alert cap evicts oldest alerts FIFO', async () => {
  const { listeners, api, disposeAll } = boot({})
  for (let i = 0; i < MAX_ALERTS + 50; i += 1) {
    await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  }
  const alerts = await fetchAlerts(api)
  assert.equal(alerts.length, MAX_ALERTS)
  disposeAll()
})

test('status reports alert count and config', async () => {
  const { listeners, api, disposeAll } = boot({ mode: 'ask' })
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  const res = mockResponse()
  await invoke(api, mockRequest({ url: '/guard/api/status' }), res)
  const value = jsonOf(res).value
  assert.equal(value.alertCount, 1)
  assert.equal(value.mode, 'ask')
  disposeAll()
})

test('persisted file is written atomically under guard dir', async () => {
  const home = createTempHome()
  tmpDirs.push(home)
  const { listeners, disposeAll } = boot({}, { home })
  await dispatch(listeners, bashExec('s-1', 'rm -rf /'), async () => ({ kind: 'allow' }))
  disposeAll()
  disposeAlls.splice(disposeAlls.indexOf(disposeAll), 1)
  const file = join(home, 'guard', 'alerts.json')
  const parsed = await waitPersisted(file, 1)
  assert.equal(parsed.alerts[0].type, 'destructive')
})
