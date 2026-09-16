import type { Logger } from './types.js';
/** jsonlAppender 选项。 */
export interface JsonlOptions {
    /** 防抖窗口（毫秒），默认 500。 */
    flushMs?: number;
    /** compact 阈值（行数），默认 5000。 */
    compactLines?: number;
    /** 日志器（可选 warn）。 */
    logger?: Logger;
    /** 阈值回调（可选）。 */
    onCompact?: (() => void) | null;
    /** 日志前缀。 */
    prefix?: string;
}
/** jsonlAppender 统计信息。 */
export interface JsonlStats {
    total: number;
    bytesWritten: number;
    writes: number;
}
/** jsonlAppender 句柄接口。 */
export interface JsonlHandleInterface {
    append: (value: unknown) => void;
    flush: () => void;
    snapshot: (lines: string[]) => Promise<void>;
    dispose: () => Promise<void>;
    stats: () => JsonlStats;
    /**
     * **已排空信号**（issue #343）：清防抖/compact 定时器 → 冲刷队列 → 等写链（含回调触发的
     * 快照）全部跑完再 resolve。`append()`/`flush()` 是同步排队语义，调用方无法 await 到
     * "确已落盘"；补上本方法后，用例不必再用 `await sleep(flushMs + 余量)` 赌防抖窗口到期。
     */
    drained: () => Promise<void>;
}
/**
 * 创建 jsonl 追加器句柄（file 为绝对/相对路径）。
 * options: flushMs（防抖，默认 500）、compactLines（阈值，默认 5000）、
 *          logger（可选 warn）、onCompact（阈值回调，可选）、prefix（日志前缀）。
 */
export declare function jsonlAppender(file: string, options?: JsonlOptions): JsonlHandleInterface;
/** 解析 jsonl 文本为行数组（空行/非 JSON 行跳过）。 */
export declare function parseJsonlLines(text: string): string[];
