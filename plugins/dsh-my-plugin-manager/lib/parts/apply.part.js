// ── plugin body ───────────────────────────────────────────────────────
// 零第三方依赖：面板挂在官方 slots 扩展点（设置 → 插件 → 插件管理），
// 不依赖 dsh-better-sidebar。slots 服务通过 ctx.get 动态获取——服务
// 缺省时静默跳过（不注册 tab，server 端 API 不受影响）。
exports.apply = function apply(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute(STYLE_TAG, 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-my-plugin-manager: styles')

  // ctx.get(name, strict = true) 默认是严格模式：服务提供者 fiber 未 active 时
  // 返回 undefined（cordis `_getImpl`: `if (strict && impl.fiber.state !== 2)
  // return`）。首屏加载时 slots 可能尚未 active，严格模式会静默跳过注册 →
  // 设置页看不到「插件管理」页签。传 strict = false 只按「服务是否已提供」
  // 判断，首屏也能拿到 slots；服务确实不存在时才降级跳过。
  const slots = ctx.get('slots', false)
  if (slots === undefined) return

  ctx.effect(
    () =>
      slots.inject('settings.plugins.tab', () =>
        slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'my-plugin-manager',
            order: 100,
            label: () => strings.title(),
          },
          PluginManagerView,
        ),
      ),
    'dsh-my-plugin-manager: settings tab registration',
  )
}
