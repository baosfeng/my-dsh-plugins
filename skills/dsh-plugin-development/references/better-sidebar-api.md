# 宿主原生侧边栏扩展点 API 参考（@deepseek-ai/dsh 0.1.5-rc.1+）

> 权威来源（宿主安装目录）：
>
> - `dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts`（`register` / `entries` / `guide` / `claim`）
> - `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts`（两个 keyed 席位与运行面）
> - `dsh-client-ui-sidebar-files/lib/client.js:681-711`（官方生产范本，照抄写法）
> - `dsh-client-ui-sidebar-documentpreview/lib/types/client/document/registry.d.ts`（文件预览器，见文末）

**核心结论：原生能力通过 Cordis 服务名 `inject` 获取，不需要 require 任何 `@deepseek-ai/dsh-client-ui-*` 包**（证据：宿主 41 个官方 client-ui 包没有一个 require `sidebar-right`）。

## 服务与获取方式

| 服务名             | 提供方                                  | 用途                                                    |
| ------------------ | --------------------------------------- | ------------------------------------------------------- |
| `sidebarRightTabs` | `dsh-client-ui-sidebar-right`           | 页签**类型**注册表（页面/资源类型、guide 胶囊、优先级） |
| `slots`            | `dsh-client-ui-renderer`                | keyed 席位注册（面板本体与标题）                        |
| `documentPreviews` | `dsh-client-ui-sidebar-documentpreview` | 文件预览器注册表（批 2 迁移用）                         |

```js
exports.inject = ['slots', 'sidebarRightTabs'] // 声明式依赖：宿主保证服务可用后才激活

exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register(definition), '<pkg>: tab')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body),
      ),
    '<pkg>: tab body',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, Title),
      ),
    '<pkg>: tab title',
  )
}
```

> **首屏时序**：`inject` 声明式注入消除了「提供者 fiber 未 active → strict 取法返回 undefined → 静默不注册」的旧坑（曾用 `ctx.get(name, false)` 绕行）。防御式判空时**必须同时覆盖 `null` 与 `undefined`**（`tabs == null`）——`typeof null === 'object'` 会骗过 `=== undefined`。

## register(definition) —— 页签类型（stage 1）

```ts
{
  id: string                       // 必填，全局唯一（官方惯例 = 包名）；同时是席位的 key
  kind: string                     // 类型判别符；openTab 按它打开
  patterns?: readonly string[]     // 资源地址 glob；**省略 = 页面类型**（按 kind 打开）
  priority?: 'extension' | 'builtin' | 'fallback'   // 默认 extension（外部产品最高档）
  canOpen?: (address: string) => boolean            // 对已匹配地址的否决
  title: (address: string) => string                // 页签胶囊初始文本（打开时捕获）
  guide?: readonly { order: number; title: () => string; description?: () => string }[]
}
```

- **排序规则**：`priority` 档 → 匹配模式长度 → 注册顺序（`patterns` 省略时按注册顺序）。**没有数字 order 字段**；数字顺序请用 `guide[].order`（guide 页胶囊按它升序排列）。
- **id 唯一且会 throw**：重复 id 或同档同 kind 冲突 → 注册抛错（官方原文："a second registration in the same band … is a wiring mistake, and so is an `id` already in use"）。
- **一个 kind 可同时有 builtin 与 extension**：extension 生效，builtin 让位；extension 注销后 builtin 恢复。
- **多面板插件**：一个 kind 一个 `id`，不同面板请用**不同 id**（id 是席位的 key，同 key 重复注册席位会冲突）。
- 资源类型用 `patterns`（`dsh-resource://file/**`；含 `:` 的 glob 匹配整条地址，否则匹配 URI path 任意深度）。
- `guide` 省略 = 不出现在 guide 页（用户只能通过 API/地址打开）。

## keyed 席位（stage 2）——面板本体与标题

