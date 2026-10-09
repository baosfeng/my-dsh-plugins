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
      return normalizeMemory(body.value)
    })
}

/** POST /my-memory/api/memory — a write gated on the user-consent marker. */
function writeMemory({
  action,
  scope,
  cwd,
  id,
  desc,
}: {
  action: string
  scope: string
  cwd: string
  id?: string
  desc?: string
}): Promise<Required<MemoryValue>> {
  return fetch(`${API_BASE}/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, scope, cwd, id, desc, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body: ApiResponse<MemoryValue>) => {
      if (body === null || body.ok !== true) throw new Error('write failed')
      return normalizeMemory({ ...body.value, scope })
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
      return body.value
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
      return body.value
    })
}

// ── 全局提示词（issue #465）：独立端点 /my-memory/api/prompts，不复用 /memory ──

/** 提示词条目类型 */
interface PromptItem {
  id: string
  title: string
  text: string
  enabled: boolean
  order: number
  builtin?: string
  createdAt?: number
  updatedAt?: number
}

/** 提示词响应值类型 */
interface PromptsValue {
  items?: PromptItem[]
  item?: PromptItem | null
}

/** One GET/POST prompts payload into { items, item }. */
function normalizePrompts(value: PromptsValue): { items: PromptItem[]; item: PromptItem | null } {
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    item: value?.item ?? null,
  }
}

/** GET /my-memory/api/prompts → all prompts (order asc; global only). */
function fetchPrompts(): Promise<PromptItem[]> {
  return fetch(`${API_BASE}/prompts`)
    .then((res) => res.json())
    .then((body: ApiResponse<PromptsValue>) => {
      if (body === null || body.ok !== true) throw new Error('bad prompts response')
      return normalizePrompts(body.value).items
    })
}

/** POST /my-memory/api/prompts — add/update/delete/toggle/reorder, gated on
 *  the user-consent marker (the server refuses any write without it). */
function writePrompt(payload: {
  action: 'add' | 'update' | 'delete' | 'toggle' | 'reorder'
  id?: string
  title?: string
  text?: string
  enabled?: boolean
  direction?: 'up' | 'down'
}): Promise<{ items: PromptItem[]; item: PromptItem | null }> {
  return fetch(`${API_BASE}/prompts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body: ApiResponse<PromptsValue>) => {
      if (body === null || body.ok !== true) throw new Error('prompt write failed')
      return normalizePrompts(body.value)
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
    .then((body: ApiResponse<{ maxEntryLength?: number }>): { maxEntryLength: number } => {
      if (body === null || body.ok !== true) return { maxEntryLength: DEFAULT_ENTRY_LIMIT }
      const limit = body.value?.maxEntryLength
      return { maxEntryLength: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_ENTRY_LIMIT }
    })
    .catch(() => ({ maxEntryLength: DEFAULT_ENTRY_LIMIT }))
}

// 导出给其他 part 文件使用
