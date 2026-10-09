/**
 * dsh-md-render — client half (browser)，合并 think-zh-expand + mermaid-render（issue #463）。
 *
 * 职责边界（**只做 markdown 内容的渲染**）：markdown 文本、代码样式、图表渲染、
 * 思考 markdown 渲染；**其他一律保持官方默认样式**。
 *
 *  - 官方渲染器接入（official-view）：表格（GFM + 宽表格）、公式（KaTeX）、
 *    代码块（shiki 高亮 / 语言标签 / 行号 / 复制）全部来自平台 seed 模块
 *    @deepseek-ai/dsh-client-ui-primitives 的 MarkdownText；
 *  - 真增量①：text / plaintext / txt 围栏块按 markdown 渲染 + 每块「查看原文」切换；
 *  - 真增量②：pre[data-context-text] 上下文注入块按 markdown 渲染；
 *  - 真增量③：整段 markdown 复制按钮（官方只有代码块复制）；
 *  - 真增量④：统一 MarkdownView 导出（供本仓其它插件使用）；
 *  - 真增量⑤：mermaid / mmd 代码块 → 图表卡片（预览 / 代码切换、导出、失败降级回显源码）；
 *  - 真增量⑥：思考块默认展开（对官方折叠行派发一次真实 click，外观 100% 官方）；
 *  - 真增量⑦：设置 → 插件 → 渲染（单 tab 三分组）；
 *  - 真增量⑧（容错子集）：官方 GFM 不认的两种分隔行写法先规范化再交给官方渲染。
 *
 * 硬约束（可机器校验，见 test/static-assertions.mjs）：
 *  - **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  - **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  - **不读 React fiber 私有属性**（__reactFiber$）；
 *  - 单 MutationObserver（一个扫描器按语言分流）。
 *
 * 样式走 DSH 语义 token（--dsw-alias-* / --dsw-font-*），随 activation 注入、
 * fiber teardown 卸载（HMR / 禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把编译后的片段注入到
 * 下方 /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的产物，单一
 * __ModuleLoader__ bundle，无相对路径 require）。产物必须提交（CI 只跑
 * node --check + 测试，不跑构建）；片段为纯函数声明文本（无 import/export），
 * 注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // MarkdownView / CopyButton / MermaidCard / 设置页用 createElement + hooks；
    // 注入渲染经 official-view.part.js 的 require 取平台模块。
    const { createElement, useState, useEffect } = require('react')

    // ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──
    // ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──────
const CONFIG_API_URL = "/md-render/api/config"
const MERMAID_ENGINE_URL = "/md-render/assets/mermaid-10.9.3.min.js"

    // ── 渲染配置：三段命名空间化开关 + 旧扁平键读兼容 ────────────────
    "use strict";
// ── 渲染配置：三段命名空间化开关（markdown / thinking / mermaid）─────────
// 与 host 半 lib/config.js 的 schema 一一对应（同一份默认值语义）：
//  - markdown.copyButton / textFenceMarkdown / contextMarkdown  默认开（!== false）
//  - thinking.defaultExpanded                                  默认开（严格布尔）
//  - mermaid.injectPrompt / render                             默认开（仅显式 false 关）
// **旧扁平键读兼容（必须）**：合并前 dsh-md-render 把开关写在顶层，用户 profile
// 已落盘；readConfig 读时把顶层旧键映射进对应段（与 host 半同款规则）。
// client apply 默认全开，随后异步经 GET /md-render/api/config 拉取真实配置应用
// （client 端不能访问 ctx.config——Cordis inject 限制）；设置页保存后
// setRenderOptions 立即应用新开关，渲染管线读取模块级状态。
// 配置 API URL（`CONFIG_API_URL`）与引擎 URL（`MERMAID_ENGINE_URL`）由构建期
// 从 host 半 src/routes/paths.ts 注入（见 lib/client.src.js 的 __ROUTE_PATHS__ 占位符
// 与 scripts/build.mjs）—— 本文件不再各写一份字面量，避免两侧漂移。
/** 三段默认值（缺失 / 非法值一律回退到这里）。 */
const DEFAULT_RENDER_OPTIONS = {
    markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true },
    thinking: { defaultExpanded: true },
    mermaid: { injectPrompt: true, render: true },
};
/** 生效配置（模块级；渲染管线直接读，不订阅）。 */
let renderOptions = cloneDefaults();
function cloneDefaults() {
    return {
        markdown: { ...DEFAULT_RENDER_OPTIONS.markdown },
        thinking: { ...DEFAULT_RENDER_OPTIONS.thinking },
        mermaid: { ...DEFAULT_RENDER_OPTIONS.mermaid },
    };
}
/** 对象化（null / 数组 / 标量 → {}）。 */
function asObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
/** 取子对象（非对象 → {}）。 */
function sectionOf(raw, name) {
    return asObject(raw[name]);
}
/** 段内布尔键：新结构优先，旧扁平键兜底（旧键只在段内未显式给出该键时生效）。 */
function pickSection(current, nested, legacy, legacyKeys) {
    const out = { ...current };
    for (const key of Object.keys(current)) {
        const value = nested[key] !== undefined ? nested[key] : legacyKeys.includes(key) ? legacy[key] : undefined;
        if (typeof value === 'boolean')
            out[key] = value;
    }
    return out;
}
/** thinking.defaultExpanded：严格布尔（缺失 / 非布尔保持当前值）。 */
function pickThinking(current, raw) {
    const nested = sectionOf(raw, 'thinking');
    const value = nested.defaultExpanded !== undefined ? nested.defaultExpanded : raw.defaultExpanded;
    if (typeof value !== 'boolean')
        return { ...current };
    return { defaultExpanded: value };
}
/** 应用层配置 → 与**当前值**合并后的生效配置（局部更新语义：未给出的键不变）。 */
function readConfig(raw) {
    const obj = asObject(raw);
    return {
        markdown: pickSection(renderOptions.markdown, sectionOf(obj, 'markdown'), obj, [
            'copyButton',
            'textFenceMarkdown',
            'contextMarkdown',
        ]),
        thinking: pickThinking(renderOptions.thinking, obj),
        mermaid: pickSection(renderOptions.mermaid, sectionOf(obj, 'mermaid'), obj, ['injectPrompt']),
    };
}
/** 应用配置（局部合并；设置页保存后立即生效，不等 patch 热重载）。 */
function setRenderOptions(next) {
    renderOptions = readConfig(next);
}
/**
 * 异步从 server 端拉取配置并应用（初始化真实开关）。
 *
 * client 端 apply 不能访问 ctx.config（Cordis inject 限制：未 inject 声明的
 * property 访问抛 "cannot get property ... without inject"，导致插件 client 端
 * failed to apply loader entry）——真实配置经 server 端 GET /md-render/api/config
 * 获取（与设置页同一数据源）。拉取失败保持默认全开，不阻塞渲染能力。
 */
function initConfigFromServer() {
    if (typeof fetch !== 'function')
        return;
    fetch(CONFIG_API_URL)
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true || typeof body.value !== 'object' || body.value === null)
            return;
        setRenderOptions(body.value);
    })
        .catch(() => {
        // 服务不可用时保持默认（全部开启），不影响渲染。
    });
}
exports.CONFIG_API_URL = CONFIG_API_URL;
exports.setRenderOptions = setRenderOptions;
exports.readConfig = readConfig;
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
const markdownRoots = new Map();
/** 取出仍存活且与当前容器一致的 root。 */
function rootOf(container) {
    for (const [ref, root] of markdownRoots) {
        if (ref.deref() === container)
            return root;
    }
    return undefined;
}
/** 记下容器与 root 的对应（先清掉同一容器的旧条目，避免重复登记）。 */
function trackRoot(container, root) {
    forgetRoot(container);
    markdownRoots.set(new WeakRef(container), root);
}
/** 忘掉某容器的条目（不 unmount，调用方决定）。 */
function forgetRoot(container) {
    for (const [ref, _root] of markdownRoots) {
        if (ref.deref() === container)
            markdownRoots.delete(ref);
    }
}
/** 容器是否已脱离文档（`isConnected` 优先，缺失时退回 `parentNode` 判定）。 */
function isDetached(container) {
    if (typeof container.isConnected === 'boolean') {
        return container.isConnected === false;
    }
    const body = typeof document !== 'undefined' && document !== null ? document.body : null;
    if (body === null || body === undefined)
        return false;
    let node = container;
    while (node !== null && node !== undefined) {
        if (node === body)
            return false;
        node = node.parentNode ?? null;
    }
    return true;
}
/**
 * 清扫悬挂 root：容器已脱离文档（宿主重渲染把我们的节点抹掉 / 整个节点被替换）
 * 或已被 GC → unmount 并移除条目。每轮扫描开头调用一次（容器数量是「被接管的
 * 块数」，量级很小）。
 */
