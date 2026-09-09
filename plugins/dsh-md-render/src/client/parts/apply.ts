exports.inject = []

exports.apply = function apply(ctx: {
  effect: (fn: () => void | (() => void), label?: string) => void
  get?: (name: string, strict?: boolean) => unknown
}): void {
  // 增强功能开关（issue #84）：默认全开；真实配置异步经 GET /md/api/config
  // 拉取应用（client 端不能访问 ctx.config——Cordis inject 限制，访问抛
  // "cannot get property without inject"，导致 client failed to apply）。
  setRenderOptions(pickRenderOptions())
  initConfigFromServer()

  // Stylesheet first, unconditionally (see dsh-file-activity pitfall:
  // injecting styles behind a service early-return loses them on HMR).
  ctx.effect(() => {
    if (typeof document === 'undefined' || document === null || typeof document.head === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-dsh-md-render', 'styles')
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, 'dsh-md-render: styles')

  ctx.effect(() => installScanner(), 'dsh-md-render: scanner')

  // 设置页 tab（官方 slots 扩展点，issue #84 配置可视化）。
  attachSettingsTab(ctx)
}
