/**
 * dsh-my-memory — host half (TypeScript 源码)。
 *
 * 全局/项目两级记忆（issue #38）+ 渐进式索引记忆（issue #78）：
 *  - 持久化：全局 `$DSH_HOME/memory.json` + 项目 `$DSH_HOME/memory/projects/<项目 id>.json`
 *    （issue #108：项目记忆集中存 $DSH_HOME，按项目根路径 hash 分文件，项目目录不再产生
 *    `.dsh/`；项目根按 cwd 向上找 .git 定位；首次访问自动迁移旧 `<项目根>/.dsh/memory.json`
 *    数据到新位置，记忆不丢失），原子写（tmp+rename）+ 防抖（300ms 合并写盘），
 *    启动时 load() 恢复缓存；
 *  - 结构化索引（issue #78）：条目带 category / source / confidence / updatedAt /
 *    relatedIds / history / status 元数据，旧数据读取时自动回退默认值（不丢不崩）；
 *    同主题渐进合并（置信度提升 / 内容更新 / 矛盾标记）、长期未用降权、智能注入
 *    （相关性 + 时效性 + 置信度评分，替代简单 top-N）——见 lib/memory-scoring.js；
 *  - 自动提取（issue #78）：`autoLearn` 开关（默认关）+ `extractor: 'rule' | 'llm'`
 *    （rule 为本仓库确定性规则提取器；llm 为预留占位）。会话结束后（agent/status
 *    idle，顶层 agent）对本次会话的用户消息运行提取器，产出「待确认」候选存
 *    `$DSH_HOME/memory/candidates.json`——用户经面板/API 确认后才合并进正式记忆，
 *    记忆绝不静默变更（延续 R4）；
 *  - 工具：`memory_query`（只读）、`memory_save`（写——经 `tools/pre-execute` 确认门
 *    触发 DSH 原生审批，用户确认后才写入，绝不静默变更）；
 *  - 写操作 API：`POST /my-memory/api/memory`（add/update/delete）强制
 *    `confirmed: true`；`POST /my-memory/api/candidates/confirm|dismiss`（候选确认
 *    写入 / 拒弃，同样需要用户同意标记）——记忆绝不静默变更；
 *  - Client：官方 slots 设置页签（全局/项目分区 + 待确认候选列表 + 分类/置信度/
 *    来源/演进展示 + 自定义确认 UI：删除红色、保存绿色）。
 */