function sweepDetachedRoots() {
    for (const [ref, root] of markdownRoots) {
        const container = ref.deref();
        if (container === undefined) {
            markdownRoots.delete(ref);
            continue;
        }
        if (isDetached(container)) {
            markdownRoots.delete(ref);
            try {
                root.unmount();
            }
            catch (_e) {
                /* 卸载异常不阻断清扫 */
            }
        }
    }
}
/**
 * 把 markdown 原文渲染进容器（官方组件负责渲染，文本先过表格容错规范化）。
 * @returns 是否已渲染（官方组件不可用 → false，调用方保持宿主原样）。
 */
function renderMarkdownInto(container, text) {
    const platform = platformMarkdown();
    if (platform === null || platform.createRoot === null)
        return false;
    let root = rootOf(container);
    if (root === undefined) {
        root = platform.createRoot(container);
        trackRoot(container, root);
    }
    root.render(createElement(platform.MarkdownText, { text: normalizeTables(text), labels: MARKDOWN_LABELS }));
    return true;
}
/** 卸载容器上的 React root（容器内容被重建/清理前调用，避免悬挂 root）。 */
function unmountMarkdownIn(container) {
    const root = rootOf(container);
    if (root === undefined)
        return;
    forgetRoot(container);
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
exports.sweepDetachedRoots = sweepDetachedRoots;
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
/** 复制文本：clipboard API 优先，失败回退 execCommand；失败 reject。 */
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
exports.copyText = copyText;
exports.fallbackCopyText = fallbackCopyText;


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
    renderOptions.markdown.copyButton ? createElement(CopyButton, { kind: 'content' }) : null);
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
    if (!renderOptions.markdown.contextMarkdown)
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
// 语言与源码来源（只用官方 DOM 契约，**不读 React fiber 私有属性**）：块是
// div.md-code-block；语言取 code.language-xxx（官方空围栏分支与旧契约 DOM）→
// banner（data-code-block-banner）首个子元素文本（CodeBlock 用它显示 infostring）。
// 两者都取不到就不接管 —— 保持官方代码块形态（绝不猜语言）。
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
/** 块的围栏语言（code.language-* → banner infostring；非 text/plaintext/txt 的 → 空串）。
 *
 *  **不读 React fiber 私有属性**（__reactFiber$ / memoizedProps）：那是 React 内部实现，
 *  宿主升级即静默失效。只用官方 DOM 契约的降级链 —— 官方空围栏分支的
 *  code.language-xxx 与 CodeBlock banner 的 infostring。两者都取不到就不接管
 *  （保持官方代码块形态），绝不猜语言。 */
