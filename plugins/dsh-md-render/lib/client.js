/**
 * dsh-md-render — client half (browser)。职责边界：**只做 markdown 内容的渲染**（markdown
 * 文本 / 代码样式 / 图表渲染 / 思考 markdown），其他一律保持官方默认样式。
 * **内容渲染完全用插件自己的实现**（marked 解析 + 自研 vdom 渲染 + highlight.js 高亮），
 * 不再调用官方 MarkdownText / CodeBlock；解析层与高亮层走 assets 懒加载，不进本 bundle。
 * 注入点与能力清单见 README.md / docs/md渲染/，此处不重复。
 *
 * 硬约束（可机器校验，见 test/static-assertions.mjs）：
 *  - **不注册任何 conversation.chat.node 节点级 seat**（尤其 assistant-step）；
 *  - **不对官方元素写 style / class / aria**：DOM 注入只用自有 CSS + 自有 data-* 标记；
 *  - **不读 React fiber 私有属性**（__reactFiber$）；
 *  - 单 MutationObserver（一个扫描器按语言分流）。
 *
 * 外观是**插件自己的视觉语言**（src/client/parts/styles.ts 的 --mdr-* 自有 token：胶囊标签 /
 * 强调竖条 / 自有排版尺度与语法配色），颜色仍取宿主 --dsw-* 语义变量随深浅色自适应；
 * 随 activation 注入、fiber teardown 卸载（HMR / 禁用无残留）。
 *
 * BUILD NOTE: 本文件是源码模板（骨架）。scripts/build.mjs 把编译后的片段注入到下方
 * /*__PART_*__* / 占位符处并写出 lib/client.js（DSH 实际提供的产物，单一 __ModuleLoader__
 * bundle，无相对路径 require）。产物必须提交（CI 只跑 node --check + 测试，不跑构建）；
 * 片段为纯函数声明文本（无 import/export），注入后处于本 factory 作用域。
 */
window.__ModuleLoader__.load({
  id: 'dsh-md-render',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // createElement / hooks 由 react 提供；自有渲染经 dom-root.part 取平台 react-dom/client。
    const { createElement, useState, useEffect } = require('react')

    // 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）
    // ── 路由路径（构建期由 host 半 lib/routes/paths.js 注入的单一真源）──────
const CONFIG_API_URL = "/md-render/api/config"
const MERMAID_ENGINE_URL = "/md-render/assets/mermaid-10.9.3.min.js"
const PANZOOM_SCRIPT_URL = "/md-render/assets/panzoom-4.6.2.min.js"
const MARKED_URL = "/md-render/assets/marked-18.1.0.umd.js"
const HIGHLIGHTJS_URL = "/md-render/assets/highlightjs-11.12.0.min.js"
const LANGS_API_URL = "/md-render/api/langs"
const LANGS_HASH_PARAM = "h"
    // 渲染配置（三段开关 + 旧扁平键兼容）+ 围栏语言索引（issue #466）
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
Object.assign(exports,{CONFIG_API_URL,setRenderOptions,readConfig,initConfigFromServer,DEFAULT_RENDER_OPTIONS});

    "use strict";
// ── 围栏语言索引（client 半）：DOM 认不出语言时按块内容哈希问 host ────────
// 背景（issue #466 真实宿主实测）：官方 CodeBlock 的 banner 只在 shiki **认识**该语言时
// 才写语言原名（chat 侧传了 toolbarLabels → 语言名 = `i8(lang) ? lang : labels.codeLabel`），
// 且**非空**代码块不写 `language-*`（只有空围栏分支写）—— 实测 text / mermaid / 无语言
// 三种块 DOM 逐字段完全相同，纯 DOM 无法区分，本插件原来的 DOM 语言识别 100% 静默失效。
//
// **双源互补**：语言判定唯一入口 = {@link resolveFenceLangEx} —— ① client 事件流索引
// （lang-source.ts，含历史、零 RPC）；② 本文件的 {@link resolveBlockLangEx}（DOM 语言
// token → host 半实时索引：订阅 session/event 建表、不读历史）。查表只比对哈希、不看内容，
// 且 host 索引只登记本插件接管的语言 → 无关语言不会误判；缓存 / 未命中重试都有界，同一次
// 扫描的多个块合成**一次**请求；查表永远在块**稳定后**（[data-streaming] 门控 + 稳定窗口）。
/** djb2 字符串哈希（与 host 半 src/lang-index.ts 的 fenceHash 同算法；parity 由测试钉住）。 */
function fenceContentHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1)
        h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
/** 内容规范化：去尾部空白（含换行）——与 host 半 normalizeFenceContent 同口径。 */
function normalizeFenceContent(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+$/, '');
}
/** hash → lang 缓存 / 未命中重试计数表的容量上限（长会话防无界增长）。 */
const LANG_CACHE_MAX = 500;
/** 单次请求的哈希上限（与 host 半 routes/langs.ts 的 LANGS_MAX_HASHES 一致；超出留到下批）。 */
const LANG_BATCH_MAX = 64;
/** 单块参与查表的内容长度上限（超长块不查表，保持官方默认）。 */
const LANG_MAX_PROBE_CHARS = 100000;
/** 未命中重试：每哈希最多 2 次、间隔 1.5s（覆盖「client 先扫、host 索引后建」的时序差）。 */
const LANG_MAX_RETRIES = 2;
const LANG_RETRY_MS = 1500;
/** 语言 token 形态（ASCII 标识符）：banner 显示语言**原名**时为真；本地化标签「代码块」为假。 */
const LANG_TOKEN_RE = /^[a-z0-9][a-z0-9_+#.-]*$/;
/** hash → 语言（`''` = 查过且未命中；有界，见 LANG_CACHE_MAX）。 */
const langCache = new Map();
/** 待批量查询的哈希（同一次扫描的多个块合成一次请求）。 */
const langQueue = new Set();
/** 未命中哈希 → 已重试次数（有界）。 */
const langMisses = new Map();
/** 命中后触发的重扫钩子（由 scanner.ts 注册；null = 未装配）。 */
let langRescan = null;
let langFlushScheduled = false;
let langRetryTimer = null;
/** 有界写入：超出上限丢最旧（Map 迭代序 = 插入序）。 */
function boundedPut(map, key, value) {
    if (map.has(key))
        map.delete(key);
    map.set(key, value);
    while (map.size > LANG_CACHE_MAX) {
        const oldest = map.keys().next();
        if (oldest.done === true)
            return;
        map.delete(oldest.value);
    }
}
// ── ④ 语言手动切换（需求 4）：块级覆盖层（**优先级最高**）──────────────────
// 「用户显式意图 != 猜语言」：只在用户点过「渲染为…」之后生效；自动判定仍是「绝不猜」。
const FENCE_FORCE_ATTR = 'data-dsh-md-render-lang-force';
const FENCE_FORCE_VALUES = ['mermaid', 'markdown', 'source'];
/** 「渲染为…」选项表（卡片头与块内控件共用一份）。 */
const FENCE_FORCE_OPTIONS = [
    { value: 'mermaid', label: '图表' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'source', label: '源码' },
];
/** 覆盖表：块内容哈希 -> 覆盖值（有界；跨宿主重渲染存活）。 */
const fenceForces = new Map();
/** 覆盖键 = 块源码的 djb2 哈希（与 host 语言索引同一键空间）。 */
function fenceForceKey(block) {
    const text = blockLangCodeText(block);
    return text === '' ? '' : fenceContentHash(text);
}
/** 读有效的人工覆盖值（块属性优先，其次按内容哈希查表）。 */
function fenceForceOf(block) {
    const direct = typeof block.getAttribute === 'function' ? block.getAttribute(FENCE_FORCE_ATTR) : null;
    if (direct !== null && FENCE_FORCE_VALUES.includes(direct))
        return direct;
    const key = fenceForceKey(block);
    return key === '' ? undefined : fenceForces.get(key);
}
/** 写入 / 清除人工覆盖（空值 = 清除）：块属性 + 有界表 + 持久化。 */
function setFenceForce(block, value) {
    const key = fenceForceKey(block);
    if (value !== undefined && FENCE_FORCE_VALUES.includes(value)) {
        block.setAttribute(FENCE_FORCE_ATTR, value);
        if (key !== '')
            boundedPut(fenceForces, key, value);
        persistFenceForces();
        return;
    }
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute(FENCE_FORCE_ATTR);
    if (key !== '')
        fenceForces.delete(key);
    persistFenceForces();
}
/** 覆盖的会话级持久化（验收项「刷新后仍记得」）：有界 + 异常静默。 */
const FENCE_FORCE_STORE_KEY = 'dsh-md-render:lang-force';
const FENCE_FORCE_PERSIST_MAX = 100;
function persistFenceForces() {
    try {
        const store = window.sessionStorage;
        if (!store)
            return;
        store.setItem(FENCE_FORCE_STORE_KEY, JSON.stringify([...fenceForces.entries()].slice(-FENCE_FORCE_PERSIST_MAX)));
    }
    catch (_e) {
        // 隐私模式 / 配额满：不落盘也不报错
    }
}
/** 从会话存储恢复覆盖表（启动时一次；不可用 -> 退回自动判定）。 */
function restoreFenceForces() {
    try {
        const store = window.sessionStorage;
        const raw = store ? store.getItem(FENCE_FORCE_STORE_KEY) : null;
        if (raw === null)
            return;
        const list = JSON.parse(raw);
        if (!Array.isArray(list))
            return;
        for (const item of list) {
            if (!Array.isArray(item))
                continue;
            const value = String(item[1]);
            if (typeof item[0] === 'string' && item[0] !== '' && FENCE_FORCE_VALUES.includes(value)) {
                boundedPut(fenceForces, item[0], value);
            }
        }
    }
    catch (_e) {
        // 不恢复即可，不影响任何既有能力
    }
}
function blockLangCodeText(block) {
    const code = block.querySelector ? block.querySelector('code') : null;
    return code === null ? '' : normalizeFenceContent(code.textContent);
}
/**
 * DOM 已给出的语言名：`code.language-xxx`（官方空围栏 / 旧契约）→ banner 首个子元素文本。
 * banner 里可能是语言原名（js / json / bash…），也可能是本地化标签「代码块」——
 * 两者**都原样返回**，由 {@link resolveBlockLang} 用 token 形态区分。不读 React fiber。
 */
function blockLangDomLang(block) {
    const code = block.querySelector ? block.querySelector('code') : null;
    const className = code !== null && typeof code.className === 'string' ? code.className : '';
    const m = className.match(/language-([A-Za-z0-9_+-]+)/);
    if (m !== null)
        return m[1].toLowerCase();
    const banner = block.querySelector ? block.querySelector('[data-code-block-banner]') : null;
    const info = banner !== null && banner.firstElementChild ? banner.firstElementChild.textContent : '';
    return String(info ?? '')
        .trim()
        .toLowerCase();
}
/** host 索引探测：`known` 区分「查过且命中」与「还没答案 / 未命中」。 */
function indexedBlockLangProbe(block) {
    const text = blockLangCodeText(block);
    if (text === '' || text.length > LANG_MAX_PROBE_CHARS)
        return { lang: '', known: false };
    const hash = fenceContentHash(text);
    const cached = langCache.get(hash);
    if (cached !== undefined)
        return { lang: cached, known: cached !== '' };
    langQueue.add(hash);
    scheduleLangFlush();
    return { lang: '', known: false };
}
/**
 * 解析块语言（DOM 契约 + host 索引）并给出**可信度**：
 *  `confirmed === true` = 已确证，**包括 lang 为 '' 的「确证没有语言标记」**；false = 识别失败。
 *  host 索引「未命中」不算确证：它只登记本插件接管的语言，js / java 等同样查不到。

 */
function resolveBlockLangEx(block) {
    const dom = blockLangDomLang(block);
    if (dom !== '' && LANG_TOKEN_RE.test(dom))
        return { lang: dom, confirmed: true };
    const probe = indexedBlockLangProbe(block);
    return { lang: probe.lang, confirmed: probe.known };
}
/** 语言（字符串形态；带可信度的版本见 {@link resolveFenceLangEx}）。 */
function resolveBlockLang(block) {
    return resolveBlockLangEx(block).lang;
}
/**
 * 语言判定唯一入口（**手动覆盖 > client 事件流索引 > DOM/host 索引**）：
 *  ⓪ 手动覆盖（需求 4）：用户点过「渲染为…」→ 直接采用且 confirmed = true；
 *  ① client 事件流索引 {@link fenceLangOf}——含历史的原始 markdown，命中即零 RPC，
 *     confirmed = true；**`''` = 确证无语言**同样算确证（需求 3 的兜底只认这种情形）；
 *  ② 取不到 → {@link resolveBlockLangEx}（DOM token / host 索引命中才算确证）。
 * 调用方按 `confirmed` 区分「确证无语言」与「识别失败」：后者原样保留官方代码块。
 */
function resolveFenceLangEx(block) {
    const forced = fenceForceOf(block);
    if (forced !== undefined)
        return { lang: forced, confirmed: true };
    const local = fenceLangOf(block);
    if (local !== undefined)
        return { lang: local, confirmed: true };
    return resolveBlockLangEx(block);
}
/** 语言判定唯一入口的字符串形态（带可信度的版本见 {@link resolveFenceLangEx}）。 */
function resolveFenceLang(block) {
    return resolveFenceLangEx(block).lang;
}
/** 本插件渲染容器内的块不再二次接管（防递归重建；类名来自 block-render.ts）。 */
function isInsideRenderedMarkdown(block) {
    if (!block.closest)
        return false;
    return block.closest('div.' + BLOCK_MD_CLASS) !== null || block.closest('div.' + CODE_HOST_CLASS) !== null;
}
/** 取一批待查哈希（不超过单请求上限，其余留到下批）。 */
function takeLangBatch() {
    const batch = [];
    for (const hash of langQueue) {
        if (batch.length >= LANG_BATCH_MAX)
            break;
        batch.push(hash);
    }
    for (const hash of batch)
        langQueue.delete(hash);
    return batch;
}
/** 微任务批处理：一次扫描里的多个块合成一次请求（避免每块一发）。 */
function scheduleLangFlush() {
    if (langFlushScheduled)
        return;
    langFlushScheduled = true;
    Promise.resolve()
        .then(flushLangQueue)
        .catch(() => {
        // 查表失败**静默降级**：保持官方默认渲染，不影响任何既有能力。
    });
}
/** 批量请求语言索引（相对 URL 失败 / 非 200 / 结构不符 → 空答案）。 */
async function fetchLangs(hashes) {
    if (typeof fetch !== 'function')
        return {};
    const query = hashes.map((h) => LANGS_HASH_PARAM + '=' + encodeURIComponent(h)).join('&');
    const response = await fetch(LANGS_API_URL + '?' + query);
    if (response === null || response === undefined || response.ok === false)
        return {};
    const body = (await response.json());
    if (body === null || body.ok !== true || body.value === null || typeof body.value !== 'object')
        return {};
    return body.value;
}
/** 记录一次未命中（首次进入重试表；表满丢最旧）。 */
function noteLangMiss(hash) {
    if (!langMisses.has(hash))
        boundedPut(langMisses, hash, 0);
}
/** 把一批答案写进缓存：命中触发重扫，未命中排重试，剩余哈希排下一批。 */
function applyLangAnswers(batch, answer) {
    let hit = false;
    let missed = false;
    for (const hash of batch) {
        const lang = answer[hash];
        if (typeof lang === 'string' && lang !== '') {
            boundedPut(langCache, hash, lang);
            langMisses.delete(hash);
            hit = true;
            continue;
        }
        boundedPut(langCache, hash, '');
        noteLangMiss(hash);
        missed = true;
    }
    if (hit && langRescan !== null)
        langRescan();
    if (missed)
        scheduleLangRetry();
    if (langQueue.size > 0)
        scheduleLangFlush();
}
/** 冲刷待查队列（测试可直接 await；生产由微任务触发）。 */
async function flushLangQueue() {
    langFlushScheduled = false;
    const batch = takeLangBatch();
    if (batch.length === 0)
        return;
    try {
        applyLangAnswers(batch, await fetchLangs(batch));
    }
    catch (_e) {
        // 单批失败不冒泡（静默降级）；未命中的哈希留待重试窗口再试。
    }
}
/** 未命中里还有可重试的哈希 → 排一次重试定时器（同时最多一个）。 */
function scheduleLangRetry() {
    if (langRetryTimer !== null || typeof setTimeout !== 'function')
        return;
    let retryable = false;
    for (const count of langMisses.values()) {
        if (count < LANG_MAX_RETRIES)
            retryable = true;
    }
    if (!retryable)
        return;
    langRetryTimer = setTimeout(() => {
        langRetryTimer = null;
        retryLangMisses();
    }, LANG_RETRY_MS);
}
/** 有界重试：把未命中的哈希从缓存里删掉再重扫（重扫会重新排队 → 重新查表）。 */
function retryLangMisses() {
    for (const [hash, count] of [...langMisses.entries()]) {
        if (count >= LANG_MAX_RETRIES)
            continue;
        boundedPut(langMisses, hash, count + 1);
        langCache.delete(hash);
    }
    if (langRescan !== null)
        langRescan();
}
/** 注册「语言命中 / 重试」后的重扫钩子（scanner.ts 装配；返回撤销函数）。 */
function installLangRescan(rescan) {
    langRescan = rescan;
    return () => {
        if (langRescan === rescan)
            langRescan = null;
    };
}
/** teardown：清定时器、待查队列、未命中表与缓存（fiber 卸载 / HMR 无残留）。 */
function teardownLangProbes() {
    if (langRetryTimer !== null)
        clearTimeout(langRetryTimer);
    langRetryTimer = null;
    langFlushScheduled = false;
    langQueue.clear();
    langMisses.clear();
    langCache.clear();
    fenceForces.clear();
    langRescan = null;
}
Object.assign(exports,{LANGS_API_URL,LANGS_HASH_PARAM,LANG_BATCH_MAX,LANG_MAX_RETRIES,fenceContentHash,normalizeFenceContent,blockLangDomLang,resolveBlockLang,resolveFenceLang,resolveFenceLangEx,resolveBlockLangEx,FENCE_FORCE_ATTR,FENCE_FORCE_OPTIONS,fenceForceOf,setFenceForce,restoreFenceForces,isInsideRenderedMarkdown,flushLangQueue,retryLangMisses,installLangRescan,teardownLangProbes});

    "use strict";
// ── 围栏语言索引（client 半，双源互补的**主源**）：会话事件流 ────────────
// 宿主 0.2.0-rc.2 实测（调研报告 tmp/md-render-lang-source/report.md §7）：
//   · banner 文本走 `supportsHighlighting(lang) ? lang : labels.codeLabel`
//     —— 只有 shiki 语法表认识的标记才进 DOM，其余一律显示本地化标签「代码块」；
//   · 非空代码块的 <code> 也不带 language-*（只有 node.value === '' 的
//     空围栏分支才带）；
//   ⇒ text / plaintext / txt / mermaid / mmd 与「无语言」块在 DOM 里**完全同形**，
//     任何 DOM 启发式都取不到语言（实测接管数 toggles=0 / views=0）。
//
// **为什么必须有这一半**（host 半实时索引的结构性缺口）：host 半只订阅
// `session/event`、**不读历史** —— 用户打开的是历史会话、而插件实例是之后才启动
// （冷启动 / 重启后打开历史会话）时，host 索引为空，按哈希查表永不命中。
// 而 `ctx.sessions.binding(id).eventSource` 的窗口里就是这个会话**已加载的全部**
// 原始事件（含历史），所以本表是「历史会话 + 冷启动」唯一能命中的来源。
//
// 语言的真源在**会话事件流**：官方 ctx.sessions.binding(id).eventSource 的窗口里就是
// 未经裁剪的原始 Session 事件，assistant/message.data.message.content[].text 与
// user/message.data.content[].text 是模型可见消息的 markdown 原文。
// host 半的实时索引（src/lang-index.ts，`session/event` 订阅）作为**兜底**保留：
//   本表命中 → 零 RPC；本表未命中 / 取不到 → 才可能走那一次批量查询（routes/langs.ts）。
//
// 映射（内容哈希 + 文档序 FIFO，报告 §3.2-A）：
//   1. 事件侧：扫每段 markdown 的围栏块，建 hash(规范化代码) → langs[]（文档序，
//      含 '' = 确证无语言）；只取 surfaceOp === 'append' 的 durable 事件；
//   2. DOM 侧：对 div.md-code-block 取 <pre>.textContent 算同一哈希查表；
//   3. 候选互不相同 → 按 DOM 文档序 FIFO，且要求 DOM 内同哈希块数与候选数一致；
//      数量不符 / 取不到位 → 返回 undefined（调用方静默退回现状），**绝不猜**。
//
// 降级（真降级）：ctx.get('sessions') 取不到 / 任何异常 → 空表 → 调用方退回
// resolveBlockLang（DOM 契约 + host 索引），行为与修复前一致。
// 无语言 / 非目标语言的块在任何路径下都不会被接管。
//
// 依赖注入（R1 三方案实测结论，见报告；本轮已用 rc.2 asar 抽出的真实 cordis 4.0.4 复测）：
//   · 采用：`ctx.get('sessions', false)` + `exports.inject` 保持 `[]` —— 服务在则取到，
//     服务缺则返回 undefined（不抛）；服务晚于 apply 提供（真实首屏顺序）也照样取到。
//     cordis 4 的 ReflectService.get 契约原文即 "read a service ... without the inject
//     requirement"，零新增硬依赖；
//   · `inject: { optional: [...] }` —— cordis 4.0.4 **不支持可选注入**（对象形式是
//     「服务名 → intercept 配置」），实测 apply 根本不执行：不采用；
//   · `inject: ['sessions']` —— 服务缺失时 apply 完全不执行 → **整个 client 半失效**
//     （连样式与设置页一起没）：不采用（本轮实测确认）。
//
// 硬约束：不读 React fiber 私有属性；不写官方元素的 style / class / aria；
// 不注册任何节点级 seat；调用时机由调用方钉死在 [data-streaming] 门控之后
// （块稳定时才查表）。
/** 已解析事件的上限（性能护栏：seen 集合规模）。 */
const MAX_FENCE_EVENTS = 20000;
/** 单段 markdown 的扫描上限（字符）；超出不参与建表。 */
const MAX_FENCE_MARKDOWN_CHARS = 400000;
/** 单块代码内容上限（字符）；超出不参与建表（下游同样会拒绝超长块）。 */
const MAX_FENCE_CODE_CHARS = 200000;
/** 歧义消解时一次枚举的代码块上限（性能护栏）。 */
const MAX_ORDER_SCAN_BLOCKS = 4000;
function emptyFenceIndex() {
    return { sessionId: '', revision: -1, byHash: new Map(), seen: new Set() };
}
let fenceIndex = emptyFenceIndex();
/** 重置为空表（会话切换 / 取不到事件源 / 任何异常）。已是空表则原样返回
 *  （本函数每批扫描都会被调用，避免每次重新分配 Map / Set）。 */
function resetFenceIndex() {
    if (fenceIndex.revision === -1)
        return;
    fenceIndex = emptyFenceIndex();
}
/** 规范化：CRLF → LF、去行尾空白、去尾部空行（**两端必须用同一函数**）。 */
function fenceNormalize(code) {
    return String(code ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n+$/, '');
}
/** 内容哈希（长度前缀 + djb2，复用 context-markdown.ts 的 contextHash；空内容 → 空串）。 */
function fenceHash(code) {
    if (typeof code !== 'string' || code === '')
        return '';
    return code.length.toString(36) + ':' + contextHash(code);
}
/** info string → 语言标记（首个空白分隔的 token，小写；无则空串）。 */
function fenceInfoLang(info) {
    const token = String(info ?? '')
        .trim()
        .split(/\s+/)[0];
    return token === undefined ? '' : token.toLowerCase();
}
/**
 * 保守围栏解析（报告 §8-R2）：行首 0–3 空格 + 三反引号/三波浪号（≥3）+ info string 开栏，
 * 同字符且长度不短于开栏的纯围栏行闭栏；未闭合的尾巴一律忽略（成对才算）。
 * 与官方 remark 的边角行为可能不同 —— 因此结果只用于**白名单语言匹配**，
 * 误判不会造成破坏，只会少接管。
 */
function collectFences(text, sink) {
    const lines = String(text ?? '').split(/\r?\n/);
    let open = null;
    for (let i = 0; i < lines.length; i += 1) {
        const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
        if (m === null)
            continue;
        if (open === null) {
            open = { ch: m[1].charAt(0), len: m[1].length, lang: fenceInfoLang(m[2]), line: i };
            continue;
        }
        if (m[1].charAt(0) !== open.ch || m[1].length < open.len || m[2].trim() !== '')
            continue;
        sink(open.lang, lines.slice(open.line + 1, i).join('\n'));
        open = null;
    }
}
/** 收下一段围栏块（空内容 / 超长不计入 —— 下游同样会拒绝它们）。 */
function collectInto(byHash, lang, code) {
    const hash = fenceHash(fenceNormalize(code));
    if (hash === '')
        return;
    const list = byHash.get(hash);
    if (list === undefined)
        byHash.set(hash, [lang]);
    else
        list.push(lang);
}
/** 内容块数组 → 文本段（只认 string 的 text 字段；其它块类型原样跳过）。 */
function pushTexts(out, content) {
    if (!Array.isArray(content))
        return;
    for (const block of content) {
        if (block === null || typeof block !== 'object')
            continue;
        const text = block.text;
        if (typeof text !== 'string')
            continue;
        if (text.length > MAX_FENCE_MARKDOWN_CHARS)
            continue;
        out.push(text);
    }
}
/** 事件里的 markdown 原文段（assistant 的 text / reasoning + user 的 text）。 */
function eventMarkdowns(event) {
    const out = [];
    const data = (event.data ?? {});
    if (event.type === 'assistant/message') {
        const message = (data.message ?? {});
        pushTexts(out, message.content);
    }
    else if (event.type === 'user/message') {
        pushTexts(out, data.content);
    }
    return out;
}
/** 事件流条目 → 原始 Session 事件（非 durable 事件条目返回 null）。 */
function eventOf(entry) {
    if (entry === null || typeof entry !== 'object')
        return null;
    const record = entry;
    if (record.type !== 'event')
        return null;
    return record.event !== null && typeof record.event === 'object' ? record.event : null;
}
/**
 * 增量吸收事件窗口：只解析**没见过 seq** 的事件（流式期间窗口每批都会被重发，
 * 全量重扫 markdown 会把 CPU 拖垮）；非 durable / 非消息事件同样记账后跳过。
 */
function absorbFences(index, entries) {
    for (const entry of entries) {
        if (index.seen.size >= MAX_FENCE_EVENTS)
            return;
        const event = eventOf(entry);
        if (event === null)
            continue;
        const seq = Number(event.seq);
        if (Number.isFinite(seq)) {
            if (index.seen.has(seq))
                continue;
            index.seen.add(seq);
        }
        if (event.surfaceOp !== 'append')
            continue;
        for (const markdown of eventMarkdowns(event)) {
            collectFences(markdown, (lang, code) => collectInto(index.byHash, lang, code));
        }
    }
}
/** 安全取属性（null / undefined / 标量 → undefined）——宿主契约缺失时只降级不抛。 */
function propOf(value, key) {
    return value !== null && typeof value === 'object' ? value[key] : undefined;
}
/** 会话列表行是否被主视图持有（与官方 dsh-client-ui-session 同一判据：retainedBy.mainView > 0）。 */
function isMainViewRow(row) {
    const retained = propOf(row, 'retainedBy');
    if (retained === undefined)
        return false;
    return Number(propOf(retained, 'mainView')) > 0;
}
/** 当前主视图会话 id；列表结构不符 / 没有主视图会话 → ''（调用方退回空表）。 */
function mainSessionId(sessions) {
    const list = sessions.list;
    if (list === undefined || typeof propOf(list, 'getSnapshot') !== 'function')
        return '';
    const state = list.getSnapshot();
    const byId = propOf(state, 'byId');
    if (byId === undefined || byId === null || typeof byId !== 'object')
        return '';
    for (const row of Object.values(byId)) {
        if (isMainViewRow(row))
            return String(propOf(row, 'id') ?? '');
    }
    return '';
}
/**
 * ctx.get('sessions', false) —— cordis 4 的 ReflectService.get 契约即
 * "Read a service from the store without the inject requirement"，因此**不需要**
 * 声明 inject（硬 inject 在服务缺失时会让 apply 根本不执行，整插件失效）。
 * strict = false：首屏时服务提供者 fiber 可能尚未 active（同 dsh-my-remote 的教训）。
 */
function sessionsService(ctx) {
    if (ctx === null || ctx === undefined || typeof ctx !== 'object')
        return null;
    const get = ctx.get;
    if (typeof get !== 'function')
        return null;
    try {
        const service = get.call(ctx, 'sessions', false);
        return service !== null && typeof service === 'object' ? service : null;
    }
    catch (_e) {
        return null;
    }
}
/** 当前主视图会话的事件源（SessionEventSource）；任一步取不到返回 null。 */
function currentEventSource(ctx) {
    const sessions = sessionsService(ctx);
    if (sessions === null)
        return null;
    try {
        const id = mainSessionId(sessions);
        if (id === '')
            return null;
        const binding = sessions.binding?.call(sessions, id);
        const source = binding === null || binding === undefined ? undefined : binding.eventSource;
        if (source === null || source === undefined || typeof source !== 'object')
            return null;
        return { sessionId: id, source: source };
    }
    catch (_e) {
        return null;
    }
}
/** 事件窗口快照 { sessionId, revision, entries }；取不到返回 null。 */
function fenceEventWindow(ctx) {
    const current = currentEventSource(ctx);
    if (current === null)
        return null;
    try {
        const getSnapshot = current.source.getSnapshot;
        if (typeof getSnapshot !== 'function')
            return null;
        const snapshot = getSnapshot.call(current.source);
        if (snapshot === null || snapshot === undefined || !Array.isArray(snapshot.entries))
            return null;
        return {
            sessionId: current.sessionId,
            revision: Number(snapshot.revision) || 0,
            entries: snapshot.entries,
        };
    }
    catch (_e) {
        return null;
    }
}
/**
 * 按需刷新语言表（每批扫描开头调用一次）：事件源 revision 未变则内部直接返回。
 * 任何异常 / 服务缺失 → 空表（调用方自然降级到原有 DOM 读法）。
 */
function refreshFenceLangIndex(ctx) {
    try {
        const window = fenceEventWindow(ctx);
        if (window === null) {
            resetFenceIndex();
            return;
        }
        if (window.sessionId === fenceIndex.sessionId && window.revision === fenceIndex.revision)
            return;
        if (window.sessionId !== fenceIndex.sessionId)
            resetFenceIndex();
        fenceIndex.sessionId = window.sessionId;
        fenceIndex.revision = window.revision;
        absorbFences(fenceIndex, window.entries);
    }
    catch (_e) {
        resetFenceIndex();
    }
}
/** 块源码（官方 <pre>.textContent 的规范化形式）；空 / 超长 / 结构不符 → null。 */
function fenceBlockCode(block) {
    if (block === null || block === undefined || typeof block.querySelector !== 'function')
        return null;
    const pre = block.querySelector('pre');
    const text = pre === null || pre === undefined ? '' : (pre.textContent ?? '');
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FENCE_CODE_CHARS)
        return null;
    return fenceNormalize(text);
}
/** 块所属的会话滚动容器（歧义消解只在同一容器内比较文档序）。 */
function fenceScopeOf(block) {
    const closest = block.closest;
    if (typeof closest !== 'function')
        return null;
    const scope = closest.call(block, '[data-conversation-scroll]');
    if (scope === null || scope === undefined)
        return null;
    return typeof scope.querySelectorAll === 'function' ? scope : null;
}
/** 块在会话滚动容器内、与其内容同哈希的块中的文档序与总数；取不到返回 null。 */
function sameHashPosition(block, hash) {
    const scope = fenceScopeOf(block);
    if (scope === null)
        return null;
    const blocks = Array.from(scope.querySelectorAll('div.md-code-block'));
    if (blocks.length > MAX_ORDER_SCAN_BLOCKS)
        return null;
    let index = -1;
    let count = 0;
    for (const candidate of blocks) {
        const code = fenceBlockCode(candidate);
        if (code === null || fenceHash(code) !== hash)
            continue;
        if (candidate === block)
            index = count;
        count += 1;
    }
    return index < 0 ? null : { index, count };
}
/** 歧义哈希：按 DOM 文档序取第 N 个候选；DOM 内同哈希块数与候选数不符 → 整块放弃。 */
function fenceLangAtDocumentOrder(block, hash, langs) {
    const position = sameHashPosition(block, hash);
    if (position === null || position.count !== langs.length || position.index >= langs.length)
        return undefined;
    return langs[position.index];
}
/**
 * 块的围栏语言（新来源：会话事件流哈希表）。取不到 / 有歧义 → undefined
 * （调用方回退到原有的 DOM 契约读法）。**绝不猜语言**。
 */
