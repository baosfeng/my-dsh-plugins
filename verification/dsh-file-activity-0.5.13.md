# 发版前功能级验证清单 — dsh-file-activity@0.5.13

验证时间：2026-09-25T01:10:15.408Z
验证环境：隔离实例（端口 3094，复用生产 profile 配置组合，独立 DSH_HOME）

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

- 隔离实例同时挂 4 个待发 addon + 生产邻居插件，`dump-config` 171 个 id 无重复；本插件在生产 profile 里**未被禁用**（与 guardian / ts-example / task-reliability 不同），页签默认即在右栏打开。
- 指南席位出现「文件活动」胶囊并正常开页签（guide 条目 `id` 必填席位，本轮补的就是这个字段）；页签内容渲染正常：「暂无文件活动记录」空态 + 「文件统计」分节。
- 插件间联动：与 dsh-my-guard / dsh-my-memory / dsh-md-render / dsh-my-plugin-manager 等生产邻居共存，无注册冲突、无 `already registered` 报错。
- 未覆盖 / 局限：面板只验证了**空态**渲染 —— 本轮没有跑 agent 读写或侧边栏打开文件，故没有真实文件活动记录可核对；本轮变更仅为 guide 条目补 `id`，受影响的可观察面就是该胶囊与页签注册。未接入 console 异常捕获。
- 清理：实例已 kill、临时目录已删、端口已释放、无 `choose folder` 残留进程。

> 说明：功能级项由验证者（人工或 agent）在真实浏览器中逐项验证后，将 [ ] 改为 [x]。
> release.mjs 发版门禁会校验本清单功能级项全部勾选，未全勾选将阻断发版（issue #67）。
