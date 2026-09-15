# dsh-my-context

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="上下文透镜面板：概览卡片 + 上下文占用进度条与溢出预警 + 上下文构成条 + 请求记录 + 预算告警与设置" src="https://unpkg.com/dsh-my-context/assets/context-panel.png" width="640" />
</div>

**dsh-my-context**：DSH 上下文透镜 + 成本治理插件——**上下文透镜**统计每次请求的 token 用量与上下文构成（system / tools / user / 注入 / assistant / 工具结果）、可视化 KV 缓存命中率与上下文占用预警，按会话隔离、重启后恢复；**成本治理**提供每轮 / 每会话 token 预算，超限提醒（warn）或拦截（deny）。

## 功能

- **token 用量统计**：从 DSH 事件流读取每次请求的 system prompt + tools 估算、assistant 真实 usage（input / output / cacheRead / cacheWrite）、user / 注入构成、工具结果与上下文窗口。
- **KV 缓存命中率**：`cacheRead / (input + cacheRead)`，长会话的缓存收益一目了然。
- **上下文构成**：按 system / tools / user / inject / assistant / tool 六类拆分，每次请求留存快照。
- **上下文溢出预警**：概览卡「上下文占用」进度条比对累计用量与上下文窗口，按 `warnThreshold`（默认 0.8）→ 预警、`alertThreshold`（默认 0.9）→ 告警、固定 0.95 → 严重分级，命中时给出压缩建议并记录「溢出预警」列表。
- **预算治理**：每轮 / 每会话 token 上限（0 = 不限制）；warn 只记录告警不打断流程，deny 优雅结束本轮（blocked）；同一会话同一 scope 60s 内不重复告警。
- **侧边栏面板**：「上下文透镜」页签含概览卡片、构成条、请求记录、预算设置与预算告警列表；面板可见时 5s 轮询、隐藏时暂停。
- **会话隔离与防膨胀**：统计按会话分桶，持久化到 `$DSH_HOME/context/context.json`（防抖 + 原子写），每会话请求记录上限 500 条 FIFO、告警 50 条。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-context --trust-lockfile`——无需克隆本仓库；link 方式供本仓库开发者使用。

```bash
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-context
```

安装后重启 `dsh web`（server 端改动需重启；client 端改动硬刷新浏览器即可）。

## 配置

插件行的 `config:` 块，均可省略：

| 配置项           | 默认值   | 说明                                |
| ---------------- | -------- | ----------------------------------- |
| `perTurn`        | `0`      | 每轮 token 上限（0 = 不限制）       |
| `perSession`     | `0`      | 每会话 token 上限（0 = 不限制）     |
| `mode`           | `'warn'` | 超限行为：`warn` 提醒 / `deny` 拦截 |
| `warnThreshold`  | `0.8`    | 溢出预警阈值（进度条变色）          |
| `alertThreshold` | `0.9`    | 溢出告警阈值（95% 固定为严重）      |

预算与阈值也可在侧边栏面板中动态修改（`POST /context/api/budget`、`POST /context/api/overflow`）。

## 相关文档

→ [上下文透镜模块文档](../../docs/上下文透镜/概述.md)