function fenceLangOf(block) {
    try {
        const entry = fenceIndex.byHash.size === 0 ? null : fenceBlockCode(block);
        if (entry === null)
            return undefined;
        const hash = fenceHash(entry);
        const langs = hash === '' ? undefined : fenceIndex.byHash.get(hash);
        if (langs === undefined)
            return undefined;
        const first = langs[0];
        if (langs.every((lang) => lang === first))
            return first;
        return fenceLangAtDocumentOrder(block, hash, langs);
    }
    catch (_e) {
        return undefined;
    }
}
Object.assign(exports,{MAX_FENCE_EVENTS,MAX_FENCE_CODE_CHARS,fenceNormalize,fenceHash,fenceInfoLang,collectFences,refreshFenceLangIndex,resetFenceIndex});
exports.fenceIndexSize = () => fenceIndex.byHash.size;
Object.assign(exports,{fenceLangOf});

    // 非标准表格容错（官方 GFM 未覆盖的两种写法）
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
Object.assign(exports,{normalizeTables,isTableSeparator,isTableHeader,splitTableCells});

    // 渲染依赖懒加载：marked（解析层）/ highlight.js（高亮层），走 assets 静态路由
    "use strict";
// ── 渲染依赖的懒加载（marked 解析层 / highlight.js 高亮层）─────────────────
// 与 mermaid 引擎**同一套模式**：vendored UMD 放 assets/，host 半 /md-render/assets
// 静态托管，client 首次真正需要时才 fetch + 注入 <script>，**不进 lib/client.js**
// （用户口径：打包体积不用控、只控启动速度 —— 两个库合计 ~176 KB 若内联会直接抬高
// 首屏解析成本，懒加载对启动是 0 增量）。
//
// 契约（与 mermaid-engine.ts 同款，判据由测试钉住）：
//   · 全局优先：页面里已有 window.marked / window.hljs（别的插件先加载过 / 复跑）→ 直接复用，零请求；
//   · 同名去重：同一个库只 fetch 一次；失败**不再重试**（渲染退回宿主官方形态，静默不报错）；
//   · 就绪通知：加载完成 → 通知订阅者（scanner 据此重扫，把「加载期间落在官方形态」的块补渲染）；
//   · 任何异常都吞掉（fetch 失败 / 注入失败 / 无 document）→ 调用方拿到 null 走降级。
/** 库名（也是 window 上的全局变量名）：marked = markdown 解析层，hljs = 语法高亮层。 */
const MARKED_ASSET = 'marked';
const HLJS_ASSET = 'hljs';
/** 两个懒加载库（URL 由构建期从 host 半 routes/paths.ts 注入，单一真源）。 */
const renderAssetTable = {
    [MARKED_ASSET]: { url: MARKED_URL, global: MARKED_ASSET, promise: null, failed: false },
    [HLJS_ASSET]: { url: HIGHLIGHTJS_URL, global: HLJS_ASSET, promise: null, failed: false },
};
/** 已就绪的库数（进幂等签名：库到位后块要重建一次，把纯文本换成高亮 / 渲染态）。 */
let renderAssetVersion = 0;
/** 就绪订阅者（scanner 装配；teardown 清空，防跨 fiber 泄漏）。 */
let renderAssetListeners = [];
/** 取全局对象（非对象 / 未加载 → null）。 */
function renderAssetGlobal(name) {
    const value = typeof window !== 'undefined' ? window[name] : undefined;
    return value !== null && value !== undefined && typeof value === 'object' ? value : null;
}
/** 注入脚本并复查全局（注入后仍缺失 → 抛错，由调用方转成失败态）。 */
function injectRenderAsset(code, globalName) {
    const script = document.createElement('script');
    script.textContent = code;
    document.head.appendChild(script);
    const loaded = renderAssetGlobal(globalName);
    if (loaded === null)
        throw new Error('render asset missing after injection: ' + globalName);
    return loaded;
}
/** fetch + 注入（无 document / fetch / 非 200 一律 reject）。 */
function fetchRenderAsset(entry) {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
        return Promise.reject(new Error('no document to inject render asset'));
    }
    if (typeof fetch !== 'function')
        return Promise.reject(new Error('no fetch for render asset'));
    return fetch(entry.url)
        .then((resp) => {
        if (resp === null || resp === undefined || resp.ok === false) {
            throw new Error('render asset fetch failed: ' + entry.url);
        }
        return resp.text();
    })
        .then((code) => injectRenderAsset(code, entry.global));
}
/** 广播「某个库已就绪」（订阅者内部自会判断自己关心的那一个）。 */
function noteRenderAssetReady() {
    renderAssetVersion += 1;
    const listeners = renderAssetListeners;
    renderAssetListeners = [];
    for (const listener of listeners) {
        try {
            listener();
        }
        catch (_e) {
            /* 订阅者异常不阻断其它订阅者 */
        }
    }
}
/**
 * 确保某个库可用：已加载 → 同步返回全局；否则启动一次 fetch 并返回 null。
 * 调用方拿到 null 时**保持宿主官方形态**，等就绪通知后的重扫再接管（真降级）。
 */
function ensureRenderAsset(name) {
    const entry = renderAssetTable[name];
    if (entry === undefined)
        return null;
    const existing = renderAssetGlobal(entry.global);
    if (existing !== null)
        return existing;
    if (entry.failed)
        return null;
    if (entry.promise === null) {
        entry.promise = fetchRenderAsset(entry)
            .then((loaded) => {
            noteRenderAssetReady();
            return loaded;
        })
            .catch(() => {
            // 失败即放弃（本会话不再重试）：块停在宿主官方形态，不报错、不刷屏。
            entry.failed = true;
            entry.promise = null;
            return null;
        });
    }
    return null;
}
/** 已就绪库数（进幂等签名；库到位后签名变化 → 块重建一次）。 */
function renderAssetsReady() {
    return renderAssetVersion;
}
/** 订阅「库就绪」（返回撤销函数）。 */
function installRenderAssetReady(listener) {
    renderAssetListeners.push(listener);
    return () => {
        renderAssetListeners = renderAssetListeners.filter((item) => item !== listener);
    };
}
// teardown 只清订阅者：脚本已在页面里、全局仍在，重扫（re-apply）时秒命中，不重复请求。
function teardownRenderAssets() {
    renderAssetListeners = [];
}
Object.assign(exports,{MARKED_URL,HIGHLIGHTJS_URL,MARKED_ASSET,HLJS_ASSET,ensureRenderAsset,renderAssetsReady,installRenderAssetReady,teardownRenderAssets});

    // 自有渲染容器的 React root 管理（不再 require 官方组件）
    "use strict";
// ── 自有渲染容器的 React root 管理（不再依赖官方组件）────────────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」「代码渲染使用我们自己的」。
// 本插件插入的容器里跑的是**自研渲染器**产出的 vdom，由平台 seed 模块
// react-dom/client 的 createRoot 落到 DOM（与 mermaid 卡片同一手法，零安装零打包）。
// 本模块不再 require 官方 UI 组件库（ui-primitives）—— 官方 MarkdownText / CodeBlock
// 已完全不参与本插件的内容渲染。
//
// 只保留两件事：
//  1. 解析 react-dom/client（缺失 → 真降级：DOM 注入点不动宿主 DOM、MarkdownView 落 <pre>）；
//  2. 「容器 → root」映射（可枚举 + WeakRef）：宿主重渲染把容器连节点一起抹掉时，
//     悬挂的 React root 必须 unmount，否则 root 与 fiber 树一直活着。
let domRootPlatform;
/** 解析 react-dom/client（字面量 spec：check-client-modules.mjs 以 AST 提取字面量 require）。 */
function platformDomRoot() {
    if (domRootPlatform !== undefined)
        return domRootPlatform;
    let createRoot = null;
    try {
        const reactDomClient = require('react-dom/client');
        createRoot = reactDomClient ? reactDomClient.createRoot : null;
    }
    catch (_e) {
        createRoot = null;
    }
    domRootPlatform =
        typeof createRoot === 'function' ? { createRoot: createRoot } : null;
    return domRootPlatform;
}
/** 自研渲染器的挂载能力是否可用（react-dom/client 在）。 */
function domRootAvailable() {
    const platform = platformDomRoot();
    return platform !== null && platform.createRoot !== null;
}
/**
 * 容器 → React root。
 *
 * 用 `Map` + `WeakRef` 而不是 `WeakMap`：**需要能枚举**以清扫「宿主把容器连同
 * 我们的节点一起重渲染掉」留下的悬挂 root（容器已脱离文档 → 必须 unmount，否则
 * React root 与其 fiber 树一直活着）。WeakRef 保证条目不会让容器本身无法回收。
 */
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
 * 把 vdom 渲染进容器（复用容器上已有的 root）。
 * @returns react-dom/client 不可用 → false（调用方保持宿主原样，真降级）。
 */
function renderNodeInto(container, node) {
    const platform = platformDomRoot();
    if (platform === null || platform.createRoot === null)
        return false;
    let root = rootOf(container);
    if (root === undefined) {
        root = platform.createRoot(container);
        trackRoot(container, root);
    }
    root.render(node);
    return true;
}
/**
 * 把 markdown 原文渲染进容器（**自研渲染器**；表格容错在 markdownNodes 内）。
 * @returns marked 未就绪 / react-dom 不可用 → false（调用方保持宿主原样）。
 */
function renderMarkdownInto(container, text) {
    const nodes = markdownNodes(text);
    if (nodes === null)
        return false;
    return renderNodeInto(container, nodes);
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
Object.assign(exports,{platformDomRoot,domRootAvailable,renderNodeInto,renderMarkdownInto,unmountMarkdownIn,sweepDetachedRoots});

    // 自研代码块渲染（hljs 高亮 + 真实语言名 banner + 复制 + 自动换行）
    "use strict";
// ── 自研代码块渲染（语法高亮 + 真实语言名 banner + 复制 + 自动换行）──────────
// 用户口径（最高优先级）：「代码渲染使用我们自己的，不要使用原生的」。
// 本模块**不调用官方 CodeBlock / MarkdownText**：banner 自己画（语言名用**围栏 info
// string 的真实 token**，不是官方的本地化标签「代码块」）、复制按钮自己实现、
// 高亮走懒加载的 highlight.js（assets/highlightjs-*.min.js，不进 bundle）。
//
// 高亮实现（刻意不用 innerHTML）：
//   highlight.js 的结果对象带 `_emitter` 令牌树（root.children：字符串 / {scope,children}），
//   本模块按 hljs 自己的 `scopeToCSSClass` 口径把 scope 映射成 `hljs-*` class，再落成
//   **React vdom span** —— 全程没有字符串拼 HTML、没有 dangerouslySetInnerHTML，
//   模型输出不会被当 HTML 执行（与官方「raw HTML 保持字面文本」同一条安全口径）。
//
// 降级（真降级）：hljs 没加载好 / 语言不在 hljs 语言表 / 超长（> MAX_HIGHLIGHT_CHARS）
//   一律渲染**纯文本**代码块（内容一字不少，只是没有着色）；hljs 就绪后签名变化会重建一次。
/** 代码块渲染容器类名（block-render.ts 插入块内的自有节点）。 */
const CODE_HOST_CLASS = 'dsh-md-render-code-host';
/** 代码卡片类名。 */
const CODE_VIEW_CLASS = 'dsh-md-render-code';
/** banner 行 / 语言名 / 操作区 / 复制按钮类名。 */
const CODE_HEAD_CLASS = 'dsh-md-render-code-head';
const CODE_LANG_CLASS = 'dsh-md-render-code-lang';
const CODE_ACTIONS_CLASS = 'dsh-md-render-code-actions';
const CODE_COPY_CLASS = 'dsh-md-render-code-copy';
/** 换行切换按钮类名 / 换行态下追加到 pre 的类名（**默认不换行** = 横向滚动）。 */
const CODE_WRAP_BTN_CLASS = 'dsh-md-render-code-wrap-btn';
const CODE_WRAP_CLASS = 'dsh-md-render-code-wrap';
/** 代码主体行（行号列 + pre 的横向滚动容器）/ 行号列 / 行号切换按钮类名。 */
const CODE_BODY_CLASS = 'dsh-md-render-code-body';
const CODE_NUMS_CLASS = 'dsh-md-render-code-nums';
const CODE_LINES_BTN_CLASS = 'dsh-md-render-code-lines-btn';
/** 代码主体容器（pre）/ 无高亮时的纯文本 code 类名。 */
const CODE_PRE_CLASS = 'dsh-md-render-code-pre';
const CODE_TEXT_CLASS = 'dsh-md-render-code-text';
/** hljs class 前缀（hljs 的 options.classPrefix 默认值，逐字对齐）。 */
const HLJS_CLASS_PREFIX = 'hljs-';
/** 单块高亮上限（字符）：超出只做纯文本渲染（高亮是 O(代码长度) 的正则扫描）。 */
const MAX_HIGHLIGHT_CHARS = 60000;
/**
 * hljs scope → CSS class（与 hljs HTMLRenderer 的 `scopeToCSSClass` **逐字同口径**）：
 *  · `language:xxx` → `language-xxx`（子语言）；
 *  · 分级 scope `comment.line` → `hljs-comment line`；
 *  · 简单 scope `keyword` → `hljs-keyword`。
 */
function hljsScopeClass(scope) {
    const name = String(scope ?? '');
    if (name === '')
        return '';
    if (name.indexOf('language:') === 0)
        return name.replace('language:', 'language-');
    if (name.indexOf('.') >= 0) {
        const pieces = name.split('.');
        const head = pieces.shift() ?? '';
        const tail = pieces.map((piece, index) => piece + '_'.repeat(index + 1));
        return [HLJS_CLASS_PREFIX + head, ...tail].join(' ');
    }
    return HLJS_CLASS_PREFIX + name;
}
/** 令牌树 → vdom 子节点（无 scope 的容器节点**不包 span**，与 hljs 的 emitsWrappingTags 一致）。 */
function hljsChildren(node, keyBase, out) {
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (typeof child === 'string') {
            out.push(child);
            continue;
        }
        if (child === null || typeof child !== 'object')
            continue;
        const key = keyBase + '-' + i;
        const inner = [];
        hljsChildren(child, key, inner);
        const className = hljsScopeClass(child.scope);
        if (className === '') {
            for (const item of inner)
                out.push(item);
            continue;
        }
        out.push(createElement('span', { key, className }, ...inner));
    }
}
/** 从 hljs 结果里取令牌树根（结果 / _emitter / root 任一层缺失 → null）。 */
function hljsRootOf(result) {
    if (result === null || result === undefined)
        return null;
    const emitter = result._emitter;
    if (emitter === null || emitter === undefined)
        return null;
    const root = emitter.root;
    return root === null || root === undefined ? null : root;
}
/** 真正调 hljs（语言存在但语法扫描抛错 → 纯文本降级，不冒泡）。 */
function highlightWith(hljs, lang, code) {
    try {
        if (!hljs.getLanguage.call(hljs, lang))
            return null;
        const result = hljs.highlight.call(hljs, code, {
            language: lang,
            ignoreIllegals: true,
        });
        const root = hljsRootOf(result);
        if (root === null)
            return null;
        const out = [];
        hljsChildren(root, 'hl', out);
        return out.length === 0 ? null : out;
    }
    catch (_e) {
        return null;
    }
}
/**
 * 高亮一段代码：返回 vdom 子节点数组；**任何一步不成立就返回 null**（调用方渲染纯文本）。
 * 用 hljs 结果里的 `_emitter` 令牌树，不消费它的 HTML 字符串。
 */
function highlightCodeNodes(lang, code) {
    if (lang === '' || code === '' || code.length > MAX_HIGHLIGHT_CHARS)
        return null;
    const hljs = ensureRenderAsset(HLJS_ASSET);
    if (hljs === null)
        return null;
    if (typeof hljs.getLanguage !== 'function')
        return null;
    return highlightWith(hljs, lang, code);
}
/** 代码主体：有高亮 → hljs class 的 span 树；否则纯文本（内容一字不少）。 */
function codeBodyNodes(lang, source) {
    const nodes = highlightCodeNodes(lang, source);
    if (nodes === null)
        return createElement('code', { className: CODE_TEXT_CLASS }, source);
    return createElement('code', { className: HLJS_CLASS_PREFIX + 'code' }, ...nodes);
}
/**
 * 行号列文本：按**逻辑行**（`\n` 切分）逐行编号，与代码行一一对齐。
 * 用 `\n` join + `white-space:pre` 呈现，行高与 pre 同源 → 两列天然对齐。
 */
