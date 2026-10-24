/**
 * dsh-my-skill-manager — 插件入口（host half）。
 *
 * 能力面（契约见 docs/原型重构/impl-contract-skill-manager.md）：
 *  - 禁用机制：向 `ctx.skills` 注册 rank-0 占位 provider；被禁用名字在合并
 *    目录里被占位覆盖，模型侧看到「已禁用」，`get()` 不加载正文。配置按
 *    会话 cwd 解析，因此项目禁用只影响该项目。
 *  - 使用统计：包装 `ctx.skills.get()`，`tools/pre-execute` 标记模型来源，
 *    防抖 500ms 原子写 `$DSH_HOME/skills.usage.json`。
 *  - HTTP：`/my-skill-manager/api` 下的 list / detail / rescan / session /
 *    config 路由，前置信任围栏。
 *  - Client：由 `lib/client.js` 注册「设置 → 插件」页签（独立构建）。
 */
import { createTrustFence } from 'dsh-shared'
import { createDisablerProvider } from './server/disabler.js'
import { API_PREFIX, createApiHandler } from './server/http.js'
import type { DshContext } from './server/types.js'
import { createModelCallTracker, createUsageStore, usageFile, wrapSkillGet } from './server/usage.js'

export const name = 'dsh-my-skill-manager'

export const inject = ['skills', 'webServer', 'sessions']

export function apply(ctx: DshContext): void {
  // 禁用占位 provider：配置变化时 invalidate 让宿主 skill 目录立即重算。
  let invalidate = (): void => {}
  const disposeProvider = ctx.skills!.registerProvider((control) => {
    invalidate = () => control.invalidate()
    return createDisablerProvider()
  })
  ctx.effect(() => disposeProvider, 'dsh-my-skill-manager: disabler provider')

  // 使用统计：包装 get 计数，tools/pre-execute 标记模型调用来源。
  const usage = createUsageStore({ file: usageFile(), logger: ctx.logger })
  const tracker = createModelCallTracker()
  const restoreGet = wrapSkillGet(ctx.skills!, usage, tracker)
  const disposePreExecute = ctx.on('tools/pre-execute', (...args: unknown[]) => {
    const execution = args[0]
    const next = args[1]
    if (execution !== null && typeof execution === 'object') {
      const call = execution as { name?: unknown; arguments?: { name?: unknown } }
      if (call.name === 'skill' && typeof call.arguments?.name === 'string') tracker.mark(call.arguments.name)
    }
    return typeof next === 'function' ? next() : undefined
  })
  ctx.effect(
    () => () => {
      if (typeof disposePreExecute === 'function') disposePreExecute()
      restoreGet()
      void usage.flush()
    },
    'dsh-my-skill-manager: usage listeners',
  )

  const fence = createTrustFence(ctx)
  ctx.effect(
    () =>
      ctx.webServer!.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: createApiHandler({ ctx, invalidate, fence, usage }),
      }),
    'dsh-my-skill-manager: /my-skill-manager/api routes',
  )
}
