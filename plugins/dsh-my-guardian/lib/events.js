/**
 * dsh-my-guardian — diagnostic event log (ring buffer in state) and the loader
 * event listeners that feed it.
 */
import { ERROR_SNIP, EVENT_LIMIT } from './state.js';
/** Append a diagnostic event to the shared state's ring buffer. */
export function logEvent(shared, type, message) {
    const record = {
        time: Date.now(),
        type,
        message: String(message).slice(0, ERROR_SNIP),
    };
    shared.state.events.push(record);
    if (shared.state.events.length > EVENT_LIMIT)
        shared.state.events.splice(0, shared.state.events.length - EVENT_LIMIT);
    return record;
}
/**
 * 本插件监听的宿主事件名（登记表）。
 *
 * 判据在 test/host-event-contract.mjs：这些名字必须命中**目标宿主真实事件表**
 * （test/fixtures/host-events.json，由 scripts/host-events.mjs 从宿主源码取证：
 * `interface Events` 声明 ∪ `ctx.<emit|parallel|...>` 派发），否则必须有
 * HOST_EVENT_FALLBACKS 降级信号。新增/删除 ctx.on 时必须同步本表。
 *
 * 0.1.7-rc.2 起：`loader/entry-init`、`loader/partial-dispose` 仍由宿主
 * cordis-plugin-loader 派发（有效）；`hmr/config-update-failed` 已被删除，只剩
 * "已退役 0.1.5-rc.1 兼容"意义，实际诊断走 HOST_EVENT_FALLBACKS 的日志通道。
 */
export const LISTENED_HOST_EVENTS = [
    'loader/entry-init',
    'loader/partial-dispose',
    'hmr/config-update-failed',
];
/** 宿主在配置热更新失败点打的结构化 warn 首参（逐字取自宿主源码，测试会校验）。 */
const CONFIG_FAILURE_MARKER = 'config reload at %C failed';
/** cordis exporter 的 verbosity 阈值：2 = 收 warn 及更严重的消息（error/warn）。 */
const WARN_LEVEL = 2;
/** marker 之后紧跟的 `ctx.logger.warn(error)` 配对窗口（ms）。 */
const PAIR_WINDOW_MS = 50;
/** 双版本去重窗口（ms）：0.1.5-rc.1 上同一失败既打日志又发事件。 */
const DEDUP_WINDOW_MS = 1000;
/** 去重表上限（长跑内存护栏）。 */
const DEDUP_LIMIT = 50;
/** marker 先到时错误文本未知的占位（紧随的 Error warn 会补齐）。 */
const PENDING_DETAIL = '(error detail logged by host)';
/**
 * 降级信号登记：宿主 0.1.7-rc.2 把 HMR 换成 @deepseek-ai/dsh-hmr，事件表只剩
 * `hmr/change` / `hmr/reload` —— `hmr/config-update-failed` 被删除，`ctx.on` 该事件
 * 在新宿主上**静默失效**（不报错、不告警），"配置热更新失败"诊断整体消失。
 *
 * 替代可观测量（逐字取证，非猜测）：0.1.5-rc.1 的 cordis-plugin-hmr 与 0.1.7-rc.2 的
 * dsh-hmr **在同一个 catch 里先打同一对 warn、然后旧版才发事件**：
 *   ctx.logger.warn('config reload at %C failed', filename); ctx.logger.warn(error)
 * （旧：cordis-plugin-hmr/lib/index.js；新：packages/boot/hmr/src/watch-config.ts，
 *   已装宿主 0.1.7-rc.2 对应 node_modules/@deepseek-ai/dsh-hmr/lib/index.js）
 * 所以结构化日志是两个宿主共有的可观测面，用它接手被删事件的诊断职责。
 *
 * 宿主升级到 0.1.7-rc.2 之后：已装宿主也变成 0.1.7-rc.2，`hmr/config-update-failed`
 * 在两个通道里都不存在——该 `ctx.on` 只剩"已退役 0.1.5-rc.1 兼容"意义（注册未知
 * 事件不报错，回退宿主仍可诊断），因此 legacySource 转为 legacyRetired 退役登记。
 * 新宿主的诊断职责全部由结构化 warn 通道承担（marker 在参考源与已装宿主双向取证）。
 */
