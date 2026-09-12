/**
 * dsh-my-memory — 权限模式感知的保存确认策略（issue #208）。
 *
 * 背景：`danger-full-access` preset 的 approval policy 是 `never`，宿主
 * ApprovalService.decide() 对 never 会话里的一切 ask **直接判 rejected**
 * （dsh-user-approval/lib/index.js:178），因此 `tools/pre-execute` 返回
 * `{ kind: 'ask' }` 的写操作在该模式下 100% 失败，且用户看不到任何弹窗
 * （#191 修复后 memory_save 仍然「存不了记忆」的第二环根因）。
 *
 * 本模块把「是否确认」从写死的 ask 改成**权限模式感知 + 可配置**：
 *  - `saveApproval: 'auto'`（默认）：policy=never 时直接写入（用户选择该
 *    模式即已表达对 agent 的信任）；条目仍标记来源、面板可见可撤销；
 *    policy=ask 时保持原生确认（行为不变）；
 *  - `'always'`：始终要求确认；policy=never 时明确失败并给出可操作提示；
 *  - `'never'`：从不确认（高级用法）。
 *
 * policy 判定（两条途径，均与宿主实现同源）：
 *  1. 宿主 approval 服务探针 `ApprovalService.effectivePolicy(session)`
 *     （dsh-user-approval/lib/index.js:155-157）——与宿主 decide() 同一函数；
 *  2. 会话日志折返：向前扫描 `approval/policy` 事件
 *     （dsh-user-approval/lib/index.js:163-168 的 overrideOf 同构；该事件由
 *     dsh-permission-presets/lib/index.js:293-311 在会话创建时写入），
 *     无事件时回落到宿主 approval 配置默认值 `'ask'`。
 * 两条途径都不可用时返回 `undefined`（未知）→ 按 ask 保守处理，不误放行。
 */

/** 保存确认策略（插件配置 `saveApproval`，默认 'auto'）。 */
export type SaveApproval = 'auto' | 'always' | 'never'

/** 会话审批策略（宿主 approval 服务的取值域）。 */
export type ApprovalPolicy = 'ask' | 'never'

/** 会话审批策略探针（宿主 approval 服务；返回非法值时回落到日志折返）。 */
export type PolicyProbe = (session: unknown) => unknown

/** 保存确认决策（宿主 PreToolDecision 的最小子集：allow / ask / deny）。 */
export type SaveDecision = { kind: 'allow' } | { kind: 'ask'; reason: string } | { kind: 'deny'; reason: string }

/** 策略相关配置（只读取 `saveApproval`，其余字段忽略）。 */
export interface SavePolicyConfig {
  saveApproval?: unknown
}

/** 门管辖的记忆写操作（issue #192：保存与删除共用同一道确认门与同一套策略）。 */
export type MemoryWriteOperation = 'save' | 'delete'

/**
 * `always` + policy=never 的失败提示：可操作、中文、不是笼统 rejected。
 * （方案 B：失败可见化——模型能把这段原因原样转述给用户。）
 */
function alwaysUnderNeverHint(operation: MemoryWriteOperation): string {
  const isDelete = operation === 'delete'
  const action = isDelete ? '删除' : '保存'
  const auto = isDelete ? '该模式下自动删除并记录删除日志' : '该模式下自动保存并标记来源'
  const manual = isDelete ? '在记忆面板手动删除这条记忆' : '在记忆面板手动新增这条记忆'
  return (
    '当前会话的审批策略为 never（不会弹出确认窗口，典型配置是 danger-full-access 预设），' +
    `插件配置 saveApproval=always 要求每次${action}都经用户确认，故本次${action}未执行。` +
    `请任选其一后重试：① 在插件配置中把 saveApproval 改为 auto（${auto}）或 never；` +
    '② 把会话 preset 切到 workspace-write（该模式会弹出确认窗口）；' +
    `③ 让用户直接${manual}。`
  )
}

/** 归一化 `saveApproval` 配置；非法值回落 'auto'。 */
export function saveApprovalOf(config?: SavePolicyConfig): SaveApproval {
  const value = config?.saveApproval
  return value === 'always' || value === 'never' ? value : 'auto'
}

