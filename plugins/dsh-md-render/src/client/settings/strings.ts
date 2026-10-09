// ── 设置页文案（i18n）+ 样式 ───────────────────────────────────────────
// 语言来源两级（都是浏览器全局）：宿主 locale（dsh-client-locale 把当前 UI 语言同步到
// <html lang>）优先，其次 navigator.language。只看 navigator.language 会停在浏览器
// 语言、与宿主 UI 语言不一致（浏览器英文 + 宿主中文时最明显）。
// 文案全部是**惰性函数**：宿主切语言后重渲染即取到新语言，写成常量就跟不上。
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
  if (host.startsWith('zh')) return true
  if (host.startsWith('en')) return false
  return mdRenderBrowserLang().startsWith('zh')
}

/** 中英二选一（惰性求值）。 */
function mdRenderText(zh: string, en: string): () => string {
  return () => (mdRenderIsZh() ? zh : en)
}

/** 设置页文案表（全部惰性）。 */
const MD_RENDER_STRINGS = {
  tab: mdRenderText('渲染', 'Rendering'),
  groupMarkdown: mdRenderText('Markdown 增强', 'Markdown enhancements'),
  groupThinking: mdRenderText('思考块', 'Thinking'),
  groupMermaid: mdRenderText('Mermaid 图表', 'Mermaid diagrams'),
  copyButtonLabel: mdRenderText('整段复制', 'Copy whole message'),
  copyButtonHint: mdRenderText(
    'MarkdownView 整段内容一键复制（官方只有代码块复制）',
    'One-click copy for the whole MarkdownView (the host only copies code blocks)',
  ),
  textFenceLabel: mdRenderText('text 围栏块渲染', 'Render text fences'),
  textFenceHint: mdRenderText(
    '语言标记为 text / plaintext / txt 的围栏块按 markdown 渲染，每块可切回原文',
    'Render text / plaintext / txt fences as markdown, each block can switch back to source',
  ),
  contextLabel: mdRenderText('上下文注入块渲染', 'Render context-injection blocks'),
  contextHint: mdRenderText(
    '宿主以纯文本呈现的上下文注入正文（子 agent 消息 / AGENTS.md）按 markdown 渲染',
    'Render plain-text context bodies (sub-agent messages / AGENTS.md) as markdown',
  ),
  thinkingLabel: mdRenderText('思考默认展开', 'Expand thinking by default'),
  thinkingHint: mdRenderText(
    '新出现的思考块自动展开；只对官方折叠行派发一次点击，外观完全由官方决定（用户手动折叠后不再干预）',
    'Newly mounted thinking rows expand automatically by dispatching one click; the look stays fully official (a manual collapse is respected)',
  ),
  injectPromptLabel: mdRenderText('注入 mermaid 能力说明', 'Inject mermaid capability note'),
  injectPromptHint: mdRenderText(
    '默认开启；关闭后已有代码块照常渲染，只是不再主动引导模型画图',
    'On by default; when off, existing blocks still render — the model is just no longer nudged',
  ),
  mermaidRenderLabel: mdRenderText('渲染 mermaid 代码块', 'Render mermaid code blocks'),
  mermaidRenderHint: mdRenderText(
    'mermaid / mmd 代码块渲染为图表卡片（预览 / 代码切换、导出 PNG / SVG）；渲染失败时回显源码',
    'Render mermaid / mmd blocks as diagram cards (preview / code toggle, PNG / SVG export); on failure the source is shown',
  ),
  loading: mdRenderText('加载中…', 'Loading…'),
  save: mdRenderText('保存', 'Save'),
  saved: mdRenderText('已保存', 'Saved'),
  saveFailed: mdRenderText('保存失败', 'Save failed'),
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
}

/** 设置页样式：只用宿主语义变量（--dsw-* / --ds-*），跟随深浅主题。 */
const MD_RENDER_SETTINGS_STYLES: string = `
.dsh-md-render-settings{display:flex;flex-direction:column;gap:12px;padding:12px}
.dsh-md-render-settings-group{display:flex;flex-direction:column;gap:8px}
.dsh-md-render-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-md-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-md-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-md-render-settings-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}
.dsh-md-render-settings-hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);line-height:1.5}
.dsh-md-render-settings-toggle{flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent);position:relative;cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-md-render-settings-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),background var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-settings-toggle[data-on="true"]::after{transform:translateX(12px);background:var(--dsw-alias-label-primary-foreground)}
.dsh-md-render-settings-actions{display:flex;align-items:center;gap:8px}
.dsh-md-render-settings-btn{height:28px;padding:0 14px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12)}
.dsh-md-render-settings-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-settings-status{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-settings-saved{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-settings-error{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary)}
`
