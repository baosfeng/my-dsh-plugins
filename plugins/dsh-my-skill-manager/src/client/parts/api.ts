// ── api：/my-skill-manager/api 的请求与防御性归一化 ──────────────────────
// 契约（impl-contract-skill-manager.md + 服务端确认）：
//   GET  /list?cwd=        → { cwd, projectRoot, scannedAt, skills[], globalDisabled[],
//                              projectDisabled[], diagnostics:{missing[]}, usage{} }
//   GET  /detail?name=&cwd= → { name, path, content, truncated }（仅白名单根，≤256KB）
//   GET  /rescan?cwd=      → 同 /list（服务端先 invalidate catalog）
//   GET  /session?sessionId= → { cwd }
//   PUT  /config           → { scope, disabled[], cwd } → { ok: true }
// 响应外壳一律 { ok: true, value } / { ok: false, error: { code, message } }；
// 写接口成功无 value。
const API_BASE = '/my-skill-manager/api'

/** 服务端 JSON 外壳（字段防御性读取）。 */
interface ApiEnvelope {
  ok?: unknown
  value?: unknown
  error?: unknown
  message?: unknown
}

/** error / message 字段 → 文案（字符串直接用，对象取 .message）。 */
function errorMessageOf(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw === null || typeof raw !== 'object') return ''
  const message = (raw as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

/** 把服务端 error 对象/字符串收敛成一句可展示的文案。 */
function apiMessage(body: unknown, fallback: string): string {
  if (body === null || typeof body !== 'object') return fallback
  const source = body as ApiEnvelope
  const fromError = errorMessageOf(source.error)
  if (fromError !== '') return fromError
  const fromBody = errorMessageOf(source.message)
  return fromBody === '' ? fallback : fromBody
}

/** 统一请求：解析外壳，ok !== true 时抛出带服务端文案的 Error。 */
function apiRequest(path: string, init: RequestInit | undefined, fallback: string): Promise<unknown> {
  return fetch(API_BASE + path, init)
    .then((response) => response.json())
    .then((body: unknown) => {
      if (body === null || typeof body !== 'object' || (body as ApiEnvelope).ok !== true) {
        throw new Error(apiMessage(body, fallback))
      }
      return (body as ApiEnvelope).value
    })
}

/** 任意异常 → 展示文案。 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return strings.saveFailedFallback()
}

// ── 字段归一化 ─────────────────────────────────────────────────────────
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) if (typeof entry === 'string') out.push(entry)
  return out
}

/** usage 条目：{ count, lastUsedAt, lastSource }。字段缺失返回 null。 */
function normalizeUsage(raw: unknown): UsageValue | null {
  if (raw === null || typeof raw !== 'object') return null
  const entry = raw as { count?: unknown; lastUsedAt?: unknown; lastSource?: unknown }
  if (typeof entry.count !== 'number' && typeof entry.lastUsedAt !== 'number') return null
  return {
    count: asNumber(entry.count),
    lastUsedAt: asNumber(entry.lastUsedAt),
    lastSource: entry.lastSource === 'model' ? 'model' : 'user',
  }
}

/** invocation：{ modelInvocable, userInvocable }；缺失返回 null。 */
function normalizeInvocation(raw: unknown): InvocationValue | null {
  if (raw === null || typeof raw !== 'object') return null
  const entry = raw as { modelInvocable?: unknown; userInvocable?: unknown }
  if (typeof entry.modelInvocable !== 'boolean' && typeof entry.userInvocable !== 'boolean') return null
  return {
    modelInvocable: entry.modelInvocable === true,
    userInvocable: entry.userInvocable === true,
  }
}

/** usage 映射：name → { count, lastUsedAt, lastSource }。 */
function normalizeUsageMap(raw: unknown): Record<string, UsageValue> {
  const usage: Record<string, UsageValue> = {}
  if (raw === null || typeof raw !== 'object') return usage
  const table = raw as Record<string, unknown>
  for (const key of Object.keys(table)) {
    const entry = normalizeUsage(table[key])
    if (entry !== null) usage[key] = entry
  }
  return usage
}

/** diagnostics.missing[] → { name, path, reason }。 */
function normalizeMissing(raw: unknown): ServerMissingRow[] {
  const missing: ServerMissingRow[] = []
  if (raw === null || typeof raw !== 'object') return missing
  const list = (raw as { missing?: unknown }).missing
  if (!Array.isArray(list)) return missing
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as ServerMissingRow
    missing.push({ name: asString(row.name), path: asString(row.path), reason: asString(row.reason) })
  }
  return missing
}

