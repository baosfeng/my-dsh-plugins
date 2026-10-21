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
const MERMAID_ENGINE_URL = "/md-render/assets/mermaid-12.2.0.min.js"
const PANZOOM_SCRIPT_URL = "/md-render/assets/panzoom-4.6.2.min.js"
const MARKED_URL = "/md-render/assets/marked-18.1.0.umd.js"
const HIGHLIGHTJS_URL = "/md-render/assets/highlightjs-11.12.0.min.js"
const LANGS_API_URL = "/md-render/api/langs"
const LANGS_HASH_PARAM = "h"
const PROJECT_LANG_API_URL = "/md-render/api/project-lang"
const PROJECT_LANG_CWD_PARAM = "cwd"
    // 渲染配置（三段开关 + 旧扁平键兼容）+ 围栏语言索引（issue #466）
    "use strict";
// ── 渲染配置：三段命名空间化开关（markdown / thinking / mermaid）─────────
// 与 host 半 lib/config.js 的 schema 一一对应（同一份默认值语义）：
//  - markdown.copyButton / textFenceMarkdown / contextMarkdown / inferLang  默认开（!== false）
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
    markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true, inferLang: true },
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
            'inferLang',
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
 *     confirmed = true；**`''` = 确证无语言**同样算确证（后续交给 fence-content 按内容分流）；
 *  ② 取不到 → {@link resolveBlockLangEx}（DOM token / host 索引命中才算确证）。
 * 调用方按 `confirmed` 区分「确证无语言」与「识别失败」：后者原样按代码卡接管（语言位留空）。
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

    "use strict";
// ── 无语言围栏的内容分流：像 markdown 文档 / 像代码 ──────────────────────
// 背景（2026-10-20 真实会话取证）：208 个围栏里 200 个无语言标记（184 个在思考块里），
// 内容是 Kotlin / SQL / shell —— 旧口径「无语言一律 markdown」把代码折叠成一坨。
// 现在先看内容：明显是 markdown 文档才 markdown 化，否则代码卡（等宽、保留换行）。
// 边界：只判「是不是 markdown 文档」（不猜语言、不改写内容）；拿不准一律按代码卡
// （误判成代码只是没美化，误判成 markdown 会破坏代码结构）。判据 = markdown 块级特征
// 加权 ≥ 2 且**零代码特征**。脚本模式片段（无 import/export）。
/** markdown 块级特征（行首，允许 0–3 空格缩进）。 */
const FENCE_MD_HEADING = /^ {0,3}#{1,6}[ \t]+\S/;
const FENCE_MD_QUOTE = /^ {0,3}>[ \t]?\S/;
const FENCE_MD_LIST = /^ {0,3}(?:[-*+][ \t]+\S|\d{1,9}\.[ \t]+\S)/;
/** GFM 表格分隔行：至少两格 `---`，可带 `:` 对齐标记。 */
const FENCE_MD_TABLE_SEP = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
/** 首尾都有管道符的表格行。 */
const FENCE_MD_TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/;
/** 分隔线：`***` / `---` / `___`（≥3 个，可夹空格）。 */
const FENCE_MD_THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** 行内 markdown 标记（粗体 / 行内代码 / 链接）——弱证据，只在非代码行计入。 */
const FENCE_MD_INLINE = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/;
/** 代码特征：行首关键字（Kotlin / Java / TS / Python / Go / SQL / shell 的常见开局）。 */
const FENCE_CODE_KEYWORD = /^[\t ]*(?:val|var|fun|class|object|interface|private|public|protected|internal|import|package|def|const|let|function|return|if|else|elif|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|yield|async|await|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|System\.|console\.|echo|export|using|struct|enum|namespace|typedef|require|module)\b/;
/** 代码特征：注解行（`@Composable` / `@Override` / `@Test` …）。 */
const FENCE_CODE_ANNOTATION = /^[\t ]*@[A-Za-z_]\w*/;
/** 代码特征：行尾语句 / 块符号（`;` `{` `}` `=>` `->` `):`）。 */
const FENCE_CODE_TRAIL = /(?:[;{}]|=>|->|\)[ \t]*[:{])[ \t]*$/;
/** 代码特征：以 2+ 空格或 tab 开头的续行（markdown 列表行已排除）。 */
const FENCE_CODE_INDENT = /^(?: {2,}|\t)\S/;
/** 代码特征：运算符（逻辑 / 比较 / 作用域 / 箭头；`--`、`++` 信号太弱、易与表格分隔线撞车，不计）。 */
const FENCE_CODE_OPERATOR = /(?:&&|\|\||::|=>|->|!==|===|!=|==|\+=|-=)/;
/** 单行 → markdown 结构特征（表格分隔与分隔线互斥：`| --- | --- |` 只算表格分隔）。 */
function classifyMarkdownLine(line) {
    const tableSep = FENCE_MD_TABLE_SEP.test(line);
    return {
        heading: FENCE_MD_HEADING.test(line),
        tableSep,
        tableRow: !tableSep && FENCE_MD_TABLE_ROW.test(line),
        quote: FENCE_MD_QUOTE.test(line),
        list: FENCE_MD_LIST.test(line),
        thematic: !tableSep && FENCE_MD_THEMATIC.test(line),
    };
}
/** 是否 markdown 结构行（是 → 只计正分，**不参与代码特征**）。 */
function isMarkdownStructure(kind) {
    return kind.heading || kind.tableSep || kind.tableRow || kind.quote || kind.list || kind.thematic;
}
/** 结构行的 markdown 正分（标题与表格分隔是块级强特征，各 2 分）。 */
function markdownScoreOfStructure(kind) {
    let score = 0;
    if (kind.heading)
        score += 2;
    if (kind.tableSep)
        score += 2;
    if (kind.tableRow)
        score += 1;
    if (kind.quote)
        score += 1;
    if (kind.list)
        score += 1;
    if (kind.thematic)
        score += 1;
    return score;
}
/** 普通行的代码特征分（注解 / 行首关键字 / 行尾符号 / 缩进续行 / 运算符，各自 1 分）。 */
function codeScoreOfLine(line) {
    let score = 0;
    if (FENCE_CODE_ANNOTATION.test(line))
        score += 1;
    if (FENCE_CODE_KEYWORD.test(line))
        score += 1;
    if (FENCE_CODE_TRAIL.test(line))
        score += 1;
    if (FENCE_CODE_INDENT.test(line))
        score += 1;
    if (FENCE_CODE_OPERATOR.test(line))
        score += 1;
    return score;
}
/** 普通行的行内 markdown 弱证据（只在不像代码行时计 1 分）。 */
function inlineMarkdownScoreOfLine(line) {
    if (FENCE_CODE_TRAIL.test(line) || FENCE_CODE_KEYWORD.test(line))
        return 0;
    return FENCE_MD_INLINE.test(line) ? 1 : 0;
}
/** 逐行计分（空行跳过；不看语言、不看代码内容语义）。 */
function scoreFenceContent(source) {
    const lines = String(source ?? '').split('\n');
    let markdown = 0;
    let code = 0;
    for (const line of lines) {
        if (line.trim() === '')
            continue;
        const kind = classifyMarkdownLine(line);
        if (isMarkdownStructure(kind)) {
            // 结构行只计正分：否则表格分隔行 `| --- | --- |` 会被 `--` 类运算符误伤成代码。
            markdown += markdownScoreOfStructure(kind);
            continue;
        }
        markdown += inlineMarkdownScoreOfLine(line);
        code += codeScoreOfLine(line);
    }
    return { markdown, code };
}
/**
 * 无语言围栏是否**明显是 markdown 文档**（判据见文件头）：
 * `markdown 分 ≥ 2` 且 **零代码特征**；否则一律按代码卡（保守：不美化也不破坏）。
 */
function fenceLooksLikeMarkdown(source) {
    const score = scoreFenceContent(source);
    return score.markdown >= 2 && score.code === 0;
}
Object.assign(exports,{scoreFenceContent,fenceLooksLikeMarkdown});
 "use strict";
