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

// ── agent 记忆（issue #502）：独立端点 /my-memory/api/agent-memory ──
// 与上面两套的语义相反：**写入不需要 confirmed 标记**（agent 自主维护，
// 面板是用户自己的入口，改自己的记忆不必再问一次）。

/** 面板上的一份 agent 记忆（正文 + 只有用户可见的元数据）。 */
interface AgentMemoryEntry {
  name: string
  /** 项目可读名（服务端从 index.json 补齐；缺失时面板退回显示 hash id）。 */
  projectName?: string
  content: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  readCount: number
  archived: boolean
}

/** 面板分组：全局一份 + 每个项目一份（只装活跃条目，归档区单独给）。 */
interface AgentMemoryGroup {
  /** 稳定开关 id：`global` / `project:<id>`。 */
  id: string
  kind: 'global' | 'project'
  projectId?: string
  projectName?: string
  entries: AgentMemoryEntry[]
  count: number
  latestUpdatedAt: number
}

/** 晋升时会被删除的一处（项目文件 + 那一行）。 */
interface PromoteSource {
  name: string
  projectId: string
  projectName: string
  line: string
}

/** 跨项目晋升建议（服务端用 duplicates.ts 的相似度算出，阈值不另设）。 */
interface PromoteSuggestion {
  text: string
  similarity: number
  sources: PromoteSource[]
  /** 不能进全局的原因（路径 / 地址 / 端口 / 仓库名）；null = 可晋升。 */
  blocked: string | null
}

/** agent 记忆端点的载荷：分组 + 归档区 + 晋升建议。 */
interface AgentMemoryPayload {
  groups: AgentMemoryGroup[]
  archived: AgentMemoryEntry[]
  suggestions: PromoteSuggestion[]
}

/** 空载荷（首次渲染 / 响应形状漂移时的兜底）。 */
function emptyAgentMemoryPayload(): AgentMemoryPayload {
  return { groups: [], archived: [], suggestions: [] }
}

/** 归一化端点返回值：缺字段一律当空，绝不因形状漂移让整个面板崩掉。 */
function normalizeAgentMemory(value: Partial<AgentMemoryPayload> | undefined): AgentMemoryPayload {
  return {
    groups: Array.isArray(value?.groups) ? value.groups : [],
    archived: Array.isArray(value?.archived) ? value.archived : [],
    suggestions: Array.isArray(value?.suggestions) ? value.suggestions : [],
  }
}

/**
 * 响应 → 载荷；失败时把**服务端给的原因**抛出去（晋升被拒绝时用户必须看到
 * 为什么，所以这里不能像别处那样只抛一句通用文案）。
 */
function agentMemoryPayloadOf(
  body: (ApiResponse<AgentMemoryPayload> & { error?: { message?: string } }) | null,
  fallback: string,
): AgentMemoryPayload {
  if (body === null || body.ok !== true) throw new Error(body?.error?.message ?? fallback)
  return normalizeAgentMemory(body.value)
}

/** GET /my-memory/api/agent-memory → 分组 + 归档 + 晋升建议。 */
function fetchAgentMemory(): Promise<AgentMemoryPayload> {
  return fetch(`${API_BASE}/agent-memory`)
    .then((res) => res.json())
    .then((body) => agentMemoryPayloadOf(body, strings.loadError()))
}

/** POST /my-memory/api/agent-memory — write | delete | restore（用户自己的面板入口）。 */
function writeAgentMemory(payload: {
  action: 'write' | 'delete' | 'restore'
  name: string
  content?: string
}): Promise<AgentMemoryPayload> {
  return fetch(`${API_BASE}/agent-memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((body) => agentMemoryPayloadOf(body, strings.saveFailed()))
}

/** POST promote：把一条跨项目重复的条目晋升进 user.md（服务端重算建议再执行）。 */
function promoteAgentMemory(text: string): Promise<AgentMemoryPayload> {
  return fetch(`${API_BASE}/agent-memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'promote', text }),
  })
    .then((res) => res.json())
    .then((body) => agentMemoryPayloadOf(body, strings.agentMemoryPromoteFailed()))
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