/** 调用 agent 的会话对象（`exec.agent.session`）。 */
function sessionOf(exec: unknown): unknown {
  const agent = (exec as { agent?: { session?: unknown } } | undefined)?.agent
  return agent?.session
}

/** 宿主 approval 服务探针的合法取值（非法/抛错一律视为「无结论」）。 */
function probePolicyOf(probe: PolicyProbe | undefined, session: unknown): ApprovalPolicy | undefined {
  if (typeof probe !== 'function') return undefined
  try {
    const value = probe(session)
    return value === 'ask' || value === 'never' ? value : undefined
  } catch {
    return undefined
  }
}

/** 会话日志的读取器（宿主 Session 的 `seq` + `eventAt` 契约）。 */
function logReaderOf(session: unknown): { seq: number; eventAt: (index: number) => unknown } | undefined {
  const candidate = session as { seq?: unknown; eventAt?: unknown } | undefined
  if (typeof candidate?.eventAt !== 'function') return undefined
  const seq = typeof candidate.seq === 'number' && Number.isFinite(candidate.seq) ? candidate.seq : undefined
  if (seq === undefined || seq < 0) return undefined
  const readEvent = candidate.eventAt as (index: number) => unknown
  return { seq, eventAt: (index: number) => readEvent.call(candidate, index) }
}

/** 一个 `approval/policy` 事件的策略取值（其余事件/取值返回 undefined）。 */
function policyOfEvent(event: unknown): ApprovalPolicy | undefined {
  const eventObj = event as { type?: unknown; data?: { policy?: unknown } } | undefined
  if (eventObj?.type !== 'approval/policy') return undefined
  const policy = eventObj.data?.policy
  return policy === 'ask' || policy === 'never' ? policy : undefined
}

/**
 * 折返会话日志里最后一个 `approval/policy`（宿主 overrideOf 同构）。
 * 无该事件时返回宿主 approval 配置的默认值 'ask'；日志不可读返回 undefined。
 */
function foldPolicyOf(session: unknown): ApprovalPolicy | undefined {
  const log = logReaderOf(session)
  if (log === undefined) return undefined
  for (let index = log.seq - 1; index >= 0; index -= 1) {
    const policy = policyOfEvent(log.eventAt(index))
    if (policy !== undefined) return policy
  }
  return 'ask'
}

/**
 * 判定一次工具调用所属会话的审批策略（issue #208）。
 * @param exec 宿主 `ToolExecution`（`tools/pre-execute` 第一参数，含 agent）。
 * @param probe 宿主 approval 服务探针；无结论时回落会话日志折返。
 * @returns 'ask' / 'never'，两者都判不出时 undefined（未知）。
 */
export function approvalPolicyOf(exec: unknown, probe?: PolicyProbe): ApprovalPolicy | undefined {
  const session = sessionOf(exec)
  if (session === undefined) return undefined
  return probePolicyOf(probe, session) ?? foldPolicyOf(session)
}

/** 保存范围的用户可见名（用于确认/失败文案）。 */
function scopeLabelOf(args: { scope?: string } | undefined): string {
  return args?.scope === 'project' ? '项目' : '全局'
}

/** 范围的机器可读键（确认卡据此渲染选项行；issue #193）。 */
function scopeKeyOf(args: { scope?: string } | undefined): string {
  return args?.scope === 'project' ? 'project' : 'global'
}

/** 确认卡的结构化字段行（issue #193）：中文文案保持人类可读不变，机器可读
 *  字段另起行追加，客户端确认卡（面板侧 / 工具侧共用）据此渲染范围、分类与
 *  内容摘要。解析失败时客户端退化为「只显示原文」，不会渲染错信息。 */
function askReasonFields(fields: { scope?: string; category?: string; content?: string }): string {
  const lines: string[] = []
  if (fields.scope !== undefined) lines.push(`范围：${fields.scope}`)
  if (fields.category !== undefined && fields.category !== '') lines.push(`分类：${fields.category}`)
  if (fields.content !== undefined && fields.content !== '') lines.push(`内容：${fields.content}`)
  return lines.length === 0 ? '' : `\n${lines.join('\n')}`
}

/** 单行 desc 摘要（确认/失败文案用；超长截断）。 */
function descSnippet(desc: unknown): string {
  const oneLine = typeof desc === 'string' ? desc.trim().split('\n')[0] : ''
  if (oneLine === '') return '（空内容）'
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine
}

