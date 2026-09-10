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
import { readFile, stat } from 'node:fs/promises';
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
};
function mediaTypeForPath(path) {
    const dot = path.lastIndexOf('.');
    const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
    return MEDIA_TYPES[ext] ?? 'application/octet-stream';
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
/** stat + read + respond with the file's bytes (bounded by MEDIA_LIMIT). */
async function serveMedia(response, abs, url) {
    let info;
    try {
        info = await stat(abs);
    }
    catch {
        throw mediaError(404, 'file not found');
    }
    if (!info.isFile())
        throw mediaError(400, 'not a file');
    if (info.size > MEDIA_LIMIT)
        throw mediaError(413, 'file too large');
    const body = await readFile(abs);
    const headers = {
        'content-type': mediaTypeForPath(abs),
        'cache-control': 'no-cache',
    };
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
    let info;
    try {
        info = await stat(abs);
    }
    catch {
        throw mediaError(404, 'file not found');
    }
    if (!info.isFile())
        throw mediaError(400, 'not a file');
    if (info.size > TEXT_LIMIT)
        throw mediaError(413, 'file too large');
    const content = await readFile(abs, 'utf8');
    writeJson(response, 200, { ok: true, value: { content } });
}
