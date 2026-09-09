/**
 * dsh-my-guardian — diagnostic event log (ring buffer in state) and the loader
 * event listeners that feed it.
 */
import { ERROR_SNIP, EVENT_LIMIT } from './state.js';
/** Append a diagnostic event to the shared state's ring buffer. */
export function logEvent(shared, type, message) {
    shared.state.events.push({
        time: Date.now(),
        type,
        message: String(message).slice(0, ERROR_SNIP),
    });
    if (shared.state.events.length > EVENT_LIMIT)
        shared.state.events.splice(0, shared.state.events.length - EVENT_LIMIT);
}
/** Register the loader/HMR diagnostic listeners (R9/R10). */
export function attachEventListeners(ctx, shared) {
    ctx.on('loader/entry-init', (entry) => {
        logEvent(shared, 'entry-init', `entry ${entryLabelOf(entry)} initialized`);
    });
    ctx.on('loader/partial-dispose', (entry) => {
        logEvent(shared, 'entry-dispose', `entry ${entryLabelOf(entry)} disposed`);
    });
    ctx.on('hmr/config-update-failed', (filename, error) => {
        logEvent(shared, 'update-failed', `${String(filename)}: ${error instanceof Error ? error.message : String(error)}`);
        ctx.logger?.warn(`[dsh-my-guardian] config update failed (rolled back): ${String(filename)}`);
        shared.persistSoon();
    });
}
/**
 * entry 可读标识——⚠️ 只读 options 字段，绝不访问 `entry.id` getter：
 * loader 在 Entry **构造函数中** emit `loader/entry-init`，此时
 * `parent.tree` 尚未就绪，访问 getter 会抛 "Cannot read properties of
 * undefined (reading 'tree')" —— 这个异常发生在启动阶段，会让整个
 * DSH 服务起不来（守护插件自己炸启动，实锤隔离实例复现）。
 */
function entryLabelOf(entry) {
    if (entry === null || typeof entry !== 'object')
        return '?';
    const options = entry.options;
    if (options !== null && typeof options === 'object') {
        if (options.id !== undefined && options.id !== null)
            return String(options.id);
        if (typeof options.name === 'string' && options.name !== '')
            return options.name;
    }
    return '?';
}
