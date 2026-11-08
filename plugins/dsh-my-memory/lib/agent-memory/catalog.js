/**
 * dsh-my-memory — agent 记忆的**目录缓存与自愈**（issue #502 后续）。
 *
 * 为什么需要它：记忆正文零常驻是对的，但「不读就不知道有什么、读了才知道」
 * 是个死结——按需读取把「想起来去 list」的负担压在模型自觉上，靠不住。
 * 所以目录常驻，内容恒定（前缀缓存友好），写入/删除后重建一次。
 *
 * 本文件只负责「什么时候重建」：启动同步装一次（prime）、本进程写入后 refresh、
 * 窗口外按 ≤1s 节流的磁盘指纹自愈（命令行脚本 / 第二个窗口写的条目也能看见）。
 * 具体的分组与排版在 catalog-render.ts。
 */
import { readFileSync, statSync } from 'node:fs';
import { absoluteFileOf, entryLinesOf, indexFile, listExistingFilesSync } from './paths.js';
import { renderCatalog } from './catalog-render.js';
export { MAX_CATALOG_BYTES, MAX_CATALOG_LINES, catalogPrefix, renderCatalog, truncateEntry } from './catalog-render.js';
function isCatalogFile(name) {
    return name !== 'MEMORY.md';
}
/** 同步读一个文件的条目行；缺失或读失败返回空数组。 */
function entryLinesSync(name) {
    try {
        return entryLinesOf(readFileSync(absoluteFileOf(name), 'utf8'));
    }
    catch {
        return [];
    }
}
/** 目录校验的默认节流阈值（毫秒）：系统提示词每轮求值都调 text()，不能每轮 stat。 */
const DEFAULT_REVALIDATE_MS = 1000;
/** 默认指纹：stat 一遍磁盘上真实存在的记忆文件（不读正文）。 */
function diskStamp() {
    const stamp = {};
    for (const name of listExistingFilesSync()) {
        if (!isCatalogFile(name))
            continue;
        try {
            stamp[name] = statSync(absoluteFileOf(name)).mtimeMs;
        }
        catch {
            // 刚被删除/不可读：跳过——列表本身的变化会让指纹不等
        }
    }
    return stamp;
}
/** 指纹归一化为可比对的字符串（按文件名排序，保证顺序稳定）。 */
function stampKey(stamp) {
    return Object.keys(stamp)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => name + ':' + String(stamp[name]))
        .join('\n');
}
/**
 * 同步读项目名映射（index.json 的 `projects` 字段）。
 *
 * 目录渲染是同步的（section.text()），所以这里只能同步读一次小文件（通常
 * 几百字节）。读失败/缺失一律降级为空表——展示名不值得让目录构建失败。
 */
function projectNamesSync() {
    try {
        const raw = JSON.parse(readFileSync(indexFile(), 'utf8'));
        const projects = raw.projects;
        if (projects !== null && typeof projects === 'object')
            return projects;
    }
    catch {
        // 缺失或损坏：退回 id 前 6 位
    }
    return {};
}
/**
 * 构造目录缓存。
 *
 * @param source - 提供「文件 → 条目行」的函数；由 store 实现（已含 index 加载与归档过滤）。
 * @param options - 节流阈值 / 时钟 / 指纹（默认取生产值；测试注入以免 sleep）。
 */
export function createAgentMemoryCatalog(source, options = {}) {
    const revalidateMs = options.revalidateMs ?? DEFAULT_REVALIDATE_MS;
    const now = options.now ?? Date.now;
    const readStamp = options.stamp ?? diskStamp;
    let cached = '';
    let snapshot = '';
    let checkedAt = Number.NEGATIVE_INFINITY;
    const rebuild = (entries, recency) => {
        cached = renderCatalog(entries.filter((entry) => entry.lines.length > 0), projectNamesSync(), { recency });
    };
    /**
     * 以文件系统为准重建（prime 与自愈共用）：扫描根级白名单 + projects/<id>/。
     * 顺序是「先取指纹、再读正文」：中途有别的进程写入时指纹偏旧，下次校验会
     * 自然重扫一次——宁可多扫一次，不可把新内容永久挡在缓存外。
     */
    const reloadFromDisk = () => {
        const stamp = readStamp();
        snapshot = stampKey(stamp);
        rebuild(listExistingFilesSync()
            .filter(isCatalogFile)
            .map((name) => ({ name, lines: entryLinesSync(name) })), stamp);
        checkedAt = now();
    };
    /** 节流校验：窗口内直接返回；窗口外 stat 一遍，指纹变了才重建。 */
    const revalidate = (at) => {
        if (at - checkedAt < revalidateMs)
            return;
        checkedAt = at;
        if (stampKey(readStamp()) !== snapshot)
            reloadFromDisk();
    };
    return {
        text: () => {
            // 目录求值发生在系统提示词组装里，抛错会拖垮整轮组装（模型连话都说不出）。
            // 任何异常都退回上一份目录——宁可目录略旧，也不能让一轮对话起不来。
            try {
                revalidate(now());
            }
            catch {
                // 自愈失败：保留缓存，下次求值再试
            }
            return cached;
        },
        prime() {
            try {
                reloadFromDisk();
            }
            catch {
                // 启动时读不到磁盘：留空目录，等第一次 refresh 或下次自愈
            }
        },
        async refresh() {
            try {
                // 同 reloadFromDisk：先取指纹再读正文，写入竞态只会导致多扫一次。
                const stamp = readStamp();
                rebuild(await source(), stamp);
                snapshot = stampKey(stamp);
                checkedAt = now();
            }
            catch {
                // 目录重建失败不覆盖旧值：宁可展示上一次的目录，也不要把「读不到」当空库。
            }
        },
    };
}
