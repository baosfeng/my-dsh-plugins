/**
 * dsh-my-memory — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "记忆 / Memory" tab (official `slots` extension point — no
 * third-party dependency) showing the GLOBAL and PROJECT memory scopes side
 * by side, with add / edit / delete. Every write goes through a custom
 * confirmation UI (built on the ask pattern, NOT the native browser
 * confirm): delete is a red, eye-catching two-step confirm; save/add is
 * green. The project scope is visually distinct (project-root badge +
 * different section accent) so the two scopes never blur together.
 *
 * Data source: GET /my-memory/api/memory + POST /my-memory/api/memory
 * (server half). Writes carry `confirmed: true` — the server refuses any
 * write without the user-consent marker.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs splices
 * the `lib/parts/*.part.js` pieces into the PART placeholder markers below
 * (each piece is plain function-declaration text sharing this factory scope;
 * the browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')
    // 官方 UI 组件库（宿主 staticModules 提供，零安装零体积；组件表见
    // docs/开发指南/官方UI组件库.md）：Input/Pill/Button + 官方线性图标。
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    // ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
  try {
    const lang = (navigator.language || 'en').toLowerCase()
    return lang.startsWith('zh')
  } catch {
    return false
  }
}

const strings = {
  title: () => (isZh() ? '记忆' : 'Memory'),
  globalSection: () => (isZh() ? '全局记忆' : 'Global memory'),
  projectSection: () => (isZh() ? '项目记忆' : 'Project memory'),
  projectHint: () =>
    isZh()
      ? '输入项目根路径以查看 / 编辑该项目记忆（存储于 $DSH_HOME/memory/projects/）'
      : 'Enter a project root to view/edit its project memory (stored under $DSH_HOME/memory/projects/)',
  loadProject: () => (isZh() ? '加载' : 'Load'),
  refresh: () => (isZh() ? '刷新' : 'Refresh'),
  retry: () => (isZh() ? '重试' : 'Retry'),
  loading: () => (isZh() ? '加载中…' : 'Loading…'),
  loadError: () => (isZh() ? '加载失败' : 'Load failed'),
  empty: () => (isZh() ? '暂无记忆' : 'No memories yet'),
  emptyHint: () => (isZh() ? '点击下方输入框添加第一条记忆' : 'Add your first memory below'),
  projectEmptyHint: () =>
    isZh()
      ? '当前无项目会话，请在上方输入项目根路径加载项目记忆'
      : 'No active project session; enter a project root above to load its memory',
  addPlaceholder: () =>
    isZh()
      ? '输入要记住的内容（建议 1-2 句话概括，如：回复使用中文）'
      : 'Type what to remember (keep it to 1-2 sentences, e.g. reply in Chinese)',
  // ── issue #105 记忆内容精简：超长提示 / 概要预览 ──
  entryTooLongHint: (current, limit) =>
    isZh()
      ? `内容过长（${current} 字，建议 ≤ ${limit} 字），建议精简为 1-2 句`
      : `Entry too long (${current} chars, suggested ≤ ${limit}); keep it to 1-2 sentences`,
  summaryPreview: () =>
    isZh() ? '将保存完整内容；列表与注入显示概要：' : 'Full content is saved; list & injection show the summary: ',
  add: () => (isZh() ? '新增' : 'Add'),
  save: () => (isZh() ? '保存' : 'Save'),
  cancel: () => (isZh() ? '取消' : 'Cancel'),
  edit: () => (isZh() ? '编辑' : 'Edit'),
  delete: () => (isZh() ? '删除' : 'Delete'),
  confirmAdd: () => (isZh() ? '确认新增这条记忆？' : 'Add this memory?'),
  confirmUpdate: () => (isZh() ? '确认保存这条记忆的修改？' : 'Save this memory change?'),
  confirmDelete: () => (isZh() ? '确定删除这条记忆？此操作不可撤销。' : 'Delete this memory? This cannot be undone.'),
  confirmSave: () => (isZh() ? '确认保存' : 'Confirm save'),
  confirmDeleteBtn: () => (isZh() ? '确认删除' : 'Confirm delete'),
  saved: () => (isZh() ? '已保存' : 'Saved'),
  saveFailed: () => (isZh() ? '操作失败' : 'Operation failed'),
  projectRoot: () => (isZh() ? '项目根：' : 'Project root: '),
  globalNote: () =>
    isZh()
      ? '全局记忆在会话开始时注入系统提示词（agent 始终携带）；存于 $DSH_HOME/memory.json'
      : 'Global memories are injected into the system prompt at session start; stored in $DSH_HOME/memory.json',
  projectNote: () =>
    isZh()
      ? '项目记忆按项目隔离，仅该项目会话可见；存于 $DSH_HOME/memory/projects/（按项目根路径哈希分文件）'
      : 'Project memories are scoped to this project only; stored under $DSH_HOME/memory/projects/ (one file per project-root hash)',
  confirmHint: () =>
    isZh() ? '所有新增 / 修改 / 删除都需要你确认' : 'Every add / edit / delete needs your confirmation',
  updatedAt: (ts) => (isZh() ? `更新于 ${new Date(ts).toLocaleString()}` : `Updated ${new Date(ts).toLocaleString()}`),
  // ── issue #110 视觉重设计：徽标分类/数量、相对时间、排序、截断展开 ──
  globalScope: () => (isZh() ? '全局' : 'Global'),
  projectScope: () => (isZh() ? '项目' : 'Project'),
  countBadge: (label, n) => (isZh() ? `${label} · ${n} 条` : `${label} · ${n}`),
  countOnly: (n) => (isZh() ? `${n} 条` : `${n}`),
  projectBadge: (root, n) => (isZh() ? `项目根：${root} · ${n} 条` : `Project root: ${root} · ${n}`),
  pathInputAria: () => (isZh() ? '项目根路径' : 'Project root path'),
  addInputAria: (scope) =>
    isZh() ? `新增记忆内容（${scope === 'project' ? '项目' : '全局'}）` : `New memory (${scope})`,
  justNow: () => (isZh() ? '刚刚' : 'just now'),
  minutesAgo: (n) => (isZh() ? `${n} 分钟前` : `${n} min ago`),
  hoursAgo: (n) => (isZh() ? `${n} 小时前` : `${n} hr ago`),
  daysAgo: (n) => (isZh() ? `${n} 天前` : `${n} d ago`),
  sortLabel: () => (isZh() ? '按更新时间排序' : 'Sort by updated'),
  sortNewest: () => (isZh() ? '最新优先' : 'Newest first'),
  sortOldest: () => (isZh() ? '最旧优先' : 'Oldest first'),
  expand: () => (isZh() ? '展开' : 'Expand'),
  collapse: () => (isZh() ? '收起' : 'Collapse'),
  // ── issue #78 渐进式索引记忆：待确认候选 + 元数据展示 ──
  candidatesSection: () => (isZh() ? '自动学习候选（待确认）' : 'Auto-learned candidates (pending)'),
  candidatesNote: () =>
    isZh()
      ? '会话结束后自动从对话提取的记忆候选（autoLearn 开启时）。确认后写入记忆（同主题自动提升置信度），拒绝则丢弃——记忆绝不静默变更'
      : 'Memory candidates auto-extracted from conversations (when autoLearn is on). Confirm to store them (same themes gain confidence), dismiss to drop — memories never change silently',
  candidatesEmpty: () => (isZh() ? '暂无待确认候选' : 'No pending candidates'),
  confirmCandidate: () => (isZh() ? '确认写入' : 'Confirm'),
  dismissCandidate: () => (isZh() ? '拒弃' : 'Dismiss'),
  candidateSource: (sessionId) =>
    isZh()
      ? `来源会话：${sessionId === '' ? '(无)' : sessionId}`
      : `Source session: ${sessionId === '' ? '(none)' : sessionId}`,
  candidateScopeBadge: (scope) =>
    isZh() ? (scope === 'project' ? '项目候选' : '全局候选') : scope === 'project' ? 'Project' : 'Global',
  categoryLabel: (category) =>
    ({
      preference: isZh() ? '偏好' : 'Preference',
      fact: isZh() ? '事实' : 'Fact',
      project: isZh() ? '项目' : 'Project',
      stack: isZh() ? '技术栈' : 'Stack',
      workflow: isZh() ? '工作流' : 'Workflow',
    })[category] ?? (isZh() ? '事实' : 'Fact'),
  confidenceLabel: (n) => (isZh() ? `置信度 ${n}` : `Confidence ${n}`),
  statusConflict: () => (isZh() ? '待处理矛盾' : 'Conflict'),
  historyLabel: () => (isZh() ? '演进历史' : 'History'),
  historyEntry: (action) =>
    isZh()
      ? action === 'reinforce'
        ? '多次出现，置信度提升'
        : action === 'conflict'
          ? '内容更新（可能矛盾）'
          : '新增'
      : action,
  noHistory: () => (isZh() ? '暂无演进历史' : 'No history yet'),
}

    // ── styles (DSH semantic tokens, injected on activate, removed on teardown) ──
// Mirrors the dsh-file-activity design language (issue #54): tight 2px 6px 8px
// body, 26px rows with hover fills, 24px circular icon buttons, two-line empty
// states, and motion on every state change. All colors ride the DSH semantic
// tokens (--dsw-alias-*), typography rides the font roles (--dsw-font-*).
const STYLES = `
.dsh-my-memory-root { display:flex; flex-direction:column; gap:8px; padding:2px 6px 8px;
  font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-toolbar { display:flex; flex-direction:column; gap:4px; }
.dsh-my-memory-pathbar { display:flex; gap:6px; align-items:center; }
/* 路径输入/加载/刷新按钮由官方 Input/Button 提供视觉（issue #143 试点）；
   仅保留布局微调：路径输入 wrapper 撑满剩余宽度。 */
