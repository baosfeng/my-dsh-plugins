/**
 * dsh-md-render — client half (browser).
 *
 * 精简后的职责（**不再自实现任何 markdown 渲染**）：
 *  - 官方渲染器接入（official-view.part）：表格（GFM + 宽表格横向滚动）、
 *    公式（micromark-extension-math + KaTeX）、代码块（shiki 高亮 / 语言
 *    标签 / 行号 / 复制）全部来自平台 seed 模块
 *    @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText（0.1.7-rc.2 内置）；
 *  - 真增量①：text / plaintext / txt 围栏块按 markdown 渲染 + 每块「查看原文」切换；
 *  - 真增量②：pre[data-context-text] 上下文注入块按 markdown 渲染
 *    （宿主 ContextBody 把它渲染为纯文本）；
 *  - 真增量③：整段 markdown 复制按钮（官方只有代码块复制）；
 *  - 真增量④：统一 MarkdownView 导出（供本仓其它插件使用）；
 *  - 真增量⑤：设置 → 插件 → 渲染 开关面板；
 *  - 真增量⑥（容错子集）：官方 GFM 不认的两种分隔行写法（无管道符 /
 *    列数与表头不等）先规范化再交给官方渲染（table-normalize.part）。
 * 注入渲染走 react-dom/client 的 createRoot（与 dsh-mermaid-render 同一
 * 手法），只把官方组件挂到本插件插入的容器里。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation
 * 注入、fiber teardown 卸载（HMR/禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把 lib/parts/*.part.js
 * 片段注入到下方 /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的
 * 产物，单一 __ModuleLoader__ bundle，无相对路径 require）。产物必须提交
 * （CI 只跑 node --check + 测试，不跑构建）；片段为纯函数声明文本（无
 * import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView（markdown-view.part.js）与 CopyButton（copy.part.js）用
    // createElement / useState；设置页（settings.part.js）用 useEffect；
    // 注入渲染经 official-view.part.js 的 require 取平台模块。
    const { createElement, useState, useEffect } = require('react')

    // ── 渲染配置：保留增强功能的开关状态 ────────────────────────────
    "use strict";
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
const DEFAULT_RENDER_OPTIONS = {
    copyButton: true,
    textFenceMarkdown: true,
    contextMarkdown: true,
};
let renderOptions = { ...DEFAULT_RENDER_OPTIONS };
function setRenderOptions(next) {
    renderOptions = { ...renderOptions, ...(next || {}) };
}
/** 从应用层配置提取显式配置值（仅接受布尔；缺失/非法值保持默认，不覆盖）。 */
function pickRenderOptions(config) {
    const out = {};
    const cfg = config ?? {};
    for (const key of Object.keys(DEFAULT_RENDER_OPTIONS)) {
        if (typeof cfg[key] === 'boolean')
            out[key] = cfg[key];
    }
    return out;
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
    if (typeof fetch !== 'function')
        return;
    fetch('/md/api/config')
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true || typeof body.value !== 'object' || body.value === null)
            return;
        setRenderOptions(pickRenderOptions(body.value));
    })
        .catch(() => {
        // 服务不可用时保持默认（全部开启），不影响渲染。
    });
}
exports.setRenderOptions = setRenderOptions;
exports.pickRenderOptions = pickRenderOptions;
exports.initConfigFromServer = initConfigFromServer;
exports.DEFAULT_RENDER_OPTIONS = DEFAULT_RENDER_OPTIONS;


    // ── 非标准表格容错（官方 GFM 未覆盖的两种写法）──────────────────
    "use strict";
// ── 非标准表格容错（官方 GFM 未覆盖的那一部分）────────────────────────
// 官方渲染链是 micromark-extension-gfm + mdast-util-gfm（ui-primitives/
// src/markdown/parse.ts:16,29-30），**实测**（test/table-normalize.mjs 用
// micromark 逐条验证）它已经接受这些写法：
//   · 无首尾管道符      a | b / --- | ---
//   · 紧凑分隔行        a | b / ---|---
//   · 单横线分隔        a | b / -|-
//   · 表格前有普通段落文本（前缀文本不会吃掉表格）
//   · 数据行多列/少列、只有表头无数据行、逐列对齐标记
// 只有两种写法 GFM 不认：
//   ① 分隔行完全没有管道符（a | b 后跟 ---）：GFM 视为 setext 标题
//   ② 分隔行单元格数与表头不等（a | b | c 后跟 --- | ---）：整段不识别
// 本函数只把这①②两种写法**规范化**成合法 GFM 分隔行（列数与表头对齐、
// 逐列保留 :--- / :---: / ---: 对齐标记），其余文本一字不动 —— 规范化后
// 交给官方 MarkdownText 渲染，本插件不做任何自己的渲染实现。
// 只作用于本插件交给官方渲染器的文本（MarkdownView / text 围栏块 /
// 上下文注入块），不触碰宿主其它内容。
/** 分隔行候选：只含 - : | 与空白，且至少一个 -（与旧实现同一判据）。 */
const TABLE_SEP_RE = /^\s*\|?[\s:\-|]+\|?\s*$/;
function isTableSeparator(line) {
    return typeof line === 'string' && TABLE_SEP_RE.test(line) && line.includes('-');
}
/** 按 | 切列（去首尾管道符、逐格 trim）。 */
function splitTableCells(line) {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}
/** 表头候选：含 |、至少 2 列、且本身不是分隔行。 */
function isTableHeader(line) {
    if (typeof line !== 'string' || isTableSeparator(line))
        return false;
    const trimmed = line.trim();
    if (!trimmed.includes('|'))
        return false;
    return splitTableCells(trimmed).length >= 2;
}
/** 对齐标记 → 合法 GFM 分隔单元格（保留左/中/右语义，缺省左对齐）。 */
function alignCell(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right)
        return ':---:';
    if (right)
        return '---:';
    if (left)
        return ':---';
    return '---';
}
/**
 * 把①②两种 GFM 不认的分隔行规范化为合法写法；无需改动时原样返回。
 * 已是合法 GFM 表格（有管道符且列数与表头一致）一字不动。
 */
