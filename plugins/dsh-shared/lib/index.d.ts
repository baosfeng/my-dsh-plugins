/**
 * dsh-shared — DSH 插件共享工具包入口。
 *
 * 提供：
 *  - isTrustedApiRequest — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - header — 字符串型请求头读取（围栏与路由共用）
 *  - readJsonBody / writeJson / writeError — HTTP JSON 读写工具
 *  - currentProfile / profileDirOf / patchFileOf / extractConfig /
 *    writePatchConfig — 配置持久化（cordis.patch.yml YAML 子集读写）
 *  - atomicWriteJson / atomicWriteStats — 原子写快照（**默认护栏**：1s 节流 + 1MB 上限）
 *  - jsonlAppender / parseJsonlLines — JSON Lines 增量追加（事件流唯一正确原语）
 *  - boundedMap / boundList — 有界容器（淘汰语义 + 淘汰计数）
 *  - createWriteScheduler — 写入调度（防抖 + 最小间隔 + 串行链 + drain/flush）
 *  - createResourceGuard — 资源看门狗（采样 → 阈值判定 → 连续确认降级/恢复）
 *  - createProcessSampler — 进程/文件采样源（CPU/RSS/文件字节/写入速率）
 *  - evaluateResourceAlerts / shouldEnterDegrade / shouldExitDegrade — 判定纯函数
 *
 * 由各插件 lib/fence.js、lib/http.js、lib/config-store.js 抽取合并
 * （issue #45），消除多插件间复制粘贴；资源护栏原语见 issue #198
 * （默认安全 + 有界容器 + 写入调度 + 资源看门狗）。
 * 依赖方在 dependencies 声明 dsh-shared（issue #72：npm 随插件安装自动安装，
 * 依赖先发版）。
 *
 * 原语选型与适用边界：plugins/dsh-shared/README.md、docs/共享工具包/。
 */
export { isTrustedApiRequest, header } from './fence.js';
export { readJsonBody, writeJson, writeError } from './http.js';
export { currentProfile, profileDirOf, patchFileOf, extractConfig, writePatchConfig } from './config-store.js';
export { findProjectRoot } from './project.js';
export { withTimeout, userMessage } from './async.js';
export { atomicWriteJson, atomicWriteStats, DEFAULT_MAX_BYTES, DEFAULT_MIN_INTERVAL_MS } from './persist.js';
export { jsonlAppender, parseJsonlLines } from './jsonl.js';
export { BoundedMap, boundedMap, boundList, DEFAULT_BOUND_MAP_SIZE, DEFAULT_BOUND_LIST_SIZE } from './bounded.js';
export { createWriteScheduler, DEFAULT_DEBOUNCE_MS, DEFAULT_MAX_WRITE_RETRIES, DEFAULT_MIN_WRITE_INTERVAL_MS, } from './scheduler.js';
export { DEFAULT_RESOURCE_LIMITS, DEFAULT_GUARD_CONFIRM_COUNT, evaluateResourceAlerts, shouldEnterDegrade, shouldExitDegrade, } from './resource-rules.js';
export { createResourceGuard, createProcessSampler, DEFAULT_GUARD_INTERVAL_MS, DEFAULT_GUARD_HISTORY_SIZE, } from './resource-guard.js';
export type { IncomingHeaders, IncomingRequest, ServerResponse, Logger, ConfigValue, ConfigDict } from './types.js';
export type { UserMessage } from './async.js';
export type { AtomicWriteOptions, AtomicWriteStats, AtomicWriteBlocked } from './persist.js';
export type { JsonlOptions, JsonlStats, JsonlHandleInterface } from './jsonl.js';
export type { BoundedList, BoundedListOptions, BoundedMapOptions, BoundedMapStats, BoundedPolicy } from './bounded.js';
export type { WriteContext, WriteScheduler, WriteSchedulerOptions, WriteSchedulerStats } from './scheduler.js';
export type { ResourceLimits, ResourceAlert } from './resource-rules.js';
export type { ResourceSample } from './resource-guard-types.js';
export type { ResourceGuard, ResourceGuardOptions, ResourceGuardStats, ResourceSnapshot, ResourceSampler, ProcessSamplerOptions, } from './resource-guard.js';
