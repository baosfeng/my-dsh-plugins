/**
 * dsh-my-memory — /my-memory/api route handler.
 *
 *  - GET  /my-memory/api/memory?scope=global|project&cwd=… → the memory
 *    items of one scope (read-only; project scope resolves the project root
 *    from cwd);
 *  - GET  /my-memory/api/session?sessionId=… → the session's working
 *    directory ('' when the session has none) — the settings panel uses it
 *    to auto-load the current project's memory on open (issue #104), the
 *    same session-cwd resolution as the memory_query tool;
 *  - POST /my-memory/api/memory → a write operation (add / update / delete).
 *    Every write MUST carry `confirmed: true` — the user-consent marker the
 *    settings panel sets only after its custom confirmation UI (delete is
 *    red, save is green). A write without the marker is refused with 400:
 *    memory must never change silently.
 *  - GET  /my-memory/api/candidates → the pending auto-extracted learning
 *    candidates (issue #78). Read-only; candidates never touch the memory
 *    files until the user confirms them.
 *  - POST /my-memory/api/candidates/confirm → accept one candidate: it is
 *    merged into the target scope store (globally or per-project, per the
 *    candidate's scope + cwd) with progressive update (same-theme entries
 *    gain confidence / content update / conflict marker), then removed from
 *    the pending list. Every confirm MUST carry `confirmed: true` — memory
 *    never changes silently, even for auto-extracted candidates.
 *  - POST /my-memory/api/candidates/dismiss → reject one candidate: it is
 *    dropped from the pending list without touching any memory (also gated
 *    on `confirmed: true`).
 *  - GET  /my-memory/api/config → the entry-length guidance the settings
 *    panel uses for concise-input hints (`maxEntryLength`, `maxDescLength`,
 *    issue #105). Writes keep the FULL desc in storage — the panel and the
 *    injection summarize for display only.
 *
 * Every request passes the trust fence first; responses are JSON with
 * cache-control: no-cache.
 */
import { readJsonBody, writeError, writeJson } from 'dsh-shared';
import { findProjectRoot } from 'dsh-shared';
import { DEFAULT_MAX_DESC_LENGTH, DEFAULT_MAX_ENTRY_LENGTH } from './memory-text.js';
import { makeSource } from './memory-scoring.js';
/** The cwd query parameter, normalized to undefined when absent. */
function cwdOf(url) {
    const cwd = url.searchParams.get('cwd') ?? '';
    return cwd !== '' ? cwd : undefined;
}
export function createApiHandler({ globalStore, getProjectStore, candidatesStore, fence, sessions, config, logger, }) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        try {
            await routeRequest(url, request, response, {
                globalStore,
                getProjectStore,
                candidatesStore,
                sessions,
                config,
                logger,
            });
        }
        catch (error) {
            writeError(response, error);
        }
    };
}
/** Dispatch one request to the matching handler by path + method. */
async function routeRequest(url, request, response, { globalStore, getProjectStore, candidatesStore, sessions, config, logger }) {
    if (await routeCandidates(url, request, response, { candidatesStore, globalStore, getProjectStore, logger }))
        return;
    if (url.pathname.endsWith('/config') && request.method === 'GET') {
        handleConfig(config, response);
        return;
    }
    if (url.pathname.endsWith('/session') && request.method === 'GET') {
        await handleSession(sessions, url, response);
        return;
    }
    if (url.pathname.endsWith('/memory') && request.method === 'GET') {
        await handleList(url, response, globalStore, getProjectStore);
        return;
    }
    if (url.pathname.endsWith('/memory') && request.method === 'POST') {
        await handleWrite(request, response, globalStore, getProjectStore, logger);
        return;
    }
    writeJson(response, 404, { ok: false, error: { message: 'unknown my-memory API method' } });
}
/** 候选相关路由分发（issue #78）；已处理返回 true。 */
async function routeCandidates(url, request, response, { candidatesStore, globalStore, getProjectStore, logger }) {
    if (url.pathname.endsWith('/candidates') && request.method === 'GET') {
        await handleCandidatesList(candidatesStore, url, response);
        return true;
    }
    if (url.pathname.endsWith('/candidates/confirm') && request.method === 'POST') {
        await handleCandidateConfirm(request, response, candidatesStore, globalStore, getProjectStore, logger);
        return true;
    }
    if (url.pathname.endsWith('/candidates/dismiss') && request.method === 'POST') {
        await handleCandidateDismiss(request, response, candidatesStore);
        return true;
    }
    return false;
}
/** GET /candidates — the pending auto-extracted learning candidates (issue #78). */
async function handleCandidatesList(candidatesStore, url, response) {
    if (candidatesStore === null || candidatesStore === undefined) {
        writeJson(response, 200, { ok: true, value: { items: [] } });
        return;
    }
    await candidatesStore.load();
    writeJson(response, 200, { ok: true, value: { items: candidatesStore.list() } });
}
/** POST /candidates/confirm — accept one candidate into the target scope
 *  (user-confirmed write; memory never changes silently). */