function textFenceLang(block) {
    const candidates = [textFenceClassLang(block), textFenceBannerLang(block)];
    const lang = candidates.find((value) => TEXT_FENCE_LANGS.includes(value)) ?? '';
    return { lang };
}
/** 块源码：官方 <pre> 的文本（官方 display 语义：去掉一个尾部换行）。 */
function textFenceSource(block) {
    const pre = block.querySelector('pre');
    const text = pre !== null ? (pre.textContent ?? '') : '';
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}
/** 取块的源码与签名素材（非目标语言 / 空内容 / 超长 → null）。 */
function textFenceBody(block) {
    const { lang } = textFenceLang(block);
    if (lang === '')
        return null;
    const text = textFenceSource(block);
    if (!text.trim() || text.length > MAX_TEXT_FENCE_CHARS)
        return null;
    return { lang, text };
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner 同一口径）。
 *  名字带 TextFence 前缀：本文件与 mermaid-scan 片段共享 factory 作用域，重名会互相覆盖。 */
function isTextFenceStreaming(block) {
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
    if (!renderOptions.markdown.textFenceMarkdown)
        return;
    if (!officialMarkdownAvailable())
        return;
    if (isTextFenceStreaming(block))
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


    // ── 思考块默认展开（对官方折叠行派发一次 click；不改外观）────────
    "use strict";
// ── 思考块默认展开（DOM 层派发官方点击，路径 C）─────────────────────────
// 官方没有任何「思考默认展开」的设置或扩展点：
//  - 折叠态摘要不是 markdown，展开内容才是（官方 ReasoningRow 内部已用
//    MarkdownText variant="compact" 渲染 —— 思考 markdown 渲染**官方默认已具备**）；
//  - 折叠时内容**不在 DOM**（DisclosureRow 的 {open && children}）→ 设属性
//    （data-expanded / details.open）只能得到空的 24px 行，永远看不到内容；
//  - 唯一不接管节点、不改样式的手段是**对官方折叠行派发一次真实 click**，
//    让官方自己的 React 状态机切到展开态（外观 / DOM 结构 / 动画 / a11y 全走官方）。
//
// 硬约束遵守：
//  - 不注册任何 conversation.chat.node 节点级 seat（尤其 assistant-step）；
//  - 不写官方元素的 style / class / aria（本模块只调用 `row.click()`）；
//  - **契约守卫 + 静默降级**：选择器失配（官方改属性名 / 改结构）→ 退回官方默认，
//    不抛错、不写任何 DOM、不影响其它渲染能力；
//  - **性能护栏**：只在新增节点内定位 think 容器（`matchesThinkRoot` 短路），
//    避免每批都对全文档跑属性选择器；`WeakSet` 保证每个元素**一次性动作**
//    （幂等：用户手动折叠后我们永不再碰它；observer 自激也会被集合挡住）。
/** 官方思考行定位选择器（只用官方自身属性，不新增任何 class / style）。 */
const THINK_ROW_SELECTOR = '[data-variant="think"] [data-disclosure-row][aria-expanded]';
/** 官方思考容器选择器（性能护栏：先短路，再在容器内查行）。 */
const THINK_ROOT_SELECTOR = '[data-variant="think"]';
/** 单次扫描处理的行数上限（性能护栏：一次批次最多派发这么多次 click）。 */
const MAX_THINK_ROWS_PER_SCAN = 200;
/** 已由本模块处理过的行（一次性动作；WeakSet 不阻止 GC）。 */
const handledThinkRows = new WeakSet();
/** 元素是否为思考容器，或包含思考容器（性能护栏短路条件）。 */
function hasThinkRoot(el) {
    if (typeof el.matches !== 'function')
        return false;
    try {
        return el.matches(THINK_ROOT_SELECTOR) || el.querySelector(THINK_ROOT_SELECTOR) !== null;
    }
    catch (_e) {
        return false;
    }
}
/** 在 root 内枚举思考行（契约守卫：任何 DOM 异常都静默返回空数组）。 */
function thinkRowsIn(root) {
    try {
        const out = [];
        if (typeof root.matches === 'function' && root.matches(THINK_ROW_SELECTOR))
            out.push(root);
        const found = root.querySelectorAll(THINK_ROW_SELECTOR);
        for (let i = 0; i < found.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1)
            out.push(found[i]);
        return out;
    }
    catch (_e) {
        return [];
    }
}
/** 派发一次官方点击（契约守卫：抛错即静默放弃，绝不影响其它渲染）。 */
function expandThinkRow(row) {
    try {
        const click = row.click;
        if (typeof click !== 'function')
            return;
        click.call(row);
    }
    catch (_e) {
        /* 官方契约变化 → 静默降级为官方默认（折叠） */
    }
}
/**
 * 扫描 root（自身 / 后代）内的官方思考行：新见到的、仍折叠的行派发一次 click。
 * 开关关闭 / 已处理过 / 已展开 / 契约失配 → 一律不动（完全保持官方默认）。
 */
function applyThinkExpand(root) {
    if (!renderOptions.thinking.defaultExpanded)
        return;
    if (!hasThinkRoot(root))
        return;
    for (const row of thinkRowsIn(root)) {
        if (handledThinkRows.has(row))
            continue;
        handledThinkRows.add(row);
        // 已展开（用户手动展开 / 官方默认展开）→ 不碰；只对 aria-expanded="false" 动作。
        if (row.getAttribute('aria-expanded') !== 'false')
            continue;
        expandThinkRow(row);
    }
}
exports.THINK_ROW_SELECTOR = THINK_ROW_SELECTOR;
exports.applyThinkExpand = applyThinkExpand;


    // ── mermaid 引擎按需加载 + 离屏渲染 ────────────────────────────
    "use strict";
// ── mermaid 引擎：按需加载 + 离屏渲染 ─────────────────────────────────
// 引擎由 DSH webServer 从插件 assets 目录静态托管（**不内联**进 bundle：issue #185
// 的 4.48 MB base64 冗余教训），首次渲染时 fetch 并按需注入 <script>，不阻塞启动。
// 构建期 scripts/build.mjs 校验 assets/mermaid-10.9.3.min.js 的 SHA256 与 UMD 形态。
// 降级路径：fetch 失败 → 回退检查 window.mermaid 是否已由外部加载；仍失败 → 卡片
// 显示错误原因 + **原始源码**（绝不静默丢内容）。
// MERMAID_ENGINE_URL 由构建期从 host 半 src/routes/paths.ts 注入（单一真源）。
/** 超长块跳过（与 mermaid 自身 maxTextSize 5e4 对齐，不做无谓渲染）。 */
const MAX_SOURCE_CHARS = 50000;
/**
 * 引擎初始化配置。`suppressErrorRendering` 是 mermaid v11+ 的开关：本插件 vendored 的
 * 是 **10.9.3**，实测该版本不认识这个键（传进去被静默接收但不生效，渲染失败时仍会往
 * 容器里插错误图形）。这里依然显式传：升级引擎后自动多一层保险；真正的兜底是离屏渲染。
 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true };
let mermaidReady = null;
/** 清掉加载缓存（卡片「重试」必须能真的重新加载一次）。 */
function resetMermaidEngine() {
    mermaidReady = null;
}
/** 初始化引擎；重复 initialize 抛错时忽略（配置已经在）。 */
function initEngine(engine) {
    try {
        engine.initialize(MERMAID_INIT);
    }
    catch (_e) {
        /* already initialized */
    }
    return engine;
}
/** 注入引擎脚本并解析 window.mermaid（注入失败 / 注入后仍缺失 → reject）。 */
function injectEngine(code) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.textContent = code;
        script.onerror = () => reject(new Error('mermaid engine script injection failed'));
        document.head.appendChild(script);
        const m = typeof window !== 'undefined' ? window.mermaid : undefined;
        if (!m) {
            reject(new Error('mermaid engine missing after injection'));
            return;
        }
        resolve(initEngine(m));
    });
}
/** 加载（或复用）mermaid 引擎：首次从 assets fetch。 */
function ensureMermaid() {
    const globalEngine = typeof window !== 'undefined' ? window.mermaid : undefined;
    if (globalEngine)
        return Promise.resolve(initEngine(globalEngine));
    if (mermaidReady !== null)
        return mermaidReady;
    mermaidReady = loadEngine().catch((err) => {
        resetMermaidEngine();
        throw err instanceof Error ? err : new Error(String(err));
    });
    return mermaidReady;
}
/** fetch 引擎 UMD 并注入（无 document / fetch 失败 / 注入失败都 reject）。 */
function loadEngine() {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
        return Promise.reject(new Error('no document to inject mermaid'));
    }
    return fetch(MERMAID_ENGINE_URL)
        .then((resp) => {
        if (!resp.ok)
            throw new Error(`mermaid engine fetch failed: ${resp.status}`);
        return resp.text();
    })
        .then((code) => injectEngine(code));
}
/** 离屏渲染容器标记（回归测试据此断言渲染发生在脱离文档流的节点里）。 */
const OFFSCREEN_ATTR = 'data-dsh-mermaid-render-offscreen';
/** 创建离屏渲染容器：脱离文档流并移出视口，但仍在布局树内
 *  （display:none / visibility:hidden 会让 mermaid 量不到节点尺寸）。 */
function createOffscreenHost(entryId) {
    const host = document.createElement('div');
    host.setAttribute(OFFSCREEN_ATTR, entryId);
    host.setAttribute('aria-hidden', 'true');
    host.className = 'dsh-md-render-offscreen';
    return host;
}
/** 丢弃离屏容器及其内部一切（失败时 mermaid 的错误图形就在里面）。 */
function dropOffscreen(host) {
    if (host.parentNode)
        host.parentNode.removeChild(host);
}
/**
 * 渲染 mermaid 源码为 SVG 字符串。
 *
 * 为什么必须离屏：mermaid 10.9.3 解析/渲染失败时**自己**往渲染容器里插一张「炸弹图」
 * （#d<id> + .error-icon / .error-text，文案 "Syntax error in text"），而
 * `suppressErrorRendering` 在该版本无效。把渲染导向一个脱离文档流的容器后，失败图形
 * 只落在容器里、随容器一起被移除 —— 页面永远看不到它；成功则只取返回的 svg 字符串。
 */
function renderSvg(engine, entryId, source) {
    const body = typeof document !== 'undefined' && document !== null ? document.body : null;
    if (body === null || body === undefined)
        return Promise.reject(new Error('no document body to render into'));
    const host = createOffscreenHost(entryId);
    body.appendChild(host);
    return engine.render(entryId, source, host).then((out) => {
        const svg = out && typeof out.svg === 'string' ? out.svg : '';
        dropOffscreen(host);
        if (!svg)
            throw new Error('mermaid 未返回 SVG');
        return svg;
    }, (err) => {
        dropOffscreen(host);
        throw err instanceof Error ? err : new Error(String(err));
    });
}
/** 错误对象转可读文本（卡片提示条用）。 */
function errMsg(err) {
    return err instanceof Error && err.message ? err.message : String(err);
}
exports.MERMAID_ENGINE_URL = MERMAID_ENGINE_URL;
exports.MAX_SOURCE_CHARS = MAX_SOURCE_CHARS;
exports.OFFSCREEN_ATTR = OFFSCREEN_ATTR;
exports.ensureMermaid = ensureMermaid;
exports.resetMermaidEngine = resetMermaidEngine;
exports.renderSvg = renderSvg;
exports.errMsg = errMsg;


    // ── mermaid 图表卡片（预览 / 代码切换、导出、失败回显源码）──────
    "use strict";