// ── 无语言围栏的语言推断：内容识别优先，项目主语言兜底 ────────────────────
// 无语言块按代码卡渲染但语言位留空、无高亮 → 本模块推断一个语言：
//   ① 内容识别（高置信特征、纯函数、零 IO）：JSON / shell / SQL / Kotlin / Python / TS /
//     JS / Java / C++ / HTML / CSS；② 项目主语言（会话 cwd 的构建标记文件，见
//     src/routes/project-lang.ts）；③ 日志块与认不出的 → 留空。
// 边界：只用于高亮 + 胶囊，带 data-mdr-lang-inferred 标识（不冒充原文标注）、**不参与分流**；
// 请求失败 / 无会话服务 / 无 fetch 静默降级；cwd 与结果按会话有界缓存（TTL 10 分钟）。
// 脚本模式片段（无 import/export）。
/** 内容识别规则（**顺序即优先级**：越特异的特征越靠前）。 */
const INFER_CONTENT_RULES = [
    { lang: 'json', test: (text) => looksLikeJson(text) },
    {
        lang: 'bash',
        test: (text) => /^#!.*\b(?:ba|z|k)?sh\b/.test(text) ||
            /(?:^|\n)[ \t]*(?:export[ \t]+\w+=|[A-Z][A-Z0-9_]+=\S)/.test(text) ||
            /(?:^|\n|[\s&|;])(?:~\/|\.\/|\/)[\w./-]*\b(?:adb|gradlew|apkanalyzer|emulator|xcodebuild)\b/.test(text) ||
            /(?:^|\n|[\s&|;])(?:adb|npm|npx|pnpm|yarn|git|brew|curl|wget|cd|ls|mkdir|rm|cp|mv|docker|kubectl|gradlew|pip3?|python3?|node|cargo|deno|bun)[ \t]+[-\w./]/.test(text),
    },
    {
        lang: 'sql',
        test: (text) => /^[ \t]*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b/im.test(text) ||
            // SQL 片段（没有 SELECT 开头）：LIKE / WHERE … = / IN / IS / JOIN 这类强特征。
            // 注意 `=` 后没有词边界（`= 1` 两侧都是非单词字符），单独用 `=(?!=)`。
            /\b(?:LIKE[ \t]+'|WHERE[ \t]+\w+[ \t]*(?:[<>!=]=|=(?!=)|\bIN\b|\bIS\b|\bLIKE\b)|\b(?:INNER|LEFT|RIGHT)[ \t]+JOIN[ \t]+\w+\b|GROUP[ \t]+BY\b|ORDER[ \t]+BY[ \t]+\w+)/i.test(text),
    },
    {
        lang: 'kotlin',
        test: (text) => /(?:^|\n)[ \t]*(?:private\s+|internal\s+|public\s+)?(?:const\s+)?(?:val|var|fun)\s+\w+/.test(text) ||
            /(?:^|\n)[ \t]*object\s+\w+\s*\{/.test(text) ||
            /@[A-Z][A-Za-z0-9_]*\b/.test(text),
    },
    {
        lang: 'python',
        test: (text) => /(?:^|\n)[ \t]*(?:def\s+\w+\s*\(|class\s+\w+[^:]*:|import\s+\w+|from\s+\w+\s+import\b)/.test(text) ||
            /\bself\.\w+/.test(text),
    },
    {
        lang: 'typescript',
        test: (text) => /\b(?:interface|type)\s+\w+\s*[={]|\bimport\s+type\b|:\s*(?:string|number|boolean|unknown|void)\b/.test(text),
    },
    {
        lang: 'javascript',
        test: (text) => /\b(?:const|let)\s+\w+\s*=|\bfunction\s+\w+\s*\(|=>\s*\{|\bconsole\.\w+|\brequire\(/.test(text),
    },
    {
        lang: 'java',
        test: (text) => /\bpublic\s+(?:static\s+)?(?:void|class|interface)\b|\bSystem\.out\.print/.test(text),
    },
    { lang: 'cpp', test: (text) => /^[ \t]*#include[ \t]*[<"]|\bstd::/.test(text) },
    {
        lang: 'html',
        test: (text) => /^[ \t]*<!(?:DOCTYPE|doctype)\b|^[ \t]*<(?:html|head|body|div|span|section|script|style)\b/.test(text),
    },
    {
        lang: 'css',
        test: (text) => /(?:^|\n)[ \t]*[.#]?[\w-]+[ \t]*\{[^}]*:[^;{}]+;/.test(text),
    },
];
/** 项目主语言缓存 TTL（与 host 半 CACHE_TTL_MS 同口径）。 */
const INFER_PROJECT_TTL_MS = 10 * 60 * 1000;
/** 项目主语言缓存：{ cwd, lang, at }（每会话一份，有界）。 */
let inferredProjectLang = null;
/** 请求进行中（避免同一轮扫描重复发请求）。 */
let inferredProjectPending = false;
/** 已经失败过的 cwd（不反复重试；换 cwd 会重置）。 */
let inferredProjectFailed = '';
/** 严格 JSON（首字符 `{` / `[` 且 JSON.parse 成功）。 */
function looksLikeJson(text) {
    const trimmed = text.trim();
    if (trimmed.length < 2)
        return false;
    const first = trimmed.charAt(0);
    if (first !== '{' && first !== '[')
        return false;
    try {
        JSON.parse(trimmed);
        return true;
    }
    catch (_e) {
        return false;
    }
}
/** 明显是运行时日志（时间戳行占多数）：日志没有语言可高亮，**不参与项目主语言兜底**。 */
function looksLikeLog(text) {
    const lines = String(text ?? '')
        .split('\n')
        .filter((line) => line.trim() !== '');
    if (lines.length === 0)
        return false;
    const stamped = lines.filter((line) => /^[ \t]*\d{2}:\d{2}:\d{2}[.,]\d{1,3}\b/.test(line) ||
        /^[ \t]*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(line) ||
        /^[ \t]*\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d{3}\b/.test(line)).length;
    return stamped >= Math.max(1, Math.ceil(lines.length / 2));
}
/** 内容识别：命中返回语言名，否则 ''（纯函数、零 IO）。 */
function inferLangByContent(code) {
    const text = String(code ?? '');
    if (text.trim() === '')
        return '';
    for (const rule of INFER_CONTENT_RULES) {
        if (rule.test(text))
            return rule.lang;
    }
    return '';
}
/** 会话 cwd（`sessions.binding(id).session.getSnapshot().cwd`；取不到 → ''）。 */
function sessionCwdOf(ctx) {
    const sessions = sessionsService(ctx);
    if (sessions === null)
        return '';
    try {
        const id = mainSessionId(sessions);
        if (id === '')
            return '';
        const binding = typeof sessions.binding === 'function' ? sessions.binding(id) : null;
        const session = propOf(binding, 'session');
        if (session === null || session === undefined || typeof session.getSnapshot !== 'function')
            return '';
        const snapshot = session.getSnapshot();
        const cwd = propOf(snapshot, 'cwd');
        return typeof cwd === 'string' ? cwd : '';
    }
    catch (_e) {
        return '';
    }
}
/** 当前缓存的项目主语言（过期 / cwd 不一致 → ''）。 */
function cachedProjectLang(cwd) {
    if (inferredProjectLang === null)
        return '';
    if (inferredProjectLang.cwd !== cwd)
        return '';
    if (Date.now() - inferredProjectLang.at > INFER_PROJECT_TTL_MS)
        return '';
    return inferredProjectLang.lang;
}
/** 请求 host 半探测项目主语言（失败 / 非 200 / 结构不符 → ''）。 */
async function fetchProjectLang(cwd) {
    if (typeof fetch !== 'function')
        return '';
    try {
        const url = PROJECT_LANG_API_URL + '?' + PROJECT_LANG_CWD_PARAM + '=' + encodeURIComponent(cwd);
        const response = await fetch(url);
        if (response === null || response === undefined || response.ok === false)
            return '';
        const body = (await response.json());
        if (body === null || body.ok !== true)
            return '';
        const lang = propOf(body.value, 'lang');
        return typeof lang === 'string' ? lang.toLowerCase() : '';
    }
    catch (_e) {
        return '';
    }
}
/**
 * 按需刷新「项目主语言」（每个扫描批开头调用一次）：
 * 已有缓存 / 请求进行中 / 已失败过同一 cwd / 取不到 cwd → 直接返回（成本 = 几个属性读）。
 * 请求成功触发一次重扫（把语言胶囊与高亮补上）。
 */
/** 会话切换 / 失败标记复位：cwd 变了就丢掉上一份缓存与失败记录。 */
function syncProjectLangCwd(cwd) {
    if (inferredProjectLang !== null && inferredProjectLang.cwd !== cwd)
        inferredProjectLang = null;
    if (inferredProjectFailed !== '' && inferredProjectFailed !== cwd)
        inferredProjectFailed = '';
}
/** 发起一次项目主语言请求（并发去重；成功触发重扫，失败记住该 cwd 不再重试）。 */
function requestProjectLangOnce(cwd) {
    inferredProjectPending = true;
    void fetchProjectLang(cwd).then((lang) => {
        inferredProjectPending = false;
        if (lang === '') {
            inferredProjectFailed = cwd;
            return;
        }
        inferredProjectLang = { cwd, lang, at: Date.now() };
        if (typeof rescanForLangs === 'function')
            rescanForLangs();
    });
}
/**
 * 按需刷新「项目主语言」（每个扫描批开头调用一次）：
 * 已有缓存 / 请求进行中 / 已失败过同一 cwd / 取不到 cwd / 开关关闭 → 直接返回（成本 = 几个属性读）。
 */
function refreshInferredLang(ctx) {
    try {
        if (renderOptions.markdown.inferLang === false)
            return;
        const cwd = sessionCwdOf(ctx);
        if (cwd === '')
            return;
        syncProjectLangCwd(cwd);
        if (cachedProjectLang(cwd) !== '' || inferredProjectPending || inferredProjectFailed === cwd)
            return;
        requestProjectLangOnce(cwd);
    }
    catch (_e) {
        inferredProjectPending = false;
    }
}
/** 块源码（官方 `pre.textContent`；取不到 → ''）。 */
function inferCodeOfBlock(block) {
    if (block === null || block === undefined || typeof block.querySelector !== 'function')
        return '';
    const pre = block.querySelector('pre');
    return pre === null || pre === undefined ? '' : (pre.textContent ?? '');
}
/**
 * 推断块语言（唯一入口）：内容识别 → 项目主语言 → 留空。
 * 返回 `source` 供胶囊标注（'content' / 'project' / ''），**不改变分流**。
 */
function inferredFenceLang(block) {
    if (renderOptions.markdown.inferLang === false)
        return { lang: '', source: '' };
    const code = inferCodeOfBlock(block);
    const byContent = inferLangByContent(code);
    if (byContent !== '')
        return { lang: byContent, source: 'content' };
    // 日志没有语言可高亮：硬贴一个项目主语言只会是错的高亮（真实会话里日志块不少）。
    if (looksLikeLog(code))
        return { lang: '', source: '' };
    const cwd = inferredProjectLang === null ? '' : inferredProjectLang.cwd;
    const project = cwd === '' ? '' : cachedProjectLang(cwd);
    if (project !== '')
        return { lang: project, source: 'project' };
    return { lang: '', source: '' };
}
/** teardown：清缓存与进行中标记（fiber 卸载 / HMR 无残留）。 */
function teardownInferredLang() {
    inferredProjectLang = null;
    inferredProjectPending = false;
    inferredProjectFailed = '';
}
Object.assign(exports,{INFER_PROJECT_TTL_MS,looksLikeJson,inferLangByContent,looksLikeLog,sessionCwdOf,refreshInferredLang,inferredFenceLang,teardownInferredLang});

    "use strict";
// ── 非标准表格容错（交给 marked 之前的一次纯文本规范化）────────────────
// 判据（GFM 实测口径）：GFM 自己就接受这些写法 —— 无首尾管道符、紧凑分隔行
// （---|---）、单横线分隔（-|-）、表格前有普通段落、数据行列数不等、只有表头、
// 逐列对齐标记。这些**一字不动**。
//
// GFM 不接受的只有两种：
//   ① 分隔行完全没有管道符（`a | b` 后跟 `---`）→ 被当成 setext 标题；
//   ② 分隔行单元格数与表头不等（`a | b | c` 后跟 `--- | ---`）→ 整段不识别。
// 本模块只规范化 ② 与 ①，把分隔行按表头列数补齐 / 裁剪，逐列保留
// :--- / :---: / ---: 对齐语义；其余文本（含行尾空白、空行、代码块）原样返回。
//
// 纯函数、无副作用：own-markdown.ts 在 `marked.lexer()` 之前调用它。
// 脚本模式片段（无 import/export），跨 part 以全局函数名引用。
/** 分隔行候选：只含 - : | 与空白，且至少一个 -。 */
const MDR_TABLE_SEPARATOR_RE = /^\s*\|?[\s:\-|]+\|?\s*$/;
/** 是否为一段表格分隔行（`---` / `--- | ---` / `:-:` 等）。 */
function isTableSeparator(line) {
    if (typeof line !== 'string')
        return false;
    return MDR_TABLE_SEPARATOR_RE.test(line) && line.indexOf('-') >= 0;
}
/** 单行 → 去首尾管道符、逐格 trim 的单元格数组。 */
function splitTableCells(line) {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}
/** 表头候选：含管道符、至少两格、且本身不是分隔行。 */
function isTableHeader(line) {
    if (typeof line !== 'string' || isTableSeparator(line))
        return false;
    const trimmed = line.trim();
    if (trimmed.indexOf('|') < 0)
        return false;
    return splitTableCells(trimmed).length >= 2;
}
/** 单个分隔格 → 合法 GFM 分隔格（逐列保留左 / 中 / 右对齐，缺省左对齐）。 */
function alignCell(cell) {
    const left = cell.charAt(0) === ':';
    const right = cell.charAt(cell.length - 1) === ':';
    if (left && right)
        return ':---:';
    if (right)
        return '---:';
    if (left)
        return ':---';
    return '---';
}
/**
 * 规范化 ①② 两种 GFM 不认的分隔行；无需改动时返回**同一字符串**。
 * 输出格式沿用既有口径：`--- | ---`（不补首尾管道符），列数 = 表头列数。
 */
function normalizeTables(text) {
    const source = typeof text === 'string' ? text : String(text);
    const lines = source.split('\n');
    let patched = null;
    for (let i = 0; i + 1 < lines.length; i += 1) {
        const header = lines[i];
        const separator = lines[i + 1];
        if (!isTableHeader(header) || !isTableSeparator(separator))
            continue;
        const headerCells = splitTableCells(header);
        const separatorCells = splitTableCells(separator);
        // 合法 GFM 分隔行（有管道符且列数一致）不动。
        if (separator.indexOf('|') >= 0 && separatorCells.length === headerCells.length)
            continue;
        if (patched === null)
            patched = lines.slice();
        patched[i + 1] = headerCells.map((_cell, index) => alignCell(separatorCells[index] ?? '')).join(' | ');
    }
    return patched === null ? source : patched.join('\n');
}
Object.assign(exports,{normalizeTables,isTableSeparator,isTableHeader,splitTableCells});

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
// ── 自研代码围栏卡（B 路）：语言胶囊 + 标题 + 行号 / 换行 / 复制 + 底栏三态 ──
// 用户口径（最高优先级）：「代码渲染使用我们自己的，不要使用原生的」。本卡片完全由
// 本插件产出（不调用官方 CodeBlock / MarkdownText）：
//   · 语言胶囊 = 围栏 info string 的真实 token（CSS 大写 + 字距 .06em），语言位为空时
//     留空（**绝不编造语言名**）；语言是推断来的（内容识别 / 项目主语言）时加 is-inferred
//     + data-mdr-lang-inferred，浮层说明推断来源，底栏也写明「按…推断」；
//   · 高亮走懒加载 highlight.js 的**令牌树 → vdom span**，不拼 HTML、不 innerHTML，
//     模型输出不会被当 HTML 执行；hljs 未就绪 / 语言不认识 / 超长 → 纯文本（内容一字不少）；
//   · 行号默认关、自动换行默认关（状态写卡片 data-mdr-lines / data-mdr-wrap，CSS 呈现）；
//   · 底栏「渲染为…」三态（图表 / Markdown / 源码）复用 lang-switch.ts 的控件。
/** 代码块宿主容器类名（block-render.ts 探测 / block-lang.ts 防递归引用）。 */
const CODE_HOST_CLASS = 'mdr-block';
/** 围栏卡 / 头部 / 语言胶囊 / 标题 / 操作区 / 主体 / 行号列 / 代码 / 底栏类名。 */
const MDR_FENCE_CLASS = 'mdr-fence';
const MDR_FENCE_HEAD_CLASS = 'mdr-fence-head';
const MDR_FENCE_PILL_CLASS = 'mdr-pill mdr-fence-pill';
const MDR_FENCE_TITLE_CLASS = 'mdr-fence-title';
const MDR_FENCE_ACTIONS_CLASS = 'mdr-fence-actions';
const MDR_FENCE_ACTION_CLASS = 'mdr-icon-btn mdr-fence-action';
const MDR_FENCE_COPY_CLASS = 'mdr-fence-copy';
const MDR_FENCE_BODY_CLASS = 'mdr-fence-body';
const MDR_FENCE_NUMS_CLASS = 'mdr-line-nums';
const MDR_FENCE_CODE_CLASS = 'mdr-fence-code';
const MDR_FENCE_FOOT_CLASS = 'mdr-fence-foot';
const MDR_FENCE_NOTE_CLASS = 'mdr-fence-note';
/** 推断语言的语言胶囊状态类名（虚线边等视觉区分在 styles-code.ts）。 */
const MDR_FENCE_PILL_INFERRED = 'is-inferred';
/** 单块高亮上限（字符）：超出只做纯文本渲染（高亮是 O(代码长度) 的正则扫描）。 */
const MAX_HIGHLIGHT_CHARS = 60000;
/** 推断来源 → 中文短标签（胶囊浮层 / 底栏说明共用，不写原生 title）。 */
const MDR_INFERRED_LABEL = {
    content: '按内容推断',
    project: '按项目推断',
};
/** 规范化推断来源：只认 'content' / 'project'，其余（缺省 / 空串 / 未知值）一律视为非推断。 */
function langInferredOf(value) {
    return value === 'content' || value === 'project' ? value : '';
}
/**
 * hljs scope → 本插件语法色类名（原型 .hl-key / .hl-str / .hl-num / .hl-com /
 * .hl-fn / .hl-tag / .hl-prop）。只映射到有颜色的族；未知 scope 不包 span（纯文本）。
 * 分级 scope 取首段（`comment.line` → comment）。
 */
const MDR_HL_SCOPE_CLASS = {
    keyword: 'hl-key',
    built_in: 'hl-key',
    type: 'hl-key',
    literal: 'hl-key',
    symbol: 'hl-key',
    meta: 'hl-key',
    'keyword.control': 'hl-key',
    string: 'hl-str',
    regexp: 'hl-str',
    char: 'hl-str',
    'string.escape': 'hl-str',
    'char.escape': 'hl-str',
    number: 'hl-num',
    comment: 'hl-com',
    quote: 'hl-com',
    title: 'hl-fn',
    'title.function': 'hl-fn',
    'title.class': 'hl-fn',
    function: 'hl-fn',
    tag: 'hl-tag',
    name: 'hl-tag',
    'selector-tag': 'hl-tag',
    'selector-id': 'hl-tag',
    attr: 'hl-prop',
    attribute: 'hl-prop',
    property: 'hl-prop',
    params: 'hl-prop',
    variable: 'hl-prop',
};
/** scope → 语法色类名（无法映射 → 空串）。 */
function hlClassOf(scope) {
    const name = String(scope === null || scope === undefined ? '' : scope);
    if (name === '')
        return '';
    const direct = MDR_HL_SCOPE_CLASS[name];
    if (direct !== undefined)
        return direct;
    const dot = name.indexOf('.');
    const head = dot >= 0 ? name.slice(0, dot) : name;
    return MDR_HL_SCOPE_CLASS[head] ?? '';
}
/** 从 hljs 结果里取令牌树根（结果 / _emitter / root 任一层缺失 → null）。 */
function hlRootOf(result) {
    if (result === null || result === undefined)
        return null;
    const emitter = result._emitter;
    if (emitter === null || emitter === undefined)
        return null;
    const root = emitter.root;
    return root === null || root === undefined ? null : root;
}
/** 令牌树 → vdom 子节点（无 scope / 未知 scope 的容器不包 span）。 */
function hlTokenNodes(node, keyBase, out) {
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (typeof child === 'string') {
            if (child !== '')
                out.push(child);
            continue;
        }
        if (child === null || typeof child !== 'object')
            continue;
        const key = keyBase + '-' + String(i);
        const inner = [];
        hlTokenNodes(child, key, inner);
        const className = hlClassOf(child.scope);
        if (className === '') {
            for (const item of inner)
                out.push(item);
            continue;
        }
        out.push(createElement('span', { key, className }, ...inner));
    }
}
/**
 * 高亮一段代码：返回 vdom 子节点数组；任何一步不成立返回 null（调用方渲染纯文本）。
 * 解析层由 render-assets.ts 的懒加载入口提供，本文件不自己加载脚本。
 */
/** 高亮层的最小 API 面（懒加载未就绪 / 形态不符 → null）。 */
function hljsApi() {
    const hljs = ensureRenderAsset(HLJS_ASSET);
    if (hljs === null)
        return null;
    if (typeof hljs.getLanguage !== 'function' || typeof hljs.highlight !== 'function')
        return null;
    return hljs;
}
/** 调高亮层（语言不支持 / 抛错 → null）。 */
function hlResultOf(lang, code) {
    const hljs = hljsApi();
    if (hljs === null)
        return null;
    try {
        if (!hljs.getLanguage(lang))
            return null;
        return hljs.highlight(code, { language: lang, ignoreIllegals: true });
    }
    catch (_e) {
        return null;
    }
}
/**
 * 高亮一段代码：返回 vdom 子节点数组；任何一步不成立返回 null（调用方渲染纯文本）。
 * 解析层由 render-assets.ts 的懒加载入口提供，本文件不自己加载脚本。
 */
function highlightNodes(lang, code) {
    if (lang === '' || code === '' || code.length > MAX_HIGHLIGHT_CHARS)
        return null;
    const root = hlRootOf(hlResultOf(lang, code));
    if (root === null)
        return null;
    const out = [];
    hlTokenNodes(root, 'hl', out);
    return out.length === 0 ? null : out;
}
/** 行号列文本：按逻辑行逐行编号（空行占位、末尾换行不多出一行）。 */
function lineNumbersText(source) {
    const count = source === '' ? 0 : source.split('\n').length;
    const out = [];
    for (let i = 1; i <= count; i += 1)
        out.push(String(i));
    return out.join('\n');
}
/**
 * 底栏说明：行数 · 语言（语言位为空时如实说「未标注语言」，不编造）；
 * 语言是推断来的再追加推断来源（「按项目推断」），原文标注则保持原样文案。
 */
function fenceLineNote(source, lang, inferred = '') {
    const lines = source === '' ? 0 : source.split('\n').length;
    const head = String(lines) + ' 行 · ';
    if (inferred === '')
        return head + (lang === '' ? '未标注语言' : lang);
    const from = MDR_INFERRED_LABEL[inferred];
    return head + (lang === '' ? from : lang + ' · ' + from);
}
/** 代码主体：有高亮 → 语法色 span 树；否则纯文本（内容一字不少）。 */
function codeBodyNode(lang, source) {
    const nodes = highlightNodes(lang, source);
    if (nodes === null)
        return createElement('code', { className: 'mdr-fence-text' }, source);
    return createElement('code', { className: 'mdr-fence-hl' }, ...nodes);
}
/**
 * 语言胶囊的 props：原文标注 → 现状（空语言时 aria-hidden）；推断语言再加 is-inferred、
 * data-mdr-lang-inferred 与 data-mdr-tip 浮层（复用 [data-mdr-tip] 机制，不写原生 title）。
 */
function fencePillProps(lang, inferred) {
    const props = {
        className: inferred === '' ? MDR_FENCE_PILL_CLASS : MDR_FENCE_PILL_CLASS + ' ' + MDR_FENCE_PILL_INFERRED,
    };
    if (inferred !== '') {
        props['data-mdr-lang-inferred'] = inferred;
        props['data-mdr-tip'] = MDR_INFERRED_LABEL[inferred];
    }
    if (lang === '')
        props['aria-hidden'] = 'true';
    return props;
}
/** 头部：语言胶囊 + 标题 + 操作区（复制 / 换行 / 行号）。 */
function MdrFenceHead(props) {
    const wrapLabel = props.wrap ? '关闭自动换行' : '切换自动换行';
    const linesLabel = props.lines ? '隐藏行号' : '切换行号';
    return createElement('div', { className: MDR_FENCE_HEAD_CLASS }, createElement('span', fencePillProps(props.lang, langInferredOf(props.inferred)), props.lang), props.title === '' ? null : createElement('span', { className: MDR_FENCE_TITLE_CLASS }, props.title), createElement('span', { className: MDR_FENCE_ACTIONS_CLASS }, createElement(MdrCopyButton, { text: props.code, tip: '复制代码', className: MDR_FENCE_COPY_CLASS }), createElement('button', {
        type: 'button',
        className: MDR_FENCE_ACTION_CLASS + (props.wrap ? ' is-on' : ''),
        'aria-label': wrapLabel,
        'aria-pressed': props.wrap ? 'true' : 'false',
        'data-mdr-tip': wrapLabel,
        onClick: props.onWrap,
    }, icon.wrap(14)), createElement('button', {
        type: 'button',
        className: MDR_FENCE_ACTION_CLASS + (props.lines ? ' is-on' : ''),
        'aria-label': linesLabel,
        'aria-pressed': props.lines ? 'true' : 'false',
        'data-mdr-tip': linesLabel,
        onClick: props.onLines,
    }, icon.lines(14))));
}
/** 主体：行号列（默认 CSS 隐藏，data-mdr-lines 开启才显示）+ pre。 */
function MdrFenceBody(props) {
    return createElement('div', { className: MDR_FENCE_BODY_CLASS }, createElement('div', { className: MDR_FENCE_NUMS_CLASS, 'aria-hidden': 'true' }, lineNumbersText(props.code)), createElement('pre', { className: MDR_FENCE_CODE_CLASS, tabIndex: 0 }, codeBodyNode(props.lang, props.code)));
}
/** 底栏：行数/语言说明 + 「渲染为…」三态（当前视图由 view 传入，代码视图三态均不激活）。 */
function MdrFenceFoot(props) {
    return createElement('div', { className: MDR_FENCE_FOOT_CLASS }, createElement('span', { className: MDR_FENCE_NOTE_CLASS }, fenceLineNote(props.code, props.lang, langInferredOf(props.inferred))), MdrLangSwitchFrom({ current: props.view }));
}
/**
 * 代码围栏卡（契约导出）：props = { lang, code, title?, inferred?, view? }；内部可选 view 用于
 * 底栏三态（代码视图无对应选项 → 三个按钮都不激活，如实反映「自动判定为代码」）；
 * inferred = 语言是推断来的（'content' 按内容 / 'project' 按项目主语言），缺省 = 原文有标注。
 */
function MdrCodeBlock(props) {
    const lang = typeof props.lang === 'string' ? props.lang : '';
    const code = typeof props.code === 'string' ? props.code : '';
    const title = typeof props.title === 'string' ? props.title : '';
    const inferred = langInferredOf(props.inferred);
    const view = typeof props.view === 'string' && props.view !== '' ? props.view : 'code';
    const [wrap, setWrap] = useState(false);
    const [lines, setLines] = useState(false);
    return createElement('div', {
        className: MDR_FENCE_CLASS,
        'data-mdr-fence': 'code',
        'data-mdr-lang': lang,
        'data-mdr-lines': lines ? 'on' : 'off',
        'data-mdr-wrap': wrap ? 'on' : 'off',
    }, MdrFenceHead({
        lang,
        title,
        code,
        wrap,
        lines,
        inferred,
        onWrap: () => setWrap(!wrap),
        onLines: () => setLines(!lines),
    }), MdrFenceBody({ lang, code }), MdrFenceFoot({ lang, code, view, inferred }));
}
Object.assign(exports,{CODE_HOST_CLASS,MDR_FENCE_CLASS,MDR_FENCE_PILL_CLASS,MDR_FENCE_CODE_CLASS,MAX_HIGHLIGHT_CHARS,MDR_HL_SCOPE_CLASS,hlClassOf,hlTokenNodes,highlightNodes,lineNumbersText,fenceLineNote,MDR_INFERRED_LABEL,langInferredOf,fencePillProps,MdrFenceHead,MdrFenceBody,MdrFenceFoot,MdrCodeBlock});

    // 自研 markdown 渲染（marked 词法树 → vdom，表格容错在此接上）
    "use strict";
// ── 自研 markdown 渲染（marked 词法树 → 自有 vdom）──────────────────────
// 口径（最高优先级）：markdown 内容**全部由本插件自己的渲染器产出**，不调用宿主
// MarkdownText；自有类名 `mdr-*`，样式在 styles-markdown.ts（只在 .mdr-md 作用域内）。
//
// 安全口径（与宿主 MarkdownText 逐条对齐）：
//   · raw HTML 一律当**字面文本**（html token → 文本节点，由 React 转义），
//     模型输出永远不会被当 HTML 执行；
//   · 链接只放行 http / https / mailto 与同源相对路径（`/…`，不含 `//host`）；
//   · 图片只放行 http / https 与同源相对路径，其余渲染 alt 文本；
//   · 全程没有 innerHTML / dangerouslySetInnerHTML。
//
// 解析层懒加载（assets 里的 marked，不进 bundle）：未就绪 → markdownNodes 返回 null，
// 调用方保持宿主官方形态；就绪通知后的重扫再接管（真降级，绝不丢内容）。
// 表格进 lexer 之前先过 table-normalize 的 normalizeTables（非标准分隔行容错）。
//
// 脚本模式片段（无 import/export）：createElement / ensureRenderAsset / MARKED_ASSET /
// normalizeTables 都是同一 factory 作用域里的全局；跨路组件（MdrCodeBlock）走 exports
// 运行时探测，未就绪时退化为自有 <pre>，两条路各自独立可交付。
/** markdown 内容根类名（styles-markdown.ts 的作用域）。 */
const MDR_MD_ROOT_CLASS = 'mdr-root mdr-md';
/** 解析异常时的原文兜底类名（内容一字不丢）。 */
const MDR_MD_PLAIN_CLASS = 'mdr-md-plain';
/** 行内代码 / 图片 / 链接降级 / 图片降级类名。 */
const MDR_MD_CODE_CLASS = 'mdr-md-code';
const MDR_MD_IMG_CLASS = 'mdr-md-img';
const MDR_MD_IMG_ALT_CLASS = 'mdr-md-img-alt';
const MDR_MD_LINK_PLAIN_CLASS = 'mdr-md-link-plain';
/** 代码块兜底（跨路 MdrCodeBlock 未就绪时）。 */
const MDR_MD_PRE_CLASS = 'mdr-md-pre';
/** 表格 / 列表 / 任务项类名。 */
const MDR_MD_TABLE_WRAP_CLASS = 'mdr-scroll mdr-md-table-wrap';
const MDR_MD_TABLE_CLASS = 'mdr-md-table';
const MDR_MD_LIST_CLASS = 'mdr-md-list';
const MDR_MD_TASK_LIST_CLASS = 'mdr-md-list mdr-md-task-list';
const MDR_MD_TASK_ITEM_CLASS = 'mdr-md-task-item';
const MDR_MD_CHECK_CLASS = 'mdr-md-check';
/** 单元格对齐 class（不用行内 style / align 属性）。 */
const MDR_MD_ALIGN_CLASSES = {
    left: 'mdr-md-cell-left',
    center: 'mdr-md-cell-center',
    right: 'mdr-md-cell-right',
};
/** 链接放行的协议。 */
const MDR_MD_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];
/** info string → 语言 token（`{js}` / `.js` 也认，取首个空白分隔 token）。 */
const MDR_MD_LANG_RE = /^\{?\.?([A-Za-z0-9_+#-]*)\}?$/;
/** 语义强调 token → 同名 HTML 标签。 */
const MDR_MD_EMPHASIS_TAGS = { strong: 'strong', em: 'em', del: 'del' };
/** 任意值 → 文本（null / undefined → 空串）。 */
function mdText(value) {
    if (typeof value === 'string')
        return value;
    return value === null || value === undefined ? '' : String(value);
}
/** 归一化后的对象形态 token（非对象 → 空对象）。 */
function mdTokenOf(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
/** info string → 小写语言 token（无语言 → 空串）。 */
function mdInfoLang(info) {
    const token = mdText(info).trim().split(/\s+/)[0] ?? '';
    const matched = MDR_MD_LANG_RE.exec(token);
    return (matched === null ? token : matched[1]).toLowerCase();
}
/** 标题层级收敛到 h1–h6（marked 可能给出 7+ 的畸形层级）。 */
function mdHeadingTag(depth) {
    const value = Number(depth);
    const level = Number.isFinite(value) ? Math.min(6, Math.max(1, Math.trunc(value))) : 1;
    return 'h' + String(level);
}
/** 表格列对齐的追加 class（未知 / 缺省 → 空串）。 */
function mdAlignClass(align) {
    const name = mdText(align);
    return Object.prototype.hasOwnProperty.call(MDR_MD_ALIGN_CLASSES, name) ? ' ' + MDR_MD_ALIGN_CLASSES[name] : '';
}
/** 安全链接目标：http / https / mailto 或同源相对路径；其余返回空串。 */
function mdSafeHref(url) {
    const value = mdText(url);
    if (value === '')
        return '';
    try {
        const protocol = new URL(value).protocol;
        return MDR_MD_LINK_PROTOCOLS.indexOf(protocol) >= 0 ? value : '';
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
/** 从 bundle 的 exports 面探测其它路的组件（未就绪 → null，绝不抛错）。 */
function mdrPartFunction(name) {
    if (typeof exports !== 'object' || exports === null)
        return null;
    const value = exports[name];
    return typeof value === 'function' ? value : null;
}
/** 图片点开放大（灯箱由另一路提供；未就绪时静默降级为不可放大）。 */
function mdOpenImage(src, alt) {
    const open = mdrPartFunction('openImageLightbox');
    if (open === null)
        return;
    open(src, alt);
}
/** 行内 token 数组 → vdom 子节点。 */
function mdInlineChildren(tokens, keyBase) {
    if (!Array.isArray(tokens))
        return [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        out.push(mdInlineNode(tokens[i], keyBase + '-' + String(i)));
    }
    return out;
}
/** 行内 token → vdom 节点（未知 token 原样出文本，绝不丢内容）。 */
function mdInlineNode(token, key) {
    const t = mdTokenOf(token);
    const type = mdText(t.type);
    if (Object.prototype.hasOwnProperty.call(MDR_MD_EMPHASIS_TAGS, type)) {
        return createElement(MDR_MD_EMPHASIS_TAGS[type], { key }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'codespan') {
        // 与宿主一致：行内代码里的换行按空格显示。
        return createElement('code', { key, className: MDR_MD_CODE_CLASS }, mdText(t.text).replace(/\r?\n|\r/g, ' '));
    }
    if (type === 'br')
        return createElement('br', { key });
    if (type === 'link')
        return mdLinkNode(t, key);
    if (type === 'image')
        return mdImageNode(t, key);
    // text / escape / html（raw HTML 当字面文本）/ 未知 token
    return mdText(t.text);
}
/** 链接：目标不安全 → 退化为纯文本（不产生 javascript: / data: 目标）。 */
function mdLinkNode(t, key) {
    const children = mdInlineChildren(t.tokens, key);
    const href = mdSafeHref(t.href);
    if (href === '')
        return createElement('span', { key, className: MDR_MD_LINK_PLAIN_CLASS }, ...children);
    const title = mdText(t.title);
    return createElement('a', {
        key,
        className: 'mdr-md-link',
        href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: title === '' ? undefined : title,
    }, ...children);
}
/** 放大键：Enter / 空格与点击同路（焦点环真能用，不做死的焦点环）。 */
function mdImageZoomKey(src, alt, event) {
    const key = String(event.key ?? '');
    if (key !== 'Enter' && key !== ' ')
        return;
    if (typeof event.preventDefault === 'function')
        event.preventDefault();
    mdOpenImage(src, alt);
}
/** 图片：地址不安全 → alt 文本；安全 → 可点击放大的图片。 */
function mdImageNode(t, key) {
    const alt = mdText(t.text);
    const src = mdSafeImageSrc(t.href);
    if (src === '')
        return createElement('span', { key, className: MDR_MD_IMG_ALT_CLASS }, alt);
    const title = mdText(t.title);
    return createElement('img', {
        key,
        className: MDR_MD_IMG_CLASS,
        src,
        alt,
        title: title === '' ? undefined : title,
        loading: 'lazy',
        tabIndex: 0,
        'data-mdr-zoom': 'true',
        onClick: () => mdOpenImage(src, alt),
        onKeyDown: (event) => mdImageZoomKey(src, alt, event),
    });
}
/**
 * markdown 文本 → vdom 子节点数组（调用方放进 `.mdr-md` 容器）。
 * @returns null = 解析层还没就绪（调用方保持宿主官方形态，等就绪重扫）；
 *          数组 = 渲染结果（解析异常时退化为原文 <pre>，内容一字不丢）。
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
        // 非标准表格容错：GFM 不认的分隔行先规范化，再进解析器。
        tokens = lexer.call(marked, normalizeTables(source));
    }
    catch (_e) {
        tokens = null;
    }
    if (!Array.isArray(tokens))
        return [createElement('pre', { key: 'md-plain', className: MDR_MD_PLAIN_CLASS }, source)];
    return mdBlockChildren(tokens, 'md');
}
/**
 * markdown 内容组件：`{ text, streaming }` → div.mdr-root.mdr-md。
 * streaming=true 时根上加 `data-streaming="true"` + `.is-streaming`（宿主 DOM 契约 [data-streaming]）。
 */
function MdrMarkdown(props) {
    const text = mdText(props === null || props === undefined ? '' : props.text);
    const streaming = props !== null && props !== undefined && props.streaming === true;
    const nodes = markdownNodes(text);
    return createElement('div', {
        className: MDR_MD_ROOT_CLASS + (streaming ? ' is-streaming' : ''),
        'data-mdr-root': 'true',
        'data-streaming': streaming ? 'true' : undefined,
    }, ...(nodes === null ? [createElement('pre', { key: 'md-fallback', className: MDR_MD_PLAIN_CLASS }, text)] : nodes));
}
Object.assign(exports,{MdrMarkdown,markdownNodes,mdInfoLang,mdSafeHref,mdSafeImageSrc});

    "use strict";
// ── markdown 块级渲染（A 路 · own-markdown.ts 的块级分支）────────────────
// 从 own-markdown.ts 拆出（文件 ≤400 行门禁）：表格 / 列表 / 任务项 / 代码块 /
// 行内内容块 → vdom 节点。与 inline 层共用同一个 factory 作用域（script 模式），
// 因此这里直接引用 createElement / mdInlineChildren / mdTokenOf 等，无需 import。
// 行为与拆分前逐字一致：块级 token 组装逻辑没有任何改动。
/** 表格单元格（th / td；对齐走自有 class）。 */
function mdCellNode(cell, key, tag, align) {
    return createElement(tag, { key, className: 'mdr-md-cell' + mdAlignClass(align) }, ...mdInlineChildren(mdTokenOf(cell).tokens, key));
}
/** 表格：外层横向滚动容器（宽表格不撑破消息区）。 */
function mdTableNode(t, key) {
    const header = Array.isArray(t.header) ? t.header : [];
    const rows = Array.isArray(t.rows) ? t.rows : [];
    const aligns = Array.isArray(t.align) ? t.align : [];
    const headRow = createElement('tr', { key: key + '-head' }, ...header.map((cell, index) => mdCellNode(cell, key + '-h-' + String(index), 'th', aligns[index])));
    const bodyRows = rows.map((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : [];
        return createElement('tr', { key: key + '-r-' + String(rowIndex) }, ...cells.map((cell, index) => mdCellNode(cell, key + '-r-' + String(rowIndex) + '-' + String(index), 'td', aligns[index])));
    });
    return createElement('div', { key, className: MDR_MD_TABLE_WRAP_CLASS }, createElement('table', { className: MDR_MD_TABLE_CLASS }, createElement('thead', null, headRow), createElement('tbody', null, ...bodyRows)));
}
/**
 * 列表项内容：tight 列表的 text token 直接出行内节点；其余（段落 / 嵌套列表 / 代码块…）
 * 按块渲染 —— 与 marked 的 tight / loose 语义一致，且不额外包一层 <p>。
 */
function mdItemChildren(item, keyBase) {
    const tokens = Array.isArray(item.tokens) ? item.tokens : [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const key = keyBase + '-i-' + String(i);
        const t = mdTokenOf(tokens[i]);
        if (t.type === 'text' && Array.isArray(t.tokens)) {
            for (const node of mdInlineChildren(t.tokens, key))
                out.push(node);
            continue;
        }
        if (t.type === 'text') {
            out.push(mdText(t.text));
            continue;
        }
        const node = mdBlockNode(tokens[i], key);
        if (node === null)
            continue;
        if (Array.isArray(node)) {
            for (const child of node)
                out.push(child);
        }
        else {
            out.push(node);
        }
    }
    return out;
}
/** 列表项：任务项渲染成只读复选框（disabled + readOnly；勾形由 CSS :has 画）。 */
function mdItemNode(item, key) {
    const t = mdTokenOf(item);
    const children = mdItemChildren(t, key);
    if (t.task !== true)
        return createElement('li', { key, className: 'mdr-md-li' }, ...children);
    const checked = t.checked === true;
    const box = createElement('input', {
        key: key + '-check',
        className: MDR_MD_CHECK_CLASS,
        type: 'checkbox',
        checked,
        disabled: true,
        readOnly: true,
        'aria-label': checked ? '已完成' : '未完成',
    });
    return createElement('li', { key, className: MDR_MD_TASK_ITEM_CLASS + (checked ? ' is-done' : '') }, box, ...children);
}
/** 列表（有序列表按 marked 的 start 还原起始序号；任务列表加同类名）。 */
function mdListNode(t, key) {
    const ordered = t.ordered === true;
    const items = Array.isArray(t.items) ? t.items : [];
    const start = Number(t.start);
    const hasTask = items.some((item) => mdTokenOf(item).task === true);
    return createElement(ordered ? 'ol' : 'ul', {
        key,
        className: hasTask ? MDR_MD_TASK_LIST_CLASS : MDR_MD_LIST_CLASS,
        start: ordered && Number.isFinite(start) && start > 1 ? start : undefined,
    }, ...items.map((item, index) => mdItemNode(item, key + '-' + String(index))));
}
/**
 * 代码块：优先交给另一路的 MdrCodeBlock（围栏块渲染器）；未就绪时退化为自有 <pre>。
 * 两条路各自独立可交付，集成后自动接管。
 */
function mdCodeNode(t, key) {
    const lang = mdInfoLang(t.lang);
    const code = mdText(t.text);
    const codeBlock = mdrPartFunction('MdrCodeBlock');
    if (codeBlock !== null)
        return createElement(codeBlock, { key, lang, code });
    return createElement('pre', { key, className: MDR_MD_PRE_CLASS, 'data-mdr-lang': lang === '' ? undefined : lang }, createElement('code', null, code));
}
/** 内容全是行内 token 的块级类型。 */
const MDR_MD_TEXT_BLOCK_TYPES = ['paragraph', 'heading', 'text', 'html'];
/** 行内内容块 → vdom 节点（html 按字面文本出一段，其余按标签渲染）。 */
function mdTextBlockNode(type, t, key) {
    if (type === 'paragraph') {
        return createElement('p', { key, className: 'mdr-md-p' }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'heading') {
        return createElement(mdHeadingTag(t.depth), { key, className: 'mdr-md-h' }, ...mdInlineChildren(t.tokens, key));
    }
    if (type === 'html')
        return createElement('p', { key, className: 'mdr-md-html' }, mdText(t.text));
    return mdInlineChildren(t.tokens, key); // 'text'（tight 列表项）
}
/** 块级 token → vdom 节点（null = 不产出；数组 = 展开多个）。 */
function mdBlockNode(token, key) {
    const t = mdTokenOf(token);
    const type = mdText(t.type);
    if (MDR_MD_TEXT_BLOCK_TYPES.indexOf(type) >= 0)
        return mdTextBlockNode(type, t, key);
    if (type === 'blockquote') {
        return createElement('blockquote', { key, className: 'mdr-md-quote' }, ...mdBlockChildren(t.tokens, key));
    }
    if (type === 'code')
        return mdCodeNode(t, key);
    if (type === 'table')
        return mdTableNode(t, key);
    if (type === 'list')
        return mdListNode(t, key);
    if (type === 'hr')
        return createElement('hr', { key, className: 'mdr-md-hr' });
    return null; // space / def / 未知 token
}
/** 块级 token 数组 → vdom 子节点数组（展开嵌套数组，保持 key 稳定）。 */
function mdBlockChildren(tokens, keyBase) {
    if (!Array.isArray(tokens))
        return [];
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const node = mdBlockNode(tokens[i], keyBase + '-' + String(i));
        if (node === null)
            continue;
        if (Array.isArray(node)) {
            for (const child of node)
                out.push(child);
        }
        else {
            out.push(node);
        }
    }
    return out;
}

    "use strict";
// ── 图片点击放大（B 路）：原生 <dialog> 模态灯箱 ──────────────────────────
// 交互：markdown 图片点击 → 原生 <dialog>.showModal()（遮罩 / Esc / 焦点归还 / 背景
// 滚动锁定由浏览器兜底，零依赖）；三路关闭 = Esc（cancel 事件）/ 点击遮罩 /
// 点击图片本身；同一时刻只保留一个灯箱（再点第二张先收掉上一个）。
//
// 安全口径：只放行 http(s) 与同源相对路径（与 markdown 渲染同一条口径），未放行的
// 地址**不打开灯箱**、不加载来路不明的资源；全程只有 DOM API，没有 innerHTML。
/** 灯箱 <dialog> / 内容包装 / 大图 / 关闭按钮类名。 */
const MDR_LIGHTBOX_CLASS = 'mdr-lightbox';
const MDR_LIGHTBOX_WRAP_CLASS = 'mdr-lightbox-wrap';
const MDR_LIGHTBOX_IMG_CLASS = 'mdr-lightbox-img';
const MDR_LIGHTBOX_CLOSE_CLASS = 'mdr-lightbox-close';
/** 宿主容器已绑定点击代理的标记。 */
const MDR_LIGHTBOX_BOUND_ATTR = 'data-mdr-lightbox-bound';
/** 当前打开的灯箱（同一时刻只允许一个）。 */
let mdrLightbox = null;
/** 安全图片地址：http(s) 绝对地址或同源相对路径；其余（javascript: / data: 等）→ ''。 */
function mdrSafeImageSrc(url) {
    const text = typeof url === 'string' ? url.trim() : '';
    if (text === '')
        return '';
    if (/^https?:\/\//i.test(text))
        return text;
    if (/^\/\//.test(text))
        return text;
    if (text.charAt(0) === '/' || text.indexOf('./') === 0 || text.indexOf('../') === 0)
        return text;
    return '';
}
/** 关闭灯箱（幂等；Esc / 遮罩 / 点击图片三路共用）。 */
function closeImageLightbox() {
    const dialog = mdrLightbox;
    if (dialog === null)
        return;
    mdrLightbox = null;
    try {
        dialog.close();
    }
    catch (_e) {
        /* 已关闭 / 伪 DOM 无此方法 */
    }
    if (dialog.parentNode)
        dialog.parentNode.removeChild(dialog);
}
/** 以模态方式打开（无 showModal 的环境退回 open 属性 —— 绝不静默失败）。 */
function showMdrLightbox(dialog) {
    try {
        dialog.showModal();
    }
    catch (_e) {
        dialog.open = true;
    }
}
/** 显式关闭按钮（右上角圆形；叉线由 CSS 的 ::before / ::after 画）。 */
function mdrLightboxCloseButton() {
    const button = document.createElement('button');
    button.className = MDR_LIGHTBOX_CLOSE_CLASS;
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.textContent = '×';
    button.addEventListener('click', closeImageLightbox);
    return button;
}
/** 点图放大；地址不在安全口径内 → 什么都不做。 */
function openImageLightbox(src, alt) {
    const safe = mdrSafeImageSrc(src);
    if (safe === '' || typeof document === 'undefined' || document === null)
        return;
    closeImageLightbox();
    const dialog = document.createElement('dialog');
    dialog.className = MDR_LIGHTBOX_CLASS;
    const wrap = document.createElement('div');
    wrap.className = MDR_LIGHTBOX_WRAP_CLASS;
    const img = document.createElement('img');
    img.className = MDR_LIGHTBOX_IMG_CLASS;
    img.src = safe;
    img.alt = typeof alt === 'string' ? alt : '';
    wrap.appendChild(img);
    wrap.appendChild(mdrLightboxCloseButton());
    dialog.appendChild(wrap);
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target === img)
            closeImageLightbox();
    });
    dialog.addEventListener('cancel', closeImageLightbox);
    document.body.appendChild(dialog);
    mdrLightbox = dialog;
    showMdrLightbox(dialog);
}
/** 事件目标最近的 <img>（选择器不成立 / 抛错 → null）。 */
function mdrClosestImage(target) {
    const el = target;
    if (el === null || el === undefined || typeof el.closest !== 'function')
        return null;
    try {
        const img = el.closest('img');
        return img === null || img === undefined ? null : img;
    }
    catch (_e) {
        return null;
    }
}
/** 点击代理：host 内的 <img> 被点击 → 放大（绕开按钮 / 链接内的图片）。 */
function mdrImageFromEvent(host, target) {
    const element = mdrClosestImage(target);
    if (element === null)
        return null;
    if (typeof host.contains === 'function' && !host.contains(element))
        return null;
    if (typeof element.closest === 'function' && element.closest('button,a'))
        return null;
    return element;
}
/**
 * 给宿主容器挂一次点击放大（契约导出）：同一容器重复调用是幂等的；
 * 事件代理 → 后插入的图片也自动生效，不需要逐图绑定。
 */
function mountMdrLightbox(host) {
    if (!host || typeof host.addEventListener !== 'function' || typeof host.getAttribute !== 'function')
        return;
    if (host.getAttribute(MDR_LIGHTBOX_BOUND_ATTR) === 'true')
        return;
    host.setAttribute(MDR_LIGHTBOX_BOUND_ATTR, 'true');
    host.addEventListener('click', (event) => {
        const img = mdrImageFromEvent(host, event.target);
        if (img === null)
            return;
        openImageLightbox(img.getAttribute('src'), img.getAttribute('alt'));
    });
}
Object.assign(exports,{MDR_LIGHTBOX_CLASS,MDR_LIGHTBOX_BOUND_ATTR,mdrSafeImageSrc,openImageLightbox,closeImageLightbox,mountMdrLightbox});

    "use strict";
// ── 复制按钮（B 路）：idle / copied / failed 三态 ─────────────────────────
// 复用面：围栏卡（复制代码原文）、整段 markdown（复制整段纯文本）。
// 通道：navigator.clipboard.writeText 优先，失败回退 document.execCommand('copy')
// （textarea 中转）；两条通道都不通 → failed 态（1.6s 后回 idle）。
// 纪律：不写 el.style / classList / cssText —— textarea 的隐藏与定位全走
// STYLES_CODE 的 .mdr-copy-sink 类名（只 setAttribute 自有标记）。
/** 复制按钮基类 / 文案 / 复位时长（原型 1.6s 回退）。 */
const MDR_COPY_CLASS = 'mdr-copy';
const MDR_COPY_LABEL_CLASS = 'mdr-copy-label';
const MDR_COPY_SINK_CLASS = 'mdr-copy-sink';
const MDR_COPY_RESET_MS = 1600;
/** 复制失败兜底：隐藏 textarea + execCommand('copy')（无样式写入，类名负责隐藏）。 */
function fallbackCopyText(text) {
    if (typeof document === 'undefined' || document === null || !document.body)
        return false;
    const sink = document.createElement('textarea');
    sink.value = text;
    sink.className = MDR_COPY_SINK_CLASS;
    sink.setAttribute('readonly', '');
    sink.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sink);
    let ok = false;
    try {
        sink.select();
        ok = typeof document.execCommand === 'function' ? !!document.execCommand('copy') : false;
    }
    catch (_e) {
        ok = false;
    }
    if (sink.parentNode)
        sink.parentNode.removeChild(sink);
    return ok;
}
/** 复制文本：clipboard API 优先，失败回退 execCommand；两条通道失败 → reject。 */
function copyText(text) {
    const clipboard = typeof navigator !== 'undefined' && navigator !== null
        ? navigator.clipboard
        : undefined;
    const writeText = clipboard !== null && clipboard !== undefined
        ? clipboard.writeText
        : undefined;
    if (typeof writeText === 'function') {
        return writeText.call(clipboard, text).catch(() => {
            if (!fallbackCopyText(text))
                throw new Error('copy failed');
        });
    }
    if (!fallbackCopyText(text))
        return Promise.reject(new Error('copy failed'));
    return Promise.resolve();
}
/** 复制按钮文案（状态语义：idle=复制 / copied=已复制 / failed=复制失败）。 */
function mdrCopyLabel(state) {
    if (state === 'copied')
        return '已复制';
    if (state === 'failed')
        return '复制失败';
    return '复制';
}
/** 复制按钮类名（状态用语义类，不用 classList）。 */
function mdrCopyClassName(state, extra) {
    const classes = ['mdr-btn', MDR_COPY_CLASS];
    if (state === 'copied')
        classes.push('is-copied');
    if (state === 'failed')
        classes.push('is-failed');
    if (typeof extra === 'string' && extra !== '')
        classes.push(extra);
    return classes.join(' ');
}
/**
 * 从 DOM 容器收集纯文本（跳过按钮 / 语言胶囊等噪声），供「不传 text」的调用面在
 * 点击时按容器现取（整段 markdown 复制）。
 */
function mdrCollectText(node, out) {
    if (node === null || node === undefined || typeof node !== 'object')
        return;
    const item = node;
    if (item.nodeType === 3) {
        if (typeof item.textContent === 'string')
            out.push(item.textContent);
        return;
    }
    if (item.nodeType !== 1 || mdrCollectSkip(item))
        return;
    const kids = Array.isArray(item.childNodes) ? item.childNodes : [];
    for (const kid of kids)
        mdrCollectText(kid, out);
}
/** 噪声元素（按钮 / 胶囊 / 卡片头尾）：不计入整段复制的纯文本。 */
function mdrCollectSkip(item) {
    const el = item;
    if (typeof el.matches !== 'function')
        return false;
    try {
        return el.matches('button,.mdr-pill,.mdr-fence-head,.mdr-fence-foot');
    }
    catch (_e) {
        return false; /* 选择器不成立 → 继续收集 */
    }
}
/** 点击时从最近容器取整段纯文本（text 为空时的兜底）。 */
function mdrCopyTextOf(target) {
    const el = target;
    if (el === null || el === undefined || typeof el.closest !== 'function')
        return '';
    const host = el.closest('.mdr-md,.tzx-md,.mdr-ctx-body');
    if (host === null || host === undefined)
        return '';
    const out = [];
    mdrCollectText(host, out);
    return out.join('');
}
/**
 * 复制按钮（契约导出）：props = { text, tip, className? }。
 * text 为空串时退化为「点击时从最近 .mdr-md 容器取纯文本」。
 */
function MdrCopyButton(props) {
    const [state, setState] = useState('idle');
    const [timer, setTimer] = useState(null);
    const flash = (next) => {
        setState(next);
        if (timer !== null)
            clearTimeout(timer);
        setTimer(setTimeout(() => setState('idle'), MDR_COPY_RESET_MS));
    };
    const onClick = (event) => {
        const target = event === null || event === undefined ? null : event.currentTarget;
        const text = typeof props.text === 'string' && props.text !== '' ? props.text : mdrCopyTextOf(target);
        if (text === '') {
            flash('failed');
            return;
        }
        copyText(text).then(() => flash('copied'), () => flash('failed'));
    };
    const label = mdrCopyLabel(state);
    return createElement('button', {
        type: 'button',
        className: mdrCopyClassName(state, props.className),
        'data-mdr-state': state,
        'data-mdr-tip': state === 'idle' ? props.tip : label,
        'aria-label': label,
        onClick,
    }, createElement('span', { className: MDR_COPY_LABEL_CLASS }, label));
}
Object.assign(exports,{MDR_COPY_CLASS,MDR_COPY_RESET_MS,fallbackCopyText,copyText,mdrCopyLabel,mdrCopyClassName,mdrCopyTextOf,MdrCopyButton});

    // 统一 MarkdownView：对外公共 API（自研渲染 + 整段复制）
    "use strict";
// ── 统一 MarkdownView（对外公共 API 面）──────────────────────────────
// 对外承诺（README「公共 API 契约」）：require('dsh-md-render').MarkdownView
// 存在且为 React 组件，props 为 { text: string }（额外 props 忽略，非字符串
// 降级为文本）；bundle id 为 dsh-md-render。
//
// 实现 = **本插件自己的 markdown 渲染器**（own-markdown.ts：marked 词法树 →
// React vdom，解析层走 assets 懒加载）+ 非标准表格容错（table-normalize.ts）
// + 「整段复制」按钮（copy.ts 的 MdrCopyButton）。**不调用官方 MarkdownText**。
// 解析层还没加载好 → 先落 <pre> 原文兜底（内容一字不丢），就绪通知触发重渲染。
// 根容器类名与自研渲染器同源（.mdr-root.mdr-md）：整段复制的 hover 浮现
// （.mdr-md:hover .mdr-md-copy）与 markdown 排版样式都挂在这个作用域上。
/** 统一 MarkdownView：{ text } → div.mdr-root.mdr-md（自研渲染 + 整段复制按钮）。 */
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
    return createElement('div', { className: 'mdr-root mdr-md' }, 
    // 解析层未就绪 → <pre> 兜底（原文不丢、渲染期不抛错）；就绪后换成自研渲染结果。
    ...(nodes === null ? [createElement('pre', { key: 'md-fallback', className: 'mdr-md-plain' }, source)] : nodes), 
    // 整段复制按钮（copyButton 关闭 → 不渲染）；官方只有代码块复制。
    renderOptions.markdown.copyButton
        ? createElement(MdrCopyButton, { text: '', tip: '复制整段 markdown', className: 'mdr-md-copy' })
        : null);
}
Object.assign(exports,{MarkdownView});

    // 上下文注入块 markdown 渲染（pre[data-context-text]）
    "use strict";
// ── 上下文注入块（B 路）：标注头 + 来源 + markdown 正文 ───────────────────
// 宿主 ContextBody 把上下文注入正文渲染成 <pre data-context-text="true"> 纯文本
// （ui-chat/src/client/chat/ContextBody.tsx:147，white-space:pre-wrap）：其中的
// 标题 / 列表 / 表格 / 代码块都是字面文本。本模块在 DOM 层把这类块交给本插件自己的
// markdown 渲染器（render-assets.ts 懒加载 marked 的入口），并加一带「上下文注入」标注、
// 来源与「按 markdown 渲染」徽标的卡片（原型 3558–3603）。
//
// 与 React 共存的约束：
//  - 不改 pre 的子结构（React 对 <pre>{text}</pre> 的文本 diff 会整体改写 textContent），
//    只在 pre 之前插入卡片并给 pre 置 hidden；
//  - 卡片写签名（长度 + 哈希 + 渲染库就绪版本），重扫签名一致 → 跳过（幂等）；
//  - 宿主重渲染冲掉卡片后，scanner 的重扫会补挂；超长 / 渲染库未就绪 → 保持宿主纯文本。
/** 上下文注入正文选择器（宿主 ContextBody 的稳定 data 契约）。 */
const CONTEXT_TEXT_SELECTOR = 'pre[data-context-text="true"]';
/** 卡片类名 / 卡片标记 / 签名属性 / 原文隐藏标记。 */
const MDR_CONTEXT_CLASS = 'mdr-ctx';
const MDR_CONTEXT_HEAD_CLASS = 'mdr-ctx-head';
const MDR_CONTEXT_TITLE_CLASS = 'mdr-ctx-title';
const MDR_CONTEXT_FROM_CLASS = 'mdr-ctx-from';
const MDR_CONTEXT_BADGE_CLASS = 'mdr-pill mdr-ctx-badge';
const MDR_CONTEXT_BODY_CLASS = 'mdr-md mdr-ctx-body';
const MDR_CONTEXT_MARK_ATTR = 'data-mdr-context';
const MDR_CONTEXT_SIG_ATTR = 'data-mdr-sig';
const MDR_CONTEXT_HIDDEN_ATTR = 'data-mdr-context-hidden';
/** 单块渲染上限（字符）；超过则保持宿主纯文本。 */
const MAX_CONTEXT_CHARS = 200000;
/** djb2 字符串哈希（签名用，非加密；lang-source.ts 的 fenceHash 复用）。 */
function contextHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1)
        h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
/** 来源标注：宿主行头部的 [data-context-source]（producer 名）；找不到 → ''。 */
function mdrContextSourceOf(host) {
    let node = host;
    for (let depth = 0; depth < 8 && node !== null && node !== undefined; depth += 1) {
        if (typeof node.querySelector === 'function') {
            try {
                const found = node.querySelector('[data-context-source]');
                if (found !== null) {
                    const label = (found.textContent ?? '').trim();
                    if (label !== '')
                        return label;
                }
            }
            catch (_e) {
                /* 契约失配 → 退化为无来源 */
            }
        }
        node = node.parentNode;
    }
    return '';
}
/** 已在位的卡片（pre 的前一个兄弟且带本模块标记）。 */
function mdrContextCardOf(host) {
    const prev = host.previousElementSibling;
    if (prev === null || prev === undefined)
        return null;
    return prev.getAttribute(MDR_CONTEXT_MARK_ATTR) === 'true' ? prev : null;
}
/** 卡片签名（内容 + 渲染库就绪版本：库到位后重建一次把纯文本换成渲染态）。 */
function mdrContextSignature(text) {
    return String(text.length) + ':' + contextHash(text) + ':' + String(renderAssetsReady());
}
/** 移掉在位卡片（内容变化 / 重建前清理）。 */
function removeMdrContextCard(host) {
    const card = mdrContextCardOf(host);
    if (card === null)
        return;
    // React root 挂在正文容器上（不是外层卡片）：先卸内层，再清 DOM。
    const body = typeof card.querySelector === 'function' ? card.querySelector('.mdr-ctx-body') : null;
    if (body !== null)
        unmountMarkdownIn(body);
    unmountMarkdownIn(card);
    if (card.parentNode)
        card.parentNode.removeChild(card);
    if (typeof host.removeAttribute === 'function')
        host.removeAttribute(MDR_CONTEXT_HIDDEN_ATTR);
}
/** 建标注头（纯 DOM，不写 style）。 */
function mdrContextHeadElement(source) {
    const head = document.createElement('div');
    head.className = MDR_CONTEXT_HEAD_CLASS;
    const dot = document.createElement('span');
    dot.className = 'mdr-ctx-dot';
    dot.setAttribute('aria-hidden', 'true');
    head.appendChild(dot);
    const title = document.createElement('strong');
    title.className = MDR_CONTEXT_TITLE_CLASS;
    title.textContent = '上下文注入';
    head.appendChild(title);
    if (source !== '') {
        const from = document.createElement('span');
        from.className = MDR_CONTEXT_FROM_CLASS;
        from.textContent = '来自 ' + source;
        head.appendChild(from);
    }
    const badge = document.createElement('span');
    badge.className = MDR_CONTEXT_BADGE_CLASS;
    badge.textContent = '按 markdown 渲染';
    head.appendChild(badge);
    return head;
}
/** 可接管的正文：门控（开关 / 渲染层 / 宿主契约 / 空文本 / 超长）全在前置，不可接管 → null。 */
function mdrContextTextOf(host) {
    if (!renderOptions.markdown.contextMarkdown)
        return null;
    if (!domRootAvailable())
        return null;
    if (typeof host.getAttribute !== 'function')
        return null;
    const parent = host.parentNode;
    if (parent === null || parent === undefined || typeof parent.insertBefore !== 'function')
        return null;
    const text = host.textContent ?? '';
    if (text.trim() === '' || text.length > MAX_CONTEXT_CHARS)
        return null;
    return text;
}
/** 建卡片（标注头 + markdown 正文）：渲染层不就绪 → null（调用方保持宿主纯文本）。 */
function mdrContextCardFor(host, text) {
    const card = document.createElement('div');
    card.className = MDR_CONTEXT_CLASS;
    card.setAttribute(MDR_CONTEXT_MARK_ATTR, 'true');
    card.setAttribute(MDR_CONTEXT_SIG_ATTR, mdrContextSignature(text));
    card.appendChild(mdrContextHeadElement(mdrContextSourceOf(host)));
    const body = document.createElement('div');
    body.className = MDR_CONTEXT_BODY_CLASS;
    if (!renderMarkdownInto(body, text))
        return null;
    card.appendChild(body);
    return card;
}
/**
 * 把 <pre data-context-text="true"> 接管成「标注头 + markdown 正文」卡片。
 * 开关关闭 / 渲染层不可用 / 超长 / 空文本 → 保持宿主纯文本（真降级）。
 */
function mountMdrContext(host) {
    const text = mdrContextTextOf(host);
    if (text === null)
        return;
    const signature = mdrContextSignature(text);
    const existing = mdrContextCardOf(host);
    if (existing !== null && existing.getAttribute(MDR_CONTEXT_SIG_ATTR) === signature)
        return;
    if (existing !== null)
        removeMdrContextCard(host);
    const card = mdrContextCardFor(host, text);
    if (card === null)
        return;
    const parent = host.parentNode;
    if (parent === null)
        return;
    parent.insertBefore(card, host);
    host.hidden = true;
    host.setAttribute(MDR_CONTEXT_HIDDEN_ATTR, 'true');
}
/** 扫描 root（自身 / 后代）内的上下文注入块（供 scanner 调用）。 */
function scanContextBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches(CONTEXT_TEXT_SELECTOR))
        mountMdrContext(root);
    for (const pre of Array.from(root.querySelectorAll(CONTEXT_TEXT_SELECTOR)))
        mountMdrContext(pre);
}
Object.assign(exports,{CONTEXT_TEXT_SELECTOR,MAX_CONTEXT_CHARS,MDR_CONTEXT_CLASS,contextHash,mdrContextSourceOf,mountMdrContext,scanContextBlocks});

    // 围栏块接管：markdown / 代码两路（mermaid 交给下面）
    "use strict";
// ── 围栏块接管（B 路）：div.md-code-block → 自研代码卡 / markdown 卡 / 源码 ──
// 宿主契约（写死的选择器）：围栏块是 `div.md-code-block`，官方内容（banner + pre）保留不动；
// 本模块只在块内追加自有容器，并在块上写 `data-mdr-view`（code | markdown；source 时移除），
// 由 STYLES_CODE 的属性选择器隐藏官方内容 —— 切回源码时官方原样恢复。
//
// 视图状态 = 块上的 data-mdr-view（单一事实源）：底栏三态控件的点击由 lang-switch.ts 派发
// `mdr-lang-switch` CustomEvent，本模块监听后改写视图；幂等靠签名（视图 + 语言 + 长度 +
// 内容哈希 + 渲染库就绪版本），流式块（[data-streaming] 祖先）跳过，稳定后再渲染。
/** 自建容器 / markdown 卡类名（BLOCK_MD_CLASS 也被 block-lang.ts 用于防递归重建）。 */
const MDR_BLOCK_CLASS = 'mdr-block';
const BLOCK_MD_CLASS = 'mdr-block-md';
/** 块视图 / 签名 / 语言 / 事件绑定标记（全部为本插件自有 data-mdr-*）。 */
const BLOCK_VIEW_ATTR = 'data-mdr-view';
const BLOCK_SIG_ATTR = 'data-mdr-sig';
const BLOCK_LANG_ATTR = 'data-mdr-lang';
const BLOCK_BOUND_ATTR = 'data-mdr-bound';
/** 语言是推断的（'content' / 'project'；空 = 原文标注或未推断）。 */
const BLOCK_INFER_ATTR = 'data-mdr-lang-inferred';
/** 底栏三态控件派发的事件名（与 lang-switch.ts 同一契约）。 */
const BLOCK_SWITCH_EVENT = 'mdr-lang-switch';
/** 触发 markdown 渲染的语言标记（显式标记 → 一律 markdown；无语言块的判定见 fence-content.ts）。 */
const TEXT_FENCE_LANGS = ['text', 'plaintext', 'txt', 'md', 'markdown'];
/** 图表语言（渲染交给 mermaid-scan.ts；本模块不碰）。 */
const MDR_DIAGRAM_LANGS = ['mermaid', 'mmd'];
/** markdown / 代码单块渲染上限（字符）：超长保持官方形态，避免单块卡顿。 */
const MAX_TEXT_FENCE_CHARS = 100000;
const MAX_CODE_FENCE_CHARS = 200000;
/** 块源码：官方 <pre> 文本（去掉一个尾部换行，对齐官方 display 语义）。 */
function fenceSource(block) {
    const pre = typeof block.querySelector === 'function' ? block.querySelector('pre') : null;
    const text = pre !== null ? (pre.textContent ?? '') : '';
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isFenceStreaming(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/**
 * 接管类型（唯一入口，手动覆盖优先级最高）：
 *  ⓪ 「渲染为…」覆盖：source → 不接管（官方原样）；markdown → 强制 markdown；mermaid → 交给图表；
 *  ① mermaid / mmd → 交给 mermaid-scan（本模块不碰）；
 *  ② text 家族 → 自研 markdown（明确的意图）；
 *  ③ 「确证无语言」→ **看内容**（fence-content）：明显是 markdown 文档才自研 markdown，
 *     否则按代码卡（等宽 + 保留换行；真实会话里无标记围栏绝大多数是代码），语言位用
 *     fence-lang-infer 的**推断值**（内容识别 > 项目主语言 > 留空，带「推断」标识）；
 *  ④ 其余（含识别失败）→ 自研代码卡（同一套推断；认不出才留空，绝不编造语言名）。
 */
function fenceKindOf(block) {
    const forced = fenceForceOf(block);
    if (forced === 'source')
        return { kind: 'none', lang: '' };
    if (forced === 'markdown')
        return { kind: 'markdown', lang: '' };
    if (forced === 'mermaid')
        return { kind: 'none', lang: 'mermaid' };
    const resolved = resolveFenceLangEx(block);
    const lang = resolved.lang;
    if (MDR_DIAGRAM_LANGS.includes(lang))
        return { kind: 'none', lang };
    if (TEXT_FENCE_LANGS.includes(lang))
        return { kind: 'markdown', lang };
    if (lang === '') {
        if (!resolved.confirmed) {
            const guess = inferredFenceLang(block);
            return { kind: 'code', lang: guess.lang, infer: guess.source };
        }
        if (fenceLooksLikeMarkdown(fenceSource(block)))
            return { kind: 'markdown', lang: '' };
        const guess = inferredFenceLang(block);
        return { kind: 'code', lang: guess.lang, infer: guess.source };
    }
    return { kind: 'code', lang };
}
/** 前置门控（任何语言判定之前）：开关关闭 / 渲染层不可用 / 流式块 / 已渲染容器内的块。 */
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
/** 本模块已建的自有容器。 */
function mdrBlockOf(host) {
    const found = typeof host.querySelector === 'function' ? host.querySelector('div.' + MDR_BLOCK_CLASS) : null;
    return found === null || found === undefined ? null : found;
}
/** 清掉自有容器（宿主的 banner / pre 一律不动）。 */
function clearMdrBlock(host) {
    const card = mdrBlockOf(host);
    if (card === null)
        return;
    // React root 挂在标题正文容器上（不是外壳卡）：先卸内层，再清 DOM。
    const body = typeof card.querySelector === 'function' ? card.querySelector('.mdr-block-body') : null;
    if (body !== null)
        unmountMarkdownIn(body);
    unmountMarkdownIn(card);
    if (card.parentNode)
        card.parentNode.removeChild(card);
    if (typeof host.removeAttribute === 'function') {
        host.removeAttribute(BLOCK_SIG_ATTR);
        host.removeAttribute(BLOCK_VIEW_ATTR);
        host.removeAttribute(BLOCK_INFER_ATTR);
    }
}
/** 幂等签名（含渲染库就绪版本：库到位后重建一次，把兜底换成渲染态）。 */
function fenceSignature(kind, lang, source) {
    return kind + ':' + lang + ':' + String(source.length) + ':' + contextHash(source) + ':' + String(renderAssetsReady());
}
/** 建代码卡（React：MdrCodeBlock 自带头 / 体 / 底栏三态；infer 非空 = 语言是推断的）。 */
function buildMdrCodeCard(lang, source, infer) {
    const card = document.createElement('div');
    card.className = MDR_BLOCK_CLASS;
    const props = { lang, code: source, view: 'code' };
    if (typeof infer === 'string' && infer !== '')
        props.inferred = infer;
    const ok = renderNodeInto(card, createElement(MdrCodeBlock, props));
    return ok ? card : null;
}
/** 建 markdown 卡（正文交给 render-assets 懒加载入口；底栏保留三态控件）。 */
function buildMdrMarkdownCard(source) {
    const card = document.createElement('div');
    card.className = MDR_BLOCK_CLASS + ' ' + BLOCK_MD_CLASS;
    const body = document.createElement('div');
    body.className = 'mdr-md mdr-block-body';
    if (!renderMarkdownInto(body, source))
        return null;
    card.appendChild(body);
    const foot = document.createElement('div');
    foot.className = 'mdr-fence-foot';
    const note = document.createElement('span');
    note.className = 'mdr-fence-note';
    note.textContent = '按 markdown 渲染';
    foot.appendChild(note);
    // 注意：类名**不能**用 mdr-lang-switch —— 那是扫描器补注入控件的类，
    // scanLangSwitches 会把同类的节点当自己的清掉（markdown 卡底栏会被误删）。
    const switchHost = document.createElement('div');
    switchHost.className = 'mdr-block-switch';
    if (!renderNodeInto(switchHost, createElement(MdrLangSwitchFrom, { current: 'markdown' })))
        return null;
    foot.appendChild(switchHost);
    card.appendChild(foot);
    return card;
}
/** 监听底栏三态事件（每块只绑一次）：事件 → 块视图（单一事实源）。 */
function bindMdrBlockEvents(host) {
    if (host.getAttribute(BLOCK_BOUND_ATTR) === 'true')
        return;
    host.setAttribute(BLOCK_BOUND_ATTR, 'true');
    host.addEventListener(BLOCK_SWITCH_EVENT, (event) => {
        const detail = event.detail;
        const value = detail !== undefined && typeof detail.value === 'string' ? detail.value : '';
        if (value === '')
            return;
        applyMdrLangChoice(host, value);
    });
}
/** 三态选择落地：图表 → 覆盖层 + 重扫（mermaid-scan 接）；markdown/source → 直接换视图。 */
function applyMdrLangChoice(host, value) {
    const lang = host.getAttribute(BLOCK_LANG_ATTR) ?? '';
    if (value === 'diagram') {
        setFenceForce(host, 'mermaid');
        clearMdrBlock(host);
        if (typeof rescanForLangs === 'function')
            rescanForLangs();
        return;
    }
    const source = fenceSource(host);
    if (value === 'markdown') {
        setFenceForce(host, 'markdown');
        mountMdrBlock(host, lang, source, 'markdown');
        return;
    }
    setFenceForce(host, 'source');
    mountMdrBlock(host, lang, source, 'source');
    // 源码视图下块回到宿主形态：重扫把底栏三态入口补回来（幂等）。
    if (typeof rescanForLangs === 'function')
        rescanForLangs();
}
/**
 * 挂载围栏块视图（契约导出）：host = div.md-code-block。
 * view = code（代码卡）| markdown（自研 markdown）| source（移除自有容器、官方原样）。
 */
function mountMdrBlock(host, lang, source, view, infer) {
    if (!host || typeof host.getAttribute !== 'function')
        return;
    bindMdrBlockEvents(host);
    if (view === 'source') {
        clearMdrBlock(host);
        host.setAttribute(BLOCK_LANG_ATTR, lang);
        return;
    }
    if (!domRootAvailable())
        return;
    const safeView = view === 'markdown' ? 'markdown' : 'code';
    const signature = fenceSignature(safeView, lang, source);
    if (host.getAttribute(BLOCK_SIG_ATTR) === signature && mdrBlockOf(host) !== null)
        return;
    clearMdrBlock(host);
    const card = safeView === 'markdown' ? buildMdrMarkdownCard(source) : buildMdrCodeCard(lang, source, infer);
    if (card === null)
        return;
    host.appendChild(card);
    markMdrBlock(host, lang, safeView, signature, infer);
}
/** 挂载完成后的收尾：写块标记 + 去掉扫描器补的块内控件（卡片底栏自带三态，避免一套两块）。 */
function markMdrBlock(host, lang, view, signature, infer) {
    host.setAttribute(BLOCK_LANG_ATTR, lang);
    host.setAttribute(BLOCK_VIEW_ATTR, view);
    host.setAttribute(BLOCK_SIG_ATTR, signature);
    if (typeof infer === 'string' && infer !== '')
        host.setAttribute(BLOCK_INFER_ATTR, infer);
    if (typeof removeLangSwitch === 'function')
        removeLangSwitch(host);
}
/** 应用（幂等）：把围栏块交给自研渲染器；门控 / 超长 / 空内容 → 不动宿主 DOM。 */
function applyFenceBlock(block) {
    if (fencePreSkip(block))
        return;
    const target = fenceKindOf(block);
    if (target.kind === 'none')
        return;
    const source = fenceSource(block);
    if (source.trim() === '' || source.length > fenceMaxChars(target.kind))
        return;
    mountMdrBlock(block, target.lang, source, target.kind === 'markdown' ? 'markdown' : 'code', target.infer);
}
/** 扫描 root（自身 / 后代）内的围栏代码块（mermaid 块由 mermaid-scan 负责）。 */
function scanFenceBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches('div.md-code-block'))
        applyFenceBlock(root);
    for (const block of Array.from(root.querySelectorAll('div.md-code-block')))
        applyFenceBlock(block);
}
Object.assign(exports,{MDR_BLOCK_CLASS,BLOCK_MD_CLASS,BLOCK_VIEW_ATTR,BLOCK_SIG_ATTR,BLOCK_SWITCH_EVENT,TEXT_FENCE_LANGS,MAX_TEXT_FENCE_CHARS,MAX_CODE_FENCE_CHARS,fenceSource,isFenceStreaming,fenceKindOf,fenceSignature,mdrBlockOf,clearMdrBlock,bindMdrBlockEvents,mountMdrBlock,applyFenceBlock,scanFenceBlocks});

    "use strict";
// ── 思考块默认展开（B 路）：宿主折叠态派发一次官方 click ──────────────────
// 契约决策（leader 已拍板）：**接受宿主渲染**。宿主折叠时内容不在 DOM（`{open && children}`），
// 自绘思考块拿不到内容；唯一不改宿主节点、不改样式的手段是对官方折叠行派发一次真实
// click，让官方自己的 React 状态机切到展开态（外观 / DOM / 动画 / a11y 全走官方）。
//
// 纪律与护栏：
//  - 只读官方自身属性（`[data-variant="think"] [data-disclosure-row][aria-expanded]`），
//    不写官方元素的 style / class / aria；
//  - 只对 `aria-expanded="false"` 的行动作；WeakSet 保证每行**一次性**动作
//    （用户之后手动折叠，永不再碰）；
//  - 选择器失配 / click 抛错 → 静默降级为官方默认（折叠），不影响其它渲染；
//  - 单次最多处理 MAX_THINK_ROWS_PER_SCAN 行（性能护栏）。
/** 官方思考行定位选择器（只用官方自身属性）。 */
const THINK_ROW_SELECTOR = '[data-variant="think"] [data-disclosure-row][aria-expanded]';
/** 官方思考容器选择器（先短路再查行，避免每批对全文档跑属性选择器）。 */
const THINK_ROOT_SELECTOR = '[data-variant="think"]';
/** 单次扫描处理的行数上限（性能护栏）。 */
const MAX_THINK_ROWS_PER_SCAN = 200;
/** 已由本模块处理过的行（一次性动作；WeakSet 不阻止 GC）。 */
const handledThinkRows = new WeakSet();
/** 派发一次官方点击（契约守卫：抛错即静默放弃，绝不影响其它渲染）。 */
function expandThinkRow(row) {
    try {
        const click = row.click;
        if (typeof click === 'function')
            click.call(row);
    }
    catch (_e) {
        /* 官方契约变化 → 静默降级为官方默认（折叠） */
    }
}
/** 在指定根内枚举思考行（scanner 传入新增节点，省一次全文档查询）。 */
function rootRowsOf(root) {
    const out = [];
    try {
        const rows = root.querySelectorAll(THINK_ROW_SELECTOR);
        for (let i = 0; i < rows.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1)
            out.push(rows[i]);
    }
    catch (_e) {
        return [];
    }
    return out;
}
/** 在文档内枚举折叠中的思考行（契约守卫：任何 DOM 异常都静默返回空数组）。 */
function thinkRowsOf() {
    if (typeof document === 'undefined' || document === null)
        return [];
    if (typeof document.querySelectorAll !== 'function')
        return [];
    const out = [];
    try {
        const rows = document.querySelectorAll(THINK_ROW_SELECTOR);
        for (let i = 0; i < rows.length && out.length < MAX_THINK_ROWS_PER_SCAN; i += 1)
            out.push(rows[i]);
    }
    catch (_e) {
        return [];
    }
    return out;
}
/**
 * 扫描文档内的官方思考行：新见到的、仍折叠的行派发一次 click。
 * 开关关闭（thinking.defaultExpanded=false）/ 已处理过 / 已展开 / 契约失配 → 一律不动。
 */
function applyThinkExpand(root) {
    if (!renderOptions.thinking.defaultExpanded)
        return;
    const scoped = root !== undefined && root !== null && typeof root.querySelectorAll === 'function';
    for (const row of scoped ? rootRowsOf(root) : thinkRowsOf()) {
        if (handledThinkRows.has(row))
            continue;
        handledThinkRows.add(row);
        if (row.getAttribute('aria-expanded') !== 'false')
            continue;
        expandThinkRow(row);
    }
}
Object.assign(exports,{THINK_ROW_SELECTOR,THINK_ROOT_SELECTOR,MAX_THINK_ROWS_PER_SCAN,applyThinkExpand});

    // mermaid 引擎按需加载 + 离屏渲染
    "use strict";
// ── mermaid 引擎：懒加载 + 离屏渲染 ─────────────────────────────────────
// 解析层**不进 bundle**（历史 4.49 MB 内联的教训）：引擎 UMD vendored 在 assets/，
// 由宿主 /md-render/assets/* 静态托管；这里只在首次真正需要时按需取脚本。
// 懒加载通道与 render-assets.ts 同款（vendored UMD + 运行时 <script> + 失败不重试）：
// 若 render-assets 的登记表已包含 mermaid 就直接复用它的 Promise 语义；尚未登记时
// 用同一机制自取 —— 两条路径都**不把引擎打成产物的一部分**。
//
// 失败面（都转成卡片可见的失败态，绝不静默丢内容）：
//  · 无 document（伪 DOM / SSR）→ ensureMermaid() 返回 null；
//  · fetch / 注入失败 / 注入后仍缺 window.mermaid → reject，卡片显示源码 + 原因。
//
// 离屏渲染：把渲染导向一个脱离视口、但仍参与布局的容器，SVG / 错误输出都留在容器里，
// 失败随容器一起丢弃（display:none / visibility:hidden 会让 mermaid 量不到节点尺寸，不能用）。
// 12.2.0 起 suppressErrorRendering 生效（解析失败不再往页面插「炸弹图」），离屏容器
// 仍是第二道保险 —— 引擎行为变化不会把错误图形漏到对话里。
/** 超长块跳过（与 mermaid 自身 maxTextSize 5e4 对齐，不做无谓渲染）。 */
const MAX_SOURCE_CHARS = 50000;
/** 离屏渲染容器标记（自有 data-*：回归测试据此断言渲染发生在脱离视口流的节点里）。 */
const OFFSCREEN_ATTR = 'data-mdr-mm-offscreen';
/** 引擎初始化配置（12.2.0 认 suppressErrorRendering：失败不渲染炸弹图，直接 reject）。 */
const MERMAID_INIT = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true };
/** 在飞的加载 Promise（失败即清空：卡片「重试」必须能真的重新加载一次）。 */
let mermaidReady = null;
/** 页面里已有的引擎（别的插件先加载过 / 复跑）→ 直接复用，零请求。 */
function mermaidGlobal() {
    return typeof window === 'undefined' ? undefined : window.mermaid;
}
/** initialize 重复调用会抛错（配置已经在）——忽略即可。 */
function initEngine(engine) {
    try {
        engine.initialize(MERMAID_INIT);
    }
    catch (_e) {
        /* already initialized */
    }
    return engine;
}
/** 注入引擎脚本并复查全局（注入后仍缺失 → reject）。 */
function injectEngine(code) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.textContent = code;
        script.onerror = () => reject(new Error('mermaid 引擎脚本注入失败'));
        document.head.appendChild(script);
        const engine = mermaidGlobal();
        if (engine === undefined) {
            reject(new Error('注入后仍未拿到 mermaid 引擎'));
            return;
        }
        resolve(initEngine(engine));
    });
}
/**
 * 懒加载引擎：优先走 render-assets 的登记表（集成窗口把 mermaid 登记进去后自动生效），
 * 尚未登记则按同一机制从 assets 路由取一次。
 */
function loadEngine() {
    const viaAssets = ensureRenderAsset(MERMAID_ASSET);
    if (viaAssets !== null)
        return Promise.resolve(initEngine(viaAssets));
    return fetch(MERMAID_ENGINE_URL)
        .then((resp) => {
        if (resp.ok === false)
            throw new Error('mermaid 引擎下载失败：HTTP ' + String(resp.status));
        return resp.text();
    })
        .then(injectEngine);
}
/** 本引擎在 render-assets 登记表里的名字（与 vendor 脚本的全局变量同名）。 */
const MERMAID_ASSET = 'mermaid';
/**
 * 确保引擎可用（首次调用触发一次懒加载）。
 * @returns 无 document（伪 DOM / SSR）→ null；否则返回加载 Promise。
 */
function ensureMermaid() {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined')
        return null;
    const existing = mermaidGlobal();
    if (existing !== undefined)
        return Promise.resolve(initEngine(existing));
    if (mermaidReady !== null)
        return mermaidReady;
    mermaidReady = loadEngine().catch((err) => {
        resetMermaidEngine();
        throw err instanceof Error ? err : new Error(String(err));
    });
    return mermaidReady;
}
/** 清掉加载缓存（卡片「重试」先调用它，再重跑渲染）。 */
function resetMermaidEngine() {
    mermaidReady = null;
}
/** 创建离屏渲染容器：脱离视口但仍参与布局（mermaid 要量节点尺寸）。 */
function createOffscreenHost(entryId) {
    const host = document.createElement('div');
    host.setAttribute(OFFSCREEN_ATTR, entryId);
    host.setAttribute('aria-hidden', 'true');
    host.className = 'mdr-mm-offscreen';
    return host;
}
/** 丢弃离屏容器及其内部一切（失败时引擎的错误图形就在里面）。 */
function dropOffscreen(host) {
    if (host.parentNode !== null)
        host.parentNode.removeChild(host);
}
/**
 * 渲染 mermaid 源码为 SVG 字符串。
 * 成功只取返回的 svg 字符串；失败时错误图形随离屏容器一起被丢弃，页面永远看不到它。
 */
function renderSvg(engine, entryId, source) {
    const body = typeof document === 'undefined' || document === null ? null : document.body;
    if (body === null || body === undefined)
        return Promise.reject(new Error('没有可用的 document.body'));
    const host = createOffscreenHost(entryId);
    body.appendChild(host);
    return engine.render(entryId, source, host).then((out) => {
        const svg = out !== null && out !== undefined && typeof out.svg === 'string' ? out.svg : '';
        dropOffscreen(host);
        if (svg === '')
            throw new Error('mermaid 未返回 SVG');
        return svg;
    }, (err) => {
        dropOffscreen(host);
        throw err instanceof Error ? err : new Error(String(err));
    });
}
/** 错误对象 → 可读文本（卡片失败态 / 提示条共用）。 */
function errMsg(err) {
    if (err instanceof Error && err.message)
        return err.message;
    return String(err);
}
Object.assign(exports,{MERMAID_ENGINE_URL,MAX_SOURCE_CHARS,OFFSCREEN_ATTR,MERMAID_ASSET,ensureMermaid,resetMermaidEngine,renderSvg,errMsg});

    // mermaid 卡片工具条（常驻四项：视图切换 / 缩放分段 / 全屏浮窗 / 更多菜单）
    "use strict";
// ── mermaid 卡片工具条（React）──────────────────────────────────────────
// 常驻：视图分段（预览 / 代码，带文字）+ 缩放分段（− 100% +）+ 全屏 + 更多；
// 低频操作收进「更多」菜单（导出 PNG / SVG、缩放模式、复制代码）—— 用户口径
// 「外面有的，里面就别再有」，所以全屏只常驻、菜单里不重复。
// 底栏「渲染为… 图表 / Markdown / 源码」**常显**（三态互斥，不藏进菜单）。
// 所有状态走 aria-* / 属性，类名由 React 计算（不碰 classList / el.style）。
/** 图标快捷方式（共享图标集；显式尺寸，CSS 不参与图标几何）。 */
function mmIcon(name, size) {
    return icon[name](size);
}
/** 预览 / 代码 视图分段（渲染失败时禁用预览，避免只剩激活态假象）。 */
function MdrMmViewSeg(props) {
    const btn = (label, value, iconNode, disabled) => createElement('button', {
        type: 'button',
        className: 'mdr-seg-btn' + (props.view === value ? ' is-active' : ''),
        onClick: () => props.onView(value),
        disabled: disabled,
        'aria-pressed': props.view === value,
        'data-mdr-tip': label,
    }, iconNode, createElement('span', null, label));
    return createElement('div', { className: 'mdr-seg', role: 'group', 'aria-label': '图表视图切换' }, btn('预览', 'diagram', mmIcon('eye', 12), props.previewDisabled), btn('代码', 'source', mmIcon('code', 12), false));
}
/** 缩放分段：− / 百分比 / + 收进一个胶囊（百分比是显示值，由 zoom-math 更新）。 */
function MdrMmZoomSeg(props) {
    const btn = (label, tip, iconNode, action) => createElement('button', {
        type: 'button',
        className: 'mdr-icon-btn',
        onClick: () => zoomEntry(props.scopeId, action),
        'aria-label': label,
        'data-mdr-tip': tip,
    }, iconNode);
    return createElement('div', { className: 'mdr-mm-zoom', role: 'group', 'aria-label': '图表缩放' }, btn('缩小', '缩小（键盘 −）', mmIcon('minus', 12), 'out'), createElement('span', { className: 'mdr-mm-zoom-val' }, '100%'), btn('放大', '放大（键盘 +）', mmIcon('plus', 12), 'in'));
}
/** 全屏按钮：打开原生 <dialog>（常驻高频入口）。 */
function MdrMmFullscreen(props) {
    return createElement('button', {
        type: 'button',
        className: 'mdr-icon-btn',
        onClick: props.onOpen,
        disabled: props.disabled,
        'aria-label': '全屏',
        'data-mdr-tip': '全屏（Esc 关闭）',
    }, mmIcon('maximize', 14));
}
/** 菜单项（模块级，压组件圈复杂度）。 */
function mmMenuItemNode(label, iconNode, onSelect, opts = {}) {
    const props = {
        type: 'button',
        role: opts.role ?? 'menuitem',
        className: 'mdr-mm-menu-item',
        onClick: onSelect,
        disabled: opts.disabled === true,
        'aria-label': label,
    };
    if (opts.role === 'menuitemradio')
        props['aria-checked'] = opts.checked === true;
    return createElement('button', props, iconNode, createElement('span', null, label), opts.check === undefined ? null : opts.check);
}
/** 菜单关闭路径：点菜单外 / Esc（触发按钮的点击已 stopPropagation）。 */
function useMenuDismiss(open, onDismiss) {
    useEffect(() => {
        if (!open)
            return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape')
                onDismiss();
        };
        const onDoc = () => onDismiss();
        document.addEventListener('keydown', onKey);
        document.addEventListener('click', onDoc);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('click', onDoc);
        };
    }, [open, onDismiss]);
}
/** 「更多」触发按钮（阻止冒泡：否则 document 的「点外关闭」会立刻关掉刚打开的菜单）。 */
function MmMenuTrigger(props) {
    return createElement('button', {
        type: 'button',
        className: 'mdr-icon-btn',
        'aria-haspopup': 'menu',
        'aria-expanded': props.open ? 'true' : 'false',
        'aria-label': '更多',
        'data-mdr-tip': '更多',
        onClick: (e) => {
            if (typeof e.stopPropagation === 'function')
                e.stopPropagation();
            props.onToggle();
        },
    }, mmIcon('more', 14));
}
/** 菜单内容：导出 / 缩放模式（menuitemradio + 勾）/ 复制代码。 */
function MmMenuBody(props) {
    const fitItem = (value, label, iconName) => mmMenuItemNode(label, mmIcon(iconName, 13), () => props.onFit(value), {
        role: 'menuitemradio',
        checked: props.fit === value,
        disabled: !props.zoomable,
        check: props.fit === value ? createElement('span', { className: 'mdr-mm-check' }, mmIcon('check', 12)) : null,
    });
    return createElement('div', { className: 'mdr-mm-menu', role: 'menu', 'aria-label': '更多操作', hidden: !props.open }, mmMenuItemNode('导出 PNG', mmIcon('file', 13), props.onPng, { disabled: !props.ready }), mmMenuItemNode('导出 SVG', mmIcon('download', 13), props.onSvg, { disabled: !props.ready }), createElement('div', { className: 'mdr-mm-menu-sep' }), createElement('div', { className: 'mdr-mm-menu-label' }, '缩放模式'), fitItem('container', '适应容器', 'fit'), fitItem('width', '适应宽度', 'wrap'), createElement('div', { className: 'mdr-mm-menu-sep' }), mmMenuItemNode('复制代码', mmIcon('copy', 13), props.onCopy));
}
/** 「更多」菜单：低频操作收纳（触发按钮 + 内容 + 关闭策略）。 */
function MdrMmMenu(props) {
    const [open, setOpen] = useState(false);
    const [fit, setFit] = useState('container');
    useMenuDismiss(open, () => setOpen(false));
    const pickFit = (value) => {
        setFit(value);
        setOpen(false);
        zoomEntry(props.scopeId, value === 'container' ? 'fit' : 'fill');
    };
    const pickExport = (action) => () => {
        setOpen(false);
        action();
    };
    return createElement('div', { className: 'mdr-mm-more' }, createElement(MmMenuTrigger, { open: open, onToggle: () => setOpen(!open) }), createElement(MmMenuBody, {
        open: open,
        fit: fit,
        ready: props.ready,
        zoomable: props.zoomable,
        onFit: pickFit,
        onPng: pickExport(props.onPng),
        onSvg: pickExport(props.onSvg),
        onCopy: pickExport(props.onCopy),
    }));
}
/** 底栏：常显「渲染为… 图表 / Markdown / 源码」+ 右侧渲染说明。 */
function MdrMmModeBar(props) {
    const btn = (value, label, iconNode) => createElement('button', {
        type: 'button',
        className: 'mdr-mm-mode',
        onClick: () => props.onView(value),
        'aria-pressed': props.view === value,
        'aria-label': '渲染为' + label,
    }, iconNode, createElement('span', null, label));
    return createElement('div', { className: 'mdr-mm-foot' }, createElement('span', { className: 'mdr-mm-foot-label' }, '渲染为…'), createElement('div', { className: 'mdr-mm-modes', role: 'group', 'aria-label': '围栏块渲染方式' }, btn('diagram', '图表', mmIcon('chart', 11)), btn('markdown', 'Markdown', mmIcon('markdown', 11)), btn('source', '源码', mmIcon('code', 11))), createElement('span', { className: 'mdr-mm-spacer' }), createElement('span', { className: 'mdr-mm-meta' }, props.meta()));
}
/** 卡片头：标题胶囊 + 类型 + 工具条（视图分段 / 缩放 / 全屏 / 更多）。 */
function MmCardHead(props) {
    return createElement('div', { className: 'mdr-mm-head' }, createElement('span', { className: 'mdr-mm-title', title: props.title }, mmIcon('chart', 11), createElement('span', null, props.title)), createElement('span', { className: 'mdr-mm-kind' }, props.kind), createElement('div', { className: 'mdr-mm-toolbar' }, createElement(MdrMmViewSeg, {
        view: props.view,
        previewDisabled: props.status === 'error',
        onView: props.onView,
    }), createElement(MdrMmZoomSeg, { scopeId: props.scopeId }), createElement(MdrMmFullscreen, { onOpen: props.onOpenFullscreen, disabled: !props.ready }), createElement(MdrMmMenu, {
        scopeId: props.scopeId,
        ready: props.ready,
        zoomable: props.zoomable,
        onPng: props.exportActions.onPng,
        onSvg: props.exportActions.onSvg,
        onCopy: props.exportActions.onCopy,
    })));
}
/** 全屏 dialog 头：标题 + 路径 + 操作（缩放 / 导出 SVG / 关闭）。 */
function MdrMmDialogHead(props) {
    return createElement('div', { className: 'mdr-mm-dialog-head' }, createElement('span', { className: 'mdr-mm-title' }, mmIcon('chart', 11), createElement('span', null, props.title)), createElement('span', { className: 'mdr-mm-dialog-path' }, 'mermaid 围栏块 · ' + props.kind), createElement('div', { className: 'mdr-mm-dialog-actions' }, createElement(MdrMmZoomSeg, { scopeId: props.fsId }), createElement('button', { type: 'button', className: 'mdr-btn', onClick: props.onExportSvg }, mmIcon('download', 12), createElement('span', null, '导出 SVG')), createElement('button', {
        type: 'button',
        className: 'mdr-icon-btn',
        onClick: props.onClose,
        'aria-label': '关闭全屏',
        'data-mdr-tip': '关闭（Esc）',
    }, mmIcon('close', 14))));
}

    // mermaid 图表卡片（预览 / 代码切换、导出、失败回显源码）
    "use strict";
// ── mermaid 图表卡片（React）── 卡片挂在插件自插的容器里（不动官方节点结构）；
// 官方 <pre> 由自有 CSS 的「块级标记」规则隐藏（标记由 mermaid-scan 写，见 styles-mermaid）。
//
// 结构（原型 .mm-card 3203–3361）：头（标题胶囊 + 类型 + 工具条）/ 体（图表 · Markdown ·
// 源码 三段互斥，由根节点 data-mdr-mm-view 驱动）/ 底（常显「渲染为…」三态 + 说明）。
// 全屏 = 原生 <dialog>（顶层 / Esc / 焦点归还 / 滚动锁定由浏览器提供，90vw × 85vh）。
// 状态一律走 aria-* 与自有 data-*，类名由 React 计算 —— 不写 classList / cssText / el.style。
/** 卡片挂载序号（作用域 id 用；缩放 / 导出都按作用域 id 定位）。 */
let mmCardSeq = 0;
/** 块级标记（**既有宿主契约值**：scanner / mermaid-scan 写在官方块与 host 上，自有 CSS
 *  据此隐藏官方 <pre>）。三个名字被 scanner.ts（不在本路写区）直接引用，字面量保持冻结。 */
const MERMAID_VIEW_ATTR = 'data-dsh-md-render-mermaid-view';
const MERMAID_ENTRY_ATTR = 'data-dsh-md-render-mermaid';
const MERMAID_STATE_ATTR = 'data-dsh-md-render-mermaid-state';
/** 提示条定时器（模块级单例：后一条提示覆盖前一条）。 */
let mmNoticeTimer = null;
/** 渲染状态机：加载引擎 → 离屏渲染 → SVG / 失败原因；令牌机制丢弃迟到结果。 */
function useMmRender(scopeId, source, attempt) {
    const [status, setStatus] = useState('loading');
    const [svg, setSvg] = useState(null);
    const [error, setError] = useState(null);
    const [elapsed, setElapsed] = useState(0);
    const [tokens] = useState(() => new Map());
    useEffect(() => {
        const token = {};
        tokens.set(scopeId, token);
        const current = () => tokens.get(scopeId) === token;
        setStatus('loading');
        const started = typeof performance === 'undefined' ? 0 : performance.now();
        const pending = ensureMermaid();
        if (pending === null) {
            setError('当前环境没有可用的 document，无法渲染图表');
            setStatus('error');
            return undefined;
        }
        pending
            .then((engine) => renderSvg(engine, scopeId, source))
            .then((svgText) => {
            if (!current())
                return;
            setSvg(svgText);
            setError(null);
            setElapsed(typeof performance === 'undefined' ? 0 : Math.max(1, Math.round(performance.now() - started)));
            setStatus('ok');
        })
            .catch((err) => {
            if (!current())
                return;
            setError(errMsg(err));
            setStatus('error');
        });
        return () => {
            if (tokens.get(scopeId) === token)
                tokens.delete(scopeId);
        };
    }, [scopeId, source, attempt, tokens]);
    function begin() {
        tokens.delete(scopeId);
        setError(null);
        setStatus('loading');
    }
    return { status: status, svg: svg, error: error, elapsed: elapsed, begin: begin };
}
/** 短暂提示（导出成功 / 失败），2.5s 后自动消失。 */
function useMmNotice() {
    const [notice, setNotice] = useState(null);
    useEffect(() => {
        return () => {
            if (mmNoticeTimer !== null)
                clearTimeout(mmNoticeTimer);
        };
    }, []);
    function flash(type, text) {
        setNotice({ type: type, text: text });
        if (mmNoticeTimer !== null)
            clearTimeout(mmNoticeTimer);
        mmNoticeTimer = setTimeout(() => setNotice(null), 2500);
    }
    return { notice: notice, flash: flash };
}
/** 取字符串（缺失 / 空串 → 回退值；纯函数）。 */
function mmText(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : value;
}
/** 渲染出 SVG 后绑定缩放（懒加载 panzoom；失败自动落降级引擎）；卸载时收掉本作用域。 */
function useMmZoom(scopeId, zoomable, svg) {
    useEffect(() => {
        if (!zoomable)
            return undefined;
        const target = zoomTargetsOf(scopeId);
        if (target !== null)
            void bindZoom(target, scopeId);
        return undefined;
    }, [scopeId, zoomable, svg]);
    useEffect(() => () => destroyZoomScope(scopeId), [scopeId]);
}
/** 图表区：加载中 / 失败态（源码为主 + 一行原因 + 重试）/ 渲染出的 SVG。 */
function MmDiagram(props) {
    if (props.status === 'loading') {
        return createElement('div', { className: 'mdr-mm-loading' }, mmIcon('refresh', 14), createElement('span', null, '渲染中…'));
    }
    if (props.status === 'error')
        return createElement(MmDiagramError, { error: props.error, source: props.source, onRetry: props.onRetry });
    if (props.svg === null)
        return createElement('pre', { className: 'mdr-mm-code' }, props.source);
    return createElement('div', { className: 'mdr-mm-canvas', dangerouslySetInnerHTML: { __html: props.svg } });
}
/** 失败态：源码是主视觉（DOM 第一个节点 = 首屏内容），失败原因降为一行灰字。 */
function MmDiagramError(props) {
    return createElement('div', { className: 'mdr-mm-error' }, createElement('pre', { className: 'mdr-mm-error-src' }, props.source), createElement('div', { className: 'mdr-mm-error-msg' }, mmIcon('alert', 13), createElement('span', null, '图表渲染失败：' + String(props.error ?? '')), createElement('button', {
        type: 'button',
        className: 'mdr-icon-btn mdr-mm-retry',
        onClick: props.onRetry,
        'aria-label': '重试',
        'data-mdr-tip': '重试渲染',
    }, mmIcon('refresh', 12))));
}
/** Markdown 视图：把源码当 markdown 渲染（marked 未就绪 → 退回纯文本，绝不留白）。 */
function MmMarkdownPanel(props) {
    const [host, setHost] = useState(null);
    const [rendered, setRendered] = useState(true);
    useEffect(() => {
        if (props.view !== 'markdown' || host === null)
            return undefined;
        setRendered(renderMarkdownInto(host, props.source));
        return () => unmountMarkdownIn(host);
    }, [props.view, props.source, host]);
    return createElement('div', { className: 'mdr-mm-md' }, createElement('div', { ref: setHost }), rendered ? null : createElement('div', { className: 'mdr-mm-md-fallback' }, props.source));
}
/** 提示条（成功 / 失败一行，无提示时返回 null）。 */
function MmNoticeBar(props) {
    if (props.notice === null)
        return null;
    return createElement('div', { className: 'mdr-mm-notice', 'data-mdr-mm-notice': props.notice.type }, mmIcon(props.notice.type === 'ok' ? 'check' : 'alert', 13), createElement('span', null, props.notice.text));
}
/** 打开原生模态（已打开 / 伪 DOM → 静默跳过）。 */
function mmDialogShow(dialogEl) {
    try {
        if (typeof dialogEl.showModal === 'function' && dialogEl.open !== true)
            dialogEl.showModal();
    }
    catch (_e) {
        /* 已打开 / 伪 DOM：不阻断渲染 */
    }
}
/** 关闭原生模态（已关闭 / 伪 DOM → 静默跳过）。 */
function mmDialogClose(dialogEl) {
    try {
        if (typeof dialogEl.close === 'function' && dialogEl.open === true)
            dialogEl.close();
    }
    catch (_e) {
        /* 已关闭 */
    }
}
/** 全屏浮窗（原生 <dialog>）：克隆出来的 SVG 走独立作用域，缩放与卡片互不影响。 */
function MdrMmDialog(props) {
    const [dialogEl, setDialogEl] = useState(null);
    const fsId = props.scopeId + '-fs';
    useEffect(() => {
        if (dialogEl === null)
            return undefined;
        const onCancel = (event) => {
            event.preventDefault();
            props.onClose();
        };
        const onClose = () => props.onClose();
        dialogEl.addEventListener('cancel', onCancel);
        dialogEl.addEventListener('close', onClose);
        if (props.open)
            mmDialogShow(dialogEl);
        else
            mmDialogClose(dialogEl);
        return () => {
            dialogEl.removeEventListener('cancel', onCancel);
            dialogEl.removeEventListener('close', onClose);
            mmDialogClose(dialogEl);
            destroyZoomScope(fsId);
        };
    }, [dialogEl, fsId, props.open]);
    useEffect(() => {
        if (!props.open)
            return undefined;
        const target = zoomTargetsOf(fsId);
        if (target !== null)
            void bindZoom(target, fsId);
        return undefined;
    }, [fsId, props.open, props.svg]);
    return createElement('dialog', {
        className: 'mdr-mm-dialog',
        ref: setDialogEl,
        'aria-label': 'mermaid 全屏',
        onClick: (event) => {
            if (event.target === event.currentTarget)
                props.onClose();
        },
    }, createElement(MdrMmDialogHead, {
        fsId: fsId,
        title: props.title,
        kind: props.kind,
        onClose: props.onClose,
        onExportSvg: props.onExportSvg,
    }), createElement('div', { className: 'mdr-mm-dialog-body mdr-mm-frame', 'data-mdr-mm': fsId, 'data-mdr-mm-fs': 'open' }, createElement('div', { className: 'mdr-mm-canvas', dangerouslySetInnerHTML: { __html: props.svg ?? '' } })), createElement('div', { className: 'mdr-mm-dialog-foot' }, createElement('span', null, 'Esc 关闭 · 缩放只影响显示，不改变导出尺寸'), createElement('span', { className: 'mdr-mm-spacer' }), createElement('span', { className: 'mdr-mm-meta' }, '图表渲染耗时 ' + String(props.elapsed) + 'ms')));
}
/** Mermaid 图表卡片（签名冻结：source / kind / title）。 */
function MdrMermaidCard(props) {
    const [scopeId] = useState(() => 'mdr-mm-' + ++mmCardSeq);
    const [attempt, setAttempt] = useState(0);
    const [view, setView] = useState('diagram');
    const [fsOpen, setFsOpen] = useState(false);
    const source = String(props.source ?? '');
    const kind = mmText(props.kind, mermaidKindOf(source));
    const title = mmText(props.title, kind);
    const { status, svg, error, elapsed, begin } = useMmRender(scopeId, source, attempt);
    const { notice, flash } = useMmNotice();
    const exportActions = makeExportHandlers(scopeId, source, flash);
    const ready = status === 'ok' && svg !== null;
    const zoomable = ready && view === 'diagram';
    useMmZoom(scopeId, zoomable, svg);
    function retry() {
        resetMermaidEngine();
        begin();
        setAttempt((n) => n + 1);
    }
    return createElement('div', {
        // mdr-root：通用控件（.mdr-icon-btn / .mdr-seg / .mdr-btn）的 token 作用域。
        className: 'mdr-mm-card mdr-root',
        'data-mdr-mm': scopeId,
        // 图表标记：其它注入点（lang-switch）据此跳过「渲染为…」控件，避免两套入口并存。
        'data-mdr-mermaid': 'true',
        'data-mdr-mm-state': status,
        'data-mdr-mm-view': view,
    }, createElement(MmCardHead, {
        title: title,
        kind: kind,
        status: status,
        view: view,
        ready: ready,
        zoomable: zoomable,
        scopeId: scopeId,
        onView: (next) => setView(next),
        onOpenFullscreen: () => setFsOpen(true),
        exportActions: exportActions,
    }), createElement(MmNoticeBar, { notice: notice }), createElement('div', { className: 'mdr-mm-body mdr-mm-frame' }, createElement(MmDiagram, { status: status, svg: svg, error: error, source: source, onRetry: retry })), createElement(MmMarkdownPanel, { view: view, source: source }), createElement('pre', { className: 'mdr-mm-code' }, source), createElement(MdrMmModeBar, {
        view: view,
        onView: (next) => setView(next),
        meta: () => kind + ' · 由 dsh-md-render 渲染',
    }), createElement(MdrMmDialog, {
        open: fsOpen && ready,
        scopeId: scopeId,
        title: title,
        kind: kind,
        svg: svg,
        elapsed: elapsed,
        onClose: () => setFsOpen(false),
        onExportSvg: exportActions.onSvg,
    }));
}
Object.assign(exports,{MdrMermaidCard,MmDiagram,MmDiagramError,MERMAID_VIEW_ATTR,MERMAID_ENTRY_ATTR,MERMAID_STATE_ATTR});

    // mermaid 代码块识别 + 流式稳定窗口
    "use strict";
// ── mermaid 围栏块识别 + 流式稳定窗口 + 卡片挂载 ───────────────────────
// 只在 `[data-conversation-scroll]` 内识别 `div.md-code-block` 且语言为 mermaid / mmd 的块
// （宿主没有 mermaid fence 渲染器注册 API —— 这是本插件的真增量）。
//
// 挂载策略（不改官方节点结构）：
//  · 卡片 host 追加在块内（appendChild，不动块的子结构）；
//  · 官方 <pre> 的隐藏全部交给自有 CSS（块上写自有标记），本模块只写 data-*；
//  · 标题 / 类型从源码提取（frontmatter title → accTitle → 类型名；类型 = 首个有效语句
//    的关键字），与原型「标题胶囊 + kind」一致。
//
// 流式口径：宿主在**整条消息**上挂 `data-streaming`，DOM 里看不到「结束围栏是否已出现」，
// 只能从内容是否还在增长来判定闭合（STREAM_SETTLE_MS + 连续观察次数）；误判有第二道
// 防线：源码再变即自愈卸载重来，绝不留残缺卡片。
/** 流式块稳定窗口（毫秒）。取自真机实测的流式更新间隔之上（~240ms/次）。 */
const STREAM_SETTLE_MS = 400;
/** 连续观察次数（首次发现算 1 次；窗口到期再确认 1 次才允许渲染）。 */
const STREAM_MIN_OBSERVATIONS = 2;
/** 本插件接管的围栏语言（与其它注入点的语言集合不重叠 → 分流稳定）。 */
const MM_FENCE_LANGS = ['mermaid', 'mmd'];
/** 已知图表类型关键字 → 展示用规范名（原型 .mm-kind 显示 flowchart 等）。
 *  清单按 mermaid 12.2.0 实测（initialize 后逐个 detectType 命中）补齐；裸关键字与
 *  `-beta` 别名都收，规范名统一去掉 `-beta` 后缀。 */
const MM_KIND_NAMES = [
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'stateDiagram-v2',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'quadrantChart',
    'requirementDiagram',
    'gitGraph',
    'C4Context',
    'C4Container',
    'C4Component',
    'C4Dynamic',
    'mindmap',
    'timeline',
    'sankey',
    'sankey-beta',
    'xychart',
    'xychart-beta',
    'block',
    'block-beta',
    'packet',
    'packet-beta',
    'architecture',
    'architecture-beta',
    'kanban',
    'info',
    'eventmodeling',
    'ishikawa',
    'ishikawa-beta',
    'cynefin-beta',
    'radar-beta',
    'treemap',
    'treemap-beta',
    'venn-beta',
    'wardley-beta',
    'swimlane-beta',
    'treeView-beta',
    'agentflow-beta',
    'railroad-beta',
    'railroad-abnf-beta',
    'railroad-ebnf-beta',
    'railroad-peg-beta',
    'usecase-beta',
];
/** 类型关键字 → 规范名（纯函数）。 */
function mmCanonicalKind(word) {
    if (word === 'graph')
        return 'flowchart';
    if (word === 'stateDiagram-v2')
        return 'stateDiagram';
    if (word.slice(-5) === '-beta')
        return word.slice(0, -5);
    return word;
}
/** 无类型信息的行：空行 / mermaid 注释 / frontmatter 键（纯函数）。 */
function mmSkipKindLine(line) {
    if (line === '')
        return true;
    if (line.indexOf('%%') === 0)
        return true;
    if (line.indexOf('title:') === 0)
        return true;
    return line.indexOf('config:') === 0;
}
/** 从源码提取图表类型（纯函数；识别不了 → 'mermaid'）。 */
function mermaidKindOf(source) {
    const text = String(source === undefined || source === null ? '' : source).replace(/^\uFEFF/, '');
    let frontMatter = false;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line === '---') {
            frontMatter = !frontMatter;
            continue;
        }
        if (frontMatter)
            continue;
        if (mmSkipKindLine(line))
            continue;
        const word = line.split(/\s+/)[0];
        if (MM_KIND_NAMES.indexOf(word) >= 0)
            return mmCanonicalKind(word);
    }
    return 'mermaid';
}
/** 从源码提取标题：frontmatter title → accTitle → 类型名（纯函数）。 */
function mermaidTitleOf(source, kind) {
    const text = String(source === undefined || source === null ? '' : source).replace(/^\uFEFF/, '');
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text);
    if (fm !== null) {
        const inFm = /(?:^|\n)\s*title:\s*(.+?)\s*(?:\n|$)/.exec(fm[1]);
        if (inFm !== null && inFm[1] !== '')
            return inFm[1];
    }
    const acc = /accTitle:\s*(.+?)\s*(?:\n|$)/.exec(text);
    if (acc !== null && acc[1] !== '')
        return acc[1];
    return kind;
}
/** 挂载序号（host 上的 entry 标记用）。 */
let mmHostSeq = 0;
const mmMounts = new Map();
const mmStreamWatch = new Map();
/**
 * 是否为 mermaid 代码块。语言来源 = block-lang 的双源互补：
 *  · allowIndex !== false：① client 事件流索引（含历史，冷启动唯一来源）；② DOM 语言名兜底；
 *  · allowIndex === false：只读 DOM —— 流式块专用（内容还在补写，哈希必然落空）。
 */
