# 侧边栏原生 API 迁移指南（issue #187）

> **何时阅读**：把插件的侧边栏能力从第三方 `dsh-better-sidebar` 迁到宿主原生扩展点时；或要新增页签 / 文件预览器 / 浮层 / 设置页时。
> 姊妹文档：[宿主原生侧边栏扩展点 API 参考](../../skills/dsh-plugin-development/references/better-sidebar-api.md)（服务与方法签名）、[扩展开发](../开发指南/扩展开发.md)（扩展点总表）。
>
> **状态**：批 1（6 个轻量插件）与批 2（`dsh-file-activity`）均已落地；全仓 `npm ls dsh-better-sidebar` 无输出。
> 证据分两类：**[源码]** = 宿主 0.1.5-rc.1 包源码/类型的 `文件:行`；**[实测]** = 本机隔离实例（独立 `DSH_HOME` + 真实 Chrome via CDP）探针插件的运行结果。

## 0. 现状（迁移前）

`dsh-file-activity` client 侧消费 `ctx.betterSidebar`（`src/client/globals.d.ts:56-62`）：

| better-sidebar 能力                                                          | 用处                                | 使用点                                         |
| ---------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `registerTab({id,title,icon,order,single,settings.pluginToggles,component})` | 挂「文件活动」页签 + 页签内设置开关 | `src/client/parts/apply.ts:36-63`              |
| `matchFileViewer(path)` + `fetchStrategy`（fsRead/mediaUrl/custom）          | 浮窗预览取字节并复用内置 viewer     | `src/client/parts/preview.ts:156-190, 132-150` |
| `openTab({type,title,path})`                                                 | 每会话首次自动打开页签              | `src/client/parts/auto-open.ts:59`             |
| `getSnapshot()/subscribeState()`                                             | 读布局/设置、读当前 sessionId       | `src/client/parts/auto-open.ts:14-26, 66-75`   |
| 浮窗（自己实现，非服务能力）                                                 | 点文件弹浮窗预览                    | `src/client/parts/preview.ts:286-344`          |

## 1. 四个能力点的原生对应物（含证据）

### 1.1 页签注册 → `sidebarRightTabs.register` + keyed slot 两步式

- **[源码]** `dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts:88-153`：`SidebarRightTabDefinition` = `{ id, kind, patterns?, priority?, canOpen?, title(address), guide? }`；`register()` 返回 **幂等 disposer**，调用方放进自己的 `ctx.effect`；**id 重复或 kind 冲突会 throw**；`extension` 档可接管 `builtin`。
- **[源码]** `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts:28-66`：正文席位 `sidebar.right.pane.tab`（keyed，key = definition.`id`），标题席位 `sidebar.right.pane.tab.title`（同 key）；`inject.hooks.tabInfo` 给到 `SidebarRightTabInfo`（`tab.visible` / `tab.actions.openResource/openTab/close` / `tab.signal`）。
- **[源码]** 官方生产范本：`dsh-client-ui-sidebar-files/lib/client.js:682-714`（`inject = ['slots','locale','sidebarRightTabs','remote','remote.workspaceFiles']` → 两次 `ctx.effect` 注册 tab 类型与两个席位）。
- **[实测]** 探针 `registerTab`/`registerPaneTab`/`registerPaneTabTitle` 三步全部 `ok`（无 throw），`ctx.slots.inject` 与 `ctx.slots.register` 均为 function，`ctx.sidebarRightTabs` 为 object。
- **icon 无原生对应**：`SidebarRightGuideEntry.icon`（`tab-registry.d.ts:50`）只作用于 **guide 页的入口胶囊**，页签 chip 没有 icon API → **保留标题、去掉时钟图标**（或把图标画进 `.title` 席位的组件里，但 chip 高度受限，默认不做）。
- **数字 order 无原生对应**：页签顺序 = `priority` 档 → 匹配模式长度 → 注册顺序（`tab-registry.d.ts:12-18`）；文件的 `order: 15` 失去意义，本插件用默认档 `extension`（不声明 `priority`），与文件树等内置页签并存。

