// ── data access (host routes) ─────────────────────────────────────────

/** 一条文件活动记录（GET /file-activity/api/stats 的 recent[] 元素）。 */
interface RecentEntry {
  path: string
  /** 'read' / 'create' / 'modify' / 'delete'（未知值按 read 渲染）。 */
  op: string
  time: number
}

/** 单文件计数（stats.counts[绝对路径]）。 */
interface FileCounter {
  read: number
  create: number
  modify: number
  /** 首次出现时间（host 记录，可能缺省）。 */
  firstSeen?: number
  /** 最近一次活动时间（host 记录，可能缺省）。 */
  lastSeen?: number
}

/** GET /file-activity/api/stats 的 value。 */
interface StatsValue {
  cwd?: string
  recent?: RecentEntry[]
  counts?: Record<string, FileCounter>
}

/** 单会话数据桶（按 sessionId 隔离，互不串味）。 */
interface SessionBucket {
  recent: RecentEntry[]
  counts: Record<string, FileCounter>
  loading: boolean
}

/** 浮窗预览目标（绝对路径 + 显示名）。 */
interface PreviewTarget {
  abs: string
  name: string
}

/** client 端全局状态（store.ts createStore 的形状）。 */
interface DataState {
  bySession: Record<string, SessionBucket>
  preview: PreviewTarget | null
}

async function fetchStats(sessionId: string): Promise<StatsValue | null> {
  const response = await fetch(`/file-activity/api/stats?sessionId=${encodeURIComponent(sessionId)}`)
  const json = await response.json()
  if (json === null || typeof json !== 'object' || json.ok !== true) return null
  return json.value
}

/** Resolve the session working directory through the sidebar's native API. */
async function fetchSessionCwd(sessionId: string): Promise<string> {
  try {
    const response = await fetch('/sidebar/api/session.cwd', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const json = await response.json()
    const cwd = json?.value?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : ''
  } catch {
    return ''
  }
}

function postRecord(sessionId: string, path: string, op: string): void {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof path !== 'string' || path === '') return
  void fetch('/file-activity/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, path, op }),
  }).catch(() => {})
}

function postClear(sessionId: string): void {
  void fetch('/file-activity/api/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {})
}

/** Plugin media route URL for a recorded path (authorized per session). */
function mediaUrlOf(sessionId: string, path: string): string {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path })}`
}

/** Plugin text route URL (`as=text`): fs.read-shaped JSON for recorded text. */
function textUrlOf(sessionId: string, path: string): string {
  return `/file-activity/file?${new URLSearchParams({ sessionId, path, as: 'text' })}`
}
