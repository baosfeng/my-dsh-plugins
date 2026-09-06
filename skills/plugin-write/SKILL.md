---
name: plugin-write
description: 使用当 需要新建 DSH 插件、为外部 DSH 插件选择公开命名、校验 dsh-plugin.naming.json 清单、查询中央注册表已知冲突，或把现有插件适配到新 DSH 宿主版本时。覆盖从仓库模式/插件形态选择、离线命名校验、在线注册表查询到包校验的完整流程。
---

# 编写 DSH 插件（plugin-write）

创建插件包。先分类仓库模式与插件形态，再读对应参考文件，最后用覆盖变更的最小门禁集校验发布入口。

## 先选仓库模式

| 目标 | 适用规则 |
|---|---|
| 官方 `deepseek-harness` monorepo 内的包 | 用仓库内 package/tsconfig/文档与根门禁规则 |
| 外部可安装的 DSH 插件 | 保留该仓库的包布局与脚本；只用精确目标 DSH 版本已发布的包与导出；不复制 `private`、workspace 版本、根 tsconfig 注册或 monorepo 专属 README 门禁 |
| 现有插件适配新 DSH 宿主 | 读 [references/version-adaptation.md](references/version-adaptation.md)，建完整版本走廊并跑七类触点 preflight；`breaking` 变更且用户未授权实施时，先展示迁移计划等确认 |

Cordis/Schemastery/DSH 包名与版本范围从精确目标版本的 manifest 推导（当前示例用 `@deepseek-ai/*` 标识符；旧目标按各自发布契约）。

**每个新外部插件**：读 [references/naming-conventions.md](references/naming-conventions.md) 再选公开标识符；在插件仓库根创建 `dsh-plugin.naming.json`，跑只读校验器（见下）。兼容性错误 = 目标契约失败；前缀警告 = 社区建议；`--strict` 仅当插件采用防撞名 profile。这不是官方 manifest 也不是全局预留。现有外部插件：报告命名偏差但保留已发布名（用户明确授权兼容性破坏改名除外）。

离线声明通过后，读 [references/registry-check.md](references/registry-check.md)，网络可用时跑独立中央查询（带精确目标 DSH 版本）。无匹配只算"无已审匹配"；超时/畸形数据/不支持契约/网络失败算"未检查"。在线查询绝不修改本地 manifest、不自动改名、不把自动发现候选当预留——正式预留只存在于中央注册表审阅合并后。

## 再分类插件形态

| 能力需求 | 形态 | 参考 |
|---|---|---|
| 模型可调用的工具（读文件/跑命令/搜网页） | 工具插件 | `references/tool-plugin.md`（已裁剪，见 dsh-plugin-development 工具型速览） |
| 新模型 provider | LLM 适配器插件 | `references/llm-adapter-plugin.md`（已裁剪） |
| 请求/工具/回合拦截（权限/策略/指标/遥测） | Hook 插件 | `references/hook-plugin.md`（已裁剪） |
| 被其他插件经 `ctx` 消费的能力 | Service 插件 | `references/service-plugin.md`（已裁剪） |
| 经 `cordis.yml` 提供的用户可配置行为 | Config 插件 | `references/config-plugin.md`（已裁剪） |

> 本仓库裁剪了 5 个形态参考文件（形态覆盖见 `dsh-plugin-development` skill 的「插件形态」表）；形态可自由组合，每个包含的形态仍须满足自身契约。需求不匹配五形态时，映射到既有扩展点注册，**绝不直接改 agent loop**。

