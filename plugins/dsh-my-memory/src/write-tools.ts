/**
 * dsh-my-memory — 记忆写工具的注册与确认门装配（issue #107 / #192 / #208）。
 *
 * 把「注册 memory_save / memory_delete + 挂 tools/pre-execute 确认门」从
 * index.ts 抽出：index.ts 已贴近 400 行文件上限（scripts/check-ts-size.mjs
 * 门禁），而这两个写工具共用同一道门、同一套 saveApproval 权限模式感知策略，
 * 天然属于同一内聚单元。
 */
import { createMemorySaveGate, createMemorySaveTool } from './tool.js'
import { createMemoryDeleteTool, lookupDeleteTarget } from './delete-tool.js'
import type { ToolConfig } from './tool.js'
import type { DshContext } from './types.js'
import type { StoreInstance } from './memory-types.js'

/** 写工具的存储依赖 + 配置。 */
export interface WriteToolDeps {
  globalStore: StoreInstance
  getProjectStore: (cwd: string) => Promise<StoreInstance>
  config?: ToolConfig
}

/**
 * 宿主 approval 服务的策略探针（issue #208）：直接调用
 * `ApprovalService.effectivePolicy(session)`——与宿主对 ask 的判定是同一个
 * 函数（dsh-user-approval/lib/index.js:155-178），所以探针结论不会与宿主漂移；
 * 服务未加载/返回异常时由 save-policy 回落到会话日志折返。
 */
function approvalProbe(ctx: DshContext, session: unknown): unknown {
  const approval = ctx.get<{ effectivePolicy?: (session: unknown) => unknown }>('approval')
  return approval?.effectivePolicy?.(session)
}

/**
 * 注册记忆写工具（memory_save #107 / memory_delete #192）并挂上共享确认门
 * （#208 起权限模式感知）。记忆绝不静默变更：门按会话审批策略 + saveApproval
 * 决定「原生确认（ask）/ 免确认放行（auto + never）/ 明确拒绝（always + never）」。
 */
export function registerMemoryWriteTools(
  ctx: DshContext,
  { globalStore, getProjectStore, config }: WriteToolDeps,
): void {
  const stores = { globalStore, getProjectStore }
  ctx.effect(() => {
    const disposers = [
      ctx.tools?.register(createMemorySaveTool({ ...stores, config, logger: ctx.logger })),
      ctx.tools?.register(createMemoryDeleteTool({ ...stores, logger: ctx.logger })),
    ]
    return () => disposers.forEach((dispose) => dispose?.())
  }, 'dsh-my-memory: memory_save + memory_delete tools')
  ctx.effect(
    () =>
      ctx.on(
        'tools/pre-execute',
        createMemorySaveGate({
          config,
          probePolicy: (session) => approvalProbe(ctx, session),
          logger: ctx.logger,
          lookupTarget: (args, exec) => lookupDeleteTarget(args, stores, exec),
        }),
      ),
    'dsh-my-memory: memory save/delete approval gate',
  )
}
