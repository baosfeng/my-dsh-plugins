# dsh-shared

DSH 插件共享工具包：多插件共用的 server 端工具，消除复制粘贴（issue #45）；
资源护栏（上限 / 节流 / 淘汰 / 写入调度）统一收口在这里（issue #198）。

## 功能

- **信任围栏** `isTrustedApiRequest(request, trustedHosts)` / `header(headers, name)` — Host-header 信任围栏（与 /api 网关一致的契约）：host 必须为 loopback 或受信权威，且 sec-fetch-site 不得为 cross-site、origin（若存在）必须与 host 同源。
- **HTTP JSON 工具** `readJsonBody(request)` / `writeJson(response, status, value)` / `writeError(response, error)` — 有界 JSON 请求体读取与 JSON 响应写入。
- **配置持久化** `currentProfile()` / `profileDirOf(profile)` / `patchFileOf(profile)` / `extractConfig(text, rowId)` / `writePatchConfig(file, rowId, config)` — cordis.patch.yml 的 YAML 子集读写（设置页保存配置，原子写 tmp+rename）。
- **项目根解析** `findProjectRoot(cwd)` — 最近 `.git` 祖先目录（项目级配置/记忆的根）。
- **异步与消息** `withTimeout(promise, ms)` / `userMessage(text)` — 超时包装（不 reject）与 user 角色消息构造。
- **原子写快照（默认护栏）** `atomicWriteJson(file, value, logger, prefix, options?)` — JSON 快照原子写（tmp+rename，自动建目录，失败仅告警）。**默认安全**：`minIntervalMs` 默认 1000ms（节流窗口）、`maxBytes` 默认 1MB（超限拒绝）；被拦**不静默**——warn + `atomicWriteStats()` 计数（`writes/bytesWritten/throttled/rejected/failed`）+ 可选 `onBlocked` 回调。放宽必须显式：`minIntervalMs: 0`（关节流）、`maxBytes: N`（提高上限）、`force: true`（跳过**节流**，字节上限仍生效——仅用于退出前冲刷/用户显式保存）。
- **jsonl 增量追加** `jsonlAppender(file, options)`（+ `parseJsonlLines`）— 防写放大持久化原语：`append(obj)` 只写新行（防抖批量 appendFile）、行数达 `compactLines` 阈值回调 `onCompact` 宿主做 `snapshot(lines)` 原子快照、`dispose()` 冲刷、`stats()` 暴露写入字节/次数。**高频事件持久化必须用它**（9/2 审计插件写放大事故的根治模式）。
- **有界容器** `boundedMap(options)` / `boundList(options)` — 上限 + 淘汰语义 + 淘汰计数：`boundedMap` 默认 LRU（`policy: 'fifo'` 可选）、`boundList` 为 FIFO；两者都暴露 `evicted` 计数与 `onEvict` 回调，`toJSON()` / `items()` 保持「普通对象 / 普通数组」的磁盘 JSON 形态（替换既有字段不改变持久化格式），maxSize 必须为正整数（fail-fast）。
- **写入调度** `createWriteScheduler(options)` — 防抖（`debounceMs` 默认 500ms）+ 最小间隔（`minIntervalMs` 默认 1000ms）+ 串行链 + `drain()`（**确定性就绪信号**：await 后所有挂起写入都已结束，测试/teardown 不再 sleep 猜时间）+ `flush()`（退出前立即强写，force 透传）+ 写回调返回 `false`（被护栏拒绝）时自动重排（`maxWriteRetries` 默认 3，耗尽 warn 放弃）；`stats()` 暴露 `writes/coalesced/retried/failures`。

## 原语选型（先读边界，再动手）

| 数据形态                        | 该用的原语                                         | 反例（错误用法）                                                                                                           |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 事件流（高频追加、每条独立）    | `jsonlAppender`                                    | ❌ 用 `atomicWriteJson` 每次事件全量重写审计日志（写放大数百~数千倍，#126 事故根因）                                       |
| 状态快照（低频全量、数据汇总）  | `createWriteScheduler` + `atomicWriteJson`         | ❌ 裸 `setTimeout` 防抖 + 手写 dirtyChain（各插件重复且易漏节流）；❌ 用 `jsonlAppender` 存需要整体覆盖的配置              |
| 内存字典 / 列表要有上界         | `boundedMap` / `boundList`                         | ❌ 无上限的 `Record`/`Map`/`数组`（会话表、路径表随运行时长线性增长）；❌ 用有界容器存**审计明细**（淘汰即丢数据，应落盘） |
| 需要 LRU 的数组                 | `boundedMap`                                       | ❌ 对数组做「访问即移动到尾部」（O(n)，热路径性能陷阱）                                                                    |
| 降级 / 看门狗（采样→判定→停写） | 第三批 `createResourceGuard`（issue #198，未落地） | ❌ 各插件抄一份 resource-monitor（当前 observability 仍为插件内实现）                                                      |

**适用边界与反例的完整说明**：`docs/共享工具包/概述.md`；资源预算五维评审口径见 `skills/resource-budget-review/SKILL.md` 与 `docs/开发指南/插件资源安全规范.md`。

## 安装

`dsh-shared` 是纯工具库（`dsh.kind=library`，非 DSH 插件，无 `cordis.patch.yml`），**无需单独安装**——依赖方在 `dependencies` 声明后由 npm 自动安装（issue #72：依赖随插件安装自动安装，用户无需手动处理）。

## 使用

```js
import { isTrustedApiRequest, readJsonBody, writeJson, createWriteScheduler, atomicWriteJson } from 'dsh-shared'

// 路由注册时用信任围栏过滤非可信来源
const fence = (request) => isTrustedApiRequest(request, ctx.webRuntime.trustedHosts)

// 状态快照落盘：调度器保证节奏，护栏兜底
const scheduler = createWriteScheduler({
  logger: ctx.logger,
  write: ({ force }) => atomicWriteJson(file, state, ctx.logger, '[my-plugin]', { force, maxBytes: 4 * 1024 * 1024 }),
})
scheduler.schedule() // 变更后调度（防抖合并）
await scheduler.drain() // 就绪信号：确定已落盘（测试用它替掉 sleep）
await scheduler.flush() // teardown：立即强写
```

## 依赖方

依赖本包的插件须在 `dependencies` 声明 `dsh-shared`（issue #72：dsh-shared 是自家工具库而非宿主提供的运行时，用 dependencies 语义——npm 随插件安装自动安装，用户无需手动装；依赖先发版，见 `scripts/release.mjs` 跨插件依赖校验）：

```json
{
  "dependencies": {
    "dsh-shared": "^0.1.0"
  }
}
```

已接入资源护栏的依赖方（issue #198 第一/二批）：`dsh-my-context`（`boundedMap` 会话数上限 + `boundList` 明细数组 + `createWriteScheduler`）、`dsh-my-skill-manager`（`createWriteScheduler`）、`dsh-my-notify`（`atomicWriteJson` 保存路径 `force`）、`dsh-file-activity`（#197 已用 `jsonlAppender`）。

## 开发

```bash
cd plugins/dsh-shared && npm test
```
