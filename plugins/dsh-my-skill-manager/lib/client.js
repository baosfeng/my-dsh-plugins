/**
 * dsh-my-skill-manager — client half (browser). SOURCE TEMPLATE.
 *
 * A Web Settings "Skill 管理 / Skill Manager" tab (official `slots`
 * extension point — no third-party dependency) implementing the "技能台"
 * (Skill Deck) layout: command bar, cards / compact table views, filters,
 * dual-scope switches (global + current project), focus detail with a
 * SKILL.md preview, batch enable/disable, diagnostics page, toasts and the
 * loading / empty / error states.
 *
 * Data source: /my-skill-manager/api/{list,detail,rescan,session,config}
 * (server half). Styling uses the host's --dsw-* semantic tokens only.
 *
 * BUILD NOTE: this file is the SOURCE TEMPLATE. scripts/build.mjs compiles
 * src/client/parts/*.ts into lib/.client-build/parts/*.js and splices those
 * pieces into the PART placeholder markers below
 * (each piece is plain function-declaration text sharing this factory scope;
 * the browser ModuleLoader does not support relative-path require) and writes
 * lib/client.js — the file actually served by DSH, which MUST be committed
 * (CI runs node --check + tests against it, not against this template).
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-skill-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState } = require('react')

    // ── parts (injected by scripts/build.mjs; keep this exact order — the
    //    const initializers below run in splice order) ─────────────────────
    "use strict";
function isZh() {
    try {
        const host = (document.documentElement.lang || '').toLowerCase();
        if (host !== '')
            return host.startsWith('zh');
    }
    catch {
    }
    try {
        return (navigator.language || 'en').toLowerCase().startsWith('zh');
    }
    catch {
        return false;
    }
}
function pick(zh, en) {
    return isZh() ? zh : en;
}
const REASON_META = {
    'broken-symlink': {
        label: ['坏符号链接', 'Broken symlink'],
        reason: [
            '符号链接的目标不存在，扫描时被跳过。',
            'The symlink target no longer exists, so the entry was skipped during the scan.',
        ],
        suggestion: [
            '恢复目标目录，或在确认无用后移除该符号链接，然后重新扫描。',
            'Restore the target directory, or remove the link if it is no longer needed, then rescan.',
        ],
    },
    'missing-skill-md': {
        label: ['缺 SKILL.md', 'Missing SKILL.md'],
        reason: [
            '目录存在，但缺少 SKILL.md，无法解析技能元信息。',
            'The directory exists but has no SKILL.md, so its metadata cannot be parsed.',
        ],
        suggestion: [
            '在目录内补写 SKILL.md（含 name / description frontmatter），或删除该目录后重新扫描。',
            'Add a SKILL.md with name/description frontmatter, or delete the directory, then rescan.',
        ],
    },
    'missing-frontmatter': {
        label: ['缺 frontmatter', 'Missing frontmatter'],
        reason: ['SKILL.md 顶部缺少 YAML frontmatter。', 'SKILL.md has no YAML frontmatter at the top.'],
        suggestion: [
            '在 SKILL.md 顶部补写 frontmatter（至少 name 与 description），然后重新扫描。',
            'Add frontmatter (at least name and description) at the top of SKILL.md, then rescan.',
        ],
    },
    'invalid-name': {
        label: ['名称非法', 'Invalid name'],
        reason: [
            '技能名称不符合 kebab-case 规范（小写字母、数字与连字符）。',
            'The skill name is not valid kebab-case (lowercase letters, digits and hyphens).',
        ],
        suggestion: [
            '把目录名与 frontmatter 的 name 改为 kebab-case，然后重新扫描。',
            'Rename the directory and the frontmatter name to kebab-case, then rescan.',
        ],
    },
    'parse-failed': {
        label: ['解析失败', 'Parse failed'],
        reason: [
            'frontmatter 解析失败或字段类型异常，扫描时被跳过。',
            'Frontmatter parsing failed or a field has the wrong type, so the scan skipped it.',
        ],
        suggestion: [
            '检查 frontmatter 的 YAML 语法与字段类型后重新扫描。',
            'Check the frontmatter YAML syntax and field types, then rescan.',
        ],
    },
};
const strings = {
    title: () => pick('Skill 管理', 'Skill Manager'),
    searchPlaceholder: () => pick('搜索名称、描述或路径', 'Search name, description or path'),
    searchAria: () => pick('搜索技能', 'Search skills'),
    searchClear: () => pick('清空搜索', 'Clear search'),
    shortcutHint: () => '⌘K',
    rescanning: () => pick('扫描中…', 'Scanning…'),
    rescanAria: () => pick('重新扫描技能目录', 'Rescan skill directories'),
    statsAria: () => pick('概览筛选', 'Overview filters'),
    statAll: () => pick('全部', 'All'),
    statEnabled: () => pick('启用', 'Enabled'),
    statDisabled: () => pick('禁用', 'Disabled'),
    statAnomaly: () => pick('异常', 'Issues'),
    diagEntry: () => pick('诊断', 'Diagnostics'),
    diagEntryAria: (count) => pick(`打开异常诊断，当前 ${count} 项异常`, `Open diagnostics, ${count} issues`),
    projectNote: () => pick('未绑定项目 · 本项目作用域不可用', 'No project bound · scope unavailable'),
    filterButton: () => pick('筛选', 'Filter'),
    filterButtonAria: (count) => count > 0
        ? pick(`筛选，已生效 ${count} 项条件`, `Filter, ${count} active conditions`)
        : pick('打开筛选', 'Open filters'),
    filterTitle: () => pick('筛选', 'Filter'),
    filterClose: () => pick('关闭', 'Close'),
    filterReset: () => pick('重置', 'Reset'),
    filterSourceGroup: () => pick('按来源筛选', 'Filter by source'),
    filterStatusGroup: () => pick('按状态筛选', 'Filter by status'),
    filtersSource: () => pick('来源', 'Source'),
    filterAll: () => pick('全部', 'All'),
    filtersStatus: () => pick('状态', 'Status'),
    filterAllStatus: () => pick('全部状态', 'All statuses'),
    sourceProject: () => pick('本项目', 'Project'),
    sourceUser: () => pick('用户', 'User'),
    sourceBundled: () => pick('内置', 'Built-in'),
    sourceOther: () => pick('其他', 'Other'),
    sourceAnomaly: () => pick('异常', 'Issues'),
    unusedOnly: () => pick('只看未使用', 'Unused only'),
    resultCountUnit: () => pick('项结果', 'results'),
    scanTime: (time) => pick(`上次扫描 ${time}`, `Last scan ${time}`),
    viewAria: () => pick('视图切换', 'View mode'),
    viewCards: () => pick('卡片流', 'Cards'),
    viewTable: () => pick('紧凑表', 'Table'),
    sortAria: () => pick('排序方式', 'Sort by'),
    sortName: () => pick('名称', 'Name'),
    sortUsage: () => pick('使用次数', 'Uses'),
    sortRecent: () => pick('最近使用', 'Recent'),
    sortSource: () => pick('来源', 'Source'),
    sortDirAria: (dir) => pick(`切换排序方向（当前${dir === 'asc' ? '升序' : '降序'}）`, `Toggle sort direction (currently ${dir === 'asc' ? 'ascending' : 'descending'})`),
    selectAria: () => pick('进入选择模式', 'Enter selection mode'),
    groupProject: () => pick('本项目', 'This project'),
    groupUser: () => pick('用户', 'User'),
    groupBundled: () => pick('内置', 'Built-in'),
    groupOther: () => pick('其他', 'Other'),
    groupAnomaly: () => pick('异常', 'Issues'),
    groupAnomalyHint: () => pick('扫描失败 · 需要修复', 'Scan failed · needs a fix'),
    cardOpenAria: (name, expanded) => pick(`${expanded ? '收起' : '展开'} ${name} 的详情`, `${expanded ? 'Collapse' : 'Expand'} details for ${name}`),
    badgeGlobalOff: () => pick('全局关闭', 'Global off'),
    badgeProjectOff: () => pick('本项目关闭', 'Project off'),
    badgeScanIssue: () => pick('扫描异常', 'Scan issue'),
    usageNever: () => pick('未使用', 'Never used'),
    usageTimes: (count) => pick(`${count} 次`, `${count} uses`),
    usageTitle: (count, recent) => pick(`调用 ${count} 次，最近 ${recent}`, `Used ${count} times, last ${recent}`),
    scopeGlobal: () => pick('全局', 'Global'),
    scopeProject: () => pick('本项目', 'This project'),
    scopeAria: (name, scope, on, disabled) => pick(`${name} ${scope}作用域：${on ? '已启用' : '已禁用'}${disabled ? '（不可切换）' : ''}`, `${name} ${scope} scope: ${on ? 'enabled' : 'disabled'}${disabled ? ' (unavailable)' : ''}`),
    scopeTitle: (scope, on, disabled) => {
        const state = disabled ? pick('不可切换', 'unavailable') : on ? pick('启用', 'on') : pick('关闭', 'off');
        return pick(`${scope}作用域：${state}`, `${scope} scope: ${state}`);
    },
    footAnomaly: () => pick('扫描异常 · 不可管理', 'Scan issue · not manageable'),
    footNoProject: () => pick('未绑定项目 · 本项目不可用', 'No project · this scope unavailable'),
    footGlobalOff: () => pick('全局关闭 · 本项目不生效', 'Globally off · project scope inactive'),
    footProjectOff: () => pick('本项目作用域已关闭', 'Project scope is off'),
    detailPath: () => pick('路径', 'Path'),
    detailProvider: () => 'Provider',
    detailInvocation: () => pick('调用能力', 'Invocation'),
    detailSource: () => pick('来源', 'Source'),
    detailCollected: () => pick('已收录', 'Cataloged'),
    detailDiscovered: () => pick('目录发现', 'Scan-discovered'),
    detailScanIssue: () => pick('扫描异常', 'Scan issue'),
    detailScopes: () => pick('作用域', 'Scopes'),
    detailReason: () => pick('原因', 'Reason'),
    detailSuggestion: () => pick('建议', 'Suggestion'),
    scopeUnavailable: () => pick('扫描异常 · 不可用', 'Scan issue · unavailable'),
    scopeState: (on) => (on ? pick('启用', 'on') : pick('关闭', 'off')),
    capModel: () => pick('模型可调用', 'Model invocable'),
    capUser: () => pick('用户可调用', 'User invocable'),
    previewTitle: () => 'SKILL.md',
    previewFirstLines: () => pick('前 15 行', 'First 15 lines'),
    previewUnavailable: () => pick('无法读取', 'Unavailable'),
    previewLoading: () => pick('读取中…', 'Loading…'),
    previewEmpty: () => pick('（SKILL.md 为空）', '(SKILL.md is empty)'),
    copyFull: () => pick('复制全文', 'Copy all'),
    copyPathAria: (name) => pick(`复制 ${name} 的路径`, `Copy path of ${name}`),
    copyMdAria: (name) => pick(`复制 ${name} 的 SKILL.md 全文`, `Copy full SKILL.md of ${name}`),
    copyPathDone: () => pick('已复制路径', 'Path copied'),
    copyMdDone: () => pick('已复制 SKILL.md 全文', 'Full SKILL.md copied'),
    copyFailed: () => pick('复制失败，请手动选择文本', 'Copy failed, select the text manually'),
    copyEmpty: () => pick('没有可复制的内容', 'Nothing to copy'),
    retry: () => pick('重试', 'Retry'),
    usageCallsUnit: () => pick('次调用', 'calls'),
    usageVia: (via) => via === 'model' ? pick('模型调用', 'Model call') : via === 'user' ? pick('用户调用', 'User call') : '—',
    usageRecent: (time) => pick(`最近 ${time}`, `Last ${time}`),
    usageViaNone: () => '—',
    truncatedNote: () => pick('（已截断至 256KB）', '(truncated to 256KB)'),
    inlineErrorTitle: (name) => pick(`未能更新「${name}」`, `Could not update "${name}"`),
    updateFailedToast: () => pick('更新失败 · 可在行内重试', 'Update failed · retry inline'),
    toggleOnToast: (name, scope) => pick(`已启用「${name}」 · ${scope}`, `Enabled "${name}" · ${scope}`),
    toggleOffToast: (name, scope) => pick(`已禁用「${name}」 · ${scope}`, `Disabled "${name}" · ${scope}`),
    bulkSelected: (count) => pick(`已选 ${count} 项`, `${count} selected`),
    bulkSkip: (count) => pick(`${count} 项异常将跳过`, `${count} issues will be skipped`),
    bulkEnable: () => pick('启用', 'Enable'),
    bulkDisable: () => pick('禁用', 'Disable'),
    bulkExit: () => pick('退出', 'Exit'),
    bulkExitAria: () => pick('退出选择模式', 'Exit selection mode'),
    bulkEnableAria: () => pick('批量启用所选技能', 'Enable selected skills'),
    bulkDisableAria: () => pick('批量禁用所选技能', 'Disable selected skills'),
    confirmTitle: (count) => pick(`确认禁用 ${count} 项技能？全局与本项目作用域都会关闭。`, `Disable ${count} skills? Both the global and project scopes will be turned off.`),
    confirmSkipNote: (count) => pick(`${count} 项异常将跳过。`, `${count} issues will be skipped.`),
    confirmDisable: () => pick('确认禁用', 'Disable'),
    confirmCancel: () => pick('取消', 'Cancel'),
    loadingAria: () => pick('正在读取技能目录', 'Reading skill directories'),
    emptyNoDataTitle: () => pick('技能台还是空的', 'The skill deck is empty'),
    emptyNoDataBody: () => pick('没有扫描到任何 skill。确认项目与用户技能目录存在后，重新扫描一次。', 'No skills were found. Check the project and user skill directories, then rescan.'),
    emptyNoResultTitle: (query) => pick(`没有找到「${query}」`, `No matches for "${query}"`),
    emptyNoResultBody: () => pick('试试缩短关键词，或清除来源与状态筛选后再看一次。', 'Try a shorter keyword, or clear the source and status filters and search again.'),
    emptyFilteredTitle: () => pick('没有符合条件的技能', 'No skills match'),
    emptyFilteredBody: () => pick('当前来源与状态筛选组合下没有结果。重置筛选，或换一个来源继续看。', 'No results for this combination of source and status filters. Reset the filters or pick another source.'),
    emptyNoProjectTitle: () => pick('没有可用的项目上下文', 'No project context'),
    emptyNoProjectBody: () => pick('当前窗口没有打开项目。项目级 skill 不会出现在技能台，卡片上的「本项目」开关也暂不可用。', 'No project is open in this window. Project skills are not listed and the project scope switch is unavailable.'),
    emptyNoProjectPreview: () => pick('未绑定项目 · 已禁用', 'No project · disabled'),
    emptyNoProjectToggle: () => pick('本项目作用域（未绑定项目，已禁用）', 'Project scope (no project bound, disabled)'),
    emptyClearSearch: () => pick('清除搜索', 'Clear search'),
    emptyResetFilters: () => pick('重置筛选', 'Reset filters'),
    emptyRescan: () => pick('重新扫描', 'Rescan'),
    emptyShowAll: () => pick('查看全部来源', 'Show all sources'),
    errorTitle: () => pick('扫描失败', 'Scan failed'),
    errorHint: () => pick('读取技能目录时出错。请检查目录权限或宿主日志后重试。', 'Reading the skill directories failed. Check directory permissions or the host log, then retry.'),
    retryScan: () => pick('重试扫描', 'Retry scan'),
    listFailedFallback: () => pick('读取技能目录失败', 'Failed to read skill directories'),
    rescanFailedFallback: () => pick('重新扫描失败', 'Rescan failed'),
    detailFailedFallback: () => pick('读取 SKILL.md 失败', 'Failed to read SKILL.md'),
    saveFailedFallback: () => pick('保存失败', 'Failed to save'),
    scanDoneToast: (all, anomaly) => pick(`扫描完成 · ${all} 项，${anomaly} 项异常`, `Scan complete · ${all} skills, ${anomaly} issues`),
    scanFailedToast: () => pick('扫描失败', 'Scan failed'),
    projectUnavailableToast: () => pick('未绑定项目，本项目作用域不可用', 'No project bound; project scope unavailable'),
    noEligibleToast: () => pick('所选项目没有可切换的普通技能', 'No ordinary skills in the selection'),
    batchFailedToast: () => pick('批量更新失败', 'Bulk update failed'),
    batchOnToast: (count) => pick(`已启用 ${count} 项`, `Enabled ${count} skills`),
    batchOffToast: (count) => pick(`已禁用 ${count} 项`, `Disabled ${count} skills`),
    batchSkipToast: (count) => pick(` · 跳过 ${count} 项异常`, ` · skipped ${count} issues`),
    diagTitle: () => pick('诊断', 'Diagnostics'),
    diagSubtitle: (count, time) => pick(`${count} 项异常 · 上次扫描 ${time}`, `${count} issues · last scan ${time}`),
    diagBack: () => pick('返回技能台', 'Back to the skill deck'),
    diagRescan: () => pick('重新扫描', 'Rescan'),
    diagFoot: () => pick('扫描范围：本项目 · 用户 · 内置。修复目录后重新扫描即可恢复收录。', 'Scope: project · user · built-in. Fix the directory and rescan to restore it.'),
    diagEmpty: () => pick('没有异常条目', 'No issues found'),
    diagReason: () => pick('原因', 'Reason'),
    diagSuggestion: () => pick('建议', 'Suggestion'),
    tableAria: () => pick('技能紧凑表', 'Compact skill table'),
    colName: () => pick('名称', 'Name'),
    colSource: () => pick('来源', 'Source'),
    colUsage: () => pick('使用', 'Uses'),
    colRecent: () => pick('最近', 'Recent'),
    colScope: () => pick('作用域', 'Scopes'),
    colScopeTitle: () => pick('作用域：左为全局，右为本项目', 'Scopes: left global, right this project'),
    selectAllAria: () => pick('选择当前视图全部技能', 'Select all skills in the current view'),
    selectRowAria: (name) => pick(`选择 ${name}`, `Select ${name}`),
    sortByAria: (label) => pick(`按${label}排序`, `Sort by ${label}`),
    recentNever: () => pick('从未使用', 'Never used'),
    reasonShort: (reason) => {
        const meta = REASON_META[reason];
        return meta === undefined ? reason : pick(meta.label[0], meta.label[1]);
    },
    reasonText: (reason) => {
        const meta = REASON_META[reason];
        return meta === undefined ? reason : pick(meta.reason[0], meta.reason[1]);
    },
    reasonSuggestion: (reason) => {
        const meta = REASON_META[reason];
        return meta === undefined ? '' : pick(meta.suggestion[0], meta.suggestion[1]);
    },
};

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
const glyph = {
    cards: (size = 13) => iconSvg([
        createElement('rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }),
        createElement('rect', { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
    ], size),
    table: (size = 13) => iconSvg([
        createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        createElement('path', { d: 'M3 10h18M9 10v10' }),
    ], size),
    filter: (size = 13) => iconSvg([createElement('path', { d: 'M4 5h16l-6.4 7.6V20l-3.2-1.7v-5.7L4 5Z' })], size),
    sort: (size = 13) => iconSvg([
        createElement('path', { d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }),
        createElement('circle', { cx: 16, cy: 7, r: 2 }),
        createElement('circle', { cx: 10, cy: 17, r: 2 }),
    ], size),
    activity: (size = 12) => iconSvg([createElement('path', { d: 'M3 12h4l2.5 6 4-14 2.5 8H21' })], size),
    checkSquare: (size = 16) => iconSvg([
        createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
        createElement('path', { d: 'm8 12 3 3 5-6' }),
    ], size),
    back: (size = 16) => iconSvg([createElement('path', { d: 'M19 12H5' }), createElement('path', { d: 'm11 6-6 6 6 6' })], size),
    arrowUp: (size = 12) => iconSvg([createElement('path', { d: 'M12 19V5' }), createElement('path', { d: 'm6 11 6-6 6 6' })], size),
    arrowDown: (size = 12) => iconSvg([createElement('path', { d: 'M12 5v14' }), createElement('path', { d: 'm6 13 6 6 6-6' })], size),
    sortNeutral: (size = 12) => iconSvg([createElement('path', { d: 'm8 9 4-4 4 4' }), createElement('path', { d: 'm8 15 4 4 4-4' })], size),
    package: (size = 28) => iconSvg([
        createElement('path', { d: 'M3 7l9-4 9 4-9 4-9-4Z' }),
        createElement('path', { d: 'M3 7v10l9 4 9-4V7' }),
        createElement('path', { d: 'M12 11v10' }),
    ], size),
    fileMissing: (size = 28) => iconSvg([
        createElement('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z' }),
        createElement('path', { d: 'M14 3v5h5' }),
        createElement('path', { d: 'M9 14h6' }),
    ], size),
};

    "use strict";
const STYLE_TOKENS = `

.dsh-my-skill-manager-root {
  /* 局部语义别名：全部由 --dsw-* 派生，便于把原型的一整套 --sk-* 色板
     映射到宿主的语义槽；深浅主题跟随宿主自动适配。 */
  --skm-surface: var(--dsw-alias-bg-layer-2);
  --skm-surface-2: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-2));
  --skm-surface-3: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-layer-2));
  --skm-border: var(--dsw-alias-border-l2);
  --skm-border-strong: var(--dsw-alias-border-l4, var(--dsw-alias-border-l3));
  --skm-hover: var(--dsw-alias-interactive-bg-hover);
  --skm-accent: var(--dsw-alias-accent, var(--dsw-alias-state-business-primary));
  --skm-accent-strong: color-mix(in srgb, var(--skm-accent) 76%, var(--dsw-alias-label-primary));
  --skm-accent-soft: color-mix(in srgb, var(--skm-accent) 14%, transparent);
  --skm-accent-ring: color-mix(in srgb, var(--skm-accent) 30%, transparent);
  --skm-success: var(--dsw-alias-state-success-primary);
  --skm-warn: var(--dsw-alias-state-warn-primary);
  --skm-danger: var(--dsw-alias-state-error-primary);
  --skm-warn-soft: color-mix(in srgb, var(--skm-warn) 14%, transparent);
  --skm-danger-soft: color-mix(in srgb, var(--skm-danger) 14%, transparent);
  --skm-on-accent: var(--dsw-alias-label-primary-foreground);
  --skm-code-bg: var(--dsw-alias-markdown-code-block);
  --skm-code-fg: var(--dsw-alias-label-secondary);
  --skm-track: color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
  --skm-knob: var(--dsw-alias-switch-thumb, var(--dsw-alias-label-primary-foreground));
  --skm-selected: color-mix(in srgb, var(--skm-accent) 12%, var(--dsw-alias-bg-layer-2));
  --skm-scroll: var(--dsw-alias-scrollbar-hover-l1, var(--dsw-alias-label-dimmed));
  --skm-shadow: var(--dsw-shadow-lv2);
  --skm-ease: var(--ds-transition-duration-slow) var(--ds-ease-in-out);

  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  /* 宿主设置面板 800px 高、内容列 564px 宽；技能台在页签下方占一个有界
     高度（约 620px，原型内容区），内部列表自己滚动，不再叠加外层滚动。 */
  height: min(620px, calc(100vh - 260px));
  min-height: 320px;
  max-height: 100%;
  overflow: hidden;
  padding: 2px 6px 8px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}
