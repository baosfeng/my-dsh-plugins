/**
 * dsh-my-plugin-manager — host half.
 *
 * 公共插件管理面板（issue #2）：在 DSH 设置页统一维护插件生命周期——
 * 市场浏览/搜索（npm registry）、一键安装/卸载（`dsh plugin` CLI）、
 * 更新检查（pnpm outdated）、已安装清单（官方 pluginInventory）。
 *
 * 纯官方依赖：server 只用 pluginInventory / webServer / webRuntime 服务；
 * client 面板挂在官方 slots 扩展点（设置 → 插件），不依赖第三方插件。
 * 安装/卸载通过 `dsh plugin --profile <p> add|remove` 落盘（与 CLI 同一
 * 数据源），新插件在下次重启时由 loader（或 guardian 候选区）加载。
 */
import { currentProfile, isTrustedApiRequest, profileDirOf } from 'dsh-shared';
import { createApiHandler } from './api-route.js';
export const name = 'dsh-my-plugin-manager';
export const inject = ['pluginInventory', 'webServer', 'webRuntime'];
export function apply(ctx) {
    const profile = currentProfile();
    const profileDir = profileDirOf(profile);
    const fence = (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/my-plugin-manager/api',
        handler: createApiHandler({ ctx, profile, profileDir, fence }),
    }), 'dsh-my-plugin-manager: /my-plugin-manager/api routes');
    ctx.logger?.info(`[dsh-my-plugin-manager] 插件管理器已启用（profile=${profile}）`);
}
