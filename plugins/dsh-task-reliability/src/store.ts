/**
 * dsh-task-reliability — persisted task registry.
 *
 * 依赖 util.js（randomId）与 constants.js（STORE_FILE/MAX_DESC）。
 * 任务注册表存储于 $DSH_HOME/task-reliability.json（**异步**原子写 tmp+rename）；
 * 提供任务/待确认问题的增删查改与 mode 状态解析。
 *
 * 资源形态（issue #198 P2，resource-budget-review 的 CPU/磁盘 IO 维度）：
 *  - **写路径异步**：`saveStore` 返回 Promise，序列化与 I/O 都不在调用方的
 *    关键路径上（原实现 writeFileSync/renameSync 在事件循环内同步执行——
 *    状态文件随任务/待确认问题增长后，写盘期间宿主事件循环（LLM 流、
 *    工具回调）全部停摆）；
 *  - **写串行化**：同一进程内的落盘经串行链排队（tmp+rename 的临时文件
 *    同名并发写会互相覆盖）；
 *  - **退出路径同步兜底**：`saveStoreSync` 只给 teardown 用——卸载返回前
 *    必须写完（异步写在卸载返回后才可能落盘，宿主随后退出即丢状态），
 *    一次小文件同步写在卸载阶段可忽略；热路径（防抖落盘）不允许用它；
 *  - **读路径保持同步**：`loadStore` 只在插件启动时读一次（当前状态文件
 *    几百字节），且 apply 是同步契约（返回值供宿主/测试检查）——改异步会
 *    引入「加载完成前写入被覆盖」的窗口，收益低于风险（见 PR 未接入清单）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomId } from './util.js'
import { STORE_FILE, MAX_DESC, MAX_QUESTIONS, QUESTION_TTL_MS } from './constants.js'
import type {
  AnyObject,
  LoggerLike,
  Question,
  QuestionResult,
  Store,
  StoreMode,
  Task,
  TaskInput,
  TaskResult,
} from './types.js'

function defaultStore(): Store {
  return {
    version: 1,
    tasks: [],
    questions: [],
    mode: {
      tracking: false,
      verify: false,
      autopilot: false,
      sessionAutopilot: {},
    },
  }
}

function readParsed(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, STORE_FILE), 'utf8'))
}

function isValidParsed(parsed: unknown): parsed is AnyObject & { tasks: unknown[] } {
  return parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as AnyObject).tasks)
}

function isValidTask(task: unknown): boolean {
  return task !== null && typeof task === 'object' && typeof (task as Task).sessionId === 'string'
}

function normalizeMode(mode: AnyObject): StoreMode {
  return {
    tracking: mode.tracking === true,
    verify: mode.verify === true,
    autopilot: mode.autopilot === true,
    sessionAutopilot:
      mode.sessionAutopilot !== null && typeof mode.sessionAutopilot === 'object' ? mode.sessionAutopilot : {},
  }
}

function normalizeStore(parsed: AnyObject & { tasks: unknown[] }): Store {
  const store = defaultStore()
  store.tasks = parsed.tasks.filter((task) => isValidTask(task)) as Task[]
  store.questions = Array.isArray(parsed.questions)
    ? (parsed.questions.filter((q: unknown) => q !== null && typeof q === 'object') as Question[])
    : []
  if (parsed.mode !== null && typeof parsed.mode === 'object') store.mode = normalizeMode(parsed.mode)
  return store
}

export function loadStore(dir: string, logger?: LoggerLike): Store {
  try {
    const parsed = readParsed(dir)
    if (!isValidParsed(parsed)) return defaultStore()
    return normalizeStore(parsed)
  } catch {
    logger?.warn?.('dsh-task-reliability: store unreadable, starting empty')
    return defaultStore()
  }
}

/**
 * 状态文件写入串行链：同一进程内的落盘排队执行（前一个失败不阻断后一个）。
 * tmp+rename 的临时文件同名时，并发写会互相覆盖并触发 rename 竞态——串行消除它。
 */
let writeChain: Promise<void> = Promise.resolve()

/**
 * 落盘状态（**异步**，issue #198 P2，见文件头「资源形态」）：
 *  - 目录按需创建；tmp+rename 原子写（崩溃不会留下半个文件）；
 *  - 序列化与 I/O 都在调用返回之后执行——调用方（事件处理 / teardown）的
 *    关键路径不再被写盘阻塞；
 *  - 并发调用经 {@link writeChain} 串行化；
 *  - 失败以 reject 暴露给调用方（调用方决定 warn 或忽略）。
 * 注意：序列化在排到的执行时刻进行，写出的是那一刻的状态（不会比调用时更旧）。
 */
export function saveStore(dir: string, store: Store): Promise<void> {
  const run = async (): Promise<void> => {
    const path = join(dir, STORE_FILE)
    const tmp = `${path}.tmp-${process.pid}`
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
    await rename(tmp, path)
  }
  const next = writeChain.then(run, run)
  writeChain = next.catch(() => {})
  return next
}

