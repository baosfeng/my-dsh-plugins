/**
 * 原生侧边栏页签注册助手（issue #187 批 1；scripts/build.mjs 拼接片段）。
 *
 * 原生结构：每个面板一个**页签类型**（sidebarRightTabs.register）+ 两个
 * **keyed 席位**（slots.register，body 与 title）。id 全局唯一且是席位的
 * key，一个 key 只能注册一个席位 —— 本插件有两个独立面板，因此每个 kind 用
 * 自己的 id（沿用迁移前 better-sidebar 的 tab id）。
 *
 * 片段无 import/export，共享 client.src.js 的 factory 作用域：本函数的参数
 * 全部由调用方（apply）注入，便于单测与阅读。
 */
function registerNativeTab(ctx, tabs, slots, spec) {
  ctx.effect(
    () =>
      tabs.register({
        id: spec.id,
        kind: spec.id,
        title: spec.title,
        guide: [{ order: spec.order, title: spec.title }],
      }),
    'dsh-my-observability: ' + spec.label + ' tab',
  )
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: spec.id }, spec.Body),
      ),
    'dsh-my-observability: ' + spec.label + ' tab body',
  )
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register({ name: 'sidebar.right.pane.tab.title', key: spec.id }, spec.Title),
      ),
    'dsh-my-observability: ' + spec.label + ' tab title',
  )
}

/** 原生 tab title 席位：宿主给定标题优先，否则回退面板自带文案。 */
function nativeTabTitle(fallback) {
  return function TabTitle(props) {
    const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
    return createElement('span', null, info?.tab?.title ?? fallback())
  }
}