import { createApiHandler } from './api-route.js';
import { isTrustedApiRequest } from 'dsh-shared';
import { DEFAULT_MAX_ENTRY_LENGTH } from './memory-text.js';
import { createMemorySection } from './prompt.js';
import { extractCandidates } from './extract.js';
import { candidateMemoryFile, createCandidatesStore, createStore, globalMemoryFile, migrateProjectMemory, resolveProjectMemory, } from './store.js';
import { createMemoryQueryTool } from './tool.js';
import { registerMemoryWriteTools } from './write-tools.js';
import { saveApprovalOf } from './save-policy.js';
export const name = 'dsh-my-memory';
export const inject = ['systemPrompt', 'tools', 'webServer', 'webRuntime', 'sessions'];
/** maxEntryLength 配置（issue #105 精简引导）；非法值回落默认 50。 */
function maxEntryLengthOf(config) {
    return Number.isInteger(config?.maxEntryLength) && config.maxEntryLength > 0
        ? config.maxEntryLength
        : DEFAULT_MAX_ENTRY_LENGTH;
}
/** maxMessagesPerSession 配置；非法值回落默认 60。 */
function maxMessagesPerSessionOf(config) {
    return Number.isInteger(config?.maxMessagesPerSession) && config.maxMessagesPerSession > 0
        ? config.maxMessagesPerSession
        : 60;
}
/** 全局 + 项目（按 cwd 懒创建并缓存；首次访问自动迁移旧集中前文件）stores。 */
function createMemoryStores() {
    const globalStore = createStore({ file: globalMemoryFile() });
    const projectStores = new Map();
    const getProjectStore = async (cwd) => {
        const { file, legacyFile } = await resolveProjectMemory(cwd);
        let store = projectStores.get(file);
        if (store === undefined) {
            await migrateProjectMemory({ file, legacyFile });
            store = createStore({ file });
            await store.load();
            projectStores.set(file, store);
        }
        return store;
    };
    return { globalStore, projectStores, getProjectStore };
}
/** 本次会话的用户消息暂存（sessionId → 文本数组；有上限防膨胀）。 */
function createMessageCollector(options) {
    const messages = new Map();
    const maxPerSession = maxMessagesPerSessionOf(options);
    return {
        push: (sessionId, text) => {
            const trimmed = typeof text === 'string' ? text.trim() : '';
            const collectable = typeof sessionId === 'string' && sessionId !== '' && trimmed !== '';
            if (collectable) {
                const list = messages.get(sessionId) ?? [];
                list.push(trimmed);
                messages.set(sessionId, list.slice(-maxPerSession));
            }
        },
        take: (sessionId) => {
            const list = messages.get(sessionId) ?? [];
            messages.delete(sessionId);
            return list;
        },
    };
}
/** 消息是否真实用户输入（非插件注入；与 dsh-my-guard 同判定）。 */
function isPluginInjected(message) {
    const source = message?.source;
    return source !== null && typeof source === 'object' && source.kind === 'plugin';
}
/** 从 user/message 的 data 提取文本（content 中全部 text block 拼接）。 */
function extractUserText(message) {
    const messageObj = message !== null && typeof message === 'object' ? message : undefined;
    const blocks = Array.isArray(messageObj?.content) ? messageObj.content : [];
    const parts = [];
    for (const block of blocks) {
        const blockObj = block !== null && typeof block === 'object' ? block : undefined;
        const isTextBlock = blockObj?.type === 'text' && typeof blockObj.text === 'string';
        if (isTextBlock)
            parts.push(blockObj.text);
    }
    return parts.join(' ');
}
/** 顶层 agent 判定（子代理结束不触发提取）。 */
function isTopLevelAgent(agent) {
    const agentObj = agent !== null && typeof agent === 'object' ? agent : undefined;
    const session = agentObj?.session;
    const header = session?.header;
    const hasHeader = header !== undefined && header !== null;
    return hasHeader && !hasSubagentMarker(header, agentObj?.options);
}
/** 任一子代理标记命中即子代理（header 持久化标记 + 运行时深度 + 派生父会话）。 */
function hasSubagentMarker(header, options) {
    const headerObj = header;
    const optionsObj = options;
    const byOrigin = headerObj.origin === 'subagent';
    const byDepth = typeof headerObj.delegationDepth === 'number' && headerObj.delegationDepth > 0;
    const byOptions = typeof optionsObj?.subagentDepth === 'number' && optionsObj.subagentDepth > 0;
    const byParentSession = typeof headerObj.parentSession === 'string' && headerObj.parentSession !== '';
    return byOrigin || byDepth || byOptions || byParentSession;
}
/** 候选指纹（category + 归一化的 desc）——去重用。 */
function fingerprintOf(candidate) {
    return `${candidate.category}|${String(candidate.desc).replace(/\s+/g, '')}`;
}
/** 把提取出的候选并入候选存储（按指纹去重，避免同会话重复候选）。 */
async function storeCandidates(candidatesStore, candidates) {
    const existing = await candidatesStore.load().then(() => candidatesStore.list());
    const known = new Set(existing.map((c) => fingerprintOf(c)));
    const fresh = candidates.filter((c) => !known.has(fingerprintOf(c)));
    for (const candidate of fresh) {
        await candidatesStore.addRaw(candidate);
    }
    return fresh;
}
/** agent/status 会话结束处理器（issue #78）：顶层 agent idle 时对本次会话
 *  收集到的用户消息运行提取器，候选进「待确认」区（绝不静默写入）。 */