function normalizeTables(text) {
    const source = String(text);
    const lines = source.split('\n');
    let out = null;
    for (let i = 0; i + 1 < lines.length; i += 1) {
        if (!isTableHeader(lines[i]) || !isTableSeparator(lines[i + 1]))
            continue;
        const header = splitTableCells(lines[i]);
        const separator = splitTableCells(lines[i + 1]);
        if (lines[i + 1].includes('|') && separator.length === header.length)
            continue;
        if (out === null)
            out = lines.slice();
        out[i + 1] = header.map((_cell, j) => alignCell(separator[j] ?? '')).join(' | ');
    }
    return out === null ? source : out.join('\n');
}
exports.normalizeTables = normalizeTables;
exports.isTableSeparator = isTableSeparator;
exports.isTableHeader = isTableHeader;
exports.splitTableCells = splitTableCells;


    // ── 官方渲染器接入（平台 MarkdownText + react-dom/client）────────
    "use strict";
// ── 官方渲染器接入（平台 MarkdownText + react-dom/client）─────────────
// 本插件**不再自实现 markdown 渲染**：GFM 表格（对齐 / 宽表格横向滚动）、
// 公式（micromark-extension-math + KaTeX）、代码块（shiki 高亮 / 语言标签 /
// 行号 / 复制按钮 / 主题）全部由宿主官方
// @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText 提供（0.1.7-rc.2
// 起内置）。本模块只负责两件事：
//  1. 解析平台模块：两个 spec 都在宿主 staticModules seed 表里
//     （react-dom/client、@deepseek-ai/dsh-client-ui-primitives），
//     零安装零打包（白名单见 scripts/check-client-modules.mjs 的
//     SEED_MODULES）；
//  2. 把官方组件渲染到**本插件插入的容器**里（react-dom/client.createRoot，
//     与 dsh-mermaid-render 同一手法；注入点才是本插件的真增量）。
//
// 降级（真降级，不是假降级）：官方组件或 createRoot 取不到时 ——
//   · MarkdownView（公共 API）落 <pre> 兜底：原文不丢、渲染期不抛错；
//   · DOM 注入点（text 围栏 / 上下文块）**不动宿主 DOM**，保持宿主原样。
// labels 必填（官方 MarkdownText 没有默认值，渲染含围栏代码块的文档会读
// labels.code.copyLabel），本插件按自己的中文界面硬编码。
const PLATFORM_MARKDOWN_MODULE = '@deepseek-ai/dsh-client-ui-primitives';
const PLATFORM_MARKDOWN_EXPORT = 'MarkdownText';
/** 官方 MarkdownText 的 labels 契约（MarkdownLabels：code + footnotes）。 */
const MARKDOWN_LABELS = {
    code: { copyLabel: '复制', copiedLabel: '已复制' },
    footnotes: '脚注',
};
/** React 语义的组件判定：函数，或带 $$typeof 的对象（memo/forwardRef/lazy）。 */
function isRenderableComponent(value) {
    if (typeof value === 'function')
        return true;
    return typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol';
}
let platformCache;
/** 解析官方 MarkdownText 与 createRoot；任一缺失返回 null（真降级起点）。 */
function platformMarkdown() {
    if (platformCache !== undefined)
        return platformCache;
    let MarkdownText = null;
    let createRoot = null;
    // 字面量 spec：scripts/check-client-modules.mjs 以 AST 提取字面量 require 并逐条
    // 判定是否在允许集合内（平台 seed 表 / dsh.client.external / 自身包名）——写成变量
    // 会让这条门禁看不见依赖，等于绕开门禁。
    try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
        MarkdownText = primitives ? primitives[PLATFORM_MARKDOWN_EXPORT] : null;
    }
    catch (_e) {
        MarkdownText = null;
    }
    try {
        const reactDomClient = require('react-dom/client');
        createRoot = reactDomClient ? reactDomClient.createRoot : null;
    }
    catch (_e) {
        createRoot = null;
    }
    platformCache = isRenderableComponent(MarkdownText)
        ? {
            MarkdownText,
            createRoot: typeof createRoot === 'function' ? createRoot : null,
        }
        : null;
    return platformCache;
}
/** 官方 MarkdownText 是否可用于 DOM 注入（组件 + createRoot 都在）。 */
function officialMarkdownAvailable() {
    const platform = platformMarkdown();
    return platform !== null && platform.createRoot !== null;
}
/** 容器 → React root（WeakMap：容器被宿主回收后不留引用）。 */
const markdownRoots = new WeakMap();
/**
 * 把 markdown 原文渲染进容器（官方组件负责渲染，文本先过表格容错规范化）。
 * @returns 是否已渲染（官方组件不可用 → false，调用方保持宿主原样）。
 */
function renderMarkdownInto(container, text) {
    const platform = platformMarkdown();
    if (platform === null || platform.createRoot === null)
        return false;
    let root = markdownRoots.get(container);
    if (root === undefined) {
        root = platform.createRoot(container);
        markdownRoots.set(container, root);
    }
    root.render(createElement(platform.MarkdownText, { text: normalizeTables(text), labels: MARKDOWN_LABELS }));
    return true;
}
/** 卸载容器上的 React root（容器内容被重建/清理前调用，避免悬挂 root）。 */
function unmountMarkdownIn(container) {
    const root = markdownRoots.get(container);
    if (root === undefined)
        return;
    markdownRoots.delete(container);
    try {
        root.unmount();
    }
    catch (_e) {
        /* 卸载异常不阻断调用方清理 DOM */
    }
}
/** MarkdownView 的内容节点：官方组件，或 <pre> 兜底（原文不丢）。 */
function officialMarkdownNode(text) {
    const platform = platformMarkdown();
    if (platform === null)
        return createElement('pre', { className: 'dsh-md-render-fallback' }, text);
    return createElement(platform.MarkdownText, { text: normalizeTables(text), labels: MARKDOWN_LABELS });
}
exports.PLATFORM_MARKDOWN_MODULE = PLATFORM_MARKDOWN_MODULE;
exports.MARKDOWN_LABELS = MARKDOWN_LABELS;
exports.platformMarkdown = platformMarkdown;
exports.officialMarkdownAvailable = officialMarkdownAvailable;
exports.renderMarkdownInto = renderMarkdownInto;
exports.unmountMarkdownIn = unmountMarkdownIn;
exports.officialMarkdownNode = officialMarkdownNode;


    // ── 整段 markdown 复制（官方只有代码块复制）─────────────────────
    "use strict";
