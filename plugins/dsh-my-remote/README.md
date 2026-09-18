# dsh-my-remote — 远程控制插件

**dsh-my-remote**：离开电脑后依然可以掌控 DSH——ask / approval / 会话结束事件实时下发到外部通道（手机 / IM），在手机上回答 ask、批准 approval、查询会话状态、继续任务。

![npm 版本](https://img.shields.io/badge/dsh--my--remote-v0.1.2-blue) ![DSH 插件](https://img.shields.io/badge/DSH%20Plugin-server--only-lightgrey) ![License](https://img.shields.io/badge/License-MIT-green)

![远程回答 ask：GUI 等待回答卡片](./assets/ask-push.png)

## 功能

- **事件下发**：`ask`（提问等待回答）/ `approval`（等待批准）/ `end`（会话结束）实时下行到外部通道（HTTP webhook / 中转服务 / IM 机器人网关），帧含会话标题、问题文本与选项、审批原因与工具名。
- **远程回答 ask**：外部调用入站 API 提交答案（选项或自由文本），agent 立即收到注入的 answers 并继续执行。
- **远程批准 approval**：外部提交批准（`allowed-once`）或拒绝（`rejected`），approval 等待方立即决议，工具放行或拦截。
- **状态查询 / 继续会话**：查询活动会话、待回答 ask、待批准 approval 快照；`continue` 指令唤醒或继续对应会话。
- **安全**：loopback 信任围栏 + `apiToken` 鉴权（写指令带 `x-remote-token` 头）+ 指令白名单 + 操作审计。
- **设置页**：`设置 → 插件 → 远程控制` 可视化编辑 4 项配置（token 掩码、两个超时、webhook 列表增删改），保存即生效。
- **通道可扩展**：适配器契约渠道无关（事件帧 + 指令格式），HTTP 通道先行，微信/QQ/飞书机器人按同一接口扩展。

![设置 → 插件 → 远程控制：token 掩码、两个超时与 webhook 列表编辑器](./assets/settings-panel.png)

## 安装

```bash
# npm 安装（推荐）
dsh plugin --profile web add dsh-my-remote

# 或从本仓库 link 安装
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-remote
```

## 配置

### 设置页（推荐）

**设置 → 插件 → 远程控制** 面板可视化编辑 4 项配置，保存即生效（写回 profile 层 `cordis.patch.yml` 的 `remote` 行）：

| 项                                   | 说明                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `apiToken`                           | 密码型输入框；已配置时提示「留空则不修改」，不回显原文 |
| `askTimeoutMs` / `approvalTimeoutMs` | 毫秒，0 = 无限等待                                     |
| `webhooks`                           | 列表编辑器：增 / 改 / 删 / 启停（名称、URL、事件多选） |

两处刻意的边界：**webhook 的自定义 `headers`** 与 **`end`/`ask`/`approval` 事件开关**不在面板里，仍需在 yml 手写；面板保存会先读该行已有配置再合并，**不会覆盖这些手写项**。

### 手写配置

`cordis.patch.yml` 中插件行的 `config:` 字段，全部可选：

```yaml
config:
  apiToken: 'your-token' # 写指令鉴权；留空则仅靠 loopback 围栏
  askTimeoutMs: 0 # 远程回答等待超时（0=无限；>0 超时返回空 answers 由模型自行决策）
  approvalTimeoutMs: 0 # 远程批准等待超时（0=无限；>0 超时 fail-closed 拒绝）
  webhooks:
    - name: '我的中转服务'
      url: 'https://relay.example.com/hook'
      events: ['ask', 'approval', 'end'] # 缺省 = 全部
      enabled: true
      headers: # 自定义请求头（中转服务鉴权等）；设置页不暴露，保存时按名称保留
        Authorization: 'Bearer xxx'
```

## 使用（外部通道侧）

外部中转服务/IM 机器人收到下行事件帧（JSON，POST）后，可调用这些端点应答：

| 端点                       | 说明                                         |
| -------------------------- | -------------------------------------------- |
| `GET /remote/api/info`     | 插件开关信息                                 |
| `GET /remote/api/status`   | 活动会话 / 待回答 ask / 待批准 approval 快照 |
| `GET /remote/api/audit`    | 操作审计日志（指令留痕）                     |
| `POST /remote/api/command` | 远程指令统一入口（`x-remote-token` 头鉴权）  |

`command` 动作：`answer`（按问题 id 选项或自由文本回答）、`approve`（`outcome` 为 `allowed-once` 或 `rejected`）、`continue`（经 `agent.steer` 注入用户消息继续会话）。

> 远程调用（非本机）需把 DSH 的 `trustedHosts` 配置为你的中转服务域名，并用 `apiToken` 鉴权。详见 [docs/远程控制/概述.md](../../docs/远程控制/概述.md)。

## 相关文档

→ [远程控制概述](../../docs/远程控制/概述.md) · [CHANGELOG](CHANGELOG.md)

- 事件监听模式参考 `dsh-my-notify`；ask 拦截/steer 参考 `dsh-task-reliability`；approval 决议契约来自 DSH `dsh-user-approval`（`'allowed-once'` 是唯一批准）。
- 安全围栏与 HTTP 工具来自 `dsh-shared`（`isTrustedApiRequest` / `readJsonBody` / `writeJson`）。
