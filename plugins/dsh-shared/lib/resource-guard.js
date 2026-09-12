/**
 * dsh-shared — 资源看门狗原语（issue #198 第三批）。
 *
 * 审计缺口：dsh-my-observability 里有一份**插件私有**的 resource-monitor +
 * resource-rules（15s 采样 CPU/RSS/受监控文件字节/写入速率 → 阈值判定 → 连续
 * 3 次超限降级停落盘 / 连续 3 次正常恢复）。任何需要「资源超限自动降级」的
 * 插件都只能把这份状态机抄一遍（docs/共享工具包/概述.md 的清单里这条一直挂着
 * 「未落地」）。本文件把它抽成可复用原语，并把 observability 改成消费方——
 * 抽出来没人用的库等于没抽。
 *
 * 三层职责：
 *  1. **采样**（宿主职责）：`collect(previous, now)` 返回本窗口指标。采样必须
 *     **廉价且同步**（statSync / process.cpuUsage 量级，15s 一次 <0.01% CPU）——
 *     采样本身放大被监控对象就违背了监控的初衷；
 *  2. **判定**（resource-rules.ts 纯函数）：`evaluateResourceAlerts` 告警、
 *     `shouldEnterDegrade` / `shouldExitDegrade` 连续确认（防抖动）；
 *  3. **状态机 + 呼叫宿主**（本文件）：连续 enterConfirmCount 次关键阈值超限 →
 *     降级（onDegrade）；连续 exitConfirmCount 次正常 → 恢复（onRecover）。
 *     降级中不重复触发；回调异常只 warn（宿主回调炸掉不能带崩看门狗）。
 *
 * ⚠️ 适用边界与反例：
 *  - 适用：**持续运行逻辑的自动降级**（持久化 / 轮询 / 后台任务）——判定是纯
 *    函数、阈值可配置、降级动作由宿主决定（L1 提高节流 / L2 停止落盘 / L3 降采样）；
 *  - 不适用：一次性操作的资源检查（直接算大小/限流即可，不需要状态机）；
 *  - 不适用：把「告警」当「降级」——只有**磁盘类关键阈值**（write-rate /
 *    file-size）触发降级；CPU/内存超限只告警（正常大请求峰值会误伤，见
 *    resource-rules.ts 的 isCriticalOverLimit）；
 *  - 降级期间宿主仍必须保证内存有界（本原语只发信号，不管内存）；
 *  - 恢复必须做一次全量快照补齐（内存=真相），否则降级窗口的数据永久缺失；
 *  - 采样源必须同步且廉价：把「递归扫目录」这类 O(n) 采样塞进 collect 会让
 *    监控自身成为热点（observability 的 $DSH_HOME 字节维度就是这样，属于已知
 *    存量代价，新接入方不要复制）。
 *
 * 五维预算（resource-budget-review）：采样 15s 一次、单次 O(1)（statSync +
 * cpuUsage）；ring buffer 固定 historySize（默认 60）条 → 内存 O(60)，不随运行
 * 时长增长；无网络、自身无磁盘写。
 */
import { statSync } from 'node:fs';
import { DEFAULT_GUARD_CONFIRM_COUNT, DEFAULT_RESOURCE_LIMITS, evaluateResourceAlerts, shouldEnterDegrade, shouldExitDegrade, } from './resource-rules.js';
// 一处导入即可拿到「采样 + 判定 + 状态机」：判定纯函数在 resource-rules.ts，
// 这里 re-export 方便消费方（observability 等）只依赖一个模块。
export { DEFAULT_RESOURCE_LIMITS, DEFAULT_GUARD_CONFIRM_COUNT, evaluateResourceAlerts, shouldEnterDegrade, shouldExitDegrade, } from './resource-rules.js';
/** 默认采样间隔（ms）。 */
export const DEFAULT_GUARD_INTERVAL_MS = 15000;
/** 默认历史样本数（ring buffer 上限）。 */
export const DEFAULT_GUARD_HISTORY_SIZE = 60;
/** 校验正数参数（fail-fast，避免静默 0 值让看门狗失效）。 */
function assertPositive(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('createResourceGuard: ' + name + ' 必须为正数，got ' + String(value));
    }
}
/** 创建资源看门狗（见文件头「三层职责」与适用边界）。 */
export function createResourceGuard(options) {
    const intervalMs = options.intervalMs ?? DEFAULT_GUARD_INTERVAL_MS;
    const historySize = options.historySize ?? DEFAULT_GUARD_HISTORY_SIZE;
    const enterConfirmCount = options.enterConfirmCount ?? DEFAULT_GUARD_CONFIRM_COUNT;
    const exitConfirmCount = options.exitConfirmCount ?? DEFAULT_GUARD_CONFIRM_COUNT;
    assertPositive(intervalMs, 'intervalMs');
    assertPositive(historySize, 'historySize');
    assertPositive(enterConfirmCount, 'enterConfirmCount');
    assertPositive(exitConfirmCount, 'exitConfirmCount');
    if (typeof options.collect !== 'function')
        throw new TypeError('createResourceGuard: collect 必须为函数');
    const deps = {
        collect: options.collect,
        limits: { ...DEFAULT_RESOURCE_LIMITS, ...(options.limits ?? {}) },
        intervalMs,
        historySize,
        enterConfirmCount,
        exitConfirmCount,
        onDegrade: options.onDegrade,
        onRecover: options.onRecover,
        logger: options.logger,
        prefix: options.prefix ?? '[resource-guard]',
        now: options.now ?? Date.now,
    };
    const state = { timer: null, lastSample: null, history: [], degraded: false, stats: emptyStats() };
    const guard = {
        sample: () => sampleOnce(state, deps),
        start: () => startSampling(state, deps, guard),
        stop: () => stopSampling(state),
        isDegraded: () => state.degraded,
        history: () => [...state.history],
        stats: () => ({ ...state.stats }),
    };
    return guard;
}
/** 统计初值。 */
function emptyStats() {
    return { samples: 0, degraded: 0, recovered: 0, alerts: 0 };
}
/**
 * 采样一次：首个样本只作基线（无窗口数据 → 不告警、不进历史），之后入历史
 * （ring buffer 有界）→ 更新降级状态机 → 返回快照。
 */
