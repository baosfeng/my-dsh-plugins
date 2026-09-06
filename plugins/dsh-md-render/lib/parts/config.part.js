// ── 渲染配置（issue #84 配置化）：增强功能开关状态 ─────────────────
// 各增强功能独立开关（默认全部开启）：copyButton / syntaxHighlight /
// languageLabel / lineNumbers / taskList / strikethrough / image /
// nestedList / mathStructures / tableSort / tableFold。client apply 默认
// 全开，随后异步经 GET /md/api/config 拉取真实配置应用（client 端不能
// 访问 ctx.config——Cordis inject 限制）；设置页保存后 setRenderOptions
// 立即应用新开关，渲染管线（代码块 / 行内 / DOM 表格）读取模块级状态。
// issue #146：选择型配置（非布尔）加入同一 options 状态——
// copyButtonPosition（代码块复制按钮位置，默认 bottom-right 与 #74
// 原始诉求一致）与 codeTheme（代码块主题，默认 bright 明亮高对比）。

/** 代码块复制按钮位置（issue #146）：header=头部右上角 | bottom-right=右下角。 */
const COPY_BUTTON_POSITIONS = ['header', 'bottom-right']

/** 代码块主题 id 列表（issue #146）：色板定义见 styles.part.js。 */
const CODE_THEMES = ['bright', 'github-light', 'github-dark', 'one-dark', 'nord']

const DEFAULT_RENDER_OPTIONS = {
  copyButton: true,
  syntaxHighlight: true,
  languageLabel: true,
  lineNumbers: true,
  taskList: true,
  strikethrough: true,
  image: true,
  nestedList: true,
  mathStructures: true,
  tableSort: true,
  tableFold: true,
  copyButtonPosition: COPY_BUTTON_POSITIONS[1],
  codeTheme: CODE_THEMES[0],
}

let renderOptions = { ...DEFAULT_RENDER_OPTIONS }
function setRenderOptions(next) {
  renderOptions = { ...renderOptions, ...(next || {}) }
}

/** 从应用层配置提取显式配置值（布尔开关仅接受布尔，选择项仅接受合法枚举；缺失/非法值保持默认，不覆盖）。 */
function pickRenderOptions(config) {
  const out = {}
  const cfg = config ?? {}
  for (const key of Object.keys(DEFAULT_RENDER_OPTIONS)) {
    if (typeof cfg[key] === 'boolean') out[key] = cfg[key]
  }
  if (COPY_BUTTON_POSITIONS.includes(cfg.copyButtonPosition)) out.copyButtonPosition = cfg.copyButtonPosition
  if (CODE_THEMES.includes(cfg.codeTheme)) out.codeTheme = cfg.codeTheme
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
function initConfigFromServer() {
  if (typeof fetch !== 'function') return
  fetch('/md/api/config')
    .then((res) => res.json())
    .then((body) => {
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
exports.COPY_BUTTON_POSITIONS = COPY_BUTTON_POSITIONS
exports.CODE_THEMES = CODE_THEMES