function lineNumbersText(source) {
    const count = source.split('\n').length;
    const out = [];
    for (let i = 1; i <= count; i += 1)
        out.push(String(i));
    return out.join('\n');
}
/**
 * 自研代码块：banner（真实语言名 + 行号切换 + 换行切换 + 复制）+ pre。
 *
 * 行号切换（原型 §代码围栏块 的 lines-btn）：**默认关闭**（与现状默认形态一致），
 * 打开后左侧出现行号列，与代码同行高对齐。行号列按逻辑行编号，**换行态下自动隐藏**
 * （自动换行后一个逻辑行会占多行物理行，行号列会错位）；点行号时若处于换行态，
 * 先收起换行再开行号，避免「按了没反应」。
 *
 * 换行切换（官方 CodeToolbar 有、此前自研版漏掉的能力）：按钮排在**复制之前**，
 * 点一次在「不换行（横向滚动）」与「自动换行」之间切换，可访问名 / aria-pressed 同步。
 * **默认不换行** —— 与现状（以及官方默认形态）一致，不改变默认视觉行为。
 *
 * `lang` 为空 = 该块语言识别不出 —— 此时**不编造语言名**，banner 语言位留空。
 */
function CodeBlockView({ lang, code }) {
    const [copied, setCopied] = useState(false);
    const [wrap, setWrap] = useState(false);
    const [lines, setLines] = useState(false);
    const source = typeof code === 'string' ? code : String(code ?? '');
    const onCopy = () => {
        copyText(source).then(() => setCopied(true), () => { });
    };
    const onToggleWrap = () => setWrap(!wrap);
    const onToggleLines = () => {
        if (!lines && wrap)
            setWrap(false);
        setLines(!lines);
    };
    /** 行号列只在「已开启且未换行」时出现（换行后逻辑行 ≠ 物理行，行号必然错位）。 */
    const showLines = lines && !wrap;
    const copyLabel = copied ? '已复制' : '复制';
    const wrapLabel = wrap ? '取消换行' : '自动换行';
    const linesLabel = lines ? '隐藏行号' : '显示行号';
    return createElement('div', { className: CODE_VIEW_CLASS }, createElement('div', { className: CODE_HEAD_CLASS }, createElement('span', { className: CODE_LANG_CLASS }, lang === '' ? '' : lang), createElement('div', { className: CODE_ACTIONS_CLASS }, createElement('button', {
        type: 'button',
        className: CODE_LINES_BTN_CLASS,
        'aria-label': linesLabel,
        'data-dsh-md-render-tip': linesLabel,
        'aria-pressed': lines ? 'true' : 'false',
        onClick: onToggleLines,
    }, icon.lines(14)), createElement('button', {
        type: 'button',
        className: CODE_WRAP_BTN_CLASS,
        'aria-label': wrapLabel,
        // data-dsh-md-render-tip = 悬停浮层文字（styles.ts 的 [data-dsh-md-render-tip]::after）；文字收起后它是唯一的可视提示。
        'data-dsh-md-render-tip': wrapLabel,
        // 字符串而非布尔：React 对 aria-* 会原样写成 aria-pressed="true|false"。
        'aria-pressed': wrap ? 'true' : 'false',
        onClick: onToggleWrap,
    }, 
    // 图标常显（本轮补齐 wrap 图标）：没有图标的按钮收起文字就成空按钮。
    icon.wrap(14)), createElement('button', {
        type: 'button',
        className: CODE_COPY_CLASS,
        'aria-label': copyLabel,
        // 状态也写进 data-state：styles.ts 靠它让成功态的浮层**常显** + 图标换勾（状态不能只靠悬停才知道）。
        'data-state': copied ? 'copied' : 'idle',
        'data-dsh-md-render-tip': copyLabel,
        onClick: onCopy,
    }, 
    // 图标常显、文字走悬停浮层（styles.ts 的 [data-dsh-md-render-tip]::after）。
    icon.copy(14)))), 
    // 行号列与 pre 同属一个横向滚动容器：代码横向滚动时行号列一起走（原型 fence-body 同构）。
    createElement('div', { className: CODE_BODY_CLASS }, showLines
        ? createElement('div', { className: CODE_NUMS_CLASS, 'aria-hidden': 'true' }, lineNumbersText(source))
        : null, 
    // 换行态只**追加**类名，原有 CODE_PRE_CLASS 保留（样式由 styles.ts 统一提供）。
    createElement('pre', { className: CODE_PRE_CLASS + (wrap ? ' ' + CODE_WRAP_CLASS : ''), tabIndex: 0 }, codeBodyNodes(lang, source))));
}
Object.assign(exports,{CODE_HOST_CLASS,CODE_VIEW_CLASS,CODE_LANG_CLASS,CODE_WRAP_BTN_CLASS,CODE_WRAP_CLASS,CODE_BODY_CLASS,CODE_NUMS_CLASS,CODE_LINES_BTN_CLASS,CODE_PRE_CLASS,MAX_HIGHLIGHT_CHARS,hljsScopeClass,lineNumbersText,highlightCodeNodes,CodeBlockView});

    // 自研 markdown 渲染（marked 词法树 → vdom，表格容错在此接上）
    "use strict";
