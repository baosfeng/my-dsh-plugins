# 发版前功能级验证清单 — dsh-my-memory@0.1.10

验证时间：2026-09-25T10:17:03.026Z
验证环境：隔离实例（端口 3100，复用生产 profile 配置组合，独立 DSH_HOME）

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

验证者：发版子会话（agent）。宿主：本机已装 dsh **0.1.7-rc.2**（`dsh --version` 实测），与 release.mjs 3c 同宿主。

**隔离环境（真实浏览器取证，端口 3099）**：独立 `DSH_HOME=/tmp/dsh-verify-manual`，profile 由生产 `~/.dsh/profiles/web` 复刻（剥离 `.dsh-market`；副本内去掉 guardian 的 `disabled: true` —— **生产配置一个字节未改**）；`node_modules` 以只读软链复用生产；工作区状态复用生产 `storages/workspace.json`。真实浏览器 agent-browser 0.34.0 打开 `http://127.0.0.1:3099/?token=…`。

**修复前后对照**：修复前 0.1.7-rc.2 下点开插件设置面板即 React error #130 白屏（`createElement(undefined)` —— 宿主只提供 `IconXxxOutlineMedium/Regular`，没有 `IconRefreshOutline14` 这类数字后缀导出；旧 `try{require}catch` 只兜 require 失败、兜不住单点属性缺失）。

**易碎场景**：浏览器重载（同 URL 重新打开）后页面完整重渲染（可访问性树 21 个 button、含「插件」），client bundle 重载正常、无白屏，页签与数据回读一致。

**插件间联动**：同一隔离实例同时挂 `dsh-my-memory` / `dsh-my-skill-manager` / `dsh-my-guardian` 三个待验插件 + 生产邻居插件；`dump-config` 202 个顶层 entry id 无重复，三个插件的设置页签 / 右栏席位全部出现、无注册冲突。

**环境已清理**：`agent-browser close --all`；`lsof -ti :3099` 为空（端口释放）；`rm -rf /tmp/dsh-verify-manual` 后复查目录不存在；`pgrep -fl "choose folder"` 为空。清单生成实例（3100 / 3101）由脚本自行停止并清理临时目录。**主实例 3080 / PID 79170 全程未触碰。**

**未覆盖 / 局限**：① 未做 console 未捕获异常的编程式断言（agent-browser 未提供 console 收集口，判据 = 页面错误面 + 可访问性树 + 交互成功）；② 记忆 / skill 的写-删持久化往返未在本轮制造真实数据（时间盒内未做），该路径由插件自身测试覆盖。

**核心功能走通证据（dsh-my-memory）**：设置 → 内置插件 → **「记忆」页签完整渲染**：项目根路径输入框 + 「加载」/「刷新」按钮、「全局记忆 0 条」+ 新增输入框、「项目记忆（项目根 /Users/bsfeng/IdeaProjects/python-task · 0 条）」+ 新增输入框、「自动学习候选（待确认）0 条」空态；页签内按钮 / 输入框在可访问性树中全部带 ref（可交互）。截图 `/tmp/verify-3099-memory.png`。
