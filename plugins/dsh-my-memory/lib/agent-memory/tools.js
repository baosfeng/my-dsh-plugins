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
import { createIndexStore } from './index-store.js';
import { createAgentMemoryStore } from './store.js';
import { DEFAULT_ARCHIVE_MS } from './paths.js';
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
/** 会话 cwd（用于拼项目作用域路径）。 */
function cwdOf(exec) {
    const agent = exec?.agent;
    return agent?.session?.header?.cwd ?? '';
}
/** 项目作用域的别名前缀：agent 不必知道项目 id（宿主按项目根 hash 生成）。 */
const CURRENT_PROJECT = 'projects/current/';
/**
 * 把 `projects/current/…` 解析为当前项目的真实前缀，其余名字原样返回。
 *
 * 项目 id 是宿主按项目根算出来的 hash，agent 无从得知也不该背——它只写
 * 「当前项目」，解析交给系统。list 返回的仍是真实路径，两者指向同一文件。
 */
async function resolveAlias(rawName, exec, resolveProjectPrefix) {
    if (typeof rawName !== 'string')
        return rawName;
    const cleaned = rawName.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!cleaned.startsWith(CURRENT_PROJECT))
        return rawName;
    const prefix = await resolveProjectPrefix(cwdOf(exec));
    return prefix + cleaned.slice(CURRENT_PROJECT.length);
}
/** 全局层文件（agent 可写，但要过「通用性」护栏）。 */
const GLOBAL_FILES = new Set(['user.md', 'feedback.md', 'MEMORY.md']);
/** 项目专属标识：带扩展名的仓库内路径、本机地址、端口。 */
const PROJECT_MARKERS = Object.freeze([
    /\bscripts\/[\w.-]+/, // scripts/debug-cli.sh
    /\bsrc\/[\w-]+\/[\w.-]+/, // src/client/foo.ts
    /\bapps\/[\w-]+\/[\w.-]+/, // apps/web/src/x.ts
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // 124.222.x.x
    /\blocalhost:\d{2,5}\b/, // localhost:3080
]);
/**
 * 全局层写入护栏：**含项目专属标识的条目不许进全局**。
 *
 * 这是确定性规则、不是模型判断：一条「走 scripts/debug-cli.sh」写进全局，
 * 就会在每个项目里误导 agent（真实事故就是这么发生的）。判据只认「这条
 * 内容里有没有指向某个具体仓库的东西」，命中就要求改写进项目层——误判的
 * 代价是 agent 改写一次，漏判的代价是全局污染，两者不对称。
 *
 * @returns null 表示放行；否则返回给 agent 的可操作提示。
 */
export function globalScopeReject(name, content, cwd) {
    if (typeof name !== 'string' || !GLOBAL_FILES.has(name))
        return null;
    if (typeof content !== 'string')
        return null;
    const repo = cwd === '' ? '' : basename(cwd);
    const haystack = content;
    const hit = PROJECT_MARKERS.find((pattern) => pattern.test(haystack));
    if (hit !== undefined) {
        return '这条含项目专属标识（路径 / 地址 / 端口），请写 projects/current/…；全局层只放跨项目通用的能力';
    }
    if (repo.length >= 4 && haystack.includes(repo)) {
        return `这条点名了当前仓库（${repo}），请写 projects/current/…；只有换个项目仍成立的内容才进全局`;
    }
    return null;
}
/** 把 store 的返回摊平成模型可读的文本。 */
function renderRead(result) {
    return result.ok ? result.content : result.error;
}
/**
 * 渲染 list 结果：**一条记忆一行**，不是「一个文件一行」。
 *
 * 文件级概要等于让 agent 读文件名猜内容——它只能二选一：不读（猜错）或
 * 整份读（付 4 KB）。条目级才能「先扫一遍，只读命中的那一份」。
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
/** agent_memory_write：整份覆盖写入（成功只回 ok）。 */
function writeTool({ store, resolveProjectPrefix, rememberProject }) {
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
            const rejected = globalScopeReject(name, params.content, cwdOf(exec));
            if (rejected !== null)
                return rejected;
            const result = await store.write(name, params.content);
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
/** 构造四个工具定义（不含注册副作用，便于单测）。 */
export function createAgentMemoryTools(deps) {
    return [listTool(deps), readTool(deps), writeTool(deps), deleteTool(deps)];
}
/** 注册四个工具 + 启动时归档冷记忆；返回 disposer 集合。 */
export function registerAgentMemoryTools(ctx, { config, resolveProjectPrefix, runtime, }) {
    if (config?.enabled === false)
        return () => { };
    const { index, store } = runtime ?? createAgentMemoryRuntime({ logger: ctx.logger });
    const archiveMs = Number.isFinite(config?.archiveDays) && (config?.archiveDays ?? 0) > 0
        ? config.archiveDays * 24 * 60 * 60 * 1000
        : DEFAULT_ARCHIVE_MS;
    const rememberProject = (id, label) => void index.rememberProject(id, label);
    const disposers = createAgentMemoryTools({ store, resolveProjectPrefix, rememberProject }).map((tool) => ctx.tools?.register(tool));
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
