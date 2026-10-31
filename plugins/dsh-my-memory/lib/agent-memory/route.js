/**
 * dsh-my-memory — /my-memory/api/agent-memory 路由（issue #502）。
 *
 * 与 /memory、/prompts 都是**独立端点**（不复用）：
 *  - GET  → 文件列表 + 每份记忆正文 + **index.json 元数据**（创建时间、
 *           最后读取、读取次数、是否已归档）。
 *  - POST → 写操作 write | delete | restore，**不需要 confirmed** —— agent
 *           记忆本就是 agent 自主维护的，与「全局记忆必须用户确认」的语义相反。
 *           面板是**用户**的入口，用户改自己的记忆当然也不需要再问一次。
 *           restore 把归档条目搬回原位（面板能看见归档正文，才谈得上恢复）。
 *
 * 面板读元数据是本体系「给用户了解原因」的唯一落点：agent 看不到时间戳与
 * 热度（它们不注入上下文、也不能被 agent 改），但用户必须看得到。
 */
import { readJsonBody, writeJson } from 'dsh-shared';
import { createAgentMemoryRuntime } from './tools.js';
import { listExistingFiles, normalizeName } from './paths.js';
/**
 * 构造路由依赖（issue #502）。
 *
 * **必须与工具侧共用同一个 runtime**：index.json 是整份 cache 覆盖落盘，
 * 两个实例各持一份 cache 会互相覆盖（lost update）。调用方传 runtime；
 * 未传时自建一份（仅面板使用、无并发写者的场景）。
 */
export function createAgentMemoryRouteDeps({ logger, enabled, runtime, }) {
    const { index, store } = runtime ?? createAgentMemoryRuntime({ logger });
    // 关闭 agent 记忆时面板仍可读（展示历史），只是工具与说明段不再注册。
    void enabled;
    return { index, store, logger };
}
/** 一份记忆的面板视图（缺元数据时给零值，绝不因元数据缺失隐藏正文）。 */
/** 项目文件的可读名；不是项目文件或未记录过名字时 undefined。 */
function projectNameOf(name, projectNames) {
    const parts = name.split('/');
    return parts[0] === 'projects' && parts.length === 3 ? projectNames[parts[1] ?? ''] : undefined;
}
/** 缺元数据时的零值（绝不因元数据缺失隐藏正文）。 */
const EMPTY_META = Object.freeze({ createdAt: 0, updatedAt: 0, lastReadAt: 0, readCount: 0 });
function viewOf(name, content, meta, projectNames) {
    const projectName = projectNameOf(name, projectNames);
    const m = meta ?? EMPTY_META;
    return {
        name,
        ...(projectName === undefined ? {} : { projectName }),
        content,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        lastReadAt: m.lastReadAt,
        readCount: m.readCount,
        archived: meta !== undefined && meta.archivedAt !== undefined,
    };
}
/** 读全部（含已归档，面板需要展示归档区）。 */
async function readAll({ index, store }) {
    await index.load();
    // 活跃条目以文件系统为准（索引丢键时正文不该跟着消失）；已归档条目扫描不到，
    // 从索引补回来（正文在 archive/，readForPanel 会兜底读到）。
    const names = new Set(await listExistingFiles());
    for (const name of Object.keys(index.state().files)) {
        if (index.metaOf(name)?.archivedAt !== undefined)
            names.add(name);
    }
    const projectNames = index.projectNames();
    const entries = [];
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
        const read = await store.readForPanel(name);
        if (read === null)
            continue;
        entries.push(viewOf(name, read, index.metaOf(name), projectNames));
    }
    return entries;
}
/** 拒绝：状态码 + 可读原因。 */
function reject(response, status, message) {
    writeJson(response, status, { ok: false, error: { message } });
}
/**
 * 执行一个面板写动作；成功返 null，失败返可操作原因。
 *
 * 动作与 store 方法的映射收在一处：新增动作时只改这里，handleWrite 的
 * 分支数不再随动作增长（守住圈复杂度门禁）。
 */
async function applyAction(store, action, name, content) {
    const result = action === 'write'
        ? await store.write(name, content)
        : action === 'delete'
            ? await store.remove(name)
            : action === 'restore'
                ? await store.restore(name)
                : null;
    if (result === null)
        return 'action must be write, delete or restore';
    return result.ok ? null : result.error;
}
/** POST 分派：write | delete | restore（面板是用户入口，不需要 confirmed 标记）。 */
async function handleWrite(request, response, deps) {
    const payload = await readJsonBody(request);
    const action = typeof payload?.action === 'string' ? payload.action : '';
    const name = normalizeName(payload?.name);
    if (name === null) {
        reject(response, 400, 'invalid or missing name');
        return;
    }
    const error = await applyAction(deps.store, action, name, payload?.content);
    if (error !== null) {
        reject(response, 400, error);
        return;
    }
    writeJson(response, 200, { ok: true, value: { items: await readAll(deps) } });
}
/**
 * 分派一条 agent-memory 请求。
 * @returns true = 已处理（含已写响应）。
 */
export async function routeAgentMemory(url, request, response, deps) {
    if (!url.pathname.endsWith('/agent-memory'))
        return false;
    try {
        if (request.method === 'GET') {
            writeJson(response, 200, { ok: true, value: { items: await readAll(deps) } });
            return true;
        }
        if (request.method === 'POST') {
            await handleWrite(request, response, deps);
            return true;
        }
    }
    catch (error) {
        deps.logger?.warn(`agent-memory 路由失败：${String(error)}`);
        reject(response, 500, 'internal error');
        return true;
    }
    return false;
}
