/**
 * dsh-task-reliability — host half (entry point).
 *
 * 任务可靠性保障。在 DSH 运行时上提供 8 项能力：
 *
 *  1. 任务注册表（持久化 $DSH_HOME/task-reliability.json，原子写 + 防抖）：
 *     手动（页面/API/远程 hook）注册任务；开启自动跟踪后，会话存在活动
 *     goal 时保守自动登记。
 *  2. 模型超时/请求失败自动重试：`agent/request-error` waterfall 接管
 *     超时/瞬态类失败（TIMEOUT/ETIMEDOUT/ECONNRESET/TRANSPORT 等），带
 *     指数退避与次数上限；其余失败委托 next()。
 *  3. 任务未完成自动继续：`agent/turn-stopping` serial 监听，存在活动任务
 *     时注入 steering 让机器再跑一步；direct 模式直接继续，verify 模式
 *     交给会话结束后校验流程。内置防死循环护栏（同内容哈希去重、每任务
 *     循环上限、全局速率限制、abort 检查）。
 *  4. 完成度校验 agent：会话完全结束后（agent/status idle）创建独立校验
 *     agent，读取主会话日志判断任务是否真正完成；未完成 → followup 唤醒
 *     主 agent 继续（带校验结论）；校验失败 → 降级直接继续。
 *  5. 思考重复检测与干预：`llm/stream` waterfall 包装流，对 reasoning
 *     段落做 n-gram 相似度检测；连续高相似判定为思考循环 → 终止该回合，
 *     turn-stopping 注入分级打断指令；每会话干预次数上限。
 *  6. 休眠/重启恢复：插件启动后延迟扫描活动任务，`agents.resume` 恢复
 *     agent 并注入「系统重启，继续完成之前的任务」；resumeAt 幂等。
 *  7. 自主决策模式（出行模式）：`tools/pre-execute` 拦截 ask_user_question
 *     → deny（不调用 next()），模型收到 reason 后自行决策；被拦截的问题
 *     收集到待确认列表（持久化，可查询/回答/清除）；相关会话审批策略
 *     切换为 never（自动批准工具执行）。
 *  8. 远程触发接口：POST /task-reliability/api/trigger（loopback 信任围栏
 *     + 可选 apiToken），支持 mode/register/answer/status 动作。
 *  9. /task 斜杠命令（issue #35）：任何时候可查看任务状态、继续任务、
 *     回答待确认问题、切换自主决策模式、注册任务（复用 store/API 逻辑）。
 *
 * 安全约定：所有 HTTP 路由先做 loopback 信任围栏；apiToken 配置后要求
 * `x-task-reliability-token` 头。
 *
 * 注意：可选服务（agents/sessionQuery/goals/approval/commands）一律经
 * ctx.get 读取并处理 undefined；事件监听全部经 ctx.on 注册、路由经
 * ctx.effect 注册，卸载无残留。
 *
 * 模块：constants.js（常量）· util.js（工具）· fence.js（HTTP 围栏）·
 * text.js（会话文本）· repeat.js（思考重复）· store.js（持久化任务注册表）·
 * verify.js（校验 + 恢复）· events.js（事件监听）· api.js（HTTP 路由）·
 * command.js（/task 斜杠命令）。
 * 本文件只做装配：构建 options → 加载 store → 创建 shared 状态 →
 * 注册监听/API/命令 → 启动恢复 → 注册 teardown。
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

import { loadStore, saveStore } from './store.js'
import { isTrustedApiRequest } from 'dsh-shared'
import { resumeActiveTasks, runWatchdog } from './verify.js'
import { registerListeners } from './events.js'
import { createApi } from './api.js'
import { registerTaskCommand } from './command.js'
import { currentProfile, patchFileOf, writePatchConfig } from 'dsh-shared'
import { configToPlain } from './util.js'
import {
  RETRYABLE_CODES,
  RETRY_MAX,
  MAX_LOOP,
  MAX_VERIFY,
  RETRY_BASE_MS,
  STEER_COOLDOWN_MS,
  SAVE_DEBOUNCE_MS,
  RESUME_GRACE_MS,
  RATE_MAX_ACTIONS,
  ASK_TIMEOUT_MS,
  AUTOPILOT_GRACE_MS,
  WATCHDOG_INTERVAL_MS,
  STALL_TIMEOUT_MS,
  REPEAT_SIM_THRESHOLD,
  REPEAT_CONSECUTIVE,
  REPEAT_MAX_PER_SESSION,
  TOOL_LOOP_BUFFER,
  TOOL_LOOP_CONSECUTIVE,
  TOOL_LOOP_WINDOW,
  NO_PROGRESS_ROUNDS,
  RESCUE_MAX_PER_SESSION,
  RESCUE_COOLDOWN_MS,
} from './constants.js'

export const name = 'dsh-task-reliability'

export const inject = ['webServer']

export function apply(ctx, config) {
  const options = buildOptions(config)
  const shared = createShared(ctx, options)
  // 设置页保存配置（issue #27）：持久化到 profile patch 文件 + 更新内存
  // options（立即生效）。DSH 的 watchUserPatches 会热重载 patch 文件。
  shared.saveConfig = async (payload) => {
    const next = buildOptionsFrom(payload)
    await writePatchConfig(patchFileOf(currentProfile()), 'task-reliability', configToPlain(next))
    Object.assign(options, next)
  }
  registerListeners(ctx, shared)
  registerApi(ctx, shared)
  registerTaskCommand(ctx, shared)
  scheduleResume(ctx, shared)
  scheduleWatchdog(ctx, shared)
  registerTeardown(ctx, shared)
  // 返回 shared 供测试/宿主检查（Cordis 忽略普通对象返回值）。
  return shared
}

// ── options 构建 ───────────────────────────────────────────────────────────

function strOption(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegInt(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

/** 0~1 之间的比例配置（相似度阈值），非法回退默认。 */
function ratio(value, fallback) {
  return typeof value === 'number' && value > 0 && value < 1 ? value : fallback
}

