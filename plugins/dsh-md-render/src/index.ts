/**
 * dsh-md-render — host half（合并 think-zh-expand + mermaid-render，issue #463）。
 *
 * 合并后 host 半提供三件事：
 *  1. **配置读写路由** `/md-render/api/config`（GET/PUT，唯一一条配置路径）：
 *     命名空间化 config（markdown/thinking/mermaid）+ 旧扁平键读兼容；
 *  2. **静态资源路由** `/md-render/assets`：mermaid 引擎（不内联进 bundle）；
 *  3. **system-prompt 注入**：仅 mermaid 能力声明（`injectPrompt` 开关）。
 *     中文思考指令不在此注册 —— 由 dsh-my-memory 的「全局提示词」提供。
 *
 * 渲染本体全部在 client 半（lib/client.js）。配置保存写 profile patch 文件
 * （复用 dsh-shared），DSH 的 watchUserPatches 热重载后 client 重新 apply
 * （保存即生效，无需重启）。
 *
 * 本文件编译为 lib/index.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { createConfigState, mergeConfig, persistConfig } from './config.js'
import type { ConfigPatch, MdRenderConfig } from './config.js'
import { createPromptSection } from './prompt.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerConfigRoutes } from './routes/config.js'
import type { DshContext } from './types.js'

export const name = 'dsh-md-render'

/**
 * 服务依赖：webServer（路由）+ systemPrompt（能力声明）。
 *
 * `webServer` **必须**声明：cordis 4 的 service 守卫在 `ctx.webServer` 的 **get 阶段**
 * 就抛 `cannot get property "webServer" without inject`，可选链挡不住。
 * cordis 4 的 inject 没有 required/optional 语义；声明后在没有 webServer 的 profile
 * （如 tui）里该 fiber 保持 inactive —— 这正是期望。
 */
export const inject = ['webServer', 'systemPrompt'] as const

/** 应用层配置（cordis.patch.yml 插件行的 `config` 字段）。 */
export type MdRenderPluginConfig = Record<string, unknown>

export function apply(ctx: DshContext, config?: MdRenderPluginConfig): void {
  // 应用层 config 优先；旧扁平键读兼容在 createConfigState 内（用户 profile 已落盘）。
  const state = createConfigState(config)

  // system-prompt：只注册 mermaid 能力声明（先撤后注册，同值不惊动宿主）。
  const syncSection = createSectionSync(ctx)
  syncSection(state.mermaid.injectPrompt)

  // 配置保存：持久化（合并行内已有键）+ 更新内存 + section 热同步。
  registerConfigRoutes(ctx, state, async (patch: ConfigPatch) => {
    const next = mergeConfig(state, patch)
    await persistConfig(next)
    Object.assign(state.markdown, next.markdown)
    Object.assign(state.thinking, next.thinking)
    Object.assign(state.mermaid, next.mermaid)
    syncSection(next.mermaid.injectPrompt)
    ctx.logger?.info(`[dsh-md-render] 配置已保存（变更段=${Object.keys(patch).join(',')}）`)
  })

  // 静态资源：mermaid 引擎（按需 fetch，不内联）。
  registerAssetRoutes(ctx)

  ctx.logger?.info(
    state.mermaid.injectPrompt
      ? '[dsh-md-render] 已启用（markdown 增强 + 思考展开 + mermaid 渲染 + 能力声明注入）'
      : '[dsh-md-render] 已启用（markdown 增强 + 思考展开 + mermaid 渲染；能力声明注入已关闭）',
  )
}

/**
 * 注册/撤销 systemPrompt section：可重入 + **幂等**（保存后调用即热生效）。
 * 幂等很重要：重复注册同名 section 宿主会抛错，而无谓的撤销+重注册会让
 * 「保存一个与原值相同的配置」也惊动宿主（也可能丢掉其它插件的顺序假设）。
 */
function createSectionSync(ctx: DshContext): (inject: boolean) => void {
  let dispose: (() => void) | null = null
  let current: boolean | null = null
  return (inject: boolean): void => {
    if (current === inject) return
    if (dispose !== null) {
      dispose()
      dispose = null
    }
    current = inject
    const section = createPromptSection(inject)
    if (section === null) return
    dispose = ctx.systemPrompt?.section(section) ?? null
  }
}
