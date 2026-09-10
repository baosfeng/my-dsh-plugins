/**
 * dsh-task-reliability — HTTP API routes.
 *
 * 依赖 fence.js（writeJson/writeError/readJsonBody/header）与 store.js。
 * 注册 /task-reliability/api 前缀路由：info/tasks/questions/mode/trigger
 * 及任务状态操作；所有请求先过 loopback 信任围栏，写操作要求 apiToken。
 */
import { configToPlain, header } from './util.js'
import { readJsonBody, writeJson, writeError } from 'dsh-shared'
import { registerTask, taskById, finishTask, answerQuestion } from './store.js'
import type { AgentsService, ApprovalService, ServerRequest, ServerResponse, SharedContext, Task } from './types.js'

/** apiToken 校验：未配置 token 时放行，配置后要求请求头一致。 */
function tokenOk(request: ServerRequest, shared: SharedContext): boolean {
  return (
    shared.options.apiToken === '' || header(request.headers, 'x-task-reliability-token') === shared.options.apiToken
  )
}

function parsePath(url: string | undefined): string | undefined {
  const pathname = new URL(url ?? '/', 'http://dsh.internal').pathname
  return pathname.startsWith('/task-reliability/api/') ? pathname.slice('/task-reliability/api/'.length) : undefined
}

function writeForbidden(response: ServerResponse, message: string): void {
  writeJson(response, 403, { ok: false, error: { code: 'forbidden', message } })
}

// ── GET 路由 ───────────────────────────────────────────────────────────────

function writeInfo(response: ServerResponse, shared: SharedContext): void {
  writeJson(response, 200, {
    ok: true,
    value: {
      tracking: shared.store.mode.tracking,
      verify: shared.store.mode.verify,
      autopilot: shared.store.mode.autopilot,
      sessionAutopilot: shared.store.mode.sessionAutopilot,
      taskCount: shared.store.tasks.length,
      activeCount: shared.store.tasks.filter((task) => task.status === 'active' || task.status === 'checking').length,
      questionCount: shared.store.questions.filter((question) => question.answer === undefined).length,
      apiToken: shared.options.apiToken !== '',
    },
  })
}

async function dispatchGet(
  method: string,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  if (method === 'info') {
    writeInfo(response, shared)
    return true
  }
  if (method === 'tasks') {
    writeJson(response, 200, { ok: true, value: shared.store.tasks })
    return true
  }
  if (method === 'questions') {
    writeJson(response, 200, { ok: true, value: shared.store.questions })
    return true
  }
  if (method === 'config') {
    writeJson(response, 200, { ok: true, value: configToPlain(shared.options) })
    return true
  }
  return false
}

// ── POST 路由 ──────────────────────────────────────────────────────────────

/** 手动注册任务（/tasks 与 trigger register 共用）。 */
async function registerFromBody(
  body: Record<string, unknown>,
  response: ServerResponse,
  shared: SharedContext,
): Promise<void> {
  const result = registerTask(shared.store, {
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
    description: typeof body.description === 'string' ? body.description : '',
    mode: body.mode,
    source: 'manual',
  })
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: { message: result.error } })
    return
  }
  shared.save()
  writeJson(response, 200, { ok: true, value: result.task })
}

