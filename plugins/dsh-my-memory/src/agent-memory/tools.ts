/**
 * dsh-my-memory — agent 记忆的四个工具（issue #502）。
 *
 * 工具面收敛为 4 个，全部限定在 $DSH_HOME/agent-memory/ 内（白名单见
 * paths.ts）。签名刻意做得像文件操作，但**不带任何元数据**——
 * `agent_memory_read` 返回的字节就是正文本身，一个多余字符都没有。
 *
 * 返回值纪律（issue #502）：**成功只有一个词 `ok`**，不汇报条数、不解释、
 * 不回显内容。失败才给可操作的原因。这条是「保存时不污染上下文」的落点：
 * agent 不会因为「已保存 2 条记忆」这类回显浪费 token。
 *
 * 为什么不用宿主 fs/read 直接读：$DSH_HOME 不在沙箱可写根内
 * （packages/sandbox/sandbox/src/roots.ts:52 只给 workspace + /tmp），
 * 且 fs-observation-policy 强制先读后写。自建工具是唯一可行路径，
 * 顺带把「路径逃逸 / 尺寸 / 敏感信息」三道硬门禁关在插件侧。
 */
import { createIndexStore } from './index-store.js'
import { createAgentMemoryStore } from './store.js'
import { DEFAULT_ARCHIVE_MS } from './paths.js'
import type { AgentMemoryStore } from './store.js'
import type { LoggerService, ToolsService } from '../types.js'

/** 单个工具的定义（与宿主 tools.register 契约的最小交集：output 是宿主强制的）。 */
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  execute: (params: Record<string, unknown>, exec?: unknown) => Promise<unknown>
}

/**
 * 四个工具共用的输出契约。
 *
 * 宿主 `tools.register()` **强制**要求 `output { schema, render }`：缺了直接抛
 * `TypeError: tool "…" must declare output { schema, render, presentationMeta? }`
 * （已装宿主 0.2.1-rc.3 实测），工具连注册都过不去——所以它既是契约也是门禁。
 * 本体系的成功值本来就是纯文本（成功一个 `ok`，失败一句可操作原因），故 schema
 * 就是 string，render 原样包一个 text block，模型看到的字节与之前完全一致。
 */
const TEXT_OUTPUT = Object.freeze({
  schema: { type: 'string' } as Record<string, unknown>,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
})

/** 工具配置（issue #502）。 */
export interface AgentMemoryConfig {
  /** 关闭整块 agent 记忆能力（默认开启）。 */
  enabled?: boolean
  /** 冷记忆归档阈值（天，默认 180）。 */
  archiveDays?: number
}

/** 会话 cwd（用于拼项目作用域路径）。 */
function cwdOf(exec: unknown): string {
  const agent = (exec as { agent?: { session?: { header?: { cwd?: string } } } } | undefined)?.agent
  return agent?.session?.header?.cwd ?? ''
}

/** 项目作用域的别名前缀：agent 不必知道项目 id（宿主按项目根 hash 生成）。 */
const CURRENT_PROJECT = 'projects/current/'

/**
 * 把 `projects/current/…` 解析为当前项目的真实前缀，其余名字原样返回。
 *
 * 项目 id 是宿主按项目根算出来的 hash，agent 无从得知也不该背——它只写
 * 「当前项目」，解析交给系统。list 返回的仍是真实路径，两者指向同一文件。
 */
async function resolveAlias(
  rawName: unknown,
  exec: unknown,
  resolveProjectPrefix: (cwd: string) => Promise<string>,
): Promise<unknown> {
  if (typeof rawName !== 'string') return rawName
  const cleaned = rawName.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!cleaned.startsWith(CURRENT_PROJECT)) return rawName
  const prefix = await resolveProjectPrefix(cwdOf(exec))
  return prefix + cleaned.slice(CURRENT_PROJECT.length)
}

/** 把 store 的返回摊平成模型可读的文本。 */
function renderRead(result: { ok: true; content: string } | { ok: false; error: string }): string {
  return result.ok ? result.content : result.error
}

/** 渲染 list 结果（条目数 >1 才标出来，避免把 60 条看成一两条）。 */
function renderList(items: Array<{ name: string; firstLine: string; count: number }>): string {
  if (items.length === 0) return '（空）'
  return items
    .map((item) => {
      const summary = item.firstLine === '' ? item.name : `${item.name} — ${item.firstLine}`
      return item.count > 1 ? `${summary}（${item.count} 条）` : summary
    })
    .join('\n')
}

/** 工具依赖。 */
export interface AgentMemoryToolDeps {
  store: AgentMemoryStore
  resolveProjectPrefix: (cwd: string) => Promise<string>
}

