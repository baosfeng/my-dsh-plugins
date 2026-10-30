/**
 * dsh-my-memory — agent 记忆的正文存储（issue #502）。
 *
 * 正文是纯 markdown，**一个多余字符都没有**：不带 frontmatter、不带日期、
 * 不带 id。时间戳与热度全在 index.json（见 index-store.ts），agent 看不到。
 *
 * 硬门禁（模型绕不过，全部在工具侧强制执行）：
 *  - 文件名白名单（paths.ts 的 normalizeName）→ 路径逃逸结构上不可能；
 *  - 尺寸红线：单文件 4 KB / 60 条 / 单条 100 字符，超限**报错**要求先整理
 *    （照 Claude Code「超限报错而非静默截断」，agent 会立刻看到自己写满了）；
 *  - 敏感信息扫描：命中 API key / token / 密码模式即拒写；
 *  - 原子写（tmp + rename），并发写由 createWriteScheduler 串行化。
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_ENTRIES, MAX_ENTRY_CHARS, MAX_FILE_BYTES, absoluteFileOf, archiveDir, archivedAbsoluteOf, normalizeName, } from './paths.js';
/** 名字非法时的统一原因（四个入口复用，措辞与提示词里的文件分工一致）。 */
const INVALID_NAME = '无效的文件名，可选：MEMORY.md / user.md / feedback.md / projects/<id>/*.md';
/** 敏感信息模式：API key / token / 密码 / 私钥。 */
const SECRET_PATTERNS = Object.freeze([
    /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI / DeepSeek 风格
    /\bgh[pousr]_[A-Za-z0-9]{16,}\b/, // GitHub token
    /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // 私钥
    /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i, // 明文凭据赋值
]);
/** 正文里是否含疑似敏感信息。 */
function containsSecret(text) {
    return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}
/** 统计正文条目数（markdown 列表项或以 `-` 开头的行）。 */
function countEntries(text) {
    return text.split('\n').filter((line) => /^\s*-\s+\S/.test(line)).length;
}
/** 超过单条长度上限的行（用于拒绝写超长条目）。 */
function longestLine(text) {
    return text.split('\n').reduce((max, line) => Math.max(max, line.trim().length), 0);
}
/**
 * 校验正文是否可写。
 *
 * @returns null 表示通过；否则返回给 agent 的可操作错误文本。
 */
function validateContent(text) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_FILE_BYTES) {
        return `已满（${bytes}/${MAX_FILE_BYTES} 字节），先把过时条目合并或删除再写`;
    }
    const entries = countEntries(text);
    if (entries > MAX_ENTRIES) {
        return `已满（${entries}/${MAX_ENTRIES} 条），先把过时条目合并或删除再写`;
    }
    const longest = longestLine(text);
    if (longest > MAX_ENTRY_CHARS) {
        return `有一条 ${longest} 字，超过 ${MAX_ENTRY_CHARS} 字上限；一条只写一件事，精简后再写`;
    }
    if (containsSecret(text))
        return '含密钥或口令，拒绝写入';
    return null;
}
/** 读一个物理路径；缺失返回 null（调用方给出可操作错误）。 */
async function readAt(file) {
    try {
        return await readFile(file, 'utf8');
    }
    catch {
        return null;
    }
}
/** 读一份正文；缺失返回 null（调用方给出可操作错误）。 */
async function readText(name) {
    return readAt(absoluteFileOf(name));
}
/** 原子写一份正文（tmp + rename，不产生半截文件）。 */
async function writeText(name, content) {
    const file = absoluteFileOf(name);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, file);
}
/**
 * 归档冷记忆：把 long-unread 的文件移入 archive/，并从索引可视集合中移除。
 *
 * 只看系统独占的 index.json 元数据（真实读取行为），不猜关键词——所以
 * 阈值是可信的（对比：注入阈值是猜测，issue #502 明确不做）。
 */
async function archiveColdEntries(index, archiveMs, now, logger) {
    const moved = [];
    for (const [name, meta] of Object.entries(index.state().files)) {
        if (meta.archivedAt !== undefined)
            continue;
        // updatedAt 必须计入：复活（重新写入）只刷新 updatedAt，createdAt 仍是
        // 很久以前——只看 createdAt 会让刚复活的记忆在下次启动立刻又被归档。
        const last = Math.max(meta.lastReadAt, meta.createdAt, meta.updatedAt);
        if (now - last < archiveMs)
            continue;
        const from = absoluteFileOf(name);
        try {
            await stat(from);
        }
        catch {
            continue; // 文件已被用户删除，跳过
        }
        const to = join(archiveDir(), ...name.split('/'));
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
        await index.markArchived(name);
        moved.push(name);
    }
    if (moved.length > 0)
        logger?.info?.(`agent-memory: 归档 ${moved.length} 个冷记忆（${moved.join(', ')}）`);
    return moved;
}
/** 读一份正文并记一次取用（readCount 只由 agent 通道产生）。 */
async function readEntry(name, index) {
    const text = await readText(name);
    if (text === null)
        return { ok: false, error: `${name} 不存在` };
    await index.touchRead(name);
    return { ok: true, content: text };
}
/**
 * 删除一份正文与它的元数据（串行化，避免与并发写互相踩）。
 *
 * 活跃正文与归档副本一起清：删掉一份「已归档」的记忆不该报「不存在」，
 * 也不该在 archive/ 里留一份孤儿。
 */
