/** 读取查询参数（缺失回空串）。 */
export function queryOf(url, name) {
    return url.searchParams.get(name) ?? '';
}
/** 解析 limit 查询参数（非正整数回 0 = 不限）。 */
export function limitOf(url) {
    const raw = url.searchParams.get('limit');
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
/** 读取 JSON 请求体。 */
export async function readJsonBody(request) {
    const chunks = [];
    const req = request;
    // 支持 async iterator（测试 mock）或 Node.js 可读流
    if (typeof req[Symbol.asyncIterator] === 'function') {
        const iterator = req[Symbol.asyncIterator]();
        let result = await iterator.next();
        while (!result.done) {
            chunks.push(typeof result.value === 'string' ? result.value : String(result.value));
            result = await iterator.next();
        }
    }
    else if (typeof req.on === 'function') {
        await new Promise((resolve, reject) => {
            const buffers = [];
            req.on.call(req, 'data', (chunk) => buffers.push(chunk));
            req.on.call(req, 'end', () => {
                chunks.push(Buffer.concat(buffers).toString('utf8'));
                resolve();
            });
            req.on.call(req, 'error', reject);
        });
    }
    const body = chunks.join('');
    return body ? JSON.parse(body) : {};
}
/** 写 JSON 响应。 */
export function writeJson(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
}
/** 写错误响应。 */
export function writeError(response, error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 500, { ok: false, error: { message } });
}
