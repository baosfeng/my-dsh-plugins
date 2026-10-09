/**
 * dsh-md-render — 应用层配置语义（issue #463 合并 think-zh-expand + mermaid-render）。
 *
 * 配置按能力命名空间化为三段（`markdown` / `thinking` / `mermaid`）：
 *
 *   markdown.copyButton / textFenceMarkdown / contextMarkdown   默认开（\`!== false\`）
 *   thinking.defaultExpanded                                    默认开（严格布尔，回退 true）
 *   mermaid.injectPrompt / render                               默认开（仅显式 false 关）
 *
 * **旧扁平键读兼容（必须）**：合并前 dsh-md-render 把开关写在 patch 行的**顶层**
 * （\`copyButton\` 等），用户 profile 里已经落盘；本模块读时把顶层旧键映射进
 * \`markdown.*\`，写时一律新结构。
 *
 * **写入必须合并行内已有键**：dsh-shared 的 writePatchConfig 语义是「删掉旧条目 →
 * 追加新条目」，不合并行内已有键 —— 直接写会把用户手写的其它 config 键抹掉。
 * persistConfig 因此先 extractConfig 取回行内现有 config 再展开写入（防回归测试见
 * test/legacy-config.mjs）。
 *
 * 本文件编译为 lib/config.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { readFile } from 'node:fs/promises'

import { currentProfile, extractConfig, patchFileOf, writePatchConfig } from 'dsh-shared'

/**
 * 配置行 id：与 cordis.patch.yml 的插件行 id 一致（不是包名、不是插件名前缀）。
 * 仅本模块的 persistConfig 使用——对外契约由测试用字面量钉住。
 */
const CONFIG_ROW_ID = 'md-render'

/** 合并后的生效配置。 */
export interface MdRenderConfig {
  markdown: { copyButton: boolean; textFenceMarkdown: boolean; contextMarkdown: boolean }
  thinking: { defaultExpanded: boolean }
  mermaid: { injectPrompt: boolean; render: boolean }
}

/** markdown 段开关键（默认开：仅显式 false 关闭）。 */
const MARKDOWN_SWITCH_KEYS = ['copyButton', 'textFenceMarkdown', 'contextMarkdown'] as const
/** mermaid 段开关键（默认开：仅显式 false 关闭）。 */
const MERMAID_SWITCH_KEYS = ['injectPrompt', 'render'] as const

/** 三段默认值（缺失 / 非法值一律回退到这里）。 */
const DEFAULT_CONFIG: MdRenderConfig = {
  markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
  thinking: { defaultExpanded: true },
  mermaid: { injectPrompt: true, render: true },
}

/** 只认对象（null / 数组 / 标量 → undefined）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 默认开：仅显式 false 关闭（缺失 / 非法值按开）。 */
function defaultOn(value: unknown): boolean {
  return value !== false
}

/** 默认开但严格布尔（thinking.defaultExpanded：只有布尔值生效）。 */
function strictBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * markdown 段：新结构优先，**旧扁平键读兼容**（旧键只在 markdown 段缺失该键时生效）。
 * 旧键来自合并前的 md-render（用户 profile 已落盘），不能丢。
 */
function readMarkdown(raw: Record<string, unknown>, legacy: Record<string, unknown>): MdRenderConfig['markdown'] {
  const nested = asRecord(raw.markdown)
  const out = { ...DEFAULT_CONFIG.markdown }
  for (const key of MARKDOWN_SWITCH_KEYS) {
    const value = nested !== undefined && nested[key] !== undefined ? nested[key] : legacy[key]
    out[key] = defaultOn(value)
  }
  return out
}

/** thinking 段（旧扁平键 `defaultExpanded` 读兼容）。 */
function readThinking(raw: Record<string, unknown>, legacy: Record<string, unknown>): MdRenderConfig['thinking'] {
  const nested = asRecord(raw.thinking)
  const value =
    nested !== undefined && nested.defaultExpanded !== undefined ? nested.defaultExpanded : legacy.defaultExpanded
  return { defaultExpanded: strictBool(value, DEFAULT_CONFIG.thinking.defaultExpanded) }
}

/** mermaid 段（旧扁平键 `injectPrompt` 读兼容；`render` 为合并后新增开关）。 */
function readMermaid(raw: Record<string, unknown>, legacy: Record<string, unknown>): MdRenderConfig['mermaid'] {
  const nested = asRecord(raw.mermaid)
  const out = { ...DEFAULT_CONFIG.mermaid }
  for (const key of MERMAID_SWITCH_KEYS) {
    const value = nested !== undefined && nested[key] !== undefined ? nested[key] : legacy[key]
    out[key] = defaultOn(value)
  }
  return out
}

/** 应用层 config（patch 行的 config，任意结构）→ 生效配置（含旧扁平键兼容）。 */
export function createConfigState(config?: unknown): MdRenderConfig {
  const raw = asRecord(config) ?? {}
  return {
    markdown: readMarkdown(raw, raw),
    thinking: readThinking(raw, raw),
    mermaid: readMermaid(raw, raw),
  }
}

/** 单段的部分更新（PUT 只带变更键时其余键保持原值）。 */
type SectionPatch<T> = { [K in keyof T]?: T[K] }

/** 请求体归一化结果（三段都是部分更新；非法结构返回 undefined → 调用方回 400）。 */
export interface ConfigPatch {
  markdown?: SectionPatch<MdRenderConfig['markdown']>
  thinking?: SectionPatch<MdRenderConfig['thinking']>
  mermaid?: SectionPatch<MdRenderConfig['mermaid']>
}

