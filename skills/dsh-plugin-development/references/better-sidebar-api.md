# 宿主原生侧边栏扩展点速查（`ctx.sidebarRightTabs` + keyed 席位）

> **本仓库全部插件已迁到宿主原生扩展点，无一个依赖第三方 `dsh-better-sidebar`。** 本文件早期版本记录的是该包的 `ctx.betterSidebar` API——**已废弃，不要照它写新插件**（该服务本机未安装，误用形态是**运行时静默不激活**，排查成本极高）。文件名保留仅为兼容既有引用。

1. 官方 [subsystems/sidebar-right.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.zh.md)——tab 注册字段表、slot 表、`ctx.sidebarRight` 选项表，含生成的 Cordis API 小节，读这一页即等价于读源码；keyed 席位机制另见 [slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md)。
2. 本仓库 [宿主API速查](../../../docs/官方文档/宿主API速查.md)——查 API 精确语义的入口；本机实存源码树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` 下 `dsh-client-ui-sidebar-*/lib/types/**/*.d.ts` 是签名真相。

**本仓库实测用到的四个服务**（只经 Cordis 服务名取，不 require 宿主包）：

| 服务名             | 用途                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `sidebarRightTabs` | 页签**类型**注册表：`register({ id, kind, patterns?, priority?, canOpen?, title, guide? })`         |
| `slots`            | keyed 席位注册：正文 `sidebar.right.pane.tab`、标题 `sidebar.right.pane.tab.title`，key = 类型 `id` |
| `sidebarRight`     | 导航控制器：`openTab(kind, opts)` / `openResource(address, opts)` / `close` / `split` / `float`     |
| `documentPreviews` | 文件预览器注册表（`extensions` / `priority`），由 `text` 页签工具栏调用                             |

```js
exports.inject = ['slots', 'sidebarRightTabs'] // 声明式依赖：服务就绪后插件才激活
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: PKG, kind: PKG + ':page', title: () => '页面名' }), 'tab type')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PKG }, Body),
      ),
    'tab body',
  )
}
```

> 参考实现：`plugins/dsh-file-activity/src/client/parts/apply.ts`（类型 + 正文 + 标题 + 预览器四件套）、`plugins/dsh-ts-example/src/client/index.ts`（最简 TS 版）。`id` 用包名（全局唯一 + 席位 key），`kind` 用 `包名:xxx`；`kind` 不得占用内置 `guide` / `text` / `files`。

## 迁移对照：读旧代码时用（左侧全部为已废弃写法）

- `inject: ['betterSidebar']`（已废弃）→ `inject: ['slots', 'sidebarRightTabs']`
- `registerTab({ id: 'pkg:page', order, single, component })`（已废弃）→ `sidebarRightTabs.register({ id: 包名, kind: 'pkg:page' })` + `sidebar.right.pane.tab` 席位
- 数字 `order`（页签条排序，已废弃）→ `guide[].order`（引导页胶囊顺序）；页签条顺序 = 打开顺序
- `component({ scope, visible })`（已废弃）→ 席位组件收 `sessionId`；实时信息经框架注入的 `useTabInfo()`
- `registerFileViewer`（已废弃）→ `ctx.documentPreviews.register(...)`（字节由文档 owner 读，职责与旧 API 相反）
- `openTab`/`closeTab`/`activateTab`/`updateTab`/`getTabs`（已废弃）→ `ctx.sidebarRight.openTab`/`openResource`；其余无原生等价（本仓库 0 命中）

> 迁移期取舍、浮窗与降级语义见 [侧边栏原生 API 迁移指南](../../../docs/开发指南/侧边栏原生API迁移指南.md)。