function codeSet(value) {
  return Array.isArray(value) && value.length > 0 ? new Set(value) : RETRYABLE_CODES
}

function buildOptions(config) {
  return buildOptionsFrom(config ?? {})
}

function buildOptionsFrom(c) {
  return {
    apiToken: strOption(c.apiToken, ''),
    retryMax: positiveInt(c.retryMax, RETRY_MAX),
    maxLoop: positiveInt(c.maxLoop, MAX_LOOP),
    maxVerify: positiveInt(c.maxVerify, MAX_VERIFY),
    retryableCodes: codeSet(c.retryableCodes),
    retryBaseMs: nonNegInt(c.retryBaseMs, RETRY_BASE_MS),
    autopilot: c.autopilot === true,
    steerCooldownMs: nonNegInt(c.steerCooldownMs, STEER_COOLDOWN_MS),
    saveDebounceMs: nonNegInt(c.saveDebounceMs, SAVE_DEBOUNCE_MS),
    resumeGraceMs: nonNegInt(c.resumeGraceMs, RESUME_GRACE_MS),
    rateMaxActions: positiveInt(c.rateMaxActions, RATE_MAX_ACTIONS),
    askTimeoutMs: nonNegInt(c.askTimeoutMs, ASK_TIMEOUT_MS),
    autopilotGraceMs: nonNegInt(c.autopilotGraceMs, AUTOPILOT_GRACE_MS),
    watchdogIntervalMs: nonNegInt(c.watchdogIntervalMs, WATCHDOG_INTERVAL_MS),
    stallTimeoutMs: positiveInt(c.stallTimeoutMs, STALL_TIMEOUT_MS),
    // —— 死循环检测（issue #77）——
    repeatSimThreshold: ratio(c.repeatSimThreshold, REPEAT_SIM_THRESHOLD),
    repeatConsecutive: positiveInt(c.repeatConsecutive, REPEAT_CONSECUTIVE),
    repeatMaxPerSession: positiveInt(c.repeatMaxPerSession, REPEAT_MAX_PER_SESSION),
    toolLoopConsecutive: positiveInt(c.toolLoopConsecutive, TOOL_LOOP_CONSECUTIVE),
    toolLoopWindow: positiveInt(c.toolLoopWindow, TOOL_LOOP_WINDOW),
    toolLoopBuffer: positiveInt(c.toolLoopBuffer, TOOL_LOOP_BUFFER),
    noProgressRounds: nonNegInt(c.noProgressRounds, NO_PROGRESS_ROUNDS),
    notifyOnLoop: c.notifyOnLoop === true,
    notifyUrl: strOption(c.notifyUrl, ''),
    // —— 输出未完成自动救场（issue #147）——
    rescueOnTruncation: c.rescueOnTruncation !== false,
    rescueMaxPerSession: positiveInt(c.rescueMaxPerSession, RESCUE_MAX_PER_SESSION),
    rescueCooldownMs: nonNegInt(c.rescueCooldownMs, RESCUE_COOLDOWN_MS),
  }
}

