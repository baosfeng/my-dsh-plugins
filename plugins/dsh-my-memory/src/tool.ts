/**
 * dsh-my-memory — the `memory_query` (read-only) and `memory_save` tools.
 *
 * Registered through `ctx.tools.register` with a hand-built ToolDefinition
 * (no `@deepseek-ai/dsh-tools` import — plugins in this repo resolve only
 * Node builtins and relative modules, so the definition is constructed
 * directly with JSON-Schema parameters/output, which the registry accepts).
 *
 * `memory_query` is strictly read-only: it never mutates the stores. It lists
 * the global or project memories, optionally filtered by a keyword substring.
 * The project scope resolves its cwd from the calling agent's session
 * (`exec.agent.session.header.cwd`) unless the model passes one explicitly.
 *
 * `memory_save` lets the agent persist a memory the user wants kept. It never
 * changes memory silently: a `tools/pre-execute` gate (`createMemorySaveGate`)
 * answers every `memory_save` call with `{ kind: 'ask', reason }`, which
 * triggers the DSH native approval flow — the write lands only after the user
 * confirms it. The `proactivePropose` config switch (default off, issue #78
 * phase) only shapes the tool description: on, the description tells the agent
 * it may propose saving memories it notices; off, the agent saves on request.
 */
import { findProjectRoot } from 'dsh-shared'
import type { MemoryItem, StoreInstance } from './memory-types.js'

/** 查询结果接口。 */
export interface QueryResult {
  scope: 'global' | 'project'
  cwd: string
  projectRoot: string
  items: MemoryItem[]
}

/** 保存结果接口。 */
export interface SaveResult {
  scope: 'global' | 'project'
  cwd: string
  projectRoot: string
  item: MemoryItem
}

/** 存储依赖接口。 */
export interface StoreDeps {
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
}

/** 配置接口。 */
export interface ToolConfig {
  proactivePropose?: boolean
}

/** 日志接口。 */
export interface Logger {
  warn(message: string): void
  info(message: string): void
}

/** 执行上下文接口。 */
export interface ExecContext {
  agent?: {
    id?: string
    session?: {
      header?: {
        cwd?: string
      }
    }
  }
}

/** Filter items by a keyword substring (case-insensitive); no filter when empty. */
export function filterItems(items: MemoryItem[], keyword?: string): MemoryItem[] {
  const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : ''
  if (needle === '') return items
  return items.filter((item) => item.desc.toLowerCase().includes(needle))
}

/** Render one query result as model-facing text. */
export function renderQueryResult(value: QueryResult): string {
  const scopeLabel = value.scope === 'project' ? '项目' : '全局'
  const where =
    value.scope === 'project' && value.projectRoot !== ''
      ? `（项目：${value.projectRoot}）`
      : value.scope === 'project'
        ? '（项目目录未知）'
        : ''
  if (value.items.length === 0) return `没有找到${scopeLabel}记忆${where}。`
  const lines = value.items.map((item) => `- [${item.id}] ${item.desc}`)
  return `${scopeLabel}记忆${where}（${value.items.length} 条）：\n${lines.join('\n')}`
}

/** memory_query parameters (JSON Schema; the registry projects them to the model). */
const QUERY_PARAMETERS = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['global', 'project'],
      description: '查询范围：global（全局记忆）或 project（当前项目记忆）',
    },
    keyword: {
      type: 'string',
      description: '可选：按记忆内容包含的关键词过滤（不区分大小写）',
    },
    cwd: {
      type: 'string',
      description: '可选：项目记忆的项目目录（默认取当前会话的工作目录）',
    },
  },
  required: ['scope'],
  additionalProperties: false,
}

/** memory_query output schema (JSON Schema; enforced on every successful value). */
const QUERY_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string' },
    cwd: { type: 'string' },
    projectRoot: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          desc: { type: 'string' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
        },
        required: ['id', 'desc', 'createdAt', 'updatedAt'],
      },
    },
  },
  required: ['scope', 'cwd', 'projectRoot', 'items'],
}