// ── 整段 markdown 复制（官方只有代码块复制）────────────────────────
// 复制实现：navigator.clipboard.writeText 优先，失败回退
// document.execCommand('copy')（textarea 中转）；复制成功后按钮文案
// 切换「已复制」1.5s 后恢复；流式渲染中（[data-streaming] 祖先）由
// styles.ts 的 [data-streaming] .dsh-md-render-copy{display:none} 规则隐藏。
function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok;
    try {
        ok = document.execCommand('copy');
    }
    catch (_e) {
        ok = false;
    }
    document.body.removeChild(ta);
    return ok;
}
function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).catch(() => {
            if (!fallbackCopyText(text))
                throw new Error('copy failed');
        });
    }
    if (!fallbackCopyText(text))
        return Promise.reject(new Error('copy failed'));
    return Promise.resolve();
}
/** 是否应跳过该元素（复制按钮自身 / 官方代码块 banner：语言名+复制按钮文案）。 */
function isCopyNoise(el) {
    if (el.matches('.dsh-md-render-copy') || el.matches('button'))
        return true;
    return el.matches('[data-code-block-banner]') || el.matches('.dsh-md-render-code-head');
}
// 收集容器纯文本（跳过复制按钮与代码块 banner，避免按钮/语言名文案混入）。
// 不用 textContent 直取：textContent 包含 display:none 元素的文本，
// 按钮文案会混入；递归遍历 childNodes 并跳过噪声元素。
function collectCopyText(node, out) {
    if (node.nodeType === 3) {
        out.push(node.textContent);
        return;
    }
    if (node.nodeType !== 1)
        return;
    if (isCopyNoise(node))
        return;
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i += 1)
        collectCopyText(kids[i], out);
}
// kind: 'content'（tzx-md 内，复制整段纯文本；官方代码块复制按钮由官方提供）。
// 点击时从 DOM 取文本（流式结束后内容已稳定）。
function CopyButton({ kind }) {
    const [copied, setCopied] = useState(false);
    const [timer, setTimer] = useState(null);
    const onClick = (event) => {
        const host = event && event.currentTarget ? event.currentTarget.closest(kind === 'content' ? '.tzx-md' : '') : null;
        if (!host)
            return;
        const out = [];
        collectCopyText(host, out);
        const text = out.join('');
        if (!text)
            return;
        copyText(text).then(() => {
            setCopied(true);
            if (timer)
                clearTimeout(timer);
            setTimer(setTimeout(() => setCopied(false), 1500));
        }, () => { });
    };
    return createElement('button', {
        type: 'button',
        className: 'dsh-md-render-copy' + (copied ? ' dsh-md-render-copy-done' : ''),
        title: copied ? '已复制' : '复制',
        'aria-label': copied ? '已复制' : '复制',
        onClick,
    }, copied ? '已复制' : '复制');
}


    // ── 统一 MarkdownView：对外公共 API（官方渲染 + 整段复制）────────
    "use strict";
// ── 统一 MarkdownView（对外公共 API 面）──────────────────────────────
// 对外承诺（README「公共 API 契约」）：require('dsh-md-render').MarkdownView
// 存在且为 React 组件，props 为 { text: string }（额外 props 忽略，非字符串
// 降级为文本）；bundle id 为 dsh-md-render。
//
// 实现 = 官方 MarkdownText（平台 seed 模块，表格 / 公式 / 代码块全部由
// 官方渲染）+ 非标准表格容错预处理（table-normalize.ts） + 「整段复制」
// 按钮（官方只有代码块复制，整段复制是本插件保留的增量）。官方组件不可用
// → <pre> 兜底。本文件不含任何自实现的 markdown 渲染。
/** 统一 MarkdownView：{ text } → div.tzx-md（官方渲染 + 整段复制按钮）。 */
function MarkdownView({ text }) {
    const source = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
    return createElement('div', { className: 'tzx-md' }, officialMarkdownNode(source), 
    // 整段复制按钮（copyButton 关闭 → 不渲染）；官方只有代码块复制。
    renderOptions.copyButton ? createElement(CopyButton, { kind: 'content' }) : null);
}
exports.MarkdownView = MarkdownView;


    // ── 上下文注入块 markdown 渲染（pre[data-context-text]）─────────
    "use strict";
