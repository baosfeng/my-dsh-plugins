---
name: plugin-test
description: 使用当 需要为 DSH 插件编写或审查测试，或验证 DSH 版本迁移后的插件时。从单测、覆盖率、真实 API e2e、快照、Web 测试、真实组合、构建产物冒烟中选择最小充分层级；版本迁移用内置七触点测试流程并验证精确目标版本运行时。
---

# 测试 DSH 插件（plugin-test）

选择能证明变更正确的最小测试层级集。默认不跑全量套件，不重复已通过的检查。

## 测试 DSH 版本迁移

把现有插件适配到新 DSH 宿主版本时：

1. 读 [references/version-migration-testing.md](references/version-migration-testing.md)，为精确 from/to 版本建迁移账本，扫描全部七类触点。
2. 为每个适用的 `breaking`/`behavior` 变更加针对性回归测试（变更级测试只证明该映射，不证明整个插件有效）。
3. 用真实产品入口冷启动精确目标版本并完成一个完整用户回合。类型检查、配置解析、Loader 冒烟、mock Context **不能替代**这个运行时证明。
4. 诚实报告不可用的凭据/provider/OS/浏览器/PTY/破坏性迁移边界；有未验证项不得声称全面兼容。

## Docker 发布冒烟

发版前对外部插件打包产物做干净环境冷启动验证：读 [references/docker-release-smoke.md](references/docker-release-smoke.md)，用自带 runner 跑打包 artifact——**pin 一个精确 DSH 版本 + 非 latest Node 镜像**，把 artifact 装入隔离 Profile，冷启动真实 DSH 入口；启动本身不足以覆盖变更行为时加一个 argv 功能探针。

生成的 JSON/Markdown 只作为该 artifact 与目标版本的窄证据。未验证的 provider/浏览器/OS/安全检查/其他版本如实报告为 unverified；冒烟通过不扩大其覆盖范围。生成报告、原始日志、临时 Profile、Docker 缓存都放在 skill 目录之外。

## 测试层级

| 层级 | 证明什么 |
|---|---|
| 单元测试 | 边界情况、错误路径、事件顺序、并发竞争、契约回归；每个注册都需要 HMR 安全测试（dispose 贡献注册的 fiber 并断言资源被移除） |
| 覆盖率门禁 | 只证明行被执行，不证明发布功能真的可用；外部插件按仓库声明的阈值 |
| 真实 API e2e | 有 provider 凭据且授权时跑（含 DeepSeek 模型与 provider 冒烟）；凭据缺失时套件自跳过保持 CI 绿；免凭据测试只证明管线连通，只有带凭据的运行证明 agent 能配合真实模型工作 |
| 快照测试 | 免凭据输出，钉住传输契约与呈现；模型/协议/用户可见行为变更必须加或更新免凭据快照 |
| Web 浏览器快照 | Chromium 回放输出对比；CI 强制只读回放，绝不写期望输出；本地录制并审阅每个差异 |

## 按变更面选层级

- 纯逻辑/内部助手 → 只跑单测。
- 新增/修改包源码 → 跑仓库覆盖率门禁。
- 模型可见行为（prompt/工具 schema/工具输出/skill 目录）→ 加免凭据快照 + 真实组合测试。
- 协议可见行为（ACP/JSON-RPC/线传输）→ 加免凭据快照。
- 用户可见行为（CLI 转录/交互终端/GUI 流）→ 用产品入口测试套件。
- provider 行为（新 adapter/真实 provider 功能）→ 凭据可用且授权时跑真实 API e2e。
- 用户会实际运行的插件 → 执行非单测的真实组合测试；绝不只测手工拼装的 `ctx.plugin(...)`。

## 测试真实入口路径

- 用户可见插件需要真实组合测试：经 Loader 与应用/进程入口启动测试用 `cordis.yml`；只 mock 外部服务或非确定性输入；断言模型可见请求/日志、持久化状态或用户可见输出；不把测试选项加进发布默认值。
- "真实入口路径"指**发布产物**：`bin` 必须在原生 Node 下跑构建产物（暴露 tsx 隐藏的关闭竞态/模块解析/吞掉的加载失败）；外部插件冒烟其打包入口；断言缺必需配置时进程非零退出。
- 外部插件按自己的 resolver，但至少加一个显式打包产物消费者，让源码别名藏不住缺失导出或第二个运行时单例。

## 保持测试有效

- 优先真实实现而非 mock：只 mock 昂贵或非确定性边界（LLM 适配器/网络/时钟），下游保持真实。手写 fake 只证明桥搬了字节，不证明发布工具交付了声称的行为；桥接工具调用用脚本化 mock 模型，工具与执行器保持真实。
- 验证外部世界而非信任 agent 报告：e2e 断言应重跑命令或重读文件；只查 agent 输出关键词会让作弊 agent 通过；断言未触碰文件逐字节一致。
- e2e 测试拥有自己的资源：测试内创建 Harness，`afterEach` 释放（含失败/重试/超时后）。
- 恢复测试必须区分每个 chunk 边界前后的失败，证明失败 chunk 不产生消息或工具副作用。

## 命令

外部插件用自己的脚本：打包 artifact → 装入运行精确目标版本的隔离 Profile → 冷启动 + 核心路径冒烟。跑覆盖变更面的最小集，只跑一次。CI 只证明它实际定义的 gate。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/docker-release-smoke.md](references/docker-release-smoke.md) | Docker 发布冒烟配方（pin 版本/隔离 Profile/冷启动/argv 探针） |
| [references/version-migration-testing.md](references/version-migration-testing.md) | 版本迁移测试（七触点 + 回归 + 冷启动证明） |
| [scripts/docker-release-smoke.mjs](scripts/docker-release-smoke.mjs) | Docker 冒烟 runner |
| [scripts/container-runner.mjs](scripts/container-runner.mjs) | 容器运行器（docker 冒烟依赖） |