| 席位                           | key       | 组件收到的 props                                            |
| ------------------------------ | --------- | ----------------------------------------------------------- |
| `sidebar.right.pane.tab`       | 类型 `id` | `sessionId`、`useTabInfo`（hook）、以及该 slot 的 inject 面 |
| `sidebar.right.pane.tab.title` | 类型 `id` | 同上；**返回标题节点**（页签 chip 与浮窗标题都走它）        |

```js
function Body({ useTabInfo, sessionId }) {
  const { tab } = useTabInfo() // { id, kind, title, visible, navigation, signal, actions }
  return createElement(Panel, {
    scope: { sessionId },
    visible: tab.visible !== false, // 停靠页签需侧边栏展开且该页签激活
  })
}
function Title({ useTabInfo }) {
  const { tab } = useTabInfo()
  return createElement('span', null, tab.title)
}
```

- `tab.visible`：停靠面板需「侧边栏展开 + 该页签激活」；展开标题含非激活页签；浮窗恒 true → 用作轮询开关。
- `tab.signal`：**仅在记录消失或插件卸载时中止**（不是隐藏/切会话）。
- `tab.actions`：`{ openResource, openTab, close }`（页签对自身操作，落在它所在会话）。
- `title` 席位渲染的 DOM 带 `data-slot="sidebar.right.pane.tab.title"`（宿主 slot 框架标记，可作 e2e 判据）。

## 打开与导航（`ctx.sidebarRight`）

```js
ctx.sidebarRight.openTab(kind, { paneId?, replaceTab?, params? })        // 打开页面类型
ctx.sidebarRight.openResource(address, { kind?, params?, revealIfOpened? })  // 打开资源（按地址认领）
```

- 页面类型**始终在目标 pane 内去重**（对应旧 `single: true` 语义）；资源类型默认按 `(kind, contentId)` 复用，`revealIfOpened: false` 允许重复。
- 空 pane 的 **guide 页**由 strip 的 add 控件打开（kind = `sidebar://guide`）；guide 列出所有注册类型的 `guide[]` 胶囊，按 `order` 升序。

## 从 `ctx.betterSidebar` 迁移映射（issue #187）

| better-sidebar                                                       | 原生等价                                                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `inject: ['betterSidebar']`                                          | `inject: ['slots', 'sidebarRightTabs']`                                                                                                         |
| `registerTab({ id, title, order, single, component })`               | `sidebarRightTabs.register({ id, kind, title, guide: [{ order, title }] })` + 两个 keyed 席位（key = id）                                       |
| `id: 'pkg:page'`                                                     | `id` = 包名（唯一 + 席位 key）；`kind` = 原 `'pkg:page'`                                                                                        |
| 数字 `order`（页签条排序）                                           | `guide[].order`（guide 胶囊顺序）；页签条顺序 = 打开顺序                                                                                        |
| `single: true`                                                       | 原生页面类型默认在 pane 内去重                                                                                                                  |
| `component({ scope, visible })`                                      | slot 组件收 `sessionId` + `useTabInfo()`（取 `tab.visible` / `tab.title`）                                                                      |
| `icon`                                                               | `guide[].icon`（仅 guide 胶囊；页签 chip 无 icon 位）                                                                                           |
| `registerFileViewer` / `matchFileViewer`                             | `ctx.documentPreviews.register`（`extensions`/`priority`/`candidates`；**字节由文档 owner 读**，与 better-sidebar 的 `fetchStrategy` 职责相反） |
| `openTab` / `closeTab` / `activateTab` / `updateTab` / `getTabs`     | `ctx.sidebarRight.openTab`/`openResource` + `tabs.entries()`；其余无原生等价（本仓 0 命中）                                                     |
| `badge` / `onOpen`/`onActivate`/`onClose` / `features` / `dedupeKey` | 无原生等价（本仓 0 命中，缺口影响面为零）                                                                                                       |

> 仍依赖 `dsh-better-sidebar` 的插件只剩 `dsh-file-activity`（预览器/浮窗/设置开关，批量 2 排期）。
