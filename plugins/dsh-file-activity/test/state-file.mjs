/**
 * 测试辅助：从 JSON Lines 状态文件重建会话（与宿主 loadState 同一套语法）。
 * 宿主集成测试用它断言「落盘内容」，避免各自手写 JSON.parse（旧格式假设）。
 */
import { readFileSync } from 'node:fs'
import { defaultLimits, emptyEvicted, enforceQuota } from '../lib/quota.js'
import { foldRecord, parseLegacySnapshot, parseStateFileText } from '../lib/state.js'

/** 读取状态文件全文（不存在返回空串）。 */
export function readStateText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** 重建全部会话（快照行 + 事件行重放 + 配额执行，语义与宿主一致）。 */
export function replaySessions(file) {
  const text = readStateText(file)
  const legacy = parseLegacySnapshot(text)
  const { snapshot, records } = parseStateFileText(text)
  const sessions = {}
  const source = legacy === null ? snapshot : { ...legacy.sessions, ...snapshot }
  for (const [sessionId, raw] of Object.entries(source)) {
    const state = { version: 1, sessions: { [sessionId]: raw }, stats: { evicted: emptyEvicted() } }
    sessions[sessionId] = state.sessions[sessionId]
  }
  const state = { version: 1, sessions, stats: { evicted: emptyEvicted() } }
  const limits = defaultLimits()
  const evicted = emptyEvicted()
  for (const record of records) {
    if (foldRecord(state, record.sessionId, record.path, record.op, record.time) === null) continue
    enforceQuota(state, record.sessionId, limits, evicted)
  }
  return state.sessions
}

/** 指定会话的重建结果。 */
export function sessionFromFile(file, sessionId) {
  return replaySessions(file)[sessionId]
}