function isMermaidBlock(block, allowIndex = true) {
    try {
        const lang = allowIndex ? resolveFenceLang(block) : blockLangDomLang(block);
        return MM_FENCE_LANGS.indexOf(lang) >= 0;
    }
    catch (_e) {
        return false;
    }
}
/** 提取代码块源码（官方 <pre> 的文本）。 */
function mermaidSourceOf(block) {
    try {
        const pre = block.querySelector('pre');
        return pre === null ? '' : pre.textContent || '';
    }
    catch (_e) {
        return '';
    }
}
/** 块是否仍在流式消息里（祖先带 [data-streaming]）。 */
function isMmStreaming(block) {
    return !!(block.closest && block.closest('[data-streaming]'));
}
/** 清掉某块的稳定观察。 */
function clearStreamWatch(block) {
    const watch = mmStreamWatch.get(block);
    if (watch !== undefined && watch.timer !== null)
        clearTimeout(watch.timer);
    mmStreamWatch.delete(block);
}
/** 把卡片挂进块内（卡片自带作用域 id；块上写自有标记驱动官方 <pre> 的隐藏）。 */
function mountMermaidCard(block, source) {
    if (mmMounts.has(block))
        return;
    const host = document.createElement('div');
    // 双类名：新口径 mdr-mm-host + 既有 dsh-md-render-* 前缀（旧样式按前缀白名单保留我们的节点）。
    host.className = 'mdr-mm-host dsh-md-render-mermaid-host';
    block.appendChild(host);
    const root = require('react-dom/client').createRoot(host);
    const kind = mermaidKindOf(source);
    mmMounts.set(block, { root: root, host: host, text: source });
    clearStreamWatch(block);
    block.setAttribute(MERMAID_VIEW_ATTR, 'preview');
    host.setAttribute(MERMAID_ENTRY_ATTR, 'mermaid-' + String(++mmHostSeq));
    host.setAttribute(MERMAID_STATE_ATTR, 'loading');
    // 已是卡片：块内不再挂「渲染为…」控件（卡片底栏常显三态入口）。
    removeLangSwitch(block);
    root.render(createElement(MdrMermaidCard, { source: source, kind: kind, title: mermaidTitleOf(source, kind) }));
}
/** 自愈卸载：源码在挂载后又变了（流式其实还没写完）→ 拆卡片、恢复原始块。 */
function unmountMermaidCard(block, card) {
    mmMounts.delete(block);
    clearStreamWatch(block);
    try {
        card.root.unmount();
    }
    catch (_e) {
        /* 卸载异常不阻断恢复原始块 */
    }
    if (card.host.parentNode !== null)
        card.host.parentNode.removeChild(card.host);
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute(MERMAID_VIEW_ATTR);
}
/** 记录一次观察：内容变了就重新计时，没变就累计观察次数。 */
function watchStream(block, source, round) {
    const prev = mmStreamWatch.get(block);
    if (prev === undefined || prev.text !== source) {
        if (prev !== undefined && prev.timer !== null)
            clearTimeout(prev.timer);
        const watch = { text: source, observations: 1, round: round, timer: null };
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        mmStreamWatch.set(block, watch);
        return;
    }
    if (prev.round !== round) {
        prev.round = round;
        prev.observations += 1;
    }
}
/** 稳定窗口到期：内容仍与观察一致、且已连续观察够次数才渲染。 */
function settleStream(block) {
    const watch = mmStreamWatch.get(block);
    if (watch === undefined)
        return;
    watch.timer = null;
    if (typeof block.isConnected === 'boolean' && !block.isConnected) {
        mmStreamWatch.delete(block);
        return;
    }
    const source = mermaidSourceOf(block);
    if (source !== watch.text || !source.trim())
        return;
    if (mmMounts.has(block))
        return;
    watch.observations += 1;
    if (watch.observations < STREAM_MIN_OBSERVATIONS) {
        watch.timer = setTimeout(() => settleStream(block), STREAM_SETTLE_MS);
        return;
    }
    mountMermaidCard(block, source);
}
/**
 * 单个候选块：挂载 / 继续等待 / 自愈卸载。非 mermaid 块立即返回（性能护栏）。
 * 语言判定放在开关之后（关掉 mermaid 渲染时一次请求都不发）；流式块只读 DOM。
 */