function sampleOnce(state, deps) {
    const at = deps.now();
    const previous = state.lastSample;
    const metrics = deps.collect(previous, at);
    const sample = { ...metrics, time: metrics.time ?? at };
    state.stats.samples += 1;
    if (previous === null) {
        state.lastSample = sample;
        return { ...sample, history: [], alerts: [], degraded: state.degraded };
    }
    state.history.push(sample);
    if (state.history.length > deps.historySize) {
        state.history.splice(0, state.history.length - deps.historySize);
    }
    state.lastSample = sample;
    const alerts = evaluateResourceAlerts(sample, deps.limits);
    state.stats.alerts += alerts.length;
    const base = { ...sample, history: [...state.history], alerts };
    updateDegradeState(state, deps, base);
    return { ...base, degraded: state.degraded };
}
/** 降级状态机：未降级且连续超限 → 降级（回调）；已降级且连续正常 → 恢复（回调）。 */
function updateDegradeState(state, deps, base) {
    if (!state.degraded && shouldEnterDegrade(state.history, deps.limits, deps.enterConfirmCount)) {
        state.degraded = true;
        state.stats.degraded += 1;
        invokeCallback(deps, 'onDegrade', deps.onDegrade, { ...base, degraded: true });
    }
    else if (state.degraded && shouldExitDegrade(state.history, deps.limits, deps.exitConfirmCount)) {
        state.degraded = false;
        state.stats.recovered += 1;
        invokeCallback(deps, 'onRecover', deps.onRecover, { ...base, degraded: false });
    }
}
/** 宿主回调异常只 warn：回调炸掉不能带崩看门狗状态机。 */
function invokeCallback(deps, name, callback, snapshot) {
    if (typeof callback !== 'function')
        return;
    try {
        callback(snapshot);
    }
    catch (error) {
        deps.logger?.warn(deps.prefix + ' ' + name + ' callback failed: ' + errorText(error));
    }
}
/** 启动周期采样（幂等；unref 让看门狗不阻止进程退出）。 */
function startSampling(state, deps, guard) {
    if (state.timer === null) {
        state.timer = setInterval(() => {
            guard.sample();
        }, deps.intervalMs);
        if (typeof state.timer.unref === 'function')
            state.timer.unref();
    }
    return state.timer;
}
/** 停止周期采样（幂等）。 */
function stopSampling(state) {
    if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
    }
}
/** 创建进程 + 文件采样器（见 {@link ProcessSamplerOptions}）。 */
export function createProcessSampler(options) {
    let lastCpu = process.cpuUsage();
    return (previous, now) => {
        const cpu = process.cpuUsage();
        const cpuDelta = cpu.user - lastCpu.user + (cpu.system - lastCpu.system); // µs
        lastCpu = cpu;
        const memoryBytes = process.memoryUsage().rss;
        let fileBytes = 0;
        try {
            fileBytes = statSync(options.file).size;
        }
        catch {
            // 受监控文件尚未创建：字节为 0
        }
        let extra = {};
        try {
            extra = options.extra?.(now) ?? {};
        }
        catch {
            // 自定义维度不可达：忽略
        }
        if (previous === null) {
            return { time: now, cpuPercent: 0, memoryBytes, fileBytes, writeRateBytesPerHour: 0, ...extra };
        }
        const deltaMs = Math.max(now - (previous.time ?? now), 1);
        const byteDelta = fileBytes - (previous.fileBytes ?? 0);
        return {
            time: now,
            // CPU 单核折算：cpuDelta(µs) / deltaMs(ms) / 1000 → 百分比（×100）
            cpuPercent: (cpuDelta / 1000 / deltaMs) * 100,
            memoryBytes,
            fileBytes,
            writeRateBytesPerHour: byteDelta > 0 ? (byteDelta / deltaMs) * 3600 * 1000 : 0,
            ...extra,
        };
    };
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
