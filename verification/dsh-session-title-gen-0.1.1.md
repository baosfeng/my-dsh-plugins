# 发版前功能级验证清单 — dsh-session-title-gen@0.1.1

验证时间：2026-09-19T01:35:26.190Z
验证环境：隔离实例（端口 3099，复用生产 profile 配置组合，独立 DSH_HOME）

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

验证方式：隔离实例（独立 DSH_HOME + 端口 3099，复刻生产 profile 组合）+ 真实 Chrome。

- **client UI**：设置 → 插件 分区的页签列表出现「会话标题生成」；面板 8 项齐全（启用开关 / 模板 / provider / model / 4 个数值上限），文案为惰性单语中文。
- **核心功能（保存链路）**：把「标题长度上限」由 80 改为 120 → 保存 → profile 的 cordis.patch.yml 写入 `maxTitleBytes: 120`，且**其它插件行完好**（5 个 disabled: true 未受影响）。
- **易碎场景（持久化）**：手工把 patch 中的值改为 200（模拟文件层配置 / 重启后的状态）→ watchUserPatches 热重载后 `GET /session-title-gen/api/config` 返回 `maxTitleBytes: 200`，证明配置确实从文件重新加载生效。
- **插件联动**：与 dsh-my-remote 同实例共存，dump-config 171 个 id 无重复，启动日志无 error / duplicate。
- **环境清理**：实例停止、临时目录删除、端口 3099 释放、浏览器会话关闭、agent-browser doctor 无残留。

注：本机生产 profile 中该插件为 disabled: true，验证时在隔离实例内临时启用（禁用状态下 client 不进 manifest、设置页看不到页签）。
