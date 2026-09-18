/**
 * dsh-session-title-gen — 设置页配置端点与路由注册（issue #385）。
 *
 * 「设置 → 插件 → 会话标题生成」的保存链路：client PUT `<prefix>/config` → 本模块校验
 * → 写回 profile 层 patch 文件（持久化）→ 更新内存生效值并通知 apply 侧**热切换**
 * （保存即生效，不必等 watchUserPatches 热重载、不必重启 DSH）。
 *
 * 写回复用 dsh-shared 的配置原语（currentProfile / patchFileOf / extractConfig /
 * writePatchConfig），并**先合并该行已有键再写**：`writePatchConfig` 的语义是
 * 「删除同 id 旧条目 → 追加新条目」，直接写会把用户手写的其它键（如 `disabled: true`）
 * 一起抹掉（数据破坏，issue #385 验收项「写回不删掉用户手写的其它键」）。
 *
 * 注册契约（真实环境「设置页恒报配置加载失败」的修复依据）：
 *  1. 服务经 `ctx.inject(['webServer'], cb)` **局部等待**，不用 `ctx.get('webServer')`
 *     一次性取值 —— cordis 的 get 带严格就绪检查且**没有重试**，webServer 晚于本插件
 *     就绪时永久错过，路由从未注册 → client 端 404。
 *  2. 注册承载在**常驻 root**（`ctx.root ?? ctx`）的 inject 子 fiber 上 —— profile 插件
 *     自身 fiber 在 apply 结束后被 loader 回收，挂在它上面的 `ctx.effect` 会一并注销
 *     （路由同样消失 → 404）。
 *  3. 顶层 `inject` **不**声明 webServer：那会让整个插件在无 webServer 的 profile
 *     （tui / headless）里 fiber PENDING、apply 根本不执行 —— 标题生成是主功能，不能陪葬。
 */
import { readFile } from 'node:fs/promises';
import { currentProfile, extractConfig, isTrustedApiRequest, patchFileOf, readJsonBody, writeJson, writePatchConfig, } from 'dsh-shared';
import { mergePatchEntries, normalizeConfigPatch } from './config.js';
/** 配置读写路由前缀（client 端 GET/PUT `<prefix>/config`）。 */
export const CONFIG_ROUTE_PREFIX = '/session-title-gen/api';
/** 写回行 id：必须与 plugins/dsh-session-title-gen/cordis.patch.yml 的插件行 id 一致
 *  （loader 按行 id 匹配配置，id 不符会新增孤儿行、原行配置不变）。 */
export const CONFIG_ROW_ID = 'session-title-gen';
/** 读取 patch 文件中该行已有的 config 块（文件不存在 / 解析失败 → 空对象）。 */
async function readExistingConfig(file) {
    try {
        return extractConfig(await readFile(file, 'utf8'), CONFIG_ROW_ID) ?? {};
    }
    catch {
        // 首次保存（文件还不存在）或文件不可读：按空配置合并，写入侧会创建目录。
        return {};
    }
}
/** 写回 profile 层 patch 文件：合并已有键后整体重写（保留用户手写的其它配置）。 */
export async function persistSettingsConfig(next) {
    const file = patchFileOf(currentProfile());
    await writePatchConfig(file, CONFIG_ROW_ID, mergePatchEntries(await readExistingConfig(file), next));
}
/** PUT 处理：校验 → 落盘（失败 500、内存不动）→ 回规整后的完整 8 项。 */
async function handleConfigPut(request, response, read, write) {
    let next;
    try {
        next = normalizeConfigPatch(await readJsonBody(request), read());
    }
    catch {
        next = undefined;
    }
    if (next === undefined) {
        writeJson(response, 400, { ok: false, error: { message: 'invalid config' } });
        return;
    }
    try {
        await write(next);
    }
    catch (error) {
        // 落盘失败绝不当成成功：client 侧据此提示「保存失败」，内存生效值保持原样。
        writeJson(response, 500, { ok: false, error: { message: `config write failed: ${String(error)}` } });
        return;
    }
    writeJson(response, 200, { ok: true, value: next });
}
/** 构造读写配置的 handler：fence → GET/PUT `<prefix>/config` → 403/404 兜底。 */
export function createConfigHandler(read, write) {
    return async (request, response) => {
        // loopback 信任围栏与 /api 网关同一契约（仅本机可访问；trustedHosts 本插件不使用）。
        if (!isTrustedApiRequest(request, [])) {
            writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
        }
        const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname;
        if (pathname === `${CONFIG_ROUTE_PREFIX}/config`) {
            if (request.method === 'GET') {
                writeJson(response, 200, { ok: true, value: read() });
                return;
            }
            if (request.method === 'PUT') {
                await handleConfigPut(request, response, read, write);
                return;
            }
        }
        writeJson(response, 404, { ok: false, error: { message: 'unknown dsh-session-title-gen API method' } });
    };
}
/** 已注册配置路由的 disposer（以常驻 root ctx 为键，用于重复 apply 去重）。 */
const routeDisposers = new WeakMap();
/** 在 inject 子 scope 上挂载配置路由；注册失败只告警，绝不让插件 fatal。 */
function mountConfigRoute(hostCtx, scope, state, onSaved) {
    // loader 会多次 apply 同一插件：root 常驻意味着上一轮注册不会自动消失，而宿主
    // WebServer.register 对重复 (kind, path) 直接抛错 → 先撤上一轮再注册。
    routeDisposers.get(hostCtx)?.();
    scope.effect(() => {
        const webServer = scope.webServer;
        try {
            const dispose = webServer?.register({
                kind: 'prefix',
                path: CONFIG_ROUTE_PREFIX,
                handler: createConfigHandler(() => state.current, async (next) => {
                    await persistSettingsConfig(next);
                    state.current = next;
                    onSaved(next);
                }),
            });
            if (dispose === undefined)
                return undefined;
            routeDisposers.set(hostCtx, dispose);
            return () => {
                if (routeDisposers.get(hostCtx) === dispose)
                    routeDisposers.delete(hostCtx);
                dispose();
            };
        }
        catch (error) {
            // 宿主拒绝注册（同 path 已被占用等）：降级为「无配置路由」，不冒泡成 fatal。
            scope.logger?.warn(`[dsh-session-title-gen] 配置路由注册被宿主拒绝：${String(error)}`);
            return undefined;
        }
    }, 'dsh-session-title-gen: config route');
}
/** 注册配置读写路由（契约见文件头）；无 webServer 的 profile 下静默不注册。 */
export function registerConfigRoute(ctx, state, onSaved) {
    const hostCtx = ctx.root ?? ctx;
    try {
        if (typeof hostCtx.inject !== 'function') {
            ctx.logger?.warn('[dsh-session-title-gen] ctx.inject 不可用，配置路由未注册（设置页不可用）');
            return;
        }
        hostCtx.inject(['webServer'], (scope) => mountConfigRoute(hostCtx, scope, state, onSaved));
    }
    catch (error) {
        // inactive ctx 上建 inject 子 fiber 可能抛错：降级为「无配置路由」，不 fatal。
        ctx.logger?.warn(`[dsh-session-title-gen] webServer 局部注入失败，配置路由未注册：${String(error)}`);
    }
}
