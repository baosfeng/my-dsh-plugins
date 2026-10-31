/**
 * dsh-my-memory — /my-memory/api/agent-memory 路由（issue #502）。
 *
 * 与 /memory、/prompts 都是**独立端点**（不复用）：
 *  - GET  → 文件列表 + 每份记忆正文 + **index.json 元数据**（创建时间、
 *           最后读取、读取次数、是否已归档）。
 *  - POST → 写操作 write | delete | restore，**不需要 confirmed** —— agent
 *           记忆本就是 agent 自主维护的，与「全局记忆必须用户确认」的语义相反。
 *           面板是**用户**的入口，用户改自己的记忆当然也不需要再问一次。
 *           restore 把归档条目搬回原位（面板能看见归档正文，才谈得上恢复）。
 *
 * 面板读元数据是本体系「给用户了解原因」的唯一落点：agent 看不到时间戳与
 * 热度（它们不注入上下文、也不能被 agent 改），但用户必须看得到。
 */
import { readJsonBody, writeJson } from 'dsh-shared'
import { createAgentMemoryRuntime } from './tools.js'
import type { AgentMemoryRuntime } from './tools.js'
import { createIndexStore } from './index-store.js'
import { createAgentMemoryStore } from './store.js'
import { listExistingFiles, normalizeName } from './paths.js'
import type { LoggerService, ServerRequest, ServerResponse } from '../api-route.types.js'

/** 一份记忆的面板视图（正文 + 元数据）。 */
interface AgentMemoryEntry {
  name: string
  content: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  readCount: number
  archived: boolean
}

/** 路由依赖。 */
export interface AgentMemoryRouteDeps {
  index: ReturnType<typeof createIndexStore>
  store: ReturnType<typeof createAgentMemoryStore>
  logger?: LoggerService
}

/**
 * 构造路由依赖（issue #502）。
 *
 * **必须与工具侧共用同一个 runtime**：index.json 是整份 cache 覆盖落盘，
 * 两个实例各持一份 cache 会互相覆盖（lost update）。调用方传 runtime；
 * 未传时自建一份（仅面板使用、无并发写者的场景）。
 */
export function createAgentMemoryRouteDeps({
  logger,
  enabled,
  runtime,
}: {
  logger?: LoggerService
  enabled?: boolean
  runtime?: AgentMemoryRuntime
}): AgentMemoryRouteDeps {
  const { index, store } = runtime ?? createAgentMemoryRuntime({ logger })
  // 关闭 agent 记忆时面板仍可读（展示历史），只是工具与说明段不再注册。
  void enabled
  return { index, store, logger }
}

/** 一份记忆的面板视图（缺元数据时给零值，绝不因元数据缺失隐藏正文）。 */
function viewOf(
  name: string,
  content: string,
  meta:
    { createdAt: number; updatedAt: number; lastReadAt: number; readCount: number; archivedAt?: number } | undefined,
): AgentMemoryEntry {
  return {
    name,
    content,
    createdAt: meta?.createdAt ?? 0,
    updatedAt: meta?.updatedAt ?? 0,
    lastReadAt: meta?.lastReadAt ?? 0,
    readCount: meta?.readCount ?? 0,
    archived: meta?.archivedAt !== undefined,
  }
}

/** 读全部（含已归档，面板需要展示归档区）。 */
async function readAll({ index, store }: AgentMemoryRouteDeps): Promise<AgentMemoryEntry[]> {
  await index.load()
  // 活跃条目以文件系统为准（索引丢键时正文不该跟着消失）；已归档条目扫描不到，
  // 从索引补回来（正文在 archive/，readForPanel 会兜底读到）。
  const names = new Set(await listExistingFiles())
  for (const name of Object.keys(index.state().files)) {
    if (index.metaOf(name)?.archivedAt !== undefined) names.add(name)
  }
  const entries: AgentMemoryEntry[] = []
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const read = await store.readForPanel(name)
    if (read === null) continue
    entries.push(viewOf(name, read, index.metaOf(name)))
  }
  return entries
}

/** 拒绝：状态码 + 可读原因。 */
function reject(response: ServerResponse, status: number, message: string): void {
  writeJson(response, status, { ok: false, error: { message } })
}

/**
 * 执行一个面板写动作；成功返 null，失败返可操作原因。
 *
 * 动作与 store 方法的映射收在一处：新增动作时只改这里，handleWrite 的
 * 分支数不再随动作增长（守住圈复杂度门禁）。
 */
async function applyAction(
  store: AgentMemoryRouteDeps['store'],
  action: string,
  name: string,
  content: unknown,
): Promise<string | null> {
  const result =
    action === 'write'
      ? await store.write(name, content)
      : action === 'delete'
        ? await store.remove(name)
        : action === 'restore'
          ? await store.restore(name)
          : null
  if (result === null) return 'action must be write, delete or restore'
  return result.ok ? null : result.error
}

/** POST 分派：write | delete | restore（面板是用户入口，不需要 confirmed 标记）。 */
async function handleWrite(
  request: ServerRequest,
  response: ServerResponse,
  deps: AgentMemoryRouteDeps,
): Promise<void> {
  const payload = await readJsonBody(request)
  const action = typeof payload?.action === 'string' ? payload.action : ''
  const name = normalizeName(payload?.name)
  if (name === null) {
    reject(response, 400, 'invalid or missing name')
    return
  }
  const error = await applyAction(deps.store, action, name, payload?.content)
  if (error !== null) {
    reject(response, 400, error)
    return
  }
  writeJson(response, 200, { ok: true, value: { items: await readAll(deps) } })
}

/**
 * 分派一条 agent-memory 请求。
 * @returns true = 已处理（含已写响应）。
 */
export async function routeAgentMemory(
  url: URL,
  request: ServerRequest,
  response: ServerResponse,
  deps: AgentMemoryRouteDeps,
): Promise<boolean> {
  if (!url.pathname.endsWith('/agent-memory')) return false
  try {
    if (request.method === 'GET') {
      writeJson(response, 200, { ok: true, value: { items: await readAll(deps) } })
      return true
    }
    if (request.method === 'POST') {
      await handleWrite(request, response, deps)
      return true
    }
  } catch (error) {
    deps.logger?.warn(`agent-memory 路由失败：${String(error)}`)
    reject(response, 500, 'internal error')
    return true
  }
  return false
}
