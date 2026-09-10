/**
 * dsh-shared — atomic JSON persistence（由 dsh-file-activity / dsh-my-context /
 * dsh-my-guard / dsh-my-observability 的 store/persist 原子写逻辑抽取合并，
 * issue #45）。
 *
 * ⚠️ 资源护栏（quality-gates #11）：本函数是「全量快照」原语，只适用于
 * 低频全量写（配置/状态快照）。高频增量写必须用 jsonlAppender（lib/jsonl.js）
 * ——每次落盘全量重写大状态正是 9/2 审计插件写放大事故的根因。
 * 可选 options 护栏：minIntervalMs（节流窗口，超频跳过）、maxBytes（巨型
 * 对象拒绝），超限均 warn 并返回 false。
 */
import type { Logger } from './types.js';
/** 原子写选项。 */
export interface AtomicWriteOptions {
    /** 节流窗口（毫秒）：窗口内重复写入被跳过。 */
    minIntervalMs?: number;
    /** 最大字节数：超过则拒绝写入。 */
    maxBytes?: number;
}
/**
 * 原子写 JSON 快照（tmp+rename，自动建目录）；失败仅告警不抛出。
 * 调用方负责串行化（dirtyChain）与防抖调度。
 * 返回 true=已写盘；false=被护栏拒绝（节流/超限）。
 */
export declare function atomicWriteJson(file: string, value: unknown, logger: Logger | undefined, prefix: string, options?: AtomicWriteOptions): Promise<boolean>;
