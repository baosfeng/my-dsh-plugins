/**
 * dsh-my-observability — 资源阈值判定（纯函数）。
 *
 * 阈值口径与 skill `resource-budget-review` 一致（设计/开发/运行三遍校验
 * 的运行期部分）：写放大/CPU/内存超限在采样数据上提前暴露，告警可查询。
 * 纯函数便于单测与配置覆盖（config.resourceLimits 浅合并）。
 */
/** 默认阈值（DSH 插件场景，来源 resource-budget-review 五维表）。 */
export const DEFAULT_LIMITS = {
    /** 审计文件写入速率上限：50 MB/小时。 */
    writeRateBytesPerHour: 50 * 1024 * 1024,
    /** 审计文件大小上限：50 MB（循环 compact 后应远小于此）。 */
    fileBytes: 50 * 1024 * 1024,
    /** 本进程 CPU 均值上限：10%（单核折算，采样窗口内 user+sys / 时长）。 */
    cpuPercent: 10,
    /** 本进程 RSS 上限：500 MB。 */
    memoryBytes: 500 * 1024 * 1024,
};
/** 采样数据 → 告警列表（[{ rule, level, message, value, limit }]）。 */
export function evaluateResourceAlerts(sample, limits = DEFAULT_LIMITS) {
    const alerts = [];
    if (typeof sample.writeRateBytesPerHour === 'number' && sample.writeRateBytesPerHour > limits.writeRateBytesPerHour) {
        alerts.push({
            rule: 'write-rate',
            level: 'error',
            message: `审计写入速率 ${fmtMB(sample.writeRateBytesPerHour)}/h 超过上限 ${fmtMB(limits.writeRateBytesPerHour)}/h（写放大风险）`,
            value: sample.writeRateBytesPerHour,
            limit: limits.writeRateBytesPerHour,
        });
    }
    if (typeof sample.fileBytes === 'number' && sample.fileBytes > limits.fileBytes) {
        alerts.push({
            rule: 'file-size',
            level: 'error',
            message: `审计文件 ${fmtMB(sample.fileBytes)} 超过上限 ${fmtMB(limits.fileBytes)}（请检查 compact/轮转）`,
            value: sample.fileBytes,
            limit: limits.fileBytes,
        });
    }
    if (typeof sample.cpuPercent === 'number' && sample.cpuPercent > limits.cpuPercent) {
        alerts.push({
            rule: 'cpu',
            level: 'warn',
            message: `本进程 CPU ${Math.round(sample.cpuPercent)}% 超过上限 ${limits.cpuPercent}%`,
            value: sample.cpuPercent,
            limit: limits.cpuPercent,
        });
    }
    if (typeof sample.memoryBytes === 'number' && sample.memoryBytes > limits.memoryBytes) {
        alerts.push({
            rule: 'memory',
            level: 'warn',
            message: `本进程内存 ${fmtMB(sample.memoryBytes)} 超过上限 ${fmtMB(limits.memoryBytes)}`,
            value: sample.memoryBytes,
            limit: limits.memoryBytes,
        });
    }
    return alerts;
}
/** 连续多少次采样超限（关键阈值）判定进入降级（模块内默认值）。 */
const DEGRADE_CONFIRM_COUNT = 3;
/** 连续多少次采样正常判定退出降级（模块内默认值）。 */
const RECOVER_CONFIRM_COUNT = 3;
/**
 * 关键阈值判定：磁盘写放大风险主导（write-rate / file-size 任一超限即记超限）。
 * CPU/内存超限告警但不触发落盘降级（避免误伤正常大请求峰值）。
 */
function isCriticalOverLimit(sample, limits = DEFAULT_LIMITS) {
    return ((sample.writeRateBytesPerHour ?? 0) > limits.writeRateBytesPerHour || (sample.fileBytes ?? 0) > limits.fileBytes);
}
/**
 * 降级判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值超限 → 进入降级。
 * 历史样本不足 confirmCount 时不降级（冷启动保护）。
 * 返回布尔（shouldEnterDegrade）。
 */
export function shouldEnterDegrade(history, limits = DEFAULT_LIMITS, confirmCount = DEGRADE_CONFIRM_COUNT) {
    const recent = history.slice(-confirmCount);
    if (recent.length < confirmCount)
        return false;
    return recent.every((sample) => isCriticalOverLimit(sample, limits));
}
/**
 * 恢复判定（纯函数）：最近 confirmCount 个样本**全部**关键阈值正常 → 退出降级。
 * 历史样本不足 confirmCount 时不恢复（避免刚降级立即恢复抖动）。
 */
export function shouldExitDegrade(history, limits = DEFAULT_LIMITS, confirmCount = RECOVER_CONFIRM_COUNT) {
    const recent = history.slice(-confirmCount);
    if (recent.length < confirmCount)
        return false;
    return recent.every((sample) => !isCriticalOverLimit(sample, limits));
}
function fmtMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