### 1.2 文件预览器 → `documentPreviews`（元数据）+ document owner 读字节

- **[源码]** `dsh-client-ui-sidebar-documentpreview/lib/types/client/document/registry.d.ts:1-52`：`register({ id, extensions, priority?, title(), loading })`，`loading: 'text-pages' | 'bytes-complete'`；`candidates(path)` 排序 = `extension` 档优先 → 最长后缀 → 注册顺序；`getSnapshot()/subscribe()` 可观测。
- **[源码]** 字节来源职责**相反**：`face.d.ts:1-22`（“The preview's asynchronous half: reading pages into the store”）——原生由 **document owner**（`dsh-client-ui-sidebar-documentpreview` 的 `textFace`，绑定 `remote.workspaceFiles.read` / `readAll`）读字节，再通过 `sidebar.right.tab.document` 席位把 `DocumentContent` 交给渲染器（`document/contract.d.ts:9-37`：`{kind:'text', text, pages, eof} | {kind:'bytes', data}`）。渲染器**不 fetch**。
- **[源码]** 地址契约：资源 tab 地址形如 `dsh-resource://file/session/<sessionId>/<path>`（`definition.d.ts:1-11` 声明 fallback 档 `text` 类型接管该前缀）。
- **[实测]** `ctx.documentPreviews.register({id, extensions:['probe'], priority:'extension', loading:'text-pages', title})` **不抛错**；`candidates('a.probe')` 返回 `['dsh-probe-native-sidebar']`（注册生效、排序可查询）。
- **结论**：file-activity **不再自己取字节、不再自己选 viewer**。它只注册**元数据**，渲染由宿主的 document owner + 原生 viewer 完成（`.jsonl/.log/.probe` 之外的常见文本/图片/PDF 宿主已覆盖，本插件的补充注册用于声明“这些后缀也能开”）。

### 1.3 浮窗 → `shell.overlay` slot（自实现，官方推荐落点）

- **[源码]** `dsh-client-ui-layout/lib/types/client/index.d.ts:74-84`：`'shell.overlay': { kind: 'list'; scope: 'root' }`；文档：“Frame-wide floating layer, above every column and outside their scroll containers… The layer itself is click-through — entries opt back into pointer events”。
- **[源码]** 注册选项（宿主 client runner 的 slot 文档表，`dsh-cordis-client-runner/lib/client.js:3944-3993`）：`{ name:'shell.overlay', id:'<自有 id>', order?:number, label?:string|()=>string }`，示例明确“a fresh `id` is added beside the shipped entries”（**不会**替换宿主 UI，`replaceRisk: none`）。
- **[实测]** `ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay', id:'dsh-probe-native-sidebar', order:100, label:'PROBE OVERLAY'}, Component))` **渲染成功**：DOM 中 `[data-probe-overlay]` 命中 1 个，`rect = [0,0,756,18]`（页面顶部），文本 `PROBE OVERLAY`。
- **生命周期设计**：overlay 组件常驻（root scope，跟插件 fiber 同生命周期），显示与否由插件 store 的 `preview` 字段决定；`preview === null` 时组件返回 `null` —— 与现有 `dataStore.set({preview})` 逻辑一致，浮窗的关闭动画/自动关闭（`AUTO_CLOSE_MS`）保持不变。
- **不选原生 `ctx.sidebarRight.float(tabId)` 的理由**：`service.d.ts:152-160` 的 `float()` 只对**已存在**的 tab 生效（“one that is missing or already floating is left alone”），而点击文件时需要**新建**一个内容 tab；且本插件的预览对象是“任意记录过的路径”，不总是宿主的 `file` 资源地址（`/tmp` 等 workspace 之外的路径会被 `file` provider 拒绝，见 4.2）。

