/**
 * dsh-my-remote — 操作审计（内存环形缓冲）。
 *
 * 远程控制是敏感操作（可回答 ask / 批准 approval / 注入会话消息），所有
 * 指令（含未知动作尝试、token 失败）都记录日志：来源 IP、动作、sessionId、
 * 时间、结果、详情。环形缓冲上限可配（默认 100），超限丢最旧。
 *
 * 纯内存结构（无 IO / 无持久化），事件驱动写入，资源影响为零——无磁盘
 * 写入、无定时器、内存上界 = 缓冲上限条数。
 */
/** 默认审计缓冲上限。 */
export const AUDIT_LIMIT = 100;
/** 创建审计缓冲。 */
export function createAuditLog(limit = AUDIT_LIMIT) {
    const entries = [];
    /** 记录一条审计（字段规整，尽力而为）。 */
    function record(entry) {
        entries.unshift({
            time: typeof entry?.time === 'number' ? entry.time : Date.now(),
            action: strField(entry, 'action'),
            sessionId: strField(entry, 'sessionId'),
            source: strField(entry, 'source'),
            ok: entry?.ok === true,
            detail: strField(entry, 'detail'),
        });
        if (entries.length > limit)
            entries.length = limit;
    }
    /** 只读审计快照（最新在前；深拷贝防外部篡改）。 */
    function list() {
        return entries.map((entry) => ({ ...entry }));
    }
    return { record, list, limit };
}
/** 字符串字段规整：非字符串回退空串。 */
function strField(entry, key) {
    return typeof entry?.[key] === 'string' ? entry[key] : '';
}
