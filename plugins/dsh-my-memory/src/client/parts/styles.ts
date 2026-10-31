// ── styles：按 docs/原型重构/dsh-my-memory-v2.html 一比一复刻 ─────────────
// 设计值直接取自原型（浅色单主题）：卡片白底、#e8eaee 描边、#2f6fed 主色、
// 分类徽标软底、5 点置信度、居中确认弹层。类名沿用 dsh-my-memory-* 契约，
// 只重写取值与结构间距。注入在 activate，卸载时移除。
const STYLES: string = `
.dsh-my-memory-root { display:flex; flex-direction:column; gap:10px; padding:2px 6px 8px;
  color:#15181c; font:14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; }
.dsh-my-memory-body { display:flex; flex-direction:column; gap:10px; }
/* ── 三 tab 分段控件 ── */
.dsh-my-memory-tabs { display:inline-flex; gap:2px; padding:3px; border-radius:10px;
  background:#f1f3f6; align-self:flex-start; }
.dsh-my-memory-tab { display:inline-flex; align-items:center; gap:7px; height:32px; padding:0 15px;
  border:none; border-radius:8px; background:transparent; color:#4b5563; font:inherit; font-size:13px;
  cursor:pointer; transition:background .15s, color .15s, box-shadow .15s; }
.dsh-my-memory-tab:hover:not(.is-active) { color:#111827; }
.dsh-my-memory-tab.is-active { background:#fff; color:#111827; font-weight:600;
  box-shadow:0 1px 2px rgba(16,24,40,.1), 0 0 0 1px rgba(16,24,40,.04); }
.dsh-my-memory-tab-count { display:inline-flex; align-items:center; height:17px; padding:0 7px; border-radius:999px;
  background:#eef1f5; color:#6b7280; font-size:11px; font-variant-numeric:tabular-nums; }
.dsh-my-memory-tab.is-active .dsh-my-memory-tab-count { background:#eef4ff; color:#2456b3; }
/* ── 说明行 + 排序 ── */
.dsh-my-memory-section-head { display:flex; align-items:center; gap:8px; }
.dsh-my-memory-section-title { color:#15181c; font-size:14px; font-weight:600; }
.dsh-my-memory-prompt-count { display:inline-flex; align-items:center; height:17px; padding:0 7px; border-radius:999px;
  background:#eef1f5; color:#6b7280; font-size:11px; }
.dsh-my-memory-note-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.dsh-my-memory-note { margin:0; color:#6b7280; font-size:12.5px; line-height:1.6; }
.dsh-my-memory-note code { padding:1px 5px; border-radius:4px; background:#f1f3f6; color:#4b5563;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11.5px; }
.dsh-my-memory-sort { display:inline-flex; align-items:center; gap:4px; flex:none; height:26px; padding:0 10px;
  border:1px solid #dfe3e8; border-radius:7px; background:#fff; color:#4b5563; font:inherit; font-size:12px;
  cursor:pointer; white-space:nowrap; }
.dsh-my-memory-sort svg { display:block; flex:none; }
.dsh-my-memory-sort:hover { background:#f6f7f9; }
/* ── 记忆列表：整块白卡 + 行分隔 ── */
.dsh-my-memory-section { display:flex; flex-direction:column; gap:10px; }
.dsh-my-memory-list { border:1px solid #e8eaee; border-radius:10px; background:#fff; overflow:hidden; }
.dsh-my-memory-row { box-sizing:border-box; width:100%; padding:11px 13px; background:#fff;
  transition:background .15s; }
.dsh-my-memory-row + .dsh-my-memory-row { border-top:1px solid #e8eaee; }
.dsh-my-memory-row:hover { background:#fafbfc; }
.dsh-my-memory-row-editing { background:#fbfcff; }
.dsh-my-memory-row-head { display:flex; align-items:flex-start; gap:10px; }
.dsh-my-memory-desc { flex:1; min-width:0; padding:0; border:none; background:transparent; text-align:left;
  color:#1b1f24; font:inherit; font-size:14px; line-height:1.6; cursor:pointer; word-break:break-word;
  display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
.dsh-my-memory-desc:hover { color:#2f6fed; }
.dsh-my-memory-desc-open { display:block; overflow:visible; color:#1b1f24; }
.dsh-my-memory-desc-open:hover { color:#1b1f24; }
.dsh-my-memory-actions { display:flex; align-items:center; gap:2px; flex:none; margin-left:auto; }
.dsh-my-memory-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px;
  padding:0; border:none; border-radius:6px; background:transparent; color:#5b6470; cursor:pointer; flex:none;
  transition:background .15s, color .15s; }
.dsh-my-memory-iconbtn svg { display:block; }
.dsh-my-memory-iconbtn:hover:not(:disabled) { background:#f1f3f6; color:#111827; }
.dsh-my-memory-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-memory-iconbtn-danger:hover:not(:disabled) { background:#fdeceb; color:#c8322b; }
.dsh-my-memory-row-head .dsh-my-memory-actions { opacity:.65; transition:opacity .15s; }
.dsh-my-memory-row:hover .dsh-my-memory-row-head .dsh-my-memory-actions,
.dsh-my-memory-row:focus-within .dsh-my-memory-row-head .dsh-my-memory-actions { opacity:1; }
/* ── 元信息 ── */
.dsh-my-memory-meta { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:6px;
  color:#6b7280; font-size:12px; }
.dsh-my-memory-meta-time { color:#6b7280; }
.dsh-my-memory-ct-badge { display:inline-flex; align-items:center; height:20px; padding:0 7px; border-radius:5px;
  font-size:11.5px; font-weight:500; line-height:1; white-space:nowrap; color:#4b5563; background:#f2f4f7; }
.dsh-my-memory-conf { display:inline-flex; align-items:center; gap:3px; }
.dsh-my-memory-conf i { width:5px; height:5px; border-radius:50%; background:#dfe3e8; }
.dsh-my-memory-conf i.on { background:#4a7dde; }
.dsh-my-memory-conf b { margin-left:3px; font-weight:500; color:#6b7280; }
.dsh-my-memory-conflict-badge { display:inline-flex; align-items:center; height:20px; padding:0 7px; border-radius:5px;
  background:#fdf0ee; color:#b42318; font-size:11.5px; font-weight:500; }
/* ── 展开详情 ── */
.dsh-my-memory-detail { display:flex; flex-direction:column; gap:10px; margin-top:10px; padding-top:10px;
  border-top:1px dashed #e8eaee; }
.dsh-my-memory-detail-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px 16px; }
.dsh-my-memory-detail-label { margin-bottom:2px; color:#8b9199; font-size:11.5px; }
.dsh-my-memory-detail-value { color:#374151; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-memory-detail-block { display:flex; flex-direction:column; gap:2px; }
.dsh-my-memory-detail-empty { color:#8b9199; font-size:12px; }
.dsh-my-memory-history { display:flex; flex-direction:column; gap:2px; margin:0; padding:0; list-style:none; }
.dsh-my-memory-history li { color:#4b5563; font-size:12px; }
.dsh-my-memory-conflict-note { padding:8px 10px; border:1px solid #f7d9d6; border-radius:8px;
  background:#fdf3f2; color:#a3231b; font-size:12.5px; line-height:1.55; }
/* ── 空态 / 状态行 ── */
.dsh-my-memory-empty { padding:22px 16px; border:1px dashed #dfe3e8; border-radius:10px;
  text-align:center; color:#8b9199; font-size:13px; }
.dsh-my-memory-empty-body { display:flex; flex-direction:column; gap:2px; }
.dsh-my-memory-empty-main { color:#4b5563; font-size:13.5px; font-weight:500; }
.dsh-my-memory-empty-hint { color:#8b9199; font-size:12px; line-height:1.7; }
.dsh-my-memory-status { display:flex; align-items:center; gap:5px; color:#8b9199; font-size:12px; }
.dsh-my-memory-status svg { display:block; flex:none; }
.dsh-my-memory-loading { padding:4px 2px; }
.dsh-my-memory-spinner { display:inline-block; width:12px; height:12px; border-radius:50%; flex:none;
  border:2px solid rgba(47,111,237,.3); border-top-color:#2f6fed; animation:dsh-my-memory-spin 800ms linear infinite; }
.dsh-my-memory-saved { color:#128a4f; }
.dsh-my-memory-error { display:flex; align-items:center; gap:6px; color:#c8322b; font-size:12px; white-space:pre-wrap; }
/* ── 输入区 ── */
.dsh-my-memory-composer { display:flex; flex-direction:column; gap:6px; margin-top:2px; padding:12px 14px;
  border:1px solid #e8eaee; border-radius:10px; background:#fbfcfd; }
.dsh-my-memory-composer-input { box-sizing:border-box; width:100%; min-height:52px; max-height:180px; resize:none;
  overflow-y:auto; padding:9px 11px; border:1px solid #dfe3e8; border-radius:9px; background:#fff;
  color:#111827; font:inherit; font-size:13.5px; line-height:1.6; }
.dsh-my-memory-composer-input:focus,
.dsh-my-memory-prompt-textarea:focus { outline:none; border-color:#2f6fed; box-shadow:0 0 0 3px rgba(47,111,237,.12); }
.dsh-my-memory-composer-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.dsh-my-memory-composer-hint { color:#8b9199; font-size:12px; line-height:1.5; }
.dsh-my-memory-count { font-variant-numeric:tabular-nums; }
.dsh-my-memory-entry-hint { color:#b45309; font-size:12px; line-height:1.7; }
.dsh-my-memory-btn-add, .dsh-my-memory-btn-save { display:inline-flex; align-items:center; justify-content:center; gap:6px;
  height:32px; padding:0 14px; border:1px solid transparent; border-radius:8px; background:#2f6fed; color:#fff;
  font:inherit; font-size:13px; cursor:pointer; white-space:nowrap; transition:background .15s; }
.dsh-my-memory-btn-add svg, .dsh-my-memory-btn-save svg { display:block; flex:none; }
.dsh-my-memory-btn-add:hover:not(:disabled), .dsh-my-memory-btn-save:hover:not(:disabled) { background:#2560d8; }
.dsh-my-memory-btn-add:disabled, .dsh-my-memory-btn-save:disabled { background:#c3cfe8; cursor:not-allowed; }
.dsh-my-memory-add-input { flex:1; min-width:0; }
/* ── 确认弹层（居中） ── */
.dsh-my-memory-overlay { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
  padding:24px; background:rgba(15,23,42,.38); animation:dsh-my-memory-fade .16s ease; }
.dsh-my-memory-overlay .dsh-my-memory-ask { width:min(480px, 100%); padding:0; }
.dsh-my-memory-ask { display:flex; flex-direction:column; align-items:center; box-sizing:border-box; width:100%; padding:8px 0 12px; }
/* ask 卡的对外句柄（测试与外部样式按此定位；视觉全部在 .dsh-my-memory-ask-card 上） */
.dsh-my-memory-confirm { box-sizing:border-box; width:100%; }
.dsh-my-memory-ask-card { display:flex; flex-direction:column; box-sizing:border-box; width:100%; padding:0;
  border-radius:14px; overflow:hidden; background:#fff; box-shadow:0 20px 48px rgba(15,23,42,.24);
  animation:dsh-my-memory-pop .18s cubic-bezier(.2,0,.2,1); }
.dsh-my-memory-ask-strip { display:flex; align-items:center; gap:8px; padding:12px 16px; font-size:13px; font-weight:600; }
.dsh-my-memory-ask-save .dsh-my-memory-ask-strip { background:#eaf7ef; color:#12603a; }
.dsh-my-memory-ask-delete .dsh-my-memory-ask-strip { background:#fdecea; color:#a3231b; }
.dsh-my-memory-ask-dot { flex:none; width:7px; height:7px; border-radius:50%; background:currentColor; }
.dsh-my-memory-ask-strip-title { font-weight:600; }
.dsh-my-memory-ask-scope-badge { display:inline-flex; align-items:center; flex:none; margin-left:auto; height:20px;
  padding:0 8px; border-radius:999px; background:rgba(255,255,255,.75); color:#374151; font-size:11.5px; font-weight:500; }
.dsh-my-memory-ask-body { display:flex; flex-direction:column; gap:8px; padding:16px; max-height:min(60vh, 520px); overflow-y:auto; }
.dsh-my-memory-ask-options { display:flex; flex-direction:column; gap:6px; }
.dsh-my-memory-ask-option { display:flex; align-items:center; gap:8px; height:34px; padding:0 10px;
  border:1px solid #dfe3e8; border-radius:8px; color:#6b7280; font-size:12.5px; cursor:default; }
.dsh-my-memory-ask-option.is-active { border-color:#c9d6f5; background:#f3f7ff; color:#2456b3; font-weight:500; }
.dsh-my-memory-ask-option-dot { flex:none; width:6px; height:6px; border-radius:50%; background:#c4c9d0; }
.dsh-my-memory-ask-option-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-memory-ask-option.is-active .dsh-my-memory-ask-option-dot { background:#2f6fed; }
.dsh-my-memory-ask-fields { display:flex; flex-direction:column; gap:6px; }
.dsh-my-memory-ask-field { display:flex; gap:10px; font-size:12.5px; line-height:1.6; }
.dsh-my-memory-ask-field-label { flex:none; color:#8b9199; }
.dsh-my-memory-ask-field-value { min-width:0; color:#1f2937; word-break:break-word; }
.dsh-my-memory-ask-preview { display:flex; flex-direction:column; gap:4px; padding:10px 12px; border:1px solid #eceef1;
  border-radius:8px; background:#f7f8fa; }
.dsh-my-memory-ask-preview-text { color:#1f2937; font-size:13.5px; line-height:1.65; white-space:pre-wrap;
  word-break:break-word; max-height:180px; overflow:auto; }
.dsh-my-memory-ask-footer { display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:12px 16px; border-top:1px solid #eceef1; background:#fbfcfd; }
.dsh-my-memory-ask-feedback { min-width:0; color:#8b9199; font-size:12px; line-height:1.5; }
.dsh-my-memory-ask-actions { display:flex; align-items:center; flex:none; gap:8px; margin-left:auto; }
.dsh-my-memory-confirm-summary { display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:8px;
  border:1px solid #eceef1; background:#f7f8fa; }
.dsh-my-memory-confirm-summary-label { color:#8b9199; font-size:11.5px; }
.dsh-my-memory-confirm-summary-text { color:#1f2937; font-size:13px; word-break:break-word; }
.dsh-my-memory-confirm-ok { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px;
  border:1px solid transparent; border-radius:8px; font:inherit; font-size:13px; cursor:pointer;
  transition:filter .15s; }
.dsh-my-memory-confirm-ok svg { display:block; flex:none; }
.dsh-my-memory-confirm-ok-save { background:#138a52; color:#fff; }
.dsh-my-memory-confirm-ok-delete { background:#c8322b; color:#fff; }
.dsh-my-memory-confirm-ok:hover { filter:brightness(1.08); }
.dsh-my-memory-confirm-cancel { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px;
  border:1px solid #dfe3e8; border-radius:8px; background:#fff; color:#374151; font:inherit; font-size:13px;
  cursor:pointer; }
.dsh-my-memory-confirm-cancel svg { display:block; flex:none; }
.dsh-my-memory-confirm-cancel:hover { background:#f6f7f9; }
/* ── 提示词 tab ── */
.dsh-my-memory-section-prompts { gap:10px; }
.dsh-my-memory-prompt-list { display:flex; flex-direction:column; gap:8px; }
.dsh-my-memory-prompt-row { display:flex; flex-direction:column; gap:6px; padding:11px 13px; border:1px solid #e8eaee;
  border-radius:10px; background:#fff; }
.dsh-my-memory-prompt-row:hover { border-color:#d7dbe2; }
.dsh-my-memory-prompt-row-off { background:#fafbfc; }
.dsh-my-memory-prompt-row-off .dsh-my-memory-prompt-title,
.dsh-my-memory-prompt-row-off .dsh-my-memory-prompt-text { color:#9aa1aa; }
.dsh-my-memory-prompt-title { color:#111827; font-size:13.5px; font-weight:600; }
.dsh-my-memory-prompt-text { color:#4b5563; font-size:13px; line-height:1.6; white-space:pre-wrap; word-break:break-word;
  max-height:96px; overflow-y:auto; }
.dsh-my-memory-switch { position:relative; flex:none; width:30px; height:18px; padding:0; border:none; border-radius:999px;
  background:#d5dae1; cursor:pointer; transition:background .15s; }
.dsh-my-memory-switch.is-on { background:#1f9d55; }
.dsh-my-memory-switch:disabled { opacity:.5; cursor:default; }
.dsh-my-memory-switch-dot { position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%;
  background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:transform .15s; }
.dsh-my-memory-switch.is-on .dsh-my-memory-switch-dot { transform:translateX(12px); }
.dsh-my-memory-prompt-textarea { box-sizing:border-box; width:100%; min-height:56px; max-height:180px; resize:none;
  overflow-y:auto; padding:9px 11px; border:1px solid #dfe3e8; border-radius:9px; background:#fff;
  color:#111827; font:inherit; font-size:13.5px; line-height:1.6; }
.dsh-my-memory-iconbtn-up svg { transform:rotate(180deg); }
/* ── agent 记忆（issue #502）：文件视图，正文等宽、元数据弱化 ── */
.dsh-my-memory-agent-card { display:flex; flex-direction:column; gap:6px; padding:11px 13px;
  border:1px solid #e6e9ee; border-radius:10px; background:#fff; }
.dsh-my-memory-agent-card.is-archived { opacity:.72; background:#fafbfc; }
.dsh-my-memory-agent-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-my-memory-agent-title { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-my-memory-agent-name { min-width:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;
  color:#111827; background:#f3f4f6; padding:2px 7px; border-radius:6px; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
/* 作用域徽标：项目相关的内容写进全局层时，这里会把错位直接暴露给用户 */
.dsh-my-memory-agent-scope { flex:none; display:inline-flex; align-items:center; height:18px; padding:0 7px;
  border-radius:999px; background:#f2f4f7; color:#6b7280; font-size:11px; line-height:1; white-space:nowrap; }
.dsh-my-memory-agent-scope.is-project { background:#eef4ff; color:#2456b3; }
/* 行内操作与其它 tab 一致：hover / 聚焦才完全显现 */
.dsh-my-memory-agent-head .dsh-my-memory-actions { opacity:.65; transition:opacity .15s; }
.dsh-my-memory-agent-card:hover .dsh-my-memory-agent-head .dsh-my-memory-actions,
.dsh-my-memory-agent-card:focus-within .dsh-my-memory-agent-head .dsh-my-memory-actions { opacity:1; }
.dsh-my-memory-agent-meta { margin:0; color:#6b7280; font-size:12px; line-height:1.5; }
.dsh-my-memory-agent-body { margin:0; padding:9px 11px; border-radius:8px; background:#f8f9fb;
  color:#374151; font-size:13px; line-height:1.65; white-space:pre-wrap; word-break:break-word;
  max-height:220px; overflow-y:auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.dsh-my-memory-agent-editor { box-sizing:border-box; width:100%; min-height:120px; resize:vertical;
  padding:9px 11px; border:1px solid #dfe3e8; border-radius:9px; background:#fff; color:#111827;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; line-height:1.65; }
.dsh-my-memory-agent-editing { display:flex; flex-direction:column; gap:8px; }
.dsh-my-memory-agent-save { display:flex; justify-content:flex-end; gap:8px; }
.dsh-my-memory-agent-archive { margin-top:10px; }
.dsh-my-memory-agent-archive > summary { cursor:pointer; color:#6b7280; font-size:12.5px; padding:6px 0; }
.dsh-my-memory-agent-archive .dsh-my-memory-agent-card { margin-top:8px; }
/* 分组折叠头：项目名 · N 条（默认展开全局 + 最近写入的项目） */
.dsh-my-memory-agent-group { margin-top:10px; }
.dsh-my-memory-agent-group-head { display:flex; align-items:center; gap:6px; width:100%; padding:7px 9px;
  border:none; border-radius:8px; background:#f5f6f8; color:#374151; font:inherit; font-size:12.5px;
  font-weight:600; text-align:left; cursor:pointer; }
.dsh-my-memory-agent-group-head:hover { background:#eef0f4; }
.dsh-my-memory-agent-group-head:focus-visible { outline:2px solid #2456b3; outline-offset:1px; }
.dsh-my-memory-agent-group-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-my-memory-agent-group > .dsh-my-memory-list { margin-top:8px; }
/* 跨项目晋升建议：面板顶部醒目区（被护栏拒绝的条目按钮置灰，原因用红字给出来） */
.dsh-my-memory-agent-suggest { display:flex; flex-direction:column; gap:8px; padding:11px 13px;
  border:1px solid #dfe6f5; border-radius:10px; background:#f8faff; }
.dsh-my-memory-agent-suggest-title { margin:0; color:#2456b3; font-size:12.5px; font-weight:600; }
.dsh-my-memory-agent-suggest-row { display:flex; flex-direction:column; gap:5px; align-items:flex-start;
  padding:9px 11px; border:1px solid #e6e9ee; border-radius:9px; background:#fff; }
.dsh-my-memory-agent-suggest-text { margin:0; color:#111827; font-size:13px; line-height:1.6; word-break:break-word; }
.dsh-my-memory-agent-suggest-meta { margin:0; color:#6b7280; font-size:12px; line-height:1.5; }
.dsh-my-memory-agent-suggest-blocked { margin:0; color:#c8322b; font-size:12px; line-height:1.6; }
@keyframes dsh-my-memory-spin { to { transform:rotate(360deg); } }
@keyframes dsh-my-memory-fade { from { opacity:0; } }
@keyframes dsh-my-memory-pop { from { opacity:0; transform:translateY(6px) scale(.985); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-my-memory-overlay, .dsh-my-memory-ask-card { animation:none; }
}
`.trim()

const STYLE_TAG: string = 'data-dsh-my-memory'

// 导出给其他 part 文件使用