/** The memory_query tool definition (read-only). */
export function createMemoryQueryTool({ globalStore, getProjectStore }: StoreDeps) {
  return {
    name: 'memory_query',
    description:
      '查询记忆详情（只读）：列出全局或项目记忆条目，可按关键词过滤。全局记忆在会话开始时已注入系统提示词；此工具用于查看完整记忆列表或项目记忆。',
    parameters: QUERY_PARAMETERS,
    output: {
      schema: QUERY_OUTPUT,
      render: (_args: unknown, value: QueryResult) => [{ type: 'text', text: renderQueryResult(value) }],
    },
    async execute(args: { scope: string; keyword?: string; cwd?: string }, exec: ExecContext) {
      return executeQuery(args, exec, { globalStore, getProjectStore })
    },
  }
}

/** Run one memory_query call (read-only). */
async function executeQuery(
  args: { scope: string; keyword?: string; cwd?: string },
  exec: ExecContext,
  { globalStore, getProjectStore }: StoreDeps,
): Promise<QueryResult> {
  const scope = args.scope === 'project' ? 'project' : 'global'
  if (scope === 'global') {
    return { scope, cwd: '', projectRoot: '', items: filterItems(globalStore.list(), args.keyword) }
  }
  const cwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : sessionCwdOf(exec)
  if (cwd === '') {
    return { scope, cwd: '', projectRoot: '', items: [] }
  }
  const store = await getProjectStore(cwd)
  const projectRoot = await findProjectRoot(cwd)
  return { scope, cwd, projectRoot, items: filterItems(store.list(), args.keyword) }
}

/** The calling agent's session cwd, when it has one. */
function sessionCwdOf(exec: ExecContext): string {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

/** memory_save parameters (JSON Schema; the registry projects them to the model). */
const SAVE_PARAMETERS = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['global', 'project'],
      description: '保存范围：global（全局记忆）或 project（当前项目记忆）',
    },
    desc: {
      type: 'string',
      description: '要保存的记忆内容（用户偏好、项目约定、技术决策等）',
    },
    cwd: {
      type: 'string',
      description: '可选：项目记忆的项目目录（默认取当前会话的工作目录）',
    },
  },
  required: ['scope', 'desc'],
  additionalProperties: false,
}

/** memory_save output schema (JSON Schema; the saved item is always returned). */
const SAVE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string' },
    cwd: { type: 'string' },
    projectRoot: { type: 'string' },
    item: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        desc: { type: 'string' },
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
      },
      required: ['id', 'desc', 'createdAt', 'updatedAt'],
    },
  },
  required: ['scope', 'cwd', 'projectRoot', 'item'],
}

/** The save scope label used in the approval reason (zh, model/user-facing). */
function scopeLabelOf(args: { scope?: string }): string {
  return args?.scope === 'project' ? '项目' : '全局'
}

/** A short desc snippet for the approval reason / render text. */
function descSnippet(desc: unknown): string {
  const oneLine = typeof desc === 'string' ? desc.trim().split('\n')[0] : ''
  if (oneLine === '') return '（空内容）'
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine
}

/** Render one save result as model-facing text. */
export function renderSaveResult(value: SaveResult): string {
  const scopeLabel = value.scope === 'project' ? '项目' : '全局'
  const where =
    value.scope === 'project' && value.projectRoot !== ''
      ? `（项目：${value.projectRoot}）`
      : value.scope === 'project'
        ? '（项目目录未知）'
        : ''
  return `已保存${scopeLabel}记忆${where}：${value.item.desc} [${value.item.id}]`
}

/**
 * The memory_save tool description. The `proactivePropose` switch (default
 * off, issue #78 phase) tells the agent it may proactively propose saving
 * memories it notices during the conversation; off, the agent saves on
 * request. Either way the write always goes through the user-consent gate.
 */
export function saveToolDescription(proactivePropose?: boolean): string {
  if (proactivePropose === true) {
    return '保存记忆（写操作，需用户确认）：将一条值得记住的信息保存为全局或项目记忆。内容建议浓缩为 1-2 句话概括（用「；」或「。」切分要点），不要长篇解释性话语。发现值得记住的信息时，可主动向用户提议保存；用户同意后调用本工具。保存后 memory_query 立即可查、后续会话注入生效。'
  }
  return '保存记忆（写操作，需用户确认）：按用户要求将一条信息保存为全局或项目记忆。内容建议浓缩为 1-2 句话概括（用「；」或「。」切分要点），不要长篇解释性话语。调用后需用户确认才会真正写入。保存后 memory_query 立即可查、后续会话注入生效。'
}