// ── mermaid 图表卡片（React）──────────────────────────────────────────
// 卡片只挂在**本插件自己插入的容器**里（不改官方节点结构）：mermaid 块内的官方
// `<pre>` 由**自有 CSS**（styles.ts 的 `.md-code-block[data-dsh-md-render-mermaid-view]`
// 规则）隐藏 —— 不再用 `pre.style.display`（硬约束：不对官方元素写 style）。
// 渲染失败时卡片显示错误原因 + 重试 + **原始源码**（源码必须看得见）。
/** 卡片 host 标记（entryId；测试与导出按它定位）。 */
const MERMAID_ENTRY_ATTR = 'data-dsh-md-render-mermaid';
/** 渲染态标记（loading / ok / error；写在 host 上，与 React 提交时机解耦）。 */
const MERMAID_STATE_ATTR = 'data-dsh-md-render-mermaid-state';
/** 块级视图标记（preview / code；写在 md-code-block 上，驱动自有 CSS 隐藏官方 pre）。 */
const MERMAID_VIEW_ATTR = 'data-dsh-md-render-mermaid-view';
/** 挂载序号（entryId 用；导出文件名取其中的数字）。 */
let mermaidSeq = 0;
/** 记录一条渲染态转移：写到卡片 host 的真实 DOM 属性上（宿主 / CSS / 测试可观察）。 */
function noteRenderState(entryId, state) {
    if (typeof document === 'undefined' || document === null)
        return;
    const host = document.querySelector('[' + MERMAID_ENTRY_ATTR + '="' + entryId + '"]');
    if (host && typeof host.setAttribute === 'function')
        host.setAttribute(MERMAID_STATE_ATTR, state);
}
/**
 * 渲染状态机：加载引擎 → **离屏渲染** → 成功取 SVG / 失败留原因。
 * 渲染令牌：effect 每次运行（含重试）先作废旧令牌再挂新令牌，异步结果落定时令牌已废
 * 就丢弃 —— 引擎加载有缓存层且是慢操作，只靠 cancelled 标志挡不住迟到落定。
 */
function useMermaidRender(entryId, source, attempt) {
    const [status, setStatus] = useState('loading');
    const [svg, setSvg] = useState(null);
    const [error, setError] = useState(null);
    const [tokens] = useState(() => new Map());
    useEffect(() => {
        const token = {};
        tokens.set(entryId, token);
        const current = () => tokens.get(entryId) === token;
        setStatus('loading');
        noteRenderState(entryId, 'loading');
        ensureMermaid()
            .then((m) => renderSvg(m, entryId, source))
            .then((svgText) => {
            if (!current())
                return;
            setSvg(svgText);
            setError(null);
            setStatus('ok');
            noteRenderState(entryId, 'ok');
        })
            .catch((err) => {
            if (!current())
                return;
            setError(errMsg(err));
            setStatus('error');
            noteRenderState(entryId, 'error');
        });
        return () => {
            if (tokens.get(entryId) === token)
                tokens.delete(entryId);
        };
    }, [entryId, source, attempt, tokens]);
    /** 立刻回到 loading（重试时先重置视图、并作废在飞的一轮，不等 effect 跑完）。 */
    function begin() {
        tokens.delete(entryId);
        setError(null);
        setStatus('loading');
        noteRenderState(entryId, 'loading');
    }
    return { status, svg, error, begin };
}
/** 导出结果提示条（成功/失败），无提示时返回 null。 */
function renderNotice(notice) {
    if (!notice)
        return null;
    return createElement('div', { className: 'dsh-md-render-mermaid-notice dsh-md-render-mermaid-notice-' + notice.type }, notice.text);
}
/** 导出按钮组：下载 PNG / 下载 SVG / 复制代码。 */
function ExportButtons({ status, onPng, onSvg, onCopy, }) {
    const ready = status === 'ok';
    const btn = (label, iconNode, onClick, disabled) => createElement('button', { type: 'button', className: 'dsh-md-render-mermaid-eb', onClick, disabled, title: label, 'aria-label': label }, iconNode, createElement('span', null, label));
    return createElement('div', { className: 'dsh-md-render-mermaid-export', role: 'group', 'aria-label': 'export' }, btn('下载 PNG', icon.download(14), onPng, !ready), btn('下载 SVG', icon.download(14), onSvg, !ready), btn('复制代码', icon.copy(14), onCopy, false));
}
/** 预览 / 代码 视图切换（卡片头部）。 */
function ViewToggle({ mode, setMode }) {
    const btn = (label, value, iconNode) => createElement('button', {
        type: 'button',
        className: mode === value ? 'dsh-md-render-mermaid-vt dsh-md-render-mermaid-vt-active' : 'dsh-md-render-mermaid-vt',
        onClick: () => setMode(value),
        'aria-pressed': mode === value,
    }, iconNode, createElement('span', null, label));
    return createElement('div', { className: 'dsh-md-render-mermaid-view-toggle', role: 'group', 'aria-label': 'view mode' }, btn('预览', 'preview', icon.file(14)), btn('代码', 'code', icon.code(14)));
}
/** 卡片主体：loading / error（含源码与重试）/ 代码视图 / 渲染出的 SVG。 */
function CardBody({ status, mode, error, source, svg, onRetry, }) {
    if (status === 'loading') {
        return createElement('div', { className: 'dsh-md-render-mermaid-loading' }, icon.refresh(14), createElement('span', null, '渲染中…'));
    }
    if (status === 'error') {
        return createElement('div', { className: 'dsh-md-render-mermaid-error' }, createElement('div', { className: 'dsh-md-render-mermaid-error-head' }, icon.alert(15), createElement('span', { className: 'dsh-md-render-mermaid-error-title' }, 'Mermaid 渲染失败'), createElement('button', {
            type: 'button',
            className: 'dsh-md-render-mermaid-eb dsh-md-render-mermaid-retry',
            onClick: onRetry,
            title: '重试渲染',
            'aria-label': '重试',
        }, icon.refresh(13), createElement('span', null, '重试'))), createElement('div', { className: 'dsh-md-render-mermaid-error-msg' }, error), createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source));
    }
    if (mode === 'code' || !svg)
        return createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source);
    return createElement('div', { className: 'dsh-md-render-mermaid-svg', dangerouslySetInnerHTML: { __html: svg } });
}
/** Mermaid 图表卡片组件。 */
function MermaidCard({ entryId, source }) {
    const [attempt, setAttempt] = useState(0);
    const [mode, setMode] = useState('preview');
    const [notice, setNotice] = useState(null);
    const { status, svg, error, begin } = useMermaidRender(entryId, source, attempt);
    /** 重试：先清引擎加载缓存（上次可能就失败在加载），再重跑渲染。 */
    function retry() {
        resetMermaidEngine();
        begin();
        setAttempt((n) => n + 1);
    }
    /** 短暂提示（成功/失败），2.5s 后自动消失。 */
    function flashNotice(type, text) {
        setNotice({ type: type, text });
        if (noticeTimer)
            clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => setNotice(null), 2500);
    }
    const exportActions = makeExportHandlers(entryId, source, flashNotice);
    return createElement('div', { className: 'dsh-md-render-mermaid-card' }, createElement('div', { className: 'dsh-md-render-mermaid-card-head' }, createElement('div', { className: 'dsh-md-render-mermaid-card-title' }, icon.file(12), createElement('span', null, 'Mermaid 图表')), createElement('div', { className: 'dsh-md-render-mermaid-card-actions' }, createElement(ExportButtons, { status, ...exportActions }), createElement(ViewToggle, { mode, setMode }))), renderNotice(notice), createElement(CardBody, { status, mode, error, source, svg, onRetry: retry }));
}
/** 提示条定时器（模块级单例：后一条提示覆盖前一条）。 */
let noticeTimer = null;
exports.MERMAID_ENTRY_ATTR = MERMAID_ENTRY_ATTR;
exports.MERMAID_STATE_ATTR = MERMAID_STATE_ATTR;
exports.MERMAID_VIEW_ATTR = MERMAID_VIEW_ATTR;
exports.noteRenderState = noteRenderState;
exports.MermaidCard = MermaidCard;


    // ── mermaid 代码块识别 + 流式稳定窗口 ──────────────────────────
    "use strict";
// ── mermaid 代码块识别 + 流式稳定窗口 + 卡片挂载 ──────────────────────
// 只在 `[data-conversation-scroll]` 内识别 `div.md-code-block` 且语言标记为
// mermaid / mmd 的块（官方不接管这类块 —— 全仓 grep `mermaid` 于宿主 packages
// 为 0 命中，官方没有任何 fence 渲染器注册 API，所以这是本插件的真增量）。
//
// 挂载策略（不改官方节点结构）：
//  - 卡片 host 追加在块内（appendChild，**不动**块的子结构）；
//  - 官方 `<pre>` 的隐藏**全部交给自有 CSS**（styles.ts 的
//    `.md-code-block[data-dsh-md-render-mermaid-view]` 规则），本模块只写自己的
//    data-* 标记 —— 硬约束：不对官方元素写 style / class / aria。
//
// 流式口径：宿主在**整条消息**上挂 `data-streaming`，DOM 里看不到「结束围栏是否
// 已出现」，只能从内容是否还在增长来判定闭合（STREAM_SETTLE_MS + 连续观察次数）。
// 误判有第二道防线：源码再变即自愈卸载重来（绝不留残缺卡片）。
/** 流式块稳定窗口（毫秒）。取自真机实测的流式更新间隔（约 240ms/次）之上——
 *  比它小会把 token 间隔误判成「已闭合」。 */
