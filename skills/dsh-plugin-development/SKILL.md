---
name: dsh-plugin-development
description: 在本仓库（my-dsh-plugins）中新建、修改、调试或发布 DSH 插件时使用。覆盖五种插件形态：工具型（defineTool 注册 agent 工具）、侧边栏页签/预览器（宿主原生扩展点 sidebarRightTabs + slots + documentPreviews）、纯 server（事件/HTTP 路由）、两者混合、agent preset 资产包（agent.cordis.yml + preset.yml）。也适用于处理注册冲突（already registered）、挂载不生效、HMR 不热更新、profile 双挂载、GitHub Release 发版与 tag 规则等错误场景。仓库内插件均为 plugins/<name> 自包含 bundle；工具型与生态参考见 references/。
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
- **调研生态/分发渠道**：官方资源与插件市场收录直接查官方 `docs/`（导航见[官方文档索引](../../docs/官方文档/索引.md)）；本仓库自身的双通道分发约定见下「外部生态与分发」
- **查宿主 API 精确语义**：判**存在性 / 定义点 / 契约**（serial 还是 parallel、有没有 `next()`）用**本地官方参考源 + 知识图谱**（参考源 `/Users/bsfeng/IdeaProjects/deepseek-harness`，命令见[官方文档索引](../../docs/官方文档/索引.md) 第十节）——官方 docs 只列事件名与概览，这类契约必须回源码；**不要按 API 名字猜**（同名不同义的坑见[本仓库重点](../../docs/官方文档/本仓库重点.md)）。

## 相关 skill（交叉引用）

- `plugin-write`（skills/plugin-write/）：写新插件 + 命名规范/查重（结构化命名清单 + 离线/在线校验，见「命名阶段」增量）
- `plugin-runtime-debug`（skills/plugin-runtime-debug/）：运行时故障排查（读宿主源码契约，见「运行时故障排查」增量）
- `plugin-upgrade`（skills/plugin-upgrade/）：DSH 版本升级/插件兼容性迁移（三模式 + 版本走廊 + 宿主升级纪律）
- `dsh-upgrade-audit`（skills/dsh-upgrade-audit/）：两 DSH 版本间兼容性审计（npm 模式物化 + playbook 输出契约）
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
| **agent preset 资产包**                   | 提供模式选择器里的 agent 预设（如「插件开发模式」） | `agent.cordis.yml` + `preset.yml` + 自带 `skills/`；**不挂 profile**，复制到 `$DSH_HOME/.agent-presets/<id>/` 后由宿主 `@deepseek-ai/dsh-agent-presets` 发现                                                                                                                     |

> `ctx.sidebarRightTabs` / `ctx.slots` / `ctx.sidebarRight` / `ctx.documentPreviews` **只存在于 client 端**。server 端需要侧边栏数据时走本插件自己的 HTTP 路由（`/<插件名>/api/*`），不要假设这些服务存在。

