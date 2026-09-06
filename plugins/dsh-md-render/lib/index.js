/**
 * dsh-md-render — host half.
 *
 * The plugin's rendering happens client-side (see lib/client.js); this host
 * half provides the application-level config surface (issue #84 配置化):
 *
 *  - 增强功能独立开关（默认开启）：copyButton / syntaxHighlight /
 *    languageLabel / lineNumbers / taskList / strikethrough / image /
 *    nestedList / mathStructures / tableSort / tableFold；
 *  - 设置页保存经 PUT /md/api/config（lib/routes.js）写入 profile patch
 *    文件（复用 dsh-shared 的配置持久化），重启不丢；
 *  - DSH 的 watchUserPatches 热重载 patch 文件，client 端重新 apply 后
 *    按新开关渲染（保存即生效，无需重启）。
 */
import { currentProfile, patchFileOf, writePatchConfig } from 'dsh-shared'
import { registerConfigRoutes, SWITCH_KEYS, SELECT_KEYS, SELECT_DEFAULTS } from './routes.js'

export const name = 'dsh-md-render'

export const inject = ['webServer']

export function apply(ctx, config) {
  // 应用层 config（cordis.patch.yml → ctx.config）优先；缺省/非法值保持默认。
  const options = buildOptions(config)

  // 配置保存：持久化到 profile patch 文件 + 更新内存。patch 文件写入完整
  // 配置（当前值 + 新值合并），重启后完整恢复；DSH 的 watchUserPatches 会
  // 热重载 patch 文件（保存即生效）。
  const onConfigChange = async (next) => {
    const merged = { ...options, ...next }
    await writePatchConfig(patchFileOf(currentProfile()), 'md-render', merged)
    Object.assign(options, next)
  }

  registerConfigRoutes(ctx, options, onConfigChange)
}

/**
 * 应用层配置 → options（开关默认开启、选择项默认值兜底；
 * 开关仅布尔值生效，选择项非法值回退默认）。
 */
export function buildOptions(config) {
  const c = config ?? {}
  const options = {}
  for (const key of SWITCH_KEYS) options[key] = c[key] !== false
  for (const [key, allowed] of Object.entries(SELECT_KEYS)) {
    options[key] = allowed.includes(c[key]) ? c[key] : SELECT_DEFAULTS[key]
  }
  return options
}
