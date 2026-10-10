/**
 * dsh-md-render — 围栏语言索引（host half，issue #466）。
 *
 * **为什么需要它**（真实宿主 DOM 的硬限制）：官方 `CodeBlock` 只在 shiki **认识**该语言时
 * 才把语言原名写进 banner —— 语言名来源是宿主 bundle 的 `i8(lang) ? lang : labels.codeLabel`
 * （源码坐标 `packages/client/ui-primitives/src/markdown/CodeBlock.tsx:195`，chat 侧传了
 * `toolbarLabels` 故走 `CodeToolbar` 分支）；shiki 不认识 `text` / `mermaid` 等，于是 banner
 * 显示本地化标签「代码块」。同时**非空**代码块的 `<code>` 不写 `language-xxx` class
 * （官方只在**空**围栏分支写）。实测 14 个块的 DOM：`text` / `mermaid` / 无语言三者逐字段完全
 * 相同 —— **纯 DOM 无法区分**，client 半的 DOM 识别因此 100% 静默失效。
 *
 * **换语言来源**：订阅 `session/event`（`user/message` / `assistant/message`）拿到消息
 * markdown **原文**，解析出每个围栏块的「语言标记 + 块内容」，对内容算 djb2 哈希建
 * `hash → lang` 索引；client 半按块内容哈希查表得到语言（路由见 `routes/langs.ts`）。
 *
 * **只登记本插件接管的语言**（{@link INDEXED_FENCE_LANGS}）：索引不会与 `js` / `python` 等
 * 无关语言撞车；client 查不到时保持官方默认（**绝不误伤「无语言」块**）。
 *
 * **资源预算**（resource-budget-review 五维）：内存 = 上限 × 单条 ≈ 2000 × 120 B ≈ 240 KB；
 * CPU = 每条消息一次线性解析（单条上限 {@link MAX_INDEXED_MARKDOWN_CHARS}）；
 * 磁盘 0（**不落盘**）；网络 0（查询走 host 进程内的既有 HTTP 路由）。
 *
 * 本文件编译为 lib/lang-index.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { boundedMap } from 'dsh-shared';
/** 建索引的围栏语言（小写）：只有这些语言值得让 client 接管。 */
export const INDEXED_FENCE_LANGS = ['text', 'plaintext', 'txt', 'mermaid', 'mmd'];
/** 索引上限（条）：超出按插入序淘汰最旧（fifo，最近的消息留在表里）。 */
export const LANG_INDEX_MAX_SIZE = 2000;
/** 单条 markdown 的解析上限（字符）：超大消息（粘贴的日志等）截断，不拖慢事件处理。 */
export const MAX_INDEXED_MARKDOWN_CHARS = 400000;
/** 开围栏行：0-3 空格缩进 + ≥3 个 ` 或 ~ + info string（可为空）。 */
const OPEN_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** 闭围栏行：0-3 空格缩进 + 与开围栏同字符且不短于其长度的围栏 + 行内只有空白。 */
const CLOSE_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
/** info string 的首个 token（去掉 {.lang} / .lang 花括号与点前缀写法）。 */
const LANG_TOKEN_RE = /^\{?\.?([A-Za-z0-9_+#-]*)\}?$/;
/**
 * djb2 字符串哈希（签名字符串，非加密）。
 * **必须与 client 半 `fenceContentHash` 逐字一致** —— 两侧算法漂移 = 索引 100% 落空，
 * 由 test/lang-index.mjs 的 parity 用例钉住（与 context-markdown.ts 的 contextHash 同算法）。
 */
export function fenceHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1)
        h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
/**
 * 内容规范化（与 client 半 `normalizeFenceContent` **必须逐字一致**）：CRLF / CR → LF + 去掉尾部空白（含换行）。
 * 官方 `CodeBlock` 显示时会去掉**一个**尾部换行（`trimmed`，CodeBlock.tsx:74），markdown
 * 解析器也可能保留 / 去掉围栏末尾的空行 —— 两侧都做「去光尾部空白」即可对齐所有变体。
 */
export function normalizeFenceContent(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+$/, '');
}
/** 开围栏行 → {缩进, 围栏标记, info string}；不是开围栏返回 null。 */
function openFenceOf(line) {
    const m = OPEN_FENCE_RE.exec(line);
    if (m === null)
        return null;
    const [, spaces, marker, info] = m;
    // 反引号围栏的 info string 里不允许再出现反引号（CommonMark），否则不是围栏行。
    if (marker.charAt(0) === '`' && info.includes('`'))
        return null;
    return { indent: spaces.length, marker, info: info.trim() };
}
/** 该行是否是 `open` 的闭围栏。 */
function isClosingFence(line, open) {
    const m = CLOSE_FENCE_RE.exec(line);
    if (m === null)
        return false;
    const marker = m[2];
    return marker.charAt(0) === open.marker.charAt(0) && marker.length >= open.marker.length;
}
/** info string → 语言标记（首 token、小写、去花括号写法）；空串表示无语言。 */
function normalizeLang(info) {
    const token = info.split(/\s+/)[0] ?? '';
    const m = LANG_TOKEN_RE.exec(token);
    return (m === null ? token : m[1]).toLowerCase();
}
/**
 * 扫描 markdown 原文里的围栏块（行级扫描，不引入 markdown 解析依赖）。
 * 未闭合的围栏（流式消息 / 截断）按「内容一直到文末」处理 —— 与官方渲染一致。
 */
export function parseFences(markdown) {
    // 行尾归一（CRLF / CR → LF）：markdown 解析器如此，不归一会让索引与 DOM 文本错配。
    const lines = String(markdown ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const open = openFenceOf(lines[i]);
        if (open === null) {
            i += 1;
            continue;
        }
        const body = [];
        let j = i + 1;
        for (; j < lines.length; j += 1) {
            if (isClosingFence(lines[j], open))
                break;
            body.push(lines[j]);
        }
        out.push({ lang: normalizeLang(open.info), content: body.join('\n'), indent: open.indent });
        i = j + 1;
    }
    return out;
}
/** 按开围栏缩进去掉每行最多 N 个前导空格（CommonMark 缩进围栏的内容语义）。 */
function dedentContent(content, indent) {
    if (indent <= 0)
        return content;
    const pad = new RegExp('^ {0,' + String(indent) + '}');
    return content
        .split('\n')
        .map((line) => line.replace(pad, ''))
        .join('\n');
}
/**
 * 围栏块 → 查询键（内容哈希）。
 *
 * 两个变体：① 原文去尾空白；② 去掉缩进后的内容 —— markdown 解析器会把开围栏的缩进从每行
 * 去掉，DOM 里的 `<code>` 因此是**去缩进版**，只登记 ① 会让缩进围栏匹配不上。
 */
export function fenceHashKeys(fence) {
    const body = normalizeFenceContent(fence.content);
    if (body === '')
        return [];
    const keys = [fenceHash(body)];
    const dedented = fenceHash(normalizeFenceContent(dedentContent(body, fence.indent)));
    if (!keys.includes(dedented))
        keys.push(dedented);
    return keys;
}
/** 超长 markdown 截断（**不**在字符中间切围栏以外的东西：截断即丢弃后半段）。 */
function clipMarkdown(markdown) {
    const text = String(markdown ?? '');
    return text.length > MAX_INDEXED_MARKDOWN_CHARS ? text.slice(0, MAX_INDEXED_MARKDOWN_CHARS) : text;
}
/** 创建语言索引（**有界 + 不落盘**；进程内单例由 src/index.ts 持有）。 */
export function createLangIndex(options = {}) {
    const maxSize = options.maxSize ?? LANG_INDEX_MAX_SIZE;
    const index = boundedMap({ maxSize, policy: 'fifo' });
    let fences = 0;
    return {
        record(markdown) {
            let count = 0;
            for (const fence of parseFences(clipMarkdown(markdown))) {
                if (!INDEXED_FENCE_LANGS.includes(fence.lang))
                    continue;
                for (const key of fenceHashKeys(fence))
                    index.set(key, fence.lang);
                count += 1;
            }
            fences += count;
            return count;
        },
        lookup(hashes) {
            const out = {};
            for (const hash of hashes) {
                const lang = index.get(hash);
                if (lang !== undefined)
                    out[hash] = lang;
            }
            return out;
        },
        stats() {
            return { ...index.stats(), fences };
        },
    };
}
