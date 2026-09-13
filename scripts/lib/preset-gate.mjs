/**
 * preset-gate.mjs — agent preset 资产包形态判定与发版门禁豁免（issue #231）。
 *
 * `plugins/` 下并非只有 profile 插件，当前有三种被 release.mjs 处理的目录形态：
 *   1. profile 插件（bundle）：`dsh.bundle.patch` + `cordis.patch.yml`，经 `dsh plugin add` 装载；
 *   2. 共享工具包：`dsh.kind=library`（issue #45），npm 依赖，不挂 cordis service；
 *   3. **agent preset 资产包**：`agent.cordis.yml` + `preset.yml`（+ 自带 `skills/`），
 *      由 `scripts/install.mjs` 复制到 `$DSH_HOME/.agent-presets/<目录名>/`。
 *
 * 形态证据（宿主 `@deepseek-ai/dsh-agent-presets`，随 `@deepseek-ai/dsh` 安装）：
 *   - `lib/types/discovery.js`：`COMPOSITION_FILE = 'agent.cordis.yml'`（目录名即 preset id，
 *     组合文件缺失/不可解析的目录被标为 broken row）、`USER_PRESET_DIR = '.agent-presets'`
 *     （可写根）、`SHIPPED_PRESET_ROOT`（随包内置的 preset）；
 *   - `lib/types/metadata.js`：`METADATA_FILE = 'preset.yml'`，只承载显示元数据
 *     （name/description/order），由模式选择器读取；缺失或损坏不影响挂载。
 *
 * preset 资产包**不挂 profile**（无 `dsh.bundle`、无 `cordis.patch.yml`），组合文件里的
 * `cordis:group` 行与 `@deepseek-ai/dsh-*` 行都由宿主进程的 loader 解析，所以
 * release.mjs 1b 的「DSH 插件必须声明 peerDependencies.cordis」对它不适用——该检查的
 * 目的是保证 `dsh plugin add` 装出来的 bundle 能解析宿主 cordis。补 `peerDependencies.cordis`
 * 反而是错误的形态声明：它会让 `npm install` 的消费者以为这是个 cordis 插件包。
 *
 * 判据「可判定、可测试、不自欺」（对齐 issue #227 的三条硬约束）：
 *   1. 豁免只认显式声明 `dsh.kind === 'preset'`——**不写插件名单**；
 *   2. 必须带非空 `dsh.presetReason`（写明形态与理由，防止随手豁免）；
 *   3. 与 `dsh.bundle` / `dsh.client` **互斥**——那是 profile 插件形态，自相矛盾即拒绝豁免；
 *   4. 仓库不变量：声明 preset 的目录必须**真的有** `agent.cordis.yml` + `preset.yml`
 *      且内容成形（组合含插件行、元数据含非空 name）；反向不变量：目录里有 preset 资产
 *      却不声明 `dsh.kind=preset` 也拦下，并提示正确修复方式（而不是误报缺 cordis peer）。
 *
 * 豁免结果由 release.mjs 在发版输出与批量汇总中**显式列出**（含理由），不悄悄放行。
 */

/** 宿主 discovery 认定 preset 的组成文件（`@deepseek-ai/dsh-agent-presets` COMPOSITION_FILE）。 */
export const PRESET_COMPOSITION_FILE = 'agent.cordis.yml'
/** 宿主读取 preset 显示元数据的文件（`@deepseek-ai/dsh-agent-presets` METADATA_FILE）。 */
export const PRESET_METADATA_FILE = 'preset.yml'

/** 组合文件是否为插件行清单（含至少一个带值的 name 键）。 */
const hasPluginRow = (text) => /(^|\n)\s*(?:-\s*)?name:\s*\S/.test(text)
/** 显示元数据是否含非空 name（选择器显示名）。 */
const hasDisplayName = (text) => /(^|\n)\s*name:\s*\S/.test(text)

