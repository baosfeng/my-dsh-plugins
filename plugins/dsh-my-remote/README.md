# dsh-my-remote — 远程控制插件

> 离开电脑后依然可以掌控 DSH：ask / approval / 会话结束事件实时下发到外部通道（手机 / IM），在手机上回答 ask、批准 approval、查询会话状态、继续任务。

![npm 版本](https://img.shields.io/badge/dsh--my--remote-v0.1.0-blue) ![DSH 插件](https://img.shields.io/badge/DSH%20Plugin-server--only-lightgrey) ![License](https://img.shields.io/badge/License-MIT-green)

## 效果图

真实运行画面（隔离 DSH 实例）：模型调用 `ask_user_question` 提问时，插件拦截并渲染「等待回答」卡片，同时事件帧下行到外部通道（webhook / 手机中转）。

![远程回答 ask：GUI 等待回答卡片](./assets/ask-push.png)

## 功能

| 能力              | 说明                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 事件下发          | `ask`（提问等待回答）、`approval`（等待批准）、`end`（会话结束）实时下行到外部通道（HTTP webhook / 中转服务 / IM 机器人网关），帧含会话标题、问题文本与可选选项、审批原因与工具名 |
| 远程回答 ask      | 外部服务端/手机调用入站 API 提交回答（按问题 id 选项选择或自由文本），agent 立即收到注入的 answers 并继续执行                                                                     |
| 远程批准 approval | 外部提交批准（`allowed-once`）或拒绝（`rejected`），approval 等待方立即决议，工具放行或拦截                                                                                       |
| 状态查询          | `GET /remote/api/status` 返回活动会话、待回答 ask、待批准 approval 快照                                                                                                           |
| 继续会话          | `continue` 指令经 `agent.steer` 注入用户消息，唤醒/继续对应会话                                                                                                                   |
| 安全              | loopback 信任围栏 + `apiToken` 鉴权（写指令 `x-remote-token` 头）+ 指令白名单 + 操作审计（远程控制比通知更敏感，所有指令与拒绝留痕）                                              |
| 通道可扩展        | 适配器契约（事件帧 + 指令格式渠道无关），HTTP 通道先行，微信/QQ/飞书机器人按同一接口扩展（见 [docs/远程控制/概述.md](../../docs/远程控制/概述.md)）                               |

## 架构

```
┌──────────────┐   事件下行(出站 webhook)    ┌──────────────┐
│ DSH 插件      │ ──────────────────────────→ │ 外部通道      │ ←→ 手机 / 微信 / QQ / 飞书
│ dsh-my-remote │ ←────────────────────────── │ (中转服务/机器人) │
└──────────────┘   指令上行(入站 API + token)  └──────────────┘
```

分层：

- **事件层**：监听 `agent/status`（idle→end）、`tools/execute`（ask_user_question）、`approval/request`；ask/approval 用 `Promise.race([next(), 远程决议])` 拦截，远程回答/批准短路注入 DSH 流程，本机操作透传 `next()`（不改变原有体验）。
- **指令层**：入站指令白名单（answer / approve / continue）+ 状态快照 + 操作审计。
- **渠道层**：适配器契约 `{ sendEvent(event) }`，HTTP 适配器（通用中转 webhook）先行。
- **安全层**：loopback 围栏（dsh-shared `isTrustedApiRequest`）+ apiToken + 白名单 + 审计。

所有可选服务（`agents` / `sessionTitle` / `webRuntime`）经 `ctx.get` 读取，缺省安全降级。

## 安装

方式一：npm 注册表（发布后）

```bash
dsh plugin --profile web add dsh-my-remote
```

方式二：仓库链接安装

```bash
git clone https://github.com/baosfeng/my-dsh-plugins.git
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-remote
```

## 配置

可在 `cordis.patch.yml` / profile patch 中的应用层 config 设置（`config:` 字段），全部可选：

```yaml
- insert:
    - id: remote
      name: 'dsh-my-remote'
      config:
        apiToken: 'your-token' # 写指令鉴权；留空则仅靠 loopback 围栏
        askTimeoutMs: 0 # 远程回答等待超时（0=无限；>0 超时返回空 answers 由模型自行决策）
        approvalTimeoutMs: 0 # 远程批准等待超时（0=无限；>0 超时 fail-closed 拒绝）
        webhooks:
          - name: '我的中转服务'
            url: 'https://relay.example.com/hook'
            events: ['ask', 'approval', 'end'] # 缺省 = 全部
            enabled: true
            headers:
              authorization: 'Bearer x' # 可选附加请求头
```

## 使用（外部通道侧）

外部中转服务/IM 机器人收到下行事件帧（JSON，POST），可调用以下 API 应答：

| 端点                       | 说明                                         |
| -------------------------- | -------------------------------------------- |
| `GET /remote/api/info`     | 插件开关信息                                 |
| `GET /remote/api/status`   | 活动会话 / 待回答 ask / 待批准 approval 快照 |
| `GET /remote/api/audit`    | 操作审计日志（指令留痕）                     |
| `POST /remote/api/command` | 远程指令统一入口（`x-remote-token` 头鉴权）  |

`command` 动作：

```jsonc
// 回答 ask：
{ "action": "answer", "sessionId": "<id>", "answers": [{ "id": "q1", "selected": ["继续"] }] }
// 自由文本回答：
{ "action": "answer", "sessionId": "<id>", "answers": [{ "id": "q1", "selected": [], "custom": "我的回答" }] }
// 批准 approval：
{ "action": "approve", "sessionId": "<id>", "outcome": "allowed-once" }   // 或 "rejected"
// 继续/唤醒会话：
{ "action": "continue", "sessionId": "<id>", "message": "继续执行下一步" }
```

> 远程调用（非本机）需把 DSH 的 `trustedHosts` 配置为你的中转服务域名（webRuntime 配置），并用 `apiToken` 鉴权。详见 [docs/远程控制/概述.md](../../docs/远程控制/概述.md)。

## 通道扩展（微信/QQ/飞书机器人）

本插件定义**渠道无关**的事件帧与指令格式，新增 IM 渠道只需实现适配器契约（把事件帧转为 IM 消息卡片、把 IM 回调转为指令），无需改动事件层/指令层/安全层。契约与示例见 [docs/远程控制/概述.md](../../docs/远程控制/概述.md)。

## 开发

```bash
cd plugins/dsh-my-remote
npm test          # vitest 单元测试 + 覆盖率门禁 + cucumber Gherkin 验收
```

需求清单：[docs/远程控制/需求清单.md](../../docs/远程控制/需求清单.md)

## 相关

- 事件监听模式参考 `dsh-my-notify`（SSE/trigger/fence/token）
- ask 拦截/steer 参考 `dsh-task-reliability`；approval 决议契约来自 DSH `dsh-user-approval`（`'allowed-once'` 是唯一批准）
- 安全围栏/HTTP 工具来自 `dsh-shared`（`isTrustedApiRequest` / `readJsonBody` / `writeJson` 等）