// ── 自研 markdown 渲染（marked 解析 → React vdom）───────────────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」。本模块**不调用
// 官方 MarkdownText**：markdown → marked 词法树 → 本插件自己的 React 元素（自有 class，
// 只在 .tzx-md 作用域内由自有 CSS 上色，样式全部取 --dsw-* 变量）。
//
// 安全口径（与官方 MarkdownText 逐条对齐）：
//   · **raw HTML 一律当字面文本**（marked 的 html token 渲染成文本节点，React 会转义）——
//     模型输出永远不会被当 HTML 执行；
//   · 链接只放行 http / https / mailto 与同源相对路径（`/…`，不含 `//host`）；
//   · 图片只放行 http / https 与同源相对路径；其余渲染 alt 文本；
//   · 全程没有 innerHTML / dangerouslySetInnerHTML。
//
// 解析层懒加载（assets/marked-*.umd.js，不进 bundle）：marked 未就绪 → 返回 null，
// 调用方保持宿主官方形态；就绪通知后的重扫再接管（真降级，绝不丢内容）。
// 表格容错沿用既有 normalizeTables（GFM 不认的两种分隔行写法先规范化）。
// 数学公式不做（用户明确：暂不做）。
/** markdown 文本内的行内代码类名。 */
const MD_CODE_CLASS = 'dsh-md-render-md-code';
/** 图片类名 / 可点击放大的**追加**类名（点击走 image-lightbox.ts 的原生 dialog 灯箱）。 */
const MD_IMG_CLASS = 'dsh-md-render-md-img';
const MD_IMG_ZOOM_CLASS = 'dsh-md-render-img-zoom';
/** 解析异常时的原文兜底容器类名（内容一字不丢）。 */
const MD_PLAIN_CLASS = 'dsh-md-render-md-plain';
/** 表格单元格对齐 class（不用行内 style / 不用 align 属性）。 */
const MD_ALIGN_CLASSES = {
    left: 'dsh-md-render-md-left',
    center: 'dsh-md-render-md-center',
    right: 'dsh-md-render-md-right',
};
/** 链接放行的协议（与官方 sanitizeUrl 同口径）。 */
const MD_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];
/** info string → 语言 token（`{js}` / `.js` 花括号与点前缀写法也认，取首个空白分隔 token）。 */
const MD_LANG_TOKEN_RE = /^\{?\.?([A-Za-z0-9_+#-]*)\}?$/;
/** 任意值 → markdown 文本（null / undefined → 空串）。 */
function mdText(value) {
    if (typeof value === 'string')
        return value;
    return value === null || value === undefined ? '' : String(value);
}
/** info string → 小写语言 token（无语言 → 空串）。 */
function mdInfoLang(info) {
    const token = mdText(info).trim().split(/\s+/)[0] ?? '';
    const matched = MD_LANG_TOKEN_RE.exec(token);
    return (matched === null ? token : matched[1]).toLowerCase();
}
/** 归一化后的对象形态 token（非对象 → 空对象）。 */
function mdToken(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
/** 标题层级收敛到 h1–h6（marked 可能给出 7+ 的畸形层级）。 */
function mdHeadingTag(depth) {
    const value = Number(depth);
    const level = Number.isFinite(value) ? Math.min(6, Math.max(1, Math.trunc(value))) : 1;
    return 'h' + String(level);
}
/** 表格列对齐 class 后缀（未知 / 缺省 → 空）。 */
function mdAlignClass(align) {
    const name = mdText(align);
    return Object.prototype.hasOwnProperty.call(MD_ALIGN_CLASSES, name) ? ' ' + MD_ALIGN_CLASSES[name] : '';
}
/** 安全链接目标：http / https / mailto 或同源相对路径；其余返回空串（渲染为纯文本）。 */
function mdSafeHref(url) {
    const value = mdText(url);
    if (value === '')
        return '';
    try {
        const protocol = new URL(value).protocol;
        return MD_LINK_PROTOCOLS.indexOf(protocol) >= 0 ? value : '';
    }
    catch (_e) {
        return value.charAt(0) === '/' && value.charAt(1) !== '/' ? value : '';
    }
}
/** 安全图片地址：http / https 或同源相对路径；其余返回空串（渲染 alt 文本）。 */
function mdSafeImageSrc(url) {
    const value = mdText(url);
    if (value === '')
        return '';
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:' ? value : '';
    }
    catch (_e) {
        return value.charAt(0) === '/' && value.charAt(1) !== '/' ? value : '';
    }
}
/** 行内 token 数组 → vdom 子节点。 */
function mdInlineChildren(tokens, keyBase) {
    if (!Array.isArray(tokens))
        return [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const node = mdInlineNode(tokens[i], keyBase + '-' + i);
        if (node !== null)
            out.push(node);
    }
    return out;
}
/** 语义强调类行内 token（strong / em / del → 同名 HTML 标签）。 */
const MD_EMPHASIS_TAGS = { strong: 'strong', em: 'em', del: 'del' };
/** 行内 token → vdom 节点（未知 token 原样出文本，绝不丢内容）。 */
function mdInlineNode(token, key) {
    const t = mdToken(token);
    const type = mdText(t.type);
    if (Object.prototype.hasOwnProperty.call(MD_EMPHASIS_TAGS, type)) {
        return createElement(MD_EMPHASIS_TAGS[type], { key }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'codespan') {
        // 与官方一致：行内代码里的换行按空格显示。
        return createElement('code', { key, className: MD_CODE_CLASS }, mdText(t.text).replace(/\r?\n|\r/g, ' '));
    }
    if (type === 'br')
        return createElement('br', { key });
    if (type === 'link')
        return mdLinkNode(t, key);
    if (type === 'image')
        return mdImageNode(t, key);
    // text / escape / html（与官方一致：raw HTML 当字面文本，React 负责转义）/ 未知 token
    return mdText(t.text);
}
/** 链接：目标不安全 → 退化为纯文本（不产生可点击的 javascript: / data: 目标）。 */
function mdLinkNode(t, key) {
    const children = mdInlineChildren(t.tokens, key);
    const href = mdSafeHref(t.href);
    if (href === '')
        return createElement('span', { key, className: 'dsh-md-render-md-link-plain' }, ...children);
    const title = mdText(t.title);
    return createElement('a', {
        key,
        className: 'dsh-md-render-md-link',
        href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: title === '' ? undefined : title,
    }, ...children);
}
/**
 * 放大键：Enter / 空格与点击同路。
 * 图片是可点击的放大入口，样式给了 :focus-visible 焦点环（styles.ts），
 * 因此必须真能键盘触达 —— 只做鼠标等于焦点环是死的。
 */
function mdImageZoomKey(src, alt, event) {
    const key = String(event.key ?? '');
    if (key !== 'Enter' && key !== ' ')
        return;
    if (typeof event.preventDefault === 'function')
        event.preventDefault();
    openImageLightbox(src, alt);
}
/**
 * 图片：地址不安全 → 渲染 alt 文本（不加载任何来路不明的资源）。
 * 地址安全 → 图片带 MD_IMG_ZOOM_CLASS，点一下（或 Enter / 空格）开原生 <dialog>
 * 灯箱放大（image-lightbox.ts；灯箱内对 src 再走一次同一安全口径）。
 */
function mdImageNode(t, key) {
    const alt = mdText(t.text);
    const src = mdSafeImageSrc(t.href);
    if (src === '')
        return createElement('span', { key, className: 'dsh-md-render-md-img-alt' }, alt);
    const title = mdText(t.title);
    return createElement('img', {
        key,
        className: MD_IMG_CLASS + ' ' + MD_IMG_ZOOM_CLASS,
        src,
        alt,
        title: title === '' ? undefined : title,
        loading: 'lazy',
        tabIndex: 0,
        onClick: () => openImageLightbox(src, alt),
        onKeyDown: (event) => mdImageZoomKey(src, alt, event),
    });
}
/** 表格单元格（th / td；对齐走自有 class）。 */
function mdCellNode(cell, key, tag, align) {
    return createElement(tag, { key, className: 'dsh-md-render-md-cell' + mdAlignClass(align) }, ...mdInlineChildren(mdToken(cell).tokens, key));
}
/** 表格（外层包一个横向滚动容器，宽表格不撑破消息区）。 */
function mdTableNode(t, key) {
    const header = Array.isArray(t.header) ? t.header : [];
    const rows = Array.isArray(t.rows) ? t.rows : [];
    const aligns = Array.isArray(t.align) ? t.align : [];
    const headRow = createElement('tr', { key: key + '-head' }, ...header.map((cell, index) => mdCellNode(cell, key + '-h-' + index, 'th', aligns[index])));
    const bodyRows = rows.map((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : [];
        return createElement('tr', { key: key + '-r-' + rowIndex }, ...cells.map((cell, index) => mdCellNode(cell, key + '-r-' + rowIndex + '-' + index, 'td', aligns[index])));
    });
    return createElement('div', { key, className: 'dsh-md-render-md-table-wrap' }, createElement('table', { className: 'dsh-md-render-md-table' }, createElement('thead', null, headRow), createElement('tbody', null, ...bodyRows)));
}
/**
 * 列表项内容：tight 列表的 `text` token 直接出行内节点，其余（段落 / 嵌套列表 / 代码块…）
 * 按块渲染 —— 与 marked 的 tight / loose 语义一致，且不额外包一层 `<p>`。
 */
function mdItemChildren(item, keyBase) {
    const tokens = Array.isArray(item.tokens) ? item.tokens : [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const key = keyBase + '-i-' + i;
        const t = mdToken(tokens[i]);
        if (t.type === 'text') {
            if (Array.isArray(t.tokens)) {
                for (const node of mdInlineChildren(t.tokens, key))
                    out.push(node);
            }
            else {
                out.push(mdText(t.text));
            }
            continue;
        }
        const node = mdBlockNode(tokens[i], key);
        if (node === null)
            continue;
        if (Array.isArray(node)) {
            for (const item2 of node)
                out.push(item2);
        }
        else {
            out.push(node);
        }
    }
    return out;
}
/** 列表项（任务列表渲染成只读复选框）。 */
function mdItemNode(item, key) {
    const t = mdToken(item);
    const children = mdItemChildren(t, key);
    if (t.task !== true)
        return createElement('li', { key, className: 'dsh-md-render-md-li' }, ...children);
    const box = createElement('input', {
        key: key + '-task',
        className: 'dsh-md-render-md-task',
        type: 'checkbox',
        checked: t.checked === true,
        disabled: true,
        readOnly: true,
    });
    return createElement('li', { key, className: 'dsh-md-render-md-li dsh-md-render-md-task-item' }, box, ...children);
}
/** 列表（有序列表按 marked 的 start 还原起始序号）。 */
function mdListNode(t, key) {
    const ordered = t.ordered === true;
    const items = Array.isArray(t.items) ? t.items : [];
    const start = Number(t.start);
    const startAttr = ordered && Number.isFinite(start) && start > 1 ? start : undefined;
    return createElement(ordered ? 'ol' : 'ul', { key, className: 'dsh-md-render-md-list', start: startAttr }, ...items.map((item, index) => mdItemNode(item, key + '-' + index)));
}
/** 围栏代码块（markdown 内部的代码块：同样走**自研**代码块渲染器）。 */
function mdCodeNode(t, key) {
    return createElement(CodeBlockView, { key, lang: mdInfoLang(t.lang), code: mdText(t.text) });
}
/** 内容全是行内 token 的块级类型（paragraph / heading / text / html）。 */
const MD_TEXT_BLOCK_TYPES = ['paragraph', 'heading', 'text', 'html'];
/** 行内内容块 → vdom 节点（html 按字面文本出一段，其余按标签渲染）。 */
function mdTextBlockNode(type, t, key) {
    if (type === 'paragraph') {
        return createElement('p', { key, className: 'dsh-md-render-md-p' }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'heading') {
        return createElement(mdHeadingTag(t.depth), { key, className: 'dsh-md-render-md-h' }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'html')
        return createElement('p', { key, className: 'dsh-md-render-md-html' }, mdText(t.text));
    return mdInlineChildren(t.tokens, key); // 'text'（tight 列表项）
}
/** 块级 token → vdom 节点（null = 不产出；数组 = 展开多个）。 */
function mdBlockNode(token, key) {
    const t = mdToken(token);
    const type = mdText(t.type);
    if (MD_TEXT_BLOCK_TYPES.indexOf(type) >= 0)
        return mdTextBlockNode(type, t, key);
    if (type === 'blockquote') {
        return createElement('blockquote', { key, className: 'dsh-md-render-md-quote' }, ...mdBlockChildren(t.tokens, key));
    }
    if (type === 'code')
        return mdCodeNode(t, key);
    if (type === 'table')
        return mdTableNode(t, key);
    if (type === 'list')
        return mdListNode(t, key);
    if (type === 'hr')
        return createElement('hr', { key, className: 'dsh-md-render-md-hr' });
    return null; // space / def / 未知 token
}
/** 块级 token 数组 → vdom 子节点数组（展开嵌套数组，保持 key 稳定）。 */
function mdBlockChildren(tokens, keyBase) {
    if (!Array.isArray(tokens))
        return [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const node = mdBlockNode(tokens[i], keyBase + '-' + i);
        if (node === null)
            continue;
        if (Array.isArray(node)) {
            for (const item of node)
                out.push(item);
        }
        else {
            out.push(node);
        }
    }
    return out;
}
/**
 * markdown 文本 → vdom 子节点数组（调用方放进 `.tzx-md` 容器）。
 * @returns null = marked 还没就绪（调用方保持宿主官方形态，等就绪重扫）；
 *          数组 = 渲染结果（解析异常时退化为原文 `<pre>`，内容一字不丢）。
 */
function markdownNodes(text) {
    const source = mdText(text);
    const marked = ensureRenderAsset(MARKED_ASSET);
    if (marked === null)
        return null;
    const lexer = marked.lexer;
    if (typeof lexer !== 'function')
        return null;
    let tokens = null;
    try {
        // 表格容错沿用既有实现：GFM 不认的两种分隔行写法先规范化再进解析器。
        tokens = lexer.call(marked, normalizeTables(source));
    }
    catch (_e) {
        tokens = null;
    }
    if (!Array.isArray(tokens))
        return [createElement('pre', { key: 'md-plain', className: MD_PLAIN_CLASS }, source)];
    return mdBlockChildren(tokens, 'md');
}
Object.assign(exports,{MD_CODE_CLASS,MD_IMG_CLASS,MD_IMG_ZOOM_CLASS,MD_PLAIN_CLASS,mdInfoLang,mdSafeHref,mdSafeImageSrc,markdownNodes});

    // markdown 图片点击放大灯箱（原生 <dialog>，三路关闭）
    "use strict";
// ── markdown 图片「点击放大」灯箱（原生 <dialog> 模态）──────────────────────
// 用户反馈：图片只能静态看、点不开 —— 成熟方案（medium-zoom / PhotoSwipe /
// lightGallery）都支持点击放大。这里只借这条交互，实现用**原生 <dialog> +
// showModal()**（与本插件 mermaid 浮窗同款做法：零依赖，遮罩 / Esc / 焦点归还
// 由浏览器兜底），不引入任何三方库。
//
// 三路关闭：Esc（dialog 的 cancel 事件）/ 点击遮罩（点击落在 dialog 自身 =
// 点了 ::backdrop）/ 点击图片（想立刻收起时不必去够边缘）。关闭即把 dialog 从
// 文档移除（不留残留节点）；同一时刻只保留一个灯箱（再点第二张图先收掉上一个）。
//
// 安全口径与 markdown 渲染完全一致：src 仍过 mdSafeImageSrc（只放行 http / https
// 与同源相对路径），未放行的地址**不打开灯箱**；全程只有 DOM API（className /
// src / alt 属性赋值），没有 innerHTML / dangerouslySetInnerHTML。
/** 灯箱 <dialog> 类名。 */
const LIGHTBOX_CLASS = 'dsh-md-render-img-lightbox';
/** 灯箱内大图类名。 */
const LIGHTBOX_IMG_CLASS = 'dsh-md-render-img-lightbox-img';
/** 内容包装层类名（关闭按钮的定位锚点，与原型 .dlg-wrap 同构）。 */
const LIGHTBOX_WRAP_CLASS = 'dsh-md-render-img-lightbox-wrap';
/** 关闭按钮类名（32px 圆形，挂在图片右上角外侧；叉线由 styles.ts 的 ::before/::after 画）。 */
const LIGHTBOX_CLOSE_CLASS = 'dsh-md-render-img-lightbox-close';
/** 当前打开的灯箱（同一时刻只允许一个）。 */
let imageLightbox = null;
/** 关闭灯箱（幂等；Esc / 遮罩 / 点击图片三路共用）。 */
function closeImageLightbox() {
    const dialog = imageLightbox;
    if (dialog === null)
        return;
    imageLightbox = null;
    try {
        dialog.close();
    }
    catch (_e) {
        /* 已关闭 / 伪 DOM 无此方法 */
    }
    const parent = dialog.parentNode;
    if (parent !== null && parent !== undefined)
        parent.removeChild(dialog);
}
/** 以模态方式打开（无 showModal 的环境退回 open 属性 —— 绝不静默失败）。 */
function showLightboxModal(dialog) {
    try {
        dialog.showModal();
    }
    catch (_e) {
        dialog.open = true;
    }
}
/** 点图放大；地址不在安全口径内 → 什么都不做（不加载来路不明的资源）。 */
function openImageLightbox(src, alt) {
    const safe = mdSafeImageSrc(src);
    if (safe === '' || typeof document === 'undefined' || document === null)
        return;
    closeImageLightbox();
    const dialog = document.createElement('dialog');
    dialog.className = LIGHTBOX_CLASS;
    const wrap = document.createElement('div');
    wrap.className = LIGHTBOX_WRAP_CLASS;
    const img = document.createElement('img');
    img.className = LIGHTBOX_IMG_CLASS;
    img.src = safe;
    img.alt = alt;
    wrap.appendChild(img);
    wrap.appendChild(makeLightboxCloseButton());
    dialog.appendChild(wrap);
    // ::backdrop 不是元素：点击落在 dialog 自身 = 点了遮罩；点图片同样收起。
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target === img)
            closeImageLightbox();
    });
    dialog.addEventListener('cancel', closeImageLightbox);
    document.body.appendChild(dialog);
    imageLightbox = dialog;
    showLightboxModal(dialog);
}
/**
 * 关闭按钮（原型 §C 的第四路关闭：Esc / 遮罩 / 点图之外再给一个显式出口，
 * 大图铺满时"点图片收起"不好发现）。叉线由 styles.ts 的 ::before/::after 画
 * （1.8px 圆角线，与原型 16px viewBox 的 1.8 stroke path 等价）——
 * 本文件走纯 DOM，不引 React 图标集，也不需要 createElementNS / innerHTML。
 */
function makeLightboxCloseButton() {
    const button = document.createElement('button');
    button.className = LIGHTBOX_CLOSE_CLASS;
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.addEventListener('click', closeImageLightbox);
    return button;
}
Object.assign(exports,{LIGHTBOX_CLASS,LIGHTBOX_IMG_CLASS,LIGHTBOX_WRAP_CLASS,LIGHTBOX_CLOSE_CLASS,openImageLightbox,closeImageLightbox});

    // 整段 markdown 复制（官方只有代码块复制）
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
// 外观与状态对齐原型（08-prototype.html 的 .md-copy）：图标 + 文案、data-state 三态
// （idle / copied / failed）、1.6s 回退；状态色与确认动效在 styles.ts。
// 失败态只在**两条通道都不通**时出现（clipboard → execCommand 兜底，原型 §C 同款三分支）。
function CopyButton({ kind }) {
    const [state, setState] = useState('idle');
    const [timer, setTimer] = useState(null);
    const flash = (next) => {
        setState(next);
        if (timer)
            clearTimeout(timer);
        setTimer(setTimeout(() => setState('idle'), 1600));
    };
    const onClick = (event) => {
        const host = event && event.currentTarget ? event.currentTarget.closest(kind === 'content' ? '.tzx-md' : '') : null;
        if (!host)
            return;
        const out = [];
        collectCopyText(host, out);
        const text = out.join('');
        if (!text)
            return;
        copyText(text).then(() => flash('copied'), () => flash('failed'));
    };
    const label = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择文本' : '复制整段 markdown';
    // 浮层文字要短（nowrap 一行）；完整说法留给 aria-label（屏幕阅读器）。
    // **不写 title**：自绘浮层已承担鼠标提示，原生 tooltip 会延迟 1s 叠在浮层上（实测观感冲突）。
    const tip = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制';
    return createElement('button', {
        type: 'button',
        className: 'dsh-md-render-copy',
        'data-state': state,
        'aria-label': label,
        'data-dsh-md-render-tip': tip,
        onClick,
    }, createElement('span', { className: 'dsh-md-render-copy-ico' }, state === 'copied' ? icon.check(14) : icon.copy(14)));
}
Object.assign(exports,{copyText,fallbackCopyText});

    // 统一 MarkdownView：对外公共 API（自研渲染 + 整段复制）
    "use strict";
// ── 统一 MarkdownView（对外公共 API 面）──────────────────────────────
// 对外承诺（README「公共 API 契约」）：require('dsh-md-render').MarkdownView
// 存在且为 React 组件，props 为 { text: string }（额外 props 忽略，非字符串
// 降级为文本）；bundle id 为 dsh-md-render。
//
// 实现 = **本插件自己的 markdown 渲染器**（own-markdown.ts：marked 词法树 →
// React vdom，解析层走 assets 懒加载）+ 非标准表格容错（table-normalize.ts）
// + 「整段复制」按钮（官方只有代码块复制）。**不调用官方 MarkdownText**。
// 解析层还没加载好 → 先落 <pre> 原文兜底（内容一字不丢），就绪通知触发重渲染。
/** 统一 MarkdownView：{ text } → div.tzx-md（自研渲染 + 整段复制按钮）。 */
function MarkdownView({ text }) {
    const source = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
    const [ready, setReady] = useState(false);
    const nodes = markdownNodes(source);
    // 解析层未就绪：订阅一次就绪通知，避免整段停在兜底形态（依赖数组只看 source / 就绪态）。
    useEffect(() => {
        if (nodes !== null)
            return undefined;
        return installRenderAssetReady(() => setReady(true));
    }, [source, ready]);
    return createElement('div', { className: 'tzx-md' }, 
    // 解析层未就绪 → <pre> 兜底（原文不丢、渲染期不抛错）；就绪后换成自研渲染结果。
    nodes === null ? createElement('pre', { className: 'dsh-md-render-fallback' }, source) : nodes, 
    // 整段复制按钮（copyButton 关闭 → 不渲染）；官方只有代码块复制。
    renderOptions.markdown.copyButton ? createElement(CopyButton, { kind: 'content' }) : null);
}
Object.assign(exports,{MarkdownView});

    // 上下文注入块 markdown 渲染（pre[data-context-text]）
    "use strict";
// ── 上下文注入块 markdown 渲染（自研渲染器）─────────────────────────────
// 宿主 @deepseek-ai/dsh-client-ui-chat 的 ContextBody 把上下文注入正文
// （子 agent 回传消息 / AGENTS.md 等 workspace 指令 / 回忆注入）渲染为
// <pre data-context-text="true"> 纯文本（ui-chat/src/client/chat/ContextBody.tsx:147，
// CSS white-space:pre-wrap），其中的 markdown（粗体 / 列表 / 标题 / 表格 /
// 代码块）不会渲染——官方不接管这类纯文本块，所以这是本插件的真增量。
// 本模块在 DOM 层把这类块交给**本插件自己的 markdown 渲染器**（own-markdown.ts，
// 解析层 marked 走 assets 懒加载），**不再调用官方 MarkdownText**。
//
// 与 React 共存的约束（宿主白名单是 React 管理的 DOM）：
//  - 不修改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体
//    改写 textContent，改子结构必被冲掉），只在 pre 之前插入渲染容器并
//    给 pre 置 hidden；
//  - 渲染容器写 data-signature（文本长度 + djb2 哈希 + 渲染库就绪版本），重扫时签名
//    一致且容器仍在位 → 跳过（幂等，不重复渲染、不抖动）；
//  - 宿主重建节点（会话切换 / 重渲染）冲掉容器后，MutationObserver 兜底
//    重扫会重做；pre 上的标记不影响宿主（React 不管理该属性）。
//  - 超长文本（> MAX_CONTEXT_CHARS）跳过；渲染库没就绪 / react-dom 不可用 → 不接管
//    （保持宿主纯文本，真降级；库就绪后的重扫会补上）。
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
/** 接管前置条件（开关 / 挂载能力 / 父节点 / 长度）→ 待渲染文本；不满足返回 null。 */
function contextSourceOf(pre) {
    if (!renderOptions.markdown.contextMarkdown)
        return null;
    if (!domRootAvailable())
        return null;
    const parent = pre.parentNode;
    if (!parent || typeof parent.insertBefore !== 'function')
        return null;
    const text = pre.textContent ?? '';
    if (text.length > MAX_CONTEXT_CHARS)
        return null;
    return { parent, text };
}
/** 建容器并交给**自研 markdown 渲染器**；渲染库未就绪 / 不可用 → null（调用方保持宿主原样）。 */
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
    const signature = String(source.text.length) + ':' + contextHash(source.text) + ':' + String(renderAssetsReady());
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
Object.assign(exports,{CONTEXT_TEXT_SELECTOR,MAX_CONTEXT_CHARS,contextHash,applyContextMarkdown,scanContextBlocks});

    // 围栏块接管：markdown / 代码两路（mermaid 交给下面）
    "use strict";
// ── 围栏块接管：markdown / 代码两路，全部由**自研渲染器**产出 ──────────────
// 用户口径（最高优先级）：「markdown 需要全部替换为我们自己的渲染」「代码渲染使用我们
// 自己的，不要使用原生的」。**任何语言的围栏块都由本插件接管**：
//   · mermaid / mmd     → 图表卡片（mermaid-scan.ts，语言集合不重叠）；
//   · text 家族 / 确证无语言 → 自研 markdown 渲染（own-markdown.ts）；
//   · 其余语言（js / ts / json / bash / python …）→ 自研代码块渲染（own-code.ts），
//     banner 显示**围栏语言的真实 token**（不是官方那个本地化标签「代码块」）。
//
// 官方节点一律**不删不改**：只在块内追加自有容器，靠自有 CSS 在接管视图下隐藏官方
// banner 与内容（切回「源码」时规则不再匹配，官方原样恢复）。视图状态写在块属性
// data-dsh-md-render-text-view（markdown | code | source）上，幂等靠签名（kind + 语言 +
// 长度 + 内容哈希 + **渲染库就绪版本**：marked / hljs 到位后签名变化，重建一次把
// 纯文本换成渲染态 / 高亮态）。流式块跳过（[data-streaming] 门控），稳定后再渲染。
/** 触发自研 markdown 渲染的语言标记（一律渲染，不做内容判定）。 */
const TEXT_FENCE_LANGS = ['text', 'plaintext', 'txt', 'md', 'markdown'];
/** 视图状态标记（写在 md-code-block 上，每块独立）：markdown | code | source。 */
const BLOCK_VIEW_ATTR = 'data-dsh-md-render-text-view';
/** 幂等签名标记（写在 md-code-block 上）。 */
const BLOCK_SIG_ATTR = 'data-dsh-md-render-text-sig';
/** markdown 渲染容器类名（tzx-md 为既有契约类，样式作用域见 styles.ts）。 */
const BLOCK_MD_CLASS = 'dsh-md-render-text-md';
/** 「查看原文 / 查看渲染」切换按钮类名（仅 markdown 视图需要）。 */
const BLOCK_TOGGLE_CLASS = 'dsh-md-render-text-toggle';
/** 视图 → 按钮文案（文案指向「点击后去哪」）。 */
const BLOCK_VIEW_LABELS = { markdown: '查看原文', source: '查看渲染' };
/** markdown 单块渲染上限（字符）：超长块保持官方代码块，避免单块渲染卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000;
/** 代码单块渲染上限（字符）：超出同样保持官方形态（与语言索引的上限同口径）。 */
const MAX_CODE_FENCE_CHARS = 200000;
/**
 * 块的接管类型（**唯一入口**，手动覆盖优先级最高）：
 *  ⓪ 「渲染为…」人工覆盖（lang-switch.ts 写入）：source → 不接管（官方原样）；
 *     markdown → 强制 markdown；mermaid → 交给 mermaid-scan；
 *  ① mermaid / mmd → 交给 mermaid-scan；
 *  ② text 家族，或「确证无语言」→ 自研 markdown；
 *  ③ 其余（js / json / bash / 任意语言，含「识别失败」）→ 自研代码块。
 * 识别失败也接管是用户口径（「所有围栏块都由插件接管」）：语言位留空，**绝不编造语言名**。
 */
function fenceKindOf(block) {
    const forced = fenceForceOf(block);
    if (forced === 'source')
        return { kind: 'none', lang: '' };
    if (forced === 'markdown')
        return { kind: 'markdown', lang: '' };
    if (forced === 'mermaid')
        return { kind: 'mermaid', lang: 'mermaid' };
    const resolved = resolveFenceLangEx(block);
    const lang = resolved.lang;
    if (MERMAID_FENCE_LANGS.includes(lang))
        return { kind: 'mermaid', lang };
    if (TEXT_FENCE_LANGS.includes(lang))
        return { kind: 'markdown', lang };
    if (lang === '')
        return { kind: resolved.confirmed ? 'markdown' : 'code', lang: '' };
    return { kind: 'code', lang };
}
/** 块源码：官方 <pre> 的文本（官方 display 语义：去掉一个尾部换行）。 */
function fenceSource(block) {
    const pre = block.querySelector('pre');
    const text = pre !== null ? (pre.textContent ?? '') : '';
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}
/** 本模块已渲染的容器（幂等判定用）。 */
function fenceBodyOf(block) {
    return block.querySelector('div.' + BLOCK_MD_CLASS + ', div.' + CODE_HOST_CLASS);
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]，与 scanner 同一口径）。 */
function isFenceStreaming(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/**
 * 前置门控（**在任何语言判定之前**）：开关关闭 / react-dom 不可用 / 流式块 /
 * 本插件渲染容器内的块（防递归重建）。
 *
 * 顺序很重要：语言判定会向 host 半发索引查询（未命中还有界重试），而流式补写中的块
 * 内容每批都在变（哈希必然落空）—— 先门控再判定，流式块与开关关闭的块**一次请求都不发**。
 */
function fencePreSkip(block) {
    if (!renderOptions.markdown.textFenceMarkdown)
        return true;
    if (!domRootAvailable())
        return true;
    if (isFenceStreaming(block))
        return true;
    return isInsideRenderedMarkdown(block);
}
/** 内容长度上限（markdown 与代码两档）。 */
function fenceMaxChars(kind) {
    return kind === 'markdown' ? MAX_TEXT_FENCE_CHARS : MAX_CODE_FENCE_CHARS;
}
/** 移除上一轮的渲染容器与切换按钮（源码变化 / 重建前清理）。 */
function clearFenceView(block) {
    const body = fenceBodyOf(block);
    if (body !== null) {
        unmountMarkdownIn(body);
        if (body.parentNode)
            body.parentNode.removeChild(body);
    }
    const btn = block.querySelector('button.' + BLOCK_TOGGLE_CLASS);
    if (btn !== null && btn.parentNode)
        btn.parentNode.removeChild(btn);
}
/** 同步切换按钮的可视形态：文字走 data-dsh-md-render-tip 浮层，图标 React 渲染进按钮
 *  （按钮自身是命令式 DOM + React 拥有其子节点：所以**不能**再手改 textContent）。 */
function syncFenceToggle(btn, view) {
    const label = BLOCK_VIEW_LABELS[view] ?? BLOCK_VIEW_LABELS.markdown;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-dsh-md-render-tip', label);
    btn.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false');
    // 图标指向「点击后去哪」：当前是源码 → markdown 图标（回渲染）；当前是渲染 → code 图标（去源码）。
    renderNodeInto(btn, view === 'source' ? icon.markdown(14) : icon.code(14));
}
/** 切换视图：写块上的状态属性 + 同步按钮形态（不动宿主内容）。 */
function setFenceView(block, view) {
    block.setAttribute(BLOCK_VIEW_ATTR, view);
    const btn = block.querySelector('button.' + BLOCK_TOGGLE_CLASS);
    if (!btn)
        return;
    syncFenceToggle(btn, view);
}
/** 「查看原文 / 查看渲染」按钮：点击只翻转本块的状态属性（每块独立）。 */
function fenceToggleButton(block, view) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BLOCK_TOGGLE_CLASS;
    syncFenceToggle(btn, view);
    btn.addEventListener('click', () => {
        setFenceView(block, block.getAttribute(BLOCK_VIEW_ATTR) === 'source' ? 'markdown' : 'source');
    });
    return btn;
}
/** 幂等签名（含渲染库就绪版本：库到位后重建一次）。 */
function fenceSignature(kind, lang, source) {
    return kind + ':' + lang + ':' + String(source.length) + ':' + contextHash(source) + ':' + String(renderAssetsReady());
}
/** 幂等判定：容器在且签名未变 → 本轮不必重建。 */
function fenceSettled(block, signature) {
    return fenceBodyOf(block) !== null && block.getAttribute(BLOCK_SIG_ATTR) === signature;
}
/** 建自有容器并把内容交给**自研渲染器**；渲染库未就绪 / 不可用 → null（保持宿主原样）。 */
function buildFenceBody(kind, lang, source) {
    const body = document.createElement('div');
    if (kind === 'markdown') {
        body.className = 'tzx-md ' + BLOCK_MD_CLASS;
        return renderMarkdownInto(body, source) ? body : null;
    }
    body.className = CODE_HOST_CLASS;
    return renderNodeInto(body, createElement(CodeBlockView, { lang, code: source })) ? body : null;
}
/**
 * 应用（幂等）：把围栏块内容交给自研渲染器（markdown 或代码块）+ 挂切换按钮。
 * 门控（含流式）/ mermaid 块 / 语言为「源码」 / 空内容或超长 / 签名未变 → 一律不动 DOM。
 */
function applyFenceBlock(block) {
    if (fencePreSkip(block))
        return;
    const target = fenceKindOf(block);
    // mermaid 块交给 mermaid-scan；「渲染为…源码」的块保持官方原样。
    if (target.kind === 'none' || target.kind === 'mermaid')
        return;
    const source = fenceSource(block);
    if (!source.trim() || source.length > fenceMaxChars(target.kind))
        return;
    const signature = fenceSignature(target.kind, target.lang, source);
    if (fenceSettled(block, signature))
        return;
    clearFenceView(block);
    const body = buildFenceBody(target.kind, target.lang, source);
    if (body === null)
        return;
    block.appendChild(body);
    if (target.kind === 'markdown')
        block.appendChild(fenceToggleButton(block, 'markdown'));
    block.setAttribute(BLOCK_VIEW_ATTR, target.kind);
    block.setAttribute(BLOCK_SIG_ATTR, signature);
}
/** 扫描 root（自身 / 后代）内的围栏代码块并接管（mermaid 块由 mermaid-scan 负责）。 */
function scanFenceBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches('div.md-code-block'))
        applyFenceBlock(root);
    for (const block of root.querySelectorAll('div.md-code-block'))
        applyFenceBlock(block);
}
Object.assign(exports,{TEXT_FENCE_LANGS,MAX_TEXT_FENCE_CHARS,MAX_CODE_FENCE_CHARS,BLOCK_VIEW_ATTR,BLOCK_SIG_ATTR,BLOCK_MD_CLASS,BLOCK_TOGGLE_CLASS,isFenceStreaming,fenceKindOf,fenceSource,fenceSignature,applyFenceBlock,scanFenceBlocks});

    // 思考块默认展开（对官方折叠行派发一次 click；不改外观）
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
Object.assign(exports,{THINK_ROW_SELECTOR,applyThinkExpand});

    // mermaid 引擎按需加载 + 离屏渲染
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
Object.assign(exports,{MERMAID_ENGINE_URL,MAX_SOURCE_CHARS,OFFSCREEN_ATTR,ensureMermaid,resetMermaidEngine,renderSvg,errMsg});

    // mermaid 卡片工具条（常驻四项：视图切换 / 缩放分段 / 全屏浮窗 / 更多菜单）
    "use strict";
// ── mermaid 卡片工具条（React）── 从 mermaid-card.ts 拆出（单文件行数门禁 ≤400）。
// 常驻四项：视图切换 / 缩放分段（− 百分比 + 收在一个胶囊）/ 全屏浮窗 /「更多」菜单；
// 低频操作（适应容器 / 适应宽度 / 导出三件）收在菜单里 —— 用户口径「外面有的，里面就别再有」，
// 所以全屏浮窗只常驻、菜单里不再重复提供。
/** 预览 / 代码 视图切换；渲染失败时禁用预览（否则只剩激活态假象）。 */
function ViewToggle({ mode, setMode, previewDisabled, }) {
    const btn = (label, value, iconNode, disabled) => createElement('button', {
        type: 'button',
        className: mode === value ? 'dsh-md-render-mermaid-vt dsh-md-render-mermaid-vt-active' : 'dsh-md-render-mermaid-vt',
        onClick: () => setMode(value),
        disabled,
        'aria-pressed': mode === value,
        'aria-label': label,
        'data-dsh-md-render-tip': label,
    }, iconNode);
    return createElement('div', { className: 'dsh-md-render-mermaid-view-toggle', role: 'group', 'aria-label': 'view mode' }, 
    // 「预览」用眼睛图标（比 file 更贴语义）。
    btn('预览', 'preview', icon.eye(14), previewDisabled === true), btn('代码', 'code', icon.code(14), false));
}
/** 缩放分段：− / 百分比 / + 收进**一个**胶囊 —— 视觉上算一个控件，卡片头因此只需一行。
 *  百分比是**显示值**（zoom-math.ts 更新其 textContent），不是动作名 —— 所以保留文字、不进浮层。
 *  「实际大小 100%」不设按钮：双击图表与键盘 0 两条路径都在（提示写在菜单「适应容器」项里）。 */
function ZoomSeg({ entryId }) {
    const btn = (ariaLabel, tip, iconNode, action) => createElement('button', {
        type: 'button',
        className: 'dsh-md-render-mermaid-eb',
        onClick: action,
        'aria-label': ariaLabel,
        'data-dsh-md-render-tip': tip,
    }, iconNode);
    return createElement('div', { className: 'dsh-md-render-seg', role: 'group', 'aria-label': '图表缩放' }, btn('缩小', '缩小（键盘 −，或触控板双指捏合）', icon.minus(14), () => zoomEntry(entryId, 'out')), 
    // 实时缩放百分比：小图放大 25% 肉眼几乎无感，用数字给出明确反馈。
    createElement('span', { className: 'dsh-md-render-mermaid-zoom-pct' }, '100%'), btn('放大', '放大（键盘 +，或触控板双指捏合）', icon.plus(14), () => zoomEntry(entryId, 'in')));
}
/** 菜单项（模块级：不依赖组件状态，也让 CardMenu 保持在尺寸门禁内）。 */
function menuItemNode(label, iconNode, onSelect, disabled) {
    return createElement('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsh-md-render-menu-item',
        onClick: onSelect,
        disabled,
        'aria-label': label,
    }, iconNode, createElement('span', null, label));
}
/** 造一个「按 label 生成菜单项」的工厂：点完立刻关（菜单留着会挡住图表，让人以为点了没反应）。 */
function makeMenuItem(close) {
    return (label, iconNode, action, disabled) => menuItemNode(label, iconNode, () => {
        close();
        action();
    }, disabled);
}
/** 全屏浮窗：**常驻**在卡片头（用户口径「全屏要放在外面」，不藏在「更多」里）——
 *  它是「把图放大看」的主入口，属高频；菜单里因此不再重复提供它。 */
function FullscreenButton({ entryId, disabled }) {
    return createElement('button', {
        type: 'button',
        className: 'dsh-md-render-mermaid-eb',
        onClick: () => toggleCardOverlay(entryId),
        disabled,
        'aria-label': '全屏浮窗',
        'data-dsh-md-render-tip': '全屏浮窗（Esc 关闭）',
    }, icon.maximize(14));
}
/** 菜单触发器（模块级，同上）。 */
function menuTriggerNode(entryId, open, onToggle) {
    return createElement('button', {
        type: 'button',
        className: 'dsh-md-render-mermaid-eb',
        [MENU_BTN_ATTR]: entryId,
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': '更多操作',
        'data-dsh-md-render-tip': '更多操作',
        onClick: (e) => {
            // 阻止冒泡：否则 document 的"点外关闭"会立刻把刚打开的菜单关掉
            if (typeof e.stopPropagation === 'function')
                e.stopPropagation();
            onToggle();
        },
    }, icon.more(14));
}
/**
 * 「更多」菜单：把**低频**操作收起来（缩放模式 / 导出），别让它们长期霸占卡片头。
 * 全屏浮窗**不在菜单里** —— 用户口径「全屏要放在外面」，它是常驻的 FullscreenButton。
 * 用户口径「外面有的，里面就别有了」：原「渲染为 Markdown / 源码」已删
 * —— 它与常驻的「预览 / 代码」是同一意图的两套入口。
 * 关闭路径：再点触发按钮 / 点菜单外 / Esc；Esc 都把焦点还给触发按钮（键盘用户不丢位置）。
 * 定位纯 CSS（styles.ts 的 .dsh-md-render-menu 贴到工具条右下方）—— 不写 el.style。
 */
function CardMenu({ entryId, ready, zoomable, onPng, onSvg, onCopy, }) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open)
            return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape')
                return;
            setOpen(false);
            const btn = document.querySelector('[' + MENU_BTN_ATTR + '="' + entryId + '"]');
            if (btn !== null && typeof btn.focus === 'function')
                btn.focus();
        };
        // 点菜单外的任何地方都关；触发按钮的点击已 stopPropagation，不会误关刚打开的自己。
        const onDoc = () => setOpen(false);
        document.addEventListener('keydown', onKey);
        document.addEventListener('click', onDoc);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('click', onDoc);
        };
    }, [open, entryId]);
    const item = makeMenuItem(() => setOpen(false));
    return createElement('div', null, menuTriggerNode(entryId, open, () => setOpen(!open)), createElement('div', { className: 'dsh-md-render-menu', role: 'menu', 'aria-label': '更多操作', hidden: !open }, item('适应容器', icon.fit(14), () => zoomEntry(entryId, 'fit'), !zoomable), item('适应宽度', icon.fill(14), () => zoomEntry(entryId, 'fill'), !zoomable), createElement('hr', { key: 'menu-sep', className: 'dsh-md-render-menu-sep' }), item('下载 PNG', icon.download(14), onPng, !ready), item('下载 SVG', icon.download(14), onSvg, !ready), item('复制代码', icon.copy(14), onCopy, false)));
}
Object.assign(exports,{ViewToggle,ZoomSeg,CardMenu,FullscreenButton});

    // mermaid 图表卡片（预览 / 代码切换、导出、失败回显源码）
    "use strict";
