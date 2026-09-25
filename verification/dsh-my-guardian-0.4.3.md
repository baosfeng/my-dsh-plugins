# 发版前功能级验证清单 — dsh-my-guardian@0.4.3

验证时间：2026-09-25T01:07:57.978Z
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

## 验证记录

验证者：agent（发版子会话）。宿主：本机已装 dsh 0.1.5-rc.1（与 release.mjs 3c 同宿主）；隔离 DSH_HOME + 端口 3099 + 预置工作区 `/tmp/dsh-verify-ws`；真实浏览器（agent-browser 0.34.0）。

- **前置事实（影响判定，已按隔离副本修正）**：生产 profile `~/.dsh/profiles/web/cordis.patch.yml` 里 `guardian` 行是 `disabled: true`，复刻后该插件**加载但禁用**、client bundle 不进 `window.__DSH_BOOT__.entries`、指南席位无「插件守护」胶囊。功能级验证在**隔离副本内**去掉该行 disabled 后重启实例（生产 profile 未改动；副本随实例删除）。
- 隔离实例同时挂 4 个待发 addon（guardian / ts-example / task-reliability / file-activity）+ 生产邻居插件，`dump-config` 171 个 id 无重复；指南席位（右栏「新标签页」菜单）出现「插件守护」胶囊，点击后正常打开页签 —— 这是本轮 guide 条目补 `id`（宿主 `SidebarRightGuideEntry` 必填）所修复的席位。
- 核心交互证据：面板「规则测试」输入 `rm -rf /` → 点「测试」→ 输出「命中规则：高 · 观察（只告警） · 删除根目录/家目录（rm -rf / 等） · 内置 rm-root」；「插件守护」面板渲染启动名册预检行（依赖缺失项 + 修复命令 + 移除）+ 候选区空态。
- 页面无错误 UI；实例日志无 error / duplicate 行。
- 未覆盖 / 局限：未接入 console 异常捕获（判据为页面错误面 + 快照渲染 + 交互成功）；HMR 事件降级通道（`hmr/config-update-failed` → logger-warn）由插件单测 + `scripts/host-events.mjs` 宿主事件表契约测试覆盖，未在本轮浏览器里制造真实的配置热更新失败。
- 清理：实例已 kill、临时目录已删、端口已释放、无 `choose folder` 残留进程。

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
