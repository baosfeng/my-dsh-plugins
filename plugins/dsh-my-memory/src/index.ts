/**
 * dsh-my-memory — host half (TypeScript 源码)。
 *
 * 全局/项目两级记忆（issue #38）+ 渐进式索引记忆（issue #78）：
 *  - 持久化：全局 `$DSH_HOME/memory.json` + 项目 `$DSH_HOME/memory/projects/<项目 id>.json`
 *    （issue #108：项目记忆集中存 $DSH_HOME，按项目根路径 hash 分文件，项目目录不再产生
 *    `.dsh/`；项目根按 cwd 向上找 .git 定位；首次访问自动迁移旧 `<项目根>/.dsh/memory.json`
 *    数据到新位置，记忆不丢失），原子写（tmp+rename）+ 防抖（300ms 合并写盘），
 *    启动时 load() 恢复缓存；
 *  - 结构化索引（issue #78）：条目带 category / source / confidence / updatedAt /
 *    relatedIds / history / status 元数据，旧数据读取时自动回退默认值（不丢不崩）；
 *    同主题渐进合并（置信度提升 / 内容更新 / 矛盾标记）、长期未用降权、智能注入
 *    （相关性 + 时效性 + 置信度评分，替代简单 top-N）——见 lib/memory-scoring.js；
 *  - 工具：`memory_query`（只读）、`memory_save`（写——经 `tools/pre-execute` 确认门
 *    触发 DSH 原生审批，用户确认后才写入，绝不静默变更）；
 *  - 写操作 API：`POST /my-memory/api/memory`（add/update/delete）强制
 *    `confirmed: true`——记忆绝不静默变更；
 *  - Client：官方 slots 设置页签（全局/项目分区 + 分类/置信度/来源/演进展示 +
 *    自定义确认 UI：删除红色、保存绿色）。
 */
import { createApiHandler } from './api-route.js'
import { createTrustFence } from 'dsh-shared'
import { DEFAULT_MAX_ENTRY_LENGTH } from './memory-text.js'
import { createMemorySection } from './prompt.js'
import { createPromptsSection } from './prompts.js'
import { createPromptsStore, promptsFile } from './prompts-store.js'
import { createStore, globalMemoryFile, migrateProjectMemory, resolveProjectMemory } from './store.js'
import { createMemoryQueryTool } from './tool.js'
import { registerMemoryWriteTools } from './write-tools.js'
import { saveApprovalOf } from './save-policy.js'
import type { SaveApproval } from './save-policy.js'
import type { DshContext, LoggerService } from './types.js'

export const name = 'dsh-my-memory'

export const inject = ['systemPrompt', 'tools', 'webServer', 'sessions']

/** 插件配置接口。 */
export interface MemoryConfig {
  /** 最大条目长度（默认 50）。 */
  maxEntryLength?: number
  /** 最大注入条目数（默认 5）。 */
  maxItems?: number
  /** 单条描述最大长度（默认 200）。 */
  maxDescLength?: number
  /** 降权阈值（毫秒，默认 90 天）。 */
  decayMs?: number
  /** 主动提议开关（默认关闭）。 */
  proactivePropose?: boolean
  /** 保存确认策略（'auto' | 'always' | 'never'，默认 'auto'；issue #208）。 */
  saveApproval?: SaveApproval
  /** 全局提示词条目上限（默认 20，issue #465）。 */
  maxPromptItems?: number
  /** 单条提示词正文上限（字符，默认 1000，超出截断 + warn；issue #465）。 */
  maxPromptLength?: number
}

/** maxEntryLength 配置（issue #105 精简引导）；非法值回落默认 50。 */
function maxEntryLengthOf(config: MemoryConfig | undefined): number {
  return Number.isInteger(config?.maxEntryLength) && config!.maxEntryLength! > 0
    ? config!.maxEntryLength!
    : DEFAULT_MAX_ENTRY_LENGTH
}

/** 全局 + 项目（按 cwd 懒创建并缓存；首次访问自动迁移旧集中前文件）stores。 */
function createMemoryStores() {
  const globalStore = createStore({ file: globalMemoryFile() })
  const projectStores = new Map<string, ReturnType<typeof createStore>>()
  const getProjectStore = async (cwd: string) => {
    const { file, legacyFile } = await resolveProjectMemory(cwd)
    let store = projectStores.get(file)
    if (store === undefined) {
      await migrateProjectMemory({ file, legacyFile })
      store = createStore({ file })
      await store.load()
      projectStores.set(file, store)
    }
    return store
  }
  return { globalStore, projectStores, getProjectStore }
}