### 1.4 自动打开 → `ctx.sidebarRight.openTab(kind)` + 会话挂载态

- **[源码]** `service.d.ts:105-126`：`openTab<K>(kind, options?)` 打开**页面类型**（by kind，无地址）；`openResource(address, options?)` 打开资源（by `dsh-resource://` 地址）；`isExpanded()` / `active()` / `toggleExpanded()` 可读列状态；文档明确“An address outside `dsh-resource://`, or one no type will open, is a wiring mistake… so it throws”。
- **[源码]** 页面类型的判定：`SidebarRightTabDefinition.patterns` 省略 = page type（`tab-registry.d.ts:78-86`）。
- **[实测]** `ctx.sidebarRight.openTab` / `openResource` / `isExpanded` / `active` 均为 function；**但在“会话表面未挂载”时调用 `openTab` 会 throw**：`sidebarRight: no session surface is mounted`（探针实测，第一次加载页面后立即调用）。
- **设计**：自动打开改为 `ctx.effect` 内触发一次 + 监听会话挂载（宿主 `slots` 的 session 变化）后重试；**失败必须可见**（见 5）。`getSnapshot().prefs.pluginSettings[tab].autoOpen` 改读本插件自己的设置（1.5），`subscribeState` 布局监听不再需要。

### 1.5 `settings.pluginToggles` → 自写 `settings.plugins.tab` UI

- **[源码]** `dsh-client-ui-settings-plugins/lib/types/client/PluginsSettingsSection.d.ts:18`：`settings.plugins.tab` 是 `settings.section` 的渲染席位（`PropsRenderSlots<'settings.plugins.tab'>`）；`index.d.ts:5-6` 说明该 section 声明 tab 席位、`settings.plugin.item` 是「可配置插件卡」的 keyed 席位。
- **[源码]** 先例：`dsh-my-memory/src/client/parts/apply.ts`（零第三方依赖，`ctx.get('slots')` 动态取服务）。
- **[实测]** `ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({name:'settings.plugins.tab', id:'dsh-probe-native-sidebar', order:100, label:'PROBE'}, Component))` **不抛错**（注册成功；未在浏览器里逐项点击核对 UI 位置——阶段 C 用真实插件复核）。
- **设计**：开关的**权威存储**从“宿主的插件设置”改为本插件自己的配置表（server 端已有 `/file-activity/api/*` 路由与持久化，见 `src/api-route.ts`、`src/persist.ts`）；UI 用官方 `@deepseek-ai/dsh-client-ui-primitives`（实测 0.1.5-rc.1 导出 **123 项**，见第 7 条）。

## 2. 字节来源职责相反：具体改造

| 关注点              | 迁移前（better-sidebar）                                                                            | 迁移后（原生）                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 谁决定用哪个 viewer | 插件 `matchFileViewer(path)` 轮询注册表                                                             | 宿主 `documentPreviews.candidates(path)` 排序（extension → 最长后缀 → 注册顺序）                                                                         |
| 谁读字节            | 插件按 `fetchStrategy` 自己 fetch（`/sidebar/api/fs.read`、`/sidebar/file`、`/file-activity/file`） | **document owner**（`textFace` → `remote.workspaceFiles.read` / `readAll`），按 `loading` 模式分页或整读                                                 |
| 渲染器拿到什么      | `{content, mediaUrl, customData}` props                                                             | `sidebar.right.tab.document` 席位的 `{resourceAddress, content, wrap}`（`contract.d.ts`）                                                                |
| 失败/大文件/二进制  | 插件自己翻译 ENOENT / outside workspace（`preview.ts:53-61`）                                       | 宿主 owner 的 `failure-line`（`dsh-client-ui-sidebar-documentpreview/lib/types/client/failure-line.d.ts`）；二进制走 `bytes-complete` → image/pdf viewer |

**改造点**：

