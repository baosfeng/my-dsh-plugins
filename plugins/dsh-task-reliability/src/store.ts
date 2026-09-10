/**
 * dsh-task-reliability — persisted task registry.
 *
 * 依赖 util.js（randomId）与 constants.js（STORE_FILE/MAX_DESC）。
 * 任务注册表存储于 $DSH_HOME/task-reliability.json（原子写 tmp+rename）；
 * 提供任务/待确认问题的增删查改与 mode 状态解析。
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
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

export function saveStore(dir: string, store: Store): void {
  const path = join(dir, STORE_FILE)
  const tmp = `${path}.tmp`
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