/**
 * 退出路径的**同步**落盘（teardown 专用，不是热路径原语）：
 * 卸载返回前必须写完——异步写的落点由事件循环决定，宿主卸载后立即退出就丢状态
 * （这正是 test/host-smoke.mjs 的「休眠/重启恢复」用例：关闭实例后必须马上能
 * 读回状态）。一次小文件同步写的阻塞（当前状态文件几百字节）发生在卸载阶段，
 * 可忽略；**热路径（防抖落盘）必须用 {@link saveStore}**。
 */
export function saveStoreSync(dir: string, store: Store): void {
  const path = join(dir, STORE_FILE)
  const tmp = `${path}.tmp-${process.pid}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, path)
}

// ── 注册表操作 ─────────────────────────────────────────────────────────────

export function activeTaskOf(store: Store, sessionId: string): Task | undefined {
  return store.tasks.find((task) => task.sessionId === sessionId && task.status === 'active')
}

export function taskById(store: Store, id: string): Task | undefined {
  return store.tasks.find((task) => task.id === id)
}

function findQuestionById(store: Store, id: string): Question | undefined {
  return store.questions.find((question) => question.id === id)
}

export function registerTask(store: Store, input: TaskInput): TaskResult {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (sessionId === '' || description === '') return { ok: false, error: 'sessionId and description are required' }
  if (description.length > MAX_DESC) return { ok: false, error: `description too long (max ${MAX_DESC})` }
  const existing = activeTaskOf(store, sessionId)
  if (existing !== undefined) return { ok: false, error: `session already has an active task (${existing.id})` }
  const now = Date.now()
  const task: Task = {
    id: randomId('task'),
    sessionId,
    description,
    status: 'active',
    mode: input.mode === 'verify' ? 'verify' : 'direct',
    source: input.source === 'auto' ? 'auto' : 'manual',
    loopCount: 0,
    verifyCount: 0,
    lastSteerAt: 0,
    resumeAt: 0,
    createdAt: now,
    updatedAt: now,
  }
  store.tasks.push(task)
  return { ok: true, task }
}

export function finishTask(store: Store, id: string, status: Task['status']): TaskResult {
  const task = taskById(store, id)
  if (task === undefined) return { ok: false, error: 'task not found' }
  task.status = status
  task.updatedAt = Date.now()
  return { ok: true, task }
}

export function addQuestion(store: Store, sessionId: string, question: unknown): void {
  if (typeof question !== 'string' || question === '') return
  const text = question.slice(0, 300)
  if (store.questions.some((q) => q.sessionId === sessionId && q.question === text && q.answer === undefined)) return
  store.questions.push({
    id: randomId('q'),
    sessionId,
    question: text,
    answer: undefined,
    createdAt: Date.now(),
    answeredAt: undefined,
  })
  pruneQuestions(store)
}

/**
 * 待确认问题列表清理（issue #154：文件不无限膨胀）：
 *  - 过期未答问题（createdAt 超过 QUESTION_TTL_MS）删除；
 *  - 总数超 MAX_QUESTIONS 时按「已答优先、最旧优先」淘汰（未答问题保留）。
 * 返回清理条数（0 = 无需清理；调用方据此决定是否落盘）。
 */
export function pruneQuestions(store: Store, now = Date.now()): number {
  const before = store.questions.length
  const fresh = store.questions.filter((q) => {
    if (q.answer !== undefined) return true
    // 旧数据无 createdAt 时间戳：视为未过期保留（不误删历史问题）。
    if (typeof q.createdAt !== 'number') return true
    return now - q.createdAt < QUESTION_TTL_MS
  })
  if (fresh.length > MAX_QUESTIONS) {
    const answered = fresh
      .filter((q) => q.answer !== undefined)
      .sort((a, b) => (a.answeredAt ?? 0) - (b.answeredAt ?? 0))
    const unanswered = fresh.filter((q) => q.answer === undefined)
    const room = MAX_QUESTIONS - unanswered.length
    store.questions = room > 0 ? [...unanswered, ...answered.slice(-room)] : unanswered.slice(-MAX_QUESTIONS)
  } else {
    store.questions = fresh
  }
  return before - store.questions.length
}

export function answerQuestion(store: Store, id: string, answer: unknown): QuestionResult {
  const question = findQuestionById(store, id)
  if (question === undefined) return { ok: false, error: 'question not found' }
  question.answer = typeof answer === 'string' ? answer.slice(0, 1000) : ''
  question.answeredAt = Date.now()
  return { ok: true, question }
}

/** 按会话 + 问题摘要记录迟到回答（issue #145：超时后 GUI 回答不静默丢弃）。 */
export function answerQuestionByNote(store: Store, sessionId: string, note: string, answer: unknown): QuestionResult {
  const question = store.questions.find(
    (q) => q.sessionId === sessionId && q.question === note && q.answer === undefined,
  )
  if (question === undefined) return { ok: false, error: 'question not found' }
  question.answer = typeof answer === 'string' ? answer.slice(0, 1000) : ''
  question.answeredAt = Date.now()
  return { ok: true, question }
}
