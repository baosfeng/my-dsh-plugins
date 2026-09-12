# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 变更

- fix(task-reliability): #198 任务注册表写路径同步 fs → 异步（`writeFileSync`/`renameSync` → `fs/promises` + 写串行链）：防抖落盘不再阻塞事件循环（10MB 状态实测调用耗时 16.96ms → 0.06ms）；teardown 保留同步尾写（`saveStoreSync`）保证卸载返回前落盘；读路径保持同步（启动一次，apply 同步契约）
- chore(task-reliability): client 端迁移到 TypeScript——632 行手写 `lib/client.js` 拆为 `src/client/parts/*.ts`（i18n / api / styles / rows / view / settings / apply），经 `tsc -p tsconfig.client.json` 编译后由 `scripts/build.mjs` 拼接进 `lib/client.src.js` 模板产出 `lib/client.js`（server 端此前已迁移）；新增 `src/client/globals.d.ts`（DSH 运行时最小契约）与 `test/client-api-contract.mjs`（轮询端点 / 模式开关 / 任务操作 / 问答 / 注册任务的 HTTP 契约防回归）。产物语义与迁移前手写版等价
- fix(task-reliability): 清理 `stryker.config.mjs` / `vitest.config.mjs` 中已不存在的模块引用（`lib/fence.js`、`lib/config-store.js`），并补上漏统计的 `lib/loop.js`、`lib/emit.js`——原清单会让 stryker `mutate` 直接报错、覆盖率静默漏项

## [0.4.7] - 2026-09-07

### 变更

- feat(observability): #155 插件状态查询聚合——统一 status-query 事件 + /plugin-status API (#170)
- chore(plugins): #165 清理失效的 dsh.client.inject 声明（13 插件） (#167)

## [0.4.6] - 2026-09-06

### 变更

- fix(task-reliability,observability): #165 Session.events 迁移——snapshotEvents 优先 + 旧 API 兜底 (#166)
- feat(observability,task-reliability): #154 插件关键行为纳入事件审计（干预/ask 决策/救场/verify/恢复）+ 文件体积控制 (#158)
- feat(observability): #155 插件日志体系补齐——7 插件关键行为/异常结构化日志（基础层） (#159)
- fix(task-reliability): #153 循环检测误报——pendingBreak 绑定命中回合跨回合失效 + 只读工具轮询豁免 (#156)
- feat(task-reliability): #147 输出未完成自动救场——普通对话回合截断自动补完 (#152)
- fix(task-reliability): #145 缓冲超时后迟到回答不静默丢弃——回答优先竞速 + 迟到回答记录待确认 + 「用户已回答」文案区分 (#149)

## [0.4.5] - 2026-09-04

### 变更

- feat(task-reliability): #77 多维度思考死循环检测 (#123)
- docs: #106 安装命令统一加 --trust-lockfile (#113)

## [0.4.4] - 2026-09-02

### 变更

- fix(scripts): #72 插件依赖未随安装自动安装（dsh-shared 未发布 npm） (#96)
- fix(dsh-task-reliability): #79 autopilot 延迟决策缓冲期，ask 先展示给用户 (#97)

## [0.4.3] - 2026-09-01

### 变更

- fix(ui): 9 个插件未定义 token danger-primary 改用 error-primary（DSH 主题仅定义 business/error/success/warn）

## [0.4.2] - 2026-08-31

### 变更

- fix(ui): dsh-task-reliability 开关开启色改用已定义 token（info-primary 未定义，PR #63）

## [0.4.1] - 2026-08-31

### 变更

- fix(ui): dsh-task-reliability 开关开/关视觉增强——关态灰轨+开态白点对比（issue #58）
- refactor(shared): 抽取 dsh-shared 共享工具包，10 个插件迁移消除重复实现（issue #45）
- chore(deps): 升级 react 19 兼容性——13 个插件 peer 声明 ^18.2.0 || ^19.2.0（issue #49）
- style(format): 全仓 prettier 格式化（issue #44）
- refactor(plugins): dsh-guardian/dsh-notify 改名 dsh-my-guardian/dsh-my-notify（npm 包名统一 dsh-my-* 系列，避免与 npm 同名包混淆）+ 新增 check-release.mjs 发布状态检查脚本
- fix(ci): 修复 7 个 eslint 质量门禁错误（CI lint 失败，issue #36 范围）

## [0.4.0] - 2026-08-29

### 新增

- **/task 斜杠命令（issue #35）**：参考官方 `/goal` 的 `ctx.commands.register` 模式注册 `/task` 命令（name 与 /goal 不冲突），任何时候可查看/继续任务：
  - 无参数 → 显示任务状态（活动任务列表、待确认问题数、模式状态）；
  - `continue` → 唤醒当前会话活动任务继续（复用 `wakeStalledTask` 恢复逻辑，与看门狗同一实现，无 `resumeAt` 幂等限制）；
  - `answer <id> <text>` → 回答待确认问题（复用 `answerQuestion`，与 HTTP API 同一函数）；
  - `autopilot on|off` → 切换自主决策模式（复用 `applyMode`，与 `/mode`、trigger mode 同一函数）；
  - `register <描述>` → 注册任务到当前会话（复用 `registerTask`，与 `/tasks`、trigger register 同一函数）。