// ── 上下文注入块 markdown 渲染 ───────────────────────────────────────
// 宿主 @deepseek-ai/dsh-client-ui-chat 的 ContextBody 把上下文注入正文
// （子 agent 回传消息 / AGENTS.md 等 workspace 指令 / 回忆注入）渲染为
// <pre data-context-text="true"> 纯文本（ui-chat/src/client/chat/ContextBody.tsx:147，
// CSS white-space:pre-wrap），其中的 markdown（粗体 / 列表 / 标题 / 表格 /
// 代码块）不会渲染——官方不接管这类纯文本块，所以这是本插件的真增量。
// 本模块在 DOM 层把这类块交给**官方 MarkdownText**（react-dom/client 挂到
// 插入的容器里）渲染，与宿主消息同一套渲染器（表格 / 公式 / 代码块能力
// 完全一致）。
//
// 与 React 共存的约束（宿主白名单是 React 管理的 DOM）：
//  - 不修改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体
//    改写 textContent，改子结构必被冲掉），只在 pre 之前插入渲染容器并
//    给 pre 置 hidden；
//  - 渲染容器写 data-signature（文本长度 + djb2 哈希），重扫时签名一致
//    且容器仍在位 → 跳过（幂等，不重复渲染、不抖动）；
//  - 宿主重建节点（会话切换 / 重渲染）冲掉容器后，MutationObserver 兜底
//    重扫会重做；pre 上的标记不影响宿主（React 不管理该属性）。
// 超长文本（> MAX_CONTEXT_CHARS）跳过；官方组件不可用时不接管（保持宿主
// 纯文本，真降级）。
/** 上下文注入正文选择器（宿主 ContextBody 的稳定 data 契约）。 */
const CONTEXT_TEXT_SELECTOR = 'pre[data-context-text="true"]';
/** 已处理标记（写在 pre 上）。 */
const CONTEXT_APPLIED = 'applied';
/** 渲染容器标记（写在插入的 div 上）。 */
const CONTEXT_BODY_ATTR = 'data-dsh-md-render-context-body';
/** 单块渲染上限（字符）；超过则保持宿主纯文本。 */
const MAX_CONTEXT_CHARS = 200000;
/** djb2 字符串哈希（签名用，非加密）。 */
function contextHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1)
        h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
/** 取已在位的渲染容器（pre 的前一个兄弟且带标记）。 */
function contextBodyOf(pre) {
    const prev = pre.previousElementSibling;
    return prev && prev.getAttribute(CONTEXT_BODY_ATTR) === 'true' ? prev : null;
}
/** 接管前置条件（开关 / 官方组件 / 父节点 / 长度）→ 待渲染文本；不满足返回 null。 */
function contextSourceOf(pre) {
    if (!renderOptions.contextMarkdown)
        return null;
    if (!officialMarkdownAvailable())
        return null;
    const parent = pre.parentNode;
    if (!parent || typeof parent.insertBefore !== 'function')
        return null;
    const text = pre.textContent ?? '';
    if (text.length > MAX_CONTEXT_CHARS)
        return null;
    return { parent, text };
}
/** 建容器并交给官方渲染器；官方组件不可用 → null（调用方保持宿主原样）。 */
function buildContextBody(text, signature) {
    const body = document.createElement('div');
    body.className = 'tzx-md dsh-md-render-context-md';
    body.setAttribute(CONTEXT_BODY_ATTR, 'true');
    body.setAttribute('data-signature', signature);
    return renderMarkdownInto(body, text) ? body : null;
}
/** 幂等应用：文本未变且容器在位 → 跳过；否则（重）渲染并隐藏原文。 */
function applyContextMarkdown(pre) {
    const source = contextSourceOf(pre);
    if (source === null)
        return;
    const signature = String(source.text.length) + ':' + contextHash(source.text);
    const existing = contextBodyOf(pre);
    if (existing && existing.getAttribute('data-signature') === signature)
        return;
    if (existing) {
        unmountMarkdownIn(existing);
        source.parent.removeChild(existing);
    }
    const body = buildContextBody(source.text, signature);
    if (body === null)
        return;
    source.parent.insertBefore(body, pre);
    pre.setAttribute('data-dsh-md-render-context', CONTEXT_APPLIED);
    pre.hidden = true;
}
/** 扫描 root 内的上下文注入块（供 scanner 调用）。 */
function scanContextBlocks(root) {
    for (const pre of Array.from(root.querySelectorAll(CONTEXT_TEXT_SELECTOR))) {
        applyContextMarkdown(pre);
    }
}
exports.CONTEXT_TEXT_SELECTOR = CONTEXT_TEXT_SELECTOR;
exports.MAX_CONTEXT_CHARS = MAX_CONTEXT_CHARS;
exports.contextHash = contextHash;
exports.applyContextMarkdown = applyContextMarkdown;
exports.scanContextBlocks = scanContextBlocks;


    // ── text / plaintext / txt 围栏块按 markdown 渲染 + 查看原文 ────
    "use strict";