function considerMermaidBlock(block, round) {
    if (!renderOptions.mermaid.render)
        return;
    if (isInsideRenderedMarkdown(block))
        return;
    if (!isMermaidBlock(block, !isMmStreaming(block)))
        return;
    const source = mermaidSourceOf(block);
    if (!source.trim() || source.length > MAX_SOURCE_CHARS)
        return;
    const mounted = mmMounts.get(block);
    if (mounted !== undefined) {
        if (mounted.text === source)
            return;
        unmountMermaidCard(block, mounted); // 源码还在变：拆掉重来，绝不留残缺卡片
    }
    if (!isMmStreaming(block)) {
        mountMermaidCard(block, source); // 历史消息 / 流式已结束：立即渲染
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
    for (const block of Array.from(mmStreamWatch.keys()))
        clearStreamWatch(block);
    mmMounts.clear();
}
Object.assign(exports,{STREAM_SETTLE_MS,MM_FENCE_LANGS,mmSkipKindLine,mmCanonicalKind,mermaidKindOf,mermaidTitleOf,isMermaidBlock,mermaidSourceOf,considerMermaidBlock,scanMermaidBlocks,teardownMermaid});

    // mermaid 图表导出（PNG / SVG 下载 + 复制源码）
    "use strict";
// ── 图表导出：PNG / SVG 真实下载 + 复制源码 ─────────────────────────────
// 失败一律经卡片提示条转可见提示，绝不静默。导出对象是**作用域里的 SVG**
// （卡片体或全屏 dialog 体：「导出 SVG」在两边都有入口）。
// 复制实现复用 copy.ts 的 copyText（同一 factory 作用域），不重复一份。
/** 默认文件名：mermaid-<序号>.<ext>（序号取自作用域 id，如 mdr-mm-3 → 3）。 */
function buildExportFileName(scopeId, ext) {
    const m = /(\d+)/.exec(String(scopeId === undefined || scopeId === null ? '' : scopeId));
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
/** 从作用域里取渲染出的 SVG 元素（按作用域 id 定位，多卡片互不串扰）。 */
function findDiagramSvg(scopeId) {
    if (typeof document === 'undefined' || document === null)
        return null;
    const root = document.querySelector('[' + MM_SCOPE_ATTR + '="' + scopeId + '"]');
    if (root === null || typeof root.querySelector !== 'function')
        return null;
    return root.querySelector('svg');
}
/** 组装导出 handler：返回 { onPng, onSvg, onCopy }。 */
function makeExportHandlers(scopeId, source, flashNotice) {
    return {
        onPng: () => {
            const svgEl = findDiagramSvg(scopeId);
            if (svgEl === null) {
                flashNotice('error', '图表尚未渲染完成，无法导出 PNG');
                return;
            }
            downloadPngFile(svgEl, buildExportFileName(scopeId, 'png'))
                .then(() => flashNotice('ok', 'PNG 已下载'))
                .catch((err) => flashNotice('error', 'PNG 导出失败：' + errMsg(err)));
        },
        onSvg: () => {
            const svgEl = findDiagramSvg(scopeId);
            if (svgEl === null) {
                flashNotice('error', '图表尚未渲染完成，无法导出 SVG');
                return;
            }
            try {
                downloadSvgFile(svgEl, buildExportFileName(scopeId, 'svg'));
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
Object.assign(exports,{buildExportFileName,serializeSvg,findDiagramSvg,makeExportHandlers});

    // mermaid 图表全屏 + 缩放 / 平移（panzoom 懒加载；失败切内置降级引擎）
    "use strict";
// ── 缩放几何与策略：上下界 / fit / fill / 100% / 锚点手势 / 跟随 / 键盘 ──
// 从 mermaid-zoom.ts 拆出（单文件行数门禁）。几何基准一律量**裁剪容器**（state.frame）
// 而非变换层：变换层高度由内容决定（扁图 flowchart LR 可能只有几十像素高），拿它当
// 可用空间会让 contain 恒为 1 —— 那正是「图永远放不大」的根因。
//
// 取值口径（原型）：缩放区间 50–200%，步进 25%；「适应容器 / 适应宽度」是保持态
// （draw.io 的 Fit Window 同款）——容器 / 全屏尺寸变化时重算，用户手动缩放即退出。
/** 缩放上下界与步进（原型：50–200%，一次 ±25%）。 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 1.25;
/** 方向键平移步长（像素）。 */
const PAN_KEY_STEP = 40;
/** 比例夹逼到引擎上下界（与缩放下界同源，纯函数）。 */
function zoomClamp(scale) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}
/** 量容器与图固有尺寸；量不出（无 SVG / 未布局 / 尺寸为 0）→ null（调用方退回 1）。 */
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
/**
 * 程序性缩放后的**居中补偿**：两个引擎的缩放锚点都是「变换层布局盒中心」，而变换层
 * 高度 = 内容固有高度（竖向长图常远超容器），锚点可能落在容器可视区之外。变换是
 * translate(t) scale(s)（降级引擎）/ scale(s) translate(t)（panzoom），补偿系数按引擎取。
 * 水平方向变换层宽 = 容器宽、内容已居中，无需补偿。
 */
function zoomCenterInFrame(state) {
    const m = zoomMetrics(state);
    if (m === null)
        return;
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
/** 适应容器 = 完整显示（contain）：宽 / 高比例的较小者。 */
function zoomFitScale(state) {
    const m = zoomMetrics(state);
    if (m === null)
        return 1;
    return zoomClamp(Math.min(m.bw / m.sw, m.bh / m.sh));
}
/** 适应宽度 = 铺满（bw / sw），高度溢出时用户平移。 */
function zoomFillScale(state) {
    const m = zoomMetrics(state);
    if (m === null)
        return 1;
    return zoomClamp(m.bw / m.sw);
}
/** 事件里的指针 / 手势中心（client 坐标）；拿不到有限坐标 → null（退回元素中心为锚）。 */
function zoomPointOf(event) {
    const e = event;
    const x = typeof e.clientX === 'number' ? e.clientX : NaN;
    const y = typeof e.clientY === 'number' ? e.clientY : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return null;
    return { x: x, y: y };
}
/** 以屏幕点为锚点缩放：优先引擎自带锚点 API；不支持 → false（调用方退回居中缩放）。 */
function zoomAnchored(state, scale, point) {
    if (point === null)
        return false;
    const pz = state.pz;
    if (typeof pz.zoomToPoint === 'function') {
        const before = pz.getScale();
        try {
            // panzoom 4.6.2 的签名是 zoomToPoint(scale, event) —— scale 在前；传反时不抛错、只是不动。
            pz.zoomToPoint(scale, { clientX: point.x, clientY: point.y });
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
/** 裸 wheel 归页面（滚动陷阱）：只有 ctrlKey+wheel（捏合）或全屏态才缩放。 */
function zoomWheelShouldHandle(event, scopeId) {
    const wheel = event;
    return wheel.ctrlKey === true || zoomScopeIsFullscreen(scopeId);
}
/** 手动缩放（滚轮 / 捏合 / 键盘）：用户接管 → 退出 fitMode；有坐标则以该点为锚。 */
function zoomManual(state, next, point, animate) {
    state.fitMode = false;
    if (!zoomAnchored(state, next, point))
        state.pz.zoom(next, { animate: animate });
    refreshZoomLabel(state);
}
/** fitMode 下的重算（全屏 / 容器尺寸变化）：比例没变就不写变换，避免观察器自激。 */
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
        if (typeof target.removeEventListener === 'function')
            target.removeEventListener(type, fn);
    };
}
/** fitMode 的「跟随容器」：全屏切换 / 容器尺寸变化时重算 fit（保持态）。 */
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
    state.fitMode = false; // 0 = 位移与比例一并复位（真正的复位；适应交给按钮 / 双击）
    state.pz.reset({ animate: false });
    refreshZoomLabel(state);
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
/** 键盘 a11y：+ / - 缩放，0 复位，方向键平移（Esc 由原生 dialog 负责）。 */
function zoomKey(box, event) {
    const state = zoomStates.get(box);
    if (state === undefined)
        return;
    const key = String(event.key ?? '');
    if (!zoomArrowKey(state, key) && !zoomScaleKey(state, key))
        return;
    if (typeof event.preventDefault === 'function')
        event.preventDefault();
}
/** 刷新百分比标签（同一作用域内的 − 100% + 分段）。 */
function refreshZoomLabel(state) {
    const label = state.root.querySelector('.mdr-mm-zoom-val');
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
/** 工具条 / 菜单动作：fit = 适应容器（保持态）/ fill = 适应宽度 / full = 100% / in / out。 */
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
/** 双击 = 「适应 ↔ 实际大小」切换（按 fitMode 状态判断，不按比例接近度判断）。 */
function zoomToggle(state) {
    applyZoom(state, state.fitMode ? 'full' : 'fit');
}

    "use strict";
// ── 内置降级缩放（panzoom 不可用时的兜底）────────────────────────────────
// panzoom 走**运行时**脚本懒加载，环境差异（资源被拦、注入时机、UMD 落点）会让它失败；
// 失败时绝不能「点了没反应」。这里用**纯属性**实现同一套接口（zoom / pan / reset /
// getScale / zoomAtPoint / destroy）：
//  · 缩放 = 改 SVG 的 width / height 属性（原型 applyZoom 同款手法，不做内联样式）；
//  · 平移 = 滚裁剪容器的 scrollLeft / scrollTop（overflow:auto 本来就在）；
//  · 容器上打 data-mdr-mm-engine="attribute"，配套 CSS 取消 svg 的 max-width 封顶。
// 零运行时加载 ⇒ 不存在失败面；坐标几何纯函数化，便于单测。
//
// 硬约束：本文件不写 classList / cssText / el.style（静态断言白名单只认 setAttribute）。
/** 缩放后的 SVG 显示尺寸（纯函数；非法比例退回 1，最小 1 像素）。 */
function fallbackSvgSize(size, scale) {
    const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return { w: Math.max(1, Math.round(size.w * safe)), h: Math.max(1, Math.round(size.h * safe)) };
}
/** 派发与 panzoom 同名的合成事件（panzoompan）：调用方据此判定「用户真的在手动平移」。 */
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
/** SVG width/height 属性给出的固有尺寸（缺省 → null）。 */
function svgAttrSize(svg) {
    const w = Number(svg.getAttribute('width') ?? 0);
    const h = Number(svg.getAttribute('height') ?? 0);
    return w > 0 && h > 0 ? { w: w, h: h } : null;
}
/** viewBox 给出的固有尺寸（缺省 → null）。 */
function svgViewBoxSize(svg) {
    const box = svg.viewBox !== undefined && svg.viewBox !== null ? svg.viewBox.baseVal : null;
    if (box === null || box.width <= 0 || box.height <= 0)
        return null;
    return { w: box.width, h: box.height };
}
/** 布局盒量出的尺寸（最后兜底；缺省 → null）。 */
function svgBoxSize(svg) {
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { w: rect.width, h: rect.height } : null;
}
/** 图固有尺寸：优先 SVG 的 width/height 属性，其次 viewBox，最后量布局盒。 */
function svgNaturalSize(svg) {
    return svgAttrSize(svg) ?? svgViewBoxSize(svg) ?? svgBoxSize(svg);
}
/** 裁剪容器（rolling 的 scrollLeft/scrollTop 宿主）。 */
function zoomFrameOf(box) {
    const frame = typeof box.closest === 'function' ? box.closest('.mdr-mm-frame') : null;
    return frame ?? box.parentElement;
}
/** 设置滚动位置（负数夹到 0；伪 DOM 缺属性时静默跳过）。 */
function scrollBy(target, dx, dy) {
    const host = target;
    const left = target;
    if (typeof host.scrollLeft === 'number')
        left.scrollLeft = Math.max(0, left.scrollLeft + dx);
    if (typeof host.scrollTop === 'number')
        left.scrollTop = Math.max(0, left.scrollTop + dy);
}
/** 内置降级缩放器：与 panzoom 同接口，纯属性实现。 */
function createFallbackZoomer(box, limits) {
    const svg = box.querySelector('svg');
    const frame = zoomFrameOf(box);
    const natural = svg === null ? null : svgNaturalSize(svg);
    let scale = 1;
    const clamp = (value) => Math.min(limits.maxScale, Math.max(limits.minScale, value));
    const paint = () => {
        if (svg === null || natural === null)
            return;
        const size = fallbackSvgSize(natural, scale);
        svg.setAttribute('width', String(size.w));
        svg.setAttribute('height', String(size.h));
    };
    if (frame !== null)
        frame.setAttribute('data-mdr-mm-engine', 'attribute');
    const unbind = attachDragPan(box, (dx, dy) => {
        if (frame !== null)
            scrollBy(frame, -dx, -dy);
    });
    return {
        zoom: (next) => {
            scale = clamp(next);
            paint();
            return scale;
        },
        pan: (x, y, options) => {
            const relative = options !== undefined && options.relative === true;
            if (frame !== null) {
                const scroller = frame;
                if (typeof scroller.scrollLeft === 'number')
                    scroller.scrollLeft = relative ? scroller.scrollLeft + x : Math.max(0, x);
                if (typeof scroller.scrollTop === 'number')
                    scroller.scrollTop = relative ? scroller.scrollTop + y : Math.max(0, y);
            }
            return { x: x, y: y };
        },
        reset: () => {
            scale = 1;
            paint();
            if (frame !== null) {
                const scroller = frame;
                if (typeof scroller.scrollLeft === 'number')
                    scroller.scrollLeft = 0;
                if (typeof scroller.scrollTop === 'number')
                    scroller.scrollTop = 0;
            }
            return { x: 0, y: 0 };
        },
        getScale: () => scale,
        zoomAtPoint: (next) => {
            scale = clamp(next);
            paint();
            return scale;
        },
        destroy: () => {
            unbind();
            if (frame !== null)
                frame.removeAttribute('data-mdr-mm-engine');
        },
    };
}
Object.assign(exports,{fallbackSvgSize,createFallbackZoomer});

    "use strict";
// ── 图表缩放 / 平移绑定（panzoom 懒加载 + 内置降级引擎）──────────────────
// 一个「作用域」= 一个带 data-mdr-mm="<id>" 的容器（卡片体 / 全屏 dialog 体各一个），
// 作用域里再找裁剪容器（.mdr-mm-frame）与变换层（.mdr-mm-canvas）；
// 几何与动作策略在 zoom-math.ts，panzoom 不可用时的纯属性引擎在 zoom-fallback.ts。
//
// 设计取舍：
//  · 缩放对象是**本插件自有的容器**（不碰官方元素），事件绑在作用域根上 ——
//    指针落在卡片任意位置都能捏合；
//  · 裸 wheel 不拦截（纵向滚动归页面），只有 ctrl+wheel（触控板捏合）或全屏态才缩放；
//  · 全屏 dialog 由卡片以 React 渲染、原生 showModal() 打开；这里只按作用域各自绑定，
//    两个作用域互不影响。
/** 缩放作用域标记（卡片根 / dialog 体各带一个；值 = 作用域 id）。 */
const MM_SCOPE_ATTR = 'data-mdr-mm';
/** 全屏态标记（原生 <dialog open> 之外的自有标记，供滚轮策略判断）。 */
const MM_FS_ATTR = 'data-mdr-mm-fs';
const zoomStates = new Map();
let panzoomReady = null;
/** 注入 panzoom UMD 并解析 window.Panzoom（注入下无 module → 落 window）。 */
function injectPanzoom(code) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.textContent = code;
        script.onerror = () => reject(new Error('panzoom 脚本注入失败'));
        document.head.appendChild(script);
        const ctor = typeof window === 'undefined' ? undefined : window.Panzoom;
        if (typeof ctor !== 'function') {
            reject(new Error('注入后仍未拿到 panzoom'));
            return;
        }
        resolve(ctor);
    });
}
/** 懒加载 panzoom（首次真正需要才取；失败重置缓存 → 下次点击可重试）。 */
function ensurePanzoom() {
    const globalCtor = typeof window === 'undefined' ? undefined : window.Panzoom;
    if (typeof globalCtor === 'function')
        return Promise.resolve(globalCtor);
    if (panzoomReady !== null)
        return panzoomReady;
    panzoomReady = fetch(PANZOOM_SCRIPT_URL)
        .then((resp) => {
        if (resp.ok === false)
            throw new Error('panzoom 下载失败：HTTP ' + String(resp.status));
        return resp.text();
    })
        .then(injectPanzoom)
        .catch((err) => {
        panzoomReady = null;
        throw err instanceof Error ? err : new Error(String(err));
    });
    return panzoomReady;
}
/** 作用域根（卡片 / 全屏 dialog 体）。 */
function zoomScopeOf(scopeId) {
    if (typeof document === 'undefined' || document === null)
        return null;
    return document.querySelector('[' + MM_SCOPE_ATTR + '="' + scopeId + '"]');
}
/** 作用域内的裁剪容器 / 变换层 / 根（缺失 → null）。 */
function zoomTargetsOf(scopeId) {
    const root = zoomScopeOf(scopeId);
    if (root === null || typeof root.querySelector !== 'function')
        return null;
    const frame = root.querySelector('.mdr-mm-frame');
    const box = root.querySelector('.mdr-mm-canvas');
    if (frame === null || box === null)
        return null;
    return { root: root, frame: frame, box: box };
}
/** 该作用域是否处于全屏态（滚轮策略用：全屏里裸 wheel 也缩放）。 */
function zoomScopeIsFullscreen(scopeId) {
    const root = zoomScopeOf(scopeId);
    return root !== null && root.getAttribute(MM_FS_ATTR) === 'open';
}
/** 事件绑定：绑在作用域根上；缩放锚点跟随手势中心。 */
function bindZoomEvents(state, scopeId) {
    const { pz, root, box } = state;
    root.addEventListener('wheel', (event) => {
        if (!zoomWheelShouldHandle(event, scopeId))
            return;
        zoomManual(state, pz.getScale() * zoomStep(event), zoomPointOf(event), false);
        event.preventDefault();
    }, { passive: false });
    // macOS Safari 触控板捏合派发 gesture*（不发 ctrl+wheel）；接不住就「没有任何放大效果」。
    let gestureBase = pz.getScale();
    root.addEventListener('gesturestart', (event) => {
        gestureBase = pz.getScale();
        event.preventDefault();
    });
    root.addEventListener('gesturechange', (event) => {
        const ratio = Number(event.scale);
        if (ratio > 0)
            zoomManual(state, gestureBase * ratio, zoomPointOf(event), false);
        event.preventDefault();
    });
    // 双击 = 适应 ↔ 实际大小；拖动平移（panzoompan / 降级引擎合成都发）→ 退出 fitMode。
    box.addEventListener('dblclick', () => zoomToggle(state));
    box.addEventListener('panzoompan', () => {
        state.fitMode = false;
    });
    root.addEventListener('keydown', (event) => zoomKey(box, event));
}
/** 用给定引擎建实例（幂等）：状态登记 + 事件绑定 + fitMode 跟随 + 首次适应容器。
 *  引擎构造抛错也回落降级引擎，绝不让按钮失灵。 */
function buildZoomState(target, make, translateInScaledSpace, scopeId) {
    const { root, frame, box } = target;
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
        inScaledSpace = false;
    }
    const state = {
        pz: pz,
        root: root,
        frame: frame,
        box: box,
        fitMode: true,
        translateInScaledSpace: inScaledSpace,
    };
    zoomStates.set(box, state);
    bindZoomEvents(state, scopeId);
    state.unwatch = bindFitFollow(state);
    applyZoom(state, 'fit');
    return state;
}
/** 绑定缩放 / 平移（幂等）：优先 panzoom，**它拉不起来就用内置引擎**（不允许静默失败）。 */
function bindZoom(target, scopeId) {
    const bound = zoomStates.get(target.box);
    if (bound !== undefined)
        return Promise.resolve(bound);
    return ensurePanzoom()
        .then((Panzoom) => buildZoomState(target, (limits) => new Panzoom(target.box, {
        minScale: limits.minScale,
        maxScale: limits.maxScale,
        cursor: 'grab',
        pinchAndPan: true,
        zoomWithWheel: false,
        touchAction: 'pan-y',
    }), true, scopeId))
        .catch(() => buildZoomState(target, (limits) => createFallbackZoomer(target.box, limits), false, scopeId));
}
/** 工具条入口：未就绪就等加载完再执行（加载期间 / 失败后点击都不能被丢弃）。 */
function zoomEntry(scopeId, action) {
    const target = zoomTargetsOf(scopeId);
    if (target === null)
        return;
    void bindZoom(target, scopeId).then((state) => applyZoom(state, action));
}
/** 卸载一个作用域（全屏 dialog 关闭 / 卡片卸载）：解绑跟随、销毁引擎、清表。 */
function destroyZoomScope(scopeId) {
    const root = zoomScopeOf(scopeId);
    if (root === null)
        return;
    for (const [box, state] of zoomStates) {
        if (state.root !== root)
            continue;
        if (typeof state.unwatch === 'function')
            state.unwatch();
        try {
            state.pz.destroy();
        }
        catch (_e) {
            /* 不阻断清理 */
        }
        zoomStates.delete(box);
    }
}
/** teardown：销毁全部实例、清空表与加载缓存（观察器断连由共享骨架负责）。 */
function teardownZoom() {
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
Object.assign(exports,{PANZOOM_SCRIPT_URL,MM_SCOPE_ATTR,MM_FS_ATTR,zoomStates,zoomScopeOf,zoomTargetsOf,zoomScopeIsFullscreen,ensurePanzoom,bindZoom,zoomEntry,destroyZoomScope,teardownZoom});

    // 「渲染为…」语言手动切换（覆盖层 + 块内控件 + 卡片头并项）
    "use strict";
// ── 「渲染为…」三态控件（B 路）：图表 / Markdown / 源码 ───────────────────
// 视觉真源 = 原型 .render-mode（1565–1619）：分段外框 padding 2 / 6px 圆角，
// 按钮高 22 / padding 0 8 / 10.5px，当前态用 .is-active。
//
// 通信契约：控件本身不拥有块状态 —— 点击时在最近的 div.md-code-block 上派发
// `mdr-lang-switch` CustomEvent（detail.value = diagram|markdown|source），由
// block-render.ts 的监听器改写块视图（单一事实源留在块上，控件可安全多挂）。
//
// 三种渲染方式与旧覆盖层（block-lang.ts 的 data-dsh-md-render-lang-force）的映射：
//   diagram → mermaid（交给图表卡片）· markdown → markdown · source → source（宿主原样）。
/** 控件类名 / 选项属性 / 事件名。 */
const MDR_RM_CLASS = 'mdr-rm';
const MDR_RM_BTN_CLASS = 'mdr-rm-btn';
const MDR_SWITCH_EVENT = 'mdr-lang-switch';
const MDR_SWITCH_OPTION_ATTR = 'data-mdr-option';
/** 块内控件容器类名（旧调用面 syncLangSwitch 使用）。 */
const LANG_SWITCH_CLASS = 'mdr-lang-switch';
/** 三种渲染方式（值与原型 data-mm-mode 同构：diagram / markdown / source）。 */
const MDR_RENDER_OPTIONS = [
    { value: 'diagram', label: '图表', iconName: 'chart' },
    { value: 'markdown', label: 'Markdown', iconName: 'markdown' },
    { value: 'source', label: '源码', iconName: 'code' },
];
/** 取共享图标（查不到退回 code，绝不返回空按钮）。 */
function mdrRenderIcon(name, size) {
    const make = icon[name];
    return typeof make === 'function' ? make(size) : icon.code(size);
}
/** 事件目标最近的围栏块（选择器不成立 / 抛错 → null）。 */
function mdrBlockOfTarget(target) {
    const el = target;
    if (el === null || el === undefined || typeof el.closest !== 'function')
        return null;
    try {
        return el.closest('div.md-code-block');
    }
    catch (_e) {
        return null;
    }
}
/** 派发切换事件（构造失败 → 静默：块视图保持原样）。 */
function mdrEmitSwitch(host, value) {
    try {
        const event = typeof CustomEvent === 'function' ? new CustomEvent(MDR_SWITCH_EVENT, { bubbles: true, detail: { value } }) : null;
        if (event !== null && typeof host.dispatchEvent === 'function')
            host.dispatchEvent(event);
    }
    catch (_e) {
        /* 事件构造失败 → 静默（块视图不变） */
    }
}
/** 点击 → 在最近的 div.md-code-block 上派发切换事件（契约守卫：无块 / 无 API 即静默）。 */
function mdrDispatchLangSwitch(target, value) {
    const host = mdrBlockOfTarget(target);
    if (host === null || host === undefined || typeof host.dispatchEvent !== 'function')
        return;
    if (typeof host.setAttribute === 'function')
        host.setAttribute('data-mdr-switch', value);
    mdrEmitSwitch(host, value);
}
/**
 * 渲染方式控件（内部通用形态；current 可为 'code' 表示「不是三态之一」，
 * 此时三个按钮都不激活，如实反映自动判定结果）。
 */
function MdrLangSwitchFrom(props) {
    const current = typeof props.current === 'string' ? props.current : '';
    const buttons = [];
    for (const option of MDR_RENDER_OPTIONS) {
        const active = current === option.value;
        buttons.push(createElement('button', {
            key: option.value,
            type: 'button',
            className: MDR_RM_BTN_CLASS + (active ? ' is-active' : ''),
            'aria-pressed': active ? 'true' : 'false',
            'aria-label': '渲染为' + option.label,
            'data-mdr-tip': '渲染为' + option.label,
            [MDR_SWITCH_OPTION_ATTR]: option.value,
            onClick: (event) => mdrDispatchLangSwitch(event === null || event === undefined ? null : event.currentTarget, option.value),
        }, mdrRenderIcon(option.iconName, 11), createElement('span', null, option.label)));
    }
    return createElement('span', { className: MDR_RM_CLASS, role: 'group', 'aria-label': '渲染为' }, ...buttons);
}
/** 「渲染为…」三态控件（契约导出）：props = { current: 'diagram' | 'markdown' | 'source' }。 */
function MdrLangSwitch(props) {
    return MdrLangSwitchFrom({ current: props.current });
}
/** 块的当前渲染方式（读块上的视图 / 覆盖标记；无法判定 → source）。 */
function langSwitchValue(block) {
    if (typeof block.getAttribute !== 'function')
        return 'source';
    const view = block.getAttribute('data-mdr-view');
    if (view === 'markdown' || view === 'code' || view === 'source')
        return view;
    const forced = fenceForceOf(block);
    if (forced === 'mermaid')
        return 'diagram';
    if (forced === 'markdown')
        return 'markdown';
    if (forced === 'source')
        return 'source';
    return 'source';
}
/**
 * 块是否该有块内控件：自建视图（代码卡 / markdown 卡 / 图表卡）的底栏与卡片头
 * 已经各自带了三态控件，这里不再重复注入（「外面有的，里面就别有了」）；
 * 只给仍停在宿主形态、且不在流式中的块补一个入口。
 */
function langSwitchEnabled(block) {
    if (typeof block.getAttribute !== 'function')
        return false;
    if (block.getAttribute('data-mdr-view') !== null)
        return false;
    if (block.closest && block.closest('[data-streaming]'))
        return false;
    if (typeof block.querySelector === 'function') {
        if (block.querySelector('div.mdr-block') !== null)
            return false;
        if (block.querySelector('[data-mdr-mermaid]') !== null)
            return false;
    }
    return true;
}
/** 移除块内控件（卡片挂载时调用；卡片头自带另外一项）。 */
function removeLangSwitch(block) {
    if (typeof block.querySelector !== 'function')
        return;
    const group = block.querySelector('div.' + LANG_SWITCH_CLASS);
    if (group !== null && group.parentNode)
        group.parentNode.removeChild(group);
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute('data-mdr-lang-switch');
}
/** 同步块内「渲染为…」控件（幂等；渲染层不可用 / 不该有控件时移除）。 */
function syncLangSwitch(block) {
    if (typeof block.querySelector !== 'function')
        return;
    if (!langSwitchEnabled(block) || !domRootAvailable()) {
        removeLangSwitch(block);
        return;
    }
    const current = langSwitchValue(block);
    const existing = block.querySelector('div.' + LANG_SWITCH_CLASS);
    if (existing !== null) {
        if (existing.getAttribute('data-mdr-current') === current)
            return;
        if (existing.parentNode)
            existing.parentNode.removeChild(existing);
    }
    const group = document.createElement('div');
    group.className = LANG_SWITCH_CLASS;
    group.setAttribute('data-mdr-current', current);
    if (!renderNodeInto(group, createElement(MdrLangSwitchFrom, { current })))
        return;
    block.appendChild(group);
    if (typeof block.setAttribute === 'function')
        block.setAttribute('data-mdr-lang-switch', current);
}
/** 切换渲染方式：写覆盖标记 → 清本块自建视图 → 重扫（幂等）。 */
function applyLangForce(block, value) {
    const forced = value === 'diagram' || value === 'mermaid' ? 'mermaid' : value === 'markdown' ? 'markdown' : 'source';
    setFenceForce(block, forced);
    clearMdrBlock(block);
    if (typeof block.removeAttribute === 'function')
        block.removeAttribute('data-mdr-view');
    removeLangSwitch(block);
    if (typeof rescanForLangs === 'function')
        rescanForLangs();
}
/** 扫描 root（自身 / 后代）内的围栏代码块，同步各自的语言控件。 */
function scanLangSwitches(root) {
    if (!root || typeof root.querySelectorAll !== 'function')
        return;
    if (typeof root.matches === 'function' && root.matches('div.md-code-block'))
        syncLangSwitch(root);
    for (const block of Array.from(root.querySelectorAll('div.md-code-block')))
        syncLangSwitch(block);
}
Object.assign(exports,{LANG_SWITCH_CLASS,MDR_RM_CLASS,MDR_RM_BTN_CLASS,MDR_SWITCH_EVENT,MDR_RENDER_OPTIONS,mdrDispatchLangSwitch,MdrLangSwitchFrom,MdrLangSwitch,langSwitchValue,syncLangSwitch,removeLangSwitch,applyLangForce,scanLangSwitches});

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
    // 无语言围栏的语言推断：项目主语言按需请求一次（有缓存；成功后会触发重扫补胶囊与高亮）。
    refreshInferredLang(fenceScanContext);
    const el = node;
    applyThinkExpand(el);
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
            teardownInferredLang();
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

    // 样式（宿主语义 token，随 activation 注入）：5 个按职责拆分的 part + 聚合器
    "use strict";
// ── 设计系统底座（token + 通用控件 + 动效纪律）────────────────────────────
// 口径：本文件只提供「设计 token / 通用控件 / 动效 / 焦点环 / 滚动条」，
// markdown 内容样式在 styles-markdown.ts，两条路只共用这里的类名与变量。
//
// 颜色纪律（静态断言 test/mdr-styles.mjs 钉死）：
//   · 一律取宿主语义变量 --dsw-*，或用 color-mix(in srgb, …) 派生；
//   · **不写裸十六进制**、不用 --shiki-token-*（那是官方高亮的调色板）；
//   · 遮罩取宿主 --dsw-alias-bg-mask-3（深色态 label-primary 是近白，按比例混会得到白雾）。
//
// 几何 / 字号 / 间距 / 动效照原型 docs/原型重构/dsh-md-render.html（8–91、828–1035、1083–1113）。
// 本文件是 client 端的**脚本模式片段**（与 tsconfig.client.json 一致：无 import/export，
// 编译后注入 __ModuleLoader__ factory 作用域），因此用 `const` 而非 `export const`；
// 聚合器 styles.ts 直接按变量名拼接。
const STYLES_BASE = `
/* ══ 设计 token（只在自有根元素上定义：自定义属性不外溢到宿主元素）══ */
.mdr-root,.mdr-md{
/* ── 色彩 26 项（原型 9–38 的语义位 → 宿主语义色 / color-mix 派生）── */
--mdr-bg:var(--dsw-alias-bg-layer-1);
--mdr-bg-elevated:var(--dsw-alias-bg-layer-2);
--mdr-bg-hover:var(--dsw-alias-interactive-bg-hover);
--mdr-surface:var(--dsw-alias-markdown-code-block);
--mdr-surface-raised:var(--dsw-alias-markdown-code-block-banner);
--mdr-border:var(--dsw-alias-border-l2);
--mdr-border-soft:var(--dsw-alias-border-l1);
--mdr-border-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);
--mdr-text:var(--dsw-alias-label-primary);
--mdr-text-2:var(--dsw-alias-label-secondary);
--mdr-text-3:var(--dsw-alias-label-tertiary);
--mdr-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-accent-hover:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 78%,var(--dsw-alias-label-primary));
--mdr-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 14%,transparent);
--mdr-on-accent:var(--dsw-alias-label-primary-foreground);
--mdr-success:var(--dsw-alias-state-success-primary);
--mdr-success-soft:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);
--mdr-warn:var(--dsw-alias-state-warn-label);
--mdr-warn-soft:color-mix(in srgb,var(--dsw-alias-state-warn-label) 14%,transparent);
--mdr-danger:var(--dsw-alias-state-error-primary);
--mdr-danger-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);
--mdr-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-toast-bg:var(--dsw-alias-markdown-code-block-banner);
--mdr-overlay:var(--dsw-alias-bg-mask-3);
--mdr-shadow:var(--dsw-shadow-lv2);
--mdr-focus-ring:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 45%,transparent);
/* ── 几何（原型 76–79）── */
--mdr-radius-sm:4px;
--mdr-radius-md:8px;
--mdr-radius-lg:10px;
--mdr-radius-pill:980px;
/* ── 字号阶梯（原型 80–83）── */
--mdr-fs-xs:12px;
--mdr-fs-sm:14px;
--mdr-fs-base:16px;
--mdr-fs-lg:18px;
/* ── 间距（原型 84–88：4/8/12/16/24，无 space-5）── */
--mdr-space-1:4px;
--mdr-space-2:8px;
--mdr-space-3:12px;
--mdr-space-4:16px;
--mdr-space-6:24px;
/* ── 动效（原型 89–90 + 设计基线 §五 的缓动）── */
--mdr-motion-fast:150ms;
--mdr-motion-base:220ms;
--mdr-ease:cubic-bezier(.28,0,.22,1);
color:var(--mdr-text-2);
font-size:var(--mdr-fs-sm);
line-height:1.6;
}

/* ══ 通用控件（只有本文件定义，其他路只引用类名）══ */

/* 文字按钮：原型 .text-btn（828–877） */
.mdr-btn{
display:inline-flex;
align-items:center;
gap:var(--mdr-space-1);
height:24px;
padding:0 6px;
border:1px solid transparent;
border-radius:6px;
background:transparent;
color:var(--mdr-text-2);
font-size:11.5px;
line-height:1;
white-space:nowrap;
flex:none;
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-btn:hover:not(:disabled){background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-btn:disabled{opacity:.35;cursor:default}
.mdr-btn.is-on{background:var(--mdr-accent-soft);color:var(--mdr-accent)}
.mdr-btn.is-copied{color:var(--mdr-success)}
.mdr-btn>svg{width:12px;height:12px;flex:none}

/* 图标按钮：原型 .icon-btn（828–859）—— 决策 1：24×24，不用旧的 26 */
.mdr-icon-btn{
display:inline-flex;
align-items:center;
justify-content:center;
position:relative;
flex:none;
width:24px;
height:24px;
padding:0;
border:1px solid transparent;
border-radius:6px;
background:transparent;
color:var(--mdr-text-3);
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease),opacity var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-icon-btn:hover:not(:disabled){background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-icon-btn:disabled{opacity:.35;cursor:default}
.mdr-icon-btn.is-on{background:var(--mdr-accent-soft);color:var(--mdr-accent)}
.mdr-icon-btn>svg{width:15px;height:15px;flex:none}

/* 分段控件：原型 .segmented / .seg-btn（1004–1035） */
.mdr-seg{
display:inline-flex;
align-items:center;
gap:2px;
padding:3px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-bg-elevated);
flex:none;
}
.mdr-seg-btn{
display:inline-flex;
align-items:center;
gap:6px;
height:26px;
padding:0 12px;
border:0;
border-radius:6px;
background:transparent;
color:var(--mdr-text-2);
font-size:12px;
line-height:1;
white-space:nowrap;
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-seg-btn:hover{background:var(--mdr-bg-hover);color:var(--mdr-text)}
.mdr-seg-btn.is-active{background:var(--mdr-accent-soft);color:var(--mdr-accent);font-weight:500}

/* 胶囊：原型 .pill（902–932） */
.mdr-pill{
display:inline-flex;
align-items:center;
gap:var(--mdr-space-1);
height:20px;
max-width:100%;
padding:0 7px;
border:1px solid var(--mdr-border-soft);
border-radius:10px;
background:var(--mdr-bg-elevated);
color:var(--mdr-text-2);
font-size:10.5px;
line-height:1;
white-space:nowrap;
flex:none;
}
.mdr-pill-accent{color:var(--mdr-accent);background:var(--mdr-accent-soft);border-color:transparent}
.mdr-pill-success{color:var(--mdr-success);background:var(--mdr-success-soft);border-color:transparent}

/* 开关：原型 .switch（963–1003）—— 44×26，20px 圆钮 translateX(18px) */
.mdr-switch{
position:relative;
flex:none;
width:44px;
height:26px;
padding:0;
border:1px solid var(--mdr-border);
border-radius:10px;
background:var(--mdr-surface-raised);
cursor:pointer;
transition:background var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-switch::after{
content:'';
position:absolute;
top:2px;
left:2px;
width:20px;
height:20px;
border-radius:50%;
background:var(--mdr-text-2);
transition:transform var(--mdr-motion-fast) var(--mdr-ease),background var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-switch[aria-checked='true']{background:var(--mdr-accent);border-color:var(--mdr-accent)}
.mdr-switch[aria-checked='true']::after{transform:translateX(18px);background:var(--mdr-on-accent)}
.mdr-switch:hover{border-color:var(--mdr-accent)}

/* 底部提示：原型 #toast（1050 一带的浮层形态） */
.mdr-toast{
position:fixed;
left:50%;
bottom:var(--mdr-space-6);
z-index:80;
max-width:min(420px,80vw);
padding:6px 12px;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-md);
background:var(--mdr-toast-bg);
color:var(--mdr-text);
font-size:12px;
line-height:1.4;
box-shadow:var(--mdr-shadow);
opacity:0;
pointer-events:none;
transform:translate(-50%,8px);
transition:opacity var(--mdr-motion-base) var(--mdr-ease),transform var(--mdr-motion-base) var(--mdr-ease);
}
.mdr-toast.is-on{opacity:1;transform:translate(-50%,0)}
.mdr-toast.is-warn{color:var(--mdr-warn);border-color:color-mix(in srgb,var(--mdr-warn) 45%,transparent)}

/* 浮层提示：原型 [data-tip]（1083–1113）—— ::after 取 attr，hover / focus 浮现 */
[data-mdr-tip]{position:relative}
[data-mdr-tip]::after{
content:attr(data-mdr-tip);
position:absolute;
left:50%;
bottom:calc(100% + 6px);
z-index:70;
padding:4px 7px;
border:1px solid var(--mdr-border);
border-radius:6px;
background:var(--mdr-surface-raised);
color:var(--mdr-text);
font-size:11px;
line-height:1.4;
white-space:nowrap;
box-shadow:var(--mdr-shadow);
opacity:0;
pointer-events:none;
transform:translate(-50%,4px);
transition:opacity var(--mdr-motion-fast) var(--mdr-ease),transform var(--mdr-motion-fast) var(--mdr-ease);
}
[data-mdr-tip]:hover::after,[data-mdr-tip]:focus-visible::after{opacity:1;transform:translate(-50%,0)}

/* ══ 焦点环（自有强调色光晕；宿主指针模态的全局规则抹不到自有规则）══ */
:is(.mdr-btn,.mdr-icon-btn,.mdr-seg-btn,.mdr-switch):focus-visible{
outline:2px solid var(--mdr-focus-ring);
outline-offset:1px;
}
.mdr-switch:focus-visible{outline:none;box-shadow:0 0 0 3px var(--mdr-accent-soft)}

/* ══ 滚动条（细、低对比：只在自有滚动容器上生效）══ */
.mdr-scroll{scrollbar-width:thin;scrollbar-color:var(--mdr-border) transparent}
.mdr-scroll::-webkit-scrollbar{width:8px;height:8px}
.mdr-scroll::-webkit-scrollbar-track{background:transparent}
.mdr-scroll::-webkit-scrollbar-thumb{background:var(--mdr-border);border-radius:var(--mdr-radius-pill)}
.mdr-scroll::-webkit-scrollbar-thumb:hover{background:var(--mdr-border-strong)}

/* ══ 动效纪律（设计基线 §五）══
   · hover / 微状态 = --mdr-motion-fast(150ms)；进入 UI = --mdr-motion-base(220ms)
   · 只动 transform / opacity；动效不作为状态变化的唯一信号
   · prefers-reduced-motion：全部关掉，不做「缩短式」妥协 */
@media (prefers-reduced-motion:reduce){
:where(.mdr-root,.mdr-md) *,:where(.mdr-root,.mdr-md) *::before,:where(.mdr-root,.mdr-md) *::after{
transition:none!important;
animation:none!important;
}
[data-mdr-tip]::after,.mdr-toast{transition:none!important}
}
`;
Object.assign(exports,{STYLES_BASE});

    "use strict";
// ── markdown 内容渲染样式（自有 vdom 的全部外观）────────────────────────
// 真源：docs/原型重构/dsh-md-render.html 1116–1321（.md-body 一族）+ 设计基线 §二 markdown。
// 口径：
//   · 正文 13px / 1.72，标题阶梯 18 / 16 / 14 / 14 / 13 / 12；
//   · 列表 ::marker 用三级文字色，任务列表是只读复选框（input[disabled][readonly] +
//     :has() 画勾，勾形 150ms），已完成项灰字 + 删除线；
//   · 表格走圆角外框 + 中性表头 + 行 hover；引用 2px 强调左线 + 薄底 + 7px 右圆角，
//     嵌套引用降级为中性细线；
//   · 行内码 4px 圆角 + 发丝边 + 宿主行内码底 + 强调文字色；
//   · 整段复制按钮绝对定位右上角，hover / focus 浮现。
// 颜色只取 styles-base.ts 的 --mdr-* token（或宿主 --dsw-*），本文件**不写裸十六进制**。
// 脚本模式片段（无 import/export），与 styles-base.ts 同作用域拼接。
const STYLES_MARKDOWN = `
/* ══ markdown 正文根 ══ */
.mdr-md{
display:flex;
flex-direction:column;
gap:10px;
min-width:0;
position:relative;
font-size:13px;
line-height:1.72;
color:var(--mdr-text-2);
}

/* ══ 段落 / 标题（原型 1126–1147 + 任务口径 h1–h6 = 18/16/14/14/13/12）══ */
.mdr-md p{margin:0}
.mdr-md h1,.mdr-md h2,.mdr-md h3,.mdr-md h4,.mdr-md h5,.mdr-md h6{
margin:2px 0 0;
color:var(--mdr-text);
font-weight:600;
line-height:1.4;
letter-spacing:.1px;
}
.mdr-md h1{font-size:18px}
.mdr-md h2{font-size:16px}
.mdr-md h3{font-size:14px}
.mdr-md h4{font-size:14px}
.mdr-md h5{font-size:13px}
.mdr-md h6{font-size:12px;color:var(--mdr-text-2)}

/* ══ 强调 / 链接（原型 1162–1173）══ */
.mdr-md strong{color:var(--mdr-text);font-weight:600}
.mdr-md em{font-style:italic}
.mdr-md del{color:var(--mdr-text-3)}
.mdr-md a{
color:var(--mdr-accent);
text-decoration:none;
border-bottom:1px solid color-mix(in srgb,var(--mdr-accent) 35%,transparent);
transition:border-bottom-color var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md a:hover{border-bottom-color:var(--mdr-accent);color:var(--mdr-accent-hover)}

/* ══ 列表（原型 1148–1161）══ */
.mdr-md ul,.mdr-md ol{
margin:0;
padding-left:20px;
display:flex;
flex-direction:column;
gap:3px;
}
.mdr-md li{min-width:0}
.mdr-md li::marker{color:var(--mdr-text-3)}

/* ══ 任务列表（原型 1229–1266；只读复选框 + :has 勾形）══ */
.mdr-md-task-list{list-style:none;padding-left:2px;gap:var(--mdr-space-1)}
.mdr-md-task-item{
display:flex;
align-items:flex-start;
gap:7px;
position:relative;
}
.mdr-md-check{
width:14px;
height:14px;
margin:4px 0 0;
flex:none;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-sm);
background:var(--mdr-surface);
appearance:none;
-webkit-appearance:none;
cursor:default;
transition:background var(--mdr-motion-fast) var(--mdr-ease),border-color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md-task-item::after{
content:'';
position:absolute;
left:5px;
top:8px;
width:3px;
height:7px;
border:solid var(--mdr-on-accent);
border-width:0 1.5px 1.5px 0;
transform:rotate(45deg);
opacity:0;
transition:opacity var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md-task-item:has(>.mdr-md-check:checked)::after{opacity:1}
.mdr-md-task-item:has(>.mdr-md-check:checked)>.mdr-md-check{
background:var(--mdr-accent);
border-color:var(--mdr-accent);
}
.mdr-md-task-item.is-done{color:var(--mdr-text-3)}
.mdr-md-task-item.is-done span,
.mdr-md-task-item.is-done strong{
color:var(--mdr-text-3);
text-decoration:line-through;
text-decoration-color:var(--mdr-border);
}

/* ══ 表格（原型 1196–1228：圆角外框 + 中性表头 + 行 hover）══ */
.mdr-md-table-wrap{
overflow-x:auto;
border:1px solid var(--mdr-border);
border-radius:var(--mdr-radius-md);
background:var(--mdr-surface);
max-width:100%;
}
.mdr-md-table{
width:100%;
border-collapse:collapse;
font-size:12px;
min-width:420px;
}
.mdr-md-table th{
background:var(--mdr-bg-elevated);
color:var(--mdr-text-2);
font-weight:600;
text-align:left;
padding:7px 10px;
border-bottom:1px solid var(--mdr-border);
white-space:nowrap;
}
.mdr-md-table td{
padding:7px 10px;
border-bottom:1px solid var(--mdr-border-soft);
color:var(--mdr-text-2);
vertical-align:top;
}
.mdr-md-table tr:last-child td{border-bottom:0}
.mdr-md-table tbody tr td{transition:background var(--mdr-motion-fast) var(--mdr-ease)}
.mdr-md-table tbody tr:hover td{background:var(--mdr-bg-hover)}

/* ══ 引用（原型 1174–1184：2px 强调左线 + 薄底 + 7px 右圆角）══ */
.mdr-md blockquote{
margin:0;
padding:6px 12px;
border-left:2px solid var(--mdr-accent);
background:var(--mdr-accent-soft);
border-radius:0 7px 7px 0;
color:var(--mdr-text-2);
}
.mdr-md blockquote p{margin:0}
.mdr-md blockquote blockquote{
background:transparent;
border-left-color:var(--mdr-border);
border-radius:0 var(--mdr-radius-sm) var(--mdr-radius-sm) 0;
}

/* ══ 分隔线（原型 1185–1189）══ */
.mdr-md hr{margin:2px 0;border:0;border-top:1px solid var(--mdr-border-soft)}

/* ══ 图片（原型 1190–1195）══ */
.mdr-md img{
max-width:100%;
display:block;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
}
.mdr-md-img{cursor:zoom-in}
.mdr-md-img:focus-visible{outline:2px solid var(--mdr-focus-ring);outline-offset:2px}
.mdr-md-img-alt{color:var(--mdr-text-3);font-style:italic}
.mdr-md-link-plain{color:var(--mdr-text-2);word-break:break-all}

/* ══ 行内码（4px 圆角 + 发丝边 + 宿主行内码底 + 强调文字）══ */
.mdr-md :not(pre)>code{
padding:1px 4px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-sm);
background:var(--mdr-code-bg);
color:var(--mdr-accent);
font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
font-size:12px;
line-height:1.5;
overflow-wrap:anywhere;
}

/* ══ 代码块兜底（围栏块由 MdrCodeBlock 接管；解析层未就绪时落这里）══ */
.mdr-md-pre{
margin:0;
padding:10px 12px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-code-bg);
color:var(--mdr-text-2);
font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
font-size:11.5px;
line-height:1.65;
white-space:pre-wrap;
word-break:break-word;
overflow-x:auto;
}
.mdr-md-pre>code{padding:0;border:0;background:transparent;color:inherit;font-size:inherit}

/* ══ 整段复制按钮（原型 1267–1281：右上角 hover / focus 浮现）══ */
.mdr-md-copy{
position:absolute;
top:-2px;
right:0;
opacity:0;
transition:opacity var(--mdr-motion-fast) var(--mdr-ease),color var(--mdr-motion-fast) var(--mdr-ease);
}
.mdr-md:hover .mdr-md-copy,.mdr-md-copy:focus-visible{opacity:1}
.mdr-md .mdr-md-copy.is-copied{opacity:1;color:var(--mdr-success)}
.mdr-md-copy:focus-visible{outline:2px solid var(--mdr-focus-ring);outline-offset:1px}

/* ══ 解析异常兜底（原文一字不丢）══ */
.mdr-md-plain{
margin:0;
padding:10px 12px;
border:1px solid var(--mdr-border-soft);
border-radius:var(--mdr-radius-md);
background:var(--mdr-code-bg);
color:var(--mdr-text-2);
font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
font-size:11.5px;
line-height:1.65;
white-space:pre-wrap;
word-break:break-word;
}

/* ══ 动效纪律：markdown 内容的过渡在 reduced-motion 下全关 ══ */
@media (prefers-reduced-motion:reduce){
.mdr-md a,.mdr-md img,.mdr-md .mdr-md-copy,.mdr-md .mdr-md-check,
.mdr-md .mdr-md-task-item::after,.mdr-md-table tbody tr td{transition:none}
}
`;
Object.assign(exports,{STYLES_MARKDOWN});

    "use strict";
// ── 样式：代码围栏卡 + 交互件（B 路）──────────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html：
//   · 围栏块 1404–1600（卡 10px 圆角 + 1px 发丝边 / 头 32 / 语言胶囊 / 行号列 / code 11.5-1.65）
//   · render-mode 三态 1565–1619（底栏「渲染为…」：图表 / Markdown / 源码）
//   · 查看原文 1282–1322、思考块 1324–1410、上下文注入 1938–1990
// 颜色一律取宿主 --dsw-* 语义变量或 color-mix 派生（**禁裸十六进制**、禁 --shiki-token-*）；
// 几何 / 字号 / 间距 / 动效照原型取值。本文件只定义插件自建 .mdr-* 类名；宿主元素仅在
// 「接管态」（div.md-code-block[data-mdr-view]）下按属性选择器隐藏，不覆盖宿主类名外观。
/** 代码围栏 / 上下文块 / 灯箱 / 渲染方式控件的样式（styles.ts 聚合后注入）。 */
const STYLES_CODE = `
/* ══ 帧 token（局部定义：只在插件自建节点上生效，不外溢到官方元素）══ */
.mdr-fence,.mdr-block,.mdr-ctx,.mdr-lightbox,.mdr-lang-switch{
--mdr-frame-bg:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer));
--mdr-frame-layer:var(--dsw-alias-bg-layer,var(--dsw-alias-markdown-code-block));
--mdr-frame-line:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));
--mdr-frame-hair:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));
--mdr-frame-ink:var(--dsw-alias-label-primary);
--mdr-frame-ink-2:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));
--mdr-frame-ink-3:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));
--mdr-frame-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link,var(--dsw-alias-label-primary)));
--mdr-frame-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 14%,transparent);
--mdr-frame-ok:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary));
--mdr-frame-bad:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary));
--mdr-frame-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
--mdr-frame-fast:150ms;
--mdr-frame-ease:cubic-bezier(0.28,0,0.22,1);
/* 语法色：五色语义映射全部由宿主状态色向正文色混合得到（与官方 shiki 调色板无关） */
--mdr-frame-hl-key:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 88%,var(--dsw-alias-label-primary));
--mdr-frame-hl-str:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary));
--mdr-frame-hl-num:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))) 70%,var(--dsw-alias-label-primary));
--mdr-frame-hl-com:color-mix(in srgb,var(--dsw-alias-label-tertiary) 78%,var(--dsw-alias-label-primary));
--mdr-frame-hl-fn:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 50%,var(--dsw-alias-label-primary));
--mdr-frame-hl-tag:var(--dsw-alias-state-success-primary);
--mdr-frame-hl-prop:var(--dsw-alias-label-primary);
}

/* ══ 围栏卡（原型 .fence：10px 圆角 + 1px 发丝边 + 代码底）══ */
.mdr-fence{display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-frame-line);border-radius:10px;overflow:hidden;background:var(--mdr-frame-bg);font-family:var(--mdr-frame-mono)}
.mdr-fence-head{display:flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 9px;background:color-mix(in srgb,var(--mdr-frame-layer) 70%,var(--mdr-frame-bg));border-bottom:1px solid var(--mdr-frame-hair);min-width:0}
/* 语言胶囊：10px / 600 / 大写 / 字距 .06em（原型 .lang-pill 1432–1447） */
.mdr-fence-pill{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:4px;background:var(--mdr-frame-accent-soft);color:var(--mdr-frame-accent);font-family:var(--mdr-frame-mono);font-size:10px;font-weight:600;line-height:1;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;flex:none}
/* 推断语言（内容识别 / 项目主语言兜底）：虚线边 + 透明底，「原文标注」与「推断」一眼可分；
   几何按 border-box 收进既有 19px 高，不改变头高与胶囊占位 */
.mdr-fence-pill.is-inferred{border:1px dashed color-mix(in srgb,var(--mdr-frame-accent) 52%,var(--mdr-frame-hair));background:transparent;box-sizing:border-box}
/* 推断胶囊的浮层朝下：卡是 overflow:hidden，朝上会被 32px 头裁掉；仍是同一套 [data-mdr-tip] 伪元素 */
.mdr-fence-pill.is-inferred[data-mdr-tip]::after{bottom:auto;top:calc(100% + 6px)}
.mdr-fence-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mdr-frame-ink-3)}
.mdr-fence-actions{display:flex;align-items:center;gap:1px;margin-left:auto;flex:none}
.mdr-fence-action{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--mdr-frame-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-fence-action:hover{background:color-mix(in srgb,var(--mdr-frame-ink) 8%,transparent);color:var(--mdr-frame-ink)}
.mdr-fence-action.is-on{color:var(--mdr-frame-accent);background:var(--mdr-frame-accent-soft)}
.mdr-fence-action:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}
.mdr-fence-copy{height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--mdr-frame-ink-3);font-size:11px;cursor:pointer;opacity:0;transition:opacity var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-fence:hover .mdr-fence-copy,.mdr-fence:focus-within .mdr-fence-copy,.mdr-fence-copy:focus-visible{opacity:1}
.mdr-copy.is-copied{opacity:1;color:var(--mdr-frame-ok)}
.mdr-copy.is-failed{opacity:1;color:var(--mdr-frame-bad)}
@media (hover:none){.mdr-fence-copy{opacity:1}}

/* ══ 代码主体：行号列 + pre（原型 .fence-body 1478–1524）══ */
.mdr-fence-body{display:flex;min-width:0;overflow-x:auto}
.mdr-line-nums{display:none;flex:none;padding:10px 4px 10px 10px;text-align:right;white-space:pre;color:var(--mdr-frame-ink-3);font-family:var(--mdr-frame-mono);font-size:11.5px;line-height:1.65;letter-spacing:0.02em;user-select:none;background:var(--mdr-frame-bg);border-right:1px solid var(--mdr-frame-hair)}
.mdr-fence[data-mdr-lines="on"] .mdr-line-nums{display:block}
.mdr-fence-code{margin:0;padding:10px 12px;min-width:0;font-family:var(--mdr-frame-mono);font-size:11.5px;line-height:1.65;color:var(--mdr-frame-ink-2);white-space:pre;tab-size:2}
.mdr-fence[data-mdr-wrap="on"] .mdr-fence-code{white-space:pre-wrap;word-break:break-word}
.mdr-fence[data-mdr-wrap="on"] .mdr-fence-body{overflow-x:hidden}
.mdr-fence-code .hl-key{color:var(--mdr-frame-hl-key)}
.mdr-fence-code .hl-str{color:var(--mdr-frame-hl-str)}
.mdr-fence-code .hl-num{color:var(--mdr-frame-hl-num)}
.mdr-fence-code .hl-com{color:var(--mdr-frame-hl-com);font-style:italic}
.mdr-fence-code .hl-fn{color:var(--mdr-frame-hl-fn)}
.mdr-fence-code .hl-tag{color:var(--mdr-frame-hl-tag)}
.mdr-fence-code .hl-prop{color:var(--mdr-frame-hl-prop)}

/* ══ 底栏 + 「渲染为…」三态（原型 .fence-foot / .render-mode 1526–1619）══ */
.mdr-fence-foot{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 9px 6px;border-top:1px solid var(--mdr-frame-hair);background:var(--mdr-frame-bg);font-size:10px;color:var(--mdr-frame-ink-3)}
.mdr-fence-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdr-rm{display:inline-flex;align-items:center;gap:1px;margin-left:auto;padding:2px;border:1px solid var(--mdr-frame-line);border-radius:6px;background:var(--mdr-frame-layer);flex:none}
.mdr-rm-btn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--mdr-frame-ink-3);font-size:10.5px;white-space:nowrap;cursor:pointer;transition:background var(--mdr-frame-fast) var(--mdr-frame-ease),color var(--mdr-frame-fast) var(--mdr-frame-ease)}
.mdr-rm-btn:hover{background:color-mix(in srgb,var(--mdr-frame-ink) 7%,transparent);color:var(--mdr-frame-ink)}
.mdr-rm-btn.is-active{background:var(--mdr-frame-bg);color:var(--mdr-frame-ink);font-weight:500}
.mdr-rm-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}
.mdr-lang-switch{display:flex;justify-content:flex-end}

/* ══ 上下文注入块（原型 .ctx-block 1938–1987）══ */
.mdr-ctx{display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px 11px;border:1px dashed color-mix(in srgb,var(--mdr-frame-accent) 42%,var(--mdr-frame-line));border-radius:10px;background:color-mix(in srgb,var(--mdr-frame-accent) 4%,var(--dsw-alias-bg-layer))}
.mdr-ctx-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;font-size:10.5px;color:var(--mdr-frame-accent)}
.mdr-ctx-title{font-size:11px;font-weight:600}
.mdr-ctx-from{color:var(--mdr-frame-ink-3)}
.mdr-ctx-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;background:var(--mdr-frame-accent-soft);color:var(--mdr-frame-accent);font-size:10.5px;font-weight:500;line-height:1;white-space:nowrap;flex:none}
.mdr-ctx-body{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:11.5px;line-height:1.65;color:var(--mdr-frame-ink-2)}

/* ══ 图片灯箱（原生 dialog：遮罩 / Esc / 焦点归还由浏览器兜底）══ */
.mdr-lightbox{position:fixed;inset:0;display:grid;place-items:center;width:100vw;max-width:100vw;height:100vh;max-height:100vh;margin:0;padding:24px;border:0;background:transparent;overflow:visible}
.mdr-lightbox::backdrop{background:var(--dsw-alias-bg-mask-3,color-mix(in srgb,var(--mdr-frame-ink) 45%,transparent))}
.mdr-lightbox[open]{display:grid}
.mdr-lightbox-wrap{position:relative;display:inline-flex;max-width:88vw;max-height:82vh}
.mdr-lightbox-img{display:block;max-width:88vw;max-height:82vh;border-radius:10px;background:var(--mdr-frame-bg);box-shadow:0 18px 48px color-mix(in srgb,var(--mdr-frame-ink) 28%,transparent)}
.mdr-lightbox-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;padding:0;border:1px solid var(--mdr-frame-line);border-radius:50%;background:var(--mdr-frame-layer);color:var(--mdr-frame-ink-2);font-size:16px;line-height:1;cursor:pointer}
.mdr-lightbox-close:hover{color:var(--mdr-frame-ink);background:color-mix(in srgb,var(--mdr-frame-ink) 10%,var(--mdr-frame-layer))}
.mdr-lightbox-close:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-frame-accent) 35%,transparent)}

/* ══ 接管态：显示自建块、隐藏宿主原内容（不改宿主类名与节点）══ */
div.md-code-block[data-mdr-view] > :not(.mdr-block){display:none !important}
.mdr-block{display:block;min-width:0}
/* markdown 卡：与围栏卡同一帧，正文走 A 路的 .mdr-md */
.mdr-block-md{display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-frame-line);border-radius:10px;overflow:hidden;background:var(--mdr-frame-bg)}
.mdr-block-md .mdr-block-body{padding:10px 12px;min-width:0}

/* ══ 复制兜底 textarea（不写 el.style：位置/隐藏全走类名）══ */
.mdr-copy-sink{position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none}

/* ══ 动效降级（原型 prefers-reduced-motion 全关）══ */
@media (prefers-reduced-motion:reduce){.mdr-fence *,.mdr-ctx *,.mdr-lightbox *,.mdr-lang-switch *{transition-duration:0ms !important;animation-duration:0ms !important}}
`;
Object.assign(exports,{STYLES_CODE});

    "use strict";
// ── mermaid 卡片样式（STYLES_MERMAID）───────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html（.mm-card 段 1617–1937 / 全屏
// dialog 1850–1937）。几何 / 字号 / 间距逐条照原型；颜色**只取宿主语义变量**
// 或 color-mix 派生（禁裸十六进制、禁 --shiki-token-*），深浅主题自动跟随。
//
// 作用域纪律：本文件只写**自有类名**（.mdr-mm-*）与**自有 data-* 标记**；
// 通用控件（.mdr-icon-btn / .mdr-seg / .mdr-pill / .mdr-switch / [data-mdr-tip]）
// 由 styles-base.ts 定义，这里只在必要处锁行内尺寸，不重复定义外观。
// 状态切换一律走属性选择器（[data-mdr-mm-view] / [aria-pressed] / [aria-checked]
// / [hidden]），JS 侧不写 classList / cssText / el.style。
//
// 官方的围栏 <pre> 隐藏：块上的标记由 mermaid-scan 写（宿主块级标记是既有契约），
// 这里同时接受新口径 data-mdr-mm-block-view（集成窗口切换后自动生效）。
const STYLES_MERMAID = `
/* ══ 卡片作用域 token（自定义属性不外溢到宿主元素）══ */
.mdr-mm-card,.mdr-mm-dialog{
--mdr-mm-line:var(--dsw-alias-border-l2);
--mdr-mm-line-soft:var(--dsw-alias-border-l1);
--mdr-mm-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));
--mdr-mm-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);
--mdr-mm-surface:var(--dsw-alias-markdown-code-block);
--mdr-mm-elevated:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,var(--dsw-alias-markdown-code-block));
--mdr-mm-code-bg:var(--dsw-alias-markdown-inline-code);
--mdr-mm-hover:var(--dsw-alias-interactive-bg-hover);
--mdr-mm-text:var(--dsw-alias-label-primary);
--mdr-mm-text-2:var(--dsw-alias-label-secondary);
--mdr-mm-text-3:var(--dsw-alias-label-tertiary);
--mdr-mm-danger:color-mix(in srgb,var(--dsw-alias-state-error-primary) 72%,var(--dsw-alias-label-primary));
--mdr-mm-danger-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);
--mdr-mm-scrim:var(--dsw-alias-bg-mask-3);
--mdr-mm-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
--mdr-mm-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);
--mdr-mm-motion:150ms;--mdr-mm-motion-in:220ms;--mdr-mm-ease:cubic-bezier(0.28,0,0.22,1);
}

/* ══ 卡片外壳 ══ */
.mdr-mm-card{position:relative;display:flex;flex-direction:column;min-width:0;border:1px solid var(--mdr-mm-line);border-radius:10px;background:var(--mdr-mm-surface);color:var(--mdr-mm-text);overflow:hidden;animation:mdr-mm-in var(--mdr-mm-motion-in) var(--mdr-mm-ease)}
@keyframes mdr-mm-in{from{opacity:0;transform:translateY(1px)}to{opacity:1;transform:none}}

/* ══ 卡片头：标题胶囊 / 类型 / 工具条（7 8 7 10 + 发丝下边）══ */
.mdr-mm-head{display:flex;align-items:center;gap:7px;padding:7px 8px 7px 10px;border-bottom:1px solid var(--mdr-mm-line-soft);min-width:0;flex-wrap:nowrap}
.mdr-mm-title{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:6px;background:var(--mdr-mm-accent-soft);color:var(--mdr-mm-accent);font-size:11px;font-weight:600;line-height:22px;white-space:nowrap;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis}
.mdr-mm-kind{font-size:10px;color:var(--mdr-mm-text-3);white-space:nowrap;flex:none;overflow:hidden;text-overflow:ellipsis;max-width:104px}
.mdr-mm-toolbar{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}
/* 工具条按钮 24×24（原型 .icon-btn；外观在 styles-base，这里只锁卡片头尺寸） */
.mdr-mm-toolbar .mdr-icon-btn{width:24px;height:24px}
/* 视图分段：带文字「预览 / 代码」（原型 .segmented 紧凑档） */
.mdr-mm-toolbar .mdr-seg{padding:2px;border-radius:7px}
.mdr-mm-toolbar .mdr-seg-btn{height:20px;padding:0 8px;font-size:11px;border-radius:5px;gap:4px}

/* ══ 缩放分段：− 100% + 收在一个 24 高胶囊里 ══ */
.mdr-mm-zoom{display:inline-flex;align-items:center;gap:0;height:24px;border:1px solid var(--mdr-mm-line);border-radius:6px;overflow:hidden;background:var(--mdr-mm-elevated);flex:none}
.mdr-mm-zoom .mdr-icon-btn{width:22px;height:22px;border-radius:0}
.mdr-mm-zoom-val{min-width:42px;text-align:center;font-size:10.5px;color:var(--mdr-mm-text-2);font-variant-numeric:tabular-nums;padding:0 2px;border-left:1px solid var(--mdr-mm-line-soft);border-right:1px solid var(--mdr-mm-line-soft);line-height:22px;flex:none}

/* ══ 更多菜单：低频操作（导出 / 缩放模式 / 复制）══ */
.mdr-mm-menu{position:absolute;top:34px;right:8px;z-index:40;width:196px;padding:5px;background:var(--mdr-mm-elevated);border:1px solid var(--mdr-mm-line);border-radius:10px;box-shadow:var(--mdr-mm-shadow);display:flex;flex-direction:column;gap:1px}
.mdr-mm-menu[hidden]{display:none}
.mdr-mm-menu-item{display:flex;align-items:center;gap:8px;height:29px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--mdr-mm-text-2);font-size:11.5px;line-height:1;text-align:left;width:100%;white-space:nowrap;cursor:pointer;transition:background var(--mdr-mm-motion) var(--mdr-mm-ease),color var(--mdr-mm-motion) var(--mdr-mm-ease)}
.mdr-mm-menu-item:hover{background:var(--mdr-mm-hover);color:var(--mdr-mm-text)}
.mdr-mm-menu-item:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--mdr-mm-accent)}
.mdr-mm-menu-item[disabled]{opacity:0.4;cursor:default}
.mdr-mm-menu-item svg{flex:none;color:var(--mdr-mm-text-3)}
.mdr-mm-check{margin-left:auto;display:inline-flex;color:var(--mdr-mm-accent);flex:none}
.mdr-mm-menu-item[aria-checked="true"]{color:var(--mdr-mm-text)}
.mdr-mm-menu-sep{height:1px;background:var(--mdr-mm-line-soft);margin:4px 2px}
.mdr-mm-menu-label{font-size:10px;color:var(--mdr-mm-text-3);padding:5px 8px 2px;letter-spacing:0.04em}

/* ══ 卡片体：点阵底 + 14 内边距 + 最小高 190 ══ */
.mdr-mm-body{padding:14px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 1px 1px,var(--mdr-mm-line-soft) 1px,transparent 0) 0 0/16px 16px;min-height:190px;overflow:auto;position:relative}
.mdr-mm-canvas{display:flex;align-items:center;justify-content:center;width:100%}
.mdr-mm-canvas svg{max-width:100%;height:auto;color:var(--mdr-mm-text-2)}
/* 降级引擎（panzoom 不可用）用 SVG 宽高属性缩放，取消 max-width 封顶 */
.mdr-mm-body[data-mdr-mm-engine="attribute"] .mdr-mm-canvas svg{max-width:none}
.mdr-mm-md-fallback{padding:14px;min-height:190px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre-wrap;overflow-wrap:anywhere}
.mdr-mm-error-src{margin:0;padding:10px 12px;border:1px solid var(--mdr-mm-line-soft);border-radius:6px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--mdr-mm-surface)}
.mdr-mm-code{margin:0;padding:14px;font-family:var(--mdr-mm-mono);font-size:11.5px;line-height:1.7;color:var(--mdr-mm-text-2);white-space:pre;overflow:auto;background:var(--mdr-mm-code-bg);min-height:190px;tab-size:2}
.mdr-mm-md{padding:14px;min-height:190px}

/* 三态视图：图表 / Markdown / 源码（属性驱动，不切 class） */
.mdr-mm-card[data-mdr-mm-view="source"] .mdr-mm-body,
.mdr-mm-card[data-mdr-mm-view="source"] .mdr-mm-md,
.mdr-mm-card[data-mdr-mm-view="markdown"] .mdr-mm-body,
.mdr-mm-card[data-mdr-mm-view="markdown"] .mdr-mm-code,
.mdr-mm-card[data-mdr-mm-view="diagram"] .mdr-mm-code,
.mdr-mm-card[data-mdr-mm-view="diagram"] .mdr-mm-md{display:none}

/* ══ 底栏：常显「渲染为… 图表 / Markdown / 源码」══ */
.mdr-mm-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--mdr-mm-line-soft);font-size:10px;color:var(--mdr-mm-text-3);min-width:0;flex-wrap:wrap}
.mdr-mm-foot-label{flex:none}
.mdr-mm-modes{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--mdr-mm-line-soft);border-radius:6px;background:var(--mdr-mm-elevated)}
.mdr-mm-mode{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:0;border-radius:4px;background:transparent;color:var(--mdr-mm-text-2);font-size:10.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background var(--mdr-mm-motion) var(--mdr-mm-ease),color var(--mdr-mm-motion) var(--mdr-mm-ease)}
.mdr-mm-mode:hover{background:var(--mdr-mm-hover);color:var(--mdr-mm-text)}
.mdr-mm-mode[aria-pressed="true"]{background:var(--mdr-mm-accent-soft);color:var(--mdr-mm-accent)}
.mdr-mm-mode:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--mdr-mm-accent)}
.mdr-mm-spacer{margin-left:auto}
.mdr-mm-meta{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ══ 加载 / 失败态（失败态以源码为主视觉，原因降为一行）══ */
.mdr-mm-loading{display:flex;align-items:center;gap:8px;padding:14px;font-size:11.5px;color:var(--mdr-mm-text-3);min-height:190px}
.mdr-mm-loading svg{flex:none;animation:mdr-mm-spin 0.9s linear infinite}
@keyframes mdr-mm-spin{to{transform:rotate(360deg)}}
.mdr-mm-error{padding:14px;display:flex;flex-direction:column;gap:8px;min-height:190px;background:var(--mdr-mm-code-bg)}
.mdr-mm-error-msg{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--mdr-mm-danger) 32%,transparent);border-radius:6px;background:var(--mdr-mm-danger-soft);font-size:11px;line-height:1.5;color:var(--mdr-mm-danger);overflow-wrap:anywhere}
.mdr-mm-error-msg svg{flex:none}
.mdr-mm-retry{margin-left:auto;flex:none}
.mdr-mm-notice{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--mdr-mm-line-soft);font-size:11px;line-height:1.5}
.mdr-mm-notice[data-mdr-mm-notice="ok"]{color:var(--dsw-alias-state-success-primary)}
.mdr-mm-notice[data-mdr-mm-notice="error"]{color:var(--mdr-mm-danger)}
.mdr-mm-notice svg{flex:none}

/* ══ 全屏浮窗：原生 <dialog>（90vw × 85vh + 遮罩）══ */
.mdr-mm-dialog{width:90vw;height:85vh;max-width:none;max-height:none;margin:auto;border:1px solid var(--mdr-mm-line);border-radius:10px;background:var(--mdr-mm-elevated);color:var(--mdr-mm-text);padding:0;overflow:hidden;box-shadow:var(--mdr-mm-shadow)}
.mdr-mm-dialog::backdrop{background:var(--mdr-mm-scrim);backdrop-filter:blur(2px)}
.mdr-mm-dialog[open]{display:flex;flex-direction:column;animation:mdr-mm-in var(--mdr-mm-motion-in) var(--mdr-mm-ease)}
.mdr-mm-dialog-head{height:48px;flex:none;display:flex;align-items:center;gap:9px;padding:0 12px;border-bottom:1px solid var(--mdr-mm-line-soft);min-width:0}
.mdr-mm-dialog-path{font-size:10.5px;color:var(--mdr-mm-text-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdr-mm-dialog-actions{margin-left:auto;display:flex;align-items:center;gap:5px;flex:none}
.mdr-mm-dialog-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:24px;background:radial-gradient(circle at 1px 1px,var(--mdr-mm-line-soft) 1px,transparent 0) 0 0/18px 18px}
.mdr-mm-dialog-body .mdr-mm-canvas svg{max-width:100%;max-height:100%;width:auto;height:auto}
.mdr-mm-dialog-body[data-mdr-mm-engine="attribute"] .mdr-mm-canvas svg{max-width:none;max-height:none}
.mdr-mm-dialog-foot{height:40px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;border-top:1px solid var(--mdr-mm-line-soft);font-size:10.5px;color:var(--mdr-mm-text-3);flex-wrap:nowrap;min-width:0}
.mdr-mm-dialog-foot .mdr-mm-meta{overflow:hidden;text-overflow:ellipsis}

/* 官方围栏 <pre> 的隐藏（自有块级标记驱动；新口径标记一并接受）*/
.md-code-block[data-dsh-md-render-mermaid-view] pre,
.md-code-block[data-mdr-mm-block-view] pre{display:none}

/* 进动效 / 降级引擎的离屏渲染容器（量得到布局、看不见）*/
.mdr-mm-offscreen{position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none}

@media (prefers-reduced-motion:reduce){
.mdr-mm-card,.mdr-mm-dialog[open],.mdr-mm-loading svg{animation:none}
.mdr-mm-menu-item,.mdr-mm-mode{transition:none}
}
`;

    "use strict";
// ── 设置页样式（STYLES_SETTINGS）────────────────────────────────────────
// 视觉真源 = docs/原型重构/dsh-md-render.html（设置弹层 3843–4064 + CSS
// 2070–2356 的 **插件内容区**）。插件头部 / 双 tab / 分组头（图标 + 计数徽标）/
// 开关行 / 说明块 / 底部保存与恢复默认，几何字号逐条照原型。
//
// 口径：
//  · 颜色只取宿主 --dsw-* 语义变量或 color-mix 派生（禁裸十六进制）；
//  · 通用控件 .mdr-switch / .mdr-pill / .mdr-seg / .mdr-icon-btn 由 styles-base 定义，
//    这里只锁「设置行内」的排布；开关 44×26 是契约值（styles-base 同值），行内再声明
//    一次是为了防止宿主页面把通用控件挤变形；
//  · 状态全走属性 / [hidden] / aria，不在 JS 里碰 classList / cssText / el.style。
const STYLES_SETTINGS = `
/* ══ 根容器（宿主设置页里的插件内容区）══ */
.mdr-set{--mdr-set-line:var(--dsw-alias-border-l2);--mdr-set-line-soft:var(--dsw-alias-border-l1);--mdr-set-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));--mdr-set-accent-soft:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)) 12%,transparent);--mdr-set-surface:var(--dsw-alias-bg-layer-1);--mdr-set-elevated:var(--dsw-alias-bg-layer-2);--mdr-set-hover:var(--dsw-alias-interactive-bg-hover);--mdr-set-text:var(--dsw-alias-label-primary);--mdr-set-text-2:var(--dsw-alias-label-secondary);--mdr-set-text-3:var(--dsw-alias-label-tertiary);--mdr-set-danger:color-mix(in srgb,var(--dsw-alias-state-error-primary) 72%,var(--dsw-alias-label-primary));--mdr-set-motion:150ms;--mdr-set-ease:cubic-bezier(0.28,0,0.22,1);display:flex;flex-direction:column;min-height:0;color:var(--mdr-set-text)}
.mdr-set [hidden]{display:none}

/* ══ 插件头部：图标块 + 标题（包名徽标）+ 简介 + 状态徽标 ══ */
.mdr-set-head{display:flex;align-items:flex-start;gap:10px;padding:14px 20px 12px;border-bottom:1px solid var(--mdr-set-line-soft);flex:none}
.mdr-set-icon{width:34px;height:34px;border-radius:8px;background:var(--mdr-set-accent-soft);color:var(--mdr-set-accent);display:flex;align-items:center;justify-content:center;flex:none}
.mdr-set-info{flex:1;min-width:0}
.mdr-set-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:15px;font-weight:600;line-height:1.4}
.mdr-set-sub{margin:2px 0 0;font-size:11.5px;color:var(--mdr-set-text-3);line-height:1.5}
.mdr-set-meta{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}

/* ══ 双 tab：渲染 / 关于（分段胶囊 + 右侧提示）══ */
.mdr-set-tabs{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--mdr-set-line-soft);flex:none;min-width:0}
.mdr-set-tabs .mdr-seg{padding:3px;border-radius:8px}
.mdr-set-tabs .mdr-seg-btn{height:26px;padding:0 12px;font-size:12px}
.mdr-set-tab-hint{margin-left:auto;font-size:11px;color:var(--mdr-set-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ══ 面板（可滚动）══ */
.mdr-set-panel{flex:1;min-height:0;overflow-y:auto;padding:14px 20px 18px}
.mdr-set-panel[hidden]{display:none}

/* ══ 分组：边框卡片 + 分组头（图标 + 标题 + 计数徽标）══ */
.mdr-set-group{border:1px solid var(--mdr-set-line);border-radius:10px;background:var(--mdr-set-surface);margin-bottom:12px;overflow:hidden}
.mdr-set-group-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--mdr-set-line-soft);background:var(--mdr-set-elevated);min-width:0;flex-wrap:wrap}
.mdr-set-group-head svg{flex:none;color:var(--mdr-set-accent)}
.mdr-set-group-head h3{margin:0;font-size:13px;font-weight:600;white-space:nowrap;line-height:1.4}
.mdr-set-group-head .mdr-pill{margin-left:auto}

/* ══ 开关行：标题 + 说明 + 右侧开关 ══ */
.mdr-set-row{display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-bottom:1px solid var(--mdr-set-line-soft);min-width:0}
.mdr-set-row:last-child{border-bottom:0}
.mdr-set-row-text{flex:1;min-width:0}
.mdr-set-row-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:var(--mdr-set-text);line-height:1.5;flex-wrap:wrap}
.mdr-set-row-desc{margin:2px 0 0;font-size:11px;color:var(--mdr-set-text-3);line-height:1.55;overflow-wrap:anywhere}
.mdr-set-row-desc code{font-size:10.5px}
.mdr-set-ctrl{display:flex;align-items:center;gap:6px;flex:none;padding-top:1px}
/* 开关行内锁定 44×26（契约值，与 styles-base 的 .mdr-switch 同值）*/
.mdr-set-row .mdr-switch{width:44px;height:26px;flex:none}

/* ══ 说明块（注入能力说明等）══ */
.mdr-set-note{margin:0 14px 10px;padding:8px 10px;border:1px solid var(--mdr-set-line-soft);border-radius:8px;background:var(--mdr-set-elevated);font-size:10.5px;color:var(--mdr-set-text-3);line-height:1.6}
.mdr-set-note strong{color:var(--mdr-set-text-2);font-weight:500}
.mdr-set-note code{font-size:10px}

/* ══ 底部操作：保存 / 恢复默认 / 已保存 / 说明 ══ */
.mdr-set-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 2px 8px}
.mdr-set-save{height:32px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:8px;background:var(--mdr-set-accent);color:var(--dsw-alias-label-primary-foreground);font-size:12px;font-weight:500;cursor:pointer;transition:background var(--mdr-set-motion) var(--mdr-set-ease)}
.mdr-set-save:hover{background:color-mix(in srgb,var(--mdr-set-accent) 86%,var(--dsw-alias-label-primary-foreground))}
.mdr-set-save:disabled{opacity:0.4;cursor:default}
.mdr-set-reset{height:32px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--mdr-set-line);border-radius:8px;background:transparent;color:var(--mdr-set-text);font-size:12px;cursor:pointer;transition:background var(--mdr-set-motion) var(--mdr-set-ease)}
.mdr-set-reset:hover{background:var(--mdr-set-hover)}
.mdr-set-save:focus-visible,.mdr-set-reset:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--mdr-set-accent) 35%,transparent)}
.mdr-set-saved{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--dsw-alias-state-success-primary)}
.mdr-set-foot-hint{font-size:10.5px;color:var(--mdr-set-text-3);line-height:1.6;margin-left:auto;text-align:right}

/* ══ 加载 / 失败态 ══ */
.mdr-set-status{display:flex;align-items:center;gap:8px;padding:14px;font-size:12px;color:var(--mdr-set-text-3)}
.mdr-set-error{padding:10px 14px;border:1px solid color-mix(in srgb,var(--mdr-set-danger) 32%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);font-size:11.5px;color:var(--mdr-set-danger);line-height:1.6;margin-bottom:12px}
.mdr-set-error svg{margin-right:6px;vertical-align:-2px}

@media (prefers-reduced-motion:reduce){
.mdr-set-save,.mdr-set-reset{transition:none}
}
`;

    "use strict";
// ── 样式聚合器（**唯一**对外导出的样式表，随 activation 注入）──────────────
// 口径（最高优先级）：「全部使用我们自己的，外观也是」——视觉语言全部由本插件定义，
// 宿主样式只作为**颜色与主题来源**被读取（--dsw-* / --dsh-* 语义变量随深浅色自动切换，
// 绝不硬编码十六进制）。视觉真源 = docs/md渲染/原型（docs/原型重构/dsh-md-render.html）。
//
// 架构（v2，三路拆分后）：样式按「谁用谁写」拆成 5 个 part，本文件只做**有序聚合**——
//   ① styles-base.ts      设计 token / 通用控件（.mdr-btn / .mdr-seg / .mdr-switch / .mdr-toast…）/ 动效纪律
//   ② styles-markdown.ts  markdown 内容（.mdr-root .mdr-md 下的排版 / 表格 / 任务列表）
//   ③ styles-code.ts      围栏块（卡片头 / 行号 / 语言胶囊 / 三态底栏）+ 设置页之外的交互件
//   ④ styles-mermaid.ts   mermaid 卡片 / 全屏 dialog / 缩放工具条
//   ⑤ styles-settings.ts  设置页（双 tab / 分组头 / 开关行 / 保存与恢复默认）
// 顺序即级联顺序：base 在前提供 token 与通用控件，其余按功能区叠加。改样式只改对应 part，
// 本文件保持「只有一行拼接」——静态断言（test/mdr-*.mjs）钉住各 part 的导出与几何。
//
// 硬约束（test/static-assertions.mjs 钉死）：只写自有 DOM 与自有 data-* 作用域；不用 el.style；
// 颜色只用宿主语义变量或 color-mix 派生（禁裸十六进制、禁 --shiki-token-*）。
const STYLES = STYLES_BASE + STYLES_MARKDOWN + STYLES_CODE + STYLES_MERMAID + STYLES_SETTINGS;

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
// ── 设置页文案（i18n）──────────────────────────────────────────────────
// 语言来源两级（都是浏览器全局）：宿主 locale（宿主把当前 UI 语言同步到 <html lang>）
// 优先，其次 navigator.language。文案全部是**惰性函数**：宿主切语言后重渲染即取到新语言，
// 写成常量就跟不上。
// 样式不在这里：新口径由 parts/styles-settings.ts 的 STYLES_SETTINGS 单一负责。
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
    if (host.indexOf('zh') === 0)
        return true;
    if (host.indexOf('en') === 0)
        return false;
    return mdRenderBrowserLang().indexOf('zh') === 0;
}
/** 中英二选一（惰性求值）。 */
function mdRenderText(zh, en) {
    return () => (mdRenderIsZh() ? zh : en);
}
/** 设置页文案表（全部惰性）。 */
const MD_RENDER_STRINGS = {
    tab: mdRenderText('渲染', 'Rendering'),
    packageName: 'dsh-md-render',
    headTitle: mdRenderText('渲染', 'Rendering'),
    headSub: mdRenderText('接管对话内围栏块：代码高亮、mermaid 图表卡片、思考块默认展开、整段复制。', 'Takes over fenced blocks in conversations: syntax highlighting, mermaid diagram cards, expanded thinking and whole-message copy.'),
    enabled: mdRenderText('已启用', 'Enabled'),
    tabRender: mdRenderText('渲染', 'Rendering'),
    tabAbout: mdRenderText('关于', 'About'),
    tabHint: mdRenderText('修改即时生效 · 已打开的消息重新挂载后生效', 'Changes apply immediately · already-open messages pick them up on remount'),
    groupMarkdown: mdRenderText('Markdown', 'Markdown'),
    groupThinking: mdRenderText('思考块', 'Thinking'),
    groupMermaid: mdRenderText('Mermaid 图表', 'Mermaid diagrams'),
    count4: mdRenderText('4 项', '4 items'),
    count3: mdRenderText('3 项', '3 items'),
    count2: mdRenderText('2 项', '2 items'),
    count1: mdRenderText('1 项', '1 item'),
    injected: mdRenderText('宿主注入', 'Host-injected'),
    copyTitle: mdRenderText('复制按钮', 'Copy button'),
    copyDesc: mdRenderText('代码块右上角显示复制按钮，默认隐藏、悬停浮现；键盘聚焦时同样可见。', 'A copy button on the top-right of code blocks; hidden until hover or keyboard focus.'),
    fenceTitle: mdRenderText('围栏块渲染总开关', 'Render fenced blocks'),
    fenceDesc: mdRenderText('关闭后所有围栏块保持宿主官方形态，仅保留 markdown 正文渲染。', 'When off, every fenced block keeps the host look; only markdown body rendering stays on.'),
    inferTitle: mdRenderText('推断无标记围栏的语言', 'Infer languages for untagged fences'),
    inferDesc: mdRenderText('没有语言标记的围栏块按内容识别语言，认不出再用当前项目主语言（构建标记文件），仅用于高亮与胶囊展示并标注「推断」。', 'Untagged fences get a language inferred from their content, then from the project main language; used only for highlighting and the language pill, marked as inferred.'),
    contextTitle: mdRenderText('上下文注入块', 'Context-injection blocks'),
    contextDesc: mdRenderText('子代理回传的消息按 markdown 渲染，并标注「上下文注入」来源。', 'Sub-agent messages are rendered as markdown and labelled as context injection.'),
    thinkTitle: mdRenderText('默认展开', 'Expand by default'),
    thinkDesc: mdRenderText('思考块加载后默认展开，可手动折叠；关闭后默认收起，只显示标题与耗时。', 'Thinking blocks start expanded and can be collapsed; when off they start collapsed with only the title and timing.'),
    mermaidTitle: mdRenderText('渲染为图表卡片', 'Render as diagram cards'),
    mermaidDesc: mdRenderText('mermaid 围栏块渲染为卡片：预览 / 代码切换、缩放、全屏、导出 PNG 与 SVG。', 'mermaid fences become cards: preview / code toggle, zoom, fullscreen, PNG and SVG export.'),
    injectTitle: mdRenderText('注入 mermaid 能力说明', 'Inject the mermaid capability note'),
    injectDesc: mdRenderText('默认开启；关闭后已有代码块照常渲染，只是不再主动引导模型画图。', 'On by default; when off, existing blocks still render — the model is just no longer nudged.'),
    noteMermaid: mdRenderText('图表由宿主注入的 mermaid 运行时渲染，插件只负责围栏块接管与卡片外壳；宿主未提供运行时时自动回退到源码视图，不阻塞对话。', 'Diagrams are rendered by the host-provided mermaid runtime; the plugin only owns fence takeover and the card shell, and falls back to the source view when the runtime is missing.'),
    noteMermaidStrong: mdRenderText('注入能力说明：', 'Injection note:'),
    save: mdRenderText('保存', 'Save'),
    reset: mdRenderText('恢复默认', 'Restore defaults'),
    saved: mdRenderText('已保存', 'Saved'),
    saveFailed: mdRenderText('保存失败', 'Save failed'),
    footHint: mdRenderText('配置保存在插件设置中，随工作区同步', 'Saved in plugin settings and synced with the workspace'),
    loading: mdRenderText('加载中…', 'Loading…'),
    loadFailed: mdRenderText('配置加载失败', 'Failed to load config'),
    retry: mdRenderText('重试', 'Retry'),
    errorMissingRoute: mdRenderText('服务端插件未加载：/md-render/api 路由不存在（确认已安装并启用 dsh-md-render 后重启 DSH，HTTP 404）', 'Host half not loaded: the /md-render/api route is missing (install and enable dsh-md-render, then restart DSH — HTTP 404)'),
    errorForbidden: mdRenderText('请求被安全围栏拒绝（403）：请检查网络/代理设置', 'Blocked by the trust fence (403): check your network/proxy settings'),
    errorNetwork: mdRenderText('网络错误或响应异常：请检查 DSH 服务是否正常运行', 'Network error or bad response: check that the DSH server is running'),
    groupAbout: mdRenderText('关于 dsh-md-render', 'About dsh-md-render'),
    versionTitle: mdRenderText('版本', 'Version'),
    versionDesc: mdRenderText('随已安装的 npm 包发布，版本号以 package.json 为准。', 'Shipped with the installed npm package; the version lives in package.json.'),
    slotsTitle: mdRenderText('扩展点', 'Extension points'),
    slotsDesc: mdRenderText('ctx.slots 设置页签 · 围栏块接管 · 不注册节点级 seat、不使用右侧栏页签。', 'ctx.slots settings tab · fence takeover · no node-level seats and no right-sidebar tabs.'),
    depsTitle: mdRenderText('依赖', 'Dependencies'),
    depsDesc: mdRenderText('marked / highlight.js / panzoom 走 assets 懒加载；mermaid 由宿主运行时提供，均不打包。', 'marked / highlight.js / panzoom load lazily from assets; mermaid comes from the host runtime — none are bundled.'),
    docsTitle: mdRenderText('文档', 'Docs'),
    docsDesc: mdRenderText('docs/md渲染/概述.md · docs/原型重构/brief-md-render.md', 'docs/md渲染/概述.md · docs/原型重构/brief-md-render.md'),
    viewDocs: mdRenderText('查看文档', 'Open docs'),
};

    "use strict";
/** 开关项构造器（压掉三组表格的重复字段）。 */
function mdRenderItem(section, key, label, hint) {
    return { section: section, key: key, label: label, hint: hint };
}
/** 三组开关（顺序即渲染顺序；覆盖 host 半 schema 的全部布尔键）。 */
const MD_RENDER_SWITCH_GROUPS = [
    {
        icon: 'markdown',
        title: MD_RENDER_STRINGS.groupMarkdown,
        count: MD_RENDER_STRINGS.count4,
        pill: 'success',
        items: [
            mdRenderItem('markdown', 'copyButton', MD_RENDER_STRINGS.copyTitle, MD_RENDER_STRINGS.copyDesc),
            mdRenderItem('markdown', 'textFenceMarkdown', MD_RENDER_STRINGS.fenceTitle, MD_RENDER_STRINGS.fenceDesc),
            mdRenderItem('markdown', 'contextMarkdown', MD_RENDER_STRINGS.contextTitle, MD_RENDER_STRINGS.contextDesc),
            mdRenderItem('markdown', 'inferLang', MD_RENDER_STRINGS.inferTitle, MD_RENDER_STRINGS.inferDesc),
        ],
        note: null,
    },
    {
        icon: 'pencil',
        title: MD_RENDER_STRINGS.groupThinking,
        count: MD_RENDER_STRINGS.count1,
        pill: 'success',
        items: [mdRenderItem('thinking', 'defaultExpanded', MD_RENDER_STRINGS.thinkTitle, MD_RENDER_STRINGS.thinkDesc)],
        note: null,
    },
    {
        icon: 'chart',
        title: MD_RENDER_STRINGS.groupMermaid,
        count: MD_RENDER_STRINGS.injected,
        pill: 'accent',
        items: [
            mdRenderItem('mermaid', 'render', MD_RENDER_STRINGS.mermaidTitle, MD_RENDER_STRINGS.mermaidDesc),
            mdRenderItem('mermaid', 'injectPrompt', MD_RENDER_STRINGS.injectTitle, MD_RENDER_STRINGS.injectDesc),
        ],
        note: MD_RENDER_STRINGS.noteMermaid,
    },
];
/** 取开关当前值：缺失 / 非布尔 → 默认开（与 host 半 schema 同口径）。纯函数。 */
function mdrSwitchOn(draft, section, key) {
    if (draft === null || draft === undefined)
        return true;
    const sec = draft[section];
    if (sec === null || sec === undefined)
        return true;
    return sec[key] !== false;
}
/** 默认草稿（全部开启）；「恢复默认」与加载失败兜底共用。纯函数。 */
function mdrDefaultDraft() {
    return {
        markdown: { copyButton: true, textFenceMarkdown: true, contextMarkdown: true, inferLang: true },
        thinking: { defaultExpanded: true },
        mermaid: { injectPrompt: true, render: true },
    };
}
function mdrSetIcon(name, size) {
    return icon[name](size);
}
/** 插件头部：图标 + 标题（含包名徽标）+ 简介 + 状态徽标。 */
function MdrSetHead() {
    return createElement('div', { className: 'mdr-set-head' }, createElement('div', { className: 'mdr-set-icon' }, mdrSetIcon('markdown', 18)), createElement('div', { className: 'mdr-set-info' }, createElement('div', { className: 'mdr-set-title' }, createElement('span', null, MD_RENDER_STRINGS.headTitle()), createElement('span', { className: 'mdr-pill mdr-pill-accent' }, MD_RENDER_STRINGS.packageName)), createElement('p', { className: 'mdr-set-sub' }, MD_RENDER_STRINGS.headSub())), createElement('div', { className: 'mdr-set-meta' }, createElement('span', { className: 'mdr-pill mdr-pill-success' }, MD_RENDER_STRINGS.enabled())));
}
/** 双 tab 头（渲染 / 关于）+ 右侧提示。 */
function MdrSetTabs(props) {
    const tab = (value, label) => createElement('button', {
        type: 'button',
        role: 'tab',
        className: 'mdr-seg-btn' + (props.tab === value ? ' is-active' : ''),
        'data-mdr-set-tab': value,
        'aria-selected': props.tab === value,
        onClick: () => props.onTab(value),
    }, label());
    return createElement('div', { className: 'mdr-set-tabs' }, createElement('div', { className: 'mdr-seg', role: 'tablist', 'aria-label': '渲染插件页签' }, tab('render', MD_RENDER_STRINGS.tabRender), tab('about', MD_RENDER_STRINGS.tabAbout)), createElement('span', { className: 'mdr-set-tab-hint' }, MD_RENDER_STRINGS.tabHint()));
}
/** 开关行（标题 + 说明 + 右侧 44×26 开关）。 */
function MdrSetSwitchRow(props) {
    return createElement('div', { className: 'mdr-set-row' }, createElement('div', { className: 'mdr-set-row-text' }, createElement('div', { className: 'mdr-set-row-title' }, props.item.label()), createElement('p', { className: 'mdr-set-row-desc' }, props.item.hint())), createElement('div', { className: 'mdr-set-ctrl' }, createElement('button', {
        type: 'button',
        className: 'mdr-switch',
        role: 'switch',
        'aria-checked': props.on,
        'aria-label': props.item.label(),
        onClick: () => props.onChange(!props.on),
    })));
}
/** 一个分组：分组头（图标 + 标题 + 计数徽标）+ 开关行 + 可选说明块。 */
function MdrSetGroup(props) {
    return createElement('div', { className: 'mdr-set-group' }, createElement('div', { className: 'mdr-set-group-head' }, mdrSetIcon(props.group.icon, 15), createElement('h3', null, props.group.title()), createElement('span', { className: 'mdr-pill mdr-pill-' + props.group.pill }, props.group.count())), ...props.group.items.map((item) => createElement(MdrSetSwitchRow, {
        key: item.section + '.' + item.key,
        item: item,
        on: mdrSwitchOn(props.draft, item.section, item.key),
        onChange: (value) => props.onPatch(item, value),
    })), props.group.note === null
        ? null
        : createElement('p', { className: 'mdr-set-note' }, createElement('strong', null, MD_RENDER_STRINGS.noteMermaidStrong()), createElement('span', null, props.group.note())));
}
/** 底部操作：保存 / 恢复默认 / 已保存 / 失败 / 说明。 */
function MdrSetActions(props) {
    return createElement('div', { className: 'mdr-set-actions' }, createElement('button', { type: 'button', className: 'mdr-set-save', onClick: props.onSave }, mdrSetIcon('check', 13), createElement('span', null, MD_RENDER_STRINGS.save())), createElement('button', { type: 'button', className: 'mdr-set-reset', onClick: props.onReset }, MD_RENDER_STRINGS.reset()), props.saved
        ? createElement('span', { className: 'mdr-set-saved' }, mdrSetIcon('check', 12), createElement('span', null, MD_RENDER_STRINGS.saved()))
        : null, props.failed ? createElement('span', { className: 'mdr-set-error' }, MD_RENDER_STRINGS.saveFailed()) : null, createElement('span', { className: 'mdr-set-foot-hint' }, MD_RENDER_STRINGS.footHint()));
}
/** 关于面板：版本 / 扩展点 / 依赖 / 文档。 */
function MdrSetAbout() {
    const row = (title, desc) => createElement('div', { className: 'mdr-set-row' }, createElement('div', { className: 'mdr-set-row-text' }, createElement('div', { className: 'mdr-set-row-title' }, title()), createElement('p', { className: 'mdr-set-row-desc' }, desc)));
    return createElement('div', { className: 'mdr-set-panel', role: 'tabpanel', 'aria-label': '关于' }, createElement('div', { className: 'mdr-set-group' }, createElement('div', { className: 'mdr-set-group-head' }, mdrSetIcon('help', 15), createElement('h3', null, MD_RENDER_STRINGS.groupAbout())), row(MD_RENDER_STRINGS.versionTitle, MD_RENDER_STRINGS.versionDesc()), row(MD_RENDER_STRINGS.slotsTitle, MD_RENDER_STRINGS.slotsDesc()), row(MD_RENDER_STRINGS.depsTitle, MD_RENDER_STRINGS.depsDesc()), row(MD_RENDER_STRINGS.docsTitle, MD_RENDER_STRINGS.docsDesc())));
}
/** 渲染面板：三组开关 + 底部操作（tab 切换只控制显隐）。 */
function MdrRenderPanel(props) {
    return createElement('div', { className: 'mdr-set-panel', role: 'tabpanel', 'aria-label': '渲染设置', hidden: props.hidden }, ...MD_RENDER_SWITCH_GROUPS.map((group, index) => createElement(MdrSetGroup, { key: 'group-' + index, group: group, draft: props.draft, onPatch: props.onPatch })), createElement(MdrSetActions, {
        saved: props.saved,
        failed: props.failed,
        onSave: props.onSave,
        onReset: props.onReset,
    }));
}
/** 配置加载失败视图：按失败原因给针对性提示 + 重试。 */
function MdrSetLoadError(props) {
    const hint = props.kind === 'http:404'
        ? MD_RENDER_STRINGS.errorMissingRoute()
        : props.kind === 'http:403'
            ? MD_RENDER_STRINGS.errorForbidden()
            : MD_RENDER_STRINGS.errorNetwork();
    return createElement('div', { className: 'mdr-set mdr-root' }, createElement('div', { className: 'mdr-set-error' }, mdrSetIcon('alert', 13), MD_RENDER_STRINGS.loadFailed()), createElement('div', { className: 'mdr-set-status' }, hint), createElement('div', { className: 'mdr-set-actions' }, createElement('button', { type: 'button', className: 'mdr-set-reset', onClick: props.onRetry }, MD_RENDER_STRINGS.retry())));
}
/** 设置状态（加载 → 草稿 → 保存 / 恢复默认）；拆出主组件压函数长度。 */
function useMdRenderSettings() {
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorKind, setErrorKind] = useState('');
    const [saved, setSaved] = useState(false);
    const load = () => {
        setLoading(true);
        setErrorKind('');
        mdRenderLoadConfig((value) => {
            setDraft(value);
            setLoading(false);
        }, (kind) => {
            setDraft(null);
            setLoading(false);
            setErrorKind(kind);
        });
    };
    useEffect(() => {
        load();
    }, []);
    const save = (next) => {
        setSaved(false);
        setErrorKind('');
        mdRenderSaveConfig(next, () => setSaved(true), (kind) => setErrorKind(kind));
    };
    const patch = (item, value) => {
        const current = draft ?? mdrDefaultDraft();
        setSaved(false);
        setDraft({ ...current, [item.section]: { ...(current[item.section] ?? {}), [item.key]: value } });
    };
    const reset = () => {
        const defaults = mdrDefaultDraft();
        setDraft(defaults);
        save(defaults);
    };
    return {
        draft: draft,
        loading: loading,
        errorKind: errorKind,
        saved: saved,
        load: load,
        save: save,
        patch: patch,
        reset: reset,
    };
}
/** 设置页主视图（渲染 / 关于 双 tab）。 */
function MdrSettingsView() {
    const [tab, setTab] = useState('render');
    const state = useMdRenderSettings();
    if (state.loading) {
        return createElement('div', { className: 'mdr-set mdr-root' }, createElement('div', { className: 'mdr-set-status' }, MD_RENDER_STRINGS.loading()));
    }
    if (state.draft === null)
        return createElement(MdrSetLoadError, { kind: state.errorKind, onRetry: state.load });
    return createElement('div', { className: 'mdr-set mdr-root' }, createElement(MdrSetHead), createElement(MdrSetTabs, { tab: tab, onTab: (next) => setTab(next) }), createElement(MdrRenderPanel, {
        hidden: tab !== 'render',
        draft: state.draft,
        saved: state.saved,
        failed: state.errorKind === 'save',
        onPatch: state.patch,
        onSave: () => state.save(state.draft ?? mdrDefaultDraft()),
        onReset: state.reset,
    }), tab === 'about' ? createElement(MdrSetAbout) : null);
}
Object.assign(exports,{mdrSwitchOn,mdrDefaultDraft,MD_RENDER_SWITCH_GROUPS,MdrSettingsView});

    "use strict";
// ── 设置页注册（官方 slots 扩展点）───────────────────────────────────────
// 两处注册，写入的是**加法型** seat：
//  1. settings.plugins.tab（list）：id / order / 惰性 label —— DSH < 0.1.7 与
//     「设置 → 内置插件」分区仍走它；
//  2. plugins.bundle.config（keyed）：key = 组合包 npm 包名（= package.json name），
//     只在 view: 'page' 时渲染，供 >= 0.1.7 的插件管理器在组合包详情页复用同一视图。
// 两处共用 MdrSettingsView（渲染 / 关于 双 tab）。
//
// 片段编译模式：本文件与其余 client 片段一样是 **script 模式**（无 import/export）。
// 重名靠命名消除（不能靠模块隔离）；设置页样式由 parts/styles-settings.ts 提供，
// 经 parts/styles.ts 聚合进主样式表（本文件不再单独注入，避免同一份 CSS 进两次）。
/** 页签 id：必须全局唯一 —— 复用宿主已发出的 id 会**替换**对方页签（静默故障）。 */
const MD_RENDER_SETTINGS_TAB_ID = 'md-render-settings';
/** 页签顺序（合并前三插件分别为 90 / 92 / 95，合一后取最前者）。 */
const MD_RENDER_SETTINGS_TAB_ORDER = 90;
/** DSH >= 0.1.7 插件管理器的组合包详情页配置 slot（keyed）。 */
const MD_RENDER_BUNDLE_CONFIG_SLOT = 'plugins.bundle.config';
/** keyed slot 的 key：必须是本组合包的 npm 包名（宿主按包名派发），与 package.json 一致。 */
const MD_RENDER_PACKAGE_NAME = 'dsh-md-render';
/**
 * 组合包详情页配置视图：summary 返回 null（列表页不占位），page / 缺省复用设置页视图。
 */
function mdRenderBundleConfigView(props) {
    if (props !== undefined && props !== null && props.view === 'summary')
        return null;
    return MdrSettingsView();
}
/** 拉取当前生效配置（GET）；失败交 onError（kind 供提示区分）。 */
function mdRenderLoadConfig(onValue, onError) {
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
/** 保存配置（PUT）：发全量草稿（host 半按段合并）；成功后立即应用并点亮「已保存」。 */
function mdRenderSaveConfig(draft, onSaved, onError) {
    fetch(CONFIG_API_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
    })
        .then((res) => res.json())
        .then((body) => {
        if (body === null || body.ok !== true)
            throw new Error('save failed');
        setRenderOptions(draft);
        onSaved();
    })
        .catch(() => onError('save'));
}
/**
 * 注册设置页签。三处刻意的写法：
 *  · 设置页样式随主样式表注入（parts/styles.ts 聚合 STYLES_SETTINGS），这里**不再**重复注入；
 *  · `ctx.get('slots', false)`：必须传 strict=false —— 服务提供者 fiber 尚未 active
 *    （首屏）时 strict 取法返回 undefined，页签会消失到下次 HMR；
 *  · 服务缺失（精简上下文 / 老宿主）时静默跳过：设置页是增强，不能拖垮整个 client。
 */
function attachSettingsTab(ctx) {
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
        }, MdrSettingsView));
        // 字面量（不用常量）：静态断言从**产物**里抽取 inject('…') 的字面量做白名单校验。
        slots.inject('plugins.bundle.config', () => slots.register({
            name: MD_RENDER_BUNDLE_CONFIG_SLOT,
            key: MD_RENDER_PACKAGE_NAME,
        }, mdRenderBundleConfigView));
        return undefined;
    }, 'dsh-md-render: settings tab registration');
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