- **commands 服务判空降级**：`ctx.get('commands')` 判空，宿主未提供 commands 服务时插件其余能力（HTTP API/事件监听）照常工作；注册包 `ctx.effect`（disposer 被 fiber 持有，卸载无残留）。
- **测试**：`test/host-command.mjs`（34 用例：命令注册/与 /goal 不冲突/解析/各子命令/复用断言/降级/持久化）、Gherkin `task-reliability-command.feature`（10 场景）。

## [0.3.0] - 2026-08-28

### 新增

- **ask 超时自动继续（issue #34）**：`tools/execute` 包装 `ask_user_question`，空闲计时器（`askTimeoutMs`，默认 30 分钟，0 = 禁用）超时后：记录待确认问题（复用自主决策机制，可事后回答）+ 注入「用户长时间未响应，请自行决策继续」followup + 返回模拟回答（有推荐选项则选中第一个，否则空回答由模型自行决策），任务不挂起；用户回答时真实结果透传。
- **任务停滞看门狗（issue #34）**：定期（`watchdogIntervalMs`，默认 5 分钟，0 = 禁用）扫描活动任务，最后活动时间超过 `stallTimeoutMs`（默认 10 分钟）判定停滞 → 复用恢复逻辑唤醒（live agent 直接 followup，否则 `agents.resume` + 「系统唤醒恢复」指令），锁屏/休眠/网络断开后自动继续，无需重启 DSH；唤醒失败不标记 failed，留给下次轮询。
- **配置项**：`askTimeoutMs` / `watchdogIntervalMs` / `stallTimeoutMs`（设置页可视化 + `GET/PUT /task-reliability/api/config` 同步支持）。
- **测试**：ask 超时（超时注入/推荐选项/真实回答透传/禁用/非 ask 透传/子代理/模拟回答过滤）、看门狗（唤醒/未停滞/禁用/不重复唤醒/失败保持/live 不 resume/阈值边界）、Gherkin 3 新场景、client-render 设置页新字段断言。

### 取舍说明

- **系统唤醒恢复用看门狗轮询替代电源事件监听**：Node 无内置电源事件 API，`system-sleep` 等 npm 包引入运行时依赖（违反无新增依赖约束）；看门狗轮询（默认 5 分钟间隔）在唤醒后最多一个周期内恢复任务。

## [0.2.0] - 2026-08-27

### 新增

- **配置可视化（issue #27）**：设置 → 插件 → 任务可靠性 页签（官方 slots 扩展点），11 项配置（超时重试/自动继续/持久化与速率/安全）可视化编辑，保存即生效、重启不丢。
- **配置 API**：`GET /task-reliability/api/config`（当前生效配置）、`PUT /task-reliability/api/config`（保存配置，写入 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，DSH watchUserPatches 热重载 + 内存 options 即时更新）。
- **配置持久化模块**：`lib/config-store.js`（profile patch 文件读写，YAML 子集解析/序列化，原子写 tmp+rename，不破坏其他条目）。
- **测试**：`test/config-store.mjs`（配置读写/持久化闭环）、`test/host-config.mjs`（配置 API 读写/立即生效/重启恢复/非法输入/fence）、Gherkin `task-reliability-config.feature`（5 场景）、client-render 设置页渲染断言。

## [0.1.3] - 2026-08-26

### 变更

- fix(task-reliability): 任务状态徽章文本永远显示「进行中」（盲测发现）
- fix(plugin): 修复 llm/stream 包装 handler 误用 async 导致 yield* 委托崩溃
- docs+test: 全面审查修复——文档同步补全 + mermaid 测试增强

## [0.1.2] - 2026-08-25

### 变更

- **npm 页面元数据优化**：description 改为中英双语（中文在前）；README 效果截图引用改为绝对 URL（unpkg），npm 包页面可直接显示图片。

## [0.1.1] - 2026-08-25

### 变更

- **合并入主仓库 main**（feat/task-reliability 分支，issue #17）。
- **Server 端按 P2 模式拆分**：`lib/index.js`（1001 行）拆分为 194 行入口 + 9 子模块（constants/util/fence/text/repeat/store/verify/events/api），`apply` 导出与行为不变；vitest 覆盖率与 Stryker 变异统计范围同步扩展至全部 server 文件（变异 70.16% ≥ 70%）。
- **新增 `test/text.mjs`**（16 用例，text.js 变异分 50.81% → 72.58%）。
- 一处无测试覆盖的意外错误路径修正：非 `/task-reliability/api/` 前缀 + POST 请求原抛 TypeError 返回 400，现统一返回 404（更合理）。

## [0.1.0] - 2026-08-24

### Added

- 任务可靠性保障首个版本：
  - 任务注册表（持久化 `$DSH_HOME/task-reliability.json`，原子写 + 防抖）
  - 模型超时/请求失败自动重试（`agent/request-error` 接管，退避 + 上限）
  - 任务未完成自动继续（`agent/turn-stopping` + steer，含防死循环护栏）
  - 完成度校验 agent（会话结束后独立 agent 判断完成度，未完成唤醒继续）
  - 思考重复检测与干预（`llm/stream` reasoning 相似度检测 + 打断指令 + 参数调整）
  - 休眠/重启后任务恢复（启动扫描 + `agents.resume` + 继续指令，幂等）
  - 自主决策模式（出行模式）：ask 拦截自动决策 + 待确认问题收集 + 自动批准
  - 远程触发接口（`POST /task-reliability/api/trigger`，loopback + token）
  - 侧边栏页签 UI（模式开关 / 任务列表 / 待确认问题）
