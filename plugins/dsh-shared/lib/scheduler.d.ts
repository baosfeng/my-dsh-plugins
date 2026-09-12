/**
 * dsh-shared — 写入调度原语（issue #198 第二批）。
 *
 * 审计缺口：各插件重复实现「防抖 persistSoon + dirtyChain 串行链」（my-context /
 * my-guard / skill-manager / 旧 file-activity 结构几乎逐行相同），且「等落盘」
 * 只能靠固定 sleep —— 这正是 CI flaky 的根因
 * （docs/踩坑/固定sleep等异步落盘导致CI-flaky.md：sleep 不表达条件，只表达"我猜够了"）。
 *
 * createWriteScheduler 把三层职责收口到一处：
 *  1. **防抖**（debounceMs，默认 500ms）：窗口内多次 schedule 合并为一次写；
 *  2. **最小间隔**（minIntervalMs，默认 1000ms，与 atomicWriteJson 默认护栏对齐）：
 *     调度器自己保证两次写的间隔 —— 护栏是兜底，不该由它来拦正常节奏；
 *  3. **串行链**：写回调永不并发（tmp+rename 同名临时文件冲突的根因）；
 * 加上：
 *  4. **drain()** —— 确定性就绪信号：await 之后所有挂起写入（含因最小间隔推迟的）
 *     都已结束，测试/teardown 不必再 sleep 猜时间；
 *     ⚠️ 配置契约：minIntervalMs 应与落盘护栏（atomicWriteJson 的 minIntervalMs）
 *     一致——两者默认都是 1000ms；若调用方把调度间隔调得比护栏窗口小，护栏会拦下
 *     「正常节奏」的写（走重排路径：不丢数据但多一次重试）。
 *  5. **flush()** —— 退出前立即强写（以 force=true 调用写回调）；
 *  6. **被护栏拒绝自动重排**：写回调返回 false（atomicWriteJson 节流/超限）时，
 *     调度器保留脏标记并重排（默认最多重试 maxWriteRetries 次），重试耗尽才放弃并
 *     warn —— 绝不静默丢状态，也绝不无限重试制造写放大。
 *
 * 用法：
 *   const scheduler = createWriteScheduler({
 *     debounceMs: 500,
 *     minIntervalMs: 1000,
 *     logger,
 *     write: ({ force }) => atomicWriteJson(file, state, logger, prefix, { force, maxBytes }),
 *   })
 *   scheduler.schedule()   // 变更后调度（防抖）
 *   await scheduler.drain() // 测试/就绪信号：确定已落盘
 *   await scheduler.flush() // teardown：立即强写
 *
 * ⚠️ 适用边界与反例：
 *  - 适用：**状态快照型**落盘（低频全量写，状态有界），需要防抖 + 节流 + 串行；
 *  - 不适用：**事件流型**高频追加——用 jsonlAppender（lib/jsonl.ts），
 *    调度器会把事件合并成一次「全量写」，正是写放大事故的模式；
 *  - 不适用：需要「写成功才返回给用户」的同步语义（如 API 保存流程）——直接
 *    调 atomicWriteJson 并检查返回值，或 `await scheduler.flush()`。
 */
import type { Logger } from './types.js';
/** 默认防抖窗口（ms）。 */
export declare const DEFAULT_DEBOUNCE_MS = 500;
/** 默认最小写间隔（ms）：与 atomicWriteJson 的默认节流窗口一致。 */
export declare const DEFAULT_MIN_WRITE_INTERVAL_MS = 1000;
/** 默认写回调被拒后的最大连续重试次数。 */
export declare const DEFAULT_MAX_WRITE_RETRIES = 3;
/** 写回调入参：force = 立即强写（跳过调度器自身的最小间隔，并透传给 atomicWriteJson）。 */
export interface WriteContext {
    force: boolean;
}
/** 调度器选项。 */
export interface WriteSchedulerOptions {
    /** 实际落盘动作；返回 false 表示被护栏拒绝（调度器会重排）。 */
    write: (context: WriteContext) => Promise<boolean | void> | boolean | void;
    /** 防抖窗口（ms），默认 {@link DEFAULT_DEBOUNCE_MS}。 */
    debounceMs?: number;
    /** 最小写间隔（ms），默认 {@link DEFAULT_MIN_WRITE_INTERVAL_MS}。 */
    minIntervalMs?: number;
    /** 被拒后最大连续重试次数，默认 {@link DEFAULT_MAX_WRITE_RETRIES}。 */
    maxWriteRetries?: number;
    /** 日志器（可选 warn）。 */
    logger?: Logger;
    /** 日志前缀。 */
    prefix?: string;
}
/** 调度器统计（资源观测）。 */
export interface WriteSchedulerStats {
    /** 成功落盘次数（写回调未返回 false 且未抛错）。 */
    writes: number;
    /** 被防抖合并掉的调度次数。 */
    coalesced: number;
    /** 被护栏拒绝后的重排次数。 */
    retried: number;
    /** 写回调抛错次数。 */
    failures: number;
}
/** 写入调度器句柄。 */
export interface WriteScheduler {
    /** 防抖调度一次写（变更后调用，可高频安全调用）。 */
    schedule: () => void;
    /** 立即强写并等待完成（teardown / 用户显式保存）。 */
    flush: () => Promise<void>;
    /** 等待所有挂起写入结束（确定性就绪信号；无挂起时立即 resolve）。 */
    drain: () => Promise<void>;
    /** 是否还有未落盘的变更（挂起 / 推迟 / 在飞）。 */
    pending: () => boolean;
    /** 统计快照。 */
    stats: () => WriteSchedulerStats;
}
/** 创建写入调度器（见文件头「三层职责」与适用边界）。 */
export declare function createWriteScheduler(options: WriteSchedulerOptions): WriteScheduler;
