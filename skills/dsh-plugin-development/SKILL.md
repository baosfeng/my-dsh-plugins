---
name: dsh-plugin-development
description: 在本仓库（my-dsh-plugins）中新建、修改、调试或发布 DSH 插件时使用。覆盖五种插件形态：工具型（defineTool 注册 agent 工具）、侧边栏页签/预览器（宿主原生扩展点 sidebarRightTabs + slots + documentPreviews）、纯 server（事件/HTTP 路由）、两者混合、agent preset 声明包（cordis.patch.yml 里一行 @deepseek-ai/dsh-agent-preset）。也适用于处理注册冲突（already registered）、挂载不生效、HMR 不热更新、profile 双挂载、GitHub Release 发版与 tag 规则等错误场景。仓库内插件均为 plugins/<name> 自包含 bundle；工具型与生态参考见 references/。
---

# 本仓库 DSH 插件开发

## 概览

本仓库是个人 DSH 插件集合（轻量多插件目录，非 workspace monorepo）。每个插件是 `plugins/<name>/` 下的**自包含 Cordis bundle**：拥有自己的 `package.json`、`cordis.patch.yml`、README、LICENSE、CHANGELOG，可独立安装、独立发布、独立拆仓。

一个插件通常由两端组成：

- **Server 端**（`lib/index.js`）：运行在 DSH Node 进程，提供事件监听、HTTP 路由、持久化。
- **Client 端**（`lib/client.js`）：运行在浏览器，通过**宿主原生扩展点**注册侧边栏页签（tab）与文件预览器（viewer）——页签类型走 `ctx.sidebarRightTabs.register(...)`，正文走 keyed 席位 `sidebar.right.pane.tab`，文件预览另走 `ctx.documentPreviews`。

安装方式：`dsh plugin --profile web add link:<插件目录绝对路径>`（或从 GitHub Release 下载 tarball 安装）。

## 何时使用

