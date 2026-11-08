/**
 * dsh-my-memory — agent 记忆的四个工具（issue #502）。
 *
 * 工具面收敛为 4 个，全部限定在 $DSH_HOME/agent-memory/ 内（白名单见
 * paths.ts）。签名刻意做得像文件操作，但**不带任何元数据**——
 * `agent_memory_read` 返回的字节就是正文本身，一个多余字符都没有。
 *
 * 返回值纪律（issue #502）：**成功只有一个词 `ok`**，不汇报条数、不解释、
 * 不回显内容。失败才给可操作的原因。这条是「保存时不污染上下文」的落点：
 * agent 不会因为「已保存 2 条记忆」这类回显浪费 token。
 *
 * 为什么不用宿主 fs/read 直接读：$DSH_HOME 不在沙箱可写根内
 * （packages/sandbox/sandbox/src/roots.ts:52 只给 workspace + /tmp），
 * 且 fs-observation-policy 强制先读后写。自建工具是唯一可行路径，
 * 顺带把「路径逃逸 / 尺寸 / 敏感信息」三道硬门禁关在插件侧。
 */
import { basename } from 'node:path';
import { compressContentForWrite } from './compress.js';
import { createIndexStore } from './index-store.js';
import { createAgentMemoryStore } from './store.js';
import { DEFAULT_ARCHIVE_MS } from './paths.js';
import { cwdOf, globalScopeReject, resolveAlias } from './scope-guard.js';
/**
 * 四个工具共用的输出契约。
 *
 * 宿主 `tools.register()` **强制**要求 `output { schema, render }`：缺了直接抛
 * `TypeError: tool "…" must declare output { schema, render, presentationMeta? }`
 * （已装宿主 0.2.1-rc.3 实测），工具连注册都过不去——所以它既是契约也是门禁。
 * 本体系的成功值本来就是纯文本（成功一个 `ok`，失败一句可操作原因），故 schema
 * 就是 string，render 原样包一个 text block，模型看到的字节与之前完全一致。
 */
const TEXT_OUTPUT = Object.freeze({
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
});
/** 把 store 的返回摊平成模型可读的文本。 */
function renderRead(result) {
    return result.ok ? result.content : result.error;
}
/**
 * 渲染 list 结果：**一条记忆一行**，不是「一个文件一行」。
 *
 * 文件级概要等于让 agent 读文件名猜内容——它只能二选一：不读（猜错）或
 * 整份读（付一份正文）。条目级才能「先扫一遍，只读命中的那一份」。
 */
function renderList(items) {
    if (items.length === 0)
        return '（空）';
    return items.flatMap((item) => item.lines.map((line) => `${item.name} · ${line}`)).join('\n');
}
/** 写入后记录项目名（只在项目层文件、且 cwd 可用时）。 */
function rememberProjectOf(name, exec, remember) {
    if (remember === undefined)
        return;
    const id = projectIdFromName(name);
    const cwd = cwdOf(exec);
    if (id === '' || cwd === '')
        return;
    remember(id, basename(cwd));
}
/** agent_memory_list：列出可读的记忆文件（冷记忆不列出）。 */
function listTool({ store, resolveProjectPrefix }) {
    return {
        name: 'agent_memory_list',
        description: '列出你的跨会话记忆文件（文件名 + 概要）。不确定有没有相关记忆时先调用它。',
        parameters: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string',
                    enum: ['all', 'project'],
                    description: 'all（默认，全部）或 project（仅当前项目）',
                },
            },
            additionalProperties: false,
        },
        output: TEXT_OUTPUT,
        async execute(params, exec) {
            const scope = typeof params.scope === 'string' ? params.scope : 'all';
            const prefix = scope === 'project' ? await resolveProjectPrefix(cwdOf(exec)) : '';
            return renderList(await store.entries(prefix));
        },
    };
}
/** agent_memory_read：读一份正文（返回的字节就是正文本身，无元数据）。 */
function readTool({ store, resolveProjectPrefix }) {
    return {
        name: 'agent_memory_read',
        description: '读取一份跨会话记忆的正文。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '文件名，如 user.md / projects/<id>/pitfalls.md' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        output: TEXT_OUTPUT,
        async execute(params, exec) {
            const name = await resolveAlias(params.name, exec, resolveProjectPrefix);
            return renderRead(await store.read(name));
        },
    };
}
/** 渲染搜索结果：一条一行 `文件:行号 · 原文`（行号便于复核）。 */
function renderHits(hits) {
    if (hits.length === 0)
        return '（没有匹配的条目）';
    return hits.map((hit) => `${hit.name}:${hit.line} · ${hit.text}`).join('\n');
}
/** agent_memory_search：按关键词在**条目级**搜索（只读）。
 *
 *  渐进式加载的中间层——目录只给 30 字摘要、read 一次要整份（≤16 KB）；
 *  记忆一多，「这条在不在、在哪份文件」靠猜不准，靠 read 太贵。搜索一次就
 *  拿到「文件 + 行号 + 原文」，再决定要不要 read 全文。
 */
