/**
 * dsh-my-memory — agent 记忆写入时的**条目压缩**（issue #518 后续）。
 *
 * 为什么只在 agent 记忆上做：这套记忆由模型自己维护、写入即整份覆盖，条目
 * 平均 63.7 字且越写越长；目录只有 100 行 / 8 KB 的硬预算，213 条里 113 条
 * 进不了目录。压缩后的条目能让目录多装一倍，而全局 / 项目记忆条目少、注入
 * 侧已经做过摘要，不需要再压。
 *
 * 本模块只做纯逻辑（选行 / 拼回 / 校验），LLM 调用由调用方注入：
 *  - 失败、超时、输出不合格式 → 返回 null，调用方按原文写入（绝不阻塞）；
 *  - 压缩结果必须与原条目**数量一致、顺序一致、每条更短且非空**，否则整体放弃。
 */
/** 默认压缩阈值：短于这个长度的条目不压（压了也省不了多少）。 */
export const DEFAULT_COMPRESS_MIN_CHARS = 60;
/**
 * 选出可压缩的条目：`- ` 开头且正文长度 > minChars。
 * 标题、空行、规则文字一律不动。
 */
export function pickCompressibleLines(lines, minChars = DEFAULT_COMPRESS_MIN_CHARS) {
    const out = [];
    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed.startsWith('- '))
            continue;
        const text = trimmed.slice(2).trim();
        if (text.length > minChars)
            out.push({ index, text });
    }
    return out;
}
/**
 * 把压缩结果原位拼回。
 *
 * @returns 拼好的行数组；数量/格式/变短任一不满足时返回 null（调用方按原文写）。
 */
export function applyCompressedLines(lines, candidates, compressed) {
    if (compressed.length !== candidates.length)
        return null;
    const next = lines.slice();
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const value = normalizeCompressed(compressed[i]);
        if (value === null)
            return null;
        // 只接受「更短」：等长或更长的结果说明模型在扩写，退回原文更安全。
        if (value.length >= candidate.text.length)
            return null;
        next[candidate.index] = '- ' + value;
    }
    return next;
}
/** 规范化模型输出的一行：去编号 / 列表符号 / 引号，必须非空。 */
function normalizeCompressed(raw) {
    let value = String(raw ?? '').trim();
    if (value === '')
        return null;
    value = value.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
    value = value.replace(/^["'「『]/, '').replace(/["'」』]$/, '').trim();
    return value === '' ? null : value;
}
/**
 * 写入前的压缩门面：切行 → 选长条目 → 交给注入的压缩器 → 原位拼回。
 * 任何一步失败都返回原文（记忆写入永不因压缩失败而阻塞）。
 */
export async function compressContentForWrite(content, call, minChars = DEFAULT_COMPRESS_MIN_CHARS) {
    if (call === undefined)
        return content;
    const lines = content.split('\n');
    const candidates = pickCompressibleLines(lines, minChars);
    if (candidates.length === 0)
        return content;
    let compressed = null;
    try {
        compressed = await call(candidates.map((candidate) => candidate.text));
    }
    catch {
        return content;
    }
    if (compressed === null)
        return content;
    const next = applyCompressedLines(lines, candidates, compressed);
    return next === null ? content : next.join('\n');
}
/** 解析模型的整段输出为条目数组（只保留非空行，去掉可能的围栏）。 */
export function parseCompressedBlock(text) {
    const body = String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/^\s*```[a-z]*\s*$/gim, '')
        .trim();
    if (body === '')
        return [];
    return body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}
