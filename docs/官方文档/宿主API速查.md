---
title: 官方文档 · 宿主 API 速查
description: 按「要做什么」定位宿主 API 的官方页面与一句话语义，杜绝按名字猜语义 — 三条查询正路 + 任务入口表 + Cordis 心智模型 + 能力接缝 + 术语译名
---

# 宿主 API 速查（查哪里 + 一句话语义）

> ⚠️ **何时阅读：** 接宿主能力前、拿不准某个 `ctx.*` / 事件语义时。本文件**只回答「查哪里 + 一句话语义」**；签名、类型字段、配置键、事件 payload 一律由官方页面与生成目录承载，本文件不复制、不罗列。
>
> 链接前缀均为 `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/`（中文版 `*.zh.md`）。本地参考源 `~/.dsh-refs/deepseek-harness`，可直接 grep。分域导航见同目录 [子系统地图](子系统地图.md)、文档总览见 [索引](索引.md)。

## 一、查 API 的三条正路

**正路 1 — 精准语义：子系统页（首选）**

官方 `docs/subsystems/<名>.zh.md`：每页含该子系统的类型定义 + **生成的 `Cordis API` 小节**（anchor `#cordis-surface`，内含 `ctx.<key>` 服务方法与 `<域>/*` 事件清单）。类型块与源码等价（由 `verify-type-equiv` 校验），**读这一页即等价于读源码**，不必再翻源码猜。

