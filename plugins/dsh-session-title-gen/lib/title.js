/**
 * dsh-session-title-gen — title generation core.
 *
 * 纯函数 + LLM 生成：模板格式化、结构化判断、轻量流组装（只收集
 * text-delta 与 finish reason，不依赖 @deepseek-ai/dsh-llm 的
 * BlockAssembler）、标题折叠读取、UTF-8 截断。
 */
/** 默认格式模板：先归属后描述（类似 git commit 的 type(scope)）。 */
export const DEFAULT_TEMPLATE = '[{workspace}] {description}';
/**
 * Format a title from the template, replacing {workspace} and {description}.
 * @param template - format template with {workspace}/{description} placeholders.
 * @param workspace - workspace name (may be '').
 * @param description - LLM-generated description.
 * @returns the formatted one-line title, or '' when description is empty.
 */
export function formatTitle(template, workspace, description) {
    const desc = String(description ?? '').trim();
    if (desc === '')
        return '';
    const ws = String(workspace ?? '').trim();
    let tpl = String(template ?? DEFAULT_TEMPLATE);
    if (ws === '') {
        // 无工作区时移除 `[{workspace}]` 占位（split/join 无正则回溯，避免
        // 用户配置的 template 含大量空白时触发 ReDoS；`\s+` 规范化是线性匹配）
        tpl = tpl.split('[{workspace}]').join(' ');
    }
    const title = tpl.replaceAll('{workspace}', ws).replaceAll('{description}', desc);
    return title.replace(/\s+/g, ' ').trim();
}
/**
 * Heuristic: whether a title already looks structured (bracket-prefixed,
 * the default template shape `[workspace] description`).
 * @param title - title text to inspect.
 * @returns true when the title starts with a `[...]` prefix.
 */
export function isStructuredTitle(title) {
    return typeof title === 'string' && /^\[[^\]]+\]/.test(title);
}
/**
 * Lightweight stream assembly: collect text-delta text and the finish
 * reason kind from an llm.stream async iterable.
 * @param chunks - async iterable of stream chunks.
 * @returns { text, finish } — joined text and finish kind ('stop'/'error'/…).
 */
export async function collectStreamText(chunks) {
    let text = '';
    let finish = undefined;
    let failure = undefined;
    for await (const chunk of chunks) {
        if (chunk === null || typeof chunk !== 'object')
            continue;
        if (chunk.type === 'text-delta')
            text += chunk.text ?? '';
        else if (chunk.type === 'finish') {
            finish = chunk.reason?.kind;
            failure = chunk.reason?.failure;
        }
    }
    return { text, finish, failure };
}
/**
 * Fold the latest session/title event data from a session log.
 * @param session - live session (or mock) with an events array.
 * @returns the latest title event data, or undefined.
 */
export function foldTitle(session) {
    const events = session?.events;
    if (!Array.isArray(events))
        return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event?.type === 'session/title')
            return event.data;
    }
    return undefined;
}
/**
 * Truncate a string to a UTF-8 byte budget without splitting a code point.
 * @param input - title text.
 * @param maxBytes - positive byte budget.
 * @returns the longest leading code-point prefix within the budget.
 */
function truncateUtf8(input, maxBytes) {
    if (Buffer.byteLength(input, 'utf8') <= maxBytes)
        return input;
    let used = 0;
    let output = '';
    for (const character of input) {
        const bytes = Buffer.byteLength(character, 'utf8');
        if (used + bytes > maxBytes)
            break;
        output += character;
        used += bytes;
    }
    return output;
}
/**
 * Generate a structured title through the llm service.
 * @param ctx - context exposing the llm service.
 * @param options - { session, workspace, messages, route, signal, config }.
 * @returns { title, model } — formatted title and the used model route.
 * @throws when the LLM call fails, produces no text, or no route is available.
 */
export async function generateTitle(ctx, { session, workspace, messages, route, signal, config }) {
    const framed = frameMessages(messages);
    assertInputSize(framed, config.maxInputBytes);
    const resolved = resolveRoute(config, route);
    const options = buildOptions({ session, framed, route: resolved, signal, config });
    const { text, finish, failure } = await collectStreamText(ctx.llm.stream(options));
    assertFinish(finish, failure);
    const description = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const title = formatTitle(config.template, workspace, description);
    return { title: finalizeTitle(title, config.maxTitleBytes), model: resolved };
}
/** Frame exact messages as JSON so user text cannot break structural delimiters. */
function frameMessages(messages) {
    return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`;
}
/** Reject oversized input before it reaches the model. */
function assertInputSize(framed, maxInputBytes) {
    const inputBytes = Buffer.byteLength(framed, 'utf8');
    if (inputBytes > maxInputBytes) {
        throw new Error(`session-title-gen: input is ${inputBytes} bytes, exceeding maxInputBytes ${maxInputBytes}`);
    }
}
/** Resolve the explicit route pair or the session request route. */
function resolveRoute(config, route) {
    const provider = config.provider ?? route?.provider;
    const model = config.model ?? route?.model;
    if (provider === undefined || model === undefined) {
        throw new Error('session-title-gen: no LLM route available; configure provider and model together');
    }
    return { provider, model };
}
/** Build the llm.stream options for one title request. */
function buildOptions({ session, framed, route, signal, config, }) {
    return {
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: framed }] }],
        system: systemPrompt(),
        maxTokens: config.maxOutputTokens,
        sessionId: session.id,
        purpose: 'session-title',
        signal,
    };
}
/** Translate a terminal error finish into a thrown failure. */
function assertFinish(finish, failure) {
    if (finish === 'error') {
        throw new Error(`session-title-gen: LLM call failed: ${failure?.message ?? 'unknown error'}`);
    }
}
/** Normalize and truncate the formatted title; reject empty results. */
function finalizeTitle(title, maxBytes) {
    if (title === '')
        throw new Error('session-title-gen: title model produced an empty title');
    const truncated = truncateUtf8(title, maxBytes);
    if (truncated === '')
        throw new Error('session-title-gen: title empty after truncation');
    return truncated;
}
/** Stable system instruction: structured title, workspace first. */
function systemPrompt() {
    return [
        'Create a concise title for an AI coding-assistant session from the supplied human messages.',
        'The title MUST start with the workspace name in square brackets, then a brief description, like a git commit subject: [workspace] description.',
        'Return only the title on one line, in plain text of natural language, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
        'Use the language of the messages.',
        'Aim for about 8 words in non-CJK languages or 16 CJK characters for the description part.',
    ].join('\n');
}