// ── shared 状态 ────────────────────────────────────────────────────────────

function resolveDir() {
  const envHome = process.env.DSH_HOME
  return typeof envHome === 'string' && envHome !== '' ? envHome : join(homedir(), '.dsh')
}

/** 防抖落盘：save 合并写入，cancel 供 teardown 清理。 */
function createSaver(dir, store, options, logger) {
  let saveTimer = null
  const save = () => {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        saveStore(dir, store)
      } catch (error) {
        logger?.warn?.(`dsh-task-reliability: save failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, options.saveDebounceMs)
  }
  const cancel = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }
  return { save, cancel }
}

/** 可变运行时上下文：所有子模块共享（store/options/save/fence/计数状态）。 */
function createShared(ctx, options) {
  const dir = resolveDir()
  const store = loadStore(dir, ctx.logger)
  const webRuntime = ctx.get('webRuntime')
  const trustedHosts =
    webRuntime !== undefined && webRuntime !== null && Array.isArray(webRuntime.trustedHosts)
      ? webRuntime.trustedHosts
      : []
  const saver = createSaver(dir, store, options, ctx.logger)
  return {
    ctx,
    options,
    dir,
    store,
    save: saver.save,
    saver,
    fence: (request) => isTrustedApiRequest(request, trustedHosts),
    retryBuckets: new Map(),
    repeatStates: new Map(),
    rescueStates: new Map(),
    errorMarks: new Map(),
    actionLog: [],
    resumeTimer: null,
    watchdogTimer: null,
  }
}

// ── 装配 ───────────────────────────────────────────────────────────────────

function registerApi(ctx, shared) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/task-reliability/api',
        handler: createApi(shared),
      }),
    'dsh-task-reliability: /task-reliability/api routes',
  )
}

/** 启动恢复（休眠/重启后任务续跑），延迟 resumeGraceMs 执行。 */
function scheduleResume(ctx, shared) {
  shared.resumeTimer = setTimeout(() => {
    shared.resumeTimer = null
    void resumeActiveTasks(ctx, shared.store, shared.save)
  }, shared.options.resumeGraceMs)
}

/** 任务停滞看门狗（issue #34）：定期扫描活动任务，长时间无进展自动唤醒。 */
function scheduleWatchdog(ctx, shared) {
  if (shared.options.watchdogIntervalMs <= 0) return
  shared.watchdogTimer = setInterval(() => {
    void runWatchdog(ctx, shared.store, shared.save, shared.options)
  }, shared.options.watchdogIntervalMs)
}

/** 卸载清理：定时器 + 立即落盘。 */
function registerTeardown(ctx, shared) {
  ctx.effect(
    () => () => {
      if (shared.resumeTimer !== null) {
        clearTimeout(shared.resumeTimer)
        shared.resumeTimer = null
      }
      if (shared.watchdogTimer !== null) {
        clearInterval(shared.watchdogTimer)
        shared.watchdogTimer = null
      }
      shared.saver.cancel()
      try {
        saveStore(shared.dir, shared.store)
      } catch {
        // final flush is best-effort
      }
    },
    'dsh-task-reliability: teardown',
  )
}
