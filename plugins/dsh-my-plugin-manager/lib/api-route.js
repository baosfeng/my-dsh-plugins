/**
 * dsh-my-plugin-manager — /my-plugin-manager/api route handler.
 *
 *  - GET  /my-plugin-manager/api/installed  → loader 已安装清单 + 版本；
 *  - GET  /my-plugin-manager/api/search?q=… → npm registry 市场搜索；
 *  - GET  /my-plugin-manager/api/detail?name=… → 插件详情（README/版本/依赖）；
 *  - POST /my-plugin-manager/api/install    → `dsh plugin --profile <p> add`;
 *  - POST /my-plugin-manager/api/uninstall  → `dsh plugin --profile <p> remove`;
 *  - GET  /my-plugin-manager/api/updates    → `pnpm outdated --json`（更新检查）。
 * Every request passes the trust fence first; responses are JSON with
 * cache-control: no-cache.
 */
import { readJsonBody, writeError, writeJson } from 'dsh-shared';
import { installedVersionOf, installPlugin, uninstallPlugin, outdatedPlugins } from './manage.js';
import { fetchPackageDetail, searchNpmPlugins } from './registry.js';
export function createApiHandler({ ctx, profile, profileDir, fence, }) {
    const logger = ctx.logger;
    const handlers = {
        installed: {
            method: 'GET',
            run: async (url, request, response) => handleInstalled(ctx, profileDir, response),
        },
        search: { method: 'GET', run: (url, request, response) => handleSearch(url, response) },
        detail: { method: 'GET', run: (url, request, response) => handleDetail(url, response, logger) },
        updates: {
            method: 'GET',
            run: (url, request, response) => handleUpdates(profile, response, logger),
        },
        install: {
            method: 'POST',
            run: (url, request, response) => handleInstall(profile, request, response, logger),
        },
        uninstall: {
            method: 'POST',
            run: (url, request, response) => handleUninstall(profile, request, response, logger),
        },
    };
    return async (request, response) => {
        if (!fence(request)) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const url = new URL(request.url ?? '/', 'http://dsh.internal');
        try {
            const method = apiMethodOf(url);
            const spec = method === undefined ? undefined : handlers[method];
            if (spec === undefined || spec.method !== request.method) {
                writeJson(response, 404, {
                    ok: false,
                    error: { message: 'unknown my-plugin-manager API method' },
                });
                return;
            }
            await spec.run(url, request, response);
        }
        catch (error) {
            writeError(response, error);
        }
    };
}
/** Strip the /my-plugin-manager/api/ prefix; undefined for anything else. */
function apiMethodOf(url) {
    const pathname = url.pathname;
    return pathname.startsWith('/my-plugin-manager/api/') ? pathname.slice('/my-plugin-manager/api/'.length) : undefined;
}
/**
 * 官方/内置包命名空间（issue #28）：DSH 官方 bundle（@deepseek-ai/*）、
 * Cordis 核心 loader 条目（cordis / cordis:*）、Cordis 官方生态组织
 * （@koishijs/*）。其余命名空间一律视为用户安装的插件。
 */
const OFFICIAL_PREFIXES = ['@deepseek-ai/', '@koishijs/'];
/** 判断 moduleName 是否为官方/内置插件（用于「已安装」列表过滤）。 */
export function isOfficialModule(moduleName) {
    if (moduleName === 'cordis' || moduleName.startsWith('cordis:'))
        return true;
    return OFFICIAL_PREFIXES.some((prefix) => moduleName.startsWith(prefix));
}
/**
 * GET /installed — user-installed loader entries with resolved versions.
 *
 * `pluginInventory.list()` 是 async（宿主 dsh-host-plugin-inventory 0.1.2-rc.1
 * `async list()` 返回 Promise<{ entries }>），必须 await 后再读 entries——
 * 同步解引用会得到 undefined.entries 而抛错，路由返回 400（已安装列表
 * 显示「加载失败」）。createApiHandler 已 `await spec.run(...)` 并 catch，
 * 因此这里的 async 异常仍会被统一转成 JSON 错误响应。
 */