export function apply(ctx: DshContext, config: MemoryConfig): void {
  const { globalStore, projectStores, getProjectStore } = createMemoryStores()
  // 全局提示词（issue #465）：**独立文件 + 独立 store**，与记忆不共享任何结构。
  // 种子迁移发生在 store 首次读之前（见 prompts-store.ts 的顺序约束）。
  const promptsStore = createPromptsStore({
    file: promptsFile(),
    logger: ctx.logger,
    maxItems: config?.maxPromptItems,
    maxLength: config?.maxPromptLength,
  })

  const loadPromise = globalStore.load().catch(() => {})

  ctx.effect(() => {
    void loadPromise
    return () => {
      Promise.all([globalStore.flush(), promptsStore.flush()]).catch(() => {})
      ;[...projectStores.values()].forEach((store) => store.flush().catch(() => {}))
      promptsStore.dispose()
    }
  }, 'dsh-my-memory: store lifecycle')

  // ── 系统提示词注入（每次组装求值，记忆变更即时生效）────────────────
  ctx.effect(
    () => ctx.systemPrompt?.section(createMemorySection(globalStore, config)),
    'dsh-my-memory: system prompt section',
  )

  // ── 全局提示词注入（issue #465）：单 section、固定字面量名、order -85 ──
  // provider 读内存态 → 保存后**下一轮组装即生效**，无需重注册/重启。
  // section 名是幂等键：重复注册宿主会抛错，而抛错会打断整个 apply →
  // 这里必须 try/catch 降级（丢提示词注入，绝不拖垮记忆能力）。
  ctx.effect(() => {
    try {
      return ctx.systemPrompt?.section(
        createPromptsSection(promptsStore, {
          maxItems: Number.isInteger(config?.maxPromptItems) ? config!.maxPromptItems : undefined,
          maxLength: Number.isInteger(config?.maxPromptLength) ? config!.maxPromptLength : undefined,
          logger: ctx.logger,
        }),
      )
    } catch (error) {
      ctx.logger?.warn(
        `[dsh-my-memory] 全局提示词 section 注册失败（已降级：提示词不注入，记忆能力不受影响）：${String(error)}`,
      )
      return () => {}
    }
  }, 'dsh-my-memory: prompts system prompt section')

  // ── memory_query 只读工具 ─────────────────────────────────────────────
  ctx.effect(
    () => ctx.tools?.register(createMemoryQueryTool({ globalStore, getProjectStore })),
    'dsh-my-memory: memory_query tool',
  )

  // ── 记忆写工具（save/delete）+ 用户确认门（#107/#192，#208 起策略感知）──
  // 门按会话审批策略 + saveApproval 决定确认/免确认放行/明确拒绝——绝不静默变更。
  registerMemoryWriteTools(ctx, { globalStore, getProjectStore, config })

  // ── 写操作 API（需用户同意标记）──────────────────────────────────────
  const fence = createTrustFence(ctx) as (request: unknown) => boolean
  const apiHandler = createApiHandler({
    globalStore,
    getProjectStore,
    promptsStore,
    fence,
    sessions: ctx.sessions,
    logger: ctx.logger,
    config: { ...config, maxEntryLength: maxEntryLengthOf(config) },
  })
  ctx.effect(
    () => ctx.webServer?.register({ kind: 'prefix', path: '/my-memory/api', handler: apiHandler }),
    'dsh-my-memory: /my-memory/api routes',
  )

  registerMemoryStatusQuery(ctx, globalStore, projectStores, { config })
}

/** 插件状态查询（#155 聚合层）：返回全局/项目记忆条目数 + 启动日志。 */
function registerMemoryStatusQuery(
  ctx: DshContext,
  globalStore: ReturnType<typeof createStore>,
  projectStores: Map<string, ReturnType<typeof createStore>>,
  startup: { config: MemoryConfig },
) {
  ctx.on('plugin:status-query', ({ plugin }: { plugin: string }) => {
    if (plugin !== 'dsh-my-memory') return undefined
    const globalCount = globalStore.state?.items?.length ?? 0
    const projectCount = [...projectStores.values()].reduce((n, s) => n + (s.state?.items?.length ?? 0), 0)
    return {
      ok: true,
      value: {
        plugin: 'dsh-my-memory',
        config: { keys: ['maxEntryLength', 'saveApproval'] },
        running: true,
        stats: { globalEntries: globalCount, projectEntries: projectCount },
        lastActions: [],
      },
    }
  })
  logStartup(ctx.logger, startup.config)
}

/** 启动日志（issue #155）：统一 [dsh-my-memory] 前缀 + 关键配置摘要。 */
function logStartup(logger: LoggerService | undefined, config: MemoryConfig) {
  logger?.info(
    `[dsh-my-memory] 记忆插件已启用（maxEntryLength=${maxEntryLengthOf(config)}，saveApproval=${saveApprovalOf(config)}）`,
  )
}
