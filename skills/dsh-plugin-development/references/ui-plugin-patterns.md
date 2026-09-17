# dsh UI 插件实现思路调研（2026-08）

> 调研样本：zhu1090093659/dsh-web-ui（5500★，UI 插件全家桶 monorepo，18+ 插件包）、omdsh-dev/DSH-better-sidebar（右侧面板服务）、nexu-io/open-design（dsh-runtime 设计引擎）、amruthpillai/reactive-resume（dsh-plugin 简历应用）、官方 dsh-io/dsh-plugin-skill；第二轮：Nagi-ovo/dsh-visualize（生成式 UI）、bowenliang123/dsh-context（上下文面板+slash 命令）、toolclub/dsh-agent-team-gui、Fishquito7/dsh-skill-viewer（技能/MCP 面板）、Noob-stupid/dsh-plugin-hub（插件管理面板）、ccch1mneyyy/dsh-TUI + working-activity、ZSeven-W/dsh-ios（iOS 模拟器）、NanmiCoder/dsh-agent-teams（开发文档踩坑蒸馏）。
>
> ⚠️ **实战踩坑清单（14+ 项目蒸馏）见 [dsh-plugin-pitfalls.md](dsh-plugin-pitfalls.md)**——开发前必读。

## 一、项目形态：monorepo 全家桶 vs 单包

| 形态                | 代表                                       | 特点                                                                                                                                                                               |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **monorepo 全家桶** | dsh-web-ui（`packages/dsh-*` 18+ 包）      | 每个 UI 功能独立成包、独立 npm 发布（`@linxin666/dsh-*`）；提供**聚合包**（dsh-web-ui-all）：dependencies 收集全部子插件 + `cordis.patch.yml` 汇总所有 insert 行，一次安装全部到位 |
| **单包**            | better-sidebar、reactive-resume/dsh-plugin | 一个包一个插件，src + cordis.patch.yml + tsdown                                                                                                                                    |
| **聚合注意事项**    | dsh-web-ui-all                             | 聚合行 id 统一加命名空间前缀（`web-ui-`）避免与独立包冲突；host 半区只注册一次（第二个来源空操作）；子插件随包激活，只想要一部分就装子包                                           |

## 二、包内结构（通用骨架）

```
my-plugin/
├── src/
│   ├── index.ts            # host 端入口（export name/inject/apply）
│   ├── client/             # 浏览器端（React 组件、api 层、locales）
│   ├── host/               # Node 端（服务、路由、loopback 围栏）
│   └── core/               # 两端共享类型/工具（如 types.ts）
├── tests/                  # vitest 测试（含 .tsx 组件测试）
├── cordis.patch.yml        # insert 行
├── package.json            # dsh 字段（bundle.patch + client.platform/inject）
├── tsconfig.client.json    # 浏览器端编译配置（分端编译）
├── tsconfig.host.json      # Node 端编译配置
├── tsdown.config.ts        # 打包（tsdown，TS 项目）
└── mount-once.ts           # 防重复挂载包装（HMR/重载安全）
```

- **双 tsconfig**：client / host 分端编译，是 TS 插件标配。
- **mount-once**：`apply = mountOnce(id, applyImpl)` 防止重复挂载导致二次注册。

## 三、Client 端 UI 注册方式（重点）

| 方式                       | 机制                                                                                                                                                                                        | 代表                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **官方 Slot 系统**（推荐） | `declare module '@deepseek-ai/dsh-client-ui-slots'` 扩展 `SlotMap` 声明槽位 + `inject: ['slots', ...]` 后向槽位注册组件；`context`（如 `conversation.input.selector.context` 分支选择器座） | dsh-web-ui/dsh-git-graph                           |
| **设置卡片（推荐）**       | 两个半侧同包配对：Host 半 `ctx.settings.installSection(ctx, NS, Config, config, {...})`；浏览器半按 UI 体量选 slot：紧凑单项偏好用 keyed slot `settings.plugin.item`（key = 命名空间），需要完整内容区的设置页用一级分区 slot `settings.section`（官方 [cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.zh.md)） | dsh-web-ui/dsh-pet、community-plugins、skin-center |
| **全局悬浮（不走 slot）**  | 全局 UI（宠物等）直接 `createRoot(document.body)` 挂独立 React root——新会话页无 session，会话级 slot 会消失                                                                                 | dsh-web-ui/dsh-pet                                 |
| **侧边栏页签（宿主原生）** | `inject: ['slots', 'sidebarRightTabs']`：`ctx.sidebarRightTabs.register` 注册类型 + keyed 席位 `sidebar.right.pane.tab` 挂正文（第三方 `dsh-better-sidebar` 已弃用）                          | 本仓库 dsh-file-activity                            |

