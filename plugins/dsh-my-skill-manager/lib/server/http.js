/**
 * dsh-my-skill-manager — /my-skill-manager/api 路由。
 *
 *  GET  /list?cwd=      全量 skill（官方 catalog + 目录扫描合并）+ 两个禁用
 *                       名单 + 诊断 + 使用统计（不再按全局/项目视图过滤）
 *  GET  /rescan?cwd=    先 invalidate 官方 catalog，再返回同 /list 的 payload
 *  GET  /detail?name=&cwd=  SKILL.md 只读预览（白名单根、≤256KB）
 *  GET  /session?sessionId= 会话的工作目录
 *  PUT  /config         { scope:'global'|'project', disabled:string[], cwd }
 *                       保存一个作用域的禁用名单并 invalidate
 *
 * 所有请求先过信任围栏（dsh-shared createTrustFence）；响应统一 JSON，
 * 成功列表用 { ok:true, value }，保存用 { ok:true }，失败用
 * { ok:false, error:{ code, message } }。
 */
import { readJsonBody, writeJson } from 'dsh-shared';
import { buildCatalogView } from './catalog.js';
import { normalizeDisabledList, readDisabledLists, saveDisabledList } from './config-store.js';
import { DetailError, readSkillDetail } from './detail.js';
/** 路由前缀。 */
export const API_PREFIX = '/my-skill-manager/api';
/** 构造路由处理函数。 */
export function createApiHandler({ ctx, invalidate, fence, usage, }) {
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        try {
            await dispatch({ request, response, ctx, invalidate, usage });
        }
        catch (error) {
            writeFailure(response, error);
        }
    };
}
/** 路由表：HTTP 方法 + 路径后缀 → 处理函数。 */
const ROUTES = [
    { method: 'GET', suffix: '/list', handle: handleList },
    { method: 'GET', suffix: '/rescan', handle: handleRescan },
    { method: 'GET', suffix: '/detail', handle: handleDetail },
    { method: 'GET', suffix: '/session', handle: handleSession },
    { method: 'PUT', suffix: '/config', handle: handleConfig },
];
/** 路由分发：查路由表，未命中回 404。 */
async function dispatch(deps) {
    const url = new URL(deps.request.url ?? '/', 'http://dsh.internal');
    const route = url.pathname.replace(/\/+$/, '');
    const method = deps.request.method ?? 'GET';
    const entry = ROUTES.find((candidate) => candidate.method === method && route.endsWith(candidate.suffix));
    if (entry === undefined) {
        writeJson(deps.response, 404, {
            ok: false,
            error: { code: 'not-found', message: 'unknown my-skill-manager API route' },
        });
        return;
    }
    await entry.handle(deps, url);
}
/** GET /list。 */
async function handleList({ response, ctx, usage }, url) {
    writeJson(response, 200, { ok: true, value: await listValue(ctx, usage, cwdOf(url)) });
}
/** GET /rescan：先失效宿主缓存，再返回新列表。 */
async function handleRescan({ response, ctx, invalidate, usage }, url) {
    invalidate();
    writeJson(response, 200, { ok: true, value: await listValue(ctx, usage, cwdOf(url)) });
}
/** GET /detail。 */
async function handleDetail({ response, ctx }, url) {
    await detailValue(ctx, url, response);
}
/** GET /session。 */
function handleSession({ response, ctx }, url) {
    writeJson(response, 200, { ok: true, value: { cwd: sessionCwd(ctx, url) } });
}
/** PUT /config。 */
async function handleConfig({ request, response, invalidate }) {
    await saveConfig(request, response, invalidate);
}
/** cwd 查询参数（空串视为缺省）。 */
function cwdOf(url) {
    const cwd = url.searchParams.get('cwd') ?? '';
    return cwd === '' ? undefined : cwd;
}
/** 组装 /list 与 /rescan 的 value。 */
async function listValue(ctx, usage, cwd) {
    if (ctx.skills === undefined)
        throw new HttpError(503, 'skills-unavailable', 'skills service is unavailable');
    const catalog = await ctx.skills.list({ cwd });
    const snapshot = usage.snapshot();
    const view = await buildCatalogView({ catalog, cwd, usage: snapshot });
    const { globalDisabled, projectDisabled } = await readDisabledLists(cwd);
    return {
        cwd: view.cwd,
        projectRoot: view.projectRoot,
        scannedAt: view.scannedAt,
        skills: view.skills,
        globalDisabled,
        projectDisabled,
        diagnostics: view.diagnostics,
        usage: snapshot,
    };
}
/** /detail：name 必填，失败映射 400/404。 */
async function detailValue(ctx, url, response) {
    const name = url.searchParams.get('name') ?? '';
    if (name.trim() === '') {
        writeJson(response, 400, { ok: false, error: { code: 'invalid-name', message: 'name is required' } });
        return;
    }
    try {
        const detail = await readSkillDetail({ name, cwd: cwdOf(url) });
        writeJson(response, 200, { ok: true, value: detail });
    }
    catch (error) {
        if (error instanceof DetailError) {
            writeJson(response, error.code === 'not-found' ? 404 : 400, {
                ok: false,
                error: { code: error.code, message: error.message },
            });
            return;
        }
        throw error;
    }
}
/** /session：会话工作目录（无会话 / 无 cwd → 空串）。 */
function sessionCwd(ctx, url) {
    const sessionId = url.searchParams.get('sessionId') ?? '';
    if (sessionId === '')
        return '';
    const session = ctx.sessions?.get(sessionId);
    const cwd = session?.header?.cwd;
    return typeof cwd === 'string' ? cwd : '';
}
/** /config：保存一个作用域的禁用名单，然后 invalidate。 */
async function saveConfig(request, response, invalidate) {
    const body = await readJsonBody(request);
    const scope = body.scope;
    if (scope !== 'global' && scope !== 'project') {
        writeJson(response, 400, {
            ok: false,
            error: { code: 'invalid-scope', message: 'scope must be "global" or "project"' },
        });
        return;
    }
    const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : undefined;
    await saveDisabledList({
        scope: scope,
        disabled: normalizeDisabledList(body.disabled),
        cwd,
    });
    invalidate();
    writeJson(response, 200, { ok: true });
}
/** 带 HTTP 状态码的错误。 */
class HttpError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}
/** 统一失败响应。 */
function writeFailure(response, error) {
    if (error instanceof HttpError) {
        writeJson(response, error.status, { ok: false, error: { code: error.code, message: error.message } });
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 500, { ok: false, error: { code: 'internal', message } });
}
