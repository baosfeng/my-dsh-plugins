/**
 * dsh-my-memory — the `memory_delete` tool (issue #192).
 *
 * 按 id 删除一条全局/项目记忆。删除**不可撤销**且**必须经用户确认**：
 * 本模块只做范围定位与删除，确认由 `save-policy.ts` 的 `tools/pre-execute`
 * 门负责——与 `memory_save` 共用同一道门、同一套 saveApproval 权限模式感知
 * 策略（issue #208）。宿主在 `{ kind: 'ask' }` 未被批准时不会调用 `execute`，
 * 因此「未确认/被拒绝」在实现层等价于「没删」。
 *
 * 语义要点：
 *  - 删除不存在的 id **明确失败**（绝不静默成功）——模型与用户都能看到原因；
 *  - `scope`/`cwd` 语义与 `memory_save` 完全一致（默认 global，项目范围
 *    解析显式 cwd 或调用会话的工作目录）；
 *  - 输出复用 #191 的 `MEMORY_ITEM_SCHEMA`：被删条目原样回执，模型可据此向
 *    用户复述「删了哪条」；
 *  - 删除在日志里留下 itemId + 会话 id 的审计线索（store 的 `remove` 只做
 *    移除、不留墓碑，故审计落在日志而非条目历史）。
 */
import { findProjectRoot } from 'dsh-shared'
import { MEMORY_ITEM_SCHEMA } from './tool.js'
import { categoryLabelOf } from './memory-scoring.js'
import type { Logger, StoreDeps } from './tool.js'
import type { MemoryItem, StoreInstance } from './memory-types.js'

/** 删除结果接口（被删条目随结果回执）。 */
export interface DeleteResult {
  scope: 'global' | 'project'
  cwd: string
  projectRoot: string
  item: MemoryItem
}

/** 删除参数（id 必填；scope/cwd 语义与 memory_save 一致）。 */
export interface DeleteArgs {
  id: string
  scope?: string
  cwd?: string
}

/** 门的待删目标查询参数（id 可能缺失——门的兜底路径）。 */
export type DeleteQuery = Partial<DeleteArgs>

/** 定位到的删除目标（store + 回执元信息）。 */
interface LocatedTarget {
  store: StoreInstance
  scope: 'global' | 'project'
  cwd: string
  projectRoot: string
}

/** memory_delete parameters (JSON Schema; the registry projects them to the model). */
const DELETE_PARAMETERS = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: '要删除的记忆条目 id（memory_query 输出里的 [id]）',
    },
    scope: {
      type: 'string',
      enum: ['global', 'project'],
      description: '删除范围：global（全局记忆）或 project（当前项目记忆），默认 global',
    },
    cwd: {
      type: 'string',
      description: '可选：项目记忆的项目目录（默认取当前会话的工作目录）',
    },
  },
  required: ['id'],
  additionalProperties: false,
}

/** memory_delete output schema（复用 #191 的条目 schema，形状不漂移）。 */
const DELETE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string' },
    cwd: { type: 'string' },
    projectRoot: { type: 'string' },
    item: MEMORY_ITEM_SCHEMA,
  },
  required: ['scope', 'cwd', 'projectRoot', 'item'],
}

/** The memory_delete tool definition (write; gated by the shared approval gate). */
export function createMemoryDeleteTool({ globalStore, getProjectStore, logger }: StoreDeps & { logger?: Logger }) {
  return {
    name: 'memory_delete',
    description:
      '删除记忆（写操作，不可撤销，需用户确认）：按 id 删除全局或项目记忆中的一条。id 取自 memory_query 的输出，删除前建议先 memory_query 确认要删的是哪一条。删除不存在的 id 会明确报错，不会静默成功。',
    parameters: DELETE_PARAMETERS,
    output: {
      schema: DELETE_OUTPUT,
      render: (_args: unknown, value: DeleteResult) => [{ type: 'text', text: renderDeleteResult(value) }],
    },
    async execute(args: DeleteArgs, exec: unknown) {
      return executeDelete(args, exec, { globalStore, getProjectStore, logger })
    },
  }
}