.dsh-my-memory-path-input { flex:1; min-width:0; }
.dsh-my-memory-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; flex:none;
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-iconbtn svg { display:block; }
.dsh-my-memory-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-iconbtn:disabled { opacity:.4; cursor:default; }
.dsh-my-memory-iconbtn-danger:hover:not(:disabled) { color:var(--dsw-alias-state-error-primary); }
.dsh-my-memory-status { display:flex; align-items:center; gap:5px; font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-status svg { display:block; flex:none; }
.dsh-my-memory-loading { padding:4px 2px; }
.dsh-my-memory-spinner { display:inline-block; width:12px; height:12px; border-radius:50%; flex:none;
  border:2px solid color-mix(in srgb, var(--dsw-alias-accent) 30%, transparent); border-top-color:var(--dsw-alias-accent);
  animation:dsh-my-memory-spin 800ms linear infinite; }
.dsh-my-memory-saved { color:var(--dsw-alias-state-success-primary); }
.dsh-my-memory-error { display:flex; align-items:center; gap:6px; font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-state-error-primary); white-space:pre-wrap; }
.dsh-my-memory-sections { display:flex; flex-direction:column; gap:8px; }
.dsh-my-memory-section { display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
/* The project scope gets a subtle accent border (keeps the two scopes
    distinguishable without breaking the neutral baseline — 之前 45% 边框 +
   6% 底色过于抢眼，弱化为 28% 描边 + 中性底). */
.dsh-my-memory-section-project { border-color:color-mix(in srgb, var(--dsw-alias-accent) 28%, transparent); }
.dsh-my-memory-section-head { display:flex; align-items:center; gap:8px; }
.dsh-my-memory-section-title { font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
/* 分区徽标由官方 Pill 提供视觉（issue #143 试点）；排序 Pill 仅保留靠右布局。 */
.dsh-my-memory-sort { margin-left:auto; }
.dsh-my-memory-note { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); line-height:1.7; }
.dsh-my-memory-empty { display:flex; align-items:flex-start; gap:8px; padding:12px 10px;
  font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-empty-body { display:flex; flex-direction:column; gap:2px; }
.dsh-my-memory-empty-main { font:var(--dsw-font-s-strong-14); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-empty-icon { display:inline-flex; margin-top:1px; color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-empty-hint { color:var(--dsw-alias-label-dimmed); font:var(--dsw-font-xxxs-11); line-height:1.7; }
/* 条目卡片化：背景 + 边框 + 圆角，与内容视觉分离；hover 高亮边框（issue #110）。 */
.dsh-my-memory-row { display:flex; flex-direction:column; gap:4px; box-sizing:border-box; width:100%; min-height:26px;
  margin:0; padding:8px 10px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2);
  border-radius:6px;
  transition:border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-row:hover { border-color:color-mix(in srgb, var(--dsw-alias-accent) 40%, transparent);
  background:var(--dsw-alias-interactive-bg-hover); }
.dsh-my-memory-row-editing { border-color:var(--dsw-alias-accent); }
.dsh-my-memory-row-head { display:flex; align-items:center; gap:8px; }
.dsh-my-memory-row-desc-wrap { display:flex; align-items:center; gap:4px; flex:1; min-width:0; }
.dsh-my-memory-desc { flex:1; min-width:0; font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); word-break:break-word; }
.dsh-my-memory-expand { display:inline-flex; align-items:center; gap:3px; flex:none; height:20px; padding:0 6px; border-radius:4px;
  cursor:pointer; border:none; background:transparent; color:var(--dsw-alias-accent); font:var(--dsw-font-xxxs-11);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-expand svg { display:block; flex:none; transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-expand-open svg { transform:rotate(180deg); }
.dsh-my-memory-expand:hover { background:var(--dsw-alias-interactive-bg-hover); }
/* 操作区：统一右侧图标组，与内容用分隔线分离；删除 hover 保持红色警示。 */
.dsh-my-memory-actions { display:flex; align-items:center; gap:2px; flex:none; padding-left:8px;
  border-left:1px solid var(--dsw-alias-border-l2); }
.dsh-my-memory-meta { display:flex; align-items:center; gap:4px; font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-meta-icon { display:inline-flex; color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-addbar { display:flex; gap:6px; align-items:center; }
.dsh-my-memory-addbar-wrap { display:flex; flex-direction:column; gap:3px; }
.dsh-my-memory-entry-hint { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary);
  line-height:1.7; padding:0 2px; }
/* 新增/编辑输入由官方 Input 提供视觉（issue #143 试点）；仅保留撑满布局。 */
.dsh-my-memory-add-input { flex:1; min-width:0; }
.dsh-my-memory-btn-save { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color:var(--dsw-alias-state-success-primary); font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out), border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-btn-save svg { display:block; flex:none; }
.dsh-my-memory-btn-save:hover:not(:disabled) { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.dsh-my-memory-btn-save:disabled { opacity:.4; cursor:default; }
.dsh-my-memory-confirm { display:flex; flex-direction:column; gap:6px; padding:8px 10px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1); animation:dsh-my-memory-row-in 150ms var(--ds-ease-in-out); }
.dsh-my-memory-confirm-save { border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
.dsh-my-memory-confirm-delete { border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-my-memory-confirm-head { display:flex; align-items:center; gap:6px; }
.dsh-my-memory-confirm-head svg { display:block; flex:none; }
.dsh-my-memory-confirm-text { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-primary); }
.dsh-my-memory-confirm-desc { font:var(--dsw-font-s-14); color:var(--dsw-alias-label-primary); word-break:break-word; }
.dsh-my-memory-confirm-summary { display:flex; flex-direction:column; gap:2px; padding:4px 6px; border-radius:4px;
  background:color-mix(in srgb, var(--dsw-alias-accent) 8%, transparent); }
.dsh-my-memory-confirm-summary-label { font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-confirm-summary-text { font:var(--dsw-font-xxs-12); color:var(--dsw-alias-label-secondary); word-break:break-word; }
.dsh-my-memory-confirm-actions { display:flex; gap:6px; align-items:center; }
.dsh-my-memory-confirm-ok { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  font:var(--dsw-font-xxs-12);
  transition:filter var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-confirm-ok svg { display:block; flex:none; }
.dsh-my-memory-confirm-ok-save { border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, transparent);
  background:var(--dsw-alias-state-success-primary); color:var(--dsw-alias-label-primary-foreground); }
.dsh-my-memory-confirm-ok-delete { border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent);
  background:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-label-primary-foreground); }
.dsh-my-memory-confirm-ok:hover { filter:brightness(1.1); }
.dsh-my-memory-confirm-cancel { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 12px; border-radius:6px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);
  transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out), color var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
.dsh-my-memory-confirm-cancel svg { display:block; flex:none; }
.dsh-my-memory-confirm-cancel:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
@keyframes dsh-my-memory-row-in { from { opacity:0; transform:translateY(1px); } to { opacity:1; transform:none; } }
@keyframes dsh-my-memory-spin { to { transform:rotate(360deg); } }
/* ── issue #78 渐进式索引记忆：候选区块 + 元数据徽标 + 演进历史 ── */
.dsh-my-memory-candidates { display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
  border:1px dashed color-mix(in srgb, var(--dsw-alias-accent) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 4%, var(--dsw-alias-bg-layer-1)); }
.dsh-my-memory-row-candidate { border-style:dashed; }
.dsh-my-memory-ct-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-accent);
  background:color-mix(in srgb, var(--dsw-alias-accent) 12%, transparent); }
.dsh-my-memory-conf-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.dsh-my-memory-conflict-badge { flex:none; display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px;
  font:var(--dsw-font-xxxs-11); color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 15%, transparent); }
.dsh-my-memory-meta-sep { color:var(--dsw-alias-label-dimmed); }
.dsh-my-memory-history-entry { display:inline-flex; font:var(--dsw-font-xxxs-11);
  color:var(--dsw-alias-label-tertiary); }
.dsh-my-memory-iconbtn-confirm:hover:not(:disabled) { color:var(--dsw-alias-state-success-primary); }
`.trim()

const STYLE_TAG = 'data-dsh-my-memory'

    // ── api: fetch helpers for the Memory views ────────────────────────────
const API_BASE = '/my-memory/api'

/** One GET memory payload into { scope, cwd, projectRoot, items }. */
function normalizeMemory(value) {
  return {
    scope: value.scope ?? 'global',
    cwd: value.cwd ?? '',
    projectRoot: value.projectRoot ?? '',
    items: Array.isArray(value.items) ? value.items : [],
  }
}

/** GET /my-memory/api/memory?scope=…&cwd=… → normalized value; rejects on bad responses. */
function fetchMemory(scope, cwd) {
  const query = cwd.trim() === '' ? `?scope=${scope}` : `?scope=${scope}&cwd=${encodeURIComponent(cwd.trim())}`
  return fetch(`${API_BASE}/memory${query}`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('bad memory response')
      return normalizeMemory(body.value)
    })
}

/** POST /my-memory/api/memory — a write gated on the user-consent marker. */
function writeMemory({ action, scope, cwd, id, desc }) {
  return fetch(`${API_BASE}/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, scope, cwd, id, desc, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('write failed')
      return normalizeMemory({ ...body.value, scope })
    })
}

