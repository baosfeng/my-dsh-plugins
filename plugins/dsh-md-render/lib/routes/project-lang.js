/**
 * dsh-md-render — `/md-render/api/project-lang` 项目主语言探测（host half）。
 *
 * 用途：模型输出的围栏块**经常没有语言标记**（真实会话实测：208 个围栏里 200 个无标记），
 * 内容识别（client 半 fence-lang-infer.ts）认不出时，用「这个项目主体是什么语言」兜底 ——
 * 等价于人类看一眼仓库根就知道「这是个 Kotlin 项目」。语言名只用于**高亮 + 胶囊展示**，
 * 并带「推断」标识（不冒充围栏原文标注）。
 *
 *   GET /md-render/api/project-lang?cwd=<绝对路径>
 *     → { ok: true, value: { lang: "kotlin", evidence: "build.gradle.kts" } }
 *
 * **安全边界（刻意保守，读操作也要能一眼看懂）**：
 *  - 只接受**绝对路径** `cwd`（非空、长度 ≤ {@link MAX_CWD_CHARS}），其余一律返回空结果；
 *  - 只对 {@link PROJECT_MARKERS} 里的**固定文件清单**做 `lstat`（不读内容、不遍历目录、
 *    **不跟随符号链接**），命中即返回；
 *  - 响应只含语言名与「凭哪个标记文件推断」，不含文件内容、不含目录清单；
 *  - 结果按 cwd 有界缓存（TTL {@link CACHE_TTL_MS}、上限 {@link CACHE_MAX}），失败静默降级为空；
 *  - loopback 信任围栏由 routes/config.ts 统一负责（与 `/config`、`/langs` 同一前缀、同一围栏）。
 *
 * 本文件编译为 lib/routes/project-lang.js（产物必须提交，CI 只跑产物、不跑构建）。
 */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { writeJson } from 'dsh-shared';
import { PROJECT_LANG_CWD_PARAM } from './paths.js';
/** cwd 参数长度上限（异常输入护栏）。 */
export const MAX_CWD_CHARS = 512;
/** 结果缓存条数上限（长会话 / 多工作区也不无界）。 */
export const CACHE_MAX = 32;
/** 缓存 TTL：构建标记文件不会频繁变化，10 分钟足够新。 */
export const CACHE_TTL_MS = 10 * 60 * 1000;
/** 构建标记文件 → 语言（**顺序即优先级**：越具体的构建系统越靠前）。 */
export const PROJECT_MARKERS = [
    { file: 'build.gradle.kts', lang: 'kotlin' },
    { file: 'settings.gradle.kts', lang: 'kotlin' },
    { file: 'tsconfig.json', lang: 'typescript' },
    { file: 'go.mod', lang: 'go' },
    { file: 'Cargo.toml', lang: 'rust' },
    { file: 'pubspec.yaml', lang: 'dart' },
    { file: 'Package.swift', lang: 'swift' },
    { file: 'composer.json', lang: 'php' },
    { file: 'Gemfile', lang: 'ruby' },
    { file: 'pom.xml', lang: 'java' },
    { file: 'build.gradle', lang: 'java' },
    { file: 'pyproject.toml', lang: 'python' },
    { file: 'setup.py', lang: 'python' },
    { file: 'requirements.txt', lang: 'python' },
    { file: 'CMakeLists.txt', lang: 'cpp' },
    { file: 'package.json', lang: 'javascript' },
];
/** 缓存：cwd → 结果（插入序 = LRU 近似；有界）。 */
const cache = new Map();
/** 空结果（找不到 / 输入非法 / 任何异常都用它）。 */
function emptyProjectLang() {
    return { lang: '', evidence: '' };
}
/** 读缓存（过期即删）。 */
function readCache(key) {
    const hit = cache.get(key);
    if (hit === undefined)
        return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return undefined;
    }
    return hit.value;
}
/** 写缓存（有界：超上限丢最旧）。 */
function writeCache(key, value) {
    if (cache.has(key))
        cache.delete(key);
    cache.set(key, { value, at: Date.now() });
    while (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next();
        if (oldest.done === true)
            return;
        cache.delete(oldest.value);
    }
}
/** cwd 是否可用（绝对路径 + 非空 + 长度上限；不在这里做存在性判断，交给 lstat）。 */
function usableCwd(cwd) {
    return cwd !== '' && cwd.length <= MAX_CWD_CHARS && isAbsolute(cwd) && !cwd.includes('\u0000');
}
/** 单个标记文件是否存在（lstat：**不跟随符号链接**；任何异常 → false）。 */
async function markerExists(dir, file) {
    try {
        const info = await lstat(join(dir, file));
        return info.isFile();
    }
    catch (_e) {
        return false;
    }
}
/**
 * 探测项目主语言（纯只读：固定清单逐个 lstat，命中即停）。
 * 输入非法 / 目录不存在 / 任何异常 → 空结果；结果进有界缓存。
 */
export async function detectProjectLang(cwd) {
    const dir = String(cwd ?? '').trim();
    if (!usableCwd(dir))
        return emptyProjectLang();
    const cached = readCache(dir);
    if (cached !== undefined)
        return cached;
    const found = await scanMarkers(dir);
    writeCache(dir, found);
    return found;
}
/** 逐个标记文件 stat（顺序 = 优先级；目录不存在时第一个就 false，成本恒定）。 */
async function scanMarkers(dir) {
    for (const marker of PROJECT_MARKERS) {
        if (await markerExists(dir, marker.file))
            return { lang: marker.lang, evidence: marker.file };
    }
    return emptyProjectLang();
}
/** 请求里的 cwd 参数（重复参数取第一个；缺失 → ''）。 */
export function cwdOfRequest(request) {
    try {
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        return String(url.searchParams.get(PROJECT_LANG_CWD_PARAM) ?? '').trim();
    }
    catch (_e) {
        return '';
    }
}
/** 构造 project-lang handler（围栏由调用方 config 路由负责，这里只做探测语义）。 */
export function createProjectLangHandler() {
    return async (request, response) => {
        if (request.method !== 'GET') {
            writeJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'GET only' } });
            return;
        }
        try {
            writeJson(response, 200, { ok: true, value: await detectProjectLang(cwdOfRequest(request)) });
        }
        catch (_e) {
            // 探测失败不报错（client 半静默降级为「语言位留空」）。
            writeJson(response, 200, { ok: true, value: emptyProjectLang() });
        }
    };
}
/** 测试用：清空缓存（生产不调用）。 */
export function clearProjectLangCache() {
    cache.clear();
}