/** Run one memory_delete call; lands only after the pre-execute approval gate. */
async function executeDelete(
  args: DeleteArgs,
  exec: unknown,
  { globalStore, getProjectStore, logger }: StoreDeps & { logger?: Logger },
): Promise<DeleteResult> {
  const id = typeof args?.id === 'string' ? args.id.trim() : ''
  const sessionId = sessionIdOf(exec)
  if (id === '') {
    warnDelete(logger, `memory_delete 拒绝空 id（sessionId=${sessionId}，操作=delete）`)
    throw new Error('memory_delete: id is required and must not be empty')
  }
  const target = await locateTarget(args, { globalStore, getProjectStore }, exec)
  if (target === undefined) {
    warnDelete(logger, `memory_delete 项目范围缺少 cwd（sessionId=${sessionId}，操作=delete）`)
    throw new Error('memory_delete: project scope requires a cwd (explicit or from the session)')
  }
  const item = target.store.list().find((entry) => entry.id === id)
  if (item === undefined) {
    warnDelete(
      logger,
      `memory_delete 未找到条目（scope=${target.scope}，itemId=${id}，sessionId=${sessionId}，操作=delete）`,
    )
    throw new Error(`memory_delete: memory item not found: ${id} (scope=${target.scope})`)
  }
  await target.store.remove(id)
  infoDelete(logger, `记忆已删除（scope=${target.scope}，itemId=${id}，sessionId=${sessionId}，操作=delete）`)
  return { scope: target.scope, cwd: target.cwd, projectRoot: target.projectRoot, item }
}

/** 待删条目的内容摘要（确认门的询问文案用；查不到返回 undefined）。 */
export async function lookupDeleteTarget(
  args: DeleteQuery | undefined,
  deps: StoreDeps,
  exec?: unknown,
): Promise<string | undefined> {
  const target = await locateTarget(args, deps, exec)
  if (target === undefined) return undefined
  return target.store.list().find((entry) => entry.id === args?.id)?.desc
}

/** 定位删除目标：global 直接命中；project 解析 cwd（显式优先，其次会话目录），
 *  解析不出返回 undefined（由调用方给出明确错误）。 */
async function locateTarget(
  args: DeleteQuery | undefined,
  { globalStore, getProjectStore }: StoreDeps,
  exec: unknown,
): Promise<LocatedTarget | undefined> {
  if (args?.scope !== 'project') {
    await globalStore.load()
    return { store: globalStore, scope: 'global', cwd: '', projectRoot: '' }
  }
  const cwd = resolveCwd(args, exec)
  if (cwd === '') return undefined
  const store = await getProjectStore(cwd)
  await store.load()
  return { store, scope: 'project', cwd, projectRoot: await findProjectRoot(cwd) }
}

/** 项目 cwd：显式参数优先，其次调用会话的工作目录。 */
function resolveCwd(args: DeleteQuery | undefined, exec: unknown): string {
  if (typeof args?.cwd === 'string' && args.cwd !== '') return args.cwd
  const agent = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | undefined)?.agent
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

/** 调用 agent 的会话 id（无则空串）。 */
function sessionIdOf(exec: unknown): string {
  const agent = (exec as { agent?: { id?: unknown } } | undefined)?.agent
  return typeof agent?.id === 'string' ? agent.id : ''
}

/** Render one delete result as model-facing text. */
export function renderDeleteResult(value: DeleteResult): string {
  const scopeLabel = value.scope === 'project' ? '项目' : '全局'
  const where =
    value.scope === 'project' && value.projectRoot !== ''
      ? `（项目：${value.projectRoot}）`
      : value.scope === 'project'
        ? '（项目目录未知）'
        : ''
  return `已删除${scopeLabel}记忆${where}〔${categoryLabelOf(value.item.category)}〕：${value.item.desc} [${value.item.id}]`
}

/** 删除操作 warn 日志（统一 [dsh-my-memory] 前缀，issue #155）。 */
function warnDelete(logger: Logger | undefined, message: string): void {
  logger?.warn(`[dsh-my-memory] ${message}`)
}

/** 删除操作 info 日志（审计线索：itemId + 调用会话，issue #192）。 */
function infoDelete(logger: Logger | undefined, message: string): void {
  logger?.info(`[dsh-my-memory] ${message}`)
}
