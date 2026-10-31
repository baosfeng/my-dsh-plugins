/**
 * dsh-my-skill-manager — rank-0 占位 provider（禁用机制的落点）。
 *
 * 注册进全局层，rank 0 低于所有 filesystem rank（100–500）与 runtime（250）：
 * 被禁用的 skill 名在合并目录里被占位覆盖，模型的 skill 列表里只剩「已禁用」
 * 占位，`get()` 返回 undefined（正文不加载）。
 *
 * `list({ cwd })` 按查看方会话的 cwd 解析项目配置，因此：
 *  - 全局禁用名单在所有项目生效；
 *  - 项目禁用名单只在该项目内生效（也可在项目内禁用全局 skill）。
 *
 * 保守设计：配置里没有出现的名字不产生候选，未改动时目录与原来逐字节一致。
 */
import { readDisabledLists } from './config-store.js'
import type { SkillCandidate, SkillLookupOptions, SkillProvider } from './types.js'

/** 占位 provider 名（catalog 据此识别被遮蔽的行）。 */
export const DISABLED_PROVIDER = 'my-skill-manager'

/** 低于所有 filesystem rank 与 runtime rank。 */
export const DISABLED_RANK = 0

/** 占位条目的 source 标签。 */
const DISABLED_SOURCE = 'disabled'

/** 占位条目的描述（宿主要求非空描述）。 */
const DISABLED_DESCRIPTION = '已禁用（dsh-my-skill-manager）——该 skill 在全局/项目启用配置中被禁用，模型不会加载它。'

/** 全局 + 项目（按 cwd 解析）禁用名单的并集。 */
export async function disabledNamesOf(cwd?: string): Promise<string[]> {
  const { globalDisabled, projectDisabled } = await readDisabledLists(cwd)
  return [...new Set([...globalDisabled, ...projectDisabled])]
}

/** 构造占位 provider（每次注册一个实例；配置在 list 时现读）。 */
export function createDisablerProvider(): SkillProvider {
  return {
    name: DISABLED_PROVIDER,
    async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
      const cwd = typeof options?.cwd === 'string' && options.cwd !== '' ? options.cwd : undefined
      const names = await disabledNamesOf(cwd)
      return names.map((name) => ({
        name,
        description: DISABLED_DESCRIPTION,
        invocation: { modelInvocable: false, userInvocable: false },
        source: DISABLED_SOURCE,
        provider: DISABLED_PROVIDER,
        rank: DISABLED_RANK,
      }))
    },
    async get() {
      return undefined // 禁用态：正文绝不加载
    },
  }
}
