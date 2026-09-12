/**
 * dsh-my-memory — the `memory_query` (read-only) and `memory_save` tools.
 *
 * Registered through `ctx.tools.register` with a hand-built ToolDefinition
 * (no `@deepseek-ai/dsh-tools` import — plugins in this repo resolve only
 * Node builtins and relative modules, so the definition is constructed
 * directly with JSON-Schema parameters/output, which the registry accepts).
 *
 * `memory_query` is strictly read-only: it never mutates the stores. It lists
 * the global or project memories, optionally filtered by a keyword substring.
 * The project scope resolves its cwd from the calling agent's session
 * (`exec.agent.session.header.cwd`) unless the model passes one explicitly.
 *
 * `memory_save` lets the agent persist a memory the user wants kept. It never
 * changes memory silently: a `tools/pre-execute` gate (`createMemorySaveGate`)
 * answers every `memory_save` call with `{ kind: 'ask', reason }`, which
 * triggers the DSH native approval flow — the write lands only after the user
 * confirms it. Since issue #208 the gate is **approval-policy aware**: under
 * `policy = never` (the `danger-full-access` preset) the host auto-rejects
 * every ask, so the configurable `saveApproval` strategy either writes
 * directly (`'auto'`, entries still carry their session source) or denies
 * with an actionable hint (`'always'`) — see `save-policy.ts`. Writes are
 * stamped with the calling session id and timestamp (issue #209). The
 * `proactivePropose` config switch (default off, issue #78 phase) only shapes
 * the tool description: on, the description tells the agent it may propose
 * saving memories it notices; off, the agent saves on request.
 */
import { findProjectRoot } from 'dsh-shared';
import { CATEGORIES, makeSource } from './memory-scoring.js';
/** Filter items by a keyword substring (case-insensitive); no filter when empty. */
export function filterItems(items, keyword) {
    const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : '';
    if (needle === '')
        return items;
    return items.filter((item) => item.desc.toLowerCase().includes(needle));
}
/** Render one query result as model-facing text. */
export function renderQueryResult(value) {
    const scopeLabel = value.scope === 'project' ? '项目' : '全局';
    const where = value.scope === 'project' && value.projectRoot !== ''
        ? `（项目：${value.projectRoot}）`
        : value.scope === 'project'
            ? '（项目目录未知）'
            : '';
    if (value.items.length === 0)
        return `没有找到${scopeLabel}记忆${where}。`;
    const lines = value.items.map((item) => `- [${item.id}] ${item.desc}${sourceLabelOf(item)}`);
    return `${scopeLabel}记忆${where}（${value.items.length} 条）：\n${lines.join('\n')}`;
}
/** 条目的来源标注（issue #209）：有来源会话时附上会话 id 前缀，便于区分
 *  agent 自动保存与用户手动添加；无来源（旧数据/手动）不加任何后缀。 */
function sourceLabelOf(item) {
    const sessionId = typeof item?.source?.sessionId === 'string' ? item.source.sessionId : '';
    return sessionId === '' ? '' : `（来源：会话 ${sessionId.slice(0, 8)}）`;
}
/** memory_query parameters (JSON Schema; the registry projects them to the model). */
const QUERY_PARAMETERS = {
    type: 'object',
    properties: {
        scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: '查询范围：global（全局记忆）或 project（当前项目记忆）',
        },
        keyword: {
            type: 'string',
            description: '可选：按记忆内容包含的关键词过滤（不区分大小写）',
        },
        cwd: {
            type: 'string',
            description: '可选：项目记忆的项目目录（默认取当前会话的工作目录）',
        },
    },
    required: ['scope'],
    additionalProperties: false,
};
/** 记忆分类枚举（与 memory-scoring 的 CATEGORIES 同源，schema 单一来源）。 */
const MEMORY_CATEGORIES = [...CATEGORIES];
/** 记忆状态枚举（与 memory-scoring 的 statusOf 同源）。 */
const MEMORY_STATUSES = ['active', 'conflict-pending'];
/**
 * 记忆条目字段 JSON Schema 片段——**单一来源**（issue #191）。
 *
 * store 返回的条目恒定带这 10 个字段（`withDefaults` 恒补齐，见
 * memory-scoring），schema 必须与真实形状同源：字段增减只改这里，
 * `QUERY_OUTPUT` / `SAVE_OUTPUT` 都直接复用本常量，避免契约与实现再次
 * 漂移（#191 的根因）。
 *
 * 导出策略：只导出被消费的完整 `MEMORY_ITEM_SCHEMA`（回归测试 + #192 等
 * 后续工具复用）；字段片段/枚举保持模块私有——knip 死代码门禁要求「导出
 * 即被使用」，#192 需要片段时按需导出（同时会被消费）。
 */
