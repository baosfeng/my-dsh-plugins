// ── 渲染配置：三段命名空间化开关（markdown / thinking / mermaid）─────────
// 与 host 半 lib/config.js 的 schema 一一对应（同一份默认值语义）：
//  - markdown.copyButton / textFenceMarkdown / contextMarkdown  默认开（!== false）
//  - thinking.defaultExpanded                                  默认开（严格布尔）
//  - mermaid.injectPrompt / render                             默认开（仅显式 false 关）
// **旧扁平键读兼容（必须）**：合并前 dsh-md-render 把开关写在顶层，用户 profile
// 已落盘；readConfig 读时把顶层旧键映射进对应段（与 host 半同款规则）。
// client apply 默认全开，随后异步经 GET /md-render/api/config 拉取真实配置应用
// （client 端不能访问 ctx.config——Cordis inject 限制）；设置页保存后
// setRenderOptions 立即应用新开关，渲染管线读取模块级状态。

// 配置 API URL（`CONFIG_API_URL`）与引擎 URL（`MERMAID_ENGINE_URL`）由构建期
// 从 host 半 src/routes/paths.ts 注入（见 lib/client.src.js 的 __ROUTE_PATHS__ 占位符
// 与 scripts/build.mjs）—— 本文件不再各写一份字面量，避免两侧漂移。

/** 三段默认值（缺失 / 非法值一律回退到这里）。 */
const DEFAULT_RENDER_OPTIONS = {
  markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
  thinking: { defaultExpanded: true },
  mermaid: { injectPrompt: true, render: true },
}

type RenderOptions = typeof DEFAULT_RENDER_OPTIONS

/** 生效配置（模块级；渲染管线直接读，不订阅）。 */
let renderOptions: RenderOptions = cloneDefaults()

function cloneDefaults(): RenderOptions {
  return {
    markdown: { ...DEFAULT_RENDER_OPTIONS.markdown },
    thinking: { ...DEFAULT_RENDER_OPTIONS.thinking },
    mermaid: { ...DEFAULT_RENDER_OPTIONS.mermaid },
  }
}

/** 对象化（null / 数组 / 标量 → {}）。 */
function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** 取子对象（非对象 → {}）。 */
function sectionOf(raw: Record<string, unknown>, name: string): Record<string, unknown> {
  return asObject(raw[name])
}

/** 段内布尔键：新结构优先，旧扁平键兜底（旧键只在段内未显式给出该键时生效）。 */
function pickSection<T extends Record<string, boolean>>(
  current: T,
  nested: Record<string, unknown>,
  legacy: Record<string, unknown>,
  legacyKeys: readonly string[],
): T {
  const out: Record<string, boolean> = { ...current }
  for (const key of Object.keys(current)) {
    const value = nested[key] !== undefined ? nested[key] : legacyKeys.includes(key) ? legacy[key] : undefined
    if (typeof value === 'boolean') out[key] = value
  }
  return out as T
}

/** thinking.defaultExpanded：严格布尔（缺失 / 非布尔保持当前值）。 */
function pickThinking(current: RenderOptions['thinking'], raw: Record<string, unknown>): RenderOptions['thinking'] {
  const nested = sectionOf(raw, 'thinking')
  const value = nested.defaultExpanded !== undefined ? nested.defaultExpanded : raw.defaultExpanded
  if (typeof value !== 'boolean') return { ...current }
  return { defaultExpanded: value }
}

/** 应用层配置 → 与**当前值**合并后的生效配置（局部更新语义：未给出的键不变）。 */
function readConfig(raw: unknown): RenderOptions {
  const obj = asObject(raw)
  return {
    markdown: pickSection(renderOptions.markdown, sectionOf(obj, 'markdown'), obj, [
      'copyButton',
      'textFenceMarkdown',
      'contextMarkdown',
    ]),
    thinking: pickThinking(renderOptions.thinking, obj),
    mermaid: pickSection(renderOptions.mermaid, sectionOf(obj, 'mermaid'), obj, ['injectPrompt']),
  }
}

/** 应用配置（局部合并；设置页保存后立即生效，不等 patch 热重载）。 */
function setRenderOptions(next?: unknown): void {
  renderOptions = readConfig(next)
}

/**
 * 异步从 server 端拉取配置并应用（初始化真实开关）。
 *
 * client 端 apply 不能访问 ctx.config（Cordis inject 限制：未 inject 声明的
 * property 访问抛 "cannot get property ... without inject"，导致插件 client 端
 * failed to apply loader entry）——真实配置经 server 端 GET /md-render/api/config
 * 获取（与设置页同一数据源）。拉取失败保持默认全开，不阻塞渲染能力。
 */
function initConfigFromServer(): void {
  if (typeof fetch !== 'function') return
  fetch(CONFIG_API_URL)
    .then((res) => res.json())
    .then((body: { ok?: boolean; value?: unknown }) => {
      if (body === null || body.ok !== true || typeof body.value !== 'object' || body.value === null) return
      setRenderOptions(body.value)
    })
    .catch(() => {
      // 服务不可用时保持默认（全部开启），不影响渲染。
    })
}

exports.CONFIG_API_URL = CONFIG_API_URL
exports.setRenderOptions = setRenderOptions
exports.readConfig = readConfig
exports.initConfigFromServer = initConfigFromServer
exports.DEFAULT_RENDER_OPTIONS = DEFAULT_RENDER_OPTIONS
