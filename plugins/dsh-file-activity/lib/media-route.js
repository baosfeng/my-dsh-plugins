/**
 * /file-activity/file media route: serves recorded file bytes (images / PDFs
 * AND, with `as=text`, text content) for the floating preview. The sidebar's
 * own /sidebar/file route refuses every path outside the session working
 * directory (isWithin(cwd, …)), but file activity records files the agent
 * touched ANYWHERE — /tmp scratch files, sibling repos, … — so images/PDFs
 * outside the workspace resolve to a broken <img>. This route serves the
 * bytes with the same trust fence, swapping the "inside the session cwd"
 * boundary for "paths this session actually recorded".
 *
 * `as=text` (issue #68): the floating preview's text path first asks the
 * sidebar fs.read API; when the sidebar refuses a recorded file (workspace
 * fence), the client falls back to this route and receives an fs.read-shaped
 * JSON payload ({ ok, value: { content } }) so the viewer mounts unchanged.
 */
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { writeJson } from 'dsh-shared';
import { sessionCwdOf } from './cwd.js';
import { isRecordedPath } from './state.js';
/** Cap for the plugin's own media route (bytes): images / PDFs only. */
const MEDIA_LIMIT = 64 * 1024 * 1024;
/** Cap for `as=text` payloads (characters): text previews, not archives. */
const TEXT_LIMIT = 2 * 1024 * 1024;
/** Content types served by /file-activity/file (mirrors the sidebar's set). */
const MEDIA_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    // HTML documents (issue #266 C): rendered in a sandboxed iframe by the
    // floating preview, so they must be served as documents, not as text.
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xhtml': 'application/xhtml+xml',
};
/** HTML suffixes: always served through the sandboxing CSP below. */
const HTML_TYPES = new Set(['.html', '.htm', '.xhtml']);
/**
 * Content-Security-Policy for a previewed HTML document (issue #266 C).
 *
 * `sandbox` with NO `allow-same-origin` forces an opaque origin: the document
 * cannot read cookies, storage, or same-origin APIs, and it cannot script the
 * embedding page. Scripts/forms stay enabled so interactive documents render.
 * The header (not only the iframe's own `sandbox` attribute) is what keeps a
 * DIRECT visit to this URL sandboxed too — the preview iframe is not the only
 * way to reach it.
 */
const HTML_SANDBOX_CSP = 'sandbox allow-scripts allow-forms';
/** 小写后缀（含点号；无后缀返回空串）。 */
function suffixOf(path) {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot).toLowerCase();
}
function mediaTypeForPath(path) {
    return MEDIA_TYPES[suffixOf(path)] ?? 'application/octet-stream';
}
/** Error carrying an HTTP status, for the media route's catch-all. */
function mediaError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}
export function createMediaHandler({ ctx, store, fence, }) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        if (request.method !== 'GET') {
            writeJson(response, 405, { ok: false, error: { message: 'method not allowed' } });
            return;
        }
        try {
            await serveRecordedFile(request, response, ctx, store);
        }
        catch (error) {
            const status = typeof error?.status === 'number' ? error.status : 400;
            writeJson(response, status, {
                ok: false,
                error: { message: error instanceof Error ? error.message : String(error) },
            });
        }
    };
}
/**
 * Resolve a recorded path (authorized per session) and serve it: bytes
 * (images / PDFs, `download=1` supported) or, with `as=text`, an
 * fs.read-shaped JSON payload for the floating preview's text fallback.
 */
async function serveRecordedFile(request, response, ctx, store) {
    const url = new URL(request.url ?? '/', 'http://dsh.internal');
    const sessionId = url.searchParams.get('sessionId');
    const raw = url.searchParams.get('path');
    assertMediaParams(sessionId, raw);
    if (!isRecordedPath(store.state, sessionId, raw))
        throw mediaError(403, "path is not in this session's file activity");
    const abs = isAbsolute(raw) ? raw : join(sessionCwdOf(ctx, sessionId), raw);
    if (url.searchParams.get('as') === 'text') {
        await serveText(response, abs);
        return;
    }
    await serveMedia(response, abs, url);
}
/** Both query parameters are required for a media request. */
function assertMediaParams(sessionId, raw) {
    if (sessionId === null || raw === null || raw === '')
        throw mediaError(400, 'sessionId and path are required');
}
/**
 * 把 fs 读取失败按 errno 分类成 HTTP 状态（#318：commit 76f52ac 引入的 `catch {}` 把
 * 所有错误都吞成 404，丢掉了旧实现的诊断信息——EISDIR 与 EACCES 都被误报为
 * "file not found"，而目录明明存在、权限被拒也不是"没找到"）。
 *
 * 分类（与同文件既有契约对齐）：
 *   · EISDIR       → 400 'not a file'     —— 与加固前 `if (!info.isFile())` 的行为一致
 *   · EACCES/EPERM → 403 'permission denied' —— 与信任围栏的 403 语义一致
 *   · 其余（含 ENOENT）→ 404 'file not found'
 *
 * TOCTOU 加固保留：不再 stat，只在一次 `readFile` 失败后按 errno 归类——check-then-use
 * 的时间窗不复存在，分类只依赖这次真实失败的原因。
 */
function mediaReadError(error, abs) {
    const code = error?.code;
    if (code === 'EISDIR' || code === 'ENOTDIR')
        return mediaError(400, `not a file: ${abs}`);
    if (code === 'EACCES' || code === 'EPERM')
        return mediaError(403, `permission denied: ${abs}`);
    return mediaError(404, 'file not found');
}
/** stat + read + respond with the file's bytes (bounded by MEDIA_LIMIT). */
async function serveMedia(response, abs, url) {
    let body;
    try {
        // 单次 read：不再 stat，避免 check-then-use（#318 前的 TOCTOU 加固）
        body = await readFile(abs);
    }
    catch (error) {
        // 按 errno 分类（目录 → 400；权限 → 403；其余 → 404），不丢诊断信息
        throw mediaReadError(error, abs);
    }
    // Check file size after reading to avoid race condition
    if (body.length > MEDIA_LIMIT)
        throw mediaError(413, 'file too large');
    const headers = {
        'content-type': mediaTypeForPath(abs),
        'cache-control': 'no-cache',
    };
    // Untrusted document: the sandboxing CSP travels with the bytes, so the
    // protection does not depend on the caller embedding it in a sandboxed frame.
    if (HTML_TYPES.has(suffixOf(abs))) {
        headers['content-security-policy'] = HTML_SANDBOX_CSP;
        headers['x-content-type-options'] = 'nosniff';
    }
    if (url.searchParams.get('download') === '1') {
        headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(abs))}`;
    }
    response.writeHead(200, headers);
    response.end(body);
}
/**
 * `as=text` mode: serve a recorded file's text content as an fs.read-shaped
 * JSON payload ({ ok, value: { content } }) so the floating preview's text
 * viewers mount unchanged even when the sidebar fs.read refuses the path
 * (workspace fence — issue #68). Same authorization as bytes serving:
 * recorded paths only.
 */
async function serveText(response, abs) {
    let content;
    try {
        // Use try-catch instead of stat + readFile to avoid TOCTOU race condition
        content = await readFile(abs, 'utf8');
    }
    catch (error) {
        throw mediaReadError(error, abs);
    }
    // Check content length after reading to avoid race condition
    if (content.length > TEXT_LIMIT)
        throw mediaError(413, 'file too large');
    writeJson(response, 200, { ok: true, value: { content } });
}