const STREAM_SETTLE_MS = 400;
/** 连续观察次数（首次发现算 1 次；窗口到期再确认 1 次才允许渲染）。 */
const STREAM_MIN_OBSERVATIONS = 2;
const mermaidMounts = new Map();
const mermaidStreamWatch = new Map();
/** 检查是否为 mermaid 代码块（code.language-mermaid / -mmd；不读 React fiber）。 */
function isMermaidBlock(block) {
    try {
        const code = block.querySelector('code');
        if (!code)
            return false;
        const cls = String(code.className || '').toLowerCase();
        return cls.includes('language-mermaid') || cls.includes('language-mmd');
    }
    catch (_e) {
        return false;
    }
}
/** 提取代码块源码（官方 CodeBlock 的 <pre> 文本）。 */
function mermaidSourceOf(block) {
    try {
        const pre = block.querySelector('pre');
        return pre ? pre.textContent || '' : '';
    }
    catch (_e) {
        return '';
    }
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isMermaidStreaming(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/** 清掉某块的稳定观察（挂载 / 卸载 / 元素已失效时）。 */
function clearStreamWatch(block) {
    const watch = mermaidStreamWatch.get(block);
    if (watch !== undefined && watch.timer !== null)
        clearTimeout(watch.timer);
    mermaidStreamWatch.delete(block);
}
/** 把卡片挂进块内（entryId 写在 host 上；状态属性由卡片状态机更新）。 */
function mountCard(block, source) {
    if (mermaidMounts.has(block))
        return;
    const host = document.createElement('div');
    host.className = 'dsh-md-render-mermaid-host';
    block.appendChild(host);
    const root = require('react-dom/client').createRoot(host);
    const entryId = 'dsh-md-render-mermaid-' + ++mermaidSeq;
    mermaidMounts.set(block, { root, host, text: source });
    clearStreamWatch(block);
    // 视图标记写在块上：自有 CSS 据此隐藏官方 <pre>（不改官方元素的 style/class）。
    block.setAttribute(MERMAID_VIEW_ATTR, 'preview');
    host.setAttribute(MERMAID_ENTRY_ATTR, entryId);
    host.setAttribute(MERMAID_STATE_ATTR, 'loading');
    root.render(createElement(MermaidCard, { entryId, source }));
}
/** 自愈卸载：源码在挂载后又变了（流式其实还没写完）→ 拆卡片、恢复原始块。 */
function unmountCard(block, card) {
    mermaidMounts.delete(block);
    clearStreamWatch(block);
    try {
        card.root.unmount();
    }
    catch (_e) {
        /* 卸载异常不阻断恢复原始块 */
    }
    if (card.host.parentNode)
        card.host.parentNode.removeChild(card.host);
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute(MERMAID_VIEW_ATTR);
}
/** 记录一次观察：内容变了就重新计时，没变就累计观察次数。 */
function watchStream(block, source, round) {
    const prev = mermaidStreamWatch.get(block);
    if (prev === undefined || prev.text !== source) {
        if (prev !== undefined && prev.timer !== null)
            clearTimeout(prev.timer);
        const watch = { text: source, observations: 1, round, timer: null };
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        mermaidStreamWatch.set(block, watch);
        return;
    }
    if (prev.round !== round) {
        prev.round = round;
        prev.observations += 1;
    }
}
/** 稳定窗口到期：内容仍与观察一致、且已连续观察够次数才渲染。 */
function settleStream(block) {
    const watch = mermaidStreamWatch.get(block);
    if (watch === undefined)
        return;
    watch.timer = null;
    if (typeof block.isConnected === 'boolean' && !block.isConnected) {
        mermaidStreamWatch.delete(block);
        return;
    }
    const source = mermaidSourceOf(block);
    if (source !== watch.text || !source.trim())
        return;
    if (mermaidMounts.has(block))
        return;
    watch.observations += 1;
    if (watch.observations < STREAM_MIN_OBSERVATIONS) {
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        return;
    }
    mountCard(block, source);
}
/** 单个候选块：挂载 / 继续等待 / 自愈卸载。非 mermaid 块立即返回（性能护栏）。 */
function considerMermaidBlock(block, round) {
    if (!isMermaidBlock(block))
        return;
    if (!renderOptions.mermaid.render)
        return;
    const source = mermaidSourceOf(block);
    if (!source.trim() || source.length > MAX_SOURCE_CHARS)
        return;
    const mounted = mermaidMounts.get(block);
    if (mounted !== undefined) {
        if (mounted.text === source)
            return;
        unmountCard(block, mounted); // 源码还在变：拆掉重来，绝不留残缺卡片
    }
    if (!isMermaidStreaming(block)) {
        mountCard(block, source); // 历史消息 / 流式已结束：立即渲染（不回归）
        return;
    }
    watchStream(block, source, round);
}
/** 扫描 root（自身 / 后代）内的会话滚动容器里的 mermaid 代码块。 */
function scanMermaidBlocks(root, round) {
    const scrolls = [];
    if (root.matches && root.matches('[data-conversation-scroll]'))
        scrolls.push(root);
    if (root.querySelectorAll) {
        for (const sc of root.querySelectorAll('[data-conversation-scroll]'))
            scrolls.push(sc);
    }
    for (const sc of scrolls) {
        for (const block of sc.querySelectorAll('div.md-code-block'))
            considerMermaidBlock(block, round);
    }
}
/** teardown：清掉全部观察与挂载记录（observer 断连由共享骨架负责）。 */
function teardownMermaid() {
    for (const block of Array.from(mermaidStreamWatch.keys()))
        clearStreamWatch(block);
    mermaidMounts.clear();
}
exports.STREAM_SETTLE_MS = STREAM_SETTLE_MS;
exports.isMermaidBlock = isMermaidBlock;
exports.mermaidSourceOf = mermaidSourceOf;
exports.considerMermaidBlock = considerMermaidBlock;
exports.scanMermaidBlocks = scanMermaidBlocks;
exports.teardownMermaid = teardownMermaid;


    // ── mermaid 图表导出（PNG / SVG 下载 + 复制源码）────────────────
    "use strict";
// ── mermaid 图表导出：PNG / SVG 下载 + 复制源码 ────────────────────────
// 失败一律经卡片提示条转可见提示，绝不静默（与合并前的 dsh-mermaid-render 同款行为）。
// 复制实现复用 copy.ts 的 copyText（同一 factory 作用域），不重复一份。
/** 默认文件名：mermaid-<序号>.<ext>（序号取自 entryId，如 dsh-md-render-mermaid-3 → 3）。 */
function buildExportFileName(entryId, ext) {
    const m = /(\d+)/.exec(String(entryId || ''));
    return 'mermaid-' + (m ? m[1] : '1') + '.' + ext;
}
/** 序列化 SVG DOM 为字符串；缺 xmlns 时补上（Image 加载 SVG 必需）。 */
function serializeSvg(svgEl) {
    const xml = new XMLSerializer().serializeToString(svgEl);
    return xml.includes('xmlns') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}
/** 触发浏览器下载：Blob → 临时 a[download] → click → 延迟 revoke URL。 */
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** 下载 SVG：序列化 → Blob(image/svg+xml) → 下载。 */
function downloadSvgFile(svgEl, fileName) {
    const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, fileName);
}
/** canvas → PNG blob → 下载（load 回调内，失败 reject）。 */
function encodePng(img, url, fileName, resolve, reject) {
    try {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('canvas 2d 上下文不可用');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(url);
            if (!pngBlob) {
                reject(new Error('PNG 编码失败'));
                return;
            }
            downloadBlob(pngBlob, fileName);
            resolve();
        }, 'image/png');
    }
    catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
    }
}
/** 下载 PNG：SVG → Image → canvas(2x) → toBlob → 下载；失败 reject。 */
function downloadPngFile(svgEl, fileName) {
    return new Promise((resolve, reject) => {
        let url = '';
        try {
            const blob = new Blob([serializeSvg(svgEl)], { type: 'image/svg+xml;charset=utf-8' });
            url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => encodePng(img, url, fileName, resolve, reject);
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('SVG 图片加载失败'));
            };
            img.src = url;
        }
        catch (err) {
            URL.revokeObjectURL(url);
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
/** 从卡片 DOM 取渲染出的 SVG 元素（按 entryId 定位，避免多卡片串扰）。 */
function findCardSvg(entryId) {
    if (typeof document === 'undefined' || document === null)
        return null;
    const host = document.querySelector('[data-dsh-md-render-mermaid="' + entryId + '"]');
    if (!host || !host.querySelector)
        return null;
    return host.querySelector('svg');
}
/** 组装卡片导出 handler：返回 { onPng, onSvg, onCopy }。 */
function makeExportHandlers(entryId, source, flashNotice) {
    return {
        onPng: () => {
            const svgEl = findCardSvg(entryId);
            if (!svgEl) {
                flashNotice('error', '图表尚未渲染完成，无法导出 PNG');
                return;
            }
            downloadPngFile(svgEl, buildExportFileName(entryId, 'png'))
                .then(() => flashNotice('ok', 'PNG 已下载'))
                .catch((err) => flashNotice('error', 'PNG 导出失败：' + errMsg(err)));
        },
        onSvg: () => {
            const svgEl = findCardSvg(entryId);
            if (!svgEl) {
                flashNotice('error', '图表尚未渲染完成，无法导出 SVG');
                return;
            }
            try {
                downloadSvgFile(svgEl, buildExportFileName(entryId, 'svg'));
                flashNotice('ok', 'SVG 已下载');
            }
            catch (err) {
                flashNotice('error', 'SVG 导出失败：' + errMsg(err));
            }
        },
        onCopy: () => {
            copyText(source)
                .then(() => flashNotice('ok', '源码已复制'))
                .catch((err) => flashNotice('error', '复制失败：' + errMsg(err)));
        },
    };
}
exports.buildExportFileName = buildExportFileName;
exports.serializeSvg = serializeSvg;
exports.findCardSvg = findCardSvg;
exports.makeExportHandlers = makeExportHandlers;


    // ── 共享 DOM 扫描骨架 + 单 MutationObserver 按语言分流 ──────────
    // ── shared DOM scanner skeleton (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：渲染类插件各自的 MutationObserver 骨架结构等价，收口到这里。
// 当前唯一消费者是 dsh-md-render（parts/scanner.ts：思考行 / 上下文块 / text 围栏 /
// mermaid 卡片分流；原 dsh-think-zh-expand、dsh-mermaid-render 已合并进它）。
//
// 共享的只是**骨架**：观察 body、把新增元素与兜底重扫目标交给插件的 scan 回调、
// 维护批次轮次、返回 disposer。各插件的特有策略全部留在 scan 回调里（本 issue
// 的一条硬约束：共享化不得削掉 #185/#195/#196/#205 的任何行为）：
//  - dsh-md-render：流式内容门控（[data-streaming] 祖先跳过）、幂等签名 / WeakSet、
//    上下文注入块与 text 围栏块接管、宿主契约不匹配时的静默降级、mermaid 卡片挂载
//    （围栏闭合判定 settleStream / 离屏渲染 / 自愈卸载），以及 teardown 时清理挂载表
//    与流式观察表（经 onTeardown 注入）。
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
// ── 扫描器：**单一** MutationObserver，按语言分流 ────────────────────────
// 合并前 dsh-md-render 与 dsh-mermaid-render 各装一个 MutationObserver（同一条 body
// 被两路观察）；合并后收敛为**一个**（issue #463 决策 2），扫描顺序固定：
//
//   1. 思考行（think）—— 只看新增节点内的官方折叠行，最轻；
//   2. 上下文注入块（pre[data-context-text]）；
//   3. text / plaintext / txt 围栏块；
//   4. mermaid / mmd 围栏块 —— 必须最后（它会给块写视图标记，与 3 的判定互斥，
//      语言集合不重叠；放最后保证「先按语言分流、再决定接管者」的顺序稳定）。
//
// 各注入点自身幂等（签名 / WeakSet / mounts Map），scanner 只负责枚举与调用。
/** 扫描单个节点（含自身）内的全部注入点。 */
function scanNode(node, round) {
    if (!node || typeof node.querySelectorAll !== 'function')
        return;
    // 悬挂 root 清扫：宿主重渲染把我们的容器抹掉时，对应的 React root 必须卸载
    // （否则 root + fiber 树一直活着）。放在最前，先释放再重建。
    sweepDetachedRoots();
    const el = node;
    applyThinkExpand(el);
    if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR))
        applyContextMarkdown(el);
    scanContextBlocks(el);
    scanTextBlocks(el);
    scanMermaidBlocks(el, round);
}
/** 观察 body；返回观察器 disposer（骨架负责观察配置 / 批次轮次 / disposer）。 */
function installScanner() {
    return installDomScanner({
        scan: (node, round) => scanNode(node, round),
        // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
        rescanSelectors: ['[data-conversation-scroll]'],
        onTeardown: () => teardownMermaid(),
    });
}
exports.installScanner = installScanner;


    // ── 样式（DSH 语义 token，随 activation 注入）──────────────────
    "use strict";
