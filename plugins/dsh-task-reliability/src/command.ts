/**
 * dsh-task-reliability — /task slash command.
 *
 * 参考 DSH 官方 dsh-command-goal 的 ctx.commands.register 模式，注册
 * `/task` 命令（name 与 /goal 不同，不冲突），任何时候都能查看/继续任务。
 * 语法：/task [status|continue|answer <id> <text>|autopilot on|off|register <描述>]
 *
 * 复用现有 store/API 逻辑，不重复实现：
 *  - status    → 直接读 shared.store 渲染状态（活动任务/待确认问题/模式）；
 *  - continue  → 复用 verify.js 的 wakeStalledTask（live/resume 取回 + 唤醒指令，
 *                与看门狗同一恢复逻辑）；
 *  - answer    → 复用 store.js 的 answerQuestion（与 HTTP API 同一函数）；
 *  - autopilot → 复用 api.js 的 applyMode（与 /mode、trigger mode 同一函数）；
 *  - register  → 复用 store.js 的 registerTask（与 /tasks、trigger register
 *                同一函数）。
 *
 * commands 服务为可选增强：ctx.get('commands') 判空降级，宿主未提供时
 * 插件其余能力（HTTP API/事件监听）照常工作。
 */
import { activeTaskOf, answerQuestion, registerTask } from './store.js'
import { wakeStalledTask } from './verify.js'
import { applyMode } from './api.js'
import type {
  CommandInvocation,
  CommandResult,
  CommandsService,
  DshContext,
  SharedContext,
  Task,
  Question,
} from './types.js'

const USAGE = '/task [status|continue|answer <id> <text>|autopilot on|off|register <描述>]'

const INVALID_MESSAGES: Record<string, string> = {
  'invalid-answer': '回答需要 <id> <text> 两个参数。用法: /task answer <id> <text>',
  'invalid-autopilot': 'autopilot 需要 on 或 off。用法: /task autopilot on|off',
  'invalid-register': 'register 需要任务描述。用法: /task register <描述>',
}

/** 解析后的 /task 命令（判别联合）。 */
type TaskCommand =
  | { kind: 'status' }
  | { kind: 'continue' }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'autopilot'; enabled: boolean }
  | { kind: 'register'; description: string }
  | { kind: 'invalid' }
  | { kind: 'invalid-answer' }
  | { kind: 'invalid-autopilot' }
  | { kind: 'invalid-register' }

// ── 命令解析 ───────────────────────────────────────────────────────────────

function parseAnswer(rest: string): TaskCommand {
  const match = rest.match(/^(\S+)\s+([\s\S]+)$/)
  if (match === null) return { kind: 'invalid-answer' }
  return { kind: 'answer', id: match[1], text: match[2] }
}

function parseAutopilot(rest: string): TaskCommand {
  if (rest === 'on') return { kind: 'autopilot', enabled: true }
  if (rest === 'off') return { kind: 'autopilot', enabled: false }
  return { kind: 'invalid-autopilot' }
}

function parseRegister(rest: string): TaskCommand {
  if (rest === '') return { kind: 'invalid-register' }
  return { kind: 'register', description: rest }
}

/** 解析 /task 命令：无参数 → status；未知子命令 → invalid。 */
export function parseTaskCommand(rawInput: unknown): TaskCommand {
  const input = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (input === '') return { kind: 'status' }
  const space = input.search(/\s/)
  const head = space === -1 ? input : input.slice(0, space)
  const rest = space === -1 ? '' : input.slice(space).trim()
  if (head === 'status') return { kind: 'status' }
  if (head === 'continue') return { kind: 'continue' }
  if (head === 'answer') return parseAnswer(rest)
  if (head === 'autopilot') return parseAutopilot(rest)
  if (head === 'register') return parseRegister(rest)
  return { kind: 'invalid' }
}

// ── status：渲染任务状态 ────────────────────────────────────────────────────

function modeLine(shared: SharedContext): string {
  const mode = shared.store.mode
  return `模式: 自动跟踪 ${mode.tracking ? '开' : '关'} / 完成度校验 ${mode.verify ? '开' : '关'} / 自主决策 ${mode.autopilot ? '开' : '关'}`
}

function taskLine(task: Task): string {
  return `  - [${task.id}] ${task.description}（${task.status}，循环 ${task.loopCount} 次）`
}

function questionLine(question: Question): string {
  return `  - [${question.id}] ${question.question}`
}