/** The memory_save tool definition (write; gated by the approval listener). */
export function createMemorySaveTool({
  globalStore,
  getProjectStore,
  config,
  logger,
}: StoreDeps & { config?: ToolConfig; logger?: Logger }) {
  return {
    name: 'memory_save',
    description: saveToolDescription(config?.proactivePropose),
    parameters: SAVE_PARAMETERS,
    output: {
      schema: SAVE_OUTPUT,
      render: (_args: unknown, value: SaveResult) => [{ type: 'text', text: renderSaveResult(value) }],
    },
    async execute(args: { scope: string; desc: string; cwd?: string }, exec: ExecContext) {
      return executeSave(args, exec, { globalStore, getProjectStore, logger })
    },
  }
}

/** Run one memory_save call; lands only after the pre-execute approval gate. */
async function executeSave(
  args: { scope: string; desc: string; cwd?: string },
  exec: ExecContext,
  { globalStore, getProjectStore, logger }: StoreDeps & { logger?: Logger },
): Promise<SaveResult> {
  const scope = args.scope === 'project' ? 'project' : 'global'
  const desc = typeof args.desc === 'string' ? args.desc.trim() : ''
  const sessionId = sessionIdOf(exec)
  if (desc === '') {
    warnSave(logger, `memory_save 拒绝空内容（sessionId=${sessionId}，操作=save）`)
    throw new Error('memory_save: desc is required and must not be empty')
  }
  if (scope === 'global') {
    const item = await globalStore.add(desc)
    infoSave(logger, `记忆已保存（scope=global，itemId=${item.id}，sessionId=${sessionId}）`)
    return { scope, cwd: '', projectRoot: '', item }
  }
  const cwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : sessionCwdOf(exec)
  if (cwd === '') {
    warnSave(logger, `memory_save 项目范围缺少 cwd（sessionId=${sessionId}，操作=save）`)
    throw new Error('memory_save: project scope requires a cwd (explicit or from the session)')
  }
  const store = await getProjectStore(cwd)
  const projectRoot = await findProjectRoot(cwd)
  const item = await store.add(desc)
  infoSave(logger, `记忆已保存（scope=project，itemId=${item.id}，sessionId=${sessionId}，cwd=${cwd}）`)
  return { scope, cwd, projectRoot, item }
}

/** 调用 agent 的会话 id（无则空串）。 */
function sessionIdOf(exec: ExecContext): string {
  return exec?.agent?.id ?? ''
}

/** 记忆写操作 warn 日志（统一 [dsh-my-memory] 前缀，issue #155）。 */
function warnSave(logger: Logger | undefined, message: string): void {
  logger?.warn(`[dsh-my-memory] ${message}`)
}

/** 记忆写操作 info 日志（统一 [dsh-my-memory] 前缀，issue #155）。 */
function infoSave(logger: Logger | undefined, message: string): void {
  logger?.info(`[dsh-my-memory] ${message}`)
}

/**
 * The `tools/pre-execute` approval gate for memory_save (issue #107).
 *
 * Waterfall contract: every listener must first `await next()` to obtain the
 * downstream decision, then decide whether to override it. Every memory_save
 * call is answered with `{ kind: 'ask', reason }`, which triggers the DSH
 * native approval flow (approval.request) — the write executes only after the
 * user confirms. All other tools pass the downstream decision through, so the
 * gate never changes unrelated tool flows (memory never changes silently).
 */
export function createMemorySaveGate() {
  return async (
    exec: { name?: string; arguments?: { scope?: string; desc?: string } },
    next: () => Promise<unknown>,
  ) => {
    const decision = await next()
    if (exec?.name !== 'memory_save') return decision
    const scope = scopeLabelOf(exec?.arguments ?? {})
    const snippet = descSnippet(exec?.arguments?.desc)
    return {
      kind: 'ask',
      reason: `dsh-my-memory：agent 请求保存${scope}记忆「${snippet}」。记忆绝不静默变更，请确认是否保存`,
    }
  }
}
