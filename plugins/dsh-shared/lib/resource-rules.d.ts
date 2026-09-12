/**
 * dsh-shared — 资源阈值判定（纯函数，issue #198 第三批）。
 *
 * 口径与 skill resource-budget-review 的五维表一致：写放大/CPU/内存超限在
 * 采样数据上提前暴露，告警可查询。纯函数便于单测、便于消费方（observability
 * 等）做配置覆盖（浅合并 ResourceLimits）。
 *
 * 关键阈值（触发降级）只有磁盘两条：write-rate / file-size。CPU/内存超限只
 * 告警——正常大请求峰值会误伤落盘降级（见 {@link isCriticalOverLimit}）。
 */
import type { ResourceSample } from './resource-guard-types.js';
/** 资源阈值。 */
export interface ResourceLimits {
    /** 写入速率上限（字节/小时）。 */
    writeRateBytesPerHour: number;
    /** 受监控文件大小上限（字节）。 */
    fileBytes: number;
    /** 本进程 CPU 均值上限（百分比，单核折算）。 */
    cpuPercent: number;
    /** 本进程 RSS 上限（字节）。 */
    memoryBytes: number;
}
/** 单条告警。 */
export interface ResourceAlert {
    rule: string;
    level: 'error' | 'warn';
    message: string;
    value: number;
    limit: number;
}
/** 默认阈值（DSH 插件场景，来源 resource-budget-review 五维表）。 */
export declare const DEFAULT_RESOURCE_LIMITS: ResourceLimits;
/** 默认连续确认次数（进入降级 / 退出降级共用，防抖动）。 */
export declare const DEFAULT_GUARD_CONFIRM_COUNT = 3;
/** 采样数据 → 告警列表（顺序固定：write-rate / file-size / cpu / memory）。 */
export declare function evaluateResourceAlerts(sample: ResourceSample, limits?: ResourceLimits): ResourceAlert[];
/** 降级判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值超限。 */
export declare function shouldEnterDegrade(history: ResourceSample[], limits?: ResourceLimits, confirmCount?: number): boolean;
/** 恢复判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值正常。 */
export declare function shouldExitDegrade(history: ResourceSample[], limits?: ResourceLimits, confirmCount?: number): boolean;
