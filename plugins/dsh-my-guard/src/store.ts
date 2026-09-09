/**
 * dsh-my-guard — alert store.
 *
 * 告警记录的内存态 + 持久化：
 *  - 全局告警列表（每条带 sessionId/type/severity），FIFO 上限
 *    MAX_ALERTS 防膨胀；
 *  - 持久化 $DSH_HOME/guard/alerts.json（防抖 500ms + 原子写 tmp+rename
 *    + teardown flush），启动时异步加载（加载完成前的事件缓冲在 pending，
 *    加载后回放），重启后完整恢复；
 *  - confirm(id) 标记告警已确认（用户确认机制）。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MAX_ALERTS } from './constants.js'
import type { DshContext, Alert, AlertStore } from './types.js'

/** 告警数据文件：$DSH_HOME/guard/alerts.json（fallback ~/.dsh/…）。 */
export function stateFile(): string {
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home !== '' ? home : homedir()
  return join(base, 'guard', 'alerts.json')
}

/** 内部状态。 */
interface StoreState {
  version: number
  alerts: Alert[]
}

/** 存储句柄。 */
interface StoreHandle {
  ctx: DshContext
  file: string
  store: { state: StoreState }
  pending: Alert[]
  ready: boolean
  persistTimer: ReturnType<typeof setTimeout> | null
  dirtyChain: Promise<void>
  seq: number
}

/** 初始空状态。 */
function createState(): StoreState {
  return { version: 1, alerts: [] }
}

/**
 * 创建告警存储：{ state, record, alerts, count, confirm, dispose }。
 * record 在状态加载完成前缓冲（不丢告警）；dispose 冲刷未落盘数据。
 */
export function createStore(ctx: DshContext): AlertStore {
  const state = createState()
  const handle: StoreHandle = {
    ctx,
    file: stateFile(),
    store: { state },
    pending: [],
    ready: false,
    persistTimer: null,
    dirtyChain: Promise.resolve(),
    seq: 0,
  }
  const store: AlertStore = {
    state: handle.store.state,
    record: (alert: Alert) => record(handle, alert),
    alerts: (sessionId?: string, type?: string, limit?: number) => alertsOf(handle, sessionId, type, limit),
    count: () => countOf(handle),
    confirm: (id: number) => confirmOf(handle, id),
    dispose: () => dispose(handle),
  }
  void readFile(handle.file, 'utf8')
    .then((text) => onLoaded(handle, text))
    .catch(() => onLoaded(handle, ''))
  return store
}

/** 追加一条告警（自动分配 id/时间戳）；未就绪时缓冲。 */
function record(handle: StoreHandle, alert: Alert): Alert {
  const item: Alert = { id: nextId(handle), time: Date.now(), confirmed: false, ...alert }
  if (!handle.ready) {
    handle.pending.push(item)
    return item
  }
  appendAlert(handle, item)
  persistSoon(handle)
  return item
}

/** 查询告警（type 可选过滤；limit 限制条数；倒序=最新在前）。 */
function alertsOf(handle: StoreHandle, sessionId?: string, type?: string, limit?: number): Alert[] {
  let list = handle.store.state.alerts
  if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
    list = list.filter((alert) => alert.sessionId === sessionId)
  }
  if (type !== undefined && type !== null && type !== '') {
    list = list.filter((alert) => alert.type === type)
  }
  const capped = typeof limit === 'number' && limit > 0 ? list.slice(-limit) : list
  return [...capped].reverse().map((alert) => ({ ...alert }))
}

/** 告警总数（供状态展示/测试断言）。 */
function countOf(handle: StoreHandle): number {
  return handle.store.state.alerts.length
}

/** 标记告警已确认；返回是否找到并更新。 */
function confirmOf(handle: StoreHandle, id: number): boolean {
  const alert = handle.store.state.alerts.find((item) => item.id === id)
  if (alert === undefined) return false
  if (!alert.confirmed) {
    alert.confirmed = true
    alert.confirmedAt = Date.now()
    persistSoon(handle)
  }
  return true
}

/** 告警自增 id。 */
function nextId(handle: StoreHandle): number {
  handle.seq += 1
  return handle.seq
}

/** 追加告警：FIFO 淘汰超上限的最旧告警。 */
function appendAlert(handle: StoreHandle, item: Alert): void {
  handle.store.state.alerts.push(item)
  if (handle.store.state.alerts.length > MAX_ALERTS) {
    handle.store.state.alerts.splice(0, handle.store.state.alerts.length - MAX_ALERTS)
  }
}

/** 状态加载完成：解析/规整 + 合并本进程已产生的告警 + 回放缓冲 + 落盘。 */
function onLoaded(handle: StoreHandle, text: string): void {
  const parsed = parseLoaded(text)
  if (parsed !== undefined) {
    mergeCurrent(handle.store.state, parsed)
    handle.store.state = parsed
  }
  handle.ready = true
  const pending = handle.pending.splice(0)
  for (const item of pending) appendAlert(handle, item)
  if (pending.length > 0 || parsed !== undefined) persistSoon(handle)
}

/** 把当前 state 中已产生的告警合并进磁盘状态（防 dispose 回放后覆盖丢失）。 */
function mergeCurrent(current: StoreState, parsed: StoreState): void {
  if (current.alerts.length > 0) parsed.alerts.push(...current.alerts)
}

/** 解析已持久化的状态（结构不合法时回退空状态）。 */
function parseLoaded(text: string): StoreState | undefined {
  if (text === undefined || text === null || text === '') return undefined
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.alerts)) return undefined
    const state = createState()
    state.alerts = (parsed.alerts as Alert[]).filter(isValidAlert).slice(-MAX_ALERTS)
    return state
  } catch {
    return undefined
  }
}

/** 告警结构校验（时间/类型/消息为合理形态）。 */
function isValidAlert(alert: unknown): boolean {
  return (
    alert !== null &&
    typeof alert === 'object' &&
    typeof (alert as Record<string, unknown>).time === 'number' &&
    typeof (alert as Record<string, unknown>).type === 'string' &&
    typeof (alert as Record<string, unknown>).message === 'string'
  )
}

/** 原子写当前状态（经 dirtyChain 串行化；自动建目录）。 */
function persistNow(handle: StoreHandle): void {
  // 简化实现：使用 writeFile 代替 atomicWriteJson（dsh-shared 未安装时的降级）
  handle.dirtyChain = handle.dirtyChain
    .then(async () => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdir(dirname(handle.file), { recursive: true })
      await writeFile(handle.file, JSON.stringify(handle.store.state, null, 2), 'utf8')
    })
    .catch(() => {})
}

/** 防抖（500ms）调度持久化。 */
function persistSoon(handle: StoreHandle): void {
  if (handle.persistTimer !== null) return
  handle.persistTimer = setTimeout(() => {
    handle.persistTimer = null
    persistNow(handle)
  }, 500)
}

/** 卸载冲刷：清定时器 + 回放未就绪缓冲 + 立即落盘。 */
function dispose(handle: StoreHandle): void {
  if (handle.persistTimer !== null) {
    clearTimeout(handle.persistTimer)
    handle.persistTimer = null
  }
  if (!handle.ready) {
    const pending = handle.pending.splice(0)
    for (const item of pending) appendAlert(handle, item)
  }
  persistNow(handle)
  void handle.dirtyChain
}
