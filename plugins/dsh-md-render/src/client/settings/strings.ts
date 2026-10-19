// ── 设置页文案（i18n）──────────────────────────────────────────────────
// 语言来源两级（都是浏览器全局）：宿主 locale（宿主把当前 UI 语言同步到 <html lang>）
// 优先，其次 navigator.language。文案全部是**惰性函数**：宿主切语言后重渲染即取到新语言，
// 写成常量就跟不上。
// 样式不在这里：新口径由 parts/styles-settings.ts 的 STYLES_SETTINGS 单一负责。
// 函数名带 mdRender 前缀：本文件是 part 片段，与其它片段共享 factory 作用域。

/** 宿主当前 UI 语言（读不到 / 未同步时返回空串）。 */
function mdRenderHostLang(): string {
  try {
    const lang = document.documentElement.lang
    return typeof lang === 'string' ? lang : ''
  } catch (_e) {
    return ''
  }
}

/** 浏览器语言（宿主 locale 不可用时的回退）。 */
function mdRenderBrowserLang(): string {
  try {
    return (navigator.language || 'en').toLowerCase()
  } catch (_e) {
    return 'en'
  }
}

/** 当前是否中文：宿主 <html lang> 优先，其次浏览器语言，再其次英文。 */
function mdRenderIsZh(): boolean {
  const host = mdRenderHostLang().toLowerCase()
  if (host.indexOf('zh') === 0) return true
  if (host.indexOf('en') === 0) return false
  return mdRenderBrowserLang().indexOf('zh') === 0
}

/** 中英二选一（惰性求值）。 */
function mdRenderText(zh: string, en: string): () => string {
  return () => (mdRenderIsZh() ? zh : en)
}