| 目标 | 机制 |
|---|---|
| 加模型可调用能力 | 注册到 `ctx.tools` |
| 加模型 provider | 注册 adapter 到 `ctx.llm` |
| 单会话不同能力集 | 组装进 Agent preset |
| 加 Shell 执行 | 实现并注册 `ctx.bash` 后端 |
| 加持久终端执行 | 注册 `ctx.pty` 后端并加载 `dsh-tool-pty` |
| 加人类命令 | 注册到 `ctx.commands` |
| 加后台任务 | 注册到 `ctx.tasks` |
| 加文件系统访问/策略 | 实现 `ctx.fs` provider 或监听 `fs/*` 策略事件 |
| 约束启动的进程 | 用 `ctx.sandbox` 后端 |
| 拦截请求/工具/回合 | 用 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 是回合停止事件 |
| 加模型可见上下文 | 调 `agent.inject()` |
| 加 UI/编辑器集成 | 驱动 `ctx.agents` 并从 `session/event` 渲染 |
| 加 Web 客户端会话节点 | 注册 `ConversationNodeDefinition` 与 keyed renderers |
| 加持久会话状态 | 扩展 `SessionEventMap`，从日志渲染与回放 |
| 分叉活动会话 | 调 `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 注册限定到某 Agent | 用该 Agent 的 `agent.ctx` |

## 包检查清单

1. **外部包**：保留现有包管理器与构建系统；新插件应用外部命名策略并带校验过的 `dsh-plugin.naming.json`；`main`/`types`/`exports`/`files`/可选 `bin`/打包 composition 或 Profile 元数据/打包 tarball 保持一致；每个运行时依赖显式声明，编译所需 DSH peer 依赖镜像到 devDependencies；可发布的插件不设 `private`、不用 workspace 版本范围。
2. **拓扑**：可替换能力仅在独立演进时拆包（service 定义/provider/consumer 分开）；单一用途插件保持单包。
3. **校验**：新外部插件先 `node <plugin-write-skill>/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json`（`--strict` 仅防撞名 profile）；通过后网络可用时跑 `node <plugin-write-skill>/scripts/query-registry.mjs --manifest ./dsh-plugin.naming.json --harness-version <精确semver>`（不可用报 unknown 而非 available）；再按变更面跑适用校验块与覆盖率门禁。

## 编写规则

- 每个注册都是 effect：经 `ctx` 助手或 `ctx.effect()` 注册并带 disposer，插件卸载清理每个事件监听/工具/定时器/资源。
- 新行为加在文档化扩展点，不修改 `agent-loop`。
- 公共 service 方法与类型化事件写 JSDoc（`@param`/`@returns`）；类型化事件经目标 Cordis `Events` 接口声明合并定义，注明 `@mode` 分发模式。
- 不硬编码可调值：跨部署可能不同的值必须是可经 `cordis.yml` 改的校验过的 `Config` 字段。
- 模型看到的一切必须能从会话日志重建。
- 配置错误显式失败：不静默跳过缺失引用对象；在 parser/配置/接线/进程边界校验，不信任进程内类型化调用者。

## 验证

外部插件用自己的 install/typecheck/test/static-check/build 命令；打包可发布 artifact、检查内容、装入运行精确目标 DSH 的隔离 Profile；升级场景冷启动并完成一次 消息 → 工具 → 回复 或等价核心流。报告每个未覆盖的 provider/OS/UI/凭据边界。

按变更面选测试：纯逻辑跑单测；跑仓库覆盖率门禁；有 provider 凭据且授权时跑真实 API e2e；模型/协议/用户可见行为用免凭据快照；用户可见插件用真实 composition 测试；`bin` 入口还要原生 Node 的 built-artifact 冒烟。

## 参考材料

| 文件 | 内容 |
|---|---|
| [references/naming-conventions.md](references/naming-conventions.md) | 公开标识符命名规范 |
| [references/plugin-naming.schema.json](references/plugin-naming.schema.json) | dsh-plugin.naming.json 的 JSON Schema |
| [references/naming-policy.v1.json](references/naming-policy.v1.json) | 命名策略（防撞名 profile） |
| [references/registry-check.md](references/registry-check.md) | 中央注册表查询契约 |
| [references/version-adaptation.md](references/version-adaptation.md) | 现有插件跨 DSH 版本适配流程 |
| [scripts/validate-names.mjs](scripts/validate-names.mjs) | 离线命名校验器 |
| [scripts/query-registry.mjs](scripts/query-registry.mjs) | 中央注册表查询器 |