/** GET /my-memory/api/candidates → the pending auto-extracted candidates
 *  (issue #78; read-only — candidates never touch memory before confirm). */
function fetchCandidates() {
  return fetch(`${API_BASE}/candidates`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('bad candidates response')
      return Array.isArray(body.value?.items) ? body.value.items : []
    })
}

/** POST /my-memory/api/candidates/confirm — accept one candidate (user
 *  consent marker; progressive-merged into the target scope on the server). */
function confirmCandidate(id) {
  return fetch(`${API_BASE}/candidates/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('candidate confirm failed')
      return body.value
    })
}

/** POST /my-memory/api/candidates/dismiss — reject one candidate (drop it;
 *  gated on the user-consent marker, never touches any memory). */
function dismissCandidate(id) {
  return fetch(`${API_BASE}/candidates/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, confirmed: true }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) throw new Error('candidate dismiss failed')
      return body.value
    })
}

/** Current session id from localStorage ('dsh.sessions.current' → { sessionId }). */
function currentSessionId() {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    const parsed = raw === null ? null : JSON.parse(raw)
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : ''
  } catch {
    return ''
  }
}

/** GET /my-memory/api/session → the session's working directory ('' if none).
 *  The panel uses it to auto-load the current project memory on open (issue #104). */
function fetchSessionCwd(sessionId) {
  if (sessionId === '') return Promise.resolve('')
  return fetch(`${API_BASE}/session?sessionId=${encodeURIComponent(sessionId)}`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) return ''
      return typeof body.value?.cwd === 'string' ? body.value.cwd : ''
    })
    .catch(() => '')
}

/** GET /my-memory/api/config → the entry-length guidance (issue #105):
 *  `maxEntryLength` (concise-input hint threshold) and `maxDescLength`
 *  (injection cap). Falls back to the client-side default on failure. */
function fetchConfig() {
  return fetch(`${API_BASE}/config`)
    .then((res) => res.json())
    .then((body) => {
      if (body === null || body.ok !== true) return { maxEntryLength: DEFAULT_ENTRY_LIMIT }
      const limit = body.value?.maxEntryLength
      return { maxEntryLength: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_ENTRY_LIMIT }
    })
    .catch(() => ({ maxEntryLength: DEFAULT_ENTRY_LIMIT }))
}

    // ── shared icons (inline, stroke=currentColor, matching better-sidebar) ──
// Single source of truth for the plugin UI icon set (issue #54 阶段 0).
// Extracted from dsh-file-activity's lib/parts/icons.part.js; every plugin's
// scripts/build.mjs splices this file via the `shared: true` piece marker.
// Keep the stroke=currentColor outline style — it inherits the surrounding
// text color and reads on both light and dark themes.
const ICON_STROKE = 1.8
const iconSvg = (children, size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children.map((child, i) =>
      child === null || child === undefined || typeof child === 'boolean'
        ? child
        : createElement(child.type, { key: i, ...child.props }),
    ),
  )