// ── text / plaintext / txt 围栏块按 markdown 渲染 ────────────────────
// 模型有时把**实际是 markdown 的内容**（标题 / 列表 / 表格 / 链接）用
// \`\`\`text 围起来，宿主官方 CodeBlock（ui-primitives）按等宽代码块原样
// 显示就丢掉了排版——官方不接管这类块，所以这是本插件的真增量。
// 本模块在 DOM 层拦截这类块：块内文本交给**官方 MarkdownText**（经
// react-dom/client 挂到我们插入的容器里）渲染，表格 / 公式 / 代码块能力与
// 宿主消息完全一致（同一渲染器），并为**每个块**挂独立的「查看原文」切换。
// 口径（需求方已确认，不做内容启发式判定）：语言标记 ∈ {text, plaintext,
// txt} 一律渲染；其他标记（js / ts / json / bash …）与无标记的块**完全
// 不触碰**。
// 形态照 dsh-mermaid-render 的「拦截特定语言代码块 → 换渲染形态 + 视图
// 切换」先例：宿主内容容器保持原位（只按视图隐藏），渲染容器与切换按钮
// 追加在块内，视图状态写在块属性 data-dsh-md-render-text-view 上（每块
// 独立、可来回切）。
// 语言与源码来源（官方 DOM 契约，ui-primitives/src/markdown/CodeBlock.tsx:
// 187-209）：块是 div.md-code-block；语言不在 DOM class 上（CodeBlock 用
// banner 的 infostring 显示），从 React fiber 的 memoizedProps 读 lang/code
// （与 dsh-md-render 旧版轨迹接管同一手法）；fiber 取不到时回退
// code.language-xxx（官方空围栏分支与旧契约 DOM）→ banner 首个子元素文本。
// 流式口径沿用本插件既有策略（scanner.ts 的 [data-streaming] 门控 +
// 属性移除触发兜底重扫）：流式中的块跳过，稳定后再渲染——不闪断、不重复
// 挂载；幂等靠块上的签名（语言 + 长度 + djb2 哈希，哈希复用
// context-markdown.ts 的 contextHash——同一 factory 作用域），签名变化
// （流式补写 / 宿主重渲染）才重建，宿主冲掉容器后重扫自愈。
/** 触发 markdown 渲染的围栏语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS = ['text', 'plaintext', 'txt'];
/** 视图状态标记（写在 md-code-block 上，每块独立）：markdown | source。 */
const TEXT_VIEW_ATTR = 'data-dsh-md-render-text-view';
/** 幂等签名标记（写在 md-code-block 上）。 */
const TEXT_SIG_ATTR = 'data-dsh-md-render-text-sig';
/** markdown 渲染容器类名（样式见 styles.ts；tzx-md 为既有契约类）。 */
const TEXT_MD_CLASS = 'dsh-md-render-text-md';
/** 「查看原文 / 查看渲染」切换按钮类名。 */
const TEXT_TOGGLE_CLASS = 'dsh-md-render-text-toggle';
/** 视图 → 按钮文案（按钮文案指向「点击后去哪」）。 */
const TEXT_VIEW_LABELS = { markdown: '查看原文', source: '查看渲染' };
/** 单块渲染上限（字符）；超长块保持原代码块，避免单块渲染卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000;
/** 沿 React fiber 向上找 CodeBlock props 的最大跳数（实测 1~3 跳）。 */
const TEXT_FIBER_HOPS = 8;
/** 元素上的 React fiber 属性名（React 私有前缀，只读）。 */
function fiberKeys(el) {
    const keys = typeof Object.keys === 'function' ? Object.keys(el) : [];
    return keys.filter((key) => key.indexOf('__reactFiber$') === 0);
}
/** 沿一条 fiber 链向上找带 string `code` 的 props（CodeBlock 的 memoizedProps）。 */
function fiberCodeBlockProps(start) {
    let fiber = start;
    for (let hops = 0; fiber !== null && fiber !== undefined && hops < TEXT_FIBER_HOPS; hops += 1) {
        const props = fiber.memoizedProps;
        if (props !== undefined && props !== null && typeof props.code === 'string') {
            return { lang: typeof props.lang === 'string' ? props.lang.toLowerCase() : '', code: props.code };
        }
        fiber = (fiber.return ?? null);
    }
    return null;
}
/** 从 React fiber 读官方 CodeBlock 的 { lang, code }（取不到返回 null）。 */
function textFenceFiberProps(block) {
    for (const key of fiberKeys(block)) {
        const found = fiberCodeBlockProps(block[key]);
        if (found !== null)
            return found;
    }
    return null;
}
/** 官方空围栏 / 旧契约 DOM 的 code.language-xxx（无则 ''）。 */
function textFenceClassLang(block) {
    const code = block.querySelector('code');
    const className = code !== null && typeof code.className === 'string' ? code.className : '';
    const m = className.match(/language-([A-Za-z0-9_+-]+)/);
    return m ? m[1].toLowerCase() : '';
}
/** banner infostring（官方 CodeBlock 的 data-code-block-banner 首个子元素）。 */
function textFenceBannerLang(block) {
    const banner = block.querySelector('[data-code-block-banner]');
    const info = banner !== null && banner.firstElementChild ? banner.firstElementChild.textContent : '';
    return String(info ?? '')
        .trim()
        .toLowerCase();
}
/** 块的围栏语言（fiber → code class → banner；非 text/plaintext/txt → ''）。 */
function textFenceLang(block) {
    const fiber = textFenceFiberProps(block);
    const candidates = [fiber === null ? '' : fiber.lang, textFenceClassLang(block), textFenceBannerLang(block)];
    const lang = candidates.find((value) => TEXT_FENCE_LANGS.includes(value)) ?? '';
    return { lang, code: fiber === null ? null : fiber.code };
}
/** 块源码：fiber code（官方 display 语义：去掉一个尾部换行）优先，否则 DOM 文本。 */
function textFenceSource(block, code) {
    if (typeof code === 'string')
        return code.endsWith('\n') ? code.slice(0, -1) : code;
    const codeEl = block.querySelector('code');
    return codeEl !== null ? (codeEl.textContent ?? '') : '';
}
/** 取块的源码与签名素材（非目标语言 / 空内容 / 超长 → null）。 */
function textFenceBody(block) {
    const { lang, code } = textFenceLang(block);
    if (lang === '')
        return null;
    const text = textFenceSource(block, code);
    if (!text.trim() || text.length > MAX_TEXT_FENCE_CHARS)
        return null;
    return { lang, text };
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner.ts 同一口径）。 */
function isStreamingBlock(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/** 本插件已渲染的 markdown 容器（幂等判定用）。 */
function textMarkdownBody(block) {
    return block.querySelector('div.' + TEXT_MD_CLASS);
}
/** 移除上一轮的渲染容器与切换按钮（源码变化 / 重建前清理）。 */
function clearTextView(block) {
    const body = textMarkdownBody(block);
    if (body !== null) {
        unmountMarkdownIn(body);
        if (body.parentNode)
            body.parentNode.removeChild(body);
    }
    const btn = block.querySelector('button.' + TEXT_TOGGLE_CLASS);
    if (btn !== null && btn.parentNode)
        btn.parentNode.removeChild(btn);
}
/** 切换视图：写块上的状态属性 + 同步按钮文案与 aria 状态（不动宿主内容）。 */
function setTextView(block, view) {
    block.setAttribute(TEXT_VIEW_ATTR, view);
    const btn = block.querySelector('button.' + TEXT_TOGGLE_CLASS);
    if (!btn)
        return;
    btn.textContent = TEXT_VIEW_LABELS[view] ?? TEXT_VIEW_LABELS.markdown;
    btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false');
}
/** 「查看原文 / 查看渲染」按钮：点击只翻转本块的状态属性（每块独立）。 */
function textToggleButton(block, view) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = TEXT_TOGGLE_CLASS;
    btn.textContent = TEXT_VIEW_LABELS[view] ?? TEXT_VIEW_LABELS.markdown;
    btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false');
    btn.addEventListener('click', () => {
        setTextView(block, block.getAttribute(TEXT_VIEW_ATTR) === 'source' ? 'markdown' : 'source');
    });
    return btn;
}
/**
 * 应用（幂等）：把 text / plaintext / txt 块的内容交给官方渲染器渲染 +
 * 挂切换按钮。开关关闭 / 官方组件不可用 / 流式中 / 非目标语言 / 内容为空
 * 或超长 / 签名未变 → 不动 DOM。
 */
function applyTextMarkdown(block) {
    if (!renderOptions.textFenceMarkdown)
        return;
    if (!officialMarkdownAvailable())
        return;
    if (isStreamingBlock(block))
        return;
    // 本插件渲染容器内的块不再二次接管（嵌套 \`\`\`text 保持代码块形态，避免递归重建）。
    if (block.closest && block.closest('div.' + TEXT_MD_CLASS))
        return;
    const src = textFenceBody(block);
    if (src === null)
        return;
    const signature = src.lang + ':' + src.text.length + ':' + contextHash(src.text);
    if (textMarkdownBody(block) !== null && block.getAttribute(TEXT_SIG_ATTR) === signature)
        return;
    clearTextView(block);
    const body = document.createElement('div');
    body.className = 'tzx-md ' + TEXT_MD_CLASS;
    block.appendChild(body);
    if (!renderMarkdownInto(body, src.text)) {
        // 官方组件中途不可用：撤掉半成品，保持宿主原样（真降级）。
        block.removeChild(body);
        return;
    }
    block.appendChild(textToggleButton(block, 'markdown'));
    block.setAttribute(TEXT_VIEW_ATTR, 'markdown');
    block.setAttribute(TEXT_SIG_ATTR, signature);
}
/** 扫描 root（自身 / 后代）内的围栏代码块，处理其中的 text/plaintext/txt 块。 */
function scanTextBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches('div.md-code-block'))
        applyTextMarkdown(root);
    for (const block of root.querySelectorAll('div.md-code-block'))
        applyTextMarkdown(block);
}
exports.TEXT_FENCE_LANGS = TEXT_FENCE_LANGS;
exports.MAX_TEXT_FENCE_CHARS = MAX_TEXT_FENCE_CHARS;
exports.textFenceLang = textFenceLang;
exports.applyTextMarkdown = applyTextMarkdown;
exports.scanTextBlocks = scanTextBlocks;


    // ── 扫描器骨架（共享）+ MutationObserver 跟随流式渲染 ───────────
    // ── shared DOM scanner skeleton (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：dsh-md-render（parts/scanner.ts：表格增强 + #196
