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
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles
 * `src/client/parts/*.ts` to `lib/.client-build/parts/*.js` and splices those
 * fragments into the PART placeholder markers below (each piece is plain
 * function-declaration text sharing this factory scope; the browser
 * ModuleLoader does not support relative-path require) and writes
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
    let ui = null
    try {
      ui = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      ui = null // 宿主模块不可用时降级
    }

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    "use strict";
// ── i18n ──────────────────────────────────────────────────────────────
function isZh() {
    // 宿主 locale（dsh-client-locale 同步到 <html lang>）优先；空则回退浏览器语言。
    try {
        const host = (document.documentElement.lang || '').toLowerCase();
        if (host !== '')
            return host.startsWith('zh');
    }
    catch {
        /* 非浏览器环境（node 渲染）无 document */
    }
    try {
        return (navigator.language || 'en').toLowerCase().startsWith('zh');
    }
    catch {
        return false;
    }
}
const strings = {
    title: () => (isZh() ? '记忆' : 'Memory'),
    globalSection: () => (isZh() ? '全局记忆' : 'Global memory'),
    projectSection: () => (isZh() ? '项目记忆' : 'Project memory'),
    retry: () => (isZh() ? '重试' : 'Retry'),
    loading: () => (isZh() ? '加载中…' : 'Loading…'),
    loadError: () => (isZh() ? '加载失败' : 'Load failed'),
    empty: () => (isZh() ? '暂无记忆' : 'No memories yet'),
    emptyHint: () => (isZh() ? '在下方输入框添加第一条记忆' : 'Add your first memory below'),
    projectEmptyHint: () => isZh()
        ? '当前无项目会话；打开项目会话后，这里会显示该项目的记忆'
        : 'No active project session; open one to see its project memory',
    addPlaceholder: () => isZh()
        ? '输入要记住的内容（建议 1-2 句话概括，如：回复使用中文）'
        : 'Type what to remember (keep it to 1-2 sentences, e.g. reply in Chinese)',
    // ── issue #105 记忆内容精简：超长提示 / 概要预览 ──
    entryTooLongHint: (current, limit) => isZh()
        ? `内容过长（${current} 字，建议 ≤ ${limit} 字），建议精简为 1-2 句`
        : `Entry too long (${current} chars, suggested ≤ ${limit}); keep it to 1-2 sentences`,
    summaryPreview: () => isZh() ? '将保存完整内容；列表与注入显示概要：' : 'Full content is saved; list & injection show the summary: ',
    add: () => (isZh() ? '新增' : 'Add'),
    save: () => (isZh() ? '保存' : 'Save'),
    cancel: () => (isZh() ? '取消' : 'Cancel'),
    edit: () => (isZh() ? '编辑' : 'Edit'),
    delete: () => (isZh() ? '删除' : 'Delete'),
    confirmAdd: () => (isZh() ? '确认新增这条记忆？' : 'Add this memory?'),
    confirmUpdate: () => (isZh() ? '确认保存这条记忆的修改？' : 'Save this memory change?'),
    confirmDelete: () => isZh() ? '确定删除这条记忆？此操作不可撤销。' : 'Delete this memory? This cannot be undone.',
    confirmSave: () => (isZh() ? '确认保存' : 'Confirm save'),
    confirmDeleteBtn: () => (isZh() ? '确认删除' : 'Confirm delete'),
    saved: () => (isZh() ? '已保存' : 'Saved'),
    saveFailed: () => (isZh() ? '操作失败' : 'Operation failed'),
    globalNote: () => isZh()
        ? '全局记忆在会话开始时注入系统提示词（agent 始终携带）；存于 $DSH_HOME/memory.json'
        : 'Global memories are injected into the system prompt at session start; stored in $DSH_HOME/memory.json',
    projectNote: () => isZh()
        ? '项目记忆按项目隔离，仅该项目会话可见；存于 $DSH_HOME/memory/projects/（按项目根路径哈希分文件）'
        : 'Project memories are scoped to this project only; stored under $DSH_HOME/memory/projects/ (one file per project-root hash)',
    confirmHint: () => isZh() ? '所有新增 / 修改 / 删除都需要你确认' : 'Every add / edit / delete needs your confirmation',
    updatedPrefix: () => (isZh() ? '更新于 ' : 'Updated '),
    updatedAt: (ts) => isZh() ? `更新于 ${new Date(ts).toLocaleString()}` : `Updated ${new Date(ts).toLocaleString()}`,
    // ── issue #110 视觉重设计：徽标分类/数量、相对时间、排序、截断展开 ──
    globalScope: () => (isZh() ? '全局' : 'Global'),
    projectScope: () => (isZh() ? '项目' : 'Project'),
    countOnly: (n) => (isZh() ? `${n} 条` : `${n}`),
    addInputAria: (scope) => isZh() ? `新增记忆内容（${scope === 'project' ? '项目' : '全局'}）` : `New memory (${scope})`,
    justNow: () => (isZh() ? '刚刚' : 'just now'),
    minutesAgo: (n) => (isZh() ? `${n} 分钟前` : `${n} min ago`),
    hoursAgo: (n) => (isZh() ? `${n} 小时前` : `${n} hr ago`),
    daysAgo: (n) => (isZh() ? `${n} 天前` : `${n} d ago`),
    sortLabel: () => (isZh() ? '按更新时间排序' : 'Sort by updated'),
    sortNewest: () => (isZh() ? '最新优先' : 'Newest first'),
    sortOldest: () => (isZh() ? '最旧优先' : 'Oldest first'),
    expand: () => (isZh() ? '展开' : 'Expand'),
    collapse: () => (isZh() ? '收起' : 'Collapse'),
    categoryLabel: (category) => ({
        preference: isZh() ? '偏好' : 'Preference',
        fact: isZh() ? '事实' : 'Fact',
        project: isZh() ? '项目' : 'Project',
        stack: isZh() ? '技术栈' : 'Stack',
        workflow: isZh() ? '工作流' : 'Workflow',
    })[category] ?? (isZh() ? '事实' : 'Fact'),
    confidenceLabel: (n) => (isZh() ? `置信度 ${n}` : `Confidence ${n}`),
    sourceAgentLabel: (sessionId) => isZh() ? `agent 保存 · ${sessionId.slice(0, 8)}` : `saved by agent · ${sessionId.slice(0, 8)}`,
    statusConflict: () => (isZh() ? '待处理矛盾' : 'Conflict'),
    conflictNote: () => isZh()
        ? '内容曾更新，与旧版本存在差异，待你处理：确认保留当前版本，或改写后再保存。'
        : 'Updated content differs from the previous version — review it.',
    sourceLabel: () => (isZh() ? '来源会话' : 'Source session'),
    historyLabel: () => (isZh() ? '演进历史' : 'History'),
    historyEntry: (action) => isZh()
        ? action === 'reinforce'
            ? '多次出现，置信度提升'
            : action === 'conflict'
                ? '内容更新（可能矛盾）'
                : '新增'
        : action,
    noHistory: () => (isZh() ? '暂无演进历史' : 'No history yet'),
    // ── issue #193 确认卡对齐 ask 范式：条带标题 / 范围 / 分类 / footer 文案 ──
    scopeUnknown: () => (isZh() ? '范围未标注' : 'Scope not stated'),
    askScopeLabel: () => (isZh() ? '记忆范围' : 'Memory scope'),
    askScopeLocked: () => isZh() ? '范围由请求方决定，确认卡内不可更改' : 'Scope is fixed by the request and cannot be changed here',
    askCategoryLabel: () => (isZh() ? '分类' : 'Category'),
    askContentLabel: () => (isZh() ? '内容' : 'Content'),
    askSaveTitle: () => (isZh() ? 'agent 请求保存记忆' : 'Agent requests saving a memory'),
    askDeleteTitle: () => (isZh() ? 'agent 请求删除记忆' : 'Agent requests deleting a memory'),
    askAllowSave: () => (isZh() ? '允许保存' : 'Allow save'),
    askAllowDelete: () => (isZh() ? '删除这条记忆' : 'Delete this memory'),
    askDeleteArmed: () => (isZh() ? '确认删除（不可撤销）' : 'Confirm delete (irreversible)'),
    askReject: () => (isZh() ? '拒绝' : 'Reject'),
    askNoteSave: () => isZh() ? '允许后写入记忆 · 记忆绝不静默变更' : 'Writes the memory on allow · memories never change silently',
    askNoteDelete: () => isZh() ? '删除不可撤销 · 记忆绝不静默变更' : 'Deletion is irreversible · memories never change silently',
    // ── issue #465 全局提示词（与记忆并列但完全隔离）──
    promptsSection: () => (isZh() ? '全局提示词' : 'Global prompts'),
    // ── agent 记忆（issue #502）：第四个 tab ──
    agentMemorySection: () => (isZh() ? 'Agent 记忆' : 'Agent memory'),
    agentMemoryNote: () => isZh()
        ? 'agent 自主维护的跨会话记忆，与上面的全局/项目记忆相互独立。正文不注入上下文——只有 agent 主动读取时才消耗 token；这里的时间与次数只给你看，agent 看不到也改不了。'
        : 'Cross-session memory the agent maintains on its own, independent of the global/project memory above. Bodies are never injected into context — only an explicit read by the agent costs tokens; the timestamps and counts below are for you only (the agent cannot see or change them).',
    agentMemoryEmpty: () => (isZh() ? '还没有记忆' : 'No memories yet'),
    agentMemoryEmptyHint: () => isZh()
        ? '这是正常状态——agent 只在遇到下次会话仍有用、且代码里推不出来的信息时才会写。'
        : 'That is normal: the agent only writes when something is useful in a later session and cannot be derived from the code.',
    agentMemoryCreated: (value) => (isZh() ? `创建 ${value}` : `created ${value}`),
    agentMemoryRead: (count, value) => isZh() ? `读过 ${count} 次（最近 ${value}）` : `read ${count}× (last ${value})`,
    agentMemoryArchived: () => (isZh() ? '已归档（长期未读）' : 'archived (long unread)'),
    agentMemoryArchiveTitle: (count) => (isZh() ? `已归档（${count}）` : `Archived (${count})`),
    agentMemoryNever: () => (isZh() ? '从未' : 'never'),
    agentMemoryToday: () => (isZh() ? '今天' : 'today'),
    agentMemoryDaysAgo: (days) => (isZh() ? `${days} 天前` : `${days}d ago`),
    agentMemoryEdit: () => (isZh() ? '编辑' : 'Edit'),
    agentMemoryCancel: () => (isZh() ? '取消' : 'Cancel'),
    agentMemorySave: () => (isZh() ? '保存' : 'Save'),
    agentMemoryDelete: () => (isZh() ? '删除' : 'Delete'),
    agentMemoryRestore: () => (isZh() ? '恢复' : 'Restore'),
    agentMemorySaveFailed: () => (isZh() ? '保存失败' : 'Save failed'),
    agentMemoryScopeGlobal: () => (isZh() ? '全局' : 'Global'),
    agentMemoryScopeProject: () => (isZh() ? '项目' : 'Project'),
    agentMemoryDeleteTitle: () => (isZh() ? '删除这份 agent 记忆' : 'Delete this agent memory'),
    agentMemoryDeleteNote: () => isZh()
        ? '正文与索引元数据一并移除，不可撤销（agent 下次会话也读不到）'
        : 'Body and index metadata are removed for good (the agent will not see it in later sessions either)',
    promptsScope: () => (isZh() ? '全局提示词' : 'Global prompts'),
    promptsNote: () => isZh()
        ? '每轮组装时全量按序注入系统提示（启用即注入、停用即不注入；不参与记忆的评分与条数上限）——存于 $DSH_HOME/memory/prompts.json'
        : 'Every enabled prompt is injected into the system prompt in full order each turn (disabled = not injected; never scored or capped by the memory limits) — stored in $DSH_HOME/memory/prompts.json',
    promptsEmpty: () => (isZh() ? '暂无提示词' : 'No prompts yet'),
    promptsEmptyHint: () => (isZh() ? '在下方新增第一条全局提示词' : 'Add your first global prompt below'),
    promptsAddPlaceholder: () => (isZh() ? '提示词标题（如：中文思考）' : 'Prompt title (e.g. Think in Chinese)'),
    promptsTextPlaceholder: () => isZh() ? '提示词正文（将完整注入系统提示）' : 'Prompt body (injected in full into the system prompt)',
    promptsAddInputAria: () => (isZh() ? '新增提示词标题' : 'New prompt title'),
    promptsTextInputAria: () => (isZh() ? '新增提示词正文' : 'New prompt body'),
    promptEnabled: () => (isZh() ? '已启用' : 'Enabled'),
    promptDisabled: () => (isZh() ? '已停用' : 'Disabled'),
    promptToggleOn: () => (isZh() ? '启用' : 'Enable'),
    promptToggleOff: () => (isZh() ? '停用' : 'Disable'),
    promptMoveUp: () => (isZh() ? '上移' : 'Move up'),
    promptMoveDown: () => (isZh() ? '下移' : 'Move down'),
    promptBuiltin: () => (isZh() ? '内置' : 'Builtin'),
    promptHint: () => isZh()
        ? '启用的提示词全量按序注入，不评分不截断'
        : 'Enabled prompts are injected in full order — never scored, never truncated',
    confirmAddPrompt: () => (isZh() ? '确认新增这条提示词？' : 'Add this prompt?'),
    confirmUpdatePrompt: () => (isZh() ? '确认保存这条提示词的修改？' : 'Save this prompt change?'),
    confirmDeletePrompt: () => isZh() ? '确定删除这条提示词？此操作不可撤销。' : 'Delete this prompt? This cannot be undone.',
    promptCount: (n) => (isZh() ? `${n} 条` : `${n}`),
};
// 导出给其他 part 文件使用

    "use strict";
