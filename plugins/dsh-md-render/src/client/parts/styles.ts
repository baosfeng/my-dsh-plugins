// ── 样式（DSH 语义 token，随 activation 注入）──────────────────
// 精简后只保留本插件**自有 DOM** 的样式：统一 MarkdownView 的包裹容器
// （tzx-md）、两个注入容器（text 围栏块 / 上下文注入块）、「查看原文」
// 切换按钮、整段复制按钮。表格 / 公式 / 代码块高亮 / 代码主题等样式全部
// 下线——那些 DOM 现在由官方 MarkdownText 渲染，样式随官方组件自带
// （ui-primitives 的 CSS Modules）。
const STYLES: string = `
.tzx-md{position:relative;display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-md-render-fallback{margin:0;white-space:pre-wrap;font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-primary)}
/* ── 注入容器：text / plaintext / txt 围栏块按 markdown 渲染 ──
   容器由 text-markdown.ts 追加在 md-code-block 内；宿主内容容器按视图
   隐藏（官方 CodeBlock 的内容容器带稳定属性 data-code-block-content）。 */
.dsh-md-render-text-md{padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-markdown-code-block)}
.md-code-block[data-dsh-md-render-text-view="markdown"]>[data-code-block-content]{display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-text-md{display:none}
.dsh-md-render-text-toggle{display:inline-flex;align-items:center;align-self:flex-end;margin-top:4px;padding:2px 10px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;transition:color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-text-toggle:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-text-toggle[aria-pressed="true"]{color:var(--dsw-alias-accent-primary);border-color:var(--dsw-alias-accent-primary)}
/* ── 上下文注入块（pre[data-context-text]）渲染容器 ──
   插在宿主 pre 之前，宿主 pre 置 hidden（React 拥有该子树，不改其子结构）。 */
.dsh-md-render-context-md{padding:0}
/* ── 整段 markdown 复制按钮（官方只有代码块复制）──
   绝对定位右下角、hover 才显示；流式渲染中隐藏，避免复制到半截内容。 */
.dsh-md-render-copy{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font:var(--dsw-font-xxxs-11);line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out),border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.tzx-md>.dsh-md-render-copy{position:absolute;right:8px;bottom:8px}
.tzx-md:hover>.dsh-md-render-copy{opacity:1}
.dsh-md-render-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-md-render-copy-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
[data-streaming] .dsh-md-render-copy{display:none}
[data-streaming] .dsh-md-render-text-toggle{display:none}
`