async function handleInstalled(ctx, profileDir, response) {
    const inventory = await ctx.pluginInventory.list();
    const entries = inventory.entries
        .map((entry) => ({
        moduleName: entry.moduleName,
        enabled: entry.enabled,
        fiberPhase: entry.fiberPhase,
        version: installedVersionOf(profileDir, entry.moduleName),
        official: isOfficialModule(entry.moduleName),
    }))
        .filter((entry) => !entry.official);
    writeJson(response, 200, { ok: true, value: { entries } });
}
/** GET /search?q=… — npm registry market search. */
async function handleSearch(url, response) {
    const query = url.searchParams.get('q') ?? '';
    const size = Number(url.searchParams.get('size') ?? 30);
    if (query.trim() === '') {
        writeJson(response, 200, { ok: true, value: { results: [] } });
        return;
    }
    const results = await searchNpmPlugins(query.trim(), safeSize(size));
    writeJson(response, 200, { ok: true, value: { results } });
}
/** GET /detail?name=…&version=… — package detail (README/versions/deps). */
async function handleDetail(url, response, logger) {
    const name = url.searchParams.get('name') ?? '';
    const version = url.searchParams.get('version') ?? '';
    if (name.trim() === '') {
        writeJson(response, 400, { ok: false, error: { message: 'name is required' } });
        return;
    }
    try {
        const detail = await fetchPackageDetail(name.trim(), version.trim());
        writeJson(response, 200, { ok: true, value: detail });
    }
    catch (error) {
        logger?.warn(`[dsh-my-plugin-manager] 插件详情加载失败（name=${name.trim()}，原因=${error instanceof Error ? error.message : String(error)}）`);
        writeJson(response, 200, {
            ok: false,
            error: { message: String(messageOf(error) ?? 'failed to load plugin detail') },
        });
    }
}
/** 未知异常的 message（非对象/无 message 视为未提供）。 */
function messageOf(error) {
    return error?.message;
}
/** GET /updates — pnpm outdated --json parsed into a flat list. */
async function handleUpdates(profile, response, logger) {
    const result = await outdatedPlugins(profile);
    if (!result.ok) {
        logger?.warn(`[dsh-my-plugin-manager] 更新检查失败（原因=${result.error}）`);
        writeJson(response, 200, { ok: true, value: { outdated: [], error: result.error } });
        return;
    }
    logger?.info(`[dsh-my-plugin-manager] 更新检查完成（可更新=${result.outdated.length} 个）`);
    writeJson(response, 200, { ok: true, value: { outdated: result.outdated } });
}
/** POST /install { source } — install a npm package or link: path. */
async function handleInstall(profile, request, response, logger) {
    const payload = await readJsonBody(request);
    const source = typeof payload.source === 'string' ? payload.source.trim() : '';
    if (source === '') {
        writeJson(response, 400, { ok: false, error: { message: 'source is required' } });
        return;
    }
    const result = await installPlugin(profile, source);
    logInstallResult(logger, result, source, profile);
    writeJson(response, 200, {
        ok: result.ok,
        error: result.ok ? undefined : { message: cliErrorText(result) },
    });
}
/** POST /uninstall { name } — remove an installed package. */
async function handleUninstall(profile, request, response, logger) {
    const payload = await readJsonBody(request);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (name === '') {
        writeJson(response, 400, { ok: false, error: { message: 'name is required' } });
        return;
    }
    const result = await uninstallPlugin(profile, name);
    logUninstallResult(logger, result, name, profile);
    writeJson(response, 200, {
        ok: result.ok,
        error: result.ok ? undefined : { message: cliErrorText(result) },
    });
}
/** CLI 失败文本（stderr 优先，回退 stdout / exit code）。 */
function cliErrorText(result) {
    return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}
/** 安装结果日志（统一 [dsh-my-plugin-manager] 前缀，issue #155）。 */
function logInstallResult(logger, result, source, profile) {
    if (result.ok) {
        logger?.info(`[dsh-my-plugin-manager] 插件安装成功（source=${source}，profile=${profile}）`);
    }
    else {
        logger?.warn(`[dsh-my-plugin-manager] 插件安装失败（source=${source}，原因=${cliErrorText(result)}）`);
    }
}
/** 卸载结果日志（统一 [dsh-my-plugin-manager] 前缀，issue #155）。 */
function logUninstallResult(logger, result, name, profile) {
    if (result.ok) {
        logger?.info(`[dsh-my-plugin-manager] 插件卸载成功（name=${name}，profile=${profile}）`);
    }
    else {
        logger?.warn(`[dsh-my-plugin-manager] 插件卸载失败（name=${name}，原因=${cliErrorText(result)}）`);
    }
}
/** Clamp the search size to 1..50. */
function safeSize(size) {
    if (!Number.isFinite(size) || size < 1)
        return 30;
    return Math.min(size, 50);
}
