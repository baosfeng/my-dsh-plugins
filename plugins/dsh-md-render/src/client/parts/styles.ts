// ── 样式（DSH 语义 token，随 activation 注入）──────────────────────────
// 只写**本插件自有 DOM** 的样式 + **自有 data-* 标记**作用域下的显隐规则：
//  - .tzx-md / 注入容器 / 「查看原文」按钮 / 整段复制按钮（md-render 原有）；
//  - mermaid 卡片全套（dsh-md-render-mermaid-*）+ 块级视图标记驱动的官方 <pre>
//    隐藏规则（**不用** el.style：硬约束「不对官方元素写 style / class / aria」）；
//  - 离屏渲染容器（原实现用 host.style.cssText，改为类选择器）。
// 不覆盖任何官方类名的外观；表格 / 公式 / 代码块高亮样式全部随官方组件自带。
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
/* ── mermaid 图表卡片（自有 DOM）── */
.dsh-md-render-mermaid-host{display:block;min-width:0}
.md-code-block[data-dsh-md-render-mermaid-view]>pre{display:none}
.dsh-md-render-mermaid-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font:var(--dsw-font-s-14);line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-md-render-mermaid-card-in 150ms var(--ds-ease-in-out)}
.dsh-md-render-mermaid-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-md-render-mermaid-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dsh-md-render-mermaid-export{display:inline-flex;gap:2px;flex:none}
.dsh-md-render-mermaid-eb{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-mermaid-eb svg{display:block;flex:none}
.dsh-md-render-mermaid-eb:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-mermaid-notice{border-radius:6px;padding:4px 10px;font:var(--dsw-font-xxs-12);line-height:20px}
.dsh-md-render-mermaid-notice-ok{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-mermaid-notice-error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-card-title{display:flex;align-items:center;gap:5px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}
.dsh-md-render-mermaid-card-title svg{display:block;flex:none}
.dsh-md-render-mermaid-view-toggle{display:inline-flex;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:2px;flex:none}
.dsh-md-render-mermaid-vt{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;border-radius:6px;padding:2px 8px;cursor:pointer;font:var(--dsw-font-xxs-12);line-height:20px;color:var(--dsw-alias-label-secondary);transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-md-render-mermaid-vt svg{display:block;flex:none}
.dsh-md-render-mermaid-vt:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-vt-active{background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent);color:var(--dsw-alias-accent);font-weight:600}
.dsh-md-render-mermaid-svg{overflow:auto;max-height:70vh}
.dsh-md-render-mermaid-svg svg{max-width:100%;height:auto}
.dsh-md-render-mermaid-code{margin:0;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:8px 12px;overflow:auto;font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap}
.dsh-md-render-mermaid-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-loading svg{flex:none;animation:dsh-md-render-mermaid-spin 1s linear infinite}
.dsh-md-render-mermaid-error{border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);padding:8px 10px}
.dsh-md-render-mermaid-error-head{display:flex;align-items:center;gap:6px}
.dsh-md-render-mermaid-error-head svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dsh-md-render-mermaid-error-msg{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;margin-top:4px;line-height:1.5}
.dsh-md-render-mermaid-retry{margin-left:auto;flex:none}
/* ── 离屏渲染容器（引擎渲染失败时的「炸弹图」只落在这里，随容器移除）──
   必须仍在布局树内（display:none / visibility:hidden 会让 mermaid 量不到尺寸）。 */
.dsh-md-render-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
@keyframes dsh-md-render-mermaid-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-md-render-mermaid-spin{to{transform:rotate(360deg)}}
`
