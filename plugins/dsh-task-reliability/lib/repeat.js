/**
 * dsh-task-reliability — reasoning-loop / tool-loop detection.
 *
 * 依赖 constants.js（REPEAT_* / TOOL_LOOP_* 常量）。本模块实现多维度的
 * 死循环检测：
 *
 *  1. 思考内容重复：对 reasoning 块做 n-gram Jaccard 相似度检测，连续高
 *     相似判定为思考循环（阈值/连续次数/每会话上限均可配置）。
 *  2. 工具调用序列重复：对工具调用序列（工具名 + 参数摘要）检测 A→A→A 与
 *     A→B→A→B 周期循环（供 events.js 在 tools/execute 调用）。
 *  3. 产出跟踪：在 stream 里累计「有效产出」（非 reasoning 文本块 / 工具
 *     执行），供 events.js 做无进展检测。
 *
 * wrapStreamForLoop 包装 llm/stream：透传全部 chunk，命中思考循环时抛
 * REASONING_LOOP 中断回合；同时更新 repeatState 的产出跟踪。
 */

import {
  REPEAT_BUFFER,
  REPEAT_CONSECUTIVE,
  REPEAT_MAX_PER_SESSION,
  REPEAT_SIM_THRESHOLD,
  TOOL_LOOP_CONSECUTIVE,
  TOOL_LOOP_WINDOW,
} from './constants.js'

/** 两段文本的 4-gram Jaccard 相似度。 */
export function similarityOf(a, b) {
  const grams = (text) => {
    const set = new Set()
    const norm = text.replace(/\s+/g, ' ')
    for (let i = 0; i + 4 <= norm.length; i++) set.add(norm.slice(i, i + 4))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let common = 0
  for (const g of ga) if (gb.has(g)) common++
  return common / (ga.size + gb.size - common)
}

/**
 * 段落列表是否构成思考循环：连续 REPEAT_CONSECUTIVE 个相邻对高相似。
 * 阈值/连续次数可由 opts 覆盖（默认 REPEAT_SIM_THRESHOLD / REPEAT_CONSECUTIVE）。
 */
export function detectReasoningLoop(segments, opts = {}) {
  const threshold = opts.repeatSimThreshold ?? REPEAT_SIM_THRESHOLD
  const consecutive = opts.repeatConsecutive ?? REPEAT_CONSECUTIVE
  if (segments.length < consecutive + 1) return false
  let streak = 0
  for (let i = 1; i < segments.length; i++) {
    const sim = similarityOf(segments[i - 1], segments[i])
    if (sim >= threshold) streak++
    else streak = 0
    if (streak >= consecutive) return true
  }
  return false
}

/** 单个工具调用是否与另一个「同工具 + 同参数摘要」。 */
function sameCall(a, b) {
  return a.name === b.name && a.arg === b.arg
}

/**
 * 工具调用序列是否构成循环：检测 A→A→A（连续同工具同参）与
 * A→B→A→B（周期循环，周期 2..toolLoopWindow）。
 * 工具调用以 { name, arg } 记录，arg 为参数摘要。
 */
export function detectToolCallLoop(toolCalls, opts = {}) {
  const consecutive = opts.toolLoopConsecutive ?? TOOL_LOOP_CONSECUTIVE
  const window = opts.toolLoopWindow ?? TOOL_LOOP_WINDOW
  const n = toolCalls.length
  if (n >= consecutive) {
    const last = toolCalls.slice(-consecutive)
    if (last.every((call) => sameCall(call, last[0]))) return true
  }
  for (let length = 2; length <= window; length++) {
    if (n < 2 * length) continue
    const first = toolCalls.slice(n - 2 * length, n - length)
    const second = toolCalls.slice(n - length)
    if (first.every((call, i) => sameCall(call, second[i]))) return true
  }
  return false
}

function isStreamChunk(chunk) {
  return chunk !== null && typeof chunk === 'object'
}

function appendDelta(buffers, chunk) {
  const buffer = buffers.get(chunk.index)
  if (buffer !== undefined) buffer.text += chunk.text
}

/** 命中一次循环：计数 + 上限判定；未达上限则打上打断标记返回 true。 */
function raiseLoop(repeatState, opts, kind) {
  repeatState.count += 1
  if (repeatState.count > (opts.repeatMaxPerSession ?? REPEAT_MAX_PER_SESSION)) {
    repeatState.gaveUp = true
    repeatState.notified = false
    return false
  }
  repeatState.lastKind = kind
  repeatState.pendingBreak = kind
  // issue #153：pendingBreak 绑定命中回合，跨回合由 events.js 消费时校验失效。
  repeatState.pendingBreakTurn = repeatState.turnSeq
  return true
}

/** block-end 收尾：累积段落、判环、计数；同时更新产出跟踪决定是否判无进展。 */
function handleBlockEnd(buffer, segments, repeatState, opts) {
  const isReasoning = buffer.type === 'reasoning'
  if (!isReasoning && buffer.type !== 'text') return
  const text = buffer.text.trim()
  if (text.length === 0) return
  repeatState.progress.seenOutput = true
  if (!isReasoning) {
    // 非 reasoning 的助手文本块视为有效产出（推进任务）。
    repeatState.progress.productCount += 1
    return
  }
  if (text.length < 50) return
  segments.push(text)
  if (segments.length > REPEAT_BUFFER) segments.shift()
  if (repeatState.gaveUp) return
  if (!detectReasoningLoop(segments, opts)) return
  if (!raiseLoop(repeatState, opts, 'reason')) return
  const error = new Error(`reasoning loop detected (count=${repeatState.count})`)
  error.code = 'REASONING_LOOP'
  throw error
}

/**
 * 包装模型流：透传全部 chunk，检测 reasoning 段落重复；命中抛错中断回合。
 * 同时更新 repeatState.progress（seenOutput / productCount）供无进展检测，
 * 并记录 reasoning block 的类型序列用于思考-工具交替观察。
 * finish chunk 的 reason（FinishReason）记录到 repeatState.lastFinish，
 * 供 turn-stopping 救场判定 max-tokens 截断（issue #147）。
 */
export function wrapStreamForLoop(stream, repeatState, opts = {}) {
  const buffers = new Map()
  const segments = []
  return (async function* () {
    for await (const chunk of stream) {
      yield chunk
      if (!isStreamChunk(chunk)) continue
      if (chunk.type === 'block-start') {
        buffers.set(chunk.index, { type: chunk.blockType, text: '' })
      } else if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') {
        appendDelta(buffers, chunk)
      } else if (chunk.type === 'block-end') {
        const buffer = buffers.get(chunk.index)
        buffers.delete(chunk.index)
        if (buffer !== undefined) handleBlockEnd(buffer, segments, repeatState, opts)
      } else if (chunk.type === 'finish') {
        repeatState.lastFinish = chunk.reason
      }
    }
  })()
}