const icon = {
  clock: (size = 16) =>
    iconSvg([createElement('circle', { cx: 12, cy: 12, r: 9 }), createElement('path', { d: 'M12 7v5l3 2' })], size),
  refresh: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        createElement('polyline', { points: '21 3 21 9 15 9' }),
      ],
      size,
    ),
  trash: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 6h18' }),
        createElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }),
        createElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      ],
      size,
    ),
  chevronRight: (size = 14) => iconSvg([createElement('polyline', { points: '9 6 15 12 9 18' })], size),
  chevronDown: (size = 14) => iconSvg([createElement('polyline', { points: '6 9 12 15 18 9' })], size),
  file: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        createElement('path', { d: 'M14 2v6h6' }),
      ],
      size,
    ),
  folder: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }),
      ],
      size,
    ),
  external: (size = 15) =>
    iconSvg(
      [
        createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
        createElement('polyline', { points: '15 3 21 3 21 9' }),
        createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 }),
      ],
      size,
    ),
  close: (size = 15) =>
    iconSvg(
      [
        createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
      ],
      size,
    ),
  help: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 9 }),
        createElement('path', { d: 'M9.1 9.2a3 3 0 0 1 5.8 1.2c0 1.8-2.7 2.4-2.7 3.6' }),
        createElement('line', { x1: 12, y1: 17.2, x2: 12.01, y2: 17.2 }),
      ],
      size,
    ),
  // ── generic action icons (issue #54 阶段 0) ─────────────────────────────
  // Added for the upcoming plugin UI refresh: save/confirm (check), add/
  // install (plus), market search (search), settings entry (settings).
  check: (size = 16) => iconSvg([createElement('polyline', { points: '20 6 9 17 4 12' })], size),
  plus: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
        createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
      ],
      size,
    ),
  pencil: (size = 15) =>
    iconSvg([createElement('path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' })], size),
  search: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 11, cy: 11, r: 8 }),
        createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
      ],
      size,
    ),
  settings: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
        createElement('path', {
          d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
        }),
      ],
      size,
    ),
  // 警告（issue #54 阶段 1 新增）：安全护栏告警类型图标（投毒/提示注入），
  // 三角警示 + 感叹号，stroke=currentColor 风格与其余图标一致。
  alert: (size = 16) =>
    iconSvg(
      [
        createElement('path', {
          d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ],
      size,
    ),
  // 代码（issue #54 阶段 1 新增）：尖括号 `</>`，预览/代码切换的代码视图
  // 图标（dsh-mermaid-render 卡片），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，图表导出按钮（dsh-mermaid-render
  // 卡片下载 PNG/SVG），stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，复制源码按钮（dsh-mermaid-render
  // 卡片复制代码），stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
}

// Common-language / file-type badges (issue #24): brand fill + contrast
// ink, reading on both light and dark themes. Unmapped extensions keep the
// neutral currentColor file icon above. [bg, fg ink, short mark]
const FILE_BADGES = {
  // JavaScript / TypeScript
  js: ['#F7DF1E', '#323330', 'JS'],
  mjs: ['#F7DF1E', '#323330', 'JS'],
  cjs: ['#F7DF1E', '#323330', 'JS'],
  ts: ['#3178C6', '#ffffff', 'TS'],
  mts: ['#3178C6', '#ffffff', 'TS'],
  cts: ['#3178C6', '#ffffff', 'TS'],
  tsx: ['#3178C6', '#ffffff', 'TSX'],
  jsx: ['#3178C6', '#ffffff', 'JSX'],
  // 后端语言
  java: ['#007396', '#ffffff', 'JAVA'],
  c: ['#A8B9CC', '#111111', 'C'],
  cpp: ['#00599C', '#ffffff', 'C++'],
  cxx: ['#00599C', '#ffffff', 'C++'],
  cc: ['#00599C', '#ffffff', 'C++'],
  hpp: ['#00599C', '#ffffff', 'C++'],
  h: ['#A8B9CC', '#111111', 'H'],
  hh: ['#A8B9CC', '#111111', 'H'],
  cs: ['#68217A', '#ffffff', 'C#'],
  csharp: ['#68217A', '#ffffff', 'C#'],
  go: ['#00ADD8', '#ffffff', 'GO'],
  rs: ['#CE422B', '#ffffff', 'RS'],
  rb: ['#B51624', '#ffffff', 'RB'],
  php: ['#777BB4', '#ffffff', 'PHP'],
  py: ['#3776AB', '#ffffff', 'PY'],
  swift: ['#F05138', '#ffffff', 'SWIFT'],
  kt: ['#7F52FF', '#ffffff', 'KT'],
  kotlin: ['#7F52FF', '#ffffff', 'KT'],
  dart: ['#0175C2', '#ffffff', 'DART'],
  scala: ['#DC322F', '#ffffff', 'SCALA'],
  lua: ['#2C2C7C', '#ffffff', 'LUA'],
  pl: ['#0298C3', '#ffffff', 'PERL'],
  r: ['#336DC3', '#ffffff', 'R'],
  m: ['#C1272D', '#ffffff', 'MAT'],
  mm: ['#C1272D', '#ffffff', 'MAT'],
  // Web / 前端
  html: ['#E34F26', '#ffffff', '</>'],
  htm: ['#E34F26', '#ffffff', '</>'],
  css: ['#663399', '#ffffff', 'CSS'],
  scss: ['#CD6799', '#ffffff', 'SCSS'],
  sass: ['#CD6799', '#ffffff', 'SCSS'],
  vue: ['#42B883', '#ffffff', 'VUE'],
  svelte: ['#FF3E00', '#ffffff', 'SVELTE'],
  // 数据 / 结构化
  json: ['#F7DF1E', '#323330', '{}'],
  sql: ['#00758F', '#ffffff', 'SQL'],
  csv: ['#2E7D32', '#ffffff', 'CSV'],
  db: ['#0F62FE', '#ffffff', 'DB'],
  sqlite: ['#0F62FE', '#ffffff', 'DB'],
  sqlite3: ['#0F62FE', '#ffffff', 'DB'],
  xml: ['#FF6F00', '#ffffff', 'XML'],
  svg: ['#FF6F00', '#ffffff', 'SVG'],
  // 文档
  md: ['#42A5F5', '#ffffff', 'M↓'],
  markdown: ['#42A5F5', '#ffffff', 'M↓'],
  txt: ['#90A4AE', '#ffffff', 'TXT'],
  text: ['#90A4AE', '#ffffff', 'TXT'],
  log: ['#90A4AE', '#ffffff', 'TXT'],
  pdf: ['#E5202B', '#ffffff', 'PDF'],
  doc: ['#2B579A', '#ffffff', 'DOC'],
  docx: ['#2B579A', '#ffffff', 'DOC'],
  xls: ['#217346', '#ffffff', 'XLS'],
  xlsx: ['#217346', '#ffffff', 'XLS'],
  ppt: ['#D24726', '#ffffff', 'PPT'],
  pptx: ['#D24726', '#ffffff', 'PPT'],
  // 配置 / 构建
  yml: ['#CB171E', '#ffffff', 'YML'],
  yaml: ['#CB171E', '#ffffff', 'YML'],
  toml: ['#8D6E63', '#ffffff', 'TOML'],
  ini: ['#546E7A', '#ffffff', 'CFG'],
  cfg: ['#546E7A', '#ffffff', 'CFG'],
  config: ['#546E7A', '#ffffff', 'CFG'],
  env: ['#F9A825', '#323330', 'ENV'],
  properties: ['#7B1FA2', '#ffffff', 'PROP'],
  lock: ['#37474F', '#ffffff', 'LOCK'],
  dockerfile: ['#2496ED', '#ffffff', 'DOCK'],
  docker: ['#2496ED', '#ffffff', 'DOCK'],
  makefile: ['#607D8B', '#ffffff', 'MAKE'],
  gradle: ['#02303A', '#ffffff', 'GRADLE'],
  cmake: ['#265774', '#ffffff', 'CMAKE'],
  ipynb: ['#F37726', '#ffffff', 'JNB'],
  // 脚本 / Shell
  sh: ['#89E051', '#111111', '>_'],
  bash: ['#89E051', '#111111', '>_'],
  zsh: ['#89E051', '#111111', '>_'],
  ps1: ['#012456', '#ffffff', 'PS1'],
  bat: ['#546E7A', '#ffffff', 'CMD'],
  cmd: ['#546E7A', '#ffffff', 'CMD'],
  // 打包 / 二进制
  zip: ['#FFA726', '#323330', 'ZIP'],
  tar: ['#FFA726', '#323330', 'ZIP'],
  gz: ['#FFA726', '#323330', 'ZIP'],
  '7z': ['#FFA726', '#323330', 'ZIP'],
  rar: ['#FFA726', '#323330', 'ZIP'],
  exe: ['#0078D4', '#ffffff', 'EXE'],
  msi: ['#0078D4', '#ffffff', 'EXE'],
  wasm: ['#654FF0', '#ffffff', 'WASM'],
  // 图片 / 媒体
  png: ['#8E44AD', '#ffffff', 'IMG'],
  jpg: ['#8E44AD', '#ffffff', 'IMG'],
  jpeg: ['#8E44AD', '#ffffff', 'IMG'],
  gif: ['#8E44AD', '#ffffff', 'IMG'],
  webp: ['#8E44AD', '#ffffff', 'IMG'],
  ico: ['#8E44AD', '#ffffff', 'IMG'],
  bmp: ['#8E44AD', '#ffffff', 'IMG'],
  // 版本控制
  gitignore: ['#F05032', '#ffffff', 'GIT'],
  gitattributes: ['#F05032', '#ffffff', 'GIT'],
}

/** One self-colored badge svg: rounded brand rect + short contrast mark.
 *  Mark font scales by length so 5-6 char marks (JAVA/SCALA/SWIFT) stay
 *  inside the 24×24 viewBox. */
const badgeIcon = ([bg, fg, mark], size) =>
  createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: bg }),
    createElement(
      'text',
      {
        x: 12,
        y: 16,
        textAnchor: 'middle',
        fontSize: mark.length <= 2 ? 9 : mark.length <= 4 ? 7 : 5.5,
        fontWeight: 700,
        fill: fg,
      },
      mark,
    ),
  )

