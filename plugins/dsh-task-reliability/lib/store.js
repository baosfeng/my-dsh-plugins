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
import { STORE_FILE, MAX_DESC } from './constants.js'

function defaultStore() {
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

function readParsed(dir) {
  return JSON.parse(readFileSync(join(dir, STORE_FILE), 'utf8'))
}

function isValidParsed(parsed) {
  return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.tasks)
}

function isValidTask(task) {
  return task !== null && typeof task === 'object' && typeof task.sessionId === 'string'
}

function normalizeMode(mode) {
  return {
    tracking: mode.tracking === true,
    verify: mode.verify === true,
    autopilot: mode.autopilot === true,
    sessionAutopilot:
      mode.sessionAutopilot !== null && typeof mode.sessionAutopilot === 'object' ? mode.sessionAutopilot : {},
  }
}

function normalizeStore(parsed) {
  const store = defaultStore()
  store.tasks = parsed.tasks.filter((task) => isValidTask(task))
  store.questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q) => q !== null && typeof q === 'object')
    : []
  if (parsed.mode !== null && typeof parsed.mode === 'object') store.mode = normalizeMode(parsed.mode)
  return store
}

export function loadStore(dir, logger) {
  try {
    const parsed = readParsed(dir)
    if (!isValidParsed(parsed)) return defaultStore()
    return normalizeStore(parsed)
  } catch {
    logger?.warn?.('dsh-task-reliability: store unreadable, starting empty')
    return defaultStore()
  }
}

export function saveStore(dir, store) {
  const path = join(dir, STORE_FILE)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, path)
}

// ── 注册表操作 ─────────────────────────────────────────────────────────────

export function activeTaskOf(store, sessionId) {
  return store.tasks.find((task) => task.sessionId === sessionId && task.status === 'active')
}

export function taskById(store, id) {
  return store.tasks.find((task) => task.id === id)
}

function findQuestionById(store, id) {
  return store.questions.find((question) => question.id === id)
}

export function registerTask(store, input) {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (sessionId === '' || description === '') return { ok: false, error: 'sessionId and description are required' }
  if (description.length > MAX_DESC) return { ok: false, error: `description too long (max ${MAX_DESC})` }
  const existing = activeTaskOf(store, sessionId)
  if (existing !== undefined) return { ok: false, error: `session already has an active task (${existing.id})` }
  const now = Date.now()
  const task = {
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

export function finishTask(store, id, status) {
  const task = taskById(store, id)
  if (task === undefined) return { ok: false, error: 'task not found' }
  task.status = status
  task.updatedAt = Date.now()
  return { ok: true, task }
}

export function addQuestion(store, sessionId, question) {
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
}

export function answerQuestion(store, id, answer) {
  const question = findQuestionById(store, id)
  if (question === undefined) return { ok: false, error: 'question not found' }
  question.answer = typeof answer === 'string' ? answer.slice(0, 1000) : ''
  question.answeredAt = Date.now()
  return { ok: true, question }
}

/** 按会话 + 问题摘要记录迟到回答（issue #145：超时后 GUI 回答不静默丢弃）。 */
export function answerQuestionByNote(store, sessionId, note, answer) {
  const question = store.questions.find(
    (q) => q.sessionId === sessionId && q.question === note && q.answer === undefined,
  )
  if (question === undefined) return { ok: false, error: 'question not found' }
  question.answer = typeof answer === 'string' ? answer.slice(0, 1000) : ''
  question.answeredAt = Date.now()
  return { ok: true, question }
}
