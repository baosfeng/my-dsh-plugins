/**
 * dsh-my-remote — server 端入口（TypeScript 源码）。
 *
 * 远程控制插件：离开电脑后仍可在手机上回答 ask、批准 approval、查询状态、
 * 继续会话。架构分层（与 issue #75 建议一致）：
 *
 *  - 事件层（events.ts）   ：监听 agent/status（end）、tools/execute（ask）、
 *                            approval/request（approval）；ask/approval 用
 *                            Promise.race 等待远程回答/批准，短路注入 DSH 流程
 *  - 指令层（commands.ts） ：入站指令白名单（answer/approve/continue）+ 状态
 *                            快照 + 操作审计
 *  - 渠道层（channels.ts） ：事件下行到外部通道（HTTP webhook 先行；微信/QQ/
 *                            飞书机器人按同一适配器契约扩展）
 *  - 安全层                ：loopback 围栏（dsh-shared isTrustedApiRequest）
 *                            + apiToken（写指令 x-remote-token）+ 指令白名单
 *                            + 操作审计（远程控制比通知更敏感，操作留痕）
 *
 * 配置（应用层 config 覆盖，默认全部开启）：
 *  - end / ask / approval  事件下行开关（默认 true）
 *  - apiToken              写指令鉴权 token（默认空 = 不要求，仅 fence 保护）
 *  - webhooks              出站事件 webhook 列表（{ name, url, events?,
 *                            enabled?, headers? }）
 *  - askTimeoutMs          远程回答等待超时（0 = 无限，默认 0；超时返回空
 *                            answers 由模型自行决策）
 *  - approvalTimeoutMs     远程批准等待超时（0 = 无限，默认 0；超时 fail-closed
 *                            拒绝）
 *
 * 可选服务一律经 ctx.get 读取（agents / sessionTitle / webRuntime）。
 */
import { attachEvents } from './events.js';
import { createAskRegistry, createApprovalRegistry } from './registries.js';
import { createChannels } from './channels.js';
import { registerRemoteRoutes } from './routes.js';
import { createAuditLog } from './audit.js';
import { titleOf, isTopLevelAgent } from './session.js';
export const name = 'dsh-my-remote';
export const inject = ['webServer'];
export function apply(ctx, config) {
    // ── 配置（应用层 config 覆盖，默认全部开启）─────────────────────────
    const options = buildOptions(config);
    // ── 共享上下文：注册表 + 审计 + 渠道（监听与路由共享）───────────────
    const shared = {
        ctx,
        options,
        logger: ctx.logger,
        askRegistry: createAskRegistry(),
        approvalRegistry: createApprovalRegistry(),
        audit: createAuditLog(),
        channels: createChannels(options, { logger: ctx.logger }),
        titleOf,
        isTopLevelAgent,
    };
    // ── 事件层（end/ask/approval 监听 + 远程回答/批准 race）──────────────
    attachEvents(ctx, shared);
    // ── 路由（/remote/api：command/status/audit/info + fence + token）────
    registerRemoteRoutes(ctx, shared);
    ctx.logger?.info(`[dsh-my-remote] 远程控制已启用（end=${options.end ? 'on' : 'off'}，ask=${options.ask ? 'on' : 'off'}，approval=${options.approval ? 'on' : 'off'}，webhooks=${(options.webhooks ?? []).length}）`);
}
/** 应用层配置 → options（默认值 + 类型规整）。 */
function buildOptions(config) {
    const c = config ?? {};
    return {
        end: notFalse(c.end),
        ask: notFalse(c.ask),
        approval: notFalse(c.approval),
        apiToken: str(c.apiToken),
        webhooks: Array.isArray(c.webhooks) ? c.webhooks : [],
        askTimeoutMs: nonNegInt(c.askTimeoutMs, 0),
        approvalTimeoutMs: nonNegInt(c.approvalTimeoutMs, 0),
    };
}
/** 布尔开关默认开启：缺省/true → true，false → false。 */
function notFalse(value) {
    return value !== false;
}
/** 字符串字段规整：缺失/非字符串回退空串。 */
function str(value) {
    return typeof value === 'string' ? value : '';
}
/** 非负整数规整：非法/负数回退 fallback。 */
function nonNegInt(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}
