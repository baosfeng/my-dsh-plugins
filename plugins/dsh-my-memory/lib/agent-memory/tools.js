/**
 * dsh-my-memory — agent 记忆的四个工具（issue #502）。
 *
 * 工具面收敛为 4 个，全部限定在 $DSH_HOME/agent-memory/ 内（白名单见
 * paths.ts）。签名刻意做得像文件操作，但**不带任何元数据**——
 * `memory_read` 返回的字节就是正文本身，一个多余字符都没有。
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
import { createIndexStore } from './index-store.js';
import { createAgentMemoryStore } from './store.js';
import { DEFAULT_ARCHIVE_MS } from './paths.js';
/** 会话 cwd（用于拼项目作用域路径）。 */
function cwdOf(exec) {
    const agent = exec?.agent;
    return agent?.session?.header?.cwd ?? '';
}
/** 把 store 的返回摊平成模型可读的文本。 */
function renderRead(result) {
    return result.ok ? result.content : result.error;
}
/** 渲染 list 结果。 */
function renderList(items) {
    if (items.length === 0)
        return '（空）';
    return items.map((item) => (item.firstLine === '' ? item.name : `${item.name} — ${item.firstLine}`)).join('\n');
}
/** agent_memory_list：列出可读的记忆文件（冷记忆不列出）。 */
function listTool({ store, resolveProjectPrefix }) {
    return {
        name: 'agent_memory_list',
        description: '列出你的跨会话记忆文件（冷记忆不列出）。不确定有没有相关记忆时先调用它。',
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
        async execute(params, exec) {
            const scope = typeof params.scope === 'string' ? params.scope : 'all';
            const prefix = scope === 'project' ? await resolveProjectPrefix(cwdOf(exec)) : '';
            return renderList(await store.list(prefix));
        },
    };
}
/** agent_memory_read：读一份正文（返回的字节就是正文本身，无元数据）。 */
function readTool({ store }) {
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
        async execute(params) {
            return renderRead(await store.read(params.name));
        },
    };
}
/** agent_memory_write：整份覆盖写入（成功只回 ok）。 */
function writeTool({ store }) {
    return {
        name: 'agent_memory_write',
        description: '写入一份跨会话记忆（整份覆盖）。写入前先用 memory_read 读，已有同主题就合并或替换，绝不新增重复条目。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '文件名，如 user.md / projects/<id>/pitfalls.md' },
                content: { type: 'string', description: '完整正文（markdown）' },
            },
            required: ['name', 'content'],
            additionalProperties: false,
        },
        async execute(params) {
            const result = await store.write(params.name, params.content);
            return result.ok ? 'ok' : result.error;
        },
    };
}
/** agent_memory_delete：删除一份记忆。 */
function deleteTool({ store }) {
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
        async execute(params) {
            const result = await store.remove(params.name);
            return result.ok ? 'ok' : result.error;
        },
    };
}
/** 构造四个工具定义（不含注册副作用，便于单测）。 */
export function createAgentMemoryTools(deps) {
    return [listTool(deps), readTool(deps), writeTool(deps), deleteTool(deps)];
}
/** 注册四个工具 + 启动时归档冷记忆；返回 disposer 集合。 */
export function registerAgentMemoryTools(ctx, { config, resolveProjectPrefix, }) {
    if (config?.enabled === false)
        return () => { };
    const index = createIndexStore({ logger: ctx.logger });
    const store = createAgentMemoryStore({ index, logger: ctx.logger });
    const archiveMs = Number.isFinite(config?.archiveDays) && (config?.archiveDays ?? 0) > 0
        ? config.archiveDays * 24 * 60 * 60 * 1000
        : DEFAULT_ARCHIVE_MS;
    const disposers = createAgentMemoryTools({ store, resolveProjectPrefix }).map((tool) => ctx.tools?.register(tool));
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
