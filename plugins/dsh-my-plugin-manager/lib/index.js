/**
 * dsh-my-plugin-manager — host half.
 *
 * 插件市场与更新检查面板：只做官方插件管理**没有**的三项增量——
 *  1. npm 市场关键词搜索（官方 install 只接受 spec 文本，无市场浏览）；
 *  2. 更新检查（官方无 outdated / latest 面）；
 *  3. 插件详情增强（README / 版本历史 / 依赖 / 月下载量）。
 *
 * 安装 / 卸载 / 启停 / 清单管理**已下线**：官方默认内置（bundle/web-app 默认装载
 * ui-plugin-manager、tool-plugin-manager 与 `dsh plugin` CLI），本插件在设置页做可写
 * 管理与之冲突（官方刻意让设置页插件列表只读），故不再重复实现。
 *
 * 纯官方依赖：server 只用 webServer / webRuntime 服务；client 面板挂在官方 slots
 * 扩展点（设置 → 插件），不依赖任何第三方插件。
 */
import { currentProfile, isTrustedApiRequest } from 'dsh-shared';
import { createApiHandler } from './api-route.js';
export const name = 'dsh-my-plugin-manager';
export const inject = ['webServer', 'webRuntime'];
export function apply(ctx) {
    const profile = currentProfile();
    const fence = (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/my-plugin-manager/api',
        handler: createApiHandler({ ctx, profile, fence }),
    }), 'dsh-my-plugin-manager: /my-plugin-manager/api routes');
    ctx.logger?.info(`[dsh-my-plugin-manager] 插件市场面板已启用（profile=${profile}）`);
}