/** File-type icon dispatcher: branded badge for known extensions, the
 *  neutral file icon for everything else (case-insensitive, tolerates a
 *  leading dot like ".md"). */
const fileIconByExt = (ext, size = 14) => {
  const spec =
    FILE_BADGES[
      String(ext ?? '')
        .toLowerCase()
        .replace(/^\./, '')
    ]
  return spec === undefined ? icon.file(size) : badgeIcon(spec, size)
}

    // ── utils: pure display helpers (summary / relative time / sort) ──────────
// 纯展示层辅助函数：不触碰服务端状态，供客户端视图使用并可被单测直接调用。
// 概要/详情两级展示为纯展示层（issue #105）：列表显示概要（首句/语义截断），
// 点击展开查看完整详情——存储保留完整 desc，展示层只做概要计算。
// 服务端同款逻辑见 lib/memory-text.js（summarizeDesc / firstSentence）。
const TRUNCATE_LEN = 60

/** 默认建议单条记忆长度（字符，与服务端 maxEntryLength 默认一致；面板实际
 *  值来自 GET /my-memory/api/config，取不到时回落此默认）。 */
const DEFAULT_ENTRY_LIMIT = 50

/** 句子边界：中英文句末标点 + 分号 + 换行（省略号吸收入前一句）。 */
const SENTENCE_BOUNDARY = /[。！？!?；;\n….]+/u

/** 取一段文本的首句（含边界标点；连续省略号/标点并入前一句）；无边界时整段。 */
function firstSentence(text) {
  const value = String(text ?? '')
  const match = SENTENCE_BOUNDARY.exec(value)
  if (match === null) return value
  let end = match.index + 1
  while (end < value.length && SENTENCE_BOUNDARY.test(value[end])) end += 1
  return value.slice(0, end)
}

/** 语义截断长条目（issue #105 概要/详情两级展示）：多句条目列表**总是**显示
 *  概要（首句），不截断在句子中间；单句条目仅在超长时退化为字符截断。
 *  返回 { text, truncated }——truncated 为 true 表示有可展开的详情（多句或超长）。 */
function truncateText(text, max = TRUNCATE_LEN) {
  const value = String(text ?? '').trim()
  const first = firstSentence(value)
  if (first === value) {
    if (value.length <= max) return { text: value, truncated: false }
    return { text: `${value.slice(0, max)}…`, truncated: true }
  }
  if (first.length <= max) return { text: first, truncated: true }
  return { text: `${first.slice(0, max)}…`, truncated: true }
}

/** 更新时间相对化：「刚刚」「n 分钟前」「n 小时前」「n 天前」，超过 30 天回退绝对时间。 */
function relativeTime(ts) {
  const time = Number(ts)
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 0) return strings.updatedAt(time) // 未来时间（时钟偏移）回退绝对时间
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return strings.justNow()
  if (minutes < 60) return strings.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return strings.hoursAgo(hours)
  const days = Math.floor(hours / 24)
  if (days < 30) return strings.daysAgo(days)
  return strings.updatedAt(time)
}

/** 按更新时间排序（dir: 'desc' 最新在顶 / 'asc' 最旧在顶）；返回新数组，不改原列表。 */
function sortMemories(items, dir = 'desc') {
  const copy = items.slice()
  copy.sort((a, b) => (dir === 'asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt))
  return copy
}

/** 是否超过建议长度上限（保存/输入时的精简提示用）。 */
function isOverEntryLimit(text, max = DEFAULT_ENTRY_LIMIT) {
  return String(text ?? '').length > max
}

// 导出纯函数供单测直接断言（插件只消费 apply，多余导出在 client 端无副作用）。
exports.truncateText = truncateText
exports.firstSentence = firstSentence
exports.relativeTime = relativeTime
exports.sortMemories = sortMemories
exports.isOverEntryLimit = isOverEntryLimit
exports.DEFAULT_ENTRY_LIMIT = DEFAULT_ENTRY_LIMIT

    // ── view-rows: row/entry widgets for the Memory tab ─────────────────────
// 拆分自 view.part.js（issue #110 视觉重设计）：条目卡片、空状态、排序开关、
// 新增栏与确认面板。纯渲染组件，共用 view 工厂作用域内的 strings/icon/utils。
/** 排序开关：按更新时间切换最新/最旧优先（每分区独立）。官方 Pill 承载
 *  （issue #143 试点）：active 表示当前排序方向，点击切换。 */
function SortToggle({ scope, order, onSort }) {
  return createElement(
    ui.Pill,
    {
      className: 'dsh-my-memory-sort',
      active: order === 'desc',
      'aria-label': `${strings.sortLabel()} ${scope}`,
      onClick: () => onSort(scope),
    },
    createElement(ui.IconChevronDownOutline14),
    order === 'desc' ? strings.sortNewest() : strings.sortOldest(),
  )
}

/** 空状态：无条目时的引导（hint 优先，如无会话项目提示输入项目根路径）。 */
function EmptyState({ hint }) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-empty' },
    createElement('span', { className: 'dsh-my-memory-empty-icon' }, icon.file(16)),
    createElement(
      'div',
      { className: 'dsh-my-memory-empty-body' },
      createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.empty()),
      createElement('span', { className: 'dsh-my-memory-empty-hint' }, hint ?? strings.emptyHint()),
    ),
  )
}

/** 新增条目的输入 + 保存按钮；超长时给出精简提示（issue #105）。
 *  输入用官方 Input（issue #143 试点）；保存按钮保留自研（语义绿）。 */
function AddBar({ scope, value, onChange, onAdd, entryLimit }) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-addbar-wrap' },
    createElement(
      'div',
      { className: 'dsh-my-memory-addbar' },
      createElement(ui.Input, {
        className: 'dsh-my-memory-add-input',
        placeholder: strings.addPlaceholder(),
        'aria-label': strings.addInputAria(scope),
        value,
        onChange: (event) => onChange(event.target.value),
      }),
      createElement(
        'button',
        {
          className: 'dsh-my-memory-btn-save',
          'aria-label': `${strings.add()} ${scope}`,
          onClick: onAdd,
        },
        icon.plus(14),
        strings.add(),
      ),
    ),
    isOverEntryLimit(value, entryLimit)
      ? createElement(
          'div',
          { className: 'dsh-my-memory-entry-hint' },
          strings.entryTooLongHint(value.length, entryLimit),
        )
      : null,
  )
}