// ── 样式（DSH 语义 token，随 activation 注入）──────────────────────────
// 只写**本插件自有 DOM** 的样式 + **自有 data-* 标记**作用域下的显隐规则：
//  - .tzx-md / 注入容器 / 「查看原文」按钮 / 整段复制按钮（md-render 原有）；
//  - mermaid 卡片全套（dsh-md-render-mermaid-*）+ 块级视图标记驱动的官方 <pre>
//    隐藏规则（**不用** el.style：硬约束「不对官方元素写 style / class / aria」）；
//  - 离屏渲染容器（原实现用 host.style.cssText，改为类选择器）。
// 不覆盖任何官方类名的外观；表格 / 公式 / 代码块高亮样式全部随官方组件自带。
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
`;


    // ── 共享样式注入 / 图标集（dsh-shared/client-parts）─────────────
    // ── shared plugin stylesheet injection (dsh-shared/client-parts) ──
// 单一来源（issue #186 P2）：把「注入 <style data-<plugin>="styles"> 并随 fiber
// teardown 卸载」这段逐字相同的样板从渲染插件收口到这里。当前调用方：dsh-md-render
// （parts/apply.ts；原 dsh-think-zh-expand、dsh-mermaid-render 已合并进它）——
// 各调用方 scripts/build.mjs 在构建期把本
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


    // ── 设置页：文案 / 样式（i18n）+ 三分组视图 + tab 注册（单 tab）──
    "use strict";
// ── 设置页文案（i18n）+ 样式 ───────────────────────────────────────────
// 语言来源两级（都是浏览器全局）：宿主 locale（dsh-client-locale 把当前 UI 语言同步到
// <html lang>）优先，其次 navigator.language。只看 navigator.language 会停在浏览器
// 语言、与宿主 UI 语言不一致（浏览器英文 + 宿主中文时最明显）。
// 文案全部是**惰性函数**：宿主切语言后重渲染即取到新语言，写成常量就跟不上。
// 函数名带 mdRender 前缀：本文件是 part 片段，与其它片段共享 factory 作用域。
/** 宿主当前 UI 语言（读不到 / 未同步时返回空串）。 */
function mdRenderHostLang() {
    try {
        const lang = document.documentElement.lang;
        return typeof lang === 'string' ? lang : '';
    }
    catch (_e) {
        return '';
    }
}
/** 浏览器语言（宿主 locale 不可用时的回退）。 */
function mdRenderBrowserLang() {
    try {
        return (navigator.language || 'en').toLowerCase();
    }
    catch (_e) {
        return 'en';
    }
}
/** 当前是否中文：宿主 <html lang> 优先，其次浏览器语言，再其次英文。 */
function mdRenderIsZh() {
    const host = mdRenderHostLang().toLowerCase();
    if (host.startsWith('zh'))
        return true;
    if (host.startsWith('en'))
        return false;
    return mdRenderBrowserLang().startsWith('zh');
}
/** 中英二选一（惰性求值）。 */
function mdRenderText(zh, en) {
    return () => (mdRenderIsZh() ? zh : en);
}
/** 设置页文案表（全部惰性）。 */
const MD_RENDER_STRINGS = {
    tab: mdRenderText('渲染', 'Rendering'),
    groupMarkdown: mdRenderText('Markdown 增强', 'Markdown enhancements'),
    groupThinking: mdRenderText('思考块', 'Thinking'),
    groupMermaid: mdRenderText('Mermaid 图表', 'Mermaid diagrams'),
    copyButtonLabel: mdRenderText('整段复制', 'Copy whole message'),
    copyButtonHint: mdRenderText('MarkdownView 整段内容一键复制（官方只有代码块复制）', 'One-click copy for the whole MarkdownView (the host only copies code blocks)'),
    textFenceLabel: mdRenderText('text 围栏块渲染', 'Render text fences'),
    textFenceHint: mdRenderText('语言标记为 text / plaintext / txt 的围栏块按 markdown 渲染，每块可切回原文', 'Render text / plaintext / txt fences as markdown, each block can switch back to source'),
    contextLabel: mdRenderText('上下文注入块渲染', 'Render context-injection blocks'),
    contextHint: mdRenderText('宿主以纯文本呈现的上下文注入正文（子 agent 消息 / AGENTS.md）按 markdown 渲染', 'Render plain-text context bodies (sub-agent messages / AGENTS.md) as markdown'),
    thinkingLabel: mdRenderText('思考默认展开', 'Expand thinking by default'),
    thinkingHint: mdRenderText('新出现的思考块自动展开；只对官方折叠行派发一次点击，外观完全由官方决定（用户手动折叠后不再干预）', 'Newly mounted thinking rows expand automatically by dispatching one click; the look stays fully official (a manual collapse is respected)'),
    injectPromptLabel: mdRenderText('注入 mermaid 能力说明', 'Inject mermaid capability note'),
    injectPromptHint: mdRenderText('默认开启；关闭后已有代码块照常渲染，只是不再主动引导模型画图', 'On by default; when off, existing blocks still render — the model is just no longer nudged'),
    mermaidRenderLabel: mdRenderText('渲染 mermaid 代码块', 'Render mermaid code blocks'),
    mermaidRenderHint: mdRenderText('mermaid / mmd 代码块渲染为图表卡片（预览 / 代码切换、导出 PNG / SVG）；渲染失败时回显源码', 'Render mermaid / mmd blocks as diagram cards (preview / code toggle, PNG / SVG export); on failure the source is shown'),
    loading: mdRenderText('加载中…', 'Loading…'),
    save: mdRenderText('保存', 'Save'),
    saved: mdRenderText('已保存', 'Saved'),
    saveFailed: mdRenderText('保存失败', 'Save failed'),
    loadFailed: mdRenderText('配置加载失败', 'Failed to load config'),
    retry: mdRenderText('重试', 'Retry'),
    errorMissingRoute: mdRenderText('服务端插件未加载：/md-render/api 路由不存在（确认已安装并启用 dsh-md-render 后重启 DSH，HTTP 404）', 'Host half not loaded: the /md-render/api route is missing (install and enable dsh-md-render, then restart DSH — HTTP 404)'),
    errorForbidden: mdRenderText('请求被安全围栏拒绝（403）：请检查网络/代理设置', 'Blocked by the trust fence (403): check your network/proxy settings'),
    errorNetwork: mdRenderText('网络错误或响应异常：请检查 DSH 服务是否正常运行', 'Network error or bad response: check that the DSH server is running'),
};
/** 设置页样式：只用宿主语义变量（--dsw-* / --ds-*），跟随深浅主题。 */
const MD_RENDER_SETTINGS_STYLES = `
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
`;

    "use strict";
// ── 设置页视图：单 tab「渲染」三分组（Markdown 增强 / 思考块 / Mermaid 图表）──
// 官方 slots 扩展点：设置 → 插件 → 渲染。开关与 host 半 lib/config.js 的 schema
// 一一对应（三段命名空间化）。保存走 PUT /md-render/api/config → host 半写回 profile
// patch 文件（先合并行内已有键）+ 当即重同步 systemPrompt section（保存即生效）。
// 本文件是 part 片段：与其它片段共享 factory 作用域。文件末尾的 `export {}` 只用于
// 让 tsc 按模块作用域编译（否则 script 模式的全局作用域会让同名函数跨文件冲突）；
// scripts/build.mjs 注入前会剥掉编译产生的 exports 样板（see unwrapModule）。
/** 页签 id：必须全局唯一——复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MD_RENDER_SETTINGS_TAB_ID = 'md-render-settings';
/** 页签顺序（合并前三插件分别为 90 / 92 / 95，合一后取最前者）。 */
const MD_RENDER_SETTINGS_TAB_ORDER = 90;
/** 三分组的开关定义（顺序即渲染顺序）。 */
const MD_RENDER_SWITCH_GROUPS = [
    {
        title: MD_RENDER_STRINGS.groupMarkdown,
        items: [
            {
                section: 'markdown',
                key: 'copyButton',
                label: MD_RENDER_STRINGS.copyButtonLabel,
                hint: MD_RENDER_STRINGS.copyButtonHint,
            },
            {
                section: 'markdown',
                key: 'textFenceMarkdown',
                label: MD_RENDER_STRINGS.textFenceLabel,
                hint: MD_RENDER_STRINGS.textFenceHint,
            },
            {
                section: 'markdown',
                key: 'contextMarkdown',
                label: MD_RENDER_STRINGS.contextLabel,
                hint: MD_RENDER_STRINGS.contextHint,
            },
        ],
    },
    {
        title: MD_RENDER_STRINGS.groupThinking,
        items: [
            {
                section: 'thinking',
                key: 'defaultExpanded',
                label: MD_RENDER_STRINGS.thinkingLabel,
                hint: MD_RENDER_STRINGS.thinkingHint,
            },
        ],
    },
    {
        title: MD_RENDER_STRINGS.groupMermaid,
        items: [
            {
                section: 'mermaid',
                key: 'injectPrompt',
                label: MD_RENDER_STRINGS.injectPromptLabel,
                hint: MD_RENDER_STRINGS.injectPromptHint,
            },
            {
                section: 'mermaid',
                key: 'render',
                label: MD_RENDER_STRINGS.mermaidRenderLabel,
                hint: MD_RENDER_STRINGS.mermaidRenderHint,
            },
        ],
    },
];
/** 开关行（布尔配置项）。 */
function MdRenderSettingsToggle(props) {
    return createElement('div', { className: 'dsh-md-render-settings-row' }, createElement('div', { className: 'dsh-md-render-settings-info' }, createElement('div', { className: 'dsh-md-render-settings-label' }, props.label()), createElement('div', { className: 'dsh-md-render-settings-hint' }, props.hint())), createElement('div', {
        className: 'dsh-md-render-settings-toggle',
        'data-on': String(props.on),
        role: 'switch',
        'aria-checked': String(props.on),
        onClick: () => props.onChange(!props.on),
    }));
}
/** 取开关当前值（缺失按默认开）。 */
function mdRenderSwitchOn(draft, item) {
    const section = draft[item.section];
    if (section === undefined || section === null)
        return true;
    return section[item.key] !== false;
}
/** 三分组视图。 */
function MdRenderSettingsGroups(props) {
    return createElement('div', { className: 'dsh-md-render-settings' }, ...MD_RENDER_SWITCH_GROUPS.map((group, index) => createElement('div', { className: 'dsh-md-render-settings-group', key: 'group-' + index }, createElement('div', { className: 'dsh-md-render-settings-section-title' }, group.title()), ...group.items.map((item) => createElement(MdRenderSettingsToggle, {
        key: item.section + '.' + item.key,
        label: item.label,
        hint: item.hint,
        on: mdRenderSwitchOn(props.draft, item),
        onChange: (value) => props.onPatch(item, value),
    })))));
}
/** 操作区：保存按钮 + 成功/失败提示（成功失败都留在原地，不弹窗、不静默）。 */
function MdRenderSettingsActions(props) {
    return createElement('div', { className: 'dsh-md-render-settings-actions' }, createElement('button', { className: 'dsh-md-render-settings-btn', onClick: props.onSave }, MD_RENDER_STRINGS.save()), props.saved
        ? createElement('span', { className: 'dsh-md-render-settings-saved' }, MD_RENDER_STRINGS.saved())
        : null, props.failed
        ? createElement('span', { className: 'dsh-md-render-settings-error' }, MD_RENDER_STRINGS.saveFailed())
        : null);
}
/** 配置加载失败视图：按失败原因给针对性提示 + 重试。 */
function MdRenderSettingsLoadError(props) {
    const hint = props.kind === 'http:404'
        ? MD_RENDER_STRINGS.errorMissingRoute()
        : props.kind === 'http:403'
            ? MD_RENDER_STRINGS.errorForbidden()
            : MD_RENDER_STRINGS.errorNetwork();
    return createElement('div', { className: 'dsh-md-render-settings' }, createElement('div', { className: 'dsh-md-render-settings-error' }, MD_RENDER_STRINGS.loadFailed()), createElement('div', { className: 'dsh-md-render-settings-status' }, hint), createElement('div', { className: 'dsh-md-render-settings-actions' }, createElement('button', { className: 'dsh-md-render-settings-btn', onClick: props.onRetry }, MD_RENDER_STRINGS.retry())));
}
/** 拉取当前生效配置（GET）；失败交 onError（kind 供提示区分）。 */
function loadMdRenderConfig(onValue, onError) {
    fetch(CONFIG_API_URL)
        .then((res) => {
        if (!res.ok)
            throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        return res.json();
    })
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('bad config response');
        onValue(body.value ?? {});
    })
        .catch((err) => onError(typeof err?.status === 'number' ? 'http:' + err.status : 'network'));
}
/** 保存配置（PUT）：只发**变更的段**（host 半按段合并），成功交 onSaved。 */
function saveMdRenderConfig(draft, onSaved, onError) {
    fetch(CONFIG_API_URL, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('save failed');
        // 立即应用新开关（无需等待 patch 热重载，当前页面生效）。
        setRenderOptions(draft);
        onSaved();
    })
        .catch(() => onError('save'));
}
/** 设置页主视图：加载当前配置 → 三分组开关编辑 → 保存（PUT /md-render/api/config）。 */
function mdRenderSettingsView() {
    const [config, setConfig] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorKind, setErrorKind] = useState('');
    const [saved, setSaved] = useState(false);
    const load = () => {
        setLoading(true);
        setErrorKind('');
        loadMdRenderConfig((value) => {
            setConfig(value);
            setDraft(value);
            setLoading(false);
        }, (kind) => {
            setConfig(null);
            setLoading(false);
            setErrorKind(kind);
        });
    };
    useEffect(() => {
        load();
    }, []);
    if (loading) {
        return createElement('div', { className: 'dsh-md-render-settings' }, createElement('div', { className: 'dsh-md-render-settings-status' }, MD_RENDER_STRINGS.loading()));
    }
    if (config === null)
        return createElement(MdRenderSettingsLoadError, { kind: errorKind, onRetry: load });
    const patch = (item, value) => {
        const current = draft ?? {};
        setDraft({ ...current, [item.section]: { ...(current[item.section] ?? {}), [item.key]: value } });
    };
    const save = () => {
        setSaved(false);
        setErrorKind('');
        saveMdRenderConfig(draft ?? {}, () => setSaved(true), (kind) => setErrorKind(kind));
    };
    return createElement('div', { className: 'dsh-md-render-settings' }, createElement(MdRenderSettingsGroups, { draft: draft ?? {}, onPatch: patch }), createElement(MdRenderSettingsActions, { saved, failed: errorKind === 'save', onSave: save }));
}

    "use strict";
// ── 设置页注册（官方 slots 扩展点，单 tab 三分组）─────────────────────
// 合并前三个插件各注册一个 tab（md-render 90「渲染」/ think-zh 92 / mermaid 95），
// 合并后收敛为**一个** tab「渲染」三分组 —— 一次保存写全量，天然消除「三 tab 各自
// PUT 各自路径」的重复。
//
// 片段的编译模式：本文件与其余片段一样是 **script 模式**（无 import/export）——
// tsc 在 script 模式下让所有 client 片段共享一个检查作用域，跨文件引用天然可见；
// 一旦写 `export {}` 就变成模块、跨文件引用全部不可见（且片段间无法 import，
// 因为产物是构建期拼接的单一 factory 作用域）。重名因此必须靠命名消除，
// 不能靠模块隔离。
/**
 * 注册设置页签。三处刻意的写法：
 *  - 样式注入在最前、不进任何早退分支（服务判空 / HMR 时样式会丢）。
 *  - `ctx.get('slots', false)`：**必须传 strict=false** —— cordis 的
 *    `ctx.get(name, strict = true)` 在服务提供者 fiber 尚未 active（首屏）时返回
 *    undefined，页签会消失到下次 HMR；只有 strict=false 才拿得到实例。
 *  - 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能因为拿不到
 *    slots 就让整个 client（含全部渲染能力）挂掉。
 */
function attachSettingsTab(ctx) {
    installStyles(ctx, 'data-dsh-md-render-settings', MD_RENDER_SETTINGS_STYLES, 'dsh-md-render: settings styles');
    const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined;
    if (slots === undefined || slots === null)
        return;
    ctx.effect(() => {
        slots.inject('settings.plugins.tab', () => slots.register({
            name: 'settings.plugins.tab',
            id: MD_RENDER_SETTINGS_TAB_ID,
            order: MD_RENDER_SETTINGS_TAB_ORDER,
            // 惰性函数：宿主靠重注册 + 每次求值跟随语言切换（不得写成常量）。
            label: MD_RENDER_STRINGS.tab,
        }, mdRenderSettingsView));
        return undefined;
    }, 'dsh-md-render: settings tab registration');
}


    // ── 插件入口：样式注入 + 扫描器装配 + 设置页 ───────────────────
    "use strict";
exports.inject = [];
exports.apply = function apply(ctx) {
    // 增强功能开关：默认全开；真实配置异步经 GET /md-render/api/config 拉取应用
    // （client 端不能访问 ctx.config——Cordis inject 限制，访问抛
    // "cannot get property without inject"，导致 client failed to apply）。
    setRenderOptions();
    initConfigFromServer();
    // 样式注入走共享实现：与 dsh-shared 的其它消费者同一份「无条件最先注入 +
    // 随 fiber teardown 卸载」逻辑（style-tag.part.js）。位置仍在最前、不进任何
    // 早退分支（dsh-file-activity 踩坑：挂在服务判空之后，HMR / 服务缺省时样式会丢）。
    installStyles(ctx, 'data-dsh-md-render', STYLES, 'dsh-md-render: styles');
    // 三个渲染注入点共用**一个** MutationObserver（scanner.ts 按语言分流）。
    ctx.effect(() => installScanner(), 'dsh-md-render: scanner');
    // 设置页 tab（官方 slots 扩展点，单 tab 三分组）。
    attachSettingsTab(ctx);
};


    return module.exports
  },
})
