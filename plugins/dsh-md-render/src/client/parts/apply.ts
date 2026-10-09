/** 共享样式注入（dsh-shared/client-parts/style-tag.part.js，构建期拼接）。 */
declare function installStyles(
  ctx: { effect: (fn: () => void | (() => void), label?: string) => void },
  attr: string,
  css: string,
  label: string,
): void

exports.inject = []

exports.apply = function apply(ctx: {
  effect: (fn: () => void | (() => void), label?: string) => void
  get?: (name: string, strict?: boolean) => unknown
}): void {
  // 增强功能开关：默认全开；真实配置异步经 GET /md-render/api/config 拉取应用
  // （client 端不能访问 ctx.config——Cordis inject 限制，访问抛
  // "cannot get property without inject"，导致 client failed to apply）。
  setRenderOptions()
  initConfigFromServer()

  // 样式注入走共享实现：与 dsh-shared 的其它消费者同一份「无条件最先注入 +
  // 随 fiber teardown 卸载」逻辑（style-tag.part.js）。位置仍在最前、不进任何
  // 早退分支（dsh-file-activity 踩坑：挂在服务判空之后，HMR / 服务缺省时样式会丢）。
  installStyles(ctx, 'data-dsh-md-render', STYLES, 'dsh-md-render: styles')

  // 三个渲染注入点共用**一个** MutationObserver（scanner.ts 按语言分流）。
  ctx.effect(() => installScanner(), 'dsh-md-render: scanner')

  // 设置页 tab（官方 slots 扩展点，单 tab 三分组）。
  attachSettingsTab(ctx)
}
