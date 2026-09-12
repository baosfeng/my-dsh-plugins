/** 默认防抖窗口（ms）。 */
export const DEFAULT_DEBOUNCE_MS = 500;
/** 默认最小写间隔（ms）：与 atomicWriteJson 的默认节流窗口一致。 */
export const DEFAULT_MIN_WRITE_INTERVAL_MS = 1000;
/** 默认写回调被拒后的最大连续重试次数。 */
export const DEFAULT_MAX_WRITE_RETRIES = 3;
/** 校验非负整数参数（fail-fast）。 */
function assertNonNegative(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError('createWriteScheduler: ' + name + ' 必须为非负整数，got ' + String(value));
    }
}
/** 创建写入调度器（见文件头「三层职责」与适用边界）。 */
export function createWriteScheduler(options) {
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS;
    const maxWriteRetries = options.maxWriteRetries ?? DEFAULT_MAX_WRITE_RETRIES;
    assertNonNegative(debounceMs, 'debounceMs');
    assertNonNegative(minIntervalMs, 'minIntervalMs');
    assertNonNegative(maxWriteRetries, 'maxWriteRetries');
    const state = {
        write: options.write,
        debounceMs,
        minIntervalMs,
        maxWriteRetries,
        logger: options.logger,
        prefix: options.prefix ?? '[write-scheduler]',
        dirty: false,
        retries: 0,
        timer: null,
        chain: Promise.resolve(),
        writing: false,
        lastWriteAt: 0,
        idle: [],
        stats: { writes: 0, coalesced: 0, retried: 0, failures: 0 },
    };
    return {
        schedule: () => scheduleWrite(state),
        flush: () => flushWrites(state),
        drain: () => drainWrites(state),
        pending: () => isPending(state),
        stats: () => ({ ...state.stats }),
    };
}
/** 是否有未落盘的变更。 */
function isPending(state) {
    return state.dirty || state.timer !== null || state.writing;
}
/** 防抖调度：窗口内重复调用合并为一次写。 */
function scheduleWrite(state) {
    if (state.dirty)
        state.stats.coalesced += 1;
    state.dirty = true;
    if (state.timer !== null)
        return;
    state.timer = setTimer(state, state.debounceMs, () => runWrite(state, false));
}
/** 定时器统一入口（刻意不 unref：挂起写保持进程存活到落盘，避免退出丢状态）。 */
function setTimer(state, ms, run) {
    return setTimeout(run, ms);
}
/** 清掉当前定时器（不影响 dirty）。 */
function cancelTimer(state) {
    if (state.timer === null)
        return;
    clearTimeout(state.timer);
    state.timer = null;
}
/** 触发一次写：最小间隔未到则推迟（不丢 dirty），否则进入串行链。 */
function runWrite(state, force) {
    cancelTimer(state);
    if (!state.dirty && !force) {
        checkIdle(state);
        return;
    }
    const wait = force ? 0 : state.minIntervalMs - (Date.now() - state.lastWriteAt);
    if (wait > 0) {
        state.timer = setTimer(state, wait, () => runWrite(state, false));
        return;
    }
    state.dirty = false;
    state.writing = true;
    state.chain = state.chain.then(() => performWrite(state, force));
}
/** 串行链内的实际落盘：被拒 → 重排；抛错 → 计数 + warn（不中断链）。 */
async function performWrite(state, force) {
    try {
        const result = await state.write({ force });
        if (result === false)
            handleBlocked(state);
        else {
            state.stats.writes += 1;
            state.retries = 0;
            state.lastWriteAt = Date.now();
        }
    }
    catch (error) {
        state.stats.failures += 1;
        state.logger?.warn(state.prefix + ' write failed: ' + (error instanceof Error ? error.message : String(error)));
    }
    finally {
        state.writing = false;
        checkIdle(state);
    }
}
/** 被护栏拒绝：保留脏标记并重排；连续超限则放弃并 warn（不无限重试）。 */
function handleBlocked(state) {
    state.stats.retried += 1;
    state.retries += 1;
    if (state.retries > state.maxWriteRetries) {
        state.retries = 0;
        state.dirty = false;
        state.logger?.warn(state.prefix + ' write blocked ' + String(state.stats.retried) + ' time(s) — dropping pending snapshot');
        return;
    }
    state.dirty = true;
    if (state.timer === null) {
        state.timer = setTimer(state, Math.max(state.minIntervalMs, 1), () => runWrite(state, false));
    }
}
/** 空闲判定 + 唤醒 drain 等待者。 */
function checkIdle(state) {
    if (isPending(state))
        return;
    for (const resolve of state.idle.splice(0))
        resolve();
}
/** 等待所有挂起写入结束（确定性就绪信号）。 */
function waitIdle(state) {
    if (!isPending(state))
        return Promise.resolve();
    return new Promise((resolve) => {
        state.idle.push(resolve);
        checkIdle(state);
    });
}
/** drain：取消防抖等待立即尝试写（最小间隔仍由调度器保证），并等待结束。 */
function drainWrites(state) {
    cancelTimer(state);
    if (state.dirty)
        runWrite(state, false);
    return waitIdle(state);
}
/** flush：立即强写（force=true）并等待完成；无变更也写一次（teardown 语义）。 */
function flushWrites(state) {
    cancelTimer(state);
    state.dirty = true;
    runWrite(state, true);
    return waitIdle(state);
}
