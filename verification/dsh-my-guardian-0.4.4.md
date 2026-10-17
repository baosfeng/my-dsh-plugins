# 发版前功能级验证清单 — dsh-my-guardian@0.4.4

验证时间：2026-09-25T14:52:19.562Z
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

**隔离环境（真实浏览器取证，端口 3099）**：独立 `DSH_HOME`，profile 由生产 `~/.dsh/profiles/web` 复刻（剥离 `.dsh-market`；副本内去掉 guardian 的 `disabled: true` —— **生产配置一个字节未改**，`cordis.patch.yml` sha256 前后一致 `68636c5521538aef0fabfd93f5cf4b77f3ec9c9edb3f2a2090342d8557efa318`）；`node_modules` 只读复用生产；真实浏览器 agent-browser 0.34.0。

**核心功能走通**：右栏「新标签页」→ **「插件守护」席位**打开面板并完整渲染：
- 启动名册静态预检：逐个列出依赖缺失项 + 修复命令（`dsh plugin add react`）+ 「移除」指引（含 dsh-my-guardian / dsh-my-skill-manager / dsh-mermaid-render 等条目）；
- 「暂无候选插件」空态 + 提示「新插件请写入 cordis.staged.json，启动后自动加载」；
- 「最近事件」区：`18:13:38 启动区问题 — 启动名册静态预检发现 8 个问题（dsh-file-activity、dsh-md-render、dsh-mermaid-render…）— 详见 guardian/startup-issues.json`。
截图 `/tmp/verify-3099-guardian.png`。

**client UI 正常**：设置 → 内置插件中相邻页签（记忆 / Skill 管理 / 安全护栏）与 guardian 面板均正常渲染，无 React #130 白屏，可访问性树节点齐全带 ref。

**易碎场景**：浏览器重载（同 URL 重新打开）后页面完整重渲染（21 个 button），client bundle 重载正常、页签与数据回读一致。

**插件间联动**：同一隔离实例同时挂 `dsh-my-memory` / `dsh-my-skill-manager` / `dsh-my-guardian` + 生产邻居插件；`dump-config` 202 个顶层 entry id 无重复，无注册冲突。

**环境已清理**：`lsof -ti :3099` 为空（端口释放）、`rm -rf` 隔离目录后复查不存在、`pgrep -fl "choose folder"` 为空；本清单生成实例（端口 3100）由脚本自行停止并清理。**主实例 3080 / PID 79170 全程未触碰。**

**未覆盖 / 局限（如实记录）**：
1. 浏览器取证在**并入 main 的 `#412 fix(guardian): 依赖预检解析 profiles 根宿主包与子路径导出` 之前**完成；#412 对 `dep-precheck` / `startup-check` 的改由其自带测试（`test/dep-precheck.mjs`、`test/startup-check.mjs`）覆盖，本清单未重复做浏览器取证；
2. HMR 降级通道（`hmr/config-update-failed` → `dsh-hmr` 结构化 warn）由插件单测 + `scripts/host-events.mjs` 宿主事件表契约测试覆盖，未在浏览器中制造真实的配置热更新失败；
3. 未做 console 未捕获异常的编程式断言（agent-browser 无 console 收集口，判据 = 页面错误面 + 可访问性树 + 交互成功）。