function buildRows(items, scope, editing, onEdit, onEditDesc, onCancelEdit, onConfirm, expanded, onToggle) {
  return items.map((item) => {
    const isEditing = editing !== null && editing.scope === scope && editing.id === item.id
    const key = `${scope}/${item.id}`
    return createElement(MemoryRow, {
      key,
      item,
      isEditing,
      isExpanded: expanded.has(key),
      editingDesc: isEditing ? editing.desc : '',
      onEdit: () => onEdit(scope, item.id, item.desc),
      onEditDesc,
      onCancelEdit,
      onSaveEdit: () => onConfirm({ kind: 'update', scope, id: item.id, desc: editing.desc }),
      onDelete: () => onConfirm({ kind: 'delete', scope, id: item.id, desc: item.desc }),
      onToggle: () => onToggle(key),
    })
  })
}

function IconButton({ className, label, onClick, children }) {
  return createElement('button', { className, 'aria-label': label, onClick }, children)
}

/** 编辑态：输入 + 保存/取消，保留卡片底与操作/内容分离。输入用官方
 *  Input、取消用官方 Button（issue #143 试点）；保存保留自研（语义绿）。 */
function MemoryRowEdit({ editingDesc, onEditDesc, onSaveEdit, onCancelEdit }) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-editing' },
    createElement(ui.Input, {
      className: 'dsh-my-memory-add-input',
      value: editingDesc,
      onChange: (event) => onEditDesc(event.target.value),
    }),
    createElement(
      'div',
      { className: 'dsh-my-memory-actions' },
      createElement(
        'button',
        { className: 'dsh-my-memory-btn-save', onClick: onSaveEdit },
        icon.check(14),
        strings.save(),
      ),
      createElement(
        ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          onClick: onCancelEdit,
          icon: createElement(ui.IconCloseOutline16),
        },
        strings.cancel(),
      ),
    ),
  )
}

/** 一条记忆卡片：描述（+截断/展开）+ 操作图标组 + 元数据（分类/置信度/
 *  冲突/演进历史，issue #78）+ 更新时间。 */
function MemoryRow({
  item,
  isEditing,
  isExpanded,
  editingDesc,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggle,
}) {
  if (isEditing) return createElement(MemoryRowEdit, { editingDesc, onEditDesc, onSaveEdit, onCancelEdit })
  const cut = truncateText(item.desc)
  const shown = isExpanded ? item.desc : cut.text
  return createElement(
    'div',
    { className: 'dsh-my-memory-row' },
    createElement(
      'div',
      { className: 'dsh-my-memory-row-head' },
      createElement(
        'div',
        { className: 'dsh-my-memory-row-desc-wrap' },
        createElement('span', { className: 'dsh-my-memory-desc' }, shown),
        cut.truncated
          ? createElement(
              'button',
              {
                className: `dsh-my-memory-expand${isExpanded ? ' dsh-my-memory-expand-open' : ''}`,
                'aria-label': isExpanded ? strings.collapse() : strings.expand(),
                onClick: onToggle,
              },
              icon.chevronDown(14),
              isExpanded ? strings.collapse() : strings.expand(),
            )
          : null,
      ),
      createElement(
        'div',
        { className: 'dsh-my-memory-actions' },
        createElement(
          IconButton,
          { className: 'dsh-my-memory-iconbtn', label: `${strings.edit()} ${item.id}`, onClick: onEdit },
          icon.pencil(14),
        ),
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
            label: `${strings.delete()} ${item.id}`,
            onClick: onDelete,
          },
          icon.trash(14),
        ),
      ),
    ),
    createElement(MetadataRow, { item, isExpanded, onToggle }),
  )
}

/** 概要预览行（issue #105）：add/update 内容超长时提示「完整内容保存 + 显示概要」。 */
function SummaryPreview({ desc }) {
  const summary = truncateText(desc, TRUNCATE_LEN)
  return createElement(
    'div',
    { className: 'dsh-my-memory-confirm-summary' },
    createElement('span', { className: 'dsh-my-memory-confirm-summary-label' }, strings.summaryPreview()),
    createElement('span', { className: 'dsh-my-memory-confirm-summary-text' }, summary.text),
  )
}

/** 自定义确认面板（ask 模式，非原生 confirm）：删除红、保存绿。
 *  add/update 时若内容超长，显示概要预览（完整内容仍保存，issue #105）。 */
function ConfirmPanel({ confirm, onCancel, onOk, entryLimit }) {
  const isDelete = confirm.kind === 'delete'
  const text = CONFIRM_TEXTS[confirm.kind]()
  const showSummary = !isDelete && isOverEntryLimit(confirm.desc, entryLimit)
  return createElement(
    'div',
    { className: `dsh-my-memory-confirm dsh-my-memory-confirm-${isDelete ? 'delete' : 'save'}` },
    createElement(
      'div',
      { className: 'dsh-my-memory-confirm-head' },
      isDelete ? icon.trash(15) : icon.check(15),
      createElement('div', { className: 'dsh-my-memory-confirm-text' }, text),
    ),
    createElement('div', { className: 'dsh-my-memory-confirm-desc' }, confirm.desc),
    showSummary ? createElement(SummaryPreview, { desc: confirm.desc }) : null,
    createElement(
      'div',
      { className: 'dsh-my-memory-confirm-actions' },
      createElement(
        'button',
        {
          className: `dsh-my-memory-confirm-ok dsh-my-memory-confirm-ok-${isDelete ? 'delete' : 'save'}`,
          onClick: onOk,
        },
        isDelete ? icon.trash(14) : icon.check(14),
        isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
      ),
      createElement(
        'button',
        { className: 'dsh-my-memory-confirm-cancel', onClick: onCancel },
        icon.close(14),
        strings.cancel(),
      ),
    ),
  )
}

/** 确认面板标题文案（按 kind 取；未知 kind 回落删除文案）。 */
const CONFIRM_TEXTS = {
  add: () => strings.confirmAdd(),
  update: () => strings.confirmUpdate(),
  delete: () => strings.confirmDelete(),
}

/** Path input + load/refresh buttons + consent note. 路径输入用官方 Input、
 *  加载/刷新用官方 Button（size sm，issue #143 试点）。 */
function Toolbar({ pathInput, onInput, onLoad, onRefresh }) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-toolbar' },
    createElement(
      'div',
      { className: 'dsh-my-memory-pathbar' },
      createElement(ui.Input, {
        className: 'dsh-my-memory-path-input',
        icon: createElement(ui.IconFolderOpenOutline16),
        placeholder: strings.projectHint(),
        'aria-label': strings.pathInputAria(),
        title: strings.pathInputAria(),
        value: pathInput,
        onChange: (event) => onInput(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') onLoad(pathInput)
        },
      }),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': strings.loadProject(),
          onClick: () => onLoad(pathInput),
          icon: createElement(ui.IconFolderOpenOutline16),
        },
        strings.loadProject(),
      ),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          'aria-label': strings.refresh(),
          onClick: () => onRefresh(pathInput),
          icon: createElement(ui.IconRefreshOutline14),
        },
        strings.refresh(),
      ),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.confirmHint()),
  )
}

    // ── candidates: 待确认候选 / 元数据行 / 演进历史（issue #78）────────────────
// 拆分自 view-rows.part.js：与条目卡片解耦，控制单文件行数（≤400 门禁）。
/** 一条待确认候选（issue #78）：分类徽标 + 描述 + 范围 + 来源 + 确认/拒弃。 */
function CandidateRow({ candidate, busy, onConfirm, onDismiss }) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-row dsh-my-memory-row-candidate' },
    createElement(
      'div',
      { className: 'dsh-my-memory-row-head' },
      createElement(
        'div',
        { className: 'dsh-my-memory-row-desc-wrap' },
        createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(candidate.category)),
        createElement('span', { className: 'dsh-my-memory-desc' }, candidate.desc),
      ),
      createElement(
        'div',
        { className: 'dsh-my-memory-actions' },
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-confirm',
            label: `${strings.confirmCandidate()} ${candidate.id}`,
            onClick: onConfirm,
          },
          icon.check(14),
        ),
        createElement(
          IconButton,
          {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
            label: `${strings.dismissCandidate()} ${candidate.id}`,
            onClick: onDismiss,
          },
          icon.close(14),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-my-memory-meta' },
      createElement('span', { className: 'dsh-my-memory-meta-icon' }, icon.clock(11)),
      relativeTime(candidate.createdAt),
      createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
      strings.candidateScopeBadge(candidate.scope),
      createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
      strings.candidateSource(candidate.source?.sessionId),
    ),
    busy ? createElement('div', { className: 'dsh-my-memory-entry-hint' }, strings.loading()) : null,
  )
}

