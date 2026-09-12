import type { ResourceLimits, ResourceAlert } from './resource-rules.js';
import type { ResourceSample } from './resource-guard-types.js';
import type { Logger } from './types.js';
export { DEFAULT_RESOURCE_LIMITS, DEFAULT_GUARD_CONFIRM_COUNT, evaluateResourceAlerts, shouldEnterDegrade, shouldExitDegrade, } from './resource-rules.js';
export type { ResourceSample } from './resource-guard-types.js';
/** 默认采样间隔（ms）。 */
export declare const DEFAULT_GUARD_INTERVAL_MS = 15000;
/** 默认历史样本数（ring buffer 上限）。 */
export declare const DEFAULT_GUARD_HISTORY_SIZE = 60;
/** 采样快照（采样值 + 历史 + 告警 + 降级标记）。 */
export type ResourceSnapshot<M extends ResourceSample = ResourceSample> = M & {
    history: M[];
    alerts: ResourceAlert[];
    degraded: boolean;
};
/** 看门狗统计（可观测性：采样/降级/恢复/告警计数）。 */
export interface ResourceGuardStats {
    samples: number;
    degraded: number;
    recovered: number;
    alerts: number;
}
/** 看门狗选项。 */
export interface ResourceGuardOptions<M extends ResourceSample = ResourceSample> {
    /** 采样源（宿主注入）：返回本窗口指标；previous 为上一窗口样本（首个为 null）。 */
    collect: (previous: M | null, now: number) => M;
    /** 阈值覆盖（浅合并默认值）。 */
    limits?: Partial<ResourceLimits>;
    /** 采样间隔（ms），默认 {@link DEFAULT_GUARD_INTERVAL_MS}。 */
    intervalMs?: number;
    /** 历史 ring buffer 上限，默认 {@link DEFAULT_GUARD_HISTORY_SIZE}。 */
    historySize?: number;
    /** 连续确认次数（进入降级），默认 {@link DEFAULT_GUARD_CONFIRM_COUNT}。 */
    enterConfirmCount?: number;
    /** 连续确认次数（退出降级），默认 {@link DEFAULT_GUARD_CONFIRM_COUNT}。 */
    exitConfirmCount?: number;
    /** 进入降级（宿主在此执行降级动作，如停止落盘）。 */
    onDegrade?: (snapshot: ResourceSnapshot<M>) => void;
    /** 退出降级（宿主在此恢复并做一次全量快照补齐）。 */
    onRecover?: (snapshot: ResourceSnapshot<M>) => void;
    /** 日志器（回调异常 warn）。 */
    logger?: Logger;
    /** 日志前缀。 */
    prefix?: string;
    /** 时钟注入（测试确定性；默认 Date.now）。 */
    now?: () => number;
}
/** 资源看门狗句柄。 */
export interface ResourceGuard<M extends ResourceSample = ResourceSample> {
    /** 采样一次并返回快照（同步；采样源必须是廉价同步函数）。 */
    sample: () => ResourceSnapshot<M>;
    /** 启动周期采样（幂等，返回定时器句柄）。 */
    start: () => ReturnType<typeof setInterval> | null;
    /** 停止周期采样（幂等）。 */
    stop: () => void;
    /** 当前是否处于降级。 */
    isDegraded: () => boolean;
    /** 历史样本副本（ring buffer）。 */
    history: () => M[];
    /** 统计快照。 */
    stats: () => ResourceGuardStats;
}
/** 采样源签名（宿主自定义采样：进程/文件/业务指标）。 */
export type ResourceSampler<M extends ResourceSample = ResourceSample> = (previous: M | null, now: number) => M;
/** 创建资源看门狗（见文件头「三层职责」与适用边界）。 */
export declare function createResourceGuard<M extends ResourceSample = ResourceSample>(options: ResourceGuardOptions<M>): ResourceGuard<M>;
/**
 * 进程 + 文件采样器（observability 这类宿主的默认采样源）：
 * CPU（窗口内 user+sys 单核折算）/ RSS / 受监控文件字节 / 写入速率（字节/小时）。
 * `extra` 供宿主追加自定义维度（如 $DSH_HOME 总字节）。
 * 首个样本无窗口 → cpuPercent / writeRateBytesPerHour 记 0。
 */
export interface ProcessSamplerOptions {
    /** 受监控文件路径（缺失/不可达 → 0 字节，不抛错）。 */
    file: string;
    /** 额外维度（宿主特有；抛错时忽略，不影响主维度）。 */
    extra?: (now: number) => Record<string, number>;
}
/** 创建进程 + 文件采样器（见 {@link ProcessSamplerOptions}）。 */
export declare function createProcessSampler(options: ProcessSamplerOptions): ResourceSampler;