> **agent preset 资产包不是插件**（issue #231）：没有 `lib/`、`cordis.patch.yml`，不声明 `peerDependencies.cordis`，也不经 `dsh plugin add` 装载。`package.json` 必须显式声明 `"dsh": { "kind": "preset", "presetReason": "<这是什么 preset / 为什么是资产包而非 profile 插件>" }` 才会走对应的发版门禁豁免（1b cordis peer + 3c profile 组合验证；跨插件依赖/CHANGELOG/测试/效果图门禁照旧）。判据与仓库不变量在 `scripts/lib/preset-gate.mjs`：声明必须配真实 `agent.cordis.yml` + `preset.yml`，且与 `dsh.bundle` / `dsh.client` 互斥。参考实现 `plugins/dsh-plugin-dev-mode/`。

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
│   └── client.js                # client 端入口（__ModuleLoader__ 格式，见下）
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
2. **写 package.json**（见下方字段说明）。
3. **写 server 端** `lib/index.js`：`export const name / inject / apply(ctx)`。用 `ctx.on(...)` 监听事件、`ctx.effect(() => ...)` 注册副作用（返回 disposer）。HTTP 路由注入 `webServer`：`ctx.webServer.register({ kind: 'prefix', path: '/<插件名>/api', handler: async (request, response) => {...} })`，handler 内先做 loopback 信任围栏（参考现有插件的 `fence(request)`，403 拒绝非本机来源）。
4. **写 client 端** `lib/client.js`（格式见下节）：声明 `inject: ['slots', 'sidebarRightTabs']`，用 `ctx.effect(() => ctx.sidebarRightTabs.register({...}))` 注册页签**类型**，再经 `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Body))` 注册**正文**（disposer 必须被 fiber 持有，否则 HMR/禁用后残留注册、下次激活报 `"already registered"`）。
5. **写测试**：`test/` 下放纯 Node 冒烟测试（mock ctx / mock webServer / mock `slots` + `sidebarRightTabs`），CI 只跑 `npm test`（即 `node test/host-smoke.mjs`）；依赖浏览器/真实 GUI 的测试留在本机手动跑。**新增功能必须补测试**，易碎需求（重启恢复/会话隔离）必须有专门断言（可参考 `dsh-file-activity/test/host-smoke.mjs` 的"重启恢复"测试段落）。
6. **回归验证（强制）**：跑全部测试 + 对照 issue 验收标准逐条验证（尤其与本次改动相邻的功能），确认无回归后再提交。
7. **本地验证**：`dsh plugin --profile web add link:<路径>` → 浏览器硬刷新（Cmd/Ctrl+Shift+R）。client 改动热加载无需重启；**server 端改动需重启 `dsh web`**。
8. **清理验证环境（强制）**：验证完成后必须清干净——停掉后台验证实例（job_kill）、删除临时验证目录（`/tmp/dsh-<port>`）、关闭验证用专用浏览器（`browser_close` + 杀 `chrome-cdp-profile` 实例）、确认端口已释放（`curl` 应无响应）、`job_list` 确认无 running 任务。**用户可能同时在开发多个插件，残留环境会互相干扰**。完整清单见 [verifying-dsh-plugins](../verifying-dsh-plugins/SKILL.md) 的「步骤 4：收尾清理」章节（仓库内 skill）。
9. **发布**：`node scripts/release.mjs <插件名> --bump patch --push`（自动 bump 版本 + 生成 CHANGELOG + 同步文档 + 推 tag `<包名>@v<版本>`）→ `.github/workflows/release.yml` 自动测试 + 创建 GitHub Release + npm 发布（NPM_TOKEN 已配置）。详见 [发布流程](#发布流程自动--手动)。

## Client 端文件形态（必须用这个格式）

client bundle 由浏览器模块加载器装载，**不是 Node ESM**。照抄这个骨架：

```js
// lib/client.js
window.__ModuleLoader__.load({
  id: 'dsh-<功能>', // = 包名
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement } = require('react')

    // 宿主原生扩展点：声明式 inject = 硬依赖（服务就绪后插件才激活，不会静默不注册）
    exports.inject = ['slots', 'sidebarRightTabs']
    const TAB_ID = 'dsh-<功能>' // 注册表身份：全局唯一 + 正文席位的 key
    const TAB_KIND = 'dsh-<功能>:<页面>' // 类型判别符：openTab(kind) 按它打开

    exports.apply = function apply(ctx) {
      // 第一步：页签「类型」（disposer 必须包在 effect 里）
      ctx.effect(() =>
        ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND, // 省略 patterns = 页面类型（按 kind 打开）
          title: () => '页面名', // chip 初始文本，打开时捕获
          guide: [{ order: 20, title: () => '页面名' }], // 省略 guide = 进不了侧边栏引导页
        }),
      )
      // 第二步：「正文」keyed 席位（key = 上面定义的 id，官方形态）
      ctx.effect(() =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ({ useTabInfo, sessionId }) =>
            createElement(Page, {
              sessionId,
              visible: useTabInfo().tab.visible !== false, // 折叠或非激活时暂停轮询
            }),
          ),
        ),
      )
    }

    return module.exports
  },
})
```

- `inject: [...]` = **硬依赖**：所列服务宿主自带，缺任一服务时插件进入等待、**不激活**——且**不报错**，静默不激活是排查成本最高的一种失败形态。
- 只有 keyed 席位（`key` = 定义的 `id`）能拿到 `useTabInfo()`；`tab.visible === false`（侧边栏折叠或该页签非激活）时暂停轮询/订阅，`tab.signal` 在记录消失或插件卸载时中止。
- 页面组件里用 `sessionId` 调本插件自己的 HTTP 路由；文本用 `navigator.language` 判断中英文（参考现有插件 `isZh()` 模式）。
- 文件预览器不走 tab：`ctx.documentPreviews.register({ id, extensions, title, priority })` 由 `text` 页签的工具栏调用。

## package.json 关键字段

```jsonc
{
  "name": "dsh-<功能>",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json",
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "CHANGELOG.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime"] },
  },
  "peerDependencies": {
    "cordis": "^4.0.0-rc.10",
    "react": "^18.2.0 || ^19.3.0",
  },
  "peerDependenciesMeta": {
    "cordis": { "optional": true },
  },
  "scripts": { "test": "node test/host-smoke.mjs" },
}
```

要点：

- `dsh.bundle.patch` 指向的 `cordis.patch.yml` 会被 `dsh plugin add` 自动应用，**不要在 profile 里手动重复 insert 同一行**（会报 duplicate loader entry）。
- peer 依赖（cordis / react）由宿主 profile 提供；`optional: true` 表示缺省也可加载（注册代码判空跳过）。**不声明任何第三方侧边栏包**——侧边栏能力全部经宿主服务名获取。

## cordis.patch.yml

```yaml
- insert:
    - id: <插件短名>
      name: '<包名>'
```

`id` 在 profile 内全局唯一。挂载行只负责装载：不要在这里写配置，配置经 `config` 字段且由插件自行校验。

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

## 工具型插件（defineTool）速览

> 官方权威 API（dsh 插件最核心形态）：注册 agent 可调用的工具函数。完整细节见官方 [tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md) 与 [cookbook/adding-a-tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)。

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool' // 必须与 cordis.patch.yml 的 id 一致
export const inject = ['tools'] // 必须：否则 ctx.tools undefined

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'my_tool_func',
      description: '做某件事（agent 据此决定是否调用）',
      parameters: { arg: { type: 'string', description: '参数说明', required: true } },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
      },
      async execute(args) {
        return { ok: true }
      }, // 是 execute 不是 run
    }),
  )
}
```

**schema 硬规则：** ① `required` 是属性级（写 `required: true`，无 `required` 数组、无 `required: false`）；② 对象 schema 必须显式 `additionalProperties: false`；③ `output` 必填（schema + render 返回 `{ type: 'text', text }`）；④ 用 `execute(args)` 不是 `run`。

**开发调试：** `npx @dsh-io/dsh-dev scaffold <name>` 生成 TS 骨架（**第三方、非官方**脚手架，官方没有 scaffold 命令） → `npm run build` → `npx @deepseek-ai/dsh --profile web --patch <abs-path>/cordis.patch.yml` 对活 harness 调试 → `dsh plugin add <dir>` 永久注册。**本仓库 JS 约定差异**：官方骨架是 TypeScript（`@deepseek-ai/dsh-tools` 提供类型增强），本仓库插件为纯 JS（`lib/index.js` ESM）——API 相同、`defineTool` 同样可用，但**没有类型检查兜底，必须手动遵守上面的 schema 硬规则**。

## 外部生态与分发

- **本仓库分发约定（双通道）**：GitHub Release + **npm 官方 registry**（release.yml 读仓库 `NPM_TOKEN` secret 自动发布；未配置时仅警告跳过）。完整流程见 [docs/开发指南/发版流程.md](../../docs/开发指南/发版流程.md)。
- **第三方脚手架（非官方）**：`npx @dsh-io/dsh-dev scaffold <name>` 生成 TS 骨架；官方没有 scaffold 命令，用前自行核实。
- **市场收录（本仓库已用）**：给公开仓库打 GitHub topic `dsh-plugin` 即被 dshfind.com 与 DSH 1024Store（deepseek1024.com）自动聚合收录；1024Store 收录前静态校验 `package.json` + `dsh.bundle.patch` + patch 文件齐备——可当发布自检参考。

## 发布流程（自动 / 手动）

**方式 A（推荐，全自动）**：仓库 Actions → **Release (auto)** workflow（选插件 + bump 类型）→ 自动 bump 版本、生成 CHANGELOG（git log 提取）、同步文档、打 tag、触发 GitHub Release + npm 发布。

**方式 B（本地手动，等价）**：`node scripts/release.mjs <插件名> --bump patch --push`（bump 版本 + CHANGELOG 生成 + 根 README/AGENTS 版本同步 + tag + push）。版本已手动改好时省略 `--bump`。

发版门禁（release.mjs 自动校验）：`peerDependencies.cordis` 已声明且 major 一致（**agent preset 资产包 `dsh.kind=preset` 豁免**，见「插件形态」）→ CHANGELOG 有当前版本段 → npm test 全绿 → README 效果截图引用有效（`./assets/` 或 unpkg URL）→ 文档版本同步 → tag。**验证发布结果**：GitHub Releases 页面确认 Release + `.tgz` 附件、npmjs.com 确认新版本（或 `npm view <包名> version --registry=https://registry.npmjs.org`）；失败时去 Actions 页看失败步骤（历史校验 bug 见 [踩坑：release 版本校验失败](../../docs/踩坑/README.md)）。