/** 演进历史控件：展开/收起按钮 + 历史条目列表（有 history 才渲染）。 */
function HistoryControl({ item, isExpanded, onToggle }) {
  const hasHistory = Array.isArray(item.history) && item.history.length > 0
  if (!hasHistory) return null
  return createElement(
    'span',
    null,
    createElement(
      'button',
      {
        className: 'dsh-my-memory-expand',
        'aria-label': isExpanded ? strings.collapse() : strings.historyLabel(),
        onClick: onToggle,
      },
      icon.chevronDown(14),
      isExpanded ? strings.collapse() : strings.historyLabel(),
    ),
    isExpanded
      ? item.history.map((entry, index) =>
          createElement(
            'span',
            { key: `${entry.at}-${index}`, className: 'dsh-my-memory-history-entry' },
            `${strings.historyEntry(entry.action)} · ${relativeTime(entry.at)}`,
          ),
        )
      : null,
  )
}

/** 记忆条目元数据行（issue #78）：分类徽标 + 置信度 + 矛盾标记 + 演进历史
 *  （展开时显示 history 列表）。confidence 缺失/非数字时不渲染置信度徽标
 *  （之前直接拼 "置信度 ${n}"，缺失时出现"置信度 undefined"）。 */
function MetadataRow({ item, isExpanded, onToggle }) {
  const hasConfidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0
  return createElement(
    'div',
    { className: 'dsh-my-memory-meta' },
    createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(item.category)),
    hasConfidence
      ? createElement('span', { className: 'dsh-my-memory-conf-badge' }, strings.confidenceLabel(item.confidence))
      : null,
    item.status === 'conflict-pending'
      ? createElement('span', { className: 'dsh-my-memory-conflict-badge' }, strings.statusConflict())
      : null,
    createElement('span', { className: 'dsh-my-memory-meta-sep' }, '·'),
    createElement('span', { className: 'dsh-my-memory-meta-icon' }, icon.clock(11)),
    relativeTime(item.updatedAt),
    createElement(HistoryControl, { item, isExpanded, onToggle }),
  )
}

/** 待确认候选区块（issue #78）：自动提取的记忆候选，确认后写入（渐进
 *  合并）、拒弃则丢弃——记忆绝不静默变更。 */
function CandidatesBlock({ candidates, busy, onConfirmCandidate, onDismissCandidate }) {
  const list = Array.isArray(candidates) ? candidates : []
  return createElement(
    'div',
    { className: 'dsh-my-memory-candidates' },
    createElement(
      'div',
      { className: 'dsh-my-memory-section-head' },
      createElement('span', { className: 'dsh-my-memory-section-title' }, strings.candidatesSection()),
      createElement(
        ui.Pill,
        { className: 'dsh-my-memory-badge' },
        strings.countBadge(strings.candidatesSection(), list.length),
      ),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, strings.candidatesNote()),
    list.length === 0
      ? createElement('div', { className: 'dsh-my-memory-empty' }, strings.candidatesEmpty())
      : list.map((candidate) =>
          createElement(CandidateRow, {
            key: candidate.id,
            candidate,
            busy,
            onConfirm: () => onConfirmCandidate(candidate.id),
            onDismiss: () => onDismissCandidate(candidate.id),
          }),
        ),
  )
}

    // ── view: Memory settings tab ─────────────────────────────────────────
/** Load both scopes: global always; project only when a cwd is given. */
function fetchAll(cwd) {
  const projectCwd = cwd.trim()
  const globalP = fetchMemory('global', '')
  const projectP =
    projectCwd === ''
      ? Promise.resolve({ scope: 'project', cwd: '', projectRoot: '', items: [] })
      : fetchMemory('project', projectCwd)
  return Promise.all([globalP, projectP]).then(([global, project]) => ({ global, project }))
}

function mergeScope(data, scope, value) {
  return scope === 'global' ? { ...data, global: value } : { ...data, project: value }
}

/** Data actions bound to the state setters; error: null | 'load' | 'save'. */
function createActions({ setData, setLoading, setError, setSaved, setCandidates, setCandidateBusy }) {
  const applyValue = (value) => {
    setData(value)
    setLoading(false)
  }
  const refreshWith = (fetcher, cwd) => {
    setLoading(true)
    setError(null)
    setSaved(false)
    fetcher(cwd)
      .then(applyValue)
      .catch(() => {
        setLoading(false)
        setError('load')
      })
  }
  const loadCandidates = () => {
    fetchCandidates()
      .then((items) => setCandidates(items))
      .catch(() => setCandidates([]))
  }
  const run = (cwd) => refreshWith(fetchAll, cwd)
  const refreshCandidates = () => {
    setCandidateBusy(false)
    loadCandidates()
  }
  return { load: run, refresh: run, loadCandidates, refreshCandidates }
}

/** 候选确认 / 拒弃处理器（issue #78）：写入/丢弃都要用户显式动作（服务端强制 confirmed），成功后刷新候选与分区。 */
function createCandidateHandlers({ candidateBusy, setCandidateBusy, setSaved, setError, actions, pathInput }) {
  const busy = () => {
    if (candidateBusy) return true
    setCandidateBusy(true)
    return false
  }
  const settle = () => setCandidateBusy(false)
  const refreshScope = (value, pathInput) => {
    actions.loadCandidates()
    if (value?.scope === 'project' && value?.cwd !== '') actions.load(value.cwd)
    else actions.refresh(pathInput)
  }
  const onConfirmCandidate = (id) => {
    if (busy()) return
    confirmCandidate(id)
      .then((value) => {
        settle()
        setSaved(true)
        refreshScope(value, pathInput)
      })
      .catch(() => {
        settle()
        setError('save')
      })
  }
  const onDismissCandidate = (id) => {
    if (busy()) return
    dismissCandidate(id)
      .then(() => {
        settle()
        actions.loadCandidates()
      })
      .catch(() => {
        settle()
        setError('save')
      })
  }
  return { onConfirmCandidate, onDismissCandidate }
}

function MemoryView() {
  const [data, setData] = useState(null)
  const [pathInput, setPathInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [drafts, setDrafts] = useState({ global: '', project: '' })
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [sortOrder, setSortOrder] = useState({ global: 'desc', project: 'desc' })
  const [entryLimit, setEntryLimit] = useState(DEFAULT_ENTRY_LIMIT)
  const [candidates, setCandidates] = useState([])
  const [candidateBusy, setCandidateBusy] = useState(false)
  const actions = createActions({ setData, setLoading, setError, setSaved, setCandidates, setCandidateBusy })

  useEffect(() => {
    // 面板打开拉取引导配置（issue #105；失败回落默认值），再解析 cwd 加载记忆（issue #104）。
    fetchConfig()
      .then((value) => setEntryLimit(value.maxEntryLength))
      .catch(() => {})
    fetchSessionCwd(currentSessionId()).then((cwd) => actions.load(cwd))
    actions.loadCandidates()
  }, [])

  const commit = createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming })
  const { onConfirmCandidate, onDismissCandidate } = createCandidateHandlers({
    candidateBusy,
    setCandidateBusy,
    setSaved,
    setError,
    actions,
    pathInput,
  })
  return renderRoot({
    data,
    loading,
    error,
    pathInput,
    saved,
    drafts,
    editing,
    confirming,
    expanded,
    sortOrder,
    entryLimit,
    candidates,
    candidateBusy,
    actions,
    setDrafts,
    setEditing,
    setExpanded,
    setSortOrder,
    setConfirming,
    setPathInput,
    commit,
    onConfirmCandidate,
    onDismissCandidate,
  })
}

