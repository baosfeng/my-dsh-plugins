/**
 * dsh-session-title-gen — structured session title generation (issue #160).
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
 */
import { generateSessionTitle, isUserMessage, shouldSkip } from './generate.js';
import { createWarn, listenSessionEvents, selectLlm } from './host.js';
import { DEFAULT_TEMPLATE } from './title.js';
export const name = 'dsh-session-title-gen';
export const inject = ['llm'];
/** 默认配置（可被 cordis.patch.yml config 覆盖）。 */
const DEFAULTS = {
    enabled: true,
    template: DEFAULT_TEMPLATE,
    provider: undefined,
    model: undefined,
    maxTitleBytes: 80,
    maxInputBytes: 4096,
    maxOutputTokens: 64,
    timeoutMs: 30000,
};
export function apply(ctx, config) {
    const cfg = resolveConfig(config);
    if (!cfg.enabled)
        return;
    const state = new Map();
    // 注册点与服务都必须按宿主 root 规则取（详见 host.ts）：会话事件只在 root 的
    // events 实例上派发，而插件 ctx 在监听器执行时已 inactive，动态取服务会抛错。
    const listenCtx = ctx.root ?? ctx;
    const llm = selectLlm(listenCtx, ctx.llm);
    const warn = createWarn(ctx.logger);
    listenSessionEvents(listenCtx, onSessionEvent);
    ctx.effect(() => () => {
        state.clear();
    }, 'dsh-session-title-gen: state lifecycle');
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
        if (state.get(session.id)?.generating)
            return;
        const promise = generateSessionTitle({ session, llm, warn, config: cfg });
        state.set(session.id, { generating: promise });
        try {
            await promise;
        }
        finally {
            state.delete(session.id);
        }
    }
}
/** 配置解析：缺省值 + 类型护栏。 */
function resolveConfig(config) {
    const candidate = config ?? {};
    return {
        enabled: candidate.enabled !== false,
        template: nonEmptyString(candidate.template, DEFAULTS.template),
        provider: nonEmptyString(candidate.provider, DEFAULTS.provider),
        model: nonEmptyString(candidate.model, DEFAULTS.model),
        maxTitleBytes: positiveInt(candidate.maxTitleBytes, DEFAULTS.maxTitleBytes),
        maxInputBytes: positiveInt(candidate.maxInputBytes, DEFAULTS.maxInputBytes),
        maxOutputTokens: positiveInt(candidate.maxOutputTokens, DEFAULTS.maxOutputTokens),
        timeoutMs: positiveInt(candidate.timeoutMs, DEFAULTS.timeoutMs),
    };
}
function nonEmptyString(value, fallback) {
    return typeof value === 'string' && value !== '' ? value : fallback;
}
function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
