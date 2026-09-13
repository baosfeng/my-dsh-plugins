/**
 * dsh-my-context — host half.
 *
 * 上下文透镜 + 成本治理：
 *  1. 上下文透镜：监听 `session/event` 统计每次请求的 token 用量与上下文
 *     构成（system/tools/user/inject/assistant/tool 分类估算 + 真实 usage
 *     input/output/cacheRead/cacheWrite），按会话隔离、重启后恢复
 *     （持久化 $DSH_HOME/context/context.json，防抖 + 原子写）；
 *  2. 成本治理：token 计量（真实 usage 累加）+ 每轮/每会话预算配置
 *     （token 上限），超限提醒（warn）/拦截（deny，agent/pre-step 返回
 *     { kind: 'reject' } 结束本轮）。
 *
 * 模块结构：
 *  - fence.js    — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - meter.js    — token 估算（与 dsh token-meter 一致的固定密度纯函数）
 *  - store.js    — 会话上下文统计存储（会话隔离 / 重启恢复 / 上限 / 原子持久化）
 *  - budget.js   — 预算检查与配置校验（纯函数）
 *  - events.js   — 事件监听（session/event 统计 + agent/pre-step 预算拦截）
 *  - routes.js   — /context/api 路由
 *
 * 宿主契约（issue #242）：profile 插件的 fiber 会被 DSH loader 在 apply 结束后
 * 回收——注册在插件自身 ctx 上的监听器/路由会随之静默消失（事件 0 触发、
 * /context/api 404，且无任何报错）。因此会话监听与路由都注册到**常驻 root**，
 * 详见 events.ts 的 rootListeners 与 routes.ts 的 rootRoutes。
 */
import { createStore } from './store.js';
import { attachContextListeners } from './events.js';
import { registerContextRoutes } from './routes.js';
import { normalizeBudgetConfig } from './budget.js';
import { normalizeOverflowConfig } from './overflow.js';
export const name = 'dsh-my-context';
export const inject = ['webServer'];
export function apply(ctx, config) {
    // ── 配置（应用层 config 覆盖，默认全部关闭；POST /budget / /overflow 可动态更新）──
    const options = { current: normalizeBudgetConfig(config), overflow: normalizeOverflowConfig(config) };
    // ── 上下文统计存储：会话隔离 + 持久化 + 重启恢复 ──────────────────────
    const store = createStore(ctx);
    // ── 事件监听（只读观察 + 预算拦截）───────────────────────────────────
    attachContextListeners(ctx, store, options);
    // ── 路由（查询 / 预算配置）────────────────────────────────────────────
    registerContextRoutes(ctx, store, options);
    // ── 卸载冲刷：清防抖定时器 + 立即落盘 ────────────────────────────────
    // 同样挂到常驻 root：若挂插件 fiber，fiber 被回收时 store.dispose 会被立即
    // 调用（清掉防抖定时器 → 统计不再落盘）。
    const listenCtx = ctx.root ?? ctx;
    listenCtx.effect(() => store.dispose, 'dsh-my-context: persistence teardown');
}