/** 待删条目的内容摘要查询器（门在询问前解析「删的是哪条」；issue #192）。 */
export type DeleteTargetLookup = (
  args: { id?: string; scope?: string; cwd?: string },
  exec: unknown,
) => Promise<string | undefined> | string | undefined

/** 删除确认的 reason：带待删内容摘要（让用户知道删的是哪条；issue #192）。 */
function deleteAskReasonOf(args: { scope?: string; id?: string } | undefined, target?: string): string {
  const id = typeof args?.id === 'string' && args.id !== '' ? args.id : '（未提供 id）'
  const what = target === undefined ? `id=${id}（未在当前范围找到该条目）` : `「${descSnippet(target)}」[${id}]`
  const head = `dsh-my-memory：agent 请求删除${scopeLabelOf(args)}记忆 ${what}。删除不可撤销，记忆绝不静默变更，请确认是否删除`
  return head + askReasonFields({ scope: scopeKeyOf(args), content: target === undefined ? '' : descSnippet(target) })
}

/** 原生确认门的 reason（记忆绝不静默变更的自述）。 */
function askReasonOf(
  args: { scope?: string; desc?: string; id?: string; category?: string } | undefined,
  operation: MemoryWriteOperation,
  target?: string,
): string {
  if (operation === 'delete') return deleteAskReasonOf(args, target)
  const head = `dsh-my-memory：agent 请求保存${scopeLabelOf(args)}记忆「${descSnippet(args?.desc)}」。记忆绝不静默变更，请确认是否保存`
  return head + askReasonFields({ scope: scopeKeyOf(args), category: args?.category, content: descSnippet(args?.desc) })
}

/**
 * decideSaveGate — saveApproval 三态 × policy 两态 的决策矩阵（issue #208；
 * #192 起 memory_delete 复用同一矩阵，只有 ask/deny 文案按操作区分）：
 *
 * | saveApproval | policy=ask            | policy=never              | 判定不出 |
 * | ------------ | --------------------- | ------------------------- | -------- |
 * | auto（默认） | ask（原生确认，不变） | allow（直接写入，标记来源） | ask      |
 * | always       | ask（原生确认）       | deny（可操作提示）         | ask      |
 * | never        | allow                 | allow                     | allow    |
 *
 * @param input.args 记忆写工具参数（写文案用）。
 * @param input.policy 本会话审批策略（undefined = 未知）。
 * @param input.config 插件配置（只读 saveApproval）。
 * @param input.operation 写操作类型（默认 save；issue #192 起 delete 共用同一矩阵）。
 * @param input.target 待删内容摘要（仅 delete 用，决定 reason 文案）。
 * @returns allow（不确认）/ ask（原生确认）/ deny（明确失败 + 提示）。
 */
export function decideSaveGate(input: {
  args?: { scope?: string; desc?: string; id?: string; category?: string }
  policy: ApprovalPolicy | undefined
  config?: SavePolicyConfig
  operation?: MemoryWriteOperation
  target?: string
}): SaveDecision {
  const mode = saveApprovalOf(input.config)
  const operation = input.operation ?? 'save'
  if (mode === 'never') return { kind: 'allow' }
  if (mode === 'always' && input.policy === 'never') {
    return { kind: 'deny', reason: alwaysUnderNeverHint(operation) }
  }
  if (mode === 'auto' && input.policy === 'never') return { kind: 'allow' }
  return { kind: 'ask', reason: askReasonOf(input.args, operation, input.target) }
}

/** 门的日志接口（与 tool.ts 的 Logger 结构一致；独立声明以避免模块循环依赖）。 */
export interface GateLogger {
  warn(message: string): void
  info(message: string): void
}

/** 确认门选项。 */
export interface SaveGateOptions {
  /** 插件配置（只读 saveApproval）。 */
  config?: SavePolicyConfig
  /** 宿主 approval 服务探针（无结论时回落会话日志折返）。 */
  probePolicy?: PolicyProbe
  /** 日志（记录免确认放行/明确拒绝的判定依据）。 */
  logger?: GateLogger
  /** 删除门专用：解析待删条目的内容摘要（缺失/查不到时门仍会询问；issue #192）。 */
  lookupTarget?: DeleteTargetLookup
}