export const HOST_EVENT_FALLBACKS = [
    {
        event: 'hmr/config-update-failed',
        kind: 'logger-warn',
        marker: CONFIG_FAILURE_MARKER,
        targetSource: 'packages/boot/hmr/src/watch-config.ts',
        legacyRetired: {
            version: '0.1.5-rc.1',
            source: 'node_modules/@deepseek-ai/cordis-plugin-hmr/lib/index.js',
            reason: '0.1.7-rc.2 以 @deepseek-ai/dsh-hmr 取代 cordis-plugin-hmr，旧包已从已装宿主移除，双通道并存的在场取证不可复现',
        },
    },
];
/** 失败原因文本：Error 取 message、其他字符串化、未配对到时给占位。 */
function failureText(error) {
    if (error === undefined)
        return PENDING_DETAIL;
    return error instanceof Error ? error.message : String(error);
}
/**
 * 创建"配置热更新失败"记录器（两条通道共用一张最近失败表）。
 *
 * 去重依据同上：旧宿主在同一个 catch 里先 warn 再发事件，同一失败会经两条通道
 * 到达（日志通道在前），只记一条；不同文件名照常各记一条。
 * @param ctx DSH server 端 Context。
 * @param shared 插件共享状态（环形缓冲 + 落盘）。
 * @param now 注入时钟（默认 Date.now；测试用于验证窗口过期分支）。
 */
export function createConfigFailureTracker(ctx, shared, now = Date.now) {
    const recent = new Map();
    let pending;
    /** 该文件名在去重窗口内是否首次失败。 */
    const firstTime = (key) => {
        const time = now();
        const last = recent.get(key);
        if (last !== undefined && time - last < DEDUP_WINDOW_MS)
            return false;
        recent.set(key, time);
        if (recent.size > DEDUP_LIMIT)
            recent.delete(String(recent.keys().next().value));
        return true;
    };
    const write = (filename, error) => {
        const key = String(filename);
        if (!firstTime(key))
            return undefined;
        const record = logEvent(shared, 'update-failed', `${key}: ${failureText(error)}`);
        ctx.logger?.warn(`[dsh-my-guardian] config update failed (rolled back): ${key}`);
        shared.persistSoon();
        return record;
    };
    return {
        fromEvent(filename, error) {
            write(filename, error);
        },
        fromLogMarker(filename, loggerName) {
            const record = write(filename, undefined);
            if (record !== undefined)
                pending = { record, key: String(filename), name: loggerName, at: now() };
        },
        fromLogDetail(error, loggerName) {
            const state = pending;
            pending = undefined;
            if (state === undefined)
                return;
            if (now() - state.at > PAIR_WINDOW_MS || loggerName !== state.name)
                return;
            state.record.message = `${state.key}: ${failureText(error)}`.slice(0, ERROR_SNIP);
        },
    };
}
/**
 * 注册结构化日志降级通道（0.1.7-rc.2 起被删事件的替代可观测量）。
 *
 * `ctx.logger.exporter()` 是 cordis 日志服务的公开扩展点：注册的 exporter 随当前
 * fiber 释放（实测插件卸载后 exporter 一并移除，不泄漏），收到的是**未格式化的**
 * 结构化消息（`args` 里的 marker 字面量可直接比对，无需解析格式串）。
 * logger 缺失或没有 exporter（老/最小 ctx）时静默降级，不抛异常。
 */
function attachConfigFailureLogFallback(ctx, failures) {
    const logger = ctx.logger;
    if (logger === undefined || typeof logger.exporter !== 'function')
        return;
    logger.exporter({
        levels: { default: WARN_LEVEL },
        export(message) {
            if (message?.type !== 'warn')
                return;
            const args = Array.isArray(message.args) ? message.args : [];
            if (args[0] === CONFIG_FAILURE_MARKER) {
                failures.fromLogMarker(args[1], message.name);
            }
            else if (args.length === 1 && args[0] instanceof Error) {
                failures.fromLogDetail(args[0], message.name);
            }
        },
    });
}
/**
 * Register the loader/HMR diagnostic listeners (R9/R10)。
 *
 * 两条通道都注册：`hmr/config-update-failed` 只对已退役的 0.1.5-rc.1 有效，在
 * 0.1.7-rc.2（当前唯一在场宿主）上永不触发（注册未知事件不报错，回退宿主仍可诊断），
 * 当前宿主的诊断完全由日志通道承担——靠 createConfigFailureTracker 去重合并成一条。
 */
export function attachEventListeners(ctx, shared) {
    const failures = createConfigFailureTracker(ctx, shared);
    ctx.on('loader/entry-init', (entry) => {
        logEvent(shared, 'entry-init', `entry ${entryLabelOf(entry)} initialized`);
    });
    ctx.on('loader/partial-dispose', (entry) => {
        logEvent(shared, 'entry-dispose', `entry ${entryLabelOf(entry)} disposed`);
    });
    ctx.on('hmr/config-update-failed', (filename, error) => {
        failures.fromEvent(filename, error);
    });
    attachConfigFailureLogFallback(ctx, failures);
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