.dsh-my-skill-manager-root *,
.dsh-my-skill-manager-root *::before,
.dsh-my-skill-manager-root *::after { box-sizing: border-box; }
.dsh-my-skill-manager-root button {
  margin: 0; padding: 0; border: 0; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.dsh-my-skill-manager-root input { font: inherit; }
.dsh-my-skill-manager-root code,
.dsh-my-skill-manager-root pre,
.dsh-my-skill-manager-root kbd {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
.dsh-my-skill-manager-root svg { display: block; flex: none; }
.dsh-my-skill-manager-root ::selection {
  background: color-mix(in srgb, var(--skm-accent) 26%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-root :where(button, input, a, [tabindex]):focus-visible {
  outline: 2px solid var(--skm-accent);
  outline-offset: 2px;
  border-radius: 6px;
}
.dsh-my-skill-manager-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
@keyframes dsh-my-skill-manager-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dsh-my-skill-manager-spin { to { transform: rotate(360deg); } }
@keyframes dsh-my-skill-manager-pulse { 0%, 100% { opacity: .5; } 50% { opacity: .9; } }

`.trim();

    "use strict";
const STYLE_CHROME = `
/* ── 命令条（564px 硬约束：所有行 nowrap + min-width:0，禁止横向滚动）── */
.dsh-my-skill-manager-command {
  flex: none; display: flex; flex-direction: column; gap: 8px;
  min-width: 0; max-width: 100%;
}
.dsh-my-skill-manager-search-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
}
.dsh-my-skill-manager-search {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 9px; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-search:focus-within {
  box-shadow: inset 0 0 0 1px var(--skm-accent), 0 0 0 3px var(--skm-accent-ring);
}
.dsh-my-skill-manager-search-input {
  flex: 1; min-width: 0; border: 0; outline: none; background: none;
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xs-13);
  caret-color: var(--skm-accent); text-overflow: ellipsis;
}
.dsh-my-skill-manager-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-kbd {
  flex: none; display: inline-flex; align-items: center; height: 18px; padding: 0 5px;
  border-radius: 4px; background: var(--skm-surface-2);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  font-family: inherit;
}
.dsh-my-skill-manager-search-clear {
  flex: none; display: grid; place-items: center; width: 18px; height: 18px;
  border-radius: 4px; color: var(--dsw-alias-label-tertiary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-search-clear:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
/* 重新扫描：图标按钮（34×34），名称走 aria-label + title */
.dsh-my-skill-manager-scan {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-scan:hover:not(:disabled) { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-scan:disabled { cursor: progress; color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-scan-loading svg { animation: dsh-my-skill-manager-spin .9s linear infinite; }
/* 筛选按钮（图标 + 文字 + 生效条件数） */
.dsh-my-skill-manager-filter-wrap { position: relative; flex: none; }
.dsh-my-skill-manager-filter-btn {
  display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 9px;
  border-radius: 8px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-filter-btn:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-filter-btn[aria-expanded="true"] {
  background: var(--skm-surface-2); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-filter-btn-active {
  box-shadow: inset 0 0 0 1px var(--skm-accent); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-filter-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  background: var(--skm-accent-soft); color: var(--skm-accent);
  font: var(--dsw-font-xxxs-strong-11); font-variant-numeric: tabular-nums;
}
/* 概览行：4 个紧凑统计段（等分）+ 行末诊断入口 */
.dsh-my-skill-manager-stats-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
}
.dsh-my-skill-manager-stats {
  flex: 1; min-width: 0; display: flex; overflow: hidden; border-radius: 8px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-stat {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center;
  gap: 4px; height: 30px; padding: 0 4px; overflow: hidden; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  box-shadow: inset -1px 0 0 var(--skm-border);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-stat:last-child { box-shadow: none; }
.dsh-my-skill-manager-stat-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.dsh-my-skill-manager-stat b {
  flex: none; font-size: 15px; font-weight: 600; line-height: 1;
  color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-stat:hover { background: var(--skm-hover); }
.dsh-my-skill-manager-stat[aria-pressed="true"] { background: var(--skm-accent-soft); }
.dsh-my-skill-manager-stat[aria-pressed="true"] b { color: var(--skm-accent); }
.dsh-my-skill-manager-stat-warn b { color: var(--skm-warn); }
.dsh-my-skill-manager-diag-entry {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 30px; min-width: 30px; padding: 0 7px; border-radius: 8px;
  background: var(--skm-warn-soft); color: var(--skm-warn);
  box-shadow: inset 0 0 0 1px var(--skm-warn);
  font: var(--dsw-font-xxxs-strong-11); white-space: nowrap;
  transition: background var(--skm-ease);
}
.dsh-my-skill-manager-diag-entry b { font-variant-numeric: tabular-nums; }
.dsh-my-skill-manager-diag-entry:hover { background: var(--skm-surface-2); }
.dsh-my-skill-manager-diag-entry-idle {
  background: var(--skm-surface); color: var(--dsw-alias-label-tertiary);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-project-note {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-project-note span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 筛选面板（弹出层，替代常驻的 chips 两行）── */
.dsh-my-skill-manager-filter-panel {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  box-sizing: border-box; width: min(280px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-3, var(--skm-surface));
  box-shadow:
    0 0 0 1px var(--skm-border-strong),
    0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  animation: dsh-my-skill-manager-fade .15s ease-out both;
}
.dsh-my-skill-manager-filter-panel-title {
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-strong-12);
}
.dsh-my-skill-manager-filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-my-skill-manager-filter-group-label {
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); letter-spacing: .04em;
}
.dsh-my-skill-manager-filter-chip-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.dsh-my-skill-manager-filter-switch { width: 100%; justify-content: space-between; }
.dsh-my-skill-manager-filter-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  margin-top: 2px; padding-top: 8px; box-shadow: inset 0 1px 0 var(--skm-border);
}
.dsh-my-skill-manager-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 23px; padding: 0 8px;
  border-radius: 999px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-chip b {
  font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-chip:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-chip[aria-pressed="true"] {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-chip[aria-pressed="true"] b { color: var(--skm-accent); }
.dsh-my-skill-manager-src-dot {
  flex: none; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-chip .dsh-my-skill-manager-src-dot { width: 5px; height: 5px; margin-right: 1px; }
.dsh-my-skill-manager-src-dot-project { background: var(--skm-accent); }
.dsh-my-skill-manager-src-dot-user { background: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-src-dot-bundled { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-src-dot-other { background: var(--dsw-alias-label-dimmed); }
.dsh-my-skill-manager-src-dot-anomaly { background: var(--skm-warn); }

/* ── 工具条（单行：结果数 + 可截断扫描时间 + 右侧图标组）── */
.dsh-my-skill-manager-toolbar {
  flex: none; display: flex; align-items: center; gap: 6px;
  height: 34px; flex-wrap: nowrap; min-width: 0; overflow: hidden;
}
.dsh-my-skill-manager-result {
  flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
}
.dsh-my-skill-manager-result b {
  font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-scan-time {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-toolbar-right {
  flex: none; margin-left: auto; display: flex; align-items: center; gap: 4px;
}
.dsh-my-skill-manager-seg {
  display: inline-flex; flex: none; padding: 2px; border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-seg button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 24px; padding: 0; border-radius: 5px;
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-seg button:hover { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-seg button[aria-pressed="true"] {
  background: var(--skm-surface-3); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-sortwrap { position: relative; flex: none; }
.dsh-my-skill-manager-tool-text {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 7px;
  border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-tool-text:hover,
.dsh-my-skill-manager-tool-text[aria-expanded="true"] {
  background: var(--skm-surface-2); color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-sort-dir {
  flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  color: var(--dsw-alias-label-secondary); transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-sort-dir:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-select-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border-radius: 7px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-select-btn:hover { background: var(--skm-surface-2); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-select-btn[aria-pressed="true"] {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 164px; padding: 6px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-3, var(--skm-surface));
  box-shadow:
    0 0 0 1px var(--skm-border-strong),
    0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  animation: dsh-my-skill-manager-fade .15s ease-out both;
}
.dsh-my-skill-manager-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px;
  border-radius: 6px; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-menu-item:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-menu-item[aria-checked="true"] { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-menu-check {
  display: inline-grid; place-items: center; width: 14px; color: var(--skm-accent); opacity: 0;
}
.dsh-my-skill-manager-menu-item[aria-checked="true"] .dsh-my-skill-manager-menu-check { opacity: 1; }

`.trim();

    "use strict";
const STYLE_DECK = `
/* ── 列表容器 ── */
.dsh-my-skill-manager-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.dsh-my-skill-manager-list,
.dsh-my-skill-manager-table-wrap,
.dsh-my-skill-manager-state,
.dsh-my-skill-manager-diag {
  flex: 1; min-height: 0; overflow: auto;
  scrollbar-width: thin; scrollbar-color: var(--skm-scroll) transparent;
}
.dsh-my-skill-manager-list { padding: 2px 2px 4px; }
.dsh-my-skill-manager-list::-webkit-scrollbar,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar,
.dsh-my-skill-manager-state::-webkit-scrollbar,
.dsh-my-skill-manager-diag::-webkit-scrollbar { width: 8px; height: 8px; }
.dsh-my-skill-manager-list::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-state::-webkit-scrollbar-thumb,
.dsh-my-skill-manager-diag::-webkit-scrollbar-thumb {
  background: var(--skm-scroll); border-radius: 8px;
}
.dsh-my-skill-manager-list::-webkit-scrollbar-track,
.dsh-my-skill-manager-table-wrap::-webkit-scrollbar-track,
.dsh-my-skill-manager-state::-webkit-scrollbar-track,
.dsh-my-skill-manager-diag::-webkit-scrollbar-track { background: transparent; }

/* ── 来源分组 ── */
.dsh-my-skill-manager-group { padding-bottom: 6px; }
.dsh-my-skill-manager-group-head {
  position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 7px;
  padding: 7px 2px 6px; margin-bottom: 7px;
  background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-group-head h3 {
  margin: 0; font: var(--dsw-font-xxxs-strong-11); letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-group-count {
  display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-group-provider {
  margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-group-body { display: flex; flex-direction: column; gap: 7px; }

/* ── 技能卡 ── */
.dsh-my-skill-manager-card {
  position: relative; padding: 9px 10px 8px 16px; border-radius: 10px;
  background: var(--skm-surface); box-shadow: inset 0 0 0 1px var(--skm-border);
  transition: background var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-card:hover { background: var(--skm-surface-2); }
.dsh-my-skill-manager-card-selected {
  box-shadow: inset 0 0 0 1px var(--skm-accent), 0 0 0 3px var(--skm-accent-ring);
}
.dsh-my-skill-manager-card-bar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 10px 0 0 10px;
  background: var(--skm-success);
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-card-bar { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-card-anomaly .dsh-my-skill-manager-card-bar { background: var(--skm-warn); }
.dsh-my-skill-manager-card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-my-skill-manager-checkbox {
  flex: none; width: 13px; height: 13px; margin: 0;
  accent-color: var(--skm-accent); cursor: pointer;
}
.dsh-my-skill-manager-card-open {
  display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; text-align: left;
}
.dsh-my-skill-manager-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: var(--dsw-font-xs-strong-13); letter-spacing: .01em;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-name { color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-badge {
  display: inline-flex; align-items: center; flex: none; height: 16px; padding: 0 5px;
  border-radius: 4px; background: var(--skm-surface-3);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-strong-11); white-space: nowrap;
}
.dsh-my-skill-manager-badge-warn {
  background: var(--skm-warn-soft); color: var(--skm-warn); box-shadow: inset 0 0 0 1px var(--skm-warn);
}
.dsh-my-skill-manager-badge-quiet {
  background: transparent; color: var(--dsw-alias-label-tertiary);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-usage {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: none;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-usage svg { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-chevron {
  flex: none; color: var(--dsw-alias-label-tertiary);
  transition: transform .18s var(--ds-ease-in-out);
}
.dsh-my-skill-manager-card[data-expanded="true"] .dsh-my-skill-manager-chevron { transform: rotate(180deg); }
.dsh-my-skill-manager-desc {
  margin: 4px 0 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.5;
}
.dsh-my-skill-manager-card-off .dsh-my-skill-manager-desc { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-card-foot { display: flex; align-items: center; gap: 8px; min-height: 20px; flex-wrap: wrap; }
.dsh-my-skill-manager-scopes { display: inline-flex; align-items: center; gap: 10px; transition: opacity var(--skm-ease); }
.dsh-my-skill-manager-scopes-dim { opacity: .55; }
.dsh-my-skill-manager-foot-note {
  margin-left: auto; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
}

/* ── 开关 ── */
.dsh-my-skill-manager-switch {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 2px; border-radius: 6px;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: color var(--skm-ease);
}
.dsh-my-skill-manager-switch:hover:not(:disabled) { color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-track {
  position: relative; display: inline-block; flex: none; width: 26px; height: 15px;
  border-radius: 999px; background: var(--skm-track);
  box-shadow: inset 0 0 0 1px var(--skm-border-strong);
  transition: background var(--skm-ease), box-shadow var(--skm-ease);
}
.dsh-my-skill-manager-knob {
  position: absolute; top: 1.5px; left: 1.5px; width: 12px; height: 12px;
  border-radius: 50%; background: var(--skm-knob);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  transition: transform .16s var(--ds-ease-in-out), background var(--skm-ease);
}
.dsh-my-skill-manager-switch[aria-checked="true"] { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-switch[aria-checked="true"] .dsh-my-skill-manager-track {
  background: var(--skm-accent-soft); box-shadow: inset 0 0 0 1px var(--skm-accent);
}
.dsh-my-skill-manager-switch[aria-checked="true"] .dsh-my-skill-manager-knob {
  transform: translateX(11px); background: var(--skm-accent);
}
.dsh-my-skill-manager-switch-warn .dsh-my-skill-manager-track {
  background: var(--skm-warn-soft); box-shadow: inset 0 0 0 1px var(--skm-warn);
}
.dsh-my-skill-manager-switch-warn .dsh-my-skill-manager-knob { background: var(--skm-warn); }
.dsh-my-skill-manager-switch:disabled { cursor: not-allowed; opacity: .45; }
.dsh-my-skill-manager-switch-mini { gap: 0; }
.dsh-my-skill-manager-switch-mini .dsh-my-skill-manager-track { width: 22px; height: 13px; }
.dsh-my-skill-manager-switch-mini .dsh-my-skill-manager-knob { top: 1.5px; left: 1.5px; width: 10px; height: 10px; }
.dsh-my-skill-manager-switch-mini[aria-checked="true"] .dsh-my-skill-manager-knob { transform: translateX(9px); }

/* ── 内联错误 ── */
.dsh-my-skill-manager-inline-error {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 8px; padding: 7px 8px;
  border-radius: 7px; background: var(--skm-danger-soft);
  box-shadow: inset 0 0 0 1px var(--skm-danger);
  color: var(--skm-danger); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-inline-error > svg { margin-top: 1px; color: var(--skm-danger); }
.dsh-my-skill-manager-inline-error-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dsh-my-skill-manager-inline-error-title {
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-strong-11);
}
.dsh-my-skill-manager-inline-error-msg {
  color: var(--dsw-alias-label-secondary); line-height: 1.45; word-break: break-word;
}

/* ── 焦点详情 ── */
.dsh-my-skill-manager-detail {
  display: grid; grid-template-columns: 1fr 1fr; margin-top: 9px; padding-top: 9px;
  box-shadow: inset 0 1px 0 var(--skm-border);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
}
.dsh-my-skill-manager-detail-col { min-width: 0; padding-right: 12px; }
.dsh-my-skill-manager-detail-col-right {
  padding-right: 0; padding-left: 12px; box-shadow: inset 1px 0 0 var(--skm-border);
}
.dsh-my-skill-manager-detail-desc {
  margin: 0 0 7px; color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12); line-height: 1.55;
}
.dsh-my-skill-manager-meta { margin: 0; display: flex; flex-direction: column; gap: 5px; }
.dsh-my-skill-manager-meta-row {
  display: grid; grid-template-columns: 52px 1fr; gap: 6px; align-items: start;
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-meta-row dt { color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-meta-row dd {
  margin: 0; min-width: 0; display: flex; align-items: flex-start; gap: 4px; flex-wrap: wrap;
  color: var(--dsw-alias-label-secondary);
}
.dsh-my-skill-manager-meta-code {
  color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.45;
  word-break: break-all;
}
.dsh-my-skill-manager-cap {
  display: inline-flex; align-items: center; height: 17px; padding: 0 5px; border-radius: 4px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-icon-btn {
  display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  color: var(--dsw-alias-label-secondary);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-icon-btn:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-icon-btn-sm {
  flex: none; width: 20px; height: 20px; border-radius: 5px; color: var(--dsw-alias-label-tertiary);
}
.dsh-my-skill-manager-preview-head {
  display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-preview-note { font-style: normal; opacity: .8; }
.dsh-my-skill-manager-mini-btn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 6px; border-radius: 5px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-mini-btn:hover { color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-pre {
  margin: 0; padding: 7px 8px; max-height: 240px; overflow: auto;
  border-radius: 7px; background: var(--skm-code-bg);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--skm-code-fg); font-size: 10.5px; line-height: 1.5; white-space: pre;
  scrollbar-width: thin; scrollbar-color: var(--skm-scroll) transparent;
}
.dsh-my-skill-manager-pre::-webkit-scrollbar { width: 7px; height: 7px; }
.dsh-my-skill-manager-pre::-webkit-scrollbar-thumb { background: var(--skm-scroll); border-radius: 7px; }
.dsh-my-skill-manager-preview-state {
  display: block; padding: 7px 8px; border-radius: 7px; background: var(--skm-code-bg);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); line-height: 1.5;
}
.dsh-my-skill-manager-preview-state-error { color: var(--skm-danger); }
.dsh-my-skill-manager-preview-retry {
  margin-top: 5px; display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: 5px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-usage-stats {
  display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap;
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-usage-stats b { font: var(--dsw-font-xxxs-strong-11); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-missing {
  display: flex; flex-direction: column; gap: 5px; padding: 9px; border-radius: 7px;
  background: var(--skm-warn-soft); box-shadow: inset 0 0 0 1px var(--skm-warn);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11); line-height: 1.5;
}
.dsh-my-skill-manager-missing b { color: var(--skm-warn); font: var(--dsw-font-xxxs-strong-11); }
.dsh-my-skill-manager-missing code { font-size: 10.5px; word-break: break-all; color: var(--dsw-alias-label-secondary); }

`.trim();

    "use strict";
const STYLE_TABLE = `
/* ── 紧凑表 ── */
.dsh-my-skill-manager-table-wrap { padding-right: 2px; }
.dsh-my-skill-manager-table {
  width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed;
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-table thead th {
  position: sticky; top: 0; z-index: 2; height: 28px; padding: 0 6px;
  background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
  color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11);
  text-align: left; letter-spacing: .02em;
}
.dsh-my-skill-manager-th-sort { padding: 0 2px; }
.dsh-my-skill-manager-sortbtn {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px;
  border-radius: 5px; color: var(--dsw-alias-label-tertiary); font: inherit;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-sortbtn:hover { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-sortbtn svg { opacity: .4; }
.dsh-my-skill-manager-table th[aria-sort="ascending"] .dsh-my-skill-manager-sortbtn,
.dsh-my-skill-manager-table th[aria-sort="descending"] .dsh-my-skill-manager-sortbtn {
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-table th[aria-sort="ascending"] .dsh-my-skill-manager-sortbtn svg,
.dsh-my-skill-manager-table th[aria-sort="descending"] .dsh-my-skill-manager-sortbtn svg {
  opacity: 1; color: var(--skm-accent);
}
.dsh-my-skill-manager-col-check { width: 26px; }
.dsh-my-skill-manager-col-source { width: 58px; }
.dsh-my-skill-manager-col-usage { width: 40px; }
.dsh-my-skill-manager-col-recent { width: 78px; }
.dsh-my-skill-manager-col-scope { width: 66px; }
.dsh-my-skill-manager-row { height: 32px; }
.dsh-my-skill-manager-row:hover td { background: var(--skm-hover); }
.dsh-my-skill-manager-row td {
  padding: 0 6px; background: transparent;
  box-shadow: inset 0 -1px 0 var(--skm-border);
  color: var(--dsw-alias-label-secondary); vertical-align: middle; white-space: nowrap;
}
.dsh-my-skill-manager-row[data-expanded="true"] .dsh-my-skill-manager-chevron { transform: rotate(180deg); }
.dsh-my-skill-manager-row-selected td { background: var(--skm-selected); }
.dsh-my-skill-manager-row-selected td:first-child {
  box-shadow: inset 2px 0 0 var(--skm-accent), inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-row-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-my-skill-manager-row-bar {
  flex: none; width: 2px; height: 12px; border-radius: 1px; background: var(--skm-success);
}
.dsh-my-skill-manager-row-off .dsh-my-skill-manager-row-bar { background: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-row-anomaly .dsh-my-skill-manager-row-bar { background: var(--skm-warn); }
.dsh-my-skill-manager-row-open {
  display: flex; align-items: center; gap: 6px; min-width: 0; text-align: left;
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-row-open .dsh-my-skill-manager-name { font: var(--dsw-font-xxxs-strong-11); }
.dsh-my-skill-manager-row-open .dsh-my-skill-manager-chevron { opacity: .55; }
.dsh-my-skill-manager-th-scope { text-align: center; }
.dsh-my-skill-manager-scope-cell {
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.dsh-my-skill-manager-detail-row td {
  padding: 0 8px 10px; background: var(--skm-surface);
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-detail-row .dsh-my-skill-manager-detail { margin-top: 8px; padding-top: 8px; }
.dsh-my-skill-manager-detail-row .dsh-my-skill-manager-inline-error { margin-bottom: 8px; }

/* ── 批量操作条 ── */
.dsh-my-skill-manager-action {
  flex: none; height: 76px; display: flex; align-items: center; gap: 10px; padding: 0 12px;
  margin-bottom: 8px; border-radius: 9px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-accent);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
}
.dsh-my-skill-manager-action-info {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0;
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12);
}
.dsh-my-skill-manager-action-info > svg { color: var(--skm-accent); }
.dsh-my-skill-manager-action-info b {
  font: var(--dsw-font-s-strong-14); color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsh-my-skill-manager-action-note { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.dsh-my-skill-manager-action-btns {
  margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none;
}
.dsh-my-skill-manager-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 7px;
  background: var(--skm-surface-2); box-shadow: inset 0 0 0 1px var(--skm-border-strong);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxxs-11); white-space: nowrap;
  transition: background var(--skm-ease), color var(--skm-ease);
}
.dsh-my-skill-manager-btn:hover:not(:disabled) { background: var(--skm-surface-3); }
.dsh-my-skill-manager-btn:disabled { opacity: .4; cursor: not-allowed; }
.dsh-my-skill-manager-btn-primary {
  background: var(--skm-accent); color: var(--skm-on-accent); box-shadow: none;
}
.dsh-my-skill-manager-btn-primary:hover:not(:disabled) { background: var(--skm-accent-strong); }
.dsh-my-skill-manager-btn-ghost { background: none; box-shadow: none; color: var(--dsw-alias-label-secondary); }
.dsh-my-skill-manager-btn-ghost:hover:not(:disabled) { background: var(--skm-hover); color: var(--dsw-alias-label-primary); }
.dsh-my-skill-manager-btn-danger { background: var(--skm-danger); color: var(--skm-on-accent); box-shadow: none; }
.dsh-my-skill-manager-btn-danger-ghost {
  background: none; box-shadow: inset 0 0 0 1px var(--skm-danger); color: var(--skm-danger);
}
.dsh-my-skill-manager-btn-danger-ghost:hover:not(:disabled) { background: var(--skm-danger-soft); }
.dsh-my-skill-manager-action-confirm {
  background: var(--skm-danger-soft); box-shadow: inset 0 0 0 1px var(--skm-danger);
}
.dsh-my-skill-manager-action-confirm > svg { color: var(--skm-danger); }
.dsh-my-skill-manager-action-confirm .dsh-my-skill-manager-action-info {
  color: var(--dsw-alias-label-primary);
}
.dsh-my-skill-manager-action-confirm .dsh-my-skill-manager-action-info em {
  font-style: normal; color: var(--dsw-alias-label-tertiary); font-size: 10.5px;
}

/* ── 状态页：加载 / 空 / 失败 ── */
.dsh-my-skill-manager-state { padding: 2px; }
.dsh-my-skill-manager-empty,
.dsh-my-skill-manager-error {
  flex: 1; min-height: 320px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 28px 24px; text-align: center;
}
.dsh-my-skill-manager-empty > svg { margin-bottom: 10px; color: var(--dsw-alias-label-tertiary); }
.dsh-my-skill-manager-error > svg { margin-bottom: 10px; color: var(--skm-danger); }
.dsh-my-skill-manager-empty h2,
.dsh-my-skill-manager-error h2 {
  margin: 0 0 6px; color: var(--dsw-alias-label-primary); font: var(--dsw-font-s-strong-14);
}
.dsh-my-skill-manager-empty p,
.dsh-my-skill-manager-error p {
  margin: 0; max-width: 372px; color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12); line-height: 1.6; white-space: pre-wrap;
}
.dsh-my-skill-manager-error p code {
  color: var(--skm-warn); font-size: 11px; word-break: break-all;
}
.dsh-my-skill-manager-empty-actions {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 14px; flex-wrap: wrap;
}
.dsh-my-skill-manager-empty-preview {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 7px 10px;
  border-radius: 8px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 6px 2px; }
.dsh-my-skill-manager-skel-head {
  width: 110px; height: 10px; border-radius: 4px; background: var(--skm-surface-3);
  animation: dsh-my-skill-manager-pulse 1.4s ease-in-out infinite;
}
.dsh-my-skill-manager-skel-card {
  height: 72px; display: flex; flex-direction: column; gap: 9px; padding: 12px 14px;
  border-radius: 10px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
  animation: dsh-my-skill-manager-pulse 1.4s ease-in-out infinite;
}
.dsh-my-skill-manager-skel-line { height: 8px; border-radius: 4px; background: var(--skm-surface-3); }
.dsh-my-skill-manager-w25 { width: 25%; }
.dsh-my-skill-manager-w40 { width: 40%; }
.dsh-my-skill-manager-w55 { width: 55%; }
.dsh-my-skill-manager-w70 { width: 70%; }

/* ── 诊断台 ── */
.dsh-my-skill-manager-diag { padding: 2px 2px 8px; }
.dsh-my-skill-manager-diag-head {
  display: flex; align-items: center; gap: 10px; padding: 6px 2px 12px; margin-bottom: 12px;
  box-shadow: inset 0 -1px 0 var(--skm-border);
}
.dsh-my-skill-manager-diag-title h2 {
  margin: 0; color: var(--dsw-alias-label-primary); font: var(--dsw-font-s-strong-14);
}
.dsh-my-skill-manager-diag-title p {
  margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-head .dsh-my-skill-manager-btn { margin-left: auto; }
.dsh-my-skill-manager-diag-card {
  padding: 12px; margin-bottom: 10px; border-radius: 10px; background: var(--skm-surface);
  box-shadow: inset 0 0 0 1px var(--skm-border);
}
.dsh-my-skill-manager-diag-card-head {
  display: flex; align-items: flex-start; gap: 9px; margin-bottom: 10px;
}
.dsh-my-skill-manager-diag-card-head > svg { margin-top: 1px; color: var(--skm-warn); }
.dsh-my-skill-manager-diag-card-head h3 {
  margin: 0; color: var(--dsw-alias-label-primary); font: var(--dsw-font-xs-strong-13);
}
.dsh-my-skill-manager-diag-card-head p {
  margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-card-head .dsh-my-skill-manager-badge { margin-left: auto; }
.dsh-my-skill-manager-diag-meta { margin: 0; display: flex; flex-direction: column; gap: 7px; }
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-row {
  grid-template-columns: 38px 1fr; font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-row dd { align-items: center; }
.dsh-my-skill-manager-diag-meta .dsh-my-skill-manager-meta-code { font-size: 10.5px; }
.dsh-my-skill-manager-diag-foot {
  margin-top: 14px; text-align: center; color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.dsh-my-skill-manager-diag-empty {
  padding: 40px 16px; text-align: center; color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}

/* ── Toast ── */
.dsh-my-skill-manager-toast {
  position: absolute; left: 50%; bottom: 14px; z-index: 80;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 7px;
  max-width: min(640px, calc(100% - 24px)); padding: 8px 12px; border-radius: 8px;
  background: var(--skm-surface-3);
  box-shadow:
    0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent),
    inset 0 0 0 1px var(--skm-border-strong);
  color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12);
  animation: dsh-my-skill-manager-fade .18s ease-out both;
  pointer-events: none;
}
.dsh-my-skill-manager-toast-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--skm-accent); }
.dsh-my-skill-manager-toast[data-kind="error"] .dsh-my-skill-manager-toast-dot { background: var(--skm-danger); }
.dsh-my-skill-manager-toast[data-kind="success"] .dsh-my-skill-manager-toast-dot { background: var(--skm-success); }

/* ── 收窄 ── */
@media (max-width: 560px) {
  .dsh-my-skill-manager-detail { grid-template-columns: 1fr; }
  .dsh-my-skill-manager-detail-col { padding-right: 0; }
  .dsh-my-skill-manager-detail-col-right {
    padding-left: 0; margin-top: 9px; padding-top: 9px;
    box-shadow: inset 0 1px 0 var(--skm-border);
  }
  .dsh-my-skill-manager-foot-note { display: none; }
  .dsh-my-skill-manager-group-provider { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-my-skill-manager-root *,
  .dsh-my-skill-manager-root *::before,
  .dsh-my-skill-manager-root *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();

    "use strict";
const STYLES = [STYLE_TOKENS, STYLE_CHROME, STYLE_DECK, STYLE_TABLE].join('\n');
const STYLE_TAG = 'data-dsh-my-skill-manager';

    "use strict";
const API_BASE = '/my-skill-manager/api';
function errorMessageOf(raw) {
    if (typeof raw === 'string')
        return raw;
    if (raw === null || typeof raw !== 'object')
        return '';
    const message = raw.message;
    return typeof message === 'string' ? message : '';
}
function apiMessage(body, fallback) {
    if (body === null || typeof body !== 'object')
        return fallback;
    const source = body;
    const fromError = errorMessageOf(source.error);
    if (fromError !== '')
        return fromError;
    const fromBody = errorMessageOf(source.message);
    return fromBody === '' ? fallback : fromBody;
}
function apiRequest(path, init, fallback) {
    return fetch(API_BASE + path, init)
        .then((response) => response.json())
        .then((body) => {
        if (body === null || typeof body !== 'object' || body.ok !== true) {
            throw new Error(apiMessage(body, fallback));
        }
        return body.value;
    });
}
function errorText(error) {
    if (error instanceof Error && error.message !== '')
        return error.message;
    if (typeof error === 'string' && error !== '')
        return error;
    return strings.saveFailedFallback();
}
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function asStringList(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value)
        if (typeof entry === 'string')
            out.push(entry);
    return out;
}
function normalizeUsage(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const entry = raw;
    if (typeof entry.count !== 'number' && typeof entry.lastUsedAt !== 'number')
        return null;
    return {
        count: asNumber(entry.count),
        lastUsedAt: asNumber(entry.lastUsedAt),
        lastSource: entry.lastSource === 'model' ? 'model' : 'user',
    };
}
function normalizeInvocation(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const entry = raw;
    if (typeof entry.modelInvocable !== 'boolean' && typeof entry.userInvocable !== 'boolean')
        return null;
    return {
        modelInvocable: entry.modelInvocable === true,
        userInvocable: entry.userInvocable === true,
    };
}
function normalizeUsageMap(raw) {
    const usage = {};
    if (raw === null || typeof raw !== 'object')
        return usage;
    const table = raw;
    for (const key of Object.keys(table)) {
        const entry = normalizeUsage(table[key]);
        if (entry !== null)
            usage[key] = entry;
    }
    return usage;
}
function normalizeMissing(raw) {
    const missing = [];
    if (raw === null || typeof raw !== 'object')
        return missing;
    const list = raw.missing;
    if (!Array.isArray(list))
        return missing;
    for (const entry of list) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const row = entry;
        missing.push({ name: asString(row.name), path: asString(row.path), reason: asString(row.reason) });
    }
    return missing;
}
function normalizeSkills(raw) {
    const skills = [];
    if (!Array.isArray(raw))
        return skills;
    for (const entry of raw) {
        if (entry !== null && typeof entry === 'object')
            skills.push(entry);
    }
    return skills;
}
function normalizeList(value) {
    const payload = (value !== null && typeof value === 'object' ? value : {});
    return {
        cwd: asString(payload.cwd),
        projectRoot: asString(payload.projectRoot),
        scannedAt: asNumber(payload.scannedAt),
        skills: normalizeSkills(payload.skills),
        globalDisabled: asStringList(payload.globalDisabled),
        projectDisabled: asStringList(payload.projectDisabled),
        missing: normalizeMissing(payload.diagnostics),
        usage: normalizeUsageMap(payload.usage),
    };
}
function apiQuery(cwd) {
    return cwd === '' ? '' : '?cwd=' + encodeURIComponent(cwd);
}
function fetchList(cwd) {
    return apiRequest('/list' + apiQuery(cwd), undefined, strings.listFailedFallback()).then(normalizeList);
}
function rescanCatalog(cwd) {
    return apiRequest('/rescan' + apiQuery(cwd), undefined, strings.rescanFailedFallback()).then(normalizeList);
}
function fetchDetail(name, cwd) {
    const query = '/detail?name=' + encodeURIComponent(name) + (cwd === '' ? '' : '&cwd=' + encodeURIComponent(cwd));
    return apiRequest(query, undefined, strings.detailFailedFallback()).then((value) => {
        const payload = (value !== null && typeof value === 'object' ? value : {});
        return {
            name: asString(payload.name) === '' ? name : asString(payload.name),
            path: asString(payload.path),
            content: asString(payload.content),
            truncated: payload.truncated === true,
        };
    });
}
function saveConfig(scope, disabled, cwd) {
    return apiRequest('/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, disabled, cwd }),
    }, strings.saveFailedFallback()).then(() => undefined);
}
function currentSessionId() {
    try {
        const raw = localStorage.getItem('dsh.sessions.current');
        const parsed = raw === null ? null : JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object') {
            const sessionId = parsed.sessionId;
            if (typeof sessionId === 'string')
                return sessionId;
        }
        return '';
    }
    catch {
        return '';
    }
}
function fetchSessionCwd(sessionId) {
    if (sessionId === '')
        return Promise.resolve('');
    return apiRequest('/session?sessionId=' + encodeURIComponent(sessionId), undefined, 'session failed')
        .then((value) => {
        if (value === null || typeof value !== 'object')
            return '';
        return asString(value.cwd);
    })
        .catch(() => '');
}

    "use strict";
const SOURCE_GROUP_ORDER = {
    project: 0,
    user: 1,
    bundled: 2,
    other: 3,
    anomaly: 4,
};
function groupSource(source) {
    const value = source.toLowerCase();
    if (value.indexOf('project') !== -1)
        return 'project';
    if (value.indexOf('user') !== -1 || value.indexOf('agent') !== -1)
        return 'user';
    if (value.indexOf('bundled') !== -1 || value.indexOf('builtin') !== -1 || value.indexOf('runtime') !== -1) {
        return 'bundled';
    }
    return 'other';
}
function isAnomaly(item) {
    return item.missing;
}
function usageCountOf(item) {
    return item.usage === null ? 0 : item.usage.count;
}
function lastUsedOf(item) {
    return item.usage === null ? 0 : item.usage.lastUsedAt;
}
function toSkillItem(row, list) {
    const name = asString(row.name).trim();
    if (name === '')
        return null;
    const source = asString(row.source);
    return {
        key: 'skill:' + name,
        name,
        description: asString(row.description),
        source,
        group: groupSource(source),
        provider: asString(row.provider),
        path: asString(row.path),
        cataloged: row.cataloged !== false,
        missing: false,
        reason: '',
        invocation: normalizeInvocation(row.invocation),
        usage: normalizeUsage(row.usage) ?? list.usage[name] ?? null,
        globalOn: list.globalDisabled.indexOf(name) === -1,
        projectOn: list.projectDisabled.indexOf(name) === -1,
    };
}
function missingToItem(entry) {
    const name = asString(entry.name).trim();
    const path = asString(entry.path).trim();
    if (name === '' && path === '')
        return null;
    const reason = asString(entry.reason);
    return {
        key: 'missing:' + (path === '' ? name : path),
        name: name === '' ? path : name,
        description: '',
        source: '',
        group: 'anomaly',
        provider: '',
        path,
        cataloged: false,
        missing: true,
        reason: reason === '' ? 'parse-failed' : reason,
        invocation: null,
        usage: null,
        globalOn: false,
        projectOn: false,
    };
}
function pushUnique(items, seen, item) {
    if (item === null)
        return;
    if (seen.has(item.key))
        return;
    seen.add(item.key);
    items.push(item);
}
function buildItems(list) {
    const items = [];
    const seen = new Set();
    for (const row of list.skills)
        pushUnique(items, seen, toSkillItem(row, list));
    for (const entry of list.missing)
        pushUnique(items, seen, missingToItem(entry));
    return items;
}
function countsOf(items) {
    const counts = {
        all: 0,
        enabled: 0,
        disabled: 0,
        anomaly: 0,
        project: 0,
        user: 0,
        bundled: 0,
        other: 0,
        unused: 0,
    };
    for (const item of items) {
        counts.all += 1;
        if (item.group !== 'anomaly')
            counts[item.group] += 1;
        if (isAnomaly(item))
            counts.anomaly += 1;
        else if (item.globalOn)
            counts.enabled += 1;
        else
            counts.disabled += 1;
        if (!isAnomaly(item) && usageCountOf(item) === 0)
            counts.unused += 1;
    }
    return counts;
}
function matchesSource(item, source) {
    return source === 'all' || item.group === source;
}
function matchesStatus(item, status) {
    if (status === 'enabled')
        return !isAnomaly(item) && item.globalOn;
    if (status === 'disabled')
        return !isAnomaly(item) && !item.globalOn;
    if (status === 'anomaly')
        return isAnomaly(item);
    return true;
}
function matchesUnused(item, unusedOnly) {
    return !unusedOnly || (!isAnomaly(item) && usageCountOf(item) === 0);
}
function matchesQuery(item, query) {
    if (query === '')
        return true;
    const haystack = (item.name +
        ' ' +
        item.description +
        ' ' +
        item.path +
        ' ' +
        item.provider +
        ' ' +
        item.source).toLowerCase();
    return haystack.indexOf(query) !== -1;
}
function filterItems(items, filters) {
    const query = filters.query.trim().toLowerCase();
    return items.filter((item) => matchesSource(item, filters.source) &&
        matchesStatus(item, filters.status) &&
        matchesUnused(item, filters.unusedOnly) &&
        matchesQuery(item, query));
}
function sortItems(items, key, dir) {
    const factor = dir === 'asc' ? 1 : -1;
    return items.slice().sort((a, b) => {
        const byName = a.name.localeCompare(b.name, 'en');
        let result = 0;
        if (key === 'name')
            result = byName;
        else if (key === 'usage')
            result = usageCountOf(a) - usageCountOf(b) || byName;
        else if (key === 'recent')
            result = lastUsedOf(a) - lastUsedOf(b) || byName;
        else
            result = SOURCE_GROUP_ORDER[a.group] - SOURCE_GROUP_ORDER[b.group] || byName;
        return result * factor;
    });
}
function groupItems(items) {
    const order = ['project', 'user', 'bundled', 'other', 'anomaly'];
    const groups = [];
    for (const group of order) {
        const members = items.filter((item) => item.group === group);
        if (members.length > 0)
            groups.push({ group, items: members });
    }
    return groups;
}
function toggleNameInList(list, name, disabled) {
    const present = list.indexOf(name) !== -1;
    if (disabled && !present)
        return list.concat([name]);
    if (!disabled && present)
        return list.filter((entry) => entry !== name);
    return list.slice();
}
function applyDisabledForNames(list, names, disabled) {
    let next = list.slice();
    for (const name of names)
        next = toggleNameInList(next, name, disabled);
    return next;
}
function pad2(value) {
    return value < 10 ? '0' + String(value) : String(value);
}
function formatClock(ts) {
    if (ts <= 0)
        return '—';
    const date = new Date(ts);
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
}
function formatRecent(ts) {
    if (ts <= 0)
        return '';
    const date = new Date(ts);
    return (pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()));
}
function firstLines(text, count) {
    return text.split('\n').slice(0, count).join('\n');
}
function activeStatOf(filters) {
    if (filters.status === 'enabled')
        return 'enabled';
    if (filters.status === 'disabled')
        return 'disabled';
    if (filters.status === 'anomaly' || filters.source === 'anomaly')
        return 'anomaly';
    if (filters.source === 'all' && !filters.unusedOnly)
        return 'all';
    return '';
}
function isInteractiveEvent(event) {
    if (event === null || typeof event !== 'object')
        return false;
    const target = event.target;
    if (target === null || typeof target !== 'object')
        return false;
    const closest = target.closest;
    if (typeof closest !== 'function')
        return false;
    return (closest.call(target, 'button,input,a,label,pre,code,textarea,select') !== null);
}
function copyToClipboard(text) {
    if (text === '')
        return Promise.resolve(false);
    try {
        const nav = navigator;
        if (nav.clipboard !== undefined && typeof nav.clipboard.writeText === 'function') {
            return nav.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
        }
    }
    catch {
    }
    return fallbackCopy(text);
}
function fallbackCopy(text) {
    try {
        if (typeof document === 'undefined' || document === null || document.body === null)
            return Promise.resolve(false);
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
        document.body.removeChild(area);
        return Promise.resolve(ok === true);
    }
    catch {
        return Promise.resolve(false);
    }
}

    "use strict";
function groupProviderOf(group) {
    if (group.group === 'anomaly')
        return strings.groupAnomalyHint();
    const first = group.items[0];
    if (first === undefined)
        return '';
    const parts = [];
    if (first.source !== '')
        parts.push(first.source);
    if (first.provider !== '' && first.provider !== first.source)
        parts.push(first.provider);
    return parts.length === 0 ? strings.usageViaNone() : parts.join(' · ');
}
function groupLabelOf(group) {
    if (group === 'project')
        return strings.groupProject();
    if (group === 'user')
        return strings.groupUser();
    if (group === 'bundled')
        return strings.groupBundled();
    if (group === 'other')
        return strings.groupOther();
    return strings.groupAnomaly();
}
function sourceLabelOf(source) {
    return groupLabelOf(groupSource(source));
}
function badgeElement(className, text, key) {
    const props = { className: 'dsh-my-skill-manager-badge ' + className };
    if (key !== undefined)
        props.key = key;
    return createElement('span', props, text);
}
function skillBadges(item) {
    if (isAnomaly(item)) {
        return [
            badgeElement('dsh-my-skill-manager-badge-warn', strings.reasonShort(item.reason), 'reason'),
            badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeScanIssue(), 'scan-issue'),
        ];
    }
    if (!item.globalOn)
        return [badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeGlobalOff(), 'global-off')];
    if (!item.projectOn)
        return [badgeElement('dsh-my-skill-manager-badge-quiet', strings.badgeProjectOff(), 'project-off')];
    return [];
}
function usageElement(item) {
    const count = usageCountOf(item);
    if (count === 0) {
        return createElement('span', { className: 'dsh-my-skill-manager-usage' }, glyph.activity(12), strings.usageNever());
    }
    const recent = formatRecent(lastUsedOf(item));
    const title = strings.usageTitle(count, recent === '' ? strings.usageViaNone() : recent);
    return createElement('span', { className: 'dsh-my-skill-manager-usage', title }, glyph.activity(12), strings.usageTimes(count) + (recent === '' ? '' : ' · ' + recent));
}
function footNote(item, projectCtx) {
    if (isAnomaly(item))
        return strings.footAnomaly();
    if (!projectCtx)
        return strings.footNoProject();
    if (!item.globalOn)
        return strings.footGlobalOff();
    if (!item.projectOn)
        return strings.footProjectOff();
    return '';
}
function scopeSwitchState(props) {
    const unavailable = props.disabled || (props.scope === 'project' && !props.projectCtx);
    const checked = props.scope === 'project' && !props.projectCtx ? false : props.checked;
    const warn = props.scope === 'project' && !unavailable && !props.checked;
    return { checked, unavailable, warn };
}
function scopeSwitchClasses(props, warn) {
    const classes = ['dsh-my-skill-manager-switch'];
    if (props.mini === true)
        classes.push('dsh-my-skill-manager-switch-mini');
    if (warn)
        classes.push('dsh-my-skill-manager-switch-warn');
    return classes.join(' ');
}
function ScopeSwitch(props) {
    const label = props.scope === 'global' ? strings.scopeGlobal() : strings.scopeProject();
    const state = scopeSwitchState(props);
    const buttonProps = {
        type: 'button',
        role: 'switch',
        className: scopeSwitchClasses(props, state.warn),
        'aria-checked': state.checked,
        'aria-label': strings.scopeAria(props.item.name, label, state.checked, state.unavailable),
        disabled: state.unavailable,
        title: strings.scopeTitle(label, state.checked, state.unavailable),
    };
    if (!state.unavailable)
        buttonProps.onClick = () => props.onToggle(props.item, props.scope);
    return createElement('button', buttonProps, props.mini === true ? null : createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, label), createElement('span', { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' }, createElement('span', { className: 'dsh-my-skill-manager-knob' })));
}
function InlineError(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-inline-error', role: 'alert' }, icon.alert(14), createElement('div', { className: 'dsh-my-skill-manager-inline-error-body' }, createElement('b', { className: 'dsh-my-skill-manager-inline-error-title' }, strings.inlineErrorTitle(props.item.name)), createElement('span', { className: 'dsh-my-skill-manager-inline-error-msg' }, props.error.message)), createElement('button', { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onRetry(props.item) }, strings.retry()));
}

    "use strict";
function capElement(text) {
    return createElement('span', { className: 'dsh-my-skill-manager-cap' }, text);
}
function metaRow(label, ...values) {
    return createElement('div', { className: 'dsh-my-skill-manager-meta-row' }, createElement('dt', {}, label), createElement('dd', {}, ...values));
}
function detailCaps(item) {
    const caps = [];
    if (item.invocation !== null) {
        if (item.invocation.modelInvocable)
            caps.push(capElement(strings.capModel()));
        if (item.invocation.userInvocable)
            caps.push(capElement(strings.capUser()));
    }
    if (caps.length === 0)
        caps.push(capElement(strings.usageViaNone()));
    return caps;
}
function detailScopeText(item, anomaly) {
    if (anomaly)
        return strings.scopeUnavailable();
    return (strings.scopeGlobal() +
        ' ' +
        strings.scopeState(item.globalOn) +
        ' · ' +
        strings.scopeProject() +
        ' ' +
        strings.scopeState(item.projectOn));
}
function detailSourceText(item, anomaly) {
    if (anomaly)
        return strings.groupAnomaly() + ' · ' + strings.detailScanIssue();
    const origin = item.source === '' ? strings.groupOther() : sourceLabelOf(item.source);
    return origin + ' · ' + (item.cataloged ? strings.detailCollected() : strings.detailDiscovered());
}
function detailPreview(item, detail, handlers) {
    if (isAnomaly(item)) {
        return createElement('div', { className: 'dsh-my-skill-manager-missing' }, createElement('b', {}, strings.reasonShort(item.reason)), createElement('span', {}, strings.reasonText(item.reason)), createElement('code', {}, item.path === '' ? strings.usageViaNone() : item.path));
    }
    if (detail === undefined || detail.status === 'loading') {
        return createElement('div', { className: 'dsh-my-skill-manager-preview-state', role: 'status' }, strings.previewLoading());
    }
    if (detail.status === 'error') {
        return createElement('div', { className: 'dsh-my-skill-manager-preview-state dsh-my-skill-manager-preview-state-error', role: 'alert' }, detail.message, createElement('button', {
            type: 'button',
            className: 'dsh-my-skill-manager-preview-retry',
            onClick: () => handlers.onRetryDetail(item),
        }, icon.refresh(12), strings.retry()));
    }
    if (detail.content.trim() === '') {
        return createElement('div', { className: 'dsh-my-skill-manager-preview-state' }, strings.previewEmpty());
    }
    return createElement('pre', { className: 'dsh-my-skill-manager-pre' }, firstLines(detail.content, 15));
}
function detailPreviewHead(item, anomaly, handlers) {
    return createElement('div', { className: 'dsh-my-skill-manager-preview-head' }, createElement('span', {}, strings.previewTitle()), createElement('em', { className: 'dsh-my-skill-manager-preview-note' }, anomaly ? strings.previewUnavailable() : strings.previewFirstLines()), anomaly
        ? null
        : createElement('button', {
            type: 'button',
            className: 'dsh-my-skill-manager-mini-btn',
            'aria-label': strings.copyMdAria(item.name),
            onClick: () => handlers.onCopyMd(item),
        }, icon.copy(12), strings.copyFull()));
}
function detailStats(item) {
    const recent = formatRecent(lastUsedOf(item));
    return createElement('div', { className: 'dsh-my-skill-manager-usage-stats' }, createElement('span', {}, createElement('b', {}, String(usageCountOf(item))), ' ' + strings.usageCallsUnit()), createElement('span', {}, strings.usageRecent(recent === '' ? strings.usageViaNone() : recent)), createElement('span', {}, strings.usageVia(item.usage === null ? '' : item.usage.lastSource)));
}
function detailLeft(item, anomaly, handlers) {
    return createElement('div', { className: 'dsh-my-skill-manager-detail-col' }, createElement('p', { className: 'dsh-my-skill-manager-detail-desc' }, item.description), createElement('dl', { className: 'dsh-my-skill-manager-meta' }, metaRow(strings.detailPath(), createElement('code', { className: 'dsh-my-skill-manager-meta-code' }, item.path === '' ? strings.usageViaNone() : item.path), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-icon-btn dsh-my-skill-manager-icon-btn-sm',
        'aria-label': strings.copyPathAria(item.name),
        onClick: () => handlers.onCopyPath(item),
    }, icon.copy(13))), metaRow(strings.detailProvider(), item.provider === '' ? strings.usageViaNone() : item.provider), metaRow(strings.detailInvocation(), ...detailCaps(item)), metaRow(strings.detailSource(), detailSourceText(item, anomaly)), metaRow(strings.detailScopes(), detailScopeText(item, anomaly)), anomaly ? metaRow(strings.detailReason(), strings.reasonText(item.reason)) : null, anomaly ? metaRow(strings.detailSuggestion(), strings.reasonSuggestion(item.reason)) : null));
}
function detailRight(item, anomaly, detail, handlers) {
    const truncated = detail !== undefined && detail.truncated;
    return createElement('div', { className: 'dsh-my-skill-manager-detail-col dsh-my-skill-manager-detail-col-right' }, detailPreviewHead(item, anomaly, handlers), detailPreview(item, detail, handlers), truncated
        ? createElement('div', { className: 'dsh-my-skill-manager-preview-state' }, strings.truncatedNote())
        : null, detailStats(item));
}
function FocusDetail(props) {
    const anomaly = isAnomaly(props.item);
    return createElement('div', { className: 'dsh-my-skill-manager-detail', id: props.id }, detailLeft(props.item, anomaly, props.handlers), detailRight(props.item, anomaly, props.detail, props.handlers));
}

    "use strict";
function cardClasses(item, selected) {
    const classes = ['dsh-my-skill-manager-card'];
    if (isAnomaly(item))
        classes.push('dsh-my-skill-manager-card-anomaly');
    else if (!item.globalOn)
        classes.push('dsh-my-skill-manager-card-off');
    if (selected)
        classes.push('dsh-my-skill-manager-card-selected');
    return classes.join(' ');
}
function cardOpenButton(item, expanded, shared) {
    return createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-card-open',
        'aria-expanded': expanded,
        'aria-controls': 'detail-' + item.key,
        title: strings.cardOpenAria(item.name, expanded),
        onClick: () => shared.handlers.onToggleDetail(item),
    }, createElement('span', { className: 'dsh-my-skill-manager-name' }, item.name), createElement('span', {
        className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + item.group,
        'aria-hidden': 'true',
    }), skillBadges(item), usageElement(item), createElement('span', { className: 'dsh-my-skill-manager-chevron' }, icon.chevronDown(14)));
}
function cardTopRow(item, expanded, selected, shared) {
    const checkbox = shared.selectionMode
        ? createElement('input', {
            type: 'checkbox',
            className: 'dsh-my-skill-manager-checkbox',
            'aria-label': strings.selectRowAria(item.name),
            checked: selected,
            onChange: () => shared.handlers.onToggleSelect(item.key),
        })
        : null;
    return createElement('div', { className: 'dsh-my-skill-manager-card-top' }, checkbox, cardOpenButton(item, expanded, shared));
}
function cardScopes(item, anomaly, shared) {
    const dimmed = !item.globalOn && !anomaly;
    return createElement('div', {
        className: 'dsh-my-skill-manager-scopes' + (dimmed ? ' dsh-my-skill-manager-scopes-dim' : ''),
    }, createElement(ScopeSwitch, {
        item,
        scope: 'global',
        checked: item.globalOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        onToggle: shared.handlers.onToggleScope,
    }), createElement(ScopeSwitch, {
        item,
        scope: 'project',
        checked: item.projectOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        onToggle: shared.handlers.onToggleScope,
    }));
}
function cardFoot(item, anomaly, shared) {
    const note = footNote(item, shared.projectCtx);
    return createElement('div', { className: 'dsh-my-skill-manager-card-foot' }, cardScopes(item, anomaly, shared), note === '' ? null : createElement('span', { className: 'dsh-my-skill-manager-foot-note' }, note));
}
function SkillCard(props) {
    const item = props.item;
    const shared = props.shared;
    const expanded = shared.expanded.indexOf(item.key) !== -1;
    const selected = shared.selected.indexOf(item.key) !== -1;
    const anomaly = isAnomaly(item);
    const error = shared.inlineError !== null && shared.inlineError.key === item.key ? shared.inlineError : null;
    return createElement('article', {
        className: cardClasses(item, selected),
        'data-expanded': expanded ? 'true' : 'false',
        'data-id': item.key,
        onClick: (event) => {
            if (!isInteractiveEvent(event))
                shared.handlers.onToggleDetail(item);
        },
    }, createElement('span', { className: 'dsh-my-skill-manager-card-bar', 'aria-hidden': 'true' }), cardTopRow(item, expanded, selected, shared), createElement('p', { className: 'dsh-my-skill-manager-desc' }, item.description), cardFoot(item, anomaly, shared), error === null ? null : createElement(InlineError, { item, error, onRetry: shared.handlers.onRetryInline }), expanded
        ? createElement(FocusDetail, {
            id: 'detail-' + item.key,
            item,
            detail: shared.details[item.key],
            projectCtx: shared.projectCtx,
            handlers: shared.handlers,
        })
        : null);
}
function groupHead(group) {
    return createElement('header', { className: 'dsh-my-skill-manager-group-head' }, createElement('span', {
        className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + group.group,
        'aria-hidden': 'true',
    }), createElement('h3', {}, groupLabelOf(group.group)), createElement('span', { className: 'dsh-my-skill-manager-group-count' }, String(group.items.length)), createElement('span', { className: 'dsh-my-skill-manager-group-provider' }, groupProviderOf(group)));
}
function CardsView(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-list' }, props.groups.map((group) => createElement('section', { key: group.group, className: 'dsh-my-skill-manager-group', 'data-group': group.group }, groupHead(group), createElement('div', { className: 'dsh-my-skill-manager-group-body' }, group.items.map((item) => createElement(SkillCard, { key: item.key, item, shared: props.shared }))))));
}

    "use strict";
function ariaSortFor(key, sortKey, sortDir) {
    if (sortKey !== key)
        return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
}
function sortGlyph(key, sortKey, sortDir) {
    if (sortKey !== key)
        return glyph.sortNeutral(12);
    return sortDir === 'asc' ? glyph.arrowUp(12) : glyph.arrowDown(12);
}
function sortHeader(key, label, props) {
    return createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-sortbtn',
        'aria-label': strings.sortByAria(label),
        onClick: () => props.onSort(key),
    }, label, sortGlyph(key, props.sortKey, props.sortDir));
}
function sortableTh(key, label, props) {
    return createElement('th', {
        className: 'dsh-my-skill-manager-th-sort',
        'aria-sort': ariaSortFor(key, props.sortKey, props.sortDir),
    }, sortHeader(key, label, props));
}
function rowClasses(item, selected) {
    const classes = ['dsh-my-skill-manager-row'];
    if (isAnomaly(item))
        classes.push('dsh-my-skill-manager-row-anomaly');
    else if (!item.globalOn)
        classes.push('dsh-my-skill-manager-row-off');
    if (selected)
        classes.push('dsh-my-skill-manager-row-selected');
    return classes.join(' ');
}
function rowCheckCell(item, selected, shared) {
    if (!shared.selectionMode)
        return null;
    return createElement('td', { className: 'dsh-my-skill-manager-col-check' }, createElement('input', {
        type: 'checkbox',
        className: 'dsh-my-skill-manager-checkbox',
        'aria-label': strings.selectRowAria(item.name),
        checked: selected,
        onChange: () => shared.handlers.onToggleSelect(item.key),
    }));
}
function rowNameCell(item, expanded, shared) {
    const button = createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-row-open',
        'aria-expanded': expanded,
        'aria-controls': 'detail-row-' + item.key,
        title: strings.cardOpenAria(item.name, expanded),
        onClick: () => shared.handlers.onToggleDetail(item),
    }, createElement('span', { className: 'dsh-my-skill-manager-name' }, item.name), skillBadges(item), createElement('span', { className: 'dsh-my-skill-manager-chevron' }, icon.chevronDown(12)));
    return createElement('td', {}, createElement('div', { className: 'dsh-my-skill-manager-row-name' }, createElement('span', { className: 'dsh-my-skill-manager-row-bar', 'aria-hidden': 'true' }), button));
}
function rowScopeCell(item, shared) {
    const anomaly = isAnomaly(item);
    return createElement('td', {}, createElement('div', { className: 'dsh-my-skill-manager-scope-cell' }, createElement(ScopeSwitch, {
        item,
        scope: 'global',
        checked: item.globalOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        mini: true,
        onToggle: shared.handlers.onToggleScope,
    }), createElement(ScopeSwitch, {
        item,
        scope: 'project',
        checked: item.projectOn,
        disabled: anomaly,
        projectCtx: shared.projectCtx,
        mini: true,
        onToggle: shared.handlers.onToggleScope,
    })));
}
function rowMainCells(item, props, expanded, selected) {
    const recent = formatRecent(lastUsedOf(item));
    const count = usageCountOf(item);
    return [
        rowCheckCell(item, selected, props.shared),
        rowNameCell(item, expanded, props.shared),
        createElement('td', {}, sourceLabelOf(item.source)),
        createElement('td', { title: strings.usageTimes(count) }, String(count)),
        createElement('td', { title: recent === '' ? strings.recentNever() : recent }, recent === '' ? strings.usageViaNone() : recent),
        rowScopeCell(item, props.shared),
    ];
}
function rowDetailNode(item, props, cols, expanded, error) {
    if (expanded) {
        const inline = error === null ? null : createElement(InlineError, { item, error, onRetry: props.shared.handlers.onRetryInline });
        return createElement('tr', { key: 'detail-row:' + item.key, className: 'dsh-my-skill-manager-detail-row', id: 'detail-row-' + item.key }, createElement('td', { colSpan: cols }, inline, createElement(FocusDetail, {
            id: 'detail-' + item.key,
            item,
            detail: props.shared.details[item.key],
            projectCtx: props.shared.projectCtx,
            handlers: props.shared.handlers,
        })));
    }
    if (error === null)
        return null;
    return createElement('tr', { key: 'error-row:' + item.key, className: 'dsh-my-skill-manager-detail-row' }, createElement('td', { colSpan: cols }, createElement(InlineError, { item, error, onRetry: props.shared.handlers.onRetryInline })));
}
function tableRow(item, props, cols) {
    const shared = props.shared;
    const expanded = shared.expanded.indexOf(item.key) !== -1;
    const selected = shared.selected.indexOf(item.key) !== -1;
    const error = shared.inlineError !== null && shared.inlineError.key === item.key ? shared.inlineError : null;
    const row = createElement('tr', {
        key: 'row:' + item.key,
        className: rowClasses(item, selected),
        'data-expanded': expanded ? 'true' : 'false',
        'data-row-id': item.key,
        onClick: (event) => {
            if (!isInteractiveEvent(event))
                shared.handlers.onToggleDetail(item);
        },
    }, ...rowMainCells(item, props, expanded, selected));
    const detail = rowDetailNode(item, props, cols, expanded, error);
    return detail === null ? [row] : [row, detail];
}
function tableColgroup(selectionMode) {
    return createElement('colgroup', {}, selectionMode ? createElement('col', { className: 'dsh-my-skill-manager-col-check' }) : null, createElement('col', {}), createElement('col', { className: 'dsh-my-skill-manager-col-source' }), createElement('col', { className: 'dsh-my-skill-manager-col-usage' }), createElement('col', { className: 'dsh-my-skill-manager-col-recent' }), createElement('col', { className: 'dsh-my-skill-manager-col-scope' }));
}
function tableCheckAllCell(props, allSelected) {
    if (!props.shared.selectionMode)
        return null;
    return createElement('th', { className: 'dsh-my-skill-manager-col-check' }, createElement('input', {
        type: 'checkbox',
        className: 'dsh-my-skill-manager-checkbox',
        'aria-label': strings.selectAllAria(),
        checked: allSelected,
        onChange: (event) => props.onSelectAll(event.target !== undefined && event.target.checked === true),
    }));
}
function tableHead(props, allSelected) {
    return createElement('thead', {}, createElement('tr', {}, tableCheckAllCell(props, allSelected), sortableTh('name', strings.colName(), props), sortableTh('source', strings.colSource(), props), sortableTh('usage', strings.colUsage(), props), sortableTh('recent', strings.colRecent(), props), createElement('th', { className: 'dsh-my-skill-manager-th-scope', title: strings.colScopeTitle() }, strings.colScope())));
}
function SkillTable(props) {
    const shared = props.shared;
    const cols = shared.selectionMode ? 6 : 5;
    let selectedVisible = 0;
    for (const item of props.items)
        if (shared.selected.indexOf(item.key) !== -1)
            selectedVisible += 1;
    const allSelected = props.items.length > 0 && selectedVisible === props.items.length;
    const rows = [];
    for (const item of props.items) {
        for (const node of tableRow(item, props, cols))
            rows.push(node);
    }
    return createElement('div', { className: 'dsh-my-skill-manager-table-wrap' }, createElement('table', { className: 'dsh-my-skill-manager-table', 'aria-label': strings.tableAria() }, tableColgroup(shared.selectionMode), tableHead(props, allSelected), createElement('tbody', {}, rows)));
}

    "use strict";
function stopEvent(event) {
    if (event === null || typeof event !== 'object')
        return;
    const stop = event.stopPropagation;
    if (typeof stop === 'function')
        stop.call(event);
}
function sourceFilterChips(props) {
    const chips = [
        { key: 'all', label: strings.filterAll(), count: props.counts.all, dot: false },
        { key: 'project', label: strings.sourceProject(), count: props.counts.project, dot: true },
        { key: 'user', label: strings.sourceUser(), count: props.counts.user, dot: true },
        { key: 'bundled', label: strings.sourceBundled(), count: props.counts.bundled, dot: true },
    ];
    if (props.counts.other > 0) {
        chips.push({ key: 'other', label: strings.sourceOther(), count: props.counts.other, dot: true });
    }
    chips.push({ key: 'anomaly', label: strings.sourceAnomaly(), count: props.counts.anomaly, dot: true });
    return chips;
}
function statusFilterChips(props) {
    return [
        { key: 'all', label: strings.filterAllStatus(), count: -1, dot: false },
        { key: 'enabled', label: strings.statEnabled(), count: props.counts.enabled, dot: false },
        { key: 'disabled', label: strings.statDisabled(), count: props.counts.disabled, dot: false },
        { key: 'anomaly', label: strings.statAnomaly(), count: props.counts.anomaly, dot: false },
    ];
}
function filterChip(entry, pressed, onClick) {
    return createElement('button', {
        key: entry.key,
        type: 'button',
        className: 'dsh-my-skill-manager-chip',
        'aria-pressed': pressed,
        onClick,
    }, entry.dot
        ? createElement('i', {
            className: 'dsh-my-skill-manager-src-dot dsh-my-skill-manager-src-dot-' + entry.key,
            'aria-hidden': 'true',
        })
        : null, createElement('span', {}, entry.label), entry.count < 0 ? null : createElement('b', {}, String(entry.count)));
}
function filterSourceGroup(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-filter-group', role: 'group', 'aria-label': strings.filterSourceGroup() }, createElement('span', { className: 'dsh-my-skill-manager-filter-group-label' }, strings.filtersSource()), createElement('div', { className: 'dsh-my-skill-manager-filter-chip-row' }, sourceFilterChips(props).map((entry) => filterChip(entry, props.source === entry.key, () => props.onSource(entry.key)))));
}
function filterStatusGroup(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-filter-group', role: 'group', 'aria-label': strings.filterStatusGroup() }, createElement('span', { className: 'dsh-my-skill-manager-filter-group-label' }, strings.filtersStatus()), createElement('div', { className: 'dsh-my-skill-manager-filter-chip-row' }, statusFilterChips(props).map((entry) => filterChip(entry, props.status === entry.key, () => props.onStatus(entry.key)))));
}
function filterUnusedRow(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-filter-group' }, createElement('button', {
        type: 'button',
        role: 'switch',
        className: 'dsh-my-skill-manager-switch dsh-my-skill-manager-filter-switch',
        'aria-checked': props.unusedOnly,
        'aria-label': strings.unusedOnly(),
        onClick: () => props.onToggleUnused(),
    }, createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, strings.unusedOnly()), createElement('span', { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' }, createElement('span', { className: 'dsh-my-skill-manager-knob' }))));
}
function filterActions(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-filter-actions' }, createElement('button', { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onReset() }, strings.filterReset()), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-primary',
        onClick: () => props.onClose(),
    }, strings.filterClose()));
}
function FilterPanel(props) {
    return createElement('div', {
        id: 'dsh-my-skill-manager-filter-panel',
        className: 'dsh-my-skill-manager-filter-panel',
        role: 'dialog',
        'aria-label': strings.filterTitle(),
        onClick: (event) => stopEvent(event),
    }, createElement('div', { className: 'dsh-my-skill-manager-filter-panel-title' }, strings.filterTitle()), filterSourceGroup(props), filterStatusGroup(props), filterUnusedRow(props), filterActions(props));
}
function searchField(props) {
    const clearButton = props.query === ''
        ? null
        : createElement('button', {
            type: 'button',
            className: 'dsh-my-skill-manager-search-clear',
            'aria-label': strings.searchClear(),
            onClick: () => props.onClearSearch(),
        }, icon.close(12));
    return createElement('div', { className: 'dsh-my-skill-manager-search' }, icon.search(15), createElement('input', {
        ref: props.searchRef,
        type: 'text',
        role: 'searchbox',
        className: 'dsh-my-skill-manager-search-input',
        placeholder: strings.searchPlaceholder(),
        'aria-label': strings.searchAria(),
        autoComplete: 'off',
        spellCheck: false,
        value: props.query,
        onChange: (event) => props.onQueryChange(event.target.value),
    }), createElement('kbd', { className: 'dsh-my-skill-manager-kbd' }, strings.shortcutHint()), clearButton);
}
function filterControl(props) {
    const active = props.activeFilterCount > 0;
    const filterButton = createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-filter-btn' + (active ? ' dsh-my-skill-manager-filter-btn-active' : ''),
        'aria-haspopup': 'dialog',
        'aria-expanded': props.filterOpen,
        'aria-controls': 'dsh-my-skill-manager-filter-panel',
        'aria-label': strings.filterButtonAria(props.activeFilterCount),
        title: strings.filterButtonAria(props.activeFilterCount),
        onClick: (event) => props.onToggleFilters(event),
    }, glyph.filter(14), createElement('span', { className: 'dsh-my-skill-manager-filter-btn-label' }, strings.filterButton()), active
        ? createElement('b', { className: 'dsh-my-skill-manager-filter-btn-count' }, String(props.activeFilterCount))
        : null);
    return createElement('div', { className: 'dsh-my-skill-manager-filter-wrap' }, filterButton, props.filterOpen
        ? createElement(FilterPanel, {
            counts: props.counts,
            source: props.source,
            status: props.status,
            unusedOnly: props.unusedOnly,
            onSource: props.onSource,
            onStatus: props.onStatus,
            onToggleUnused: props.onToggleUnused,
            onReset: props.onResetFilters,
            onClose: props.onCloseFilters,
        })
        : null);
}
function rescanButton(props) {
    const label = props.scanning ? strings.rescanning() : strings.rescanAria();
    return createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-scan' + (props.scanning ? ' dsh-my-skill-manager-scan-loading' : ''),
        'aria-label': label,
        title: label,
        disabled: props.scanning,
        onClick: () => props.onRescan(),
    }, icon.refresh(15));
}
function commandSearchRow(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-search-row' }, searchField(props), filterControl(props), rescanButton(props));
}
function commandStatsRow(props) {
    const stats = [
        { key: 'all', label: strings.statAll(), count: props.counts.all, warn: false },
        { key: 'enabled', label: strings.statEnabled(), count: props.counts.enabled, warn: false },
        { key: 'disabled', label: strings.statDisabled(), count: props.counts.disabled, warn: false },
        { key: 'anomaly', label: strings.statAnomaly(), count: props.counts.anomaly, warn: true },
    ];
    const diagLabel = strings.diagEntryAria(props.counts.anomaly);
    return createElement('div', { className: 'dsh-my-skill-manager-stats-row' }, createElement('div', { className: 'dsh-my-skill-manager-stats', role: 'group', 'aria-label': strings.statsAria() }, stats.map((stat) => createElement('button', {
        key: stat.key,
        type: 'button',
        className: 'dsh-my-skill-manager-stat' + (stat.warn ? ' dsh-my-skill-manager-stat-warn' : ''),
        'aria-pressed': props.activeStat === stat.key,
        onClick: () => props.onSelectStat(stat.key),
    }, createElement('span', { className: 'dsh-my-skill-manager-stat-label' }, stat.label), createElement('b', {}, props.pending ? '—' : String(stat.count))))), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-diag-entry' +
            (props.counts.anomaly === 0 ? ' dsh-my-skill-manager-diag-entry-idle' : ''),
        'aria-label': diagLabel,
        title: diagLabel,
        onClick: () => props.onOpenDiagnostics(),
    }, icon.alert(14), props.counts.anomaly > 0 ? createElement('b', {}, props.pending ? '—' : String(props.counts.anomaly)) : null));
}
function CommandBar(props) {
    const note = props.projectCtx
        ? null
        : createElement('div', { className: 'dsh-my-skill-manager-project-note' }, icon.folder(13), createElement('span', {}, strings.projectNote()));
    return createElement('div', { className: 'dsh-my-skill-manager-command' }, commandSearchRow(props), commandStatsRow(props), note);
}

    "use strict";
const SORT_OPTIONS = [
    { key: 'name', label: strings.sortName },
    { key: 'usage', label: strings.sortUsage },
    { key: 'recent', label: strings.sortRecent },
    { key: 'source', label: strings.sortSource },
];
function sortLabelOf(key) {
    for (const option of SORT_OPTIONS)
        if (option.key === key)
            return option.label();
    return '';
}
function toolbarViewSeg(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-seg', role: 'group', 'aria-label': strings.viewAria() }, createElement('button', {
        type: 'button',
        'aria-pressed': props.view === 'cards',
        'aria-label': strings.viewCards(),
        title: strings.viewCards(),
        onClick: () => props.onView('cards'),
    }, glyph.cards(14)), createElement('button', {
        type: 'button',
        'aria-pressed': props.view === 'table',
        'aria-label': strings.viewTable(),
        title: strings.viewTable(),
        onClick: () => props.onView('table'),
    }, glyph.table(14)));
}
function toolbarSortMenu(props) {
    const menu = props.sortOpen
        ? createElement('div', { className: 'dsh-my-skill-manager-menu', role: 'menu', 'aria-label': strings.sortAria() }, SORT_OPTIONS.map((option) => createElement('button', {
            key: option.key,
            type: 'button',
            role: 'menuitemradio',
            className: 'dsh-my-skill-manager-menu-item',
            'aria-checked': props.sortKey === option.key,
            onClick: () => props.onSort(option.key),
        }, createElement('span', { className: 'dsh-my-skill-manager-menu-check' }, icon.check(14)), createElement('span', {}, option.label()))))
        : null;
    return createElement('div', { className: 'dsh-my-skill-manager-sortwrap' }, createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-tool-text',
        'aria-haspopup': 'menu',
        'aria-expanded': props.sortOpen,
        onClick: (event) => props.onToggleSortMenu(event),
    }, glyph.sort(13), createElement('span', {}, sortLabelOf(props.sortKey))), menu);
}
function toolbarSortDir(props) {
    return createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-sort-dir',
        'aria-label': strings.sortDirAria(props.sortDir),
        onClick: () => props.onToggleSortDir(),
    }, props.sortDir === 'asc' ? glyph.arrowUp(14) : glyph.arrowDown(14));
}
function toolbarSelectButton(props) {
    if (props.selectionMode)
        return null;
    return createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-select-btn',
        'aria-pressed': false,
        'aria-label': strings.selectAria(),
        title: strings.selectAria(),
        onClick: () => props.onEnterSelection(),
    }, glyph.checkSquare(14));
}
function ViewToolbar(props) {
    const scanTime = strings.scanTime(props.scanTime);
    return createElement('div', { className: 'dsh-my-skill-manager-toolbar' }, createElement('span', { className: 'dsh-my-skill-manager-result' }, createElement('b', {}, props.pending ? '—' : String(props.resultCount)), ' ' + strings.resultCountUnit()), createElement('span', { className: 'dsh-my-skill-manager-scan-time', title: scanTime }, scanTime), createElement('div', { className: 'dsh-my-skill-manager-toolbar-right' }, toolbarViewSeg(props), toolbarSortMenu(props), toolbarSortDir(props), toolbarSelectButton(props)));
}
function bulkConfirmBar(props) {
    const eligible = props.count - props.anomalyCount;
    const skipNote = props.anomalyCount > 0 ? createElement('em', {}, strings.confirmSkipNote(props.anomalyCount)) : null;
    return createElement('div', { className: 'dsh-my-skill-manager-action dsh-my-skill-manager-action-confirm', 'aria-live': 'polite' }, icon.alert(16), createElement('div', { className: 'dsh-my-skill-manager-action-info' }, strings.confirmTitle(eligible), skipNote), createElement('div', { className: 'dsh-my-skill-manager-action-btns' }, createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-danger',
        disabled: eligible === 0,
        onClick: () => props.onConfirm(),
    }, strings.confirmDisable()), createElement('button', { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onCancel() }, strings.confirmCancel())));
}
function bulkActionBar(props) {
    const skipNote = props.anomalyCount > 0
        ? createElement('span', { className: 'dsh-my-skill-manager-action-note' }, strings.bulkSkip(props.anomalyCount))
        : null;
    return createElement('div', { className: 'dsh-my-skill-manager-action', 'aria-live': 'polite' }, glyph.checkSquare(16), createElement('div', { className: 'dsh-my-skill-manager-action-info' }, createElement('span', {}, strings.bulkSelected(props.count)), skipNote), createElement('div', { className: 'dsh-my-skill-manager-action-btns' }, createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn',
        disabled: props.count === 0,
        'aria-label': strings.bulkEnableAria(),
        onClick: () => props.onEnable(),
    }, strings.bulkEnable()), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-danger-ghost',
        disabled: props.count === 0,
        'aria-label': strings.bulkDisableAria(),
        onClick: () => props.onDisable(),
    }, strings.bulkDisable()), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-ghost',
        'aria-label': strings.bulkExitAria(),
        onClick: () => props.onExit(),
    }, strings.bulkExit())));
}
function BulkBar(props) {
    if (props.confirm)
        return bulkConfirmBar(props);
    return bulkActionBar(props);
}

    "use strict";
function loadingPanel() {
    const cards = [];
    for (let index = 0; index < 6; index += 1) {
        const width = index % 2 === 0 ? 'dsh-my-skill-manager-w55' : 'dsh-my-skill-manager-w70';
        cards.push(createElement('div', { key: 'skel:' + String(index), className: 'dsh-my-skill-manager-skel-card' }, createElement('div', { className: 'dsh-my-skill-manager-skel-line dsh-my-skill-manager-w25' }), createElement('div', { className: 'dsh-my-skill-manager-skel-line ' + width }), createElement('div', { className: 'dsh-my-skill-manager-skel-line dsh-my-skill-manager-w40' })));
    }
    return createElement('div', { className: 'dsh-my-skill-manager-state' }, createElement('div', {
        className: 'dsh-my-skill-manager-skeleton',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': strings.loadingAria(),
    }, createElement('div', { className: 'dsh-my-skill-manager-skel-head' }), cards));
}
function errorPanel(message, props) {
    return createElement('div', { className: 'dsh-my-skill-manager-state' }, createElement('div', { className: 'dsh-my-skill-manager-error', role: 'alert' }, icon.alert(28), createElement('h2', {}, strings.errorTitle()), createElement('p', {}, strings.errorHint() + ' ', message === '' ? null : createElement('code', {}, message)), createElement('div', { className: 'dsh-my-skill-manager-empty-actions' }, createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-btn dsh-my-skill-manager-btn-primary',
        onClick: () => props.onRescan(),
    }, icon.refresh(14), strings.retryScan()))));
}
function emptyCopy(props) {
    if (props.variant === 'noresult') {
        return { iconName: 'search', title: strings.emptyNoResultTitle(props.query), body: strings.emptyNoResultBody() };
    }
    if (props.variant === 'filtered') {
        return { iconName: 'search', title: strings.emptyFilteredTitle(), body: strings.emptyFilteredBody() };
    }
    if (props.variant === 'noproject') {
        return { iconName: 'folder', title: strings.emptyNoProjectTitle(), body: strings.emptyNoProjectBody() };
    }
    return { iconName: 'package', title: strings.emptyNoDataTitle(), body: strings.emptyNoDataBody() };
}
function emptyIcon(iconName) {
    if (iconName === 'search')
        return icon.search(28);
    if (iconName === 'folder')
        return icon.folder(28);
    return glyph.package(28);
}
function actionButton(label, primary, onClick, withIcon) {
    const className = 'dsh-my-skill-manager-btn' + (primary ? ' dsh-my-skill-manager-btn-primary' : '');
    return createElement('button', { key: label, type: 'button', className, onClick }, withIcon ? icon.refresh(14) : null, label);
}
function emptyActionsNoResult(props) {
    return [
        actionButton(strings.emptyClearSearch(), true, () => props.onClearSearch(), false),
        actionButton(strings.emptyResetFilters(), false, () => props.onResetFilters(), false),
    ];
}
function emptyActionsNoProject(props) {
    return [
        actionButton(strings.emptyShowAll(), true, () => props.onShowAll(), false),
        actionButton(strings.emptyRescan(), false, () => props.onRescan(), true),
    ];
}
function emptyActions(props) {
    if (props.variant === 'noresult')
        return emptyActionsNoResult(props);
    if (props.variant === 'filtered') {
        return [actionButton(strings.emptyResetFilters(), true, () => props.onResetFilters(), false)];
    }
    if (props.variant === 'noproject')
        return emptyActionsNoProject(props);
    return [actionButton(strings.emptyRescan(), true, () => props.onRescan(), true)];
}
function previewSwitch() {
    return createElement('div', { className: 'dsh-my-skill-manager-empty-preview' }, createElement('button', {
        type: 'button',
        role: 'switch',
        className: 'dsh-my-skill-manager-switch',
        'aria-checked': false,
        'aria-label': strings.emptyNoProjectToggle(),
        disabled: true,
    }, createElement('span', { className: 'dsh-my-skill-manager-switch-label' }, strings.scopeProject()), createElement('span', { className: 'dsh-my-skill-manager-track', 'aria-hidden': 'true' }, createElement('span', { className: 'dsh-my-skill-manager-knob' }))), createElement('span', {}, strings.emptyNoProjectPreview()));
}
function emptyPanel(props) {
    const copy = emptyCopy(props);
    return createElement('div', { className: 'dsh-my-skill-manager-state' }, createElement('div', { className: 'dsh-my-skill-manager-empty' }, emptyIcon(copy.iconName), createElement('h2', {}, copy.title), createElement('p', {}, copy.body), props.variant === 'noproject' ? previewSwitch() : null, createElement('div', { className: 'dsh-my-skill-manager-empty-actions' }, emptyActions(props))));
}
function StatePanel(props) {
    if (props.kind === 'loading')
        return loadingPanel();
    if (props.kind === 'error')
        return errorPanel(props.message, props);
    return emptyPanel(props);
}
function Toast(props) {
    if (props.toast === null)
        return null;
    return createElement('div', { className: 'dsh-my-skill-manager-toast', role: 'status', 'aria-live': 'polite', 'data-kind': props.toast.kind }, createElement('span', { className: 'dsh-my-skill-manager-toast-dot', 'aria-hidden': 'true' }), createElement('span', {}, props.toast.message));
}

    "use strict";
function diagCard(item, onCopyPath) {
    return createElement('article', { key: item.key, className: 'dsh-my-skill-manager-diag-card' }, createElement('div', { className: 'dsh-my-skill-manager-diag-card-head' }, icon.alert(16), createElement('div', {}, createElement('h3', {}, item.name), createElement('p', {}, strings.reasonShort(item.reason))), badgeElement('dsh-my-skill-manager-badge-warn', strings.badgeScanIssue())), createElement('dl', { className: 'dsh-my-skill-manager-diag-meta' }, metaRow(strings.detailPath(), createElement('code', { className: 'dsh-my-skill-manager-meta-code' }, item.path), createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-icon-btn dsh-my-skill-manager-icon-btn-sm',
        'aria-label': strings.copyPathAria(item.name),
        onClick: () => onCopyPath(item),
    }, icon.copy(13))), metaRow(strings.diagReason(), strings.reasonText(item.reason)), metaRow(strings.diagSuggestion(), strings.reasonSuggestion(item.reason))));
}
function diagHead(props) {
    return createElement('div', { className: 'dsh-my-skill-manager-diag-head' }, createElement('button', {
        type: 'button',
        className: 'dsh-my-skill-manager-icon-btn',
        'aria-label': strings.diagBack(),
        onClick: () => props.onBack(),
    }, glyph.back(16)), createElement('div', { className: 'dsh-my-skill-manager-diag-title' }, createElement('h2', {}, strings.diagTitle()), createElement('p', {}, strings.diagSubtitle(props.items.length, props.scanTime))), createElement('button', { type: 'button', className: 'dsh-my-skill-manager-btn', onClick: () => props.onRescan() }, icon.refresh(13), strings.diagRescan()));
}
function DiagnosticsPage(props) {
    const body = props.items.length === 0
        ? createElement('div', { className: 'dsh-my-skill-manager-diag-empty' }, strings.diagEmpty())
        : props.items.map((item) => diagCard(item, props.onCopyPath));
    return createElement('div', { className: 'dsh-my-skill-manager-diag' }, diagHead(props), body, createElement('p', { className: 'dsh-my-skill-manager-diag-foot' }, strings.diagFoot()));
}

    "use strict";
const INITIAL_DECK_STATE = {
    data: null,
    loading: true,
    error: '',
    sessionCwd: '',
    query: '',
    source: 'all',
    status: 'all',
    unusedOnly: false,
    viewMode: 'cards',
    sortKey: 'name',
    sortDir: 'asc',
    sortOpen: false,
    filterOpen: false,
    expanded: [],
    selectionMode: false,
    selected: [],
    batchConfirm: false,
    diagOpen: false,
    details: {},
    inlineError: null,
    toast: null,
};
function updateDeck(store, patch) {
    store.setState((previous) => ({ ...previous, ...patch }));
}
function pushToast(store, message, kind) {
    store.toastSeq.value += 1;
    updateDeck(store, { toast: { id: store.toastSeq.value, message, kind } });
}
function focusDeckSearch(store) {
    setTimeout(() => {
        const node = store.searchRef.current;
        if (node !== null && node !== undefined && typeof node.focus === 'function')
            node.focus();
    }, 0);
}
function mountDeck(store) {
    let cancelled = false;
    const sessionId = currentSessionId();
    fetchSessionCwd(sessionId).then((detected) => {
        if (cancelled)
            return;
        updateDeck(store, { sessionCwd: detected });
        fetchList(detected).then((list) => {
            if (!cancelled)
                updateDeck(store, { data: list, loading: false });
        }, (failure) => {
            if (!cancelled)
                updateDeck(store, { error: errorText(failure), loading: false });
        });
    });
    return () => {
        cancelled = true;
    };
}
function hideToastLater(store) {
    const timer = setTimeout(() => updateDeck(store, { toast: null }), 2400);
    return () => clearTimeout(timer);
}
function closePopoversOnOutsideClick(store) {
    const close = () => updateDeck(store, { sortOpen: false, filterOpen: false });
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
}
function handleDeckShortcut(store, event) {
    const withModifier = event.metaKey === true || event.ctrlKey === true;
    const isK = event.key === 'k' || event.key === 'K';
    if (!withModifier || !isK)
        return false;
    if (typeof event.preventDefault === 'function')
        event.preventDefault();
    updateDeck(store, {
        diagOpen: false,
        selectionMode: false,
        selected: [],
        batchConfirm: false,
        sortOpen: false,
        filterOpen: false,
    });
    focusDeckSearch(store);
    return true;
}
function handleDeckEscape(store) {
    const state = store.state;
    if (state.filterOpen) {
        updateDeck(store, { filterOpen: false });
        return;
    }
    if (state.sortOpen) {
        updateDeck(store, { sortOpen: false });
        return;
    }
    if (state.batchConfirm) {
        updateDeck(store, { batchConfirm: false });
        return;
    }
    if (state.diagOpen) {
        updateDeck(store, { diagOpen: false });
        return;
    }
    if (state.selectionMode) {
        updateDeck(store, { selectionMode: false, selected: [] });
        return;
    }
    if (state.query !== '') {
        updateDeck(store, { query: '' });
        return;
    }
    if (state.expanded.length > 0)
        updateDeck(store, { expanded: [] });
}
function bindDeckKeys(store) {
    const onKeyDown = (event) => {
        if (handleDeckShortcut(store, event))
            return;
        if (event.key === 'Escape')
            handleDeckEscape(store);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
}
function useDeck() {
    const [state, setState] = useState(INITIAL_DECK_STATE);
    const [searchRef] = useState(() => ({ current: null }));
    const [toastSeq] = useState(() => ({ value: 0 }));
    const store = { state, setState, searchRef, toastSeq };
    useEffect(() => mountDeck(store), []);
    useEffect(() => (state.toast === null ? undefined : hideToastLater(store)), [state.toast]);
    useEffect(() => (state.sortOpen || state.filterOpen ? closePopoversOnOutsideClick(store) : undefined), [state.sortOpen, state.filterOpen]);
    useEffect(() => bindDeckKeys(store), [state]);
    return store;
}

    "use strict";
function withDetail(previous, key, entry) {
    const next = {};
    for (const existing of Object.keys(previous))
        next[existing] = previous[existing];
    next[key] = entry;
    return next;
}
function loadDetailAction(store, cwd, item) {
    if (isAnomaly(item))
        return;
    store.setState((previous) => ({
        ...previous,
        details: withDetail(previous.details, item.key, { status: 'loading', content: '', truncated: false, message: '' }),
    }));
    fetchDetail(item.name, cwd).then((value) => {
        store.setState((previous) => ({
            ...previous,
            details: withDetail(previous.details, item.key, {
                status: 'ready',
                content: value.content,
                truncated: value.truncated,
                message: '',
            }),
        }));
    }, (failure) => {
        store.setState((previous) => ({
            ...previous,
            details: withDetail(previous.details, item.key, {
                status: 'error',
                content: '',
                truncated: false,
                message: errorText(failure),
            }),
        }));
    });
}
function toggleDetailAction(store, cwd, item) {
    const open = store.state.expanded.indexOf(item.key) === -1;
    updateDeck(store, {
        expanded: open
            ? store.state.expanded.concat([item.key])
            : store.state.expanded.filter((entry) => entry !== item.key),
    });
    if (open)
        loadDetailAction(store, cwd, item);
}
function applyScopeAction(store, cwd, item, scope, disabled) {
    saveConfig(scope, disabled, scope === 'project' ? cwd : '').then(() => {
        store.setState((previous) => {
            if (previous.data === null)
                return previous;
            const data = scope === 'global'
                ? { ...previous.data, globalDisabled: disabled }
                : { ...previous.data, projectDisabled: disabled };
            return { ...previous, data, inlineError: null };
        });
        const enabled = disabled.indexOf(item.name) === -1;
        const scopeLabel = scope === 'global' ? strings.scopeGlobal() : strings.scopeProject();
        pushToast(store, enabled ? strings.toggleOnToast(item.name, scopeLabel) : strings.toggleOffToast(item.name, scopeLabel), enabled ? 'success' : 'default');
    }, (failure) => {
        updateDeck(store, {
            inlineError: { key: item.key, scope, message: errorText(failure), disabled },
        });
        pushToast(store, strings.updateFailedToast(), 'error');
    });
}
function toggleScopeAction(store, derived, item, scope) {
    if (isAnomaly(item))
        return;
    if (scope === 'project' && !derived.projectCtx) {
        pushToast(store, strings.projectUnavailableToast(), 'error');
        return;
    }
    if (derived.data === null)
        return;
    const current = scope === 'global' ? derived.data.globalDisabled : derived.data.projectDisabled;
    const enabled = scope === 'global' ? item.globalOn : item.projectOn;
    applyScopeAction(store, derived.cwd, item, scope, toggleNameInList(current, item.name, enabled));
}
function retryInlineAction(store, cwd, item) {
    const failure = store.state.inlineError;
    if (failure === null || failure.key !== item.key)
        return;
    applyScopeAction(store, cwd, item, failure.scope, failure.disabled);
}
function copyPathAction(store, item) {
    if (item.path === '') {
        pushToast(store, strings.copyEmpty(), 'error');
        return;
    }
    copyToClipboard(item.path).then((ok) => {
        pushToast(store, ok ? strings.copyPathDone() : strings.copyFailed(), ok ? 'success' : 'error');
    });
}
function copyMdAction(store, item) {
    const entry = store.state.details[item.key];
    const content = entry !== undefined && entry.status === 'ready' ? entry.content : '';
    if (content === '') {
        pushToast(store, strings.copyEmpty(), 'error');
        return;
    }
    copyToClipboard(content).then((ok) => {
        pushToast(store, ok ? strings.copyMdDone() : strings.copyFailed(), ok ? 'success' : 'error');
    });
}
function batchApplyAction(store, derived, enable) {
    const data = derived.data;
    if (data === null)
        return;
    const picked = derived.selectedItems;
    const eligible = picked.filter((item) => !isAnomaly(item));
    if (eligible.length === 0) {
        updateDeck(store, { batchConfirm: false });
        pushToast(store, strings.noEligibleToast(), 'error');
        return;
    }
    const names = eligible.map((item) => item.name);
    const globalNext = applyDisabledForNames(data.globalDisabled, names, !enable);
    const projectNext = applyDisabledForNames(data.projectDisabled, names, !enable);
    const jobs = [saveConfig('global', globalNext, '')];
    if (derived.projectCtx)
        jobs.push(saveConfig('project', projectNext, derived.cwd));
    Promise.all(jobs).then(() => {
        store.setState((previous) => {
            if (previous.data === null)
                return previous;
            const nextData = derived.projectCtx
                ? { ...previous.data, globalDisabled: globalNext, projectDisabled: projectNext }
                : { ...previous.data, globalDisabled: globalNext };
            return {
                ...previous,
                data: nextData,
                selectionMode: false,
                selected: [],
                batchConfirm: false,
                inlineError: null,
            };
        });
        const skipped = picked.length - eligible.length;
        pushToast(store, (enable ? strings.batchOnToast(names.length) : strings.batchOffToast(names.length)) +
            (skipped > 0 ? strings.batchSkipToast(skipped) : ''), enable ? 'success' : 'default');
    }, (failure) => {
        updateDeck(store, { batchConfirm: false });
        const detail = errorText(failure);
        pushToast(store, strings.batchFailedToast() + (detail === '' ? '' : ' · ' + detail), 'error');
    });
}
function rescanAction(store, cwd, hasData) {
    updateDeck(store, {
        loading: true,
        error: '',
        sortOpen: false,
        batchConfirm: false,
        diagOpen: false,
        filterOpen: false,
        selectionMode: false,
        selected: [],
        inlineError: null,
    });
    rescanCatalog(cwd).then((value) => {
        const nextCounts = countsOf(buildItems(value));
        updateDeck(store, { data: value, loading: false });
        pushToast(store, strings.scanDoneToast(nextCounts.all, nextCounts.anomaly), 'success');
    }, (failure) => {
        updateDeck(store, hasData ? { loading: false } : { loading: false, error: errorText(failure) });
        pushToast(store, strings.scanFailedToast(), 'error');
    });
}

    "use strict";
const EMPTY_COUNTS = {
    all: 0,
    enabled: 0,
    disabled: 0,
    anomaly: 0,
    project: 0,
    user: 0,
    bundled: 0,
    other: 0,
    unused: 0,
};
function activeFilterCountOf(state) {
    let count = 0;
    if (state.source !== 'all')
        count += 1;
    if (state.status !== 'all')
        count += 1;
    if (state.unusedOnly)
        count += 1;
    return count;
}
function deriveDeck(state) {
    const data = state.data;
    const cwd = data !== null && data.cwd !== '' ? data.cwd : state.sessionCwd;
    const items = data === null ? [] : buildItems(data);
    const filters = {
        query: state.query,
        source: state.source,
        status: state.status,
        unusedOnly: state.unusedOnly,
    };
    const visible = sortItems(filterItems(items, filters), state.sortKey, state.sortDir);
    const selectedItems = items.filter((item) => state.selected.indexOf(item.key) !== -1);
    return {
        data,
        cwd,
        projectCtx: cwd !== '',
        items,
        counts: data === null ? EMPTY_COUNTS : countsOf(items),
        filters,
        visible,
        groups: groupItems(visible),
        activeStat: activeStatOf(filters),
        anomalyItems: items.filter(isAnomaly),
        scanTime: formatClock(data === null ? 0 : data.scannedAt),
        pending: state.loading && data === null,
        activeFilterCount: activeFilterCountOf(state),
        selectedItems,
        selectedAnomalyCount: selectedItems.filter(isAnomaly).length,
    };
}
function resetFiltersAction(store) {
    updateDeck(store, { query: '', source: 'all', status: 'all', unusedOnly: false });
}
function selectStatAction(store, stat) {
    const state = store.state;
    if (stat === 'all') {
        resetFiltersAction(store);
        return;
    }
    if (state.status === stat && state.source === 'all') {
        updateDeck(store, { status: 'all' });
        return;
    }
    updateDeck(store, { source: 'all', status: stat, unusedOnly: false });
}
function changeSortAction(store, key) {
    const state = store.state;
    const defaultDir = key === 'usage' || key === 'recent' ? 'desc' : 'asc';
    const nextDir = state.sortKey === key ? (state.sortDir === 'asc' ? 'desc' : 'asc') : defaultDir;
    updateDeck(store, { sortKey: key, sortDir: nextDir, sortOpen: false });
}
function changeViewAction(store, view) {
    updateDeck(store, { viewMode: view, sortOpen: false });
}
function toggleSortDirAction(store) {
    updateDeck(store, { sortDir: store.state.sortDir === 'asc' ? 'desc' : 'asc' });
}
function toggleSortMenuAction(store, event) {
    if (event !== null && typeof event === 'object') {
        const stop = event.stopPropagation;
        if (typeof stop === 'function')
            stop.call(event);
    }
    updateDeck(store, { sortOpen: !store.state.sortOpen, filterOpen: false });
}
function toggleFilterPanelAction(store, event) {
    if (event !== null && typeof event === 'object') {
        const stop = event.stopPropagation;
        if (typeof stop === 'function')
            stop.call(event);
    }
    updateDeck(store, { filterOpen: !store.state.filterOpen, sortOpen: false });
}
function closeFilterPanelAction(store) {
    updateDeck(store, { filterOpen: false });
}
function enterSelectionAction(store) {
    updateDeck(store, {
        diagOpen: false,
        sortOpen: false,
        filterOpen: false,
        selectionMode: true,
        selected: [],
        batchConfirm: false,
    });
}
function exitSelectionAction(store) {
    updateDeck(store, { selectionMode: false, selected: [], batchConfirm: false });
}
function toggleSelectAction(store, key) {
    store.setState((previous) => {
        const present = previous.selected.indexOf(key) !== -1;
        const selected = present ? previous.selected.filter((entry) => entry !== key) : previous.selected.concat([key]);
        return { ...previous, selected, batchConfirm: false };
    });
}
function selectAllAction(store, keys) {
    updateDeck(store, { selected: keys === null ? [] : keys, batchConfirm: false });
}
function openDiagnosticsAction(store) {
    updateDeck(store, {
        diagOpen: true,
        selectionMode: false,
        selected: [],
        batchConfirm: false,
        sortOpen: false,
        filterOpen: false,
    });
}
function closeDiagnosticsAction(store) {
    updateDeck(store, { diagOpen: false });
}
function emptyVariantOf(state, derived) {
    if (state.query.trim() !== '')
        return 'noresult';
    if (!derived.projectCtx && (state.source === 'project' || derived.items.length === 0))
        return 'noproject';
    if (state.source !== 'all' || state.status !== 'all' || state.unusedOnly)
        return 'filtered';
    return 'nodata';
}
function deckShared(store, derived) {
    return {
        projectCtx: derived.projectCtx,
        selectionMode: store.state.selectionMode,
        selected: store.state.selected,
        expanded: store.state.expanded,
        details: store.state.details,
        inlineError: store.state.inlineError,
        handlers: deckHandlers(store, derived),
    };
}
function deckHandlers(store, derived) {
    return {
        onToggleDetail: (item) => toggleDetailAction(store, derived.cwd, item),
        onToggleScope: (item, scope) => toggleScopeAction(store, derived, item, scope),
        onToggleSelect: (key) => toggleSelectAction(store, key),
        onCopyPath: (item) => copyPathAction(store, item),
        onCopyMd: (item) => copyMdAction(store, item),
        onRetryInline: (item) => retryInlineAction(store, derived.cwd, item),
        onRetryDetail: (item) => loadDetailAction(store, derived.cwd, item),
    };
}
function statePanelProps(store, derived) {
    return {
        kind: 'empty',
        variant: 'nodata',
        query: store.state.query,
        message: '',
        onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
        onClearSearch: () => resetFiltersAction(store),
        onResetFilters: () => resetFiltersAction(store),
        onShowAll: () => resetFiltersAction(store),
    };
}

    "use strict";
function renderCommandBar(store, derived) {
    const state = store.state;
    if (state.diagOpen || state.selectionMode)
        return null;
    return createElement(CommandBar, {
        query: state.query,
        pending: derived.pending,
        counts: derived.counts,
        activeStat: derived.activeStat,
        scanning: state.loading,
        scanTime: derived.scanTime,
        projectCtx: derived.projectCtx,
        searchRef: store.searchRef,
        onQueryChange: (value) => updateDeck(store, { query: value }),
        onClearSearch: () => {
            updateDeck(store, { query: '' });
            focusDeckSearch(store);
        },
        onSelectStat: (stat) => selectStatAction(store, stat),
        onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
        onOpenDiagnostics: () => openDiagnosticsAction(store),
        filterOpen: state.filterOpen,
        activeFilterCount: derived.activeFilterCount,
        source: state.source,
        status: state.status,
        unusedOnly: state.unusedOnly,
        onToggleFilters: (event) => toggleFilterPanelAction(store, event),
        onCloseFilters: () => closeFilterPanelAction(store),
        onResetFilters: () => resetFiltersAction(store),
        onSource: (next) => updateDeck(store, { source: next }),
        onStatus: (next) => updateDeck(store, { status: next }),
        onToggleUnused: () => updateDeck(store, { unusedOnly: !state.unusedOnly }),
    });
}
function renderBulkBar(store, derived) {
    const state = store.state;
    if (!state.selectionMode || state.diagOpen)
        return null;
    return createElement(BulkBar, {
        count: derived.selectedItems.length,
        anomalyCount: derived.selectedAnomalyCount,
        confirm: state.batchConfirm,
        onEnable: () => batchApplyAction(store, derived, true),
        onDisable: () => updateDeck(store, { batchConfirm: true }),
        onConfirm: () => batchApplyAction(store, derived, false),
        onCancel: () => updateDeck(store, { batchConfirm: false }),
        onExit: () => exitSelectionAction(store),
    });
}
function renderToolbar(store, derived) {
    const state = store.state;
    if (state.diagOpen)
        return null;
    return createElement(ViewToolbar, {
        pending: derived.pending,
        resultCount: derived.visible.length,
        scanTime: derived.scanTime,
        view: state.viewMode,
        sortKey: state.sortKey,
        sortDir: state.sortDir,
        sortOpen: state.sortOpen,
        selectionMode: state.selectionMode,
        onView: (next) => changeViewAction(store, next),
        onToggleSortMenu: (event) => toggleSortMenuAction(store, event),
        onSort: (key) => changeSortAction(store, key),
        onToggleSortDir: () => toggleSortDirAction(store),
        onEnterSelection: () => enterSelectionAction(store),
    });
}
function renderDiagnostics(store, derived) {
    const items = derived.anomalyItems.slice().sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return createElement(DiagnosticsPage, {
        items,
        scanTime: derived.scanTime,
        onBack: () => closeDiagnosticsAction(store),
        onRescan: () => rescanAction(store, derived.cwd, derived.data !== null),
        onCopyPath: (item) => copyPathAction(store, item),
    });
}
function renderStage(store, derived) {
    const state = store.state;
    const shared = deckShared(store, derived);
    const panel = statePanelProps(store, derived);
    if (state.diagOpen)
        return renderDiagnostics(store, derived);
    if (state.loading)
        return createElement(StatePanel, { ...panel, kind: 'loading' });
    if (state.error !== '')
        return createElement(StatePanel, { ...panel, kind: 'error', message: state.error });
    if (derived.visible.length === 0) {
        return createElement(StatePanel, { ...panel, kind: 'empty', variant: emptyVariantOf(state, derived) });
    }
    if (state.viewMode === 'table') {
        return createElement(SkillTable, {
            items: derived.visible,
            shared,
            sortKey: state.sortKey,
            sortDir: state.sortDir,
            onSort: (key) => changeSortAction(store, key),
            onSelectAll: (checked) => selectAllAction(store, checked ? derived.visible.map((item) => item.key) : null),
        });
    }
    return createElement(CardsView, { groups: derived.groups, shared });
}
function renderChrome(store, derived) {
    return [renderCommandBar(store, derived), renderBulkBar(store, derived), renderToolbar(store, derived)];
}
function renderDeck(store) {
    const derived = deriveDeck(store.state);
    return createElement('div', { className: 'dsh-my-skill-manager-root' }, ...renderChrome(store, derived), createElement('div', { className: 'dsh-my-skill-manager-stage' }, renderStage(store, derived)), createElement(Toast, { toast: store.state.toast }));
}

    "use strict";
function SkillManagerView() {
    return renderDeck(useDeck());
}

    "use strict";
exports.apply = function apply(ctx) {
    ctx.effect(() => {
        if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
            return () => { };
        }
        const style = document.createElement('style');
        style.setAttribute(STYLE_TAG, 'styles');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => {
            if (style.parentNode)
                style.parentNode.removeChild(style);
        };
    }, 'dsh-my-skill-manager: styles');
    const slots = ctx.get('slots', false);
    if (slots === undefined)
        return;
    ctx.effect(() => slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        id: 'my-skill-manager',
        order: 90,
        label: () => strings.title(),
    }, SkillManagerView)), 'dsh-my-skill-manager: settings tab registration');
};


    return module.exports
  },
})