/** 取一段的更新：段内布尔键逐个校验，非法（非布尔）返回 null。 */
function readSection<T extends Record<string, boolean>>(
  value: unknown,
  keys: readonly string[],
): SectionPatch<T> | null | undefined {
  if (value === undefined) return undefined
  const obj = asRecord(value)
  if (obj === undefined) return null
  const out: Record<string, boolean> = {}
  for (const key of keys) {
    if (obj[key] === undefined) continue
    if (typeof obj[key] !== 'boolean') return null
    out[key] = obj[key] as boolean
  }
  return out as SectionPatch<T>
}

/** thinking 段：严格布尔（与另两段的 `!== false` 语义不同）。 */
function readThinkingSection(value: unknown): SectionPatch<MdRenderConfig['thinking']> | null | undefined {
  if (value === undefined) return undefined
  const obj = asRecord(value)
  if (obj === undefined) return null
  if (obj.defaultExpanded === undefined) return {}
  if (typeof obj.defaultExpanded !== 'boolean') return null
  return { defaultExpanded: obj.defaultExpanded }
}

/** 旧扁平键 → 新结构（PUT 兼容：老客户端 / 用户手写 patch 行仍可能发扁平键）。 */
function legacyPatch(payload: Record<string, unknown>): ConfigPatch {
  const pick = <T extends Record<string, boolean>>(keys: readonly string[]) =>
    Object.fromEntries(keys.filter((k) => payload[k] !== undefined).map((k) => [k, payload[k]]))
  const patch: ConfigPatch = {}
  const markdown = readSection<MdRenderConfig['markdown']>(pick(MARKDOWN_SWITCH_KEYS), MARKDOWN_SWITCH_KEYS)
  if (markdown !== null && markdown !== undefined && Object.keys(markdown).length > 0) patch.markdown = markdown
  const thinking = readThinkingSection({ defaultExpanded: payload.defaultExpanded })
  if (thinking !== null && thinking !== undefined && Object.keys(thinking).length > 0) patch.thinking = thinking
  const mermaid = readSection<MdRenderConfig['mermaid']>(pick(['injectPrompt']), ['injectPrompt'])
  if (mermaid !== null && mermaid !== undefined && Object.keys(mermaid).length > 0) patch.mermaid = mermaid
  return patch
}

export function normalizeConfigPayload(payload: unknown): ConfigPatch | undefined {
  const obj = asRecord(payload)
  if (obj === undefined) return undefined
  const markdown = readSection<MdRenderConfig['markdown']>(obj.markdown, MARKDOWN_SWITCH_KEYS)
  const thinking = readThinkingSection(obj.thinking)
  const mermaid = readSection<MdRenderConfig['mermaid']>(obj.mermaid, MERMAID_SWITCH_KEYS)
  if (markdown === null || thinking === null || mermaid === null) return undefined
  return mergeSections(legacyPatch(obj), buildPatch(markdown, thinking, mermaid))
}

/** 把三个段的部分更新组装成 patch（空段丢弃）。 */
function buildPatch(
  markdown: SectionPatch<MdRenderConfig['markdown']> | undefined,
  thinking: SectionPatch<MdRenderConfig['thinking']> | undefined,
  mermaid: SectionPatch<MdRenderConfig['mermaid']> | undefined,
): ConfigPatch {
  const patch: ConfigPatch = {}
  if (markdown !== undefined && Object.keys(markdown).length > 0) patch.markdown = markdown
  if (thinking !== undefined && Object.keys(thinking).length > 0) patch.thinking = thinking
  if (mermaid !== undefined && Object.keys(mermaid).length > 0) patch.mermaid = mermaid
  return patch
}

/** 合并两批段更新并**丢掉空段**（空段不参与写入，避免把默认值当变更存盘）。 */
function mergeSections(base: ConfigPatch, patch: ConfigPatch): ConfigPatch {
  const out: ConfigPatch = {}
  const markdown = { ...base.markdown, ...patch.markdown }
  const thinking = { ...base.thinking, ...patch.thinking }
  const mermaid = { ...base.mermaid, ...patch.mermaid }
  if (Object.keys(markdown).length > 0) out.markdown = markdown
  if (Object.keys(thinking).length > 0) out.thinking = thinking
  if (Object.keys(mermaid).length > 0) out.mermaid = mermaid
  return out
}

/** 把部分更新合并进当前生效配置（内存态，写盘前调用）。 */
export function mergeConfig(current: MdRenderConfig, patch: ConfigPatch): MdRenderConfig {
  return {
    markdown: { ...current.markdown, ...patch.markdown },
    thinking: { ...current.thinking, ...patch.thinking },
    mermaid: { ...current.mermaid, ...patch.mermaid },
  }
}

/**
 * 写回 profile patch 文件（原子写）：**先合并行内已有 config 键**再展开写入。
 * dsh-shared 的 writePatchConfig 是「删旧条目 → 追加新条目」语义，不合并行内已有键；
 * 不先 extractConfig 就会把用户手写的键（以及本插件以外的配置）一并抹掉。
 * 失败向上抛，调用方据此回错误码且不动内存。
 */
export async function persistConfig(next: MdRenderConfig): Promise<void> {
  const file = patchFileOf(currentProfile())
  const merged = { ...(await readExistingConfig(file)), ...next }
  await writePatchConfig(file, CONFIG_ROW_ID, merged)
}

/** 读回 patch 行内已有的 config 键（文件不存在 / 无该行 → {}）。 */
async function readExistingConfig(file: string): Promise<Record<string, unknown>> {
  try {
    return asRecord(extractConfig(await readFile(file, 'utf8'), CONFIG_ROW_ID)) ?? {}
  } catch {
    return {}
  }
}