async function removeEntry(name, index, serial) {
    const active = await readText(name);
    const archived = await readAt(archivedAbsoluteOf(name));
    if (active === null && archived === null)
        return { ok: false, error: `${name} 不存在` };
    await serial(async () => {
        await rm(absoluteFileOf(name), { force: true });
        await rm(archivedAbsoluteOf(name), { force: true });
        await index.drop(name);
    });
    return { ok: true };
}
/**
 * 恢复一条已归档记忆：正文从 archive/ 搬回原位 + 清归档标记。
 *
 * 只动归档区与实际正文，不碰 readCount——恢复是对「遗忘」的撤销，不是一次取用。
 */
async function restoreArchived(name, index, serial) {
    await index.load();
    const meta = index.metaOf(name);
    if (meta === undefined || meta.archivedAt === undefined)
        return { ok: false, error: `${name} 未归档` };
    if ((await readAt(archivedAbsoluteOf(name))) === null) {
        return { ok: false, error: `${name} 的归档文件已不存在` };
    }
    await serial(async () => {
        const target = absoluteFileOf(name);
        await mkdir(dirname(target), { recursive: true });
        await rename(archivedAbsoluteOf(name), target);
        await index.markRestored(name);
    });
    return { ok: true };
}
/** 单文件写入的串行互斥（promise 链）：并发写同一文件不会互相覆盖。 */
function createSerial() {
    let chain = Promise.resolve();
    return (task) => {
        const next = chain.then(task, task);
        chain = next.catch(() => { });
        return next;
    };
}
/** 解析 MEMORY.md 的索引行（「文件名 — 何时读」）；没有索引就是空表。 */
async function indexHints() {
    const hints = new Map();
    const text = await readText('MEMORY.md');
    if (text === null)
        return hints;
    for (const line of text.split('\n')) {
        const matched = /^\s*-\s*([^\s—–-]+)\s*[—–-]\s*(.+)$/u.exec(line);
        if (matched !== null)
            hints.set(matched[1], matched[2].trim());
    }
    return hints;
}
/** 列出可读记忆（冷记忆不列出）：文件名 + 概要（索引行优先，其次正文首行）+ 条目数。 */
async function listEntries(index, prefix) {
    // 必须先 load：启动时 index.load() 是异步的，list 可能早于它完成——
    // 那时 state() 是空索引，agent 会把「暂时没加载」误读成「我什么都没写过」。
    await index.load();
    const hints = await indexHints();
    const out = [];
    for (const [name, meta] of Object.entries(index.state().files)) {
        if (meta.archivedAt !== undefined)
            continue; // 冷记忆不列出
        if (prefix !== '' && !name.startsWith(prefix))
            continue;
        const text = await readText(name);
        if (text === null)
            continue;
        // 索引写了的用索引描述（那是 agent 写给自己的「何时读」线索），否则首行。
        const firstLine = hints.get(name) ?? (name === 'MEMORY.md' ? '索引（一行一个文件 + 何时读）' : firstLineOf(text));
        out.push({ name, firstLine, count: countEntries(text) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** 正文首行（列表展示用）。 */
function firstLineOf(text) {
    return (text
        .split('\n')
        .find((line) => line.trim() !== '')
        ?.trim() ?? '');
}
/** agent 记忆正文的读写门面。 */
export function createAgentMemoryStore({ index, logger, }) {
    // 串行化写：并发写同一文件不会互相覆盖（issue #502 验收）。
    const serial = createSerial();
    return {
        async read(rawName) {
            const name = normalizeName(rawName);
            if (name === null)
                return { ok: false, error: INVALID_NAME };
            return readEntry(name, index);
        },
        async write(rawName, rawContent) {
            const name = normalizeName(rawName);
            if (name === null)
                return { ok: false, error: INVALID_NAME };
            if (typeof rawContent !== 'string')
                return { ok: false, error: 'content 必须是字符串' };
            const invalid = validateContent(rawContent);
            if (invalid !== null)
                return { ok: false, error: invalid };
            // 先读后写由 agent 自己负责（提示词引导），这里只保证落盘正确。
            await serial(async () => {
                await writeText(name, rawContent);
                await index.touchWrite(name);
            });
            return { ok: true };
        },
        async remove(rawName) {
            const name = normalizeName(rawName);
            if (name === null)
                return { ok: false, error: INVALID_NAME };
            return removeEntry(name, index, serial);
        },
        async restore(rawName) {
            const name = normalizeName(rawName);
            if (name === null)
                return { ok: false, error: INVALID_NAME };
            return restoreArchived(name, index, serial);
        },
        list: (prefix = '') => listEntries(index, prefix),
        archiveCold: (archiveMs, now) => archiveColdEntries(index, archiveMs, now ?? Date.now(), logger),
        // 面板读取**不计 readCount**：热度只应由 agent 的真实取用产生，
        // 用户翻看一眼不该让死记忆续命（否则遗忘机制被人肉浏览废掉）。
        // 落位优先正文原位，其次归档区——归档不再等于「从面板消失」（issue #502 修复）。
        readForPanel: async (name) => (await readText(name)) ?? (await readAt(archivedAbsoluteOf(name))),
        // 供测试/未来面板预校验复用（knip 通过门面引用，不产生游离导出）。
        validate: (content) => validateContent(content),
    };
}