/** 门的工具调用载荷（宿主 `tools/pre-execute` 的第一参数子集）。 */
interface GateExec {
  name?: string
  arguments?: { scope?: string; desc?: string; id?: string; cwd?: string; category?: string }
  agent?: unknown
}

/**
 * The `tools/pre-execute` approval gate for the memory write tools
 * (memory_save since issue #107, memory_delete since issue #192; policy aware
 * since issue #208 — both operations share one strategy matrix).
 *
 * Waterfall contract: every listener must first `await next()` to obtain the
 * downstream decision, then decide whether to override it. The decision comes
 * from {@link decideSaveGate} — `{ kind: 'ask', reason }` triggers the DSH
 * native approval flow (approval.request); under an approval policy of
 * `never` (danger-full-access) the host auto-rejects every ask
 * (dsh-user-approval/lib/index.js:178), so the gate either lets the write
 * through (`saveApproval: 'auto'`) or denies it with an actionable hint
 * (`'always'`) instead of failing invisibly. All other tools pass the
 * downstream decision through, so the gate never changes unrelated tool flows.
 */
export function createMemorySaveGate(options?: SaveGateOptions) {
  return async (exec: GateExec, next: () => Promise<unknown>) => {
    const downstream = await next()
    if (exec?.name === 'memory_save') return saveGateDecision(exec, downstream, options)
    if (exec?.name === 'memory_delete') return deleteGateDecision(exec, downstream, options)
    return downstream
  }
}

/** 保存决策 + 日志（拆出为独立函数以守住圈复杂度 ≤ 10 门禁）。 */
function saveGateDecision(exec: GateExec, downstream: unknown, options: SaveGateOptions | undefined): unknown {
  const policy = approvalPolicyOf(exec, options?.probePolicy)
  const decision = decideSaveGate({ args: exec?.arguments, policy, config: options?.config })
  return applyGateDecision(decision, downstream, options, 'memory_save', policy)
}

/** 删除决策 + 日志：先解析待删内容摘要，再走同一策略矩阵（issue #192）。 */
async function deleteGateDecision(
  exec: GateExec,
  downstream: unknown,
  options: SaveGateOptions | undefined,
): Promise<unknown> {
  const target = await deleteTargetOf(exec, options)
  const policy = approvalPolicyOf(exec, options?.probePolicy)
  const decision = decideSaveGate({
    args: exec?.arguments,
    policy,
    config: options?.config,
    operation: 'delete',
    target,
  })
  return applyGateDecision(decision, downstream, options, 'memory_delete', policy)
}

/** 待删内容摘要的容错解析：查询器缺失/抛错/空值一律 undefined（门仍会询问）。 */
async function deleteTargetOf(exec: GateExec, options: SaveGateOptions | undefined): Promise<string | undefined> {
  if (typeof options?.lookupTarget !== 'function') return undefined
  try {
    const value = await options.lookupTarget(exec?.arguments ?? {}, exec)
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/** 统一的决策落地：ask 原样返回触发原生审批，deny 记录并返回，allow 放行下游（+日志）。 */
function applyGateDecision(
  decision: SaveDecision,
  downstream: unknown,
  options: SaveGateOptions | undefined,
  toolName: string,
  policy: ApprovalPolicy | undefined,
): unknown {
  if (decision.kind === 'ask') return decision
  const where = `policy=${policy ?? 'unknown'}，saveApproval=${saveApprovalOf(options?.config)}`
  if (decision.kind === 'deny') {
    warnGate(options?.logger, `${toolName} 被拒绝（${where}）：${decision.reason}`)
    return decision
  }
  infoGate(options?.logger, `${toolName} 免确认放行（${where}）`)
  return downstream
}

/** 门 info 日志（统一 [dsh-my-memory] 前缀）。 */
function infoGate(logger: GateLogger | undefined, message: string): void {
  logger?.info(`[dsh-my-memory] ${message}`)
}

/** 门 warn 日志（统一 [dsh-my-memory] 前缀）。 */
function warnGate(logger: GateLogger | undefined, message: string): void {
  logger?.warn(`[dsh-my-memory] ${message}`)
}