1. 新增 `src/client/parts/document-previews.ts`：`ctx.documentPreviews.register({ id: PKG, extensions: [...], priority: 'extension', title, loading: 'text-pages' })`（纯元数据，无字节职责）。
2. **浮窗预览保留**（`shell.overlay`），继续用现有 `/file-activity/file` 媒体路由与 `/file-activity/text` 文本路由取字节 —— 因为插件记录的路径**可以落在 workspace 之外**（agent 读过的 `/tmp`、`~/.dsh` 下的文件），宿主 `file` provider 的工作区围栏会拒绝（**实测待补**：阶段 C 用 `openResource` 打开一个 workspace 外路径，记录其失败表现）。
3. 降级链：`documentPreviews` 缺失 → 跳过注册（浮窗仍可用）；浮窗取字节失败 → 现有错误面板 + `AUTO_CLOSE_MS` 自动关闭（保持现状）。

## 3. 根配置与文档同步（批 2 收尾负责）

| 文件                                                                                                                                | 现状（实测）                                                   | 动作                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根 `package.json`                                                                                                                   | `dependencies["dsh-better-sidebar"]=">=0.14.0"`                | 删除该行                                                                                                                                            |
| `knip.json`                                                                                                                         | `ignoreDependencies` 含 `"dsh-better-sidebar"`                 | 删除该条                                                                                                                                            |
| `package-lock.json`                                                                                                                 | 3 处 `dsh-better-sidebar`                                      | 重装/更新锁文件后确认为 0                                                                                                                           |
| 验证                                                                                                                                | `npm ls dsh-better-sidebar` 现输出 `dsh-better-sidebar@0.18.0` | 清理后必须**无输出**                                                                                                                                |
| `docs/开发指南/官方UI组件库.md:13`                                                                                                  | 「共 104 项」                                                  | 复验 0.1.5-rc.1 = **123 项**（[实测] 探针 `require('@deepseek-ai/dsh-client-ui-primitives')` → `Object.keys().length === 123`），更新清单与版本说明 |
| `skills/dsh-plugin-development/references/better-sidebar-api.md`                                                                    | better-sidebar API 参考                                        | 替换为原生 API 参考（或标注废弃）                                                                                                                   |
| `docs/开发指南/扩展开发.md`、`docs/开发指南/TS升级规范.md`、`docs/踩坑/DSH插件依赖级联安装机制.md`、`docs/踩坑/插件页签样式丢失.md` | 描述 better-sidebar                                            | 同步为原生扩展点                                                                                                                                    |

**编译期依赖**：移除 better-sidebar 后，`node_modules/@deepseek-ai/dsh-client-ui-primitives|slots`（0.1.2-rc.1，由 better-sidebar 的 peerDependencies 带进来）会消失；file-activity 的 client 源码**不 require** 这些包（只用 Cordis 服务名），故不受影响；若后续要用官方组件库，那是 **staticModules 运行时提供**（`docs/开发指南/官方UI组件库.md:8`），无需 npm 依赖。

## 4. e2e DOM 断言的正确契约（实测）

**[实测] 原生停靠体系在 DOM 上真实使用的属性**（隔离实例，右侧边栏已展开）：

```
data-dockkit-surface=1  data-dockkit-drop-zones=horizontal  data-dockkit-pane=pane1
data-dockkit-pane-active=true  data-dockkit-strip=pane1  data-dockkit-strip-tabs=pane1
data-dockkit-strip-fill  data-dockkit-strip-chrome  data-dockkit-split-button  data-dockkit-add-tab
```

