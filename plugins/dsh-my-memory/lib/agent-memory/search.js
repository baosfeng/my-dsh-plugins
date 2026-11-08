/**
 * dsh-my-memory — 跨会话记忆的**条目级搜索**（只读）。
 *
 * 渐进式加载的中间层：目录只给 30 字摘要，read 一次要整份（≤ 4 KB）。记忆一多，
 * 「这条在不在、在哪份文件」靠目录猜不准、靠 read 又太贵——搜索让 agent 用关键词
 * 直接定位到「文件 + 行号 + 条目原文」，再只读真正需要的那一份。
 *
 * 纯函数：文件列表与读取器由调用方注入（store 负责归档过滤 / 项目前缀），
 * 因此不需要 mock 文件系统就能单测。
 */
/**
 * 关键词切分：空格分隔、小写、去空词。
 */
function termsOf(query) {
    return String(query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term !== '');
}
/** 一行是否命中全部词（AND，不区分大小写）。 */
function matches(line, terms) {
    const lower = line.toLowerCase();
    return terms.every((term) => lower.includes(term));
}
/**
 * 按关键词搜索条目：**多个词以空格分隔时全部命中才算**（AND，不区分大小写）。
 * 只命中条目行（`- ` 开头），标题与规则文字不参与，避免噪音。
 */
export function searchEntries(files, read, query, limit) {
    const terms = termsOf(query);
    if (terms.length === 0)
        return [];
    const cap = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const hits = [];
    for (const name of files) {
        const text = read(name);
        if (text === null)
            continue;
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const trimmed = lines[index].trim();
            if (!trimmed.startsWith('- ') || !matches(trimmed, terms))
                continue;
            hits.push({ name, line: index + 1, text: trimmed.slice(2) });
            if (hits.length >= cap)
                return hits;
        }
    }
    return hits;
}
