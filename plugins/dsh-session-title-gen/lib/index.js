/**
 * dsh-session-title-gen — structured session title generation (issue #160)。
 *
 * 监听会话首条人类消息，用 LLM 生成类似 git commit 的结构化标题
 * （先归属后描述，如 `[my-dsh-plugins] 修复 #143 记忆页签崩溃`），经核心
 * `session/title` 事件写入（log-backed，重启保留）。
 *
 * 与核心 dsh-session-title 的协作：
 *  - 核心 bundle 已注册唯一 provider（session-title-first-prompt-llm），
 *    本插件不注册 provider，直接 append session/title 事件覆盖；
 *  - 核心 fallback/provider 生成的非结构化标题会触发本插件重新生成
 *    （监听 session/title 事件兜底竞态）；
 *  - 生成失败不 append（核心标题保留，不阻塞会话）。
 *
 * 宿主契约适配见 host.ts（issue #232：profile 插件的 events 实例隔离、
 * Session.events 私有化、插件 ctx 在监听器执行时已 inactive），
 * 单会话生成流程见 generate.ts。
 *
 * 配置面（issue #385）：8 项配置经「设置 → 插件 → 会话标题生成」可视化编辑，
 * 保存写回 profile 的 cordis.patch.yml 并**热生效** —— 配置端点与注册契约见
 * config-routes.ts，默认值与规整口径见 config.ts。
 */
import { resolveConfig, toTitleConfig } from './config.js';
import { registerConfigRoute } from './config-routes.js';
import { generateSessionTitle, isUserMessage, shouldSkip } from './generate.js';
import { createWarn, listenSessionEvents, selectLlm, stopSessionEvents } from './host.js';
export const name = 'dsh-session-title-gen';
export const inject = ['llm'];
export function apply(ctx, config) {
    // 生效值容器：设置页保存后原地更新（热生效），生成逻辑每次读最新值。
    const state = { current: resolveConfig(config) };
    const generating = new Map();
    // 注册点与服务都必须按宿主 root 规则取（详见 host.ts）：会话事件只在 root 的
    // events 实例上派发，而插件 ctx 在监听器执行时已 inactive，动态取服务会抛错。
    const listenCtx = ctx.root ?? ctx;
    const llm = selectLlm(listenCtx, ctx.llm);
    const warn = createWarn(ctx.logger);
    let listening = false;
    /** 挂载 / 卸载 session/event 监听（设置页保存 enabled 后立即热切换）。 */
    function syncListeners(enabled) {
        if (enabled === listening)
            return;
        listening = enabled;
        if (enabled)
            listenSessionEvents(listenCtx, onSessionEvent);
        else
            stopSessionEvents(listenCtx);
    }
    // 配置路由**无条件注册**（含禁用状态）：否则用户在设置页里没有入口把插件重新打开；
    // enabled=false 只影响标题生成，不影响配置面。
    registerConfigRoute(ctx, state, (next) => syncListeners(next.enabled));
    syncListeners(state.current.enabled);
    ctx.effect(() => () => {
        generating.clear();
    }, 'dsh-session-title-gen: state lifecycle');
    ctx.logger?.info(`[dsh-session-title-gen] 结构化会话标题${state.current.enabled ? '已启用' : '已禁用（可在「设置 → 插件」中开启）'}`);
    /** session/event 监听器：人类消息或标题事件触发结构化标题生成。 */
    function onSessionEvent(session, event) {
        const sess = session;
        const evt = event;
        if (evt?.type === 'user/message') {
            if (!isUserMessage(evt))
                return;
            return maybeGenerate(sess);
        }
        if (evt?.type === 'session/title')
            return maybeGenerate(sess);
        return undefined;
    }
    /** 生成结构化标题（fire-and-forget；同一会话同时只跑一次）。 */
    async function maybeGenerate(session) {
        if (session === null || typeof session !== 'object' || typeof session.id !== 'string')
            return;
        if (shouldSkip(session))
            return;
        if (state.current.enabled === false)
            return;
        if (generating.get(session.id)?.generating)
            return;
        const promise = generateSessionTitle({ session, llm, warn, config: toTitleConfig(state.current) });
        generating.set(session.id, { generating: promise });
        try {
            await promise;
        }
        finally {
            generating.delete(session.id);
        }
    }
}