/** agent_memory_list：列出可读的记忆文件（冷记忆不列出）。 */
function listTool({ store, resolveProjectPrefix }: AgentMemoryToolDeps): ToolDefinition {
  return {
    name: 'agent_memory_list',
    description: '列出你的跨会话记忆文件（文件名 + 概要）。不确定有没有相关记忆时先调用它。',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'project'],
          description: 'all（默认，全部）或 project（仅当前项目）',
        },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(params, exec) {
      const scope = typeof params.scope === 'string' ? params.scope : 'all'
      const prefix = scope === 'project' ? await resolveProjectPrefix(cwdOf(exec)) : ''
      return renderList(await store.list(prefix))
    },
  }
}

/** agent_memory_read：读一份正文（返回的字节就是正文本身，无元数据）。 */
function readTool({ store, resolveProjectPrefix }: AgentMemoryToolDeps): ToolDefinition {
  return {
    name: 'agent_memory_read',
    description: '读取一份跨会话记忆的正文。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名，如 user.md / projects/<id>/pitfalls.md' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(params, exec) {
      const name = await resolveAlias(params.name, exec, resolveProjectPrefix)
      return renderRead(await store.read(name))
    },
  }
}

/** agent_memory_write：整份覆盖写入（成功只回 ok）。 */
function writeTool({ store, resolveProjectPrefix }: AgentMemoryToolDeps): ToolDefinition {
  return {
    name: 'agent_memory_write',
    description:
      '写入一份跨会话记忆（整份覆盖）。写入前先用 agent_memory_read 读，已有同主题就合并或替换，绝不新增重复条目。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名，如 user.md / projects/<id>/pitfalls.md' },
        content: { type: 'string', description: '完整正文（markdown）' },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(params, exec) {
      const name = await resolveAlias(params.name, exec, resolveProjectPrefix)
      const result = await store.write(name, params.content)
      return result.ok ? 'ok' : result.error
    },
  }
}

/** agent_memory_delete：删除一份记忆。 */
function deleteTool({ store, resolveProjectPrefix }: AgentMemoryToolDeps): ToolDefinition {
  return {
    name: 'agent_memory_delete',
    description: '删除一份跨会话记忆。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(params, exec) {
      const name = await resolveAlias(params.name, exec, resolveProjectPrefix)
      const result = await store.remove(name)
      return result.ok ? 'ok' : result.error
    },
  }
}

/** agent 记忆的运行时依赖（index + store）。 */
export interface AgentMemoryRuntime {
  index: ReturnType<typeof createIndexStore>
  store: AgentMemoryStore
}

/**
 * 构造 agent 记忆的运行时（index + store 单实例）。
 *
 * **必须全进程只有一份**：index.json 的持久化是「整份 cache 覆盖落盘」，
 * 两个实例各持一份 cache 时，一次面板写入会把工具侧 cache 里的旧值整体
 * 写回去（lost update——面板刚清掉的归档标记可能被回滚）。所以 index.ts
 * 建一份，工具与面板路由共用。
 */
export function createAgentMemoryRuntime({ logger }: { logger?: LoggerService } = {}): AgentMemoryRuntime {
  const index = createIndexStore({ logger })
  return { index, store: createAgentMemoryStore({ index, logger }) }
}

/** 构造四个工具定义（不含注册副作用，便于单测）。 */
export function createAgentMemoryTools(deps: AgentMemoryToolDeps): ToolDefinition[] {
  return [listTool(deps), readTool(deps), writeTool(deps), deleteTool(deps)]
}

/** 注册四个工具 + 启动时归档冷记忆；返回 disposer 集合。 */
export function registerAgentMemoryTools(
  ctx: {
    tools?: ToolsService
    logger?: LoggerService
    on?: (event: string, handler: (...args: any[]) => void) => () => void
  },
  {
    config,
    resolveProjectPrefix,
    runtime,
  }: {
    config?: AgentMemoryConfig
    resolveProjectPrefix: (cwd: string) => Promise<string>
    runtime?: AgentMemoryRuntime
  },
): () => void {
  if (config?.enabled === false) return () => {}
  const { index, store } = runtime ?? createAgentMemoryRuntime({ logger: ctx.logger })
  const archiveMs =
    Number.isFinite(config?.archiveDays) && (config?.archiveDays ?? 0) > 0
      ? (config!.archiveDays as number) * 24 * 60 * 60 * 1000
      : DEFAULT_ARCHIVE_MS

  const disposers = createAgentMemoryTools({ store, resolveProjectPrefix }).map((tool) =>
    ctx.tools?.register(tool as never),
  )

  // 启动时归档一次冷记忆（不阻塞启动：失败只 warn）。
  void index
    .load()
    .then(() => store.archiveCold(archiveMs))
    .catch((error: unknown) => ctx.logger?.warn(`agent-memory: 冷记忆归档失败：${String(error)}`))

  return () => {
    disposers.forEach((dispose) => dispose?.())
    void index.flush().catch(() => {})
  }
}

/** 供测试/面板复用：判断一个名字是否合法。 */