const MEMORY_ITEM_PROPERTIES = {
    id: { type: 'string' },
    desc: { type: 'string' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    category: { type: 'string', enum: MEMORY_CATEGORIES },
    source: {
        type: 'object',
        additionalProperties: false,
        properties: {
            sessionId: { type: 'string' },
            at: { type: 'number' },
        },
        required: ['sessionId', 'at'],
    },
    confidence: { type: 'number' },
    relatedIds: { type: 'array', items: { type: 'string' } },
    history: {
        type: 'array',
        items: {
            type: 'object',
            additionalProperties: false,
            properties: {
                at: { type: 'number' },
                action: { type: 'string' },
                desc: { type: 'string' },
            },
            required: ['at', 'action', 'desc'],
        },
    },
    status: { type: 'string', enum: MEMORY_STATUSES },
};
/** 条目必填字段：与 MEMORY_ITEM_PROPERTIES 同源（新增字段自动必填，不会漏声明）。 */
const MEMORY_ITEM_REQUIRED = Object.keys(MEMORY_ITEM_PROPERTIES);
/**
 * 记忆条目的完整输出 schema——**导出供回归测试与后续工具复用**（#192 等）：
 * save.item 与 query.items[] 共用同一对象引用，形状永不漂移。
 */
export const MEMORY_ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: MEMORY_ITEM_PROPERTIES,
    required: MEMORY_ITEM_REQUIRED,
};
/** memory_query output schema (JSON Schema; enforced on every successful value). */
const QUERY_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        scope: { type: 'string' },
        cwd: { type: 'string' },
        projectRoot: { type: 'string' },
        items: { type: 'array', items: MEMORY_ITEM_SCHEMA },
    },
    required: ['scope', 'cwd', 'projectRoot', 'items'],
};
/** The memory_query tool definition (read-only). */
export function createMemoryQueryTool({ globalStore, getProjectStore }) {
    return {
        name: 'memory_query',
        description: '查询记忆详情（只读）：列出全局或项目记忆条目，可按关键词过滤。全局记忆在会话开始时已注入系统提示词；此工具用于查看完整记忆列表或项目记忆。',
        parameters: QUERY_PARAMETERS,
        output: {
            schema: QUERY_OUTPUT,
            render: (_args, value) => [{ type: 'text', text: renderQueryResult(value) }],
        },
        async execute(args, exec) {
            return executeQuery(args, exec, { globalStore, getProjectStore });
        },
    };
}
/** Run one memory_query call (read-only). */
async function executeQuery(args, exec, { globalStore, getProjectStore }) {
    const scope = args.scope === 'project' ? 'project' : 'global';
    if (scope === 'global') {
        return { scope, cwd: '', projectRoot: '', items: filterItems(globalStore.list(), args.keyword) };
    }
    const cwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : sessionCwdOf(exec);
    if (cwd === '') {
        return { scope, cwd: '', projectRoot: '', items: [] };
    }
    const store = await getProjectStore(cwd);
    const projectRoot = await findProjectRoot(cwd);
    return { scope, cwd, projectRoot, items: filterItems(store.list(), args.keyword) };
}
/** The calling agent's session cwd, when it has one. */
function sessionCwdOf(exec) {
    const cwd = exec?.agent?.session?.header?.cwd;
    return typeof cwd === 'string' ? cwd : '';
}
/** memory_save parameters (JSON Schema; the registry projects them to the model). */
const SAVE_PARAMETERS = {
    type: 'object',
    properties: {
        scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: '保存范围：global（全局记忆）或 project（当前项目记忆）',
        },
        desc: {
            type: 'string',
            description: '要保存的记忆内容（用户偏好、项目约定、技术决策等）',
        },
        cwd: {
            type: 'string',
            description: '可选：项目记忆的项目目录（默认取当前会话的工作目录）',
        },
    },
    required: ['scope', 'desc'],
    additionalProperties: false,
};
/** memory_save output schema (JSON Schema; the saved item is always returned). */
const SAVE_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        scope: { type: 'string' },
        cwd: { type: 'string' },
        projectRoot: { type: 'string' },
        item: MEMORY_ITEM_SCHEMA,
    },
    required: ['scope', 'cwd', 'projectRoot', 'item'],
};
/** Render one save result as model-facing text. */
export function renderSaveResult(value) {
    const scopeLabel = value.scope === 'project' ? '项目' : '全局';
    const where = value.scope === 'project' && value.projectRoot !== ''
        ? `（项目：${value.projectRoot}）`
        : value.scope === 'project'
            ? '（项目目录未知）'
            : '';
    return `已保存${scopeLabel}记忆${where}：${value.item.desc} [${value.item.id}]`;
}
/**
 * The memory_save tool description. The `proactivePropose` switch (default
 * off, issue #78 phase) tells the agent it may proactively propose saving
 * memories it notices during the conversation; off, the agent saves on
 * request. Either way the write always goes through the user-consent gate.
 */
