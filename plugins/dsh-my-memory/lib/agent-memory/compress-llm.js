/**
 * dsh-my-memory — 记忆压缩器的 LLM 实现（**只用于 agent 记忆写入**）。
 *
 * 走宿主 `ctx.llm.stream`，用**当前会话的模型路由**（`session.requestHeader().config`），
 * 不经过会话日志、不进对话上下文。任何一步失败（无 llm 服务 / 无路由 / 超时 /
 * 输出条数不符）都返回 null，由调用方按原文写入——压缩是优化，不是前置条件。
 */
import { parseCompressedBlock } from './compress.js';
/** 压缩器的系统提示：只删解释、保命令，行数必须一致。 */
export const COMPRESS_SYSTEM_PROMPT = [
    '你在为一份「跨会话记忆」做写入前压缩。输入是多条记忆条目（每行一条，已带 "- " 前缀）。',
    '对每一条：保留结论、约束、命令、路径、数字、专有名词与适用条件；删掉解释、举例、背景、语气词与重复表述。',
    '输出要求：行数与输入**完全一致**，一行一条，不要编号、不要解释、不要空行、不要代码围栏。',
    '某条已经足够精炼时原样输出；不得改写事实，不得合并或拆分条目。',
].join('\n');
/** 压缩超时（毫秒）：超时按原文写入，绝不让记忆写入卡在模型上。 */
export const DEFAULT_COMPRESS_TIMEOUT_MS = 8000;
/** exec 上的会话对象（形状不对时 undefined）。 */
function sessionOf(exec) {
    const agent = exec?.agent;
    const session = agent?.session;
    return typeof session === 'object' && session !== null ? session : undefined;
}
/** 会话 requestHeader 里的 config 段（拿不到时 undefined）。 */
function configOf(exec) {
    const session = sessionOf(exec);
    if (session === undefined)
        return undefined;
    const reader = session.requestHeader;
    if (typeof reader !== 'function')
        return undefined;
    const header = reader.call(session);
    const config = header?.config;
    return typeof config === 'object' && config !== null ? config : undefined;
}
function isRoutePart(value) {
    return typeof value === 'string' && value !== '';
}
/** 从工具执行上下文里取当前会话的模型路由（拿不到返回 null）。 */
function routeOf(exec) {
    const config = configOf(exec);
    return config !== undefined && isRoutePart(config.provider) && isRoutePart(config.model)
        ? { provider: config.provider, model: config.model }
        : null;
}
/**
 * 构造 LLM 压缩器：输入待压缩条目正文（不含 "- "），输出同数量的压缩条目。
 * 失败一律 null（调用方回退原文）。
 */
export function createLlmCompressor({ llm, timeoutMs = DEFAULT_COMPRESS_TIMEOUT_MS, }) {
    return async (lines, exec) => {
        const service = llm();
        const route = routeOf(exec);
        if (service === undefined || route === null)
            return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let text = '';
            const options = {
                provider: route.provider,
                model: route.model,
                system: COMPRESS_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: [{ type: 'text', text: lines.map((line) => '- ' + line).join('\n') }] }],
                temperature: 0,
                signal: controller.signal,
            };
            for await (const chunk of service.stream(options)) {
                if (chunk.type === 'text-delta' && typeof chunk.text === 'string')
                    text += chunk.text;
            }
            const parsed = parseCompressedBlock(text);
            return parsed.length === lines.length ? parsed : null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    };
}