## 常见错误

| 症状                                                                       | 根因                                                                                          | 解决                                                                                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"tab type ... already registered"`                                        | 重复注册：HMR 残留或 id 冲突                                                                  | 注册必须包 `ctx.effect`；id 全局唯一（内置 explorer/git/terminal 等不可占用）                                                                                                 |
| `"no service available"`（tools）                                          | 工具型插件没声明 `inject: ['tools']`                                                          | `export const inject = ['tools']`                                                                                                                                             |
| 工具注册了但 agent 从不调用                                                | `description` 写得不够好                                                                      | description 是 agent 决策依据，写清用途与参数                                                                                                                                 |
| Release workflow 在 `Verify the git tag matches package.json version` 失败 | 校验比较格式不一致（历史 bug：`expected` 带 `v` 前缀而 tag 解析的 `VERSION` 不带）            | 校验必须比较**裸版本**：`expected="$(node -p ...)"`（不带 v），与 tag `@v` 后部分一致；改后删 tag 重推（`git tag -d <tag> && git push origin :refs/tags/<tag>`）              |
| schema 类型推断/校验失败                                                   | `required` 数组、`required: false`、缺 `additionalProperties`                                 | 属性级 `required: true`；对象 schema 显式 `additionalProperties: false`（官方 tools.zh.md）                                                                                   |
| 页面没效果                                                                 | 只改了 server 端没重启；或没硬刷新                                                            | server 改动重启 `dsh web`；client 改动 Cmd/Ctrl+Shift+R                                                                                                                       |
| `duplicate loader entry id`                                                | profile 里手动 insert + bundle patch 自动插入重复                                             | 删掉手动行，只用 `dsh plugin` 安装                                                                                                                                            |
| `ctx.sidebarRightTabs` undefined                                           | 没声明 inject，或服务未加载                                                                   | `inject: ['slots', 'sidebarRightTabs']`；可选场景用 `ctx.get` 判空降级                                                                                                        |
| 双 Cordis / 类型分裂                                                       | 同时引用 unscoped 与 scoped cordis                                                            | 全链统一一个 cordis（本仓库用 `cordis` peer + link 安装）                                                                                                                     |
| HMR 后状态错乱                                                             | disposer 没被 fiber 持有                                                                      | `ctx.effect(() => register(...))`，绝不裸调                                                                                                                                   |
| 页签偶发"纯文字无样式"                                                     | 样式注入放在服务判空早退（`if (service === undefined) return`）之后，HMR/服务重载瞬间跳过注入 | **样式注入必须放 `apply` 最前、无条件执行**（不依赖任何服务），每个 fiber 持自己的 `<style>`、disposer 只删自己的（详见 [踩坑：插件页签样式丢失](../../docs/踩坑/README.md)） |

## 运行时故障排查（plugin-runtime-debug 增量）

> 插件在浏览器运行时行为异常（粘贴/附件/合成器"第一次成功后续失败"、chips/面板陈旧占位、版本芯片报错）时，**先读宿主源码契约，不要按 API 名字猜**——对方 skill 的排查方法补充到本仓库调试场景：

1. **读宿主源码契约**（npm 全局安装的 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/`）：打开插件调用的宿主 API 实现，读 doc 注释、guards、比较的类型。三个问题覆盖多数事故：
   - **offset 数的是哪个字符串**？发布快照字段与内部编辑器投影不一定是同一个字符串，喂错表示会静默失败（返回 false/no-op，不抛错）。
   - **每个"单位"在各表示中占多宽**？chips/tokens/attachments 等不透明内联单位在发布字段与 verb guard 的投影中宽度不同时，offset 只在无单位时正确。
   - **verb 拒绝时谁发现**？布尔返回的 verb 静默失败会变成下游状态 bug（调用方照删自己的簿记，UI 渲染"缺失"占位符）——审计每个调用点的"fire, ignore result, clean up anyway"形态。