export function saveToolDescription(proactivePropose) {
    if (proactivePropose === true) {
        return '保存记忆（写操作，需用户确认）：将一条值得记住的信息保存为全局或项目记忆。内容建议浓缩为 1-2 句话概括（用「；」或「。」切分要点），不要长篇解释性话语。发现值得记住的信息时，可主动向用户提议保存；用户同意后调用本工具。保存后 memory_query 立即可查、后续会话注入生效。';
    }
    return '保存记忆（写操作，需用户确认）：按用户要求将一条信息保存为全局或项目记忆。内容建议浓缩为 1-2 句话概括（用「；」或「。」切分要点），不要长篇解释性话语。调用后需用户确认才会真正写入。保存后 memory_query 立即可查、后续会话注入生效。';
}
/** The memory_save tool definition (write; gated by the approval listener). */
export function createMemorySaveTool({ globalStore, getProjectStore, config, logger, }) {
    return {
        name: 'memory_save',
        description: saveToolDescription(config?.proactivePropose),
        parameters: SAVE_PARAMETERS,
        output: {
            schema: SAVE_OUTPUT,
            render: (_args, value) => [{ type: 'text', text: renderSaveResult(value) }],
        },
        async execute(args, exec) {
            return executeSave(args, exec, { globalStore, getProjectStore, logger });
        },
    };
}
/** Run one memory_save call; lands only after the pre-execute approval gate. */
async function executeSave(args, exec, { globalStore, getProjectStore, logger }) {
    const scope = args.scope === 'project' ? 'project' : 'global';
    const desc = typeof args.desc === 'string' ? args.desc.trim() : '';
    const sessionId = sessionIdOf(exec);
    if (desc === '') {
        warnSave(logger, `memory_save 拒绝空内容（sessionId=${sessionId}，操作=save）`);
        throw new Error('memory_save: desc is required and must not be empty');
    }
    const at = Date.now();
    const entry = { desc, source: makeSource(sessionId, at) };
    if (scope === 'global') {
        const item = await globalStore.add(entry, at);
        infoSave(logger, `记忆已保存（scope=global，itemId=${item.id}，sessionId=${sessionId}）`);
        return { scope, cwd: '', projectRoot: '', item };
    }
    const cwd = typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : sessionCwdOf(exec);
    if (cwd === '') {
        warnSave(logger, `memory_save 项目范围缺少 cwd（sessionId=${sessionId}，操作=save）`);
        throw new Error('memory_save: project scope requires a cwd (explicit or from the session)');
    }
    const store = await getProjectStore(cwd);
    const projectRoot = await findProjectRoot(cwd);
    const item = await store.add(entry, at);
    infoSave(logger, `记忆已保存（scope=project，itemId=${item.id}，sessionId=${sessionId}，cwd=${cwd}）`);
    return { scope, cwd, projectRoot, item };
}
/** 调用 agent 的会话 id（无则空串）。 */
function sessionIdOf(exec) {
    return exec?.agent?.id ?? '';
}
/** 记忆写操作 warn 日志（统一 [dsh-my-memory] 前缀，issue #155）。 */
function warnSave(logger, message) {
    logger?.warn(`[dsh-my-memory] ${message}`);
}
/** 记忆写操作 info 日志（统一 [dsh-my-memory] 前缀，issue #155）。 */
function infoSave(logger, message) {
    logger?.info(`[dsh-my-memory] ${message}`);
}
/**
 * memory_save 的 `tools/pre-execute` 确认门（issue #107；#208 起权限模式感知）
 * 实现于 `save-policy.ts`——策略/判定与该门同源。此处 re-export，让工具消费者
 * （index.ts、测试）保持单一导入点。
 */
export { createMemorySaveGate } from './save-policy.js';
