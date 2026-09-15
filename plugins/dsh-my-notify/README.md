# dsh-my-notify

[![插件生态](https://img.shields.io/badge/插件生态-topic%20dsh-4d6bfe)](https://github.com/topics/dsh)

<div align="center">
  <img alt="远程触发通知：页面右下角 toast 卡片（通知权限未授予时的兜底呈现）" src="https://unpkg.com/dsh-my-notify/assets/notify-toast.png" width="640" />
</div>

**DSH 通知提醒插件**：在**会话结束**、**agent 询问问题**、**等待你批准**时发出**浏览器系统通知 + 提示音**，点击通知直接跳转到对应会话；另提供**远程 hook 触发接口**与**出站 webhook**（推送企微 / 飞书 / 钉钉机器人），离开电脑也能收到。

## 功能

- **三类自动触发**（默认全开、可单独关闭）：`end` 本轮对话完成或被中断、`ask` agent 调用 `ask_user_question`、`approval` 出现待批准请求；同类事件同一会话 3 秒内去重。
- **默认过滤子代理会话**：只提醒你直接查看的顶层会话；`subagentEnd: true` 后子代理完成也提醒，标题带「子代理」前缀。
- **通知呈现**：系统通知（标题 = 会话标题，正文 = 类型 + 摘要）、提示音（Web Audio 合成，无需音频文件，首次与页面交互后解锁）、点击通知聚焦窗口并打开对应会话；通知权限被拒时用页面内 toast 兜底。
- **出站 Webhook**：事件推送到企业微信 / 飞书 / 钉钉群机器人或自建通用中转（消息格式与加签自动适配），支持多 webhook、按事件订阅、自定义模板；推送失败重试 3 次（指数退避），失败记录在设置页可见。
- **可视化设置**：设置 → 插件 → 通知提醒 页签编辑触发开关、webhook 列表、Token、去重窗口，保存即生效、重启不丢。

## 配置

`cordis.patch.yml` 对应插件行的 `config` 字段，均为可选：

| 配置键        | 默认    | 作用                                                         |
| ------------- | ------- | ------------------------------------------------------------ |
| `end`         | `true`  | 会话结束提醒                                                 |
| `ask`         | `true`  | 询问提醒（`askMode: 'full'` 完整问题 / `'summary'` 摘要）    |
| `approval`    | `true`  | 审批提醒（工具名 + 原因）                                    |
| `subagentEnd` | `false` | 子代理完成也提醒                                             |
| `apiToken`    | `''`    | 远程触发 token；非空时 trigger 需带 `x-notify-token` 头      |
| `dedupeMs`    | `3000`  | 同类事件去重窗口（毫秒）                                     |
| `webBaseUrl`  | `''`    | DSH Web 地址；配置后 `end` 推送携带会话链接 `/sessions/<id>` |

**远程触发**：`POST /notify/api/trigger`（loopback 信任围栏 + 可选 token），body `{title, body, sessionId?}`——任何本机进程、cron、CI、其他插件都能推送通知，`sessionId` 填写后点击通知可跳到该会话。

**页面内开关**（localStorage，默认全开）：`dsh-notify:notify` / `dsh-notify:sound` / `dsh-notify:toast` 置 `0` 分别关闭系统通知 / 提示音 / toast。

## 安装

> 💡 **npm 安装（普通用户推荐）**：`dsh plugin --profile web add dsh-my-notify --trust-lockfile`——无需克隆本仓库；以下 link 方式供本仓库开发者使用。依赖 `dsh-shared` 随 npm 自动安装。

```bash
# 1) 克隆本仓库（任意目录）
git clone https://github.com/baosfeng/my-dsh-plugins.git
# 2) 以本地 link 方式安装（将 <仓库路径> 替换为上面的克隆目录）
dsh plugin --profile web add link:<仓库路径>/plugins/dsh-my-notify
```

- server 端改动需重启 `dsh web`；client 端改动浏览器硬刷新即可。

## 限制与说明

- **通知权限**：浏览器首次收到通知时发起权限请求；拒绝后自动用页面内 toast 兜底。
- **自动播放策略**：提示音需用户与页面有过至少一次交互（点击 / 按键）后才能发声，属浏览器安全限制。
- **SSE 会话**：多标签页同时打开时全部收到通知；EventSource 断线 3s 自动重连。

## 相关文档

→ [通知提醒模块文档](../../docs/通知提醒/概述.md) · [CHANGELOG](CHANGELOG.md)
