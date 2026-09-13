// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：侧边栏页签走**宿主原生扩展点**（issue #187 批 1）——
// ctx.sidebarRightTabs.register 注册页面类型 + slots 的
// sidebar.right.pane.tab / .title 两个 keyed 席位注册面板与标题，不再消费
// 第三方 dsh-better-sidebar 服务。核心治理能力（候选区/隔离/安全模式）纯
// server 端，本面板只是诊断视图。
//
// 时序语义（迁移前 vs 迁移后）：迁移前用 ctx.get('<第三方服务>', false)
// 绕开「首屏提供者 fiber 未 active → strict 取法返回 undefined → 静默不注册，
// HMR 后才出现」；迁移后由**声明式 inject**（exports.inject）负责——宿主保证
// slots / sidebarRightTabs 可用后才激活本插件，首屏时序问题从根上消除。服务
// 实例仍按防御式判空（旧宿主/测试桩），缺失时静默跳过页签注册。
exports.inject = ['slots', 'sidebarRightTabs']

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
        guide: [{ order: TAB_ORDER, title: () => strings.title() }],
      }),
    'dsh-my-guardian: tab type',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID_PKG }, GuardianTabBody),
      ),
    'dsh-my-guardian: tab body',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID_PKG }, GuardianTabTitle),
      ),
    'dsh-my-guardian: tab title',
  )
}

/** 原生 tab body 席位：适配成 GuardianView 的 { sessionId, visible } 契约。 */
function GuardianTabBody(props: NativeTabProps): ElementLike {
  const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  return createElement(GuardianView, {
    sessionId: props.sessionId,
    visible: info?.tab?.visible !== false,
  }) as ElementLike
}

/** 原生 tab title 席位：宿主给定标题优先，否则回退本插件文案。 */
function GuardianTabTitle(props: NativeTabProps): ElementLike {
  const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
  return createElement('span', null, info?.tab?.title ?? strings.title()) as ElementLike
}
