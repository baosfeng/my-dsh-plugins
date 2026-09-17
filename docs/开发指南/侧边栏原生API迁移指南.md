---
title: 宿主原生侧边栏扩展点
description: 宿主原生侧边栏扩展点（slots / sidebarRightTabs / documentPreviews / sidebarRight / settings）的精确语义、DOM 契约与降级要求
---

# 宿主原生侧边栏扩展点

> ⚠️ **何时阅读：** 新增页签 / 文件预览器 / 浮层 / 设置页时，或要确认某个侧边栏能力的原生语义、DOM 契约与降级要求时。
> 姊妹文档：[宿主原生侧边栏扩展点 API 参考](../../skills/dsh-plugin-development/references/better-sidebar-api.md)（服务与方法签名）、[扩展开发](扩展开发.md)（扩展点总表）。
>
> 本仓库已无任何插件依赖 `dsh-better-sidebar`（`npm ls dsh-better-sidebar` 无输出）；client 端一律经 **Cordis 服务名**取原生能力，**无需 require 任何 `@deepseek-ai/dsh-client-ui-*` 包**。

## 1. 四个能力点的原生对应物

### 1.1 页签注册 → `sidebarRightTabs.register` + keyed slot 两步式

- `SidebarRightTabDefinition` = `{ id, kind, patterns?, priority?, canOpen?, title(address), guide? }`；`register()` 返回**幂等 disposer**，必须放进自己的 `ctx.effect`；**id 重复或 kind 冲突会 throw**；`extension` 档可接管 `builtin`。
- 正文席位 `sidebar.right.pane.tab`（keyed，key = definition.`id`），标题席位 `sidebar.right.pane.tab.title`（同 key）；`inject.hooks.tabInfo` 给到 `tab.visible` / `tab.actions.{openResource,openTab,close}` / `tab.signal`。
- `inject` 声明 `['slots', 'sidebarRightTabs']`，两次 `ctx.effect` 分别注册 tab 类型与席位（官方生产范本 `dsh-client-ui-sidebar-files`）。
- **icon 无原生对应**：`SidebarRightGuideEntry.icon` 只作用于 guide 页的入口胶囊，页签 chip 没有 icon API。可行做法：在 `.title` 席位组件里返回「图标 + 文本」（chip HTML 为 `[data-dockkit-tab] > [data-dockkit-tab-title] > [data-slot=sidebar.right.pane.tab.title] > 你的节点`）；`title(address)` thunk 返回 React 节点不可靠（它是 chip 兜底文本）。
- **数字 order 无原生对应**：页签顺序 = `priority` 档 → 匹配模式长度 → 注册顺序。自定义数字顺序会失去意义，一般用默认档 `extension`。

### 1.2 文件预览器 → `documentPreviews`（只注册元数据）

- `register({ id, extensions, priority?, title(), loading })`，`loading: 'text-pages' | 'bytes-complete'`；`candidates(path)` 排序 = `extension` 档优先 → 最长后缀 → 注册顺序；`getSnapshot()` / `subscribe()` 可观测。
- **字节来源职责与 better-sidebar 相反**：原生由 **document owner** 读字节（绑定 workspace 读接口），再通过 `sidebar.right.tab.document` 席位把 `{kind:'text', text, pages, eof} | {kind:'bytes', data}` 交给渲染器——**渲染器不 fetch、插件不选 viewer**。
- 地址契约：资源 tab 地址形如 `dsh-resource://file/session/<sessionId>/<path>`。
- 结论：插件只注册"这些后缀也能开"，`.jsonl/.log` 之外的常见文本/图片/PDF 宿主已覆盖；失败/大文件由宿主 owner 的 failure-line 与 `bytes-complete` → image/pdf viewer 处理。
- **例外**：插件记录的路径可能落在 workspace 之外（`/tmp`、`~/.dsh` 下的文件），宿主 `file` provider 的工作区围栏会拒绝——这类预览仍由插件自实现的浮窗承担。

### 1.3 浮窗 → `shell.overlay` slot（自实现）

- `'shell.overlay': { kind: 'list'; scope: 'root' }`：整帧浮层，位于所有列之上、在各列滚动容器之外；**层本身点击穿透**，条目自行 opt-in 指针事件。
- 注册选项 `{ name:'shell.overlay', id:'<自有 id>', order?, label? }`——新增 `id` 会与宿主自带条目**并存**，不替换宿主 UI。
- **不选原生 `sidebarRight.float(tabId)` 的理由**：`float()` 只对**已存在**的 tab 生效（"missing or already floating is left alone"），而点文件时需要**新建**内容 tab；且预览对象是"任意记录过的路径"，不总是宿主的 `file` 资源地址。
- 生命周期：overlay 组件常驻（root scope，与插件 fiber 同生命周期），显示与否由插件自己的 store 决定（`preview === null` 时返回 `null`），关闭动画/自动关闭语义由插件保持。