// ── mermaid 图表卡片（React）── 卡片只挂在本插件自插的容器里（不改官方节点结构）；
// 官方 `<pre>` 由自有 CSS 的 `[data-dsh-md-render-mermaid-view]` 规则隐藏。
/** 卡片 host 标记（entryId）。 */
const MERMAID_ENTRY_ATTR = 'data-dsh-md-render-mermaid';
/** 渲染态（loading / ok / error；写在 host 上，与 React 提交时机解耦）。 */
const MERMAID_STATE_ATTR = 'data-dsh-md-render-mermaid-state';
/** 视图标记（preview / code；驱动自有 CSS 隐藏官方 pre）。 */
const MERMAID_VIEW_ATTR = 'data-dsh-md-render-mermaid-view';
/** 卡片根 / SVG 容器类名（mermaid-zoom 共用）。 */
const MERMAID_CARD_CLASS = 'dsh-md-render-mermaid-card';
const MERMAID_SVG_CLASS = 'dsh-md-render-mermaid-svg';
/** 变换层类名：panzoom 只变换它，外层容器负责裁剪。 */
const MERMAID_CANVAS_CLASS = 'dsh-md-render-mermaid-canvas';
/** 挂载序号（entryId 用）。 */
let mermaidSeq = 0;
/** 「更多」菜单触发按钮的标记（Esc 归还焦点时按 entryId 找它）。 */
const MENU_BTN_ATTR = 'data-dsh-md-render-menu-btn';
/** 记录一条渲染态转移（写到卡片 host 的真实 DOM 属性上）。 */
function noteRenderState(entryId, state) {
    if (typeof document === 'undefined' || document === null)
        return;
    const host = document.querySelector('[' + MERMAID_ENTRY_ATTR + '="' + entryId + '"]');
    if (host && typeof host.setAttribute === 'function')
        host.setAttribute(MERMAID_STATE_ATTR, state);
}
/** 渲染状态机（加载引擎 → 离屏渲染 → SVG / 失败原因）；令牌机制丢弃迟到结果。 */
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
/** 卡片主体：loading / error（含源码与重试）/ 代码视图 / 渲染出的 SVG。 */
function CardBody({ status, mode, error, source, svg, onRetry, }) {
    if (status === 'loading') {
        return createElement('div', { className: 'dsh-md-render-mermaid-loading' }, icon.refresh(14), createElement('span', null, '渲染中…'));
    }
    if (status === 'error') {
        // 主次反转：源码是主视觉，失败原因降为一行灰字；「重试」是加载失败的唯一恢复路径。
        return createElement('div', { className: 'dsh-md-render-mermaid-error' }, createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source), createElement('div', { className: 'dsh-md-render-mermaid-error-line' }, icon.alert(13), createElement('span', { className: 'dsh-md-render-mermaid-error-msg' }, 'Mermaid 渲染失败：' + String(error ?? '')), createElement('button', {
            type: 'button',
            className: 'dsh-md-render-mermaid-eb dsh-md-render-mermaid-retry',
            onClick: onRetry,
            'aria-label': '重试',
            'data-dsh-md-render-tip': '重试渲染',
        }, icon.refresh(13))));
    }
    if (mode === 'code' || !svg)
        return createElement('pre', { className: 'dsh-md-render-mermaid-code' }, source);
    return createElement('div', { className: MERMAID_SVG_CLASS }, createElement('div', { className: MERMAID_CANVAS_CLASS, dangerouslySetInnerHTML: { __html: svg } }));
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
    // 失败态把视图钉到 code：按钮激活态与实际显示一致。
    const view = status === 'error' ? 'code' : mode;
    /** 可缩放 = 已渲染出图且停在预览态（缩放分段与菜单里的缩放项都按它启用）。 */
    const zoomable = svg !== null && view === 'preview';
    // 渲染出 SVG 后绑定缩放 / 平移（懒加载 panzoom；失败只标记卡片，不再静默）。
    // 清理时收掉本卡片的浮窗：组件卸载 / 切到代码视图都不留浮窗。
    useEffect(() => {
        if (status !== 'ok' || view !== 'preview')
            return undefined;
        const target = zoomTargetsOf(entryId);
        if (target !== null)
            bindZoom(target);
        return () => closeOverlayOf(entryId);
    }, [entryId, status, view]);
    return createElement('div', { className: MERMAID_CARD_CLASS }, createElement('div', { className: 'dsh-md-render-mermaid-card-head' }, createElement('div', { className: 'dsh-md-render-mermaid-card-title' }, 
    // 「图表」用 chart 图标（原来借用 file，语义不准）。
    icon.chart(12), createElement('span', null, 'Mermaid 图表')), 
    // 卡片头**最多一行**：视图切换 → 缩放分段（算一个控件）→ 全屏浮窗（常驻）→「更多」（低频收纳）。
    createElement('div', { className: 'dsh-md-render-mermaid-card-actions' }, createElement(ViewToggle, { mode: view, setMode, previewDisabled: status === 'error' }), zoomable ? createElement(ZoomSeg, { entryId }) : null, 
    // 全屏浮窗**常驻**（用户口径：全屏放在外面，不藏进「更多」）—— 未出图 / 代码视图下禁用
    createElement(FullscreenButton, { entryId, disabled: !zoomable }), createElement(CardMenu, { entryId, ready: status === 'ok', zoomable, ...exportActions }))), renderNotice(notice), createElement(CardBody, { status, mode: view, error, source, svg, onRetry: retry }));
}
/** 提示条定时器（模块级单例：后一条提示覆盖前一条）。 */
let noticeTimer = null;
Object.assign(exports,{MERMAID_ENTRY_ATTR,MERMAID_STATE_ATTR,MERMAID_VIEW_ATTR,noteRenderState,MERMAID_CARD_CLASS,MERMAID_SVG_CLASS,MERMAID_CANVAS_CLASS,CardBody,MermaidCard});

    // mermaid 代码块识别 + 流式稳定窗口
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
/** 本插件接管的 mermaid 围栏语言（与 text-markdown 的语言集合不重叠 → 分流稳定）。 */
const MERMAID_FENCE_LANGS = ['mermaid', 'mmd'];
/**
 * 是否为 mermaid 代码块。语言来源 = block-lang.ts 的 resolveFenceLang（双源互补）：
 *  · allowIndex !== false：① **client 事件流索引**（lang-source.ts）—— 会话窗口里的原始
 *    markdown 原文，**含历史**，冷启动 / 重启后打开历史会话也命中（host 半实时索引为空时
 *    这条路径就是唯一来源），零 RPC；② 回退 resolveBlockLang（DOM 的
 *    code.language-mermaid / banner 语言原名 → host 半的实时索引）；
 *  · allowIndex === false：**只读 DOM**——流式块专用（内容还在补写，哈希必然落空，查表即请求放大）。
 * 不读 React fiber 私有属性。
 */
function isMermaidBlock(block, allowIndex = true) {
    try {
        const lang = allowIndex ? resolveFenceLang(block) : blockLangDomLang(block);
        return MERMAID_FENCE_LANGS.includes(lang);
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
    // 已是卡片：块内不再挂「渲染为…」控件；卡片头也不再提供它 —— 与常驻的「预览 / 代码」
    // 是同一意图的两套入口（用户口径「外面有的，里面就别有了」）。
    removeLangSwitch(block);
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
/**
 * 单个候选块：挂载 / 继续等待 / 自愈卸载。非 mermaid 块立即返回（性能护栏）。
 *
 * 语言判定放在开关之后（关掉 mermaid 渲染时一次请求都不发），并且**流式块只读 DOM**：
 * 流式补写中的内容哈希必然落空，查表既无意义又放大请求量；消息流式结束后
 * `data-streaming` 消失会触发兜底重扫，那时再走索引路径（结果：索引识别出的 mermaid 块
 * 在消息稳定后挂卡片，DOM 已给出语言名的块保持原有的「立即 / 400ms 窗口」行为）。
 * 历史会话（非流式）走的是①client 事件流索引：**同步命中即挂卡片**，不发任何请求。
 */
function considerMermaidBlock(block, round) {
    if (!renderOptions.mermaid.render)
        return;
    if (isInsideRenderedMarkdown(block))
        return;
    if (!isMermaidBlock(block, !isMermaidStreaming(block)))
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
Object.assign(exports,{STREAM_SETTLE_MS,isMermaidBlock,mermaidSourceOf,considerMermaidBlock,scanMermaidBlocks,teardownMermaid});

    // mermaid 图表导出（PNG / SVG 下载 + 复制源码）
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
Object.assign(exports,{buildExportFileName,serializeSvg,findCardSvg,makeExportHandlers});

    // mermaid 图表全屏 + 缩放 / 平移（panzoom 懒加载；失败切内置降级引擎）
    "use strict";
// ── 缩放几何与策略：fit / fill / 100% 的基准比例、锚点手势、fitMode 跟随、快捷键动作 ──
// 从 mermaid-zoom.ts 拆出（单文件行数门禁 ≤400）。几何基准一律量**裁剪容器**（state.frame）
// 而非变换层：变换层高度由内容决定（扁图如 flowchart LR `X-->Y` 仅约 50px），拿它当可用空间
// 会让 contain 恒为 1 —— 那正是「图永远放不大」的根因（真机实测：容器 160 vs 变换层 50）。
/** 比例夹逼到引擎上下界（与 panzoom 构造参数同源）。 */
function zoomClamp(scale) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}
/** 量容器与图固有尺寸；量不出（无 SVG / 容器未布局 / 尺寸为 0）→ null（调用方退回 1）。 */
function zoomMetrics(state) {
    const svg = state.box.querySelector('svg');
    if (svg === null)
        return null;
    const container = state.frame;
    const bw = Number(container.offsetWidth ?? 0);
    const bh = Number(container.offsetHeight ?? 0);
    const scale = state.pz.getScale() || 1;
    const rect = svg.getBoundingClientRect();
    const sw = rect.width / scale;
    const sh = rect.height / scale;
    if (bw <= 0 || bh <= 0 || sw <= 0 || sh <= 0)
        return null;
    return { bw, bh, sw, sh };
}
/** 程序性缩放后的**居中补偿**：两个引擎的缩放锚点都是「变换层布局盒中心」
 *  （panzoom 把 transform-origin 内联成 50% 50%；内置降级引擎 paint() 同）。而变换层高度 =
 *  内容固有高度，竖向长图常远大于容器的 max-height:70vh → 锚点落在容器**可视区之外**，
 *  缩放后内容中心停在容器外（真机现象：「图不在正中间，跑到了最下面」）。
 *  变换是 translate(t) scale(s) 且 origin 恰为变换层中心 ⇒ 中心屏幕位置 = 中心 + t，
 *  于是 t = 容器中心 − 变换层中心。水平方向变换层宽 = 容器宽、内容已由 flex 居中，无需补偿。
 *
 *  ⚠️ **不要**改成「让变换层绝对定位填满容器」来绕开：那样变换层脱离文档流，容器高度会塌回
 *  min-height(160px) —— 既丢掉「高度随内容自适应」，fit 又按 160px 算，图表被压到 20% 上下。 */
function zoomCenterInFrame(state) {
    const m = zoomMetrics(state);
    if (m === null)
        return;
    // ⚠️ 系数随引擎而变（真机实测踩过）：panzoom 的 transform 是 `scale(s) translate(t)`，
    // 平移量 t 落在**缩放后的坐标系**里 ⇒ 想在屏幕上移动 Δ 必须传 Δ ÷ s；
    // 内置降级引擎是 `translate(t) scale(s)` ⇒ 1:1。写死其中一个，另一个引擎就会偏。
    const s = state.pz.getScale() || 1;
    const k = state.translateInScaledSpace && s > 0 ? 1 / s : 1;
    state.pz.pan(0, ((m.bh - m.sh) / 2) * k, { relative: false });
}
/** 100% = 图表真实像素大小：viewBox 宽 ÷ 未缩放的显示宽（适应容器后两者不等）。 */
function zoomNaturalScale(state) {
    const svg = state.box.querySelector('svg');
    const scale = state.pz.getScale() || 1;
    const shown = svg === null ? 0 : svg.getBoundingClientRect().width / scale;
    const natural = svg === null ? 0 : svg.viewBox.baseVal.width;
    if (shown <= 0 || natural <= 0)
        return 1;
    return zoomClamp(natural / shown);
}
/** 适应 = 完整显示（contain）：按「容器尺寸 ÷ 图固有尺寸」取宽高比例的**较小**者。
 *  原先 fit 只是 reset 到 scale=1 —— 小图（如 flowchart LR `X-->Y` 仅 ~90px 宽）躺在
 *  上千像素的容器里，点「适应」毫无变化、点「+」一次也只放大 25%，用户感知就是「没反应」。 */
function zoomFitScale(state) {
    const m = zoomMetrics(state);
    if (m === null)
        return 1;
    return zoomClamp(Math.min(m.bw / m.sw, m.bh / m.sh));
}
/** 铺满 = 适应宽度（PhotoSwipe 的 fill / Panzoom 的 cover）：bw / sw，保持宽高比。
 *  与 fit 只差**不**受高度约束 —— 宽图比「适应」更实用，高度溢出时用户拖动平移。 */
function zoomFillScale(state) {
    const m = zoomMetrics(state);
    return m === null ? 1 : zoomClamp(m.bw / m.sw);
}
/** 事件里的指针 / 手势中心（client 坐标）；拿不到有限坐标 → null（退回以元素中心为锚）。 */
function zoomPointOf(event) {
    const e = event;
    const x = typeof e.clientX === 'number' ? e.clientX : NaN;
    const y = typeof e.clientY === 'number' ? e.clientY : NaN;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
/** 以屏幕点为锚点缩放到 scale：优先用引擎自带的锚点 API（panzoom 4.6 的 zoomToPoint /
 *  降级引擎的 zoomAtPoint）；引擎不支持 → false（调用方退回以元素中心为锚的居中缩放）。 */
function zoomAnchored(state, scale, point) {
    if (point === null)
        return false;
    const pz = state.pz;
    if (typeof pz.zoomToPoint === 'function') {
        const before = pz.getScale();
        try {
            // panzoom **4.6.2** 的签名是 zoomToPoint(**scale, event**) —— scale 在前。证据在库自身：
            // `function v(e,t,n,o){ … t.clientX … }`，而它的 `zoomWithWheel` 是 `v(h(…), e, t, e)`。
            // 较新版本才是 (point, scale)。传错顺序时它**不抛错、只是静默不动** —— 真机实测：
            // wheel 事件已到达且 preventDefault 了、console 零报错，transform 却纹丝不动。
            pz.zoomToPoint(scale, { clientX: point.x, clientY: point.y });
            // 调用后校验：签名不符 / 内部异常时它可能既不抛错也不生效 —— 没变就当没成功，
            // 让调用方回退到居中缩放。绝不把「锚点失败」放大成「整次缩放都不生效」。
            if (Math.abs((pz.getScale() || 0) - before) > 1e-6)
                return true;
        }
        catch (_e) {
            /* 落回退路径 */
        }
    }
    if (typeof pz.zoomAtPoint === 'function') {
        pz.zoomAtPoint(scale, point);
        return true;
    }
    return false;
}
/** 一档缩放比（滚轮 / 捏合共用）：deltaY < 0 = 放大。 */
function zoomStep(event) {
    return Number(event.deltaY) < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
}
/** 裸 wheel 归页面（滚动陷阱）：只有 ctrlKey+wheel（捏合）或浮窗态才缩放。 */
function zoomWheelShouldHandle(event, card) {
    const wheel = event;
    return wheel.ctrlKey === true || card.getAttribute(FS_ATTR) === FS_OPEN;
}
/** 手动缩放（滚轮 / 捏合 / 键盘）：退出 fitMode（用户接管后不再跟随容器），
 *  有指针坐标就以该点为锚点，否则以元素中心为锚。 */
function zoomManual(state, next, point, animate) {
    state.fitMode = false;
    if (!zoomAnchored(state, next, point))
        state.pz.zoom(next, { animate });
    // 滚轮 / 捏合 / 键盘这条路径此前**从不刷新百分比标签**（锚点分支还会提前 return）——
    // 结果就是「缩放真的生效了、百分比纹丝不动」，用户据此判断成「点了没反应」
    // （真机实测：transform 已 scale(1.006→1.509) 且平移到锚点，pct 却仍显示 101%）。
    refreshZoomLabel(state);
}
/** fitMode 下的重算（全屏切换 / 容器尺寸变化）：比例没变就不写 transform，
 *  否则 ResizeObserver 与自身写入的变换会互相触发。 */
function zoomRefitIfFit(state) {
    if (!state.fitMode)
        return;
    const next = zoomFitScale(state);
    if (Math.abs(next - state.pz.getScale()) <= next * 0.005)
        return;
    state.pz.zoom(next, { animate: false });
    zoomCenterInFrame(state);
    refreshZoomLabel(state);
}
/** 事件解绑闭包（document / window / 元素通用）。 */
function zoomListen(target, type, fn) {
    target.addEventListener(type, fn);
    return () => {
        // 伪 DOM / 残缺实现可能没有 removeEventListener：解绑失败不该让 teardown 抛错。
        if (typeof target.removeEventListener === 'function')
            target.removeEventListener(type, fn);
    };
}
/** fitMode 的「跟随容器」：全屏切换、以及容器尺寸变化（ResizeObserver；不可用退回
 *  window resize）时**重算 fit** —— draw.io 的 Fit Window 是保持态，不是一次性动作
 *  （真机实证：容器 1174×508 → 800×544 后图仍停在旧比例，全屏后缩在一角、大片空白）。 */
function bindFitFollow(state) {
    const refit = () => zoomRefitIfFit(state);
    const win = typeof window === 'undefined' ? undefined : window;
    const doc = typeof document === 'undefined' ? undefined : document;
    const unbinds = [];
    if (doc !== undefined && typeof doc.addEventListener === 'function') {
        unbinds.push(zoomListen(doc, 'fullscreenchange', refit));
    }
    const RO = win === undefined ? undefined : win.ResizeObserver;
    if (typeof RO === 'function') {
        const ro = new RO(refit);
        ro.observe(state.frame);
        unbinds.push(() => ro.disconnect());
    }
    else if (win !== undefined && typeof win.addEventListener === 'function') {
        unbinds.push(zoomListen(win, 'resize', refit));
    }
    return () => {
        for (const off of unbinds)
            off();
    };
}
/** 缩放键（+ / - / = / _ / 0）；拆出来压圈复杂度。 */
function zoomScaleKey(state, key) {
    const factor = key === '+' || key === '=' ? ZOOM_STEP : key === '-' || key === '_' ? 1 / ZOOM_STEP : 0;
    if (factor > 0) {
        zoomManual(state, state.pz.getScale() * factor, null, true);
        return true;
    }
    if (key !== '0')
        return false;
    state.fitMode = false; // 0 = 位移与比例一并复位（真正的复位；适应交给「适应」按钮 / 双击）
    state.pz.reset({ animate: false });
    return true;
}
/** 方向键平移（拆出来压圈复杂度）。 */
function zoomArrowKey(state, key) {
    const dx = key === 'ArrowLeft' ? PAN_KEY_STEP : key === 'ArrowRight' ? -PAN_KEY_STEP : 0;
    const dy = key === 'ArrowUp' ? PAN_KEY_STEP : key === 'ArrowDown' ? -PAN_KEY_STEP : 0;
    if (dx === 0 && dy === 0)
        return false;
    state.fitMode = false;
    state.pz.pan(dx, dy, { animate: false, relative: true });
    return true;
}
/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移（Esc 由浮窗 dialog 的 cancel 负责）。 */
function zoomKey(card, box, event) {
    const state = zoomStates.get(box);
    if (state === undefined)
        return;
    const key = String(event.key ?? '');
    if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key))
        return;
    if (typeof event.preventDefault === 'function')
        event.preventDefault();
}
/** 刷新百分比标签：panzoom 的 transform 落在下一帧，同步读可能拿到旧值 → 再补一次。 */
function refreshZoomLabel(state) {
    const label = state.card.querySelector('.' + ZOOM_PCT_CLASS);
    if (label === null)
        return;
    const apply = () => {
        label.textContent = Math.round((state.pz.getScale() || 1) * 100) + '%';
    };
    apply();
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function')
        raf(apply);
}
/** 工具条 / 双击动作：fit = 适应容器（进入**保持态**跟随模式）/ fill = 铺满宽度 /
 *  full = 100% / in / out。除 fit 外都算用户手动接管 → 退出 fitMode。 */
function applyZoom(state, action) {
    if (action === 'fit') {
        state.fitMode = true;
        state.pz.zoom(zoomFitScale(state), { animate: false });
        zoomCenterInFrame(state);
    }
    else if (action === 'fill') {
        state.fitMode = false;
        state.pz.zoom(zoomFillScale(state), { animate: false });
        zoomCenterInFrame(state);
    }
    else if (action === 'full') {
        state.fitMode = false;
        state.pz.zoom(zoomNaturalScale(state), { animate: false });
        zoomCenterInFrame(state);
    }
    else {
        state.fitMode = false;
        state.pz.zoom(state.pz.getScale() * (action === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP), { animate: true });
    }
    refreshZoomLabel(state);
}
/** 双击 = 「适应 ↔ 实际大小」切换（Panzoom 的 toggleZoom / viewer.js / lightGallery 同款语义）：
 *  正在跟随 fit → 去 100%；否则回到 fit。键盘 0 才是真正的复位。
 *
 *  **必须按状态判断，不能按「当前比例是否接近 fit 值」**：fit ≈ 100%（图接近 1:1）时，
 *  |1.00 − 1.011| = 0.011 落在任何容差内 → 两次双击都判「接近 fit」→ 永远切不回 fit
 *  （真机实测：101% --双击--> 100% --双击--> 100%）。 */
function zoomToggle(state) {
    applyZoom(state, state.fitMode ? 'full' : 'fit');
}

    "use strict";
// ── 内置降级缩放引擎（panzoom 不可用时的兜底）──────────────────────────────
// #471 真机第四轮教训：panzoom 走**运行时** fetch + <script> 注入，环境差异（资源加载、
// 注入时机、UMD 落点）会让它静默失败 —— 用户看到的就是「缩放按钮点了完全没反应」，
// 而百分比停在硬编码的初始值 100%（真机复现：阻断该请求 → pct 100% / 绑定从未建立 /
// 卡片零提示）。这里用纯 CSS transform 实现同一套 API：**零运行时加载 ⇒ 不存在失败面**。
// 锚点与 panzoom 对齐：库自己把 transform-origin 写成 50% 50%（= 元素布局盒中心），
// 这里用同一锚点，并以 zoomAtPoint 提供「以屏幕点为锚点缩放」（对应它的 zoomToPoint）。
/** 派发与 panzoom 同名的合成事件（panzoompan）：调用方据此判断「用户真的在手动平移」
 *  → 退出 fitMode。伪 DOM / 旧环境没有 dispatchEvent 或 CustomEvent 时静默跳过。 */
function fireZoomEvent(box, type) {
    const host = box;
    const Ctor = globalThis.CustomEvent;
    if (typeof host.dispatchEvent !== 'function' || typeof Ctor !== 'function')
        return;
    try {
        host.dispatchEvent(new Ctor(type, { detail: {} }));
    }
    catch (_e) {
        /* 事件派发失败不阻断平移 */
    }
}
/** 指针拖拽平移：把每次位移交给 onDrag；返回解绑函数。 */
function attachDragPan(box, onDrag) {
    let last = null;
    const pointOf = (event) => {
        const e = event;
        return { x: Number(e.clientX ?? 0), y: Number(e.clientY ?? 0) };
    };
    const onDown = (event) => {
        last = pointOf(event);
    };
    const onMove = (event) => {
        if (last === null)
            return;
        const now = pointOf(event);
        const dx = now.x - last.x;
        const dy = now.y - last.y;
        last = now;
        if (dx === 0 && dy === 0)
            return;
        fireZoomEvent(box, 'panzoompan');
        onDrag(dx, dy);
    };
    const onUp = () => {
        last = null;
    };
    const host = box;
    if (typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') {
        return () => { };
    }
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
    return () => {
        box.removeEventListener('pointerdown', onDown);
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        box.removeEventListener('pointercancel', onUp);
    };
}
/** 以屏幕点 P 为锚点缩放后的平移量：变换是 translate(t) scale(s)（origin = 布局盒中心 O），
 *  P 不动需 t2 = t1 + (P − O − t1)·(1 − s2/s1)；量不出几何（未布局 / 伪 DOM）→ null（居中缩放）。 */
function zoomPanToPoint(box, from, to, pan, point) {
    const rect = box.getBoundingClientRect();
    if (from <= 0 || rect.width <= 0 || rect.height <= 0)
        return null;
    const k = 1 - to / from;
    const ox = Number(rect.left ?? 0) + rect.width / 2 - pan.x;
    const oy = Number(rect.top ?? 0) + rect.height / 2 - pan.y;
    return { x: pan.x + (point.x - ox - pan.x) * k, y: pan.y + (point.y - oy - pan.y) * k };
}
/** 内置降级缩放器：接口与 panzoom 一致（zoom / pan / reset / getScale / zoomAtPoint / destroy）。 */
function createFallbackZoomer(box, limits) {
    const el = box;
    const style = el.style ?? {};
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const clamp = (value) => Math.min(limits.maxScale, Math.max(limits.minScale, value));
    const paint = () => {
        style.transformOrigin = '50% 50%';
        style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    };
    const unbind = attachDragPan(box, (dx, dy) => {
        tx += dx;
        ty += dy;
        paint();
    });
    /** panzoom 的 zoomToPoint 对应物：锚点缩放（见 zoomPanToPoint 的几何）。 */
    const zoomAtPoint = (next, point) => {
        const to = clamp(next);
        const pan = zoomPanToPoint(box, scale, to, { x: tx, y: ty }, point);
        if (pan !== null) {
            tx = pan.x;
            ty = pan.y;
        }
        scale = to;
        paint();
        return scale;
    };
    return {
        zoom: (next) => {
            scale = clamp(next);
            paint();
            return scale;
        },
        pan: (x, y, options) => {
            if (options !== undefined && options.relative === true) {
                tx += x;
                ty += y;
            }
            else {
                tx = x;
                ty = y;
            }
            paint();
            return { x: tx, y: ty };
        },
        reset: () => {
            scale = 1;
            tx = 0;
            ty = 0;
            paint();
            return { x: 0, y: 0 };
        },
        getScale: () => scale,
        zoomAtPoint: zoomAtPoint,
        destroy: () => {
            unbind();
            style.transform = '';
            style.transformOrigin = '';
        },
    };
}

    "use strict";
// ── mermaid 图表浮窗 + 缩放 / 平移（#470 需求 1 / #471 真机反馈）────────────
// 浮窗 = 页面内 <dialog> 模态，**不用** Fullscreen API：顶层压过宿主 UI，遮罩 / Esc /
// 焦点归还 / 滚动锁定由浏览器兜底。缩放 = panzoom vendored asset 懒加载（0 增量）。
// 比例几何与交互策略（fit / fill / 100%、fitMode 跟随、锚点手势、快捷键动作）在
// zoom-math.ts；panzoom 不可用时的纯 CSS 降级引擎在 zoom-fallback.ts。
// 设计取舍与真机实测数字见 tmp/md-render-enhancements/zoom-fix-report.md。
const ZOOM_ATTR = 'data-dsh-md-render-zoom';
/** 缩放百分比标签类名（工具条内自有 DOM）：让「点了到底有没有变」一眼可见。 */
const ZOOM_PCT_CLASS = 'dsh-md-render-mermaid-zoom-pct';
/** 卡片态：open = 浮窗开；failed = panzoom 加载失败（此前静默 → 像「点了没反应」）。 */
const FS_ATTR = 'data-dsh-md-render-fs';
const FS_OPEN = 'open';
const FS_FAIL = 'failed';
/** 浮窗面板标记 + 面板 / 面板工具条类名（自有 DOM）。 */
const FS_PANEL_ATTR = 'data-dsh-md-render-fs-panel';
const FS_CLASS = 'dsh-md-render-mermaid-fs';
const FS_BAR_CLASS = 'dsh-md-render-mermaid-fs-bar';
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.5;
const PAN_KEY_STEP = 40;
/** 已绑定的图表（自有变换层 → 状态）；同容器只绑一次。 */
const zoomStates = new Map();
let panzoomReady = null;
let overlayHome = null;
/** 注入 panzoom UMD 并解析 window.Panzoom（注入下无 module → 落 window）。 */
function injectPanzoom(code) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.textContent = code;
        script.onerror = () => reject(new Error('panzoom script injection failed'));
        document.head.appendChild(script);
        const ctor = typeof window !== 'undefined' ? window.Panzoom : undefined;
        if (typeof ctor !== 'function') {
            reject(new Error('panzoom missing after injection'));
            return;
        }
        resolve(ctor);
    });
}
/** 懒加载 panzoom（首次真正需要才 fetch；失败重置缓存 → 下次点击可重试）。 */
function ensurePanzoom() {
    const globalCtor = typeof window !== 'undefined' ? window.Panzoom : undefined;
    if (typeof globalCtor === 'function')
        return Promise.resolve(globalCtor);
    if (panzoomReady !== null)
        return panzoomReady;
    panzoomReady = fetch(PANZOOM_SCRIPT_URL)
        .then((resp) => {
        if (resp.ok === false)
            throw new Error('panzoom fetch failed: ' + String(resp.status));
        return resp.text();
    })
        .then(injectPanzoom)
        .catch((err) => {
        panzoomReady = null;
        throw err instanceof Error ? err : new Error(String(err));
    });
    return panzoomReady;
}
/** 卡片 + 自有 SVG 容器（按 entryId 定位）。 */
function zoomTargetsOf(entryId) {
    if (typeof document === 'undefined' || document === null)
        return null;
    const host = document.querySelector('[' + MERMAID_ENTRY_ATTR + '="' + entryId + '"]');
    if (host === null || typeof host.querySelector !== 'function')
        return null;
    const card = host.querySelector('div.' + MERMAID_CARD_CLASS);
    if (card === null)
        return null;
    const frame = card.querySelector('div.' + MERMAID_SVG_CLASS);
    if (frame === null)
        return null;
    const canvas = frame.querySelector('div.' + MERMAID_CANVAS_CLASS) ?? frame;
    return { card, frame, box: canvas };
}
/** 事件绑定：绑在**卡片**上（指针落在卡片任意位置都能捏合，原先只绑变换层，偏一点就没反应）；
 *  裸 wheel 不拦截，纵向滚动仍归页面。缩放锚点跟随手势中心（mermaid.live 的 zoomAtPoint 同款）。 */