function searchTool({ store, resolveProjectPrefix }) {
    return {
        name: 'agent_memory_search',
        description: '按关键词搜索跨会话记忆的条目（只读）。返回命中的文件、行号与条目原文，比整份 read 省；不确定细节时先搜再决定 read 哪份。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '关键词；多个词以空格分隔时全部命中才算（不区分大小写）' },
                scope: {
                    type: 'string',
                    enum: ['all', 'project'],
                    description: 'all（默认，全部文件）或 project（仅当前项目文件）',
                },
                limit: { type: 'number', description: '最多返回几条（默认 20，上限 50）' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        output: TEXT_OUTPUT,
        async execute(params, exec) {
            const query = typeof params.query === 'string' ? params.query.trim() : '';
            if (query === '')
                return 'query 不能为空';
            const prefix = params.scope === 'project' ? await resolveProjectPrefix(cwdOf(exec)) : '';
            const limit = Number.isInteger(params.limit) ? Math.min(50, params.limit) : 20;
            return renderHits(await store.search(query, { prefix, limit }));
        },
    };
}
/** agent_memory_write：整份覆盖写入（成功只回 ok）。 */
function writeTool({ store, resolveProjectPrefix, rememberProject, compress, compressMinChars, }) {
    return {
        name: 'agent_memory_write',
        description: '写入一份跨会话记忆（整份覆盖）。写入前先用 agent_memory_read 读，已有同主题就合并或替换，绝不新增重复条目。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '文件名，如 user.md / projects/<id>/pitfalls.md' },
                content: { type: 'string', description: '完整正文（markdown）' },
            },
            required: ['name', 'content'],
            additionalProperties: false,
        },
        output: TEXT_OUTPUT,
        async execute(params, exec) {
            const name = await resolveAlias(params.name, exec, resolveProjectPrefix);
            // content 缺失时 String(undefined) 会变成空串 → 静默清空整份记忆并回 ok（实测 30 条归零）。
            if (typeof params.content !== 'string') {
                return '写入被拒绝：content 必须是完整正文字符串（本次没拿到，可能被截断）；先用 agent_memory_read 读回原文再整份写。';
            }
            const rejected = globalScopeReject(name, params.content, cwdOf(exec));
            if (rejected !== null)
                return rejected;
            // 写入前压缩长条目（agent 记忆专属）：失败一律按原文写，绝不阻塞。
            const content = await compressContentForWrite(params.content, compress === undefined ? undefined : (lines) => compress(lines, exec), compressMinChars);
            const result = await store.write(name, content);
            if (result.ok)
                rememberProjectOf(name, exec, rememberProject);
            return result.ok ? 'ok' : result.error;
        },
    };
}
/** agent_memory_delete：删除一份记忆。 */
function deleteTool({ store, resolveProjectPrefix }) {
    return {
        name: 'agent_memory_delete',
        description: '删除一份跨会话记忆。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '文件名' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        output: TEXT_OUTPUT,
        async execute(params, exec) {
            const name = await resolveAlias(params.name, exec, resolveProjectPrefix);
            const result = await store.remove(name);
            return result.ok ? 'ok' : result.error;
        },
    };
}
/** 从 projects/<id>/<file> 里取出项目 id；不是项目文件返回空串。 */
function projectIdFromName(name) {
    if (typeof name !== 'string')
        return '';
    const parts = name.split('/');
    return parts.length === 3 && parts[0] === 'projects' ? (parts[1] ?? '') : '';
}
/**
 * 构造 agent 记忆的运行时（index + store 单实例）。
 *
 * **必须全进程只有一份**：index.json 的持久化是「整份 cache 覆盖落盘」，
 * 两个实例各持一份 cache 时，一次面板写入会把工具侧 cache 里的旧值整体
 * 写回去（lost update——面板刚清掉的归档标记可能被回滚）。所以 index.ts
 * 建一份，工具与面板路由共用。
 */
export function createAgentMemoryRuntime({ logger, onChange, } = {}) {
    const index = createIndexStore({ logger });
    return { index, store: createAgentMemoryStore({ index, logger, onChange }) };
}
/** 构造五个工具定义（不含注册副作用，便于单测）。 */
export function createAgentMemoryTools(deps) {
    return [listTool(deps), readTool(deps), searchTool(deps), writeTool(deps), deleteTool(deps)];
}
/** 注册四个工具 + 启动时归档冷记忆；返回 disposer 集合。 */
export function registerAgentMemoryTools(ctx, { config, resolveProjectPrefix, runtime, compress, compressMinChars, }) {
    if (config?.enabled === false)
        return () => { };
    const { index, store } = runtime ?? createAgentMemoryRuntime({ logger: ctx.logger });
    const archiveMs = Number.isFinite(config?.archiveDays) && (config?.archiveDays ?? 0) > 0
        ? config.archiveDays * 24 * 60 * 60 * 1000
        : DEFAULT_ARCHIVE_MS;
    const rememberProject = (id, label) => void index.rememberProject(id, label);
    const disposers = createAgentMemoryTools({
        store,
        resolveProjectPrefix,
        rememberProject,
        compress,
        compressMinChars,
    }).map((tool) => ctx.tools?.register(tool));
    // 启动时归档一次冷记忆（不阻塞启动：失败只 warn）。
    void index
        .load()
        .then(() => store.archiveCold(archiveMs))
        .catch((error) => ctx.logger?.warn(`agent-memory: 冷记忆归档失败：${String(error)}`));
    return () => {
        disposers.forEach((dispose) => dispose?.());
        void index.flush().catch(() => { });
    };
}
/** 供测试/面板复用：判断一个名字是否合法。 */