- 在仓库里**新建**一个插件（先读「插件形态」再动手）
- **修改**现有插件（server / client 任一端）
- **调试**：注册冲突、挂载不生效、页面不刷新不生效、重复挂载
- **发布**：版本号、CHANGELOG、tag、GitHub Release
- **开发工具型插件**（agent 可调用的函数）：官方 `defineTool` 权威 API 直接查本地官方参考源（[tools.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.zh.md) + [tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md)；本 skill 不再维护副本）
- **调研生态/分发渠道**：官方资源与插件市场收录直接查官方 `docs/`（导航见[官方文档索引](../../docs/官方文档/索引.md)）；本仓库自身的双通道分发约定见 [references/tool-plugin-and-ecosystem.md](references/tool-plugin-and-ecosystem.md)
- **查宿主 API 精确语义**：判**存在性 / 定义点 / 契约**（serial 还是 parallel、有没有 `next()`）用**本地官方参考源 + 知识图谱**（参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`，命令见[官方文档索引](../../docs/官方文档/索引.md) 第二节）——官方 docs 只列事件名与概览，这类契约必须回源码；**不要按 API 名字猜**（同名不同义的坑见[本仓库重点](../../docs/官方文档/本仓库重点.md)）。

## 相关 skill（交叉引用）

- `plugin-write`（skills/plugin-write/）：写新插件 + 命名规范/查重（结构化命名清单 + 离线/在线校验，见「命名阶段」增量）
- `plugin-runtime-debug`（skills/plugin-runtime-debug/）：运行时故障排查（读宿主源码契约，增量见 [references/troubleshooting.md](references/troubleshooting.md)）
- `plugin-upgrade`（skills/plugin-upgrade/）：DSH 版本升级/插件兼容性迁移（三模式 + 版本走廊 + 宿主升级纪律）
- `plugin-upgrade` 的模式 D（两 DSH 版本间兼容性审计，npm 模式物化 + playbook 输出契约）已并入同 skill
- `plugin-test`（skills/plugin-test/）：测试 + docker 冒烟（发布前对打包产物冷启动验证）
- `plugin-release`（skills/plugin-release/）：打包发布 + 发布前自动检查（5 层 gate + 语义 gate）

## 宿主能力缺口：一律插件侧接管（项目决策）

**宿主渲染/能力缺口一律由本仓库插件侧接管处理，不依赖上游修改、不向上游提 issue。** 用户决策原话：「全由我们自己的插件进行处理」。

- **不接受**在文档里写「宿主如此设计，故不支持」，也**不接受**以「等上游修复」为由推迟；
- **落地模式**（轨迹视图等后续能力按此模式覆盖）：
  1. **先确证宿主 DOM 契约**——拿到 `文件:行号` / bundle 证据（如上下文注入块由 `@deepseek-ai/dsh-client-ui-chat` 的 `ContextBody` 渲染为 `<pre data-context-text="true">` + CSS `white-space:pre-wrap`），不靠猜；
  2. **幂等标记**——用内容签名标记已接管节点，重复扫描不重复处理；
  3. **可降级**——宿主契约不匹配时静默退让为宿主原文（不报错、不误伤）；
  4. **MutationObserver 兜底**——应对 React 重渲染（宿主重建 DOM 后重新接管）；
  5. **性能保护**——超长内容跳过处理。
- 参考实现：`dsh-md-render` 对宿主纯文本注入块的 DOM 接管（[插件 README](../../plugins/dsh-md-render/README.md) · [md 渲染模块文档](../../docs/md渲染/概述.md)）；遇到同类缺口不要新开「等上游修复」类 issue，直接在本仓库插件里覆盖。
- **profile 插件的 fiber 会被 loader 回收 → 注册必须落到常驻 root**（实测）：注册在插件自身 ctx 上的 `ctx.on('session/event', …)` 与 `ctx.effect(() => webServer.register(…))` 会**静默消失**——事件 0 触发、路由 404，**没有任何报错**。新插件写事件监听/路由时默认用 `const listenCtx = ctx.root ?? ctx` + `{ global: true }`，并以 root 为键去重（避免重复 apply 累积）。判定方法（3 分钟探针）与完整修法：[踩坑：profile 插件 fiber 回收导致监听器静默失效](../../docs/踩坑/README.md)；参考实现 `plugins/dsh-my-context`（`rootListeners` / `rootRoutes`）与防回归测试 `plugins/dsh-my-context/test/host-root-registration.mjs`。

## 插件形态（先决策）

| 形态                                      | 面向                                                | 关键 API                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **工具型插件**（注册 agent 工具）         | 提供 agent 可调用的函数（天气/搜索/记忆等纯工具）   | server 端 `ctx.tools.register(defineTool(...))`，官方权威：[tools.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.zh.md) + [tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md) |
| **侧边栏页签 / 预览器**（宿主原生扩展点） | 在侧边栏提供新页面或文件预览                        | client 端 `ctx.sidebarRightTabs.register(...)` + keyed 席位 `sidebar.right.pane.tab`；文件预览器 `ctx.documentPreviews`（签名查官方 [sidebar-right.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.zh.md)）                     |
| **纯 server 插件**                        | 事件监听 / HTTP 路由 / 持久化                       | `apply(ctx)` + `ctx.on` / `webServer`                                                                                                                                                                                                                                            |
| **两者混合**（最常见）                    | 页面 + 后端逻辑                                     | 两端都写，client 通过 HTTP 路由或事件上报 server                                                                                                                                                                                                                                 |
| **agent preset 声明包**                   | 提供模式选择器里的 agent 预设（如「插件开发模式」） | `cordis.patch.yml` 里一行 `@deepseek-ai/dsh-agent-preset` 声明（`id`/`plugins`/`name`/`description`）；经 `plugin_manager` 的 `install_bundle` 装载（**要求宿主 ≥ 0.1.7-rc.2**）                                                                                                  |

> `ctx.sidebarRightTabs` / `ctx.slots` / `ctx.sidebarRight` / `ctx.documentPreviews` **只存在于 client 端**。server 端需要侧边栏数据时走本插件自己的 HTTP 路由（`/<插件名>/api/*`），不要假设这些服务存在。

> **agent preset 现在由 bundle patch 承载**（issue #231；0.1.7-rc.2 移除了 `$DSH_HOME/.agent-presets/` 目录机制，旧包 `@deepseek-ai/dsh-agent-presets` 已不存在）：目录内只有 YAML 与文档、无 `lib/` JS 代码、不 import cordis，也不声明 `peerDependencies.cordis`。`package.json` 必须显式声明 `"dsh": { "kind": "preset", "bundle": { "patch": "./cordis.patch.yml" }, "presetReason": "<这是什么 preset / 为什么它以此形态分发>" }`，且 `cordis.patch.yml` 里真的有一行 `@deepseek-ai/dsh-agent-preset` 声明（`config.id` + `config.plugins`），才会走对应的发版门禁豁免（1b cordis peer + 3c profile 组合验证；跨插件依赖/CHANGELOG/测试/效果图门禁照旧）。判据与仓库不变量在 `scripts/lib/preset-gate.mjs`：与 `dsh.client` 互斥。参考实现 `plugins/dsh-plugin-dev-mode/`。

### 命名阶段：先检索 npm 包名（强制）

> 背景：`dsh-notify`、`dsh-guardian`、`dsh-skill-manager`、`dsh-plugin-manager` 等包名已被其他开发者的同名插件占用（maintainers 分别为 pasumao / lss1213 / gohana / ruihuahe，均为 DSH 生态独立项目），`dsh plugin add <包名>` 会装到别人的包、功能完全不同。包名撞名必须在**命名阶段**检索规避，而不是发布时才发现再被迫改名。本仓库已按此规避：撞名的插件统一用 `dsh-my-*` 前缀（`dsh-my-notify` / `dsh-my-guardian` / `dsh-my-skill-manager` / `dsh-my-plugin-manager`），目录名 = 包名 = tag 名。

1. **列候选名**：按「目录结构规范」的命名规则（`dsh-<功能>`，目录名 = 包名）列出 1–3 个候选包名。
2. **逐个检索**（npm 官方 registry）：

   ```bash
   npm view <候选包名> --registry=https://registry.npmjs.org
   ```

   - **可用**：输出 `npm error code E404` / `404 Not Found`（无版本信息）→ 包名未被占用。
   - **被占用**：输出版本号、maintainers 等元数据 → 已被占用；`npm view <包名> maintainers` 可查看占用者。
   - 想发现近似名/同功能包：`npm search <关键词> --registry=https://registry.npmjs.org`。

3. **被占用 → 改名**：统一加 `my-` 前缀为 `dsh-my-<功能>`，参考本仓库改名先例 `dsh-my-skill-manager`（原 `dsh-skill-manager` 被占）、`dsh-my-plugin-manager`（原 `dsh-plugin-manager` 被占）。改名后重新执行第 2 步确认新名可用再继续。
4. **记录检索结果（强制）**：候选名 + 占用情况记入该插件的命名 issue（评论即可），发布前复查一次。

> **命名查重增量（plugin-write skill）**：对方提供结构化命名清单 + 离线/在线双重校验，可补充到本流程——① 新建插件时声明 `dsh-plugin.naming.json`（结构化命名清单：包名/显示名/标识符）；② 用 `skills/plugin-write/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json` 离线校验（兼容性错误 = 目标契约失败，前缀警告 = 社区建议）；③ 网络可用时用 `skills/plugin-write/scripts/query-registry.mjs --manifest ./dsh-plugin.naming.json --harness-version <精确版本>` 查中央注册表（无匹配只算"无已审匹配"，超时/网络失败算"未检查"，绝不把自动发现候选当预留）。本仓库 npm 检索（上面 1-4 步）与对方注册表查询互补：npm 查包名占用，注册表查生态标识符冲突。

## 目录结构规范

```
plugins/<name>/                  # 插件目录（小写连字符命名，如 dsh-file-activity）
├── lib/
│   ├── index.js                 # server 端入口（export { name, inject, apply }）
│   └── client.js                # client 端入口（__ModuleLoader__ 格式，见 references/client-file-format.md）
├── test/                        # 测试（CI 只跑 node test/host-smoke.mjs）
├── assets/                      # README 截图等
├── package.json
├── cordis.patch.yml             # bundle 挂载补丁
├── README.md                    # 中文说明（截图 + 功能 + 安装 + 配置）
├── LICENSE                      # MIT（从现有插件复制）
└── CHANGELOG.md                 # Keep a Changelog 格式
```

命名与规范：

- 包名 `dsh-<功能>`（如 `dsh-file-activity`），无 scope；**目录名 = 包名**。
- 插件行 id（cordis.patch.yml）用短横线小写（如 `file-activity`）。
- **client 注册的页签 `id` 用包名**（原生注册表要求全局唯一，且是正文 keyed 席位的 key），**`kind` 用 `包名:xxx`**（如 `dsh-ts-example:greeting`）；`kind` 不得占用内置值 `guide` / `text` / `files`。
- 每个插件**不需要**独立 .gitignore（根 .gitignore 统一覆盖 node_modules / .DS_Store / .dsh-vision-toolkit 等）。
- 新插件 README 必须中文，顶部放插件生态 badge（见现有插件）与**真实运行效果图**；骨架阶段截图可用占位注释，发版前补真实截图。**效果图规范（强制）**：① 每插件 README 顶部放 1–3 张真实运行截图（用 `verifying-dsh-plugins` 隔离实例 + 浏览器端到端截图，非示意图）；② 截图存 `<插件>/assets/`，README 用 `./assets/xxx.png` 相对路径引用；③ 新插件发版前必须补图；④ **功能更新 / UI 变化 / 交互新增时必须同步更新/补充截图**，与代码改动一起提交、一起发版（`scripts/release.mjs` 会校验 README 引用了且 `assets/` 含截图，缺失则发版失败）；⑤ **确无用户可见 UI 的插件走显式声明豁免，不写插件名单**：`package.json` 的 `dsh.ui=false` + 非空 `dsh.uiReason`（写明为什么没有可截图的产物；`dsh.ui=false` 与 `dsh.client` 互斥——声明无 UI 却提供 client 端会被判为非法声明，必须补真实截图）；判据实现 `scripts/lib/screenshot-gate.mjs`、单测 `scripts/test/screenshot-gate.test.mjs`，发版输出与批量汇总显式列出「已豁免」插件与理由（豁免可见、可审计）。
- **需求与回归基准（强制）**：需求以 **GitHub issue** 为准（验收标准写在 issue 正文）；**回归基准 = 该插件测试套件 + issue 验收标准逐条核对**。易碎需求（重启恢复、会话隔离、持久化不丢失、数据不串）必须有专门测试断言（见 [构建与测试 · 需求回归](../../docs/开发指南/构建与测试.md#需求回归强制要求)）。

## 开发流程

0. **先读需求**：读该插件相关 issue 的验收标准，想清楚本次改动涉及哪些条目、可能影响哪些。**新建插件时先做命名阶段 npm 包名检索**（见「插件形态 · 命名阶段」），候选名与占用情况记入命名 issue。
1. **搭骨架**：按上面目录结构创建 `plugins/<name>/`，复制现有插件（`plugins/dsh-file-activity/`）的 `cordis.patch.yml`、LICENSE 作参照。
2. **写 package.json**（字段说明见 [references/package-and-patch.md](references/package-and-patch.md)）。
3. **写 server 端** `lib/index.js`：`export const name / inject / apply(ctx)`。用 `ctx.on(...)` 监听事件、`ctx.effect(() => ...)` 注册副作用（返回 disposer）。HTTP 路由注入 `webServer`：`ctx.webServer.register({ kind: 'prefix', path: '/<插件名>/api', handler: async (request, response) => {...} })`，handler 内先做 loopback 信任围栏（参考现有插件的 `fence(request)`，403 拒绝非本机来源）。
4. **写 client 端** `lib/client.js`（格式见 [references/client-file-format.md](references/client-file-format.md)）：声明 `inject: ['slots', 'sidebarRightTabs']`，用 `ctx.effect(() => ctx.sidebarRightTabs.register({...}))` 注册页签**类型**，再经 `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Body))` 注册**正文**（disposer 必须被 fiber 持有，否则 HMR/禁用后残留注册、下次激活报 `"already registered"`）。
5. **写测试**：`test/` 下放纯 Node 冒烟测试（mock ctx / mock webServer / mock `slots` + `sidebarRightTabs`），CI 只跑 `npm test`（即 `node test/host-smoke.mjs`）；依赖浏览器/真实 GUI 的测试留在本机手动跑。**新增功能必须补测试**，易碎需求（重启恢复/会话隔离）必须有专门断言（可参考 `dsh-file-activity/test/host-smoke.mjs` 的"重启恢复"测试段落）。
6. **回归验证（强制）**：跑全部测试 + 对照 issue 验收标准逐条验证（尤其与本次改动相邻的功能），确认无回归后再提交。
7. **本地验证**：`dsh plugin --profile web add link:<路径>` → 浏览器硬刷新（Cmd/Ctrl+Shift+R）。client 改动热加载无需重启；**server 端改动需重启 `dsh web`**。
8. **清理验证环境（强制）**：验证完成后必须清干净——停掉后台验证实例（job_kill）、删除临时验证目录（`/tmp/dsh-<port>`）、关闭验证用专用浏览器（`browser_close` + 杀 `chrome-cdp-profile` 实例）、确认端口已释放（`curl` 应无响应）、`job_list` 确认无 running 任务。**用户可能同时在开发多个插件，残留环境会互相干扰**。完整清单见 [verifying-dsh-plugins](../verifying-dsh-plugins/SKILL.md) 的「步骤 4：收尾清理」章节（仓库内 skill）。
9. **发布**：`node scripts/release.mjs <插件名> --bump patch --push`（自动 bump 版本 + 生成 CHANGELOG + 同步文档 + 推 tag `<包名>@v<版本>`）→ `.github/workflows/release.yml` 自动测试 + 创建 GitHub Release + npm 发布（NPM_TOKEN 已配置）。详见 [references/tool-plugin-and-ecosystem.md](references/tool-plugin-and-ecosystem.md) 的「发布流程」。

## 细节参考（按需加载）

正文只留决策流程与要点，细节按需加载：

| 需要什么                                                        | 去哪里                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Client 端文件形态（`__ModuleLoader__` 骨架、inject/席位硬约束） | [references/client-file-format.md](references/client-file-format.md)               |
| `package.json` 关键字段 · `cordis.patch.yml`                    | [references/package-and-patch.md](references/package-and-patch.md)                 |
| 工具型插件（defineTool）速览 · 外部生态与分发 · 发布流程        | [references/tool-plugin-and-ecosystem.md](references/tool-plugin-and-ecosystem.md) |
| 常见错误表 · 运行时故障排查 · 需要避免的坑                      | [references/troubleshooting.md](references/troubleshooting.md)                     |
| 社区实战踩坑清单（版本兼容 / 生命周期 / 构建 TS / 类型合并…）   | [references/dsh-plugin-pitfalls.md](references/dsh-plugin-pitfalls.md)             |

## Server 端要点

- `export const name = '<包名>'`、`export const inject = [...]`（可用 `webServer`、`sessions`、`webRuntime` 等服务）、`export function apply(ctx)`。
- 可选服务用 `ctx.get('服务名')` 读取并处理 undefined；硬依赖才放 inject。
- 监听 DSH 事件用 `ctx.on('事件名', handler)`；所有副作用包 `ctx.effect(() => {...})`（返回 disposer 的注册函数直接返回其返回值）。
- 注册 agent 工具：`inject: ['tools']` 后 `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`——完整权威 API 与 schema 硬规则见官方 [tools.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.zh.md)。
- HTTP 路由：`ctx.webServer.register({ kind: 'prefix', path: '/<插件名>/api', handler })`；handler 签名 `(request, response)`，用 `request.url` 分发，`writeHead` + `end` 返回 JSON；先做 loopback 信任围栏。
- 持久化：写 `$DSH_HOME` 下 JSON（防抖 + 原子写 tmp+rename），按会话隔离。

## TypeScript 开发（TS 插件）

> 新插件可用 TypeScript 开发（server 端 tsc 编译 + client 端构建时编译 + CI 类型检查）。**完整示例照抄 `plugins/dsh-ts-example/`**，详细说明见 [docs/TS示例/概述.md](../../docs/TS示例/概述.md)。

- **目录结构**：`src/*.ts`（server 源码，`index.ts` 入口 + 逻辑模块 + `types.d.ts` 运行时类型声明）、`src/client/index.ts`（client 源码，单文件）、`lib/` 放编译产物（`index.js` / `client.js`，**必须提交**——CI 只跑 `node --check` + 测试，不跑构建）。
- **server 构建**：`tsc -p tsconfig.json`（`module: nodenext` → ESM 产物 `lib/*.js`）；相对 import 写 `.js` 扩展名（nodenext 要求，tsc 自动映射到 `.ts` 源码）。
- **client 构建**：`tsc -p tsconfig.client.json`（`module: commonjs` + `moduleResolution: bundler`）编译为 CommonJS 单文件，`scripts/build.mjs` 注入 `lib/client.src.js` 模板的 `__CLIENT_BUNDLE__` 占位符 → `lib/client.js`；产物内联进 `__ModuleLoader__` factory 作用域后 `require`/`exports`/`module` 均为作用域变量。**client 端 TS 源码为单文件**（无运行时相对 import）；多文件/复杂打包用 esbuild/tsdown（官方 `tsdown.client.ts` 协议）。
- **类型检查**：根 `tsconfig.json`（strict）+ `npm run typecheck`（`tsc --noEmit`，CI 强制）——编译期发现模块不存在（TS2307）/类型不匹配/未定义变量；#39 的 `require('dsh-md-render')` 类错误在 TS 下不可能发版出去。
- **运行时类型**：`ctx` / `webServer` / 请求响应用 `src/types.d.ts` 手写最小契约（DSH 运行时模块由宿主提供，不装 cordis 类型包）；client 端 `ctx.sidebarRightTabs` / `ctx.slots` / `ctx.sidebarRight` / `ctx.documentPreviews` 等类型在 `src/client/globals.d.ts` 内联声明（参考 `plugins/dsh-file-activity/src/client/globals.d.ts`）。
- **踩坑**：TS 7 移除了 `moduleResolution: node10`（用 `bundler`）；注释里不写 `/*`（提前闭合块注释 → TS1127）；typescript-eslint 尚不兼容 TS 7（eslint 只查 JS，TS 由 tsc 负责）；tsc 产物（`lib/index.js` 等）加入 `.prettierignore` + `eslint.config.js` ignores。