async function handleCandidateConfirm(request, response, candidatesStore, globalStore, getProjectStore, logger) {
    if (candidatesStore === null || candidatesStore === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'candidate store unavailable' } });
        return;
    }
    const payload = await readJsonBody(request);
    const resolved = await resolveCandidate(payload, candidatesStore, 'confirm');
    if (!resolved.ok) {
        writeJson(response, resolved.status, { ok: false, error: { message: resolved.message } });
        return;
    }
    const outcome = await mergeCandidateIntoStore(resolved.candidate, globalStore, getProjectStore);
    if (!outcome.ok) {
        writeJson(response, outcome.status, { ok: false, error: { message: outcome.message } });
        return;
    }
    await candidatesStore.remove(resolved.id);
    logger?.info(`[dsh-my-memory] 候选已确认并入记忆（candidateId=${resolved.id}，scope=${outcome.scope}，outcome=${outcome.outcome}）`);
    writeJson(response, 200, {
        ok: true,
        value: { scope: outcome.scope, cwd: outcome.cwd, item: outcome.item, outcome: outcome.outcome },
    });
}
/** 定位候选（确认/拒弃共用）：校验同意标记 + id，从待确认列表找到候选。
 *  返回 { ok:false, status, message } 或 { ok:true, candidate, id }。 */
async function resolveCandidate(payload, candidatesStore, action) {
    if (payload?.confirmed !== true) {
        return { ok: false, status: 400, message: `candidate ${action} requires confirmed: true (user consent)` };
    }
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (id === '') {
        return { ok: false, status: 400, message: `candidate ${action} requires an id` };
    }
    await candidatesStore.load();
    const candidate = candidatesStore.list().find((c) => c.id === id);
    if (candidate === undefined) {
        return { ok: false, status: 404, message: 'candidate not found' };
    }
    return { ok: true, candidate, id };
}
/** 将候选渐进合并进目标 scope 的 store（issue #78）；返回
 *  { ok:false, status, message } 或 { ok:true, scope, cwd, item, outcome }。 */
async function mergeCandidateIntoStore(candidate, globalStore, getProjectStore) {
    const scope = candidate.scope === 'project' ? 'project' : 'global';
    if (scope === 'global') {
        const now = Date.now();
        const result = await globalStore.mergeAdd(candidateForMerge(candidate, now), now);
        return { ok: true, scope, cwd: '', item: result.item, outcome: result.outcome };
    }
    const cwd = typeof candidate.cwd === 'string' && candidate.cwd !== '' ? candidate.cwd : '';
    if (cwd === '') {
        return { ok: false, status: 400, message: 'project candidate requires a cwd' };
    }
    const store = await getProjectStore(cwd);
    const now = Date.now();
    const result = await store.mergeAdd(candidateForMerge(candidate, now), now);
    return { ok: true, scope, cwd, item: result.item, outcome: result.outcome };
}
/** 候选 → 正式条目载荷（补齐元数据默认、source 用当前确认时间）。 */
function candidateForMerge(candidate, now) {
    return {
        desc: candidate.desc,
        category: candidate.category,
        source: makeSource(candidate.source?.sessionId, now),
        confidence: 1,
        createdAt: candidate.createdAt,
        updatedAt: now,
    };
}
/** POST /candidates/dismiss — reject one candidate (drop it without touching
 *  any memory; still gated on the user-consent marker). */
async function handleCandidateDismiss(request, response, candidatesStore) {
    if (candidatesStore === null || candidatesStore === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'candidate store unavailable' } });
        return;
    }
    const payload = await readJsonBody(request);
    if (payload?.confirmed !== true) {
        writeJson(response, 400, {
            ok: false,
            error: { message: 'candidate dismiss requires confirmed: true (user consent)' },
        });
        return;
    }
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (id === '') {
        writeJson(response, 400, { ok: false, error: { message: 'candidate dismiss requires an id' } });
        return;
    }
    await candidatesStore.load();
    if (!(await candidatesStore.remove(id))) {
        writeJson(response, 404, { ok: false, error: { message: 'candidate not found' } });
        return;
    }
    writeJson(response, 200, { ok: true, value: { removed: true } });
}
/** GET /config — the entry-length guidance for the panel (issue #105). */
function handleConfig(config, response) {
    writeJson(response, 200, {
        ok: true,
        value: {
            maxEntryLength: config?.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH,
            maxDescLength: config?.maxDescLength ?? DEFAULT_MAX_DESC_LENGTH,
        },
    });
}
/** GET /session — the session's working directory ('' when none). The settings
 *  panel auto-loads the current project memory from it (issue #104), the same
 *  session-cwd resolution the memory_query tool uses. */
