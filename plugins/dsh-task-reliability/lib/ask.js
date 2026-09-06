/**
 * dsh-task-reliability — ask 竞速与迟到回答（issue #145）。
 *
 * 依赖 util（userMessage）/store/constants。tools/execute 的 ask_user_question
 * 等待用户回答与缓冲/超时竞速的专用逻辑：
 * - 回答优先：next() settle 即取消超时，真实回答透传，不注入自动决策指令；
 * - 超时优先：返回自动决策结果，但继续监听 next()——超时后的迟到回答不被
 *   静默丢弃，写入待确认列表（answer 字段可查）+ 注入「用户已回答」提示。
 */

import { userMessage } from './util.js'
import { addQuestion, answerQuestionByNote } from './store.js'
import { ASK_TIMEOUT_CONTINUE_TEXT, AUTOPILOT_DENY_REASON, AUTOPILOT_LATE_ANSWER_TEXT } from './constants.js'
import { PLUGIN_EVENTS } from './emit.js'

// ── ask 参数摘要 ──────────────────────────────────────────────────────────

/** ask 参数摘要：取第一个问题的 header/question 首行（尽力而为）。 */
export function askNoteOf(argumentsValue) {
  try {
    const first = firstQuestion(argumentsValue)
    if (first === undefined) return ''
    if (typeof first.header === 'string' && first.header !== '') return first.header
    return questionLine(first)
  } catch {
    // ignore
  }
  return ''
}

function firstQuestion(argumentsValue) {
  const questions = argumentsValue?.questions
  if (!Array.isArray(questions) || questions.length === 0) return undefined
  const first = questions[0]
  if (first === null || typeof first !== 'object') return undefined
  return first
}

function questionLine(first) {
  if (typeof first.question !== 'string' || first.question === '') return ''
  const line = first.question.split('\n')[0]
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

// ── 超时自动决策 ──────────────────────────────────────────────────────────

/** 超时后的模拟回答：有推荐选项（第一个）则选中，否则空回答由模型自行决策。 */
function simulatedAskAnswer(argumentsValue) {
  const questions = argumentsValue?.questions
  if (!Array.isArray(questions)) return { value: { answers: [] } }
  const answers = []
  for (const question of questions) {
    if (question === null || typeof question !== 'object' || typeof question.id !== 'string') continue
    const options = Array.isArray(question.options)
      ? question.options.filter(
          (option) => option !== null && typeof option === 'object' && typeof option.label === 'string',
        )
      : []
    answers.push(
      options.length > 0 ? { id: question.id, selected: [options[0].label] } : { id: question.id, selected: [] },
    )
  }
  return { value: { answers } }
}

/**
 * 超时后的自动决策：记录待确认问题 + 注入继续指令 + 返回回答。
 * autopilot 返回空回答（由模型自行决策，语义与 pre-execute deny 一致）；
 * askTimeout 返回模拟回答（有推荐选项则选中第一个）。
 */
function timeoutDecision(autopilot, exec, agent, shared) {
  addQuestion(shared.store, agent.id, askNoteOf(exec.arguments))
  shared.save()
  shared.emit(PLUGIN_EVENTS.ASK_DECISION, {
    sessionId: agent.id,
    action: 'ask-timeout',
    reason: autopilot ? 'autopilot-grace' : 'ask-timeout',
    question: askNoteOf(exec.arguments),
    autopilot,
  })
  try {
    agent.followup(userMessage(autopilot ? AUTOPILOT_DENY_REASON : ASK_TIMEOUT_CONTINUE_TEXT))
  } catch {
    // followup is best-effort; the simulated answer still unblocks the turn
  }
  return autopilot ? { value: { answers: [] } } : simulatedAskAnswer(exec.arguments)
}

// ── 竞速与迟到回答（issue #145）───────────────────────────────────────────

/** 从工具结果 value 提取回答文本（answers[].selected 拼接；无有效回答返回空串）。 */
function answerTextOf(value) {
  try {
    const answers = value?.value?.answers
    if (!Array.isArray(answers)) return ''
    const texts = answers
      .filter((a) => a !== null && typeof a === 'object')
      .map((a) => (Array.isArray(a.selected) ? a.selected.filter((s) => typeof s === 'string') : []))
      .filter((selected) => selected.length > 0)
      .map((selected) => selected.join('、'))
    return texts.join('；')
  } catch {
    return ''
  }
}

/**
 * 超时后的迟到回答（issue #145）：不静默丢弃——写入待确认列表（ask 卡片与
 * 待确认列表共用记录，answer 字段可查）+ 注入「用户已回答」提示。
 * 全部 best-effort：记录失败/提示失败均不影响主流程。
 */
function recordLateAnswer(shared, agent, argumentsValue, value) {
  const answer = answerTextOf(value)
  if (answer === '') return
  const result = answerQuestionByNote(shared.store, agent.id, askNoteOf(argumentsValue), answer)
  if (!result.ok) return
  shared.save()
  shared.emit(PLUGIN_EVENTS.ASK_DECISION, {
    sessionId: agent.id,
    action: 'ask-late-answer',
    reason: 'late-answer',
    question: askNoteOf(argumentsValue),
    answer,
  })
  try {
    agent.followup(userMessage(AUTOPILOT_LATE_ANSWER_TEXT(answer)))
  } catch {
    // followup is best-effort
  }
}

/**
 * 用户回答 vs 超时竞速（issue #145）：
 * - 回答优先：next() settle 即取消超时，真实结果透传，不注入自动决策指令；
 * - 超时优先：返回自动决策结果，但继续监听 next()——迟到回答不被静默丢弃
 *   （recordLateAnswer：写入待确认列表 + 「用户已回答」提示）。
 */
export function raceAskAnswer(exec, next, timeoutMs, autopilot, shared) {
  const agent = exec.agent
  return new Promise((resolve, reject) => {
    let timer = null
    let timedOut = false
    Promise.resolve(next()).then(
      (value) => {
        if (timedOut) {
          recordLateAnswer(shared, agent, exec.arguments, value)
          return
        }
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (timedOut) return
        clearTimeout(timer)
        reject(error)
      },
    )
    timer = setTimeout(() => {
      timedOut = true
      resolve(timeoutDecision(autopilot, exec, agent, shared))
    }, timeoutMs)
  })
}