/** skills[] → 只保留对象条目（字段留待 model.ts 归一化）。 */
function normalizeSkills(raw: unknown): ServerSkillRow[] {
  const skills: ServerSkillRow[] = []
  if (!Array.isArray(raw)) return skills
  for (const entry of raw) {
    if (entry !== null && typeof entry === 'object') skills.push(entry as ServerSkillRow)
  }
  return skills
}

/** /list → ListValue。 */
function normalizeList(value: unknown): ListValue {
  const payload = (value !== null && typeof value === 'object' ? value : {}) as ServerListPayload
  return {
    cwd: asString(payload.cwd),
    projectRoot: asString(payload.projectRoot),
    scannedAt: asNumber(payload.scannedAt),
    skills: normalizeSkills(payload.skills),
    globalDisabled: asStringList(payload.globalDisabled),
    projectDisabled: asStringList(payload.projectDisabled),
    missing: normalizeMissing(payload.diagnostics),
    usage: normalizeUsageMap(payload.usage),
  }
}

// ── 请求 ───────────────────────────────────────────────────────────────
function apiQuery(cwd: string): string {
  return cwd === '' ? '' : '?cwd=' + encodeURIComponent(cwd)
}

/** GET /list → 归一化列表。 */
function fetchList(cwd: string): Promise<ListValue> {
  return apiRequest('/list' + apiQuery(cwd), undefined, strings.listFailedFallback()).then(normalizeList)
}

/** GET /rescan → 归一化列表（服务端先 invalidate）。 */
function rescanCatalog(cwd: string): Promise<ListValue> {
  return apiRequest('/rescan' + apiQuery(cwd), undefined, strings.rescanFailedFallback()).then(normalizeList)
}

/** GET /detail → SKILL.md（content 可能已被服务端按 256KB 截断）。 */
function fetchDetail(name: string, cwd: string): Promise<DetailValue> {
  const query = '/detail?name=' + encodeURIComponent(name) + (cwd === '' ? '' : '&cwd=' + encodeURIComponent(cwd))
  return apiRequest(query, undefined, strings.detailFailedFallback()).then((value) => {
    const payload = (value !== null && typeof value === 'object' ? value : {}) as ServerDetailPayload
    return {
      name: asString(payload.name) === '' ? name : asString(payload.name),
      path: asString(payload.path),
      content: asString(payload.content),
      truncated: payload.truncated === true,
    }
  })
}

/** PUT /config：写入某个作用域的禁用名单。 */
function saveConfig(scope: 'global' | 'project', disabled: string[], cwd: string): Promise<void> {
  return apiRequest(
    '/config',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, disabled, cwd }),
    },
    strings.saveFailedFallback(),
  ).then(() => undefined)
}

/** 当前会话 id（localStorage 'dsh.sessions.current' → { sessionId }）。 */
function currentSessionId(): string {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      const sessionId = (parsed as { sessionId?: unknown }).sessionId
      if (typeof sessionId === 'string') return sessionId
    }
    return ''
  } catch {
    return ''
  }
}

/** GET /session → 会话 cwd；无会话或失败一律 ''（无项目上下文）。 */
function fetchSessionCwd(sessionId: string): Promise<string> {
  if (sessionId === '') return Promise.resolve('')
  return apiRequest('/session?sessionId=' + encodeURIComponent(sessionId), undefined, 'session failed')
    .then((value) => {
      if (value === null || typeof value !== 'object') return ''
      return asString((value as { cwd?: unknown }).cwd)
    })
    .catch(() => '')
}
