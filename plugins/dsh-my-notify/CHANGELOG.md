# Changelog

本文件记录 dsh-my-notify 的所有版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更

- chore(notify): client 端迁移到 TypeScript——手写 `lib/parts/*.js` 片段改由 `src/client/parts/*.ts` 经 `tsc -p tsconfig.client.json` 编译，再由 `scripts/build.mjs` 拼接进 `lib/client.src.js` 模板产出 `lib/client.js`（server 端此前已迁移）；新增 `src/client/globals.d.ts`（DSH 运行时最小契约）与 `test/client-contract.mjs`（构建/行为契约防回归）。产物语义不变

## [0.3.8] - 2026-09-04

### 变更

- fix(notify): #12 修复 CodeQL js/polynomial-redos 告警（webBaseUrl 尾斜杠处理） (#131)
- feat(notify): #109 webhook 推送内容增强（token/完整问题/模板） (#128)
- fix(notify): #11 修复 URL 主机名校验（CodeQL 告警） (#114)
- fix(notify): #112 子代理完成通知受全局开关控制 (#115)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.3.7] - 2026-09-02

### 变更

- fix(notify): #70 跨标签页去重改用 Web Locks（消除并发双弹）+ 修复 #92 客户端 TDZ 挂载失败

## [0.3.6] - 2026-09-02

### 变更

- feat(notify): #92 出站 webhook——企微/飞书/钉钉机器人事件推送 (#101)
- fix(notify): #70 客户端去重 + 多标签页协调，消除重复通知 (#94)
- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)

## [0.3.5] - 2026-09-01

### 变更

- feat(notify): #71 提示音音量可配置——默认增益 0.18→0.6，新增 dsh-notify:volume + 设置页音量滑杆

## [0.3.4] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.3.3] - 2026-08-31

### 变更

- Merge branch 'issue-57-think-visual-rollback'
- fix(ui): dsh-my-notify 开关开/关视觉增强——关态灰轨+开态白点对比（issue #58）

## [0.3.2] - 2026-08-28

### 变更

- feat(ui): dsh-my-notify toast 翻新——类型图标/操作按钮/动画（issue #54）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）

## [0.3.1] - 2026-08-27

### 变更

- **npm 包名改为 `dsh-my-notify`**：`bsfeng-dsh-notify` → `dsh-my-notify`，与 `dsh-my-*` 系列统一，目录名 = 包名 = tag 名，避免与 npm 上他人同名包（`dsh-notify`，Pasumao 的 Windows 通知插件）混淆。安装命令变为 `dsh plugin --profile web add dsh-my-notify`。localStorage 配置 key（`dsh-notify:notify` 等）、API 路径（`/notify/api/*`）、插件行 id（`notify`）保持旧前缀，兼容既有用户配置。
- **代码重构（eslint 门禁修复）**：`lib/parts/settings.js` 的 `NotifySettingsView` 拆分（65→40 行内，抽出 `renderSettingsForm` / `saveConfig` 子函数）+ `lib/client.js` 同步重建，行为不变。

## [0.3.0] - 2026-08-27

### 新增

- **子代理完成通知开关（issue #26）**：`subagentEnd` 配置项（默认 `false`）控制子代理完成是否推送；子代理判定白名单化（`origin === 'subagent'` / `delegationDepth > 0` / 运行时 `options.subagentDepth > 0` 任一命中即子代理，结构不完整保守视为子代理，修复 fork 继承/工作流 worker 等漏网形态误弹）；子代理通知带 `agentType: 'subagent'` 标记与「子代理」标题前缀；ask/approval 始终只推顶层。
- **配置可视化（issue #27）**：设置 → 插件 → 通知提醒 页签（官方 slots 扩展点），end/ask/approval/subagentEnd 开关 + apiToken/dedupeMs 输入，保存即生效、重启不丢。
- **配置 API**：`GET /notify/api/config`（当前生效配置）、`PUT /notify/api/config`（保存配置，写入 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，DSH watchUserPatches 热重载 + 内存即时更新 + 监听器按新开关重载）。
- **配置持久化模块**：`lib/config-store.js`（profile patch 文件读写，YAML 子集解析/序列化，原子写 tmp+rename，不破坏其他条目）。
- **测试**：`test/config-store.mjs`（配置读写/持久化闭环）、`test/host-config.mjs`（配置 API 读写/立即生效/重启恢复/非法输入/fence）、Gherkin `notify-config.feature`（5 场景）。

## [0.2.1] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.2.0] - 2026-08-25

### 变更

- **npm 包名改为 `bsfeng-dsh-notify`**：npm 上 `dsh-notify` 已被他人占用（Pasumao 的 Windows 通知插件），按用户确认改为 bsfeng 前缀。安装命令变为 `dsh plugin --profile web add link:<仓库路径>/plugins/dsh-notify`（link 安装 key 同步）或未来 npm 安装 `bsfeng-dsh-notify`。localStorage 配置 key（`dsh-notify:notify` 等）与 API 路径（`/notify/api/*`）保持旧前缀，兼容既有用户配置。
- **Server 端按 P2 模块拆分**：`lib/index.js`（349 行）拆分为 fence/session/notice/listeners/routes 子模块；**Client 端方案 B 拆分**（src 模板 + 3 片段 + build 拼接）。
- 行为不变（重构 + 改名）。

## [0.1.0] - 2026-08-23

### 新增

- **三类自动触发提醒**：会话结束（`agent/status` idle）、agent 询问问题（`ask_user_question`）、审批请求（`approval/request`），默认全开、可配置单独关闭；自动过滤子代理会话；同类 3 秒去重。
- **浏览器通知 + 提示音 + 页面 toast**：Notification API 系统通知（标题=会话标题，正文=类型+摘要），点击跳转对应会话；Web Audio 合成短促「滴」声；通知权限被拒时页面右上角 toast 兜底；通知/声音/toast 可经 localStorage 独立关闭。
- **实时通道**：`GET /notify/api/stream` SSE 长连接（EventSource 消费，25s 心跳，断线自动重连），多标签页同时订阅。
- **远程 hook 扩展接口**：`POST /notify/api/trigger` 支持任意本机进程/webhook 触发自定义通知（`kind: remote`，可带 `sessionId` 跳转）；loopback 信任围栏 + 可选 `apiToken`（`x-notify-token` 头）门禁。
- **查询接口**：`GET /notify/api/info` 返回当前触发开关。
- **冒烟测试**：`test/host-smoke.mjs` 覆盖三类触发（含 waterfall `next()` 透传）、子代理过滤、去重、SSE 清理、fence/token 门禁。

**真实环境验证**（独立端口 3081 隔离实例）：

- 真实 agent 完成一轮对话 → SSE 收到 `kind: end` 通知帧；
- 真实 agent 调用 `ask_user_question` → SSE 收到 `kind: ask` 通知帧（含真实会话标题「通知插件端到端验证」与问题摘要）；
- `POST /notify/api/trigger` → SSE 广播 `kind: remote` 帧；跨域/非标 host 请求被 403 拒绝。