function createSessionEndHandler({ collector, candidatesStore, autoLearn, extractor, logger, }) {
    return ({ agent, status }) => {
        if (!autoLearn || status !== 'idle' || !isTopLevelAgent(agent))
            return;
        const sessionId = typeof agent?.id === 'string' ? agent.id : '';
        const cwd = cwdOfAgent(agent);
        const messages = collector.take(sessionId);
        if (messages.length === 0)
            return;
        const candidates = extractCandidates(messages, {
            sessionId,
            cwd,
            now: Date.now(),
            extractor,
        });
        if (candidates.length > 0) {
            storeCandidates(candidatesStore, candidates).then(() => {
                logger?.info(`[dsh-my-memory] 会话结束自动提取候选（sessionId=${sessionId}，候选数=${candidates.length}，extractor=${extractor}）`);
            });
        }
    };
}
/** agent 的会话工作目录（无则空串）。 */
function cwdOfAgent(agent) {
    const agentObj = agent !== null && typeof agent === 'object' ? agent : undefined;
    const session = agentObj?.session;
    const header = session?.header;
    const cwd = header !== null && typeof header === 'object' ? header.cwd : undefined;
    return typeof cwd === 'string' ? cwd : '';
}
/** session/event 用户消息收集器（issue #78，autoLearn 开启时只读收集）。 */
function createMessageCollectorListener({ collector, autoLearn, }) {
    return (session, event) => {
        const eventObj = event !== null && typeof event === 'object' ? event : undefined;
        const data = eventObj?.data;
        const collectable = autoLearn && eventObj?.type === 'user/message' && !isPluginInjected(data);
        if (collectable) {
            const sessionId = session !== null && typeof session === 'object' && typeof session.id === 'string'
                ? session.id
                : '';
            collector.push(sessionId, extractUserText(data));
        }
    };
}
export function apply(ctx, config) {
    const { globalStore, projectStores, getProjectStore } = createMemoryStores();
    const candidatesStore = createCandidatesStore({ file: candidateMemoryFile() });
    const collector = createMessageCollector(config);
    const autoLearn = config?.autoLearn === true;
    const extractor = config?.extractor === 'llm' ? 'llm' : 'rule';
    const loadPromise = Promise.all([globalStore.load(), candidatesStore.load()]).catch(() => { });
    ctx.effect(() => {
        loadPromise;
        return () => {
            Promise.all([globalStore.flush(), candidatesStore.flush()]).catch(() => { });
            [...projectStores.values()].forEach((store) => store.flush().catch(() => { }));
        };
    }, 'dsh-my-memory: store lifecycle');
    // ── 系统提示词注入（每次组装求值，记忆变更即时生效）────────────────
    ctx.effect(() => ctx.systemPrompt?.section(createMemorySection(globalStore, config)), 'dsh-my-memory: system prompt section');
    // ── memory_query 只读工具 ─────────────────────────────────────────────
    ctx.effect(() => ctx.tools?.register(createMemoryQueryTool({ globalStore, getProjectStore })), 'dsh-my-memory: memory_query tool');
    // ── 记忆写工具（save/delete）+ 用户确认门（#107/#192，#208 起策略感知）──
    // 门按会话审批策略 + saveApproval 决定确认/免确认放行/明确拒绝——绝不静默变更。
    registerMemoryWriteTools(ctx, { globalStore, getProjectStore, config });
    // ── 自动提取（issue #78，autoLearn 默认关）───────────────────────────
    // 只读收集本次会话的用户消息（session/event），会话结束（agent/status
    // idle，顶层 agent）时运行提取器，候选进「待确认」区——绝不静默写入。
    ctx.effect(() => ctx.on('session/event', createMessageCollectorListener({ collector, autoLearn })), 'dsh-my-memory: user-message collector');
    const sessionEndHandler = createSessionEndHandler({
        collector,
        candidatesStore,
        autoLearn,
        extractor,
        logger: ctx.logger,
    });
    ctx.effect(() => ctx.on('agent/status', sessionEndHandler), 'dsh-my-memory: auto-extract on session end');
    // ── 写操作 API（需用户同意标记）──────────────────────────────────────
    const fence = (request) => isTrustedApiRequest(request, ctx.webRuntime?.trustedHosts ?? []);
    const apiHandler = createApiHandler({
        globalStore,
        getProjectStore,
        candidatesStore,
        fence,
        sessions: ctx.sessions,
        logger: ctx.logger,
        config: { ...config, maxEntryLength: maxEntryLengthOf(config) },
    });
    ctx.effect(() => ctx.webServer?.register({ kind: 'prefix', path: '/my-memory/api', handler: apiHandler }), 'dsh-my-memory: /my-memory/api routes');
    registerMemoryStatusQuery(ctx, globalStore, projectStores, { autoLearn, extractor, config });
}
/** 插件状态查询（#155 聚合层）：返回全局/项目记忆条目数 + 启动日志。 */
function registerMemoryStatusQuery(ctx, globalStore, projectStores, startup) {
    ctx.on('plugin:status-query', ({ plugin }) => {
        if (plugin !== 'dsh-my-memory')
            return undefined;
        const globalCount = globalStore.state?.items?.length ?? 0;
        const projectCount = [...projectStores.values()].reduce((n, s) => n + (s.state?.items?.length ?? 0), 0);
        return {
            ok: true,
            value: {
                plugin: 'dsh-my-memory',
                config: { keys: ['autoLearn', 'extractor', 'maxEntryLength', 'saveApproval'] },
                running: true,
                stats: { globalEntries: globalCount, projectEntries: projectCount },
                lastActions: [],
            },
        };
    });
    logStartup(ctx.logger, startup.autoLearn, startup.extractor, startup.config);
}
/** 启动日志（issue #155）：统一 [dsh-my-memory] 前缀 + 关键配置摘要。 */
function logStartup(logger, autoLearn, extractor, config) {
    logger?.info(`[dsh-my-memory] 记忆插件已启用（autoLearn=${autoLearn ? 'on' : 'off'}，extractor=${extractor}，maxEntryLength=${maxEntryLengthOf(config)}，saveApproval=${saveApprovalOf(config)}）`);
}
