// ── api: fetch helpers for the Memory views ────────────────────────────
const API_BASE: string = '/my-memory/api'

/** 记忆条目类型 */
interface MemoryItem {
  id: string
  desc: string
  category?: string
  confidence?: number
  updatedAt?: number
  createdAt?: number
  scope?: string
  cwd?: string
  projectRoot?: string
  history?: Array<{ action: string; at: number }>
  status?: string
  source?: { sessionId?: string }
}

/** 记忆响应值类型 */
interface MemoryValue {
  scope?: string
  cwd?: string
  projectRoot?: string
  items?: MemoryItem[]
}

/** API 响应类型 */
interface ApiResponse<T = unknown> {
  ok?: boolean
  value?: T
}

/** One GET memory payload into { scope, cwd, projectRoot, items }. */
function normalizeMemory(value: MemoryValue): Required<MemoryValue> {
  return {
    scope: value.scope ?? 'global',
    cwd: value.cwd ?? '',
    projectRoot: value.projectRoot ?? '',
    items: Array.isArray(value.items) ? value.items : [],
  }
}

/** GET /my-memory/api/memory?scope=…&cwd=… → normalized value; rejects on bad responses. */
function fetchMemory(scope: string, cwd: string): Promise<Required<MemoryValue>> {
  const query = cwd.trim() === '' ? `?scope=${scope}` : `?scope=${scope}&cwd=${encodeURIComponent(cwd.trim())}`
  return fetch(`${API_BASE}/memory${query}`)
    .then((res) => res.json())
    .then((body: ApiResponse<MemoryValue>) => {
      if (body === null || body.ok !== true) throw new Error('bad memory response')
      return normalizeMemory(body.value ?? {})
    })
}

/** POST /my-memory/api/memory — a write gated on the user-consent marker. */
function writeMemory(params: { action: string; scope: string; cwd: string; id?: string; desc?: string }): Promise<Required<MemoryValue>> {
  return fetch(`${API_BASE}/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body: ApiResponse<MemoryValue>) => {
      if (body === null || body.ok !== true) throw new Error('write failed')
      return normalizeMemory({ ...body.value, scope: params.scope })
    })
}

/** GET /my-memory/api/candidates → the pending auto-extracted candidates
 *  (issue #78; read-only — candidates never touch memory before confirm). */
function fetchCandidates(): Promise<MemoryItem[]> {
  return fetch(`${API_BASE}/candidates`)
    .then((res) => res.json())
    .then((body: ApiResponse<{ items?: MemoryItem[] }>) => {
      if (body === null || body.ok !== true) throw new Error('bad candidates response')
      return Array.isArray(body.value?.items) ? body.value.items : []
    })
}

/** POST /my-memory/api/candidates/confirm — accept one candidate (user
 *  consent marker; progressive-merged into the target scope on the server). */
function confirmCandidate(id: string): Promise<MemoryValue> {
  return fetch(`${API_BASE}/candidates/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body: ApiResponse<MemoryValue>) => {
      if (body === null || body.ok !== true) throw new Error('candidate confirm failed')
      return body.value ?? {}
    })
}

/** POST /my-memory/api/candidates/dismiss — reject one candidate (drop it;
 *  gated on the user-consent marker, never touches any memory). */
function dismissCandidate(id: string): Promise<MemoryValue> {
  return fetch(`${API_BASE}/candidates/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body: ApiResponse<MemoryValue>) => {
      if (body === null || body.ok !== true) throw new Error('candidate dismiss failed')
      return body.value ?? {}
    })
}

/** Current session id from localStorage ('dsh.sessions.current' → { sessionId }). */
function currentSessionId(): string {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    const parsed = raw === null ? null : JSON.parse(raw)
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : ''
  } catch {
    return ''
  }
}

/** GET /my-memory/api/session → the session's working directory ('' if none).
 *  The panel uses it to auto-load the current project memory on open (issue #104). */
function fetchSessionCwd(sessionId: string): Promise<string> {
  if (sessionId === '') return Promise.resolve('')
  return fetch(`${API_BASE}/session?sessionId=${encodeURIComponent(sessionId)}`)
    .then((res) => res.json())
    .then((body: ApiResponse<{ cwd?: string }>) => {
      if (body === null || body.ok !== true) return ''
      return typeof body.value?.cwd === 'string' ? body.value.cwd : ''
    })
    .catch(() => '')
}

/** GET /my-memory/api/config → the entry-length guidance (issue #105):
 *  `maxEntryLength` (concise-input hint threshold) and `maxDescLength`
 *  (injection cap). Falls back to the client-side default on failure. */
function fetchConfig(): Promise<{ maxEntryLength: number }> {
  return fetch(`${API_BASE}/config`)
    .then((res) => res.json())
    .then((body: ApiResponse<{ maxEntryLength?: number }>) => {
      if (body === null || body.ok !== true) return { maxEntryLength: DEFAULT_ENTRY_LIMIT }
      const limit = body.value?.maxEntryLength
      return { maxEntryLength: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_ENTRY_LIMIT }
    })
    .catch(() => ({ maxEntryLength: DEFAULT_ENTRY_LIMIT }))
}

// 导出给其他 part 文件使用
exports.API_BASE = API_BASE
exports.normalizeMemory = normalizeMemory
exports.fetchMemory = fetchMemory
exports.writeMemory = writeMemory
exports.fetchCandidates = fetchCandidates
exports.confirmCandidate = confirmCandidate
exports.dismissCandidate = dismissCandidate
exports.currentSessionId = currentSessionId
exports.fetchSessionCwd = fetchSessionCwd
exports.fetchConfig = fetchConfig
