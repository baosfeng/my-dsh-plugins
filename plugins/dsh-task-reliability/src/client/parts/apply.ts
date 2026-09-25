// ── plugin body ───────────────────────────────────────────────────────

/** 样式注入（与 fiber 同生命周期）：卸载时只移除本 fiber 自己插入的 <style>。 */
function injectStyles(ctx: ClientContext): void {
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-task-reliability', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode !== null) style.parentNode.removeChild(style)
    }
  }, 'dsh-task-reliability: styles')
}

/**
 * 侧边栏页签注册（宿主原生扩展点，issue #187 批 1）。
 *
 * 原生等价结构：
 *  - `sidebarRightTabs.register` 注册页面类型（id 用包名、kind 沿用迁移前的
 *    tab id、guide.order 沿用迁移前的 order(70)，用户从右栏指南页打开）；
 *  - `slots.register` 在 `sidebar.right.pane.tab` / `.title` 两个 keyed 席位
 *    注册面板本体与页签标题（key = 类型 id）。
 *
 * 降级语义（迁移前的「动态查第三方服务 + 缺省静默跳过」已不适用）：
 * 时序由**声明式 inject**（`exports.inject = ['slots', 'sidebarRightTabs']`）
 * 负责——宿主保证两个服务可用后才激活本插件，不再需要 strict=false 绕开
 * 「首屏提供者 fiber 未 active」；服务实例仍按防御式判空，缺失（旧宿主/测试
 * 桩）时静默跳过页签注册，样式注入不受影响。页签注册本身由 `slots.inject`
 * 等待槽位声明，实际渲染发生在之后。
 */
function attachSidebarTab(ctx: ClientContext): void {
  const tabs = ctx.get('sidebarRightTabs', false) as SidebarRightTabsService | undefined
  const slots = ctx.get('slots', false) as SlotsService | undefined
  if (tabs === undefined || tabs === null) return
  if (slots === undefined || slots === null) return

  ctx.effect(
    () =>
      tabs.register({
        id: TAB_ID_PKG,
        kind: TAB_ID,
        title: () => strings.title(),
        // guide 条目 id 必填（宿主 SidebarRightGuideEntry）：缺了它注册不报错，但宿主
        // 会把 entryId: undefined 传给 sidebar.right.tab.guide.entry 席位（静默降级）。
        guide: [{ id: TAB_ID_PKG, order: TAB_ORDER, title: () => strings.title() }],
      }),
    'dsh-task-reliability: tab',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID_PKG }, TaskReliabilityTabBody),
      ),
    'dsh-task-reliability: tab body',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID_PKG }, TaskReliabilityTabTitle),
      ),
    'dsh-task-reliability: tab title',
  )
}

/** 原生 tab body 席位：适配成 Panel 的 { scope, visible } 契约。 */
function TaskReliabilityTabBody(props: NativeTabProps): unknown {
  const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  return createElement(Panel, {
    scope: { sessionId: props.sessionId },
    visible: info?.tab?.visible !== false,
  })
}

/** 原生 tab title 席位：宿主给定标题优先，否则回退本插件文案。 */
function TaskReliabilityTabTitle(props: NativeTabProps): unknown {
  const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  return createElement('span', null, info?.tab?.title ?? strings.title())
}

/**
 * client 端入口。
 *
 * 样式先注入（不依赖任何服务）；侧边栏页签走宿主原生扩展点（服务缺失时
 * 静默跳过）；设置页 tab 走官方 slots 扩展点（attachSettingsTab 内部自行判空）。
 */
exports.apply = function apply(ctx: ClientContext): void {
  injectStyles(ctx)

  attachSidebarTab(ctx)

  // 设置页 tab（官方 slots 扩展点，issue #27 配置可视化）。
  attachSettingsTab(ctx)
}

// Internal functions exposed for the test suites only; inert in the browser
// bundle (plain properties on the exports object).
exports.__test = {
  isZh,
  strings,
  statusLabel,
  statusClass,
  settingsSections: SETTINGS_SECTIONS,
  settingsRow,
  settingsSection,
  injectStyles,
  attachSettingsTab,
  attachSidebarTab,
  STYLES,
  SETTINGS_STYLES,
}
