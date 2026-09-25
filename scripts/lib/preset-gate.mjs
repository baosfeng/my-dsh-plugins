/**
 * preset-gate.mjs — agent preset 声明包形态判定与发版门禁豁免（issue #231；0.1.7 形态迁移）。
 *
 * **形态变更**：宿主 0.1.7-rc.2 移除了「preset 目录资产」机制。`$DSH_HOME/.agent-presets/
 * <id>/` 下的 `agent.cordis.yml` + `preset.yml` 已无任何读取者——旧侧常量在
 * `@deepseek-ai/dsh-agent-presets` 的 `lib/types/discovery.js`（`COMPOSITION_FILE`）与
 * `lib/types/metadata.js`（`METADATA_FILE`），而 0.1.7-rc.2 全树不含该包与该目录名，
 * 宿主自带的迁移文档亦明写 "Nothing reads that directory any more."
 *
 * preset 现在**是一行 `@deepseek-ai/dsh-agent-preset` 声明，由 bundle 的
 * `cordis.patch.yml` 承载**（形态证据：`packages/preset/agent-preset/src/index.ts` 的
 * `Config` schema 与 `ctx.agentPresets.register()`；官方 Web preset 位于
 * `@deepseek-ai/dsh-web-app` bundle 的 `presets/<id>.patch.yml`）：
 *   - 声明行 `config`：`id`（必填）/ `plugins`（必填）/ 可选 `name`、`description`、`order`；
 *   - Loader 行 id 约定 `preset-<id>`；
 *   - 装载走 `plugin_manager` 的 `install_bundle`——`installBundle` 会拒绝未声明
 *     `dsh.bundle` 的包，所以 preset 声明包**必须有 patch 载体**。
 *
 * 判据「可判定、可测试、不自欺」（对齐 issue #227 的三条硬约束）：
 *   1. 豁免只认显式声明 `dsh.kind === 'preset'`——**不写插件名单**；
 *   2. 必须带非空 `dsh.presetReason`（写明形态与理由，防止随手豁免）；
 *   3. `dsh.kind=preset` **必须**声明 `dsh.bundle.patch`，且该 patch 里真的有一行
 *      `@deepseek-ai/dsh-agent-preset` 声明（含非空 `id` 与 `plugins` 列表）——
 *      0.1.7 的 preset 只能由 bundle 承载，没有载体就不会被宿主发现；
 *   4. 与 `dsh.client` **互斥**——preset 只提供 agent 组合与技能，不向浏览器注入；
 *   5. 反向不变量：patch 里有声明行却不声明 `dsh.kind=preset` 也拦下，并提示正确修复
 *      方式（而不是误报缺 cordis peer）。
 *
 * 豁免结果由 release.mjs 在发版输出与批量汇总中**显式列出**（含理由），不悄悄放行。
 *
 * **保留豁免的两个理由**（豁免本体仍由 release.mjs 施加）：本包目录内只有 YAML 与
 * 文档、**无 JS 代码、不 import cordis、不挂 cordis service**，故不声明
 * `peerDependencies.cordis`；真实 profile 装载验证需要宿主 ≥ 0.1.7 提供
 * `@deepseek-ai/dsh-agent-preset`（当前宿主 0.1.5-rc.1 不提供，声明行无法激活），
 * 所以在宿主升级前该项无法通过。
 */

/** 承载 preset 声明行的 bundle patch 默认文件名（`dsh.bundle.patch` 未声明时的探测目标）。 */
export const PRESET_PATCH_FILE = 'cordis.patch.yml'
/** 承载 preset 声明的宿主插件包名（`config` schema 见 `packages/preset/agent-preset/src/index.ts`）。 */
export const PRESET_DECLARATION_PLUGIN = '@deepseek-ai/dsh-agent-preset'

