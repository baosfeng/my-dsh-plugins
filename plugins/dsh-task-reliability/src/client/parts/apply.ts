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
 * client 端入口。
 *
 * 样式先注入（不依赖任何服务）；侧边栏页签在 betterSidebar 可用时注册，
 * 设置页 tab 走官方 slots 扩展点（attachSettingsTab 内部自行判空）。
 */
exports.apply = function apply(ctx: ClientContext): void {
  injectStyles(ctx)

  // strict=false：同理，首屏时 betterSidebar 服务的提供者 fiber 可能尚未
  // active，strict 取法返回 undefined 会让侧边栏页签静默不注册；取到实例
  // 后仍按下面的 typeof 判断降级（未安装 better-sidebar 时为 undefined）。
  const betterSidebar = ctx.get('betterSidebar', false) as SidebarService | undefined
  if (betterSidebar !== undefined && betterSidebar !== null && typeof betterSidebar.registerTab === 'function') {
    ctx.effect(
      () =>
        betterSidebar.registerTab({
          id: TAB_ID,
          title: () => strings.title(),
          order: 70,
          single: true,
          component: ({ scope, visible }) => createElement(Panel, { scope, visible }),
        }),
      'dsh-task-reliability: tab',
    )
  }

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
  STYLES,
  SETTINGS_STYLES,
}