### 1.4 自动打开 → `sidebarRight.openTab(kind)` + 会话挂载态

- `openTab<K>(kind, options?)` 打开**页面类型**（by kind，无地址）；`openResource(address, options?)` 打开资源（by `dsh-resource://` 地址，地址不合法或没有类型接手会 **throw**）；`isExpanded()` / `active()` / `toggleExpanded()` 读列状态。
- `SidebarRightTabDefinition.patterns` 省略 = page type。
- ⚠️ **会话表面未挂载时调用 `openTab` 会 throw**（`sidebarRight: no session surface is mounted`）——自动打开必须在 `ctx.effect` 内触发并监听会话挂载后重试。**失败必须可见**（见 §3），不能吞异常。

### 1.5 `settings.pluginToggles` → 自写 `settings.plugins.tab` UI

- `settings.plugins.tab` 是 `settings.section` 的渲染席位，`settings.plugin.item` 是「可配置插件卡」的 keyed 席位（先例：`dsh-my-memory` 的 client parts，零第三方依赖、`ctx.get('slots')` 动态取服务）。
- 开关的**权威存储**是插件自己的配置表（server 端路由 + 持久化），不依赖宿主 `prefs.pluginSettings`。
- UI 用官方组件库（可用性以本机运行包为准，见 [官方 UI 组件库](官方UI组件库.md)）。

## 2. e2e DOM 断言的正确契约

原生停靠体系真实使用的属性：`data-dockkit-surface` / `-drop-zones` / `-pane` / `-pane-active` / `-strip` / `-strip-tabs` / `-strip-fill` / `-strip-chrome` / `-split-button` / `-add-tab`。

- **页签**：断言 `[data-dockkit-tab="<plugin id>"]`（或该节点的文本）；`role="tab"` / `aria-selected` / `data-dockkit-tab-quiet` / `-active` 可选。
- **不要**用 `[data-dockkit-tab-title]` 当"我的页签出现了"的判据——它由宿主自己渲染、始终存在。
- **正文**：`[data-dockkit-pane]` 内找插件自己的 DOM 标记（插件保留自有类名 + `data-<插件>-*` 锚点）。
- **空 pane 不自动 seed**：初始载入时 `[data-dockkit-tab]` 计数为 0（宿主在展开后才 seed 默认页）——任何"页签存在"的断言前必须先点击 `[data-dockkit-add-tab]` 或触发一次展开，否则会得到"页签丢了"的假失败。
- **反例**：`[data-dsh-panel-host]` 是**左侧导航栏**的宿主标记，与右侧边栏无关；旧 e2e 探它（或 `[data-dsh-sidebar]`）会得到假阳性。

## 3. 降级语义（绝不允许静默失效）

| 失败场景                                                                                   | 要求的行为                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务缺失（未 inject 成功）                                                                 | `inject` 声明式依赖会让宿主拒绝 mount 并报 `failed to apply ... without inject`；插件额外 `console.error` 一条带包名的可读原因                                                           |
| `registerTab` / `documentPreviews.register` / `slots.register` **throw**（id / kind 冲突） | try/catch 包住**每一次注册**，`console.error('[<包名>] <阶段> 注册失败: ' + message)`，并把失败写进 `document.documentElement.dataset.<插件>Degraded`（供 e2e 与用户排查），**不吞异常** |
| 页签未出现（服务在但渲染失败）                                                             | 页签正文渲染显式错误面板（"扩展点不可用" + 原因），而不是空面板                                                                                                                          |
| 浮窗取字节失败                                                                             | 保留错误面板 + 自动关闭（现状语义不变）                                                                                                                                                  |
| 预览器注册成功但宿主读不到字节                                                             | 宿主 owner 的 failure-line 显示原因，插件不再自己翻译 ENOENT                                                                                                                             |

## 4. 上线前验证

1. 单测覆盖新契约（`inject` 列表、两步式注册调用形状、`shell.overlay` 与 `settings.plugins.tab` 注册、注册 throw 时的 console.error + degraded 标记）。
2. 覆盖率门禁：行 ≥85 / 分支 ≥75 / 函数 ≥80（阈值口径唯一出处见 [构建与测试](构建与测试.md)）。
3. e2e 按 §2 契约重写（先制造展开意图，再断言 `data-dockkit-*`），并做隔离实例 + 真实浏览器实测。
4. `npm test` + `npm run verify` 全绿。