/**
 * 判定一个插件目录是否是**已正确声明**的 agent preset 资产包。
 *
 * 纯函数：文件读取由 `readAsset` 注入（文件不存在返回 null），便于单测覆盖每条判据与不变量。
 *
 * @param {{ pkg: object, readAsset: (file: string) => string|null }} input
 * @returns {{ status: 'declared'|'none'|'problem', reason: string, problem: string|null }}
 *   - `declared`：已声明且资产齐全 → 门禁豁免 peerDependencies.cordis 与 profile 组合验证；
 *   - `none`：与 preset 无关（未声明且无 preset 资产）→ 走常规插件门禁；
 *   - `problem`：形态声明不合法或与资产矛盾 → 门禁拒绝豁免并报出准确原因。
 */
export function resolvePresetAsset({ pkg, readAsset }) {
  const dsh = pkg?.dsh ?? {}
  const { kind } = dsh
  const composition = readAsset(PRESET_COMPOSITION_FILE)
  const metadata = readAsset(PRESET_METADATA_FILE)

  if (kind !== 'preset') {
    if (composition === null && metadata === null) return { status: 'none', reason: '', problem: null }
    const declared = kind === undefined ? '未声明 dsh.kind' : `dsh.kind=${JSON.stringify(kind)}`
    return {
      status: 'problem',
      reason: '',
      problem:
        `检测到 agent preset 资产（${PRESET_COMPOSITION_FILE} / ${PRESET_METADATA_FILE}）但 ${declared}——` +
        '这是 agent preset 资产包形态，必须显式声明 dsh.kind="preset" + 非空 dsh.presetReason；' +
        '否则门禁按 profile 插件校验，会误报缺少 peerDependencies.cordis（issue #231）',
    }
  }
  if (dsh.bundle !== undefined) {
    return {
      status: 'problem',
      reason: '',
      problem:
        'dsh.kind=preset 与 dsh.bundle 互斥：preset 资产包不是 profile bundle，没有 cordis.patch.yml，' +
        '不参与 dsh plugin add 装载',
    }
  }
  if (dsh.client !== undefined) {
    return {
      status: 'problem',
      reason: '',
      problem: 'dsh.kind=preset 与 dsh.client 互斥：preset 只提供 agent 组合与技能，不向浏览器注入 client 端',
    }
  }
  const presetReason = typeof dsh.presetReason === 'string' ? dsh.presetReason.trim() : ''
  if (presetReason === '') {
    return {
      status: 'problem',
      reason: '',
      problem:
        'dsh.kind=preset 必须同时声明非空 dsh.presetReason（写明这是什么 preset、为什么它是资产包而非 profile 插件，' +
        '防止随手豁免）',
    }
  }
  if (composition === null) {
    return {
      status: 'problem',
      reason: '',
      problem: `dsh.kind=preset 但缺少 ${PRESET_COMPOSITION_FILE}（宿主 discovery 以该文件认定 preset，目录名即 preset id）`,
    }
  }
  if (metadata === null) {
    return {
      status: 'problem',
      reason: '',
      problem: `dsh.kind=preset 但缺少 ${PRESET_METADATA_FILE}（宿主以该文件提供模式选择器的显示名与描述）`,
    }
  }
  if (!hasPluginRow(composition)) {
    return {
      status: 'problem',
      reason: '',
      problem: `${PRESET_COMPOSITION_FILE} 不含任何插件行（name），不是可挂载的 agent 组合，不能作为 preset 豁免依据`,
    }
  }
  if (!hasDisplayName(metadata)) {
    return {
      status: 'problem',
      reason: '',
      problem: `${PRESET_METADATA_FILE} 缺少非空 name（模式选择器显示名），不能作为 preset 豁免依据`,
    }
  }
  return {
    status: 'declared',
    reason: `agent preset 资产包（dsh.kind=preset：${presetReason}）`,
    problem: null,
  }
}
