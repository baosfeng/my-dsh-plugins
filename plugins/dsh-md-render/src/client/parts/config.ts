// ── 渲染配置：保留增强功能的开关状态 ────────────────────────────────
// 精简后只剩三个开关（默认全开）：
//  - copyButton：整段 markdown 复制按钮（官方只有代码块复制）；
//  - textFenceMarkdown：text / plaintext / txt 围栏块按 markdown 渲染；
//  - contextMarkdown：pre[data-context-text] 上下文注入块按 markdown 渲染。
// 表格 / 公式 / 代码块高亮等原开关已随自实现渲染一并下线（官方已内置），
// 迁移说明见 README「配置」与 CHANGELOG。
// client apply 默认全开，随后异步经 GET /md/api/config 拉取真实配置应用
// （client 端不能访问 ctx.config——Cordis inject 限制）；设置页保存后
// setRenderOptions 立即应用新开关，渲染管线读取模块级状态。

const DEFAULT_RENDER_OPTIONS: Record<string, boolean | string> = {
  copyButton: true,
  textFenceMarkdown: true,
  contextMarkdown: true,
}

let renderOptions: Record<string, boolean | string> = { ...DEFAULT_RENDER_OPTIONS }
function setRenderOptions(next?: Record<string, boolean | string>): void {
  renderOptions = { ...renderOptions, ...(next || {}) }
}

/** 从应用层配置提取显式配置值（仅接受布尔；缺失/非法值保持默认，不覆盖）。 */
function pickRenderOptions(config?: Record<string, unknown>): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {}
  const cfg = config ?? {}
  for (const key of Object.keys(DEFAULT_RENDER_OPTIONS)) {
    if (typeof cfg[key] === 'boolean') out[key] = cfg[key] as boolean
  }
  return out
}

/**
 * 异步从 server 端拉取配置并应用（初始化真实开关）。
 *
 * client 端 apply 不能访问 ctx.config（Cordis inject 限制：未 inject 声明
 * 的 property 访问抛 "cannot get property ... without inject"，导致插件
 * client 端 failed to apply loader entry）——真实配置经 server 端
 * GET /md/api/config 获取（与设置页同一数据源）。拉取失败保持默认全开，
 * 不阻塞渲染能力。
 */
function initConfigFromServer(): void {
  if (typeof fetch !== 'function') return
  fetch('/md/api/config')
    .then((res) => res.json())
    .then((body: { ok?: boolean; value?: Record<string, unknown> }) => {
      if (body === null || body.ok !== true || typeof body.value !== 'object' || body.value === null) return
      setRenderOptions(pickRenderOptions(body.value))
    })
    .catch(() => {
      // 服务不可用时保持默认（全部开启），不影响渲染。
    })
}

exports.setRenderOptions = setRenderOptions
exports.pickRenderOptions = pickRenderOptions
exports.initConfigFromServer = initConfigFromServer
exports.DEFAULT_RENDER_OPTIONS = DEFAULT_RENDER_OPTIONS