function bindZoomEvents(state) {
    const { pz, card, box } = state;
    card.addEventListener('wheel', (event) => {
        if (!zoomWheelShouldHandle(event, card))
            return;
        zoomManual(state, pz.getScale() * zoomStep(event), zoomPointOf(event), false);
        event.preventDefault();
    }, { passive: false });
    // macOS Safari 触控板捏合派发 gesture*（不发 ctrl+wheel）；接不住就「没有任何放大效果」。
    let gestureBase = pz.getScale();
    card.addEventListener('gesturestart', (event) => {
        gestureBase = pz.getScale();
        event.preventDefault();
    });
    card.addEventListener('gesturechange', (event) => {
        const ratio = Number(event.scale);
        // gesture* 的 clientX / clientY 就是手势中心 → 以它为锚点（与指针捏合一致）。
        if (ratio > 0)
            zoomManual(state, gestureBase * ratio, zoomPointOf(event), false);
        event.preventDefault();
    });
    // 双击 = 适应 ↔ 实际大小（不是复位）；用户拖动平移（panzoom 的 panzoompan）→ 退出 fitMode。
    box.addEventListener('dblclick', () => zoomToggle(state));
    box.addEventListener('panzoompan', () => {
        state.fitMode = false;
    });
    card.addEventListener('keydown', (event) => zoomKey(card, box, event));
}
/** 用给定引擎建实例（幂等）：状态登记 + 事件绑定 + fitMode 跟随 + 首次适应容器。
 *  panzoom 与内置降级引擎共用这条路；**引擎构造抛错也回落到降级态**，绝不让按钮失灵。 */
function buildZoomState(target, make, 
/** 引擎的 transform 组合顺序（真机实测两者**相反**）：
 *  panzoom 是 `scale(s) translate(t)` —— 平移量落在**缩放后的坐标系**里，屏幕位移 = t·s；
 *  内置降级引擎是 `translate(t) scale(s)` —— 屏幕位移 = t。居中补偿要按它取系数。 */
translateInScaledSpace) {
    const { card, frame, box } = target;
    const again = zoomStates.get(box);
    if (again !== undefined)
        return again;
    let pz;
    let inScaledSpace = translateInScaledSpace;
    try {
        pz = make({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX });
    }
    catch (_e) {
        pz = createFallbackZoomer(box, { minScale: ZOOM_MIN, maxScale: ZOOM_MAX });
        inScaledSpace = false; // 回落 = 降级引擎（translate 与 scale 1:1）
    }
    const state = { pz, card, frame, box, fitMode: true, translateInScaledSpace: inScaledSpace };
    zoomStates.set(box, state);
    frame.setAttribute(ZOOM_ATTR, 'on'); // 外层切裁剪态：放大后不盖住工具条
    bindZoomEvents(state);
    state.unwatch = bindFitFollow(state); // 全屏 / 容器尺寸变化 → fitMode 下重算 fit
    if (card.getAttribute(FS_ATTR) === FS_FAIL)
        card.removeAttribute(FS_ATTR);
    // 首次绑定即适应容器：小图（flowchart LR 只有几十像素宽）不再缩在一角等用户放大。
    applyZoom(state, 'fit');
    return state;
}
/** 绑定缩放 / 平移（幂等）：优先 panzoom；**它拉不起来就用内置引擎**。
 *  #471 真机第四轮：panzoom 走运行时 fetch + <script> 注入，环境差异会让它静默失败，
 *  用户看到的就是「点了完全没反应」（真机复现：阻断该请求 → pct 停在 100%、按钮全失效、
 *  卡片零提示）。因此这里**不再有「失败就 return undefined」这条静默路径** ——
 *  任何失败都必须落到一个真能用的引擎上。 */
function bindZoom(target) {
    const { box } = target;
    const bound = zoomStates.get(box);
    if (bound !== undefined)
        return Promise.resolve(bound);
    return ensurePanzoom()
        .then((Panzoom) => buildZoomState(target, (limits) => {
        // touchAction 内联态取 pan-y：纵向滚动归页面，横向拖拽平移。
        return new Panzoom(box, {
            minScale: limits.minScale,
            maxScale: limits.maxScale,
            cursor: 'grab',
            pinchAndPan: true,
            zoomWithWheel: false,
            touchAction: 'pan-y',
        });
    }, true))
        .catch(() => buildZoomState(target, (limits) => createFallbackZoomer(box, limits), false));
}
/** 工具条入口：未就绪就**等加载完再执行**（此前直接 return，加载期间与加载失败后的
 *  每次点击都被静默丢弃 —— 用户看到的就是「点了没反应」）。 */
function zoomEntry(entryId, action) {
    const target = zoomTargetsOf(entryId);
    if (target === null)
        return;
    void bindZoom(target).then((state) => applyZoom(state, action));
}
/** 浮窗里的小按钮：文字走 data-dsh-md-render-tip 悬停浮层，图标 React 渲染进按钮
 *  （图标单一真源在共享图标集，不为命令式路径另写一套 SVG）。 */
function overlayButton(label, iconNode, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsh-md-render-mermaid-eb';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-dsh-md-render-tip', label);
    renderNodeInto(btn, iconNode);
    btn.addEventListener('click', onClick);
    return btn;
}
/** 二级入口：浏览器原生全屏。**先收浮窗再进全屏** —— PhotoSwipe 官方配方：两层容器
 *  绝不同时存在（真机实测此前 dialog 仍 open = 两层模态叠加）。全屏切换由 fitMode 的
 *  fullscreenchange 跟随重新适应；请求被拒 / 不支持则就地重新适应（别停在浮窗时的大比例）。 */
function requestNativeFullscreen(target) {
    closeCardOverlay();
    const refit = () => {
        const state = zoomStates.get(target.box);
        if (state !== undefined)
            zoomRefitIfFit(state);
    };
    const api = target.card;
    try {
        if (typeof api.requestFullscreen !== 'function') {
            refit();
            return;
        }
        void Promise.resolve(api.requestFullscreen()).catch(refit);
    }
    catch (_e) {
        refit();
    }
}
/** 打开浮窗：搬**宿主**而不是卡片 —— React 17+ 把合成事件委托挂在根容器上，
 *  把卡片搬出去 = 浮窗里所有按钮失灵（真机实测）。 */
function openCardOverlay(target, entryId) {
    if (overlayHome !== null || typeof document === 'undefined' || document === null)
        return;
    const host = target.card.parentNode;
    if (host === null || typeof host.appendChild !== 'function')
        return;
    const dialog = document.createElement('dialog');
    dialog.className = FS_CLASS;
    dialog.setAttribute(FS_PANEL_ATTR, 'open');
    const bar = document.createElement('div');
    bar.className = FS_BAR_CLASS;
    bar.appendChild(overlayButton('浏览器全屏', icon.maximize(14), () => requestNativeFullscreen(target)));
    bar.appendChild(overlayButton('关闭', icon.close(14), closeCardOverlay));
    dialog.appendChild(bar);
    overlayHome = { host: host, entryId, parent: host.parentNode, next: host.nextSibling, dialog };
    dialog.appendChild(host);
    // ::backdrop 不是元素：点击落在 dialog 自身 = 点了遮罩。
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog)
            closeCardOverlay();
    });
    dialog.addEventListener('cancel', closeCardOverlay);
    document.body.appendChild(dialog);
    dialog.showModal();
    target.card.setAttribute(FS_ATTR, FS_OPEN);
}
/** 关闭浮窗：宿主还回原位置（幂等；关闭按钮 / Esc / 遮罩三路共用）。 */
function closeCardOverlay() {
    const home = overlayHome;
    if (home === null)
        return;
    overlayHome = null;
    try {
        home.dialog.close();
    }
    catch (_e) {
        /* 已关闭 / 伪 DOM 无此方法 */
    }
    const parent = home.parent;
    if (parent !== null && typeof parent.insertBefore === 'function') {
        try {
            parent.insertBefore(home.host, home.next);
        }
        catch (_e) {
            parent.appendChild(home.host); // 原位置已失效（宿主重渲染）：父节点兜底
        }
    }
    const card = typeof home.host.querySelector === 'function' ? home.host.querySelector('div.' + MERMAID_CARD_CLASS) : null;
    if (card !== null && card.getAttribute(FS_ATTR) === FS_OPEN)
        card.removeAttribute(FS_ATTR);
    if (home.dialog.parentNode !== null)
        home.dialog.parentNode.removeChild(home.dialog);
}
/** 卡片卸载时收掉自己的浮窗（别关掉别的卡片的）。 */
function closeOverlayOf(entryId) {
    if (overlayHome !== null && overlayHome.entryId === entryId)
        closeCardOverlay();
}
/** 工具条「全屏」：开 / 关浮窗；返回切换后的浮窗态。 */
function toggleCardOverlay(entryId) {
    if (overlayHome !== null) {
        closeCardOverlay();
        return false;
    }
    const target = zoomTargetsOf(entryId);
    if (target === null)
        return false;
    openCardOverlay(target, entryId);
    // 浮窗里容器大得多 → 重新适应，一开就是铺满的大图。
    void bindZoom(target).then((state) => applyZoom(state, 'fit'));
    return target.card.getAttribute(FS_ATTR) === FS_OPEN;
}
/** teardown：收掉浮窗、解绑跟随监听、销毁实例、清表与加载缓存。 */
function teardownZoom() {
    closeCardOverlay();
    for (const state of zoomStates.values()) {
        if (typeof state.unwatch === 'function')
            state.unwatch();
        try {
            state.pz.destroy();
        }
        catch (_e) {
            /* 不阻断清理 */
        }
    }
    zoomStates.clear();
    panzoomReady = null;
}
Object.assign(exports,{PANZOOM_SCRIPT_URL,ZOOM_ATTR,FS_ATTR,FS_OPEN,FS_FAIL,FS_PANEL_ATTR,FS_CLASS,zoomTargetsOf,ensurePanzoom,bindZoom,zoomEntry,zoomKey,zoomWheelShouldHandle,toggleCardOverlay,closeCardOverlay,closeOverlayOf,zoomStates,teardownZoom});

    // 「渲染为…」语言手动切换（覆盖层 + 块内控件 + 卡片头并项）
    "use strict";
// ── 「渲染为…」语言手动切换（issue #470 需求 4）───────────────────────────
// 语言自动判定在真实宿主会误判（banner 只给本地化标签「代码块」），用户需要显式纠正手段：
// 块内（已是图表卡片时改在卡片头）追加**自有**控件，写块级覆盖 data-dsh-md-render-lang-force，
// 由 block-lang.ts 的 resolveFenceLangEx 在**最前面**读取。
// 口径：「用户显式意图 != 猜语言」—— 只在用户点过之后生效，不参与任何自动判定。
// 成本（已知情并接受）：原本零注入的块现在每块多一个自有节点；入口 hover 才显示，但**必须**
// 同时支持键盘 focus-within 与触屏常显（@media (hover:none)），只做 hover 手机点不到。
// 已是卡片时不再注入块内控件。视觉语言复用 ViewToggle 类，不引第二套。
/** 控件容器类名 + 块级标记（自有 DOM；块级标记兼作 hover 作用域）。 */
const LANG_SWITCH_CLASS = 'dsh-md-render-lang-switch';
const LANG_SWITCH_ATTR = 'data-dsh-md-render-lang-switch';
/** ViewToggle 的既有类名（复用视觉语言，不新增一套按钮样式）。 */
const LANG_SWITCH_BTN = 'dsh-md-render-mermaid-vt';
const LANG_SWITCH_GROUP = 'dsh-md-render-mermaid-view-toggle';
/** 控件已渲染的值（没变就不重建 DOM）。 */
const langSwitchRendered = new WeakMap();
function peekFenceLang(block) {
    const local = fenceLangOf(block);
    if (local !== undefined)
        return { lang: local, confirmed: true };
    const dom = blockLangDomLang(block);
    return { lang: dom !== '' && LANG_TOKEN_RE.test(dom) ? dom : '', confirmed: false };
}
/** 当前有效渲染方式（手动覆盖优先；`'' + confirmed` = 确证无语言）。 */
function langSwitchValue(block) {
    const forced = fenceForceOf(block);
    if (forced !== undefined)
        return forced;
    // 已接管的块按**观察到的状态**判定（卡片 host / 自有容器在），零额外判定。
    if (mermaidMounts.has(block))
        return 'mermaid';
    if (block.querySelector('div.' + BLOCK_MD_CLASS) !== null)
        return 'markdown';
    // 自研代码块视图：三态控件里没有对应选项 → 三个按钮都不激活（自动判定为「代码」）。
    if (block.querySelector('div.' + CODE_HOST_CLASS) !== null)
        return 'code';
    const peek = peekFenceLang(block);
    if (MERMAID_FENCE_LANGS.includes(peek.lang))
        return 'mermaid';
    if (TEXT_FENCE_LANGS.includes(peek.lang) || (peek.lang === '' && peek.confirmed))
        return 'markdown';
    return 'source';
}
/** 该块是否该有块内控件：渲染容器内 / 已是卡片 / 流式块都不管。 */
function langSwitchEnabled(block) {
    if (isInsideRenderedMarkdown(block))
        return false;
    if (mermaidMounts.has(block))
        return false;
    return !(block.closest && block.closest('[data-streaming]'));
}
/** 移除块内控件（卡片挂载时调用；卡片头自带另外两项）。 */
function removeLangSwitch(block) {
    const group = block.querySelector('div.' + LANG_SWITCH_CLASS);
    if (group !== null && group.parentNode)
        group.parentNode.removeChild(group);
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute(LANG_SWITCH_ATTR);
}
/** 切换渲染方式：写覆盖 -> 拆掉现接管方 -> 重扫重建（幂等）。 */
function applyLangForce(block, value) {
    setFenceForce(block, value);
    clearFenceView(block);
    // 视图属性也必须一起清：否则块停在接管视图，官方内容被自有 CSS 藏住 → 空块。
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute(BLOCK_VIEW_ATTR);
    const mounted = mermaidMounts.get(block);
    if (mounted !== undefined)
        unmountCard(block, mounted);
    syncLangSwitch(block);
    rescanForLangs();
}
/** 选项图标（共享图标集名）：「渲染为」三项各自的标识 —— 文字收起后它必须还在。 */
const LANG_SWITCH_ICONS = { mermaid: 'chart', markdown: 'markdown', source: 'code' };
/** 按名取共享图标（查不到退回 code，绝不返回空按钮）。 */
function langSwitchIcon(name, size) {
    const make = icon[name];
    return typeof make === 'function' ? make(size) : icon.code(size);
}
/** 单个选项按钮（块内版）：文字走 data-dsh-md-render-tip 悬停浮层，图标 React 渲染进按钮
 *  （按钮自身是命令式 DOM，子节点归 React —— 所以**不能**再手改 textContent）。 */
function langSwitchButton(block, option, value) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = value === option.value ? LANG_SWITCH_BTN + ' ' + LANG_SWITCH_BTN + '-active' : LANG_SWITCH_BTN;
    const tip = '渲染为' + option.label;
    btn.setAttribute('aria-label', tip);
    btn.setAttribute('data-dsh-md-render-tip', tip);
    btn.setAttribute('aria-pressed', value === option.value ? 'true' : 'false');
    renderNodeInto(btn, langSwitchIcon(LANG_SWITCH_ICONS[option.value] ?? 'code', 14));
    btn.addEventListener('click', () => applyLangForce(block, option.value));
    return btn;
}
/** 同步块内「渲染为…」控件（幂等；不该有控件时去掉）。 */
function syncLangSwitch(block) {
    if (typeof block.querySelectorAll !== 'function')
        return;
    if (!langSwitchEnabled(block)) {
        removeLangSwitch(block);
        return;
    }
    const value = langSwitchValue(block);
    const existing = block.querySelector('div.' + LANG_SWITCH_CLASS);
    if (existing !== null) {
        if (langSwitchRendered.get(existing) === value)
            return;
        if (existing.parentNode)
            existing.parentNode.removeChild(existing);
        langSwitchRendered.delete(existing);
    }
    const group = document.createElement('div');
    group.className = LANG_SWITCH_CLASS + ' ' + LANG_SWITCH_GROUP;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '渲染为');
    for (const option of FENCE_FORCE_OPTIONS)
        group.appendChild(langSwitchButton(block, option, value));
    block.appendChild(group);
    langSwitchRendered.set(group, value);
    block.setAttribute(LANG_SWITCH_ATTR, value);
}
/** 扫描 root（自身 / 后代）内的围栏代码块，同步各自的语言控件。 */
function scanLangSwitches(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches('div.md-code-block'))
        syncLangSwitch(root);
    for (const block of root.querySelectorAll('div.md-code-block'))
        syncLangSwitch(block);
}
// 卡片头的 CardLangSwitch 已删除（用户口径「外面有的，里面就别有了」）：它的
// 「渲染为 Markdown / 源码」与卡片头常驻的「预览 / 代码」是同一意图的两套入口。
// 块内控件（langSwitchButton 那套）保留 —— 它是**语言误判后的纠正入口**，代码块没有别的切换手段。
Object.assign(exports,{LANG_SWITCH_CLASS,LANG_SWITCH_ATTR,langSwitchValue,peekFenceLang,syncLangSwitch,scanLangSwitches,removeLangSwitch,applyLangForce});

    // 共享 DOM 扫描骨架 + 单 MutationObserver 按语言分流
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
//   3. 围栏块（自研 markdown / 自研代码块，mermaid 除外）；
//   4. mermaid / mmd 围栏块 —— 必须最后（它会给块写视图标记，与 3 的判定互斥，
//      语言集合不重叠；放最后保证「先按语言分流、再决定接管者」的顺序稳定）。
//
// 各注入点自身幂等（签名 / WeakSet / mounts Map），scanner 只负责枚举与调用。
//
// **每批扫描前先刷新围栏语言索引**（lang-source.ts）：本插件的语言判定主源是 client 侧
// 会话事件流索引（历史会话 + 冷启动唯一能命中的来源），它按事件源 `revision` 增量维护 ——
// revision 未变时刷新函数内部直接返回（成本 = 几个属性读）。放在最前：本轮所有块的
// 语言判定都该看到**同一份**表。取不到会话服务 / 任何异常 → 空表 → 全链路退回原有
// DOM 契约读法（行为与修复前一致）。
/** 扫描器持有的宿主 ctx（apply 时传入；只用于按需读会话事件流，见 lang-source.ts）。 */
let fenceScanContext = null;
/** 扫描单个节点（含自身）内的全部注入点。 */
function scanNode(node, round) {
    if (!node || typeof node.querySelectorAll !== 'function')
        return;
    // 悬挂 root 清扫：宿主重渲染把我们的容器抹掉时，对应的 React root 必须卸载
    // （否则 root + fiber 树一直活着）。放在最前，先释放再重建。
    sweepDetachedRoots();
    // 围栏语言表按批刷新（lang-source.ts）：事件源 revision 未变则内部直接返回。
    // 放在注入点之前：本轮所有块的语言判定共用同一份表（历史会话冷启动靠它命中）。
    refreshFenceLangIndex(fenceScanContext);
    const el = node;
    applyThinkExpand(el);
    if (typeof el.matches === 'function' && el.matches(CONTEXT_TEXT_SELECTOR))
        applyContextMarkdown(el);
    scanContextBlocks(el);
    scanFenceBlocks(el);
    scanMermaidBlocks(el, round);
    // 4. 语言手动切换控件（需求 4）—— 最后：mermaid 卡片挂载会决定该块用卡片头还是块内控件。
    scanLangSwitches(el);
}
/** 重扫轮次（语言索引回调专用；与骨架的批次轮次分开计数，避免伪装成同一批）。 */
let langRescanRound = 0;
/** 会话滚动容器选择器（与骨架的 rescanSelectors 取同一契约）。 */
const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]';
/**
 * 语言索引命中（或重试）后的重扫：只扫会话滚动容器，全部注入点幂等（不会重复挂载）。
 * **容器本身也要算**：querySelectorAll 只找后代，容器若就是扫描根（精简页面 / 测试夹具里
 * body 即容器）会一条都匹配不到 —— 那会让「命中后重扫」静默失效。
 */
function rescanForLangs() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function')
        return;
    langRescanRound += 1;
    const roots = [...document.querySelectorAll(CONVERSATION_SCROLL_SELECTOR)];
    const body = document.body;
    if (body && typeof body.matches === 'function' && body.matches(CONVERSATION_SCROLL_SELECTOR))
        roots.push(body);
    for (const root of roots)
        scanNode(root, langRescanRound);
}
/**
 * 观察 body；返回观察器 disposer（骨架负责观察配置 / 批次轮次 / disposer）。
 * `ctx` 只被 lang-source.ts 用来惰性读会话事件流（**刻意不声明 inject**，见该文件头部
 * 的 R1 实测结论）；不传 / 精简上下文 → 索引恒为空 → 退回原有 DOM 契约读法。
 */
