// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → 记忆），
// 不依赖 dsh-better-sidebar。slots 服务是官方 client 服务，通过
// ctx.get 动态获取——服务缺省时静默跳过（不注册 tab，server 端记忆
// 能力不受影响）。
//
// issue #193：额外接管工具侧确认「呈现」——注册 conversation.composer 的
// chain 条目（宿主 dsh-client-ui-approval 用同一扩展点渲染原生审批卡，
// dsh-client-ui-approval/lib/client.js:272-281），仅当 pending approval 属于
// memory_save / memory_delete 时当选，其余一律让位。chain 选举语义：
// dsh-client-ui-renderer/lib/client.js:831-849 —— 按 priority 顺序询问，
// 首个 select 非 null 者当选并独占渲染（break），select 抛错 = declined。
// 宿主审批条目 priority=1，本插件用更小的 0 排在其前；即便顺序相反也只是
// 退回宿主原生卡（安全降级），不会出现「两边都不渲染」的死锁。

/** DSH client 端 Context（cordis Context 最小契约）。 */
interface ClientContext {
  effect(callback: () => void | (() => void), label?: string): void
  get<T>(name: string, strict?: boolean): T | undefined
}

/** slots 注册选项（设置页 tab 与 composer chain 两个扩展点共用）。 */
interface SlotRegisterOptions {
  name: string
  id?: string
  order?: number
  label?: () => string
  /** chain slot 专用：数值小者先被询问（宿主审批条目为 1）。 */
  priority?: number
  /** chain slot 专用：返回非 null 即当选渲染；null = 让位下一个条目。 */
  select?: (owner: unknown) => unknown
}

/** slots 服务（官方 client 扩展点）。 */
interface SlotsService {
  inject(slot: string, factory: () => () => void): void
  register(options: SlotRegisterOptions, component: (props: never) => ReactNode): () => void
}

/** 被接管的记忆写操作类型。 */
type MemoryApprovalOperation = 'save' | 'delete'

/** 工具侧确认卡载荷：select 里预解析并校验完毕，组件只做纯渲染。 */
interface MemoryApprovalMatch {
  operation: MemoryApprovalOperation
  toolName: string
  scope: string
  category: string
  content: string
  reasonText: string
  answer: (outcome: 'allowed-once' | 'rejected') => unknown
}

/**
 * chain 选举判据（严判据 + 双重校验，issue #193 安全契约）：
 * 只接管 pending approval 且 toolName ∈ {memory_save, memory_delete}；
 * 任何不确定情形（非对象、kind 不符、toolName 不在白名单、answer 不是函数、
 * 字段取值抛错）一律返回 null —— chain 渲染器随后询问宿主条目，用户始终
 * 能批准。绝不返回「半接管」状态（既不渲染、又挡住宿主）。
 */
function memoryApprovalOperation(pending: unknown): MemoryApprovalOperation | '' {
  if (pending === null || pending === undefined || typeof pending !== 'object') return ''
  const candidate = pending as { kind?: unknown; toolName?: unknown; answer?: unknown }
  if (candidate.kind !== 'approval') return ''
  if (typeof candidate.answer !== 'function') return ''
  if (candidate.toolName === 'memory_save') return 'save'
  if (candidate.toolName === 'memory_delete') return 'delete'
  return ''
}

function memoryApprovalSelect(owner: unknown): MemoryApprovalMatch | null {
  try {
    const pending = (owner as { pendingInteraction?: unknown } | undefined)?.pendingInteraction
    const operation = memoryApprovalOperation(pending)
    if (operation === '') return null
    const candidate = pending as { toolName: string; answer: MemoryApprovalMatch['answer']; reason?: unknown }
    const parsed = parseAskReason(candidate.reason)
    return {
      operation,
      toolName: String(candidate.toolName),
      scope: parsed.scope,
      category: parsed.category,
      content: parsed.content,
      reasonText: parsed.text,
      answer: candidate.answer.bind(pending),
    }
  } catch {
    return null
  }
}

/**
 * 工具侧确认卡（issue #193）：ask 范式卡 + 直接答复宿主 approval。
 * 删除走二次确认（首次点击只 arm），保存单击即允许；按钮文案与配色按
 * 操作区分（保存成功色 / 删除危险色）。答复异常被吞掉，绝不让渲染崩溃
 * 取代卡片（chain 的 crash face 会让用户无法批准）。
 */
function isUsableMatch(matched: unknown): matched is MemoryApprovalMatch {
  if (matched === null || matched === undefined) return false
  if (typeof matched !== 'object') return false
  return typeof (matched as MemoryApprovalMatch).answer === 'function'
}

/** 答复宿主 approval：兑现失败被吞掉，绝不让渲染崩溃取代卡片。 */
function answerApproval(matched: MemoryApprovalMatch, outcome: 'allowed-once' | 'rejected'): void {
  try {
    const result = matched.answer(outcome)
    if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => {})
    }
  } catch {
    // 宿主 approval 通道异常不得冒泡：卡片保持可交互，用户可重试
  }
}

/** 卡片文案与配色（保存成功色 / 删除危险色 + 二次确认）。 */
function approvalCardProps(
  matched: MemoryApprovalMatch,
  busy: boolean,
  respond: (outcome: 'allowed-once' | 'rejected') => void,
): AskConfirmCardProps {
  const isDelete = matched.operation === 'delete'
  return {
    variant: isDelete ? 'delete' : 'save',
    title: isDelete ? strings.askDeleteTitle() : strings.askSaveTitle(),
    scope: matched.scope,
    category: matched.category,
    content: matched.content,
    showSummary: isOverEntryLimit(matched.content, DEFAULT_ENTRY_LIMIT),
    note: isDelete ? strings.askNoteDelete() : strings.askNoteSave(),
    allowLabel: isDelete ? strings.askAllowDelete() : strings.askAllowSave(),
    armedLabel: isDelete ? strings.askDeleteArmed() : undefined,
    disabled: busy,
    onAllow: () => respond('allowed-once'),
    onReject: () => respond('rejected'),
  }
}

function MemoryApprovalCard(props: { matched?: unknown }): ReactNode {
  const [busy, setBusy] = useState(false)
  const matched = props?.matched
  if (!isUsableMatch(matched)) return null
  const respond = (outcome: 'allowed-once' | 'rejected'): void => {
    if (busy) return
    setBusy(true)
    answerApproval(matched, outcome)
  }
  return createElement(AskConfirmCard, approvalCardProps(matched, busy, respond))
}

exports.apply = function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(STYLE_TAG, 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-memory: styles')

  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下会返回 undefined，注册代码会静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = ctx.get<SlotsService>('slots', false)
  if (slots === undefined) return

  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'my-memory',
            order: 92,
            label: () => strings.title(),
          },
          MemoryView,
        ),
      ),
    'dsh-my-memory: settings tab registration',
  )

  // 工具侧确认呈现接管（issue #193）：chain 多注册共存，仅记忆写工具的
  // approval 当选；其它工具的审批由宿主条目渲染（priority=1）。
  // 注册失败不得影响面板 tab（记忆能力本身在 server 端，与呈现无关）。
  ctx.effect(
    () =>
      slots.inject('conversation.composer', () => {
        try {
          return slots.register(
            {
              name: 'conversation.composer',
              priority: 0,
              select: memoryApprovalSelect,
            },
            MemoryApprovalCard as (props: never) => ReactNode,
          )
        } catch {
          return () => {}
        }
      }),
    'dsh-my-memory: memory approval composer takeover',
  )
}