/** 根视图渲染（保持 MemoryView 简洁；全部状态经 props 传入）。 */
function renderRoot({
  data,
  loading,
  error,
  pathInput,
  saved,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  candidates,
  candidateBusy,
  actions,
  setDrafts,
  setEditing,
  setExpanded,
  setSortOrder,
  setConfirming,
  setPathInput,
  commit,
  onConfirmCandidate,
  onDismissCandidate,
}) {
  return createElement(
    'div',
    { className: 'dsh-my-memory-root' },
    createElement(Toolbar, { pathInput, onInput: setPathInput, onLoad: actions.load, onRefresh: actions.refresh }),
    error === null ? null : createElement(ErrorBanner, { kind: error, onRetry: () => actions.load(pathInput) }),
    loading
      ? createElement(
          'div',
          { className: 'dsh-my-memory-status dsh-my-memory-loading' },
          createElement('span', { className: 'dsh-my-memory-spinner' }),
          strings.loading(),
        )
      : data === null
        ? null
        : createElement(Sections, {
            data,
            saved,
            drafts,
            editing,
            confirming,
            expanded,
            sortOrder,
            entryLimit,
            candidates,
            candidateBusy,
            onDraft: (scope, value) => setDrafts({ ...drafts, [scope]: value }),
            onEdit: (scope, id, desc) => setEditing({ scope, id, desc }),
            onEditDesc: (value) => setEditing({ ...editing, desc: value }),
            onCancelEdit: () => setEditing(null),
            onConfirm: (confirm) => setConfirming(confirm),
            onCancelConfirm: () => setConfirming(null),
            onToggle: (key) =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              }),
            onSort: (scope) => setSortOrder((prev) => ({ ...prev, [scope]: prev[scope] === 'desc' ? 'asc' : 'desc' })),
            onCommit: commit,
            onConfirmCandidate,
            onDismissCandidate,
          }),
  )
}

/** Load-failure banner with a retry entry; write-failure banner without. */
function ErrorBanner({ kind, onRetry }) {
  if (kind === 'load') {
    return createElement(
      'div',
      { className: 'dsh-my-memory-error' },
      strings.loadError(),
      createElement(
        ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          className: 'dsh-my-memory-btn-retry',
          onClick: onRetry,
          icon: createElement(ui.IconRefreshOutline14),
        },
        strings.retry(),
      ),
    )
  }
  return kind === 'save' ? createElement('div', { className: 'dsh-my-memory-error' }, strings.saveFailed()) : null
}

/** One confirmed write (add / update / delete) → POST + refresh the scope. */
function createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming }) {
  return (confirm) => {
    setSaved(false)
    setError(null)
    writeMemory({
      action: confirm.kind,
      scope: confirm.scope,
      cwd: confirm.scope === 'project' ? data.project.cwd : '',
      id: confirm.id,
      desc: confirm.desc,
    })
      .then((value) => {
        setSaved(true)
        setDrafts((d) => ({ ...d, [confirm.scope]: '' }))
        setEditing(null)
        setConfirming(null)
        setData((d) => mergeScope(d, confirm.scope, value))
      })
      .catch(() => setError('save'))
  }
}

/** Two scopes side by side (global + project), plus pending candidates (issue #78). */
function Sections({
  data,
  saved,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  candidates,
  candidateBusy,
  onDraft,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onConfirm,
  onCancelConfirm,
  onToggle,
  onSort,
  onCommit,
  onConfirmCandidate,
  onDismissCandidate,
}) {
  const blockProps = {
    drafts,
    editing,
    confirming,
    expanded,
    sortOrder,
    entryLimit,
    onDraft,
    onEdit,
    onEditDesc,
    onCancelEdit,
    onConfirm,
    onCancelConfirm,
    onToggle,
    onSort,
    onCommit,
  }
  return createElement(
    'div',
    { className: 'dsh-my-memory-sections' },
    createElement(SectionBlock, {
      scope: 'global',
      title: strings.globalSection(),
      note: strings.globalNote(),
      data: data.global,
      ...blockProps,
    }),
    createElement(SectionBlock, {
      scope: 'project',
      title: strings.projectSection(),
      note: strings.projectNote(),
      data: data.project,
      ...blockProps,
    }),
    createElement(CandidatesBlock, {
      candidates,
      busy: candidateBusy,
      onConfirmCandidate,
      onDismissCandidate,
    }),
    saved
      ? createElement('div', { className: 'dsh-my-memory-status dsh-my-memory-saved' }, icon.check(14), strings.saved())
      : null,
  )
}

/** One scope's section: 区块标题 / 徽标 / 排序开关 / 列表 / 新增栏 / 确认面板。 */
function SectionBlock({
  scope,
  title,
  note,
  data,
  drafts,
  editing,
  confirming,
  expanded,
  sortOrder,
  entryLimit,
  onDraft,
  onEdit,
  onEditDesc,
  onCancelEdit,
  onConfirm,
  onCancelConfirm,
  onToggle,
  onSort,
  onCommit,
}) {
  const isProject = scope === 'project'
  // 徽标：数量（标题已含 scope 标签）；项目加载后附带项目根路径信息。
  const badge =
    scope === 'global'
      ? strings.countOnly(data.items.length)
      : data.cwd !== ''
        ? strings.projectBadge(data.projectRoot, data.items.length)
        : strings.countOnly(data.items.length)
  const order = sortOrder[scope]
  const items = sortMemories(data.items, order)
  const rows = buildRows(items, scope, editing, onEdit, onEditDesc, onCancelEdit, onConfirm, expanded, onToggle)
  // 空状态：无会话项目时提示输入项目根路径（issue #104），否则提示新增（issue #110 视觉统一）。
  const emptyHint = isProject && data.cwd === '' ? strings.projectEmptyHint() : undefined
  return createElement(
    'div',
    { className: `dsh-my-memory-section${isProject ? ' dsh-my-memory-section-project' : ''}` },
    createElement(
      'div',
      { className: 'dsh-my-memory-section-head' },
      createElement('span', { className: 'dsh-my-memory-section-title' }, title),
      createElement(ui.Pill, { className: 'dsh-my-memory-badge' }, badge),
      createElement(SortToggle, { scope, order, onSort }),
    ),
    createElement('div', { className: 'dsh-my-memory-note' }, note),
    rows.length === 0 ? createElement(EmptyState, { hint: emptyHint }) : rows,
    createElement(AddBar, {
      scope,
      value: drafts[scope],
      entryLimit,
      onChange: (value) => onDraft(scope, value),
      onAdd: () => onConfirm({ kind: 'add', scope, desc: drafts[scope] }),
    }),
    confirming !== null && confirming.scope === scope
      ? createElement(ConfirmPanel, {
          confirm: confirming,
          entryLimit,
          onCancel: onCancelConfirm,
          onOk: () => onCommit(confirming),
        })
      : null,
  )
}

    // ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → 记忆），
// 不依赖 dsh-better-sidebar。slots 服务是官方 client 服务，通过
// ctx.get 动态获取——服务缺省时静默跳过（不注册 tab，server 端记忆
// 能力不受影响）。
exports.apply = function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(STYLE_TAG, 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-memory: styles')

  const slots = ctx.get('slots')
  if (slots === undefined) return

  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'my-memory',
            order: 92,
            label: () => strings.title(),
          },
          MemoryView,
        ),
      ),
    'dsh-my-memory: settings tab registration',
  )
}


    return module.exports
  },
})