function installScanner(ctx) {
    fenceScanContext = ctx ?? null;
    const uninstallRescan = installLangRescan(rescanForLangs);
    // 懒加载的渲染库（marked / hljs）就绪后重扫一次：加载期间落在「宿主官方形态」的块补渲染
    // （代码块则从纯文本换成高亮 —— 签名含就绪版本，重扫会重建）。
    const uninstallAssetReady = installRenderAssetReady(rescanForLangs);
    const dispose = installDomScanner({
        scan: (node, round) => scanNode(node, round),
        // 兜底重扫目标：会话滚动容器（流式结束后内容补全，不一定以 addedNodes 出现）。
        rescanSelectors: ['[data-conversation-scroll]'],
        onTeardown: () => {
            teardownMermaid();
            teardownZoom();
            teardownLangProbes();
            teardownRenderAssets();
            resetFenceIndex();
        },
    });
    return () => {
        dispose();
        uninstallRescan();
        uninstallAssetReady();
    };
}
Object.assign(exports,{installScanner});

    // 样式（DSH 语义 token，随 activation 注入）
    "use strict";
// ── 样式（**本插件自有的视觉语言**，随 activation 注入）────────────────────
// 口径（最高优先级）：「全部使用我们自己的，外观也是」—— 本文件**不再对齐官方视觉**：
// 布局 / 形状 / 间距 / 层级 / 边框 / 圆角 / 强调方式全部由本插件自己设计，官方样式只作为
// 「颜色与主题来源」被读取（--dsw-alias-* 语义色随深浅色自动切换，绝不硬编码十六进制）。
//
// **markdown 内容的外观真源 = 渲染原型**（docs/md渲染/原型/）：其几何（8/12/18/980）、字号阶梯
// （21/17/15/14/13/12）、间距（4/8/12/16/24）、动效（150ms/220ms + cubic-bezier(.28,0,.22,1)）、
// 线索色比例与交互状态逐条对齐，由 test/prototype-alignment.mjs 机器钉死（漂移即红）。
// 原型用 apple 固定十六进制，本插件**不照搬**——同名语义映射到宿主 --dsw-* 派生（见该测试的
// 「有意偏离」段与 docs/md渲染/概述.md）。
//
// 设计语言（一眼可辨的辨识点）：
//  ① **胶囊**：语言名 / 卡片标题 = 强调色 + 大写 + 字距的胶囊标签（官方是 11px 灰字标签）；
//     所有插件控件（复制 / 查看原文 / 导出 / 视图切换）统一为胶囊按钮，focus-visible 走
//     自家强调色描边 + 光晕（官方只给 2px 官方描边，指针模态下还会被宿主全局规则抹掉）。
//  ② **强调竖条**：代码卡片左侧 3px 强调色竖线、markdown 卡片左侧 2px 淡强调线、
//     h1 左侧 3px 竖线、引用块左侧 3px 竖线 —— 同一条"我们渲染的"视觉线索。
//  ③ **头部不再是通栏灰带**：语言胶囊 + 右侧 hover/focus 才浮现的复制按钮，
//     头部只留一层 5% 强调色薄底 + 一条发丝分隔线，与代码区同属一个圆角容器。
//  ④ **自有排版尺度**：正文 14px/1.75、标题 20/17/15.5/14.5/13.5/12（h6 大写小字），
//     代码 12.5px/1.7 等宽（官方 11px/19px）——不再使用 --dsw-font-markdown-* 排版 shorthand。
//  ⑤ **自有语法配色**：五色语义映射（蓝=关键字/紫罗兰?见下）全部由宿主状态色向正文色混合得到，
//     对比度不低于官方 shiki 调色板（实测见报告），且与块的强调色同源。
// 硬约束（test/static-assertions.mjs 钉死）：只写自有 DOM 与自有 data-* 作用域；不用 el.style；
// 不覆盖官方类名外观（官方子树的隐藏仍走「自有 CSS + 自有 data-* 视图值」那条既有路径）。
// 语法着色不再取 --shiki-token-*（那是官方 shiki 的调色板，逐 token 对齐等于照抄官方外观）；
// 改由本插件自己的语义映射 + color-mix 向正文色收敛，任何主题下都有对比度兜底。
const STYLES = `
/* ══ 设计 token（只在自有根元素上定义：自定义属性不会外溢到官方元素）══ */
.tzx-md,.dsh-md-render-text-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.dsh-md-render-lang-switch,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-fs,.dsh-md-render-img-lightbox,.dsh-md-render-fallback{
--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-accent-text:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 62%,var(--dsw-alias-label-primary));
--mdr-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);
--mdr-accent-line:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 55%,transparent);
--mdr-tint:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 6%,transparent);
/* 原型 03 条派生线索色（08-prototype.html 的 :root 派生块）——**颜色类一律宿主语义 token**：
   原型的 apple 十六进制与"按比例混色"都不照搬，因为混色方向在深色态会反转（见下 scrim）。
   逐字对齐原型的只有**几何 / 字号 / 间距 / 动效**（见 test/prototype-alignment.mjs）。 */
--mdr-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-hairline:var(--dsw-alias-border-l1);
--mdr-ok-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-bad-ink:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary));
/* 遮罩**必须**取宿主的遮罩 token：label-primary 在深色态是近白，按比例混会得到 55% 白雾
   （原型 §D2 警告过的"一片浅灰"，只是换了个成因）。宿主 bg-mask-* 是固定黑，深浅两态都变暗。 */
--mdr-scrim:var(--dsw-alias-bg-mask-3);
--mdr-line:var(--dsw-alias-border-l2);
--mdr-line-soft:var(--dsw-alias-border-l1);
--mdr-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);
--mdr-surface:var(--dsw-alias-markdown-code-block);
/* 几何：逐字对齐原型 02-style.md（--radius-sm/md/lg/pill = 8 / 12 / 18 / 980） */
--mdr-radius-sm:4px;--mdr-radius-md:8px;--mdr-radius-lg:10px;--mdr-pill:980px;
/* 字号阶梯：h1–h6 逐字对齐原型（21 / 17 / 15 / 14 / 13 / 12）——**原型取值是「正文 14px」下的基线**，
   这里改用宿主的**内容字号轴**平移，跟随「设置 → 外观 → 字号大小」（12–17）：正文 / 表格读
   --dsh-content-font-size；h1–h3 用 calc(原型值 + --dsh-content-font-delta)（宿主官方 markdown 同款写法，
   它 h1 也是 calc(21px + delta)）；h5 / h6 / 小字档**不缩放** —— 与宿主对 dense secondary text 的策略一致
   （缩到 11–12px 以下会掉可读性）。行高用相对倍数，天然跟随。 */
--mdr-fs-h1:calc(18px + var(--dsh-content-font-delta,0px));
--mdr-fs-h2:calc(16px + var(--dsh-content-font-delta,0px));
--mdr-fs-h3:calc(14px + var(--dsh-content-font-delta,0px));
--mdr-fs-h4:var(--dsh-content-font-size,14px);
--mdr-fs-h5:13px;--mdr-fs-h6:12px;
--mdr-fs-body:var(--dsh-content-font-size,14px);--mdr-fs-xs:12px;
/* 间距阶梯：对齐原型 --space-*（4 / 8 / 12 / 16 / 24） */
--mdr-space-1:4px;--mdr-space-2:8px;--mdr-space-3:12px;--mdr-space-4:16px;--mdr-space-6:24px;
/* 动效：对齐原型 --motion-fast / --motion-base / --ease-standard */
--mdr-motion-fast:150ms;--mdr-motion-base:220ms;--mdr-ease:cubic-bezier(0.28,0,0.22,1);
/* 焦点环：对齐原型 --focus-ring（4px 强调色光晕；inset 变体给会被 overflow 裁掉的滚动区） */
--mdr-focus-ring:0 0 0 4px color-mix(in srgb,var(--mdr-accent) 35%,transparent);
--mdr-focus-ring-inset:inset 0 0 0 4px color-mix(in srgb,var(--mdr-accent) 35%,transparent);
--mdr-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
--mdr-syn-keyword:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 88%,var(--dsw-alias-label-primary));
--mdr-syn-string:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-syn-number:color-mix(in srgb,var(--dsw-alias-state-warn-label) 70%,var(--dsw-alias-label-primary));
--mdr-syn-function:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 50%,var(--dsw-alias-label-primary));
--mdr-syn-comment:color-mix(in srgb,var(--dsw-alias-label-tertiary) 78%,var(--dsw-alias-label-primary));
--mdr-syn-deleted:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary));
--mdr-syn-variable:var(--dsw-alias-label-secondary);
}
/* ══ 自研 markdown 内容（.tzx-md 作用域）══
   own-markdown.ts 产出的 p / h1–h6 / ul / ol / table / blockquote / a / code 全部落在
   这个容器里。层级、字号、间距、强调方式**全部由本插件定义**（不取官方 markdown 排版 token），
   且**逐条对齐渲染原型**（段序与 08-prototype.html 的「markdown 渲染」段一一对应，便于比对）。 */
.tzx-md{position:relative;display:flex;flex-direction:column;gap:var(--mdr-space-3);min-width:0;font-size:var(--mdr-fs-body);line-height:1.6;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.tzx-md p{margin:0}
.tzx-md h1,.tzx-md h2,.tzx-md h3,.tzx-md h4,.tzx-md h5,.tzx-md h6{margin-top:0;font-weight:600}
.tzx-md h1{font-size:var(--mdr-fs-h1);line-height:1.4;letter-spacing:.1px}
.tzx-md h2{font-size:var(--mdr-fs-h2);line-height:1.4;letter-spacing:.1px}
.tzx-md h3{font-size:var(--mdr-fs-h3);line-height:1.4;letter-spacing:-.005em}
.tzx-md h4{font-size:var(--mdr-fs-h4);line-height:1.4;color:var(--dsw-alias-label-secondary)}
.tzx-md h5{font-size:var(--mdr-fs-h5);line-height:1.45;letter-spacing:.01em;color:var(--dsw-alias-label-secondary)}
.tzx-md h6{font-size:var(--mdr-fs-h6);line-height:1.5;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
/* 标题间距走原型的「相邻兄弟加距 + 标题后紧贴」机制（不靠标题自身 margin-top） */
.tzx-md>*+h1{margin-top:var(--mdr-space-3)}
.tzx-md>*+h2{margin-top:var(--mdr-space-3)}
.tzx-md>*+h3{margin-top:var(--mdr-space-2)}
.tzx-md>*+h4,.tzx-md>*+h5,.tzx-md>*+h6{margin-top:var(--mdr-space-1)}
.tzx-md h1+*,.tzx-md h2+*,.tzx-md h3+*,.tzx-md h4+*,.tzx-md h5+*,.tzx-md h6+*{margin-top:0}
.tzx-md ul,.tzx-md ol{margin:0;padding-left:var(--mdr-space-6);display:flex;flex-direction:column;gap:var(--mdr-space-1)}
.tzx-md li>p{margin:0}
.tzx-md li::marker{color:var(--dsw-alias-label-tertiary)}
.tzx-md ol>li::marker{font-variant-numeric:tabular-nums}
.tzx-md ul ul,.tzx-md ul ol,.tzx-md ol ul,.tzx-md ol ol{margin-top:var(--mdr-space-1);gap:var(--mdr-space-1)}
.tzx-md blockquote{margin:0;padding:6px var(--mdr-space-3);border-left:2px solid var(--mdr-accent);border-radius:0 7px 7px 0;background:var(--mdr-accent-soft);color:var(--dsw-alias-label-secondary)}
.tzx-md blockquote p{margin:0}
/* 嵌套引用降级：左竖线转中性、底色更淡，不与一级引用抢层级（原型同款） */
.tzx-md blockquote blockquote{margin-top:var(--mdr-space-2);border-left-color:var(--mdr-line);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}
.tzx-md hr{border:0;align-self:stretch;height:0;margin:2px 0;border-top:1px solid var(--mdr-line-soft)}
.tzx-md a{border-radius:3px;color:var(--dsw-alias-link);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--dsw-alias-link) 40%,transparent);text-decoration-thickness:1px;text-underline-offset:3px;transition:color var(--mdr-motion-fast) var(--mdr-ease),text-decoration-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md a:hover{text-decoration-color:currentColor}
.tzx-md a:active{color:var(--dsw-alias-label-primary)}
.tzx-md a:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
.tzx-md strong{font-weight:600}
.tzx-md em{font-style:italic}
.tzx-md del{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
/* 行内代码：原型未单列 .md-body code 规则，按其全局 code（4px 圆角 / 中性发丝边）收敛；
   字号 .86em 收一档、底色取宿主行内码 token、文字走强调色 —— 颜色全部随深浅色自动切换。 */
.tzx-md code.dsh-md-render-md-code{padding:2px 6px;border:1px solid var(--mdr-hairline);border-radius:var(--mdr-radius-sm);background:var(--mdr-code-bg);font-family:var(--mdr-mono);font-size:.86em;line-height:1.5;color:var(--mdr-accent-text)}
/* 裸链接退化成纯文本样式（原型：muted + 点状下划线） */
.tzx-md .dsh-md-render-md-link-plain{color:var(--dsw-alias-label-secondary);text-decoration:underline dotted}
/* 图片 alt：原型实测 meta 一档对 12px 小字只有 3.62:1，改用 muted 一档（过 4.5:1） */
.tzx-md .dsh-md-render-md-img-alt{color:var(--dsw-alias-label-secondary);font-size:var(--mdr-fs-xs)}
.tzx-md img.dsh-md-render-md-img{max-width:100%;height:auto;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface)}
/* 可放大的图片（own-markdown.ts 追加 dsh-md-render-img-zoom）：指针与键盘都能触达 */
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom{cursor:zoom-in;transition:border-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:hover{border-color:var(--mdr-accent-line)}
.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
.tzx-md .dsh-md-render-md-html{color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-plain{margin:0;padding:var(--mdr-space-3) var(--mdr-space-4);border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);font-family:var(--mdr-mono);font-size:var(--mdr-fs-xs);line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
/* 任务列表：勾选框也自绘（原生 disabled checkbox **不认** accent-color，实测宿主里恒为灰；
   ::before 画方框、::after 用 border 折角画勾，色彩全部取宿主语义变量 → 深浅色自动跟随。
   真实 input 仅 opacity:0（仍在无障碍树里，勾选状态可被读出），:has() 失配时整层退化为原生控件。
   勾选确认动效（原型 §D3）：勾形 rotate(45deg) scale(.6→1) + opacity，全长 150ms，只动 transform / opacity。 */
/* ⚠️ 这里**不写** cursor / :focus-within：真实 input 由 own-markdown.ts 渲染为 disabled+readOnly
   （markdown 是模型输出快照，勾选无法持久 —— 见文档「有意偏离」），写了就是永不触发的死规则。
   勾选态由 :has(:checked) 跟随**原文语义**（- [x]）呈现，键盘焦点环留给真正可交互的元素。 */
.tzx-md .dsh-md-render-md-task{position:absolute;left:0;top:4px;width:14px;height:14px;margin:0;appearance:none;border:0;background:transparent;opacity:0}
.tzx-md .dsh-md-render-md-task-item{position:relative;list-style:none;margin-left:calc(-1 * var(--mdr-space-6));padding-left:var(--mdr-space-6)}
.tzx-md .dsh-md-render-md-task-item::before{content:"";position:absolute;left:0;top:4px;width:14px;height:14px;border:1px solid var(--dsw-alias-label-tertiary);border-radius:4px;background-color:transparent;transition:background-color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-task-item:hover::before{border-color:var(--dsw-alias-label-secondary)}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::before{border-color:var(--mdr-accent);background-color:var(--mdr-accent)}
/* 已完成项：文字降一档 + 删除线（原型 .task-list li.is-done span 同款；本实现文字是裸内联内容，
   装饰挂在 li 上即可传播到整行文本，勾选框是绝对定位元素不受影响）。 */
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked){color:var(--dsw-alias-label-tertiary);text-decoration:line-through;text-decoration-color:var(--mdr-line)}
.tzx-md .dsh-md-render-md-task-item::after{content:"";position:absolute;left:4px;top:8.5px;width:4px;height:7px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 1.5px 1.5px 0;transform:rotate(45deg) scale(.6);opacity:0;transition:transform var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{transform:rotate(45deg) scale(1);opacity:1}
@supports not selector(:has(*)){.tzx-md .dsh-md-render-md-task{position:static;width:auto;height:auto;opacity:1;appearance:auto}.tzx-md .dsh-md-render-md-task-item{padding-left:0}.tzx-md .dsh-md-render-md-task-item::before,.tzx-md .dsh-md-render-md-task-item::after{display:none}}
/* 表格：圆角外框 + 中性表头薄底 + 发丝行线 + 行 hover（原型同款；表头不再是强调色薄底） */
.tzx-md .dsh-md-render-md-table-wrap{overflow-x:auto;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md);background:var(--mdr-surface)}
.tzx-md table.dsh-md-render-md-table{border-collapse:collapse;width:100%;min-width:420px;font-size:var(--mdr-fs-xs);line-height:1.55}
.tzx-md .dsh-md-render-md-table th,.tzx-md .dsh-md-render-md-table td{padding:7px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--mdr-line-soft)}
.tzx-md .dsh-md-render-md-table th{font-weight:600;background:var(--dsw-alias-bg-layer-2,var(--mdr-surface));border-bottom-color:var(--mdr-line)}
.tzx-md .dsh-md-render-md-table tbody tr td{transition:background-color var(--mdr-motion-fast) var(--mdr-ease)}
.tzx-md .dsh-md-render-md-table tbody tr:hover td{background:var(--dsw-alias-bg-layer-2,var(--mdr-tint))}
.tzx-md .dsh-md-render-md-table tbody tr:last-child td{border-bottom:0}
.tzx-md .dsh-md-render-md-left{text-align:left}
.tzx-md .dsh-md-render-md-center{text-align:center}
.tzx-md .dsh-md-render-md-right{text-align:right}
/* 窄视口表格降到小字（原型 768 断点同款） */
@media (max-width:768px){.tzx-md table.dsh-md-render-md-table{font-size:var(--mdr-fs-xs)}}
.dsh-md-render-fallback{display:block;margin:0;padding:12px 14px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap}
/* ══ 围栏块的 markdown 卡片：与代码卡片同一套边框 / 圆角 / 层次（自有设计系统）══
   block-render.ts 追加在 md-code-block 内；接管后隐藏官方全部直接子元素
   （banner 标签被宿主写死为「代码块」，对自研渲染的块是错误信息）；切回「源码」时自动恢复。 */
.dsh-md-render-text-md{padding:14px 16px 16px 18px;border:1px solid var(--mdr-line);border-left:2px solid var(--mdr-accent-line);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);box-shadow:var(--dsw-shadow-lv1)}
.md-code-block[data-dsh-md-render-text-view="markdown"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="code"]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-text-md{display:none}
.md-code-block[data-dsh-md-render-text-view="source"]>.dsh-md-render-code-host{display:none}
/* ══ 自研代码块（own-code.ts）：真实语言名胶囊 + 复制（hover / focus 浮现）+ 语法高亮 ══ */
.dsh-md-render-code-host{display:block;min-width:0}
/* container-type：把**卡片自身**声明为查询容器 —— 分档要按「可用宽度（消息列宽）」判，
   不是视口（大屏 + 侧栏展开时列可能只有 380px，视口断点判不到）。见下方 @container 分档。 */
.dsh-md-render-code{container-type:inline-size;position:relative;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--mdr-surface);box-shadow:var(--dsw-shadow-lv1)}
.dsh-md-render-code-head{display:flex;align-items:center;justify-content:flex-end;gap:var(--mdr-space-1);row-gap:2px;flex-wrap:wrap;padding:6px 10px 6px 12px;background:var(--dsw-alias-markdown-code-block-banner);border-bottom:1px solid var(--mdr-line-soft)}
.dsh-md-render-code-lang{margin-right:auto;min-width:0;overflow:hidden;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;text-overflow:ellipsis;white-space:nowrap;color:var(--mdr-accent-text)}
.dsh-md-render-code-lang:empty{display:none}
.dsh-md-render-code-actions{display:inline-flex;align-items:center;gap:var(--mdr-space-1);flex:none}
/* 代码主体行：行号列 + pre 共用一个滚动容器（原型 .fence-body 同构）——
   横向滚动时行号列跟着走，纵向滚动时两者一起走，天然对齐。 */
.dsh-md-render-code-body{display:flex;align-items:stretch;min-width:0;max-height:70vh;overflow:auto}
/* 行号列：与 pre 同字体 / 同字号 / 同行高 → 逐行对齐；用 pre 呈现换行、不参与选中/复制。
   右对齐 + 等宽数字（tabular-nums）：位数变化时列宽稳定。 */
.dsh-md-render-code-nums{flex:none;padding:12px 8px 12px 10px;border-right:1px solid var(--mdr-line-soft);background:transparent;font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;text-align:right;white-space:pre;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;user-select:none}
.dsh-md-render-code-pre{flex:1;min-width:0;margin:0;padding:12px 14px;overflow:visible;background:transparent;font-family:var(--mdr-mono);font-size:12.5px;line-height:1.7;tab-size:2;color:var(--dsw-alias-label-primary);white-space:pre;overflow-wrap:normal;word-break:normal}
.dsh-md-render-code-pre:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring-inset)}
.dsh-md-render-code-pre code{font:inherit;color:inherit;background:none;border:0;padding:0;white-space:inherit;word-break:inherit}
/* ── 插件控件统一形态：胶囊按钮（复制 / 查看原文 / 整段复制 / 导出 / 视图切换）── */
/* 统一 26px 方格图标按钮：图标常显、宽度恒定 —— 收起文字后不塌、排布整齐。
   position:relative 是浮层（下方 ::after）的定位锚点。 */
.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-code-lines-btn,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;padding:0;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:transparent;font:inherit;font-size:11px;font-weight:500;line-height:1;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color var(--mdr-motion-fast) var(--mdr-ease),background-color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease)}
.dsh-md-render-code-copy:hover,.dsh-md-render-code-wrap-btn:hover,.dsh-md-render-code-lines-btn:hover,.dsh-md-render-text-toggle:hover,.dsh-md-render-copy:hover,.dsh-md-render-mermaid-eb:hover:not(:disabled),.dsh-md-render-mermaid-vt:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
.dsh-md-render-code-copy:focus-visible,.dsh-md-render-code-wrap-btn:focus-visible,.dsh-md-render-code-lines-btn:focus-visible,.dsh-md-render-text-toggle:focus-visible,.dsh-md-render-copy:focus-visible,.dsh-md-render-mermaid-eb:focus-visible,.dsh-md-render-mermaid-vt:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
/* ── 控件「文字收起、只留图标」，悬停 / 键盘聚焦用**浮层**显示文字（用户口径）──
   为什么用浮层而不是就地撑开：就地撑开会把同一行相邻按钮推开 —— 鼠标扫过时整排抖动。
   浮层走 absolute（零布局位移）+ 向下弹出（top:100%）：卡片是 overflow:hidden，
   向上的浮层会被裁掉。
   文字来源是按钮的 data-dsh-md-render-tip（动作名，可较长）；aria-label 保持简短供屏幕阅读器 —— 两者职责不同。
   为什么必须每个按钮都有图标：没有图标的按钮收起文字就成空按钮，所以本轮补齐了
   maximize / fit / fill / minus / wrap / markdown / eye（共享图标集）并给所有控件接上。 */
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{content:attr(data-dsh-md-render-tip);position:absolute;top:calc(100% + 5px);right:0;z-index:2;padding:2px var(--mdr-space-2);border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:400;line-height:16px;white-space:nowrap;box-shadow:var(--dsw-shadow-lv2);pointer-events:none;opacity:0;transform:translateY(-2px);transition:opacity var(--mdr-motion-fast) var(--mdr-ease),transform var(--mdr-motion-fast) var(--mdr-ease)}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]:hover::after,
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]:focus-visible::after{opacity:1;transform:none}
/* 状态变化不能只靠悬停才知道（原型 §D 纪律）：复制成功 / 失败时浮层**常显**，
   与「图标换勾 + 语义色」一起构成不依赖鼠标的状态信号。 */
.dsh-md-render-copy[data-state="copied"]::after,.dsh-md-render-copy[data-state="failed"]::after,
.dsh-md-render-code-copy[data-state="copied"]::after{opacity:1;transform:none}
/* 触屏既没有 hover、也没有"悬停可发现"：按钮就地带文字（否则只剩图标，无从判断按钮做什么） */
@media (hover:none){
:is(.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-code-lines-btn,.dsh-md-render-text-toggle,.dsh-md-render-copy,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt){width:auto;min-width:26px;padding:0 var(--mdr-space-2)}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::before{content:attr(data-dsh-md-render-tip);white-space:nowrap}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{display:none}
}
/* ── 收纳取代「按宽度藏按钮」（用户口径 + 原型同步改版）──
   非核心进「更多」菜单后，常驻操作位只剩 3 个（视图切换 / 缩放分段 / 更多）：按钮从 8 个降到 3 个，
   就不存在「窄了该藏谁」的问题 —— 更少的按钮比「藏着但仍在」更干净。
   容器分档只留一条有实际意义的兜底：极窄（<360px）时缩放百分比值让位给图表（它是纯信息，不是操作）。
   降级：不支持 @container 的环境里百分比照常显示。 */
@container (max-width:359px){.dsh-md-render-mermaid-zoom-pct{display:none}}
/* 缩放分段：− / 百分比 / + 收进**一个**胶囊 —— 视觉上是一个控件，卡片头因此只需一行 */
.dsh-md-render-seg{display:inline-flex;align-items:center;flex:none;padding:2px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-pill);background:var(--mdr-tint)}
.dsh-md-render-seg>.dsh-md-render-mermaid-eb{border:0;background:transparent}
/* ── 「更多」菜单：低频按钮的**收纳处**（而不是长期占位）──
   绝对定位贴到触发按钮下方、右对齐：纯 CSS 定位（不写 el.style），锚点是工具条容器（position:relative）。
   菜单放在卡片内 —— 卡片没有 overflow 裁切（代码块才有，而代码块没有菜单）。 */
.dsh-md-render-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:6;min-width:176px;padding:var(--mdr-space-1);border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2)}
.dsh-md-render-menu[hidden]{display:none}
.dsh-md-render-menu-item{display:flex;align-items:center;gap:var(--mdr-space-2);width:100%;padding:var(--mdr-space-1) var(--mdr-space-2);border:0;border-radius:var(--mdr-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;text-align:left;white-space:nowrap;cursor:pointer}
.dsh-md-render-menu-item:hover,.dsh-md-render-menu-item:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-md-render-menu-item:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-menu-item svg{display:block;flex:none}
.dsh-md-render-menu-sep{height:1px;margin:var(--mdr-space-1) 0;border:0;background:var(--mdr-line-soft)}
/* 复制按钮：默认隐形，hover / 键盘 focus-within / 触屏常显三路可现 */
.dsh-md-render-code-copy{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-copy,.dsh-md-render-code:focus-within .dsh-md-render-code-copy{opacity:1}
@media (hover:none){.dsh-md-render-code-copy{opacity:1}}
/* 换行切换：与复制按钮同一套浮现策略（hover / focus-within / 触屏常显），
   按下态用强调色胶囊 —— 一眼可辨「当前在看换行还是横向滚动」。 */
.dsh-md-render-code-wrap-btn{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-wrap-btn,.dsh-md-render-code:focus-within .dsh-md-render-code-wrap-btn{opacity:1}
@media (hover:none){.dsh-md-render-code-wrap-btn{opacity:1}}
.dsh-md-render-code-wrap-btn[aria-pressed="true"]{border-color:var(--mdr-accent-line);background:var(--mdr-accent-soft);color:var(--mdr-accent-text)}
/* 行号切换：与换行同一套浮现策略（两者性质相同 —— 不改内容、只改呈现），按下态同样用强调色胶囊 */
.dsh-md-render-code-lines-btn{opacity:0}
.dsh-md-render-code:hover .dsh-md-render-code-lines-btn,.dsh-md-render-code:focus-within .dsh-md-render-code-lines-btn{opacity:1}
@media (hover:none){.dsh-md-render-code-lines-btn{opacity:1}}
.dsh-md-render-code-lines-btn[aria-pressed="true"]{border-color:var(--mdr-accent-line);background:var(--mdr-accent-soft);color:var(--mdr-accent-text)}
/* 换行态：长行折行显示（默认态是 white-space:pre 横向滚动，与官方 CodeBlock 的 wrap 语义对齐） */
.dsh-md-render-code-pre.dsh-md-render-code-wrap{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden}
.dsh-md-render-text-toggle{align-self:flex-end;margin-top:4px}
.dsh-md-render-text-toggle[aria-pressed="true"]{border-color:var(--mdr-accent-line);background:var(--mdr-accent-soft);color:var(--mdr-accent-text)}
/* ── 语法着色：本插件自己的语义映射（不取官方 shiki 调色板）──
   每一色都由宿主**状态色**向正文色混合得到：深浅色自动跟随，且对比度不低于官方调色板
   （官方 keyword #d6336c ≈4.5:1、string #2f9e44 ≈3.3:1；本映射见报告实测）。 */
.dsh-md-render-code-pre .hljs-keyword,.dsh-md-render-code-pre .hljs-selector-tag,.dsh-md-render-code-pre .hljs-literal,.dsh-md-render-code-pre .hljs-doctag,.dsh-md-render-code-pre .hljs-meta{color:var(--mdr-syn-keyword)}
.dsh-md-render-code-pre .hljs-string,.dsh-md-render-code-pre .hljs-regexp,.dsh-md-render-code-pre .hljs-symbol,.dsh-md-render-code-pre .hljs-bullet,.dsh-md-render-code-pre .hljs-addition,.dsh-md-render-code-pre .hljs-template-tag{color:var(--mdr-syn-string)}
.dsh-md-render-code-pre .hljs-comment,.dsh-md-render-code-pre .hljs-quote{color:var(--mdr-syn-comment);font-style:italic}
.dsh-md-render-code-pre .hljs-number,.dsh-md-render-code-pre .hljs-constant,.dsh-md-render-code-pre .hljs-built_in,.dsh-md-render-code-pre .hljs-type,.dsh-md-render-code-pre .hljs-class,.dsh-md-render-code-pre .hljs-tag{color:var(--mdr-syn-number)}
.dsh-md-render-code-pre .hljs-title,.dsh-md-render-code-pre .hljs-title.function_,.dsh-md-render-code-pre .hljs-title.class_,.dsh-md-render-code-pre .hljs-section,.dsh-md-render-code-pre .hljs-function{color:var(--mdr-syn-function)}
.dsh-md-render-code-pre .hljs-attr,.dsh-md-render-code-pre .hljs-attribute,.dsh-md-render-code-pre .hljs-variable,.dsh-md-render-code-pre .hljs-template-variable,.dsh-md-render-code-pre .hljs-params,.dsh-md-render-code-pre .hljs-property,.dsh-md-render-code-pre .hljs-punctuation{color:var(--mdr-syn-variable)}
.dsh-md-render-code-pre .hljs-link,.dsh-md-render-code-pre .hljs-name,.dsh-md-render-code-pre .hljs-selector-id,.dsh-md-render-code-pre .hljs-selector-class{color:var(--dsw-alias-link)}
.dsh-md-render-code-pre .hljs-deletion{color:var(--mdr-syn-deleted)}
.dsh-md-render-code-pre .hljs-emphasis{font-style:italic}
.dsh-md-render-code-pre .hljs-strong{font-weight:600}
/* ── 上下文注入块（pre[data-context-text]）渲染容器 ──
   插在宿主 pre 之前，宿主 pre 置 hidden（React 拥有该子树，不改其子结构）。 */
.dsh-md-render-context-md{padding:0}
/* ── 整段 markdown 复制按钮（hover / focus-within 浮现，流式中隐藏）── */
/* ⚠️ 尺寸**不再**单开例外（上一轮的 28px 文字胶囊已按「文字收起、只留图标」的口径撤回）：
   现在与卡片工具条同为 26px 方格图标按钮。别再把它撑成带文字的胶囊 —— 那会把整段复制的
   浮现按钮与工具条拉成两套形态。 */
.dsh-md-render-copy{opacity:0}
.tzx-md>.dsh-md-render-copy{position:absolute;right:10px;bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.tzx-md:hover>.dsh-md-render-copy,.tzx-md:focus-within>.dsh-md-render-copy{opacity:1}
.tzx-md>.dsh-md-render-copy:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--mdr-accent-line);color:var(--dsw-alias-label-primary)}
/* 复制成功 / 失败走「文字级」语义色（原型 §E2：原色对 12px 小字对比度不足） */
.dsh-md-render-copy[data-state="copied"],.dsh-md-render-copy-done{border-color:var(--mdr-ok-ink);color:var(--mdr-ok-ink)}
.dsh-md-render-copy[data-state="failed"]{border-color:var(--mdr-bad-ink);color:var(--mdr-bad-ink)}
/* 状态确认动效（原型 §D1）：颜色过渡 150ms + 勾形图标 scale(1.12) */
.dsh-md-render-copy-ico{transition:transform var(--mdr-motion-fast) var(--mdr-ease)}
.dsh-md-render-copy[data-state="copied"] .dsh-md-render-copy-ico{transform:scale(1.12)}
[data-streaming] .dsh-md-render-copy{display:none}
[data-streaming] .dsh-md-render-text-toggle{display:none}
/* ── mermaid 图表卡片（自有 DOM）：与代码 / markdown 卡片同一套边框 / 圆角 / 层次 ── */
.dsh-md-render-mermaid-host{display:block;min-width:0}
.md-code-block[data-dsh-md-render-mermaid-view]>:not([class*=dsh-md-render]):not(.tzx-md){display:none}
.dsh-md-render-mermaid-card{container-type:inline-size;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1);font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);animation:dsh-md-render-mermaid-card-in 150ms var(--ds-ease-in-out)}
.dsh-md-render-mermaid-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:nowrap}
/* 用户口径：卡片头**最多一行**（不换行、不溢出）。空间不够时先压标题（省略号），
   再由 @container 让掉百分比值。position:relative 是「更多」菜单的定位锚点。 */
.dsh-md-render-mermaid-card-actions{position:relative;display:flex;align-items:center;gap:var(--mdr-space-1);margin-left:auto;flex:none;flex-wrap:nowrap}
.dsh-md-render-mermaid-eb svg,.dsh-md-render-mermaid-vt svg,.dsh-md-render-mermaid-card-title svg{display:block;flex:none}
.dsh-md-render-mermaid-eb:disabled{opacity:.45;cursor:not-allowed}
.dsh-md-render-mermaid-notice{border-radius:var(--mdr-radius-sm);padding:4px 10px;font-size:12px;line-height:20px}
.dsh-md-render-mermaid-notice-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-md-render-mermaid-notice-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* 卡片标题与代码块语言胶囊同一形态：强调色 + 大写 + 字距（自有标签语言） */
.dsh-md-render-mermaid-card-title{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 22%,transparent);border-radius:var(--mdr-pill);background:var(--mdr-accent-soft);font-family:var(--mdr-mono);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--mdr-accent-text)}
.dsh-md-render-mermaid-view-toggle{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:var(--mdr-tint);flex:none}
.dsh-md-render-mermaid-vt{border:0;background:transparent}
.dsh-md-render-mermaid-view-toggle>.dsh-md-render-mermaid-vt-active{background:var(--mdr-accent-soft);color:var(--mdr-accent-text);font-weight:600}
.dsh-md-render-mermaid-svg{position:relative;overflow:auto;max-height:70vh;min-height:160px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent) 1px,transparent 1px);background-size:18px 18px}
.dsh-md-render-mermaid-svg[data-dsh-md-render-zoom]{overflow:hidden}
/* ⚠️ 变换层**必须留在文档流里**（高度 = 内容固有高度）：容器的 max-height:70vh 配上变换层
   撑开 ⇒ **容器高度随内容自适应**（短图矮、长图封顶 70vh）。曾试过让变换层绝对定位填满容器
   来对齐缩放锚点 —— 结果容器塌回 min-height(160px)：高度自适应没了，fit 又按 160px 算，
   图表被压到 20% 上下（用户真机反馈「所有都是固定高度」）。
   锚点（变换层中心）≠ 容器中心的问题由 zoom-math.ts 的 zoomCenterInFrame 在程序性缩放后
   **显式平移**解决 —— 不要再用改尺寸的方式绕。
   变换层也不写 transform-origin：两个引擎都会内联覆盖成 50% 50%，写在这里只会误导后来者。 */
.dsh-md-render-mermaid-canvas{display:flex;align-items:center;justify-content:center}
.dsh-md-render-mermaid-svg svg{max-width:100%;height:auto}
.dsh-md-render-mermaid-code{margin:0;padding:12px 14px;border:1px solid var(--mdr-line-soft);border-radius:var(--mdr-radius-md);background:var(--mdr-surface);overflow:auto;font-family:var(--mdr-mono);font-size:12px;line-height:1.7;white-space:pre-wrap}
.dsh-md-render-mermaid-loading{display:flex;align-items:center;gap:6px;padding:8px 6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-loading svg{flex:none;animation:dsh-md-render-mermaid-spin 1s linear infinite}
/* 失败态：源码是主视觉（第一屏），红横幅降为一行灰字提示（#470 需求 2） */
.dsh-md-render-mermaid-error{display:flex;flex-direction:column;gap:6px}
.dsh-md-render-mermaid-error-line{display:flex;align-items:center;gap:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-md-render-mermaid-error-line svg{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-md-render-mermaid-error-msg{white-space:pre-wrap;word-break:break-all}
.dsh-md-render-mermaid-retry{margin-left:auto;flex:none}
/* ── 「渲染为…」语言手动切换控件（自有 DOM）── hover / 键盘 focus-within / 触屏常显三路，
   作用域 = 自有块级标记，不碰官方 class。 */
.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{display:flex;justify-content:flex-end;margin-top:4px;padding:2px;border:1px solid var(--mdr-line);border-radius:var(--mdr-pill);background:var(--mdr-tint);opacity:0;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.md-code-block[data-dsh-md-render-lang-switch]:hover>.dsh-md-render-lang-switch{opacity:1}
.md-code-block[data-dsh-md-render-lang-switch]:focus-within>.dsh-md-render-lang-switch{opacity:1}
@media (hover:none){.md-code-block[data-dsh-md-render-lang-switch]>.dsh-md-render-lang-switch{opacity:1}}
/* ── 图表缩放 / 浮窗（需求 1，自有 DOM）──
   工具条按钮复用卡片按钮类；浮窗 = 页面内 <dialog> 模态（**非**浏览器全屏），
   卡片临时移入面板：遮罩 / Esc / 焦点归还 / 背景滚动锁定全由浏览器兜底。 */
/* 缩放百分比：分段中间的**显示值**（由 zoom-math.ts 更新 textContent）—— 不是动作名，保留文字 */
.dsh-md-render-mermaid-zoom-pct{display:inline-flex;align-items:center;justify-content:center;min-width:42px;font-family:var(--mdr-mono);font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-md-render-mermaid-fs{display:flex;flex-direction:column;gap:6px;width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;padding:8px 10px;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);font-size:14px;color:var(--dsw-alias-label-primary)}
.dsh-md-render-mermaid-fs::backdrop{background:color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent)}
.dsh-md-render-mermaid-fs-bar{display:flex;justify-content:flex-end;gap:6px;flex:none}
.dsh-md-render-mermaid-fs>.dsh-md-render-mermaid-host{flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-card{flex:1;min-height:0;overflow:hidden;padding:0;border:0;box-shadow:none}
.dsh-md-render-mermaid-fs .dsh-md-render-mermaid-svg{max-height:none;flex:1;min-height:0}
/* ── 图片放大灯箱（medium-zoom / PhotoSwipe 通行做法）：页面内 <dialog> 模态，
   图片 contain 装入、Esc / 点遮罩 / 点图片三路关闭；焦点归还由浏览器兜底。 ── */
/* 原型 §C：图片**直接浮在遮罩上**（不是面板）—— dialog 自身透明、无边框、无内边距；
   尺寸固定为 92vw×92vh 以保留「点空白区（= 遮罩）关闭」这条路径（原型同尺寸口径）。 */
.dsh-md-render-img-lightbox{display:flex;align-items:center;justify-content:center;width:92vw;height:92vh;max-width:none;max-height:none;margin:auto;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;cursor:zoom-out}
/* 遮罩抽成 --mdr-scrim token（原型 §D2：直接拿正文色混，深色态会变成一片浅灰） */
.dsh-md-render-img-lightbox::backdrop{background:var(--mdr-scrim)}
.dsh-md-render-img-lightbox-wrap{position:relative;display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%}
/* max-height 取 86vh 而不是 100%：给右上角外挂的关闭按钮（-14px -14px）留出可视余量（原型同口径） */
.dsh-md-render-img-lightbox-img{display:block;max-width:100%;max-height:86vh;object-fit:contain;border:1px solid var(--mdr-line);border-radius:var(--mdr-radius-md);box-shadow:var(--dsw-shadow-lv2)}
/* 关闭按钮：32px 圆形，挂在图片右上角外侧（原型同款）；Esc / 点遮罩 / 点图片三路关闭不变 */
.dsh-md-render-img-lightbox-close{position:absolute;top:-14px;right:-14px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:32px;padding:0;border:0;border-radius:var(--mdr-pill);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;box-shadow:var(--dsw-shadow-lv2)}
/* 叉线：两条 1.8px 圆角线对折 45°（等价于原型 16px viewBox 的 1.8 stroke path） */
.dsh-md-render-img-lightbox-close::before,.dsh-md-render-img-lightbox-close::after{content:"";position:absolute;width:14px;height:1.8px;border-radius:1px;background:currentColor}
.dsh-md-render-img-lightbox-close::before{transform:rotate(45deg)}
.dsh-md-render-img-lightbox-close::after{transform:rotate(-45deg)}
.dsh-md-render-img-lightbox-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-md-render-img-lightbox-close:focus-visible{outline:none;box-shadow:var(--mdr-focus-ring)}
/* 图片放大浮窗进入动效（原型 §D4）：220ms opacity + scale(.985→1)，遮罩淡入 */
.dsh-md-render-img-lightbox[open]{animation:dsh-md-render-dlg-in var(--mdr-motion-base) var(--mdr-ease)}
.dsh-md-render-img-lightbox[open]::backdrop{animation:dsh-md-render-dlg-backdrop-in var(--mdr-motion-base) var(--mdr-ease)}
@keyframes dsh-md-render-dlg-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}
@keyframes dsh-md-render-dlg-backdrop-in{from{opacity:0}to{opacity:1}}
/* ── 离屏渲染容器（失败时的炸弹图只落这里）── 必须在布局树内（display:none 会量不到尺寸）。 */
.dsh-md-render-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
@keyframes dsh-md-render-mermaid-card-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}
@keyframes dsh-md-render-mermaid-spin{to{transform:rotate(360deg)}}
/* ══ 动效纪律（原型 §D / craft animation-discipline）══
   · hover 与微状态高频 → --mdr-motion-fast(150ms)；进入 UI → --mdr-motion-base(220ms)
   · 只动 transform / opacity；动画不作为状态变化的唯一信号（勾选框本身、按钮文案同步变化）
   · prefers-reduced-motion：全部关掉，**不做**妥协式"缩短"
   范围：markdown 内容 + 整段复制 + 图片放大浮窗（卡片 / 图表动效不在本轮范围，见文档）。 */
@media (prefers-reduced-motion:reduce){
.tzx-md a,.tzx-md img.dsh-md-render-md-img.dsh-md-render-img-zoom,.tzx-md .dsh-md-render-md-table tbody tr td,.tzx-md .dsh-md-render-md-task-item::before{transition:none}
.tzx-md .dsh-md-render-md-task-item::after{transform:rotate(45deg);opacity:0;transition:none}
.tzx-md .dsh-md-render-md-task-item:has(>.dsh-md-render-md-task:checked)::after{transform:rotate(45deg);opacity:1}
.dsh-md-render-copy,.dsh-md-render-copy-ico,.dsh-md-render-code-copy,.dsh-md-render-code-wrap-btn,.dsh-md-render-code-lines-btn,.dsh-md-render-text-toggle,.dsh-md-render-mermaid-eb,.dsh-md-render-mermaid-vt{transition:none}
.dsh-md-render-copy[data-state="copied"] .dsh-md-render-copy-ico{transform:none}
:is(.tzx-md,.dsh-md-render-code,.dsh-md-render-mermaid-card,.md-code-block) [data-dsh-md-render-tip]::after{transition:none}
.dsh-md-render-img-lightbox[open],.dsh-md-render-img-lightbox[open]::backdrop{animation:none}
}
`;

    // 共享样式注入 / 图标集（dsh-shared/client-parts）
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

    // 设置页：文案 / 样式（i18n）+ 三分组视图 + tab 注册（单 tab）
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
    copyButtonHint: mdRenderText('MarkdownView 整段内容一键复制（本插件自研 markdown 渲染 + 整段复制）', 'One-click copy for the whole MarkdownView (plugin-built markdown rendering + whole-content copy)'),
    textFenceLabel: mdRenderText('围栏块渲染（自研）', 'Render code fences (built-in)'),
    textFenceHint: mdRenderText('所有围栏代码块都由本插件自己的渲染器产出：text / 无语言块按 markdown 渲染，其余语言渲染为带真实语言名与语法高亮的代码块；每块可切回官方源码视图', 'Every fenced block is rendered by this plugin own renderer: text / unlabelled blocks as markdown, other languages as a code block with the real language name and syntax highlighting; each block can switch back to the host source view'),
    contextLabel: mdRenderText('上下文注入块渲染', 'Render context-injection blocks'),
    contextHint: mdRenderText('宿主以纯文本呈现的上下文注入正文（子 agent 消息 / AGENTS.md）由本插件自己的 markdown 渲染器渲染', 'Render plain-text context bodies (sub-agent messages / AGENTS.md) with this plugin own markdown renderer'),
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
        // issue #443（对齐 #460 的落地方式）：DSH >= 0.1.7 的新版插件管理器
        // （client-ui-plugin-manager）把插件配置页放在**组合包详情页**，由它自己声明
        // `plugins.bundle.config`（keyed slot，key = 组合包 npm 包名，只在 view: 'page'
        // 时渲染）。**追加**这一处注册，上面的 `settings.plugins.tab` 一并保留 ——
        // 旧入口在 DSH < 0.1.7 与「设置 → 内置插件」分区仍然有效，替换会让那些版本丢入口。
        // 字面量（不用常量）：静态断言 test/static-assertions.mjs 从**产物**里抽取
        // `inject('…')` 的字面量做白名单校验，变量名抽不出来。
        slots.inject('plugins.bundle.config', () => slots.register({
            name: MD_RENDER_BUNDLE_CONFIG_SLOT,
            key: MD_RENDER_PACKAGE_NAME,
        }, mdRenderBundleConfigView));
        return undefined;
    }, 'dsh-md-render: settings tab registration');
}
/** DSH >= 0.1.7 插件管理器的组合包详情页配置 slot（keyed）。 */
const MD_RENDER_BUNDLE_CONFIG_SLOT = 'plugins.bundle.config';
/**
 * keyed slot 的 key：必须是本组合包的 npm 包名（宿主按包名派发），
 * 与 package.json 的 `name` 一致 —— test/settings-bundle-config.mjs 会核对两者。
 */
