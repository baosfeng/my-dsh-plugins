// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：不 inject better-sidebar（那是第三方插件服务）。面板是
// 可选增强——ctx.get('betterSidebar') 动态获取，服务不存在时静默跳过，
// 核心治理能力（候选区/隔离/安全模式）纯 server 端，不受影响。
exports.apply = function apply(ctx: ClientContext) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-my-guardian', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-guardian: styles')

  // strict=false：首屏加载时 betterSidebar 服务（由 dsh-better-sidebar 提供）
  // 的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true) 在
  // strict 模式下会返回 undefined，注册代码会静默 return（侧边栏看不到本
  // 插件页签，HMR 重载后才出现）；取到实例即可——未安装 better-sidebar 时
  // 仍返回 undefined（下面的判空降级不变），实际渲染发生在注册之后，安全。
  const service = ctx.get('betterSidebar', false)
  if (service === undefined) return

  ctx.effect(
    () =>
      service.registerTab({
        id: TAB_ID,
        title: () => strings.title(),
        order: 80,
        single: true,
        component: ({ scope, visible }: { scope: PanelScope; visible: boolean }) =>
          createElement(GuardianView, { sessionId: scope.sessionId, visible }),
      }),
    'dsh-my-guardian: tab registration',
  )
}