/** 设置页文案表（全部惰性）。 */
const MD_RENDER_STRINGS = {
  tab: mdRenderText('渲染', 'Rendering'),
  packageName: 'dsh-md-render',
  headTitle: mdRenderText('渲染', 'Rendering'),
  headSub: mdRenderText(
    '接管对话内围栏块：代码高亮、mermaid 图表卡片、思考块默认展开、整段复制。',
    'Takes over fenced blocks in conversations: syntax highlighting, mermaid diagram cards, expanded thinking and whole-message copy.',
  ),
  enabled: mdRenderText('已启用', 'Enabled'),
  tabRender: mdRenderText('渲染', 'Rendering'),
  tabAbout: mdRenderText('关于', 'About'),
  tabHint: mdRenderText(
    '修改即时生效 · 已打开的消息重新挂载后生效',
    'Changes apply immediately · already-open messages pick them up on remount',
  ),
  groupMarkdown: mdRenderText('Markdown', 'Markdown'),
  groupThinking: mdRenderText('思考块', 'Thinking'),
  groupMermaid: mdRenderText('Mermaid 图表', 'Mermaid diagrams'),
  count3: mdRenderText('3 项', '3 items'),
  count2: mdRenderText('2 项', '2 items'),
  count1: mdRenderText('1 项', '1 item'),
  injected: mdRenderText('宿主注入', 'Host-injected'),
  copyTitle: mdRenderText('复制按钮', 'Copy button'),
  copyDesc: mdRenderText(
    '代码块右上角显示复制按钮，默认隐藏、悬停浮现；键盘聚焦时同样可见。',
    'A copy button on the top-right of code blocks; hidden until hover or keyboard focus.',
  ),
  fenceTitle: mdRenderText('围栏块渲染总开关', 'Render fenced blocks'),
  fenceDesc: mdRenderText(
    '关闭后所有围栏块保持宿主官方形态，仅保留 markdown 正文渲染。',
    'When off, every fenced block keeps the host look; only markdown body rendering stays on.',
  ),
  contextTitle: mdRenderText('上下文注入块', 'Context-injection blocks'),
  contextDesc: mdRenderText(
    '子代理回传的消息按 markdown 渲染，并标注「上下文注入」来源。',
    'Sub-agent messages are rendered as markdown and labelled as context injection.',
  ),
  thinkTitle: mdRenderText('默认展开', 'Expand by default'),
  thinkDesc: mdRenderText(
    '思考块加载后默认展开，可手动折叠；关闭后默认收起，只显示标题与耗时。',
    'Thinking blocks start expanded and can be collapsed; when off they start collapsed with only the title and timing.',
  ),
  mermaidTitle: mdRenderText('渲染为图表卡片', 'Render as diagram cards'),
  mermaidDesc: mdRenderText(
    'mermaid 围栏块渲染为卡片：预览 / 代码切换、缩放、全屏、导出 PNG 与 SVG。',
    'mermaid fences become cards: preview / code toggle, zoom, fullscreen, PNG and SVG export.',
  ),
  injectTitle: mdRenderText('注入 mermaid 能力说明', 'Inject the mermaid capability note'),
  injectDesc: mdRenderText(
    '默认开启；关闭后已有代码块照常渲染，只是不再主动引导模型画图。',
    'On by default; when off, existing blocks still render — the model is just no longer nudged.',
  ),
  noteMermaid: mdRenderText(
    '图表由宿主注入的 mermaid 运行时渲染，插件只负责围栏块接管与卡片外壳；宿主未提供运行时时自动回退到源码视图，不阻塞对话。',
    'Diagrams are rendered by the host-provided mermaid runtime; the plugin only owns fence takeover and the card shell, and falls back to the source view when the runtime is missing.',
  ),
  noteMermaidStrong: mdRenderText('注入能力说明：', 'Injection note:'),
  save: mdRenderText('保存', 'Save'),
  reset: mdRenderText('恢复默认', 'Restore defaults'),
  saved: mdRenderText('已保存', 'Saved'),
  saveFailed: mdRenderText('保存失败', 'Save failed'),
  footHint: mdRenderText(
    '配置保存在插件设置中，随工作区同步',
    'Saved in plugin settings and synced with the workspace',
  ),
  loading: mdRenderText('加载中…', 'Loading…'),
  loadFailed: mdRenderText('配置加载失败', 'Failed to load config'),
  retry: mdRenderText('重试', 'Retry'),
  errorMissingRoute: mdRenderText(
    '服务端插件未加载：/md-render/api 路由不存在（确认已安装并启用 dsh-md-render 后重启 DSH，HTTP 404）',
    'Host half not loaded: the /md-render/api route is missing (install and enable dsh-md-render, then restart DSH — HTTP 404)',
  ),
  errorForbidden: mdRenderText(
    '请求被安全围栏拒绝（403）：请检查网络/代理设置',
    'Blocked by the trust fence (403): check your network/proxy settings',
  ),
  errorNetwork: mdRenderText(
    '网络错误或响应异常：请检查 DSH 服务是否正常运行',
    'Network error or bad response: check that the DSH server is running',
  ),
  groupAbout: mdRenderText('关于 dsh-md-render', 'About dsh-md-render'),
  versionTitle: mdRenderText('版本', 'Version'),
  versionDesc: mdRenderText(
    '随已安装的 npm 包发布，版本号以 package.json 为准。',
    'Shipped with the installed npm package; the version lives in package.json.',
  ),
  slotsTitle: mdRenderText('扩展点', 'Extension points'),
  slotsDesc: mdRenderText(
    'ctx.slots 设置页签 · 围栏块接管 · 不注册节点级 seat、不使用右侧栏页签。',
    'ctx.slots settings tab · fence takeover · no node-level seats and no right-sidebar tabs.',
  ),
  depsTitle: mdRenderText('依赖', 'Dependencies'),
  depsDesc: mdRenderText(
    'marked / highlight.js / panzoom 走 assets 懒加载；mermaid 由宿主运行时提供，均不打包。',
    'marked / highlight.js / panzoom load lazily from assets; mermaid comes from the host runtime — none are bundled.',
  ),
  docsTitle: mdRenderText('文档', 'Docs'),
  docsDesc: mdRenderText(
    'docs/md渲染/概述.md · docs/原型重构/brief-md-render.md',
    'docs/md渲染/概述.md · docs/原型重构/brief-md-render.md',
  ),
  viewDocs: mdRenderText('查看文档', 'Open docs'),
}