/** patch 是否含一行 `@deepseek-ai/dsh-agent-preset` 声明（YAML 行首 `name:`）。 */
const hasDeclarationRow = (text) =>
  /(^|\n)\s*(?:-\s*)?name:\s*['"]?@deepseek-ai\/dsh-agent-preset['"]?[ \t]*(\n|$)/.test(text)
/** 声明行是否带非空 preset id（config.id，Loader 行 id 为 `preset-<id>`）。 */
const hasPresetId = (text) => /(^|\n)\s*id:\s*['"]?[a-z0-9][a-z0-9-]*['"]?[ \t]*(\n|$)/.test(text)
/** 声明行是否带 plugins 列表（preset 的插件行）。 */
const hasPluginsList = (text) => /(^|\n)\s*plugins:\s*(\n|$)/.test(text)

/** `dsh.bundle.patch` 归一化为字符串数组（可以是单文件，也可以是官方 bundle 那样的列表）。 */
const declaredPatches = (dsh) => {
  const patch = dsh?.bundle?.patch
  if (typeof patch === 'string') return [patch]
  if (Array.isArray(patch)) return patch.filter((file) => typeof file === 'string')
  return []
}

/**
 * 判定一个插件目录是否是**已正确声明**的 agent preset 声明包。
 *
 * 纯函数：文件读取由 `readAsset` 注入（文件不存在返回 null），便于单测覆盖每条判据与不变量。
 *
 * @param {{ pkg: object, readAsset: (file: string) => string|null }} input
 * @returns {{ status: 'declared'|'none'|'problem', reason: string, problem: string|null }}
 *   - `declared`：已声明且 patch 载体与声明行齐全 → 门禁豁免 cordis peer 与 profile 组合验证；
 *   - `none`：与 preset 无关（未声明且 patch 里无声明行）→ 走常规插件门禁；
 *   - `problem`：形态声明不合法或与载体矛盾 → 门禁拒绝豁免并报出准确原因。
 */
export function resolvePresetAsset({ pkg, readAsset }) {
  const dsh = pkg?.dsh ?? {}
  const { kind } = dsh
  const declared = declaredPatches(dsh)
  // 显式声明的 patch 优先；未声明 bundle 时回落到默认文件名，这样「patch 里有声明行
  // 却忘了 kind=preset」也能被反向不变量拦下，而不是静默走常规门禁。
  const candidates = declared.length > 0 ? declared : [PRESET_PATCH_FILE]
  const found = candidates
    .map((file) => [file, readAsset(file)])
    .find(([, text]) => text !== null && hasDeclarationRow(text))
  const declarationFile = found?.[0] ?? null
  const declaration = found?.[1] ?? null

  if (kind !== 'preset') {
    if (declaration === null) return { status: 'none', reason: '', problem: null }
    const label = kind === undefined ? '未声明 dsh.kind' : `dsh.kind=${JSON.stringify(kind)}`
    return {
      status: 'problem',
      reason: '',
      problem:
        `${declarationFile} 声明了 ${PRESET_DECLARATION_PLUGIN} 行（agent preset 形态）但 ${label}——` +
        '这是 agent preset 声明包形态，必须显式声明 dsh.kind="preset" + 非空 dsh.presetReason；' +
        '否则门禁按 profile 插件校验，会误报缺少 peerDependencies.cordis（issue #231）',
    }
  }
  if (dsh.client !== undefined) {
    return {
      status: 'problem',
      reason: '',
      problem: 'dsh.kind=preset 与 dsh.client 互斥：preset 只提供 agent 组合与技能，不向浏览器注入 client 端',
    }
  }
  if (declared.length === 0) {
    return {
      status: 'problem',
      reason: '',
      problem:
        'dsh.kind=preset 必须声明 dsh.bundle.patch（0.1.7 的 preset 是 bundle patch 承载的 ' +
        `${PRESET_DECLARATION_PLUGIN} 声明行，没有 patch 载体宿主不会发现它）`,
    }
  }
  const presetReason = typeof dsh.presetReason === 'string' ? dsh.presetReason.trim() : ''
  if (presetReason === '') {
    return {
      status: 'problem',
      reason: '',
      problem:
        'dsh.kind=preset 必须同时声明非空 dsh.presetReason（写明这是什么 preset、为什么它以此形态分发，' +
        '防止随手豁免）',
    }
  }
  if (declaration === null) {
    return {
      status: 'problem',
      reason: '',
      problem: `dsh.kind=preset 但 ${declared.join('、')} 里没有 ${PRESET_DECLARATION_PLUGIN} 声明行（宿主靠该行注册 preset）`,
    }
  }
  if (!hasPresetId(declaration)) {
    return {
      status: 'problem',
      reason: '',
      problem: `${declarationFile} 的声明行缺少非空 config.id（preset 身份；Loader 行 id 约定为 preset-<id>）`,
    }
  }
  if (!hasPluginsList(declaration)) {
    return {
      status: 'problem',
      reason: '',
      problem: `${declarationFile} 的声明行缺少 plugins 列表（插件行为空的 preset 不可挂载）`,
    }
  }
  return {
    status: 'declared',
    reason: `agent preset 声明包（dsh.kind=preset：${presetReason}）`,
    problem: null,
  }
}
