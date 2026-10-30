/**
 * dsh-my-memory — /my-memory/api/agent-memory 路由（issue #502）。
 *
 * 与 /memory、/prompts 都是**独立端点**（不复用）：
 *  - GET  → 文件列表 + 每份记忆正文 + **index.json 元数据**（创建时间、
 *           最后读取、读取次数、是否已归档）。
 *  - POST → 写操作 write | delete，**不需要 confirmed** —— agent 记忆本就是
 *           agent 自主维护的，与「全局记忆必须用户确认」的语义相反。
 *           面板是**用户**的入口，用户改自己的记忆当然也不需要再问一次。
 *
 * 面板读元数据是本体系「给用户了解原因」的唯一落点：agent 看不到时间戳与
 * 热度（它们不注入上下文、也不能被 agent 改），但用户必须看得到。
 */
import { readJsonBody, writeJson } from 'dsh-shared';
import { createIndexStore } from './index-store.js';
import { createAgentMemoryStore } from './store.js';
import { normalizeName } from './paths.js';
/**
 * 构造路由依赖（issue #502）。
 *
 * 与工具的 store 是**独立实例**：工具侧与面板侧并发读写同一批文件时，
 * 各自的 index 缓存不会互相打架（原子写已保证磁盘一致）。
 */
export function createAgentMemoryRouteDeps({ logger, enabled, }) {
    const index = createIndexStore({ logger });
    const store = createAgentMemoryStore({ index, logger });
    // 关闭 agent 记忆时面板仍可读（展示历史），只是工具不再注册。
    void enabled;
    return { index, store, logger };
}
/** 一份记忆的面板视图（缺元数据时给零值，绝不因元数据缺失隐藏正文）。 */
function viewOf(name, content, meta) {
    return {
        name,
        content,
        createdAt: meta?.createdAt ?? 0,
        updatedAt: meta?.updatedAt ?? 0,
        lastReadAt: meta?.lastReadAt ?? 0,
        readCount: meta?.readCount ?? 0,
        archived: meta?.archivedAt !== undefined,
    };
}
/** 读全部（含已归档，面板需要展示归档区）。 */
async function readAll({ index, store }) {
    await index.load();
    const entries = [];
    for (const name of Object.keys(index.state().files)) {
        const read = await store.readForPanel(name);
        if (read === null)
            continue;
        entries.push(viewOf(name, read, index.metaOf(name)));
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}
/** 拒绝：状态码 + 可读原因。 */
function reject(response, status, message) {
    writeJson(response, status, { ok: false, error: { message } });
}
/** POST 分派：write | delete（面板是用户入口，不需要 confirmed 标记）。 */
async function handleWrite(request, response, deps) {
    const payload = await readJsonBody(request);
    const action = typeof payload?.action === 'string' ? payload.action : '';
    const name = normalizeName(payload?.name);
    if (name === null) {
        reject(response, 400, 'invalid or missing name');
        return;
    }
    if (action === 'write') {
        const result = await deps.store.write(name, payload?.content);
        if (!result.ok) {
            reject(response, 400, result.error);
            return;
        }
    }
    else if (action === 'delete') {
        const result = await deps.store.remove(name);
        if (!result.ok) {
            reject(response, 400, result.error);
            return;
        }
    }
    else {
        reject(response, 400, 'action must be write or delete');
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
