/**
 * dsh-my-skill-manager — host half.
 *
 * Skill 管理（issue #23）：分「全局 / 项目」查看 skill 列表、按项目启用/禁用。
 *
 *  - 禁用机制：向 `ctx.skills` 注册一个 rank-0 占位 provider（全局层），
 *    被禁用的 skill 名在合并目录里被占位覆盖（filesystem rank 100–500、
 *    runtime 250 都低于 rank 0 优先级…… 注：rank 数值越小优先级越高），
 *    模型侧只见「已禁用」占位、`get()` 拒绝加载正文；`list()` 按会话 cwd
 *    解析项目配置，因此禁用可按项目生效、也可在项目内禁用全局 skill。
 *  - 配置：全局 `$DSH_HOME/skills.enabled.json` + 项目
 *    `<projectRoot>/.dsh/skills.enabled.json`（随仓库版本化）。
 *  - 使用统计（issue #91）：包装 `ctx.skills.get()`——skill 正文被加载
 *    （模型 skill 工具 / 用户 /name 手势注入）即计数；`tools/pre-execute`
 *    标记模型来源；持久化 `$DSH_HOME/skills.usage.json`（防抖 + 原子写）。
 *  - Client：官方 slots 注册「设置 → 插件」下的 Skill 管理页签（纯官方
 *    依赖，不依赖 dsh-better-sidebar）。
 */
import { isTrustedApiRequest } from 'dsh-shared';
import { createApiHandler } from './api-route.js';
import { createDisablerProvider } from './provider.js';
import { createUsageStore, recordUsage, usageFile } from './usage.js';
export const name = 'dsh-my-skill-manager';
export const inject = ['skills', 'webServer', 'webRuntime', 'sessions'];
export function apply(ctx) {
    // 禁用占位 provider：配置变化时 invalidate 让 skill 目录立即重算。
    let invalidate = () => { };
    const disposer = ctx.skills.registerProvider((control) => {
        invalidate = () => control.invalidate();
        return createDisablerProvider();
    });
    ctx.effect(() => disposer, 'dsh-my-skill-manager: disabler provider');
    // 使用统计（issue #91）：包装 ctx.skills.get——成功加载 skill 正文即计数。
    // 来源判定：tools/pre-execute 标记最近一次模型 skill 工具调用；get 命中
    // 该标记记 model，否则记 user（用户 /name 手势注入等）。
    const usage = createUsageStore({ file: usageFile(), logger: ctx.logger });
    let pendingModelSkill = null;
    const originalGet = ctx.skills?.get;
    if (typeof originalGet === 'function') {
        const boundGet = originalGet.bind(ctx.skills);
        ctx.skills.get = async (skillName, options) => {
            const skill = await boundGet(skillName, options);
            const source = pendingModelSkill === skillName ? 'model' : 'user';
            if (pendingModelSkill === skillName)
                pendingModelSkill = null;
            if (skill !== undefined)
                recordUsage(usage, skillName, source);
            return skill;
        };
    }
    const usageDisposers = [
        ctx.on('tools/pre-execute', (...args) => {
            const exec = args[0];
            const next = args[1];
            if (exec !== null && typeof exec === 'object') {
                const call = exec;
                if (call.name === 'skill' && typeof call.arguments?.name === 'string') {
                    pendingModelSkill = call.arguments.name;
                }
            }
            return next();
        }),
    ];
    ctx.effect(() => () => {
        for (const dispose of usageDisposers) {
            if (typeof dispose === 'function')
                dispose();
        }
        if (typeof originalGet === 'function' && ctx.skills !== null && ctx.skills !== undefined) {
            ctx.skills.get = originalGet;
        }
    }, 'dsh-my-skill-manager: usage listeners');
    const fence = (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts);
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/my-skill-manager/api',
        handler: createApiHandler({ ctx, invalidate, fence, usage }),
    }), 'dsh-my-skill-manager: /my-skill-manager/api routes');
}
