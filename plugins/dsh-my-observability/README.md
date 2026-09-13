# dsh-my-observability

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="轨迹回放面板：侧边栏时间轴展示 agent 行为（状态/模型流/工具调用）" src="https://unpkg.com/dsh-my-observability/assets/replay-panel.png" width="640" />
  <img alt="Git 工具面板：仓库状态 / 差异 / 提交前审查 / 类型化提交" src="https://unpkg.com/dsh-my-observability/assets/git-panel.png" width="640" />
</div>

**DSH 可观测性 + Git 工程工具插件**：**事件审计**记录 agent 的每一次行为（状态变化 / 模型流 / 工具调用与结果），**轨迹回放面板**在侧边栏按时间轴回放会话轨迹；**结构化 Git 工具**提供 Conventional Commits 类型化提交；**增量 diff 审查**在提交前用规则引擎（可选 AI 增强）检查调试残留、密钥泄露等问题。

## 功能

### 1. 事件审计（agent 行为可追溯）

Server 端只读观察 DSH 生命周期事件并记录审计日志：

| 事件                | 审计记录       | 说明                                                                 |
| ------------------- | -------------- | -------------------------------------------------------------------- |
| `agent/status`      | `agent_status` | 状态变化 + 顶层/子代理标记                                           |
| `llm/stream`        | `llm_stream`   | 流开始/结束/错误 + chunk/字符/耗时统计（同步包装流，透传全部 chunk） |
| `tools/pre-execute` | `tool_call`    | 工具名 + 参数键列表 + 主要文本参数截断摘要                           |
| `tools/execute`     | `tool_result`  | 工具名 + 成功/失败 + 耗时                                            |

- **会话隔离**：事件按会话分桶，切换会话互不串扰；
- **重启恢复**：持久化到 `$DSH_HOME/observability/audit.jsonl`（**增量追加** + 防抖批量 flush + 周期 compact 原子快照），重启后完整恢复；升级前旧格式 `audit.json` 自动迁移；
- **防膨胀**：每会话最多 2000 条（FIFO 淘汰）、全局 20000 条（轮转淘汰）；
- **零写放大**：落盘只写新增事件（≈事件本体字节），不会因事件流持续而反复全量重写审计文件；
- **资源监控 + 自动降级（资源看门狗）**：面板「资源」区块展示本进程 CPU/内存 + 审计文件大小与写入速率（15s 采样），写放大/超限自动告警（告警列表展示在「资源」区块，阈值见 `resource-budget-review`）；写入速率/文件大小连续超限自动**暂停落盘**（事件仍入内存，有界不丢），回落自动恢复（全量快照补齐降级窗口），全程日志告警 + API `degraded` 标记（issue #127）。
- **只读观察**：waterfall 事件一律透传 `next()`，绝不改变工具/模型流程。

### 2. 轨迹回放面板（时间轴）

侧边栏「轨迹回放」页签：选择会话 + 类型过滤（全部 / 状态 / 模型流 / 工具），按时间轴展示 agent 行为（类型徽标 + 时间 + 摘要）；面板可见时 5s 轮询、隐藏时暂停。

### 3. 结构化 Git 工具（类型化提交）

侧边栏「Git 工具」页签：输入仓库路径 → 查看状态（分支 + 暂存/未暂存计数）与差异（工作区/暂存区）→ **类型化提交**：

- 类型枚举：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`；
- 消息格式：`<type>(<scope>): <description>`（scope 可选，body 可选）；
- 服务端生成消息 + `execFile` 执行 git（不经 shell），提交历史清晰可追溯。

### 4. 增量 diff 审查（提交前审查）

「提交前审查」按钮对增量 diff 运行规则引擎（确定性、可测试）：

| 规则              | 严重级别 | 检查内容                                              |
| ----------------- | -------- | ----------------------------------------------------- |
| `secret-leak`     | error    | 密钥/凭据硬编码（password/api_key/secret/token）      |
| `conflict-marker` | error    | 合并冲突标记残留（`<<<<<<<` / `=======` / `>>>>>>>`） |
| `debug-statement` | warning  | 调试残留（console.* / debugger / print 族）           |
| `large-diff`      | warning  | 单文件变更 > 300 行                                   |
| `binary-file`     | warning  | 二进制文件变更                                        |
| `todo-marker`     | info     | TODO/FIXME/HACK 标记                                  |
| `trailing-space`  | info     | 行尾多余空格                                          |
| `no-test-change`  | info     | 有源码变更但无测试变更                                |

- **可选 AI 审查**：配置 `aiReview`（默认开）且 agents 服务可用时，创建独立审查 agent 阅读 diff 输出总评（verdict/summary/topIssues）；超时/失败/解析失败自动降级，规则引擎结果不受影响（AI 是增强，不是门禁）。

## 工作原理

- **Server 端**（`lib/index.js`）：`audit.js` 监听四类事件 → `store.js` 按会话分桶持久化；`git.js` 类型化提交（execFile）；`review.js` + `diff.js` 规则引擎；`ai.js` 可选 AI 增强；`routes.js` 提供 `/observability/api` 路由（全部经 loopback 信任围栏）。
- **Client 端**（`lib/client.js`）：两个侧边栏页签（`dsh-my-observability:replay` 轨迹回放、`dsh-my-observability:git` Git 工具），每个面板一个页签类型，经**宿主原生侧边栏扩展点**注册（`ctx.sidebarRightTabs` 页签类型 + `slots` 的 `sidebar.right.pane.tab` / `.title` 席位，issue #187 批 1），样式走 DSH 语义 token，随 fiber 卸载无残留。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-observability --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-observability
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新（Cmd/Ctrl+Shift+R）即可。

## 配置

插件级配置（`cordis.patch.yml` 对应插件行的 `config` 字段，均为可选）：

```yaml
- insert:
    - id: observability
      name: 'dsh-my-observability'
    - config: # 传给 apply(ctx, config)
        aiReview: true # 增量 diff 审查启用 AI 增强（默认 true；agents 服务不可用时自动降级）
        aiTimeoutMs: 60000 # AI 审查超时（毫秒，默认 60000）
```

## 依赖

| 依赖     | 用途          | 可选           |
| -------- | ------------- | -------------- |
| `cordis` | 插件运行时    | 是（宿主提供） |
| `react`  | client 端组件 | 是（宿主提供） |

## 限制与说明

- **Git 工具作用于本机仓库**：仓库路径由你在面板中输入（localStorage 记住），仅本机可访问（loopback 围栏）。
- **AI 审查需要 agents 服务**：不可用时审查自动降级为纯规则引擎结果，不影响使用。
- **审计上限**：每会话 2000 条 / 全局 20000 条，超出自动淘汰最旧事件。

## 相关文档

→ [可观测性模块文档](../../docs/可观测性/概述.md) · [需求清单](../../docs/可观测性/需求清单.md) · [CHANGELOG](CHANGELOG.md)