// ── styles：按 docs/原型重构/dsh-my-memory-v2.html 一比一复刻 ─────────────
// 设计值直接取自原型（浅色单主题）：卡片白底、#e8eaee 描边、#2f6fed 主色、
// 分类徽标软底、5 点置信度、居中确认弹层。类名沿用 dsh-my-memory-* 契约，
// 只重写取值与结构间距。注入在 activate，卸载时移除。
const STYLES = `
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
@keyframes dsh-my-memory-spin { to { transform:rotate(360deg); } }
@keyframes dsh-my-memory-fade { from { opacity:0; } }
@keyframes dsh-my-memory-pop { from { opacity:0; transform:translateY(6px) scale(.985); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-my-memory-overlay, .dsh-my-memory-ask-card { animation:none; }
}
`.trim();
const STYLE_TAG = 'data-dsh-my-memory';
// 导出给其他 part 文件使用

    "use strict";
// ── api: fetch helpers for the Memory views ────────────────────────────
const API_BASE = '/my-memory/api';
/** One GET memory payload into { scope, cwd, projectRoot, items }. */
function normalizeMemory(value) {
    return {
        scope: value.scope ?? 'global',
        cwd: value.cwd ?? '',
        projectRoot: value.projectRoot ?? '',
        items: Array.isArray(value.items) ? value.items : [],
    };
}
/** GET /my-memory/api/memory?scope=…&cwd=… → normalized value; rejects on bad responses. */
function fetchMemory(scope, cwd) {
    const query = cwd.trim() === '' ? `?scope=${scope}` : `?scope=${scope}&cwd=${encodeURIComponent(cwd.trim())}`;
    return fetch(`${API_BASE}/memory${query}`)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad memory response');
        return normalizeMemory(body.value);
    });
}
/** POST /my-memory/api/memory — a write gated on the user-consent marker. */
function writeMemory({ action, scope, cwd, id, desc, }) {
    return fetch(`${API_BASE}/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, scope, cwd, id, desc, confirmed: true }),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('write failed');
        return normalizeMemory({ ...body.value, scope });
    });
}
/** One GET/POST prompts payload into { items, item }. */
function normalizePrompts(value) {
    return {
        items: Array.isArray(value?.items) ? value.items : [],
        item: value?.item ?? null,
    };
}
/** GET /my-memory/api/prompts → all prompts (order asc; global only). */
function fetchPrompts() {
    return fetch(`${API_BASE}/prompts`)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad prompts response');
        return normalizePrompts(body.value).items;
    });
}
/** POST /my-memory/api/prompts — add/update/delete/toggle/reorder, gated on
 *  the user-consent marker (the server refuses any write without it). */
function writePrompt(payload) {
    return fetch(`${API_BASE}/prompts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, confirmed: true }),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('prompt write failed');
        return normalizePrompts(body.value);
    });
}
/** GET /my-memory/api/agent-memory → 全部记忆（含已归档，面板分区展示）。 */
function fetchAgentMemory() {
    return fetch(`${API_BASE}/agent-memory`)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad agent-memory response');
        return Array.isArray(body.value?.items) ? body.value.items : [];
    });
}
/** POST /my-memory/api/agent-memory — write | delete | restore（用户自己的面板入口）。 */
function writeAgentMemory(payload) {
    return fetch(`${API_BASE}/agent-memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('agent-memory write failed');
        return Array.isArray(body.value?.items) ? body.value.items : [];
    });
}
/** Current session id from localStorage ('dsh.sessions.current' → { sessionId }). */
function currentSessionId() {
    try {
        const raw = localStorage.getItem('dsh.sessions.current');
        const parsed = raw === null ? null : JSON.parse(raw);
        return typeof parsed?.sessionId === 'string' ? parsed.sessionId : '';
    }
    catch {
        return '';
    }
}
/** GET /my-memory/api/session → the session's working directory ('' if none).
 *  The panel uses it to auto-load the current project memory on open (issue #104). */
function fetchSessionCwd(sessionId) {
    if (sessionId === '')
        return Promise.resolve('');
    return fetch(`${API_BASE}/session?sessionId=${encodeURIComponent(sessionId)}`)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            return '';
        return typeof body.value?.cwd === 'string' ? body.value.cwd : '';
    })
        .catch(() => '');
}
/** GET /my-memory/api/config → the entry-length guidance (issue #105):
 *  `maxEntryLength` (concise-input hint threshold) and `maxDescLength`
 *  (injection cap). Falls back to the client-side default on failure. */
function fetchConfig() {
    return fetch(`${API_BASE}/config`)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            return { maxEntryLength: DEFAULT_ENTRY_LIMIT };
        const limit = body.value?.maxEntryLength;
        return { maxEntryLength: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_ENTRY_LIMIT };
    })
        .catch(() => ({ maxEntryLength: DEFAULT_ENTRY_LIMIT }));
}
// 导出给其他 part 文件使用

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
  // 代码图标（预览 / 代码切换的代码视图），stroke=currentColor 风格与其余图标一致。
  code: (size = 16) =>
    iconSvg(
      [
        createElement('polyline', { points: '16 18 22 12 16 6' }),
        createElement('polyline', { points: '8 6 2 12 8 18' }),
      ],
      size,
    ),
  // 下载（issue #85 新增）：箭头入托盘，mermaid 卡片导出 PNG/SVG 用，
  // stroke=currentColor 风格与其余图标一致。
  download: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
        createElement('polyline', { points: '7 10 12 15 17 10' }),
        createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
      ],
      size,
    ),
  // 复制（issue #85 新增）：双层矩形，mermaid 卡片复制源码用，
  // stroke=currentColor 风格与其余图标一致。
  copy: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
        createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
      ],
      size,
    ),
  // ── 控件图标化（issue #486）：卡片工具条「文字收起、只留图标」需要每个按钮都有图标 ──
  // 全屏浮窗（四角向外），mermaid 缩放条用。
  maximize: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }),
        createElement('path', { d: 'M16 3h3a2 2 0 0 1 2 2v3' }),
        createElement('path', { d: 'M21 16v3a2 2 0 0 1-2 2h-3' }),
        createElement('path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }),
      ],
      size,
    ),
  // 适应容器（「完整显示整张图」）：外框套内框，表达「内容装进可用宽度」。
  fit: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('rect', { x: 8, y: 8, width: 8, height: 8, rx: 1 }),
      ],
      size,
    ),
  // 适应宽度 / 铺满：两侧容器边界 + 水平双向箭头。
  fill: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M3 5v14' }),
        createElement('path', { d: 'M21 5v14' }),
        createElement('path', { d: 'M7 12h10' }),
        createElement('path', { d: 'm9 9-3 3 3 3' }),
        createElement('path', { d: 'm15 9 3 3-3 3' }),
      ],
      size,
    ),
  // 缩小：与既有 plus 同粗细的单横线。
  minus: (size = 16) => iconSvg([createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 })], size),
  // 自动换行：折行箭头（lucide wrap-text 同形），代码块换行切换用。
  wrap: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 3, y1: 6, x2: 21, y2: 6 }),
        createElement('path', { d: 'M3 12h15a3 3 0 1 1 0 6h-4' }),
        createElement('polyline', { points: '16 16 14 18 16 20' }),
        createElement('line', { x1: 3, y1: 18, x2: 10, y2: 18 }),
      ],
      size,
    ),
  // markdown 文本（框内 M↓）：「渲染为 Markdown」用。
  markdown: (size = 16) =>
    iconSvg(
      [
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('path', { d: 'M7 15V9l3 3 3-3v6' }),
        createElement('path', { d: 'M17 9v6' }),
        createElement('path', { d: 'm15 13 2 2 2-2' }),
      ],
      size,
    ),
  // 行号（左侧 gutter 短线列 + 右侧正文线）：代码块「显示 / 隐藏行号」切换用。
  lines: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M4 6h1' }),
        createElement('path', { d: 'M4 12h1' }),
        createElement('path', { d: 'M4 18h1' }),
        createElement('line', { x1: 9, y1: 6, x2: 20, y2: 6 }),
        createElement('line', { x1: 9, y1: 12, x2: 20, y2: 12 }),
        createElement('line', { x1: 9, y1: 18, x2: 20, y2: 18 }),
      ],
      size,
    ),
  // 更多（三点）：卡片工具条的「更多」菜单触发器 —— 低频按钮收进菜单，不长期霸占头部。
  more: (size = 16) =>
    iconSvg(
      [
        createElement('circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        createElement('circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        createElement('circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      ],
      size,
    ),
  // 图表（柱状）：mermaid 图表卡片标题与「渲染为图表」选项用。
  chart: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 6, y1: 20, x2: 6, y2: 10 }),
        createElement('line', { x1: 12, y1: 20, x2: 12, y2: 4 }),
        createElement('line', { x1: 18, y1: 20, x2: 18, y2: 14 }),
      ],
      size,
    ),
  // 预览（眼睛）：视图切换的「预览」用 —— 比 file 更贴语义。
  eye: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }),
        createElement('circle', { cx: 12, cy: 12, r: 3 }),
      ],
      size,
    ),
  // 箭头向上（更新图标）：向上的箭头，表示更新操作
  arrowUp: (size = 16) =>
    iconSvg(
      [
        createElement('line', { x1: 12, y1: 19, x2: 12, y2: 5 }),
        createElement('polyline', { points: '5 12 12 5 19 12' }),
      ],
      size,
    ),
  // 电源关（禁用图标）：圆形电源按钮，表示禁用操作
  powerOff: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
      ],
      size,
    ),
  // 电源开（启用图标）：圆形电源按钮，表示启用操作
  powerOn: (size = 16) =>
    iconSvg(
      [
        createElement('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }),
        createElement('line', { x1: 12, y1: 2, x2: 12, y2: 12 }),
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

    "use strict";
// ── ui-fallback: 官方 UI 组件库的逐项兜底（结构性缺陷修复）───────────────
// 旧写法只把 require 包进 try/catch —— 它包得住「模块不存在」，**包不住
// 单个导出不存在**：require 成功 ≠ 每个 ui.X 都存在。
//   · DSH ≤ 0.1.5：@deepseek-ai/dsh-client-ui-primitives 在宿主 staticModules
//     里不存在 → require 抛错 → ui = null，整块走本地渲染路径（当时不崩）。
//   · DSH 0.1.7-rc.2：该包真实存在（version 0.1.7-rc.2）→ require 成功 →
//     首次真正进入官方组件路径；而下列带「尺寸后缀」的图标导出在该版本中
//     并不存在（官方图标导出名是 IconXxxOutlineMedium / IconXxxOutlineRegular）：
//       IconRefreshOutline14【0.1.7 缺失】 IconChevronDownOutline14【0.1.7 缺失】
//       IconCloseOutline16【0.1.7 缺失】   IconFolderOpenOutline16【0.1.7 缺失】
//     createElement(undefined) → React error #130（"Element type is invalid …
//     got: undefined"）→ settings.plugins.tab 整块内容区白屏。
// 修复原则：**逐项兜底**——官方存在且是组件就用官方，缺失/非法则用本插件已有
// 的本地实现顶上（图标复用 dsh-shared 的 icon 集，原子组件用本地等价实现）；
// ui 为 null（旧降级路径）时同样得到完整可用的表，语义不劣化。
// 防回归：test/client-render.mjs 用「只暴露宿主真实导出」的 stub 渲染，
// 并断言渲染树中不存在 undefined 元素类型。
/** React 可渲染组件判定：函数，或 memo / forwardRef / lazy 这类带 $$typeof 的对象。 */
function isUiComponent(value) {
    if (typeof value === 'function')
        return true;
    return typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol';
}
/** 官方图标缺失时的本地兜底：把 dsh-shared 的图标图形包成组件。
 *  统一渲染 inline-flex 包裹层——className（如加载旋转动画）与
 *  data-ui-icon 标记都挂在包裹层，便于样式与防回归测试断言「本地兜底生效」。 */
function uiIconFallback(glyph, size, name) {
    return function UiIconFallback(props) {
        const wrapperProps = {
            'data-ui-icon': `local:${name}`,
            style: { display: 'inline-flex', alignItems: 'center' },
        };
        if (props && typeof props.className === 'string')
            wrapperProps.className = props.className;
        return createElement('span', wrapperProps, glyph(size));
    };
}
/** 官方 Pill 缺失时的本地兜底：胶囊标签（className 透传，active 加粗）。 */
function UiPillFallback(props) {
    const { active, className, children, ...rest } = props ?? {};
    const rootProps = { ...rest };
    if (typeof className === 'string')
        rootProps.className = className;
    if (active === true)
        rootProps.style = { fontWeight: 600 };
    return createElement('span', rootProps, children);
}
/** 官方 Button 缺失时的本地兜底：<button type=button>，icon 与文字并列。 */
function UiButtonFallback(props) {
    const { variant: _variant, size: _size, icon, children, ...rest } = props ?? {};
    return createElement('button', { type: 'button', ...rest }, icon, children);
}
/** 官方 Input 缺失时的本地兜底：wrapper span + 内部 input（icon 前置）——
 *  与官方 Input 契约一致：className 在 wrapper，原生属性在内部 input。 */
function UiInputFallback(props) {
    const { icon, className, ...rest } = props ?? {};
    const wrapperProps = { style: { display: 'inline-flex', alignItems: 'center' } };
    if (typeof className === 'string')
        wrapperProps.className = className;
    return createElement('span', wrapperProps, icon, createElement('input', rest));
}
/** 官方组件表 → 安全表：本插件的每个 ui.X 取用点逐项兜底。 */
function normalizeUi(raw) {
    const official = (raw ?? {});
    return {
        ...official,
        Button: isUiComponent(official.Button) ? official.Button : UiButtonFallback,
        Input: isUiComponent(official.Input) ? official.Input : UiInputFallback,
        Pill: isUiComponent(official.Pill) ? official.Pill : UiPillFallback,
        IconRefreshOutline14: isUiComponent(official.IconRefreshOutline14)
            ? official.IconRefreshOutline14
            : uiIconFallback(icon.refresh, 14, 'refresh'),
        IconChevronDownOutline14: isUiComponent(official.IconChevronDownOutline14)
            ? official.IconChevronDownOutline14
            : uiIconFallback(icon.chevronDown, 14, 'chevron-down'),
        IconCloseOutline16: isUiComponent(official.IconCloseOutline16)
            ? official.IconCloseOutline16
            : uiIconFallback(icon.close, 16, 'close'),
        IconFolderOpenOutline16: isUiComponent(official.IconFolderOpenOutline16)
            ? official.IconFolderOpenOutline16
            : uiIconFallback(icon.folder, 16, 'folder'),
    };
}
ui = normalizeUi(ui);

    "use strict";
// ── utils: pure display helpers (summary / relative time / sort) ──────────
// 纯展示层辅助函数：不触碰服务端状态，供客户端视图使用并可被单测直接调用。
// 概要/详情两级展示为纯展示层（issue #105）：列表显示概要（首句/语义截断），
// 点击展开查看完整详情——存储保留完整 desc，展示层只做概要计算。
// 服务端同款逻辑见 lib/memory-text.js（summarizeDesc / firstSentence）。
const TRUNCATE_LEN = 60;
/** 默认建议单条记忆长度（字符，与服务端 maxEntryLength 默认一致；面板实际
 *  值来自 GET /my-memory/api/config，取不到时回落此默认）。 */
const DEFAULT_ENTRY_LIMIT = 50;
/** 句子边界：中英文句末标点 + 分号 + 换行（省略号吸收入前一句）。 */
const SENTENCE_BOUNDARY = /[。！？!?；;\n….]+/u;
/** 取一段文本的首句（含边界标点；连续省略号/标点并入前一句）；无边界时整段。 */
function firstSentence(text) {
    const value = String(text ?? '');
    const match = SENTENCE_BOUNDARY.exec(value);
    if (match === null)
        return value;
    let end = match.index + 1;
    while (end < value.length && SENTENCE_BOUNDARY.test(value[end]))
        end += 1;
    return value.slice(0, end);
}
/** 语义截断长条目（issue #105 概要/详情两级展示）：多句条目列表**总是**显示
 *  概要（首句），不截断在句子中间；单句条目仅在超长时退化为字符截断。
 *  返回 { text, truncated }——truncated 为 true 表示有可展开的详情（多句或超长）。 */
function truncateText(text, max = TRUNCATE_LEN) {
    const value = String(text ?? '').trim();
    const first = firstSentence(value);
    if (first === value) {
        if (value.length <= max)
            return { text: value, truncated: false };
        return { text: `${value.slice(0, max)}…`, truncated: true };
    }
    if (first.length <= max)
        return { text: first, truncated: true };
    return { text: `${first.slice(0, max)}…`, truncated: true };
}
/** 更新时间相对化：「刚刚」「n 分钟前」「n 小时前」「n 天前」，超过 30 天回退绝对时间。 */
function relativeTime(ts) {
    const time = Number(ts);
    if (!Number.isFinite(time))
        return '';
    const diff = Date.now() - time;
    if (diff < 0)
        return strings.updatedAt(time); // 未来时间（时钟偏移）回退绝对时间
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1)
        return strings.justNow();
    if (minutes < 60)
        return strings.minutesAgo(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return strings.hoursAgo(hours);
    const days = Math.floor(hours / 24);
    if (days < 30)
        return strings.daysAgo(days);
    return strings.updatedAt(time);
}
/** 按更新时间排序（dir: 'desc' 最新在顶 / 'asc' 最旧在顶）；返回新数组，不改原列表。 */
function sortMemories(items, dir = 'desc') {
    const copy = items.slice();
    copy.sort((a, b) => (dir === 'asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
    return copy;
}
/** 是否超过建议长度上限（保存/输入时的精简提示用）。 */
function isOverEntryLimit(text, max = DEFAULT_ENTRY_LIMIT) {
    return String(text ?? '').length > max;
}
// 导出纯函数供单测直接断言（插件只消费 apply，多余导出在 client 端无副作用）。
exports.truncateText = truncateText;
exports.firstSentence = firstSentence;
exports.relativeTime = relativeTime;
exports.sortMemories = sortMemories;
exports.isOverEntryLimit = isOverEntryLimit;
exports.DEFAULT_ENTRY_LIMIT = DEFAULT_ENTRY_LIMIT;

    "use strict";
// ── confirm-ui: ask 范式确认卡（issue #193）──────────────────────────────
// 复刻宿主 ask / approval 卡片规格（dsh-client-ui-user-questions:234、
// dsh-client-ui-approval:272-281 两段构建产物 CSS 的证据）：
//   条带（8px 状态点 + 标题 + 范围徽标）→ 20px 大卡 → 40px/12px 选项行 →
//   footer 左右分布（左反馈文字 + 右动作按钮）。
// 面板内确认与工具侧确认共用本组件，保证两边形态一致（#193 验收标准 4）：
// 统一的 DOM 契约 = .dsh-my-memory-ask-{save,delete} > .dsh-my-memory-ask-card
// > strip / body(options + fields) / footer。
/** 结构化行取值：`范围：project` / `分类：workflow` / `内容：...`。 */
function askReasonField(text, label) {
    const hit = new RegExp('(?:^|\\n)' + label + '：([^\\n]+)').exec(text);
    return hit === null ? '' : hit[1].trim();
}
/** 结构化行缺失时的兜底：从中文文案里认范围（老 reason / 外部来源）。 */
function fallbackScopeOf(text) {
    if (text.includes('项目记忆'))
        return 'project';
    if (text.includes('全局记忆'))
        return 'global';
    return '';
}
/** 解析确认门 reason；任何异常都退化为「只有原文」的安全结果。 */
function parseAskReason(reason) {
    const text = typeof reason === 'string' ? reason : '';
    try {
        const raw = askReasonField(text, '范围');
        const scope = raw === 'global' || raw === 'project' ? raw : fallbackScopeOf(text);
        return { text, scope, category: askReasonField(text, '分类'), content: askReasonField(text, '内容') };
    }
    catch {
        return { text, scope: '', category: '', content: '' };
    }
}
/** 范围显示名（全局 / 项目 / 全局提示词 / 未标注）。 */
function scopeTextOf(scope) {
    if (scope === 'prompts')
        return strings.promptsScope();
    if (scope === 'project')
        return strings.projectScope();
    if (scope === 'global')
        return strings.globalScope();
    return strings.scopeUnknown();
}
/** 条带（ask 范式）：状态点 + 标题 + 范围徽标。 */
function AskStrip({ title, scope, variant }) {
    return createElement('div', { className: 'dsh-my-memory-ask-strip' }, createElement('span', { className: 'dsh-my-memory-ask-dot' }), createElement('span', { className: 'dsh-my-memory-ask-strip-title' }, title), createElement('span', { className: `dsh-my-memory-ask-scope-badge dsh-my-memory-ask-scope-badge-${variant}` }, scopeTextOf(scope)));
}
/** 选项行组：保存列全局/项目（当前项选中），删除只列该记忆所属范围。 */
function AskOptions({ variant, scope }) {
    // 提示词不是记忆范围：不展示「全局 / 项目」二选一（范围由请求方决定）。
    if (scope === 'prompts')
        return null;
    const scopes = variant === 'delete' ? (scope === '' ? [] : [scope]) : ['global', 'project'];
    if (scopes.length === 0)
        return null;
    return createElement('div', { className: 'dsh-my-memory-ask-options', role: 'radiogroup', 'aria-label': strings.askScopeLabel() }, scopes.map((item) => createElement('div', {
        key: item,
        className: `dsh-my-memory-ask-option${item === scope ? ' is-active' : ''}`,
        role: 'radio',
        'aria-checked': item === scope,
        title: strings.askScopeLocked(),
    }, createElement('span', { className: 'dsh-my-memory-ask-option-dot' }), createElement('span', { className: 'dsh-my-memory-ask-option-text' }, scopeTextOf(item)))));
}
/** 信息行：分类 / 内容（+ 超长时的概要预览，沿用 #105 契约）。 */
function AskFields({ category, content, showSummary, }) {
    const fields = [
        category === ''
            ? null
            : createElement(AskField, {
                key: 'category',
                label: strings.askCategoryLabel(),
                value: strings.categoryLabel(category),
            }),
        content === ''
            ? null
            : createElement('div', { key: 'content', className: 'dsh-my-memory-ask-preview' }, createElement('div', { className: 'dsh-my-memory-ask-field-label' }, strings.askContentLabel()), createElement('div', { className: 'dsh-my-memory-ask-preview-text' }, content)),
    ];
    return createElement('div', { className: 'dsh-my-memory-ask-fields' }, ...fields, showSummary ? createElement(SummaryPreview, { desc: content }) : null);
}
/** 单条「标签：值」信息行。 */
function AskField({ label, value }) {
    return createElement('div', { className: 'dsh-my-memory-ask-field' }, createElement('span', { className: 'dsh-my-memory-ask-field-label' }, label), createElement('span', { className: 'dsh-my-memory-ask-field-value' }, value));
}
/** footer（ask 范式）：左反馈文字 + 右动作按钮，gap 8/12px。 */
function AskFooter({ note, allowLabel, rejectLabel, variant, onAllow, onReject, disabled, }) {
    return createElement('div', { className: 'dsh-my-memory-ask-footer' }, createElement('span', { className: 'dsh-my-memory-ask-feedback' }, note), createElement('div', { className: 'dsh-my-memory-ask-actions' }, createElement('button', {
        className: `dsh-my-memory-confirm-ok dsh-my-memory-confirm-ok-${variant}`,
        disabled: disabled === true,
        onClick: onAllow,
    }, variant === 'delete' ? icon.trash(14) : icon.check(14), allowLabel), createElement('button', { className: 'dsh-my-memory-confirm-cancel', disabled: disabled === true, onClick: onReject }, icon.close(14), rejectLabel)));
}
/**
 * ask 范式确认卡（单一视觉实现，两处复用）。
 * `armedLabel` 存在时按钮走两步：首次点击只 arm，再次点击才执行——危险
 * 操作（删除）的二次确认；面板侧因已有「图标 → 确认面板」两步，不启用。
 */
function AskConfirmCard(props) {
    const [armed, setArmed] = useState(false);
    const isDelete = props.variant === 'delete';
    const twoStep = props.armedLabel !== undefined && props.armedLabel !== '';
    const handleAllow = () => {
        if (twoStep && !armed) {
            setArmed(true);
            return;
        }
        props.onAllow();
    };
    const allowLabel = armed && props.armedLabel !== undefined ? props.armedLabel : props.allowLabel;
    return createElement('div', { className: `dsh-my-memory-ask dsh-my-memory-ask-${props.variant}` }, createElement('div', { className: 'dsh-my-memory-confirm dsh-my-memory-ask-card' }, createElement(AskStrip, { title: props.title, scope: props.scope, variant: props.variant }), createElement('div', { className: 'dsh-my-memory-ask-body' }, props.showOptions === false ? null : createElement(AskOptions, { variant: props.variant, scope: props.scope }), createElement(AskFields, {
        category: props.category ?? '',
        content: props.content ?? '',
        showSummary: props.showSummary === true && !isDelete,
    })), createElement(AskFooter, {
        note: props.note,
        allowLabel,
        rejectLabel: strings.askReject(),
        variant: props.variant,
        onAllow: handleAllow,
        onReject: props.onReject,
        disabled: props.disabled,
    })));
}
// 导出给其他 part 文件使用

    "use strict";
// ── view-rows: row / composer / confirm modal widgets for the Memory tab ──
// 条目卡片、空状态、排序开关、新增输入区（自适应高度 textarea）与确认弹层。
// 纯渲染组件，共用 view 工厂作用域内的 strings/icon/ui/utils。
/** 排序开关：原型式小按钮（最新 / 最旧优先）。 */
function SortToggle({ scope, order, onSort, }) {
    return createElement('button', {
        className: 'dsh-my-memory-sort',
        type: 'button',
        'aria-label': `${strings.sortLabel()} ${scope}`,
        onClick: () => onSort(scope),
    }, icon.chevronDown(14), order === 'desc' ? strings.sortNewest() : strings.sortOldest());
}
/** 空状态：无条目时的引导（hint 优先，如无项目会话时提示打开项目会话）。 */
function EmptyState({ hint }) {
    return createElement('div', { className: 'dsh-my-memory-empty' }, createElement('span', { className: 'dsh-my-memory-empty-body' }, createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.empty()), createElement('span', { className: 'dsh-my-memory-empty-hint' }, hint ?? strings.emptyHint())));
}
/** 自适应高度 textarea：内容变高时按 scrollHeight 抬升，封顶 180px。
 *  node 环境（测试渲染）没有 DOM，直接跳过。 */
function autoGrowTextarea(target) {
    const el = target;
    if (el === null || typeof el !== 'object' || el.style === undefined || typeof el.scrollHeight !== 'number')
        return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}
/** 新增条目的输入区：多行自适应 textarea + 字数计数 + 超长提示 + 新增按钮。 */
function AddBar({ scope, value, onChange, onAdd, entryLimit, }) {
    const over = isOverEntryLimit(value, entryLimit);
    return createElement('div', { className: 'dsh-my-memory-composer' }, createElement('textarea', {
        className: 'dsh-my-memory-composer-input',
        rows: 2,
        placeholder: strings.addPlaceholder(),
        'aria-label': strings.addInputAria(scope),
        value,
        onChange: (event) => onChange(event.target.value),
        onInput: (event) => autoGrowTextarea(event.target),
        onKeyDown: (event) => {
            if (event.key === 'Enter' && event.shiftKey !== true) {
                event.preventDefault?.();
                if (value.trim() !== '')
                    onAdd();
            }
        },
    }), over
        ? createElement('div', { className: 'dsh-my-memory-entry-hint' }, strings.entryTooLongHint(value.length, entryLimit))
        : null, createElement('div', { className: 'dsh-my-memory-composer-foot' }, createElement('span', { className: 'dsh-my-memory-composer-hint' }, createElement('span', { className: 'dsh-my-memory-count' }, `${value.length} / ${entryLimit}`), ' · ', strings.confirmHint()), createElement('button', {
        className: 'dsh-my-memory-btn-add',
        'aria-label': `${strings.add()} ${scope}`,
        disabled: value.trim() === '',
        onClick: onAdd,
    }, icon.plus(14), strings.add())));
}
function buildRows(items, scope, editing, onEdit, onEditDesc, onCancelEdit, onConfirm, expanded, onToggle, entryLimit) {
    return items.map((item) => {
        const isEditing = editing !== null && editing.scope === scope && editing.id === item.id;
        const key = `${scope}/${item.id}`;
        return createElement(MemoryRow, {
            key,
            item,
            isEditing,
            isExpanded: expanded.has(key),
            editingDesc: isEditing ? editing.desc : '',
            onEdit: () => onEdit(scope, item.id, item.desc),
            onEditDesc,
            onCancelEdit,
            onSaveEdit: () => onConfirm({ kind: 'update', scope, id: item.id, desc: editing.desc, category: item.category }),
            onDelete: () => onConfirm({ kind: 'delete', scope, id: item.id, desc: item.desc, category: item.category }),
            onToggle: () => onToggle(key),
            entryLimit,
        });
    });
}
function IconButton({ className, label, onClick, children, }) {
    return createElement('button', { className, 'aria-label': label, onClick }, children);
}
/** 编辑态：多行自适应输入 + 保存/取消（保存前仍需确认）。 */
function MemoryRowEdit({ editingDesc, onEditDesc, onSaveEdit, onCancelEdit, entryLimit, }) {
    const over = isOverEntryLimit(editingDesc, entryLimit);
    return createElement('div', { className: 'dsh-my-memory-row dsh-my-memory-row-editing' }, createElement('textarea', {
        className: 'dsh-my-memory-composer-input',
        rows: 2,
        value: editingDesc,
        'aria-label': strings.edit(),
        onChange: (event) => onEditDesc(event.target.value),
        onInput: (event) => autoGrowTextarea(event.target),
    }), over
        ? createElement('div', { className: 'dsh-my-memory-entry-hint' }, strings.entryTooLongHint(editingDesc.length, entryLimit))
        : null, createElement('div', { className: 'dsh-my-memory-composer-foot' }, createElement('span', { className: 'dsh-my-memory-composer-hint' }, createElement('span', { className: 'dsh-my-memory-count' }, `${editingDesc.length} / ${entryLimit}`), ' · ', strings.confirmHint()), createElement('div', { className: 'dsh-my-memory-actions' }, createElement('button', { className: 'dsh-my-memory-btn-save', onClick: onSaveEdit }, icon.check(14), strings.save()), createElement(ui.Button, {
        variant: 'ghost',
        size: 'sm',
        onClick: onCancelEdit,
        icon: createElement(ui.IconCloseOutline16),
    }, strings.cancel()))));
}
/** 一条记忆卡片：描述（概要/展开）+ 操作图标组 + 元数据（分类/置信度/
 *  冲突/演进历史）+ 更新时间。 */
function MemoryRow({ item, isEditing, isExpanded, editingDesc, onEdit, onEditDesc, onCancelEdit, onSaveEdit, onDelete, onToggle, entryLimit, }) {
    if (isEditing) {
        return createElement(MemoryRowEdit, { editingDesc, onEditDesc, onSaveEdit, onCancelEdit, entryLimit });
    }
    const cut = truncateText(item.desc);
    return createElement('div', { className: 'dsh-my-memory-row' }, createElement('div', { className: 'dsh-my-memory-row-head' }, createElement(MemoryRowDesc, {
        shown: isExpanded ? item.desc : cut.text,
        isExpanded,
        onToggle,
    }), createElement(MemoryRowActions, { id: item.id, onEdit, onDelete })), createElement(MetadataRow, { item }), isExpanded ? createElement(MemoryDetail, { item }) : null);
}
/** 展开详情：矛盾提示 + 来源会话/分类/置信度 + 演进历史（原型的信息层级）。 */
function MemoryDetail({ item }) {
    const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(5, Math.round(item.confidence))
        : 1;
    return createElement('div', { className: 'dsh-my-memory-detail' }, item.status === 'conflict-pending'
        ? createElement('div', { className: 'dsh-my-memory-conflict-note' }, strings.conflictNote())
        : null, createElement('div', { className: 'dsh-my-memory-detail-grid' }, createElement('div', null, createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.sourceLabel()), createElement('div', { className: 'dsh-my-memory-detail-value' }, item.source?.sessionId ? strings.sourceAgentLabel(item.source.sessionId) : '—')), createElement('div', null, createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.askCategoryLabel()), createElement('div', { className: 'dsh-my-memory-detail-value' }, strings.categoryLabel(item.category))), createElement('div', null, createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.confidenceLabel(confidence)), createElement('div', { className: 'dsh-my-memory-detail-value' }, `${confidence}/5`))), createElement(HistoryList, { item }));
}
/** 概要预览行（issue #105）：add/update 内容超长时提示「完整内容保存 + 显示概要」。 */
function SummaryPreview({ desc }) {
    const summary = truncateText(desc, TRUNCATE_LEN);
    return createElement('div', { className: 'dsh-my-memory-confirm-summary' }, createElement('span', { className: 'dsh-my-memory-confirm-summary-label' }, strings.summaryPreview()), createElement('span', { className: 'dsh-my-memory-confirm-summary-text' }, summary.text));
}
/** 确认面板标题文案（按 kind 取；未知 kind 回落删除文案）。 */
const CONFIRM_TEXTS = {
    add: () => strings.confirmAdd(),
    update: () => strings.confirmUpdate(),
    delete: () => strings.confirmDelete(),
};
/** 记忆写操作确认：居中弹层 + 共用 ask 范式卡（保存绿 / 删除红）。 */
function ConfirmPanel({ confirm, onCancel, onOk, entryLimit, }) {
    const isDelete = confirm.kind === 'delete';
    return createElement('div', { className: 'dsh-my-memory-overlay', role: 'presentation' }, createElement(AskConfirmCard, {
        variant: isDelete ? 'delete' : 'save',
        title: CONFIRM_TEXTS[confirm.kind](),
        scope: confirm.scope,
        category: confirm.category ?? '',
        content: confirm.desc ?? '',
        showSummary: !isDelete && isOverEntryLimit(confirm.desc, entryLimit),
        note: strings.confirmHint(),
        allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
        showOptions: false,
        onAllow: onOk,
        onReject: onCancel,
    }));
}
// 导出给其他 part 文件使用

    "use strict";
// ── rows: 行级子部件（记忆条目行 / 提示词行 / 元数据行）──────────────────
// client 片段为 script 模式，无 import/export，靠命名避免重名；拼接顺序见
// scripts/build.mjs 的 pieces。这里只放**单行渲染**的通用子部件，供
// view-rows.ts / prompts.ts 共用。
/** 描述即展开开关：整段内容可点击，展开后显示全文（原型的信息层级）。 */
function MemoryRowDesc({ shown, isExpanded, onToggle, }) {
    return createElement('button', {
        className: `dsh-my-memory-desc${isExpanded ? ' dsh-my-memory-desc-open' : ''}`,
        type: 'button',
        'aria-label': isExpanded ? strings.collapse() : strings.expand(),
        onClick: onToggle,
    }, shown);
}
/** 条目操作图标组（编辑 / 删除）。 */
function MemoryRowActions({ id, onEdit, onDelete, }) {
    return createElement('div', { className: 'dsh-my-memory-actions' }, createElement(IconButton, { className: 'dsh-my-memory-iconbtn', label: `${strings.edit()} ${id}`, onClick: onEdit }, icon.pencil(14)), createElement(IconButton, {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
        label: `${strings.delete()} ${id}`,
        onClick: onDelete,
    }, icon.trash(14)));
}
/** 演进历史列表（详情区）：无历史时给占位。 */
function HistoryList({ item }) {
    const history = Array.isArray(item.history) ? item.history : [];
    return createElement('div', { className: 'dsh-my-memory-detail-block' }, createElement('div', { className: 'dsh-my-memory-detail-label' }, strings.historyLabel()), history.length === 0
        ? createElement('span', { className: 'dsh-my-memory-detail-empty' }, strings.noHistory())
        : createElement('ul', { className: 'dsh-my-memory-history' }, history.map((entry, index) => createElement('li', { key: `${entry.at}-${index}` }, `${strings.historyEntry(entry.action)} · ${relativeTime(entry.at)}`))));
}
/** 记忆条目元数据行：分类徽标 + 置信度点 + 矛盾标记 + 更新时间。
 *  来源会话与演进历史移入展开详情（原型的信息层级）。 */
function MetadataRow({ item }) {
    const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0
        ? Math.min(5, Math.round(item.confidence))
        : null;
    return createElement('div', { className: 'dsh-my-memory-meta' }, createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.categoryLabel(item.category)), confidence === null
        ? null
        : createElement('span', { className: 'dsh-my-memory-conf', 'aria-label': strings.confidenceLabel(confidence) }, [1, 2, 3, 4, 5].map((n) => createElement('i', { key: n, className: n <= confidence ? 'on' : '' })), createElement('b', null, `${confidence}/5`)), item.status === 'conflict-pending'
        ? createElement('span', { className: 'dsh-my-memory-conflict-badge' }, strings.statusConflict())
        : null, createElement('span', { className: 'dsh-my-memory-meta-time' }, `${strings.updatedPrefix()}${relativeTime(item.updatedAt)}`));
}
/** 分区标题行（标题 + 条数徽标）。 */
function PromptsSectionHead({ count }) {
    return createElement('div', { className: 'dsh-my-memory-section-head' }, createElement('span', { className: 'dsh-my-memory-section-title' }, strings.promptsSection()), createElement('span', { className: 'dsh-my-memory-prompt-count' }, strings.promptCount(count)));
}
/** 一条提示词的编辑态：标题输入 + 正文 textarea + 保存/取消。 */
function PromptRowEdit({ editing, onTitle, onText, onSave, onCancel, }) {
    return createElement('div', { className: 'dsh-my-memory-row dsh-my-memory-row-editing dsh-my-memory-prompt-row' }, createElement(ui.Input, {
        className: 'dsh-my-memory-add-input',
        placeholder: strings.promptsAddPlaceholder(),
        'aria-label': strings.promptsAddInputAria(),
        value: editing.title,
        onChange: (event) => onTitle(event.target.value),
    }), createElement('textarea', {
        className: 'dsh-my-memory-prompt-textarea',
        placeholder: strings.promptsTextPlaceholder(),
        'aria-label': strings.promptsTextInputAria(),
        value: editing.text,
        onChange: (event) => onText(event.target.value),
    }), createElement('div', { className: 'dsh-my-memory-actions' }, createElement('button', { className: 'dsh-my-memory-btn-save', onClick: onSave }, icon.check(14), strings.save()), createElement(ui.Button, {
        variant: 'ghost',
        size: 'sm',
        onClick: onCancel,
        icon: createElement(ui.IconCloseOutline16),
    }, strings.cancel())));
}
/** 提示词行操作组（上移 / 下移 / 编辑 / 删除）。 */
function PromptRowActions({ id, onMoveUp, onMoveDown, onEdit, onDelete, }) {
    return createElement('div', { className: 'dsh-my-memory-actions' }, createElement(IconButton, {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-up',
        label: strings.promptMoveUp() + ' ' + id,
        onClick: onMoveUp,
    }, icon.chevronDown(14)), createElement(IconButton, { className: 'dsh-my-memory-iconbtn', label: strings.promptMoveDown() + ' ' + id, onClick: onMoveDown }, icon.chevronDown(14)), createElement(IconButton, { className: 'dsh-my-memory-iconbtn', label: strings.edit() + ' ' + id, onClick: onEdit }, icon.pencil(14)), createElement(IconButton, {
        className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
        label: strings.delete() + ' ' + id,
        onClick: onDelete,
    }, icon.trash(14)));
}
/** 启停开关（点击翻转 enabled）：原型一致的 30×18 胶囊开关。 */
function PromptToggle({ item, busy, onToggle }) {
    const enabled = item.enabled === true;
    return createElement('button', {
        className: `dsh-my-memory-switch${enabled ? ' is-on' : ''}`,
        role: 'switch',
        'aria-checked': enabled,
        'aria-label': (enabled ? strings.promptToggleOff() : strings.promptToggleOn()) + ' ' + item.id,
        disabled: busy,
        onClick: onToggle,
    }, createElement('span', { className: 'dsh-my-memory-switch-dot' }));
}
// 导出给其他 part 文件使用

    "use strict";
// ── prompts-state / view-state: 分区状态工厂（issue #465）────────────────
// 从 view.ts 抽出（文件行数门禁 ≤400 的基线约束）：
//  - 全局提示词的模块级状态 + 发布/订阅 + `usePromptsBlockProps`（在根视图里调用）；
//  - 记忆分区的数据动作工厂 `createActions`（与状态机同源，随视图一起抽出）。
// 全部依赖拼接作用域里的 strings/api/fetch*（无 import/export）。
// ── 模块级提示词状态（发布/订阅）──────────────────────────────────────────
// 状态放在模块作用域而非组件 state：本仓库 client 端的测试驱动器每帧重建元素，
// 组件内自持 state 在跨帧断言下不稳定；模块级状态 + 订阅通知在真机与测试下语义
// 完全一致，且天然保证「提示词只有一份真相」（与记忆视图的 data 同样唯一）。
let promptState = { items: [], busy: false, editing: null, confirming: null, draft: { title: '', text: '' } };
/** 订阅者（每个分区实例一个 setState）。 */
const promptListeners = new Set();
let promptLoaded = false;
/** 更新状态并通知订阅者。 */
function setPromptState(patch) {
    promptState = { ...promptState, ...patch };
    for (const listener of promptListeners)
        listener(promptState);
}
/** 写操作（click / 确认路径共用）：串行 busy，成功后用服务端回传的列表覆盖。 */
function runPromptWrite(payload) {
    if (promptState.busy)
        return Promise.resolve();
    setPromptState({ busy: true });
    return writePrompt(payload)
        .then((value) => {
        const patch = { items: value.items };
        if (payload.action === 'add')
            patch.draft = { title: '', text: '' };
        setPromptState({ ...patch, editing: null, confirming: null });
    })
        .catch(() => { })
        .then(() => setPromptState({ busy: false }));
}
/** 提示词分区 props 的构造入口（在根视图里作为一等 hook 调用）。
 *  状态住在根视图，不放在被渲染的子树里：本仓库 client 端是「每帧重建元素」模型，
 *  子树里自持状态的组件在测试驱动器下会拿到新的 hook 槽位（真机 React 靠位置复用
 *  实例，不受影响）——放在根视图既与记忆视图的状态机同构，也保证行为可断言。 */
function usePromptsBlockProps() {
    const [state, setState] = useState(promptState);
    useEffect(() => {
        const listener = (next) => setState(next);
        promptListeners.add(listener);
        if (!promptLoaded) {
            promptLoaded = true;
            fetchPrompts()
                .then((items) => setPromptState({ items }))
                .catch(() => setPromptState({ items: [] }));
        }
        return () => {
            promptListeners.delete(listener);
        };
    }, []);
    return {
        items: state.items,
        busy: state.busy,
        editing: state.editing,
        confirming: state.confirming,
        draft: state.draft,
        onToggle: (id) => runPromptWrite({ action: 'toggle', id, enabled: !enabledOf(state.items, id) }),
        onMove: (id, direction) => runPromptWrite({ action: 'reorder', id, direction }),
        onEdit: (item) => setPromptState({ editing: { id: item.id, title: item.title, text: item.text } }),
        onEditTitle: (value) => setPromptState({ editing: state.editing === null ? null : { ...state.editing, title: value } }),
        onEditText: (value) => setPromptState({ editing: state.editing === null ? null : { ...state.editing, text: value } }),
        onCancelEdit: () => setPromptState({ editing: null }),
        onSaveEdit: () => setPromptState({
            confirming: state.editing === null
                ? null
                : { kind: 'update', id: state.editing.id, title: state.editing.title, text: state.editing.text },
        }),
        onDelete: (item) => setPromptState({ confirming: { kind: 'delete', id: item.id, title: item.title } }),
        onDraft: (patch) => setPromptState({ draft: { ...state.draft, ...patch } }),
        onAdd: () => setPromptState({ confirming: { kind: 'add', title: state.draft.title, text: state.draft.text } }),
        onConfirm: (confirm) => setPromptState({ confirming: confirm }),
        onCancelConfirm: () => setPromptState({ confirming: null }),
        onCommit: (confirm) => {
            void runPromptWrite(confirmPayload(confirm));
        },
    };
}
/** Data actions bound to the state setters; error: null | 'load' | 'save'. */
function createActions({ setData, setLoading, setError, setSaved, }) {
    const applyValue = (value) => {
        setData(value);
        setLoading(false);
    };
    const run = (cwd) => {
        setLoading(true);
        setError(null);
        setSaved(false);
        fetchMemoryOnce(cwd)
            .then(applyValue)
            .catch(() => {
            setLoading(false);
            setError('load');
        });
    };
    return { load: run, refresh: run };
}
// 导出给其他 part 文件使用

    "use strict";
// ── prompts: 全局提示词的设置 tab（issue #465）────────────────────────────
// 与记忆 tab 并列但完全隔离：独立数据源（/my-memory/api/prompts）、独立状态、
// 独立确认面板。交互：新增 / 编辑 / 删除 / 启用停用 / 上移下移（写回 order）；
// **不做拖拽**（零依赖、可测）。删除走红色二次确认，保存走绿色。
/** 提示词正文上限（与宿主默认 maxPromptLength 一致；仅用于输入计数提示）。 */
const PROMPT_TEXT_LIMIT = 1000;
/** 一条提示词卡片：启停 + 标题（+ 内置徽标）+ 正文 + 排序/编辑/删除。 */
function PromptRow({ item, isEditing, busy, onToggle, onMoveUp, onMoveDown, onEdit, onDelete, }) {
    const head = createElement('div', { className: 'dsh-my-memory-row-head' }, createElement(PromptToggle, { item, busy, onToggle }), createElement('span', { className: 'dsh-my-memory-prompt-title' }, item.title), item.builtin === undefined
        ? null
        : createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.promptBuiltin()), item.enabled === true
        ? null
        : createElement('span', { className: 'dsh-my-memory-ct-badge' }, strings.promptDisabled()), createElement(PromptRowActions, { id: item.id, onMoveUp, onMoveDown, onEdit, onDelete }));
    return createElement('div', {
        className: 'dsh-my-memory-row dsh-my-memory-prompt-row' + (item.enabled === true ? '' : ' dsh-my-memory-prompt-row-off'),
    }, head, createElement('div', { className: 'dsh-my-memory-prompt-text' }, item.text));
}
/** 新增栏：标题 + 正文（自适应 textarea）+ 字数 + 新增按钮。 */
function PromptAddBar({ draft, busy, onDraft, onAdd, }) {
    const over = draft.text.length > PROMPT_TEXT_LIMIT;
    return createElement('div', { className: 'dsh-my-memory-composer' }, createElement(ui.Input, {
        className: 'dsh-my-memory-add-input',
        placeholder: strings.promptsAddPlaceholder(),
        'aria-label': strings.promptsAddInputAria(),
        value: draft.title,
        onChange: (event) => onDraft({ title: event.target.value }),
    }), createElement('textarea', {
        className: 'dsh-my-memory-prompt-textarea',
        placeholder: strings.promptsTextPlaceholder(),
        'aria-label': strings.promptsTextInputAria(),
        rows: 2,
        value: draft.text,
        onChange: (event) => onDraft({ text: event.target.value }),
        onInput: (event) => autoGrowTextarea(event.target),
    }), over
        ? createElement('div', { className: 'dsh-my-memory-entry-hint' }, strings.entryTooLongHint(draft.text.length, PROMPT_TEXT_LIMIT))
        : null, createElement('div', { className: 'dsh-my-memory-composer-foot' }, createElement('span', { className: 'dsh-my-memory-composer-hint' }, createElement('span', { className: 'dsh-my-memory-count' }, `${draft.text.length} / ${PROMPT_TEXT_LIMIT}`), ' · ', strings.promptHint()), createElement('button', {
        className: 'dsh-my-memory-btn-add',
        disabled: busy || draft.title.trim() === '' || draft.text.trim() === '',
        'aria-label': strings.add(),
        onClick: onAdd,
    }, icon.plus(14), strings.add())));
}
/** 一条提示词：编辑态走编辑器，否则走卡片（纯渲染，无状态）。 */
function PromptEntry({ item, editing, busy, onToggle, onMove, onEdit, onEditTitle, onEditText, onCancelEdit, onSaveEdit, onDelete, }) {
    if (editing !== null && editing.id === item.id) {
        return createElement(PromptRowEdit, {
            key: 'prompt/' + item.id,
            editing,
            onTitle: onEditTitle,
            onText: onEditText,
            onSave: onSaveEdit,
            onCancel: onCancelEdit,
        });
    }
    return createElement(PromptRow, {
        key: 'prompt/' + item.id,
        item,
        isEditing: false,
        busy,
        onToggle,
        onMoveUp: () => onMove('up'),
        onMoveDown: () => onMove('down'),
        onEdit,
        onDelete,
    });
}
/** 列表主体：无条目时给引导空状态，否则渲染条目（纯渲染，无状态）。 */
function PromptEntryList({ items, editing, busy, onToggle, onMove, onEdit, onEditTitle, onEditText, onCancelEdit, onSaveEdit, onDelete, }) {
    if (items.length === 0) {
        return createElement('div', { className: 'dsh-my-memory-empty' }, createElement('span', { className: 'dsh-my-memory-empty-body' }, createElement('span', { className: 'dsh-my-memory-empty-main' }, strings.promptsEmpty()), createElement('span', { className: 'dsh-my-memory-empty-hint' }, strings.promptsEmptyHint())));
    }
    return items.map((item) => createElement(PromptEntry, {
        key: 'prompt/' + item.id,
        item,
        editing,
        busy,
        onToggle: () => onToggle(item.id),
        onMove: (direction) => onMove(item.id, direction),
        onEdit: () => onEdit(item),
        onEditTitle,
        onEditText,
        onCancelEdit,
        onSaveEdit,
        onDelete: () => onDelete(item),
    }));
}
/** 全局提示词 tab（列表 + 新增栏 + 确认弹层）。 */
function PromptsBlock({ items, busy, editing, confirming, draft, onToggle, onMove, onEdit, onEditTitle, onEditText, onCancelEdit, onSaveEdit, onDelete, onDraft, onAdd, onConfirm, onCancelConfirm, onCommit, }) {
    return createElement('div', { className: 'dsh-my-memory-section dsh-my-memory-section-prompts' }, createElement(PromptsSectionHead, { count: items.length }), createElement('div', { className: 'dsh-my-memory-note' }, strings.promptsNote()), createElement('div', { className: 'dsh-my-memory-prompt-list' }, createElement(PromptEntryList, {
        items,
        editing,
        busy,
        onToggle,
        onMove,
        onEdit,
        onEditTitle,
        onEditText,
        onCancelEdit,
        onSaveEdit,
        onDelete,
    })), createElement(PromptAddBar, { draft, busy, onDraft, onAdd }), createElement(PromptConfirmPanel, { confirming, busy, onCommit, onCancelConfirm }));
}
/** 提示词确认弹层（与记忆分区共用 ask 范式卡：删除红 / 保存绿）。 */
function PromptConfirmPanel({ confirming, busy, onCommit, onCancelConfirm, }) {
    if (confirming === null)
        return null;
    const isDelete = confirming.kind === 'delete';
    return createElement('div', { className: 'dsh-my-memory-overlay', role: 'presentation' }, createElement(AskConfirmCard, {
        variant: isDelete ? 'delete' : 'save',
        title: isDelete
            ? strings.confirmDeletePrompt()
            : confirming.kind === 'update'
                ? strings.confirmUpdatePrompt()
                : strings.confirmAddPrompt(),
        scope: 'prompts',
        category: '',
        content: (confirming.title ?? '') + (confirming.text === undefined ? '' : '\n' + confirming.text),
        note: strings.promptHint(),
        allowLabel: isDelete ? strings.confirmDeleteBtn() : strings.confirmSave(),
        disabled: busy,
        onAllow: () => onCommit(confirming),
        onReject: onCancelConfirm,
    }));
}
/** 目标条目的当前启用态（toggle 需要翻转值；找不到时按「未启用」处理）。 */
function enabledOf(items, id) {
    const item = items.find((entry) => entry.id === id);
    return item !== undefined && item.enabled === true;
}
/** 确认面板 → 写操作载荷（add / update / delete）。 */
function confirmPayload(confirm) {
    if (confirm.kind === 'delete')
        return { action: 'delete', id: confirm.id };
    if (confirm.kind === 'update') {
        return { action: 'update', id: confirm.id, title: confirm.title, text: confirm.text };
    }
    return { action: 'add', title: confirm.title ?? '', text: confirm.text ?? '' };
}
// 导出给其他 part 文件使用

    "use strict";
// ── agent 记忆面板的状态（issue #502）────────────────────────────────
// 与 prompts-state 同构：把「加载 / 编辑 / 草稿 / 保存 / 删除确认」从 view.ts 里
// 析出，守住 apply 与 view 的函数行数门禁。
/** 恢复一条已归档记忆（服务端搬回原位 + 清归档标记），返回最新列表。 */
function restoreAgentMemory(name) {
    return writeAgentMemory({ action: 'restore', name });
}
/** 进入编辑态：把该文件当前正文载入草稿（write 是整份覆盖，必须先拿到原文）。 */
function beginAgentEdit(entries, name, setEditing, setDraft) {
    const target = entries.find((entry) => entry.name === name);
    setEditing(name);
    setDraft(target === undefined ? '' : target.content);
}
/** 确认层通过后真正落盘删除，并用服务端回传的最新列表刷新（失败只标错，不吞掉）。 */
function commitAgentDelete(name, editing, settle) {
    settle.setPendingDelete('');
    writeAgentMemory({ action: 'delete', name })
        .then((next) => {
        settle.setEntries(next);
        if (editing === name) {
            settle.setEditing('');
            settle.setDraft('');
        }
    })
        .catch(() => settle.setError(true));
}
/** agent 记忆 tab 的状态钩子（挂载即拉一次；写后直接用回传结果刷新）。 */
function useAgentMemoryState() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [editing, setEditing] = useState('');
    const [draft, setDraft] = useState('');
    const [pendingDelete, setPendingDelete] = useState('');
    const reload = () => {
        setLoading(true);
        setError(false);
        fetchAgentMemory()
            .then(setEntries)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    };
    // 空依赖 = 只在挂载时拉一次；agent 改了文件后下次打开面板即最新。
    useEffect(reload, []);
    const save = () => {
        const target = entries.find((entry) => entry.name === editing);
        if (target === undefined)
            return;
        writeAgentMemory({ action: 'write', name: editing, content: draft })
            .then((next) => {
            setEntries(next);
            setEditing('');
            setDraft('');
        })
            .catch(() => setError(true));
    };
    return {
        entries,
        loading,
        error,
        editing,
        draft,
        pendingDelete,
        onEdit: (name) => beginAgentEdit(entries, name, setEditing, setDraft),
        onDraft: setDraft,
        onCancel: () => {
            setEditing('');
            setDraft('');
        },
        onSave: save,
        onDeleteAsk: setPendingDelete,
        onDeleteConfirm: (name) => commitAgentDelete(name, editing, { setPendingDelete, setEntries, setError, setEditing, setDraft }),
        onDeleteCancel: () => setPendingDelete(''),
        onRestore: (name) => {
            restoreAgentMemory(name)
                .then(setEntries)
                .catch(() => setError(true));
        },
    };
}

    "use strict";
// ── agent 记忆面板（issue #502）：第四个 tab ─────────────────────────
// 与现有三 tab 的关系：**完全独立的数据源与语义**。
//  - 全局记忆/项目记忆：用户确认后写入，条目卡片视图；
//  - agent 记忆：agent 自主写入，**文件视图**——正文原样展示，
//    元数据（创建时间/最后读取/读取次数）来自 index.json，agent 看不到
//    但**用户必须看得到**，这是「给用户了解原因」的唯一落点。
// 跨 part 引用（createElement/strings/utils/icon/IconButton/ui）由拼接作用域解析。
/**
 * 记忆文件的作用域：根级（user.md / feedback.md / MEMORY.md）= 全局，
 * `projects/<id>/…` = 项目。
 *
 * 这是用户能看见「为什么这条会出现在这里」的唯一线索——项目相关的规则被
 * agent 写进全局层时，徽标会把错位直接暴露出来。
 */
function agentMemoryScopeOf(name) {
    return name.startsWith('projects/') ? 'project' : 'global';
}
/** 作用域徽标。 */
function AgentMemoryScope({ name }) {
    const scope = agentMemoryScopeOf(name);
    return createElement('span', { className: `dsh-my-memory-agent-scope is-${scope}` }, scope === 'project' ? strings.agentMemoryScopeProject() : strings.agentMemoryScopeGlobal());
}
/** 一份记忆的元数据行（时间 + 读取次数 + 归档标记）。 */
function AgentMemoryMeta({ entry }) {
    const created = entry.createdAt > 0 ? relativeTime(entry.createdAt) : strings.agentMemoryNever();
    const lastRead = entry.lastReadAt > 0 ? relativeTime(entry.lastReadAt) : strings.agentMemoryNever();
    const parts = [strings.agentMemoryCreated(created), strings.agentMemoryRead(entry.readCount, lastRead)];
    if (entry.archived)
        parts.push(strings.agentMemoryArchived());
    return createElement('p', { className: 'dsh-my-memory-agent-meta' }, parts.join(' · '));
}
/**
 * 卡片头部：文件名 + 作用域徽标 + 行内操作。
 *
 * 操作按钮**必须**走设计系统里那一套 `.dsh-my-memory-iconbtn`（与全局记忆 /
 * 项目记忆 / 提示词三个 tab 的行内操作完全一致）。此前这里用 `dsh-my-memory-btn`
 * ——一个 styles.ts 里不存在的类名，按钮静默退化成浏览器默认样式。
 * 编辑态下头部不再显示操作：编辑器底部已有「保存 / 取消」，两处并存就会出现
 * 两个「取消」。
 */
function AgentMemoryHead({ entry, editing, onEdit, onDelete, }) {
    return createElement('div', { className: 'dsh-my-memory-agent-head' }, createElement('span', { className: 'dsh-my-memory-agent-title' }, createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name), createElement(AgentMemoryScope, { name: entry.name })), editing
        ? null
        : createElement('div', { className: 'dsh-my-memory-actions' }, createElement(IconButton, {
            className: 'dsh-my-memory-iconbtn',
            label: `${strings.agentMemoryEdit()} ${entry.name}`,
            onClick: onEdit,
        }, icon.pencil(14)), createElement(IconButton, {
            className: 'dsh-my-memory-iconbtn dsh-my-memory-iconbtn-danger',
            label: `${strings.agentMemoryDelete()} ${entry.name}`,
            onClick: onDelete,
        }, icon.trash(14))));
}
/** 编辑态：多行等宽输入框 + 保存 / 取消（与 MemoryRowEdit 同一套按钮样式）。 */
function AgentMemoryEditor({ draft, onDraft, onCancel, onSave, }) {
    return createElement('div', { className: 'dsh-my-memory-agent-editing' }, createElement('textarea', {
        className: 'dsh-my-memory-agent-editor',
        value: draft,
        rows: 8,
        'aria-label': strings.agentMemoryEdit(),
        onChange: (event) => onDraft(event.target.value),
    }), createElement('div', { className: 'dsh-my-memory-agent-save' }, createElement('button', { type: 'button', className: 'dsh-my-memory-btn-save', onClick: onSave }, icon.check(14), strings.agentMemorySave()), createElement(ui.Button, {
        variant: 'ghost',
        size: 'sm',
        onClick: onCancel,
        icon: createElement(ui.IconCloseOutline16),
    }, strings.agentMemoryCancel())));
}
/** 一份记忆的完整卡片：文件名 + 元数据 + 正文（纯文本，等宽）。 */
function AgentMemoryCard({ entry, editing, draft, onEdit, onDraft, onCancel, onSave, onDelete, }) {
    return createElement('div', { className: 'dsh-my-memory-agent-card' }, createElement(AgentMemoryHead, { entry, editing, onEdit, onDelete }), createElement(AgentMemoryMeta, { entry }), editing
        ? createElement(AgentMemoryEditor, { draft, onDraft, onCancel, onSave })
        : createElement('pre', { className: 'dsh-my-memory-agent-body' }, entry.content));
}
/** 归档区：已归档的记忆只读展示（不可编辑、不在主列表），可一键恢复。 */
function AgentMemoryArchive({ entries, onRestore, }) {
    return createElement('details', { className: 'dsh-my-memory-agent-archive' }, createElement('summary', null, strings.agentMemoryArchiveTitle(entries.length)), entries.map((entry) => createElement('div', { key: entry.name, className: 'dsh-my-memory-agent-card is-archived' }, createElement('div', { className: 'dsh-my-memory-agent-head' }, createElement('span', { className: 'dsh-my-memory-agent-title' }, createElement('code', { className: 'dsh-my-memory-agent-name' }, entry.name), createElement(AgentMemoryScope, { name: entry.name })), createElement('div', { className: 'dsh-my-memory-actions' }, createElement(ui.Button, { variant: 'ghost', size: 'sm', onClick: () => onRestore(entry.name) }, strings.agentMemoryRestore()))), createElement(AgentMemoryMeta, { entry }), createElement('pre', { className: 'dsh-my-memory-agent-body' }, entry.content))));
}
/** 空态提示（agent 还没写过记忆是常态，不是错误）。 */
function AgentMemoryEmpty() {
    return createElement('div', { className: 'dsh-my-memory-empty' }, createElement('p', null, strings.agentMemoryEmpty()), createElement('p', { className: 'dsh-my-memory-empty-hint' }, strings.agentMemoryEmptyHint()));
}
/** 删除确认层（复用 ask 范式卡片）：agent 记忆是长期数据，误删不可恢复。 */
function AgentMemoryDeleteConfirm({ entry, onCancel, onConfirm, }) {
    return createElement('div', { className: 'dsh-my-memory-overlay', role: 'presentation' }, createElement(AskConfirmCard, {
        variant: 'delete',
        title: strings.agentMemoryDeleteTitle(),
        scope: agentMemoryScopeOf(entry.name),
        category: '',
        content: entry.content,
        showSummary: false,
        note: strings.agentMemoryDeleteNote(),
        allowLabel: strings.confirmDeleteBtn(),
        onAllow: onConfirm,
        onReject: onCancel,
    }));
}
/** 第四个 tab 的整体视图：说明 + 提示 + 卡片列表 + 归档区 + 删除确认层。 */
function AgentMemoryPanel({ entries, loading, error, editing, draft, pendingDelete, onEdit, onDraft, onCancel, onSave, onDeleteAsk, onDeleteConfirm, onDeleteCancel, onRestore, }) {
    const active = entries.filter((entry) => !entry.archived);
    const archived = entries.filter((entry) => entry.archived);
    const pending = entries.find((entry) => entry.name === pendingDelete);
    const cards = active.map((entry) => createElement(AgentMemoryCard, {
        key: entry.name,
        entry,
        editing: editing === entry.name,
        draft,
        onEdit: () => onEdit(entry.name),
        onDraft,
        onCancel,
        onSave,
        onDelete: () => onDeleteAsk(entry.name),
    }));
    return createElement('section', { className: 'dsh-my-memory-section' }, createElement('p', { className: 'dsh-my-memory-note' }, strings.agentMemoryNote()), loading ? createElement('p', { className: 'dsh-my-memory-note' }, strings.loading()) : null, error ? createElement('p', { className: 'dsh-my-memory-error' }, strings.loadError()) : null, cards.length === 0 && !loading && !error ? createElement(AgentMemoryEmpty, null) : null, cards.length > 0 ? createElement('div', { className: 'dsh-my-memory-list' }, cards) : null, archived.length > 0 ? createElement(AgentMemoryArchive, { entries: archived, onRestore }) : null, pending === undefined
        ? null
        : createElement(AgentMemoryDeleteConfirm, {
            entry: pending,
            onCancel: onDeleteCancel,
            onConfirm: () => onDeleteConfirm(pending.name),
        }));
}

    "use strict";
// ── view: Memory settings tab（三个 tab：全局记忆 / 项目记忆 / 全局提示词）──
// 跨 part 引用（strings/utils/api/view-rows/rows/prompts）由拼接作用域解析，
// 无需 require——浏览器 ModuleLoader 不支持 factory 内相对路径 require。
/** Load both scopes: global always; project only when a cwd is given. */
function fetchAll(cwd) {
    const projectCwd = cwd.trim();
    const globalP = fetchMemory('global', '');
    const projectP = projectCwd === ''
        ? Promise.resolve({ scope: 'project', cwd: '', projectRoot: '', items: [] })
        : fetchMemory('project', projectCwd);
    return Promise.all([globalP, projectP]).then(([global, project]) => ({ global, project }));
}
/** 同一 cwd 的在飞请求（模块级：跨渲染共享，面板重复挂载/重渲染不会重复请求记忆端点）。 */
const inflightMemory = new Map();
/** 取一次记忆；同 cwd 已有在飞请求则复用（幂等读）。 */
function fetchMemoryOnce(cwd) {
    const existing = inflightMemory.get(cwd);
    if (existing !== undefined)
        return existing;
    const promise = fetchAll(cwd);
    inflightMemory.set(cwd, promise);
    const clear = () => {
        if (inflightMemory.get(cwd) === promise)
            inflightMemory.delete(cwd);
    };
    promise.then(clear).catch(clear);
    return promise;
}
function mergeScope(data, scope, value) {
    return scope === 'global' ? { ...data, global: value } : { ...data, project: value };
}
function MemoryView() {
    const [tab, setTab] = useState('global');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [drafts, setDrafts] = useState({ global: '', project: '' });
    const [editing, setEditing] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [expanded, setExpanded] = useState(() => new Set());
    const [sortOrder, setSortOrder] = useState({
        global: 'desc',
        project: 'desc',
    });
    const [entryLimit, setEntryLimit] = useState(DEFAULT_ENTRY_LIMIT);
    const actions = createActions({ setData, setLoading, setError, setSaved });
    // 提示词数据（独立端点）：计数用于 tab 徽标，列表在提示词 tab 内渲染。
    const promptsProps = usePromptsBlockProps();
    // agent 记忆（issue #502）：独立端点，独立写入语义（无需 confirmed）。
    const agent = useAgentMemoryState();
    // 空依赖数组 = 只在挂载时拉一次配置 / 会话 cwd / 记忆。会话 cwd 决定项目
    // 记忆是否自动加载（issue #104）；面板不再有路径输入。
    useEffect(() => {
        fetchConfig()
            .then((value) => setEntryLimit(value.maxEntryLength))
            .catch(() => { });
        fetchSessionCwd(currentSessionId()).then((cwd) => actions.load(cwd));
    }, []);
    const commit = createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming });
    return renderMemoryRoot({
        tab,
        agent,
        data,
        loading,
        error,
        saved,
        drafts,
        editing,
        confirming,
        expanded,
        sortOrder,
        entryLimit,
        promptsProps,
        commit,
        reload: () => actions.load(''),
        setTab: (next) => {
            setTab(next);
            setEditing(null);
            setConfirming(null);
        },
        setDrafts,
        setEditing,
        setConfirming,
        setExpanded,
        setSortOrder,
    });
}
/** 渲染根视图：tab 栏 + 当前 tab 内容 + 状态行 + 居中确认弹层。 */
function renderMemoryRoot(props) {
    const counts = {
        global: props.data === null ? 0 : props.data.global.items.length,
        project: props.data === null ? 0 : props.data.project.items.length,
        agent: props.agent.entries.filter((entry) => !entry.archived).length,
        prompts: props.promptsProps.items.length,
    };
    return createElement('div', { className: 'dsh-my-memory-root' }, createElement(TabBar, { tab: props.tab, counts, onTab: props.setTab }), createElement('div', { className: 'dsh-my-memory-body' }, props.error === null ? null : createElement(ErrorBanner, { kind: props.error, onRetry: props.reload }), renderTabContent(props), props.saved
        ? createElement('div', { className: 'dsh-my-memory-status dsh-my-memory-saved' }, icon.check(14), strings.saved())
        : null), props.confirming === null
        ? null
        : createElement(ConfirmPanel, {
            confirm: props.confirming,
            entryLimit: props.entryLimit,
            onCancel: () => props.setConfirming(null),
            onOk: () => props.commit(props.confirming),
        }));
}
/** 当前 tab 的内容：加载态 / 记忆分区 / 提示词 tab。 */
function renderTabContent(props) {
    if (props.loading) {
        return createElement('div', { className: 'dsh-my-memory-status dsh-my-memory-loading' }, createElement('span', { className: 'dsh-my-memory-spinner' }), strings.loading());
    }
    if (props.tab === 'agent')
        return createElement(AgentMemoryPanel, { ...props.agent });
    if (props.data === null)
        return null;
    if (props.tab === 'prompts')
        return createElement(PromptsTab, props.promptsProps);
    const scope = props.tab === 'project' ? 'project' : 'global';
    return createElement(ScopePanel, {
        scope,
        data: scope === 'global' ? props.data.global : props.data.project,
        draft: props.drafts[scope],
        order: props.sortOrder[scope],
        editing: props.editing,
        expanded: props.expanded,
        entryLimit: props.entryLimit,
        onDraft: (value) => props.setDrafts({ ...props.drafts, [scope]: value }),
        onEdit: (scopeName, id, desc) => props.setEditing({ scope: scopeName, id, desc }),
        onEditDesc: (value) => props.setEditing(props.editing === null ? null : { ...props.editing, desc: value }),
        onCancelEdit: () => props.setEditing(null),
        onConfirm: (confirm) => props.setConfirming(confirm),
        onToggle: (key) => props.setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        }),
        onSort: (scopeName) => props.setSortOrder((prev) => ({
            ...prev,
            [scopeName]: prev[scopeName] === 'desc' ? 'asc' : 'desc',
        })),
    });
}
/** 三个 tab 的分段控件（计数徽标直接标在 tab 上）。 */
function TabBar({ tab, counts, onTab, }) {
    const tabs = [
        { id: 'global', label: strings.globalSection(), count: counts.global },
        { id: 'project', label: strings.projectSection(), count: counts.project },
        { id: 'prompts', label: strings.promptsSection(), count: counts.prompts },
        { id: 'agent', label: strings.agentMemorySection(), count: counts.agent },
    ];
    return createElement('div', { className: 'dsh-my-memory-tabs', role: 'tablist', 'aria-label': strings.title() }, tabs.map((item) => createElement('button', {
        key: item.id,
        role: 'tab',
        className: `dsh-my-memory-tab${tab === item.id ? ' is-active' : ''}`,
        'aria-selected': tab === item.id,
        'aria-label': item.label,
        onClick: () => onTab(item.id),
    }, item.label, createElement('span', { className: 'dsh-my-memory-tab-count' }, item.count))));
}
/** 一个记忆分区（全局或项目）：说明行 + 排序 + 列表 + 新增输入区。 */
function ScopePanel(props) {
    const { scope, data, draft, order, entryLimit } = props;
    const isProject = scope === 'project';
    const items = sortMemories(data.items, order);
    const rows = buildRows(items, scope, props.editing, props.onEdit, props.onEditDesc, props.onCancelEdit, props.onConfirm, props.expanded, props.onToggle, entryLimit);
    const emptyHint = isProject && data.cwd === '' ? strings.projectEmptyHint() : undefined;
    return createElement('section', { className: `dsh-my-memory-section${isProject ? ' dsh-my-memory-section-project' : ''}` }, createElement('div', { className: 'dsh-my-memory-note-row' }, createElement('p', { className: 'dsh-my-memory-note' }, isProject ? strings.projectNote() : strings.globalNote()), createElement(SortToggle, { scope, order, onSort: props.onSort })), rows.length === 0
        ? createElement(EmptyState, { hint: emptyHint })
        : createElement('div', { className: 'dsh-my-memory-list' }, rows), createElement(AddBar, {
        scope,
        value: draft,
        entryLimit,
        onChange: props.onDraft,
        onAdd: () => props.onConfirm({ kind: 'add', scope, desc: draft, category: 'fact' }),
    }));
}
/** 提示词 tab：独立数据源，与记忆状态机零耦合。 */
function PromptsTab(props) {
    return createElement(PromptsBlock, props);
}
/** Load-failure banner with a retry entry; write-failure banner without. */
function ErrorBanner({ kind, onRetry }) {
    if (kind === 'load') {
        return createElement('div', { className: 'dsh-my-memory-error' }, strings.loadError(), createElement(ui.Button, {
            variant: 'outline',
            size: 'sm',
            onClick: onRetry,
            icon: createElement(ui.IconRefreshOutline14),
        }, strings.retry()));
    }
    return kind === 'save' ? createElement('div', { className: 'dsh-my-memory-error' }, strings.saveFailed()) : null;
}
/** One confirmed write (add / update / delete) → POST + refresh the scope. */
function createCommitHandler({ data, setData, setSaved, setError, setDrafts, setEditing, setConfirming, }) {
    return (confirm) => {
        setSaved(false);
        setError(null);
        writeMemory({
            action: confirm.kind,
            scope: confirm.scope,
            cwd: confirm.scope === 'project' && data !== null ? data.project.cwd : '',
            id: confirm.id,
            desc: confirm.desc,
        })
            .then((value) => {
            setSaved(true);
            setDrafts((d) => ({ ...d, [confirm.scope]: '' }));
            setEditing(null);
            setConfirming(null);
            setData((d) => mergeScope(d, confirm.scope, value));
        })
            .catch(() => setError('save'));
    };
}
// 导出给 apply.ts 使用

    "use strict";
// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → 记忆），
// 不依赖 dsh-better-sidebar。slots 服务是官方 client 服务，通过
// ctx.get 动态获取——服务缺省时静默跳过（不注册 tab，server 端记忆
// 能力不受影响）。
//
// issue #193：额外接管工具侧确认「呈现」——注册 conversation.composer 的
// chain 条目（宿主 dsh-client-ui-approval 用同一扩展点渲染原生审批卡，
// dsh-client-ui-approval/lib/client.js:272-281），仅当 pending approval 属于
// memory_save / memory_delete 时当选，其余一律让位。chain 选举语义：
// dsh-client-ui-renderer/lib/client.js:831-849 —— 按 priority 顺序询问，
// 首个 select 非 null 者当选并独占渲染（break），select 抛错 = declined。
// 宿主审批条目 priority=1，本插件用更小的 0 排在其前；即便顺序相反也只是
// 退回宿主原生卡（安全降级），不会出现「两边都不渲染」的死锁。
/**
 * chain 选举判据（严判据 + 双重校验，issue #193 安全契约）：
 * 只接管 pending approval 且 toolName ∈ {memory_save, memory_delete}；
 * 任何不确定情形（非对象、kind 不符、toolName 不在白名单、answer 不是函数、
 * 字段取值抛错）一律返回 null —— chain 渲染器随后询问宿主条目，用户始终
 * 能批准。绝不返回「半接管」状态（既不渲染、又挡住宿主）。
 */
function memoryApprovalOperation(pending) {
    if (pending === null || pending === undefined || typeof pending !== 'object')
        return '';
    const candidate = pending;
    if (candidate.kind !== 'approval')
        return '';
    if (typeof candidate.answer !== 'function')
        return '';
    if (candidate.toolName === 'memory_save')
        return 'save';
    if (candidate.toolName === 'memory_delete')
        return 'delete';
    return '';
}
function memoryApprovalSelect(owner) {
    try {
        const pending = owner?.pendingInteraction;
        const operation = memoryApprovalOperation(pending);
        if (operation === '')
            return null;
        const candidate = pending;
        const parsed = parseAskReason(candidate.reason);
        return {
            operation,
            toolName: String(candidate.toolName),
            scope: parsed.scope,
            category: parsed.category,
            content: parsed.content,
            reasonText: parsed.text,
            answer: candidate.answer.bind(pending),
        };
    }
    catch {
        return null;
    }
}
/**
 * 工具侧确认卡（issue #193）：ask 范式卡 + 直接答复宿主 approval。
 * 删除走二次确认（首次点击只 arm），保存单击即允许；按钮文案与配色按
 * 操作区分（保存成功色 / 删除危险色）。答复异常被吞掉，绝不让渲染崩溃
 * 取代卡片（chain 的 crash face 会让用户无法批准）。
 */
function isUsableMatch(matched) {
    if (matched === null || matched === undefined)
        return false;
    if (typeof matched !== 'object')
        return false;
    return typeof matched.answer === 'function';
}
/** 答复宿主 approval：兑现失败被吞掉，绝不让渲染崩溃取代卡片。 */
function answerApproval(matched, outcome) {
    try {
        const result = matched.answer(outcome);
        if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
            void result.catch(() => { });
        }
    }
    catch {
        // 宿主 approval 通道异常不得冒泡：卡片保持可交互，用户可重试
    }
}
/** 卡片文案与配色（保存成功色 / 删除危险色 + 二次确认）。 */
function approvalCardProps(matched, busy, respond) {
    const isDelete = matched.operation === 'delete';
    return {
        variant: isDelete ? 'delete' : 'save',
        title: isDelete ? strings.askDeleteTitle() : strings.askSaveTitle(),
        scope: matched.scope,
        category: matched.category,
        content: matched.content,
        showSummary: isOverEntryLimit(matched.content, DEFAULT_ENTRY_LIMIT),
        note: isDelete ? strings.askNoteDelete() : strings.askNoteSave(),
        allowLabel: isDelete ? strings.askAllowDelete() : strings.askAllowSave(),
        armedLabel: isDelete ? strings.askDeleteArmed() : undefined,
        disabled: busy,
        onAllow: () => respond('allowed-once'),
        onReject: () => respond('rejected'),
    };
}
function MemoryApprovalCard(props) {
    const [busy, setBusy] = useState(false);
    const matched = props?.matched;
    if (!isUsableMatch(matched))
        return null;
    const respond = (outcome) => {
        if (busy)
            return;
        setBusy(true);
        answerApproval(matched, outcome);
    };
    return createElement(AskConfirmCard, approvalCardProps(matched, busy, respond));
}
exports.apply = function apply(ctx) {
    ctx.effect(() => {
        if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined')
            return () => { };
        const style = document.createElement('style');
        style.setAttribute(STYLE_TAG, 'styles');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => {
            if (style.parentNode)
                style.parentNode.removeChild(style);
        };
    }, 'dsh-my-memory: styles');
    // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
    // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
    // 在 strict 模式下会返回 undefined，注册代码会静默 return（设置页看不到
    // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
    // 槽位声明，实际渲染发生在之后，安全。
    const slots = ctx.get('slots', false);
    if (slots === undefined)
        return;
    ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        id: 'my-memory',
        order: 92,
        label: () => strings.title(),
    }, MemoryView)), 'dsh-my-memory: settings tab registration');
    // 工具侧确认呈现接管（issue #193）：chain 多注册共存，仅记忆写工具的
    // approval 当选；其它工具的审批由宿主条目渲染（priority=1）。
    // 注册失败不得影响面板 tab（记忆能力本身在 server 端，与呈现无关）。
    ctx.effect(() => slots.inject('conversation.composer', () => {
        try {
            return slots.register({
                name: 'conversation.composer',
                priority: 0,
                select: memoryApprovalSelect,
            }, MemoryApprovalCard);
        }
        catch {
            return () => { };
        }
    }), 'dsh-my-memory: memory approval composer takeover');
};


    return module.exports
  },
})