// 上下文块接管 + #205 轨迹视图接管）与 dsh-mermaid-render（client/index.ts：
// mermaid 卡片挂载 / 流式闭合判定）各自的 MutationObserver 骨架结构等价，收口到这里。
//
// 共享的只是**骨架**：观察 body、把新增元素与兜底重扫目标交给插件的 scan 回调、
// 维护批次轮次、返回 disposer。各插件的特有策略全部留在 scan 回调里（本 issue
// 的一条硬约束：共享化不得削掉 #185/#195/#196/#205 的任何行为）：
//  - dsh-md-render：流式内容门控（[data-streaming] 祖先跳过）、幂等 seen 集合、
//    上下文注入块 / 轨迹视图接管、宿主契约不匹配时的静默降级；
//  - dsh-mermaid-render：围栏闭合判定（settleStream）、离屏渲染、自愈卸载，
//    以及 teardown 时清理挂载表 / 流式观察表（经 onTeardown 注入）。
/**
 * 观察 body 的 DOM 变更（子节点 + data-streaming 属性），把新增元素与兜底重扫
 * 目标交给 scan 回调；返回 disposer。
 *
 * @param {{
 *   scan: (node: Node, round: number) => void
 *   rescanSelectors?: string[]
 *   attributeFilter?: string[]
 *   onTeardown?: () => void
 * }} options
 *   - scan：处理一个节点（新增元素，或重扫容器的根）。round 是本次批次的递增序号，
 *     同一批次内所有 scan 调用共享它（插件可用它做「本批次只挂载一次」判定）
 *   - rescanSelectors：每次变更后兜底重扫的选择器（流式结束、虚拟列表行回收等
 *     不产生 addedNodes 的内容变化）
 *   - attributeFilter：触发重扫的属性名（默认 ['data-streaming']）
 *   - onTeardown：disposer 被调用时（fiber 卸载 / HMR）的清理钩子
 * @returns {() => void} 观察器 disposer
 */
function installDomScanner(options) {
  const rescanSelectors = options.rescanSelectors ?? []
  const attributeFilter = options.attributeFilter ?? ['data-streaming']
  let round = 0
  options.scan(document.body, ++round)
  const observer = new MutationObserver((mutations) => {
    const current = ++round
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === 1) options.scan(added, current)
      }
    }
    // 兜底重扫：流式结束后的内容补全 / 轨迹视图虚拟列表回收不一定以 addedNodes
    // 形式出现，按选择器整体重扫，保证最终一致。
    for (const selector of rescanSelectors) {
      for (const el of document.querySelectorAll(selector)) options.scan(el, current)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter })
  return () => {
    observer.disconnect()
    if (options.onTeardown) options.onTeardown()
  }
}

    "use strict";