```bash
cd ~/.dsh-refs/deepseek-harness/docs
ls subsystems                                          # 58 页清单，文件名即子系统名
grep -rln '^## Cordis API' subsystems/*.zh.md          # 49 页带 Cordis API 小节
grep -rh '^### `ctx\.' subsystems/*.zh.md              # 全部 76 个 ctx 服务小节
grep -rh '^### `[a-z-]*/\*` events' subsystems/*.zh.md # 全部 26 个事件域小节
```

**正路 2 — 判定「谁能替换、谁发谁收」**

- 能力归属与可替换性 → [capability-seams.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.zh.md)：总表列为 `ctx 键 | 角色 | 所属包 | 实现 | 直接消费方 | 配套插件 | 说明`；**角色列 `seam` 才是可替换能力**，`core` 是主干服务。
- 事件归属与分发模式 → [event-producer-consumer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/event-producer-consumer.zh.md)：矩阵列为 `Event | Mode | Declared in | Dispatchers | Listeners`；**Mode 列就是唯一允许的分发方法**。
- 不属于任何子系统的 `ctx` 成员（cordis core / loader / hmr / timer 继承层）→ [cordis-api/inherited.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/inherited.md)（仅英文）。
- 想知道「这个事实归哪一层文档」→ [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md)（官方文档分层契约）。

**正路 3 — 全量目录：只检索，不通读**

```bash
cd ~/.dsh-refs/deepseek-harness/docs
grep -n '^### `' tool-catalog.zh.md | grep -i <工具名关键词>     # 工具 schema；包小节为 `## `@deepseek-ai/dsh-…``
grep -n '^## `@deepseek-ai/dsh-<包名>`' config-catalog.zh.md     # 某个包可设置的 config 键
grep -n -A4 '^### `turn/\*`' persistence-catalog.zh.md           # 持久化事件域及其变体
grep -n 'turn/start' persistence-catalog.zh.md                   # 事件是否有持久化声明
grep -n '<包名>' module-graph.zh.md                              # peer 依赖（mermaid 节点 + 末尾表格行）
```

四份在线目录：[tool-catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.zh.md) · [config-catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md) · [persistence-catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/persistence-catalog.zh.md) · [module-graph](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.zh.md)。四者都是生成物：**不要通读、不要手改、不要整篇复制进本仓库**。`module-graph` 没有小节标题，只能按包名 grep。

## 二、按「我要做什么」找入口

| 我要做什么 | 去哪一篇 | 一句话语义 / 最易猜错处 |
| --- | --- | --- |
| 注册模型可调用工具 | [subsystems/tools.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.zh.md) + [cookbook/adding-a-tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md) | `ctx.tools` 是**作用域化**注册表；`defineTool` 只是类型化辅助，原始 JSON Schema 的 `ToolDefinition` 同样可注册（MCP 工具走这条）。执行必经 `tools/pre-execute → tools/execute → tools/post-execute` 三段 waterfall |
| 订阅 / 发送事件 | [cordis-api/events.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/events.zh.md) + [user/develop/framework/events.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.zh.md) | 分发方法由事件 mode 唯一决定（`emit`/`waterfall`/`parallel`/`serial`/`bail`），换方法即错；waterfall 是环绕中间件，不调 `next()` 就短路下游 |
| 注册服务 / 依赖服务 | [cordis-api/service.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/service.zh.md) + 对应子系统页 | 一个服务占一个 `ctx.<key>`；消费方用 `inject` 声明依赖，**永不 import 实现**——这正是「换提供方不动消费方」的前提 |
| 读写插件配置 | [user/develop/basic/config.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.zh.md) + [config-catalog.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md) | 该页是**部署轴**（`cordis.yml` 条目 config）；插件作者要的连接方式在子系统页生成区，模型可见的工具 schema 在 tool-catalog |
| 持久化会话事件 | [persistence-catalog.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/persistence-catalog.zh.md) + [subsystems/session.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.zh.md) | 只有写进**仅追加日志**的事实才跨 reload / fork 存活；surface 事件进模型历史，log-only 不进；「模型可见即已记录」是运行时不变量 |
| 改系统提示词 | [subsystems/system-prompt.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.zh.md) | 提示词是**逐步骤组装**的（片段 + 工具 schema 提供方），不是一份全局静态字符串 |
| 加设置卡片 | [cookbook/adding-a-settings-card.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.zh.md) + [subsystems/settings.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/settings.zh.md) | Host 半侧注册命名空间、浏览器半侧用 `dsh.client` 声明，**以命名空间为键自动配对**；分层解析为 默认值 → 组合 base → 用户文档 |
| 侧边栏页签 / 客户端 UI | [subsystems/sidebar-right.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.zh.md) + [subsystems/slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md) + [subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md) + [web-styling.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.zh.md) | 页签是**注册进宿主 tab 注册表并由宿主路由**，不是自己往 DOM 塞；slot 有声明所有权 / cardinality / scope |
| 控制 subagent / 团队 | [subsystems/subagent.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.zh.md) + [subsystems/agent-team.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/agent-team.zh.md) | `ctx.subagents` 是**命名提供方注册表**，启动时能力与运行时能力分离；Agent Teams 是显式启用的协作 seam，不是默认行为 |
| 审批 | [subsystems/approval.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.zh.md) | 一次性决策经 `approval/request` waterfall 分派，**回答方是监听器**；无回答方以 `unavailable` 故障关闭（不会默认放行） |
| 用户提问 | [subsystems/user-questions.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/user-questions.zh.md) | UI 侧提供当前生效的回答方，工具侧在**提供方无关**的 `ask()` promise 上暂停 |
| 沙箱策略 | [subsystems/sandbox.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.zh.md) | 消费方交出**即将执行的确切 argv**，后端按每次调用的策略包装并报告强制执行；故障关闭 |
| 文件系统 | [subsystems/filesystem.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/filesystem.zh.md) | `ctx.fs` 是 seam，`tool-fs` 才是消费方；变更限制由 `fs-sandbox` 按共享沙箱模式施加 |
| 终端 / 子进程 / shell | [subsystems/shell.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/shell.zh.md) + [subsystems/subprocess.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subprocess.zh.md) + [subsystems/terminal.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/terminal.zh.md) | 三层别混：`shell` = 面向模型的执行器 seam；`subprocess` = 底层 spawn（进程树 / stdio / kill 升级）；`terminal` = 持久终端会话（有身份与清理） |
| skill 加载 | [subsystems/skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md) | `ctx.skills` 合并各提供方目录；`tool-skill` 渲染**会话前缀目录**、按需加载正文，不是全量塞进提示词 |
| 压缩 | [subsystems/compaction.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.zh.md) | 由压力 / 请求错误事件驱动的 `ctx.compaction` 引擎；**不存在面向模型的压缩工具** |
| 后台任务 | [subsystems/jobs.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/jobs.zh.md) | producer 登记正在运行的工作，`ctx.jobs` 是消费方视图，`job_*` 工具负责读取与终止 |
| 加 HTTP 路由 | [subsystems/web-server.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.zh.md) | 具名路由注册表 + 匹配顺序 + **可认领的回退席位**；索引渲染有挂接点 |
| 加 Remote API（Host ↔ 浏览器） | [cookbook/adding-a-remote-api.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-remote-api.zh.md) + [subsystems/typert.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/typert.zh.md) | 五步：声明方法 / 声明失败 / 注册 / Client 消费 / 写测试；失败面是单个 `RemoteError` + 一张码表 |
| 人类斜杠命令 | [subsystems/commands.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/commands.zh.md) | 命令由面向人的适配器解释执行，**不成为模型消息**；既非模型工具也非 `ctx.shell` |
| 判断新行为挂在哪 | [architecture.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md) | 文末「新行为的归属位置」表：目标 → 机制，一表定归属 |

## 三、Cordis 心智模型速记

| 概念 | 一句话语义 | 猜错的典型症状 |
| --- | --- | --- |
| `ctx` | 服务容器；`extend` / `isolate` / `intercept` 派生有作用域子上下文且不改父 | 当全局单例用、跨插件直接 import 实现 |
| service | 一个服务占一个稳定 `ctx.<key>`，`super(ctx, name)` 即注册，随所属 fiber 自动移除 | 以为要手动编排启动顺序 |
| `inject` | 声明依赖 → 服务就绪才 `apply`；服务消失自动卸载、恢复后重新加载 | 手动 await 服务、把加载顺序写死 |
| event | 事件名靠 TypeScript 声明合并注册；**分发方法由事件 mode 唯一决定** | 用 `emit` 求返回值（该用 `waterfall`/`serial`/`bail`） |
| waterfall | 环绕中间件，监听器收 `(...args, next)`；不调 `next()` 即短路 | 忘 `next()` → 下游静默不执行（表现为「事件没反应」） |
| fiber / effect | 每插件一个 fiber；注册是可逆副作用，经 `ctx.effect()` / `ctx.on()` 安装，卸载即撤销 | 不返回 disposer → reload 后重复注册（already registered） |
| scope | 按 agent 的注册单位，只有全局与带作用域两层，**不继承给 subagent** | 以为子 agent 自动继承父的自定义工具或提示词 |

> 概念全貌：[cordis-primer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md)（5 个核心概念 + 分发模式表 + waterfall 语义）；动手：[cordis-tutorial/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/index.zh.md)。

## 四、能力接缝（capability seams）总览

**seam** = 一项可替换能力，含三种角色：Service Definition（拥有 `ctx.<key>` 的 `Service`，绝非 TS `interface`）+ Service Provider + Consumer；单一角色本身不是 seam。总表 [capability-seams.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.zh.md) 中角色列标 `seam` 的共 32 项，按域分组：

- 模型：`ctx.llm`、`ctx.deepseekLlmApiExtensions`
- 会话与存储：`ctx.sessionPersistence`、`ctx.storage`、`ctx.sessionQuery`、`ctx.sessionTitle`
- 配置与凭据：`ctx.settings`、`ctx.credentials`、`ctx.authorization`
- 执行世界：`ctx.subprocess`、`ctx.shell`、`ctx.terminals`、`ctx.sandbox`、`ctx.fs`、`ctx.lsp`、`ctx.ptcRuntime`
- 人机交互：`ctx.approval`、`ctx.userQuestions`、`ctx.directoryPicker`
- 工具面能力：`ctx.skills`、`ctx.web`、`ctx.mcpResources`、`ctx.browserUse`、`ctx.computerUse`、`ctx.spillStore`、`ctx.compaction`、`ctx.subagents`、`ctx.jobs`、`ctx.workflowEngine`、`ctx.attachments`、`ctx.sessionTelemetry`、`ctx.fileReferences`

替换提供方时的注意点：

1. **先确认角色是 `seam`**——`core` 是主干服务，没有第二实现可换。
2. **执行世界是连体的**：文件系统与进程提供方共享同一世界，指向远程沙箱会把 Bash、PTY、LSP 一起搬过去；不要为某个工具单独 fork。
3. **换提供方要连 profile 一起换**：消费方按 `ctx.<key>` 查找，所以代码不用改；但提供方未被加载时服务缺失，`inject` 它的插件会一直停在 PENDING（症状：插件「写了不生效」）。

## 五、术语译名对照（最易误解的十条）

| 英文 | 官方译名 | 易误解点 |
| --- | --- | --- |
| seam | 接缝 / 能力接缝 | 不是「接口」：是含三种角色的**完整能力**，单角色不叫 seam |
| scope | 作用域 | 按 agent 划分的注册单位，只有两层；**不继承给 subagent**，与变量作用域无关 |
| shadowing | 遮蔽 | 最具体者胜出：带作用域注册只在该 scope 内替换**同名全局项** |
| turn / step | 轮次 / 步骤 | 轮次 = 一次排空已接纳输入；步骤 = 一次模型请求 + 其工具执行；两者不可混用 |
| Round | Round（不译） | 承载轮次的外层策略迭代（Goal Round、Ralph Round），计数器归该策略所有 |
| human command | 人类命令 | 斜杠指令，不进模型消息；与「模型工具」「shell 命令」都不同 |
| lineage | 谱系 | 父子关系以**数据**携带（`parentSession`、深度），**从不影响可见性** |
| goal | 目标 | 一种持久状态，不是调度器也不是独立对话；会话日志才是真源 |
| activation | 激活 | 进程本地权限，**不参与持久回放**；恢复或 fork 后须人类授权才自动续跑 |
| scoped dispatch | 带作用域分发 | 关于某 agent 的活动按该 agent 的载体分发，但**注册表主体事件有意不过滤** |

> 全量译名与定义见 [glossary.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/glossary.zh.md)。

## 六、本仓库对应 skill 与参考

| 场景 | 去哪 |
| --- | --- |
| 新建 / 修改 / 发布插件（三种形态） | [skills/dsh-plugin-development/SKILL.md](../../skills/dsh-plugin-development/SKILL.md) |
| 运行时行为异常，必须对照精确宿主 API 语义排查 | [skills/plugin-runtime-debug/SKILL.md](../../skills/plugin-runtime-debug/SKILL.md) |
| 新插件形态选择与公开命名校验 | [skills/plugin-write/SKILL.md](../../skills/plugin-write/SKILL.md) |
| 测试层级选择（单测 / e2e / 快照 / Web） | [skills/plugin-test/SKILL.md](../../skills/plugin-test/SKILL.md) |
| DSH 版本升级与兼容审计 | [skills/plugin-upgrade/SKILL.md](../../skills/plugin-upgrade/SKILL.md) · [skills/dsh-upgrade-audit/SKILL.md](../../skills/dsh-upgrade-audit/SKILL.md) |
| 常驻逻辑的资源预算评审 | [skills/resource-budget-review/SKILL.md](../../skills/resource-budget-review/SKILL.md) |
| 已核对过的具体 API 用法（工具、原生侧边栏、UI 模式、踩坑） | [skills/dsh-plugin-development/references/](../../skills/dsh-plugin-development/references/) |

> 本机实际安装的宿主版本可能领先于官方 docs：`dsh --version` 与 `~/.dsh-refs` 基线不一致时，**以本机 `node_modules` 里的宿主包为准**（读 `*.d.ts` 与 `lib/`），官方页只作方向指引。