function renderStatus(shared: SharedContext): CommandResult {
  const active = shared.store.tasks.filter((task) => task.status === 'active' || task.status === 'checking')
  const pending = shared.store.questions.filter((question) => question.answer === undefined)
  const lines = [
    '任务可靠性状态',
    modeLine(shared),
    `活动任务: ${active.length} 个`,
    ...active.map(taskLine),
    `待确认问题: ${pending.length} 个`,
    ...pending.map(questionLine),
    '',
    `命令: ${USAGE}`,
  ]
  return { kind: 'success', text: lines.join('\n') }
}

// ── 子命令执行（全部复用现有 store/API 逻辑） ─────────────────────────────

/** continue：唤醒当前会话活动任务（复用 wakeStalledTask 恢复逻辑）。 */
async function runContinue(invocation: CommandInvocation, shared: SharedContext): Promise<CommandResult> {
  const task = activeTaskOf(shared.store, invocation.agent.id)
  if (task === undefined) {
    return {
      kind: 'error',
      text: '当前会话没有活动任务。使用 /task register <描述> 注册任务，或 /task 查看状态。',
    }
  }
  const ok = await wakeStalledTask(shared.ctx, task, shared.save, shared.emit)
  return ok
    ? { kind: 'success', text: `已唤醒任务继续执行：${task.description}` }
    : { kind: 'error', text: '唤醒任务失败（agent 服务不可用或会话无法恢复），请稍后重试。' }
}

/** answer：回答待确认问题（复用 store.js answerQuestion）。 */
function runAnswer(shared: SharedContext, id: string, text: string): CommandResult {
  const result = answerQuestion(shared.store, id, text)
  if (!result.ok) return { kind: 'error', text: `回答失败：${result.error}` }
  shared.save()
  return { kind: 'success', text: `已记录对问题 ${id} 的回答。` }
}

/** autopilot：切换自主决策模式（复用 api.js applyMode，与 /mode 一致）。 */
function runAutopilot(shared: SharedContext, enabled: boolean): CommandResult {
  applyMode({ autopilot: enabled }, shared)
  shared.save()
  return { kind: 'success', text: `自主决策模式已${enabled ? '开启' : '关闭'}。` }
}

/** register：注册任务到当前会话（复用 store.js registerTask）。 */
function runRegister(invocation: CommandInvocation, shared: SharedContext, description: string): CommandResult {
  const result = registerTask(shared.store, {
    sessionId: invocation.agent.id,
    description,
    mode: shared.store.mode.verify ? 'verify' : 'direct',
    source: 'manual',
  })
  if (!result.ok) return { kind: 'error', text: `注册失败：${result.error}` }
  shared.save()
  return { kind: 'success', text: `任务已注册：${result.task.id}（${result.task.description}）` }
}

// ── 入口与注册 ─────────────────────────────────────────────────────────────

/** 命令总入口：解析 → 分发到各子命令（复用逻辑）。 */
export async function handleTaskCommand(invocation: CommandInvocation, shared: SharedContext): Promise<CommandResult> {
  const command = parseTaskCommand(invocation.rawInput)
  switch (command.kind) {
    case 'status':
      return renderStatus(shared)
    case 'continue':
      return runContinue(invocation, shared)
    case 'answer':
      return runAnswer(shared, command.id, command.text)
    case 'autopilot':
      return runAutopilot(shared, command.enabled)
    case 'register':
      return runRegister(invocation, shared, command.description)
    default: {
      const message = INVALID_MESSAGES[command.kind] ?? `未知命令。用法: ${USAGE}`
      return { kind: 'error', text: message }
    }
  }
}

/** 注册 /task 命令（commands 服务可选：用 cordis 局部等待注册，服务未安装时
 *  不影响插件其它功能，一旦可用即注册）。 */
export function registerTaskCommand(ctx: DshContext, shared: SharedContext): void {
  // 不能用 ctx.get('commands') 一次性取值：commands 服务若在本插件 apply 之后
  // 才 active，strict 取法返回 undefined → 命令永久不注册（用户敲 `/` 的补全
  // 里看不到 task）。ctx.inject(['commands'], cb) 创建子 fiber 等待服务就绪，
  // 就绪后执行 cb；服务缺失时只是不注册，不阻塞插件其它能力（与官方
  // @deepseek-ai/dsh-command-compact 的 ctx.commands.register 写法同源）。
  // 注册 disposer 由子 fiber 持有，父 fiber 卸载时链式清理。
  ctx.inject(['commands'], (scope) => {
    scope.effect(
      () =>
        (scope.commands as CommandsService).register({
          name: 'task',
          description: '查看或继续任务：/task [status|continue|answer <id> <text>|autopilot on|off|register <描述>]',
          input: { hint: '[status|continue|answer <id> <text>|autopilot on|off|register <描述>]' },
          handler: (invocation: CommandInvocation) => handleTaskCommand(invocation, shared),
        }),
      'dsh-task-reliability: /task command',
    )
  })
}
