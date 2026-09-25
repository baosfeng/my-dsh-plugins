# Client 端文件形态（必须用这个格式）

> 承接 [../SKILL.md](../SKILL.md) 的「开发流程」第 4 步；主文件只留决策流程，client 端的完整骨架与约束在本文件（被移出的正文逐字保留）。

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
          // guide 条目 id 必填（宿主 SidebarRightGuideEntry）：缺了注册不报错，但宿主把
          // entryId: undefined 传给 sidebar.right.tab.guide.entry 席位，同类型重复检测也失效
          guide: [{ id: TAB_ID, order: 20, title: () => '页面名' }], // 省略 guide = 进不了侧边栏引导页
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
- 文件预览器不走 tab：`ctx.documentPreviews.register({ id, extensions, title: () => '名称', loading: 'text-pages', priority: 'extension' })` 由 `text` 页签的工具栏调用。必填 `id` / `extensions` / `title`(thunk) / `loading`（取值 `'text-pages' | 'bytes-complete' | 'renderer'`）；`priority` 可选，取值 `'builtin' | 'extension'`（默认 extension）。