// ── 扫描器：MutationObserver 跟随流式渲染 ──────────────────────────
// 精简后只保留两个真增量注入点（官方已内置表格 / 公式 / 代码块能力，
// DOM 层不再做任何渲染接管）：
//  - 上下文注入块（pre[data-context-text]，宿主 ContextBody 的纯文本渲染
//    —— 子 agent 消息 / AGENTS.md 注入等）走 context-markdown 的渲染；
//  - text / plaintext / txt 围栏块走 text-markdown 的渲染 + 每块「查看原文」
//    切换。
// 流式门控 / 幂等标记都在各自模块内（scanner 只负责枚举与调用）。
function scanNode(seen, node) {
    if (!node || typeof node.querySelectorAll !== 'function')
        return;
    const el = node;
    if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR))
        applyContextMarkdown(el);
    scanContextBlocks(el);
    scanTextBlocks(el);
}
/** 观察 body；返回观察器 disposer。
 *  骨架（观察配置 / 批次轮次 / disposer）来自共享 part（与 dsh-mermaid-render
 *  同一份），本插件的特有策略全部留在 scanNode 内；seen 集合保留给调用方
 *  语义（宿主重渲染后新节点仍会被处理）。 */
function installScanner() {
    const seen = new Set();
    return installDomScanner({
        scan: (node) => scanNode(seen, node),
        // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
        rescanSelectors: ['[data-conversation-scroll]'],
    });
}


    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    "use strict";
// ── 样式（DSH 语义 token，随 activation 注入）──────────────────
// 精简后只保留本插件**自有 DOM** 的样式：统一 MarkdownView 的包裹容器
// （tzx-md）、两个注入容器（text 围栏块 / 上下文注入块）、「查看原文」
// 切换按钮、整段复制按钮。表格 / 公式 / 代码块高亮 / 代码主题等样式全部
// 下线——那些 DOM 现在由官方 MarkdownText 渲染，样式随官方组件自带
// （ui-primitives 的 CSS Modules）。
const STYLES = `
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
`;


    // ── 共享样式注入（dsh-shared/client-parts）──────────────────────
    // ── shared plugin stylesheet injection (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：把「注入 <style data-<plugin>="styles"> 并随 fiber
// teardown 卸载」这段逐字相同的样板从渲染插件收口到这里。当前调用方：
// dsh-md-render（parts/apply.ts）/ dsh-mermaid-render（client/index.ts）/
// dsh-think-zh-expand（client/index.ts）——各自 scripts/build.mjs 在构建期把本
// 文件拼进 __ModuleLoader__ factory 作用域（构建时源文件，不经过 require 解析）。
//
// 为什么「无条件、最先注入、不进早退分支」：样式若挂在某个服务判空之后，
// HMR / 服务缺省时样式就丢了（dsh-file-activity 踩坑，见三处调用点的原注释）。
/**
 * 注入插件样式表，随 ctx fiber 卸载（HMR/禁用无残留）。
 *
 * @param {{ effect: (fn: () => void | (() => void), label?: string) => void }} ctx cordis client ctx
 * @param {string} attr 标识属性名（如 'data-dsh-md-render'；值固定为 'styles'）
 * @param {string} css 样式表文本
 * @param {string} label effect 标签（如 'dsh-md-render: styles'，HMR/调试定位用）
 * @returns {void}
 */
function installStyles(ctx, attr, css, label) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(attr, 'styles')
    style.textContent = css
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, label)
}


    // ── 设置页：渲染增强开关可视化 + 保存 ───────────────────────────
    "use strict";