const MD_RENDER_PACKAGE_NAME = 'dsh-md-render';
/**
 * 组合包详情页配置视图（issue #443）：
 *  - `view === 'summary'` → 返回 null（摘要/列表页不渲染多余组件，不占位）；
 *  - `'page'` / props 缺省（老宿主不传 props）→ 复用现有设置页视图。
 */
function mdRenderBundleConfigView(props) {
    if (props !== undefined && props !== null && props.view === 'summary')
        return null;
    return mdRenderSettingsView();
}

    // 插件入口：样式注入 + 扫描器装配 + 设置页
    "use strict";
// **刻意保持零 inject**（R1 实测，见 lang-source.ts 头部 / 报告）：
// dsh-md-render 是纯增强插件，硬 inject 在服务缺失时会让 apply **根本不执行** ——
// 整个 client 半失效（样式 / 设置页 / 全部注入点一起没）。会话事件流（围栏语言索引的
// 主源）改用 ctx.get('sessions', false) 惰性取：服务在则取到、服务缺则 undefined 不抛、
// 服务晚于 apply 提供也照样取到（cordis 4 的 ReflectService.get 契约即
// "without the inject requirement"）。inject:{optional:[...]} 在 cordis 4.0.4 不被支持
// （实测 apply 不执行），故也不用。
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
    // 传 ctx 进去：scanner 每批扫描前用它按需刷新围栏语言索引（lang-source.ts）。
    // 需求 4 的「刷新后仍记得」：启动时恢复上次的「渲染为…」覆盖（不可用 -> 空表，退回自动判定）。
    restoreFenceForces();
    ctx.effect(() => installScanner(ctx), 'dsh-md-render: scanner');
    // 设置页 tab（官方 slots 扩展点，单 tab 三分组）。
    attachSettingsTab(ctx);
};


    return module.exports
  },
})
