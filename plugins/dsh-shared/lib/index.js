/**
 * dsh-shared — DSH 插件共享工具包入口。
 *
 * 提供：
 *  - isTrustedApiRequest — Host-header 信任围栏（loopback / trustedHosts / 同源）
 *  - header — 字符串型请求头读取（围栏与路由共用）
 *  - readJsonBody / writeJson / writeError — HTTP JSON 读写工具
 *  - currentProfile / profileDirOf / patchFileOf / extractConfig /
 *    writePatchConfig — 配置持久化（cordis.patch.yml YAML 子集读写）
 *
 * 由各插件 lib/fence.js、lib/http.js、lib/config-store.js 抽取合并
 * （issue #45），消除多插件间复制粘贴；依赖方在 dependencies
 * 声明 dsh-shared（issue #72：npm 随插件安装自动安装，依赖先发版）。
 */
export { isTrustedApiRequest, header } from './fence.js';
export { readJsonBody, writeJson, writeError } from './http.js';
export { currentProfile, profileDirOf, patchFileOf, extractConfig, writePatchConfig } from './config-store.js';
export { findProjectRoot } from './project.js';
export { withTimeout, userMessage } from './async.js';
export { atomicWriteJson } from './persist.js';
export { jsonlAppender, parseJsonlLines } from './jsonl.js';
