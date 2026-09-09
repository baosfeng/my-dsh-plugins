/**
 * dsh-my-guardian — /guardian/api HTTP surface: deferred registration (the
 * webServer service may mount after the guardian; poll ticks retry until it
 * appears), trust fence, method dispatch and the panel snapshot.
 */
import { readStagedFile, writeStagedFile } from './state.js';
import { isTrustedApiRequest, readJsonBody, writeJson } from 'dsh-shared';
/** Bind the API entry points to one guardian instance's shared state. */
export function createApi(ctx, shared) {
    return {
        ensureApi: () => ensureApi(ctx, shared),
        snapshot: () => snapshot(shared),
    };
}
/**
 * Register the /guardian/api routes once the webServer service appears
 * (optional surface; CLI profiles skip it). Retried on every poll tick.
 */
function ensureApi(ctx, shared) {
    if (shared.apiRegistered)
        return;
    const webServer = ctx.get('webServer');
    if (webServer === undefined)
        return;
    const webRuntime = ctx.get('webRuntime');
    shared.apiRegistered = true;
    try {
        ctx.effect(() => webServer.register({
            kind: 'prefix',
            path: '/guardian/api',
            handler: (request, response) => handleApiRequest(ctx, shared, webRuntime, request, response),
        }), 'dsh-my-guardian: /guardian/api routes');
    }
    catch (error) {
        // registration failed: allow a later poll tick to retry
        shared.apiRegistered = false;
        ctx.logger?.warn(`[dsh-my-guardian] api registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Unified route handler: fence → method dispatch → 404/error fallback. */
async function handleApiRequest(ctx, shared, webRuntime, request, response) {
    if (!isTrustedApiRequest(request, webRuntime?.trustedHosts ?? [])) {
        writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
        return;
    }
    const url = new URL(request.url ?? '/', 'http://dsh.internal');
    const method = url.pathname.startsWith('/guardian/api/') ? url.pathname.slice('/guardian/api/'.length) : '';
    try {
        await dispatchApiMethod(ctx, shared, method, request, response);
    }
    catch (error) {
        writeJson(response, 400, {
            ok: false,
            error: { message: error instanceof Error ? error.message : String(error) },
        });
    }
}
/** Dispatch one API method to its handler; unknown methods get 404. */
async function dispatchApiMethod(ctx, shared, method, request, response) {
    if (method === 'state' && request.method === 'GET') {
        writeJson(response, 200, { ok: true, value: shared.snapshot() });
        return;
    }
    if (request.method !== 'POST') {
        writeJson(response, 404, { ok: false, error: { message: 'unknown guardian API method' } });
        return;
    }
    if (method === 'staged') {
        await handleStagedPost(ctx, shared, request, response);
        return;
    }
    if (method === 'retry') {
        await handleRetryPost(ctx, shared, request, response);
        return;
    }
    if (method === 'remove') {
        await handleRemovePost(ctx, shared, request, response);
        return;
    }
    if (method === 'safemode') {
        await handleSafemodePost(ctx, shared, request, response);
        return;
    }
    writeJson(response, 404, { ok: false, error: { message: 'unknown guardian API method' } });
}
/** POST /guardian/api/staged — add a candidate entry and mount it. */
async function handleStagedPost(_ctx, shared, request, response) {
    const payload = await readJsonBody(request);
    const id = typeof payload.id === 'string' ? payload.id : '';
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (id === '' || name === '') {
        writeJson(response, 400, { ok: false, error: { message: 'id and name are required' } });
        return;
    }
    if (shared.conflictOf(id) !== null) {
        writeJson(response, 409, { ok: false, error: { message: `id "${id}" already in use` } });
        return;
    }
    const entries = await readStagedFile(shared.stagedFile);
    if (entries.some((item) => item?.id === id)) {
        writeJson(response, 409, {
            ok: false,
            error: { message: `"${id}" already in the staged file` },
        });
        return;
    }
    entries.push({ id, name, ...(payload.config !== undefined ? { config: payload.config } : {}) });
    const writeError = await writeStagedFile(shared.stagedFile, entries);
    if (writeError !== null)
        throw writeError;
    await shared.scanStaged();
    writeJson(response, 200, { ok: true, value: shared.snapshot() });
}
/** POST /guardian/api/retry — manual unfreeze of a staged/promoted entry. */
async function handleRetryPost(_ctx, shared, request, response) {
    const payload = await readJsonBody(request);
    const id = typeof payload.id === 'string' ? payload.id : '';
    const outcome = await shared.retryEntry(id);
    if (outcome === null) {
        writeJson(response, 404, { ok: false, error: { message: `no such entry "${id}"` } });
    }
    else {
        writeJson(response, 200, { ok: true, value: { outcome } });
    }
}
/** POST /guardian/api/remove — drop an entry everywhere. */
async function handleRemovePost(_ctx, shared, request, response) {
    const payload = await readJsonBody(request);
    const id = typeof payload.id === 'string' ? payload.id : '';
    await shared.removeEntry(id);
    writeJson(response, 200, { ok: true, value: shared.snapshot() });
}
/** POST /guardian/api/safemode — toggle safe mode (R5). */
async function handleSafemodePost(_ctx, shared, request, response) {
    const payload = await readJsonBody(request);
    const enabled = payload.enabled === true;
    shared.state.safeMode = enabled;
    shared.logEvent('safe-mode', enabled ? 'safe mode enabled' : 'safe mode disabled');
    if (enabled) {
        for (const id of [...shared.mounted])
            await shared.unmount(id);
    }
    else {
        shared.attempted.clear();
        await shared.scanStaged();
        await shared.mountPromoted();
    }
    shared.persistSoon();
    writeJson(response, 200, { ok: true, value: shared.snapshot() });
}
/** One row for the panel: status + failure-classification fields (issue #86). */
function entrySnapshot(shared, id, record, isStaged) {
    const status = shared.mounted.has(id)
        ? 'running'
        : record.frozen
            ? 'frozen'
            : record.attempts > 0
                ? 'failed'
                : 'pending';
    const item = {
        id,
        name: record.name,
        attempts: record.attempts,
        frozen: record.frozen,
        lastError: record.lastError,
        lastFailedAt: record.lastFailedAt,
        failureType: record.failureType ?? null,
        missingDeps: record.missingDeps ?? [],
        installHint: record.installHint ?? null,
        status,
    };
    if (!isStaged)
        item.promotedAt = record.promotedAt;
    return item;
}
/** Snapshot for the panel (leaf values only). */
function snapshot(shared) {
    const stagedList = Object.entries(shared.state.staged).map(([id, record]) => entrySnapshot(shared, id, record, true));
    const promotedList = Object.entries(shared.state.promoted).map(([id, record]) => entrySnapshot(shared, id, record, false));
    return {
        safeMode: shared.state.safeMode,
        staged: stagedList,
        promoted: promotedList,
        events: shared.state.events.slice(-10),
        // startup-roster pre-check report (issue #144): empty array = healthy
        startupIssues: Array.isArray(shared.startupIssues) ? shared.startupIssues : [],
        startupCheckedAt: typeof shared.startupCheckedAt === 'number' ? shared.startupCheckedAt : null,
    };
}
