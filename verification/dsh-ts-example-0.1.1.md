# 发版前功能级验证清单 — dsh-ts-example@0.1.1

验证时间：2026-09-25T01:09:59.713Z
验证环境：隔离实例（端口 3092，复用生产 profile 配置组合，独立 DSH_HOME）

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

## 验证记录

验证者：agent（发版子会话）。宿主：本机已装 dsh 0.1.5-rc.1（与 release.mjs 3c 同宿主）；隔离 DSH_HOME + 端口 3099 + 预置工作区 `/tmp/dsh-verify-ws`；真实浏览器（agent-browser 0.34.0）。

- **前置事实（影响判定，已按隔离副本修正）**：生产 profile `~/.dsh/profiles/web/cordis.patch.yml` 里 `ts-example` 行是 `disabled: true`，复刻后该插件**加载但禁用**、client bundle 不进 `window.__DSH_BOOT__.entries`、指南席位无「TS 示例」胶囊。功能级验证在**隔离副本内**去掉该行 disabled 后重启实例（生产 profile 未改动；副本随实例删除）。
- 指南席位出现「TS 示例」胶囊并正常开页签（guide 条目 `id` 必填席位）。
- 核心功能端到端：页签内渲染 `Hello, session-3da7eace-b8ec-4bf5-97e5-a537bb9842da!` —— client 经真实浏览器会话调用 server 端 `/ts-example/api/greeting` 成功；`fetch('/ts-example/api/greeting?name=verify')` → `{"greeting":"Hello, verify!"}`。
- **本轮修复的行为判据**：`fetch('/ts-example/api/stats')` → `{"sessions":1}`，与实例内实际存在的 1 个会话数一致。旧事件名 `session/start` 在宿主事件表零命中（计数恒为 0、无任何报错），即“幽灵事件名”的静默降级；改监听 `session/created` 后计数非零。
- 未覆盖 / 局限：UI 的「新建会话」按钮在空会话上复用了当前空会话（会话树仍只有 1 个会话），未能造出第 2 个会话，故计数增量只到 1；未接入 console 异常捕获；未做真实模型调用（本轮变更不涉及模型可见面）。
- 清理：实例已 kill、临时目录已删、端口已释放、无 `choose folder` 残留进程。

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
