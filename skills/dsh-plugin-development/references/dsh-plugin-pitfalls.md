# dsh 插件开发踩坑清单（社区实战蒸馏）

> 来源：调研 dsh-web-ui、better-sidebar、dsh-agent-teams、dsh-plugin-hub、dsh-skill-viewer、dsh-ios、dsh-visualize、dsh-TUI、working-activity 等 14+ 项目的 README / 开发文档 / 已知限制，均为实战遇到并修复过的问题。按类别组织，开发前过一遍。

## A. 版本兼容（最常踩）

| 坑                                              | 现象                                                                                                                                  | 解决                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`webServer` / `httpServer` 键名变动**         | npm `latest`（rc.1）服务键是 `ctx.httpServer`，`next`（rc.2）重命名为 `ctx.webServer`                                                 | 过渡期双键回退：`ctx.get('webServer') ?? ctx.get('httpServer')`（新键优先、旧键回退）；`internal/service` 事件同时监听两组键再补注册                                   |
| **`workspace` → `workspaceRegistry` 重命名**    | 同上一并发生                                                                                                                          | 同上双键回退                                                                                                                                                           |
| **settings slot 形状变化**                      | DSH 0.1.0-rc.6 起 loader entry 应用阶段直接拒绝 keyed slot `settings.plugin.item` 缺 `key` 的注册 → "Failed to load plugins" 启动失败 | 卡片 keyed slot 必须传 `key`（= 命名空间）而非 `id`；整页式需求另走一级分区 slot `settings.section`                                                                                       |
| **DSH 破坏面清单**                              | 大版本升级后静默不兼容                                                                                                                | plugin-hub 归纳破坏点：patch 语义、`webServer.register` 形状、loader entry 形状、`dsh.client` bundle 格式、`settings.plugins.tab` slot；升级后显示兼容警告而非静默失败 |
| **pnpm 安装 `@deepseek-ai/dsh-type-meta` 失败** | 官方 SDK 声明了未发布 peer，pnpm 硬失败（npm 优雅跳过）                                                                               | `pnpm-workspace.yaml` 加 `overrides: { "@deepseek-ai/dsh-type-meta": "npm:@deepseek-ai/dsh-invariants@0.0.1-rc.1" }`                                                   |

## 二、激活/生命周期

| 坑                              | 现象                                                          | 解决                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **provider 注册晚于插件 mount** | 首次启动随机报 `no xxx provider is registered`，headless 必现 | `inject` 只等服务（service 已提供），**不等兄弟插件行的 provider 注册**（Loader 并发激活）。不在 `apply` 里校验 provider，延迟到首次真正使用（"最早可解析点 fail-loud"） |
| **host 代码变更不生效**         | 改了 host 端刷新页面没反应                                    | host 代码变更需**重启服务**；client 变更仅页面刷新；config 变更由 HMR 重组（~1s）                                                                                        |
| **重复挂载/二次注册**           | HMR/重载后 "already registered"                               | `apply = mountOnce(id, applyImpl)` 包装防重复挂载；所有注册包 `ctx.effect`                                                                                               |
| **副作用残留**                  | HMR/禁用后定时器、监听、轮询不清理                            | 轮询、fetch、timeout、事件监听全部返回 disposer / cancelled 标志                                                                                                         |

## 三、bundle 清单/浏览器名册

| 坑                          | 现象                                                                           | 解决                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **浏览器名册不收录**        | `window.__DSH_BOOT__` 没有条目，或 host 启动报 client bundle composition error | `client-modules` 读 `package.json.dsh.client`：要求 `platform: "web"`、合法 `exports["./client"]`、bundle 真实存在；畸形 fail loud |
| **manifest 修复后不生效**   | 改了 manifest/export 还是老样子                                                | 包元数据和负结论**不失效**；修改 manifest/export 后重启 host。仅 `lib/client.js` 内容变化才进 client HMR 重建链                    |
| **patch id 与 name 不一致** | 工具/插件静默未注册                                                            | `cordis.patch.yml` 的 `id` 必须等于 `export const name`；聚合包统一 id 加命名空间前缀（`web-ui-`）避免与独立包冲突                 |

## 四、构建/TS（TS 项目）

| 坑                         | 现象                                           | 解决                                                                                                                        |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **JSX 报串语法错误**       | `root.render(<Xxx/>)` 报 `TS1005 '>' expected` | TS 只在 `.tsx` 解析 JSX：含 JSX 的文件一律 `src/client/index.tsx`（输出仍是 `.js`）                                         |
| **TS5096/TS5023**          | typecheck 通过但 emit 失败                     | `rewriteRelativeImportExtensions` 是 TS 5.7 新增；`typescript@^5.9`（装完 `tsc --version` 确认，pnpm add 可能换掉链接版本） |
| **tsdown CSS ENOENT**      | 找不到 `./Xxx.module.css`                      | tsdown `sourceAssetPath` 需要 lib→src 回退：resolveId 找不到 emitted 路径时把路径中 `/lib/` 替换为 `/src/` 再查             |
| **git 安装源构建脚本被禁** | "git-hosted plugins build on install..."       | Git 来源依赖默认禁止 prepare 构建脚本；加 profile 的 `pnpm-workspace.yaml` `allowBuilds` 或改用 release tarball 安装        |

