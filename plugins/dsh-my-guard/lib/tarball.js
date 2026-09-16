/**
 * dsh-my-guard — npm registry tarball 获取与摘要校验（#327 从 poison.ts 拆出）。
 *
 * 为什么单独成文件：tsc 尺寸门禁（文件 ≤400 行 / 函数 ≤70 行 / 圈复杂度 ≤10）——把编排与
 * 「取元数据 / 下载 / 校验」各自拆成小函数后，任一函数都不再逼近阈值。
 *
 * 失败必须按**真实原因**返回（网络/超时、HTTP 状态码、元数据缺失或非法、摘要不符、I/O），
 * 而不是一句对用户毫无诊断价值的 `unable to resolve package tarball`——那与 `readText` 把
 * errno 吞成 null 是同一个模式。下载的字节先过 `dist.integrity` 校验（#314）。
 *
 * **字节不落盘**（#105 js/http-to-file-access）：本模块只把校验过的字节交回内存（`body`），
 * 由调用方经 tar 的 stdin 解包——这样「HTTP 响应字节 → 文件系统写 API」这条边在代码里根本
 * 不存在（CodeQL 的 sink 是文件写 API 的 data 参数，不是路径），源头上不再有把远端字节写成
 * 本地文件、以及落盘与解包之间被替换的窗口。
 */
import { createHash } from 'node:crypto';
/** 默认 registry 与请求超时（#327：registry 无响应必须有上限，否则投毒扫描会永久挂住）。 */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 15_000;
/**
 * 校验 tarball 字节与 registry 声明的 `dist.integrity` 是否一致（#314 js/http-to-file-access）。
 *
 * 为什么必须校验再落盘：这段字节会被写进 `os.tmpdir()` 下的文件并交给 tar 解包扫描，
 * 来源是 HTTP（`registry.npmjs.org` 返回的 `dist.tarball` URL）。provenance 的
 * `dist.integrity`（`sha512-<base64>`）是 registry 对这份 tarball 的摘要声明——
 * 摘要不符说明传输被篡改 / 缓存被投毒 / 拿到的是别的版本，此时宁可不扫（返回 false → 报 integrity），
 * 也不能把未校验的远端字节落盘。
 *
 * 非 `sha512-` 形态（未知算法、空值、格式错）一律拒绝：无法校验就不放行。
 */
export function verifyTarballIntegrity(buffer, integrity) {
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-'))
        return false;
    const expected = integrity.slice('sha512-'.length);
    if (expected === '')
        return false;
    return createHash('sha512').update(buffer).digest('base64') === expected;
}
/** fetch 抛错的类别：超时/中止 vs 网络不可达（含 DNS / 连接被拒）vs 其他。 */
export function classifyFetchFailure(error) {
    const name = error?.name;
    if (name === 'TimeoutError' || name === 'AbortError')
        return 'timeout';
    const causeCode = error?.cause?.code;
    if (typeof causeCode === 'string' && causeCode !== '')
        return 'network';
    if (error instanceof TypeError)
        return 'network'; // undici 把网络失败包成 TypeError: fetch failed
    return 'io-error';
}
/**
 * 从 npm registry 获取并下载 tarball 的**字节**（不落盘、不执行包内代码）。
 *
 * 用户看到"解析不了"时必须能分辨：网断了 / 404 了 / 元数据坏了 / 包被篡改。
 */
export async function fetchTarball(pkg, options = {}) {
    const registryBase = options.registryBase ?? DEFAULT_REGISTRY;
    const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    const meta = await loadMeta(`${registryBase}/${encodeURIComponent(pkg)}/latest`, timeoutMs);
    if (!meta.ok)
        return meta;
    const download = await downloadTarball(meta.tarballUrl, timeoutMs);
    if (!download.ok)
        return download;
    if (!verifyTarballIntegrity(download.body, meta.integrity)) {
        return {
            ok: false,
            kind: 'integrity',
            error: `tarball 字节与 dist.integrity 不符（可能被篡改或缓存投毒）: ${meta.tarballUrl}`,
        };
    }
    // 校验通过的字节留在内存里交给解包链路（#105：不写本地文件）
    return { ok: true, body: download.body };
}
/** 取 `/<pkg>/latest`：HTTP 状态、JSON 合法性、`dist.tarball` 与 `dist.integrity` 逐个校验。 */
async function loadMeta(metaUrl, timeoutMs) {
    let response;
    try {
        response = await fetch(metaUrl, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (error) {
        return fetchFailure(error, 'registry 请求', metaUrl, timeoutMs);
    }
    if (!response.ok) {
        return { ok: false, kind: 'http-status', error: `registry 返回 HTTP ${response.status}（GET ${metaUrl}）` };
    }
    let meta;
    try {
        meta = (await response.json());
    }
    catch (error) {
        return {
            ok: false,
            kind: 'bad-metadata',
            error: `registry 元数据不是合法 JSON（GET ${metaUrl}）: ${errorMessage(error)}`,
        };
    }
    return readDist(meta, metaUrl);
}
/** 从元数据里取 `dist.tarball` / `dist.integrity`；缺失或形态非法一律归 `bad-metadata`。 */
function readDist(meta, metaUrl) {
    const dist = meta?.dist;
    const tarballUrl = dist?.tarball;
    if (typeof tarballUrl !== 'string' || tarballUrl === '') {
        return { ok: false, kind: 'bad-metadata', error: `registry 元数据缺少 dist.tarball（GET ${metaUrl}）` };
    }
    const integrity = dist?.integrity;
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
        return {
            ok: false,
            kind: 'bad-metadata',
            error: `registry 未声明可用的 dist.integrity，无法校验摘要、拒绝落盘（GET ${metaUrl}）`,
        };
    }
    return { ok: true, tarballUrl, integrity };
}
/** 下载 tarball 字节；非 2xx 归 `http-status`，网络/超时交 `fetchFailure` 判定。 */
async function downloadTarball(url, timeoutMs) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
            return { ok: false, kind: 'http-status', error: `tarball 下载返回 HTTP ${response.status}（GET ${url}）` };
        }
        return { ok: true, body: Buffer.from(await response.arrayBuffer()) };
    }
    catch (error) {
        return fetchFailure(error, 'tarball 下载', url, timeoutMs);
    }
}
/** 组装 fetch 失败结论；信息里带上 URL 与超时上限，供用户/日志定位。 */
function fetchFailure(error, what, url, timeoutMs) {
    const kind = classifyFetchFailure(error);
    const head = kind === 'timeout' ? `${what}超时（${timeoutMs}ms 上限）` : `${what}失败`;
    return { ok: false, kind, error: `${head}（GET ${url}）: ${errorMessage(error)}` };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
