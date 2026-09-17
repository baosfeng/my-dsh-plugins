# dsh 插件生态参考（外部资源与分发通道）

> 调研整理（2026-08）。本仓库插件开发遇到生态问题时参考。

## 官方资源

| 资源                        | 地址                                                                                                          | 说明                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 官方插件开发 skill          | https://github.com/dsh-io/dsh-plugin-skill                                                                    | 权威 `defineTool` API、schema 规则、项目布局与工作流；适配 Claude Code / Codex / Cursor / Gemini CLI / opencode       |
| 脚手架 CLI                  | `npx @dsh-io/dsh-dev scaffold <name>`                                                                         | 生成官方工具型插件布局                                                                                                |
| 核心包                      | `@deepseek-ai/cordis`（容器）、`@deepseek-ai/dsh-tools`（defineTool）、`@deepseek-ai/dsh-llm`（ContentBlock） | 官方 TS 骨架用；本仓库纯 JS 插件用 `cordis` peer + link 安装                                                          |

## 插件市场与收录

| 市场          | 地址                                                                                             | 收录机制                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| dshfind       | https://dshfind.com（[仓库](https://github.com/hikariming/dshfind)）                             | 自动聚合 GitHub topic `dsh-plugin` 的仓库，每天 02:17 UTC 同步；加 topic 后约一天内出现                                                             |
| DSH 1024Store | https://deepseek1024.com（[仓库](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)） | 收录 4100+ 插件；定时增量扫描 `dsh-plugin` topic；收录前静态校验（`package.json`、`dsh.bundle.patch` 字段、patch 文件在 tree 中存在）；免费查询 API |

**分发通道：**

1. **npm publish**（官方推荐）——`dsh plugin add <包名>@latest` 可直接安装
2. **GitHub topic `dsh-plugin`**——给公开仓库加 topic 即被市场自动收录（dshfind / 1024store 都以此聚合）
3. **GitHub Release tarball**——本仓库的约定（tag `<包名>@v<版本>` 触发 release.yml 打包），用户从 Release 下载 tarball 安装

> 1024Store 的静态校验（只读 Git tree，不装依赖不执行代码）是本仓库发布质量的自检参考：`package.json` + `dsh.bundle.patch` + patch 文件三者必须齐备且在 tree 中。

## 生态中的常见插件形态

| 形态                          | 关键 API                                                         | 例子                                       |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| 工具型（agent 可调用函数）    | `ctx.tools.register(defineTool(...))`                            | 天气、记忆、搜索等纯工具                   |
| 页面型（宿主原生侧边栏）      | client 端 `ctx.sidebarRightTabs.register` + keyed 席位 `sidebar.right.pane.tab` | 本仓库 dsh-file-activity                   |
| 混合型                        | 工具 + 页面 + server 事件/路由                                   | 常见于需要 UI 的完整插件                   |
| 市场嵌入型                    | 把插件市场装进 dsh 本体                                          | dsh1024（`dsh plugin add dsh1024@latest`） |

## 常见生态差异提醒

- **双 cordis 实例**：外部插件在 DSH monorepo 之外解析，拿不到官方 cordis 的类型 augmentation——TS 项目用 type-only import 宿主类型包触发 `declare module 'cordis'` 类型合并（编译期擦除，无运行时依赖），或按本仓库做法内联声明最小契约（`src/client/globals.d.ts`）。
- **侧边栏服务只在 client 端**：`ctx.sidebarRightTabs` / `ctx.slots` / `ctx.sidebarRight` 只在浏览器侧；server 半要数据走本插件自己的 HTTP 路由（`/<插件名>/api/*`）。
- **`@deepseek-ai/cordis` vs `cordis`**：官方工具型骨架依赖 `@deepseek-ai/cordis`；本仓库插件用 `cordis` peer + link 安装（全链统一一个 cordis，避免双实例/类型分裂）。
