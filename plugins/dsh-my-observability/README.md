# dsh-my-observability

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="轨迹回放面板：侧边栏时间轴展示 agent 行为（状态/模型流/工具调用）" src="https://unpkg.com/dsh-my-observability/assets/replay-panel.png" width="640" />
  <img alt="Git 工具面板：仓库状态 / 差异 / 提交前审查 / 类型化提交" src="https://unpkg.com/dsh-my-observability/assets/git-panel.png" width="640" />
</div>

**dsh-my-observability**：DSH 可观测性 + Git 工程工具插件——**事件审计**记录 agent 的每一次行为（状态变化 / 模型流 / 工具调用与结果），**轨迹回放面板**按时间轴回放会话轨迹；**结构化 Git 工具**提供 Conventional Commits 类型化提交；**增量 diff 审查**在提交前用规则引擎（可选 AI 增强）检查调试残留、密钥泄露等问题。

## 功能

- **事件审计**：只读观察并记录 `agent/status`（状态变化 + 顶层/子代理标记）、`llm/stream`（流开始/结束/错误 + chunk 与耗时统计，透传全部 chunk）、`tools/pre-execute`（工具名 + 参数摘要）、`tools/execute`（成功/失败 + 耗时）；waterfall 事件一律透传 `next()`，绝不改变工具/模型流程。
- **持久化与上限**：按会话分桶增量追加到 `$DSH_HOME/observability/audit.jsonl`（防抖批量 flush + 周期原子 compact），重启后完整恢复；每会话上限 2000 条、全局 20000 条，超出淘汰最旧事件。
- **轨迹回放面板**：侧边栏「轨迹回放」页签，选会话 + 类型过滤（全部 / 状态 / 模型流 / 工具），时间轴展示类型徽标 + 时间 + 摘要；可见时 5s 轮询、隐藏时暂停。
- **结构化 Git 工具**：侧边栏「Git 工具」页签，输入仓库路径查看分支与暂存/未暂存计数、工作区/暂存区差异，按 `<type>(<scope>): <description>` 生成类型化提交（`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`）；服务端 `execFile` 执行 git，不经 shell。
- **增量 diff 审查**：「提交前审查」对增量 diff 跑确定性规则引擎——error：密钥/凭据硬编码、合并冲突标记；warning：调试残留（console/debugger/print）、单文件变更 > 300 行、二进制文件变更；info：TODO/FIXME/HACK 标记、行尾空格、有源码变更但无测试变更。
- **资源看门狗**：面板「资源」区块展示本进程 CPU/内存 + 审计文件大小与写入速率（15s 采样），写放大或连续超限时自动暂停落盘（事件仍入内存，有界不丢），回落自动恢复，附日志告警与 API `degraded` 标记。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-observability --trust-lockfile`——无需克隆本仓库；link 方式供本仓库开发者使用。

```bash
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-observability
```

server 端改动需重启 `dsh web`；client 端改动硬刷新浏览器（Cmd/Ctrl+Shift+R）即可。

## 配置

插件行 `config` 字段，均可选：

| 配置键        | 作用                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `aiReview`    | 增量 diff 审查启用 AI 增强（默认 `true`；agents 服务不可用时自动降级） |
| `aiTimeoutMs` | AI 审查超时（毫秒，默认 60000）                                        |

`aiReview` 与 `aiTimeoutMs` 可在 **设置 → 插件 → 可观测性** 里可视化编辑：保存即写回 profile 层 `cordis.patch.yml` 的插件行（行 id `observability`，其余手写键原样保留），DSH 热重载后立即生效，无需重启。其余字段（`aiProvider` / `aiModel` / `aiCwd` / `resourceIntervalMs` 等）仍按上表在 `cordis.patch.yml` 手写；非法值不会写坏配置（`aiReview` 非布尔忽略，`aiTimeoutMs` 非正/非有限回退 60000）。

## 限制与说明

- **Git 工具作用于本机仓库**：仓库路径由你在面板输入（localStorage 记住），仅本机可访问（loopback 围栏）。
- **AI 审查是增强不是门禁**：agents 服务不可用或超时/解析失败时自动降级为纯规则引擎结果。
- **审计有上限**：每会话 2000 条 / 全局 20000 条，超出自动淘汰最旧事件。

## 相关文档

→ [可观测性模块文档](../../docs/可观测性/概述.md) · [CHANGELOG](CHANGELOG.md)
