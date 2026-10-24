// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → Skill 管理），
// 不依赖 dsh-better-sidebar。slots 服务通过 ctx.get 动态获取——服务缺省时
// 静默跳过（不注册 tab，server 端禁用能力不受影响）。
exports.apply = function apply(ctx: ClientContext): void {
  // 样式只做一次静态注入：不能放在任何服务判定之后，否则 HMR 重建 / 服务
  // 重载会让已渲染的 tab 失去样式。disposer 只移除本 fiber 自己的 <style>。
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') {
      return () => {}
    }
    const style = document.createElement('style')
    style.setAttribute(STYLE_TAG, 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-skill-manager: styles')

  // strict=false：首屏加载时 slots 服务（由 @deepseek-ai/dsh-client-ui-renderer
  // 提供）的提供者 fiber 尚未 active，cordis 的 ctx.get(name, strict = true)
  // 在 strict 模式下返回 undefined，注册代码会静默 return（设置页看不到
  // tab，HMR 重载后才出现）；取到实例即可——注册本身由 slots.inject 等待
  // 槽位声明，实际渲染发生在之后，安全。
  const slots = ctx.get('slots', false) as SlotsService | undefined
  if (slots === undefined) return

  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'my-skill-manager',
            order: 90,
            // label 用 thunk：宿主每次投影重读，切语言无需重新注册。
            label: () => strings.title(),
          },
          SkillManagerView,
        ),
      ),
    'dsh-my-skill-manager: settings tab registration',
  )
}
