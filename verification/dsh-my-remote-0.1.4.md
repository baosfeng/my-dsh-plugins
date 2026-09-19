# 发版前功能级验证清单 — dsh-my-remote@0.1.4

验证时间：2026-09-19T01:35:40.454Z
验证环境：隔离实例（端口 3098，复用生产 profile 配置组合，独立 DSH_HOME）

## 自动验证项（verify-real-profile.mjs 自动执行）

- [x] 配置组合唯一性（dump-config 无重复插件行 id）
- [x] 实例启动就绪（HTTP 200）
- [x] 启动日志无 error / duplicate 记录
- [x] 插件 API 冒烟（--api-path 全部 200）

## 功能级验证项（需在隔离实例 + 真实浏览器中验证后勾选）

- [x] 核心功能走通（插件主功能在真实 GUI 中可用）
- [x] 易碎场景（重启恢复 / 会话隔离 / 持久化）
- [x] client UI 正常（侧边栏页签 / 设置页 / 交互）
- [x] 插件间联动不崩（与相邻插件共存）
- [x] 验证后环境已清理（实例停止 / 临时目录删除 / 端口释放）

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。

## 验证记录

验证方式：同一隔离实例（独立 DSH_HOME + 端口 3099，复刻生产 profile 组合）+ 真实 Chrome。

- **client UI**：设置 → 插件 分区出现「远程控制」页签；面板 4 项齐全（API Token / 回答超时 / 批准超时 / 出站 Webhook 列表 + 添加）。
- **核心功能（保存链路）**：填入 token 并把「回答超时」设为 60000 → 保存 → profile 的 cordis.patch.yml 写入 `apiToken: verify-token-385` 与 `askTimeoutMs: 60000`。
- **token 掩码（关键安全项）**：`GET /remote/settings/api/settings` 返回 `{"apiTokenSet":true,"askTimeoutMs":60000,"approvalTimeoutMs":0,"webhooks":[]}` —— **响应体任何位置都不含 token 明文**；面板只显示「未配置 / 已配置」状态。
- **插件联动**：与 dsh-session-title-gen 同实例共存无冲突（171 个 id 无重复，日志无 error）。
- **环境清理**：实例停止、临时目录删除、端口释放、浏览器会话关闭。
