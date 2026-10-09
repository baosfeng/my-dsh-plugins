/**
 * dsh-my-memory — /my-memory/api/prompts 路由（issue #465）。
 *
 * 与 /memory 是**独立端点**（不复用）：
 *  - GET  → 全部提示词（按 order 升序；**只全局一层**，无 scope/cwd 参数）；
 *  - POST → 写操作 add | update | delete | toggle | reorder，每个都必须带
 *    \`confirmed: true\`（与记忆同一道用户同意门）；缺失一律 400。
 *
 * 信任围栏（loopback + trustedHosts）由调用方（api-route 的 handler）在其
 * 入口统一执行，本模块只处理「已通过围栏之后」的分派与校验。
 */
import { readJsonBody, writeJson } from 'dsh-shared'
import type { PromptItem, PromptStoreInstance } from './prompt-types.js'
import type { LoggerService, ServerRequest, ServerResponse } from './api-route.types.js'

/** 提示词路由的分派结果：true = 已处理（含已写响应）。 */
export async function routePrompts(
  url: URL,
  request: ServerRequest,
  response: ServerResponse,
  { promptsStore, logger }: { promptsStore: PromptStoreInstance; logger?: LoggerService },
): Promise<boolean> {
  if (!url.pathname.endsWith('/prompts')) return false
  if (request.method === 'GET') {
    writeItems(response, await allPrompts(promptsStore))
    return true
  }
  if (request.method === 'POST') {
    await handlePromptWrite(request, response, promptsStore, logger)
    return true
  }
  return false
}

/** 读全部提示词（先等就绪，再按 order 升序返回）。 */
async function allPrompts(promptsStore: PromptStoreInstance): Promise<PromptItem[]> {
  await promptsStore.load()
  return promptsStore.list()
}

/** 200 + 当前全部提示词（每次写后回传，面板据此刷新）。 */
function writeItems(response: ServerResponse, items: PromptItem[]): void {
  writeJson(response, 200, { ok: true, value: { items } })
}

/** 拒绝：状态码 + 可读原因（绝不静默改变提示词）。 */
function rejectPrompt(response: ServerResponse, status: number, message: string): void {
  writeJson(response, status, { ok: false, error: { message } })
}

/** POST 写操作：同意门 → 分派 → 回传最新列表。 */
async function handlePromptWrite(
  request: ServerRequest,
  response: ServerResponse,
  promptsStore: PromptStoreInstance,
  logger?: LoggerService,
): Promise<void> {
  const payload = await readJsonBody(request)
  if (payload?.confirmed !== true) {
    rejectPrompt(response, 400, 'prompt write requires confirmed: true (user consent)')
    return
  }
  const outcome = await applyPromptWrite(promptsStore, payload)
  if (isRejected(outcome)) {
    rejectPrompt(response, outcome.status, outcome.message)
    return
  }
  logger?.info(
    '[dsh-my-memory] 提示词写操作完成（action=' +
      String(payload.action) +
      '，itemId=' +
      String(payload.id ?? '') +
      '）',
  )
  // 回传最新完整列表 + 本次变更的条目（add/update/toggle 带上；delete 无条目）。
  writeJson(response, 200, {
    ok: true,
    value: { items: await allPrompts(promptsStore), item: outcome.item },
  })
}

/** 写操作被拒（带状态码与可读原因）。 */
interface PromptWriteRejection {
  status: number
  message: string
}

/** 写操作成功：item = 本次创建/修改的条目（delete / reorder / list 为 null）。 */
interface PromptWriteSuccess {
  item: PromptItem | null
}

/** 写操作结果（判别式：有 status 即被拒）。 */
type PromptWriteOutcome = PromptWriteRejection | PromptWriteSuccess

/** 是否被拒（判别式收窄）。 */
function isRejected(outcome: PromptWriteOutcome): outcome is PromptWriteRejection {
  return typeof (outcome as PromptWriteRejection).status === 'number'
}

/** 分派一个已过同意门的写操作；返回拒绝原因或成功结果（含变更条目）。 */
async function applyPromptWrite(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  if (payload.action === 'add') return applyPromptAdd(promptsStore, payload)
  if (payload.action === 'update') return applyPromptUpdate(promptsStore, payload)
  if (payload.action === 'toggle') return applyPromptToggle(promptsStore, payload)
  if (payload.action === 'reorder') return applyPromptReorder(promptsStore, payload)
  if (payload.action === 'delete') return applyPromptDelete(promptsStore, payload)
  if (payload.action === 'list') return { item: null }
  return { status: 400, message: 'action must be "add", "update", "delete", "toggle" or "reorder"' }
}

/** 新增：标题与正文都必需（提示词是强指令面，拒绝半成品）。 */
async function applyPromptAdd(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (title === '') return { status: 400, message: 'add requires a non-empty title' }
  if (text === '') return { status: 400, message: 'add requires a non-empty text' }
  const created = await promptsStore.add({ title, text })
  if (created === null) return { status: 400, message: 'prompt limit reached (maxPromptItems)' }
  return { item: created }
}

/** 编辑：id 必需，title/text 至少给一个。 */
async function applyPromptUpdate(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { status: 400, message: 'update requires an id' }
  const title = typeof payload.title === 'string' ? payload.title.trim() : undefined
  const text = typeof payload.text === 'string' ? payload.text.trim() : undefined
  if (title === undefined && text === undefined) return { status: 400, message: 'update requires title or text' }
  if (text !== undefined && text === '') return { status: 400, message: 'update requires a non-empty text' }
  const changes: { title?: string; text?: string } = {}
  if (title !== undefined) changes.title = title
  if (text !== undefined) changes.text = text
  const updated = await promptsStore.update(id, changes)
  if (updated === null) return { status: 404, message: 'prompt not found' }
  return { item: updated }
}

/** 启停：enabled 必须是布尔（显式表达意图，不接受真值转换）。 */
async function applyPromptToggle(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { status: 400, message: 'toggle requires an id' }
  if (typeof payload.enabled !== 'boolean') return { status: 400, message: 'toggle requires a boolean enabled' }
  const toggled = await promptsStore.toggle(id, payload.enabled)
  if (toggled === null) return { status: 404, message: 'prompt not found' }
  return { item: toggled }
}

/** 上移/下移：direction ∈ {up, down}；已在端点时为 200 no-op（幂等，不报错）。 */
async function applyPromptReorder(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { status: 400, message: 'reorder requires an id' }
  if (payload.direction !== 'up' && payload.direction !== 'down') {
    return { status: 400, message: 'reorder requires direction "up" or "down"' }
  }
  await promptsStore.load()
  if (!promptsStore.list().some((item) => item.id === id)) return { status: 404, message: 'prompt not found' }
  await promptsStore.reorder(id, payload.direction)
  return { item: null }
}

/** 删除：id 必需；删的是条目，**不是**停用（停用走 toggle）。 */
async function applyPromptDelete(
  promptsStore: PromptStoreInstance,
  payload: Record<string, unknown>,
): Promise<PromptWriteOutcome> {
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { status: 400, message: 'delete requires an id' }
  if (!(await promptsStore.remove(id))) return { status: 404, message: 'prompt not found' }
  return { item: null }
}