- **页签**：`[data-dockkit-tab="<id>"]`（点击「新标签页」后出现，`role="tab"`、`aria-selected`、`data-dockkit-tab-quiet`、`data-dockkit-tab-active` 可选）；
- **标题节点被宿主占用**：`[data-dockkit-tab-title]` 由宿主自己渲染（始终存在），**不能**当作“我的页签出现了”的判据 —— 应断言 `[data-dockkit-tab]` 的文本内容或 `[data-dockkit-tab="<plugin id>"]`；
- **正文**：`[data-dockkit-pane]` 内可见插件自己的 DOM 标记（file-activity 保留 `.dfa` 类 + 可加 `data-dfa-*` 锚点）；
- **浮窗**：保留 `.dfa-fp`（overlay 层内），并可断言 `shell.overlay` 的存在；
- **反例**：旧 e2e 探的 `[data-dsh-panel-host]` / `[data-dsh-sidebar]` 在原生停靠实例里 `panelHost=1` 但那是**左侧导航栏**的宿主标记，与右侧边栏无关（实测 `[data-dsh-sidebar]=0`）——继续用它会得到假阳性。
- **[实测] 空 pane 不自动 seed，e2e 必须先制造意图（重复强调）**：初始载入时 `[data-dockkit-tab]` 计数为 **0**（`strip-tabs` 尺寸 0×0），点击「新标签页」（`[data-dockkit-add-tab]`）后才出现 seed 页签（宿主 `stores.d.ts:14-16`：“an empty root pane seeds the default page… the seed waits for the expansion”）。
  → **任何"页签存在"的断言前必须先点击 `[data-dockkit-add-tab]`（或触发一次展开）**，否则会得到"页签丢了"的假失败。本仓库 `plugins/dsh-file-activity/test/e2e-cdp.mjs` 已按此顺序实现。
- **[实测] 页签 chip 里可以放图标**：原生 `SidebarRightTabDefinition` 没有 icon 字段，但 `sidebar.right.pane.tab.title` 席位的组件渲染在 chip 内部（实测 chip HTML 为 `[data-dockkit-tab] > [data-dockkit-tab-title] > [data-slot=sidebar.right.pane.tab.title] > 你的节点`），因此在标题席位里返回「图标 + 文本」即可保留页签图标。**注意**：`title(address)` thunk 自身返回 React 节点不可靠（那是给 chip 兜底文本用的），图标要走席位组件。
- **[实测] 空 pane 不会自动 seed**：初始载入时 `[data-dockkit-tab]` 计数为 **0**（`strip-tabs` 尺寸 0×0），点击「新标签页」后才出现 seed 页签（`stores.d.ts:14-16`：“an empty root pane seeds the default page… the seed waits for the expansion”）。→ **e2e 必须先触发一次展开/新增意图**，否则断言“页签存在”会假失败。

## 5. 降级语义（绝不允许静默失效）

本仓库刚发生过「宿主 API 变化 → 插件完全静默失效」的事故，迁移后必须满足：