2. **症状族定位**：首次成功后续失败 → 前次调用写入了状态改变了映射（修正推导后应用到**每个**传 offset 的调用点）；删除按钮留行 + 占位标签 → verb 拒绝但簿记已删（确认返回值后再退役簿记）；陈旧/幻影条目 → 从权威源派生视图，缓存只当加速器；版本芯片报错 latest → CDN 缓存滞后，用运行版本判定"当前 vs 更新"；整个 slot 静默消失 → slot 组件内 throw 被错误边界卸载（console-only），用防御性读取（`x?.items ?? []`）加固。
3. **修复纪律**：先精确陈述不匹配（哪个表示/哪个 guard/哪些调用点）再写修复；修**所有**传表示相关值的调用点，不只报错那个；用失败交互序列复现证明（连续两次操作行为一致 + 删除路径清空所有视图）。

## 需要避免的坑

> ⚠️ **开发前先读 [references/dsh-plugin-pitfalls.md](references/dsh-plugin-pitfalls.md)** — 14+ 个社区项目的实战踩坑清单（版本兼容 / 激活生命周期 / bundle 名册 / 构建 TS / 类型合并 / 运行时数据 / 安全进程 / UI 载体选型）。

- **不要**在 `apply` 里裸调 `registerTab`（不包 effect）——HMR/禁用后残留，下次激活报 already registered。
- **不要**在 client value-import 宿主 `@deepseek-ai/dsh-client-ui-*` 包——构建纯度门会挡；宿主能力只经 `inject` 服务名取，数据用 fetch 自己请求。
- **不要**在 README/文档里写 "Host 半"——本项目统一叫 **Server 端 / Client 端**。
- **不要**把 `.dsh-vision-toolkit/`、`node_modules/` 等提交进 git。
- 发版前核对：`package.json` 版本号、CHANGELOG 段落、tag 三者一致（workflow 会强校验版本，tag 格式错则直接失败）。