## 五、类型合并（TS 项目）

| 坑                            | 现象                                                                           | 解决                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **`declare module` 不生效**   | TS2664 / 事件 union 里没有你的类型                                             | 模块增强只对**已加载进 program** 的模块生效：合并文件顶部加 `import type {} from '<目标模块>'`（编译期擦除） |
| **会话事件类型文件零 import** | 事件类型文件引入 host 类型导致 client 打包污染                                 | event-types.ts（`SessionEventMap` 合并）**必须零 import**；definition 文件可以带 type-only import            |
| **闭包内窄化失效**            | `if (event.type==='x') { arr.map(() => event.data.field) }` 报 Property 不存在 | 守卫后先 `const field = ...` 提取局部变量，闭包内用局部变量                                                  |
| **双 cordis 类型分裂**        | 宿主 client 服务（如 `ctx.sidebarRightTabs`）不在 Context 类型上               | 在 `src/client/globals.d.ts` 内联声明最小契约（本仓库做法），或 type-only import 宿主类型包触发 `declare module 'cordis'` 合并 |

## 六、运行时/数据（UI 类高频）

| 坑                       | 现象                                              | 解决                                                                                                                                    |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **轮询竞态乱序**         | 1s setInterval + fetch 重叠，旧响应覆盖新状态     | in-flight 标志或序号，只应用最新                                                                                                        |
| **响应形状校验不足**     | `body.teams ?? []` 不够，200 但形状异常时 UI 闪烁 | `Array.isArray(body.teams)` 显式校验                                                                                                    |
| **读-改-写并发**         | 同一 JSON 状态文件并发写丢数据                    | promise 链互斥串行化（key 含 workspace 防跨域同名串行）                                                                                 |
| **事件重放 vs 磁盘真相** | 事件漏了/顺序乱，面板数据错                       | 面板类 UI 以**磁盘为真相源**（host 快照），事件只用于对话流节点与审计                                                                   |
| **会话日志无法 resume**  | 追加自定义会话事件后会话无法恢复                  | 某些事件类型会导致日志无法 resume——publish 默认关闭，仅对支持 ignorable append 的宿主开启（working-activity 的 `activity/status` 教训） |
| **历史数据复合身份**     | 可重复业务 id 作为 key 冲突                       | `${ownerSessionId}:${businessId}` 复合 key，restore/dedup 同匹配 owner                                                                  |

## 七、安全/进程/端口

| 坑                    | 现象                               | 解决                                                                                                                     |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **UI 渲染不可信内容** | 模型生成的 HTML 注入宿主           | **sandboxed iframe**（不透明来源）+ CSP 禁网络/嵌套/表单，只允许固定 CDN 静态资源；fragment 限 1MB（dsh-visualize 模式） |
| **子进程孤儿残留**    | host 被杀，helper 子进程存活占端口 | 孤儿收养（handshake 权威）+ stale 回收（`serve-sim -k` 再拉起一次）；专用端口段避免冲突                                  |
| **空闲泄漏**          | 流/进程一直挂着                    | keep-alive：崩溃自动重启（~5s）；无消费者自动停（5min）；高代价重启的进程豁免空闲回收                                    |
| **任意路径操作**      | 浏览器请求任意主机目录             | workspace 门：路径必须解析为已注册 workspace 根（`realpath` + `workspaceRegistry.list()` 比对），否则 403                |
| **非本机来源**        | 路由暴露给外部                     | loopback 信任围栏（`fence`）+ `sec-fetch-site: cross-site` 拒绝                                                          |

## 八、UI 注册载体清单（选型）

| 载体                             | 适用                        | 机制                                                                            |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| 官方 Slot（设置卡片等）          | 设置页卡片/开关             | Host 半 `ctx.settings.installSection(...)` + 浏览器半 keyed slot `settings.plugin.item`（key = 命名空间）或一级分区 slot `settings.section`（完整设置区） |
| 会话槽位 SlotMap                 | 嵌入会话 UI（输入框芯片等） | `declare module '@deepseek-ai/dsh-client-ui-slots'` 扩展 SlotMap + inject slots |
| 对话流卡片                       | 会话内展示工具结果/流程     | 会话事件 → 对话流节点（client 渲染）                                            |
| slash command                    | 命令弹窗                    | `/context` 式注册命令                                                           |
| 全局悬浮                         | 无会话维度 UI（宠物等）     | `createRoot(document.body)` 独立 React root                                     |
| 宿主原生侧边栏                   | 侧边栏 tab/viewer           | `inject: ['slots', 'sidebarRightTabs']`：`ctx.sidebarRightTabs.register` + keyed 席位 `sidebar.right.pane.tab` |

## 九、其他备忘

- **磁盘为真相源**：事件可能绕过工具仪式直接写文件（模型直写），host 快照为准。
- **删除即归档**：复盘/历史数据删除时归档 + live scan 排除 + `?archived=1` 查询。
- **插件 toggle**：`- id: xxx / disabled: true` 两行 YAML，HMR 重组 ~1s（host 代码除外）。
- **render-phase 不写 ref**：window 监听器读最新值用 ref，在 effect 中同步。
- **导航即收起**：点击跳转子会话时同步 `setOpen(false)`，不等自动收起宽限。
