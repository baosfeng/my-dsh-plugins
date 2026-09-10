/**
 * dsh-my-guard — pre-execute guard（执行前护栏）。
 *
 * 监听 `tools/pre-execute`（waterfall）：
 *  - 破坏性命令检测：bash 工具 command 匹配内置破坏性模式 + 用户自定义
 *    护栏规则（issue #88，合并生效）→ 记录告警（内置 high / 自定义按规
 *    则严重级）；合并决策 mode（命中的全部规则中最严格者，见 custom-rules.js）
 *    为 deny 时返回 `{ kind: 'deny', reason }` 直接拦截，为 ask 时返回
 *    `{ kind: 'ask', reason }` 触发 DSH 原生审批确认；否则透传 next()。
 *  - 投毒扫描联动：命令含 `dsh plugin add <pkg>` 时异步扫描包内容
 *    （fire-and-forget，不阻塞 waterfall），发现可疑内容记录告警。
 *
 * ⚠️ waterfall 契约：监听器必须先 `await next()` 拿到下游决策再决定
 * 是否覆盖；默认 observe/未命中时一律原样返回下游决策。绝不吞掉 next()。
 */
import { GUARD_MODES } from './constants.js'
import { scanPackageTarget } from './poison.js'
import { decideDestructive, firstBuiltinMatch, matchCustomRules } from './custom-rules.js'
import type { DshContext, GuardMode, GuardOptions, Alert } from './types.js'

/** 注册执行前护栏监听器；返回 disposer。 */
export function attachGuardListener(
  ctx: DshContext,
  options: GuardOptions,
  recordAlert: (alert: Alert) => Alert,
): () => void {
  return ctx.on('tools/pre-execute', async (...args: unknown[]) => {
    const exec = args[0]
    const next = args[1] as () => Promise<unknown>
    const decision = await next()
    const command = commandOf(exec)
    if (command === '') return decision
    const sessionId = sessionIdOf(exec)
    const pkg = extractPluginAdd(command)
    if (pkg !== '' && options.poisonScan !== false) {
      void scanPackageTarget(pkg, (alert: Alert) => recordAlert({ ...alert, sessionId }))
    }
    const hit = decideDestructive(command, options)
    if (hit !== null) {
      recordAlert({
        type: 'destructive',
        sessionId,
        severity: hit.severity,
        message: hit.primary.message,
        detail: { command: truncateCommand(command), pattern: 'id' in hit.primary ? hit.primary.id : '' },
      })
      if (hit.mode === 'ask') {
        return {
          kind: 'ask',
          reason: `安全护栏：检测到破坏性命令（${hit.primary.message}），请确认是否执行`,
        }
      }
      if (hit.mode === 'deny') {
        return { kind: 'deny', reason: `安全护栏：已拦截破坏性命令（${hit.primary.message}）` }
      }
    }
    return decision
  })
}

/** 从 exec 提取 bash 命令文本（非 bash 工具返回空串）。 */
export function commandOf(exec: unknown): string {
  if (exec === null || typeof exec !== 'object') return ''
  const args = (exec as Record<string, unknown>).arguments
  if (args === null || typeof args !== 'object') return ''
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

/** 从 exec 提取会话 id（无 agent 返回空串）。 */
export function sessionIdOf(exec: unknown): string {
  const obj = exec as Record<string, unknown> | null | undefined
  const agent = obj?.agent
  return agent !== null && typeof agent === 'object' && typeof (agent as Record<string, unknown>).id === 'string'
    ? ((agent as Record<string, unknown>).id as string)
    : ''
}

/**
 * 破坏性命令检测：返回首个命中规则对象（内置优先，其次自定义，兼容原契约）。
 * customRules 为已编译的自定义规则列表（缺省 []）。
 */
export function detectDestructive(command: string, customRules: unknown[] = []) {
  const builtinHit = firstBuiltinMatch(command)
  if (builtinHit !== null) return builtinHit
  const customHits = matchCustomRules(command, customRules)
  return customHits.length > 0 ? customHits[0] : null
}

/** 从 bash 命令提取 `dsh plugin add <pkg>` 的包名（无命中返回空串）。 */
export function extractPluginAdd(command: string): string {
  const match = /\bdsh\s+plugin\s+(--profile\s+\S+\s+)?add\s+(\S+)/.exec(command)
  if (match === null) return ''
  const pkg = match[2].replace(/^link:/, '')
  return pkg === '' ? '' : pkg
}

/** 命令截断（保留首行，限长）。 */
export function truncateCommand(command: string): string {
  const oneLine = command.split('\n')[0].trim()
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine
}

/** 护栏模式校验：非法值回退 observe。 */
export function normalizeMode(mode: unknown): GuardMode {
  return GUARD_MODES.includes(mode as GuardMode) ? (mode as GuardMode) : 'observe'
}