// ── 设置页视图：保留增强功能的开关可视化 ────────────────────────────
// 官方 slots 扩展点：设置 → 插件 → 渲染 页签。开关列表与 server 端
// （lib/index.js buildOptions + lib/routes.js SWITCH_KEYS）一一对应；
// 保存写入 profile patch 文件（持久化），DSH 的 watchUserPatches 热重载后
// client 重新 apply（保存即生效）；保存成功后立即 setRenderOptions 应用新
// 配置（当前页面无需等待重载）。
// 精简后只剩三个开关（表格 / 公式 / 代码块高亮等开关随自实现渲染下线，
// 迁移说明见 README「配置」与 CHANGELOG）。
const SETTINGS_STYLES = `
.dsh-md-render-settings{display:flex;flex-direction:column;gap:10px;padding:12px}
.dsh-md-render-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-md-render-settings-section-title{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.dsh-md-render-settings-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-md-render-settings-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-md-render-settings-label{font:var(--dsw-font-xs-strong-13)}
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
`;
const SETTINGS_SWITCHES = [
    { key: 'copyButton', label: '整段复制', hint: 'MarkdownView 整段内容一键复制（官方只有代码块复制）' },
    {
        key: 'textFenceMarkdown',
        label: 'text 围栏块渲染',
        hint: '语言标记为 text / plaintext / txt 的围栏块按 markdown 渲染，每块可切回原文',
    },
    {
        key: 'contextMarkdown',
        label: '上下文注入块渲染',
        hint: '宿主以纯文本呈现的上下文注入正文（子 agent 消息 / AGENTS.md）按 markdown 渲染',
    },
];
/** 开关行（布尔配置项）。 */
function SettingsSwitchRow({ label, hint, on, onChange, }) {
    return createElement('div', { className: 'dsh-md-render-settings-row' }, createElement('div', { className: 'dsh-md-render-settings-info' }, createElement('div', { className: 'dsh-md-render-settings-label' }, label), createElement('div', { className: 'dsh-md-render-settings-hint' }, hint)), createElement('div', {
        className: 'dsh-md-render-settings-toggle',
        'data-on': String(on),
        role: 'switch',
        'aria-checked': String(on),
        onClick: () => onChange(!on),
    }));
}
/** 开关区块（保留的全部增强项）。 */
function renderSwitchesSection(draft, patch) {
    return createElement('div', { className: 'dsh-md-render-settings-section' }, createElement('div', { className: 'dsh-md-render-settings-section-title' }, '渲染增强'), ...SETTINGS_SWITCHES.map((item) => createElement(SettingsSwitchRow, {
        key: item.key,
        label: item.label,
        hint: item.hint,
        on: draft[item.key] === true,
        onChange: (v) => patch(item.key, v),
    })));
}
/** 保存配置（PUT /md/api/config），成功/失败更新状态。 */
function saveConfig(draft, setSaved, setErrorKind) {
    setSaved(false);
    setErrorKind('');
    fetch('/md/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('save failed');
        // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
        setRenderOptions(pickRenderOptions(draft));
        setSaved(true);
    })
        .catch(() => setErrorKind('save'));
}
/** 配置加载失败视图：失败原因（http 状态/网络）+ 针对性提示 + 重试。 */
function LoadErrorView({ errorKind, onRetry }) {
    const hint = errorKind === 'http:404'
        ? '服务端插件未加载：/md/api 路由不存在（请确认已安装并启用 dsh-md-render 后重启 DSH）'
        : errorKind === 'http:403'
            ? '请求被安全围栏拒绝（403）：请检查网络/代理设置'
            : '网络错误或响应异常：请检查 DSH 服务是否正常运行';
    return createElement('div', { className: 'dsh-md-render-settings' }, createElement('div', { className: 'dsh-md-render-settings-error' }, '配置加载失败'), createElement('div', { className: 'dsh-md-render-settings-status' }, hint), createElement('div', { className: 'dsh-md-render-settings-actions' }, createElement('button', { className: 'dsh-md-render-settings-btn', onClick: onRetry }, '重试')));
}
/** 设置页主视图：加载当前配置 → 开关编辑 → 保存（PUT /md/api/config）。 */
function MdRenderSettingsView() {
    const [config, setConfig] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorKind, setErrorKind] = useState('');
    const [saved, setSaved] = useState(false);
    const load = () => {
        setLoading(true);
        setErrorKind('');
        fetch('/md/api/config')
            .then((res) => {
            if (!res.ok)
                throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
            return res.json();
        })
            .then((body) => {
            if (body === null || body.ok !== true)
                throw new Error('bad config response');
            setConfig(body.value);
            setDraft(body.value);
            setLoading(false);
        })
            .catch((err) => {
            setLoading(false);
            setConfig(null);
            // 区分失败原因：404 = /md/api 路由未注册（服务端插件未加载），
            // 403 = 安全围栏拒绝，其余为网络/响应异常。
            setErrorKind(typeof err?.status === 'number' ? 'http:' + err.status : 'network');
        });
    };
    useEffect(() => {
        load();
    }, []);
    if (loading) {
        return createElement('div', { className: 'dsh-md-render-settings' }, createElement('div', { className: 'dsh-md-render-settings-status' }, '加载中…'));
    }
    if (config === null) {
        return createElement(LoadErrorView, { errorKind, onRetry: load });
    }
    const patch = (key, value) => setDraft({ ...draft, [key]: value });
    const save = () => saveConfig(draft, setSaved, setErrorKind);
    return createElement('div', { className: 'dsh-md-render-settings' }, renderSwitchesSection(draft, patch), createElement('div', { className: 'dsh-md-render-settings-actions' }, createElement('button', { className: 'dsh-md-render-settings-btn', onClick: save }, '保存'), saved ? createElement('span', { className: 'dsh-md-render-settings-saved' }, '已保存') : null, errorKind ? createElement('span', { className: 'dsh-md-render-settings-error' }, '保存失败') : null));
}
/** 设置页 tab 注册（官方 slots 扩展点；服务缺省时静默跳过）。 */
function attachSettingsTab(ctx) {
    // ctx.get 缺省（测试桩/精简上下文）时静默跳过，不影响渲染能力。
    const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined;
    if (slots === undefined)
        return;
    ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.head === 'undefined')
            return () => { };
        const style = document.createElement('style');
        style.setAttribute('data-dsh-md-render-settings', 'styles');
        style.textContent = SETTINGS_STYLES;
        document.head.appendChild(style);
        return () => {
            if (style.parentNode !== null)
                style.parentNode.removeChild(style);
        };
    }, 'dsh-md-render: settings styles');
    ctx.effect(() => {
        ;
        slots.inject('settings.plugins.tab', () => slots.register({
            name: 'settings.plugins.tab',
            id: 'md-render-settings',
            order: 90,
            label: () => '渲染',
        }, MdRenderSettingsView));
        return undefined;
    }, 'dsh-md-render: settings tab registration');
}


    // ── 插件入口：样式注入 + 扫描器装配 ───────────────────────────
    "use strict";
exports.inject = [];
exports.apply = function apply(ctx) {
    // 增强功能开关：默认全开；真实配置异步经 GET /md/api/config 拉取应用
    // （client 端不能访问 ctx.config——Cordis inject 限制，访问抛
    // "cannot get property without inject"，导致 client failed to apply）。
    setRenderOptions(pickRenderOptions());
    initConfigFromServer();
    // 样式注入走共享实现：与 dsh-mermaid-render / dsh-think-zh-expand
    // 同一份「无条件最先注入 + 随 fiber teardown 卸载」逻辑（style-tag.part.js）。
    // 位置仍在最前、不进任何早退分支（dsh-file-activity 踩坑：挂在服务判空之后，
    // HMR / 服务缺省时样式会丢）。
    installStyles(ctx, 'data-dsh-md-render', STYLES, 'dsh-md-render: styles');
    // 两个真增量注入点（上下文块 / text 围栏块）跟随流式渲染重扫。
    ctx.effect(() => installScanner(), 'dsh-md-render: scanner');
    // 设置页 tab（官方 slots 扩展点）。
    attachSettingsTab(ctx);
};


    return module.exports
  },
})