| 失败场景                                                                                       | 行为                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.sidebarRightTabs` / `ctx.slots` 服务缺失（未 inject 成功）                                | `inject` 声明式依赖 → 宿主不会 mount 本插件并由**宿主本身**报「failed to apply」（实测错误长这样：`failed to apply loader entry …: cannot get property "sidebarRight" without inject`）；插件额外 `console.error` 一条带包名的可读原因 |
| `registerTab` / `documentPreviews.register` / `slots.register` **throw**（id 冲突、kind 冲突） | try/catch 包住**每一次注册**，`console.error('[dsh-file-activity] <阶段> 注册失败: ' + message)`，并把失败写进 `document.documentElement.dataset.dfaDegraded`（供 e2e / 用户排查），**不吞异常**                                       |
| 页签未出现（服务在但渲染失败）                                                                 | 页签正文渲染一个显式错误面板（"扩展点不可用" + 原因），而不是空面板                                                                                                                                                                    |
| 浮窗取字节失败                                                                                 | 保留现有错误面板 + 2.5s 自动关闭（现状不变）                                                                                                                                                                                           |
| 预览器注册成功但宿主读不到字节                                                                 | 原生 owner 的失败行（`failure-line`）会显示原因；插件不再自己翻译 ENOENT                                                                                                                                                               |

## 6. 实施步骤（TDD）

1. **RED**：新增 `test/client-native.mjs`（新契约）+ 改造 `test/client-render.mjs`（mock 从 `betterSidebar` 换成 `slots/sidebarRightTabs/documentPreviews`），断言：`inject` 列表、两步式注册调用的形状、`shell.overlay` 注册、`settings.plugins.tab` 注册、注册 throw 时的 console.error + `data-dfa-degraded` 标记。
2. **GREEN**：改 `src/client/globals.d.ts`（服务契约）+ `src/client/parts/{apply,preview,auto-open}.ts` + 新增 `document-previews.ts`；`lib/client.src.js` 模板同步（**注意**：file-activity 的 client 入口在 `src/client/parts/*.ts`，模板只提供常量与拼接位；`npm run build` 生成 `lib/client.js` 并**必须提交**）。
3. **覆盖率门禁**：行 ≥85 / 分支 ≥75（新写的浮窗、settings UI、DOM 契约测试补上）。
4. **e2e 重写**：`test/e2e-cdp.mjs` 按第 4 节契约重写（先点开意图，再断言 `data-dockkit-*`）。
5. **根配置清理** + 文档同步（第 3 节）。
6. **验证**：`npm test`、`VERIFY_CONCURRENCY=2 node scripts/verify-local.mjs --full`、隔离实例 + 真实浏览器四项实测、CI 绿。

## 6b. 实施后的实测结论（阶段 C 补齐）

| 结论                                                          | 证据                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 四个原生服务可注入且行为符合源码契约                          | 探针 `dsh-probe-native-sidebar` 实测 `slots/sidebarRightTabs/documentPreviews/sidebarRight` 全部为 object，方法齐全          |
| `sidebarRightTabs.register` 只需 `{id,kind,title}` 即可开页签 | 探针注册后 `entries()` 返回 4 个类型（guide/files/text/probe），`openTab(kind)` 成功打开并渲染正文 + 标题席位                |
| `documentPreviews.register` 元数据-only 生效                  | `candidates('x.probe')` 返回 `['dsh-probe-native-sidebar']`                                                                  |
| `shell.overlay` 渲染在整帧之上且点击穿透                      | overlay 节点 rect `[0,0,756,18]`（页面顶部），不影响下层交互                                                                 |
| 官方组件库运行时导出 **123** 项                               | 探针 `require('@deepseek-ai/dsh-client-ui-primitives')` → `Object.keys().length === 123`（0.1.2-rc.1 时代记录的 104 已过时） |
| `openTab` 在会话表面未挂载时 throw                            | `sidebarRight: no session surface is mounted`（页面加载初期），因此自动打开必须重试（本插件 1s × 30 次）                     |

### 仍未实测的项（诚实边界）

- 多会话切换下页签归属与会话隔离（本插件的页签是 session scope，理论由宿主管辖）；
- 浮窗内的会话标识（`shell.overlay` 是 root scope，拿不到 session props —— 本插件把 `sessionId` 存进预览目标解决，未做多会话并排实测）；
- 真实 HMR 重载下的注册去重（`openTab` 声称幂等，未实测）；
- `priority` 多档与"匹配模式长度"的竞争排序（本插件只用默认档）。

## 7. 需要 leader 决策的点

1. **浮窗归属**：方案选 `shell.overlay` 自实现（保留现有交互与自动关闭语义）。另一条路是用原生 `sidebarRight.float(tabId)`（真·dockkit 浮窗、可拖拽停靠），但它要求先有 tab 且只对已存在的 tab 生效 —— 与“点文件即预览任意路径”的产品语义不匹配。**默认走 overlay**。
2. **页签图标**：原生无 chip icon API，默认**去掉时钟图标**（保留标题）。若要保留，可把图标画进 `.title` 席位，但会改变高度基线。
3. **自动打开开关的存储位置**：从宿主的 `prefs.pluginSettings` 迁到插件自己的配置（server 端持久化）。用户的旧开关状态会丢失（一次性）。
