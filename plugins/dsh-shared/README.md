# dsh-shared

**DSH 插件共享工具包**：多插件共用的 server 端工具，消除复制粘贴；资源护栏（上限 / 节流 / 淘汰 / 写入调度 / 降级看门狗）统一收口在这里。

## 功能

- **信任围栏** `isTrustedApiRequest` / `header`：Host-header 信任校验（loopback 或受信权威、非 cross-site、origin 与 host 同源）。
- **HTTP JSON** `readJsonBody` / `writeJson` / `writeError`：有界 JSON 请求体读取与 JSON 响应写入。
- **配置持久化** `currentProfile` / `profileDirOf` / `patchFileOf` / `extractConfig` / `writePatchConfig`：`cordis.patch.yml` 的 YAML 子集读写（原子写 tmp+rename）。
- **项目根解析** `findProjectRoot(cwd)`：最近 `.git` 祖先目录。
- **异步与消息** `withTimeout(promise, ms)` / `userMessage(text)`。
- **原子写快照** `atomicWriteJson`：JSON 快照原子写；**默认安全**——节流 1s、上限 1MB，被拦不静默（warn + `atomicWriteStats()` 计数），放宽需显式传参。
- **jsonl 增量追加** `jsonlAppender`：只写新行 + 防抖批量追加，杜绝写放大；**高频事件持久化必须用它**。
- **有界容器** `boundedMap` / `boundList`：上限 + 淘汰语义 + `evicted` 计数，不改变既有持久化格式。
- **写入调度** `createWriteScheduler`：防抖 + 最小间隔 + 串行链；`drain()` 是确定性就绪信号（测试替掉 sleep），`flush()` 退出前强写。
- **资源看门狗** `createResourceGuard`：采样 → 阈值判定 → 连续确认后降级/恢复；CPU/内存超限**只告警不降级**。

## 关键边界：写入节奏只能有一个来源

用 `createWriteScheduler` 时，写回调里的快照原语**必须**带 `minIntervalMs: 0`（关节流，节奏全交给调度器）；反之用 `atomicWriteJson` 节流时不要再套调度器。两道节流同开会让这次写被拒并重排耗尽，结果是**状态永不落盘且不报错**（只剩一条 warn）。

## 安装

`dsh-shared` 是纯工具库（`dsh.kind=library`，非 DSH 插件，无 `cordis.patch.yml`），**无需单独安装**——依赖方在 `dependencies` 声明 `dsh-shared` 后由 npm 随插件自动安装。

## 相关文档

→ [共享工具包概述](../../docs/共享工具包/概述.md) · [踩坑索引](../../docs/踩坑/README.md) · 资源预算五维口径见 `skills/resource-budget-review/SKILL.md`