async function postTasks(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<boolean> {
  const body = await readJsonBody(request)
  await registerFromBody(body, response, shared)
  return true
}

async function postTaskAction(
  taskMatch: RegExpMatchArray,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  const task = taskById(shared.store, taskMatch[1])
  if (task === undefined) {
    writeJson(response, 404, { ok: false, error: { message: 'task not found' } })
    return true
  }
  const action = taskMatch[2]
  if (action === 'delete') {
    shared.store.tasks = shared.store.tasks.filter((t: Task) => t.id !== task.id)
  } else if (action === 'pause') {
    finishTask(shared.store, task.id, 'paused')
  } else if (action === 'resume') {
    finishTask(shared.store, task.id, 'active')
  } else {
    finishTask(shared.store, task.id, 'done')
  }
  shared.save()
  writeJson(response, 200, { ok: true })
  return true
}

async function postAnswer(
  answerMatch: RegExpMatchArray,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  if (!tokenOk(request, shared)) {
    writeForbidden(response, 'invalid x-task-reliability-token')
    return true
  }
  const body = await readJsonBody(request)
  const result = answerQuestion(shared.store, answerMatch[1], typeof body.answer === 'string' ? body.answer : '')
  if (!result.ok) {
    writeJson(response, 404, { ok: false, error: { message: result.error } })
    return true
  }
  shared.save()
  writeJson(response, 200, { ok: true, value: result.question })
  return true
}

/** 审批策略切换（模式开启/关闭时应用，best-effort）。 */
function applyApprovalPolicy(sessionId: string, enabled: boolean, shared: SharedContext): void {
  const approval = shared.ctx.get<ApprovalService>('approval')
  const agents = shared.ctx.get<AgentsService>('agents')
  if (approval === undefined || approval === null || typeof approval.setPolicy !== 'function') return
  if (agents === undefined || agents === null) return
  const agent = agents.get(sessionId)
  if (agent === undefined) return
  try {
    approval.setPolicy(agent, enabled ? 'never' : 'ask')
  } catch {
    // policy switch is best-effort
  }
}

/** mode 更新（/mode 与 trigger mode 共用；/task 命令复用）。 */
export function applyMode(body: Record<string, unknown>, shared: SharedContext): void {
  if (typeof body.tracking === 'boolean') shared.store.mode.tracking = body.tracking
  if (typeof body.verify === 'boolean') shared.store.mode.verify = body.verify
  if (typeof body.autopilot === 'boolean') shared.store.mode.autopilot = body.autopilot
  if (typeof body.sessionId === 'string' && body.sessionId !== '' && typeof body.autopilot === 'boolean') {
    shared.store.mode.sessionAutopilot[body.sessionId] = body.autopilot
    applyApprovalPolicy(body.sessionId, body.autopilot, shared)
  }
}

async function postMode(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<boolean> {
  if (!tokenOk(request, shared)) {
    writeForbidden(response, 'invalid x-task-reliability-token')
    return true
  }
  const body = await readJsonBody(request)
  applyMode(body, shared)
  shared.save()
  writeJson(response, 200, { ok: true })
  return true
}

/** 保存配置（设置页）：校验 payload 为对象 → 持久化 + 更新内存 options。 */
async function putConfig(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<boolean> {
  const payload: unknown = await readJsonBody(request)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    writeJson(response, 400, { ok: false, error: { message: 'config must be an object' } })
    return true
  }
  await shared.saveConfig(payload as Record<string, unknown>)
  writeJson(response, 200, { ok: true })
  return true
}

// ── trigger 动作 ───────────────────────────────────────────────────────────

async function triggerRegister(
  body: Record<string, unknown>,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  await registerFromBody(body, response, shared)
  return true
}

async function triggerMode(
  body: Record<string, unknown>,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  applyMode(body, shared)
  shared.save()
  writeJson(response, 200, { ok: true })
  return true
}

async function triggerAnswer(
  body: Record<string, unknown>,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  const result = answerQuestion(
    shared.store,
    typeof body.id === 'string' ? body.id : '',
    typeof body.answer === 'string' ? body.answer : '',
  )
  if (!result.ok) {
    writeJson(response, 400, { ok: false, error: { message: result.error } })
    return true
  }
  shared.save()
  writeJson(response, 200, { ok: true })
  return true
}

function triggerStatus(response: ServerResponse, shared: SharedContext): boolean {
  writeJson(response, 200, {
    ok: true,
    value: {
      tracking: shared.store.mode.tracking,
      verify: shared.store.mode.verify,
      autopilot: shared.store.mode.autopilot,
      tasks: shared.store.tasks,
      questions: shared.store.questions,
    },
  })
  return true
}

async function postTrigger(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<boolean> {
  if (!tokenOk(request, shared)) {
    writeForbidden(response, 'invalid x-task-reliability-token')
    return true
  }
  const body = await readJsonBody(request)
  const action = typeof body.action === 'string' ? body.action : ''
  if (action === 'register') return triggerRegister(body, response, shared)
  if (action === 'mode') return triggerMode(body, response, shared)
  if (action === 'answer') return triggerAnswer(body, response, shared)
  if (action === 'status') return triggerStatus(response, shared)
  writeJson(response, 400, { ok: false, error: { message: 'unknown trigger action' } })
  return true
}

// ── 分派 ───────────────────────────────────────────────────────────────────

async function dispatchPost(
  method: string,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  if (method === 'tasks') return postTasks(request, response, shared)
  const taskMatch = method?.match(/^tasks\/([^/]+)\/(done|pause|resume|delete)$/)
  if (taskMatch !== null) return postTaskAction(taskMatch, request, response, shared)
  const answerMatch = method?.match(/^questions\/([^/]+)\/answer$/)
  if (answerMatch !== null) return postAnswer(answerMatch, request, response, shared)
  if (method === 'mode') return postMode(request, response, shared)
  if (method === 'config') return putConfig(request, response, shared)
  if (method === 'trigger') return postTrigger(request, response, shared)
  return false
}

async function dispatch(
  method: string | undefined,
  requestMethod: string | undefined,
  request: ServerRequest,
  response: ServerResponse,
  shared: SharedContext,
): Promise<boolean> {
  if (method === undefined) return false
  if (requestMethod === 'GET') return dispatchGet(method, request, response, shared)
  if (requestMethod === 'POST') return dispatchPost(method, request, response, shared)
  if (requestMethod === 'PUT' && method === 'config') return putConfig(request, response, shared)
  return false
}

/** API 入口：信任围栏 → 路径分派 → 未知方法 404，异常统一 400。 */
async function handleApi(request: ServerRequest, response: ServerResponse, shared: SharedContext): Promise<void> {
  if (!shared.fence(request)) {
    writeForbidden(response, 'forbidden')
    return
  }
  const method = parsePath(request.url)
  try {
    if (!(await dispatch(method, request.method, request, response, shared))) {
      writeJson(response, 404, {
        ok: false,
        error: { message: 'unknown dsh-task-reliability API method' },
      })
    }
  } catch (error) {
    writeError(response, error)
  }
}

/** 构建路由 handler（由 index.js 经 ctx.effect 注册到 webServer）。 */
export function createApi(shared: SharedContext): (request: ServerRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    await handleApi(request, response, shared)
  }
}