> **i18n 是标配**：`declare module ... LocaleNamespaceMap` 注入语言包；官方有 `@deepseek-ai/dsh-client-locale`。
> **SDK 依赖**：`@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-slots`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-settings` 等（type-only import 触发类型合并）。

## 四、Host 端（Node 侧）模式

- `inject` 官方服务：`webServer`、`sessions`、`subprocess`、`workspaceRegistry`（如 dsh-git-graph 注入 subprocess 执行 git）。
- **安全边界两层**：
  - loopback 信任围栏（本仓库 dsh-file-activity 的 `fence()` 同款）
  - **workspace 门**：`workspaceGate(path)` 校验请求路径必须是已注册的 workspace 根，浏览器只能对 workspace 操作，不能操作任意主机目录（dsh-git-graph 的 `WorkspaceGate`）。
- HTTP 路由 + **SSE 实时推送**（git 图变更流 `sse-leader.ts`）；或 client 轮询（dsh-pet 2s 轮询快照）。
- `ctx.effect(() => registerRoutes(...), '描述')`——路由注册带可读描述，disposer 生命周期。

## 五、Client 端组件设计

- 纯 props 组件 + **注入业务面接口**（`GitGraphInjected`）：组件不直接 fetch，业务动词经 inject 注入。
- 错误边界：渲染失败显示错误条（`RenderBoundary`），不白屏。
- CSS Modules（如 `pet.module.css`）+ 主题。
- 皮肤/主题类 UI：`skin.json` 清单 + 资产目录，由**皮肤中心**唯一加载器动态加载（插件负责逻辑、皮肤负责外观）。

## 五·二、第二轮调研：新发现模式（2026-08）

| 模式                   | 代表             | 思路                                                                                                                                                                                                          |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **生成式 UI**          | dsh-visualize    | 模型调用 `visualize` 工具写入 HTML fragment → 对话内渲染交互卡片；**sandboxed iframe + CSP**（禁网络/嵌套/表单，只允许固定 CDN）+ fragment 1MB 上限；会话重放从持久化工具结果恢复。工具型 + UI 渲染的混合形态 |
| **slash command 载体** | dsh-context      | 除面板外，`/context` 命令弹窗展示上下文洞察——命令是 UI 的第二出口                                                                                                                                             |
| **事件驱动状态行**     | working-activity | 监听 `tool_execution_start/end/update` 实时渲染"正在跑什么"；无进度事件时退化为耗时显示                                                                                                                       |
| **插件管理面板**       | dsh-plugin-hub   | 插件 toggle = `- id: xxx / disabled: true` 两行 YAML（HMR ~1s 重组）；安装链：curl 手动装 tarball（node 网络受限）→ git 通道 → EPERM stale-dir 清理重试；**升级后兼容警告**而非静默失败                       |
| **设置面板多分区**     | dsh-skill-viewer | 设置页注册多个一级分区（技能 + MCP）；管理 `cordis.patch.yml` 受管块，保存后 HMR 热加载；技能实体按**工作区作用域**（全局 `~/.dsh/skills` vs 工作区 `.dsh/skills`）精确操作，同名不互相影响   |
| **子进程管理**         | dsh-ios          | serve-sim 子进程：专用端口段（3181-3244）避免冲突、`--host` 永不使用、崩溃自动重启、无消费者自动停、**孤儿进程收养/回收**（`-k` 再拉起）                                                                      |
| **跨平台适配**         | working-activity | 同一 UI 想法适配 pi CLI + DSH 双平台，各自独立 npm 包；DSH 版可能需要 **runtime 补丁**（patches/*.patch）                                                                                                     |
| **对话流卡片**         | dsh-agent-teams  | 会话事件（`SessionEventMap` 合并）→ 对话内流程卡片；**面板类 UI 以磁盘为真相源**（host 快照），事件只用于节点展示                                                                                             |

> 通用结论：UI 载体已多样化——官方 Slot / 设置卡片 / slash command / 对话流卡片 / 全局挂载 / 宿主原生侧边栏页签（`sidebarRightTabs`）/ TUI 槽位。选型看 UI 的生命周期作用域：会话级 → 会话槽位/对话流；宿主全局 → settings 分区/全局挂载/命令。

## 六、对本仓库的启示（对比）

| 维度     | 本仓库 dsh-file-activity   | 生态成熟做法                                                                  |
| -------- | -------------------------- | ----------------------------------------------------------------------------- |
| 注册方式 | 宿主原生 `sidebarRightTabs` + keyed 席位 | 一致：官方 Slot 系统 + 设置卡片是通用正路 |
| 通信     | fetch 轮询 stats           | 轮询 + SSE 流；UI 事件用同源 JSON 路由                                        |
| 安全     | loopback 围栏 ✅           | + workspace 门（路径必须属于注册 workspace）                                  |
| 持久化   | $DSH_HOME 防抖原子写 ✅    | 一致                                                                          |
| 生命周期 | ctx.effect ✅              | 一致；另有 mount-once 防重复挂载                                              |
| 构建     | 纯 JS ESM                  | TS 双端编译 + tsdown                                                          |

> 生态验证：官方 Slot 系统是 UI 插件的正路（设置卡片、会话槽位、全局挂载各有适用场景）；本仓库侧边栏统一用宿主原生 `sidebarRightTabs` + keyed 席位。
