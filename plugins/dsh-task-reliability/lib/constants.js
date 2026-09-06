/**
 * dsh-task-reliability — shared constants and message constructors.
 *
 * 最底层模块：不依赖任何其他 lib 模块。所有常量、重试码集合与
 * 提示文本构造函数集中于此，供其他子模块与 index.js 引用。
 */

export const STORE_FILE = 'task-reliability.json'
export const MAX_DESC = 500
export const MAX_LOOP = 8
export const MAX_VERIFY = 3
export const STEER_COOLDOWN_MS = 8000
export const RETRY_MAX = 3
export const RETRY_BASE_MS = 1000
export const RETRY_MAX_DELAY_MS = 30000
export const RATE_WINDOW_MS = 60000
export const RATE_MAX_ACTIONS = 12
export const REPEAT_MAX_PER_SESSION = 3
export const REPEAT_SIM_THRESHOLD = 0.8
export const REPEAT_CONSECUTIVE = 3
export const REPEAT_BUFFER = 6
export const TOOL_LOOP_BUFFER = 20
export const TOOL_LOOP_CONSECUTIVE = 3
export const TOOL_LOOP_WINDOW = 4
export const NO_PROGRESS_ROUNDS = 3
export const VERIFY_TIMEOUT_MS = 60000
export const RESUME_GRACE_MS = 2000
export const SAVE_DEBOUNCE_MS = 500
export const SUMMARY_MAX_CHARS = 8000
export const ASK_TIMEOUT_MS = 30 * 60 * 1000
export const AUTOPILOT_GRACE_MS = 20 * 1000
export const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000
export const STALL_TIMEOUT_MS = 10 * 60 * 1000

export const RETRYABLE_CODES = new Set([
  'TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'STREAM_IDLE_TIMEOUT',
  'TRANSPORT',
  'NETWORK',
  'SERVER',
  'RATE_LIMIT',
  'EMPTY_RESPONSE',
])

export const DIRECT_CONTINUE_TEXT = (desc) =>
  `【任务自动继续】你之前的任务尚未确认完成，请继续完成它：${desc}。` +
  '检查当前进度，列出剩余未完成的部分并逐一执行，直到任务真正完成。' +
  '如果任务实际上已经完成，请明确说明已完成并结束。'

export const REPEAT_BREAK_TEXT = (level, kind = 'reason') => {
  if (kind === 'tool') {
    return level >= 2
      ? '【检测到工具调用循环】你正在反复执行相同的工具/命令，无法推进任务。请立即停止重复调用，' +
          '改为基于已有结果直接推进结论并继续执行任务。'
      : '【检测到工具调用循环】检测到你在反复执行相同的工具/命令，迟迟没有进展。请停止重复调用，' +
          '改用新的方式推进任务并给出结论。'
  }
  if (kind === 'progress') {
    return level >= 2
      ? '【检测到无进展循环】你反复思考/执行但始终没有新的产出或结论，任务一直无法推进。请立即停止空转，' +
          '基于已有信息直接给出结论并继续执行任务。'
      : '【检测到无进展循环】检测到你反复思考/执行但始终没有新的有效产出。请停止空转，直接基于已有信息给出结论并继续。'
  }
  return level >= 2
    ? '【检测到思考重复循环】你正在反复输出相同的思考内容。请立即停止重复推理，' +
        '以最简方式基于已有信息直接给出结论，并继续执行任务，不要再次重复思考。'
    : '【检测到思考重复】检测到思考过程出现重复。请收敛思考，避免重复推理，直接基于已有信息给出结论并继续。'
}

export const AUTOPILOT_DENY_REASON =
  '【自主决策模式】用户当前不在线，无法回答问题。请基于已有信息和上下文做出最合理的决策并继续执行，' +
  '不要再次询问用户。该问题已记录，用户回来后统一处理。'

/** 超时后迟到回答的提示（issue #145：与「不在线」文案区分，回答不被静默丢弃）。 */
export const AUTOPILOT_LATE_ANSWER_TEXT = (answer) =>
  `【用户已回答】用户已对你刚才的询问提交回答：“${answer}”，已记录到待确认列表。` +
  '若你已按自动决策继续执行，请以用户回答为准调整后续步骤。'

export const RESUME_CONTINUE_TEXT = (desc) =>
  `【系统重启恢复】系统此前在任务执行中被中断（休眠/重启），请继续完成之前的任务：${desc}。` +
  '先回顾当前进度，然后继续执行剩余部分，直到任务完成。'

export const ASK_TIMEOUT_CONTINUE_TEXT =
  '【用户长时间未响应】你之前询问用户的问题长时间未得到回答，请基于已有信息和上下文自行决策并继续执行任务，' +
  '不要再次询问用户。被跳过的询问已记录，用户回来后统一处理。'

export const WAKE_CONTINUE_TEXT = (desc) =>
  `【系统唤醒恢复】系统此前因锁屏/休眠/网络中断而停滞，请继续完成之前的任务：${desc}。` +
  '先回顾当前进度，然后继续执行剩余部分，直到任务完成。'