async function handleSession(sessions, url, response) {
    const sessionId = url.searchParams.get('sessionId');
    const session = typeof sessionId === 'string' && sessionId !== '' ? sessions?.get(sessionId) : undefined;
    const cwd = session?.header?.cwd;
    writeJson(response, 200, { ok: true, value: { cwd: typeof cwd === 'string' && cwd !== '' ? cwd : '' } });
}
/** GET /memory — one scope's items (global, or project resolved from cwd). */
async function handleList(url, response, globalStore, getProjectStore) {
    const scope = url.searchParams.get('scope') ?? 'global';
    const cwd = cwdOf(url);
    if (scope !== 'global' && scope !== 'project') {
        writeJson(response, 400, {
            ok: false,
            error: { message: 'scope must be "global" or "project"' },
        });
        return;
    }
    if (scope === 'project' && cwd === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'project scope requires a cwd' } });
        return;
    }
    const store = scope === 'global' ? globalStore : await getProjectStore(cwd);
    const projectRoot = scope === 'project' ? await findProjectRoot(cwd) : '';
    writeJson(response, 200, {
        ok: true,
        value: { scope, cwd: cwd ?? '', projectRoot, items: store.list() },
    });
}
/** POST /memory — add / update / delete, gated on the user-consent marker. */
async function handleWrite(request, response, globalStore, getProjectStore, logger) {
    const payload = await readJsonBody(request);
    const gate = writeGate(payload);
    if (gate !== null) {
        writeJson(response, gate.status, { ok: false, error: { message: gate.message } });
        return;
    }
    const store = payload.scope === 'global' ? globalStore : await getProjectStore(typeof payload.cwd === 'string' ? payload.cwd : '');
    const outcome = await applyWrite(store, payload);
    if (outcome !== null) {
        writeJson(response, outcome.status, { ok: false, error: { message: outcome.message } });
        return;
    }
    logger?.info(`[dsh-my-memory] API 写操作完成（action=${payload.action}，scope=${payload.scope}，itemId=${payload.id ?? ''}）`);
    writeJson(response, 200, { ok: true, value: { items: store.list() } });
}
/** Validate the write payload; returns a rejection or null when it passes. */
function writeGate(payload) {
    if (payload.confirmed !== true) {
        return { status: 400, message: 'write requires confirmed: true (user consent)' };
    }
    if (payload.scope !== 'global' && payload.scope !== 'project') {
        return { status: 400, message: 'scope must be "global" or "project"' };
    }
    const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : undefined;
    if (payload.scope === 'project' && cwd === undefined) {
        return { status: 400, message: 'project scope requires a cwd' };
    }
    payload.cwd = cwd;
    return null;
}
/** Apply one write action to a store; returns a rejection or null on success. */
async function applyWrite(store, payload) {
    if (payload.action === 'add')
        return applyAdd(store, payload);
    if (payload.action === 'update')
        return applyUpdate(store, payload);
    if (payload.action === 'delete')
        return applyDelete(store, payload);
    return { status: 400, message: 'action must be "add", "update" or "delete"' };
}
/** Add one memory item (desc required). */
async function applyAdd(store, payload) {
    const desc = typeof payload.desc === 'string' ? payload.desc.trim() : '';
    if (desc === '')
        return { status: 400, message: 'add requires a non-empty desc' };
    await store.add(desc);
    return null;
}
/** Update one memory item (id + desc required). */
async function applyUpdate(store, payload) {
    const id = typeof payload.id === 'string' ? payload.id : '';
    const desc = typeof payload.desc === 'string' ? payload.desc.trim() : '';
    if (id === '' || desc === '')
        return { status: 400, message: 'update requires id and a non-empty desc' };
    if ((await store.update(id, desc)) === null)
        return { status: 404, message: 'memory item not found' };
    return null;
}
/** Delete one memory item (id required). */
async function applyDelete(store, payload) {
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (id === '')
        return { status: 400, message: 'delete requires an id' };
    if (!(await store.remove(id)))
        return { status: 404, message: 'memory item not found' };
    return null;
}
